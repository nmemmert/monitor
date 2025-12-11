#!/bin/bash
# SkyWatch - One-Click Ubuntu Installation Script (Root Compatible)
# Usage: curl -fsSL https://raw.githubusercontent.com/nmemmert/monitor/main/install-ubuntu-root.sh | bash

set -e

echo "SkyWatch - Ubuntu Installation"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "Running as root. Creating dedicated user 'monitor'..."
   if ! id "monitor" &>/dev/null; then
       useradd -m -s /bin/bash monitor
       echo "Created user 'monitor'"
   fi
   SERVICE_USER="monitor"
else
   SERVICE_USER="$USER"
fi

INSTALL_DIR="/opt/resource-monitor"

echo "Installation will:"
echo "  - Install Node.js 20.x (if needed)"
echo "  - Install PM2 process manager"
echo "  - Clone repository to $INSTALL_DIR"
echo "  - Install dependencies"
echo "  - Open firewall port 3001"
echo ""
echo "Continuing installation..."

# Update system
echo ""
echo "Step 1: Updating system packages..."
apt-get update -qq

# Install Node.js
if ! command -v node &> /dev/null; then
    echo ""
    echo "Step 2: Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo ""
    echo "Node.js already installed: $(node --version)"
fi

# Install git
if ! command -v git &> /dev/null; then
    echo ""
    echo "Installing Git..."
    apt-get install -y git
fi

# Install PM2
echo ""
echo "Step 3: Installing PM2..."
npm install -g pm2

# Clone repository
echo ""
echo "Step 4: Cloning repository..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory exists, updating..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone "https://github.com/nmemmert/monitor.git" "$INSTALL_DIR"
    chown -R $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo ""
echo "Step 5: Installing dependencies..."
# For low-memory servers, limit memory usage
NODE_OPTIONS="--max-old-space-size=512" npm install --production --no-optional 2>&1 | tail -50 || npm install --production

# Build client
echo ""
echo "Step 6: Building frontend..."
cd client
npm install
npm run build
cd ..

# Setup configuration
echo ""
echo "Step 7: Setting up configuration..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "Created .env file"
fi

if ! grep -q "NODE_ENV" .env; then
    echo "NODE_ENV=production" >> .env
fi

mkdir -p data

# Firewall
echo ""
echo "Step 8: Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 3001/tcp 2>/dev/null || true
    echo "Port 3001 opened"
fi

# Start with PM2
echo ""
echo "Step 9: Starting application..."
if [ "$EUID" -eq 0 ]; then
    su - $SERVICE_USER -c "cd $INSTALL_DIR && pm2 delete resource-monitor 2>/dev/null || true"
    su - $SERVICE_USER -c "cd $INSTALL_DIR && pm2 start server/index.js --name resource-monitor"
    su - $SERVICE_USER -c "pm2 save"
    env PATH=$PATH:/usr/bin pm2 startup systemd -u $SERVICE_USER --hp /home/$SERVICE_USER
    su - $SERVICE_USER -c "pm2 save"
else
    pm2 delete resource-monitor 2>/dev/null || true
    pm2 start server/index.js --name resource-monitor
    pm2 save
    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER
    pm2 save
fi

SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo "Installation Complete!"
echo "=========================================="
echo ""
echo "Access dashboard at: http://$SERVER_IP:3001"
echo ""
echo "Commands:"
echo "  pm2 status"
echo "  pm2 logs resource-monitor"
echo "  pm2 restart resource-monitor"
echo ""
echo "Configure notifications:"
echo "  nano $INSTALL_DIR/.env"
echo "  pm2 restart resource-monitor"
echo ""
