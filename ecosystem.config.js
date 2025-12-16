module.exports = {
  apps: [{
    name: 'resource-monitor',
    script: './server/index.js',
    // Force single forked instance to avoid port conflicts
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      TIMEZONE: 'America/New_York'
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
      TIMEZONE: 'America/New_York'
    }
  }]
};
