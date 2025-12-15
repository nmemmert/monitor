import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function SLA() {
  const [slaData, setSlaData] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  const loadSLAData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/api/sla', { params: { days, page: currentPage, limit: pageSize } });
      const data = Array.isArray(response.data.resources) ? response.data.resources : [];
      setSlaData(data);
      setTotalItems(response.data.total || data.length);
      setLoading(false);
    } catch (error) {
      console.error('Error loading SLA data:', error);
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
    totalDowntime: slaData.reduce((sum, s) => sum + s.downtime_minutes, 0),
  } : null;

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>SLA Dashboard</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDays(d)}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {overallStats && (
        <div className="stats-grid" style={{ marginBottom: '2rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div className="stat" style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px' }}>
            <p className="stat-value" style={{ color: '#667eea', fontSize: '2.5rem' }}>{overallStats.totalResources}</p>
            <p className="stat-label">Total Resources</p>
          </div>
          <div className="stat" style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px' }}>
            <p className="stat-value" style={{ color: '#4caf50', fontSize: '2.5rem' }}>{overallStats.meetingTarget}/{overallStats.totalResources}</p>
            <p className="stat-label">Meeting SLA Target</p>
          </div>
          <div className="stat" style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px' }}>
            <p className="stat-value" style={{ color: '#667eea', fontSize: '2.5rem' }}>{overallStats.avgUptime}%</p>
            <p className="stat-label">Average Uptime</p>
          </div>
          <div className="stat" style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px' }}>
            <p className="stat-value" style={{ color: '#ff9800', fontSize: '2.5rem' }}>{overallStats.totalIncidents}</p>
            <p className="stat-label">Total Incidents</p>
          </div>
          <div className="stat" style={{ background: '#f5f5f5', padding: '1.5rem', borderRadius: '8px' }}>
            <p className="stat-value" style={{ color: '#f44336', fontSize: '2.5rem' }}>{Math.round(overallStats.totalDowntime)}m</p>
            <p className="stat-label">Total Downtime</p>
          </div>
        </div>
      )}

      {slaData.length === 0 ? (
        <div className="empty-state">
          <h3>No SLA data available</h3>
          <p>Add resources to start tracking SLA metrics</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <thead>
              <tr style={{ background: '#667eea', color: 'white' }}>
                <th style={{ padding: '1rem', textAlign: 'left' }}>Resource</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Target</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Actual</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Checks</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Incidents</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>Downtime</th>
              </tr>
            </thead>
            <tbody>
              {slaData.map((item, idx) => (
                <tr key={item.resource_id} style={{ borderBottom: '1px solid #eee', background: idx % 2 === 0 ? '#fafafa' : '#fff' }}>
                  <td style={{ padding: '1rem', fontWeight: 'bold' }}>{item.resource_name}</td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>{item.sla_target}%</td>
                  <td style={{ padding: '1rem', textAlign: 'center', fontWeight: 'bold', color: item.meets_target ? '#4caf50' : '#f44336' }}>
                    {item.actual_uptime}%
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    <span style={{ 
                      padding: '0.25rem 0.75rem', 
                      borderRadius: '12px', 
                      background: item.meets_target ? '#e8f5e9' : '#ffebee',
                      color: item.meets_target ? '#2e7d32' : '#c62828',
                      fontSize: '0.875rem',
                      fontWeight: 'bold'
                    }}>
                      {item.meets_target ? '✓ PASS' : '✗ FAIL'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    {item.successful_checks}/{item.total_checks}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center', color: item.incidents > 0 ? '#ff9800' : '#666' }}>
                    {item.incidents}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>
                    {item.downtime_minutes > 0 ? `${item.downtime_minutes}m` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalItems > pageSize && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '2rem', padding: '1.5rem', background: '#f5f5f5', borderRadius: '8px' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              ← Previous
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: '#666', fontSize: '0.9rem' }}>Page</span>
              <input 
                type="number" 
                value={currentPage} 
                onChange={(e) => {
                  const page = Math.max(1, Math.min(Math.ceil(totalItems / pageSize), parseInt(e.target.value) || 1));
                  setCurrentPage(page);
                }}
                style={{ width: '50px', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
              />
              <span style={{ color: '#666', fontSize: '0.9rem' }}>of {Math.ceil(totalItems / pageSize)}</span>
            </div>
            <select 
              value={pageSize} 
              onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
              style={{ padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', background: '#fff' }}
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

      <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0, color: '#667eea' }}>SLA Report Summary</h3>
        <p style={{ color: '#666', lineHeight: '1.6' }}>
          This report shows the Service Level Agreement (SLA) performance for all monitored resources over the last <strong>{days} days</strong>.
          Resources meeting their target uptime are marked as <strong style={{ color: '#4caf50' }}>PASS</strong>, while those below target are marked as <strong style={{ color: '#f44336' }}>FAIL</strong>.
        </p>
        <p style={{ color: '#666', lineHeight: '1.6', marginBottom: 0 }}>
          Overall performance: <strong>{overallStats?.meetingTarget || 0}</strong> out of <strong>{overallStats?.totalResources || 0}</strong> resources ({overallStats ? Math.round((overallStats.meetingTarget / overallStats.totalResources) * 100) : 0}%) are meeting their SLA targets.
        </p>
      </div>
    </div>
  );
}

export default SLA;
