const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/monitor.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'http',
    check_interval INTEGER DEFAULT 60000,
    timeout INTEGER DEFAULT 5000,
    enabled INTEGER DEFAULT 1,
    maintenance_mode INTEGER DEFAULT 0,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    response_time INTEGER,
    status_code INTEGER,
    error_message TEXT,
    details TEXT,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    notified INTEGER DEFAULT 0,
    acknowledged INTEGER DEFAULT 0,
    acknowledged_at DATETIME,
    acknowledged_by TEXT,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS maintenance_windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    consecutive_failures_threshold INTEGER DEFAULT 1,
    response_time_threshold INTEGER,
    response_time_baseline INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transaction_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    step_order INTEGER NOT NULL,
    url TEXT NOT NULL,
    method TEXT DEFAULT 'GET',
    headers TEXT,
    body TEXT,
    expected_status INTEGER DEFAULT 200,
    keyword TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS archived_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    response_time INTEGER,
    status_code INTEGER,
    error_message TEXT,
    details TEXT,
    checked_at DATETIME NOT NULL,
    archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS resource_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resource_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    UNIQUE(resource_id, tag)
  );

  CREATE INDEX IF NOT EXISTS idx_checks_resource_id ON checks(resource_id);
  CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
  CREATE INDEX IF NOT EXISTS idx_checks_resource_checked ON checks(resource_id, checked_at);
  CREATE INDEX IF NOT EXISTS idx_incidents_resource_id ON incidents(resource_id);
  CREATE INDEX IF NOT EXISTS idx_incidents_resource_started ON incidents(resource_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_incidents_resolved ON incidents(resource_id, resolved_at);
  CREATE INDEX IF NOT EXISTS idx_resources_group_id ON resources(group_id);
  CREATE INDEX IF NOT EXISTS idx_maintenance_windows_resource ON maintenance_windows(resource_id);
  CREATE INDEX IF NOT EXISTS idx_alert_rules_resource ON alert_rules(resource_id);
  CREATE INDEX IF NOT EXISTS idx_transaction_checks_resource ON transaction_checks(resource_id);
  CREATE INDEX IF NOT EXISTS idx_archived_checks_resource_time ON archived_checks(resource_id, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_resource_tags_resource ON resource_tags(resource_id);
  CREATE INDEX IF NOT EXISTS idx_resource_tags_tag ON resource_tags(tag);
`);

// Lightweight migrations - for existing databases
try {
  db.prepare("ALTER TABLE checks ADD COLUMN details TEXT").run();
} catch (err) {
  // Column already exists
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN group_id INTEGER").run();
} catch (err) {
  // Column already exists
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN maintenance_mode INTEGER DEFAULT 0").run();
  console.log('[DB] Added maintenance_mode column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] maintenance_mode column already exists');
  }
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN http_keyword TEXT").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN http_headers TEXT").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN quiet_hours_start TEXT").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN quiet_hours_end TEXT").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN cert_expiry_days INTEGER DEFAULT 30").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN sla_target REAL DEFAULT 99.9").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN email_to TEXT").run();
  console.log('[DB] Added email_to column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] email_to column already exists');
  } else {
    console.error('[DB] Error adding email_to column:', err.message);
  }
}

try {
  db.prepare("ALTER TABLE incidents ADD COLUMN acknowledged INTEGER DEFAULT 0").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE incidents ADD COLUMN acknowledged_at DATETIME").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE incidents ADD COLUMN acknowledged_by TEXT").run();
} catch (err) {}

try {
  db.prepare("ALTER TABLE checks ADD COLUMN cert_expiry_date TEXT").run();
} catch (err) {}

// New columns for features
try {
  db.prepare("ALTER TABLE resources ADD COLUMN tags TEXT").run();
  console.log('[DB] Added tags column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] tags column already exists');
  }
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN consecutive_failures_threshold INTEGER DEFAULT 1").run();
  console.log('[DB] Added consecutive_failures_threshold column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] consecutive_failures_threshold column already exists');
  }
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN response_time_threshold INTEGER").run();
  console.log('[DB] Added response_time_threshold column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] response_time_threshold column already exists');
  }
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN response_time_baseline INTEGER").run();
  console.log('[DB] Added response_time_baseline column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] response_time_baseline column already exists');
  }
}

try {
  db.prepare("ALTER TABLE resources ADD COLUMN is_transaction INTEGER DEFAULT 0").run();
  console.log('[DB] Added is_transaction column to resources');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] is_transaction column already exists');
  }
}

// Add description column to incidents for incident summaries
try {
  db.prepare("ALTER TABLE incidents ADD COLUMN description TEXT").run();
  console.log('[DB] Added description column to incidents');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] description column already exists');
  }
}

// Add failed_check_count to incidents to track consecutive failures at creation time
try {
  db.prepare("ALTER TABLE incidents ADD COLUMN failed_check_count INTEGER DEFAULT 0").run();
  console.log('[DB] Added failed_check_count column to incidents');
} catch (err) {
  if (err.message.includes('duplicate')) {
    console.log('[DB] failed_check_count column already exists');
  }
}

// Settings for data retention and incident thresholds
try {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('retention_days', '30')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('incident_failure_threshold', '10')").run();
} catch (err) {}

// Helpful indexes for time-range queries
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_checks_resource_time ON checks(resource_id, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_incidents_resource_time ON incidents(resource_id, started_at DESC);
`);

module.exports = db;
