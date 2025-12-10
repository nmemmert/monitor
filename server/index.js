const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const scheduler = require('./scheduler');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API Routes

// Get all resources
app.get('/api/resources', (req, res) => {
  const resources = db.prepare('SELECT * FROM resources ORDER BY name').all();
  res.json(resources);
});

// Get single resource with stats
app.get('/api/resources/:id', (req, res) => {
  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(req.params.id);
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  const stats = monitorService.getResourceStats(resource.id, 24);
  const lastCheck = monitorService.getLastCheck(resource.id);
  const activeIncident = db.prepare(`
    SELECT * FROM incidents 
    WHERE resource_id = ? AND resolved_at IS NULL
  `).get(resource.id);

  res.json({
    ...resource,
    stats,
    lastCheck,
    hasActiveIncident: !!activeIncident,
  });
});

// Create resource
app.post('/api/resources', (req, res) => {
  const { name, url, type, check_interval, timeout } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  const stmt = db.prepare(`
    INSERT INTO resources (name, url, type, check_interval, timeout)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    name,
    url,
    type || 'http',
    check_interval || 60000,
    timeout || 5000
  );

  res.json({ id: result.lastInsertRowid, message: 'Resource created' });
});

// Update resource
app.put('/api/resources/:id', (req, res) => {
  const { name, url, type, check_interval, timeout, enabled } = req.body;

  const stmt = db.prepare(`
    UPDATE resources 
    SET name = ?, url = ?, type = ?, check_interval = ?, timeout = ?, enabled = ?
    WHERE id = ?
  `);

  stmt.run(name, url, type, check_interval, timeout, enabled ? 1 : 0, req.params.id);
  res.json({ message: 'Resource updated' });
});

// Delete resource
app.delete('/api/resources/:id', (req, res) => {
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  res.json({ message: 'Resource deleted' });
});

// Get dashboard overview
app.get('/api/dashboard', (req, res) => {
  const resources = db.prepare('SELECT * FROM resources').all();
  const overview = resources.map(resource => {
    const lastCheck = monitorService.getLastCheck(resource.id);
    const stats = monitorService.getResourceStats(resource.id, 24);
    const activeIncident = db.prepare(`
      SELECT * FROM incidents 
      WHERE resource_id = ? AND resolved_at IS NULL
    `).get(resource.id);

    return {
      id: resource.id,
      name: resource.name,
      url: resource.url,
      enabled: resource.enabled,
      status: lastCheck?.status || 'unknown',
      uptime: stats.uptime,
      avgResponseTime: stats.avgResponseTime,
      lastCheck: lastCheck?.checked_at,
      hasActiveIncident: !!activeIncident,
    };
  });

  res.json(overview);
});

// Get incidents
app.get('/api/incidents', (req, res) => {
  const incidents = db.prepare(`
    SELECT i.*, r.name as resource_name, r.url as resource_url
    FROM incidents i
    JOIN resources r ON i.resource_id = r.id
    ORDER BY i.started_at DESC
    LIMIT 50
  `).all();

  res.json(incidents);
});

// Get settings
app.get('/api/settings', (req, res) => {
  const settings = {
    email_enabled: process.env.EMAIL_ENABLED === 'true',
    email_host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    email_port: parseInt(process.env.EMAIL_PORT) || 587,
    email_user: process.env.EMAIL_USER || '',
    email_pass: '', // Don't send password to client
    email_from: process.env.EMAIL_FROM || '',
    email_to: process.env.EMAIL_TO || '',
    webhook_enabled: process.env.WEBHOOK_ENABLED === 'true',
    webhook_url: process.env.WEBHOOK_URL || '',
    check_interval: parseInt(process.env.CHECK_INTERVAL) || 60000,
    timeout: parseInt(process.env.TIMEOUT) || 5000,
  };
  res.json(settings);
});

// Save settings
app.post('/api/settings', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../.env');
  
  const {
    email_enabled,
    email_host,
    email_port,
    email_user,
    email_pass,
    email_from,
    email_to,
    webhook_enabled,
    webhook_url,
    check_interval,
    timeout,
  } = req.body;

  const envContent = `PORT=${process.env.PORT || 3001}
EMAIL_ENABLED=${email_enabled}
EMAIL_HOST=${email_host}
EMAIL_PORT=${email_port}
EMAIL_USER=${email_user}
EMAIL_PASS=${email_pass || process.env.EMAIL_PASS || ''}
EMAIL_FROM=${email_from}
EMAIL_TO=${email_to}
WEBHOOK_ENABLED=${webhook_enabled}
WEBHOOK_URL=${webhook_url}
CHECK_INTERVAL=${check_interval}
TIMEOUT=${timeout}
`;

  try {
    fs.writeFileSync(envPath, envContent);

    // Keep runtime config in sync without requiring a restart
    process.env.EMAIL_ENABLED = String(email_enabled);
    process.env.EMAIL_HOST = email_host;
    process.env.EMAIL_PORT = String(email_port);
    process.env.EMAIL_USER = email_user;
    process.env.EMAIL_PASS = email_pass || process.env.EMAIL_PASS || '';
    process.env.EMAIL_FROM = email_from;
    process.env.EMAIL_TO = email_to;
    process.env.WEBHOOK_ENABLED = String(webhook_enabled);
    process.env.WEBHOOK_URL = webhook_url;
    process.env.CHECK_INTERVAL = String(check_interval);
    process.env.TIMEOUT = String(timeout);

    notificationService.setConfig({
      email_enabled: email_enabled === true || email_enabled === 'true',
      email_host,
      email_port,
      email_user,
      email_pass: email_pass || process.env.EMAIL_PASS || '',
      email_from,
      email_to,
      webhook_enabled: webhook_enabled === true || webhook_enabled === 'true',
      webhook_url,
    });

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Test email
app.post('/api/test-email', async (req, res) => {
  const nodemailer = require('nodemailer');
  const { email_host, email_port, email_user, email_pass, email_from, email_to } = req.body;

  try {
    const transporter = nodemailer.createTransport({
      host: email_host,
      port: parseInt(email_port),
      secure: false,
      auth: {
        user: email_user,
        pass: email_pass,
      },
    });

    await transporter.sendMail({
      from: email_from,
      to: email_to,
      subject: 'Test Email from Resource Monitor',
      text: `This is a test email from your Resource Monitor system.\n\nTime: ${new Date().toLocaleString()}\n\nIf you received this, your email notifications are working correctly!`,
    });

    res.json({ message: 'Test email sent successfully! Check your inbox.' });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Test webhook
app.post('/api/test-webhook', async (req, res) => {
  const axios = require('axios');
  const { webhook_url } = req.body;

  try {
    await axios.post(webhook_url, {
      resource: 'Test Resource',
      url: 'https://example.com',
      status: 'test',
      message: 'This is a test webhook from Resource Monitor',
      timestamp: new Date().toISOString(),
    });

    res.json({ message: 'Test webhook sent successfully!' });
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve React app in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  scheduler.start();
});
