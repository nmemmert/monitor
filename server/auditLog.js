const db = require('./database');

class AuditLogger {
  // Log an audit event
  log(action, entityType, entityId, changes = {}, userId = 'system', ipAddress = null) {
    try {
      db.prepare(`
        INSERT INTO audit_logs 
        (action, entity_type, entity_id, user_id, changes, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        action,
        entityType,
        entityId,
        userId,
        JSON.stringify(changes),
        ipAddress
      );
    } catch (error) {
      // Silent failure - don't crash on audit logging errors
    }
  }

  // Log resource changes
  logResourceChange(action, resourceId, changes, userId = 'system', ipAddress = null) {
    this.log(action, 'resource', resourceId, changes, userId, ipAddress);
  }

  // Log settings changes
  logSettingsChange(settingKey, oldValue, newValue, userId = 'system', ipAddress = null) {
    this.log('update', 'settings', settingKey, { old: oldValue, new: newValue }, userId, ipAddress);
  }

  // Log group changes
  logGroupChange(action, groupId, changes, userId = 'system', ipAddress = null) {
    this.log(action, 'group', groupId, changes, userId, ipAddress);
  }

  // Log maintenance window changes
  logMaintenanceChange(action, windowId, changes, userId = 'system', ipAddress = null) {
    this.log(action, 'maintenance_window', windowId, changes, userId, ipAddress);
  }

  // Get audit logs with filters
  getAuditLogs(filters = {}) {
    const {
      entityType = null,
      entityId = null,
      userId = null,
      action = null,
      startDate = null,
      endDate = null,
      limit = 100,
      offset = 0
    } = filters;

    let query = `
      SELECT 
        id,
        action,
        entity_type,
        entity_id,
        user_id,
        changes,
        ip_address,
        REPLACE(created_at, ' ', 'T') || 'Z' as created_at
      FROM audit_logs
      WHERE 1=1
    `;
    const params = [];

    if (entityType) {
      query += ' AND entity_type = ?';
      params.push(entityType);
    }

    if (entityId) {
      query += ' AND entity_id = ?';
      params.push(entityId);
    }

    if (userId) {
      query += ' AND user_id = ?';
      params.push(userId);
    }

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    if (startDate) {
      query += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND created_at <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
      const logs = db.prepare(query).all(...params);
      
      // Parse JSON changes
      return logs.map(log => ({
        ...log,
        changes: log.changes ? JSON.parse(log.changes) : {}
      }));
    } catch (error) {
      return [];
    }
  }

  // Get audit summary stats
  getSummary(days = 7) {
    try {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total_events,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT entity_type) as entity_types,
          action,
          COUNT(*) as action_count
        FROM audit_logs
        WHERE created_at > datetime('now', '-' || ? || ' days')
        GROUP BY action
      `).all(days);

      const totalEvents = db.prepare(`
        SELECT COUNT(*) as count
        FROM audit_logs
        WHERE created_at > datetime('now', '-' || ? || ' days')
      `).get(days);

      return {
        totalEvents: totalEvents?.count || 0,
        actionBreakdown: stats.map(s => ({
          action: s.action,
          count: s.action_count
        }))
      };
    } catch (error) {
      return { totalEvents: 0, actionBreakdown: [] };
    }
  }
}

module.exports = new AuditLogger();
