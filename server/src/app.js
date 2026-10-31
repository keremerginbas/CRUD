import express from 'express';
import { Readable } from 'node:stream';
import { hashPassword, requireAuth, signToken, verifyPassword, verifyWebhook } from './auth.js';
import { normalizePhone } from './phone.js';
import { decideInboundRoute } from './routing.js';
import { sendPush } from './push.js';
import { syncCallToBitrix } from './bitrix.js';

const SETTINGS_FIELDS = [
  'forward_phone', 'voice_announcement', 'recording_broker', 'recording_assistant',
  'work_start', 'work_end', 'saturday_enabled', 'saturday_start', 'saturday_end',
  'sunday_enabled', 'sunday_start', 'sunday_end',
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MANAGER_ROLES = new Set(['admin', 'broker', 'asistan']);

const publicUser = ({ password_hash, push_token, ...u }) => u;

export function createApp({ db, provider, config, notify = sendPush, bitrix = null }) {
  const app = express();
  const keepRaw = (req, _res, buf) => { req.rawBody = buf; };
  app.use(express.json({ verify: keepRaw }));
  app.use(express.urlencoded({ extended: false, verify: keepRaw }));

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    number: db.prepare('SELECT * FROM numbers WHERE did = ?'),
    numberByExtension: db.prepare(`SELECT n.* FROM numbers n JOIN users u ON u.id = n.user_id
      WHERE u.extension = ? AND n.type = 'personal' LIMIT 1`),
    numbersOfUser: db.prepare('SELECT * FROM numbers WHERE user_id = ? ORDER BY type'),
    personalNumber: db.prepare("SELECT did FROM numbers WHERE user_id = ? AND type = 'personal' LIMIT 1"),
    contactById: db.prepare('SELECT * FROM contacts WHERE id = ?'),
    contactByPhone: db.prepare('SELECT * FROM contacts WHERE phone = ? ORDER BY id LIMIT 1'),
    callById: db.prepare('SELECT * FROM calls WHERE id = ?'),
    callByProviderId: db.prepare('SELECT * FROM calls WHERE provider_call_id = ?'),
    insertCall: db.prepare(`INSERT INTO calls (provider_call_id, direction, customer_phone, dialed_number, user_id, contact_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
  };

  // Santral aranan numarayı tam numara (0533...) ya da dahili (114) olarak gönderebilir
  const findNumber = (dialed) => {
    const raw = String(dialed ?? '').replace(/\D/g, '');
    return q.number.get(normalizePhone(raw)) ?? (raw && raw.length <= 5 ? q.numberByExtension.get(raw) : undefined);
  };

  const auth = requireAuth(config.jwtSecret);
  const verify = verifyWebhook(config.pbx.webhookSecret);
  // PBX_LOG_WEBHOOKS=1: santralin gönderdiği ham alanları görmek için (yeni sağlayıcı bağlarken)
  const webhook = (req, res, next) => verify(req, res, () => {
    if (config.pbx.logWebhooks) console.log(`[webhook ${req.path}]`, JSON.stringify(req.body));
    next();
  });
  const me = (req) => q.userById.get(req.user.sub);

  // ---- Oturum ----
  app.post('/api/auth/login', (req, res) => {
    const user = q.userByEmail.get(String(req.body?.email ?? '').toLowerCase());
    if (!user || !verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
      return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
    }
    res.json({ token: signToken({ sub: user.id, role: user.role }, config.jwtSecret), user: publicUser(user) });
  });

  app.get('/api/me', auth, (req, res) => {
    const user = me(req);
    res.json({ ...publicUser(user), numbers: q.numbersOfUser.all(user.id) });
  });

  app.put('/api/me/password', auth, (req, res) => {
    const { current, next } = req.body ?? {};
    if (!verifyPassword(String(current ?? ''), me(req).password_hash)) return res.status(400).json({ error: 'Mevcut şifre hatalı' });
    if (String(next ?? '').length < 8) return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalı' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.sub);
    res.status(204).end();
  });

  app.put('/api/me/push-token', auth, (req, res) => {
    db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(req.body?.token ?? null, req.user.sub);
    res.status(204).end();
  });

  // ---- Santral ayarları ----
  app.put('/api/me/santral', auth, (req, res) => {
    const updates = {};
    for (const key of SETTINGS_FIELDS) {
      if (!(key in (req.body ?? {}))) continue;
      const value = req.body[key];
      if (key.endsWith('_start') || key.endsWith('_end')) {
        if (!TIME_RE.test(value)) return res.status(400).json({ error: `${key} SS:DD biçiminde olmalı` });
        updates[key] = value;
      } else if (key === 'forward_phone') {
        updates[key] = value ? normalizePhone(value) : null;
      } else {
        updates[key] = value ? 1 : 0;
      }
    }
    const keys = Object.keys(updates);
    if (keys.length) {
      db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => updates[k]), req.user.sub);
    }
    res.json(publicUser(me(req)));
  });

  // ---- Kişiler ----
  app.get('/api/contacts', auth, (req, res) => {
    const raw = String(req.query.q ?? '').trim();
    // "0532 123" gibi aramalar +90532123... ile eşleşsin
    const digits = raw.replace(/\D/g, '').replace(/^0/, '');
    res.json(db.prepare(`SELECT * FROM contacts WHERE name LIKE ? OR (? != '' AND phone LIKE ?)
      ORDER BY name COLLATE NOCASE LIMIT 500`).all(`%${raw.toLocaleUpperCase('tr-TR')}%`, digits, `%${digits}%`));
  });

  app.post('/api/contacts', auth, (req, res) => {
    const { name, phone, type = 'ALICI', note = null } = req.body ?? {};
    if (!name || !normalizePhone(phone)) return res.status(400).json({ error: 'İsim ve telefon zorunlu' });
    if (!['ALICI', 'SATICI'].includes(type)) return res.status(400).json({ error: 'Tip ALICI veya SATICI olmalı' });
    const { lastInsertRowid } = db.prepare('INSERT INTO contacts (name, phone, type, owner_id, note) VALUES (?, ?, ?, ?, ?)')
      .run(String(name).toLocaleUpperCase('tr-TR'), normalizePhone(phone), type, req.user.sub, note);
    res.status(201).json(q.contactById.get(lastInsertRowid));
  });

  // ---- Çağrılar ----
  const CALL_VIEW = `
    SELECT c.*, ct.name AS contact_name, ct.type AS contact_type, u.name AS user_name, n.label AS dialed_label
    FROM calls c
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN numbers n ON n.did = c.dialed_number`;

  app.get('/api/calls', auth, (req, res) => {
    const scopeAll = MANAGER_ROLES.has(req.user.role) && req.query.scope === 'all';
    res.json(db.prepare(`${CALL_VIEW} WHERE (? OR c.user_id = ?) ORDER BY c.started_at DESC, c.id DESC LIMIT 200`)
      .all(scopeAll ? 1 : 0, req.user.sub));
  });

  app.get('/api/calls/:id', auth, (req, res) => {
    const call = db.prepare(`${CALL_VIEW} WHERE c.id = ?`).get(req.params.id);
    if (!call || (call.user_id !== req.user.sub && !MANAGER_ROLES.has(req.user.role))) {
      return res.status(404).json({ error: 'Çağrı bulunamadı' });
    }
    res.json(call);
  });

  // Maskeli arama: santral önce danışmanı, sonra müşteriyi danışmanın dijital numarasıyla arar
  app.post('/api/calls/click-to-call', auth, async (req, res) => {
    const user = me(req);
    const contact = req.body?.contactId ? q.contactById.get(req.body.contactId) : null;
    const customerPhone = normalizePhone(contact?.phone ?? req.body?.phone);
    if (!customerPhone) return res.status(400).json({ error: 'Aranacak numara bulunamadı' });
    const callerId = q.personalNumber.get(user.id)?.did;
    if (!callerId) return res.status(409).json({ error: 'Size tanımlı dijital numara yok, yöneticinize başvurun' });
    if (!user.extension) return res.status(409).json({ error: 'Santral dahili numaranız tanımlı değil' });

    let providerCallId;
    try {
      ({ providerCallId } = await provider.originate({
        agentExtension: user.extension,
        agentPhone: user.forward_phone ?? user.phone,
        customerPhone,
        callerId,
        announcement: config.pbx.customerAnnouncement,
      }));
    } catch (err) {
      console.error(err);
      return res.status(502).json({ error: 'Santral aramayı başlatamadı' });
    }
    const contactId = contact?.id ?? q.contactByPhone.get(customerPhone)?.id ?? null;
    const { lastInsertRowid } = q.insertCall.run(providerCallId, 'outbound', customerPhone, callerId, user.id, contactId, 'initiated');
    res.status(201).json(q.callById.get(lastInsertRowid));
  });

  app.get('/api/calls/:id/recording', auth, async (req, res) => {
    const call = q.callById.get(req.params.id);
    if (!call?.recording_ref) return res.status(404).json({ error: 'Kayıt bulunamadı' });
    if (!canListen(req.user, call.user_id ? q.userById.get(call.user_id) : null)) {
      return res.status(403).json({ error: 'Bu kaydı dinleme yetkiniz yok' });
    }
    const upstream = await provider.fetchRecording(call.recording_ref);
    if (!upstream.ok) return res.status(502).json({ error: 'Kayıt santralden alınamadı' });
    res.set('content-type', upstream.headers.get('content-type') ?? 'audio/mpeg');
    Readable.fromWeb(upstream.body).pipe(res);
  });

  // ---- Santral webhook'ları ----
  // Gelen çağrı: santral hangi hedefe aktaracağını sorar
  app.post('/webhooks/pbx/route', webhook, (req, res) => {
    const { callerPhone: rawCaller, dialedNumber, providerCallId } = provider.parseRouteRequest(req.body);
    const callerPhone = normalizePhone(rawCaller);
    const number = findNumber(dialedNumber);
    const user = number?.user_id ? q.userById.get(number.user_id) : null;
    const contact = q.contactByPhone.get(callerPhone) ?? null;
    const decision = decideInboundRoute({
      number, user, contact, callerPhone,
      now: new Date(), timeZone: config.timezone, huntDestination: config.pbx.huntGroupDestination,
    });

    if (providerCallId && !q.callByProviderId.get(providerCallId)) {
      q.insertCall.run(providerCallId, 'inbound', callerPhone, number?.did ?? normalizePhone(dialedNumber),
        decision.userId, contact?.id ?? null, 'ringing');
    }
    if (user && decision.action === 'forward') {
      notify(user.push_token, contact?.name ?? callerPhone, `${number.label} numaranızı arıyor`,
        { type: 'incoming', providerCallId });
    }
    res.json(provider.formatRouteResponse(decision));
  });

  // Çağrı durum olayları (çaldı, açıldı, kapandı, kayıt hazır)
  app.post('/webhooks/pbx/event', webhook, (req, res) => {
    const ev = provider.parseEvent(req.body);
    if (!ev.providerCallId) return res.status(400).json({ error: 'Çağrı kimliği yok' });
    const customerPhone = normalizePhone(ev.customerPhone);
    const dialedNumber = normalizePhone(ev.dialedNumber);
    let call = q.callByProviderId.get(ev.providerCallId);

    if (!call) {
      // Santralde doğrudan başlayan çağrı (ör. 444 hattına gelen ve kuyruktan cevaplanan)
      const number = findNumber(ev.dialedNumber);
      q.insertCall.run(ev.providerCallId, ev.direction, customerPhone, dialedNumber,
        number?.user_id ?? null, q.contactByPhone.get(customerPhone)?.id ?? null, ev.status);
      call = q.callByProviderId.get(ev.providerCallId);
    }

    const ended = ['completed', 'missed', 'failed'].includes(ev.status);
    db.prepare(`UPDATE calls SET status = ?, duration_sec = MAX(duration_sec, ?), recording_ref = COALESCE(?, recording_ref),
      ended_at = CASE WHEN ? THEN datetime('now') ELSE ended_at END WHERE id = ?`)
      .run(ev.status, ev.durationSec || 0, ev.status === 'missed' ? null : ev.recordingRef, ended ? 1 : 0, call.id);

    if (ended && bitrix) syncToBitrix(call.id);

    if (ev.status === 'missed' && call.direction === 'inbound' && call.user_id) {
      const user = q.userById.get(call.user_id);
      const contact = call.contact_id ? q.contactById.get(call.contact_id) : null;
      notify(user.push_token, 'Cevapsız çağrı', `${contact?.name ?? customerPhone} sizi aradı`, { type: 'missed', callId: call.id });
    }
    res.json({ ok: true });
  });

  // Santral webhook'unu bekletmemek için arka planda çalışır; hata çağrıyı etkilemez
  async function syncToBitrix(callId) {
    const call = q.callById.get(callId);
    const user = call.user_id ? q.userById.get(call.user_id) : null;
    const bitrixUserId = user?.bitrix_user_id ?? config.bitrix?.defaultUserId;
    if (call.bitrix_call_id || !bitrixUserId) return;
    try {
      const bitrixCallId = await syncCallToBitrix({ bitrix, provider, call, bitrixUserId });
      db.prepare('UPDATE calls SET bitrix_call_id = ? WHERE id = ?').run(bitrixCallId, call.id);
    } catch (err) {
      console.error('Bitrix aktarımı başarısız:', err.message);
    }
  }

  app.get('/health', (_req, res) => res.json({ ok: true, provider: provider.name }));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  });

  return app;
}

// Santral ayarlarındaki "Ses Kaydını Dinlesin: Broker / Asistan" kuralı
export function canListen(viewer, owner) {
  if (viewer.role === 'admin') return true;
  if (!owner) return MANAGER_ROLES.has(viewer.role);
  if (viewer.sub === owner.id) return true;
  if (viewer.role === 'broker') return Boolean(owner.recording_broker);
  if (viewer.role === 'asistan') return Boolean(owner.recording_assistant);
  return false;
}
