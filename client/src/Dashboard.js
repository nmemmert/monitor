import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import NotificationCenter from './NotificationCenter';
import { formatLocalTime } from './utils/timeUtils';

const HTTP_METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH'];

function Dashboard() {
  const [resources, setResources] = useState([]);
  const [groups, setGroups] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoveryHosts, setDiscoveryHosts] = useState([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoverySubnet, setDiscoverySubnet] = useState('');
  const [localSubnets, setLocalSubnets] = useState([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editData, setEditData] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    type: 'http',
    check_interval: null,
    timeout: null,
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
    is_public: true,
    heartbeat_timeout: 300000,
    http_method: 'GET',
    http_body: '',
  });
  const [searchText, setSearchText] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [quickFilter, setQuickFilter] = useState('all');
  const [sortKey, setSortKey] = useState('severity');
  const [renderLimit, setRenderLimit] = useState(120);
  const [refreshInterval, setRefreshInterval] = useState(15000);
  const [globalCheckInterval, setGlobalCheckInterval] = useState(60000);
  const [globalTimeout, setGlobalTimeout] = useState(5000);
  const [loaded, setLoaded] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [groupData, setGroupData] = useState({ name: '', description: '' });
  const [selectedIds, setSelectedIds] = useState(new Set());
  const wsRef = useRef(null);
  const wsReconnectTimer = useRef(null);
  const wsReconnectDelay = useRef(1000);
  const actionsRef = useRef(null);
  const navigate = useNavigate();

  const showNotification = (title, message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const loadResources = useCallback(async () => {
    try {
      const response = await axios.get('/api/dashboard');
      setResources(response.data.resources);
      setGroups(response.data.groups || []);
      setLoaded(true);
    } catch (error) {
      setLoaded(true);
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        wsReconnectDelay.current = 1000;
        ws.send(JSON.stringify({ type: 'ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'dashboard') {
            setResources(message.data.resources || []);
            setGroups(message.data.groups || []);
            setLoaded(true);
          } else if (message.type === 'alert') {
            const alert = message.data;
            showNotification(`Alert: ${alert.resourceName}`, alert.message, 'error');
          } else if (message.type === 'incident') {
            const incident = message.data;
            if (incident.type === 'started') {
              showNotification('Incident Started', `${incident.resourceName} is down`, 'error');
            } else if (incident.type === 'resolved') {
              showNotification('Incident Resolved', `${incident.resourceName} is back up`, 'success');
            }
            loadResources();
          }
        } catch (error) {
          // Parse error handled silently
        }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        wsRef.current = null;
        wsReconnectTimer.current = setTimeout(() => {
          wsReconnectDelay.current = Math.min(wsReconnectDelay.current * 2, 30000);
          connectWebSocket();
        }, wsReconnectDelay.current);
      };

      wsRef.current = ws;
    } catch (error) {
      loadResources();
    }
  }, [loadResources]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!actionsRef.current) return;
      if (!actionsRef.current.contains(e.target)) setActionsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    axios.get('/api/settings').then(res => {
      const s = res.data;
      if (s.items_per_page) setRenderLimit(parseInt(s.items_per_page));
      if (s.default_sort) setSortKey(s.default_sort);
      if (s.refresh_interval) setRefreshInterval(parseInt(s.refresh_interval));
      if (s.check_interval) setGlobalCheckInterval(parseInt(s.check_interval));
      if (s.timeout) setGlobalTimeout(parseInt(s.timeout));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadResources();
    connectWebSocket();
    const fallbackInterval = setInterval(loadResources, refreshInterval);
    return () => {
      clearInterval(fallbackInterval);
      clearTimeout(wsReconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWebSocket, loadResources, refreshInterval]);

  const emptyForm = {
    name: '', url: '', type: 'http', check_interval: null, timeout: null,
    group_id: null, http_keyword: '', http_headers: '', quiet_hours_start: '',
    quiet_hours_end: '', cert_expiry_days: 30, sla_target: 99.9, email_to: '',
    maintenance_mode: false, tags: '', consecutive_failures_threshold: 1,
    response_time_threshold: null, is_public: true, heartbeat_timeout: 300000,
    http_method: 'GET', http_body: '',
  };

  const handleCreateGroup = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/groups', groupData);
      setShowGroupModal(false);
      setGroupData({ name: '', description: '' });
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to create group', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/resources', formData);
      setShowModal(false);
      setFormData(emptyForm);
      if (res.data.heartbeat_token) {
        const pingUrl = `${window.location.origin}/api/heartbeat/${res.data.heartbeat_token}`;
        showNotification('Heartbeat Created', `Ping URL: ${pingUrl}`, 'success');
      }
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to add resource', 'error');
    }
  };

  const handleEditResource = async (id) => {
    try {
      const resource = resources.find(r => r.id === id);
      if (editData.group_id !== resource?.group_id) {
        await axios.patch(`/api/resources/${id}/group`, { group_id: editData.group_id || null });
      }
      await axios.put(`/api/resources/${id}`, editData);
      setShowEditModal(false);
      setEditData({});
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to update resource', 'error');
    }
  };

  const openEditModal = (resource) => {
    setEditData(resource);
    setShowEditModal(true);
  };

  const handleDeleteResource = async (id) => {
    try {
      await axios.delete(`/api/resources/${id}`);
      setPendingDeleteId(null);
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to delete resource', 'error');
      setPendingDeleteId(null);
    }
  };

  const handleToggleMaintenance = async (resource) => {
    try {
      await axios.patch(`/api/resources/${resource.id}/maintenance-mode`, {
        maintenance_mode: !resource.maintenance_mode,
      });
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to update maintenance mode', 'error');
    }
  };

  const handleAcknowledge = async (incidentId) => {
    try {
      await axios.post(`/api/incidents/${incidentId}/acknowledge`);
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to acknowledge incident', 'error');
    }
  };

  const handleBulkDelete = async () => {
    try {
      await Promise.all([...selectedIds].map(id => axios.delete(`/api/resources/${id}`)));
      setSelectedIds(new Set());
      setPendingBulkDelete(false);
      loadResources();
    } catch (error) {
      showNotification('Error', 'Some deletes failed', 'error');
      setPendingBulkDelete(false);
    }
  };

  const handleBulkMaintenance = async (enable) => {
    try {
      await Promise.all([...selectedIds].map(id =>
        axios.patch(`/api/resources/${id}/maintenance-mode`, { maintenance_mode: enable })
      ));
      setSelectedIds(new Set());
      loadResources();
    } catch (error) {
      showNotification('Error', 'Some maintenance updates failed', 'error');
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === visibleResources.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleResources.map(r => r.id)));
    }
  };

  const handleDiscover = async (subnet = null) => {
    setShowDiscovery(true);
    setDiscoveryHosts([]);
    setDiscoveryLoading(true);
    // Fetch local subnets for the quick-select buttons (fire-and-forget)
    axios.get('/api/network-subnets').then(r => setLocalSubnets(r.data.subnets || [])).catch(() => {});
    try {
      const res = await axios.post('/api/network-discovery', { subnet: subnet || discoverySubnet || null });
      setDiscoveryHosts(res.data.hosts || []);
    } catch (error) {
      showNotification('Error', 'Network discovery failed', 'error');
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const addDiscoveredHost = (host) => {
    setFormData({
      ...emptyForm,
      name: host.hostname || host.ip,
      url: host.suggestedUrl || '',
      type: host.suggestedType || 'http',
    });
    setShowDiscovery(false);
    setShowModal(true);
  };

  const handleExportCSV = async () => {
    try {
      const response = await axios.get('/api/resources/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `resources-${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
    } catch (error) {
      showNotification('Error', 'Failed to export resources', 'error');
    }
  };

  const handleImportCSV = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const response = await axios.post('/api/resources/import', text, {
        headers: { 'Content-Type': 'text/csv' },
      });
      showNotification('Import Complete', `Imported ${response.data.count} resource(s)`, 'success');
      if (response.data.errors.length > 0) showNotification('Import Warnings', response.data.errors[0], 'warning');
      loadResources();
    } catch (error) {
      showNotification('Error', 'Failed to import resources', 'error');
    }
    e.target.value = '';
  };

  const groupNameById = groups.reduce((acc, g) => { acc[g.id] = g.name; return acc; }, {});

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

  const filteredResources = resources.filter((r) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.url.toLowerCase().includes(q)) return false;
    }
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
    if (sortKey === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    if (sortKey === 'status') {
      const rank = { down: 0, unknown: 1, up: 2 };
      return (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    }
    if (sortKey === 'uptime') return parseFloat(a.uptime || 0) - parseFloat(b.uptime || 0);
    if (sortKey === 'response') return (parseInt(b.avgResponseTime || 0, 10) || 0) - (parseInt(a.avgResponseTime || 0, 10) || 0);
    if (sortKey === 'lastcheck') {
      const ta = a.lastCheck ? new Date(a.lastCheck).getTime() : 0;
      const tb = b.lastCheck ? new Date(b.lastCheck).getTime() : 0;
      return tb - ta;
    }
    const severityDiff = getSeverityScore(b) - getSeverityScore(a);
    if (severityDiff !== 0) return severityDiff;
    const groupA = (groupNameById[a.group_id] || 'Ungrouped').toLowerCase();
    const groupB = (groupNameById[b.group_id] || 'Ungrouped').toLowerCase();
    if (groupA < groupB) return -1;
    if (groupA > groupB) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  useEffect(() => { setRenderLimit(120); }, [searchText, tagFilter, groupFilter, quickFilter, sortKey]);

  const visibleResources = sortedResources.slice(0, renderLimit);

  const totalCount = sortedResources.length;
  const upCount = sortedResources.filter((r) => r.status === 'up').length;
  const downCount = sortedResources.filter((r) => r.status === 'down').length;
  const maintenanceCount = sortedResources.filter((r) => r.maintenance_mode).length;
  const avgUptime = totalCount
    ? (sortedResources.reduce((sum, r) => sum + parseFloat(r.uptime || 0), 0) / totalCount).toFixed(2)
    : '0.00';
  const avgResponse = totalCount
    ? Math.round(sortedResources.reduce((sum, r) => sum + (parseInt(r.avgResponseTime || 0, 10) || 0), 0) / totalCount)
    : 0;

  const activeIncidents = sortedResources.filter((r) => r.hasActiveIncident || r.status === 'down').slice(0, 8);

  const allTags = [...new Set(
    resources.flatMap(r => (r.tags || '').split(',').map(t => t.trim()).filter(Boolean))
  )].sort();

  const groupCounts = groups
    .map((g) => ({
      id: g.id,
      name: g.name,
      count: sortedResources.filter((r) => String(r.group_id || '') === String(g.id)).length,
    }))
    .filter((g) => g.count > 0);

  const ungroupedCount = sortedResources.filter((r) => !r.group_id).length;

  const renderResourceRow = (resource) => {
    const checks = resource.recentChecks || [];
    const groupName = groupNameById[resource.group_id] || 'Ungrouped';
    const trend = getTrend(checks);
    const isSelected = selectedIds.has(resource.id);

    return (
      <div
        key={resource.id}
        className={`resource-row${isSelected ? ' resource-row-selected' : ''}`}
        onClick={(e) => !e.target.closest('.row-actions') && !e.target.closest('.row-checkbox') && navigate(`/resource/${resource.id}`)}
      >
        <label className="row-checkbox" onClick={(e) => e.stopPropagation()} title="Select for bulk actions">
          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(resource.id)} />
        </label>

        <div className="row-main">
          <div className="row-title-line">
            <h3 className="resource-name row-name">{resource.name}</h3>
            <span className="resource-group-pill">{groupName}</span>
            {!!resource.hasActiveIncident && <span className="incident-inline">active incident</span>}
            {!!resource.maintenance_mode && <span className="maintenance-inline">🛠 maintenance</span>}
            {resource.type === 'tls' && resource.certDaysRemaining !== null && resource.certDaysRemaining <= 30 && (
              <span
                className="maintenance-inline"
                style={{ background: resource.certDaysRemaining <= 7 ? '#d32f2f' : '#f57c00', color: '#fff' }}
                title={`SSL cert expires in ${resource.certDaysRemaining} days`}
              >
                🔒 cert exp {resource.certDaysRemaining}d
              </span>
            )}
          </div>
          <p className="resource-url row-url">{resource.type === 'heartbeat' ? '(heartbeat)' : resource.url}</p>
          <p className="resource-type row-type">{resource.type}</p>
        </div>

        <div className="row-metrics">
          <div>
            <p className="stat-value small">{resource.uptime}%</p>
            <p className="stat-label">Uptime</p>
          </div>
          <div>
            <p className="stat-value small">
              {isNaN(parseInt(resource.avgResponseTime, 10)) ? '—' : `${resource.avgResponseTime}ms`}
              <span className={`trend-chip trend-${trend}`}>{trend === 'better' ? '↓' : trend === 'worse' ? '↑' : '→'}</span>
            </p>
            <p className="stat-label">Avg Resp</p>
          </div>
          <div className="row-sparkline">
            {checks.length > 0 ? (
              <div className="status-spark-bars" title="Recent check status (newest on right)">
                {checks.map((c, i) => (
                  <div
                    key={i}
                    className={`spark-bar spark-bar-${c.status || 'unknown'}`}
                    title={`${c.status}${c.response_time ? ` — ${c.response_time}ms` : ''}`}
                  />
                ))}
              </div>
            ) : (
              <span className="last-check">No recent data</span>
            )}
          </div>
        </div>

        <div className="row-side">
          <span className={`status-badge status-${resource.status}`}>{resource.status}</span>
          <div className="row-actions">
            <button className="btn-icon action-edit" title="Edit" onClick={(e) => { e.stopPropagation(); openEditModal(resource); }}>✎</button>
            <button
              className="btn-icon action-maint"
              title={resource.maintenance_mode ? 'End maintenance' : 'Start maintenance'}
              onClick={(e) => { e.stopPropagation(); handleToggleMaintenance(resource); }}
            >
              {resource.maintenance_mode ? '✅' : '🛠'}
            </button>
            {pendingDeleteId === resource.id ? (
              <>
                <button className="btn-icon action-delete-confirm" title="Confirm delete" onClick={(e) => { e.stopPropagation(); handleDeleteResource(resource.id); }}>✓</button>
                <button className="btn-icon" title="Cancel" onClick={(e) => { e.stopPropagation(); setPendingDeleteId(null); }}>✕</button>
              </>
            ) : (
              <button className="btn-icon action-delete" title="Delete" onClick={(e) => { e.stopPropagation(); setPendingDeleteId(resource.id); }}>🗑</button>
            )}
          </div>
          <p className="last-check">Last: {resource.lastCheck ? formatLocalTime(resource.lastCheck) : 'Never'}</p>
        </div>
      </div>
    );
  };

  const HttpMethodBodyFields = ({ data, setData }) => {
    const isHttpType = ['http', 'https', 'health'].includes(data.type);
    if (!isHttpType) return null;
    return (
      <>
        <div className="form-group">
          <label>HTTP Method</label>
          <select
            value={data.http_method || 'GET'}
            onChange={(e) => setData({ ...data, http_method: e.target.value, http_body: HTTP_METHODS_WITH_BODY.includes(e.target.value) ? (data.http_body || '') : '' })}
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {HTTP_METHODS_WITH_BODY.includes(data.http_method || 'GET') && (
          <div className="form-group">
            <label>Request Body (JSON or plain text)</label>
            <textarea
              value={data.http_body || ''}
              onChange={(e) => setData({ ...data, http_body: e.target.value })}
              placeholder='{"key": "value"}'
              rows="3"
            />
          </div>
        )}
      </>
    );
  };

  return (
    <div className="container">
      {notifications.length > 0 && (
        <div className="toast-stack">
          {notifications.map(notif => (
            <div key={notif.id} className={`toast-item toast-${notif.type}`}>
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
            placeholder="Search monitors..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="tag-filter-input"
          />
          <input
            type="text"
            placeholder="Filter by tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="tag-filter-input"
          />
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="tag-filter-input">
            <option value="all">All groups</option>
            {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
            <option value="ungrouped">Ungrouped</option>
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} className="tag-filter-input">
            <option value="severity">Sort: Severity</option>
            <option value="status">Sort: Status</option>
            <option value="uptime">Sort: Uptime</option>
            <option value="response">Sort: Response</option>
            <option value="lastcheck">Sort: Last Check</option>
            <option value="name">Sort: Name</option>
          </select>
          <div ref={actionsRef} className="actions-menu-wrapper">
            <button className="btn btn-secondary" onClick={() => setActionsOpen((o) => !o)} aria-haspopup="menu" aria-expanded={actionsOpen}>
              Actions ▾
            </button>
            {actionsOpen && (
              <div role="menu" className="actions-menu">
                <button className="btn btn-ghost" onClick={() => { setActionsOpen(false); setShowGroupModal(true); }} role="menuitem">+ New Group</button>
                <button className="btn btn-ghost" onClick={() => { setActionsOpen(false); setShowModal(true); }} role="menuitem">+ Add Resource</button>
                <button className="btn btn-ghost" onClick={() => { setActionsOpen(false); handleDiscover(); }} role="menuitem">🔍 Discover Network</button>
                <hr className="actions-menu-divider" />
                <button className="btn btn-ghost" onClick={() => { setActionsOpen(false); handleExportCSV(); }} role="menuitem">⬇ Export CSV</button>
                <button className="btn btn-ghost" onClick={() => { setActionsOpen(false); document.getElementById('csv-import').click(); }} role="menuitem">⬆ Import CSV</button>
              </div>
            )}
          </div>
          <input id="csv-import" type="file" accept=".csv" className="hidden-file-input" onChange={handleImportCSV} />
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
        <div className="cc-metric-card"><p className="cc-metric-label">Monitors</p><p className="cc-metric-value">{totalCount}</p></div>
        <div className="cc-metric-card metric-ok"><p className="cc-metric-label">Up</p><p className="cc-metric-value">{upCount}</p></div>
        <div className="cc-metric-card metric-down"><p className="cc-metric-label">Down</p><p className="cc-metric-value">{downCount}</p></div>
        <div className="cc-metric-card metric-maint"><p className="cc-metric-label">Maintenance</p><p className="cc-metric-value">{maintenanceCount}</p></div>
        <div className="cc-metric-card"><p className="cc-metric-label">Avg Uptime</p><p className="cc-metric-value">{avgUptime}%</p></div>
        <div className="cc-metric-card"><p className="cc-metric-label">Avg Resp</p><p className="cc-metric-value">{avgResponse}ms</p></div>
      </div>

      {!loaded ? (
        <div className="resource-list">
          {[1, 2, 3].map(i => (
            <div key={i} className="resource-row skeleton-row">
              <div className="skeleton skeleton-name" />
              <div className="skeleton skeleton-url" />
              <div className="skeleton skeleton-badge" />
            </div>
          ))}
        </div>
      ) : resources.length === 0 ? (
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
        <>
        {selectedIds.size > 0 && (
          <div className="bulk-action-bar">
            <span className="bulk-count">{selectedIds.size} selected</span>
            <button className="btn btn-secondary" onClick={() => handleBulkMaintenance(true)}>Enable Maintenance</button>
            <button className="btn btn-secondary" onClick={() => handleBulkMaintenance(false)}>End Maintenance</button>
            {pendingBulkDelete ? (
              <>
                <button className="btn btn-danger" onClick={handleBulkDelete}>Confirm Delete {selectedIds.size}</button>
                <button className="btn" onClick={() => setPendingBulkDelete(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-danger" onClick={() => setPendingBulkDelete(true)}>Delete Selected</button>
            )}
            <button className="btn" onClick={() => { setSelectedIds(new Set()); setPendingBulkDelete(false); }}>Clear</button>
          </div>
        )}

        <datalist id="tag-suggestions">
          {allTags.map(tag => <option key={tag} value={tag} />)}
        </datalist>

        <div className="cc-layout">
          <section className="resource-list-shell cc-main">
            <div className="resource-list-header">
              <label className="header-select-all" title="Select / deselect all visible">
                <input type="checkbox"
                  checked={visibleResources.length > 0 && selectedIds.size === visibleResources.length}
                  onChange={toggleSelectAll}
                />
              </label>
              <div>Resource</div>
              <div>Metrics</div>
              <div>Status</div>
            </div>
            <div className="resource-list-count">{visibleResources.length} of {sortedResources.length} monitors</div>
            <div className="resource-list">
              {visibleResources.map(renderResourceRow)}
              {visibleResources.length < sortedResources.length && (
                <button className="load-more-btn" onClick={() => setRenderLimit((prev) => prev + 120)}>Load 120 more</button>
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
                    <div key={incident.id} className="cc-incident-item">
                      <button className="cc-incident-nav" onClick={() => navigate(`/resource/${incident.id}`)}>
                        <span className="cc-incident-name">{incident.name}</span>
                        <span className={`status-badge status-${incident.status}`}>{incident.status}</span>
                      </button>
                      {incident.activeIncidentId && (
                        <button
                          className="btn-icon cc-ack-btn"
                          title="Acknowledge incident"
                          onClick={(e) => { e.stopPropagation(); handleAcknowledge(incident.activeIncidentId); }}
                        >✓</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cc-panel">
              <h3>Groups</h3>
              <div className="cc-group-list">
                {groupCounts.map((g) => (
                  <button key={g.id} className="cc-group-item" onClick={() => setGroupFilter(String(g.id))}>
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
        </>
      )}

      {showGroupModal && (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Group</h2>
            <form onSubmit={handleCreateGroup}>
              <div className="form-group">
                <label>Group Name *</label>
                <input type="text" value={groupData.name} onChange={(e) => setGroupData({ ...groupData, name: e.target.value })} required placeholder="e.g., Production Servers" />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input type="text" value={groupData.description} onChange={(e) => setGroupData({ ...groupData, description: e.target.value })} placeholder="Optional description" />
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowGroupModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Group</button>
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
                <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required placeholder="e.g., ZimaOS Home Server" />
              </div>

              {formData.type !== 'heartbeat' && (
                <div className="form-group">
                  <label>URL *</label>
                  <input type="url" value={formData.url} onChange={(e) => setFormData({ ...formData, url: e.target.value })} required={formData.type !== 'heartbeat'} placeholder="https://your-zima.example.com" />
                </div>
              )}

              <div className="form-group">
                <label>Group</label>
                <select value={formData.group_id || ''} onChange={(e) => setFormData({ ...formData, group_id: e.target.value ? parseInt(e.target.value) : null })}>
                  <option value="">Ungrouped</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Check Type</label>
                <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })}>
                  <option value="http">HTTP/HTTPS</option>
                  <option value="health">Service Health</option>
                  <option value="tcp">TCP Port</option>
                  <option value="tls">TLS/SSL</option>
                  <option value="dns">DNS Lookup</option>
                  <option value="websocket">WebSocket</option>
                  <option value="icmp">ICMP Ping</option>
                  <option value="heartbeat">Heartbeat (cron job)</option>
                </select>
              </div>

              {formData.type === 'heartbeat' && (
                <div className="form-group">
                  <label>Heartbeat Timeout (ms)</label>
                  <input type="number" value={formData.heartbeat_timeout} onChange={(e) => setFormData({ ...formData, heartbeat_timeout: parseInt(e.target.value) })} min="10000" step="1000" />
                  <small style={{ color: '#666', fontSize: '0.85rem' }}>Alert if no ping received within this window (default 5 min)</small>
                </div>
              )}

              <div className="form-group">
                <label>Check Interval (ms)</label>
                <input type="number" value={formData.check_interval ?? ''} placeholder={`${globalCheckInterval} (global default)`} onChange={(e) => setFormData({ ...formData, check_interval: e.target.value ? parseInt(e.target.value) : null })} min="10000" />
                <small>Leave empty to use global setting ({globalCheckInterval}ms)</small>
              </div>

              {formData.type !== 'heartbeat' && (
                <div className="form-group">
                  <label>Timeout (ms)</label>
                  <input type="number" value={formData.timeout ?? ''} placeholder={`${globalTimeout} (global default)`} onChange={(e) => setFormData({ ...formData, timeout: e.target.value ? parseInt(e.target.value) : null })} min="1000" />
                  <small>Leave empty to use global setting ({globalTimeout}ms)</small>
                </div>
              )}

              {(formData.type === 'http' || formData.type === 'https' || formData.type === 'health') && (
                <>
                  <div className="form-group">
                    <label>Keyword to Match (optional)</label>
                    <input type="text" value={formData.http_keyword} onChange={(e) => setFormData({ ...formData, http_keyword: e.target.value })} placeholder="Text that must appear in response" />
                  </div>
                  <div className="form-group">
                    <label>Custom Headers (JSON, optional)</label>
                    <textarea value={formData.http_headers} onChange={(e) => setFormData({ ...formData, http_headers: e.target.value })} placeholder='{"Authorization": "Bearer token"}' rows="2" />
                  </div>
                  <HttpMethodBodyFields data={formData} setData={setFormData} />
                </>
              )}

              {formData.type === 'tls' && (
                <div className="form-group">
                  <label>Certificate Expiry Warning (days)</label>
                  <input type="number" value={formData.cert_expiry_days} onChange={(e) => setFormData({ ...formData, cert_expiry_days: parseInt(e.target.value) })} min="1" max="90" />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Quiet Hours Start (optional)</label>
                  <input type="time" value={formData.quiet_hours_start} onChange={(e) => setFormData({ ...formData, quiet_hours_start: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Quiet Hours End (optional)</label>
                  <input type="time" value={formData.quiet_hours_end} onChange={(e) => setFormData({ ...formData, quiet_hours_end: e.target.value })} />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="maintenance_mode_new" checked={!!formData.maintenance_mode} onChange={(e) => setFormData({ ...formData, maintenance_mode: e.target.checked })} />
                <label htmlFor="maintenance_mode_new" style={{ margin: 0 }}>Start in maintenance mode (no alerts sent)</label>
              </div>

              <div className="form-group">
                <label>SLA Target (%)</label>
                <input type="number" step="0.1" value={formData.sla_target} onChange={(e) => setFormData({ ...formData, sla_target: parseFloat(e.target.value) })} min="0" max="100" />
              </div>

              <div className="form-group">
                <label>Alert Email Address (Optional)</label>
                <input type="text" placeholder="user@example.com (leave empty to use global setting)" value={formData.email_to || ''} onChange={(e) => setFormData({ ...formData, email_to: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input type="text" list="tag-suggestions" placeholder="frontend,production,critical" value={formData.tags || ''} onChange={(e) => setFormData({ ...formData, tags: e.target.value })} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Consecutive Failures Before Alert</label>
                  <input type="number" min="1" value={formData.consecutive_failures_threshold || 1} onChange={(e) => setFormData({ ...formData, consecutive_failures_threshold: parseInt(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Response Time Threshold (ms)</label>
                  <input type="number" placeholder="e.g., 2000" value={formData.response_time_threshold || ''} onChange={(e) => setFormData({ ...formData, response_time_threshold: e.target.value ? parseInt(e.target.value) : null })} />
                </div>
              </div>

              <div className="form-group">
                <label>Data Retention (days)</label>
                <input type="number" placeholder="Leave empty to use global setting" value={formData.retention_days || ''} onChange={(e) => setFormData({ ...formData, retention_days: e.target.value ? parseInt(e.target.value) : null })} min="1" max="365" />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="is_public_new" checked={!!formData.is_public} onChange={(e) => setFormData({ ...formData, is_public: e.target.checked })} />
                <label htmlFor="is_public_new" style={{ margin: 0 }}>Show on public status page</label>
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Resource</button>
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
                <input type="text" value={editData.name || ''} onChange={(e) => setEditData({ ...editData, name: e.target.value })} required placeholder="e.g., Production API" />
              </div>

              {editData.type !== 'heartbeat' && (
                <div className="form-group">
                  <label>URL/Address *</label>
                  <input type="text" value={editData.url || ''} onChange={(e) => setEditData({ ...editData, url: e.target.value })} required placeholder="e.g., https://api.example.com" />
                </div>
              )}

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
                  <option value="heartbeat">Heartbeat (cron job)</option>
                </select>
              </div>

              {editData.type === 'heartbeat' && (
                <div className="form-group">
                  <label>Heartbeat Timeout (ms)</label>
                  <input type="number" value={editData.heartbeat_timeout || 300000} onChange={(e) => setEditData({ ...editData, heartbeat_timeout: parseInt(e.target.value) })} min="10000" step="1000" />
                </div>
              )}

              {editData.type === 'heartbeat' && editData.heartbeat_token && (
                <div className="form-group">
                  <label>Heartbeat Ping URL</label>
                  <input type="text" readOnly value={`${window.location.origin}/api/heartbeat/${editData.heartbeat_token}`} onClick={(e) => e.target.select()} style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.85rem' }} />
                  <small style={{ color: '#666', fontSize: '0.85rem' }}>POST to this URL from your cron job or script</small>
                </div>
              )}

              <div className="form-group">
                <label>Check Interval (ms)</label>
                <input type="number" value={editData.check_interval ?? ''} placeholder={`${globalCheckInterval} (global default)`} onChange={(e) => setEditData({ ...editData, check_interval: e.target.value ? parseInt(e.target.value) : null })} min="10000" />
                <small>Leave empty to use global setting ({globalCheckInterval}ms)</small>
              </div>

              <div className="form-group">
                <label>Timeout (ms)</label>
                <input type="number" value={editData.timeout ?? ''} placeholder={`${globalTimeout} (global default)`} onChange={(e) => setEditData({ ...editData, timeout: e.target.value ? parseInt(e.target.value) : null })} min="1000" />
                <small>Leave empty to use global setting ({globalTimeout}ms)</small>
              </div>

              {(editData.type === 'http' || editData.type === 'https' || editData.type === 'health') && (
                <>
                  <div className="form-group">
                    <label>Keyword to Match (optional)</label>
                    <input type="text" value={editData.http_keyword || ''} onChange={(e) => setEditData({ ...editData, http_keyword: e.target.value })} placeholder="Text that must appear in response" />
                  </div>
                  <div className="form-group">
                    <label>Custom Headers (JSON, optional)</label>
                    <textarea value={editData.http_headers || ''} onChange={(e) => setEditData({ ...editData, http_headers: e.target.value })} placeholder='{"Authorization": "Bearer token"}' rows="2" />
                  </div>
                  <HttpMethodBodyFields data={editData} setData={setEditData} />
                </>
              )}

              {editData.type === 'tls' && (
                <div className="form-group">
                  <label>Certificate Expiry Warning (days)</label>
                  <input type="number" value={editData.cert_expiry_days || 30} onChange={(e) => setEditData({ ...editData, cert_expiry_days: parseInt(e.target.value) })} min="1" max="90" />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Quiet Hours Start (optional)</label>
                  <input type="time" value={editData.quiet_hours_start || ''} onChange={(e) => setEditData({ ...editData, quiet_hours_start: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Quiet Hours End (optional)</label>
                  <input type="time" value={editData.quiet_hours_end || ''} onChange={(e) => setEditData({ ...editData, quiet_hours_end: e.target.value })} />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="maintenance_mode_edit" checked={!!editData.maintenance_mode} onChange={(e) => setEditData({ ...editData, maintenance_mode: e.target.checked })} />
                <label htmlFor="maintenance_mode_edit" style={{ margin: 0 }}>Maintenance mode (suppress alerts)</label>
              </div>

              <div className="form-group">
                <label>SLA Target (%)</label>
                <input type="number" step="0.1" value={editData.sla_target || 99.9} onChange={(e) => setEditData({ ...editData, sla_target: parseFloat(e.target.value) })} min="0" max="100" />
              </div>

              <div className="form-group">
                <label>Group</label>
                <select value={editData.group_id || ''} onChange={(e) => setEditData({ ...editData, group_id: e.target.value ? parseInt(e.target.value) : null })}>
                  <option value="">Ungrouped</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Alert Email Address (Optional)</label>
                <input type="text" placeholder="user@example.com or alice@example.com,bob@example.com" value={editData.email_to || ''} onChange={(e) => setEditData({ ...editData, email_to: e.target.value })} />
              </div>

              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input type="text" list="tag-suggestions" placeholder="Enter tags to organize resources" value={editData.tags || ''} onChange={(e) => setEditData({ ...editData, tags: e.target.value })} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Consecutive Failures Before Alert</label>
                  <input type="number" min="1" value={editData.consecutive_failures_threshold || 1} onChange={(e) => setEditData({ ...editData, consecutive_failures_threshold: parseInt(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Response Time Threshold (ms)</label>
                  <input type="number" placeholder="e.g., 2000" value={editData.response_time_threshold || ''} onChange={(e) => setEditData({ ...editData, response_time_threshold: e.target.value ? parseInt(e.target.value) : null })} />
                </div>
              </div>

              <div className="form-group">
                <label>Data Retention (days)</label>
                <input type="number" min="1" max="365" placeholder="Leave empty to use global setting" value={editData.retention_days || ''} onChange={(e) => setEditData({ ...editData, retention_days: e.target.value ? parseInt(e.target.value) : null })} />
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="is_public_edit" checked={editData.is_public !== false && editData.is_public !== 0} onChange={(e) => setEditData({ ...editData, is_public: e.target.checked })} />
                <label htmlFor="is_public_edit" style={{ margin: 0 }}>Show on public status page</label>
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDiscovery && (
        <div className="modal-overlay" onClick={() => setShowDiscovery(false)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <h2>🔍 Network Discovery</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
              Scan a network range for reachable hosts and HTTP services.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  value={discoverySubnet}
                  onChange={(e) => setDiscoverySubnet(e.target.value)}
                  placeholder="e.g. 192.168.1.0/24  (leave empty to auto-detect)"
                  style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: '0.9rem' }}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => handleDiscover(discoverySubnet || null)}
                  disabled={discoveryLoading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {discoveryLoading ? 'Scanning…' : '🔍 Scan'}
                </button>
              </div>
              {localSubnets.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Quick:</span>
                  {localSubnets.map(s => s.prefix && (
                    <button
                      key={s.prefix}
                      className="btn"
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.6rem' }}
                      onClick={() => { setDiscoverySubnet(s.prefix); handleDiscover(s.prefix); }}
                    >
                      {s.prefix}
                    </button>
                  ))}
                  <button
                    className="btn"
                    style={{ fontSize: '0.78rem', padding: '0.2rem 0.6rem' }}
                    onClick={() => { setDiscoverySubnet(''); handleDiscover(null); }}
                  >
                    Auto-detect
                  </button>
                </div>
              )}
            </div>

            {discoveryLoading && (
              <div className="discovery-scanning">
                <div className="discovery-spinner" />
                <span>Scanning — this takes 10–20 seconds</span>
              </div>
            )}

            {!discoveryLoading && discoveryHosts.length === 0 && (
              <div className="cc-empty">No hosts found on the local network.</div>
            )}

            {!discoveryLoading && discoveryHosts.length > 0 && (
              <div className="discovery-list">
                {discoveryHosts.map((host) => (
                  <div key={host.ip} className="discovery-row">
                    <div className="discovery-info">
                      <span className="discovery-ip">{host.ip}</span>
                      {host.hostname && <span className="discovery-hostname">{host.hostname}</span>}
                      {host.suggestedUrl && (
                        <span className="discovery-url">{host.suggestedUrl}</span>
                      )}
                      {host.openPorts.length > 0 && (
                        <span className="discovery-ports">ports: {host.openPorts.join(', ')}</span>
                      )}
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => addDiscoveredHost(host)}
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              {!discoveryLoading && (
                <button className="btn btn-secondary" onClick={handleDiscover}>↺ Rescan</button>
              )}
              <button className="btn" onClick={() => setShowDiscovery(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
