import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './App.css';
import SettingsWizard from './SettingsWizard';
import History from './History';
import SLA from './SLA';
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
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
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
  const [groupData, setGroupData] = useState({ name: '', description: '' });
  const wsRef = useRef(null);
  const actionsRef = useRef(null);
  const navigate = useNavigate();

  const loadResources = useCallback(async () => {
    try {
      const response = await axios.get('/api/dashboard');
      setResources(response.data.resources);
      setGroups(response.data.groups || []);
    } catch (error) {
      console.error('Error loading resources:', error);
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send initial ping to keep alive
        ws.send(JSON.stringify({ type: 'ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'dashboard') {
            setResources(message.data.resources || []);
            setGroups(message.data.groups || []);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, will use fallback polling');
        wsRef.current = null;
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Error connecting WebSocket:', error);
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
      console.error('Error creating group:', error);
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
      console.error('Error creating resource:', error);
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
      console.error('Error updating resource:', error);
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
        console.error('Error deleting resource:', error);
        alert('Error deleting resource');
      }
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
      console.error('Error exporting resources:', error);
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
      console.error('Error importing resources:', error);
      alert('Error importing resources');
    }

    // Reset file input
    e.target.value = '';
  };

  const toggleGroup = (groupId) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  // Filter resources by tag
  const filteredResources = tagFilter
    ? resources.filter(r => {
        const tags = (r.tags || '').toLowerCase();
        return tags.includes(tagFilter.toLowerCase());
      })
    : resources;

  const groupResourcesMap = filteredResources.reduce((acc, r) => {
    const gid = r.group_id || 'ungrouped';
    if (!acc[gid]) acc[gid] = [];
    acc[gid].push(r);
    return acc;
  }, {});

  const getGroupStats = (groupResources) => {
    if (!groupResources || groupResources.length === 0) return { uptime: 0, avgResponse: 0, total: 0 };
    const uptime = (groupResources.reduce((sum, r) => sum + parseFloat(r.uptime || 0), 0) / groupResources.length).toFixed(2);
    const avgResponse = (groupResources.reduce((sum, r) => sum + parseInt(r.avgResponseTime || 0), 0) / groupResources.length).toFixed(0);
    return { uptime, avgResponse, total: groupResources.length };
  };

  const renderResourceCard = (resource) => {
    const sparkData = (resource.recentChecks || []).map((c, idx) => ({
      idx,
      responseTime: c.response_time || 0,
      statusValue: c.status === 'up' ? 1 : 0,
    }));

    const isEditing = editingId === resource.id;

    return (
      <div
        key={resource.id}
        className="resource-card compact"
        onClick={(e) => !isEditing && !e.target.closest('.card-actions') && navigate(`/resource/${resource.id}`)}
      >
        <div className="resource-header">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {isEditing ? (
              <input
                type="text"
                value={editData.name || resource.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="edit-input"
                placeholder="Resource name"
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <h3 className="resource-name" style={{ margin: 0 }}>{resource.name}</h3>
                {resource.maintenance_mode && (
                  <span title="Maintenance mode" style={{ fontSize: '0.95rem' }}>🛠️</span>
                )}
              </div>
            )}
            <p className="resource-url">{resource.url}</p>
            <p className="resource-type">Type: {resource.type}</p>
          </div>
          <span className={`status-badge status-${resource.status}`}>
            {resource.status}
          </span>
        </div>

        {resource.hasActiveIncident && (
          <div className="incident-badge">⚠️ Active Incident</div>
        )}

        <div className="resource-meta">
          <div>
            <p
              className="stat-value small"
              style={{ cursor: 'pointer', color: resource.maintenance_mode ? '#ffc107' : undefined }}
              onClick={(e) => { e.stopPropagation(); if (!isEditing) setEditingId(resource.id); }}
            >
              {resource.uptime}%
            </p>
            <p className="stat-label">Uptime (24h)</p>
          </div>
          <div>
            <p className="stat-value small" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (!isEditing) setEditingId(resource.id); }}>
              {resource.avgResponseTime}ms
            </p>
            <p className="stat-label">Avg Resp</p>
          </div>
          <div className="sparkline">
            {sparkData.length > 1 ? (
              <ResponsiveContainer width="100%" height={50}>
                <LineChart data={sparkData} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
                  <Line type="monotone" dataKey="responseTime" stroke="#667eea" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <span style={{ fontSize: '0.75rem', color: '#999' }}>No recent data</span>
            )}
          </div>
        </div>

        <div className="card-actions">
          <button className="btn-icon" title="Edit" onClick={(e) => { e.stopPropagation(); openEditModal(resource); }}>✎</button>
          <button className="btn-icon" title="Delete" onClick={(e) => { e.stopPropagation(); handleDeleteResource(resource.id); }}>🗑</button>
        </div>

        {!isEditing && resource.lastCheck && (
          <p className="last-check">
            Last: {formatLocalTime(resource.lastCheck)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>SkyWatch Dashboard</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter by tag"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            style={{ padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid #ddd', minWidth: '160px' }}
          />
          <div ref={actionsRef} style={{ position: 'relative' }}>
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
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '110%',
                  background: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
                  minWidth: '200px',
                  padding: '0.25rem 0',
                  zIndex: 20,
                }}
              >
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); setShowGroupModal(true); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.8rem' }}
                  role="menuitem"
                >
                  + New Group
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); setShowModal(true); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.8rem' }}
                  role="menuitem"
                >
                  + Add Resource
                </button>
                <hr style={{ margin: '0.25rem 0', border: 0, borderTop: '1px solid #eee' }} />
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); handleExportCSV(); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.8rem' }}
                  role="menuitem"
                >
                  ⬇ Export CSV
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setActionsOpen(false); document.getElementById('csv-import').click(); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 0.8rem' }}
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
            style={{ display: 'none' }}
            onChange={handleImportCSV}
          />
        </div>
      </div>

      {resources.length === 0 ? (
        <div className="empty-state">
          <h3>No resources yet</h3>
          <p>Add your first resource to start monitoring</p>
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="empty-state">
          <h3>No resources match filter</h3>
          <p>Try adjusting your tag filter</p>
        </div>
      ) : (
        <div>
          {groups.map((group) => {
            const groupStats = getGroupStats(groupResourcesMap[group.id]);
            const isCollapsed = collapsedGroups[group.id];
            return (
              <div key={group.id} className="group-section">
                <div className="group-header" onClick={() => toggleGroup(group.id)}>
                  <span className="group-toggle">{isCollapsed ? '▶' : '▼'}</span>
                  <h3 style={{ margin: 0, flex: 1 }}>{group.name}</h3>
                  <div className="group-stats">
                    <span className="group-stat">{groupStats.total} resources</span>
                    <span className="group-stat">{groupStats.uptime}% up</span>
                    <span className="group-stat">{groupStats.avgResponse}ms avg</span>
                  </div>
                </div>
                {!isCollapsed && (
                  <div className="dashboard-grid">
                    {groupResourcesMap[group.id]?.map(renderResourceCard)}
                  </div>
                )}
              </div>
            );
          })}
          {groupResourcesMap['ungrouped']?.length > 0 && (
            <div className="group-section">
              <div className="group-header" onClick={() => toggleGroup('ungrouped')}>
                <span className="group-toggle">{collapsedGroups['ungrouped'] ? '▶' : '▼'}</span>
                <h3 style={{ margin: 0, flex: 1 }}>Ungrouped</h3>
                <div className="group-stats">
                  <span className="group-stat">{groupResourcesMap['ungrouped'].length} resources</span>
                  <span className="group-stat">{getGroupStats(groupResourcesMap['ungrouped']).uptime}% up</span>
                  <span className="group-stat">{getGroupStats(groupResourcesMap['ungrouped']).avgResponse}ms avg</span>
                </div>
              </div>
              {!collapsedGroups['ungrouped'] && (
                <div className="dashboard-grid">
                  {groupResourcesMap['ungrouped'].map(renderResourceCard)}
                </div>
              )}
            </div>
          )}
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
      console.error('Error loading resource:', error);
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
      console.error('Error loading checks:', error);
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
      console.error('Error loading incidents:', error);
    } finally {
      setIncidentsLoading(false);
    }
  };

  const loadSla = async () => {
    try {
      setSlaLoading(true);
      const response = await axios.get(`/api/resources/${id}/sla`, { params: { hours: slaWindow } });
      setSla(response.data);
    } catch (error) {
      console.error('Error loading SLA summary:', error);
    } finally {
      setSlaLoading(false);
    }
  };

  const loadMaintenanceWindows = async () => {
    try {
      const response = await axios.get(`/api/resources/${id}/maintenance-windows`);
      setMaintenanceWindows(response.data.windows || []);
    } catch (error) {
      console.error('Error loading maintenance windows:', error);
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
      console.error('Error creating maintenance window:', error);
      alert('Error creating maintenance window');
    }
  };

  const handleDeleteMaintenanceWindow = async (windowId) => {
    if (window.confirm('Delete this maintenance window?')) {
      try {
        await axios.delete(`/api/maintenance-windows/${windowId}`);
        loadMaintenanceWindows();
      } catch (error) {
        console.error('Error deleting maintenance window:', error);
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
        console.error('Error deleting resource:', error);
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
      console.error('Error updating resource:', error);
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
      console.error('Error updating maintenance mode:', error);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h2>{resource.name}</h2>
            <p style={{ color: '#666' }}>{resource.url}</p>
            <p className="resource-type">Type: {resource.type}</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
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
          <div className="incident-badge" style={{ background: '#fff3cd', color: '#856404', borderColor: '#ffeeba' }}>
            🛠️ Maintenance mode active — alerts are suppressed
          </div>
        )}

        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '2rem' }}>
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
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="responseTime" stroke="#667eea" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="detail-section">
        <h2>Recent Checks</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '0.9rem', color: '#555', marginRight: '0.4rem' }}>Status</label>
            <select value={checksStatus} onChange={(e) => { setChecksPage(0); setChecksStatus(e.target.value); }}>
              <option value="">All</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.9rem', color: '#555', marginRight: '0.4rem' }}>Sort</label>
            <select value={checksSort} onChange={(e) => { setChecksPage(0); setChecksSort(e.target.value); }}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" disabled={checksPage === 0 || checksLoading} onClick={() => setChecksPage(Math.max(0, checksPage - 1))}>← Prev</button>
            <button className="btn btn-secondary" disabled={checksLoading || checks.length < checksLimit} onClick={() => setChecksPage(checksPage + 1)}>Next →</button>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Time</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '0.75rem', textAlign: 'right' }}>Response Time</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Message</th>
            </tr>
          </thead>
          <tbody>
            {checksLoading ? (
              <tr><td colSpan="4" style={{ padding: '0.75rem' }}>Loading checks...</td></tr>
            ) : checks.length === 0 ? (
              <tr><td colSpan="4" style={{ padding: '0.75rem' }}>No checks found</td></tr>
            ) : checks.map((check) => (
              <tr key={check.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem' }}>
                  {formatLocalTime(check.checked_at)}
                </td>
                <td style={{ padding: '0.75rem' }}>
                  <span className={`status-badge status-${check.status}`}>
                    {check.status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                  {check.response_time ? `${check.response_time}ms` : '-'}
                </td>
                <td style={{ padding: '0.75rem', color: '#666' }}>
                  {check.error_message || 'OK'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="detail-section">
        <h2>Incidents Timeline</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '0.9rem', color: '#555', marginRight: '0.4rem' }}>Status</label>
            <select value={incidentsStatus} onChange={(e) => { setIncidentsPage(0); setIncidentsStatus(e.target.value); }}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.9rem', color: '#555', marginRight: '0.4rem' }}>Sort</label>
            <select value={incidentsSort} onChange={(e) => { setIncidentsPage(0); setIncidentsSort(e.target.value); }}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" disabled={incidentsPage === 0 || incidentsLoading} onClick={() => setIncidentsPage(Math.max(0, incidentsPage - 1))}>← Prev</button>
            <button className="btn btn-secondary" disabled={incidentsLoading || incidents.length < incidentsLimit} onClick={() => setIncidentsPage(incidentsPage + 1)}>Next →</button>
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Started</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Resolved</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {incidentsLoading ? (
              <tr><td colSpan="3" style={{ padding: '0.75rem' }}>Loading incidents...</td></tr>
            ) : incidents.length === 0 ? (
              <tr><td colSpan="3" style={{ padding: '0.75rem' }}>No incidents found</td></tr>
            ) : incidents.map((incident) => {
              const start = incident.started_at || incident.created_at;
              const end = incident.resolved_at;
              const durationMs = start && end ? (new Date(end).getTime() - new Date(start).getTime()) : null;
              const durationText = durationMs != null ? formatDuration(durationMs) : 'Ongoing';
              return (
                <tr key={incident.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.75rem' }}>{start ? formatLocalTime(start) : '-'}</td>
                  <td style={{ padding: '0.75rem' }}>{end ? formatLocalTime(end) : 'Open'}</td>
                  <td style={{ padding: '0.75rem' }}>{durationText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Maintenance Windows</h2>
          <button className="btn btn-primary" onClick={() => setShowMaintenanceModal(true)}>
            + Schedule Maintenance
          </button>
        </div>
        {maintenanceWindows.length === 0 ? (
          <p style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>No maintenance windows scheduled</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Start Time</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>End Time</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Reason</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {maintenanceWindows.map(window => (
                <tr key={window.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.75rem' }}>{formatLocalTime(window.start_time)}</td>
                  <td style={{ padding: '0.75rem' }}>{formatLocalTime(window.end_time)}</td>
                  <td style={{ padding: '0.75rem', color: '#666' }}>{window.reason || '-'}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                    <button 
                      className="btn btn-danger" 
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                      onClick={() => handleDeleteMaintenanceWindow(window.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showMaintenanceModal && (
        <div className="modal-overlay" onClick={() => setShowMaintenanceModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
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
      // Cache server timezone for timestamp formatting
      if (response.data.timezone) {
        localStorage.setItem('serverTimezone', response.data.timezone);
      }
    } catch (error) {
      console.error('Error checking notifications:', error);
    }
  };

  return (
    <nav className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <h1>🔍 SkyWatch</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link to="/" style={{ color: 'white', textDecoration: 'none', opacity: 0.9, fontWeight: 500 }}>Dashboard</Link>
            <Link to="/history" style={{ color: 'white', textDecoration: 'none', opacity: 0.9, fontWeight: 500 }}>History</Link>
            <Link to="/sla" style={{ color: 'white', textDecoration: 'none', opacity: 0.9, fontWeight: 500 }}>SLA</Link>
            <Link to="/settings" style={{ color: 'white', textDecoration: 'none', opacity: 0.9, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Settings
              {!notificationsConfigured && (
                <span style={{ 
                  background: '#ffc107', 
                  color: '#000', 
                  padding: '0.15rem 0.5rem', 
                  borderRadius: '12px', 
                  fontSize: '0.7rem',
                  fontWeight: 'bold'
                }}>SETUP</span>
              )}
            </Link>
          </div>
        </div>
        {notificationsConfigured && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', opacity: 0.9 }}>
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
        </Routes>
      </div>
    </Router>
  );
}

export default App;
