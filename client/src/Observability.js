import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { formatLocalTime } from './utils/timeUtils';

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
    <div className="container" style={{ paddingTop: '2rem' }}>
      <h2>System Observability</h2>

      <div style={{ marginBottom: '2rem', borderBottom: '1px solid #ddd', display: 'flex', gap: '1rem' }}>
        <button
          onClick={() => setActiveTab('metrics')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderBottom: activeTab === 'metrics' ? '3px solid #007bff' : 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'metrics' ? 'bold' : 'normal',
            color: activeTab === 'metrics' ? '#007bff' : '#666'
          }}
        >
          API Metrics
        </button>
        <button
          onClick={() => setActiveTab('errors')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderBottom: activeTab === 'errors' ? '3px solid #007bff' : 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'errors' ? 'bold' : 'normal',
            color: activeTab === 'errors' ? '#007bff' : '#666'
          }}
        >
          Errors
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '0.75rem 1.5rem',
            border: 'none',
            borderBottom: activeTab === 'audit' ? '3px solid #007bff' : 'none',
            backgroundColor: 'transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'audit' ? 'bold' : 'normal',
            color: activeTab === 'audit' ? '#007bff' : '#666'
          }}
        >
          Audit Logs
        </button>
      </div>

      {/* Metrics Tab */}
      {activeTab === 'metrics' && metrics && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>Server Uptime</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem' }}>
                {metrics.uptimeFormatted || `${Math.floor(metrics.uptime / 3600)}h`}
              </div>
            </div>
            <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>Total API Requests</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem' }}>
                {metrics.apiStats.reduce((sum, s) => sum + s.totalRequests, 0)}
              </div>
            </div>
            <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>Errors Logged</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem', color: metrics.errorCount > 0 ? '#dc3545' : '#28a745' }}>
                {metrics.errorCount}
              </div>
            </div>
            <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>Unique Errors</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '0.5rem' }}>
                {metrics.uniqueErrors}
              </div>
            </div>
          </div>

          <h3>API Endpoint Performance</h3>
          <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Endpoint</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Requests</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Success Rate</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Avg Response</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Min/Max</th>
                </tr>
              </thead>
              <tbody>
                {metrics.apiStats.map((stat, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '0.75rem' }}>
                      <code>{stat.method} {stat.endpoint}</code>
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.75rem' }}>{stat.totalRequests}</td>
                    <td style={{ textAlign: 'right', padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '3px',
                        backgroundColor: stat.successRate >= 95 ? '#d4edda' : '#fff3cd',
                        color: stat.successRate >= 95 ? '#155724' : '#856404'
                      }}>
                        {stat.successRate}%
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.75rem' }}>{stat.avgResponseTime}ms</td>
                    <td style={{ textAlign: 'right', padding: '0.75rem' }}>
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
            <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>No errors logged</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd' }}>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Error Message</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Context</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Occurred At</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((error, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #ddd', backgroundColor: i % 2 ? '#f9f9f9' : 'white' }}>
                      <td style={{ padding: '0.75rem' }}>
                        <code style={{ fontSize: '0.85rem', color: '#d9534f' }}>{error.error_message}</code>
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#666' }}>
                        {error.context ? JSON.stringify(JSON.parse(error.context)).substring(0, 50) : '-'}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
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
            <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
              <p><strong>Summary (Last 7 Days):</strong> {auditSummary.totalEvents} events</p>
              {auditSummary.actionBreakdown.map(action => (
                <p key={action.action} style={{ margin: '0.25rem 0', fontSize: '0.9rem', color: '#666' }}>
                  {action.action}: {action.count}
                </p>
              ))}
            </div>
          )}

          <div style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Entity Type"
              value={filters.entityType}
              onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
              style={{ padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
            />
            <input
              type="text"
              placeholder="Entity ID"
              value={filters.entityId}
              onChange={(e) => setFilters({ ...filters, entityId: e.target.value })}
              style={{ padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
            />
            <input
              type="text"
              placeholder="User ID"
              value={filters.userId}
              onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
              style={{ padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
            />
            <input
              type="text"
              placeholder="Action"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              style={{ padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
            />
          </div>

          {auditLogs.length === 0 ? (
            <p style={{ color: '#999', textAlign: 'center', padding: '2rem' }}>No audit logs found</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ddd' }}>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Action</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Entity</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>User</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Changes</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', backgroundColor: '#f5f5f5' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log, i) => (
                    <React.Fragment key={i}>
                      <tr style={{ borderBottom: '1px solid #ddd', backgroundColor: i % 2 ? '#f9f9f9' : 'white', cursor: 'pointer' }} onClick={() => setExpandedAuditRow(expandedAuditRow === i ? null : i)}>
                        <td style={{ padding: '0.75rem' }}><strong>{log.action}</strong></td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', color: '#666' }}>
                          {log.entity_type} #{log.entity_id}
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>{log.user_id}</td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                          <code style={{ cursor: 'pointer', color: '#007bff' }}>
                            {expandedAuditRow === i ? '▼ Hide' : '▶ Show'} Changes
                          </code>
                        </td>
                        <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                          {formatLocalTime(log.created_at)}
                        </td>
                      </tr>
                      {expandedAuditRow === i && (
                        <tr style={{ backgroundColor: '#f0f8ff', borderBottom: '1px solid #ddd' }}>
                          <td colSpan="5" style={{ padding: '1rem' }}>
                            <strong>Full Changes:</strong>
                            <pre style={{ marginTop: '0.5rem', backgroundColor: 'white', padding: '0.75rem', borderRadius: '4px', overflowX: 'auto', border: '1px solid #ddd' }}>
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
