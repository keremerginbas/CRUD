const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { computeDueAt, normalizePhone, todayInTurkey, isValidTime, isValidDate } = require('./schedule');
const { enrollmentPlan } = require('./scheduler');
const { createBitrixSync, getStopStages, setStopStages } = require('./bitrix');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validateSteps(steps) {
  if (!Array.isArray(steps)) throw new HttpError(400, 'steps bir liste olmalı');
  const seen = new Set();
  return steps.map((s) => {
    const day = Number(s.day_offset);
    const time = s.send_time || '10:00';
    const message = String(s.message || '').trim();
    if (!Number.isInteger(day) || day < 0) throw new HttpError(400, `Geçersiz gün: ${s.day_offset}`);
    if (seen.has(day)) throw new HttpError(400, `${day}. gün birden fazla kez tanımlanmış`);
    if (!isValidTime(time)) throw new HttpError(400, `Geçersiz saat: ${time} (SS:DD olmalı)`);
    if (!message) throw new HttpError(400, `${day}. gün için mesaj boş olamaz`);
    seen.add(day);
    return { day_offset: day, send_time: time, message };
  }).sort((a, b) => a.day_offset - b.day_offset);
}

const cleanStages = (stages) => [...new Set((Array.isArray(stages) ? stages : []).map((s) => String(s).trim()).filter(Boolean))];

function validateBitrix({ bitrix_entity, bitrix_stages, bitrix_project }) {
  if (!bitrix_entity) return { bitrix_entity: null, bitrix_stages: null, bitrix_project: null };
  if (!['lead', 'deal'].includes(bitrix_entity)) throw new HttpError(400, 'Bitrix kayıt türü "lead" veya "deal" olmalı');
  const stages = cleanStages(bitrix_stages);
  if (!stages.length) throw new HttpError(400, 'En az bir Bitrix statüsü seçilmeli');
  return { bitrix_entity, bitrix_stages: JSON.stringify(stages), bitrix_project: bitrix_project ? String(bitrix_project) : null };
}

// "[FİYAT]" gibi doldurulmamış şablon alanı olan kampanya aktif edilemez; müşteriye köşeli parantez gitmesin.
function checkPlaceholders(active, steps) {
  if (!active) return;
  for (const s of steps) {
    const m = /\[[^\]]+\]/.exec(s.message);
    if (m) throw new HttpError(400, `${s.day_offset}. gün mesajında doldurulmamış alan var: ${m[0]}. Doldurun veya kampanyayı pasif kaydedin.`);
  }
}

const parseCampaign = (c) => c && { ...c, bitrix_stages: c.bitrix_stages ? JSON.parse(c.bitrix_stages) : [] };

// Panel PUBLIC_URL=/sms ile derlendiyse alt yolu derleme dosyasından çıkar (.env'de BASE_PATH olmasa da çalışsın).
function detectBasePath(buildDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, 'asset-manifest.json'), 'utf8'));
    const main = manifest.files?.['main.js'] || '';
    return main.slice(0, Math.max(0, main.indexOf('/static/')));
  } catch {
    return '';
  }
}

function createApp({
  db, scheduler, provider = null, bitrix = null, now = () => new Date(),
  apiKey = process.env.API_KEY,
  basePath = process.env.BASE_PATH,
  buildDir = path.join(__dirname, '..', '..', 'build'),
  requirePassword = process.env.NODE_ENV === 'production',
  panelUser = process.env.PANEL_USER, panelPassword = process.env.PANEL_PASSWORD,
}) {
  const app = express();
  // Alt yolda yayın (ör. BASE_PATH=/sms): Passenger öneki iletse de iletmese de rotalar aynı çalışır.
  const base = (basePath || detectBasePath(buildDir)).replace(/\/+$/, '');
  if (base) {
    app.use((req, res, next) => {
      if (req.url === base) return res.redirect(301, `${base}/`);
      if (req.url.startsWith(`${base}/`)) req.url = req.url.slice(base.length);
      next();
    });
  }
  // Panel ve API için basit giriş (tarayıcı kullanıcı adı/şifre sorar). Webhook ve lead uç noktaları
  // kendi anahtarlarıyla korunduğu için hariç.
  const open = new Set(['/api/bitrix/webhook', '/api/leads']);
  // Canlıda şifre tanımlanmadıysa panel herkese açık kalmasın.
  if (!panelPassword && requirePassword) {
    app.use((req, res, next) => (open.has(req.path) ? next()
      : res.status(503).type('text').send('Panel kilitli: server/.env dosyasında PANEL_PASSWORD tanımlayıp uygulamayı yeniden başlatın.')));
  }
  if (panelPassword) {
    const expected = `Basic ${Buffer.from(`${panelUser || 'admin'}:${panelPassword}`).toString('base64')}`;
    app.use((req, res, next) => {
      if (open.has(req.path)) return next();
      const given = Buffer.from(req.get('authorization') || '');
      const want = Buffer.from(expected);
      if (given.length === want.length && crypto.timingSafeEqual(given, want)) return next();
      res.set('WWW-Authenticate', 'Basic realm="SMS Otomasyonu", charset="UTF-8"').status(401).send('Giriş gerekli');
    });
  }
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // Bitrix giden webhook'ları form olarak gönderir
  const api = express.Router();

  // ---------- Kampanyalar (reklam / proje) ----------
  const getCampaign = (id) => {
    const campaign = parseCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
    if (!campaign) throw new HttpError(404, 'Kampanya bulunamadı');
    campaign.steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY day_offset').all(id);
    return campaign;
  };

  // Mevcut adımları gün bazında günceller; böylece gönderilmiş mesaj kayıtları korunur.
  const saveSteps = (campaignId, steps) => {
    const existing = db.prepare('SELECT id, day_offset FROM campaign_steps WHERE campaign_id = ?').all(campaignId);
    const wanted = new Set(steps.map((s) => s.day_offset));
    for (const e of existing) {
      if (!wanted.has(e.day_offset)) db.prepare('DELETE FROM campaign_steps WHERE id = ?').run(e.id);
    }
    const upsert = db.prepare(`
      INSERT INTO campaign_steps (campaign_id, day_offset, send_time, message) VALUES (?, ?, ?, ?)
      ON CONFLICT (campaign_id, day_offset) DO UPDATE SET send_time = excluded.send_time, message = excluded.message
    `);
    for (const s of steps) upsert.run(campaignId, s.day_offset, s.send_time, s.message);
  };

  let txDepth = 0;
  const transaction = (fn) => {
    if (txDepth > 0) return fn(); // iç içe çağrılar dıştaki transaction'a katılır
    db.exec('BEGIN');
    txDepth += 1;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { txDepth -= 1; }
  };

  api.get('/campaigns', (req, res) => {
    const campaigns = db.prepare(`
      SELECT k.*,
        (SELECT COUNT(*) FROM campaign_steps s WHERE s.campaign_id = k.id) AS step_count,
        (SELECT COUNT(*) FROM enrollments e WHERE e.campaign_id = k.id AND e.status = 'active') AS active_count
      FROM campaigns k ORDER BY k.id DESC
    `).all().map(parseCampaign);
    for (const c of campaigns) {
      c.steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY day_offset').all(c.id);
    }
    res.json(campaigns);
  });

  api.get('/campaigns/:id', (req, res) => res.json(getCampaign(req.params.id)));

  api.post('/campaigns', (req, res) => {
    const { name, type = 'reklam', description = null, active = true, steps = [] } = req.body;
    if (!name || !String(name).trim()) throw new HttpError(400, 'Kampanya adı gerekli');
    if (!['reklam', 'proje'].includes(type)) throw new HttpError(400, 'Tür "reklam" veya "proje" olmalı');
    const clean = validateSteps(steps);
    checkPlaceholders(active, clean);
    const b = validateBitrix(req.body);
    const id = transaction(() => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO campaigns
        (name, type, description, active, project, bitrix_entity, bitrix_stages, bitrix_project) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(String(name).trim(), type, description, active ? 1 : 0, req.body.project || null, b.bitrix_entity, b.bitrix_stages, b.bitrix_project);
      saveSteps(lastInsertRowid, clean);
      return lastInsertRowid;
    });
    res.status(201).json(getCampaign(id));
  });

  api.put('/campaigns/:id', (req, res) => {
    const current = getCampaign(req.params.id);
    const { name = current.name, type = current.type, description = current.description, active = current.active, steps } = req.body;
    if (!['reklam', 'proje'].includes(type)) throw new HttpError(400, 'Tür "reklam" veya "proje" olmalı');
    const clean = steps === undefined ? null : validateSteps(steps);
    checkPlaceholders(active, clean || current.steps);
    const b = validateBitrix({ ...current, ...req.body });
    const project = req.body.project === undefined ? current.project : req.body.project || null;
    transaction(() => {
      db.prepare(`UPDATE campaigns SET name = ?, type = ?, description = ?, active = ?, project = ?,
        bitrix_entity = ?, bitrix_stages = ?, bitrix_project = ? WHERE id = ?`)
        .run(name, type, description, active ? 1 : 0, project, b.bitrix_entity, b.bitrix_stages, b.bitrix_project, current.id);
      if (clean) saveSteps(current.id, clean);
    });
    res.json(getCampaign(current.id));
  });

  api.delete('/campaigns/:id', (req, res) => {
    getCampaign(req.params.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // ---------- Müşteriler ----------
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

  api.get('/customers', (req, res) => {
    const q = `%${req.query.q || ''}%`;
    res.json(db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.customer_id = c.id AND e.status = 'active') AS active_count
      FROM customers c WHERE c.name LIKE ? OR c.phone LIKE ? ORDER BY c.id DESC
    `).all(q, q));
  });

  api.post('/customers', (req, res) => {
    const { campaign_id, start_date } = req.body;
    const customer = transaction(() => {
      const c = upsertCustomer(req.body);
      if (campaign_id) enroll(c.id, campaign_id, start_date);
      return c;
    });
    res.status(201).json(customer);
  });

  api.put('/customers/:id', (req, res) => {
    const current = getCustomer(req.params.id);
    const { name = current.name, phone = current.phone, consent = current.consent, opted_out = current.opted_out, note = current.note } = req.body;
    const normalized = normalizePhone(phone);
    if (!normalized) throw new HttpError(400, `Geçersiz cep telefonu: ${phone}`);
    try {
      db.prepare('UPDATE customers SET name = ?, phone = ?, consent = ?, opted_out = ?, note = ? WHERE id = ?')
        .run(name, normalized, consent ? 1 : 0, opted_out ? 1 : 0, note, current.id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Bu telefon başka bir müşteride kayıtlı');
      throw e;
    }
    res.json(getCustomer(current.id));
  });

  api.delete('/customers/:id', (req, res) => {
    getCustomer(req.params.id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // RET: müşterinin tüm aktif akışları durdurulur.
  api.post('/opt-out', (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const customer = phone && db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    if (!customer) throw new HttpError(404, 'Bu numarayla kayıtlı müşteri yok');
    transaction(() => {
      db.prepare('UPDATE customers SET opted_out = 1 WHERE id = ?').run(customer.id);
      db.prepare(`UPDATE enrollments SET status = 'cancelled' WHERE customer_id = ? AND status = 'active'`).run(customer.id);
    });
    res.json(getCustomer(customer.id));
  });

  // ---------- Kayıtlar (müşteri x kampanya) ----------
  api.get('/enrollments', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.campaign_id) { where.push('e.campaign_id = ?'); params.push(req.query.campaign_id); }
    if (req.query.customer_id) { where.push('e.customer_id = ?'); params.push(req.query.customer_id); }
    if (req.query.status) { where.push('e.status = ?'); params.push(req.query.status); }
    const rows = db.prepare(`
      SELECT e.*, c.name AS customer_name, c.phone, c.consent, c.opted_out, k.name AS campaign_name, k.active AS campaign_active
      FROM enrollments e JOIN customers c ON c.id = e.customer_id JOIN campaigns k ON k.id = e.campaign_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.id DESC
    `).all(...params);
    for (const r of rows) {
      r.plan = enrollmentPlan(db, r.id).map((s) => ({
        day_offset: s.day_offset,
        due_at: computeDueAt(r.start_date, s.day_offset, s.send_time).toISOString(),
        status: s.status || 'pending',
        attempts: s.attempts || 0,
        error: s.error,
      }));
    }
    res.json(rows);
  });

  api.post('/enrollments', (req, res) => {
    const { customer_id, campaign_id, start_date } = req.body;
    res.status(201).json(enroll(customer_id, campaign_id, start_date));
  });

  api.post('/enrollments/:id/cancel', (req, res) => {
    const r = db.prepare(`UPDATE enrollments SET status = 'cancelled' WHERE id = ? AND status = 'active'`).run(req.params.id);
    if (!r.changes) throw new HttpError(404, 'Aktif kayıt bulunamadı');
    res.json(db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.id));
  });

  // ---------- Dış entegrasyon: reklam formundan gelen lead ----------
  // Meta/Google lead formu, web sitesi formu, n8n/Zapier vb. buraya POST eder.
  api.post('/leads', (req, res) => {
    if (apiKey && req.get('x-api-key') !== apiKey) throw new HttpError(401, 'Geçersiz API anahtarı');
    const { name, phone, campaign_id, consent, start_date, note } = req.body;
    if (!campaign_id) throw new HttpError(400, 'campaign_id gerekli');
    const result = transaction(() => {
      const customer = upsertCustomer({ name, phone, consent, note });
      return { customer, enrollment: enroll(customer.id, campaign_id, start_date) };
    });
    res.status(201).json(result);
  });

  // ---------- Bitrix24 ----------
  const bitrixSync = bitrix && createBitrixSync({ db, ...bitrix, upsertCustomer, enroll, transaction });
  const requireBitrix = () => {
    if (!bitrixSync) throw new HttpError(503, 'Bitrix bağlantısı yapılandırılmamış (BITRIX_WEBHOOK_URL)');
    return bitrixSync;
  };
  const entityType = (t) => {
    if (!['lead', 'deal'].includes(t)) throw new HttpError(400, 'Tür "lead" veya "deal" olmalı');
    return t;
  };

  // Seriyi durduran statüler (randevu, satış, olumsuz…). Diğer statülere geçişte seri devam eder.
  api.get('/settings', (req, res) => res.json({ bitrix_stop_stages: getStopStages(db) }));
  api.put('/settings', (req, res) => {
    if (req.body.bitrix_stop_stages !== undefined) setStopStages(db, cleanStages(req.body.bitrix_stop_stages));
    res.json({ bitrix_stop_stages: getStopStages(db) });
  });

  api.get('/bitrix/status', (req, res) => res.json({ configured: !!bitrixSync, project_field: bitrix?.config.projectField || null }));
  // Bitrix > Geliştirici kaynakları > Giden webhook bu adrese bağlanır.
  api.post('/bitrix/webhook', wrap(async (req, res) => res.json(await requireBitrix().handleEvent(req.body))));
  // Elle tetikleme / test: { "type": "deal", "id": 123 }
  api.post('/bitrix/sync', wrap(async (req, res) => {
    res.json(await requireBitrix().sync(entityType(req.body.type), req.body.id, { force: true }));
  }));
  api.get('/bitrix/stages', wrap(async (req, res) => res.json(await requireBitrix().stages(entityType(req.query.type)))));
  api.get('/bitrix/project-options', wrap(async (req, res) => {
    res.json(await requireBitrix().projectOptions(entityType(req.query.type)));
  }));

  // ---------- Mesaj geçmişi / zamanlayıcı ----------
  api.get('/messages', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const params = [];
    let where = '';
    if (req.query.status) { where = 'WHERE m.status = ?'; params.push(req.query.status); }
    res.json(db.prepare(`
      SELECT m.*, s.day_offset, c.name AS customer_name, k.name AS campaign_name
      FROM messages m
      JOIN enrollments e ON e.id = m.enrollment_id
      JOIN customers c ON c.id = e.customer_id
      JOIN campaigns k ON k.id = e.campaign_id
      JOIN campaign_steps s ON s.id = m.step_id
      ${where} ORDER BY m.updated_at DESC LIMIT ${limit}
    `).all(...params));
  });

  api.get('/stats', (req, res) => {
    const count = (sql) => db.prepare(sql).get().n;
    res.json({
      campaigns: count('SELECT COUNT(*) n FROM campaigns WHERE active = 1'),
      customers: count('SELECT COUNT(*) n FROM customers'),
      active_enrollments: count(`SELECT COUNT(*) n FROM enrollments WHERE status = 'active'`),
      sent: count(`SELECT COUNT(*) n FROM messages WHERE status = 'sent'`),
      failed: count(`SELECT COUNT(*) n FROM messages WHERE status = 'failed'`),
    });
  });

  // Canlı deneme: tek bir numaraya tek SMS gönderir ve sağlayıcının ham yanıtını döner.
  api.post('/test-sms', wrap(async (req, res) => {
    if (!provider) throw new HttpError(503, 'SMS sağlayıcısı yok');
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw new HttpError(400, `Geçersiz cep telefonu: ${req.body.phone}`);
    const message = String(req.body.message || '').trim();
    if (!message) throw new HttpError(400, 'Mesaj boş olamaz');
    try {
      const { ref } = await provider.send(phone, message);
      res.json({ ok: true, provider: provider.name, phone, response: ref });
    } catch (err) {
      res.status(502).json({ ok: false, provider: provider.name, phone, error: String(err.message || err) });
    }
  }));

  api.post('/scheduler/run', wrap(async (req, res) => res.json(await scheduler.tick())));

  app.use('/api', api);

  // Üretimde React build'ini aynı sunucudan servis et.
  if (fs.existsSync(buildDir)) {
    app.use(express.static(buildDir));
    app.get('*', (req, res) => res.sendFile(path.join(buildDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Sunucu hatası' : err.message });
  });

  return app;
}

module.exports = { createApp };
