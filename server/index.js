const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

const db = require('./database');
const scheduler = require('./scheduler');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');
const cache = require('./cache');

const app = express();
const PORT = process.env.PORT || 3001;

// WebSocket clients
const wsClients = new Set();

// Helper to get timezone offset for SQL queries
function getTimezoneOffset() {
  const tz = process.env.TIMEZONE || 'UTC';
  if (tz === 'UTC') return '0 hours';
  
  // Use Intl to get the actual offset
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const values = {};
  parts.forEach(({ type, value }) => { values[type] = value; });
  
  // Create a date string in the target timezone and parse it
  const tzDateStr = `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
  const tzDate = new Date(tzDateStr); // Parsed as local browser time (wrong - just for comparison)
  
  // Better approach: get offset by comparing UTC formatted time with TZ formatted time
  const utcFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  const utcTime = utcFormatter.format(now);
  const tzTime = tzFormatter.format(now);
  
  const utcHour = parseInt(utcTime.split(':')[0]);
  const tzHour = parseInt(tzTime.split(':')[0]);
  
  // Calculate the offset
  let offsetHours = tzHour - utcHour;
  if (offsetHours > 12) offsetHours -= 24;
  if (offsetHours < -12) offsetHours += 24;
  
  // SQL datetime() function: we need the OPPOSITE sign
  // If local is 5 hours behind UTC, we need to ADD 5 hours to go backwards (counterintuitive but correct for SQLite)
  const sqlOffset = -offsetHours;
  const result = sqlOffset > 0 ? `+${sqlOffset} hours` : `${sqlOffset} hours`;
  return result;
}

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
  const { name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to, maintenance_mode } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO resources (name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to, maintenance_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      sla_target || 99.9,
      email_to || null,
      maintenance_mode ? 1 : 0
    );

    // Invalidate related cache entries
    cache.invalidatePattern('history:');
    cache.invalidatePattern('sla:');

    res.json({ id: result.lastInsertRowid, message: 'Resource created' });
  } catch (err) {
    console.error('[API] Error creating resource:', err.message);
    // Helpful hint if migration missing
    const hint = err.message.includes('no column named maintenance_mode')
      ? 'Database schema missing maintenance_mode. Restart server to run migrations.'
      : undefined;
    res.status(500).json({ error: 'Failed to create resource', details: err.message, hint });
  }
});

// Update resource
app.put('/api/resources/:id', (req, res) => {
  const { name, url, type, check_interval, timeout, enabled, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to, maintenance_mode } = req.body;

  const stmt = db.prepare(`
    UPDATE resources 
    SET name = ?, url = ?, type = ?, check_interval = ?, timeout = ?, enabled = ?, group_id = ?, http_keyword = ?, http_headers = ?, quiet_hours_start = ?, quiet_hours_end = ?, cert_expiry_days = ?, sla_target = ?, email_to = ?, maintenance_mode = ?
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
    email_to || null,
    maintenance_mode ? 1 : 0,
    req.params.id
  );

  // Invalidate related cache entries
  cache.invalidatePattern('history:');
  cache.invalidatePattern('sla:');

  res.json({ message: 'Resource updated' });
});

// Move a resource to a different group
app.patch('/api/resources/:id/group', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { group_id } = req.body;
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid resource id' });
    }
    if (group_id === undefined || group_id === null || group_id === '') {
      return res.status(400).json({ error: 'group_id is required' });
    }
    const gid = parseInt(group_id, 10);
    if (!Number.isInteger(gid)) {
      return res.status(400).json({ error: 'Invalid group_id' });
    }

    const stmt = db.prepare('UPDATE resources SET group_id = ? WHERE id = ?');
    const info = stmt.run(gid, id);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Invalidate caches and broadcast update
    cache.invalidatePattern('history:');
    cache.invalidatePattern('sla:');
    if (global.broadcastDashboardUpdate) {
      try { global.broadcastDashboardUpdate(); } catch {}
    }

    const updated = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update group', details: String(err) });
  }
});

// Delete resource
app.delete('/api/resources/:id', (req, res) => {
  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);
  
  // Invalidate related cache entries
  cache.invalidatePattern('history:');
  cache.invalidatePattern('sla:');
  
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
      SELECT response_time, status, REPLACE(checked_at, ' ', 'T') || 'Z' as checked_at
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
      check_interval: resource.check_interval,
      timeout: resource.timeout,
      http_keyword: resource.http_keyword,
      http_headers: resource.http_headers,
      quiet_hours_start: resource.quiet_hours_start,
      quiet_hours_end: resource.quiet_hours_end,
      cert_expiry_days: resource.cert_expiry_days,
      sla_target: resource.sla_target,
      email_to: resource.email_to,
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
    timezone: process.env.TIMEZONE || 'UTC',
    // Data retention settings
    retention_days: parseInt(process.env.RETENTION_DAYS) || 7,
    auto_cleanup_enabled: process.env.AUTO_CLEANUP_ENABLED === 'true',
    // Incident thresholds
    consecutive_failures: parseInt(process.env.CONSECUTIVE_FAILURES) || 3,
    grace_period: parseInt(process.env.GRACE_PERIOD) || 300,
    downtime_threshold: parseInt(process.env.DOWNTIME_THRESHOLD) || 600,
    // Alert retry logic
    alert_retry_count: parseInt(process.env.ALERT_RETRY_COUNT) || 3,
    alert_retry_delay: parseInt(process.env.ALERT_RETRY_DELAY) || 60,
    fallback_webhook: process.env.FALLBACK_WEBHOOK || '',
    // Alert scheduling
    global_quiet_hours_start: process.env.GLOBAL_QUIET_HOURS_START || '',
    global_quiet_hours_end: process.env.GLOBAL_QUIET_HOURS_END || '',
    escalation_hours: parseInt(process.env.ESCALATION_HOURS) || 4,
    // Dashboard customization
    default_sort: process.env.DEFAULT_SORT || 'name',
    items_per_page: parseInt(process.env.ITEMS_PER_PAGE) || 20,
    refresh_interval: parseInt(process.env.REFRESH_INTERVAL) || 5000,
    theme: process.env.THEME || 'light',
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
    timezone,
    retention_days,
    auto_cleanup_enabled,
    consecutive_failures,
    grace_period,
    downtime_threshold,
    alert_retry_count,
    alert_retry_delay,
    fallback_webhook,
    global_quiet_hours_start,
    global_quiet_hours_end,
    escalation_hours,
    default_sort,
    items_per_page,
    refresh_interval,
    theme,
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
TIMEZONE=${timezone || 'UTC'}
RETENTION_DAYS=${retention_days || 7}
AUTO_CLEANUP_ENABLED=${auto_cleanup_enabled}
CONSECUTIVE_FAILURES=${consecutive_failures || 3}
GRACE_PERIOD=${grace_period || 300}
DOWNTIME_THRESHOLD=${downtime_threshold || 600}
ALERT_RETRY_COUNT=${alert_retry_count || 3}
ALERT_RETRY_DELAY=${alert_retry_delay || 60}
FALLBACK_WEBHOOK=${fallback_webhook || ''}
GLOBAL_QUIET_HOURS_START=${global_quiet_hours_start || ''}
GLOBAL_QUIET_HOURS_END=${global_quiet_hours_end || ''}
ESCALATION_HOURS=${escalation_hours || 4}
DEFAULT_SORT=${default_sort || 'name'}
ITEMS_PER_PAGE=${items_per_page || 20}
REFRESH_INTERVAL=${refresh_interval || 5000}
THEME=${theme || 'light'}
`;

  try {
    fs.writeFileSync(envPath, envContent);

    // Keep runtime config in sync without requiring a restart
    process.env.TIMEZONE = timezone || 'UTC';
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
    process.env.RETENTION_DAYS = String(retention_days || 7);
    process.env.AUTO_CLEANUP_ENABLED = String(auto_cleanup_enabled);
    process.env.CONSECUTIVE_FAILURES = String(consecutive_failures || 3);
    process.env.GRACE_PERIOD = String(grace_period || 300);
    process.env.DOWNTIME_THRESHOLD = String(downtime_threshold || 600);
    process.env.ALERT_RETRY_COUNT = String(alert_retry_count || 3);
    process.env.ALERT_RETRY_DELAY = String(alert_retry_delay || 60);
    process.env.FALLBACK_WEBHOOK = fallback_webhook || '';
    process.env.GLOBAL_QUIET_HOURS_START = global_quiet_hours_start || '';
    process.env.GLOBAL_QUIET_HOURS_END = global_quiet_hours_end || '';
    process.env.ESCALATION_HOURS = String(escalation_hours || 4);
    process.env.DEFAULT_SORT = default_sort || 'name';
    process.env.ITEMS_PER_PAGE = String(items_per_page || 20);
    process.env.REFRESH_INTERVAL = String(refresh_interval || 5000);
    process.env.THEME = theme || 'light';

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

// Get retention settings
app.get('/api/settings/retention', (req, res) => {
  try {
    const setting = db.prepare(`
      SELECT value FROM settings WHERE key = 'retention_days'
    `).get();
    
    res.json({ 
      retention_days: setting ? parseInt(setting.value) : 30 
    });
  } catch (error) {
    console.error('Error getting retention settings:', error);
    res.status(500).json({ error: 'Failed to get retention settings' });
  }
});

// Update retention settings
app.post('/api/settings/retention', (req, res) => {
  const { retention_days } = req.body;
  
  if (!retention_days || retention_days < 1 || retention_days > 365) {
    return res.status(400).json({ error: 'Retention days must be between 1 and 365' });
  }

  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('retention_days', ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(String(retention_days), String(retention_days));
    
    res.json({ message: 'Retention settings updated', retention_days });
  } catch (error) {
    console.error('Error updating retention settings:', error);
    res.status(500).json({ error: 'Failed to update retention settings' });
  }
});

// Get incident failure threshold
app.get('/api/settings/incident-threshold', (req, res) => {
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'incident_failure_threshold'").get();
    res.json({ incident_failure_threshold: parseInt(setting?.value || '10') });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get incident threshold' });
  }
});

// Update incident failure threshold
app.post('/api/settings/incident-threshold', (req, res) => {
  const { incident_failure_threshold } = req.body;
  
  if (!incident_failure_threshold || incident_failure_threshold < 1 || incident_failure_threshold > 100) {
    return res.status(400).json({ error: 'Threshold must be between 1 and 100' });
  }

  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('incident_failure_threshold', ?)
      ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(String(incident_failure_threshold), String(incident_failure_threshold));
    
    res.json({ message: 'Incident threshold updated', incident_failure_threshold });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update incident threshold' });
  }
});

// Get archived checks for a resource
app.get('/api/resources/:id/archived', (req, res) => {
  const { id } = req.params;
  const { days = 30, page = 1, limit = 100 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const pageLimit = Math.min(500, Math.max(10, parseInt(limit)));
  const offset = (pageNum - 1) * pageLimit;

  try {
    const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const countResult = db.prepare(`
      SELECT COUNT(*) as total FROM archived_checks
      WHERE resource_id = ? AND archived_at > datetime('now', ?)
    `).get(id, `-${days} days`);

    const archived = db.prepare(`
      SELECT 
        id,
        status,
        response_time,
        status_code,
        error_message,
        details,
        REPLACE(checked_at, ' ', 'T') || 'Z' as checked_at,
        REPLACE(archived_at, ' ', 'T') || 'Z' as archived_at
      FROM archived_checks
      WHERE resource_id = ? AND archived_at > datetime('now', ?)
      ORDER BY checked_at DESC
      LIMIT ? OFFSET ?
    `).all(id, `-${days} days`, pageLimit, offset);

    res.json({
      archived,
      pagination: {
        page: pageNum,
        limit: pageLimit,
        total: countResult.total,
        totalPages: Math.ceil(countResult.total / pageLimit),
      },
    });
  } catch (error) {
    console.error('Error fetching archived checks:', error);
    res.status(500).json({ error: 'Failed to fetch archived checks' });
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
      REPLACE(checked_at, ' ', 'T') || 'Z' as checked_at
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

// Paginated checks with filters
app.get('/api/resources/:id/checks', (req, res) => {
  const resourceId = Number(req.params.id);
  const {
    limit = 50,
    offset = 0,
    status,
    from,
    to,
    sort = 'desc',
  } = req.query;

  try {
    const checks = monitorService.getChecks(resourceId, {
      limit: Math.min(Number(limit), 200),
      offset: Number(offset),
      status,
      from,
      to,
      sort,
    });
    res.json({ checks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Incidents timeline
app.get('/api/resources/:id/incidents', (req, res) => {
  const resourceId = Number(req.params.id);
  const {
    limit = 50,
    offset = 0,
    status = 'all',
    from,
    to,
    sort = 'desc',
  } = req.query;

  try {
    const incidents = monitorService.getIncidents(resourceId, {
      limit: Math.min(Number(limit), 200),
      offset: Number(offset),
      status,
      from,
      to,
      sort,
    });
    res.json({ incidents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SLA/SLO summary for a resource
app.get('/api/resources/:id/sla', (req, res) => {
  const resourceId = Number(req.params.id);
  const hours = req.query.hours ? Number(req.query.hours) : 24;

  try {
    const summary = monitorService.getSlaSummary(resourceId, hours);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get trends data (week-over-week comparison)
app.get('/api/resources/:id/trends', (req, res) => {
  const { id } = req.params;
  const { days = 7 } = req.query;

  try {
    // Get current period checks
    const currentChecks = db.prepare(`
      SELECT 
        AVG(response_time) as avg_response_time,
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as successful_checks,
        date(checked_at) as check_date
      FROM checks
      WHERE resource_id = ? AND checked_at > datetime('now', ?)
      GROUP BY date(checked_at)
      ORDER BY check_date ASC
    `).all(id, `-${days} days`);

    // Get previous period checks (for comparison)
    const previousChecks = db.prepare(`
      SELECT 
        AVG(response_time) as avg_response_time,
        COUNT(*) as total_checks,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as successful_checks,
        date(checked_at) as check_date
      FROM checks
      WHERE resource_id = ? AND checked_at BETWEEN datetime('now', ?) AND datetime('now', ?)
      GROUP BY date(checked_at)
      ORDER BY check_date ASC
    `).all(id, `-${days * 2} days`, `-${days} days`);

    // Calculate summary statistics
    const currentAvg = currentChecks.length > 0
      ? currentChecks.reduce((sum, c) => sum + (c.avg_response_time || 0), 0) / currentChecks.length
      : 0;

    const previousAvg = previousChecks.length > 0
      ? previousChecks.reduce((sum, c) => sum + (c.avg_response_time || 0), 0) / previousChecks.length
      : 0;

    const currentUptime = currentChecks.length > 0
      ? (currentChecks.reduce((sum, c) => sum + c.successful_checks, 0) / currentChecks.reduce((sum, c) => sum + c.total_checks, 0)) * 100
      : 0;

    const previousUptime = previousChecks.length > 0
      ? (previousChecks.reduce((sum, c) => sum + c.successful_checks, 0) / previousChecks.reduce((sum, c) => sum + c.total_checks, 0)) * 100
      : 0;

    res.json({
      current: {
        data: currentChecks,
        avg_response_time: Math.round(currentAvg),
        uptime: currentUptime.toFixed(2)
      },
      previous: {
        data: previousChecks,
        avg_response_time: Math.round(previousAvg),
        uptime: previousUptime.toFixed(2)
      },
      comparison: {
        response_time_change: previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg * 100).toFixed(1) : 0,
        uptime_change: (currentUptime - previousUptime).toFixed(2)
      }
    });
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// Get all resources' check history for dashboard (optimized with aggregation)
app.get('/api/history/overview', (req, res) => {
  const { days = 7, page = 1, page: pageParam, averaged = 'false' } = req.query;
  // Resource pagination (number of resources per page)
  const pageLimit = parseInt(req.query.limit || 10);
  const currentPage = Math.max(1, parseInt(pageParam || page || 1));
  const offset = (currentPage - 1) * pageLimit;

  // Create cache key based on query parameters
  const cacheKey = `history:days=${days}:page=${currentPage}:limit=${pageLimit}:averaged=${averaged}`;
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return res.json(cachedResult);
  }

  // Get total count of enabled resources
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM resources WHERE enabled = 1').get();
  const total = totalCount.count;

  // Get paginated resources
  const resources = db.prepare('SELECT * FROM resources WHERE enabled = 1 ORDER BY name LIMIT ? OFFSET ?')
    .all(pageLimit, offset);
  
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

    let recentChecks = [];
    const isAveraged = String(averaged).toLowerCase() === 'true';
    
    if (isAveraged) {
      // Compute interval hours for bucketing (1h for 7 days, 3h for 14, 6h for 30+)
      const intervalHours = days <= 7 ? 1 : days <= 14 ? 3 : 6;
      
      // Use a reliable bucketing approach with Julian Day Numbers
      // Convert to julian day, multiply by 24 for hours, divide by intervalHours and round
      const bucketExpr = `ROUND((julianday(checked_at) * 24) / ${intervalHours}) * ${intervalHours} / 24`;
      
      recentChecks = db.prepare(`
        SELECT 
          REPLACE(datetime(${bucketExpr}), ' ', 'T') || 'Z' AS checked_at,
          AVG(CASE WHEN status='up' THEN response_time ELSE NULL END) AS avg_up_response,
          SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up_count,
          COUNT(*) AS total_count
        FROM checks
        WHERE resource_id = ? AND checked_at > datetime('now', ?)
        GROUP BY ${bucketExpr}
        ORDER BY checked_at ASC
      `).all(resource.id, `-${days} days`).map(row => ({
        status: row.up_count >= Math.ceil(row.total_count/2) ? 'up' : 'down',
        response_time: Math.round(row.avg_up_response || 0),
        checked_at: row.checked_at,
      }));
    } else {
      // Non-averaged: filter to window but cap to last 600 checks
      recentChecks = db.prepare(`
        SELECT status, response_time, REPLACE(checked_at, ' ', 'T') || 'Z' as checked_at
        FROM checks
        WHERE resource_id = ? AND checked_at > datetime('now', ?)
        ORDER BY checked_at DESC
        LIMIT 600
      `).all(resource.id, `-${days} days`).reverse();
    }

    return {
      id: resource.id,
      name: resource.name,
      type: resource.type,
      checks: recentChecks, // Already chronological
      uptime: uptime.toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(0),
    };
  });

  const result = { resources: overview, total, page: currentPage, limit: pageLimit };
  
  // Cache result for 2 minutes (120 seconds)
  cache.set(cacheKey, result, 120);
  
  res.json(result);
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
  const { days = 30, page = 1, limit = 10 } = req.query;
  const pageLimit = parseInt(limit);
  const currentPage = Math.max(1, parseInt(page));
  const offset = (currentPage - 1) * pageLimit;

  // Create cache key - ensure days is treated as a number
  const daysNum = parseInt(days);
  const retentionDays = parseInt(process.env.RETENTION_DAYS) || 7;
  const effectiveDays = Math.min(daysNum, retentionDays);
  const limitedByRetention = effectiveDays < daysNum;
  const cacheKey = `sla:days=${daysNum}:eff=${effectiveDays}:page=${currentPage}:limit=${pageLimit}`;
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    return res.json(cachedResult);
  }

  // Get total count
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM resources WHERE enabled = 1').get();
  const total = totalCount.count;

  // Get paginated resources
  const resources = db.prepare('SELECT * FROM resources WHERE enabled = 1 ORDER BY name LIMIT ? OFFSET ?')
    .all(pageLimit, offset);
  
  const slaData = resources.map(resource => {
    const checks = db.prepare(`
      SELECT status 
      FROM checks 
      WHERE resource_id = ? AND checked_at > datetime('now', ?)
      `).all(resource.id, `-${effectiveDays} days`);

    const upCount = checks.filter(c => c.status === 'up').length;
    const actualUptime = checks.length > 0 ? (upCount / checks.length * 100) : 0;
    const target = resource.sla_target || 99.9;
    const meetsTarget = actualUptime >= target;

    const incidents = db.prepare(`
      SELECT COUNT(*) as count, 
             SUM(julianday(COALESCE(resolved_at, datetime('now'))) - julianday(started_at)) * 24 * 60 as downtime_minutes
      FROM incidents
      WHERE resource_id = ? AND started_at > datetime('now', ?)
      `).get(resource.id, `-${effectiveDays} days`);

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

  const result = { resources: slaData, total, page: currentPage, limit: pageLimit, effective_days: effectiveDays, limited_by_retention: limitedByRetention };
  
  // Cache result for 3 minutes (180 seconds)
  cache.set(cacheKey, result, 180);
  
  res.json(result);
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
      subject: 'Test Email from SkyWatch',
      text: `This is a test email from your SkyWatch monitoring system.\n\nTime: ${new Date().toLocaleString()}\n\nIf you received this, your email notifications are working correctly!`,
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
      message: 'This is a test webhook from SkyWatch',
      timestamp: new Date().toISOString(),
    });

    res.json({ message: 'Test webhook sent successfully!' });
  } catch (error) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint for debugging
app.post('/api/cache/clear', (req, res) => {
  cache.clear();
  console.log('Cache cleared at', new Date().toISOString());
  res.json({ message: 'Cache cleared successfully' });
});

// Debug endpoint to check timezone offset
app.get('/api/debug/timezone', (req, res) => {
  const offset = getTimezoneOffset();
  const now = new Date();
  const tz = process.env.TIMEZONE || 'UTC';
  
  // Also show what the formatted times are
  const utcFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  
  const tzFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  
  res.json({
    timezone: tz,
    offset: offset,
    utcTime: utcFormatter.format(now),
    localTime: tzFormatter.format(now),
    serverTime: now.toISOString()
  });
});

// Get maintenance windows for a resource
app.get('/api/resources/:id/maintenance-windows', (req, res) => {
  const { id } = req.params;
  
  try {
    const windows = db.prepare(`
      SELECT 
        id,
        resource_id,
        REPLACE(start_time, ' ', 'T') || 'Z' as start_time,
        REPLACE(end_time, ' ', 'T') || 'Z' as end_time,
        reason,
        REPLACE(created_at, ' ', 'T') || 'Z' as created_at
      FROM maintenance_windows
      WHERE resource_id = ?
      ORDER BY start_time DESC
    `).all(id);
    
    res.json({ windows });
  } catch (error) {
    console.error('Error fetching maintenance windows:', error);
    res.status(500).json({ error: 'Failed to fetch maintenance windows' });
  }
});

// Create maintenance window
app.post('/api/resources/:id/maintenance-windows', (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, reason } = req.body;
  
  if (!start_time || !end_time) {
    return res.status(400).json({ error: 'start_time and end_time are required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO maintenance_windows (resource_id, start_time, end_time, reason)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(id, start_time, end_time, reason || '');
    
    res.json({ 
      id: result.lastInsertRowid, 
      message: 'Maintenance window created' 
    });
  } catch (error) {
    console.error('Error creating maintenance window:', error);
    res.status(500).json({ error: 'Failed to create maintenance window' });
  }
});

// Delete maintenance window
app.delete('/api/maintenance-windows/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    db.prepare(`DELETE FROM maintenance_windows WHERE id = ?`).run(id);
    res.json({ message: 'Maintenance window deleted' });
  } catch (error) {
    console.error('Error deleting maintenance window:', error);
    res.status(500).json({ error: 'Failed to delete maintenance window' });
  }
});

// Check if resource is in maintenance window
app.get('/api/resources/:id/in-maintenance', (req, res) => {
  const { id } = req.params;
  
  try {
    const now = new Date().toISOString().split('.')[0];
    const window = db.prepare(`
      SELECT id, reason FROM maintenance_windows
      WHERE resource_id = ? AND start_time <= ? AND end_time > ?
      LIMIT 1
    `).get(id, now, now);
    
    res.json({ 
      in_maintenance: !!window,
      reason: window?.reason || null 
    });
  } catch (error) {
    console.error('Error checking maintenance status:', error);
    res.status(500).json({ error: 'Failed to check maintenance status' });
  }
});

// Calculate and update response time baseline
app.post('/api/resources/:id/calculate-baseline', (req, res) => {
  const { id } = req.params;
  const { days = 7 } = req.body;

  try {
    const baseline = monitorService.calculateResponseTimeBaseline(id, days);
    
    if (baseline === null) {
      return res.status(400).json({ error: 'Not enough data to calculate baseline' });
    }

    db.prepare(`
      UPDATE resources 
      SET response_time_baseline = ?
      WHERE id = ?
    `).run(baseline, id);

    res.json({ 
      baseline,
      message: `Baseline calculated: ${baseline}ms`
    });
  } catch (error) {
    console.error('Error calculating baseline:', error);
    res.status(500).json({ error: 'Failed to calculate baseline' });
  }
});

// Update alert rules for a resource
app.post('/api/resources/:id/alert-rules', (req, res) => {
  const { id } = req.params;
  const { consecutive_failures_threshold, response_time_threshold } = req.body;

  try {
    db.prepare(`
      UPDATE resources 
      SET consecutive_failures_threshold = ?, response_time_threshold = ?
      WHERE id = ?
    `).run(
      consecutive_failures_threshold || 1,
      response_time_threshold || null,
      id
    );

    res.json({ message: 'Alert rules updated' });
  } catch (error) {
    console.error('Error updating alert rules:', error);
    res.status(500).json({ error: 'Failed to update alert rules' });
  }
});

// Get transaction steps for a resource
app.get('/api/resources/:id/transaction-steps', (req, res) => {
  const { id } = req.params;

  try {
    const steps = db.prepare(`
      SELECT * FROM transaction_checks
      WHERE resource_id = ?
      ORDER BY step_order ASC
    `).all(id);

    res.json({ steps });
  } catch (error) {
    console.error('Error fetching transaction steps:', error);
    res.status(500).json({ error: 'Failed to fetch transaction steps' });
  }
});

// Create or update transaction step
app.post('/api/resources/:id/transaction-steps', (req, res) => {
  const { id } = req.params;
  const { step_order, url, method, headers, body, expected_status, keyword } = req.body;

  if (!step_order || !url) {
    return res.status(400).json({ error: 'step_order and url are required' });
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO transaction_checks (resource_id, step_order, url, method, headers, body, expected_status, keyword)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      id,
      step_order,
      url,
      method || 'GET',
      headers || null,
      body || null,
      expected_status || 200,
      keyword || null
    );

    res.json({ id: result.lastInsertRowid, message: 'Transaction step created' });
  } catch (error) {
    console.error('Error creating transaction step:', error);
    res.status(500).json({ error: 'Failed to create transaction step' });
  }
});

// Delete transaction step
app.delete('/api/transaction-steps/:id', (req, res) => {
  const { id } = req.params;

  try {
    db.prepare('DELETE FROM transaction_checks WHERE id = ?').run(id);
    res.json({ message: 'Transaction step deleted' });
  } catch (error) {
    console.error('Error deleting transaction step:', error);
    res.status(500).json({ error: 'Failed to delete transaction step' });
  }
});

// Enable/disable transaction mode for a resource
app.post('/api/resources/:id/toggle-transaction', (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;

  try {
    db.prepare(`
      UPDATE resources SET is_transaction = ? WHERE id = ?
    `).run(enabled ? 1 : 0, id);

    res.json({ message: `Transaction mode ${enabled ? 'enabled' : 'disabled'}` });
  } catch (error) {
    console.error('Error toggling transaction mode:', error);
    res.status(500).json({ error: 'Failed to toggle transaction mode' });
  }
});

// Export resources as CSV
app.get('/api/resources/export', (req, res) => {
  try {
    const resources = db.prepare('SELECT * FROM resources ORDER BY name').all();
    
    if (resources.length === 0) {
      return res.json({ csv: 'name,url,type,check_interval,timeout,sla_target\n' });
    }

    // CSV header
    const headers = ['name', 'url', 'type', 'check_interval', 'timeout', 'sla_target', 'tags', 'group_id', 'email_to'];
    const csvRows = [headers.join(',')];

    // CSV rows
    resources.forEach(resource => {
      const row = [
        `"${(resource.name || '').replace(/"/g, '""')}"`,
        `"${(resource.url || '').replace(/"/g, '""')}"`,
        resource.type || 'http',
        resource.check_interval || 60000,
        resource.timeout || 5000,
        resource.sla_target || 99.9,
        `"${(resource.tags || '').replace(/"/g, '""')}"`,
        resource.group_id || '',
        `"${(resource.email_to || '').replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="resources-export.csv"');
    res.send(csv);
  } catch (error) {
    console.error('Error exporting resources:', error);
    res.status(500).json({ error: 'Failed to export resources' });
  }
});

// Import resources from CSV
app.post('/api/resources/import', express.text({ type: 'text/csv' }), (req, res) => {
  try {
    const csv = req.body;
    const lines = csv.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have header and at least one resource' });
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const required = ['name', 'url'];
    if (!required.every(h => headers.includes(h))) {
      return res.status(400).json({ error: `CSV must include columns: ${required.join(', ')}` });
    }

    const imported = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        // Simple CSV parsing (handles basic quoted fields)
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let j = 0; j < lines[i].length; j++) {
          const char = lines[i][j];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim().replace(/^"|"$/g, ''));

        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });

        if (!row.name || !row.url) {
          errors.push(`Row ${i + 1}: Missing name or URL`);
          continue;
        }

        const stmt = db.prepare(`
          INSERT INTO resources (name, url, type, check_interval, timeout, sla_target, tags, group_id, email_to)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          row.name,
          row.url,
          row.type || 'http',
          parseInt(row.check_interval) || 60000,
          parseInt(row.timeout) || 5000,
          parseFloat(row.sla_target) || 99.9,
          row.tags || '',
          row.group_id ? parseInt(row.group_id) : null,
          row.email_to || ''
        );

        imported.push(row.name);
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    cache.invalidatePattern('history:');
    cache.invalidatePattern('sla:');

    res.json({ imported, errors, count: imported.length });
  } catch (error) {
    console.error('Error importing resources:', error);
    res.status(500).json({ error: 'Failed to import resources' });
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

// WebSocket handler function
function broadcastDashboardUpdate() {
  try {
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
        SELECT response_time, status, REPLACE(checked_at, ' ', 'T') || 'Z' as checked_at
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

    const message = JSON.stringify({
      type: 'dashboard',
      data: { resources: overview, groups }
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        wsClients.delete(client);
      }
    });
  } catch (error) {
    console.error('Error broadcasting dashboard update:', error.message);
  }
}

// Export broadcast function for use in scheduler
global.broadcastDashboardUpdate = broadcastDashboardUpdate;

// Start server with HTTP and WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  wsClients.add(ws);

  // Send initial dashboard data
  broadcastDashboardUpdate();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error.message);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
    wsClients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
  scheduler.start();
});
