#!/bin/bash
# Resource Monitor - One-Click Ubuntu Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/nmemmert/monitor/main/install-ubuntu.sh | bash
# Or: wget -qO- https://raw.githubusercontent.com/nmemmert/monitor/main/install-ubuntu.sh | bash

set -e

echo "🚀 Resource Monitor - Ubuntu Installation"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "⚠️  Running as root. Creating dedicated user 'monitor'..."
   # Create monitor user if doesn't exist
   if ! id "monitor" &>/dev/null; then
       useradd -m -s /bin/bash monitor
       echo "✅ Created user 'monitor'"
   fi
   SERVICE_USER="monitor"
else
   SERVICE_USER="$USER"
fi

# Install directory
INSTALL_DIR="/opt/resource-monitor"

echo "📋 Installation will:"
echo "  - Install Node.js 20.x (if needed)"
echo "  - Install PM2 process manager"
echo "  - Clone repository to $INSTALL_DIR"
echo "  - Install dependencies"
echo "  - Set up systemd service"
echo "  - Open firewall port 3001"
echo ""

# Skip confirmation if running non-interactively or with -y flag
if [ -t 0 ]; then
    read -p "Continue? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "Running in non-interactive mode, continuing..."
fi

# Update system
echo ""
echo "📦 Step 1: Updating system packages..."
apt-get update -qq

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo ""
    echo "📦 Step 2: Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo ""
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install git if not present
if ! command -v git &> /dev/null; then
    echo ""
    echo "📦 Installing Git..."
    apt-get install -y git
fi

# Install PM2 globally
echo ""
echo "📦 Step 3: Installing PM2 process manager..."
npm install -g pm2

# Clone or update repository
echo ""
echo "📥 Step 4: Setting up application..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory exists, updating..."
    cd "$INSTALL_DIR"
    git pull
else
    echo "Cloning repository..."
    REPO_URL="https://github.com/nmemmert/monitor.git"
    git clone "$REPO_URL" "$INSTALL_DIR"
    chown -R $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo ""
echo "📦 Step 5: Installing Node.js dependencies..."
npm install --production

# Build client
echo ""
echo "🔨 Step 6: Building React frontend..."
cd client
npm install
npm run build
cd ..

# Setup configuration
echo ""
echo "⚙️  Step 7: Setting up configuration..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✅ Created .env file"
    
    # Skip interactive config if running non-interactively
    if [ -t 0 ]; then
        echo ""
        echo "📝 Configure your settings:"
        read -p "Enable email notifications? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "SMTP Host (e.g., smtp.gmail.com): " SMTP_HOST
        read -p "SMTP Port (e.g., 587): " SMTP_PORT
        read -p "Email Username: " EMAIL_USER
        read -s -p "Email Password/App Password: " EMAIL_PASS
        echo ""
        read -p "From Email: " EMAIL_FROM
        read -p "To Email (for alerts): " EMAIL_TO
        
        sed -i "s/EMAIL_ENABLED=false/EMAIL_ENABLED=true/" .env
        sed -i "s/EMAIL_HOST=smtp.gmail.com/EMAIL_HOST=$SMTP_HOST/" .env
        sed -i "s/EMAIL_PORT=587/EMAIL_PORT=$SMTP_PORT/" .env
        sed -i "s/EMAIL_USER=your-email@gmail.com/EMAIL_USER=$EMAIL_USER/" .env
        sed -i "s/EMAIL_PASS=your-app-password/EMAIL_PASS=$EMAIL_PASS/" .env
        sed -i "s/EMAIL_FROM=your-email@gmail.com/EMAIL_FROM=$EMAIL_FROM/" .env
        sed -i "s/EMAIL_TO=your-email@gmail.com/EMAIL_TO=$EMAIL_TO/" .env
        fi
        
        echo ""
        read -p "Enable webhook notifications? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            read -p "Webhook URL: " WEBHOOK_URL
            sed -i "s/WEBHOOK_ENABLED=false/WEBHOOK_ENABLED=true/" .env
            sed -i "s|WEBHOOK_URL=https://your-webhook-url.com|WEBHOOK_URL=$WEBHOOK_URL|" .env
        fi
    else
        echo "⚠️  Running non-interactively. You can configure notifications later in $INSTALL_DIR/.env"
    fi
else
    echo "✅ .env file already exists"
fi

# Set NODE_ENV to production
if ! grep -q "NODE_ENV" .env; then
    echo "NODE_ENV=production" >> .env
fi

# Create data directory
mkdir -p data

# Setup firewall
echo ""
echo "🔥 Step 8: Configuring firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 3001/tcp 2>/dev/null || echo "⚠️  Could not configure UFW automatically"
    echo "✅ Port 3001 opened in firewall"
else
    echo "⚠️  UFW not found, please open port 3001 manually"
fi

# Start with PM2
echo ""
echo "🚀 Step 9: Starting application with PM2..."
if [ "$EUID" -eq 0 ]; then
    # Running as root, start PM2 as monitor user
    su - $SERVICE_USER -c "cd $INSTALL_DIR && pm2 stop resource-monitor 2>/dev/null || true"
    su - $SERVICE_USER -c "cd $INSTALL_DIR && pm2 delete resource-monitor 2>/dev/null || true"
    su - $SERVICE_USER -c "cd $INSTALL_DIR && pm2 start server/index.js --name resource-monitor"
    su - $SERVICE_USER -c "pm2 save"
    
    # Setup PM2 startup
    echo ""
    echo "🔄 Step 10: Setting up auto-start on boot..."
    env PATH=$PATH:/usr/bin pm2 startup systemd -u $SERVICE_USER --hp /home/$SERVICE_USER
    su - $SERVICE_USER -c "pm2 save"
else
    # Running as regular user
    pm2 stop resource-monitor 2>/dev/null || true
    pm2 delete resource-monitor 2>/dev/null || true
    pm2 start server/index.js --name resource-monitor
    pm2 save
    
    # Setup PM2 startup
    echo ""
    echo "🔄 Step 10: Setting up auto-start on boot..."
    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER
    pm2 save
fi

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=============================================="
echo "✅ Installation Complete!"
echo "=============================================="
echo ""
echo "🎉 Resource Monitor is now running!"
echo ""
echo "📊 Access your dashboard at:"
echo "   http://$SERVER_IP:3001"
echo "   http://localhost:3001 (if on same machine)"
echo ""
echo "🔧 Useful commands:"
echo "   pm2 status              - Check status"
echo "   pm2 logs resource-monitor  - View logs"
echo "   pm2 restart resource-monitor - Restart"
echo "   pm2 stop resource-monitor    - Stop"
echo ""
echo "⚙️  To change settings:"
echo "   nano $INSTALL_DIR/.env"
echo "   pm2 restart resource-monitor"
echo ""
echo "📝 Add your first resource:"
echo "   1. Open the dashboard in your browser"
echo "   2. Click 'Add Resource'"
echo "   3. Enter your ZimaOS URL and details"
echo ""
echo "Happy monitoring! 🚀"
