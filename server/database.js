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

  CREATE INDEX IF NOT EXISTS idx_checks_resource_id ON checks(resource_id);
  CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at);
  CREATE INDEX IF NOT EXISTS idx_checks_resource_checked ON checks(resource_id, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_incidents_resource_id ON incidents(resource_id);
  CREATE INDEX IF NOT EXISTS idx_incidents_resolved ON incidents(resource_id, resolved_at);
  CREATE INDEX IF NOT EXISTS idx_resources_group_id ON resources(group_id);
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

module.exports = db;
