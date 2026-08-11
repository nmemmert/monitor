#!/bin/bash
# SkyWatch update script — run on the server to pull and deploy the latest version.
# The React client is built locally and committed to git before running this.
# Usage: bash update-server.sh
set -e

APP_DIR="/opt/resource-monitor"

echo "==> Updating SkyWatch at ${APP_DIR} ..."
cd "$APP_DIR"

echo "==> Pulling latest code (includes pre-built client) ..."
git pull origin main

echo "==> Installing/updating server dependencies ..."
npm install --omit=dev 2>&1 | tail -20

echo "==> Restarting application via PM2 ..."
pm2 restart resource-monitor

echo "==> Waiting for startup ..."
sleep 4

echo "==> Status:"
pm2 status resource-monitor

echo ""
echo "==> Health check:"
curl -s http://localhost:3001/api/health | grep -o '"status":"[^"]*"' || echo "(no response yet)"

echo ""
echo "✅ Update complete!"
