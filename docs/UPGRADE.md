# Upgrade Guide

## Checking Your Version

Current version: Check the package.json file or look at the UI footer.

## Upgrade Process

### Option 1: Git Repository (Recommended)

If you deployed using git:

```bash
cd /opt/resource-monitor
git pull origin main
npm install
cd client && npm run build && cd ..
git add -f client/build/
git commit -m "Update build files after upgrade"
git push
pm2 restart resource-monitor
```

Then hard-refresh your browser (Ctrl+Shift+R) to clear cache and load the new version.

### Option 2: Manual Update

1. **Backup your data:**
```bash
cp -r data/ data.backup
cp .env data.backup/
```

2. **Download latest version:**
```bash
# Download zip from GitHub and extract to a new folder
# Or clone fresh: git clone https://github.com/nmemmert/monitor.git monitor-new
```

3. **Copy your configuration:**
```bash
cp data.backup/.env monitor-new/
```

4. **Install and build:**
```bash
cd monitor-new
npm run install-all
cd client && npm run build && cd ..
```

5. **Stop old version and start new:**
```bash
pm2 stop resource-monitor
pm2 delete resource-monitor
pm2 start server/index.js --name resource-monitor
pm2 save
```

6. **Restore data (if needed):**
```bash
# If you want to preserve old database:
cp data.backup/skywatch.db data/
```

### Option 3: Docker Update

```bash
# Pull latest image
docker pull your-registry/resource-monitor:latest

# Stop old container
docker stop monitor

# Start new container with same volume
docker run -d -p 3001:3001 -v resource-data:/app/data --name monitor resource-monitor:latest

# Clean up old container
docker rm monitor-old
```

## What to Check After Upgrade

1. **Access the dashboard:** Visit http://your-server:3001
2. **Check resources:** Verify all resources are still configured
3. **Test notifications:** Send test email/webhook from Settings
4. **View history:** Verify historical data is intact
5. **Monitor logs:** `pm2 logs resource-monitor` for any errors

## Rollback

If something goes wrong:

```bash
# If using git:
git revert HEAD
npm install
pm2 restart resource-monitor

# If using manual backup:
# Stop the new version and restore old version from backup
pm2 stop resource-monitor
# Copy old files back
pm2 start resource-monitor
```

## Breaking Changes by Version

### v1.0 → v1.1
- Database schema may be upgraded automatically
- No manual action required
- Check logs if issues occur

### v1.1 → v2.0
- Node.js 16+ required (was 14+)
- Update your Node.js before upgrading
- Check `.env` for any new required settings

## Troubleshooting Upgrades

### White screen after upgrade
- Hard refresh browser (Ctrl+Shift+R)
- Clear all browser cache
- Check console for JavaScript errors (F12)

### Database errors
- Ensure `data/` directory is writable
- Check disk space: `df -h`
- Verify database integrity: `sqlite3 data/skywatch.db "PRAGMA integrity_check;"`

### Resources not checking
- Verify resources still exist: `pm2 logs resource-monitor`
- Re-enable resources in dashboard if needed
- Check network connectivity from server

### Notifications not working
- Test email/webhook from Settings page
- Review server logs for errors
- Check that EMAIL_ENABLED and WEBHOOK_ENABLED are still set

## Staying Updated

To get notifications about new releases:

1. Watch the GitHub repository
2. Star the project
3. Enable notifications in GitHub settings

## Support

Having upgrade issues? Check the [Troubleshooting Guide](TROUBLESHOOTING.md) or open an issue on GitHub.
