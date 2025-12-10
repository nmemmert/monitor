import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './SettingsWizard.css';

function SettingsWizard() {
  const [settings, setSettings] = useState({
    email_enabled: false,
    email_host: 'smtp.gmail.com',
    email_port: 587,
    email_user: '',
    email_pass: '',
    email_from: '',
    email_to: '',
    webhook_enabled: false,
    webhook_url: '',
    check_interval: 60000,
    timeout: 5000,
  });

  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await axios.post('/api/settings', settings);
      alert('Settings saved successfully! Changes apply immediately.');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await axios.post('/api/test-email', {
        email_host: settings.email_host,
        email_port: settings.email_port,
        email_user: settings.email_user,
        email_pass: settings.email_pass,
        email_from: settings.email_from,
        email_to: settings.email_to,
      });
      setTestResult({ success: true, message: response.data.message });
    } catch (error) {
      setTestResult({ 
        success: false, 
        message: error.response?.data?.error || 'Failed to send test email' 
      });
    } finally {
      setTesting(false);
    }
  };

  const handleTestWebhook = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await axios.post('/api/test-webhook', {
        webhook_url: settings.webhook_url,
      });
      setTestResult({ success: true, message: response.data.message });
    } catch (error) {
      setTestResult({ 
        success: false, 
        message: error.response?.data?.error || 'Failed to send test webhook' 
      });
    } finally {
      setTesting(false);
    }
  };

  const emailProviders = [
    { name: 'Gmail', host: 'smtp.gmail.com', port: 587 },
    { name: 'Outlook', host: 'smtp-mail.outlook.com', port: 587 },
    { name: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 587 },
    { name: 'Custom', host: '', port: 587 },
  ];

  return (
    <div className="settings-wizard">
      <h2>⚙️ Settings & Notifications</h2>
      <p className="settings-description">
        Configure email and webhook notifications to receive alerts when your resources go offline.
      </p>

      {/* Email Settings */}
      <div className="settings-section">
        <div className="settings-header">
          <h3>📧 Email Notifications</h3>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.email_enabled}
              onChange={(e) => setSettings({ ...settings, email_enabled: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {settings.email_enabled && (
          <div className="settings-form">
            <div className="form-row">
              <div className="form-group">
                <label>Email Provider</label>
                <select
                  value={emailProviders.find(p => p.host === settings.email_host)?.name || 'Custom'}
                  onChange={(e) => {
                    const provider = emailProviders.find(p => p.name === e.target.value);
                    if (provider) {
                      setSettings({
                        ...settings,
                        email_host: provider.host,
                        email_port: provider.port,
                      });
                    }
                  }}
                >
                  {emailProviders.map(p => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>SMTP Host</label>
                <input
                  type="text"
                  value={settings.email_host}
                  onChange={(e) => setSettings({ ...settings, email_host: e.target.value })}
                  placeholder="smtp.gmail.com"
                />
              </div>

              <div className="form-group">
                <label>SMTP Port</label>
                <input
                  type="number"
                  value={settings.email_port}
                  onChange={(e) => setSettings({ ...settings, email_port: parseInt(e.target.value) })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Email Username</label>
                <input
                  type="email"
                  value={settings.email_user}
                  onChange={(e) => setSettings({ ...settings, email_user: e.target.value })}
                  placeholder="your-email@gmail.com"
                />
              </div>

              <div className="form-group">
                <label>Email Password / App Password</label>
                <input
                  type="password"
                  value={settings.email_pass}
                  onChange={(e) => setSettings({ ...settings, email_pass: e.target.value })}
                  placeholder="your-password-or-app-password"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>From Email</label>
                <input
                  type="email"
                  value={settings.email_from}
                  onChange={(e) => setSettings({ ...settings, email_from: e.target.value })}
                  placeholder="alerts@example.com"
                />
              </div>

              <div className="form-group">
                <label>To Email (Alert Recipient)</label>
                <input
                  type="email"
                  value={settings.email_to}
                  onChange={(e) => setSettings({ ...settings, email_to: e.target.value })}
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div className="info-box">
              <strong>💡 Gmail Setup:</strong>
              <ol>
                <li>Enable 2-factor authentication on your Google account</li>
                <li>Generate an App Password at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a></li>
                <li>Use the app password (not your regular password) above</li>
              </ol>
            </div>

            <button
              className="btn btn-secondary"
              onClick={handleTestEmail}
              disabled={testing || !settings.email_user || !settings.email_pass}
            >
              {testing ? 'Sending...' : '📨 Send Test Email'}
            </button>
          </div>
        )}
      </div>

      {/* Webhook Settings */}
      <div className="settings-section">
        <div className="settings-header">
          <h3>🔗 Webhook Notifications</h3>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={settings.webhook_enabled}
              onChange={(e) => setSettings({ ...settings, webhook_enabled: e.target.checked })}
            />
            <span className="toggle-slider"></span>
          </label>
        </div>

        {settings.webhook_enabled && (
          <div className="settings-form">
            <div className="form-group">
              <label>Webhook URL</label>
              <input
                type="url"
                value={settings.webhook_url}
                onChange={(e) => setSettings({ ...settings, webhook_url: e.target.value })}
                placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
              />
              <small>Receives POST requests with incident data when resources go offline/online</small>
            </div>

            <div className="info-box">
              <strong>💡 Webhook Payload Example:</strong>
              <pre>{JSON.stringify({
                resource: "ZimaOS Server",
                url: "https://example.com",
                status: "down",
                message: "Resource is DOWN",
                timestamp: new Date().toISOString()
              }, null, 2)}</pre>
            </div>

            <button
              className="btn btn-secondary"
              onClick={handleTestWebhook}
              disabled={testing || !settings.webhook_url}
            >
              {testing ? 'Sending...' : '🔔 Send Test Webhook'}
            </button>
          </div>
        )}
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
          <strong>{testResult.success ? '✅ Success!' : '❌ Error:'}</strong>
          <p>{testResult.message}</p>
        </div>
      )}

      {/* Monitoring Settings */}
      <div className="settings-section">
        <h3>⏱️ Default Monitoring Settings</h3>
        <div className="settings-form">
          <div className="form-row">
            <div className="form-group">
              <label>Check Interval (milliseconds)</label>
              <input
                type="number"
                value={settings.check_interval}
                onChange={(e) => setSettings({ ...settings, check_interval: parseInt(e.target.value) })}
                min="10000"
                step="1000"
              />
              <small>Default interval between checks (60000ms = 1 minute)</small>
            </div>

            <div className="form-group">
              <label>Request Timeout (milliseconds)</label>
              <input
                type="number"
                value={settings.timeout}
                onChange={(e) => setSettings({ ...settings, timeout: parseInt(e.target.value) })}
                min="1000"
                step="1000"
              />
              <small>How long to wait before considering a request failed</small>
            </div>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="settings-actions">
        <button
          className="btn btn-primary btn-large"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : '💾 Save Settings'}
        </button>
      </div>
    </div>
  );
}

export default SettingsWizard;
