import express from 'express';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { generatePassword, hashPassword, normalizeLogin, requireAuth, signToken, verifyPassword, verifyWebhook } from './auth.js';
import { normalizePhone, toLocalFormat, TRUNK_NAME_RE } from './phone.js';
import { decideInboundRoute, isOfficeOpen } from './routing.js';
import { sendPush } from './push.js';
import { syncCallToBitrix } from './bitrix.js';
import { DEFAULT_SMS_TEMPLATES, createSmsClient, fillTemplate } from './sms.js';

const SETTINGS_FIELDS = [
  'forward_phone', 'voice_announcement', 'recording_broker', 'recording_assistant',
  'work_start', 'work_end', 'saturday_enabled', 'saturday_start', 'saturday_end',
  'sunday_enabled', 'sunday_start', 'sunday_end',
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SPECIALTIES = ['konut', 'ticari', 'arazi'];
const SETTING_DEFAULTS = { office_start: '09:00', office_end: '18:00', office_days: '1,2,3,4,5,6' };
// Uzmanlık listesi: dizi ya da virgüllü metin → "konut,arazi" (geçersizse null)
const parseSpecialties = (raw) => {
  const list = [...new Set((Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  return list.length && list.every((s) => SPECIALTIES.includes(s)) ? SPECIALTIES.filter((s) => list.includes(s)).join(',') : null;
};
const MANAGER_ROLES = new Set(['admin', 'broker', 'asistan']);
const ROLES = ['admin', 'broker', 'asistan', 'danisman'];
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role)
  ? next() : res.status(403).json({ error: 'Bu işlem için yetkiniz yok' }));

// eslint-disable-next-line no-unused-vars
const publicUser = ({ password_hash, push_token, reset_code, reset_expires, reset_attempts, ...u }) => u;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export function createApp({ db, provider, config, notify = sendPush, bitrix = null, sms = createSmsClient(config.sms) }) {
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
    assistants: db.prepare("SELECT id FROM users WHERE role = 'asistan' ORDER BY id"),
    userByExtension: db.prepare('SELECT * FROM users WHERE extension = ? ORDER BY id LIMIT 1'),
    numbersOfUser: db.prepare('SELECT * FROM numbers WHERE user_id = ? ORDER BY type'),
    personalNumber: db.prepare("SELECT did, trunk FROM numbers WHERE user_id = ? AND type = 'personal' LIMIT 1"),
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

  const getSettings = () => ({ ...SETTING_DEFAULTS,
    ...Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value])) });

  const auth = requireAuth(config.jwtSecret);
  const manager = requireRole(...MANAGER_ROLES);
  const admin = requireRole('admin');
  const verify = verifyWebhook(config.pbx.webhookSecret);
  // PBX_LOG_WEBHOOKS=1: santralin gönderdiği ham alanları görmek için (yeni sağlayıcı bağlarken)
  const webhook = (req, res, next) => verify(req, res, () => {
    if (config.pbx.logWebhooks) console.log(`[webhook ${req.path}]`, JSON.stringify(req.body));
    next();
  });
  const me = (req) => q.userById.get(req.user.sub);

  // ---- Oturum ----
  // "ad.soyad@xre.com.tr" yazılırsa "ad.soyad" kullanıcısı da denenir
  const findLogin = (raw) => {
    const login = normalizeLogin(raw);
    return q.userByEmail.get(login) ?? (login.includes('@') ? q.userByEmail.get(login.split('@')[0]) : undefined);
  };

  app.post('/api/auth/login', (req, res) => {
    const user = findLogin(req.body?.email);
    if (!user || !verifyPassword(String(req.body?.password ?? ''), user.password_hash)) {
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });
    }
    if (user.status === 'pending') return res.status(403).json({ error: 'Hesabınız yönetici onayı bekliyor' });
    res.json({ token: signToken({ sub: user.id, role: user.role }, config.jwtSecret), user: publicUser(user) });
  });

  // Üye ol: başvuru danışman rolüyle açılır, yönetici onaylayana kadar giriş yapılamaz
  app.post('/api/auth/register', (req, res) => {
    const { name, email, phone, password } = req.body ?? {};
    const login = normalizeLogin(email);
    const specialties = parseSpecialties(req.body?.specialties);
    if (!String(name ?? '').trim() || !/^[a-z0-9._-]{3,40}$/.test(login)) return res.status(400).json({ error: 'Ad soyad ve kullanıcı adı (ad.soyad) zorunlu' });
    if (!/^\+905\d{9}$/.test(normalizePhone(phone))) return res.status(400).json({ error: 'Cep telefonu 05XX XXX XX XX biçiminde olmalı' });
    if (String(password ?? '').length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı' });
    if (!specialties) return res.status(400).json({ error: 'Uzmanlık alanı seçin (konut, ticari, arazi)' });
    if (q.userByEmail.get(login)) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış' });
    db.prepare(`INSERT INTO users (name, role, email, password_hash, phone, forward_phone, specialties, status)
      VALUES (?, 'danisman', ?, ?, ?, ?, ?, 'pending')`).run(String(name).trim().toLocaleUpperCase('tr-TR'), login,
      hashPassword(String(password)), normalizePhone(phone), normalizePhone(phone), specialties);
    res.status(201).json({ pending: true });
  });

  // Şifremi unuttum: kayıtlı cebe 6 haneli kod (10 dk, 5 deneme). Kullanıcı var mı yok mu belli edilmez
  app.post('/api/auth/forgot', async (req, res) => {
    const user = findLogin(req.body?.email);
    const phone = user?.forward_phone && /^\+905\d{9}$/.test(user.forward_phone) ? user.forward_phone
      : user?.phone && /^\+905\d{9}$/.test(user.phone) ? user.phone : null;
    if (user && user.status === 'active' && phone && sms.enabled) {
      const code = String(randomInt(0, 1e6)).padStart(6, '0');
      db.prepare("UPDATE users SET reset_code = ?, reset_expires = datetime('now', '+10 minutes'), reset_attempts = 0 WHERE id = ?")
        .run(sha(`${user.id}:${code}`), user.id);
      await sendSms(user, phone, `XRE Santral sifre sifirlama kodunuz: ${code} (10 dakika gecerli)`, null);
    }
    res.json({ ok: true, sms: sms.enabled });
  });

  app.post('/api/auth/reset', (req, res) => {
    const user = findLogin(req.body?.email);
    const password = String(req.body?.password ?? '');
    const fail = () => res.status(400).json({ error: 'Kod hatalı ya da süresi dolmuş' });
    if (!user?.reset_code || db.prepare("SELECT ? < datetime('now') AS old").get(user.reset_expires).old || user.reset_attempts >= 5) return fail();
    const given = Buffer.from(sha(`${user.id}:${String(req.body?.code ?? '').trim()}`));
    if (!timingSafeEqual(given, Buffer.from(user.reset_code))) {
      db.prepare('UPDATE users SET reset_attempts = reset_attempts + 1 WHERE id = ?').run(user.id);
      return fail();
    }
    if (password.length < 8) return res.status(400).json({ error: 'Şifre en az 8 karakter olmalı' });
    db.prepare('UPDATE users SET password_hash = ?, reset_code = NULL, reset_expires = NULL, reset_attempts = 0 WHERE id = ?')
      .run(hashPassword(password), user.id);
    res.json({ ok: true });
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

  // Tarayıcı telefonu bilgileri (sadece kendi santralimizde)
  app.get('/api/me/sip', auth, (req, res) => {
    if (!provider.supportsBrowserPhone) return res.json({ enabled: false });
    let { sip_secret: secret } = me(req);
    if (!secret) {
      secret = randomBytes(18).toString('hex');
      db.prepare('UPDATE users SET sip_secret = ? WHERE id = ?').run(secret, req.user.sub);
    }
    const host = req.get('x-forwarded-host') ?? req.get('host');
    res.json({
      enabled: true,
      wsUrl: config.sip?.wsUrl || `wss://${host}/ws`,
      domain: config.sip?.domain || host.split(':')[0],
      user: `u${req.user.sub}`,
      password: secret,
    });
  });

  // Uzmanlık alanı (ilk girişte zorunlu sorulur)
  app.put('/api/me/specialties', auth, (req, res) => {
    const specialties = parseSpecialties(req.body?.specialties);
    if (!specialties) return res.status(400).json({ error: 'En az bir uzmanlık alanı seçin (konut, ticari, arazi)' });
    db.prepare('UPDATE users SET specialties = ? WHERE id = ?').run(specialties, req.user.sub);
    res.json(publicUser(q.userById.get(req.user.sub)));
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
    res.json(db.prepare(`SELECT c.*, u.name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
      WHERE c.name LIKE ? OR (? != '' AND c.phone LIKE ?)
      ORDER BY c.name COLLATE NOCASE LIMIT 500`).all(`%${raw.toLocaleUpperCase('tr-TR')}%`, digits, `%${digits}%`));
  });

  // Aynı numara iki kez kaydedilmez: gelen arama numaradan tek bir sorumlu danışman bulmalı
  const duplicateContact = (phone, exceptId = 0) => db.prepare(`SELECT c.name, u.name AS owner_name FROM contacts c
    LEFT JOIN users u ON u.id = c.owner_id WHERE c.phone = ? AND c.id != ? LIMIT 1`).get(phone, exceptId);
  const duplicateError = (d) => ({ error: `Bu numara zaten kayıtlı: ${d.name}${d.owner_name ? ` (sorumlu: ${d.owner_name})` : ''}` });

  app.post('/api/contacts', auth, (req, res) => {
    const { name, phone, type = 'ALICI', note = null } = req.body ?? {};
    if (!name || !normalizePhone(phone)) return res.status(400).json({ error: 'İsim ve telefon zorunlu' });
    if (!['ALICI', 'SATICI'].includes(type)) return res.status(400).json({ error: 'Tip ALICI veya SATICI olmalı' });
    const dup = duplicateContact(normalizePhone(phone));
    if (dup) return res.status(409).json(duplicateError(dup));
    const { lastInsertRowid } = db.prepare('INSERT INTO contacts (name, phone, type, owner_id, note) VALUES (?, ?, ?, ?, ?)')
      .run(String(name).toLocaleUpperCase('tr-TR'), normalizePhone(phone), type, req.user.sub, note);
    res.status(201).json(q.contactById.get(lastInsertRowid));
  });

  // Kişiyi kendi sorumlusu ya da yönetici/broker/asistan düzenler ve siler; sorumlu danışmanı sadece onlar değiştirir
  const editableContact = (req, res) => {
    const contact = q.contactById.get(req.params.id);
    if (!contact) { res.status(404).json({ error: 'Kişi bulunamadı' }); return null; }
    if (contact.owner_id !== req.user.sub && !MANAGER_ROLES.has(req.user.role)) {
      res.status(403).json({ error: 'Bu kişi başka bir danışmana ait' }); return null;
    }
    return contact;
  };

  app.put('/api/contacts/:id', auth, (req, res) => {
    const contact = editableContact(req, res);
    if (!contact) return;
    const body = req.body ?? {};
    const name = String(body.name ?? contact.name).trim().toLocaleUpperCase('tr-TR');
    const phone = 'phone' in body ? normalizePhone(body.phone) : contact.phone;
    const type = body.type ?? contact.type;
    if (!name || !phone) return res.status(400).json({ error: 'İsim ve telefon zorunlu' });
    if (!['ALICI', 'SATICI'].includes(type)) return res.status(400).json({ error: 'Tip ALICI veya SATICI olmalı' });
    const dup = duplicateContact(phone, contact.id);
    if (dup) return res.status(409).json(duplicateError(dup));
    let ownerId = contact.owner_id;
    if ('owner_id' in body && body.owner_id !== contact.owner_id) {
      if (!MANAGER_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Sorumlu danışmanı yönetici değiştirir' });
      ownerId = body.owner_id === null ? null : Number(body.owner_id);
      if (ownerId !== null && !q.userById.get(ownerId)) return res.status(400).json({ error: 'Kullanıcı bulunamadı' });
    }
    const note = 'note' in body ? (String(body.note ?? '').trim() || null) : contact.note;
    db.prepare('UPDATE contacts SET name = ?, phone = ?, type = ?, owner_id = ?, note = ? WHERE id = ?')
      .run(name, phone, type, ownerId, note, contact.id);
    res.json(q.contactById.get(contact.id));
  });

  // Geçmiş aramalar, SMS ve randevular silinmez; sadece kişi bağlantısı boşalır
  app.delete('/api/contacts/:id', auth, (req, res) => {
    const contact = editableContact(req, res);
    if (!contact) return;
    db.exec('BEGIN');
    try {
      for (const t of ['calls', 'sms_log', 'appointments']) db.prepare(`UPDATE ${t} SET contact_id = NULL WHERE contact_id = ?`).run(contact.id);
      db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    res.status(204).end();
  });

  // ---- Çağrılar ----
  const CALL_VIEW = `
    SELECT c.*, ct.name AS contact_name, ct.type AS contact_type, u.name AS user_name, n.label AS dialed_label,
      l.ref AS listing_ref, l.title AS listing_title
    FROM calls c
    LEFT JOIN listings l ON l.id = c.listing_id
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
    const personal = q.personalNumber.get(user.id);
    const callerId = personal?.did;
    if (!callerId) return res.status(409).json({ error: 'Size tanımlı dijital numara yok, yöneticinize başvurun' });
    // Bulut santraller danışmanın dahilisini, kendi santralimiz danışmanın cep telefonunu arar
    if (provider.requiresExtension && !user.extension) return res.status(409).json({ error: 'Santral dahili numaranız tanımlı değil' });
    if (!user.forward_phone && !user.phone) return res.status(409).json({ error: 'Ayarlar sayfasından yönlendirilen telefonunuzu girin' });

    let providerCallId;
    try {
      ({ providerCallId } = await provider.originate({
        agentExtension: user.extension,
        agentPhone: user.forward_phone || user.phone,
        customerPhone,
        callerId,
        trunk: personal.trunk ?? null,
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
    const { callerPhone: rawCaller, dialedNumber, providerCallId, trunk, extension } = provider.parseRouteRequest(req.body);
    const callerPhone = normalizePhone(rawCaller);
    const number = findNumber(dialedNumber);
    // Numaranın hangi operatör bağlantısından geldiği ilk aramada öğrenilir; giden aramalar da oradan çıkar
    // (panelden elle seçilen bağlantı değiştirilmez)
    if (number && !number.trunk && TRUNK_NAME_RE.test(trunk ?? '')) {
      db.prepare('UPDATE numbers SET trunk = ? WHERE did = ? AND trunk IS NULL').run(trunk, number.did);
    }
    const user = number?.user_id ? q.userById.get(number.user_id) : null;
    const contact = q.contactByPhone.get(callerPhone) ?? null;
    const owner = contact?.owner_id ? q.userById.get(contact.owner_id) : null;
    // Karşılama hattında (444, 0850) arayanın IVR'da tuşladığı danışman dahilisi
    const ext = String(extension ?? '');
    const extensionUser = number?.type === 'hunt' && /^\d{2,6}$/.test(ext) ? q.userByExtension.get(ext) ?? null : null;
    const decision = decideInboundRoute({
      number, user, contact, owner, callerPhone,
      now: new Date(), timeZone: config.timezone,
      huntDestination: config.pbx.huntGroupDestination,
      assistantDestination: config.pbx.assistantDestination,
      callerAnnouncement: config.pbx.callerAnnouncement,
      extensionUser,
      officeOpen: isOfficeOpen(getSettings(), new Date(), config.timezone),
    });
    // HUNT_IVR=1 ise karşılama hattında santral önce "dahili tuşlayın" anonsunu çalar, sonra tuşlananla tekrar sorar.
    // Kayıtlı müşteri kendi danışmanına gidiyorsa tuşlatılmaz: doğrudan danışmanı çalar
    const toOwnConsultant = decision.action === 'forward' && !decision.reason && owner && decision.userId === owner.id;
    decision.ivr = Boolean(config.pbx.huntIvr) && number?.type === 'hunt' && !extensionUser && !toOwnConsultant;
    // Asistana giden arama: panelde açık olan asistanların hepsi birlikte çalar (masa telefonu gibi);
    // kimse açmazsa santral asistan hattına (cebe) düşer
    if (decision.action !== 'reject' && (decision.reason || decision.action === 'queue')) {
      decision.browserGroup = q.assistants.all().map((a) => `u${a.id}`);
    }

    if (decision.action !== 'reject' && providerCallId) {
      const existing = q.callByProviderId.get(providerCallId);
      if (!existing) {
        q.insertCall.run(providerCallId, 'inbound', callerPhone, number?.did ?? normalizePhone(dialedNumber),
          decision.userId, contact?.id ?? null, 'ringing');
      } else if (extensionUser && existing.user_id !== decision.userId) {
        db.prepare('UPDATE calls SET user_id = ? WHERE id = ?').run(decision.userId, existing.id);
      }
    }
    const target = decision.userId ? q.userById.get(decision.userId) : null;
    if (target && decision.action === 'forward' && decision.reason !== 'kayitsiz-musteri' && decision.reason !== 'mesai-disi') {
      notify(target.push_token, contact?.name ?? callerPhone, `${number.label} numaranızı arıyor`,
        { type: 'incoming', providerCallId });
    }
    const answer = provider.formatRouteResponse(decision);
    if (typeof answer === 'string') res.type('text').send(answer);
    else res.json(answer);
  });

  // Tarayıcıdan arama: santral "bu danışman bu numarayı arayabilir mi, hangi hattı göstereyim?" diye sorar.
  // Cevap düz metin: "ok,<hat>,<müşteri>,<operatör bağlantısı>" ya da "deny,<neden>"
  // (bağlantı boşsa santral varsayılan trunk'ı kullanır)
  app.post('/webhooks/pbx/outbound', webhook, (req, res) => {
    const userId = Number(String(req.body?.user ?? '').replace(/^u/, ''));
    const user = userId ? q.userById.get(userId) : null;
    const customerPhone = normalizePhone(req.body?.to);
    if (!user) return res.type('text').send('deny,kullanici-yok');
    if (!/^\+90[2-5]\d{9}$/.test(customerPhone)) return res.type('text').send('deny,gecersiz-numara');
    const personal = q.personalNumber.get(user.id);
    const line = personal?.did;
    if (!line) return res.type('text').send('deny,hat-yok');
    const callId = String(req.body?.callId ?? '');
    if (callId && !q.callByProviderId.get(callId)) {
      q.insertCall.run(callId, 'outbound', customerPhone, line, user.id, q.contactByPhone.get(customerPhone)?.id ?? null, 'initiated');
    }
    res.type('text').send(`ok,${toLocalFormat(line)},${toLocalFormat(customerPhone)},${personal.trunk ?? ''}`);
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

  // ---- İlan portalı ----
  const LISTING_VIEW = 'SELECT l.*, u.name AS user_name FROM listings l LEFT JOIN users u ON u.id = l.user_id';
  const listingById = db.prepare(`${LISTING_VIEW} WHERE l.id = ?`);
  const listingBody = (body, current = {}) => {
    const v = { ...current, ...Object.fromEntries(['ref', 'title', 'category', 'district', 'price', 'url', 'user_id', 'active'].filter((k) => k in (body ?? {})).map((k) => [k, body[k]])) };
    v.ref = String(v.ref ?? '').trim(); v.title = String(v.title ?? '').trim();
    if (!v.ref || !v.title) return { error: 'İlan no ve başlık zorunlu' };
    if (!SPECIALTIES.includes(v.category)) return { error: 'Kategori konut, ticari ya da arazi olmalı' };
    v.price = v.price === '' || v.price == null ? null : Math.round(Number(v.price));
    if (v.price !== null && !(v.price >= 0)) return { error: 'Geçersiz fiyat' };
    v.url = v.url ? String(v.url).trim() : null;
    if (v.url && !/^https?:\/\//i.test(v.url)) return { error: 'Bağlantı http:// ya da https:// ile başlamalı' };
    v.district = v.district ? String(v.district).trim() : null;
    v.active = v.active === undefined ? 1 : (v.active ? 1 : 0);
    return { value: v };
  };

  app.get('/api/listings', auth, (req, res) => {
    const term = `%${String(req.query.q ?? '').trim().toLocaleLowerCase('tr-TR')}%`;
    res.json(db.prepare(`${LISTING_VIEW} WHERE (? OR l.active = 1)
      AND (lower(l.ref || ' ' || l.title || ' ' || coalesce(l.district, '') || ' ' || coalesce(u.name, '')) LIKE ? OR l.title LIKE ?)
      ORDER BY l.active DESC, l.id DESC LIMIT 300`).all(req.query.all === '1' ? 1 : 0, term, `%${String(req.query.q ?? '').trim()}%`));
  });

  app.post('/api/listings', auth, (req, res) => {
    const isManager = MANAGER_ROLES.has(req.user.role);
    const userId = req.body?.user_id ? Number(req.body.user_id) : req.user.sub;
    if (!isManager && userId !== req.user.sub) return res.status(403).json({ error: 'Sadece kendi adınıza ilan ekleyebilirsiniz' });
    if (!q.userById.get(userId)) return res.status(400).json({ error: 'Danışman bulunamadı' });
    const { value: v, error } = listingBody({ ...req.body, user_id: userId });
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(`INSERT INTO listings (ref, title, category, district, price, url, user_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(v.ref, v.title, v.category, v.district, v.price, v.url, userId, v.active);
    res.status(201).json(listingById.get(lastInsertRowid));
  });

  app.put('/api/listings/:id', auth, (req, res) => {
    const current = listingById.get(req.params.id);
    if (!current) return res.status(404).json({ error: 'İlan bulunamadı' });
    const isManager = MANAGER_ROLES.has(req.user.role);
    if (!isManager && current.user_id !== req.user.sub) return res.status(403).json({ error: 'Bu ilanı düzenleme yetkiniz yok' });
    if (!isManager && 'user_id' in (req.body ?? {}) && Number(req.body.user_id) !== req.user.sub) {
      return res.status(403).json({ error: 'İlanı başkasına devredemezsiniz' });
    }
    const { value: v, error } = listingBody(req.body, current);
    if (error) return res.status(400).json({ error });
    if (v.user_id && !q.userById.get(v.user_id)) return res.status(400).json({ error: 'Danışman bulunamadı' });
    db.prepare('UPDATE listings SET ref = ?, title = ?, category = ?, district = ?, price = ?, url = ?, user_id = ?, active = ? WHERE id = ?')
      .run(v.ref, v.title, v.category, v.district, v.price, v.url, v.user_id ?? null, v.active, current.id);
    res.json(listingById.get(current.id));
  });

  // Santral: görüşmedeki (asistanın açtığı) arama bir ilana aktarıldı → ilanın danışmanına yönlendir
  app.post('/webhooks/pbx/transfer', webhook, (req, res) => {
    const listing = listingById.get(Number(req.body?.listing) || 0);
    const target = listing?.user_id ? q.userById.get(listing.user_id) : null;
    const callId = String(req.body?.callId ?? '');
    const callRow = callId ? q.callByProviderId.get(callId) : null;
    let decision;
    if (!listing || !target?.forward_phone) {
      decision = { action: 'reject', destination: null, userId: null, whisper: null };
    } else {
      const contact = callRow?.contact_id ? q.contactById.get(callRow.contact_id) : null;
      decision = {
        action: 'forward', destination: target.forward_phone, userId: target.id, callerAnnouncement: null,
        whisper: target.voice_announcement ? `${contact ? contact.name : 'Yeni müşteri'} ${listing.ref} numaralı ilan için arıyor.` : null,
        // Danışmanın panelinde arayanın adı yerine görünür
        callerName: `İlan ${listing.ref} ${listing.title}`.slice(0, 60),
      };
      if (callRow) db.prepare('UPDATE calls SET user_id = ?, listing_id = ? WHERE id = ?').run(target.id, listing.id, callRow.id);
      notify(target.push_token, contact?.name ?? callRow?.customer_phone ?? 'Müşteri', `${listing.ref} numaralı ilanınız için aktarıldı`, { type: 'incoming' });
    }
    const answer = provider.formatRouteResponse(decision);
    if (typeof answer === 'string') res.type('text').send(answer);
    else res.json(answer);
  });

  // ---- SMS ----
  const smsTemplates = () => {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'sms_templates'").get()?.value;
    try { return raw ? JSON.parse(raw) : DEFAULT_SMS_TEMPLATES; } catch { return DEFAULT_SMS_TEMPLATES; }
  };
  const smsVars = (user, contact, extra = {}) => ({
    ad: contact?.name ?? '', danisman: user?.name ?? '',
    hat: q.personalNumber.get(user?.id ?? 0)?.did ? toLocalFormat(q.personalNumber.get(user.id).did) : '', ...extra,
  });
  // Tek numaraya SMS gönderir ve loglar; { ok, id }
  async function sendSms(user, phone, message, contactId) {
    let result;
    try { result = await sms.send(toLocalFormat(phone), message); } catch (err) { result = { ok: false, response: err.message }; }
    const { lastInsertRowid } = db.prepare(`INSERT INTO sms_log (user_id, contact_id, phone, message, status, response)
      VALUES (?, ?, ?, ?, ?, ?)`).run(user?.id ?? null, contactId ?? q.contactByPhone.get(phone)?.id ?? null, phone, message,
      result.ok ? 'sent' : 'failed', result.response ?? null);
    return { ok: result.ok, id: Number(lastInsertRowid), response: result.response };
  }

  app.get('/api/sms/templates', auth, (req, res) => res.json({ enabled: sms.enabled, templates: smsTemplates() }));

  app.put('/api/sms/templates', auth, admin, (req, res) => {
    const list = Array.isArray(req.body?.templates) ? req.body.templates : null;
    if (!list || list.some((t) => !t?.title || !t?.text || String(t.text).length > 600)) {
      return res.status(400).json({ error: 'Her şablonun başlığı ve metni olmalı (en çok 600 karakter)' });
    }
    const clean = list.slice(0, 30).map((t, i) => ({ id: String(t.id ?? `t${i}`), title: String(t.title).slice(0, 60), text: String(t.text) }));
    db.prepare("INSERT INTO settings (key, value) VALUES ('sms_templates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(clean));
    res.json({ enabled: sms.enabled, templates: clean });
  });

  // Önizleme: şablon alanları doldurulmuş metin
  app.post('/api/sms/preview', auth, (req, res) => {
    const contact = req.body?.contactId ? q.contactById.get(req.body.contactId) : null;
    res.json({ text: fillTemplate(String(req.body?.text ?? ''), smsVars(me(req), contact)) });
  });

  app.post('/api/sms', auth, async (req, res) => {
    const user = me(req);
    const contact = req.body?.contactId ? q.contactById.get(req.body.contactId) : null;
    const phone = normalizePhone(contact?.phone ?? req.body?.phone);
    const message = fillTemplate(String(req.body?.message ?? '').trim(), smsVars(user, contact));
    if (!/^\+905\d{9}$/.test(phone)) return res.status(400).json({ error: 'SMS yalnızca Türkiye cep numaralarına gönderilir' });
    if (!message || message.length > 600) return res.status(400).json({ error: 'Mesaj boş olamaz (en çok 600 karakter)' });
    if (!sms.enabled) return res.status(503).json({ error: 'SMS ayarlı değil; yöneticinize başvurun' });
    const r = await sendSms(user, phone, message, contact?.id);
    if (!r.ok) return res.status(502).json({ error: `SMS gönderilemedi: ${r.response ?? ''}`.trim() });
    res.status(201).json(db.prepare('SELECT * FROM sms_log WHERE id = ?').get(r.id));
  });

  app.get('/api/sms', auth, (req, res) => {
    const phone = normalizePhone(req.query.phone);
    const contactId = Number(req.query.contactId) || null;
    const all = MANAGER_ROLES.has(req.user.role);
    res.json(db.prepare(`SELECT s.*, u.name AS user_name FROM sms_log s LEFT JOIN users u ON u.id = s.user_id
      WHERE (? OR s.user_id = ?) AND (? IS NULL OR s.contact_id = ?) AND (? = '' OR s.phone = ?)
      ORDER BY s.id DESC LIMIT 100`).all(all ? 1 : 0, req.user.sub, contactId, contactId, phone, phone));
  });

  // ---- Randevular (geri arama) ----
  const toSqlUtc = (raw) => {
    const d = new Date(String(raw ?? ''));
    return Number.isNaN(+d) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
  };
  const apptById = db.prepare('SELECT * FROM appointments WHERE id = ? AND user_id = ?');

  app.get('/api/appointments', auth, (req, res) => {
    const all = req.query.status === 'all';
    res.json(db.prepare(`SELECT * FROM appointments WHERE user_id = ? AND (? OR status = 'open')
      ORDER BY status = 'open' DESC, due_at ${all ? 'DESC' : 'ASC'} LIMIT 300`).all(req.user.sub, all ? 1 : 0));
  });

  app.post('/api/appointments', auth, async (req, res) => {
    const body = req.body ?? {};
    const contact = body.contactId ? q.contactById.get(body.contactId) : null;
    const phone = normalizePhone(contact?.phone ?? body.phone);
    const dueAt = toSqlUtc(body.due_at);
    if (!phone) return res.status(400).json({ error: 'Aranacak numara yok' });
    if (!dueAt) return res.status(400).json({ error: 'Randevu tarihi geçersiz' });
    const remind = Number.isInteger(Number(body.remind_before)) ? Math.min(Math.max(Number(body.remind_before), 0), 1440) : 60;
    const { lastInsertRowid } = db.prepare(`INSERT INTO appointments (user_id, contact_id, name, phone, due_at, remind_before, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user.sub, contact?.id ?? q.contactByPhone.get(phone)?.id ?? null,
      contact?.name ?? (String(body.name ?? '').trim().toLocaleUpperCase('tr-TR') || phone), phone, dueAt, remind, body.note ? String(body.note).slice(0, 500) : null);
    const created = apptById.get(lastInsertRowid, req.user.sub);
    // İsteğe bağlı: müşteriye "sizi şu tarihte arayacağız" SMS'i
    let smsResult = null;
    if (body.sms && sms.enabled && /^\+905\d{9}$/.test(phone)) {
      const tpl = smsTemplates().find((t) => t.id === 'randevu') ?? DEFAULT_SMS_TEMPLATES[2];
      const d = new Date(`${dueAt.replace(' ', 'T')}Z`);
      // Sunucuda Türkçe yerel ayar olmayabilir: parçaları kendimiz birleştiririz (18.11 12:00)
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
      const tarih = `${p.day}.${p.month} ${p.hour}:${p.minute}`;
      smsResult = await sendSms(me(req), phone, fillTemplate(tpl.text, smsVars(me(req), contact ?? q.contactById.get(created.contact_id ?? 0), { tarih })), created.contact_id);
    }
    res.status(201).json({ ...created, sms: smsResult && { ok: smsResult.ok } });
  });

  app.put('/api/appointments/:id', auth, (req, res) => {
    const a = apptById.get(req.params.id, req.user.sub);
    if (!a) return res.status(404).json({ error: 'Randevu bulunamadı' });
    const body = req.body ?? {};
    const status = body.status ?? a.status;
    if (!['open', 'done', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Geçersiz durum' });
    const dueAt = 'due_at' in body ? toSqlUtc(body.due_at) : a.due_at;
    if (!dueAt) return res.status(400).json({ error: 'Randevu tarihi geçersiz' });
    const note = 'note' in body ? (body.note ? String(body.note).slice(0, 500) : null) : a.note;
    db.prepare('UPDATE appointments SET status = ?, due_at = ?, note = ? WHERE id = ?').run(status, dueAt, note, a.id);
    res.json(apptById.get(a.id, req.user.sub));
  });

  // ---- Ekip ve hat yönetimi ----

  app.get('/api/users', auth, manager, (_req, res) => {
    res.json(db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all().map(publicUser));
  });

  app.get('/api/settings', auth, manager, (_req, res) => res.json(getSettings()));

  app.put('/api/settings', auth, admin, (req, res) => {
    const next = { ...getSettings() };
    for (const key of ['office_start', 'office_end']) {
      if (key in (req.body ?? {})) {
        if (!TIME_RE.test(req.body[key])) return res.status(400).json({ error: 'Saat SS:DD biçiminde olmalı' });
        next[key] = req.body[key];
      }
    }
    if ('office_days' in (req.body ?? {})) {
      const days = [...new Set(String(req.body.office_days).split(',').map((d) => d.trim()).filter(Boolean))];
      if (!days.length || days.some((d) => !/^[0-6]$/.test(d))) return res.status(400).json({ error: 'Geçersiz gün listesi' });
      next.office_days = days.sort().join(',');
    }
    const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(next)) put.run(k, v);
    res.json(getSettings());
  });

  app.post('/api/users', auth, admin, (req, res) => {
    const { email, name, role = 'danisman', phone, extension = null } = req.body ?? {};
    const specialties = parseSpecialties(req.body?.specialties);
    if (role === 'danisman' && !specialties) return res.status(400).json({ error: 'Uzmanlık alanı seçin (konut, ticari, arazi)' });
    if (!normalizeLogin(email) || !name || !normalizePhone(phone)) return res.status(400).json({ error: 'Kullanıcı adı, ad ve telefon zorunlu' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Geçersiz rol' });
    if (q.userByEmail.get(normalizeLogin(email))) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı' });
    const password = generatePassword();
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (name, role, email, password_hash, phone, forward_phone, extension, specialties)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(String(name).toLocaleUpperCase('tr-TR'), role, normalizeLogin(email),
      hashPassword(password), normalizePhone(phone), normalizePhone(phone), extension || null, specialties);
    res.status(201).json({ user: publicUser(q.userById.get(lastInsertRowid)), password });
  });

  app.post('/api/users/:id/approve', auth, admin, (req, res) => {
    if (!q.userById.get(req.params.id)) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(req.params.id);
    res.json(publicUser(q.userById.get(req.params.id)));
  });

  // Ekipten çıkarma: hatları boşa düşer, geçmiş aramalar kalır (kişi bağlantısı boşalır)
  app.delete('/api/users/:id', auth, admin, (req, res) => {
    const u = q.userById.get(req.params.id);
    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (u.id === req.user.sub) return res.status(400).json({ error: 'Kendinizi ekipten çıkaramazsınız' });
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    res.json({ ok: true });
  });

  app.post('/api/users/:id/reset-password', auth, admin, (req, res) => {
    if (!q.userById.get(req.params.id)) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const password = generatePassword();
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), req.params.id);
    res.json({ password });
  });

  app.get('/api/numbers', auth, manager, (_req, res) => {
    res.json(db.prepare(`SELECT n.*, u.name AS user_name FROM numbers n LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.type, n.did`).all());
  });

  app.put('/api/numbers/:did', auth, admin, (req, res) => {
    const number = q.number.get(req.params.did);
    if (!number) return res.status(404).json({ error: 'Hat bulunamadı' });
    // Gönderilmeyen alan değişmez (sadece ad değiştirmek sahibini silmesin)
    const userId = 'user_id' in (req.body ?? {}) ? (req.body.user_id ?? null) : number.user_id;
    if (userId !== null && !q.userById.get(userId)) return res.status(400).json({ error: 'Kullanıcı bulunamadı' });
    const label = String(req.body?.label ?? number.label).trim() || number.label;
    // Operatör bağlantısı: santraldeki trunk adı; boş = santralin varsayılanı
    let trunk = number.trunk;
    if ('trunk' in (req.body ?? {})) {
      trunk = String(req.body.trunk ?? '').trim().toLowerCase() || null;
      if (trunk && !TRUNK_NAME_RE.test(trunk)) return res.status(400).json({ error: 'Geçersiz bağlantı adı (küçük harf, rakam, _)' });
    }
    db.prepare('UPDATE numbers SET user_id = ?, label = ?, trunk = ? WHERE did = ?')
      .run(number.type === 'hunt' ? null : userId, label, trunk, number.did);
    res.json(q.number.get(number.did));
  });

  // Web arayüzü (public/): tek sayfalık uygulama
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '1h' }));

  app.get('/health', (_req, res) => res.json({ ok: true, provider: provider.name }));

  // Randevu hatırlatma SMS'i: hatırlatma zamanı gelen randevular için danışmanın cebine bir kez
  async function runReminders() {
    if (!sms.enabled) return;
    const due = db.prepare(`SELECT a.*, u.forward_phone FROM appointments a JOIN users u ON u.id = a.user_id
      WHERE a.status = 'open' AND a.sms_reminded = 0
        AND datetime(a.due_at, '-' || a.remind_before || ' minutes') <= datetime('now')
        AND a.due_at >= datetime('now', '-10 minutes')`).all();
    for (const a of due) {
      db.prepare('UPDATE appointments SET sms_reminded = 1 WHERE id = ?').run(a.id);
      if (!/^\+905\d{9}$/.test(a.forward_phone ?? '')) continue;
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(`${a.due_at.replace(' ', 'T')}Z`)).map((x) => [x.type, x.value]));
      await sendSms(q.userById.get(a.user_id), a.forward_phone,
        `Hatirlatma: ${p.hour}:${p.minute} ${a.name} (${toLocalFormat(a.phone)}) aranacak.${a.note ? ` ${a.note}` : ''}`, a.contact_id);
    }
  }
  app.locals.runReminders = runReminders;
  if (!config.disableJobs) setInterval(() => runReminders().catch((e) => console.error('Hatırlatma SMS:', e.message)), 60_000).unref();

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
