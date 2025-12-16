const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

class NotificationService {
  constructor() {
    this.applyConfigFromEnv();
  }

  applyConfigFromEnv() {
    this.setConfig({
      email_enabled: process.env.EMAIL_ENABLED === 'true',
      email_host: process.env.EMAIL_HOST,
      email_port: parseInt(process.env.EMAIL_PORT),
      email_user: process.env.EMAIL_USER,
      email_pass: process.env.EMAIL_PASS,
      email_from: process.env.EMAIL_FROM,
      email_to: process.env.EMAIL_TO,
      webhook_enabled: process.env.WEBHOOK_ENABLED === 'true',
      webhook_url: process.env.WEBHOOK_URL,
    });
  }

  setConfig(config) {
    this.emailEnabled = !!config.email_enabled;
    this.webhookEnabled = !!config.webhook_enabled;
    this.config = config;

    // Recreate transporter when email config changes; skip if incomplete
    if (
      this.emailEnabled &&
      config.email_host &&
      config.email_port &&
      config.email_user &&
      config.email_pass
    ) {
      this.transporter = nodemailer.createTransport({
        host: config.email_host,
        port: parseInt(config.email_port),
        secure: false,
        auth: {
          user: config.email_user,
          pass: config.email_pass,
        },
      });
    } else {
      this.transporter = null;
    }
  }

  async sendAlert(resource, incident, stats = null) {
    // Check if incident is acknowledged
    if (incident.acknowledged) {
      console.log(`Incident ${incident.id} already acknowledged, skipping alert`);
      return;
    }

    // Check maintenance windows
    if (this.isInMaintenanceWindow(resource.id)) {
      console.log(`Resource ${resource.name} is in maintenance window, skipping alert`);
      return;
    }

    // Check quiet hours
    if (this.isQuietHours(resource)) {
      console.log(`Resource ${resource.name} is in quiet hours, skipping alert`);
      return;
    }

    const isDown = incident.type === 'started';
    const statusEmoji = isDown ? '🔴' : '🟢';
    const statusText = isDown ? 'DOWN' : 'UP';
    
    const message = `${statusEmoji} ${resource.name} is ${statusText}!\n\nURL: ${resource.url}\nCheck Type: ${resource.type || 'http'}\nTime: ${new Date().toLocaleString()}`;

    const promises = [];

    // Use resource-specific email if provided, otherwise fall back to global config
      if (this.emailEnabled && (resource.email_to || this.config.email_to)) {
        const targetsCsv = resource.email_to || this.config.email_to;
        const targets = String(targetsCsv)
          .split(',')
          .map(t => t.trim())
          .filter(t => t && /.+@.+\..+/.test(t));
        if (targets.length > 0) {
          for (const email of targets) {
            promises.push(this.sendEmail(resource, message, incident.type, stats, email));
          }
        }
    } else {
      if (!this.emailEnabled) {
        // Email globally disabled
      } else {
        // No email target configured
      }
    }

    if (this.webhookEnabled) {
      promises.push(this.sendWebhook(resource, message, incident.type));
    }

    await Promise.allSettled(promises);
  }

  isQuietHours(resource) {
    if (!resource.quiet_hours_start || !resource.quiet_hours_end) {
      return false;
    }

    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const [startHour, startMin] = resource.quiet_hours_start.split(':').map(Number);
    const [endHour, endMin] = resource.quiet_hours_end.split(':').map(Number);
    
    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    // Handle overnight quiet hours
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }
    
    return currentTime >= startTime && currentTime < endTime;
  }

  async sendEmail(resource, message, type, stats = null, emailOverride = null) {
    if (!this.transporter) {
      console.error(`[Email] Config incomplete; skipping email (enabled=${this.emailEnabled}, host=${this.config.email_host})`);
      return;
    }

    try {
      let htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${type === 'started' ? '#d32f2f' : '#388e3c'};">${type === 'started' ? '🔴 Alert' : '🟢 Recovered'}</h2>
          <p><strong>Resource:</strong> ${resource.name}</p>
          <p><strong>Status:</strong> ${type === 'started' ? 'DOWN' : 'UP'}</p>
          <p><strong>URL:</strong> <a href="${resource.url}">${resource.url}</a></p>
          <p><strong>Check Type:</strong> ${resource.type || 'http'}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      `;

      if (stats) {
        const uptimePct = Number(stats.uptime);
        const avgMs = Number(stats.avgResponseTime);

        htmlContent += `
          <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
            <h3 style="margin-top: 0;">Last 24 Hours Performance</h3>
            <p><strong>Uptime:</strong> ${Number.isFinite(uptimePct) ? (uptimePct * 100).toFixed(2) : 'N/A'}%</p>
            <p><strong>Avg Response Time:</strong> ${Number.isFinite(avgMs) ? avgMs.toFixed(0) : 'N/A'}ms</p>
            <p><strong>Last Check:</strong> ${stats.lastCheck || 'Never'}</p>
        `;

        if (stats.recentChecks && stats.recentChecks.length > 0) {
          const graph = this.generateAsciiGraph(stats.recentChecks);
          htmlContent += `
            <p><strong>Recent Response Times (last 12 checks):</strong></p>
            <pre style="background: #fff; padding: 10px; border-left: 3px solid #2196F3; font-size: 12px;">${graph}</pre>
          `;
        }

        htmlContent += `</div>`;
      }

      htmlContent += `</div>`;

      // Use resource-specific email if provided, otherwise use global config
      const emailTo = emailOverride || resource.email_to || this.config.email_to;
      
      await this.transporter.sendMail({
        from: this.config.email_from,
        to: emailTo,
        subject: `Alert: ${resource.name} is ${type === 'started' ? 'DOWN' : 'UP'}`,
        text: message,
        html: htmlContent,
      });
      console.log(`Email sent for ${resource.name} to ${emailTo}`);
    } catch (error) {
      console.error('Email error:', error.message);
    }
  }

  generateAsciiGraph(recentChecks) {
    if (!recentChecks || recentChecks.length === 0) return '';

    // Get last 12 checks and their response times
    const checks = recentChecks.slice(-12);
    const times = checks.map(c => c.response_time || 0);
    const maxTime = Math.max(...times);
    
    if (maxTime === 0) return 'No data';

    // Simple ASCII bar chart (8 rows)
    const height = 8;
    let graph = '';
    
    for (let row = height; row > 0; row--) {
      const threshold = (maxTime / height) * row;
      for (const time of times) {
        graph += time >= threshold ? '█' : ' ';
      }
      graph += '\n';
    }
    
    // Add baseline
    graph += times.map(() => '─').join('') + '\n';
    
    // Add labels
    graph += `0ms${' '.repeat(Math.max(0, times.length - 5))}${(maxTime).toFixed(0)}ms`;

    return graph;
  }

  isInMaintenanceWindow(resourceId) {
    try {
      const db = require('./database');
      const now = new Date().toISOString().split('.')[0];
      const window = db.prepare(`
        SELECT id FROM maintenance_windows
        WHERE resource_id = ? AND start_time <= ? AND end_time > ?
        LIMIT 1
      `).get(resourceId, now, now);
      
      return !!window;
    } catch (error) {
      console.error('Error checking maintenance window:', error.message);
      return false;
    }
  }

  async sendWebhook(resource, message, type) {
    try {
      await axios.post(this.config.webhook_url || process.env.WEBHOOK_URL, {
        resource: resource.name,
        url: resource.url,
        status: type === 'started' ? 'down' : 'up',
        message,
        timestamp: new Date().toISOString(),
      });
      console.log(`Webhook sent for ${resource.name}`);
    } catch (error) {
      console.error('Webhook error:', error.message);
    }
  }
}

module.exports = new NotificationService();
