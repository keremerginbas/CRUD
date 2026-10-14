const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'reklam' CHECK (type IN ('reklam', 'proje')),
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  day_offset  INTEGER NOT NULL CHECK (day_offset >= 0),
  send_time   TEXT NOT NULL DEFAULT '10:00',
  message     TEXT NOT NULL,
  UNIQUE (campaign_id, day_offset)
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  consent    INTEGER NOT NULL DEFAULT 0,
  opted_out  INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (customer_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  step_id       INTEGER NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  phone         TEXT NOT NULL,
  body          TEXT NOT NULL,
  due_at        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  provider_ref  TEXT,
  error         TEXT,
  updated_at    TEXT NOT NULL,
  UNIQUE (enrollment_id, step_id)
);

-- Genel ayarlar (ör. seriyi durduran Bitrix statüleri).
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Bitrix kayıtlarının (lead/deal) son görülen aşaması: aşama değişmediyse akış yeniden başlatılmaz.
CREATE TABLE IF NOT EXISTS bitrix_state (
  entity     TEXT PRIMARY KEY,
  stage      TEXT,
  updated_at TEXT NOT NULL
);
`;

// Var olan veritabanlarına sonradan eklenen sütunlar.
const COLUMNS = {
  campaigns: {
    project: 'TEXT',
    bitrix_entity: "TEXT CHECK (bitrix_entity IN ('lead', 'deal'))",
    bitrix_stages: 'TEXT', // JSON dizi: kampanyayı başlatan statüler
    bitrix_project: 'TEXT',
  },
  enrollments: { source: 'TEXT' },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(cols)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'sms.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { openDb };
