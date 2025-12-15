# SkyWatch

A comprehensive monitoring system for tracking the uptime and performance of your resources.

## Features

- 📊 **Real-time Dashboard** - Monitor all your resources at a glance
- 📈 **Performance Graphs** - Visualize response times and uptime statistics with intelligent averaging
- 🔔 **Alert Notifications** - Email and webhook alerts when resources go offline
- 📝 **Incident Tracking** - Track when resources go down and recover
- ⚙️ **Configurable Checks** - Set custom check intervals and timeouts
- 🗄️ **Historical Data** - 7 days of check history with detailed statistics

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
| [🆘 Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |

## History Feature

The History page shows detailed check data with two viewing modes:

- **Averaged Mode** (Default) - Server-side bucketing for fast, clean graphs
  - 7 Days: 1-hour buckets
  - 14 Days: 3-hour buckets  
  - 30 Days: 6-hour buckets

- **Raw Mode** - Up to 600 individual checks for detailed analysis

See [Usage Guide → History Page](docs/USAGE.md#history-page) for details.

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
