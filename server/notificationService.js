const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

class NotificationService {
  constructor() {
    this.emailEnabled = process.env.EMAIL_ENABLED === 'true';
    this.webhookEnabled = process.env.WEBHOOK_ENABLED === 'true';

    if (this.emailEnabled) {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT),
        secure: false,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
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
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
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
      await axios.post(process.env.WEBHOOK_URL, {
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
