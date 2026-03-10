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
import './CommandCenterPages.css';
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
    <div className="container cc-page">
      {limitedByRetention && (
        <div className="cc-alert">
          ⚠️ Data limited to {effectiveDays} days (server retention setting). Requested {days} days.
        </div>
      )}
      <div className="cc-page-header">
        <h2 className="cc-page-title" style={{ color: '#f8fafc', fontWeight: 800 }}>Monitoring History</h2>
        <div className="cc-controls">
          <div className="cc-controls">
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
          <label className="cc-pill-toggle">
            <input
              type="checkbox"
              checked={showAveraged}
              onChange={(e) => setShowAveraged(e.target.checked)}
            />
            <span>Show Averages</span>
          </label>
          <label className="cc-pill-toggle">
            <input
              type="checkbox"
              checked={showTrends}
              onChange={(e) => setShowTrends(e.target.checked)}
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
              <div key={resource.id} className="detail-section cc-surface history-resource-card">
                <h3 className="history-resource-title">{resource.name}</h3>
                <p className="history-resource-meta">
                  <span>Type: <strong>{resource.type.toUpperCase()}</strong></span>
                  <span>Uptime: <strong style={{ color: resource.uptime >= 95 ? '#22c55e' : resource.uptime >= 80 ? '#f59e0b' : '#ef4444' }}>{resource.uptime}%</strong></span>
                  <span>Avg Response: <strong>{resource.avgResponseTime}ms</strong></span>
                </p>

                {chartData.length > 0 ? (
                  <div className="chart-container history-chart-box">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 12, fill: '#94a3b8' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis 
                          yAxisId="left" 
                          label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }}
                          tick={{ fontSize: 12, fill: '#94a3b8' }}
                        />
                        <YAxis 
                          yAxisId="right" 
                          orientation="right" 
                          domain={[0, 1]} 
                          ticks={[0, 1]} 
                          tick={{ fontSize: 12, fill: '#94a3b8' }}
                          label={{ value: 'Status', angle: 90, position: 'insideRight', style: { fill: '#94a3b8' } }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px' }}
                          labelStyle={{ color: '#cbd5e1' }}
                          itemStyle={{ color: '#e2e8f0' }}
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
                  <div className="cc-empty">No check data available</div>
                )}

                {showTrends && resource.trendsData && (
                  <div className="chart-container history-chart-box">
                    <h4 className="history-resource-title">Week-over-Week Comparison</h4>
                    {(() => {
                      const comparison = resource.trendsData?.comparison || {};
                      const responseTimeChange = asNumberOrZero(comparison.response_time_change);
                      const uptimeChange = asNumberOrZero(comparison.uptime_change);
                      return (
                    <div className="history-trend-row">
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 12, fill: '#94a3b8' }}
                          angle={-45}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis 
                          label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft', style: { fill: '#94a3b8' } }}
                          tick={{ fontSize: 12, fill: '#94a3b8' }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', padding: '10px' }}
                          labelStyle={{ color: '#cbd5e1' }}
                          itemStyle={{ color: '#e2e8f0' }}
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

                <div className="cc-kpi-grid">
                  <div className="cc-kpi">
                    <p className="cc-kpi-label">Total Checks</p>
                    <p className="cc-kpi-value" style={{ color: '#60a5fa' }}>{resource.checks?.length || 0}</p>
                  </div>
                  <div className="cc-kpi">
                    <p className="cc-kpi-label">Uptime</p>
                    <p className="cc-kpi-value" style={{ color: resource.uptime >= 95 ? '#22c55e' : resource.uptime >= 80 ? '#f59e0b' : '#ef4444' }}>{resource.uptime}%</p>
                  </div>
                  <div className="cc-kpi">
                    <p className="cc-kpi-label">Avg Response</p>
                    <p className="cc-kpi-value" style={{ color: '#a78bfa' }}>{resource.avgResponseTime}ms</p>
                  </div>
                  <div className="cc-kpi">
                    <p className="cc-kpi-label">Successful Checks</p>
                    <p className="cc-kpi-value" style={{ color: '#34d399' }}>{(resource.checks || []).filter((c) => c.status === 'up').length}/{resource.checks?.length || 0}</p>
                  </div>
                </div>
              </div>
            );
          })}

          {totalItems > pageSize && (
            <div className="cc-pagination">
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
