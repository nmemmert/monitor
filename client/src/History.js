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

function History() {
  const [historyData, setHistoryData] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axios.get('/api/history/overview', { params: { days } });
        setHistoryData(response.data || []);
        setLoading(false);
      } catch (error) {
        console.error('Error loading history:', error);
        setError(error.message);
        setLoading(false);
      }
    };

    loadHistory();
  }, [days]);

  if (loading) return <div className="container">Loading history...</div>;
  if (error) return <div className="container">Error loading history: {error}</div>;

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Monitoring History</h2>
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
      </div>

      {historyData.length === 0 ? (
        <div className="empty-state">
          <h3>No check history</h3>
          <p>Add resources and wait for checks to complete</p>
        </div>
      ) : (
        <div>
          {historyData.map((resource) => {
            const chartData = prepareChartData(resource.checks || []);

            return (
              <div key={resource.id} className="detail-section" style={{ marginBottom: '3rem' }}>
                <h3 style={{ marginBottom: '0.5rem', color: '#667eea' }}>{resource.name}</h3>
                <p style={{ color: '#666', marginBottom: '1rem' }}>
                  Type: <strong>{resource.type}</strong> | Uptime: <strong>{resource.uptime}%</strong> | Avg Response: <strong>{resource.avgResponseTime}ms</strong>
                </p>

                {chartData.length > 0 ? (
                  <div className="chart-container" style={{ height: '360px', marginBottom: '1.5rem' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11 }}
                          angle={-45}
                          textAnchor="end"
                          height={70}
                        />
                        <YAxis yAxisId="left" label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
                        <YAxis yAxisId="right" orientation="right" domain={[0, 1]} ticks={[0, 1]} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#f5f5f5', border: '1px solid #ddd' }}
                          formatter={(value, name) => {
                            if (name === 'Response Time (ms)') return `${value}ms`;
                            if (name === 'Status') return value === 1 ? 'UP' : 'DOWN';
                            return value;
                          }}
                        />
                        <Legend />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="responseTime"
                          fill="#667eea"
                          stroke="#667eea"
                          name="Response Time (ms)"
                          fillOpacity={0.25}
                          isAnimationActive={false}
                        />
                        <Bar
                          yAxisId="right"
                          dataKey="statusNumeric"
                          fill="#4caf50"
                          name="Status"
                          opacity={0.45}
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div style={{ color: '#999', padding: '1.5rem', textAlign: 'center' }}>No check data available</div>
                )}

                <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                  <div className="stat">
                    <p className="stat-value">{resource.checks?.length || 0}</p>
                    <p className="stat-label">Total Checks</p>
                  </div>
                  <div className="stat">
                    <p className="stat-value">{resource.uptime}%</p>
                    <p className="stat-label">Uptime</p>
                  </div>
                  <div className="stat">
                    <p className="stat-value">{resource.avgResponseTime}ms</p>
                    <p className="stat-label">Avg Response</p>
                  </div>
                  <div className="stat">
                    <p className="stat-value">{(resource.checks || []).filter((c) => c.status === 'up').length}/{resource.checks?.length || 0}</p>
                    <p className="stat-label">Successful Checks</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function prepareChartData(checks) {
  return checks.map((check) => {
    const date = new Date(check.checked_at);
    const label = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return {
      label,
      responseTime: check.response_time || 0,
      status: check.status,
      statusNumeric: check.status === 'up' ? 1 : 0,
    };
  });
}

export default History;
