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

  async sendAlert(resource, incident) {
    const message = incident.type === 'started'
      ? `🔴 ${resource.name} is DOWN!\n\nURL: ${resource.url}\nTime: ${new Date().toLocaleString()}`
      : `🟢 ${resource.name} is back UP!\n\nURL: ${resource.url}\nTime: ${new Date().toLocaleString()}`;

    const promises = [];

    if (this.emailEnabled) {
      promises.push(this.sendEmail(resource, message, incident.type));
    }

    if (this.webhookEnabled) {
      promises.push(this.sendWebhook(resource, message, incident.type));
    }

    await Promise.allSettled(promises);
  }

  async sendEmail(resource, message, type) {
    if (!this.transporter) {
      console.error('Email config incomplete; skipping email');
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.config.email_from,
        to: this.config.email_to,
        subject: `Alert: ${resource.name} is ${type === 'started' ? 'DOWN' : 'UP'}`,
        text: message,
      });
      console.log(`Email sent for ${resource.name}`);
    } catch (error) {
      console.error('Email error:', error.message);
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
