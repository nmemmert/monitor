import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './Status.css';

function Status() {
  const [resources, setResources] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [maintenanceWindows, setMaintenanceWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    loadStatusData();
    if (!autoRefresh) return;
    const interval = setInterval(loadStatusData, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const loadStatusData = async () => {
    try {
      const statusRes = await axios.get('/api/status-page');
      setResources(statusRes.data.resources || []);
      setIncidents(statusRes.data.incidents || []);
      setMaintenanceWindows(statusRes.data.maintenanceWindows || []);
      setLastUpdated(new Date());
    } catch (error) {
      // Status load error handled
    } finally {
      setLoading(false);
    }
  };

  const formatLocalTime = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  };

  const getResourceStatus = (resourceId) => {
    const activeIncident = incidents.find(
      (inc) => inc.resource_id === resourceId && !inc.resolved_at
    );
    return activeIncident ? 'down' : 'up';
  };

  const upCount = resources.filter((r) => getResourceStatus(r.id) === 'up').length;
  const downCount = resources.filter((r) => getResourceStatus(r.id) === 'down').length;

  if (loading) {
    return <div className="status-container"><p>Loading status...</p></div>;
  }

  return (
    <div className="status-container">
      <div className="status-header">
        <div>
          <h1>System Status</h1>
          <p className="status-subtitle">Real-time monitoring status</p>
        </div>
        <div className="status-refresh">
          <label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <p className="last-updated">Last updated: {formatLocalTime(lastUpdated)}</p>
        </div>
      </div>

      <div className="status-summary">
        <div className="summary-card">
          <div className="summary-value" style={{ color: '#4caf50' }}>
            {upCount}
          </div>
          <div className="summary-label">Services Up</div>
        </div>
        <div className="summary-card">
          <div className="summary-value" style={{ color: '#f44336' }}>
            {downCount}
          </div>
          <div className="summary-label">Services Down</div>
        </div>
        <div className="summary-card">
          <div className="summary-value" style={{ color: '#ff9800' }}>
            {maintenanceWindows.filter((m) => {
              const now = new Date();
              const start = new Date(m.start_time);
              const end = new Date(m.end_time);
              return now >= start && now <= end;
            }).length}
          </div>
          <div className="summary-label">Maintenance</div>
        </div>
      </div>

      <div className="status-section">
        <h2>Service Status</h2>
        <div className="status-grid">
          {resources.map((resource) => {
            const status = getResourceStatus(resource.id);
            const activeIncident = incidents.find(
              (inc) => inc.resource_id === resource.id && !inc.resolved_at
            );
            const inMaintenance = maintenanceWindows.some((m) => {
              const now = new Date();
              const start = new Date(m.start_time);
              const end = new Date(m.end_time);
              return m.resource_id === resource.id && now >= start && now <= end;
            });

            const daily = resource.dailyUptime || [];
            const last90Days = (() => {
              const days = [];
              for (let i = 89; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                const entry = daily.find(e => e.day === key);
                days.push({ day: key, uptime: entry ? entry.uptime : null });
              }
              return days;
            })();

            return (
              <div
                key={resource.id}
                className={`status-card status-${inMaintenance ? 'maintenance' : status}`}
              >
                <div className="status-card-header">
                  <h3>{resource.name}</h3>
                  <span className={`status-badge status-badge-${inMaintenance ? 'maintenance' : status}`}>
                    {inMaintenance ? 'Maintenance' : status === 'up' ? 'Operational' : 'Incident'}
                  </span>
                </div>

                {resource.url && (
                  <p className="resource-url">
                    <a href={resource.url} target="_blank" rel="noopener noreferrer">
                      {resource.url}
                    </a>
                  </p>
                )}

                <div className="uptime-history" title="90-day uptime — hover for details">
                  {last90Days.map((d) => {
                    const color = d.uptime === null ? '#334155'
                      : d.uptime >= 99 ? '#14b8a6'
                      : d.uptime >= 95 ? '#f59e0b'
                      : '#ef4444';
                    return (
                      <div
                        key={d.day}
                        className="uptime-day-bar"
                        style={{ background: color }}
                        title={d.uptime !== null ? `${d.day}: ${d.uptime}%` : `${d.day}: no data`}
                      />
                    );
                  })}
                </div>
                <div className="uptime-history-labels">
                  <span>90 days ago</span>
                  <span>{daily.length > 0 ? `${daily[daily.length - 1]?.uptime ?? '—'}% today` : ''}</span>
                  <span>Today</span>
                </div>

                {activeIncident && (
                  <div className="incident-info">
                    <p className="incident-title">Active Incident</p>
                    <p className="incident-started">
                      Started: {formatLocalTime(activeIncident.started_at)}
                    </p>
                    {activeIncident.description && (
                      <p className="incident-description">{activeIncident.description}</p>
                    )}
                    <p className="incident-duration">
                      Duration: {formatDuration(new Date() - new Date(activeIncident.started_at))}
                    </p>
                  </div>
                )}

                {inMaintenance && (
                  <div className="maintenance-info">
                    <p className="maintenance-title">Scheduled Maintenance</p>
                    <p className="maintenance-window">
                      {formatLocalTime(
                        maintenanceWindows.find(
                          (m) =>
                            m.resource_id === resource.id &&
                            new Date() >= new Date(m.start_time) &&
                            new Date() <= new Date(m.end_time)
                        )?.start_time
                      )}
                    </p>
                  </div>
                )}

                {status === 'up' && !inMaintenance && (
                  <div className="status-operational">
                    <p>✓ All systems operational</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {maintenanceWindows.length > 0 && (
        <div className="status-section">
          <h2>Scheduled Maintenance</h2>
          <table className="maintenance-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Start Time</th>
                <th>End Time</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {maintenanceWindows.map((maint) => (
                <tr key={maint.id}>
                  <td>
                    {resources.find((r) => r.id === maint.resource_id)?.name || 'Unknown'}
                  </td>
                  <td>{formatLocalTime(maint.start_time)}</td>
                  <td>{formatLocalTime(maint.end_time)}</td>
                  <td>{maint.reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {incidents.filter((inc) => !inc.resolved_at).length > 0 && (
        <div className="status-section">
          <h2>Active Incidents</h2>
          <table className="incidents-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {incidents
                .filter((inc) => !inc.resolved_at)
                .map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      {resources.find((r) => r.id === incident.resource_id)?.name || 'Unknown'}
                    </td>
                    <td>{formatLocalTime(incident.started_at)}</td>
                    <td>
                      {formatDuration(new Date() - new Date(incident.started_at))}
                    </td>
                    <td className="incident-desc-cell">{incident.description || '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Status;
