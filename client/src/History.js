import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function History() {
  const [historyData, setHistoryData] = useState([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      try {
        const response = await axios.get('/api/history/overview', { params: { days } });
        setHistoryData(response.data);
        setLoading(false);
      } catch (error) {
        console.error('Error loading history:', error);
        setLoading(false);
      }
    };

    loadHistory();
  }, [days]);

  if (loading) return <div className="container">Loading history...</div>;

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
          {historyData && historyData.map((resource) => (
            <div key={resource.id}>
              <h3>{resource.name}</h3>
              <p>Type: {resource.type} | Uptime: {resource.uptime}% | Avg Response: {resource.avgResponseTime}ms</p>
              <p>Total checks: {resource.checks ? resource.checks.length : 0}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default History;
