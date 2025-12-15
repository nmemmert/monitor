# Deployment Guide

## Option 1: Direct Copy (Simplest)

1. **On your local machine:**
```bash
# Build the React app
cd client
npm run build
cd ..

# Create a deployment package
# Copy these folders/files to remote:
# - server/
# - client/build/
# - data/ (optional, will be created if missing)
# - package.json
# - .env.example
```

2. **On the remote computer:**
```bash
# Install Node.js if not already installed
# Copy the files to a directory (e.g., /opt/resource-monitor or C:\monitor)

# Install dependencies
npm install

# Copy .env.example to .env and configure
cp .env.example .env
nano .env  # or use notepad on Windows

# Set NODE_ENV to production
# Add to .env: NODE_ENV=production

# Start the server
npm start
```

3. **Access the dashboard:**
   - Visit `http://your-remote-ip:3001`

## Option 2: Git Repository (Best Practice)

1. **Initialize git and push to repository:**
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin your-git-repo-url
git push -u origin main
```

2. **On remote computer:**
```bash
git clone your-git-repo-url
cd resource-monitor
npm run install-all
cd client && npm run build && cd ..
cp .env.example .env
nano .env  # Configure your settings
npm start
```

## Option 3: Docker Deployment (Advanced)

Create `Dockerfile` in project root:
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
WORKDIR /app/client
RUN npm install && npm run build
WORKDIR /app
EXPOSE 3001
CMD ["node", "server/index.js"]
```

Then deploy:
```bash
docker build -t resource-monitor .
docker run -d -p 3001:3001 -v ./data:/app/data --name monitor resource-monitor
```

## Deployment Workflow (Critical!)

**⚠️ IMPORTANT: Always commit build files when deploying changes:**

```bash
# Make your code changes
npm run build
git add -f client/build/
git commit -m "Update build files"
git push

# Then on remote server:
cd /opt/resource-monitor
git pull
pm2 restart monitor
# Hard-refresh browser (Ctrl+Shift+R) to clear cache
```

### Why?

The React build creates new bundle file hashes each time. If you don't commit the build files:
- ❌ Old cached HTML points to old JS bundle hashes
- ❌ New JS files aren't in git, so remote server gets old builds
- ❌ White screen / script loading errors

### Solution:
Always commit build files to git before deploying!

## Running as a Service (Keep it Running)

### Linux (systemd)

Create `/etc/systemd/system/skywatch.service`:
```ini
[Unit]
Description=SkyWatch
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/opt/skywatch
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable resource-monitor
sudo systemctl start resource-monitor
```

### Windows (NSSM - Non-Sucking Service Manager)

```powershell
# Download NSSM from nssm.cc
nssm install ResourceMonitor "C:\Program Files\nodejs\node.exe"
nssm set ResourceMonitor AppDirectory "C:\monitor"
nssm set ResourceMonitor AppParameters "server\index.js"
nssm start ResourceMonitor
```

### Cross-platform (PM2)

```bash
# Install PM2 globally
npm install -g pm2

# Start the application
pm2 start server/index.js --name resource-monitor

# Save the process list
pm2 save

# Set PM2 to start on boot
pm2 startup
```

## Firewall Configuration

Make sure port 3001 is accessible:

### Linux (UFW)
```bash
sudo ufw allow 3001/tcp
```

### Windows
```powershell
New-NetFirewallRule -DisplayName "SkyWatch" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
```

## Reverse Proxy (Optional but Recommended)

Use Nginx to serve on port 80/443:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
