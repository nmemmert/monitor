const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./database');
const scheduler = require('./scheduler');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');
const cache = require('./cache');

const app = express();
const PORT = process.env.PORT || 3001;

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
  
  console.log(`Timezone offset for ${tz}: ${offsetHours} hours (UTC ${utcHour}:00, TZ ${tzHour}:00)`);
  
  // SQL datetime() function: we need the OPPOSITE sign
  // If local is 5 hours behind UTC, we need to ADD 5 hours to go backwards (counterintuitive but correct for SQLite)
  const sqlOffset = -offsetHours;
  const result = sqlOffset > 0 ? `+${sqlOffset} hours` : `${sqlOffset} hours`;
  console.log(`SQL offset calculation: offsetHours=${offsetHours}, sqlOffset=${sqlOffset}, result="${result}"`);
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
  const { name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to } = req.body;

  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  const stmt = db.prepare(`
    INSERT INTO resources (name, url, type, check_interval, timeout, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    email_to || null
  );

  // Invalidate related cache entries
  cache.invalidatePattern('history:');
  cache.invalidatePattern('sla:');

  res.json({ id: result.lastInsertRowid, message: 'Resource created' });
});

// Update resource
app.put('/api/resources/:id', (req, res) => {
  const { name, url, type, check_interval, timeout, enabled, group_id, http_keyword, http_headers, quiet_hours_start, quiet_hours_end, cert_expiry_days, sla_target, email_to } = req.body;

  const stmt = db.prepare(`
    UPDATE resources 
    SET name = ?, url = ?, type = ?, check_interval = ?, timeout = ?, enabled = ?, group_id = ?, http_keyword = ?, http_headers = ?, quiet_hours_start = ?, quiet_hours_end = ?, cert_expiry_days = ?, sla_target = ?, email_to = ?
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
    req.params.id
  );

  // Invalidate related cache entries
  cache.invalidatePattern('history:');
  cache.invalidatePattern('sla:');

  res.json({ message: 'Resource updated' });
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

    const tzOffset = getTimezoneOffset();
    const recentChecks = db.prepare(`
      SELECT response_time, status, datetime(checked_at, '${tzOffset}') as checked_at
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

  const tzOffset = getTimezoneOffset();
  const checks = db.prepare(`
    SELECT 
      id,
      status,
      response_time,
      status_code,
      error_message,
      details,
      datetime(checked_at, '${tzOffset}') as checked_at
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
  const { days = 7, page = 1, page: pageParam, averaged = 'false' } = req.query;
  console.log('History overview request:', { days, averaged, type: typeof averaged, timestamp: new Date().toISOString() });
  // Resource pagination (number of resources per page)
  const pageLimit = parseInt(req.query.limit || 10);
  const currentPage = Math.max(1, parseInt(pageParam || page || 1));
  const offset = (currentPage - 1) * pageLimit;

  // Create cache key based on query parameters
  const cacheKey = `history:days=${days}:page=${currentPage}:limit=${pageLimit}:averaged=${averaged}`;
  console.log('Cache key:', cacheKey);
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log('Returning cached result');
    return res.json(cachedResult);
  }
  console.log('No cache hit, querying database');

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
    console.log(`Resource ${resource.name}: averaged=${averaged}, isAveraged=${isAveraged}`);
    
    if (isAveraged) {
      console.log(`Using averaged mode for ${resource.name}`);
      // Compute interval hours for bucketing (1h for 7 days, 3h for 14, 6h for 30+)
      const intervalHours = days <= 7 ? 1 : days <= 14 ? 3 : 6;
      console.log(`Bucketing with ${intervalHours} hour intervals`);
      
      // Use a reliable bucketing approach with Julian Day Numbers
      // Convert to julian day, multiply by 24 for hours, divide by intervalHours and round
      const bucketExpr = `ROUND((julianday(checked_at) * 24) / ${intervalHours}) * ${intervalHours} / 24`;
      const tzOffset = getTimezoneOffset();
      
      recentChecks = db.prepare(`
        SELECT 
          datetime(${bucketExpr}, '${tzOffset}') AS checked_at,
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
      console.log(`${resource.name}: Returned ${recentChecks.length} averaged data points`);
    } else {
      console.log(`Using non-averaged mode for ${resource.name}`);
      // Non-averaged: filter to window but cap to last 600 checks
      const tzOffset = getTimezoneOffset();
      recentChecks = db.prepare(`
        SELECT status, response_time, datetime(checked_at, '${tzOffset}') as checked_at
        FROM checks
        WHERE resource_id = ? AND checked_at > datetime('now', ?)
        ORDER BY checked_at DESC
        LIMIT 600
      `).all(resource.id, `-${days} days`).reverse();
      console.log(`${resource.name}: Returned ${recentChecks.length} non-averaged data points`);
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
  console.log('SLA request:', { days: daysNum, effectiveDays, limitedByRetention, page: currentPage, limit: pageLimit, cacheKey });
  
  // Check cache first
  const cachedResult = cache.get(cacheKey);
  if (cachedResult) {
    console.log('SLA: Cache hit');
    return res.json(cachedResult);
  }
  console.log('SLA: Cache miss, querying database');

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
      console.log(`SLA ${resource.name}: ${checks.length} checks in ${effectiveDays} days (requested ${daysNum})`);

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
