import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Gayrimenkul Danışmanı',
  role TEXT NOT NULL DEFAULT 'danisman' CHECK (role IN ('admin','broker','asistan','danisman')),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT NOT NULL,              -- danışmanın gerçek cep numarası (müşteri görmez)
  forward_phone TEXT,               -- gelen çağrıların yönlendirileceği numara
  extension TEXT,                   -- santraldeki dahili numara
  voice_announcement INTEGER NOT NULL DEFAULT 1, -- danışmana "müşteri arıyor" fısıltı anonsu
  recording_broker INTEGER NOT NULL DEFAULT 0,    -- broker bu danışmanın kayıtlarını dinleyebilir
  recording_assistant INTEGER NOT NULL DEFAULT 0, -- asistan bu danışmanın kayıtlarını dinleyebilir
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '19:00',
  saturday_enabled INTEGER NOT NULL DEFAULT 1,
  saturday_start TEXT NOT NULL DEFAULT '10:00',
  saturday_end TEXT NOT NULL DEFAULT '17:00',
  sunday_enabled INTEGER NOT NULL DEFAULT 0,
  sunday_start TEXT NOT NULL DEFAULT '10:00',
  sunday_end TEXT NOT NULL DEFAULT '17:00',
  push_token TEXT,
  bitrix_user_id INTEGER,            -- Bitrix24'teki kullanıcı kimliği (CRM'e arama yazmak için)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Santraldeki numaralar: danışmanın dijital (maske) numarası, ilan takip numarası veya 444 karşılama hattı
CREATE TABLE IF NOT EXISTS numbers (
  did TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('personal','listing','hunt')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'ALICI' CHECK (type IN ('ALICI','SATICI')),
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contacts_phone ON contacts(phone);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  provider_call_id TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  customer_phone TEXT NOT NULL,
  dialed_number TEXT,               -- müşterinin aradığı / müşteriye gösterilen numara (maske)
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'initiated',  -- initiated | ringing | answered | completed | missed | failed
  duration_sec INTEGER NOT NULL DEFAULT 0,
  recording_ref TEXT,
  bitrix_call_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS calls_user ON calls(user_id, started_at);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
