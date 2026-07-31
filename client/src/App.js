import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import axios from 'axios';
import './App.css';
import Dashboard from './Dashboard';
import ResourceDetail from './ResourceDetail';
import SettingsWizard from './SettingsWizard';
import History from './History';
import SLA from './SLA';
import Status from './Status';
import Observability from './Observability';
import Notifications from './Notifications';

function Navbar() {
  const [notificationsConfigured, setNotificationsConfigured] = useState(false);

  useEffect(() => {
    checkNotifications();
  }, []);

  const checkNotifications = async () => {
    try {
      const response = await axios.get('/api/settings');
      setNotificationsConfigured(response.data.email_enabled || response.data.webhook_enabled);
      if (response.data.timezone) {
        localStorage.setItem('serverTimezone', response.data.timezone);
        localStorage.setItem('serverTimezoneTime', Date.now().toString());
      }
    } catch (error) {
      // Notifications check error handled
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <div className="navbar-left">
          <h1>🔍 SkyWatch</h1>
          <div className="navbar-links">
            <Link to="/" className="nav-link">Dashboard</Link>
            <Link to="/history" className="nav-link">History</Link>
            <Link to="/sla" className="nav-link">SLA</Link>
            <Link to="/observability" className="nav-link">Observability</Link>
            <Link to="/notifications" className="nav-link">Notifications</Link>
            <Link to="/status" className="nav-link" target="_blank" rel="noreferrer">Status</Link>
            <Link to="/settings" className="nav-link settings-link">
              Settings
              {!notificationsConfigured && <span className="setup-badge">SETUP</span>}
            </Link>
          </div>
        </div>
        {notificationsConfigured && (
          <div className="notifications-pill">
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
          <Route path="/history" element={<History />} />
          <Route path="/sla" element={<SLA />} />
          <Route path="/settings" element={<div className="container"><SettingsWizard /></div>} />
          <Route path="/status" element={<Status />} />
          <Route path="/observability" element={<Observability />} />
          <Route path="/notifications" element={<Notifications />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
