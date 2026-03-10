import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import './CommandCenterPages.css';

function SLA() {
  const [slaData, setSlaData] = useState([]);
  const [days, setDays] = useState(30);
  const [maxDays, setMaxDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [effectiveDays, setEffectiveDays] = useState(30);
  const [limitedByRetention, setLimitedByRetention] = useState(false);

  useEffect(() => {
    // Fetch retention setting from server
    const fetchRetention = async () => {
      try {
        const response = await axios.get('/api/settings');
        const retentionDays = response.data.retention_days || 30;
        setMaxDays(parseInt(retentionDays));
        // Adjust current days if it exceeds retention
        if (days > retentionDays) {
          setDays(parseInt(retentionDays));
        }
      } catch (error) {
        // Failed to fetch retention setting, use default
      }
    };
    fetchRetention();
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadSLAData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/sla', { params: { days, page: currentPage, limit: pageSize } });
      const data = Array.isArray(response.data.resources) ? response.data.resources : [];
      setSlaData(data);
      setTotalItems(response.data.total || data.length);
      setEffectiveDays(response.data.effective_days || days);
      setLimitedByRetention(Boolean(response.data.limited_by_retention));
      setLoading(false);
    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  }, [days, currentPage, pageSize]);

  useEffect(() => {
    loadSLAData();
  }, [loadSLAData]);

  if (loading) return <div className="container">Loading SLA data...</div>;
  if (error) return <div className="container">Error loading SLA data: {error}</div>;

  const overallStats = slaData && Array.isArray(slaData) && slaData.length > 0 ? {
    totalResources: slaData.length,
    meetingTarget: slaData.filter(s => s.meets_target).length,
    avgUptime: (slaData.reduce((sum, s) => sum + parseFloat(s.actual_uptime), 0) / slaData.length).toFixed(2),
    totalIncidents: slaData.reduce((sum, s) => sum + s.incidents, 0),
    totalDowntime: (slaData.reduce((sum, s) => sum + s.downtime_minutes, 0) / 60).toFixed(2), // Convert to hours
  } : null;

  return (
    <div className="container cc-page">
      {limitedByRetention && (
        <div className="cc-alert">
          ⚠️ SLA data limited to {effectiveDays} days (server retention setting). Requested {days} days.
        </div>
      )}
      <div className="cc-page-header">
        <h2 className="cc-page-title">SLA Dashboard</h2>
        <div className="cc-controls">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDays(d)}
              disabled={d > maxDays}
              style={{ opacity: d > maxDays ? 0.5 : 1 }}
            >
              {d} Days
            </button>
          ))}
        </div>
        {limitedByRetention && (
          <div className="cc-alert" style={{ marginBottom: 0 }}>
            Limited by data retention ({effectiveDays} days). Increase Retention in Settings to view longer periods.
          </div>
        )}
      </div>

      {overallStats && (
        <div className="cc-kpi-grid" style={{ marginBottom: '1rem' }}>
          <div className="cc-kpi">
            <p className="cc-kpi-label">Total Resources</p>
            <p className="cc-kpi-value" style={{ color: '#60a5fa' }}>{overallStats.totalResources}</p>
          </div>
          <div className="cc-kpi">
            <p className="cc-kpi-label">Meeting SLA Target</p>
            <p className="cc-kpi-value" style={{ color: '#22c55e' }}>{overallStats.meetingTarget}/{overallStats.totalResources}</p>
          </div>
          <div className="cc-kpi">
            <p className="cc-kpi-label">Average Uptime</p>
            <p className="cc-kpi-value" style={{ color: '#a78bfa' }}>{overallStats.avgUptime}%</p>
          </div>
          <div className="cc-kpi">
            <p className="cc-kpi-label">Total Incidents</p>
            <p className="cc-kpi-value" style={{ color: '#f59e0b' }}>{overallStats.totalIncidents}</p>
          </div>
          <div className="cc-kpi">
            <p className="cc-kpi-label">Total Downtime</p>
            <p className="cc-kpi-value" style={{ color: '#ef4444' }}>{Math.round(overallStats.totalDowntime)}m</p>
          </div>
        </div>
      )}

      {slaData.length === 0 ? (
        <div className="empty-state">
          <h3>No SLA data available</h3>
          <p>Add resources to start tracking SLA metrics</p>
        </div>
      ) : (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th style={{ textAlign: 'center' }}>Target</th>
                <th style={{ textAlign: 'center' }}>Actual</th>
                <th style={{ textAlign: 'center' }}>Status</th>
                <th style={{ textAlign: 'center' }}>Checks</th>
                <th style={{ textAlign: 'center' }}>Incidents</th>
                <th style={{ textAlign: 'center' }}>Downtime</th>
              </tr>
            </thead>
            <tbody>
              {slaData.map((item, idx) => (
                <tr key={item.resource_id} style={{ background: idx % 2 === 0 ? '#0b1325' : '#0f172a' }}>
                  <td style={{ fontWeight: 'bold' }}>{item.resource_name}</td>
                  <td style={{ textAlign: 'center' }}>{item.sla_target}%</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold', color: item.meets_target ? '#22c55e' : '#ef4444' }}>
                    {item.actual_uptime}%
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ 
                      padding: '0.25rem 0.75rem', 
                      borderRadius: '12px', 
                      background: item.meets_target ? '#052e16' : '#3f1d1d',
                      color: item.meets_target ? '#4ade80' : '#fda4af',
                      fontSize: '0.875rem',
                      fontWeight: 'bold'
                    }}>
                      {item.meets_target ? '✓ PASS' : '✗ FAIL'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {item.successful_checks}/{item.total_checks}
                  </td>
                  <td style={{ textAlign: 'center', color: item.incidents > 0 ? '#f59e0b' : '#94a3b8' }}>
                    {item.incidents}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {item.downtime_minutes > 0 ? `${item.downtime_minutes}m` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalItems > pageSize && (
          <div className="cc-pagination" style={{ marginTop: '1rem' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              ← Previous
            </button>
            <div className="cc-controls">
              <span>Page</span>
              <input 
                type="number" 
                value={currentPage} 
                onChange={(e) => {
                  const page = Math.max(1, Math.min(Math.ceil(totalItems / pageSize), parseInt(e.target.value) || 1));
                  setCurrentPage(page);
                }}
                className="cc-input-sm"
              />
              <span>of {Math.ceil(totalItems / pageSize)}</span>
            </div>
            <select 
              value={pageSize} 
              onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
              className="cc-select-sm"
            >
              <option value={5}>5 per page</option>
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
            </select>
            <button 
              className="btn btn-secondary" 
              onClick={() => setCurrentPage(Math.min(Math.ceil(totalItems / pageSize), currentPage + 1))}
              disabled={currentPage >= Math.ceil(totalItems / pageSize)}
            >
              Next →
            </button>
          </div>
          )}
        </div>
      )}

      <div className="cc-surface" style={{ marginTop: '1rem' }}>
        <h3 className="history-resource-title">SLA Report Summary</h3>
        <p style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
          This report shows the Service Level Agreement (SLA) performance for all monitored resources over the last <strong>{effectiveDays} days</strong>.
          Resources meeting their target uptime are marked as <strong style={{ color: '#22c55e' }}>PASS</strong>, while those below target are marked as <strong style={{ color: '#ef4444' }}>FAIL</strong>.
        </p>
        <p style={{ color: '#cbd5e1', lineHeight: '1.6', marginBottom: 0 }}>
          Overall performance: <strong>{overallStats?.meetingTarget || 0}</strong> out of <strong>{overallStats?.totalResources || 0}</strong> resources ({overallStats ? Math.round((overallStats.meetingTarget / overallStats.totalResources) * 100) : 0}%) are meeting their SLA targets.
        </p>
      </div>
    </div>
  );
}

export default SLA;
