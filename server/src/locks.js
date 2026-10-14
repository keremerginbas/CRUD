// SQLite üzerinde süreçler arası basit kilit (panel sunucusu ve cron aynı anda çalışabilir).
function withLock(db, key, ttlMs, fn) {
  const owner = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const nowMs = Date.now();
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
    WHERE json_extract(settings.value, '$.until') < ?`).run(key, JSON.stringify({ owner, until: nowMs + ttlMs }), nowMs);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (JSON.parse(row.value).owner !== owner) return Promise.resolve({ busy: true });
  const release = () => db.prepare(`DELETE FROM settings WHERE key = ? AND json_extract(value, '$.owner') = ?`).run(key, owner);
  return Promise.resolve().then(fn).finally(release);
}

module.exports = { withLock };
