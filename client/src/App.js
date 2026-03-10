import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './App.css';
import SettingsWizard from './SettingsWizard';
import History from './History';
import SLA from './SLA';
import Status from './Status';
import Observability from './Observability';
import Notifications from './Notifications';
import NotificationCenter from './NotificationCenter';
import { formatLocalTime, formatChartTime } from './utils/timeUtils';

// Simple duration formatter for incident spans
function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function Dashboard() {
  const [resources, setResources] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editData, setEditData] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    type: 'http',
    check_interval: 60000,
    timeout: 5000,
    group_id: null,
    http_keyword: '',
    http_headers: '',
    quiet_hours_start: '',
    quiet_hours_end: '',
    cert_expiry_days: 30,
    sla_target: 99.9,
    email_to: '',
    maintenance_mode: false,
    tags: '',
    consecutive_failures_threshold: 1,
    response_time_threshold: null,
  });
  const [tagFilter, setTagFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sortKey, setSortKey] = useState('severity');
  const [renderLimit, setRenderLimit] = useState(120);
  const [groupData, setGroupData] = useState({ name: '', description: '' });
  const wsRef = useRef(null);
  const actionsRef = useRef(null);
  const navigate = useNavigate();

  // Show toast notification
  const showNotification = (title, message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, title, message, type }]);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const loadResources = useCallback(async () => {
    try {
      const response = await axios.get('/api/dashboard');
      setResources(response.data.resources);
      setGroups(response.data.groups || []);
    } catch (error) {
      // Error loading resources handled
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Send initial ping to keep alive
        ws.send(JSON.stringify({ type: 'ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'dashboard') {
            setResources(message.data.resources || []);
            setGroups(message.data.groups || []);
          } else if (message.type === 'alert') {
            // Show real-time alert notification
            const alert = message.data;
            showNotification(`Alert: ${alert.resourceName}`, alert.message, 'error');
          } else if (message.type === 'incident') {
            // Show real-time incident notification
            const incident = message.data;
            if (incident.type === 'started') {
              showNotification(`Incident Started`, `${incident.resourceName} is down`, 'error');
            } else if (incident.type === 'resolved') {
              showNotification(`Incident Resolved`, `${incident.resourceName} is back up`, 'success');
            }
            // Refresh data to show updated incidents
            loadResources();
          } else if (message.type === 'metrics') {
            // Metrics update received (can be used for performance dashboard)
          }
        } catch (error) {
          // Parse error handled silently
        }
      };

      ws.onerror = (error) => {
        // WebSocket error handled
      };

      ws.onclose = () => {
        wsRef.current = null;
      };

      wsRef.current = ws;
    } catch (error) {
      loadResources();
    }
  }, [loadResources]);

  // Close Actions menu on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!actionsRef.current) return;
      if (!actionsRef.current.contains(e.target)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    // Try to connect via WebSocket
    connectWebSocket();

    // Fallback: poll every 15 seconds if WebSocket isn't available
    const fallbackInterval = setInterval(loadResources, 15000);
    
    return () => {
      clearInterval(fallbackInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket, loadResources]);

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/groups', groupData);
      setShowGroupModal(false);
      setGroupData({ name: '', description: '' });
      loadResources();
    } catch (error) {
      alert('Error creating group');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/resources', formData);
      setShowModal(false);
      setFormData({
        name: '',
        url: '',
        type: 'http',
        check_interval: 60000,
        timeout: 5000,
        group_id: null,
        http_keyword: '',
        http_headers: '',
        quiet_hours_start: '',
        quiet_hours_end: '',
        cert_expiry_days: 30,
        sla_target: 99.9,
        email_to: '',
        maintenance_mode: false,
        tags: '',
        consecutive_failures_threshold: 1,
        response_time_threshold: null,
      });
      loadResources();
    } catch (error) {
      alert('Error creating resource');
    }
  };

  const handleEditResource = async (id) => {
    try {
      const resource = resources.find(r => r.id === id);
      
      // Handle group change via PATCH if group_id changed
      if (editData.group_id !== resource?.group_id) {
        await axios.patch(`/api/resources/${id}/group`, { 
          group_id: editData.group_id || null 
        });
      }
      
      // Update other fields via PUT
      await axios.put(`/api/resources/${id}`, editData);
      setShowEditModal(false);
      setEditData({});
      loadResources();
    } catch (error) {
      alert('Error updating resource');
    }
  };

  const openEditModal = (resource) => {
    setEditData(resource);
    setShowEditModal(true);
  };

  const handleDeleteResource = async (id) => {
    if (window.confirm('Delete this resource?')) {
      try {
        await axios.delete(`/api/resources/${id}`);
        loadResources();
      } catch (error) {
        alert('Error deleting resource');
      }
    }
  };

  const handleToggleMaintenance = async (resource) => {
    try {
      await axios.patch(`/api/resources/${resource.id}/maintenance-mode`, {
        maintenance_mode: !resource.maintenance_mode,
      });
      loadResources();
    } catch (error) {
      alert('Error updating maintenance mode');
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await axios.get('/api/resources/export', {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `resources-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentChild.removeChild(link);
    } catch (error) {
      alert('Error exporting resources');
    }
  };

  const handleImportCSV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const response = await axios.post('/api/resources/import', text, {
        headers: { 'Content-Type': 'text/csv' }
      });

      alert(`Imported ${response.data.count} resources successfully!`);
      if (response.data.errors.length > 0) {
        alert(`Errors:\n${response.data.errors.join('\n')}`);
      }
      loadResources();
    } catch (error) {
      alert('Error importing resources');
    }

    // Reset file input
    e.target.value = '';
  };

  const groupNameById = groups.reduce((acc, g) => {
    acc[g.id] = g.name;
    return acc;
  }, {});

  const getTrend = (recentChecks = []) => {
    const withTimes = recentChecks.filter((c) => typeof c.response_time === 'number' && c.response_time > 0);
    if (withTimes.length < 2) return 'flat';
    const first = withTimes[0].response_time;
    const last = withTimes[withTimes.length - 1].response_time;
    if (first <= 0) return 'flat';
    const deltaPct = ((last - first) / first) * 100;
    if (deltaPct <= -12) return 'better';
    if (deltaPct >= 12) return 'worse';
    return 'flat';
  };

  const getSeverityScore = (r) => {
    const statusScore = r.status === 'down' ? 1000 : r.status === 'unknown' ? 400 : 0;
    const incidentScore = r.hasActiveIncident ? 350 : 0;
    const maintenanceOffset = r.maintenance_mode ? -300 : 0;
    const uptimePenalty = Math.max(0, 100 - parseFloat(r.uptime || 0)) * 3;
    const responsePenalty = Math.min(250, Math.round((parseInt(r.avgResponseTime || 0, 10) || 0) / 20));
    return statusScore + incidentScore + uptimePenalty + responsePenalty + maintenanceOffset;
  };

  // Filter resources by tag/group/quick filters
  const filteredResources = resources
    .filter((r) => {
      if (tagFilter) {
        const tags = (r.tags || '').toLowerCase();
        if (!tags.includes(tagFilter.toLowerCase())) return false;
      }
      if (groupFilter === 'ungrouped') return !r.group_id;
      if (groupFilter !== 'all') return String(r.group_id || '') === groupFilter;

      if (quickFilter === 'down' && r.status !== 'down') return false;
      if (quickFilter === 'maintenance' && !r.maintenance_mode) return false;
      if (quickFilter === 'nodata' && (!r.recentChecks || r.recentChecks.length === 0)) return false;
      if (quickFilter === 'slow' && (parseInt(r.avgResponseTime || 0, 10) || 0) < 1500) return false;

      return true;
    });

  const sortedResources = [...filteredResources].sort((a, b) => {
      if (sortKey === 'name') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sortKey === 'status') {
        const rank = { down: 0, unknown: 1, up: 2 };
        return (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
      }
      if (sortKey === 'uptime') {
        return parseFloat(a.uptime || 0) - parseFloat(b.uptime || 0);
      }
      if (sortKey === 'response') {
        return (parseInt(b.avgResponseTime || 0, 10) || 0) - (parseInt(a.avgResponseTime || 0, 10) || 0);
      }
      if (sortKey === 'lastcheck') {
        const ta = a.lastCheck ? new Date(a.lastCheck).getTime() : 0;
        const tb = b.lastCheck ? new Date(b.lastCheck).getTime() : 0;
        return tb - ta;
      }

      // Default: severity first
      const severityDiff = getSeverityScore(b) - getSeverityScore(a);
      if (severityDiff !== 0) return severityDiff;

      const groupA = (groupNameById[a.group_id] || 'Ungrouped').toLowerCase();
      const groupB = (groupNameById[b.group_id] || 'Ungrouped').toLowerCase();
      if (groupA < groupB) return -1;
      if (groupA > groupB) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

  useEffect(() => {
    setRenderLimit(120);
  }, [tagFilter, groupFilter, quickFilter, sortKey]);

  const visibleResources = sortedResources.slice(0, renderLimit);

  const totalCount = sortedResources.length;
  const upCount = sortedResources.filter((r) => r.status === 'up').length;
  const downCount = sortedResources.filter((r) => r.status === 'down').length;
  const maintenanceCount = sortedResources.filter((r) => r.maintenance_mode).length;
  const avgUptime = totalCount
    ? (sortedResources.reduce((sum, r) => sum + parseFloat(r.uptime || 0), 0) / totalCount).toFixed(2)
    : '0.00';
  const avgResponse = totalCount
    ? Math.round(sortedResources.reduce((sum, r) => sum + parseInt(r.avgResponseTime || 0, 10), 0) / totalCount)
    : 0;

  const activeIncidents = sortedResources
    .filter((r) => r.hasActiveIncident || r.status === 'down')
    .slice(0, 8);

  const groupCounts = groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      count: sortedResources.filter((r) => String(r.group_id || '') === String(g.id)).length,
    }))
    .filter((g) => g.count > 0);

  const ungroupedCount = sortedResources.filter((r) => !r.group_id).length;

  const renderResourceRow = (resource) => {
    const sparkData = (resource.recentChecks || []).map((c, idx) => ({
      idx,
      responseTime: c.response_time || 0,
      statusValue: c.status === 'up' ? 1 : 0,
    }));
    const groupName = groupNameById[resource.group_id] || 'Ungrouped';
    const trend = getTrend(resource.recentChecks || []);

    return (
      <div
        key={resource.id}
        className="resource-row"
        onClick={(e) => !e.target.closest('.row-actions') && navigate(`/resource/${resource.id}`)}
      >
        <div className="row-main">
          <div className="row-title-line">
            <h3 className="resource-name row-name">{resource.name}</h3>
            <span className="resource-group-pill">{groupName}</span>
            {resource.hasActiveIncident && <span className="incident-inline">active incident</span>}
            {resource.maintenance_mode && <span className="maintenance-inline">🛠 maintenance</span>}
          </div>
          <p className="resource-url row-url">{resource.url}</p>
          <p className="resource-type row-type">{resource.type}</p>
        </div>

        <div className="row-metrics">
          <div>
            <p className="stat-value small">{resource.uptime}%</p>
            <p className="stat-label">Uptime</p>
          </div>
          <div>
            <p className="stat-value small">
              {resource.avgResponseTime}ms
              <span className={`trend-chip trend-${trend}`}>{trend === 'better' ? '↓' : trend === 'worse' ? '↑' : '→'}</span>
            </p>
            <p className="stat-label">Avg Resp</p>
          </div>
          <div className="row-sparkline">
            {sparkData.length > 1 ? (
              <ResponsiveContainer width="100%" height={44}>
                <LineChart data={sparkData} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
                  <Line type="monotone" dataKey="responseTime" stroke="#14b8a6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <span className="last-check">No recent data</span>
            )}
          </div>
        </div>

        <div className="row-side">
          <span className={`status-badge status-${resource.status}`}>
            {resource.status}
          </span>
          <div className="row-actions">
            <button className="btn-icon action-edit" title="Edit" onClick={(e) => { e.stopPropagation(); openEditModal(resource); }}>✎</button>
            <button
              className="btn-icon action-maint"
              title={resource.maintenance_mode ? 'End maintenance' : 'Start maintenance'}
              onClick={(e) => { e.stopPropagation(); handleToggleMaintenance(resource); }}
            >
              {resource.maintenance_mode ? '✅' : '🛠'}
            </button>
            <button className="btn-icon action-delete" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteResource(resource.id); }}>🗑</button>
          </div>
          <p className="last-check">
            Last: {resource.lastCheck ? formatLocalTime(resource.lastCheck) : 'Never'}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="container">
      {/* Real-time Notifications */}
      {notifications.length > 0 && (
        <div className="toast-stack">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`toast-item toast-${notif.type}`}
            >
              <strong>{notif.title}</strong>
              <div>{notif.message}</div>
            </div>
          ))}
        </div>
      )}
      <div className="dashboard-toolbar">
        <div>
          <h2 className="dashboard-title">Command Center</h2>
          <p className="dashboard-subtitle">Live operational view of all monitors</p>
        </div>
        <div className="dashboard-actions">
          <NotificationCenter />
          <input
            type="text"
            placeholder="Filter by tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="tag-filter-input"
          />
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="tag-filter-input"
          >
            <option value="all">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>{g.name}</option>
            ))}
            <option value="ungrouped">Ungrouped</option>
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="tag-filter-input"
          >
            <option value="severity">Sort: Severity</option>
            <option value="status">Sort: Status</option>
            <option value="uptime">Sort: Uptime</option>
            <option value="response">Sort: Response</option>
            <option value="lastcheck">Sort: Last Check</option>
            <option value="name">Sort: Name</option>
          </select>
          <div ref={actionsRef} className="actions-menu-wrapper">
            <button
              className="btn btn-secondary"
              onClick={() => setActionsOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
            >
              Actions ▾
            </button>
            {actionsOpen && (
              <div
                role="menu"
                className="actions-menu"
              >
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); setShowGroupModal(true); }}
                  role="menuitem"
                >
                  + New Group
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); setShowModal(true); }}
                  role="menuitem"
                >
                  + Add Resource
                </button>
                <hr className="actions-menu-divider" />
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); handleExportCSV(); }}
                  role="menuitem"
                >
                  ⬇ Export CSV
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); document.getElementById('csv-import').click(); }}
                  role="menuitem"
                >
                  ⬆ Import CSV
                </button>
              </div>
            )}
          </div>
          <input
            id="csv-import"
            type="file"
            accept=".csv"
            className="hidden-file-input"
            onChange={handleImportCSV}
          />
        </div>
      </div>

      <div className="quick-filter-row">
        <button className={`quick-chip ${quickFilter === 'all' ? 'active' : ''}`} onClick={() => setQuickFilter('all')}>All</button>
        <button className={`quick-chip ${quickFilter === 'down' ? 'active' : ''}`} onClick={() => setQuickFilter('down')}>Down</button>
        <button className={`quick-chip ${quickFilter === 'maintenance' ? 'active' : ''}`} onClick={() => setQuickFilter('maintenance')}>Maintenance</button>
        <button className={`quick-chip ${quickFilter === 'slow' ? 'active' : ''}`} onClick={() => setQuickFilter('slow')}>High Latency</button>
        <button className={`quick-chip ${quickFilter === 'nodata' ? 'active' : ''}`} onClick={() => setQuickFilter('nodata')}>No Data</button>
      </div>

      <div className="cc-metrics-grid">
        <div className="cc-metric-card">
          <p className="cc-metric-label">Monitors</p>
          <p className="cc-metric-value">{totalCount}</p>
        </div>
        <div className="cc-metric-card metric-ok">
          <p className="cc-metric-label">Up</p>
          <p className="cc-metric-value">{upCount}</p>
        </div>
        <div className="cc-metric-card metric-down">
          <p className="cc-metric-label">Down</p>
          <p className="cc-metric-value">{downCount}</p>
        </div>
        <div className="cc-metric-card metric-maint">
          <p className="cc-metric-label">Maintenance</p>
          <p className="cc-metric-value">{maintenanceCount}</p>
        </div>
        <div className="cc-metric-card">
          <p className="cc-metric-label">Avg Uptime</p>
          <p className="cc-metric-value">{avgUptime}%</p>
        </div>
        <div className="cc-metric-card">
          <p className="cc-metric-label">Avg Resp</p>
          <p className="cc-metric-value">{avgResponse}ms</p>
        </div>
      </div>

      {resources.length === 0 ? (
        <div className="empty-state">
          <h3>No resources yet</h3>
          <p>Add your first resource to start monitoring</p>
        </div>
      ) : sortedResources.length === 0 ? (
        <div className="empty-state">
          <h3>No resources match filter</h3>
          <p>Try adjusting your tag/group filters</p>
        </div>
      ) : (
        <div className="cc-layout">
          <section className="resource-list-shell cc-main">
            <div className="resource-list-header">
              <div>Resource</div>
              <div>Metrics</div>
              <div>Status</div>
            </div>
              <div className="resource-list-count">{visibleResources.length} of {sortedResources.length} monitors</div>
            <div className="resource-list">
                {visibleResources.map(renderResourceRow)}
                {visibleResources.length < sortedResources.length && (
                  <button className="load-more-btn" onClick={() => setRenderLimit((prev) => prev + 120)}>
                    Load 120 more
                  </button>
                )}
            </div>
          </section>

          <aside className="cc-rail">
            <div className="cc-panel">
              <h3>Active Incidents</h3>
              {activeIncidents.length === 0 ? (
                <p className="cc-empty">No active incidents</p>
              ) : (
                <div className="cc-incident-list">
                  {activeIncidents.map((incident) => (
                    <button
                      key={incident.id}
                      className="cc-incident-item"
                      onClick={() => navigate(`/resource/${incident.id}`)}
                    >
                      <span className="cc-incident-name">{incident.name}</span>
                      <span className={`status-badge status-${incident.status}`}>{incident.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="cc-panel">
              <h3>Groups</h3>
              <div className="cc-group-list">
                {groupCounts.map((g) => (
                  <button
                    key={g.id}
                    className="cc-group-item"
                    onClick={() => setGroupFilter(String(g.id))}
                  >
                    <span>{g.name}</span>
                    <span>{g.count}</span>
                  </button>
                ))}
                {ungroupedCount > 0 && (
                  <button className="cc-group-item" onClick={() => setGroupFilter('ungrouped')}>
                    <span>Ungrouped</span>
                    <span>{ungroupedCount}</span>
                  </button>
                )}
              </div>
            </div>
          </aside>
          </div>
      )}

      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Group</h2>
            <form onSubmit={handleCreateGroup}>
              <div className="form-group">
                <label>Group Name *</label>
                <input
                  type="text"
                  value={groupData.name}
                  onChange={(e) => setGroupData({ ...groupData, name: e.target.value })}
                  required
                  placeholder="e.g., Production Servers"
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={groupData.description}
                  onChange={(e) => setGroupData({ ...groupData, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowGroupModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add New Resource</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="e.g., ZimaOS Home Server"
                />
              </div>

              <div className="form-group">
                <label>URL *</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                  placeholder="https://your-zima.example.com"
                />
              </div>

              <div className="form-group">
                <label>Group</label>
                <select
                  value={formData.group_id || ''}
                  onChange={(e) => setFormData({ ...formData, group_id: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">Ungrouped</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Check Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="http">HTTP/HTTPS</option>
                  <option value="health">Service Health</option>
                  <option value="tcp">TCP Port</option>
                  <option value="tls">TLS/SSL</option>
                  <option value="dns">DNS Lookup</option>
                  <option value="websocket">WebSocket</option>
                  <option value="icmp">ICMP Ping</option>
                </select>
              </div>

              <div className="form-group">
                <label>Check Interval (ms)</label>
                <input
                  type="number"
                  value={formData.check_interval}
                  onChange={(e) => setFormData({ ...formData, check_interval: parseInt(e.target.value) })}
                  min="10000"
                />
              </div>

              <div className="form-group">
                <label>Timeout (ms)</label>
                <input
                  type="number"
                  value={formData.timeout}
                  onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) })}
                  min="1000"
                />
              </div>

              {(formData.type === 'http' || formData.type === 'https' || formData.type === 'health') && (
                <>
                  <div className="form-group">
                    <label>Keyword to Match (optional)</label>
                    <input
                      type="text"
                      value={formData.http_keyword}
                      onChange={(e) => setFormData({ ...formData, http_keyword: e.target.value })}
                      placeholder="Text that must appear in response"
                    />
                  </div>

                  <div className="form-group">
                    <label>Custom Headers (JSON, optional)</label>
                    <textarea
                      value={formData.http_headers}
                      onChange={(e) => setFormData({ ...formData, http_headers: e.target.value })}
                      placeholder='{"Authorization": "Bearer token"}'
                      rows="2"
                    />
                  </div>
                </>
              )}

              {formData.type === 'tls' && (
                <div className="form-group">
                  <label>Certificate Expiry Warning (days)</label>
                  <input
                    type="number"
                    value={formData.cert_expiry_days}
                    onChange={(e) => setFormData({ ...formData, cert_expiry_days: parseInt(e.target.value) })}
                    min="1"
                    max="90"
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Quiet Hours Start (optional)</label>
                  <input
                    type="time"
                    value={formData.quiet_hours_start}
                    onChange={(e) => setFormData({ ...formData, quiet_hours_start: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Quiet Hours End (optional)</label>
                  <input
                    type="time"
                    value={formData.quiet_hours_end}
                    onChange={(e) => setFormData({ ...formData, quiet_hours_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="maintenance_mode_new"
                  checked={!!formData.maintenance_mode}
                  onChange={(e) => setFormData({ ...formData, maintenance_mode: e.target.checked })}
                />
                <label htmlFor="maintenance_mode_new" style={{ margin: 0 }}>Start in maintenance mode (no alerts sent)</label>
              </div>

              <div className="form-group">
                <label>SLA Target (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.sla_target}
                  onChange={(e) => setFormData({ ...formData, sla_target: parseFloat(e.target.value) })}
                  min="0"
                  max="100"
                />
              </div>

              <div className="form-group">
                <label>Alert Email Address (Optional)</label>
                <input
                  type="text"
                  placeholder="user@example.com or alice@example.com,bob@example.com (leave empty to use global setting)"
                  value={formData.email_to || ''}
                  onChange={(e) => setFormData({ ...formData, email_to: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Tags (comma-separated, e.g., frontend,production,critical)</label>
                <input
                  type="text"
                  placeholder="Enter tags to organize resources"
                  value={formData.tags || ''}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Consecutive Failures Before Alert</label>
                  <input
                    type="number"
                    min="1"
                    value={formData.consecutive_failures_threshold || 1}
                    onChange={(e) => setFormData({ ...formData, consecutive_failures_threshold: parseInt(e.target.value) })}
                  />
                  <small style={{ color: '#666', fontSize: '0.85rem' }}>Alert only after this many consecutive failures</small>
                </div>
                <div className="form-group">
                  <label>Response Time Threshold (ms)</label>
                  <input
                    type="number"
                    placeholder="e.g., 2000"
                    value={formData.response_time_threshold || ''}
                    onChange={(e) => setFormData({ ...formData, response_time_threshold: e.target.value ? parseInt(e.target.value) : null })}
                  />
                  <small style={{ color: '#666', fontSize: '0.85rem' }}>Alert if response time exceeds this value</small>
                </div>
              </div>

              <div className="form-group">
                <label>Data Retention (days)</label>
                <input
                  type="number"
                  placeholder="Leave empty to use global setting"
                  value={formData.retention_days || ''}
                  onChange={(e) => setFormData({ ...formData, retention_days: e.target.value ? parseInt(e.target.value) : null })}
                  min="1"
                  max="365"
                />
                <small style={{ color: '#666', fontSize: '0.85rem' }}>Override global retention period for this monitor only</small>
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Resource
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Resource</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleEditResource(editData.id); }}>
              <div className="form-group">
                <label>Resource Name *</label>
                <input
                  type="text"
                  value={editData.name || ''}
                  onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  required
                  placeholder="e.g., Production API"
                />
              </div>

              <div className="form-group">
                <label>URL/Address *</label>
                <input
                  type="text"
                  value={editData.url || ''}
                  onChange={(e) => setEditData({ ...editData, url: e.target.value })}
                  required
                  placeholder="e.g., https://api.example.com"
                />
              </div>

              <div className="form-group">
                <label>Check Type *</label>
                <select value={editData.type || 'http'} onChange={(e) => setEditData({ ...editData, type: e.target.value })}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="tcp">TCP</option>
                  <option value="dns">DNS</option>
                  <option value="ping">Ping</option>
                  <option value="health">Health API</option>
                  <option value="tls">TLS Certificate</option>
                </select>
              </div>

              <div className="form-group">
                <label>Check Interval (ms)</label>
                <input
                  type="number"
                  value={editData.check_interval || 60000}
                  onChange={(e) => setEditData({ ...editData, check_interval: parseInt(e.target.value) })}
                  min="10000"
                />
              </div>

              <div className="form-group">
                <label>Timeout (ms)</label>
                <input
                  type="number"
                  value={editData.timeout || 5000}
                  onChange={(e) => setEditData({ ...editData, timeout: parseInt(e.target.value) })}
                  min="1000"
                />
              </div>

              {(editData.type === 'http' || editData.type === 'https' || editData.type === 'health') && (
                <>
                  <div className="form-group">
                    <label>Keyword to Match (optional)</label>
                    <input
                      type="text"
                      value={editData.http_keyword || ''}
                      onChange={(e) => setEditData({ ...editData, http_keyword: e.target.value })}
                      placeholder="Text that must appear in response"
                    />
                  </div>

                  <div className="form-group">
                    <label>Custom Headers (JSON, optional)</label>
                    <textarea
                      value={editData.http_headers || ''}
                      onChange={(e) => setEditData({ ...editData, http_headers: e.target.value })}
                      placeholder='{"Authorization": "Bearer token"}'
                      rows="2"
                    />
                  </div>
                </>
              )}

              {editData.type === 'tls' && (
                <div className="form-group">
                  <label>Certificate Expiry Warning (days)</label>
                  <input
                    type="number"
                    value={editData.cert_expiry_days || 30}
                    onChange={(e) => setEditData({ ...editData, cert_expiry_days: parseInt(e.target.value) })}
                    min="1"
                    max="90"
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Quiet Hours Start (optional)</label>
                  <input
                    type="time"
                    value={editData.quiet_hours_start || ''}
                    onChange={(e) => setEditData({ ...editData, quiet_hours_start: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label>Quiet Hours End (optional)</label>
                  <input
                    type="time"
                    value={editData.quiet_hours_end || ''}
                    onChange={(e) => setEditData({ ...editData, quiet_hours_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="maintenance_mode_edit"
                  checked={!!editData.maintenance_mode}
                  onChange={(e) => setEditData({ ...editData, maintenance_mode: e.target.checked })}
                />
                <label htmlFor="maintenance_mode_edit" style={{ margin: 0 }}>Maintenance mode (suppress alerts)</label>
              </div>

              <div className="form-group">
                <label>SLA Target (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={editData.sla_target || 99.9}
                  onChange={(e) => setEditData({ ...editData, sla_target: parseFloat(e.target.value) })}
                  min="0"
                  max="100"
                />
              </div>

              <div className="form-group">
                <label>Group</label>
                <select
                  value={editData.group_id || ''}
                  onChange={(e) => setEditData({ ...editData, group_id: e.target.value ? parseInt(e.target.value) : null })}
                >
                  <option value="">Ungrouped</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Alert Email Address (Optional)</label>
                <input
                  type="text"
                  placeholder="user@example.com or alice@example.com,bob@example.com (leave empty to use global setting)"
                  value={editData.email_to || ''}
                  onChange={(e) => setEditData({ ...editData, email_to: e.target.value })}
                />
                <small style={{ color: '#666', fontSize: '0.85rem' }}>Comma-separated emails: alice@example.com,bob@example.com</small>
              </div>

              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  placeholder="Enter tags to organize resources"
                  value={editData.tags || ''}
                  onChange={(e) => setEditData({ ...editData, tags: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Consecutive Failures Before Alert</label>
                  <input
                    type="number"
                    min="1"
                    value={editData.consecutive_failures_threshold || 1}
                    onChange={(e) => setEditData({ ...editData, consecutive_failures_threshold: parseInt(e.target.value) })}
                  />
                  <small style={{ color: '#666', fontSize: '0.85rem' }}>Alert only after this many consecutive failures</small>
                </div>
                <div className="form-group">
                  <label>Response Time Threshold (ms)</label>
                  <input
                    type="number"
                    placeholder="e.g., 2000"
                    value={editData.response_time_threshold || ''}
                    onChange={(e) => setEditData({ ...editData, response_time_threshold: e.target.value ? parseInt(e.target.value) : null })}
                  />
                  <small style={{ color: '#666', fontSize: '0.85rem' }}>Alert if response time exceeds this value</small>
                </div>
              </div>

              <div className="form-group">
                <label>Data Retention (days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  placeholder="Leave empty to use global setting"
                  value={editData.retention_days || ''}
                  onChange={(e) => setEditData({ ...editData, retention_days: e.target.value ? parseInt(e.target.value) : null })}
                />
                <small style={{ color: '#666', fontSize: '0.85rem' }}>Override global retention period for this monitor only</small>
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowEditModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [resource, setResource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState([]);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checksStatus, setChecksStatus] = useState('');
  const [checksPage, setChecksPage] = useState(0);
  const checksLimit = 10;
  const [checksSort, setChecksSort] = useState('desc');

  const [incidents, setIncidents] = useState([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentsStatus, setIncidentsStatus] = useState('all');
  const [incidentsPage, setIncidentsPage] = useState(0);
  const incidentsLimit = 10;
  const [incidentsSort, setIncidentsSort] = useState('desc');
  const [expandedIncidentId, setExpandedIncidentId] = useState(null);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [editingIncident, setEditingIncident] = useState(null);
  const [incidentDescription, setIncidentDescription] = useState('');
  const [updatingIncident, setUpdatingIncident] = useState(false);

  const [sla, setSla] = useState(null);
  const [slaLoading, setSlaLoading] = useState(false);
  const slaWindow = 24;

  const [maintenanceWindows, setMaintenanceWindows] = useState([]);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({
    start_time: '',
    end_time: '',
    reason: ''
  });

  useEffect(() => {
    loadResource();
    loadChecks();
    loadIncidents();
    loadSla();
    loadMaintenanceWindows();
    const interval = setInterval(loadResource, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checksStatus, checksPage, checksSort]);

  useEffect(() => {
    loadIncidents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentsStatus, incidentsPage, incidentsSort]);

  const loadResource = async () => {
    try {
      const response = await axios.get(`/api/resources/${id}`);
      setResource(response.data);
      setLoading(false);
    } catch (error) {
      setLoading(false);
    }
  };

  const loadChecks = async () => {
    try {
      setChecksLoading(true);
      const response = await axios.get(`/api/resources/${id}/checks`, {
        params: {
          limit: checksLimit,
          offset: checksPage * checksLimit,
          status: checksStatus || undefined,
          sort: checksSort,
        },
      });
      setChecks(response.data.checks || []);
    } catch (error) {
      // Checks load error handled
    } finally {
      setChecksLoading(false);
    }
  };

  const loadIncidents = async () => {
    try {
      setIncidentsLoading(true);
      const response = await axios.get(`/api/resources/${id}/incidents`, {
        params: {
          limit: incidentsLimit,
          offset: incidentsPage * incidentsLimit,
          status: incidentsStatus,
          sort: incidentsSort,
        },
      });
      setIncidents(response.data.incidents || []);
    } catch (error) {
      // Incidents load error handled
    } finally {
      setIncidentsLoading(false);
    }
  };

  const handleEditIncident = (incident) => {
    setEditingIncident(incident);
    setIncidentDescription(incident.description || '');
    setShowIncidentModal(true);
  };

  const handleUpdateIncident = async () => {
    if (!editingIncident) return;
    
    try {
      setUpdatingIncident(true);
      await axios.patch(`/api/incidents/${editingIncident.id}`, {
        description: incidentDescription,
      });
      setShowIncidentModal(false);
      setEditingIncident(null);
      setIncidentDescription('');
      loadIncidents(); // Reload to show updated description
    } catch (error) {
      alert('Failed to update incident: ' + (error.response?.data?.error || error.message));
    } finally {
      setUpdatingIncident(false);
    }
  };

  const loadSla = async () => {
    try {
      setSlaLoading(true);
      const response = await axios.get(`/api/resources/${id}/sla`, { params: { hours: slaWindow } });
      setSla(response.data);
    } catch (error) {
      // SLA load error handled
    } finally {
      setSlaLoading(false);
    }
  };

  const loadMaintenanceWindows = async () => {
    try {
      const response = await axios.get(`/api/resources/${id}/maintenance-windows`);
      setMaintenanceWindows(response.data.windows || []);
    } catch (error) {
      // Maintenance windows load error handled
    }
  };

  const handleCreateMaintenanceWindow = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`/api/resources/${id}/maintenance-windows`, maintenanceForm);
      setShowMaintenanceModal(false);
      setMaintenanceForm({ start_time: '', end_time: '', reason: '' });
      loadMaintenanceWindows();
      alert('Maintenance window created');
    } catch (error) {
      alert('Error creating maintenance window');
    }
  };

  const handleDeleteMaintenanceWindow = async (windowId) => {
    if (window.confirm('Delete this maintenance window?')) {
      try {
        await axios.delete(`/api/maintenance-windows/${windowId}`);
        loadMaintenanceWindows();
      } catch (error) {
        alert('Error deleting maintenance window');
      }
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this resource?')) {
      try {
        await axios.delete(`/api/resources/${id}`);
        navigate('/');
      } catch (error) {
        alert('Error deleting resource');
      }
    }
  };

  const toggleEnabled = async () => {
    try {
      await axios.put(`/api/resources/${id}`, {
        ...resource,
        enabled: !resource.enabled,
      });
      loadResource();
    } catch (error) {
      // Update resource error handled
    }
  };

  const toggleMaintenance = async () => {
    try {
      await axios.put(`/api/resources/${id}`, {
        ...resource,
        maintenance_mode: !resource.maintenance_mode,
      });
      loadResource();
    } catch (error) {
      // Update maintenance mode error handled
    }
  };

  if (loading) return <div className="container">Loading...</div>;
  if (!resource) return <div className="container">Resource not found</div>;

  const chartData = resource.stats.checks.map((check) => ({
    time: formatChartTime(check.checked_at),
    responseTime: check.response_time,
    status: check.status === 'up' ? 1 : 0,
  }));

  return (
    <div className="container">
      <Link to="/" className="back-button">← Back to Dashboard</Link>

      <div className="detail-section">
        <div className="detail-header-row">
          <div>
            <h2>{resource.name}</h2>
            <p className="resource-url-detail">{resource.url}</p>
            <p className="resource-type">Type: {resource.type}</p>
          </div>
          <div className="detail-actions">
            <button className="btn" onClick={toggleEnabled}>
              {resource.enabled ? 'Disable' : 'Enable'}
            </button>
            <button className="btn btn-secondary" onClick={toggleMaintenance}>
              {resource.maintenance_mode ? 'End Maintenance' : 'Start Maintenance'}
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>

        {resource.hasActiveIncident && (
          <div className="incident-badge">⚠️ Active Incident - Resource is currently DOWN</div>
        )}
        {resource.maintenance_mode && (
          <div className="incident-badge maintenance-badge">
            🛠️ Maintenance mode active — alerts are suppressed
          </div>
        )}

        <div className="stats-grid stats-grid-4 detail-stats-grid">
          <div className="stat">
            <p className="stat-value">{resource.stats.uptime}%</p>
            <p className="stat-label">Uptime (24h)</p>
          </div>
          <div className="stat">
            <p className="stat-value">{resource.stats.avgResponseTime}ms</p>
            <p className="stat-label">Avg Response</p>
          </div>
          <div className="stat">
            <p className="stat-value">{resource.stats.totalChecks}</p>
            <p className="stat-label">Total Checks</p>
          </div>
          <div className="stat">
            <p className={`stat-value status-badge status-${resource.lastCheck?.status || 'unknown'}`}>
              {resource.lastCheck?.status || 'unknown'}
            </p>
            <p className="stat-label">Current Status</p>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h2>SLA / SLO (last {slaWindow}h)</h2>
        {slaLoading ? (
          <p>Loading SLA...</p>
        ) : !sla ? (
          <p>No SLA data yet</p>
        ) : (
          <div className="stats-grid stats-grid-4">
            <div className="stat">
              <p className="stat-value">{sla.uptimePct}%</p>
              <p className="stat-label">Uptime</p>
            </div>
            <div className="stat">
              <p className="stat-value">{formatDuration(sla.downtimeMinutes * 60000 || 0)}</p>
              <p className="stat-label">Downtime</p>
            </div>
            <div className="stat">
              <p className="stat-value">{sla.p95LatencyMs != null ? `${sla.p95LatencyMs}ms` : '—'}</p>
              <p className="stat-label">p95 Latency</p>
            </div>
            <div className="stat">
              <p className="stat-value">{sla.totalChecks}</p>
              <p className="stat-label">Checks in window</p>
            </div>
            <div className="stat">
              <p className="stat-value">{sla.mttrMinutes != null ? `${sla.mttrMinutes}m` : '—'}</p>
              <p className="stat-label">MTTR</p>
            </div>
            <div className="stat">
              <p className="stat-value">{sla.mtbfMinutes != null ? `${sla.mtbfMinutes}m` : '—'}</p>
              <p className="stat-label">MTBF</p>
            </div>
          </div>
        )}
      </div>

      <div className="detail-section">
        <h2>Response Time (Last 50 Checks)</h2>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#cbd5e1' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Line type="monotone" dataKey="responseTime" stroke="#60a5fa" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="detail-section">
        <h2>Recent Checks</h2>
        <div className="section-controls">
          <div className="filter-control">
            <label>Status</label>
            <select value={checksStatus} onChange={(e) => { setChecksPage(0); setChecksStatus(e.target.value); }}>
              <option value="">All</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
            </select>
          </div>
          <div className="filter-control">
            <label>Sort</label>
            <select value={checksSort} onChange={(e) => { setChecksPage(0); setChecksSort(e.target.value); }}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div className="controls-pagination">
            <button className="btn btn-secondary" disabled={checksPage === 0 || checksLoading} onClick={() => setChecksPage(Math.max(0, checksPage - 1))}>← Prev</button>
            <button className="btn btn-secondary" disabled={checksLoading || checks.length < checksLimit} onClick={() => setChecksPage(checksPage + 1)}>Next →</button>
          </div>
        </div>
        <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Status</th>
              <th className="text-right">Response Time</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {checksLoading ? (
              <tr><td colSpan="4">Loading checks...</td></tr>
            ) : checks.length === 0 ? (
              <tr><td colSpan="4">No checks found</td></tr>
            ) : checks.map((check) => (
              <tr key={check.id}>
                <td>
                  {formatLocalTime(check.checked_at)}
                </td>
                <td>
                  <span className={`status-badge status-${check.status}`}>
                    {check.status}
                  </span>
                </td>
                <td className="text-right">
                  {check.response_time ? `${check.response_time}ms` : '-'}
                </td>
                <td className="muted-cell">
                  {check.error_message || 'OK'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="detail-section">
        <h2>Incidents Timeline</h2>
        <div className="section-controls">
          <div className="filter-control">
            <label>Status</label>
            <select value={incidentsStatus} onChange={(e) => { setIncidentsPage(0); setIncidentsStatus(e.target.value); }}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="filter-control">
            <label>Sort</label>
            <select value={incidentsSort} onChange={(e) => { setIncidentsPage(0); setIncidentsSort(e.target.value); }}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div className="controls-pagination">
            <button className="btn btn-secondary" disabled={incidentsPage === 0 || incidentsLoading} onClick={() => setIncidentsPage(Math.max(0, incidentsPage - 1))}>← Prev</button>
            <button className="btn btn-secondary" disabled={incidentsLoading || incidents.length < incidentsLimit} onClick={() => setIncidentsPage(incidentsPage + 1)}>Next →</button>
          </div>
        </div>
        <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-25">Started</th>
              <th className="w-25">Resolved</th>
              <th className="w-15">Duration</th>
              <th className="w-35">Reason</th>
            </tr>
          </thead>
          <tbody>
            {incidentsLoading ? (
              <tr><td colSpan="4">Loading incidents...</td></tr>
            ) : incidents.length === 0 ? (
              <tr><td colSpan="4">No incidents found</td></tr>
            ) : incidents.map((incident) => {
              const start = incident.started_at || incident.created_at;
              const end = incident.resolved_at;
              const durationMs = start && end ? (new Date(end).getTime() - new Date(start).getTime()) : null;
              const durationText = durationMs != null ? formatDuration(durationMs) : 'Ongoing';
              const isExpanded = expandedIncidentId === incident.id;
              const description = incident.description || 'No description';
              const isTruncated = description.length > 60;
              const displayText = isExpanded ? description : (isTruncated ? description.substring(0, 60) + '...' : description);
              return (
                <>
                  <tr key={incident.id}>
                    <td>{start ? formatLocalTime(start) : '-'}</td>
                    <td>{end ? formatLocalTime(end) : 'Open'}</td>
                    <td>{durationText}</td>
                    <td className="incident-reason-cell">
                      <span className="incident-reason-toggle" onClick={() => setExpandedIncidentId(isExpanded ? null : incident.id)}>
                        {displayText}
                        {isTruncated && (
                          <span className="expand-indicator">
                            {isExpanded ? '▼' : '▶'}
                          </span>
                        )}
                      </span>
                      <button
                        className="btn btn-secondary btn-compact"
                        onClick={() => handleEditIncident(incident)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="expanded-row">
                      <td colSpan="4" className="expanded-cell">
                        {description}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title-row">
          <h2>Maintenance Windows</h2>
          <button className="btn btn-primary" onClick={() => setShowMaintenanceModal(true)}>
            + Schedule Maintenance
          </button>
        </div>
        {maintenanceWindows.length === 0 ? (
          <p className="empty-copy">No maintenance windows scheduled</p>
        ) : (
          <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Reason</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {maintenanceWindows.map(window => (
                <tr key={window.id}>
                  <td>{formatLocalTime(window.start_time)}</td>
                  <td>{formatLocalTime(window.end_time)}</td>
                  <td className="muted-cell">{window.reason || '-'}</td>
                  <td className="text-right">
                    <button 
                      className="btn btn-danger btn-compact"
                      onClick={() => handleDeleteMaintenanceWindow(window.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {showMaintenanceModal && (
        <div className="modal-overlay" onClick={() => setShowMaintenanceModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Schedule Maintenance Window</h2>
            <form onSubmit={handleCreateMaintenanceWindow}>
              <div className="form-group">
                <label>Start Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={maintenanceForm.start_time}
                  onChange={(e) => setMaintenanceForm({ ...maintenanceForm, start_time: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>End Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={maintenanceForm.end_time}
                  onChange={(e) => setMaintenanceForm({ ...maintenanceForm, end_time: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Reason (Optional)</label>
                <textarea
                  rows="3"
                  placeholder="Planned maintenance, server upgrade, etc."
                  value={maintenanceForm.reason}
                  onChange={(e) => setMaintenanceForm({ ...maintenanceForm, reason: e.target.value })}
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowMaintenanceModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showIncidentModal && editingIncident && (
        <div className="modal-overlay" onClick={() => setShowIncidentModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Incident</h2>
            <div className="form-group">
              <label style={{ fontSize: '0.9rem', color: '#666' }}>Incident Started</label>
              <div style={{ padding: '0.5rem', backgroundColor: '#f5f5f5', borderRadius: '4px', marginBottom: '1rem' }}>
                {formatLocalTime(editingIncident.started_at || editingIncident.created_at)}
              </div>
            </div>
            <div className="form-group">
              <label>Description *</label>
              <textarea
                rows="6"
                placeholder="Describe what happened and why..."
                value={incidentDescription}
                onChange={(e) => setIncidentDescription(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
              />
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowIncidentModal(false);
                  setEditingIncident(null);
                  setIncidentDescription('');
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                onClick={handleUpdateIncident}
                disabled={updatingIncident || !incidentDescription.trim()}
              >
                {updatingIncident ? 'Updating...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Navbar() {
  const [notificationsConfigured, setNotificationsConfigured] = useState(false);

  useEffect(() => {
    checkNotifications();
  }, []);

  const checkNotifications = async () => {
    try {
      const response = await axios.get('/api/settings');
      setNotificationsConfigured(response.data.email_enabled || response.data.webhook_enabled);
      // Cache server timezone for timestamp formatting with timestamp
      if (response.data.timezone) {
        localStorage.setItem('serverTimezone', response.data.timezone);
        localStorage.setItem('serverTimezoneTime', Date.now().toString());
      }
    } catch (error) {
      // Notifications check error handled
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-left">
          <h1>🔍 SkyWatch</h1>
          <div className="navbar-links">
            <Link to="/" className="nav-link">Dashboard</Link>
            <Link to="/history" className="nav-link">History</Link>
            <Link to="/sla" className="nav-link">SLA</Link>
            <Link to="/observability" className="nav-link">Observability</Link>
            <Link to="/notifications" className="nav-link">Notifications</Link>
            <Link to="/settings" className="nav-link settings-link">
              Settings
              {!notificationsConfigured && (
                <span className="setup-badge">SETUP</span>
              )}
            </Link>
          </div>
        </div>
        {notificationsConfigured && (
          <div className="notifications-pill">
            <span>🔔</span>
            <span>Notifications Active</span>
          </div>
        )}
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <Navbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/resource/:id" element={<ResourceDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/sla" element={<SLA />} />
          <Route path="/settings" element={<div className="container"><SettingsWizard /></div>} />
          <Route path="/status" element={<Status />} />
          <Route path="/observability" element={<Observability />} />
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
