const axios = require('axios');
const net = require('net');
const tls = require('tls');
const dns = require('dns').promises;
const WebSocket = require('ws');
const ping = require('ping');
const db = require('./database');

const DEFAULT_PORTS = {
  http: 80,
  https: 443,
  tcp: 80,
  tls: 443,
  websocket: 80,
};

function parseHostPort(urlString, fallbackPort) {
  try {
    const u = new URL(urlString.startsWith('http') || urlString.startsWith('ws') ? urlString : `http://${urlString}`);
    return { host: u.hostname, port: u.port ? Number(u.port) : fallbackPort };
  } catch (err) {
    // Fallback if url is just host:port
    const [host, port] = urlString.split(':');
    return { host, port: port ? Number(port) : fallbackPort };
  }
}

class MonitorService {
  async checkResource(resource) {
    const type = (resource.type || 'http').toLowerCase();
    const startTime = Date.now();
    const base = {
      resource_id: resource.id,
      status: 'down',
      response_time: null,
      status_code: null,
      error_message: null,
      details: null,
    };

    switch (type) {
      case 'http':
      case 'https':
      case 'health':
        return this.checkHttp(resource, startTime, base);
      case 'tcp':
        return this.checkTcp(resource, startTime, base);
      case 'tls':
        return this.checkTls(resource, startTime, base);
      case 'dns':
        return this.checkDns(resource, startTime, base);
      case 'websocket':
      case 'ws':
      case 'wss':
        return this.checkWebSocket(resource, startTime, base);
      case 'icmp':
      case 'ping':
        return this.checkIcmp(resource, startTime, base);
      default:
        // Fallback to HTTP if unknown
        return this.checkHttp(resource, startTime, base);
    }
  }

  async checkHttp(resource, startTime, base) {
    let result = { ...base };
    try {
      const headers = {};
      if (resource.http_headers) {
        try {
          const customHeaders = JSON.parse(resource.http_headers);
          Object.assign(headers, customHeaders);
        } catch (e) {
          // Invalid JSON, skip custom headers
        }
      }

      const response = await axios.get(resource.url, {
        timeout: resource.timeout,
        validateStatus: () => true,
        maxRedirects: 5,
        headers,
      });
      const responseTime = Date.now() - startTime;
      const isUp = response.status >= 200 && response.status < 400;
      
      // Check for keyword if specified
      let keywordMatch = true;
      if (resource.http_keyword && response.data) {
        const dataStr = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        keywordMatch = dataStr.includes(resource.http_keyword);
        if (!keywordMatch) {
          result.error_message = `Keyword "${resource.http_keyword}" not found in response`;
        }
      }

      result = {
        ...result,
        status: (isUp && keywordMatch) ? 'up' : 'down',
        response_time: responseTime,
        status_code: response.status,
        error_message: isUp && keywordMatch ? null : (result.error_message || `HTTP ${response.status}`),
      };
    } catch (error) {
      result.error_message = error.message;
      result.response_time = Date.now() - startTime;
    }
    return result;
  }

  async checkTcp(resource, startTime, base) {
    const { host, port } = parseHostPort(resource.url, DEFAULT_PORTS.tcp);
    return new Promise(resolve => {
      const socket = new net.Socket();
      let finished = false;

      const done = (status, error_message = null) => {
        if (finished) return;
        finished = true;
        socket.destroy();
        resolve({
          ...base,
          status,
          response_time: Date.now() - startTime,
          status_code: null,
          error_message,
          details: JSON.stringify({ host, port }),
        });
      };

      socket.setTimeout(resource.timeout || 5000);
      socket.once('connect', () => done('up'));
      socket.once('timeout', () => done('down', 'TCP timeout'));
      socket.once('error', (err) => done('down', err.message));
      socket.connect(port, host);
    });
  }

  async checkTls(resource, startTime, base) {
    const { host, port } = parseHostPort(resource.url, DEFAULT_PORTS.tls);
    return new Promise(resolve => {
      const socket = tls.connect({ host, port, servername: host, timeout: resource.timeout || 5000 }, () => {
        const cert = socket.getPeerCertificate();
        const now = Date.now();
        const expires = new Date(cert.valid_to).getTime();
        const daysRemaining = Math.round((expires - now) / (1000 * 60 * 60 * 24));
        const validHost = cert.subjectaltname ? cert.subjectaltname.includes(host) : true;
        
        // Check certificate expiry threshold
        const expiryThreshold = resource.cert_expiry_days || 30;
        const certExpiringWarning = daysRemaining <= expiryThreshold && daysRemaining > 0;

        const status = daysRemaining > 0 && validHost ? 'up' : 'down';
        resolve({
          ...base,
          status,
          response_time: Date.now() - startTime,
          error_message: status === 'up' ? null : 'TLS invalid or expired',
          cert_expiry_date: cert.valid_to,
          details: JSON.stringify({
            issuer: cert.issuer?.CN,
            subject: cert.subject?.CN,
            valid_to: cert.valid_to,
            days_remaining: daysRemaining,
            host_matches: validHost,
            cert_expiring_soon: certExpiringWarning,
            expiry_threshold: expiryThreshold,
          }),
        });
        socket.end();
      });

      socket.on('error', err => {
        resolve({
          ...base,
          status: 'down',
          response_time: Date.now() - startTime,
          error_message: err.message,
        });
      });

      socket.setTimeout(resource.timeout || 5000, () => {
        resolve({
          ...base,
          status: 'down',
          response_time: Date.now() - startTime,
          error_message: 'TLS timeout',
        });
        socket.destroy();
      });
    });
  }

  async checkDns(resource, startTime, base) {
    const { host } = parseHostPort(resource.url, DEFAULT_PORTS.http);
    try {
      const records = await dns.lookup(host, { all: true });
      return {
        ...base,
        status: 'up',
        response_time: Date.now() - startTime,
        details: JSON.stringify({ answers: records }),
      };
    } catch (err) {
      return {
        ...base,
        status: 'down',
        response_time: Date.now() - startTime,
        error_message: err.message,
      };
    }
  }

  async checkWebSocket(resource, startTime, base) {
    return new Promise(resolve => {
      let finished = false;

      const done = (status, error_message = null) => {
        if (finished) return;
        finished = true;
        resolve({
          ...base,
          status,
          response_time: Date.now() - startTime,
          error_message,
        });
      };

      try {
        const ws = new WebSocket(resource.url, { handshakeTimeout: resource.timeout || 5000 });
        ws.on('open', () => {
          done('up');
          ws.close();
        });
        ws.on('error', (err) => done('down', err.message));
        ws.on('close', () => done('up'));
      } catch (err) {
        done('down', err.message);
      }
    });
  }

  async checkIcmp(resource, startTime, base) {
    const { host } = parseHostPort(resource.url, DEFAULT_PORTS.http);
    try {
      const res = await ping.promise.probe(host, { timeout: (resource.timeout || 5000) / 1000 });
      const status = res.alive ? 'up' : 'down';
      return {
        ...base,
        status,
        response_time: res.time || Date.now() - startTime,
        error_message: res.alive ? null : res.output,
        details: JSON.stringify({ packetLoss: res.packetLoss, time: res.time }),
      };
    } catch (err) {
      return {
        ...base,
        status: 'down',
        response_time: Date.now() - startTime,
        error_message: err.message,
      };
    }
  }

  saveCheck(check) {
    const stmt = db.prepare(`
      INSERT INTO checks (resource_id, status, response_time, status_code, error_message, details, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    stmt.run(
      check.resource_id,
      check.status,
      check.response_time,
      check.status_code,
      check.error_message,
      check.details || null
    );
  }

  getLastCheck(resourceId) {
    return db.prepare(`
      SELECT 
        id,
        resource_id,
        status,
        response_time,
        status_code,
        error_message,
        details,
        REPLACE(checked_at, ' ', 'T') || 'Z' AS checked_at
      FROM checks 
      WHERE resource_id = ? 
      ORDER BY checked_at DESC 
      LIMIT 1
    `).get(resourceId);
  }

  handleIncident(resourceId, isDown) {
    const activeIncident = db.prepare(`
      SELECT * FROM incidents 
      WHERE resource_id = ? AND resolved_at IS NULL
    `).get(resourceId);

    if (isDown && !activeIncident) {
      // Start new incident
      db.prepare(`
        INSERT INTO incidents (resource_id) VALUES (?)
      `).run(resourceId);
      return { type: 'started', incident: true };
    } else if (!isDown && activeIncident) {
      // Resolve incident
      db.prepare(`
        UPDATE incidents 
        SET resolved_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(activeIncident.id);
      return { type: 'resolved', incident: activeIncident };
    }

    return { type: 'none' };
  }

  getResourceStats(resourceId, hours = 24) {
    const checks = db.prepare(`
      SELECT 
        id,
        resource_id,
        status,
        response_time,
        status_code,
        error_message,
        details,
        REPLACE(checked_at, ' ', 'T') || 'Z' AS checked_at
      FROM checks 
      WHERE resource_id = ? 
      AND checked_at >= datetime('now', '-' || ? || ' hours')
      ORDER BY checked_at ASC
    `).all(resourceId, hours);

    const upChecks = checks.filter(c => c.status === 'up');
    const totalChecks = checks.length;
    const uptime = totalChecks > 0 ? (upChecks.length / totalChecks) * 100 : 0;

    const responseTimes = checks
      .filter(c => c.response_time !== null)
      .map(c => c.response_time);

    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    return {
      uptime: uptime.toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(0),
      totalChecks,
      checks: checks.slice(-50), // Last 50 checks
    };
  }

  /**
   * Paginated checks with basic filters and ISO timestamps
   */
  getChecks(resourceId, {
    limit = 50,
    offset = 0,
    status = null,
    from = null,
    to = null,
    sort = 'desc',
  } = {}) {
    const clauses = ['resource_id = ?'];
    const params = [resourceId];

    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (from) {
      clauses.push('checked_at >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('checked_at <= ?');
      params.push(to);
    }

    const order = sort === 'asc' ? 'ASC' : 'DESC';

    const sql = `
      SELECT
        id,
        resource_id,
        status,
        response_time,
        status_code,
        error_message,
        details,
        REPLACE(checked_at, ' ', 'T') || 'Z' AS checked_at
      FROM checks
      WHERE ${clauses.join(' AND ')}
      ORDER BY checked_at ${order}
      LIMIT ? OFFSET ?
    `;
    return db.prepare(sql).all(...params, limit, offset);
  }

  /**
   * Incidents timeline with filters
   */
  getIncidents(resourceId, {
    limit = 50,
    offset = 0,
    status = 'all', // all | open | closed
    from = null,
    to = null,
    sort = 'desc',
  } = {}) {
    const clauses = ['resource_id = ?'];
    const params = [resourceId];

    if (status === 'open') {
      clauses.push('resolved_at IS NULL');
    } else if (status === 'closed') {
      clauses.push('resolved_at IS NOT NULL');
    }

    if (from) {
      clauses.push('started_at >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('started_at <= ?');
      params.push(to);
    }

    const order = sort === 'asc' ? 'ASC' : 'DESC';
    const sql = `
      SELECT
        id,
        resource_id,
        REPLACE(started_at, ' ', 'T') || 'Z' AS started_at,
        CASE
          WHEN resolved_at IS NULL THEN NULL
          ELSE REPLACE(resolved_at, ' ', 'T') || 'Z'
        END AS resolved_at
      FROM incidents
      WHERE ${clauses.join(' AND ')}
      ORDER BY started_at ${order}
      LIMIT ? OFFSET ?
    `;
    return db.prepare(sql).all(...params, limit, offset);
  }

  /**
   * SLA/SLO summary over a time window
   */
  getSlaSummary(resourceId, hours = 24) {
    const checks = db.prepare(`
      SELECT
        status,
        response_time,
        REPLACE(checked_at, ' ', 'T') || 'Z' AS checked_at
      FROM checks
      WHERE resource_id = ?
        AND checked_at >= datetime('now', '-' || ? || ' hours')
      ORDER BY checked_at ASC
    `).all(resourceId, hours);

    if (checks.length < 2) {
      return {
        windowHours: hours,
        uptimePct: 0,
        downtimeMinutes: 0,
        mttrMinutes: null,
        mtbfMinutes: null,
        p95LatencyMs: null,
        totalChecks: checks.length,
      };
    }

    let upMs = 0;
    let downMs = 0;
    const upRuns = [];
    const downRuns = [];

    for (let i = 0; i < checks.length - 1; i++) {
      const cur = checks[i];
      const next = checks[i + 1];
      const curTime = new Date(cur.checked_at).getTime();
      const nextTime = new Date(next.checked_at).getTime();
      const span = Math.max(0, nextTime - curTime);

      if (cur.status === 'up') {
        upMs += span;
        upRuns.push(span);
      } else {
        downMs += span;
        downRuns.push(span);
      }
    }

    const totalMs = upMs + downMs || 1;
    const uptimePct = 100 * (upMs / totalMs);

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const mttrMs = avg(downRuns);
    const mtbfMs = avg(upRuns);

    const latencies = checks
      .map(c => c.response_time)
      .filter(v => typeof v === 'number')
      .sort((a, b) => a - b);
    const p95LatencyMs = latencies.length
      ? latencies[Math.floor(0.95 * (latencies.length - 1))]
      : null;

    return {
      windowHours: hours,
      uptimePct: Number(uptimePct.toFixed(2)),
      downtimeMinutes: Number((downMs / 60000).toFixed(2)),
      mttrMinutes: mttrMs != null ? Number((mttrMs / 60000).toFixed(2)) : null,
      mtbfMinutes: mtbfMs != null ? Number((mtbfMs / 60000).toFixed(2)) : null,
      p95LatencyMs,
      totalChecks: checks.length,
    };
  }
}

module.exports = new MonitorService();
