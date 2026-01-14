# SkyWatch

A comprehensive monitoring system for tracking the uptime and performance of your resources.

## Features

- 📊 **Real-time Dashboard** - Monitor all your resources at a glance
- 📈 **Performance Graphs** - Visualize response times and uptime statistics with intelligent averaging
- 🔔 **Alert Notifications** - Email and webhook alerts when resources go offline
- 📝 **Incident Tracking** - Track when resources go down and recover
- ⚙️ **Configurable Checks** - Set custom check intervals and timeouts
- 🗄️ **Historical Data** - Configurable data retention with per-resource overrides
- 📊 **Observability Dashboard** - View metrics, errors, and audit logs with expandable changes
- 🔐 **Data Retention Management** - Global settings + per-resource retention overrides

## Quick Start

### Installation

See [Installation Guide](docs/INSTALLATION.md) for detailed setup instructions.

**Quick Install on Ubuntu:**
```bash
curl -fsSL https://raw.githubusercontent.com/nmemmert/monitor/main/install-ubuntu.sh | bash
```

### First Steps

1. [Install SkyWatch](docs/INSTALLATION.md)
2. [Deploy to Your Server](docs/DEPLOYMENT.md)
3. [Learn How to Use](docs/USAGE.md)

## Documentation

| Topic | Description |
|-------|-------------|
| [📦 Installation](docs/INSTALLATION.md) | Quick install, manual setup, dev/prod modes |
| [🚀 Deployment](docs/DEPLOYMENT.md) | Deploy to remote servers, Docker, services, firewall |
| [📚 Usage Guide](docs/USAGE.md) | Dashboard, History, Settings, Resources, SLA Reports |
| [⬆️ Upgrade Guide](docs/UPGRADE.md) | How to upgrade to new versions |
| [🆘 Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |

## History Feature

The History page shows detailed check data with two viewing modes:

- **Averaged Mode** (Default) - Server-side bucketing for fast, clean graphs
  - 7 Days: 1-hour buckets
  - 14 Days: 3-hour buckets  
  - 30 Days: 6-hour buckets

- **Raw Mode** - Up to 600 individual checks for detailed analysis

See [Usage Guide → History Page](docs/USAGE.md#history-page) for details.

## Global Settings

Configure default settings for your entire monitoring system in the **Settings Tab**:

### 📧 Email Notifications
- SMTP configuration with Gmail, Outlook, Yahoo, or custom providers
- Test email functionality
- Fallback support for failed notifications

### 🔗 Webhook Notifications  
- Send incident data to Slack, Discord, or custom webhooks
- Test webhook functionality
- Fallback webhook as backup

### ⏱️ Default Monitoring Settings
- **Check Interval** - How often to check resources (default: 60,000ms = 1 minute)
- **Request Timeout** - Maximum time to wait for a response (default: 5,000ms)
- **Data Retention** - How many days to keep check data (1-365 days, default: 30)
- **Timezone** - Local timezone for all timestamps
- **Consecutive Failures Threshold** - Number of failures before triggering alert (default: 3)
- **Incident Failure Threshold** - Number of failures before creating incident (default: 10)
- **Grace Period** - Wait time before alerting after first failure (default: 300s)
- **Downtime Threshold** - Minimum downtime before creating incident (default: 600s)

### 🔔 Alert Settings
- **Alert Retry Logic** - How many times to retry failed alerts (default: 3)
- **Retry Delay** - Wait time between retries (default: 60s)
- **Fallback Webhook** - Backup webhook if primary notifications fail
- **Global Quiet Hours** - Suppress non-critical alerts during specific times
- **Escalation Hours** - Escalate unresolved incidents after this time (default: 4 hours)

### 📊 Dashboard Settings
- **Default Sort Order** - How to sort resources in dashboard
- **Items Per Page** - Pagination size for resource lists (default: 20)
- **Dashboard Refresh Interval** - How often to fetch fresh data (default: 5,000ms = 5 seconds)
- **Auto Cleanup** - Automatically archive old check data based on retention period

## Data Retention System

SkyWatch supports **two-tier data retention**:

### Global Retention (Default)
Set in Settings → Default Monitoring Settings → "Global Data Retention"
- Applies to all resources by default
- Retained check data is archived after the specified number of days
- Can be overridden per-resource

### Per-Resource Retention (Override)
Set when creating or editing a resource:
- Leave blank to use global setting
- Enter a specific number (1-365) to override global retention for that resource
- Useful for critical services (longer retention) or dev environments (shorter retention)

Example:
- Global retention: 30 days
- Production API: 90 days (critical data)
- Dev server: 7 days (less important)

### How Archival Works
The scheduler runs daily at 2 AM to:
1. Check each resource for its retention setting (per-resource or global)
2. Move old checks to `archived_checks` table
3. Delete from active `checks` table

## Observability Dashboard

View detailed system observability data in the **Observability Tab**:

### 📊 Metrics
- API request counts and success rates
- Response time statistics
- Error counts by endpoint
- Performance trends

### ❌ Errors
- Recent errors with stack traces
- Error frequency and patterns
- Detailed error context

### 📋 Audit Logs
- Complete change history of all resources, settings, and groups
- Filter by entity type, ID, user, or action
- **Expandable Changes** - Click "▶ Show Changes" to see full JSON of what changed
  - Shows old values and new values
  - Helps track configuration changes over time
  - Click "▼ Hide" to collapse

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
│   ├── src/
│   │   ├── App.js      # Main React component
│   │   ├── History.js  # History page with graphs
│   │   └── App.css     # Styles
│   └── build/          # Production bundle (committed to git)
├── docs/               # Documentation
├── data/               # SQLite database (auto-created)
├── .env                # Environment configuration
└── package.json
```

## Support

Having issues? Check the [Troubleshooting Guide](docs/TROUBLESHOOTING.md) for solutions to common problems.

## License

MIT
