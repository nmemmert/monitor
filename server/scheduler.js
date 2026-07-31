const cron = require('node-cron');
const db = require('./database');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');

class Scheduler {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
    this.lastCheckedAt = new Map();
    this.slowAlertCooldown = new Map();
  }

  start() {
    // Run checks every minute
    cron.schedule('* * * * *', async () => {
      if (!this.isRunning) {
        this.isRunning = true;
        try {
          await this.runChecks();
        } finally {
          this.isRunning = false;
        }
      }
    });

    // Archive old checks daily at 2 AM
    cron.schedule('0 2 * * *', () => {
      this.archiveOldChecks();
    });

    // Also run archive on startup (with delay to let DB init)
    setTimeout(() => {
      this.archiveOldChecks();
    }, 5000);
  }

  archiveOldChecks() {
    try {
      // Get global retention setting
      const retentionSetting = db.prepare(`
        SELECT value FROM settings WHERE key = 'retention_days'
      `).get();
      
      const globalRetentionDays = retentionSetting ? parseInt(retentionSetting.value) : 30;

      // Get all resources with their retention settings
      const resources = db.prepare(`
        SELECT id, retention_days FROM resources
      `).all();

      const bulkArchive = db.prepare(`
        INSERT INTO archived_checks (resource_id, status, response_time, status_code, error_message, details, checked_at)
        SELECT resource_id, status, response_time, status_code, error_message, details, checked_at
        FROM checks WHERE resource_id = ? AND checked_at < ?
      `);
      const bulkDelete = db.prepare(`DELETE FROM checks WHERE resource_id = ? AND checked_at < ?`);

      const transaction = db.transaction(() => {
        resources.forEach(resource => {
          const retentionDays = resource.retention_days || globalRetentionDays;
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
          const cutoffString = cutoffDate.toISOString().replace('T', ' ').split('.')[0];
          bulkArchive.run(resource.id, cutoffString);
          bulkDelete.run(resource.id, cutoffString);
        });
      });

      transaction();
    } catch (error) {
      // Archive error handled silently
    }
  }

  async runChecks() {
    const resources = db.prepare(`
      SELECT * FROM resources WHERE enabled = 1
    `).all();

    // Stagger checks to avoid thundering herd
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const jitter = (maxMs = 1500) => Math.floor(Math.random() * maxMs);

    const baseSpacingMs = 250; // spread starts in 250ms increments
    const tasks = resources.map((resource, index) => (async () => {
      // Honour per-resource check_interval — skip if not yet due
      const now = Date.now();
      const lastChecked = this.lastCheckedAt.get(resource.id) || 0;
      const interval = resource.check_interval || 60000;
      if (now - lastChecked < interval) return;
      this.lastCheckedAt.set(resource.id, now);

      await sleep(index * baseSpacingMs + jitter());
      try {
        const result = await monitorService.checkResource(resource);
        monitorService.saveCheck(result);

        // Rolling cap per resource (configurable via settings; default 10000)
        try {
          const capSetting = db.prepare(`SELECT value FROM settings WHERE key = 'checks_cap_per_resource'`).get();
          const cap = capSetting ? parseInt(capSetting.value) : 10000;
          if (Number.isFinite(cap) && cap > 0) {
            const rowCount = db.prepare('SELECT COUNT(*) as cnt FROM checks WHERE resource_id = ?').get(resource.id).cnt;
            const excess = rowCount - cap;
            if (excess > 0) {
              db.prepare(`
                DELETE FROM checks WHERE id IN (
                  SELECT id FROM checks WHERE resource_id = ? ORDER BY id ASC LIMIT ?
                )
              `).run(resource.id, excess);
            }
          }
        } catch (e) {
          // Non-fatal
        }

        const incident = monitorService.handleIncident(
          resource.id,
          result.status === 'down'
        );

        if (incident.type !== 'none') {
          const stats = monitorService.getResourceStats(resource.id, 24);
          const recentChecks = db.prepare(`
            SELECT response_time, status FROM checks
            WHERE resource_id = ?
            ORDER BY checked_at DESC
            LIMIT 12
          `).all(resource.id);
          stats.recentChecks = recentChecks.reverse();
          if (!resource.maintenance_mode) {
            await notificationService.sendAlert(resource, incident, stats);
          }
        }

        // Response time threshold alert (only when up, with 1-hour cooldown)
        if (
          result.status === 'up' &&
          resource.response_time_threshold &&
          result.response_time > resource.response_time_threshold &&
          !resource.maintenance_mode
        ) {
          const lastSlowAlert = this.slowAlertCooldown.get(resource.id) || 0;
          if (now - lastSlowAlert > 60 * 60 * 1000) {
            this.slowAlertCooldown.set(resource.id, now);
            await notificationService.sendAlert(resource, {
              type: 'slow',
              responseTime: result.response_time,
              threshold: resource.response_time_threshold,
              id: null,
            });
          }
        }
      } catch (error) {
        // Check error handled silently
      }
    })());

    await Promise.allSettled(tasks);

    // Broadcast updated dashboard to all connected WebSocket clients
    if (global.broadcastDashboardUpdate) {
      global.broadcastDashboardUpdate();
    }
  }

  stop() {
    // Stop the scheduler (cron tasks will continue running but we flag isRunning)
    this.isRunning = false;
  }
}

module.exports = new Scheduler();
