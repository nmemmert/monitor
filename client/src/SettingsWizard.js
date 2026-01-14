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
    timezone: 'UTC',
    retention_days: 7,
    auto_cleanup_enabled: false,
    consecutive_failures: 3,
    grace_period: 300,
    downtime_threshold: 600,
    alert_retry_count: 3,
    alert_retry_delay: 60,
    fallback_webhook: '',
    global_quiet_hours_start: '',
    global_quiet_hours_end: '',
    escalation_hours: 4,
    default_sort: 'name',
    items_per_page: 20,
    refresh_interval: 5000,
    incident_failure_threshold: 10,
  });

  const [testResult, setTestResult] = useState(null);
  const [savingSection, setSavingSection] = useState(null); // Track which section is saving
  const [testing, setTesting] = useState(false);
  const [savedMessage, setSavedMessage] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      setSettings(response.data);
    } catch (error) {
      // Settings load error handled
    }
  };

  // Save specific section without requiring all settings
  const handleSaveSection = async (sectionName, sectionData) => {
    setSavingSection(sectionName);
    setSavedMessage(null);
    try {
      await axios.post('/api/settings', sectionData);
      setSavedMessage({ section: sectionName, success: true });
      // Clear message after 3 seconds
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (error) {
      setSavedMessage({ section: sectionName, success: false, error: error.response?.data?.error || 'Failed to save' });
      setTimeout(() => setSavedMessage(null), 5000);
    } finally {
      setSavingSection(null);
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
    { name: 'iCloud', host: 'smtp.mail.me.com', port: 587 },
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

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={handleTestEmail}
                disabled={testing || !settings.email_user || !settings.email_pass}
              >
                {testing ? 'Sending...' : '📨 Send Test Email'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleSaveSection('Email', {
                  email_enabled: settings.email_enabled,
                  email_host: settings.email_host,
                  email_port: settings.email_port,
                  email_user: settings.email_user,
                  email_pass: settings.email_pass,
                  email_from: settings.email_from,
                  email_to: settings.email_to,
                })}
                disabled={savingSection === 'Email'}
              >
                {savingSection === 'Email' ? 'Saving...' : '💾 Save Email Settings'}
              </button>
            </div>
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

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={handleTestWebhook}
                disabled={testing || !settings.webhook_url}
              >
                {testing ? 'Sending...' : '🔔 Send Test Webhook'}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleSaveSection('Webhook', {
                  webhook_enabled: settings.webhook_enabled,
                  webhook_url: settings.webhook_url,
                })}
                disabled={savingSection === 'Webhook'}
              >
                {savingSection === 'Webhook' ? 'Saving...' : '💾 Save Webhook Settings'}
              </button>
            </div>
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

          <div className="form-row">
            <div className="form-group">
              <label>Global Data Retention (days)</label>
              <input
                type="number"
                value={settings.retention_days}
                onChange={(e) => setSettings({ ...settings, retention_days: parseInt(e.target.value) })}
                min="1"
                max="365"
              />
              <small>Default retention period for all monitors (1-365 days). Individual monitors can override this.</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Timezone</label>
              <select
                value={settings.timezone}
                onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              >
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="America/Chicago">America/Chicago (CST)</option>
                <option value="America/Denver">America/Denver (MST)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="Europe/Paris">Europe/Paris (CET)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEDT)</option>
                <option value="Australia/Melbourne">Australia/Melbourne (AEDT)</option>
              </select>
              <small>Timezone for timestamps and alerts</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Consecutive Failures Threshold</label>
              <input
                type="number"
                value={settings.consecutive_failures || 3}
                onChange={(e) => setSettings({ ...settings, consecutive_failures: parseInt(e.target.value) })}
                min="1"
                max="100"
              />
              <small>Number of consecutive failures before triggering an alert (default: 3)</small>
            </div>

            <div className="form-group">
              <label>Incident Failure Threshold</label>
              <input
                type="number"
                value={settings.incident_failure_threshold || 10}
                onChange={(e) => setSettings({ ...settings, incident_failure_threshold: parseInt(e.target.value) })}
                min="1"
                max="100"
              />
              <small>Number of failures before creating an incident (default: 10)</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Grace Period (seconds)</label>
              <input
                type="number"
                value={settings.grace_period || 300}
                onChange={(e) => setSettings({ ...settings, grace_period: parseInt(e.target.value) })}
                min="0"
                step="60"
              />
              <small>Wait time before alerting after first failure (default: 300s = 5 minutes)</small>
            </div>

            <div className="form-group">
              <label>Downtime Threshold (seconds)</label>
              <input
                type="number"
                value={settings.downtime_threshold || 600}
                onChange={(e) => setSettings({ ...settings, downtime_threshold: parseInt(e.target.value) })}
                min="0"
                step="60"
              />
              <small>Minimum downtime before creating incident (default: 600s = 10 minutes)</small>
            </div>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => handleSaveSection('Monitoring', {
              check_interval: settings.check_interval,
              timeout: settings.timeout,
              timezone: settings.timezone,
              retention_days: settings.retention_days,
              consecutive_failures: settings.consecutive_failures,
              grace_period: settings.grace_period,
              downtime_threshold: settings.downtime_threshold,
              incident_failure_threshold: settings.incident_failure_threshold,
            })}
            disabled={savingSection === 'Monitoring'}
          >
            {savingSection === 'Monitoring' ? 'Saving...' : '💾 Save Monitoring Settings'}
          </button>
        </div>
      </div>

      {/* Alert Settings */}
      <div className="settings-section">
        <h3>🔔 Alert Settings</h3>
        <div className="settings-form">
          <div className="form-row">
            <div className="form-group">
              <label>Alert Retry Count</label>
              <input
                type="number"
                value={settings.alert_retry_count || 3}
                onChange={(e) => setSettings({ ...settings, alert_retry_count: parseInt(e.target.value) })}
                min="0"
                max="10"
              />
              <small>Number of times to retry sending alert if it fails (default: 3)</small>
            </div>

            <div className="form-group">
              <label>Alert Retry Delay (seconds)</label>
              <input
                type="number"
                value={settings.alert_retry_delay || 60}
                onChange={(e) => setSettings({ ...settings, alert_retry_delay: parseInt(e.target.value) })}
                min="0"
                step="30"
              />
              <small>Wait time between alert retries (default: 60s)</small>
            </div>
          </div>

          <div className="form-group">
            <label>Fallback Webhook URL (optional)</label>
            <input
              type="url"
              value={settings.fallback_webhook || ''}
              onChange={(e) => setSettings({ ...settings, fallback_webhook: e.target.value })}
              placeholder="https://backup-webhook.example.com"
            />
            <small>Backup webhook to use if primary alert methods fail</small>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Global Quiet Hours Start</label>
              <input
                type="time"
                value={settings.global_quiet_hours_start || ''}
                onChange={(e) => setSettings({ ...settings, global_quiet_hours_start: e.target.value })}
              />
              <small>Suppress non-critical alerts starting at this time</small>
            </div>

            <div className="form-group">
              <label>Global Quiet Hours End</label>
              <input
                type="time"
                value={settings.global_quiet_hours_end || ''}
                onChange={(e) => setSettings({ ...settings, global_quiet_hours_end: e.target.value })}
              />
              <small>Resume normal alerting at this time</small>
            </div>
          </div>

          <div className="form-group">
            <label>Escalation Hours</label>
            <input
              type="number"
              value={settings.escalation_hours || 4}
              onChange={(e) => setSettings({ ...settings, escalation_hours: parseInt(e.target.value) })}
              min="1"
              max="48"
            />
            <small>Hours after which unresolved incidents are escalated (default: 4)</small>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => handleSaveSection('Alerts', {
              alert_retry_count: settings.alert_retry_count,
              alert_retry_delay: settings.alert_retry_delay,
              fallback_webhook: settings.fallback_webhook,
              global_quiet_hours_start: settings.global_quiet_hours_start,
              global_quiet_hours_end: settings.global_quiet_hours_end,
              escalation_hours: settings.escalation_hours,
            })}
            disabled={savingSection === 'Alerts'}
          >
            {savingSection === 'Alerts' ? 'Saving...' : '💾 Save Alert Settings'}
          </button>
        </div>
      </div>

      {/* Dashboard Settings */}
      <div className="settings-section">
        <h3>📊 Dashboard Settings</h3>
        <div className="settings-form">
          <div className="form-row">
            <div className="form-group">
              <label>Default Sort Order</label>
              <select
                value={settings.default_sort || 'name'}
                onChange={(e) => setSettings({ ...settings, default_sort: e.target.value })}
              >
                <option value="name">Name</option>
                <option value="status">Status</option>
                <option value="created_at">Created Date</option>
                <option value="group">Group</option>
              </select>
              <small>Default sorting for resources list</small>
            </div>

            <div className="form-group">
              <label>Items Per Page</label>
              <input
                type="number"
                value={settings.items_per_page || 20}
                onChange={(e) => setSettings({ ...settings, items_per_page: parseInt(e.target.value) })}
                min="10"
                max="100"
                step="10"
              />
              <small>Number of resources to display per page</small>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Dashboard Refresh Interval (ms)</label>
              <input
                type="number"
                value={settings.refresh_interval || 5000}
                onChange={(e) => setSettings({ ...settings, refresh_interval: parseInt(e.target.value) })}
                min="1000"
                step="1000"
              />
              <small>How often to refresh dashboard data (default: 5000ms = 5 seconds)</small>
            </div>
          </div>

          <div className="form-group">
            <label className="toggle-switch-row">
              <span>Auto Cleanup Enabled</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={settings.auto_cleanup_enabled || false}
                  onChange={(e) => setSettings({ ...settings, auto_cleanup_enabled: e.target.checked })}
                />
                <span className="toggle-slider"></span>
              </label>
            </label>
            <small>Automatically archive old check data based on retention period</small>
          </div>

          <button
            className="btn btn-primary"
            onClick={() => handleSaveSection('Dashboard', {
              default_sort: settings.default_sort,
              items_per_page: settings.items_per_page,
              refresh_interval: settings.refresh_interval,
              auto_cleanup_enabled: settings.auto_cleanup_enabled,
            })}
            disabled={savingSection === 'Dashboard'}
          >
            {savingSection === 'Dashboard' ? 'Saving...' : '💾 Save Dashboard Settings'}
          </button>
        </div>
      </div>

      {/* Status Messages */}
      {savedMessage && (
        <div className={`save-status ${savedMessage.success ? 'success' : 'error'}`}>
          <strong>{savedMessage.success ? '✅ Success!' : '❌ Error:'}</strong>
          <p>{savedMessage.success ? `${savedMessage.section} settings saved!` : savedMessage.error}</p>
        </div>
      )}
    </div>
  );
}

export default SettingsWizard;
