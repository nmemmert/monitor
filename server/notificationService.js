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
    const isDown = incident.type === 'started';
    const statusEmoji = isDown ? '🔴' : '🟢';
    const statusText = isDown ? 'DOWN' : 'UP';
    
    const message = `${statusEmoji} ${resource.name} is ${statusText}!\n\nURL: ${resource.url}\nCheck Type: ${resource.type || 'http'}\nTime: ${new Date().toLocaleString()}`;

    const promises = [];

    if (this.emailEnabled) {
      promises.push(this.sendEmail(resource, message, incident.type, stats));
    }

    if (this.webhookEnabled) {
      promises.push(this.sendWebhook(resource, message, incident.type));
    }

    await Promise.allSettled(promises);
  }

  async sendEmail(resource, message, type, stats = null) {
    if (!this.transporter) {
      console.error('Email config incomplete; skipping email');
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
        htmlContent += `
          <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
            <h3 style="margin-top: 0;">Last 24 Hours Performance</h3>
            <p><strong>Uptime:</strong> ${(stats.uptime * 100).toFixed(2)}%</p>
            <p><strong>Avg Response Time:</strong> ${stats.avgResponseTime.toFixed(0)}ms</p>
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

      await this.transporter.sendMail({
        from: this.config.email_from,
        to: this.config.email_to,
        subject: `Alert: ${resource.name} is ${type === 'started' ? 'DOWN' : 'UP'}`,
        text: message,
        html: htmlContent,
      });
      console.log(`Email sent for ${resource.name}`);
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
