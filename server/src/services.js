// Müşteri/kampanya/kayıt işlemleri: hem web sunucusu hem cron (toplu Bitrix ekleme) kullanır.
const { normalizePhone, todayInTurkey, isValidDate } = require('./schedule');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const parseCampaign = (c) => c && { ...c, bitrix_stages: c.bitrix_stages ? JSON.parse(c.bitrix_stages) : [] };

function createServices({ db, now = () => new Date() }) {
  const getCampaign = (id) => {
    const campaign = parseCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
    if (!campaign) throw new HttpError(404, 'Kampanya bulunamadı');
    campaign.steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY day_offset').all(id);
    return campaign;
  };

  let txDepth = 0;
  const transaction = (fn) => {
    if (txDepth > 0) return fn(); // iç içe çağrılar dıştaki transaction'a katılır
    db.exec('BEGIN');
    txDepth += 1;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth -= 1; }
  };

  const getCustomer = (id) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!c) throw new HttpError(404, 'Müşteri bulunamadı');
    return c;
  };

  const upsertCustomer = ({ name, phone, consent, note }) => {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new HttpError(400, `Geçersiz cep telefonu: ${phone}`);
    if (!name || !String(name).trim()) throw new HttpError(400, 'Müşteri adı gerekli');
    const existing = db.prepare('SELECT * FROM customers WHERE phone = ?').get(normalized);
    if (existing) {
      // RET demiş müşterinin izni form tekrar doldurulsa bile otomatik açılmaz.
      db.prepare('UPDATE customers SET name = ?, consent = MAX(consent, ?), note = COALESCE(?, note) WHERE id = ?')
        .run(String(name).trim(), consent ? 1 : 0, note ?? null, existing.id);
      return getCustomer(existing.id);
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO customers (name, phone, consent, note) VALUES (?, ?, ?, ?)')
      .run(String(name).trim(), normalized, consent ? 1 : 0, note ?? null);
    return getCustomer(lastInsertRowid);
  };

  const enroll = (customerId, campaignId, startDate, source = null) => {
    getCustomer(customerId);
    getCampaign(campaignId);
    const start = startDate || todayInTurkey(now());
    if (!isValidDate(start)) throw new HttpError(400, `Geçersiz başlangıç tarihi: ${start}`);
    const existing = db.prepare('SELECT * FROM enrollments WHERE customer_id = ? AND campaign_id = ?').get(customerId, campaignId);
    if (existing) {
      if (existing.status === 'active') {
        if (source && existing.source !== source) db.prepare('UPDATE enrollments SET source = ? WHERE id = ?').run(source, existing.id);
        return db.prepare('SELECT * FROM enrollments WHERE id = ?').get(existing.id);
      }
      // Tamamlanmış/iptal kaydı yeniden başlatılıyor: eski mesaj geçmişi sıfırlanır.
      transaction(() => {
        db.prepare('DELETE FROM messages WHERE enrollment_id = ?').run(existing.id);
        db.prepare(`UPDATE enrollments SET start_date = ?, status = 'active', source = ? WHERE id = ?`).run(start, source, existing.id);
      });
      return db.prepare('SELECT * FROM enrollments WHERE id = ?').get(existing.id);
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO enrollments (customer_id, campaign_id, start_date, source) VALUES (?, ?, ?, ?)')
      .run(customerId, campaignId, start, source);
    return db.prepare('SELECT * FROM enrollments WHERE id = ?').get(lastInsertRowid);
  };

  return { getCampaign, transaction, getCustomer, upsertCustomer, enroll };
}

module.exports = { HttpError, parseCampaign, createServices };
