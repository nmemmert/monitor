#!/bin/bash
# SkyWatch update script — run on the server to pull and deploy the latest version
# Usage: bash update-server.sh [--skip-build]
set -e

APP_DIR="/opt/resource-monitor"
SKIP_BUILD=false
for arg in "$@"; do [[ "$arg" == "--skip-build" ]] && SKIP_BUILD=true; done

echo "==> Updating SkyWatch at ${APP_DIR} ..."
cd "$APP_DIR"

echo "==> Pulling latest code ..."
git pull origin main

echo "==> Installing/updating server dependencies ..."
# Use npm install (not ci + rm -rf) so existing compatible packages stay in place
npm install --omit=dev 2>&1 | tail -20

if [ "$SKIP_BUILD" = false ]; then
  echo "==> Building React client ..."
  cd client
  npm install 2>&1 | tail -10
  npm run build 2>&1 | tail -20
  cd ..
else
  echo "==> Skipping client build (--skip-build flag set)"
fi

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
