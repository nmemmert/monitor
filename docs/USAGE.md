# Usage Guide

## Dashboard

The main dashboard provides a real-time overview of all monitored resources with their current status, uptime, and response times.

## History Page

The **History** page displays detailed check data for all monitored resources with interactive graphs and performance metrics.

### Time Window Selection

- **7 Days** - Default view, showing hourly averages (168 data points)
- **14 Days** - Shows 3-hourly averages (112 data points)
- **30 Days** - Shows 6-hourly averages (120 data points)

### Show Averages Toggle

The **"Show Averages"** checkbox controls how data is displayed:

#### When Enabled (Default)
- Data is **bucketed and averaged** server-side
- 7 Days: 1-hour buckets (168 points)
- 14 Days: 3-hour buckets (112 points)
- 30 Days: 6-hour buckets (120 points)
- **Benefit**: Much faster page load, cleaner graphs with averaged response times
- **Use when**: Viewing trends over time

#### When Disabled
- Shows up to 600 **raw individual checks** within the selected time window
- **Benefit**: See exact check-by-check performance, spot patterns
- **Use when**: Debugging specific issues, investigating downtime events

### Graph Display

Each resource shows:
- **Response Time (Blue Line)** - Average response time in milliseconds
- **Status Bars (Green/Red)** - 
  - 🟢 Green = Resource was UP during that period
  - 🔴 Red = Resource was DOWN during that period

### Statistics

Below each graph:
- **Total Checks** - Number of checks performed in the time window
- **Uptime %** - Percentage of checks that were successful (green = higher is better)
- **Avg Response** - Average response time in milliseconds
- **Successful Checks** - Count of successful vs total checks (e.g., 5592/5593)

### Performance Notes

- **Averaged mode** is optimized for performance and uses server-side aggregation
- **Non-averaged mode** can be slower with large datasets (>600 checks)
- Cache is updated every 2 minutes for averaged data
- Each time window (7/14/30 days) has separate cache entries

## Settings Page

Configure global monitoring settings and notifications.

### Email Notifications

1. Toggle "Email Notifications" on
2. Select your email provider (Gmail, Outlook, Yahoo, or Custom)
3. Enter your email credentials
4. **For Gmail**: Use an App Password (see instructions in the UI)
5. Click "Send Test Email" to verify

### Webhook Notifications

1. Toggle "Webhook Notifications" on
2. Enter your webhook URL (Slack, Discord, etc.)
3. Click "Send Test Webhook" to verify

### Other Settings

- Timezone configuration
- Data retention period
- Alert thresholds
- SLA targets

## Adding Resources

1. Click "Add Resource" on the dashboard
2. Enter resource details:
   - **Name**: Friendly name (e.g., "ZimaOS Home Server")
   - **URL**: Full URL to monitor (e.g., "https://your-zima.example.com")
   - **Check Interval**: How often to check (in milliseconds)
   - **Timeout**: Maximum time to wait for response
   - **Email To**: Email address for alerts (resource-specific)
   - **HTTP Keyword**: Optional keyword to search for in response
   - **SLA Target**: Target uptime percentage for this resource

## SLA Report

View Service Level Agreement compliance for all resources over configurable time periods.
