# Quick Deployment Guide

## Step 1: Push to GitHub

1. **Create a new repository on GitHub:**
   - Go to https://github.com/new
   - Name it (e.g., "resource-monitor")
   - Don't initialize with README (we already have one)
   - Click "Create repository"

2. **Push your code from Windows:**
```powershell
cd c:\Users\NateEmmert\mon

# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - SkyWatch"

# Add your GitHub repository
git remote add origin https://github.com/nmemmert/monitor.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 2: Install on Ubuntu Server (ONE COMMAND)

On your Ubuntu server, run:

```bash
curl -fsSL https://raw.githubusercontent.com/nmemmert/monitor/main/install-ubuntu.sh | bash
```

**That's it!** The script will:
- Install everything needed
- Set up the application
- Configure it to start on boot
- Walk you through email/webhook setup

## Step 3: Access Your Dashboard

Open your browser and go to:
```
http://your-ubuntu-server-ip:3001

## Off-Box Build Workflow (Recommended for low-power servers)

If your server cannot build the React frontend, build locally on your development machine and deploy the prebuilt assets:

1. Build locally on Windows:
   ```powershell
   cd c:\Users\NateEmmert\mon
   npm run build
   git add -f client/build/
   git commit -m "Include prebuilt client/build for deployment"
   git push origin main
   ```

2. Update server without building:
   ```bash
   ssh root@<server-ip>
   cd /opt/resource-monitor
   git pull origin main
   pm2 restart resource-monitor
   pm2 logs resource-monitor --lines 100
   ```

3. Verify:
   - Open `http://<server-ip>:3001`
   - API responds: `curl http://localhost:3001/api/dashboard | head -c 500`
   - Logs show DB migration messages (e.g., email_to column)
```

You can find your server IP by running on Ubuntu:
```bash
hostname -I
```

## Alternative: Without GitHub

If you don't want to use GitHub:

1. **On Windows, build the project:**
```powershell
cd c:\Users\NateEmmert\mon\client
npm run build
```

2. **Transfer to Ubuntu using WinSCP/FileZilla:**
   - Transfer entire `mon` folder to `/home/yourusername/resource-monitor`

3. **On Ubuntu, run:**
```bash
cd ~/resource-monitor
chmod +x install-ubuntu.sh
./install-ubuntu.sh
```

## Managing the Service

Once installed, use these commands on Ubuntu:

```bash
# Check status
pm2 status

# View logs
pm2 logs resource-monitor

# Restart
pm2 restart resource-monitor

# Stop
pm2 stop resource-monitor

# Edit configuration
nano /opt/resource-monitor/.env
pm2 restart resource-monitor
```

## Troubleshooting

**Can't access dashboard from another computer?**
- Check firewall: `sudo ufw status`
- Open port: `sudo ufw allow 3001/tcp`

**Want to use a domain name?**
- Set up Nginx reverse proxy (see README.md)

**Service not starting on boot?**
```bash
pm2 startup
pm2 save
```
