import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import './App.css';
import { formatChartTime } from './utils/timeUtils';

function History() {
  const [historyData, setHistoryData] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAveraged, setShowAveraged] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        // Ask backend for averaged data (server-side bucketing) when enabled
        const response = await axios.get('/api/history/overview', { 
          params: { days, page: currentPage, limit: pageSize, averaged: showAveraged }
        });
        console.log('History API Response:', response.data);
        
        let data = [];
        let total = 0;
        
        // Handle both response formats
        if (response.data.resources && Array.isArray(response.data.resources)) {
          data = response.data.resources;
          total = response.data.total || data.length;
        } else if (Array.isArray(response.data)) {
          data = response.data;
          total = data.length;
        }
        
        console.log('Processed history data:', { data, total });
        setHistoryData(data);
        setTotalItems(total);
        setLoading(false);
      } catch (error) {
        console.error('Error loading history:', error);
        setError(error.message);
        setLoading(false);
      }
    };

    loadHistory();
  }, [days, currentPage, pageSize, showAveraged]);

  if (loading) return <div className="container">Loading history...</div>;
  if (error) return <div className="container">Error loading history: {error}</div>;

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Monitoring History</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                className={`btn ${days === d ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setDays(d)}
              >
                {d} Days
              </button>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none', background: '#f5f5f5', padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #ddd' }}>
            <input
              type="checkbox"
              checked={showAveraged}
              onChange={(e) => setShowAveraged(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Averages</span>
          </label>
        </div>
      </div>

      {historyData.length === 0 ? (
        <div className="empty-state">
          <h3>No check history</h3>
          <p>Add resources and wait for checks to complete</p>
        </div>
      ) : (
        <div>
          {historyData.map((resource) => {
            // Server already handles averaging when averaged=true is passed
            const chartData = prepareChartData(resource.checks || []);
            console.log(`${resource.name} - Total data points:`, chartData.length, 'Averaged mode:', showAveraged);

            return (
              <div key={resource.id} className="detail-section" style={{ marginBottom: '3rem', background: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                <h3 style={{ marginBottom: '0.5rem', color: '#667eea', fontSize: '1.5rem' }}>{resource.name}</h3>
                <p style={{ color: '#666', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                  <span style={{ marginRight: '1.5rem' }}>Type: <strong style={{ color: '#333' }}>{resource.type.toUpperCase()}</strong></span>
                  <span style={{ marginRight: '1.5rem' }}>Uptime: <strong style={{ color: resource.uptime >= 95 ? '#4caf50' : resource.uptime >= 80 ? '#ff9800' : '#f44336' }}>{resource.uptime}%</strong></span>
                  <span>Avg Response: <strong style={{ color: '#333' }}>{resource.avgResponseTime}ms</strong></span>
                </p>

                {chartData.length > 0 ? (
                  <div className="chart-container" style={{ height: '400px', marginBottom: '1.5rem', background: '#fafafa', padding: '1rem', borderRadius: '6px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 12, fill: '#666' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis 
                          yAxisId="left" 
                          label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft', style: { fill: '#666' } }}
                          tick={{ fontSize: 12, fill: '#666' }}
                        />
                        <YAxis 
                          yAxisId="right" 
                          orientation="right" 
                          domain={[0, 1]} 
                          ticks={[0, 1]} 
                          tick={{ fontSize: 12, fill: '#666' }}
                          label={{ value: 'Status', angle: 90, position: 'insideRight', style: { fill: '#666' } }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '4px', padding: '10px' }}
                          formatter={(value, name) => {
                            if (name === 'Response Time') return `${value}ms`;
                            if (name === 'Status') return value === 1 ? '✓ UP' : '✗ DOWN';
                            if (name === 'Uptime %') return `${value}%`;
                            return value;
                          }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="responseTime"
                          fill="#667eea"
                          stroke="#667eea"
                          name="Response Time"
                          fillOpacity={0.3}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Bar
                          yAxisId="right"
                          dataKey="statusNumeric"
                          fill="#4caf50"
                          name="Status"
                          opacity={0.5}
                          isAnimationActive={false}
                          shape={(props) => {
                            const { x, y, width, height, payload } = props;
                            const color = payload.status === 'up' ? '#4caf50' : '#f44336';
                            return (
                              <rect
                                x={x}
                                y={y}
                                width={width}
                                height={height}
                                fill={color}
                                opacity={0.5}
                              />
                            );
                          }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ color: '#999', padding: '2rem', textAlign: 'center', background: '#fafafa', borderRadius: '6px' }}>No check data available</div>
                )}

                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div className="stat" style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '6px' }}>
                    <p className="stat-value" style={{ color: '#667eea', fontSize: '2rem', fontWeight: 'bold' }}>{resource.checks?.length || 0}</p>
                    <p className="stat-label" style={{ color: '#666', fontSize: '0.9rem' }}>Total Checks</p>
                  </div>
                  <div className="stat" style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '6px' }}>
                    <p className="stat-value" style={{ color: resource.uptime >= 95 ? '#4caf50' : resource.uptime >= 80 ? '#ff9800' : '#f44336', fontSize: '2rem', fontWeight: 'bold' }}>{resource.uptime}%</p>
                    <p className="stat-label" style={{ color: '#666', fontSize: '0.9rem' }}>Uptime</p>
                  </div>
                  <div className="stat" style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '6px' }}>
                    <p className="stat-value" style={{ color: '#667eea', fontSize: '2rem', fontWeight: 'bold' }}>{resource.avgResponseTime}ms</p>
                    <p className="stat-label" style={{ color: '#666', fontSize: '0.9rem' }}>Avg Response</p>
                  </div>
                  <div className="stat" style={{ background: '#f5f5f5', padding: '1rem', borderRadius: '6px' }}>
                    <p className="stat-value" style={{ color: '#4caf50', fontSize: '2rem', fontWeight: 'bold' }}>{(resource.checks || []).filter((c) => c.status === 'up').length}/{resource.checks?.length || 0}</p>
                    <p className="stat-label" style={{ color: '#666', fontSize: '0.9rem' }}>Successful Checks</p>
                  </div>
                </div>
              </div>
            );
          })}

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
    </div>
  );
}

function prepareChartData(checks) {
  return checks.map((check) => {
    const label = formatChartTime(check.checked_at);
    return {
      label,
      responseTime: check.response_time || 0,
      status: check.status,
      statusNumeric: check.status === 'up' ? 1 : 0,
    };
  });
}

export default History;
