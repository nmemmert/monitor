const db = require('./database');

class MetricsCollector {
  constructor() {
    this.apiMetrics = new Map();
    this.errorCounts = new Map();
    this.startTime = Date.now();
  }

  // Track API request metrics
  trackApiRequest(endpoint, method, statusCode, duration) {
    const key = `${method}:${endpoint}`;
    if (!this.apiMetrics.has(key)) {
      this.apiMetrics.set(key, {
        endpoint,
        method,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        statusCodes: {}
      });
    }

    const metrics = this.apiMetrics.get(key);
    metrics.totalRequests++;
    metrics.totalDuration += duration;
    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);

    if (statusCode >= 200 && statusCode < 400) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
    }

    metrics.statusCodes[statusCode] = (metrics.statusCodes[statusCode] || 0) + 1;
  }

  // Track application errors
  trackError(error, context = {}) {
    const errorKey = error.message || 'Unknown Error';
    const errorData = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      count: (this.errorCounts.get(errorKey) || 0) + 1
    };

    this.errorCounts.set(errorKey, errorData.count);

    // Log to database
    try {
      db.prepare(`
        INSERT INTO error_logs (error_message, stack_trace, context, occurred_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(
        error.message,
        error.stack || '',
        JSON.stringify(context)
      );
    } catch (err) {
      // Silent failure - don't crash on logging errors
    }

    return errorData;
  }

  // Get current metrics snapshot
  getMetrics() {
    const apiStats = [];
    this.apiMetrics.forEach((metrics, key) => {
      const avgDuration = metrics.totalRequests > 0 
        ? Math.round(metrics.totalDuration / metrics.totalRequests)
        : 0;
      
      apiStats.push({
        endpoint: metrics.endpoint,
        method: metrics.method,
        totalRequests: metrics.totalRequests,
        successRate: metrics.totalRequests > 0
          ? ((metrics.successCount / metrics.totalRequests) * 100).toFixed(2)
          : 0,
        avgResponseTime: avgDuration,
        minResponseTime: metrics.minDuration === Infinity ? 0 : metrics.minDuration,
        maxResponseTime: metrics.maxDuration,
        statusCodes: metrics.statusCodes
      });
    });

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      apiStats: apiStats.sort((a, b) => b.totalRequests - a.totalRequests),
      errorCount: Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0),
      uniqueErrors: this.errorCounts.size
    };
  }

  // Get recent errors from database
  getRecentErrors(limit = 50) {
    try {
      return db.prepare(`
        SELECT 
          id,
          error_message,
          stack_trace,
          context,
          REPLACE(occurred_at, ' ', 'T') || 'Z' as occurred_at
        FROM error_logs
        ORDER BY occurred_at DESC
        LIMIT ?
      `).all(limit);
    } catch (err) {
      return [];
    }
  }

  // Clear in-memory metrics (for testing/reset)
  reset() {
    this.apiMetrics.clear();
    this.errorCounts.clear();
  }
}

module.exports = new MetricsCollector();
