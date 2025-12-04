const axios = require('axios');
const db = require('./database');

class MonitorService {
  async checkResource(resource) {
    const startTime = Date.now();
    let result = {
      resource_id: resource.id,
      status: 'down',
      response_time: null,
      status_code: null,
      error_message: null,
    };

    try {
      const response = await axios.get(resource.url, {
        timeout: resource.timeout,
        validateStatus: () => true, // Don't throw on any status
      });

      const responseTime = Date.now() - startTime;
      const isUp = response.status >= 200 && response.status < 400;

      result = {
        ...result,
        status: isUp ? 'up' : 'down',
        response_time: responseTime,
        status_code: response.status,
        error_message: isUp ? null : `HTTP ${response.status}`,
      };
    } catch (error) {
      result.error_message = error.message;
      result.response_time = Date.now() - startTime;
    }

    return result;
  }

  saveCheck(check) {
    const stmt = db.prepare(`
      INSERT INTO checks (resource_id, status, response_time, status_code, error_message)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      check.resource_id,
      check.status,
      check.response_time,
      check.status_code,
      check.error_message
    );
  }

  getLastCheck(resourceId) {
    return db.prepare(`
      SELECT * FROM checks 
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
      SELECT * FROM checks 
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
}

module.exports = new MonitorService();
