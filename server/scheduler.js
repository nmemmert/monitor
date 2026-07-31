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

    // Archive old checks + update baselines + check escalations daily at 2 AM
    cron.schedule('0 2 * * *', () => {
      this.archiveOldChecks();
      this.updateBaselines();
    });

    // Escalation check runs every hour
    cron.schedule('0 * * * *', async () => {
      await this.checkEscalations();
    });

    // Also run archive on startup (with delay to let DB init)
    setTimeout(() => {
      this.archiveOldChecks();
      this.updateBaselines();
    }, 5000);
  }

  archiveOldChecks() {
    try {
      const retentionSetting = db.prepare(`SELECT value FROM settings WHERE key = 'retention_days'`).get();
      const globalRetentionDays = retentionSetting ? parseInt(retentionSetting.value) : 30;

      const resources = db.prepare(`SELECT id, retention_days FROM resources`).all();

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

  updateBaselines() {
    try {
      const resources = db.prepare(`SELECT id, type FROM resources WHERE type != 'heartbeat'`).all();
      for (const resource of resources) {
        const baseline = monitorService.calculateResponseTimeBaseline(resource.id, 7);
        if (baseline !== null) {
          db.prepare(`UPDATE resources SET response_time_baseline = ? WHERE id = ?`).run(baseline, resource.id);
        }
      }
    } catch (error) {
      // Baseline update error handled silently
    }
  }

  async checkEscalations() {
    try {
      const escalationSetting = db.prepare(`SELECT value FROM settings WHERE key = 'escalation_hours'`).get();
      const escalationHours = parseInt(escalationSetting?.value || '4');
      const fallbackSetting = db.prepare(`SELECT value FROM settings WHERE key = 'fallback_webhook'`).get();
      const fallbackWebhook = fallbackSetting?.value || process.env.FALLBACK_WEBHOOK || '';

      if (!fallbackWebhook) return;

      const cutoff = new Date(Date.now() - escalationHours * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').split('.')[0];

      const stalled = db.prepare(`
        SELECT i.*, r.name AS resource_name, r.url AS resource_url, r.type AS resource_type,
               r.maintenance_mode
        FROM incidents i
        JOIN resources r ON r.id = i.resource_id
        WHERE i.resolved_at IS NULL AND i.escalated = 0 AND i.started_at < ?
          AND r.maintenance_mode = 0
      `).all(cutoff);

      for (const incident of stalled) {
        await notificationService.sendEscalationAlert(incident, fallbackWebhook);
        db.prepare(`UPDATE incidents SET escalated = 1 WHERE id = ?`).run(incident.id);
      }
    } catch (error) {
      // Escalation check error handled silently
    }
  }

  async runChecks() {
    const resources = db.prepare(`SELECT * FROM resources WHERE enabled = 1`).all();

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const jitter = (maxMs = 1500) => Math.floor(Math.random() * maxMs);
    const baseSpacingMs = 250;

    // Collect incident alerts to flush as a group after all checks complete
    const pendingAlerts = [];

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

        const incident = monitorService.handleIncident(resource.id, result.status === 'down');

        if (incident.type !== 'none' && !resource.maintenance_mode) {
          const stats = monitorService.getResourceStats(resource.id, 24);
          const recentChecks = db.prepare(`
            SELECT response_time, status FROM checks
            WHERE resource_id = ?
            ORDER BY checked_at DESC LIMIT 12
          `).all(resource.id);
          stats.recentChecks = recentChecks.reverse();
          pendingAlerts.push({ resource, incident, stats });
        }

        // Slow alert: prefer explicit threshold, fall back to 2× computed baseline
        const effectiveThreshold = resource.response_time_threshold ||
          (resource.response_time_baseline ? resource.response_time_baseline * 2 : null);

        if (
          result.status === 'up' &&
          effectiveThreshold &&
          result.response_time > effectiveThreshold &&
          !resource.maintenance_mode
        ) {
          const lastSlowAlert = this.slowAlertCooldown.get(resource.id) || 0;
          if (now - lastSlowAlert > 60 * 60 * 1000) {
            this.slowAlertCooldown.set(resource.id, now);
            await notificationService.sendAlert(resource, {
              type: 'slow',
              responseTime: result.response_time,
              threshold: effectiveThreshold,
              id: null,
            });
          }
        }
      } catch (error) {
        // Check error handled silently
      }
    })());

    await Promise.allSettled(tasks);

    // Flush collected alerts — grouped if multiple fired in the same cycle
    await notificationService.flushAlerts(pendingAlerts);

    // Broadcast updated dashboard to all connected WebSocket clients
    if (global.broadcastDashboardUpdate) {
      global.broadcastDashboardUpdate();
    }
  }

  stop() {
    this.isRunning = false;
  }
}

module.exports = new Scheduler();
