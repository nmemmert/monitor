const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const http = require('http');
const { randomUUID } = require('crypto');
require('dotenv').config();

const db = require('./database');
const scheduler = require('./scheduler');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');
const cache = require('./cache');
const security = require('./securityMiddleware');
const metrics = require('./metrics');
const { discoverNetwork, getLocalSubnets } = require('./networkDiscovery');
const auditLog = require('./auditLog');

// Initialize notifications table if it doesn't exist
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER,
      incident_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'unread',
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_read_status ON notifications(read, created_at DESC);
  `);
} catch (error) {
  console.error('Error initializing notifications table:', error);
}

// One-time: remove stale theme setting from DB (app is always dark mode)
try {
  db.prepare("DELETE FROM settings WHERE key = 'theme'").run();
} catch (_) {}


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

// Build settings object merging DB overrides on top of env vars
function buildSettingsFromDb(dbSettings = {}) {
  return {
    email_enabled: (dbSettings.email_enabled || process.env.EMAIL_ENABLED) === 'true',
    email_host: dbSettings.email_host || process.env.EMAIL_HOST || 'smtp.gmail.com',
    email_port: parseInt(dbSettings.email_port || process.env.EMAIL_PORT) || 587,
    email_user: dbSettings.email_user || process.env.EMAIL_USER || '',
    email_pass: '',
    email_from: dbSettings.email_from || process.env.EMAIL_FROM || '',
    email_to: dbSettings.email_to || process.env.EMAIL_TO || '',
    webhook_enabled: (dbSettings.webhook_enabled || process.env.WEBHOOK_ENABLED) === 'true',
    webhook_url: dbSettings.webhook_url || process.env.WEBHOOK_URL || '',
    check_interval: parseInt(dbSettings.check_interval || process.env.CHECK_INTERVAL) || 60000,
    timeout: parseInt(dbSettings.timeout || process.env.TIMEOUT) || 5000,
    timezone: dbSettings.timezone || process.env.TIMEZONE || 'UTC',
    retention_days: parseInt(dbSettings.retention_days || process.env.RETENTION_DAYS) || 7,
    auto_cleanup_enabled: (dbSettings.auto_cleanup_enabled || process.env.AUTO_CLEANUP_ENABLED) === 'true',
    consecutive_failures: parseInt(dbSettings.consecutive_failures || process.env.CONSECUTIVE_FAILURES) || 3,
    grace_period: parseInt(dbSettings.grace_period || process.env.GRACE_PERIOD) || 300,
    downtime_threshold: parseInt(dbSettings.downtime_threshold || process.env.DOWNTIME_THRESHOLD) || 600,
    alert_retry_count: parseInt(dbSettings.alert_retry_count || process.env.ALERT_RETRY_COUNT) || 3,
    alert_retry_delay: parseInt(dbSettings.alert_retry_delay || process.env.ALERT_RETRY_DELAY) || 60,
    fallback_webhook: dbSettings.fallback_webhook || process.env.FALLBACK_WEBHOOK || '',
    global_quiet_hours_start: dbSettings.global_quiet_hours_start || process.env.GLOBAL_QUIET_HOURS_START || '',
    global_quiet_hours_end: dbSettings.global_quiet_hours_end || process.env.GLOBAL_QUIET_HOURS_END || '',
    escalation_hours: parseInt(dbSettings.escalation_hours || process.env.ESCALATION_HOURS) || 4,
    default_sort: dbSettings.default_sort || process.env.DEFAULT_SORT || 'name',
    items_per_page: parseInt(dbSettings.items_per_page || process.env.ITEMS_PER_PAGE) || 20,
    refresh_interval: parseInt(dbSettings.refresh_interval || process.env.REFRESH_INTERVAL) || 5000,
    theme: 'dark',
    ntfy_enabled: (dbSettings.ntfy_enabled || process.env.NTFY_ENABLED) === 'true',
    ntfy_url: dbSettings.ntfy_url || process.env.NTFY_URL || 'https://ntfy.sh',
    ntfy_topic: dbSettings.ntfy_topic || process.env.NTFY_TOPIC || '',
    incident_failure_threshold: parseInt(dbSettings.incident_failure_threshold || process.env.INCIDENT_FAILURE_THRESHOLD) || 10,
    slow_alert_consecutive: parseInt(dbSettings.slow_alert_consecutive || process.env.SLOW_ALERT_CONSECUTIVE) || 3,
    webhook_template: dbSettings.webhook_template || process.env.WEBHOOK_TEMPLATE || '',
  };
}

// Simple in-memory per-IP rate limiter (no external package needed)
const _rlMap = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rlMap) { if (now - v.start > 60000) _rlMap.delete(k); }
}, 5 * 60 * 1000);
function rateLimit(maxReqs, windowMs = 60000) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    const e = _rlMap.get(key);
    if (!e || now - e.start > windowMs) { _rlMap.set(key, { start: now, count: 1 }); return next(); }
    e.count++;
    if (e.count > maxReqs) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}

// Build dashboard payload (shared between HTTP route and WebSocket broadcast)
function getDashboardPayload() {
  const resources = db.prepare('SELECT * FROM resources ORDER BY group_id, name').all();
  const groups = db.prepare('SELECT * FROM groups ORDER BY name').all();

  const overview = resources.map(resource => {
    const lastCheck = monitorService.getLastCheck(resource.id);
    const stats = monitorService.getResourceStats(resource.id, 24);
    const activeIncident = db.prepare(`
      SELECT * FROM incidents WHERE resource_id = ? AND resolved_at IS NULL
    `).get(resource.id);
    const recentChecks = db.prepare(`
      SELECT response_time, status, REPLACE(checked_at, ' ', 'T') || 'Z' as checked_at
      FROM checks WHERE resource_id = ?
      ORDER BY checked_at DESC LIMIT 15
    `).all(resource.id).reverse();

    // Pull cert expiry from latest TLS check details
    let certDaysRemaining = null;
    if (resource.type === 'tls') {
      const lastTlsCheck = db.prepare(`
        SELECT details FROM checks WHERE resource_id = ? AND details IS NOT NULL ORDER BY checked_at DESC LIMIT 1
      `).get(resource.id);
      if (lastTlsCheck?.details) {
        try {
          const d = JSON.parse(lastTlsCheck.details);
          if (typeof d.days_remaining === 'number') certDaysRemaining = d.days_remaining;
        } catch {}
      }
    }

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
      maintenance_mode: resource.maintenance_mode,
      is_public: resource.is_public !== 0,
      heartbeat_token: resource.heartbeat_token,
      heartbeat_timeout: resource.heartbeat_timeout,
      consecutive_failures_threshold: resource.consecutive_failures_threshold,
      response_time_threshold: resource.response_time_threshold,
      http_method: resource.http_method || 'GET',
      http_body: resource.http_body || null,
      certDaysRemaining,
      status: lastCheck?.status || 'unknown',
      uptime: stats.uptime,
      avgResponseTime: stats.avgResponseTime,
      lastCheck: lastCheck?.checked_at,
      hasActiveIncident: !!activeIncident,
      activeIncidentId: activeIncident?.id || null,
      recentChecks,
    };
  });

  return { resources: overview, groups };
}

// Validate resource body fields (shared between POST and PUT)
function validateResourceBody(body, requireUrl = true) {
  const { name, url, type, check_interval, timeout, sla_target, retention_days } = body;
  const isHeartbeat = (type || 'http') === 'heartbeat';
  if (!name) return 'Name is required';
  if (!isHeartbeat && requireUrl && !url) return 'URL is required';
  if (!isHeartbeat && url) {
    try { new URL(url); } catch (e) { return 'Invalid URL format'; }
  }
  if (check_interval && (isNaN(check_interval) || check_interval < 10000)) return 'Check interval must be at least 10000ms';
  if (timeout && (isNaN(timeout) || timeout < 1000)) return 'Timeout must be at least 1000ms';
  if (sla_target !== undefined && sla_target !== null && (isNaN(sla_target) || sla_target < 0 || sla_target > 100)) return 'SLA target must be between 0 and 100';
  if (retention_days && (isNaN(retention_days) || retention_days < 1 || retention_days > 365)) return 'Retention days must be between 1 and 365';
  return null;
}

app.use(cors());
app.use(express.json());

// Metrics tracking middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  // Capture original res.json and res.send
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  
  const trackRequest = () => {
    const duration = Date.now() - startTime;
    const endpoint = req.route?.path || req.path;
    metrics.trackApiRequest(endpoint, req.method, res.statusCode, duration);
  };
  
  res.json = function(data) {
    trackRequest();
    return originalJson(data);
  };
  
  res.send = function(data) {
    trackRequest();
    return originalSend(data);
  };
  
  next();
});

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
  res.json({ resources });
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
  const { name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to, maintenance_mode, retention_days, is_public, heartbeat_timeout, consecutive_failures_threshold, response_time_threshold, http_method, http_body, tags } = req.body;

  const validationError = validateResourceBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const isHeartbeat = (type || 'http') === 'heartbeat';
    const token = isHeartbeat ? randomUUID() : null;
    const effectiveUrl = isHeartbeat ? `heartbeat://${name}` : url;

    const stmt = db.prepare(`
      INSERT INTO resources (name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to, maintenance_mode, retention_days, is_public, heartbeat_token, heartbeat_timeout, consecutive_failures_threshold, response_time_threshold, http_method, http_body, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      effectiveUrl,
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
      maintenance_mode ? 1 : 0,
      retention_days || null,
      (is_public === false || is_public === 0) ? 0 : 1,
      token,
      heartbeat_timeout || 300000,
      consecutive_failures_threshold || 1,
      response_time_threshold || null,
      http_method || 'GET',
      http_body || null,
      tags || null
    );

    // Invalidate related cache entries
    cache.invalidatePattern('history:');
    cache.invalidatePattern('sla:');

    // Audit log
    auditLog.logResourceChange('create', result.lastInsertRowid, { name, url, type, enabled: true }, 'system', req.ip);

    res.json({ id: result.lastInsertRowid, message: 'Resource created', heartbeat_token: token });
  } catch (err) {
    const hint = err.message.includes('no column named maintenance_mode')
      ? 'Database schema missing maintenance_mode. Restart server to run migrations.'
      : undefined;
    res.status(500).json({ error: 'Failed to create resource', details: err.message, hint });
  }
});

// Update resource
app.put('/api/resources/:id', (req, res) => {
  const { name, url, type, check_interval, timeout, enabled, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to, maintenance_mode, retention_days, is_public, heartbeat_timeout, consecutive_failures_threshold, response_time_threshold, http_method, http_body, tags } = req.body;

  const validationError = validateResourceBody(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const existing = db.prepare('SELECT url, type, heartbeat_token FROM resources WHERE id = ?').get(req.params.id);
  const isHeartbeat = (type || existing?.type || 'http') === 'heartbeat';
  const effectiveUrl = isHeartbeat ? (existing?.url || `heartbeat://${name}`) : url;

  const stmt = db.prepare(`
    UPDATE resources
    SET name = ?, url = ?, type = ?, check_interval = ?, timeout = ?, enabled = ?, group_id = ?, http_keyword = ?, http_headers = ?, quiet_hours_start = ?, quiet_hours_end = ?, cert_expiry_days = ?, sla_target = ?, email_to = ?, maintenance_mode = ?, retention_days = ?, is_public = ?, heartbeat_timeout = ?, consecutive_failures_threshold = ?, response_time_threshold = ?, http_method = ?, http_body = ?, tags = ?
    WHERE id = ?
  `);

  stmt.run(
    name,
    effectiveUrl,
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
    retention_days || null,
    (is_public === false || is_public === 0) ? 0 : 1,
    heartbeat_timeout || 300000,
    consecutive_failures_threshold || 1,
    response_time_threshold || null,
    http_method || 'GET',
    http_body || null,
    tags || null,
    req.params.id
  );

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

// Toggle maintenance mode without overwriting other resource fields
app.patch('/api/resources/:id/maintenance-mode', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { maintenance_mode } = req.body;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid resource id' });
    }
    if (typeof maintenance_mode !== 'boolean') {
      return res.status(400).json({ error: 'maintenance_mode must be a boolean' });
    }

    const stmt = db.prepare('UPDATE resources SET maintenance_mode = ? WHERE id = ?');
    const info = stmt.run(maintenance_mode ? 1 : 0, id);

    if (info.changes === 0) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Invalidate related cache entries and broadcast live update
    cache.invalidatePattern('history:');
    cache.invalidatePattern('sla:');
    if (global.broadcastDashboardUpdate) {
      try { global.broadcastDashboardUpdate(); } catch {}
    }

    const updated = db.prepare('SELECT * FROM resources WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update maintenance mode', details: String(err) });
  }
});

// Delete resource
app.delete('/api/resources/:id', (req, res) => {
  const resource = db.prepare('SELECT name, url FROM resources WHERE id = ?').get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Resource not found' });

  db.prepare('DELETE FROM resources WHERE id = ?').run(req.params.id);

  cache.invalidatePattern('history:');
  cache.invalidatePattern('sla:');
  auditLog.logResourceChange('delete', req.params.id, { name: resource.name, url: resource.url }, 'system', req.ip);

  res.json({ message: 'Resource deleted' });
});

// Get dashboard overview (grouped)
app.get('/api/dashboard', (req, res) => {
  res.json(getDashboardPayload());
});

// Get incidents
app.get('/api/incidents', (req, res) => {
  const incidents = db.prepare(`
    SELECT
      i.id,
      i.resource_id,
      REPLACE(i.started_at, ' ', 'T') || 'Z' AS started_at,
      CASE
        WHEN i.resolved_at IS NULL THEN NULL
        ELSE REPLACE(i.resolved_at, ' ', 'T') || 'Z'
      END AS resolved_at,
      i.description,
      i.failed_check_count,
      r.name as resource_name,
      r.url as resource_url
    FROM incidents i
    JOIN resources r ON i.resource_id = r.id
    ORDER BY i.started_at DESC
    LIMIT 100
  `).all();

  res.json({ incidents });
});

// Get notifications (in-app notification center)
app.get('/api/notifications', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const read = req.query.read; // undefined = all, 'unread' = only unread, 'read' = only read

  let whereClause = '';
  let whereClauseCount = '';
  if (read === 'unread') {
    whereClause = 'WHERE n.read = 0';
    whereClauseCount = 'WHERE read = 0';
  } else if (read === 'read') {
    whereClause = 'WHERE n.read = 1';
    whereClauseCount = 'WHERE read = 1';
  }

  const notifications = db.prepare(`
    SELECT 
      n.id,
      n.resource_id,
      n.incident_id,
      n.type,
      n.title,
      n.message,
      n.read,
      n.created_at,
      r.name as resource_name,
      i.started_at as incident_started_at
    FROM notifications n
    LEFT JOIN resources r ON n.resource_id = r.id
    LEFT JOIN incidents i ON n.incident_id = i.id
    ${whereClause}
    ORDER BY n.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM notifications ${whereClauseCount}
  `).get().count;

  const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get().count;

  res.json({ notifications, total, unreadCount });
});

// Get unread notification count
app.get('/api/notifications/unread/count', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get().count;
  res.json({ unreadCount: count });
});

// Mark notification as read
app.put('/api/notifications/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Delete notification
app.delete('/api/notifications/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Clear all notifications
app.post('/api/notifications/clear', (req, res) => {
  const type = req.body.type; // 'all', 'read', 'unread'
  
  if (type === 'all') {
    db.prepare('DELETE FROM notifications').run();
  } else if (type === 'read') {
    db.prepare('DELETE FROM notifications WHERE read = 1').run();
  } else if (type === 'unread') {
    db.prepare('DELETE FROM notifications WHERE read = 0').run();
  }
  
  res.json({ success: true });
});

// Get settings
app.get('/api/settings', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const dbSettings = {};
    const rows = db.prepare('SELECT key, value FROM settings').all();
    for (const row of rows) {
      dbSettings[row.key] = row.value;
    }
    res.json(buildSettingsFromDb(dbSettings));
  } catch (error) {
    console.error('Error reading settings:', error);
    res.json(buildSettingsFromDb({}));
  }
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
    incident_failure_threshold,
    webhook_template,
    ntfy_enabled,
    ntfy_url,
    ntfy_topic,
  } = req.body;

  // Validate email configuration if enabled
  if (email_enabled) {
    if (!email_host || !email_port || !email_user || !email_pass) {
      return res.status(400).json({ error: 'Email configuration incomplete. All fields required when enabled.' });
    }
    if (isNaN(email_port) || email_port < 1 || email_port > 65535) {
      return res.status(400).json({ error: 'Invalid email port number' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_from)) {
      return res.status(400).json({ error: 'Invalid email_from address' });
    }
  }

  // Validate webhook configuration if enabled
  if (webhook_enabled) {
    if (!webhook_url) {
      return res.status(400).json({ error: 'Webhook URL required when enabled' });
    }
    try {
      new URL(webhook_url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid webhook URL format' });
    }
  }

  // Validate numeric configuration
  if (retention_days && (isNaN(retention_days) || retention_days < 1)) {
    return res.status(400).json({ error: 'Retention days must be at least 1' });
  }
  if (check_interval && (isNaN(check_interval) || check_interval < 10000)) {
    return res.status(400).json({ error: 'Check interval must be at least 10000ms' });
  }
  if (timeout && (isNaN(timeout) || timeout < 1000)) {
    return res.status(400).json({ error: 'Timeout must be at least 1000ms' });
  }

  // Only persist keys that are explicitly present in this request.
  // The settings UI saves one section at a time, so absent keys must be
  // left untouched — otherwise their DB/env values get overwritten with defaults.
  const body = req.body;
  const present = (key) => body[key] !== undefined;

  // Field → { envKey, coerce }
  const FIELDS = {
    email_enabled:           { env: 'EMAIL_ENABLED',           coerce: v => String(v) },
    email_host:              { env: 'EMAIL_HOST',              coerce: v => v || '' },
    email_port:              { env: 'EMAIL_PORT',              coerce: v => String(v || 587) },
    email_user:              { env: 'EMAIL_USER',              coerce: v => v || '' },
    email_pass:              { env: 'EMAIL_PASS',              coerce: v => v || process.env.EMAIL_PASS || '' },
    email_from:              { env: 'EMAIL_FROM',              coerce: v => v || '' },
    email_to:                { env: 'EMAIL_TO',               coerce: v => v || '' },
    webhook_enabled:         { env: 'WEBHOOK_ENABLED',         coerce: v => String(v) },
    webhook_url:             { env: 'WEBHOOK_URL',             coerce: v => v || '' },
    webhook_template:        { env: 'WEBHOOK_TEMPLATE',        coerce: v => v || '' },
    check_interval:          { env: 'CHECK_INTERVAL',          coerce: v => String(v || 60000) },
    timeout:                 { env: 'TIMEOUT',                 coerce: v => String(v || 5000) },
    timezone:                { env: 'TIMEZONE',                coerce: v => v || 'UTC' },
    retention_days:          { env: 'RETENTION_DAYS',          coerce: v => String(v || 7) },
    auto_cleanup_enabled:    { env: 'AUTO_CLEANUP_ENABLED',    coerce: v => String(v) },
    consecutive_failures:    { env: 'CONSECUTIVE_FAILURES',    coerce: v => String(v || 3) },
    grace_period:            { env: 'GRACE_PERIOD',            coerce: v => String(v || 300) },
    downtime_threshold:      { env: 'DOWNTIME_THRESHOLD',      coerce: v => String(v || 600) },
    alert_retry_count:       { env: 'ALERT_RETRY_COUNT',       coerce: v => String(v || 3) },
    alert_retry_delay:       { env: 'ALERT_RETRY_DELAY',       coerce: v => String(v || 60) },
    fallback_webhook:        { env: 'FALLBACK_WEBHOOK',        coerce: v => v || '' },
    global_quiet_hours_start:{ env: 'GLOBAL_QUIET_HOURS_START',coerce: v => v || '' },
    global_quiet_hours_end:  { env: 'GLOBAL_QUIET_HOURS_END',  coerce: v => v || '' },
    escalation_hours:        { env: 'ESCALATION_HOURS',        coerce: v => String(v || 4) },
    default_sort:            { env: 'DEFAULT_SORT',            coerce: v => v || 'name' },
    items_per_page:          { env: 'ITEMS_PER_PAGE',          coerce: v => String(v || 20) },
    refresh_interval:        { env: 'REFRESH_INTERVAL',        coerce: v => String(v || 5000) },
    ntfy_enabled:            { env: 'NTFY_ENABLED',            coerce: v => String(v) },
    ntfy_url:                { env: 'NTFY_URL',                coerce: v => v || 'https://ntfy.sh' },
    ntfy_topic:              { env: 'NTFY_TOPIC',              coerce: v => v || '' },
    incident_failure_threshold: { env: 'INCIDENT_FAILURE_THRESHOLD', coerce: v => String(v || 10) },
    slow_alert_consecutive:    { env: 'SLOW_ALERT_CONSECUTIVE',    coerce: v => String(v || 3) },
  };

  // Collect only the fields present in this request
  const updates = [];
  for (const [key, cfg] of Object.entries(FIELDS)) {
    if (present(key)) {
      updates.push({ key, envKey: cfg.env, value: cfg.coerce(body[key]) });
    }
  }

  try {
    // Update DB — only touched keys
    const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
    for (const u of updates) upsert.run(u.key, u.value);

    // Update process.env — only touched keys
    for (const u of updates) process.env[u.envKey] = u.value;

    // Merge into .env file (read → patch → write) so restarts stay consistent
    let envLines = [];
    try { envLines = fs.readFileSync(envPath, 'utf8').split('\n'); } catch (_) {}
    const envMap = {};
    for (const line of envLines) {
      const eq = line.indexOf('=');
      if (eq > 0) envMap[line.slice(0, eq)] = line.slice(eq + 1);
    }
    envMap['THEME'] = 'dark';
    for (const u of updates) envMap[u.envKey] = u.value;
    fs.writeFileSync(envPath, Object.entries(envMap).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

    // Update in-memory notification config for the fields that changed
    const notifKeys = ['email_enabled','email_host','email_port','email_user','email_pass',
                       'email_from','email_to','webhook_enabled','webhook_url','webhook_template',
                       'ntfy_enabled','ntfy_url','ntfy_topic'];
    const changedNotif = updates.filter(u => notifKeys.includes(u.key));
    if (changedNotif.length > 0) {
      const patch = {};
      for (const u of changedNotif) patch[u.key] = u.value;
      // Booleans need coercion
      if (patch.email_enabled !== undefined) patch.email_enabled = patch.email_enabled === 'true';
      if (patch.webhook_enabled !== undefined) patch.webhook_enabled = patch.webhook_enabled === 'true';
      if (patch.ntfy_enabled !== undefined) patch.ntfy_enabled = patch.ntfy_enabled === 'true';
      notificationService.setConfig(patch);
    }

    res.json({ message: 'Settings saved successfully' });
  } catch (error) {
    console.error('Failed to save settings:', error);
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

// CSRF token generation endpoint
app.get('/api/auth/csrf-token', (req, res) => {
  try {
    const csrfToken = security.generateCSRFToken();
    res.json({ csrfToken });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate CSRF token' });
  }
});

// JWT token refresh endpoint
app.post('/api/auth/refresh-token', (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    // Verify the refresh token
    const decoded = security.verifyRefreshToken(refreshToken);
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Generate new access and refresh tokens
    const newAccessToken = security.generateToken({ userId: decoded.userId, username: decoded.username });
    const newRefreshToken = security.generateRefreshToken({ userId: decoded.userId, username: decoded.username });

    res.json({ 
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 3600 // 1 hour
    });
  } catch (error) {
    res.status(401).json({ error: 'Token refresh failed' });
  }
});

// Password validation endpoint (for frontend to check strength)
app.post('/api/auth/validate-password', (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    const validation = security.validatePasswordStrength(password);
    res.json(validation);
  } catch (error) {
    res.status(500).json({ error: 'Password validation failed' });
  }
});

// Observability & Monitoring Endpoints

// Get application metrics
app.get('/api/observability/metrics', (req, res) => {
  try {
    const metricsData = metrics.getMetrics();
    res.json(metricsData);
  } catch (error) {
    metrics.trackError(error, { endpoint: '/api/observability/metrics' });
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// Get recent errors
app.get('/api/observability/errors', (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const errors = metrics.getRecentErrors(parseInt(limit));
    res.json({ errors });
  } catch (error) {
    metrics.trackError(error, { endpoint: '/api/observability/errors' });
    res.status(500).json({ error: 'Failed to retrieve errors' });
  }
});

// Get audit logs
app.get('/api/observability/audit-logs', (req, res) => {
  try {
    const filters = {
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      userId: req.query.userId,
      action: req.query.action,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: parseInt(req.query.limit || 100),
      offset: parseInt(req.query.offset || 0)
    };
    
    const logs = auditLog.getAuditLogs(filters);
    const summary = auditLog.getSummary(parseInt(req.query.days || 7));
    
    res.json({ logs, summary });
  } catch (error) {
    metrics.trackError(error, { endpoint: '/api/observability/audit-logs' });
    res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

// Get audit log summary
app.get('/api/observability/audit-summary', (req, res) => {
  try {
    const { days = 7 } = req.query;
    const summary = auditLog.getSummary(parseInt(days));
    res.json(summary);
  } catch (error) {
    metrics.trackError(error, { endpoint: '/api/observability/audit-summary' });
    res.status(500).json({ error: 'Failed to retrieve audit summary' });
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

  // Get retention setting and enforce limit
  const retentionSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('retention_days');
  const maxDays = retentionSetting ? parseInt(retentionSetting.value) : 30;
  const requestedDays = parseInt(days);
  const effectiveDays = Math.min(requestedDays, maxDays);
  const limitedByRetention = effectiveDays < requestedDays;

  // Create cache key based on query parameters
  const cacheKey = `history:days=${effectiveDays}:page=${currentPage}:limit=${pageLimit}:averaged=${averaged}`;
  
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
    `).get(resource.id, `-${effectiveDays} days`);

    const uptime = stats.total > 0 ? (stats.up_count / stats.total * 100) : 0;
    const avgResponseTime = stats.avg_response || 0;

    let recentChecks = [];
    const isAveraged = String(averaged).toLowerCase() === 'true';
    
    if (isAveraged) {
      // Compute interval hours for bucketing (1h for 7 days, 3h for 14, 6h for 30+)
      const intervalHours = effectiveDays <= 7 ? 1 : effectiveDays <= 14 ? 3 : 6;
      
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
      `).all(resource.id, `-${effectiveDays} days`).map(row => ({
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
      `).all(resource.id, `-${effectiveDays} days`).reverse();
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

  const result = { 
    resources: overview, 
    total, 
    page: currentPage, 
    limit: pageLimit,
    effective_days: effectiveDays,
    requested_days: requestedDays,
    limited_by_retention: limitedByRetention
  };
  
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

// Update incident description
app.patch('/api/incidents/:id', (req, res) => {
  const { id } = req.params;
  const { description } = req.body;

  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'Description is required and must be a string' });
  }

  const stmt = db.prepare(`
    UPDATE incidents 
    SET description = ?
    WHERE id = ?
  `);

  const result = stmt.run(description.trim(), id);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  // Invalidate cache
  cache.flushAll();

  res.json({ message: 'Incident updated' });
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
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-ntfy', async (req, res) => {
  const axios = require('axios');
  const { ntfy_url, ntfy_topic } = req.body;
  if (!ntfy_topic) return res.status(400).json({ error: 'ntfy topic is required' });
  const base = (ntfy_url || 'https://ntfy.sh').replace(/\/$/, '');
  try {
    await axios.post(`${base}/`, {
      topic: ntfy_topic,
      title: '🔔 SkyWatch Test',
      message: 'This is a test notification from SkyWatch',
      priority: 3,
      tags: ['white_check_mark'],
    });
    res.json({ message: 'Test notification sent to ntfy!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Network discovery — scan local network for monitorable hosts
app.post('/api/network-discovery', async (req, res) => {
  try {
    const { subnet } = req.body || {};
    const hosts = await discoverNetwork(subnet || null);
    res.json({ hosts });
  } catch (error) {
    console.error('Network discovery error:', error);
    res.status(500).json({ error: 'Network discovery failed', details: error.message });
  }
});

// Return detected local subnets so the UI can offer them as quick-select options
app.get('/api/network-subnets', (req, res) => {
  try {
    res.json({ subnets: getLocalSubnets() });
  } catch (e) {
    res.json({ subnets: [] });
  }
});

// Clear cache endpoint for debugging
app.post('/api/cache/clear', (req, res) => {
  cache.clear();
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
    res.status(500).json({ error: 'Failed to delete maintenance window' });
  }
});

// Get all maintenance windows
app.get('/api/maintenance-windows', (req, res) => {
  try {
    const windows = db.prepare(`
      SELECT
        id,
        resource_id,
        REPLACE(start_time, ' ', 'T') || 'Z' AS start_time,
        REPLACE(end_time, ' ', 'T') || 'Z' AS end_time,
        reason
      FROM maintenance_windows
      ORDER BY start_time DESC
      LIMIT 100
    `).all();

    res.json({ maintenanceWindows: windows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get maintenance windows' });
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
    res.status(500).json({ error: 'Failed to update alert rules' });
  }
});

// Get alert rules for a resource
app.get('/api/resources/:id/alert-rules', (req, res) => {
  const resource = db.prepare('SELECT consecutive_failures_threshold, response_time_threshold FROM resources WHERE id = ?').get(req.params.id);
  if (!resource) return res.status(404).json({ error: 'Resource not found' });
  res.json(resource);
});

// Heartbeat ping endpoint — cron jobs POST here to signal they're alive
app.post('/api/heartbeat/:token', rateLimit(20), (req, res) => {
  const resource = db.prepare('SELECT id, name FROM resources WHERE heartbeat_token = ? AND enabled = 1').get(req.params.token);
  if (!resource) return res.status(404).json({ error: 'Unknown heartbeat token' });

  db.prepare('UPDATE resources SET last_heartbeat_at = CURRENT_TIMESTAMP WHERE id = ?').run(resource.id);

  // Write an 'up' check so we have a record of the ping
  db.prepare(`
    INSERT INTO checks (resource_id, status, response_time, checked_at)
    VALUES (?, 'up', 0, CURRENT_TIMESTAMP)
  `).run(resource.id);

  res.json({ ok: true, resource: resource.name });
});

// Public status page — only returns resources with is_public = 1
app.get('/api/status-page', rateLimit(60), (req, res) => {
  try {
    const resources = db.prepare('SELECT * FROM resources WHERE is_public = 1 AND enabled = 1 ORDER BY name').all();
    const incidents = db.prepare(`
      SELECT i.*, r.name AS resource_name FROM incidents i
      JOIN resources r ON r.id = i.resource_id
      WHERE r.is_public = 1 AND i.resolved_at IS NULL
      ORDER BY i.started_at DESC
    `).all();
    const maintenanceWindows = db.prepare(`
      SELECT mw.*, r.name AS resource_name FROM maintenance_windows mw
      JOIN resources r ON r.id = mw.resource_id
      WHERE r.is_public = 1
      ORDER BY mw.start_time DESC
    `).all();

    const dailyRows = db.prepare(`
      SELECT resource_id, date(checked_at) as day,
             ROUND(SUM(CASE WHEN status='up' THEN 100.0 ELSE 0 END) / COUNT(*), 1) as uptime_pct
      FROM checks
      WHERE checked_at > datetime('now', '-90 days')
      GROUP BY resource_id, date(checked_at)
      ORDER BY resource_id, day ASC
    `).all();
    const dailyByResource = {};
    dailyRows.forEach(row => {
      if (!dailyByResource[row.resource_id]) dailyByResource[row.resource_id] = [];
      dailyByResource[row.resource_id].push({ day: row.day, uptime: row.uptime_pct });
    });

    const overview = resources.map(resource => {
      const stats = monitorService.getResourceStats(resource.id, 24);
      const lastCheck = monitorService.getLastCheck(resource.id);
      return {
        id: resource.id,
        name: resource.name,
        url: resource.type === 'heartbeat' ? null : resource.url,
        type: resource.type,
        status: lastCheck?.status || 'unknown',
        uptime: stats.uptime,
        avgResponseTime: stats.avgResponseTime,
        lastCheck: lastCheck?.checked_at,
        dailyUptime: dailyByResource[resource.id] || [],
      };
    });

    res.json({ resources: overview, incidents, maintenanceWindows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load status page data' });
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
    const headers = ['name', 'url', 'type', 'check_interval', 'timeout', 'sla_target', 'tags', 'group_id', 'email_to',
      'http_method', 'http_body', 'heartbeat_timeout', 'is_public', 'consecutive_failures_threshold', 'response_time_threshold'];
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
        resource.http_method || 'GET',
        `"${(resource.http_body || '').replace(/"/g, '""')}"`,
        resource.heartbeat_timeout || 300000,
        resource.is_public !== 0 ? 1 : 0,
        resource.consecutive_failures_threshold || 1,
        resource.response_time_threshold || '',
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="resources-export.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export resources' });
  }
});

// Export SLA report as CSV
app.get('/api/sla/export', (req, res) => {
  const { days = 30 } = req.query;
  try {
    const resources = db.prepare(`
      SELECT r.*, 
             COUNT(c.id) as total_checks,
             SUM(CASE WHEN c.status = 'up' THEN 1 ELSE 0 END) as up_checks,
             AVG(c.response_time) as avg_response_time,
             COUNT(DISTINCT CASE WHEN i.id IS NOT NULL THEN i.id END) as incident_count,
             COALESCE(SUM(CAST((julianday(COALESCE(i.resolved_at, datetime('now'))) - julianday(i.started_at)) * 24 * 60 AS INTEGER)), 0) as downtime_minutes
      FROM resources r
      LEFT JOIN checks c ON r.id = c.resource_id AND c.checked_at > datetime('now', '-' || ? || ' days')
      LEFT JOIN incidents i ON r.id = i.resource_id AND i.started_at > datetime('now', '-' || ? || ' days')
      GROUP BY r.id
      ORDER BY r.name
    `).all(days, days);

    // CSV header
    const headers = ['Resource Name', 'URL', 'Total Checks', 'Successful', 'Failed', 'Uptime %', 'Avg Response Time (ms)', 'Incidents', 'Downtime (minutes)'];
    const csvRows = [headers.join(',')];

    resources.forEach(resource => {
      const uptime = resource.total_checks > 0 ? ((resource.up_checks / resource.total_checks) * 100).toFixed(2) : 0;
      const failed = (resource.total_checks || 0) - (resource.up_checks || 0);
      const row = [
        `"${resource.name.replace(/"/g, '""')}"`,
        `"${resource.url.replace(/"/g, '""')}"`,
        resource.total_checks || 0,
        resource.up_checks || 0,
        failed,
        uptime,
        (resource.avg_response_time || 0).toFixed(0),
        resource.incident_count || 0,
        resource.downtime_minutes || 0
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sla-report-${days}d.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export SLA report' });
  }
});

// Export incident history as CSV
app.get('/api/incidents/export', (req, res) => {
  const { days = 30 } = req.query;
  try {
    const incidents = db.prepare(`
      SELECT i.*, r.name as resource_name, r.url
      FROM incidents i
      JOIN resources r ON i.resource_id = r.id
      WHERE i.started_at > datetime('now', '-' || ? || ' days')
      ORDER BY i.started_at DESC
    `).all(days);

    // CSV header
    const headers = ['Resource', 'URL', 'Started At', 'Resolved At', 'Duration (minutes)', 'Incident Type', 'Error Message', 'Status'];
    const csvRows = [headers.join(',')];

    incidents.forEach(incident => {
      const startTime = new Date(incident.started_at).getTime();
      const endTime = incident.resolved_at ? new Date(incident.resolved_at).getTime() : Date.now();
      const durationMinutes = Math.round((endTime - startTime) / 1000 / 60);
      const status = incident.resolved_at ? 'Resolved' : 'Active';
      
      const row = [
        `"${incident.resource_name.replace(/"/g, '""')}"`,
        `"${incident.url.replace(/"/g, '""')}"`,
        new Date(incident.started_at).toISOString(),
        incident.resolved_at ? new Date(incident.resolved_at).toISOString() : '',
        durationMinutes,
        incident.type || 'outage',
        `"${(incident.error_message || '').replace(/"/g, '""')}"`,
        status
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="incidents-export-${days}d.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export incidents' });
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

        // Validate URL format
        try {
          new URL(row.url);
        } catch (e) {
          errors.push(`Row ${i + 1}: Invalid URL format`);
          continue;
        }

        // Check for duplicates
        const existing = db.prepare('SELECT id FROM resources WHERE url = ?').get(row.url);
        if (existing) {
          errors.push(`Row ${i + 1}: URL already exists`);
          continue;
        }

        // Validate numeric fields
        const checkInterval = parseInt(row.check_interval) || 60000;
        if (checkInterval < 10000) {
          errors.push(`Row ${i + 1}: Check interval must be at least 10000ms`);
          continue;
        }

        const timeout = parseInt(row.timeout) || 5000;
        if (timeout < 1000) {
          errors.push(`Row ${i + 1}: Timeout must be at least 1000ms`);
          continue;
        }

        const slaTarget = parseFloat(row.sla_target) || 99.9;
        if (isNaN(slaTarget) || slaTarget < 0 || slaTarget > 100) {
          errors.push(`Row ${i + 1}: SLA target must be between 0 and 100`);
          continue;
        }

        const stmt = db.prepare(`
          INSERT INTO resources (name, url, type, check_interval, timeout, sla_target, tags, group_id, email_to,
            http_method, http_body, heartbeat_timeout, is_public, consecutive_failures_threshold, response_time_threshold)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          row.name,
          row.url,
          row.type || 'http',
          checkInterval,
          timeout,
          slaTarget,
          row.tags || '',
          row.group_id ? parseInt(row.group_id) : null,
          row.email_to || '',
          row.http_method || 'GET',
          row.http_body || null,
          parseInt(row.heartbeat_timeout) || 300000,
          row.is_public === '0' || row.is_public === 'false' ? 0 : 1,
          parseInt(row.consecutive_failures_threshold) || 1,
          row.response_time_threshold ? parseInt(row.response_time_threshold) : null
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
    res.status(500).json({ error: 'Failed to import resources' });
  }
});

// ===== Agent API =====

// Serve the agent install script so remote hosts can curl it
app.get('/api/agents/script', (req, res) => {
  const fs = require('fs');
  const scriptPath = path.join(__dirname, '../agent/skywatch-agent.sh');
  if (fs.existsSync(scriptPath)) {
    res.setHeader('Content-Type', 'text/x-sh');
    res.setHeader('Content-Disposition', 'attachment; filename="skywatch-agent.sh"');
    res.sendFile(scriptPath);
  } else {
    res.status(404).json({ error: 'Agent script not found on this server' });
  }
});

// Register a new Linux agent — returns a bearer token the agent uses for all future calls
app.post('/api/agents/register', rateLimit(5), (req, res) => {
  // Optional: if AGENT_REGISTRATION_KEY is set in env, require it as X-Registration-Key header
  const requiredKey = process.env.AGENT_REGISTRATION_KEY;
  if (requiredKey) {
    const provided = req.headers['x-registration-key'] || '';
    if (provided !== requiredKey) {
      return res.status(403).json({ error: 'Invalid or missing registration key' });
    }
  }

  const { name, hostname, ip_address, os_info } = req.body;
  if (!name) return res.status(400).json({ error: 'Agent name is required' });

  try {
    const token = randomUUID();
    const result = db.prepare(`
      INSERT INTO agents (name, token, hostname, ip_address, os_info)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, token, hostname || name, ip_address || null, os_info || null);

    res.json({ id: result.lastInsertRowid, token, name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register agent', details: err.message });
  }
});

// Receive a metrics snapshot from an agent (authenticated by bearer token)
app.post('/api/agents/report', rateLimit(120), (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!token) return res.status(401).json({ error: 'Authorization token required' });

  const agent = db.prepare('SELECT id FROM agents WHERE token = ?').get(token);
  if (!agent) return res.status(401).json({ error: 'Invalid token' });

  const {
    cpu_percent, mem_total, mem_used, mem_percent,
    disk, load_1, load_5, load_15,
    uptime_seconds, process_count, net_bytes_sent, net_bytes_recv, ip_address,
  } = req.body;

  try {
    db.prepare(`
      UPDATE agents SET last_seen_at = CURRENT_TIMESTAMP, ip_address = COALESCE(?, ip_address)
      WHERE id = ?
    `).run(ip_address || null, agent.id);

    db.prepare(`
      INSERT INTO agent_metrics
        (agent_id, cpu_percent, mem_total, mem_used, mem_percent, disk_data,
         load_1, load_5, load_15, uptime_seconds, process_count, net_bytes_sent, net_bytes_recv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      cpu_percent   ?? null,
      mem_total     ?? null,
      mem_used      ?? null,
      mem_percent   ?? null,
      disk ? JSON.stringify(disk) : null,
      load_1        ?? null,
      load_5        ?? null,
      load_15       ?? null,
      uptime_seconds ?? null,
      process_count ?? null,
      net_bytes_sent ?? null,
      net_bytes_recv ?? null,
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to store metrics' });
  }
});

// List all agents with their most-recent metrics snapshot
app.get('/api/agents', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        a.id, a.name, a.hostname, a.ip_address, a.os_info,
        REPLACE(a.last_seen_at, ' ', 'T') || 'Z' AS last_seen_at,
        REPLACE(a.created_at,   ' ', 'T') || 'Z' AS created_at,
        m.cpu_percent, m.mem_total, m.mem_used, m.mem_percent,
        m.disk_data, m.load_1, m.load_5, m.load_15,
        m.uptime_seconds, m.process_count, m.net_bytes_sent, m.net_bytes_recv,
        REPLACE(m.recorded_at, ' ', 'T') || 'Z' AS last_metric_at
      FROM agents a
      LEFT JOIN agent_metrics m ON m.id = (
        SELECT id FROM agent_metrics WHERE agent_id = a.id ORDER BY recorded_at DESC LIMIT 1
      )
      ORDER BY a.name ASC
    `).all();

    const agents = rows.map(({ disk_data, ...a }) => ({
      ...a,
      disk: disk_data ? JSON.parse(disk_data) : null,
    }));

    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// Get a single agent with its latest metrics
app.get('/api/agents/:id', (req, res) => {
  try {
    const agent = db.prepare(`
      SELECT id, name, hostname, ip_address, os_info,
        REPLACE(last_seen_at, ' ', 'T') || 'Z' AS last_seen_at,
        REPLACE(created_at,   ' ', 'T') || 'Z' AS created_at
      FROM agents WHERE id = ?
    `).get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const raw = db.prepare(
      'SELECT * FROM agent_metrics WHERE agent_id = ? ORDER BY recorded_at DESC LIMIT 1'
    ).get(agent.id);

    const latest = raw
      ? (() => { const { disk_data, ...r } = raw; return { ...r, disk: disk_data ? JSON.parse(disk_data) : null }; })()
      : null;

    res.json({ ...agent, latest });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// Historical metrics for an agent (default: last hour, up to 500 rows)
app.get('/api/agents/:id/metrics', (req, res) => {
  const { limit = 60, hours = 1 } = req.query;
  try {
    const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const rows = db.prepare(`
      SELECT cpu_percent, mem_total, mem_used, mem_percent, disk_data,
        load_1, load_5, load_15, uptime_seconds, process_count,
        net_bytes_sent, net_bytes_recv,
        REPLACE(recorded_at, ' ', 'T') || 'Z' AS recorded_at
      FROM agent_metrics
      WHERE agent_id = ? AND recorded_at > datetime('now', ?)
      ORDER BY recorded_at ASC
      LIMIT ?
    `).all(req.params.id, `-${parseInt(hours)} hours`, Math.min(parseInt(limit), 500));

    const metrics = rows.map(({ disk_data, ...r }) => ({
      ...r,
      disk: disk_data ? JSON.parse(disk_data) : null,
    }));

    res.json({ metrics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

// Delete an agent and all its stored metrics
app.delete('/api/agents/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json({ message: 'Agent deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete agent' });
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

// Error tracking middleware — must be after all routes
app.use((err, req, res, next) => {
  metrics.trackError(err, { method: req.method, url: req.url, ip: req.ip });
  res.status(500).json({ error: 'Internal server error' });
});

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
    const message = JSON.stringify({ type: 'dashboard', data: getDashboardPayload() });
    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        wsClients.delete(client);
      }
    });
  } catch (error) {
    // Broadcast error handled silently
  }
}

// Broadcast alert notification to WebSocket clients
function broadcastAlert(alert) {
  try {
    const message = JSON.stringify({
      type: 'alert',
      data: alert
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        wsClients.delete(client);
      }
    });
  } catch (error) {
    // Broadcast error handled silently
  }
}

// Broadcast incident update to WebSocket clients
function broadcastIncident(incident) {
  try {
    const message = JSON.stringify({
      type: 'incident',
      data: incident
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        wsClients.delete(client);
      }
    });
  } catch (error) {
    // Broadcast error handled silently
  }
}

// Broadcast metrics update to WebSocket clients
function broadcastMetrics() {
  try {
    const metricsData = metrics.getMetrics();
    const message = JSON.stringify({
      type: 'metrics',
      data: metricsData
    });

    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      } else {
        wsClients.delete(client);
      }
    });
  } catch (error) {
    // Broadcast error handled silently
  }
}

// Export broadcast functions for use in scheduler and other modules
global.broadcastDashboardUpdate = broadcastDashboardUpdate;
global.broadcastAlert = broadcastAlert;
global.broadcastIncident = broadcastIncident;
global.broadcastMetrics = broadcastMetrics;

// Broadcast new notification to all connected WebSocket clients
function broadcastNotification(notification) {
  const message = JSON.stringify({
    type: 'notification',
    data: notification
  });
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Export broadcast notification function
global.broadcastNotification = broadcastNotification;

// Health check endpoint
app.get('/api/health', (req, res) => {
  try {
    const uptime = process.uptime();
    const dbCheck = db.prepare('SELECT COUNT(*) as count FROM resources').get();
    const schedulerStatus = scheduler.isRunning ? 'running' : 'stopped';
    
    res.json({
      status: 'ok',
      uptime: Math.floor(uptime),
      uptimeFormatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      timestamp: new Date().toISOString(),
      database: {
        connected: !!dbCheck,
        resourcesCount: dbCheck?.count || 0
      },
      scheduler: {
        status: schedulerStatus,
        isRunning: scheduler.isRunning
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Graceful shutdown handlers
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  try {
    // Close WebSocket connections
    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, 'Server shutting down');
      }
    });
    wsClients.clear();

    // Stop scheduler
    if (scheduler.isRunning) {
      scheduler.stop();
    }

    // Close database
    try {
      db.close();
    } catch (e) {
      // Database already closed
    }

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server with HTTP and WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
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
      // Handle JSON parse errors silently
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    wsClients.delete(ws);
  });
});

server.listen(PORT, () => {
  scheduler.start();
});
