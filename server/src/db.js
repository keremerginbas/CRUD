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
`;

function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'sms.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
