import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './App.css';
import SettingsWizard from './SettingsWizard';

function Dashboard() {
  const [resources, setResources] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    type: 'http',
    check_interval: 60000,
    timeout: 5000,
  });
  const navigate = useNavigate();

  useEffect(() => {
    loadResources();
    const interval = setInterval(loadResources, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadResources = async () => {
    try {
      const response = await axios.get('/api/dashboard');
      setResources(response.data);
    } catch (error) {
      console.error('Error loading resources:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/resources', formData);
      setShowModal(false);
      setFormData({ name: '', url: '', type: 'http', check_interval: 60000, timeout: 5000 });
      loadResources();
    } catch (error) {
      console.error('Error creating resource:', error);
      alert('Error creating resource');
    }
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h2>Resource Monitor Dashboard</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + Add Resource
        </button>
      </div>

      {resources.length === 0 ? (
        <div className="empty-state">
          <h3>No resources yet</h3>
          <p>Add your first resource to start monitoring</p>
        </div>
      ) : (
        <div className="dashboard-grid">
          {resources.map((resource) => (
            <div
              key={resource.id}
              className="resource-card"
              onClick={() => navigate(`/resource/${resource.id}`)}
            >
              <div className="resource-header">
                <div>
                  <h3 className="resource-name">{resource.name}</h3>
                  <p className="resource-url">{resource.url}</p>
                </div>
                <span className={`status-badge status-${resource.status}`}>
                  {resource.status}
                </span>
              </div>

              {resource.hasActiveIncident && (
                <div className="incident-badge">⚠️ Active Incident</div>
              )}

              <div className="stats-grid">
                <div className="stat">
                  <p className="stat-value">{resource.uptime}%</p>
                  <p className="stat-label">Uptime (24h)</p>
                </div>
                <div className="stat">
                  <p className="stat-value">{resource.avgResponseTime}ms</p>
                  <p className="stat-label">Avg Response</p>
                </div>
              </div>

              {resource.lastCheck && (
                <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#999' }}>
                  Last checked: {new Date(resource.lastCheck).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Add New Resource</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="e.g., ZimaOS Home Server"
                />
              </div>

              <div className="form-group">
                <label>URL *</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  required
                  placeholder="https://your-zima.example.com"
                />
              </div>

              <div className="form-group">
                <label>Check Interval (ms)</label>
                <input
                  type="number"
                  value={formData.check_interval}
                  onChange={(e) => setFormData({ ...formData, check_interval: parseInt(e.target.value) })}
                  min="10000"
                />
              </div>

              <div className="form-group">
                <label>Timeout (ms)</label>
                <input
                  type="number"
                  value={formData.timeout}
                  onChange={(e) => setFormData({ ...formData, timeout: parseInt(e.target.value) })}
                  min="1000"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Add Resource
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ResourceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [resource, setResource] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadResource();
    const interval = setInterval(loadResource, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadResource = async () => {
    try {
      const response = await axios.get(`/api/resources/${id}`);
      setResource(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error loading resource:', error);
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this resource?')) {
      try {
        await axios.delete(`/api/resources/${id}`);
        navigate('/');
      } catch (error) {
        console.error('Error deleting resource:', error);
        alert('Error deleting resource');
      }
    }
  };

  const toggleEnabled = async () => {
    try {
      await axios.put(`/api/resources/${id}`, {
        ...resource,
        enabled: !resource.enabled,
      });
      loadResource();
    } catch (error) {
      console.error('Error updating resource:', error);
    }
  };

  if (loading) return <div className="container">Loading...</div>;
  if (!resource) return <div className="container">Resource not found</div>;

  const chartData = resource.stats.checks.map((check) => ({
    time: new Date(check.checked_at).toLocaleTimeString(),
    responseTime: check.response_time,
    status: check.status === 'up' ? 1 : 0,
  }));

  return (
    <div className="container">
      <Link to="/" className="back-button">← Back to Dashboard</Link>

      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h2>{resource.name}</h2>
            <p style={{ color: '#666' }}>{resource.url}</p>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button className="btn" onClick={toggleEnabled}>
              {resource.enabled ? 'Disable' : 'Enable'}
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>

        {resource.hasActiveIncident && (
          <div className="incident-badge">⚠️ Active Incident - Resource is currently DOWN</div>
        )}

        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: '2rem' }}>
          <div className="stat">
            <p className="stat-value">{resource.stats.uptime}%</p>
            <p className="stat-label">Uptime (24h)</p>
          </div>
          <div className="stat">
            <p className="stat-value">{resource.stats.avgResponseTime}ms</p>
            <p className="stat-label">Avg Response</p>
          </div>
          <div className="stat">
            <p className="stat-value">{resource.stats.totalChecks}</p>
            <p className="stat-label">Total Checks</p>
          </div>
          <div className="stat">
            <p className={`stat-value status-badge status-${resource.lastCheck?.status || 'unknown'}`}>
              {resource.lastCheck?.status || 'unknown'}
            </p>
            <p className="stat-label">Current Status</p>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h2>Response Time (Last 50 Checks)</h2>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="responseTime" stroke="#667eea" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="detail-section">
        <h2>Recent Checks</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Time</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '0.75rem', textAlign: 'right' }}>Response Time</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Message</th>
            </tr>
          </thead>
          <tbody>
            {resource.stats.checks.slice(-10).reverse().map((check, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.75rem' }}>
                  {new Date(check.checked_at).toLocaleString()}
                </td>
                <td style={{ padding: '0.75rem' }}>
                  <span className={`status-badge status-${check.status}`}>
                    {check.status}
                  </span>
                </td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                  {check.response_time ? `${check.response_time}ms` : '-'}
                </td>
                <td style={{ padding: '0.75rem', color: '#666' }}>
                  {check.error_message || 'OK'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Navbar() {
  const [notificationsConfigured, setNotificationsConfigured] = useState(false);

  useEffect(() => {
    checkNotifications();
  }, []);

  const checkNotifications = async () => {
    try {
      const response = await axios.get('/api/settings');
      setNotificationsConfigured(response.data.email_enabled || response.data.webhook_enabled);
    } catch (error) {
      console.error('Error checking notifications:', error);
    }
  };

  return (
    <nav className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <h1>🔍 Resource Monitor</h1>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Link to="/" style={{ color: 'white', textDecoration: 'none', opacity: 0.9, fontWeight: 500 }}>Dashboard</Link>
            <Link to="/settings" style={{ color: 'white', textDecoration: 'none', opacity: 0.9, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Settings
              {!notificationsConfigured && (
                <span style={{ 
                  background: '#ffc107', 
                  color: '#000', 
                  padding: '0.15rem 0.5rem', 
                  borderRadius: '12px', 
                  fontSize: '0.7rem',
                  fontWeight: 'bold'
                }}>SETUP</span>
              )}
            </Link>
          </div>
        </div>
        {notificationsConfigured && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', opacity: 0.9 }}>
            <span>🔔</span>
            <span>Notifications Active</span>
          </div>
        )}
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <div className="App">
        <Navbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/resource/:id" element={<ResourceDetail />} />
          <Route path="/settings" element={<div className="container"><SettingsWizard /></div>} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
