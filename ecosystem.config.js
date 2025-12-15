module.exports = {
  apps: [{
    name: 'resource-monitor',
    script: './server/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      TIMEZONE: 'America/New_York'
    }
  }]
};
