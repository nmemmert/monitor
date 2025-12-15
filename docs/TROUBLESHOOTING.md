# Troubleshooting Guide

## Port Already in Use

If port 3001 is already in use, change it in `.env`:
```env
PORT=3002
```

Then restart the server.

## Email Not Sending

- Verify SMTP credentials are correct
- Check that 2FA is enabled and you're using an app password (for Gmail)
- Test with a simple SMTP client first
- Check server logs for specific error messages
- Verify EMAIL_ENABLED=true in .env
- Ensure EMAIL_TO is set to a valid email address

## Resource Not Being Checked

- Verify resource is enabled (toggle in dashboard)
- Check server logs for errors with `pm2 logs resource-monitor`
- Ensure URL is accessible from the server (try `curl https://url` from server)
- Verify the resource type matches (http, https, ping, etc.)
- Check that the check interval is set to a reasonable value

## White Screen on Load

- Hard refresh browser (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)
- Clear browser cache
- Check console for JavaScript errors (F12 → Console)
- Verify build files are in `client/build/` directory
- Make sure you committed build files before deploying

## History Page Slow

- Toggle off "Show Averages" if viewing large time windows
- Use the 7-day view instead of 30 days
- Check server load with `pm2 monit`
- Increase server resources if needed

## Database Issues

- Check that `/opt/resource-monitor/data/` directory exists and is writable
- Verify database file permissions: `ls -la data/skywatch.db`
- If corrupted, delete database and restart to rebuild from scratch

## Memory Issues

- Monitor with `pm2 monit`
- Check cache size with GET `/api/cache/clear` endpoint
- Reduce data retention period
- Enable auto-cleanup in settings

## Connection Refused

- Verify server is running: `pm2 list`
- Check port is correct: `netstat -an | grep 3001` (Linux) or `netstat -ano | findstr 3001` (Windows)
- Check firewall rules allow port 3001
- Verify .env PORT setting matches

## Incidents Not Triggering

- Verify consecutive_failures threshold is met (default: 3)
- Check grace_period setting (default: 300 seconds)
- Review alert settings in Settings page
- Check notification service is enabled
- View server logs: `pm2 logs resource-monitor`

## API Endpoints Not Working

- Verify server is running on correct port
- Check CORS settings if accessing from different domain
- Review request method (GET vs POST)
- Check error response for specific error message
- Verify request parameters are correct

## Performance Issues

- Use averaged mode in history (default is enabled)
- Increase check intervals for resources
- Enable caching (default is 2 minutes)
- Consider archiving old data
- Monitor database size: `ls -lh data/skywatch.db`
