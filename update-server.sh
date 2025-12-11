#!/bin/bash
# Quick update script for SkyWatch on remote server
# Run this on the server: bash update-server.sh

set -e

echo "🔄 Updating SkyWatch..."

cd /opt/resource-monitor

echo "📥 Pulling latest code..."
git pull origin main

echo "📦 Installing dependencies..."
rm -rf node_modules package-lock.json
npm ci --only=production 2>&1 | tail -20

echo "🔄 Restarting application..."
pm2 restart resource-monitor

echo "✅ Waiting for startup..."
sleep 3

echo "📋 Checking status..."
pm2 status resource-monitor

echo ""
echo "📊 Recent logs (checking for database migration):"
pm2 logs resource-monitor --lines 30 --nostream

echo ""
echo "✅ Update complete!"
echo "🌐 Check your dashboard at http://$(hostname -I | awk '{print $1}'):3001"
