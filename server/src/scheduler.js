const { computeDueAt, renderTemplate } = require('./schedule');

const MAX_ATTEMPTS = 3;
// Zamanı bu kadardan fazla geçmiş adımlar gönderilmez, "atlandı" olarak işaretlenir.
// (Örn. sunucu kapalıyken kaçırılanlar veya eski kayıtlara sonradan eklenen adımlar.)
const GRACE_MS = 24 * 3600 * 1000;

function enrollmentPlan(db, enrollmentId) {
  return db.prepare(`
    SELECT s.id AS step_id, s.day_offset, s.send_time, s.message AS template,
           m.status, m.attempts, m.error, m.updated_at
    FROM enrollments e
    JOIN campaign_steps s ON s.campaign_id = e.campaign_id
    LEFT JOIN messages m ON m.enrollment_id = e.id AND m.step_id = s.id
    WHERE e.id = ?
    ORDER BY s.day_offset
  `).all(enrollmentId);
}

function createScheduler({ db, provider, now = () => new Date(), log = console.log }) {
  let running = false;

  const recordStmt = db.prepare(`
    INSERT INTO messages (enrollment_id, step_id, phone, body, due_at, status, attempts, provider_ref, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (enrollment_id, step_id) DO UPDATE SET
      status = excluded.status, attempts = excluded.attempts, provider_ref = excluded.provider_ref,
      error = excluded.error, updated_at = excluded.updated_at, body = excluded.body, phone = excluded.phone
  `);

  // Süreçler arası kilit: panel sunucusu ve cron aynı anda çalışırsa aynı SMS iki kez gitmesin.
  const LOCK_MS = 10 * 60 * 1000;
  const owner = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const acquireLock = () => {
    const nowMs = Date.now();
    db.prepare(`INSERT INTO settings (key, value) VALUES ('scheduler_lock', ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value
      WHERE json_extract(settings.value, '$.until') < ?`).run(JSON.stringify({ owner, until: nowMs + LOCK_MS }), nowMs);
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'scheduler_lock'`).get();
    return JSON.parse(row.value).owner === owner;
  };
  const releaseLock = () => {
    db.prepare(`DELETE FROM settings WHERE key = 'scheduler_lock' AND json_extract(value, '$.owner') = ?`).run(owner);
  };

  async function tick() {
    if (running) return { busy: true };
    if (!acquireLock()) return { busy: true };
    running = true;
    const stats = { sent: 0, failed: 0, skipped: 0, completed: 0 };
    try {
      const current = now();
      const rows = db.prepare(`
        SELECT e.id AS enrollment_id, e.start_date, c.name AS customer_name, c.phone,
               c.consent, c.opted_out, k.name AS campaign_name, k.project, k.active AS campaign_active
        FROM enrollments e
        JOIN customers c ON c.id = e.customer_id
        JOIN campaigns k ON k.id = e.campaign_id
        WHERE e.status = 'active'
      `).all();

      for (const row of rows) {
        // İzni olmayan / RET diyen müşteriye ve durdurulmuş kampanyaya gönderim yapılmaz.
        if (!row.consent || row.opted_out || !row.campaign_active) continue;

        const plan = enrollmentPlan(db, row.enrollment_id);
        let pending = 0;
        for (const step of plan) {
          if (step.status === 'sent' || step.status === 'skipped') continue;
          if (step.status === 'failed' && step.attempts >= MAX_ATTEMPTS) continue;

          const due = computeDueAt(row.start_date, step.day_offset, step.send_time);
          if (due > current) { pending += 1; continue; }

          const body = renderTemplate(step.template, {
            ad: /^değerli müşterimiz$/i.test(row.customer_name) ? row.customer_name : row.customer_name.split(' ')[0],
            adsoyad: row.customer_name,
            kampanya: row.campaign_name,
            proje: row.project || row.campaign_name,
          });
          const stamp = current.toISOString();

          if (current - due > GRACE_MS && !step.status) {
            recordStmt.run(row.enrollment_id, step.step_id, row.phone, body, due.toISOString(),
              'skipped', 0, null, 'Gönderim zamanı 24 saatten fazla geçmişti', stamp);
            stats.skipped += 1;
            continue;
          }

          const attempts = (step.attempts || 0) + 1;
          try {
            const { ref } = await provider.send(row.phone, body);
            recordStmt.run(row.enrollment_id, step.step_id, row.phone, body, due.toISOString(),
              'sent', attempts, ref ?? null, null, stamp);
            stats.sent += 1;
          } catch (err) {
            recordStmt.run(row.enrollment_id, step.step_id, row.phone, body, due.toISOString(),
              'failed', attempts, null, String(err.message || err), stamp);
            stats.failed += 1;
            if (attempts < MAX_ATTEMPTS) pending += 1;
            log(`SMS gönderilemedi (kayıt ${row.enrollment_id}, gün ${step.day_offset}): ${err.message || err}`);
          }
        }

        if (plan.length > 0 && pending === 0) {
          db.prepare(`UPDATE enrollments SET status = 'completed' WHERE id = ?`).run(row.enrollment_id);
          stats.completed += 1;
        }
      }
      return stats;
    } finally {
      running = false;
      releaseLock();
    }
  }

  return { tick };
}

module.exports = { createScheduler, enrollmentPlan, MAX_ATTEMPTS };
