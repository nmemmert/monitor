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

// Get all groups
app.get('/api/groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups ORDER BY name').all();
  res.json(groups);
});

// Create group
app.post('/api/groups', (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Group name is required' });
  }
  try {
    const result = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)').run(name, description || '');
    res.json({ id: result.lastInsertRowid, message: 'Group created' });
  } catch (error) {
    res.status(400).json({ error: 'Group name must be unique' });
  }
});

// Delete group
app.delete('/api/groups/:id', (req, res) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ message: 'Group deleted' });
});

// Get all resources
app.get('/api/resources', (req, res) => {
  const resources = db.prepare('SELECT * FROM resources ORDER BY group_id, name').all();
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
  const { name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  const stmt = db.prepare(`
    INSERT INTO resources (name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    name,
    url,
    type || 'http',
    check_interval || 60000,
    timeout || 5000,
    group_id || null,
    http_keyword || null,
    http_headers || null,
    quiet_hours_start || null,
    quiet_hours_end || null,
    cert_expiry_days || 30,
    sla_target || 99.9
  );

  res.json({ id: result.lastInsertRowid, message: 'Resource created' });
});

// Update resource
app.put('/api/resources/:id', (req, res) => {
  const { name, url, type, check_interval, timeout, enabled, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target } = req.body;

  const stmt = db.prepare(`
    UPDATE resources 
    SET name = ?, url = ?, type = ?, check_interval = ?, timeout = ?, enabled = ?, group_id = ?, http_keyword = ?, http_headers = ?, quiet_hours_start = ?, quiet_hours_end = ?, cert_expiry_days = ?, sla_target = ?
    WHERE id = ?
  `);

  stmt.run(
    name, 
    url, 
    type, 
    check_interval, 
    timeout, 
    enabled ? 1 : 0, 
    group_id || null,
    http_keyword || null,
    http_headers || null,
    quiet_hours_start || null,
    quiet_hours_end || null,
    cert_expiry_days || 30,
    sla_target || 99.9,
    req.params.id
  );
  res.json({ message: 'Resource updated' });
});

// Delete resource
app.delete('/api/resources/:id', (req, res) => {
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  res.json({ message: 'Resource deleted' });
});

// Get dashboard overview (grouped)
app.get('/api/dashboard', (req, res) => {
  const resources = db.prepare('SELECT * FROM resources ORDER BY group_id, name').all();
  const groups = db.prepare('SELECT * FROM groups ORDER BY name').all();
  
  const overview = resources.map(resource => {
    const lastCheck = monitorService.getLastCheck(resource.id);
    const stats = monitorService.getResourceStats(resource.id, 24);
    const activeIncident = db.prepare(`
      SELECT * FROM incidents 
      WHERE resource_id = ? AND resolved_at IS NULL
    `).get(resource.id);

    const recentChecks = db.prepare(`
      SELECT response_time, status, checked_at
      FROM checks
      WHERE resource_id = ?
      ORDER BY checked_at DESC
      LIMIT 15
    `).all(resource.id).reverse();

    return {
      id: resource.id,
      name: resource.name,
      url: resource.url,
      type: resource.type,
      group_id: resource.group_id,
      enabled: resource.enabled,
      status: lastCheck?.status || 'unknown',
      uptime: stats.uptime,
      avgResponseTime: stats.avgResponseTime,
      lastCheck: lastCheck?.checked_at,
      hasActiveIncident: !!activeIncident,
      recentChecks,
    };
  });

  res.json({ resources: overview, groups });
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

// Get historical check data for a resource (paginated)
app.get('/api/resources/:id/history', (req, res) => {
  const { id } = req.params;
  const { days = 7, page = 1, limit = 100 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const pageLimit = Math.min(500, Math.max(10, parseInt(limit)));
  const offset = (pageNum - 1) * pageLimit;

  const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
  if (!resource) {
    return res.status(404).json({ error: 'Resource not found' });
  }

  // Get total count
  const countResult = db.prepare(`
    SELECT COUNT(*) as total FROM checks
    WHERE resource_id = ? AND checked_at > datetime('now', ?)
  `).get(id, `-${days} days`);

  const checks = db.prepare(`
    SELECT 
      id,
      status,
      response_time,
      status_code,
      error_message,
      details,
      checked_at
    FROM checks
    WHERE resource_id = ? AND checked_at > datetime('now', ?)
    ORDER BY checked_at DESC
    LIMIT ? OFFSET ?
  `).all(id, `-${days} days`, pageLimit, offset);

  res.json({
    resource,
    checks: checks.reverse(), // Reverse to get ASC order for charting
    pagination: {
      page: pageNum,
      limit: pageLimit,
      total: countResult.total,
      totalPages: Math.ceil(countResult.total / pageLimit),
    },
  });
});

// Get all resources' check history for dashboard (optimized with aggregation)
app.get('/api/history/overview', (req, res) => {
  const { days = 7, limit = 12 } = req.query; // Only return last 12 checks per resource for charting

  const resources = db.prepare('SELECT * FROM resources WHERE enabled = 1 ORDER BY name').all();
  
  const overview = resources.map(resource => {
    // Use aggregation query to get stats without loading all rows
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
        AVG(response_time) as avg_response,
        MIN(response_time) as min_response,
        MAX(response_time) as max_response
      FROM checks
      WHERE resource_id = ? AND checked_at > datetime('now', ?)
    `).get(resource.id, `-${days} days`);

    const uptime = stats.total > 0 ? (stats.up_count / stats.total * 100) : 0;
    const avgResponseTime = stats.avg_response || 0;

    // Only load recent checks for sparklines
    const recentChecks = db.prepare(`
      SELECT 
        status,
        response_time,
        checked_at
      FROM checks
      WHERE resource_id = ? AND checked_at > datetime('now', ?)
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(resource.id, `-${days} days`, parseInt(limit));

    return {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      checks: recentChecks.reverse(), // For charting in chronological order
      uptime: uptime.toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(0),
    };
  });

  res.json(overview);
});

// Acknowledge incident
app.post('/api/incidents/:id/acknowledge', (req, res) => {
  const { id } = req.params;
  const { acknowledged_by } = req.body;

  const stmt = db.prepare(`
    UPDATE incidents 
    SET acknowledged = 1, acknowledged_at = datetime('now'), acknowledged_by = ?
    WHERE id = ? AND resolved_at IS NULL
  `);

  const result = stmt.run(acknowledged_by || 'User', id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Incident not found or already resolved' });
  }

  res.json({ message: 'Incident acknowledged' });
});

// Get SLA report
app.get('/api/sla', (req, res) => {
  const { days = 30 } = req.query;
  
  const resources = db.prepare('SELECT * FROM resources WHERE enabled = 1').all();
  
  const slaData = resources.map(resource => {
    const checks = db.prepare(`
      SELECT status 
      FROM checks 
      WHERE resource_id = ? AND checked_at > datetime('now', ?)
    `).all(resource.id, `-${days} days`);

    const upCount = checks.filter(c => c.status === 'up').length;
    const actualUptime = checks.length > 0 ? (upCount / checks.length * 100) : 0;
    const target = resource.sla_target || 99.9;
    const meetsTarget = actualUptime >= target;

    const incidents = db.prepare(`
      SELECT COUNT(*) as count, 
             SUM(julianday(COALESCE(resolved_at, datetime('now'))) - julianday(started_at)) * 24 * 60 as downtime_minutes
      FROM incidents
      WHERE resource_id = ? AND started_at > datetime('now', ?)
    `).get(resource.id, `-${days} days`);

    return {
      resource_id: resource.id,
      resource_name: resource.name,
      sla_target: target,
      actual_uptime: actualUptime.toFixed(2),
      meets_target: meetsTarget,
      total_checks: checks.length,
      successful_checks: upCount,
      incidents: incidents.count || 0,
      downtime_minutes: Math.round(incidents.downtime_minutes || 0),
      group_id: resource.group_id,
    };
  });

  res.json(slaData);
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

// Serve React app with proper MIME types
const mimeTypes = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

app.use(express.static(path.join(__dirname, '../client/build'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (mimeTypes[ext]) {
      res.setHeader('Content-Type', mimeTypes[ext]);
    }
  }
}));

// Only serve index.html for non-file routes (no extension)
app.get('*', (req, res, next) => {
  // If the request has a file extension, let static middleware handle it or 404
  if (path.extname(req.path)) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  scheduler.start();
});
