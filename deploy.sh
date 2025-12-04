#!/bin/bash
# Deployment Script for Resource Monitor (Linux/Mac)

echo "🚀 Resource Monitor - Deployment Preparation"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run this from the project root."
    exit 1
fi

echo "📦 Step 1: Building React application..."
cd client || exit
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi
cd ..
echo "✅ Build complete!"
echo ""

echo "📋 Step 2: Creating deployment package..."
DEPLOY_DIR="deploy-package"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# Copy necessary files
cp -r server "$DEPLOY_DIR/"
cp -r client/build "$DEPLOY_DIR/client/"
cp package.json "$DEPLOY_DIR/"
cp .env.example "$DEPLOY_DIR/"
cp README.md "$DEPLOY_DIR/"
cp .gitignore "$DEPLOY_DIR/"

# Create data directory
mkdir -p "$DEPLOY_DIR/data"

echo "✅ Package created in 'deploy-package' folder!"
echo ""

echo "📝 Step 3: Creating deployment instructions..."
cat > "$DEPLOY_DIR/DEPLOY.md" << 'EOF'
# Deployment Instructions

## Quick Start on Remote Server

1. Copy the entire 'deploy-package' folder to your remote server
2. On the remote server, navigate to the folder
3. Run these commands:

### For Linux/Mac:
```bash
npm install --production
cp .env.example .env
nano .env  # Edit configuration
npm start
```

### For Windows:
```powershell
npm install --production
Copy-Item .env.example .env
notepad .env  # Edit configuration
npm start
```

4. Access the dashboard at http://your-server-ip:3001

## Keep It Running

### Using PM2 (Recommended):
```bash
npm install -g pm2
pm2 start server/index.js --name resource-monitor
pm2 save
pm2 startup
```

### As a systemd service (Linux):
```bash
sudo nano /etc/systemd/system/resource-monitor.service
```

Add:
```ini
[Unit]
Description=Resource Monitor
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/deploy-package
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable resource-monitor
sudo systemctl start resource-monitor
```

## Firewall
Make sure port 3001 is open:
```bash
sudo ufw allow 3001/tcp
```

## Configuration
Edit the .env file to configure:
- Email notifications
- Webhook notifications
- Port number
- Check intervals

Enjoy monitoring your resources! 🎉
EOF

echo "✅ Instructions created!"
echo ""

echo "🎉 Deployment package ready!"
echo ""
echo "Next steps:"
echo "1. Transfer the 'deploy-package' folder to your remote computer"
echo "2. Follow instructions in deploy-package/DEPLOY.md"
echo ""
echo "Transfer methods:"
echo "- SCP: scp -r deploy-package user@remote:/path/to/destination"
echo "- Rsync: rsync -av deploy-package/ user@remote:/path/to/destination/"
echo "- Git: Push to repository and clone on remote"
echo ""
