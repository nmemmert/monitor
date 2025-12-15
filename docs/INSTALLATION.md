# Installation Guide

## Quick Install on Ubuntu (One Command)

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

## Manual Installation

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn

### Setup

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

## Development Mode

Run both server and client in development mode:
```bash
npm run dev
```

- Server runs on http://localhost:3001
- Client runs on http://localhost:3000

## Production Mode

Build and run in production:
```bash
npm run build
npm start
```

Server will serve the built React app on http://localhost:3001
