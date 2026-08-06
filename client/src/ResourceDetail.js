import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { formatLocalTime, formatChartTime, formatDuration } from './utils/timeUtils';

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
  const [expandedCheckId, setExpandedCheckId] = useState(null);
  const [chartRange, setChartRange] = useState('24h');
  const [chartChecks, setChartChecks] = useState([]);

  const [sla, setSla] = useState(null);
  const [slaLoading, setSlaLoading] = useState(false);
  const slaWindow = 24;

  const [notifications, setNotifications] = useState([]);
  const showNotification = useCallback((title, message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  }, []);

  const [maintenanceWindows, setMaintenanceWindows] = useState([]);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState({ start_time: '', end_time: '', reason: '' });

  useEffect(() => {
    Promise.all([
      loadResource(),
      loadChecks(),
      loadIncidents(),
      loadSla(),
      loadMaintenanceWindows(),
      loadChartChecks(),
    ]).catch(() => {});
    const interval = setInterval(loadResource, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadChartChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRange]);

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
        params: { limit: checksLimit, offset: checksPage * checksLimit, status: checksStatus || undefined, sort: checksSort },
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
        params: { limit: incidentsLimit, offset: incidentsPage * incidentsLimit, status: incidentsStatus, sort: incidentsSort },
      });
      setIncidents(response.data.incidents || []);
    } catch (error) {
      // Incidents load error handled
    } finally {
      setIncidentsLoading(false);
    }
  };

  const rangeMs = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 };

  const loadChartChecks = async () => {
    try {
      const from = new Date(Date.now() - rangeMs[chartRange]).toISOString();
      const resp = await axios.get(`/api/resources/${id}/checks`, {
        params: { from, limit: 200, sort: 'asc' },
      });
      setChartChecks(resp.data.checks || []);
    } catch (error) {
      // chart load error handled
    }
  };

  const handleAcknowledge = async (incidentId) => {
    try {
      await axios.post(`/api/incidents/${incidentId}/acknowledge`);
      loadIncidents();
    } catch (error) {
      showNotification('Error', 'Failed to acknowledge incident', 'error');
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
      await axios.patch(`/api/incidents/${editingIncident.id}`, { description: incidentDescription });
      setShowIncidentModal(false);
      setEditingIncident(null);
      setIncidentDescription('');
      loadIncidents();
    } catch (error) {
      showNotification('Error', error.response?.data?.error || 'Failed to update incident', 'error');
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
      showNotification('Success', 'Maintenance window created', 'success');
    } catch (error) {
      showNotification('Error', 'Failed to create maintenance window', 'error');
    }
  };

  const handleDeleteMaintenanceWindow = async (windowId) => {
    if (window.confirm('Delete this maintenance window?')) {
      try {
        await axios.delete(`/api/maintenance-windows/${windowId}`);
        loadMaintenanceWindows();
      } catch (error) {
        showNotification('Error', 'Failed to delete maintenance window', 'error');
      }
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this resource?')) {
      try {
        await axios.delete(`/api/resources/${id}`);
        navigate('/');
      } catch (error) {
        showNotification('Error', 'Failed to delete resource', 'error');
      }
    }
  };

  const toggleEnabled = async () => {
    try {
      await axios.put(`/api/resources/${id}`, { ...resource, enabled: !resource.enabled });
      loadResource();
    } catch (error) {
      // Update resource error handled
    }
  };

  const toggleMaintenance = async () => {
    try {
      await axios.put(`/api/resources/${id}`, { ...resource, maintenance_mode: !resource.maintenance_mode });
      loadResource();
    } catch (error) {
      // Update maintenance mode error handled
    }
  };

  if (loading) return <div className="container">Loading...</div>;
  if (!resource) return <div className="container">Resource not found</div>;

  const toastStack = notifications.length > 0 && (
    <div className="toast-stack">
      {notifications.map(n => (
        <div key={n.id} className={`toast-item toast-${n.type}`}>
          <strong>{n.title}</strong>
          <div>{n.message}</div>
        </div>
      ))}
    </div>
  );

  const chartData = chartChecks.map((check) => ({
    time: formatChartTime(check.checked_at),
    responseTime: check.response_time,
    status: check.status === 'up' ? 1 : 0,
  }));

  return (
    <div className="container">
      {toastStack}
      <Link to="/" className="back-button">← Back to Dashboard</Link>

      <div className="detail-section">
        <div className="detail-header-row">
          <div>
            <h2>{resource.name}</h2>
            <p className="resource-url-detail">{resource.url}</p>
            <p className="resource-type">Type: {resource.type}</p>
          </div>
          <div className="detail-actions">
            <button className="btn" onClick={toggleEnabled}>{resource.enabled ? 'Disable' : 'Enable'}</button>
            <button className="btn btn-secondary" onClick={toggleMaintenance}>
              {resource.maintenance_mode ? 'End Maintenance' : 'Start Maintenance'}
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </div>
        </div>

        {resource.hasActiveIncident && (
          <div className="incident-badge">⚠️ Active Incident - Resource is currently DOWN</div>
        )}
        {resource.maintenance_mode && (
          <div className="incident-badge maintenance-badge">🛠️ Maintenance mode active — alerts are suppressed</div>
        )}

        <div className="stats-grid stats-grid-4 detail-stats-grid">
          <div className="stat"><p className="stat-value">{resource.stats.uptime}%</p><p className="stat-label">Uptime (24h)</p></div>
          <div className="stat"><p className="stat-value">{resource.stats.avgResponseTime}ms</p><p className="stat-label">Avg Response</p></div>
          <div className="stat"><p className="stat-value">{resource.stats.totalChecks}</p><p className="stat-label">Total Checks</p></div>
          <div className="stat">
            <p className={`stat-value status-badge status-${resource.lastCheck?.status || 'unknown'}`}>{resource.lastCheck?.status || 'unknown'}</p>
            <p className="stat-label">Current Status</p>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h2>SLA / SLO (last {slaWindow}h)</h2>
        {slaLoading ? <p>Loading SLA...</p> : !sla ? <p>No SLA data yet</p> : (
          <div className="stats-grid stats-grid-4">
            <div className="stat"><p className="stat-value">{sla.uptimePct}%</p><p className="stat-label">Uptime</p></div>
            <div className="stat"><p className="stat-value">{formatDuration(sla.downtimeMinutes * 60000 || 0)}</p><p className="stat-label">Downtime</p></div>
            <div className="stat"><p className="stat-value">{sla.p95LatencyMs != null ? `${sla.p95LatencyMs}ms` : '—'}</p><p className="stat-label">p95 Latency</p></div>
            <div className="stat"><p className="stat-value">{sla.totalChecks}</p><p className="stat-label">Checks in window</p></div>
            <div className="stat"><p className="stat-value">{sla.mttrMinutes != null ? `${sla.mttrMinutes}m` : '—'}</p><p className="stat-label">MTTR</p></div>
            <div className="stat"><p className="stat-value">{sla.mtbfMinutes != null ? `${sla.mtbfMinutes}m` : '—'}</p><p className="stat-label">MTBF</p></div>
          </div>
        )}
      </div>

      <div className="detail-section">
        <div className="section-title-row">
          <h2>Response Time</h2>
          <div className="chart-range-btns">
            {['1h', '6h', '24h', '7d'].map(r => (
              <button key={r} className={`chart-range-btn${chartRange === r ? ' active' : ''}`} onClick={() => setChartRange(r)}>{r}</button>
            ))}
          </div>
        </div>
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
              <tr><th>Time</th><th>Status</th><th className="text-right">Response Time</th><th>Message</th></tr>
            </thead>
            <tbody>
              {checksLoading ? (
                <tr><td colSpan="4">Loading checks...</td></tr>
              ) : checks.length === 0 ? (
                <tr><td colSpan="4">No checks found</td></tr>
              ) : checks.map((check) => {
                const isExpanded = expandedCheckId === check.id;
                let parsedDetails = null;
                if (check.details) {
                  try { parsedDetails = JSON.parse(check.details); } catch {}
                }
                return (
                  <React.Fragment key={check.id}>
                    <tr
                      className={`check-row${parsedDetails ? ' check-row-expandable' : ''}`}
                      onClick={() => parsedDetails && setExpandedCheckId(isExpanded ? null : check.id)}
                      title={parsedDetails ? 'Click to expand details' : undefined}
                    >
                      <td>{formatLocalTime(check.checked_at)}</td>
                      <td><span className={`status-badge status-${check.status}`}>{check.status}</span></td>
                      <td className="text-right">{check.response_time ? `${check.response_time}ms` : '-'}</td>
                      <td className="muted-cell">
                        {check.error_message || 'OK'}
                        {parsedDetails && <span className="expand-indicator">{isExpanded ? ' ▼' : ' ▶'}</span>}
                      </td>
                    </tr>
                    {isExpanded && parsedDetails && (
                      <tr className="expanded-row">
                        <td colSpan="4" className="expanded-cell">
                          <pre className="detail-json">{JSON.stringify(parsedDetails, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
              <tr><th className="w-20">Started</th><th className="w-20">Resolved</th><th className="w-15">Duration</th><th className="w-35">Reason</th><th className="w-10"></th></tr>
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
                  <React.Fragment key={incident.id}>
                    <tr>
                      <td>{start ? formatLocalTime(start) : '-'}</td>
                      <td>{end ? formatLocalTime(end) : 'Open'}</td>
                      <td>{durationText}</td>
                      <td className="incident-reason-cell">
                        <span className="incident-reason-toggle" onClick={() => setExpandedIncidentId(isExpanded ? null : incident.id)}>
                          {displayText}
                          {isTruncated && <span className="expand-indicator">{isExpanded ? '▼' : '▶'}</span>}
                        </span>
                        <button className="btn btn-secondary btn-compact" onClick={() => handleEditIncident(incident)}>Edit</button>
                      </td>
                      <td>
                        {!incident.resolved_at && (
                          <button
                            className="btn btn-secondary btn-compact"
                            title="Acknowledge — mark as seen"
                            onClick={() => handleAcknowledge(incident.id)}
                          >Ack</button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan="5" className="expanded-cell">{description}</td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="detail-section">
        <div className="section-title-row">
          <h2>Maintenance Windows</h2>
          <button className="btn btn-primary" onClick={() => setShowMaintenanceModal(true)}>+ Schedule Maintenance</button>
        </div>
        {maintenanceWindows.length === 0 ? (
          <p className="empty-copy">No maintenance windows scheduled</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>Start Time</th><th>End Time</th><th>Reason</th><th className="text-right">Actions</th></tr>
              </thead>
              <tbody>
                {maintenanceWindows.map(window => (
                  <tr key={window.id}>
                    <td>{formatLocalTime(window.start_time)}</td>
                    <td>{formatLocalTime(window.end_time)}</td>
                    <td className="muted-cell">{window.reason || '-'}</td>
                    <td className="text-right">
                      <button className="btn btn-danger btn-compact" onClick={() => handleDeleteMaintenanceWindow(window.id)}>Delete</button>
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
                <input type="datetime-local" required value={maintenanceForm.start_time} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>End Time *</label>
                <input type="datetime-local" required value={maintenanceForm.end_time} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, end_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Reason (Optional)</label>
                <textarea rows="3" placeholder="Planned maintenance, server upgrade, etc." value={maintenanceForm.reason} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, reason: e.target.value })} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowMaintenanceModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Schedule</button>
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
              <textarea rows="6" placeholder="Describe what happened and why..." value={incidentDescription} onChange={(e) => setIncidentDescription(e.target.value)} style={{ fontFamily: 'monospace', fontSize: '0.9rem' }} />
            </div>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => { setShowIncidentModal(false); setEditingIncident(null); setIncidentDescription(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" onClick={handleUpdateIncident} disabled={updatingIncident || !incidentDescription.trim()}>
                {updatingIncident ? 'Updating...' : 'Update'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ResourceDetail;
