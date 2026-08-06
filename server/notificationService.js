const nodemailer = require('nodemailer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
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
      webhook_template: process.env.WEBHOOK_TEMPLATE || '',
      ntfy_enabled: process.env.NTFY_ENABLED === 'true',
      ntfy_url: process.env.NTFY_URL || 'https://ntfy.sh',
      ntfy_topic: process.env.NTFY_TOPIC || '',
    });
  }

  setConfig(config) {
    this.emailEnabled = !!config.email_enabled;
    this.webhookEnabled = !!config.webhook_enabled;
    this.ntfyEnabled = !!config.ntfy_enabled;
    this.config = { ...this.config, ...config };

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
        connectionTimeout: 10000,
        socketTimeout: 10000,
      });
    } else {
      this.transporter = null;
    }
  }

  async sendAlert(resource, incident, stats = null) {
    // Check if incident is acknowledged
    if (incident.acknowledged) {
      return;
    }

    // Check maintenance windows
    if (this.isInMaintenanceWindow(resource.id)) {
      return;
    }

    // Check quiet hours
    if (this.isQuietHours(resource)) {
      return;
    }

    const isDown = incident.type === 'started';
    const isSlow = incident.type === 'slow';
    const statusEmoji = isDown ? '🔴' : isSlow ? '🟡' : '🟢';
    const statusText = isDown ? 'DOWN' : isSlow ? 'SLOW' : 'UP';
    const slowDetail = isSlow ? `\nResponse Time: ${incident.responseTime}ms (threshold: ${incident.threshold}ms)` : '';

    const message = `${statusEmoji} ${resource.name} is ${statusText}!\n\nURL: ${resource.url}\nCheck Type: ${resource.type || 'http'}\nTime: ${new Date().toLocaleString()}${slowDetail}`;

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

    if (this.ntfyEnabled) {
      promises.push(this.sendNtfy(resource, incident.type));
    }

    await Promise.allSettled(promises);

    // Save notification to in-app notification center
    const status = isDown ? 'down' : isSlow ? 'slow' : 'up';
    this.saveNotification(resource, incident, status, message);
  }

  saveNotification(resource, incident, status, message) {
    try {
      const db = require('./database');
      const title = status === 'down'
        ? `🔴 ${resource.name} is DOWN`
        : status === 'slow'
          ? `🟡 ${resource.name} is SLOW`
          : `🟢 ${resource.name} is UP`;
      
      const result = db.prepare(`
        INSERT INTO notifications (resource_id, incident_id, type, title, message, read)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run(
        resource.id,
        incident.id || null,
        status,
        title,
        message
      );

      // Broadcast new notification to WebSocket clients in real-time
      if (global.broadcastNotification) {
        global.broadcastNotification({
          id: result.lastInsertRowid,
          resource_id: resource.id,
          resource_name: resource.name,
          incident_id: incident.id || null,
          type: status,
          title,
          message,
          read: 0,
          created_at: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Failed to save notification:', error.message);
    }
  }

  async flushAlerts(pendingAlerts) {
    if (pendingAlerts.length === 0) return;
    if (pendingAlerts.length === 1) {
      const { resource, incident, stats } = pendingAlerts[0];
      await this.sendAlert(resource, incident, stats);
      return;
    }
    // Multiple alerts in one check cycle — save individual in-app entries but send one grouped email/webhook
    for (const { resource, incident } of pendingAlerts) {
      const status = incident.type === 'started' ? 'down' : 'up';
      const message = `${resource.name} is ${status.toUpperCase()}. URL: ${resource.url}`;
      this.saveNotification(resource, incident, status, message);
    }
    await this.sendGroupedEmail(pendingAlerts);
    if (this.webhookEnabled) {
      await this.sendGroupedWebhook(pendingAlerts);
    }
    if (this.ntfyEnabled) {
      const ntfyUrl = this.config.ntfy_url || 'https://ntfy.sh';
      const ntfyTopic = this.config.ntfy_topic;
      if (ntfyTopic) {
        try {
          const groupedBody = pendingAlerts.map(({ resource, incident }) =>
            `${incident.type === 'started' ? '[DOWN]' : '[UP]'} ${resource.name}`
          ).join('\n');
          await axios.post(`${ntfyUrl.replace(/\/$/, '')}/${ntfyTopic}`, groupedBody, {
            headers: {
              Title: encodeURIComponent(`${pendingAlerts.length} monitors changed status`),
              Priority: 'high',
              Tags: 'warning',
            },
          });
        } catch (_) {}
      }
    }
  }

  async sendGroupedEmail(alerts) {
    if (!this.transporter) return;
    const targetEmail = this.config.email_to;
    if (!targetEmail || !this.emailEnabled) return;
    try {
      const rows = alerts.map(({ resource, incident }) => {
        const status = incident.type === 'started' ? 'DOWN' : 'UP';
        const emoji = incident.type === 'started' ? '🔴' : '🟢';
        return `<li>${emoji} <strong>${resource.name}</strong> is ${status} — ${resource.url}</li>`;
      }).join('');
      await this.transporter.sendMail({
        from: this.config.email_from,
        to: targetEmail,
        subject: `⚠️ ${alerts.length} monitors changed status`,
        text: alerts.map(({ resource, incident }) =>
          `${resource.name} is ${incident.type === 'started' ? 'DOWN' : 'UP'} — ${resource.url}`
        ).join('\n'),
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
          <h2 style="color:#d32f2f">⚠️ ${alerts.length} Monitors Changed Status</h2>
          <ul>${rows}</ul>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        </div>`,
      });
    } catch (error) {
      // Grouped email error handled
    }
  }

  async sendGroupedWebhook(alerts) {
    const webhookUrl = this.config.webhook_url || process.env.WEBHOOK_URL;
    if (!webhookUrl) return;
    try {
      await axios.post(webhookUrl, {
        type: 'grouped_alert',
        count: alerts.length,
        resources: alerts.map(({ resource, incident }) => ({
          name: resource.name,
          url: resource.url,
          status: incident.type === 'started' ? 'down' : 'up',
        })),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Grouped webhook error handled
    }
  }

  async sendEscalationAlert(incident, fallbackWebhookUrl) {
    try {
      const durationMin = Math.round((Date.now() - new Date(incident.started_at).getTime()) / 60000);
      const message = `⚠️ ESCALATION: ${incident.resource_name} has been DOWN for ${durationMin} minutes without resolution.`;
      if (fallbackWebhookUrl) {
        await axios.post(fallbackWebhookUrl, {
          resource: incident.resource_name,
          url: incident.resource_url,
          status: 'escalated',
          duration_minutes: durationMin,
          incident_id: incident.id,
          started_at: incident.started_at,
          message,
          timestamp: new Date().toISOString(),
        });
      }
      this.saveNotification(
        { id: incident.resource_id, name: incident.resource_name, url: incident.resource_url },
        { id: incident.id },
        'escalated',
        message
      );
    } catch (error) {
      // Escalation alert error handled
    }
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
      return;
    }

    try {
      const logoPath = path.join(__dirname, '..', 'client', 'public', 'app-icon.png');
      const hasLogo = fs.existsSync(logoPath);
      const logoCid = 'skywatch-app-icon';
      const logoBlock = hasLogo
        ? `<div style="margin-bottom: 12px;"><img src="cid:${logoCid}" alt="SkyWatch" style="height: 40px; width: 40px; border-radius: 8px;" /></div>`
        : '';

      const isSlow = type === 'slow';
      const isDown = type === 'started';
      const headingColor = isDown ? '#d32f2f' : isSlow ? '#f57c00' : '#388e3c';
      const headingText = isDown ? '🔴 Alert' : isSlow ? '🟡 Slow Response' : '🟢 Recovered';
      const statusLabel = isDown ? 'DOWN' : isSlow ? 'SLOW' : 'UP';

      let htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${logoBlock}
          <h2 style="color: ${headingColor};">${headingText}</h2>
          <p><strong>Resource:</strong> ${resource.name}</p>
          <p><strong>Status:</strong> ${statusLabel}</p>
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
        subject: `Alert: ${resource.name} is ${type === 'started' ? 'DOWN' : type === 'slow' ? 'SLOW' : 'UP'}`,
        text: message,
        html: htmlContent,
        attachments: hasLogo
          ? [{ filename: 'app-icon.png', path: logoPath, cid: logoCid }]
          : [],
      });
    } catch (error) {
      // Email error handled
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
      return false;
    }
  }

  async sendWebhook(resource, message, type) {
    try {
      const webhookUrl = this.config.webhook_url || process.env.WEBHOOK_URL;
      const status = type === 'started' ? 'down' : type === 'slow' ? 'slow' : 'up';
      const template = this.config.webhook_template;

      let payload;
      if (template) {
        const interpolated = template
          .replace(/\{\{name\}\}/g, resource.name)
          .replace(/\{\{status\}\}/g, status)
          .replace(/\{\{url\}\}/g, resource.url)
          .replace(/\{\{type\}\}/g, resource.type || 'http')
          .replace(/\{\{message\}\}/g, message)
          .replace(/\{\{timestamp\}\}/g, new Date().toISOString());
        try {
          payload = JSON.parse(interpolated);
        } catch {
          // Template is plain text (e.g. Slack text field), wrap it
          payload = { text: interpolated };
        }
      } else {
        payload = {
          resource: resource.name,
          url: resource.url,
          status,
          message,
          timestamp: new Date().toISOString(),
        };
      }

      await axios.post(webhookUrl, payload);
    } catch (error) {
      // Webhook error handled silently
    }
  }

  async sendNtfy(resource, type) {
    const ntfyUrl = this.config.ntfy_url || 'https://ntfy.sh';
    const ntfyTopic = this.config.ntfy_topic;
    if (!ntfyTopic) return;

    const isDown = type === 'started';
    const isSlow = type === 'slow';
    const titleText = isDown ? `${resource.name} is DOWN` : isSlow ? `${resource.name} is SLOW` : `${resource.name} is UP`;
    const priority = isDown ? 'high' : isSlow ? 'default' : 'low';
    const tags = isDown ? 'red_circle,warning' : isSlow ? 'yellow_circle' : 'green_circle,white_check_mark';
    const body = resource.url || resource.name;

    try {
      await axios.post(`${ntfyUrl.replace(/\/$/, '')}/${ntfyTopic}`, body, {
        headers: {
          Title: encodeURIComponent(titleText),
          Priority: priority,
          Tags: tags,
        },
      });
    } catch (error) {
      // ntfy error handled silently
    }
  }
}

module.exports = new NotificationService();
