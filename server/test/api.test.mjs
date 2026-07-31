import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// validateResourceBody (inline copy — avoids spinning up Express)
// ---------------------------------------------------------------------------
function validateResourceBody(body, requireUrl = true) {
  const { name, url, type, check_interval, timeout, sla_target, retention_days } = body;
  const isHeartbeat = (type || 'http') === 'heartbeat';
  if (!name) return 'Name is required';
  if (!isHeartbeat && requireUrl && !url) return 'URL is required';
  if (!isHeartbeat && url) {
    try { new URL(url); } catch (e) { return 'Invalid URL format'; }
  }
  if (check_interval && (isNaN(check_interval) || check_interval < 10000)) return 'Check interval must be at least 10000ms';
  if (timeout && (isNaN(timeout) || timeout < 1000)) return 'Timeout must be at least 1000ms';
  if (sla_target !== undefined && sla_target !== null && (isNaN(sla_target) || sla_target < 0 || sla_target > 100)) return 'SLA target must be between 0 and 100';
  if (retention_days && (isNaN(retention_days) || retention_days < 1 || retention_days > 365)) return 'Retention days must be between 1 and 365';
  return null;
}

// ---------------------------------------------------------------------------
// formatDuration (inline copy)
// ---------------------------------------------------------------------------
function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('validateResourceBody', () => {
  test('rejects missing name', () => {
    const result = validateResourceBody({ url: 'https://example.com' });
    assert.equal(result, 'Name is required');
  });

  test('rejects missing URL for non-heartbeat', () => {
    const result = validateResourceBody({ name: 'Test' });
    assert.equal(result, 'URL is required');
  });

  test('rejects invalid URL', () => {
    const result = validateResourceBody({ name: 'Test', url: 'not-a-url' });
    assert.equal(result, 'Invalid URL format');
  });

  test('accepts valid http resource', () => {
    const result = validateResourceBody({ name: 'Test', url: 'https://example.com' });
    assert.equal(result, null);
  });

  test('accepts heartbeat without URL', () => {
    const result = validateResourceBody({ name: 'My Job', type: 'heartbeat' });
    assert.equal(result, null);
  });

  test('rejects check_interval below 10000', () => {
    const result = validateResourceBody({ name: 'Test', url: 'https://example.com', check_interval: 5000 });
    assert.equal(result, 'Check interval must be at least 10000ms');
  });

  test('rejects timeout below 1000', () => {
    const result = validateResourceBody({ name: 'Test', url: 'https://example.com', timeout: 500 });
    assert.equal(result, 'Timeout must be at least 1000ms');
  });

  test('rejects sla_target above 100', () => {
    const result = validateResourceBody({ name: 'Test', url: 'https://example.com', sla_target: 101 });
    assert.equal(result, 'SLA target must be between 0 and 100');
  });

  test('rejects retention_days above 365', () => {
    const result = validateResourceBody({ name: 'Test', url: 'https://example.com', retention_days: 400 });
    assert.equal(result, 'Retention days must be between 1 and 365');
  });
});

describe('formatDuration', () => {
  test('returns 0m for null input', () => {
    assert.equal(formatDuration(null), '0m');
  });

  test('returns 0m for negative input', () => {
    assert.equal(formatDuration(-100), '0m');
  });

  test('formats minutes only', () => {
    assert.equal(formatDuration(5 * 60000), '5m');
  });

  test('formats hours and minutes', () => {
    assert.equal(formatDuration(90 * 60000), '1h 30m');
  });

  test('formats exactly 1 hour', () => {
    assert.equal(formatDuration(60 * 60000), '1h 0m');
  });

  test('formats 0 minutes as 0m', () => {
    assert.equal(formatDuration(0), '0m');
  });
});

describe('rate limiter logic', () => {
  // Inline the rate-limit counter logic
  function makeRateLimiter(maxReqs, windowMs = 60000) {
    const map = new Map();
    return (ip, path) => {
      const key = `${path}:${ip}`;
      const now = Date.now();
      const e = map.get(key);
      if (!e || now - e.start > windowMs) { map.set(key, { start: now, count: 1 }); return true; }
      e.count++;
      return e.count <= maxReqs;
    };
  }

  test('allows requests within limit', () => {
    const check = makeRateLimiter(3);
    assert.ok(check('127.0.0.1', '/api/heartbeat/tok'));
    assert.ok(check('127.0.0.1', '/api/heartbeat/tok'));
    assert.ok(check('127.0.0.1', '/api/heartbeat/tok'));
  });

  test('blocks requests exceeding limit', () => {
    const check = makeRateLimiter(2);
    check('127.0.0.1', '/test');
    check('127.0.0.1', '/test');
    const allowed = check('127.0.0.1', '/test');
    assert.equal(allowed, false);
  });

  test('different IPs are tracked separately', () => {
    const check = makeRateLimiter(1);
    assert.ok(check('1.1.1.1', '/test'));
    assert.ok(check('2.2.2.2', '/test'));
  });
});
