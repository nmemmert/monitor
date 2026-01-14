const cron = require('node-cron');
const db = require('./database');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');

class Scheduler {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
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

      const insertArchived = db.prepare(`
        INSERT INTO archived_checks (resource_id, status, response_time, status_code, error_message, details, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const deleteOld = db.prepare(`
        DELETE FROM checks WHERE id = ?
      `);

      const transaction = db.transaction(() => {
        resources.forEach(resource => {
          // Use per-resource retention if set, otherwise use global
          const retentionDays = resource.retention_days || globalRetentionDays;
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
          const cutoffString = cutoffDate.toISOString().replace('T', ' ').split('.')[0];

          // Get old checks for this resource
          const oldChecks = db.prepare(`
            SELECT * FROM checks WHERE resource_id = ? AND checked_at < ?
          `).all(resource.id, cutoffString);

          oldChecks.forEach(check => {
            insertArchived.run(
              check.resource_id,
              check.status,
              check.response_time,
              check.status_code,
              check.error_message,
              check.details,
              check.checked_at
            );
            deleteOld.run(check.id);
          });
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
      await sleep(index * baseSpacingMs + jitter());
      try {
        const result = await monitorService.checkResource(resource);
        monitorService.saveCheck(result);

        // Rolling cap per resource (configurable via settings; default 10000)
        try {
          const capSetting = db.prepare(`SELECT value FROM settings WHERE key = 'checks_cap_per_resource'`).get();
          const cap = capSetting ? parseInt(capSetting.value) : 10000;
          if (Number.isFinite(cap) && cap > 0) {
            // Delete oldest rows beyond cap, using id ordering per resource
            db.prepare(`
              DELETE FROM checks
              WHERE id IN (
                SELECT id FROM checks
                WHERE resource_id = ?
                ORDER BY id ASC
                LIMIT (
                  SELECT MAX(COUNT(*) - ?, 0)
                  FROM checks WHERE resource_id = ?
                )
              )
            `).run(resource.id, cap, resource.id);
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
