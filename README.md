# SkyWatch

A comprehensive monitoring system for tracking the uptime and performance of your ZimaOS server and other online resources.

## Features

- 📊 **Real-time Dashboard** - Monitor all your resources at a glance
- 📈 **Performance Graphs** - Visualize response times and uptime statistics
- 🔔 **Alert Notifications** - Email and webhook alerts when resources go offline
- 📝 **Incident Tracking** - Track when resources go down and recover
- ⚙️ **Configurable Checks** - Set custom check intervals and timeouts
- 🗄️ **Historical Data** - 7 days of check history with detailed statistics

## Installation

### Quick Install on Ubuntu (One Command)

```bash
curl -fsSL https://raw.githubusercontent.com/nmemmert/monitor/main/install-ubuntu.sh | bash
```

The script will:
- ✅ Install Node.js 20.x
- ✅ Install PM2 process manager
- ✅ Clone and set up the application
- ✅ Configure firewall
- ✅ Set up auto-start on boot
- ✅ Guide you through email/webhook setup

### Manual Installation

#### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

#### Setup

1. Install dependencies for both server and client:
```bash
npm run install-all
```

2. Create a `.env` file in the root directory (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Configure your `.env` file:
```env
PORT=3001

# Email Notifications (optional)
EMAIL_ENABLED=true
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=your-email@gmail.com
EMAIL_TO=your-email@gmail.com

# Webhook Notifications (optional)
WEBHOOK_ENABLED=false
WEBHOOK_URL=https://your-webhook-url.com
```

## Usage

### Development Mode

Run both server and client in development mode:
```bash
npm run dev
```

- Server runs on http://localhost:3001
- Client runs on http://localhost:3000

### Production Mode

Build and run in production:
```bash
npm run build
npm start
```

Server will serve the built React app on http://localhost:3001

## Deploying to a Remote Computer

### Option 1: Direct Copy (Simplest)

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

### Option 2: Git Repository (Best Practice)

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

### Option 3: Docker Deployment (Advanced)

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

### Deployment Workflow (Critical!)

**⚠️ IMPORTANT: Always use `npm run build:commit` when deploying changes:**

```bash
# Make your code changes
npm run build:commit  # This builds React AND commits the build files to git
# Or manually:
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

**Why?** The React build creates new bundle file hashes each time. If you don't commit the build files:
- ❌ Old cached HTML points to old JS bundle hashes
- ❌ New JS files aren't in git, so remote server gets old builds
- ❌ White screen / script loading errors

**Solution:** Always commit build files to git before deploying!

### Running as a Service (Keep it Running)

**Linux (systemd):**
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

**Windows (NSSM - Non-Sucking Service Manager):**
```powershell
# Download NSSM from nssm.cc
nssm install ResourceMonitor "C:\Program Files\nodejs\node.exe"
nssm set ResourceMonitor AppDirectory "C:\monitor"
nssm set ResourceMonitor AppParameters "server\index.js"
nssm start ResourceMonitor
```

**Using PM2 (Cross-platform):**
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

### Firewall Configuration

Make sure port 3001 is accessible:

**Linux (UFW):**
```bash
sudo ufw allow 3001/tcp
```

**Windows:**
```powershell
New-NetFirewallRule -DisplayName "SkyWatch" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow
```

### Reverse Proxy (Optional but Recommended)

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

### Configuring Notifications (Setup Wizard)

1. Navigate to **Settings** in the top navigation
2. Configure email notifications:
   - Toggle "Email Notifications" on
   - Select your email provider (Gmail, Outlook, Yahoo, or Custom)
   - Enter your email credentials
   - **For Gmail**: Use an App Password (see instructions in the UI)
   - Click "Send Test Email" to verify
3. Configure webhook notifications (optional):
   - Toggle "Webhook Notifications" on
   - Enter your webhook URL (Slack, Discord, etc.)
   - Click "Send Test Webhook" to verify
4. Click "Save Settings"

### Adding Resources

1. Click "Add Resource" on the dashboard
2. Enter resource details:
   - **Name**: Friendly name (e.g., "ZimaOS Home Server")
   - **URL**: Full URL to monitor (e.g., "https://your-zima.example.com")
   - **Check Interval**: How often to check (in milliseconds)
   - **Timeout**: Maximum time to wait for response

### Viewing History

The **History** page displays detailed check data for all monitored resources with interactive graphs and performance metrics.

#### Time Window Selection

- **7 Days** - Default view, showing hourly averages (168 data points)
- **14 Days** - Shows 3-hourly averages (112 data points)
- **30 Days** - Shows 6-hourly averages (120 data points)

#### Show Averages Toggle

The **"Show Averages"** checkbox controls how data is displayed:

**When Enabled (Default):**
- Data is **bucketed and averaged** server-side
- 7 Days: 1-hour buckets (168 points)
- 14 Days: 3-hour buckets (112 points)
- 30 Days: 6-hour buckets (120 points)
- **Benefit**: Much faster page load, cleaner graphs with averaged response times
- **Use when**: Viewing trends over time

**When Disabled:**
- Shows up to 600 **raw individual checks** within the selected time window
- **Benefit**: See exact check-by-check performance, spot patterns
- **Use when**: Debugging specific issues, investigating downtime events

#### Graph Display

Each resource shows:
- **Response Time (Blue Line)** - Average response time in milliseconds
- **Status Bars (Green/Red)** - 
  - 🟢 Green = Resource was UP during that period
  - 🔴 Red = Resource was DOWN during that period

#### Statistics

Below each graph:
- **Total Checks** - Number of checks performed in the time window
- **Uptime %** - Percentage of checks that were successful (green = higher is better)
- **Avg Response** - Average response time in milliseconds
- **Successful Checks** - Count of successful vs total checks (e.g., 5592/5593)

#### Performance Notes

- **Averaged mode** is optimized for performance and uses server-side aggregation
- **Non-averaged mode** can be slower with large datasets (>600 checks)
- Cache is updated every 2 minutes for averaged data
- Each time window (7/14/30 days) has separate cache entries

## API Endpoints

- `GET /api/resources` - List all resources
- `POST /api/resources` - Create new resource
- `GET /api/resources/:id` - Get resource details
- `PUT /api/resources/:id` - Update resource
- `DELETE /api/resources/:id` - Delete resource
- `GET /api/dashboard` - Dashboard overview
- `GET /api/incidents` - Recent incidents

## Project Structure

```
mon/
├── server/              # Backend Node.js/Express
│   ├── index.js        # Main server file
│   ├── database.js     # SQLite database setup
│   ├── monitorService.js
│   ├── notificationService.js
│   └── scheduler.js
├── client/             # React frontend
│   └── src/
│       ├── App.js      # Main React component
│       └── App.css     # Styles
├── data/               # SQLite database (auto-created)
├── .env                # Environment configuration
└── package.json
```

## Configuration

### Check Intervals

The monitoring system checks all enabled resources every minute. You can customize individual resource check intervals through the UI.

### Data Retention

- Check history: 7 days
- Incidents: Indefinitely (manual cleanup)

## Troubleshooting

### Port Already in Use

If port 3001 is already in use, change it in `.env`:
```env
PORT=3002
```

### Email Not Sending

- Verify SMTP credentials
- Check that 2FA is enabled and app password is used
- Test with a simple SMTP client first

### Resource Not Being Checked

- Verify resource is enabled
- Check server logs for errors
- Ensure URL is accessible from server

## License

MIT
