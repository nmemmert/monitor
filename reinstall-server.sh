#!/bin/bash
# Complete reinstallation script for SkyWatch
# Run this to completely reinstall on your server

set -e

echo "🗑️  Complete Reinstallation of SkyWatch"
echo "========================================"
echo ""

# Stop and remove PM2 processes
echo "1️⃣  Stopping existing processes..."
pm2 stop all || true
pm2 delete all || true
pm2 save --force

# Backup database if it exists
if [ -f "/opt/resource-monitor/data/monitor.db" ]; then
    echo "💾 Backing up database..."
    mkdir -p /tmp/skywatch-backup
    cp /opt/resource-monitor/data/monitor.db /tmp/skywatch-backup/monitor.db.backup
    echo "✅ Database backed up to /tmp/skywatch-backup/monitor.db.backup"
fi

# Remove old installation
echo "2️⃣  Removing old installation..."
cd /opt
rm -rf resource-monitor

# Clone fresh from GitHub
echo "3️⃣  Cloning latest code from GitHub..."
git clone https://github.com/nmemmert/monitor.git resource-monitor
cd resource-monitor

# Restore database
if [ -f "/tmp/skywatch-backup/monitor.db.backup" ]; then
    echo "📥 Restoring database..."
    mkdir -p data
    cp /tmp/skywatch-backup/monitor.db.backup data/monitor.db
    echo "✅ Database restored"
fi

# Install dependencies with memory limit for low-power servers
echo "4️⃣  Installing dependencies (this may take 5-10 minutes)..."
NODE_OPTIONS="--max-old-space-size=512" npm install --production --no-optional 2>&1 | tail -20

# Create .env if needed
if [ ! -f ".env" ]; then
    echo "5️⃣  Creating .env file..."
    cp .env.example .env 2>/dev/null || echo "NODE_ENV=production" > .env
fi

# Create data directory if it doesn't exist
echo "5️⃣  Creating data directory..."
mkdir -p data

# Start with PM2
echo "6️⃣  Starting application..."
pm2 start server/index.js --name resource-monitor
pm2 save

# Setup PM2 to start on boot
echo "7️⃣  Configuring auto-start..."
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
pm2 save

echo ""
echo "✅ Installation complete!"
echo ""
echo "📊 Application status:"
pm2 status

echo ""
echo "📋 Recent logs (check for database migration):"
sleep 2
pm2 logs resource-monitor --lines 20 --nostream

SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "========================================"
echo "✅ SkyWatch is running!"
echo "🌐 Access at: http://$SERVER_IP:3001"
echo ""
echo "Useful commands:"
echo "  pm2 status               - Check status"
echo "  pm2 logs resource-monitor - View logs"
echo "  pm2 restart resource-monitor - Restart app"
echo "========================================"
