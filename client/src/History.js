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

const asNumberOrZero = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

function History() {
  const [historyData, setHistoryData] = useState([]);
  const [days, setDays] = useState(7);
  const [maxDays, setMaxDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAveraged, setShowAveraged] = useState(true);
  const [showTrends, setShowTrends] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [effectiveDays, setEffectiveDays] = useState(7);
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
  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        // Ask backend for averaged data (server-side bucketing) when enabled
        const response = await axios.get('/api/history/overview', { 
          params: { days, page: currentPage, limit: pageSize, averaged: showAveraged }
        });
        
        let data = [];
        let total = 0;
        
        // Handle both response formats
        if (response.data.resources && Array.isArray(response.data.resources)) {
          data = response.data.resources;
          total = response.data.total || data.length;
          setEffectiveDays(response.data.effective_days || days);
          setLimitedByRetention(Boolean(response.data.limited_by_retention));
        } else if (Array.isArray(response.data)) {
          data = response.data;
          total = data.length;
        }
        
        // Fetch trends data if enabled
        if (showTrends && data.length > 0) {
          const trendsPromises = data.map(async (resource) => {
            try {
              const trendsResponse = await axios.get(`/api/resources/${resource.id}/trends`, {
                params: { days }
              });
              return { ...resource, trendsData: trendsResponse.data };
            } catch (err) {
              return resource;
            }
          });
          data = await Promise.all(trendsPromises);
        }
        
        setHistoryData(data);
        setTotalItems(total);
        setLoading(false);
      } catch (error) {
        setError(error.message);
        setLoading(false);
      }
    };

    loadHistory();
  }, [days, currentPage, pageSize, showAveraged, showTrends]);

  if (loading) return <div className="container">Loading history...</div>;
  if (error) return <div className="container">Error loading history: {error}</div>;

  return (
    <div className="container">
      {limitedByRetention && (
        <div style={{ 
          padding: '1rem', 
          marginBottom: '1rem', 
          backgroundColor: '#fff3cd', 
          border: '1px solid #ffc107', 
          borderRadius: '4px',
          color: '#856404'
        }}>
          ⚠️ Data limited to {effectiveDays} days (server retention setting). Requested {days} days.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Monitoring History</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[7, 14, 30].map((d) => (
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
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none', background: '#f5f5f5', padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #ddd' }}>
            <input
              type="checkbox"
              checked={showAveraged}
              onChange={(e) => setShowAveraged(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Averages</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none', background: '#f5f5f5', padding: '0.5rem 1rem', borderRadius: '4px', border: '1px solid #ddd' }}>
            <input
              type="checkbox"
              checked={showTrends}
              onChange={(e) => setShowTrends(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Show Week-over-Week Trends</span>
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

                {showTrends && resource.trendsData && (
                  <div className="chart-container" style={{ height: '400px', marginBottom: '1.5rem', background: '#fafafa', padding: '1rem', borderRadius: '6px' }}>
                    <h4 style={{ marginBottom: '1rem', color: '#667eea' }}>Week-over-Week Comparison</h4>
                    {(() => {
                      const comparison = resource.trendsData?.comparison || {};
                      const responseTimeChange = asNumberOrZero(comparison.response_time_change);
                      const uptimeChange = asNumberOrZero(comparison.uptime_change);
                      return (
                    <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                      <div>
                        <strong>Response Time Change:</strong>{' '}
                        <span style={{ color: responseTimeChange >= 0 ? '#f44336' : '#4caf50' }}>
                          {responseTimeChange >= 0 ? '+' : ''}
                          {responseTimeChange.toFixed(1)}ms
                        </span>
                      </div>
                      <div>
                        <strong>Uptime Change:</strong>{' '}
                        <span style={{ color: uptimeChange >= 0 ? '#4caf50' : '#f44336' }}>
                          {uptimeChange >= 0 ? '+' : ''}
                          {uptimeChange.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                      );
                    })()}
                    <ResponsiveContainer width="100%" height="90%">
                      <ComposedChart data={prepareTrendsChartData(resource.trendsData)} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 12, fill: '#666' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis 
                          label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft', style: { fill: '#666' } }}
                          tick={{ fontSize: 12, fill: '#666' }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '4px', padding: '10px' }}
                          formatter={(value, name) => {
                            if (name === 'Current Period') return `${value}ms`;
                            if (name === 'Previous Period') return `${value}ms`;
                            return value;
                          }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Area
                          type="monotone"
                          dataKey="currentResponseTime"
                          fill="#667eea"
                          stroke="#667eea"
                          name="Current Period"
                          fillOpacity={0.3}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Area
                          type="monotone"
                          dataKey="previousResponseTime"
                          fill="#95a5a6"
                          stroke="#95a5a6"
                          strokeDasharray="5 5"
                          name="Previous Period"
                          fillOpacity={0.1}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
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

function prepareTrendsChartData(trendsData) {
  if (!trendsData || !trendsData.current || !trendsData.previous) return [];
  
  const maxLength = Math.max(
    trendsData.current.data.length,
    trendsData.previous.data.length
  );
  
  const result = [];
  for (let i = 0; i < maxLength; i++) {
    const currentDay = trendsData.current.data[i];
    const previousDay = trendsData.previous.data[i];
    
    result.push({
      day: `Day ${i + 1}`,
      currentResponseTime: currentDay ? asNumberOrZero(currentDay.avg_response_time) : null,
      previousResponseTime: previousDay ? asNumberOrZero(previousDay.avg_response_time) : null,
    });
  }
  
  return result;
}

export default History;
