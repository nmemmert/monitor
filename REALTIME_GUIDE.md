# Real-Time Updates & Observability - Quick Reference

## 🔔 Real-Time Notifications

### User Experience:
- **Toast notifications** appear in top-right corner when:
  - Incident is detected (resource down)
  - Incident is resolved (resource back up)
  - Critical alerts are triggered
- Auto-dismiss after 5 seconds
- Multiple notifications stack vertically

### WebSocket Message Types:
```javascript
// Dashboard update
{ type: 'dashboard', data: { resources: [...], groups: [...] } }

// Alert
{ type: 'alert', data: { resourceName: '...', message: '...' } }

// Incident
{ type: 'incident', data: { type: 'started'|'resolved', resourceName: '...' } }

// Metrics
{ type: 'metrics', data: { uptime: ..., apiStats: [...], errorCount: ... } }
```

---

## 📊 Observability Dashboard

### Access: 
**Navigation Bar** → **Observability** or `/observability`

### Tab 1: API Metrics
Shows performance insights:
- **Server Uptime**: How long the server has been running
- **Total API Requests**: Total requests since startup
- **Errors Logged**: Total errors logged
- **Unique Errors**: Number of distinct error types

**Endpoint Performance Table:**
| Column | Meaning |
|--------|---------|
| Endpoint | HTTP method + path |
| Requests | Total requests to this endpoint |
| Success Rate % | Percentage successful (200-399 status) |
| Avg Response | Average response time in milliseconds |
| Min/Max | Best and worst response times |

### Tab 2: Errors
Lists recent application errors:
- **Error Message**: What went wrong
- **Context**: Where it happened (endpoint, IP)
- **Occurred At**: Timestamp of error

### Tab 3: Audit Logs
Complete change history with filtering:

**Summary Section:**
- Shows events from last 7 days
- Breakdown by action type (create, update, delete)

**Filters:**
- **Entity Type**: resource, settings, group, maintenance_window
- **Entity ID**: ID of the changed entity
- **User ID**: Who made the change (usually "system" for automated)
- **Action**: create, update, delete

**Audit Log Columns:**
| Column | Meaning |
|--------|---------|
| Action | What happened (create/update/delete) |
| Entity | Type and ID of affected resource |
| User | Who made the change |
| Changes | What changed (shown as JSON snippet) |
| Time | When it happened |

---

## 📈 API Endpoints for Integration

### Get Metrics
```bash
GET /api/observability/metrics
```
Response:
```json
{
  "uptime": 3600,
  "uptimeFormatted": "1h 0m",
  "apiStats": [
    {
      "endpoint": "/api/resources",
      "method": "GET",
      "totalRequests": 150,
      "successRate": "99.33",
      "avgResponseTime": 45,
      "minResponseTime": 12,
      "maxResponseTime": 234
    }
  ],
  "errorCount": 2,
  "uniqueErrors": 1
}
```

### Get Recent Errors
```bash
GET /api/observability/errors?limit=50
```

### Get Audit Logs
```bash
GET /api/observability/audit-logs?entityType=resource&userId=system&limit=100&offset=0
```

### Get Audit Summary
```bash
GET /api/observability/audit-summary?days=7
```

---

## 🔍 Audit Log Examples

### Resource Creation
```json
{
  "action": "create",
  "entity_type": "resource",
  "entity_id": "42",
  "changes": {
    "name": "API Server",
    "url": "https://api.example.com",
    "type": "http",
    "enabled": true
  },
  "user_id": "system",
  "created_at": "2024-01-14T10:30:00Z"
}
```

### Resource Update
```json
{
  "action": "update",
  "entity_type": "resource",
  "entity_id": "42",
  "changes": {
    "name": "API Server",
    "enabled": false,
    "maintenance_mode": true
  },
  "user_id": "system",
  "created_at": "2024-01-14T10:35:00Z"
}
```

### Settings Change
```json
{
  "action": "update",
  "entity_type": "settings",
  "entity_id": "email_enabled",
  "changes": {
    "old": false,
    "new": true
  },
  "user_id": "system",
  "created_at": "2024-01-14T10:40:00Z"
}
```

---

## 💡 Use Cases

### 1. Monitoring API Performance
- Check `GET /api/observability/metrics` regularly
- Set up alerts if success rate drops below threshold
- Track response time trends over time

### 2. Debugging Issues
- Visit **Errors** tab in Observability dashboard
- See what went wrong with full stack traces
- Check context (which endpoint, from where)

### 3. Compliance Auditing
- Use **Audit Logs** tab to see who changed what
- Filter by date range and user
- Export logs for compliance reports

### 4. Root Cause Analysis
- Check audit log for recent changes
- Correlate with error logs
- Verify metrics before/after changes

### 5. Performance Optimization
- Identify slowest endpoints from metrics
- Check which endpoints have lowest success rate
- Focus optimization efforts on high-traffic endpoints

---

## ⚙️ Configuration

### Metrics Collection
- Automatically enabled, no configuration needed
- Tracks all API endpoints
- Data available via `/api/observability/metrics`

### Audit Logging
- Automatically enabled, no configuration needed
- Logs all resource CRUD operations
- Logs all settings changes
- Stores permanently in database

### Error Tracking
- Automatically enabled, no configuration needed
- Captures all exceptions
- Stores in `error_logs` table

---

## 🚀 Performance Notes

- **Metrics**: In-memory collection, resets on server restart
- **Audit Logs**: Database storage, grows indefinitely (plan archive strategy)
- **Error Logs**: Database storage, grows indefinitely (plan archive strategy)
- **WebSocket**: All connected clients receive broadcast messages

---

## 📋 Troubleshooting

### No notifications appearing?
- Check browser console for WebSocket errors
- Verify WebSocket connection is established
- Check that incidents are actually being created

### Audit logs not showing changes?
- Verify you're filtering correctly
- Check user_id (usually "system" for API operations)
- Ensure entity type matches what you're looking for

### Metrics showing as 0?
- Server was just restarted (metrics reset)
- No API calls have been made yet
- Check that endpoint path matches exactly

### Performance dashboard slow?
- Too many audit logs in database
- Consider archiving old logs
- Limit query results with pagination

