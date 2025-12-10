const cron = require('node-cron');
const db = require('./database');
const monitorService = require('./monitorService');
const notificationService = require('./notificationService');

class Scheduler {
  constructor() {
    this.jobs = new Map();
  }

  start() {
    // Run checks every minute
    cron.schedule('* * * * *', async () => {
      await this.runChecks();
    });

    // Clean old checks every hour (keep last 7 days)
    cron.schedule('0 * * * *', () => {
      db.prepare(`
        DELETE FROM checks 
        WHERE checked_at < datetime('now', '-7 days')
      `).run();
    });

    console.log('Scheduler started');
  }

  async runChecks() {
    const resources = db.prepare(`
      SELECT * FROM resources WHERE enabled = 1
    `).all();

    for (const resource of resources) {
      try {
        const result = await monitorService.checkResource(resource);
        monitorService.saveCheck(result);

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
          await notificationService.sendAlert(resource, incident, stats);
        }

        console.log(`Checked ${resource.name}: ${result.status} (${result.response_time}ms)`);
      } catch (error) {
        console.error(`Error checking ${resource.name}:`, error.message);
      }
    }
  }
}

module.exports = new Scheduler();
