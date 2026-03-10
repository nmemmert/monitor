import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatLocalTime } from './utils/timeUtils';
import './Observability.css';

function Observability() {
  const [activeTab, setActiveTab] = useState('metrics');
  const [metrics, setMetrics] = useState(null);
  const [errors, setErrors] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSummary, setAuditSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedAuditRow, setExpandedAuditRow] = useState(null);
  const [filters, setFilters] = useState({
    entityType: '',
    entityId: '',
    userId: '',
    action: ''
  });

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [activeTab, filters]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'metrics') {
        const resp = await axios.get('/api/observability/metrics');
        setMetrics(resp.data);
      } else if (activeTab === 'errors') {
        const resp = await axios.get('/api/observability/errors?limit=50');
        setErrors(resp.data.errors);
      } else if (activeTab === 'audit') {
        const auditResp = await axios.get('/api/observability/audit-logs', { params: filters });
        setAuditLogs(auditResp.data.logs);
        setAuditSummary(auditResp.data.summary);
      }
    } catch (error) {
      // Error loading data
    }
    setLoading(false);
  };

  return (
    <div className="container observability-page">
      <h2>System Observability</h2>

      <div className="obs-tabs">
        <button
          onClick={() => setActiveTab('metrics')}
          className={`obs-tab ${activeTab === 'metrics' ? 'is-active' : ''}`}
        >
          API Metrics
        </button>
        <button
          onClick={() => setActiveTab('errors')}
          className={`obs-tab ${activeTab === 'errors' ? 'is-active' : ''}`}
        >
          Errors
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`obs-tab ${activeTab === 'audit' ? 'is-active' : ''}`}
        >
          Audit Logs
        </button>
      </div>

      {/* Metrics Tab */}
      {activeTab === 'metrics' && metrics && (
        <div>
          <div className="obs-summary-grid">
            <div className="obs-summary-card">
              <div className="obs-card-label">Server Uptime</div>
              <div className="obs-card-value">
                {metrics.uptimeFormatted || `${Math.floor(metrics.uptime / 3600)}h`}
              </div>
            </div>
            <div className="obs-summary-card">
              <div className="obs-card-label">Total API Requests</div>
              <div className="obs-card-value">
                {metrics.apiStats.reduce((sum, s) => sum + s.totalRequests, 0)}
              </div>
            </div>
            <div className="obs-summary-card">
              <div className="obs-card-label">Errors Logged</div>
              <div className={`obs-card-value ${metrics.errorCount > 0 ? 'is-danger' : 'is-ok'}`}>
                {metrics.errorCount}
              </div>
            </div>
            <div className="obs-summary-card">
              <div className="obs-card-label">Unique Errors</div>
              <div className="obs-card-value">
                {metrics.uniqueErrors}
              </div>
            </div>
          </div>

          <h3>API Endpoint Performance</h3>
          <div className="obs-table-wrap obs-spacing-bottom">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th className="obs-right">Requests</th>
                  <th className="obs-right">Success Rate</th>
                  <th className="obs-right">Avg Response</th>
                  <th className="obs-right">Min/Max</th>
                </tr>
              </thead>
              <tbody>
                {metrics.apiStats.map((stat, i) => (
                  <tr key={i}>
                    <td>
                      <code>{stat.method} {stat.endpoint}</code>
                    </td>
                    <td className="obs-right">{stat.totalRequests}</td>
                    <td className="obs-right">
                      <span className={`obs-rate-pill ${stat.successRate >= 95 ? 'is-good' : 'is-warn'}`}>
                        {stat.successRate}%
                      </span>
                    </td>
                    <td className="obs-right">{stat.avgResponseTime}ms</td>
                    <td className="obs-right">
                      {stat.minResponseTime}ms / {stat.maxResponseTime}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Errors Tab */}
      {activeTab === 'errors' && (
        <div>
          {errors.length === 0 ? (
            <p className="obs-empty-copy">No errors logged</p>
          ) : (
            <div className="obs-table-wrap">
              <table className="obs-table">
                <thead>
                  <tr>
                    <th>Error Message</th>
                    <th>Context</th>
                    <th>Occurred At</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((error, i) => (
                    <tr key={i} className={i % 2 ? 'obs-zebra' : ''}>
                      <td>
                        <code className="obs-error-code">{error.error_message}</code>
                      </td>
                      <td className="obs-muted-sm">
                        {error.context ? JSON.stringify(JSON.parse(error.context)).substring(0, 50) : '-'}
                      </td>
                      <td className="obs-small">
                        {formatLocalTime(error.occurred_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Audit Logs Tab */}
      {activeTab === 'audit' && (
        <div>
          {auditSummary && (
            <div className="obs-audit-summary">
              <p><strong>Summary (Last 7 Days):</strong> {auditSummary.totalEvents} events</p>
              {auditSummary.actionBreakdown.map(action => (
                <p key={action.action} className="obs-audit-summary-line">
                  {action.action}: {action.count}
                </p>
              ))}
            </div>
          )}

          <div className="obs-filters-grid">
            <input
              type="text"
              placeholder="Entity Type"
              value={filters.entityType}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
              className="obs-filter-input"
            />
            <input
              type="text"
              placeholder="Entity ID"
              value={filters.entityId}
              onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
              className="obs-filter-input"
            />
            <input
              type="text"
              placeholder="User ID"
              value={filters.userId}
              onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
              className="obs-filter-input"
            />
            <input
              type="text"
              placeholder="Action"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="obs-filter-input"
            />
          </div>

          {auditLogs.length === 0 ? (
            <p className="obs-empty-copy">No audit logs found</p>
          ) : (
            <div className="obs-table-wrap">
              <table className="obs-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Entity</th>
                    <th>User</th>
                    <th>Changes</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log, i) => (
                    <React.Fragment key={i}>
                      <tr className={`obs-click-row ${i % 2 ? 'obs-zebra' : ''}`} onClick={() => setExpandedAuditRow(expandedAuditRow === i ? null : i)}>
                        <td><strong>{log.action}</strong></td>
                        <td className="obs-muted-sm">
                          {log.entity_type} #{log.entity_id}
                        </td>
                        <td className="obs-small">{log.user_id}</td>
                        <td className="obs-small">
                          <code className="obs-toggle-code">
                            {expandedAuditRow === i ? '▼ Hide' : '▶ Show'} Changes
                          </code>
                        </td>
                        <td className="obs-small">
                          {formatLocalTime(log.created_at)}
                        </td>
                      </tr>
                      {expandedAuditRow === i && (
                        <tr className="obs-expanded-row">
                          <td colSpan="5" className="obs-expanded-cell">
                            <strong>Full Changes:</strong>
                            <pre className="obs-pre">
                              {JSON.stringify(log.changes, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Observability;
