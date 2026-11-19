import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createApp } from '../src/app.js';
import { createServer } from 'node:http';
import { createSmsClient } from '../src/sms.js';

const config = {
  jwtSecret: 'test', timezone: 'Europe/Istanbul',
  pbx: { webhookSecret: 'hook', huntGroupDestination: 'queue:karsilama', customerAnnouncement: 'anons', huntIvr: true },
};
const pushes = [];
const bitrixCalls = [];
const bitrix = { call: async (method, params) => { bitrixCalls.push([method, params]); return method.endsWith('register') ? { CALL_ID: 'externalCall.1' } : true; } };
let base, provider, db, appInstance, tokens = {};
// Sahte SMS firması: gelen XML'leri kaydeder; mesajında 'BOZUK' geçerse hata döner
const smsSeen = [];

before(async () => {
  db = openDb(':memory:');
  const pw = hashPassword('Sifre1234');
  const add = db.prepare(`INSERT INTO users (name, role, email, password_hash, phone, forward_phone, extension, push_token,
    work_start, work_end, saturday_enabled, saturday_start, saturday_end, sunday_enabled, sunday_start, sunday_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '00:00', '23:59', 1, '00:00', '23:59', 1, '00:00', '23:59')`);
  add.run('KAAN', 'danisman', 'kaan@x.com', pw, '+905050000000', '+905050000000', '1001', 'ExpoPushToken[kaan]');
  add.run('BROKER', 'broker', 'broker@x.com', pw, '+905060000000', null, '1000', null);
  add.run('BAŞKA', 'danisman', 'baska@x.com', pw, '+905070000000', null, '1002', null);
  db.exec('UPDATE users SET bitrix_user_id = 15 WHERE id = 1');
  db.exec(`INSERT INTO numbers (did, type, user_id, label) VALUES ('+908504660149', 'personal', 1, 'Dijital hat'),
    ('+908504660150', 'listing', 1, 'İlan 638'), ('4442453', 'hunt', NULL, '444')`);
  db.exec(`INSERT INTO contacts (name, phone, type, owner_id) VALUES ('MUSTAFA UTKU', '+905464962638', 'ALICI', 1)`);

  provider = createMockProvider();
  const smsServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { smsSeen.push({ type: req.headers['content-type'], body }); res.end(body.includes('BOZUK') ? 'HATA: yetersiz bakiye' : 'OK 123456'); });
  }).listen(0);
  smsServer.unref();
  const sms = createSmsClient({ url: `http://127.0.0.1:${smsServer.address().port}/sms`, username: 'kullanici', password: 'gizli&<', header: 'XRE', type: 'UC' });
  appInstance = createApp({ db, provider, config, bitrix, sms, notify: async (...a) => pushes.push(a) });
  const server = appInstance.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  server.unref();
  for (const who of ['kaan', 'broker', 'baska']) {
    tokens[who] = (await call('POST', '/api/auth/login', { email: `${who}@x.com`, password: 'Sifre1234' })).body.token;
  }
});

async function call(method, path, body, { token, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

const signed = (body) => ({ headers: { 'x-signature': createHmac('sha256', 'hook').update(JSON.stringify(body)).digest('hex') } });

test('kullanıcı adı büyük harf ve Türkçe karakterle de girer', async () => {
  db.exec("UPDATE users SET email = 'kaan.ince' WHERE id = 1");
  try {
    assert.equal((await call('POST', '/api/auth/login', { email: ' KAAN.İNCE ', password: 'Sifre1234' })).status, 200);
  } finally {
    db.exec("UPDATE users SET email = 'kaan@x.com' WHERE id = 1");
  }
});

test('yanlış şifre reddedilir', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: 'kaan@x.com', password: 'yanlis' })).status, 401);
});

test('maskeli arama danışmanın dijital numarasıyla başlatılır', async () => {
  const res = await call('POST', '/api/calls/click-to-call', { contactId: 1 }, { token: tokens.kaan });
  assert.equal(res.status, 201);
  const sent = provider.originated.at(-1);
  assert.equal(sent.callerId, '+908504660149');
  assert.equal(sent.customerPhone, '+905464962638');
  assert.equal(sent.agentExtension, '1001');
  assert.equal(res.body.contact_id, 1);
});

test('bozuk token 401 döner, kişi araması telefonla çalışır', async () => {
  assert.equal((await call('GET', '/api/me', null, { token: 'a.b.c' })).status, 401);
  const found = (await call('GET', `/api/contacts?q=${encodeURIComponent('0546 496')}`, null, { token: tokens.kaan })).body;
  assert.deepEqual(found.map((c) => c.name), ['MUSTAFA UTKU']);
  assert.equal((await call('GET', '/api/contacts?q=utku', null, { token: tokens.kaan })).body.length, 1);
});

test('dahili gerektirmeyen santralde dahilisi olmayan danışman da arama başlatır', async () => {
  db.exec("UPDATE users SET extension = NULL WHERE id = 1");
  try {
    const res = await call('POST', '/api/calls/click-to-call', { contactId: 1 }, { token: tokens.kaan });
    assert.equal(res.status, 201);
    assert.equal(provider.originated.at(-1).agentPhone, '+905050000000');
    provider.requiresExtension = true;
    assert.equal((await call('POST', '/api/calls/click-to-call', { contactId: 1 }, { token: tokens.kaan })).status, 409);
  } finally {
    delete provider.requiresExtension;
    db.exec("UPDATE users SET extension = '1001' WHERE id = 1");
  }
});

test('webhook imzasız istekleri reddeder', async () => {
  assert.equal((await call('POST', '/webhooks/pbx/route', { from: '1', to: '2' })).status, 401);
});

test('ilan numarasını arayan müşteri danışmana yönlendirilir, bildirim gider, kayıt dinlenir', async () => {
  const route = { callId: 'in-1', from: '05464962638', to: '908504660150' };
  const r = await call('POST', '/webhooks/pbx/route', route, signed(route));
  assert.equal(r.body.action, 'forward');
  assert.equal(r.body.destination, '+905050000000');
  assert.match(r.body.whisper, /MUSTAFA UTKU İlan 638 ilanından/);
  assert.deepEqual(pushes.at(-1).slice(0, 3), ['ExpoPushToken[kaan]', 'MUSTAFA UTKU', 'İlan 638 numaranızı arıyor']);

  const ev = { callId: 'in-1', direction: 'inbound', from: '05464962638', to: '908504660150', status: 'completed', duration: 42, recording: 'rec-1' };
  assert.equal((await call('POST', '/webhooks/pbx/event', ev, signed(ev))).status, 200);

  const calls = (await call('GET', '/api/calls', null, { token: tokens.kaan })).body;
  const inbound = calls.find((c) => c.provider_call_id === 'in-1');
  assert.equal(inbound.duration_sec, 42);
  assert.equal(inbound.dialed_label, 'İlan 638');
  assert.equal(inbound.contact_name, 'MUSTAFA UTKU');
  assert.equal((await call('GET', `/api/calls/${inbound.id}`, null, { token: tokens.kaan })).body.dialed_label, 'İlan 638');
  assert.equal((await call('GET', `/api/calls/${inbound.id}`, null, { token: tokens.baska })).status, 404);

  // Biten çağrı Bitrix CRM'e kayıtla birlikte yazılır
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(bitrixCalls.map(([m]) => m),
    ['telephony.externalcall.register', 'telephony.externalcall.finish', 'telephony.externalcall.attachRecord']);
  const [, reg] = bitrixCalls[0];
  assert.equal(reg.USER_ID, 15);
  assert.equal(reg.PHONE_NUMBER, '05464962638');
  assert.equal(reg.TYPE, 2);
  assert.equal(reg.LINE_NUMBER, '08504660150');
  assert.equal(bitrixCalls[1][1].DURATION, 42);
  assert.equal(Buffer.from(bitrixCalls[2][1].FILE_CONTENT, 'base64').toString(), 'mock-audio');
  assert.equal(inbound.bitrix_call_id ?? (await call('GET', `/api/calls/${inbound.id}`, null, { token: tokens.kaan })).body.bitrix_call_id, 'externalCall.1');

  assert.equal((await call('GET', `/api/calls/${inbound.id}/recording`, null, { token: tokens.kaan })).status, 200);
  assert.equal((await call('GET', `/api/calls/${inbound.id}/recording`, null, { token: tokens.baska })).status, 403);
  assert.equal((await call('GET', `/api/calls/${inbound.id}/recording`, null, { token: tokens.broker })).status, 403);
  await call('PUT', '/api/me/santral', { recording_broker: true }, { token: tokens.kaan });
  assert.equal((await call('GET', `/api/calls/${inbound.id}/recording`, null, { token: tokens.broker })).status, 200);
});

test('santral aranan numara yerine dahiliyi gönderirse de danışman bulunur', async () => {
  const route = { callId: 'in-ext', from: '05551234567', to: '1001' };
  const r = await call('POST', '/webhooks/pbx/route', route, signed(route));
  assert.equal(r.body.action, 'forward');
  assert.equal(r.body.userId, 1);
});

test('asistan tanımlıyken kayıtsız müşteri asistana, kayıtlı müşteri danışmana gider', async () => {
  config.pbx.assistantDestination = '+905312814423';
  try {
    const unknown = { callId: 'in-asst', from: '05440000000', to: '908504660149' };
    assert.equal((await call('POST', '/webhooks/pbx/route', unknown, signed(unknown))).body.destination, '+905312814423');
    const known = { callId: 'in-known', from: '05464962638', to: '908504660149' };
    assert.equal((await call('POST', '/webhooks/pbx/route', known, signed(known))).body.destination, '+905050000000');
  } finally {
    config.pbx.assistantDestination = '';
  }
});

test('santral düz metin cevap verirse metin olarak döner, olay form gövdesiyle gelir', async () => {
  const original = provider.formatRouteResponse;
  provider.formatRouteResponse = () => 'forward,05050000000,1,1';
  try {
    const route = { callId: 'txt-1', from: '05464962638', to: '908504660150' };
    const r = await call('POST', '/webhooks/pbx/route', route, signed(route));
    assert.equal(r.body, 'forward,05050000000,1,1');
  } finally {
    provider.formatRouteResponse = original;
  }
  // Asterisk CURL() POST gövdesi application/x-www-form-urlencoded gelir
  const form = 'callId=txt-1&direction=inbound&from=05464962638&to=908504660150&status=completed&duration=7';
  const res = await fetch(`${base}/webhooks/pbx/event?token=hook`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  assert.equal(res.status, 200);
  const calls = (await call('GET', '/api/calls', null, { token: tokens.kaan })).body;
  assert.equal(calls.find((c) => c.provider_call_id === 'txt-1').duration_sec, 7);
});

test('tarayıcı telefonu: bilgiler sadece santral destekliyorsa verilir ve şifre kalıcıdır', async () => {
  assert.equal((await call('GET', '/api/me/sip', null, { token: tokens.kaan })).body.enabled, false);
  provider.supportsBrowserPhone = true;
  try {
    const a = (await call('GET', '/api/me/sip', null, { token: tokens.kaan })).body;
    const b = (await call('GET', '/api/me/sip', null, { token: tokens.kaan })).body;
    assert.equal(a.enabled, true);
    assert.equal(a.user, 'u1');
    assert.match(a.password, /^[0-9a-f]{36}$/);
    assert.equal(a.password, b.password);
    assert.match(a.wsUrl, /^wss:\/\/127\.0\.0\.1:\d+\/ws$/);
  } finally {
    delete provider.supportsBrowserPhone;
  }
});

test('tarayıcıdan arama: santral danışmanın hattını sorar, arama kaydı açılır', async () => {
  const ask = async (body) => {
    const res = await fetch(`${base}/webhooks/pbx/outbound?token=hook`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
    });
    return res.text();
  };
  // 4. alan: hattın bağlı olduğu operatör bağlantısı (boşsa santralin varsayılan trunk'ı)
  assert.equal(await ask({ user: 'u1', to: '05464962638', callId: 'web-1' }), 'ok,08504660149,05464962638,');
  const calls = (await call('GET', '/api/calls', null, { token: tokens.kaan })).body;
  const row = calls.find((c) => c.provider_call_id === 'web-1');
  assert.deepEqual([row.direction, row.contact_name, row.dialed_number], ['outbound', 'MUSTAFA UTKU', '+908504660149']);
  assert.equal(await ask({ user: 'u999', to: '05464962638' }), 'deny,kullanici-yok');
  assert.equal(await ask({ user: 'u1', to: '00441234567890' }), 'deny,gecersiz-numara');
  assert.equal(await ask({ user: 'u3', to: '05464962638' }), 'deny,hat-yok');
  const unsigned = await fetch(`${base}/webhooks/pbx/outbound`, { method: 'POST', body: 'user=u1&to=05464962638', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(unsigned.status, 401);
});

test('hat başına operatör: giden arama hattın bağlantısından çıkar, gelen arama bağlantıyı öğretir', async () => {
  const ask = async (path, body) => (await fetch(`${base}${path}?token=hook`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  })).text();
  try {
    // Gelen arama hangi bağlantıdan geldiyse hat o bağlantıya kaydedilir (ilk kez)
    const route = { from: '05464962638', to: '908504660149', callId: 'tr-1', trunk: 'netgsm' };
    await call('POST', '/webhooks/pbx/route', route, signed(route));
    assert.equal(db.prepare("SELECT trunk FROM numbers WHERE did = '+908504660149'").get().trunk, 'netgsm');
    assert.equal(await ask('/webhooks/pbx/outbound', { user: 'u1', to: '05464962638' }), 'ok,08504660149,05464962638,netgsm');
    // Sonraki aramalar elle seçilen bağlantıyı değiştirmez
    const again = { ...route, callId: 'tr-2', trunk: 'tt' };
    await call('POST', '/webhooks/pbx/route', again, signed(again));
    assert.equal(db.prepare("SELECT trunk FROM numbers WHERE did = '+908504660149'").get().trunk, 'netgsm');
    // Geçersiz bağlantı adı yazılmaz
    db.exec("UPDATE numbers SET trunk = NULL WHERE did = '+908504660149'");
    const bad = { ...route, callId: 'tr-3', trunk: 'x;Dial' };
    await call('POST', '/webhooks/pbx/route', bad, signed(bad));
    assert.equal(db.prepare("SELECT trunk FROM numbers WHERE did = '+908504660149'").get().trunk, null);
  } finally {
    db.exec("UPDATE numbers SET trunk = NULL WHERE did = '+908504660149'");
  }
});

test('panelden aramada hattın operatör bağlantısı santrale iletilir', async () => {
  db.exec("UPDATE numbers SET trunk = 'verimor' WHERE did = '+908504660149'");
  try {
    const r = await call('POST', '/api/calls/click-to-call', { phone: '05464962638' }, { token: tokens.kaan });
    assert.equal(r.status, 201);
    assert.equal(provider.originated.at(-1).trunk, 'verimor');
  } finally {
    db.exec("UPDATE numbers SET trunk = NULL WHERE did = '+908504660149'");
  }
});

test('karşılama hattında tuşlanan dahili danışmana gider, santral IVR çalacağını bilir', async () => {
  const ask = async (body) => (await fetch(`${base}/webhooks/pbx/route?token=hook`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  })).json();
  db.exec("UPDATE users SET extension = '2020' WHERE id = 1");
  try {
    const first = await ask({ from: '05559998877', to: '4442453', callId: 'ivr-1' });
    assert.equal(first.ivr, true);
    const second = await ask({ from: '05559998877', to: '4442453', callId: 'ivr-1', ext: '2020' });
    assert.deepEqual([second.action, second.destination, second.userId], ['forward', '+905050000000', 1]);
    const calls = db.prepare("SELECT user_id FROM calls WHERE provider_call_id = 'ivr-1'").all();
    assert.deepEqual(calls.map((c) => c.user_id), [1]);
    const unknown = await ask({ from: '05559998877', to: '4442453', callId: 'ivr-2', ext: '9999' });
    assert.notEqual(unknown.userId, 1);
    // Kayıtlı müşteri (MUSTAFA UTKU, sorumlusu Kaan) 0850/444'ü ararsa tuşlatılmaz, doğrudan Kaan
    const known = await ask({ from: '05464962638', to: '4442453', callId: 'ivr-5' });
    assert.deepEqual([known.action, known.userId, known.ivr], ['forward', 1, false]);
    const personal = await ask({ from: '05559998877', to: '908504660149', callId: 'ivr-3' });
    assert.equal(personal.ivr, false);
    // Varsayılan: IVR kapalı
    config.pbx.huntIvr = false;
    assert.equal((await ask({ from: '05559998877', to: '4442453', callId: 'ivr-4' })).ivr, false);
  } finally {
    db.exec("UPDATE users SET extension = '1001' WHERE id = 1");
    config.pbx.huntIvr = true;
  }
});

test('kayıtsız müşteri: asistanların hepsi (tarayıcı telefonu) birlikte çalar', async () => {
  const pw = hashPassword('x');
  const add = db.prepare(`INSERT INTO users (name, role, email, password_hash, phone) VALUES (?, 'asistan', ?, ?, '+905310000000')`);
  const a1 = Number(add.run('ASİSTAN BİR', 'asistan1', pw).lastInsertRowid);
  const a2 = Number(add.run('ASİSTAN İKİ', 'asistan2', pw).lastInsertRowid);
  try {
    const route = { from: '05559998800', to: '4442453', callId: 'grp-1' };
    const r = await call('POST', '/webhooks/pbx/route', route, signed(route));
    assert.deepEqual(r.body.browserGroup, [`u${a1}`, `u${a2}`]);
    // Danışmana giden aramada grup yok
    const known = { from: '05464962638', to: '908504660149', callId: 'grp-2' };
    assert.equal((await call('POST', '/webhooks/pbx/route', known, signed(known))).body.browserGroup, undefined);
  } finally {
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(a1, a2);
  }
});

test('ofis saatleri yöneticiden ayarlanır, danışman uzmanlık alanı zorunlu', async () => {
  db.exec("UPDATE users SET role = 'admin' WHERE email = 'broker@x.com'");
  const adminToken = (await call('POST', '/api/auth/login', { email: 'broker@x.com', password: 'Sifre1234' })).body.token;
  try {
    const s = await call('GET', '/api/settings', null, { token: adminToken });
    assert.deepEqual(s.body, { office_start: '09:00', office_end: '18:00', office_days: '1,2,3,4,5,6' });
    assert.equal((await call('PUT', '/api/settings', { office_end: '19:30' }, { token: tokens.kaan })).status, 403);
    assert.equal((await call('PUT', '/api/settings', { office_end: '25:00' }, { token: adminToken })).status, 400);
    assert.equal((await call('PUT', '/api/settings', { office_days: '1,9' }, { token: adminToken })).status, 400);
    const saved = await call('PUT', '/api/settings', { office_end: '19:30', office_days: '1,2,3,4,5' }, { token: adminToken });
    assert.deepEqual([saved.body.office_end, saved.body.office_days], ['19:30', '1,2,3,4,5']);
    await call('PUT', '/api/settings', { office_end: '18:00', office_days: '1,2,3,4,5,6' }, { token: adminToken });

    // Danışman açarken uzmanlık zorunlu; asistan için değil
    assert.equal((await call('POST', '/api/users', { email: 'u.zman', name: 'u', phone: '05320000001' }, { token: adminToken })).status, 400);
    assert.equal((await call('POST', '/api/users', { email: 'u.zman', name: 'u', phone: '05320000001', specialties: ['villa'] }, { token: adminToken })).status, 400);
    const ok = await call('POST', '/api/users', { email: 'u.zman', name: 'u', phone: '05320000001', specialties: ['konut', 'arazi'] }, { token: adminToken });
    assert.equal(ok.body.user.specialties, 'konut,arazi');
    assert.equal((await call('POST', '/api/users', { email: 'a.sistan', name: 'a', phone: '05320000002', role: 'asistan' }, { token: adminToken })).status, 201);

    // Kişi kendi uzmanlığını seçer (ilk girişte)
    assert.equal((await call('PUT', '/api/me/specialties', { specialties: [] }, { token: tokens.kaan })).status, 400);
    const me = await call('PUT', '/api/me/specialties', { specialties: ['ticari'] }, { token: tokens.kaan });
    assert.equal(me.body.specialties, 'ticari');
  } finally {
    db.exec("UPDATE users SET role = 'broker' WHERE email = 'broker@x.com'");
    db.exec("DELETE FROM users WHERE email IN ('u.zman', 'a.sistan')");
  }
});

test('randevu: danışman oluşturur, kendi randevularını görür, tamamlar', async () => {
  const due = new Date(Date.now() + 26 * 3600e3).toISOString();
  assert.equal((await call('POST', '/api/appointments', { phone: '05464962638', due_at: 'yarın' }, { token: tokens.kaan })).status, 400);
  assert.equal((await call('POST', '/api/appointments', { due_at: due }, { token: tokens.kaan })).status, 400);
  const created = await call('POST', '/api/appointments', { contactId: 1, due_at: due, note: 'Yarın ara dedi' }, { token: tokens.kaan });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.name, created.body.phone, created.body.status, created.body.remind_before], ['MUSTAFA UTKU', '+905464962638', 'open', 60]);
  const byPhone = await call('POST', '/api/appointments', { phone: '0555 111 22 33', name: 'Yeni', due_at: due, remind_before: 30 }, { token: tokens.kaan });
  assert.equal(byPhone.body.remind_before, 30);

  const mine = (await call('GET', '/api/appointments', null, { token: tokens.kaan })).body;
  assert.equal(mine.length, 2);
  assert.equal((await call('GET', '/api/appointments', null, { token: tokens.baska })).body.length, 0);
  // Başkası güncelleyemez
  assert.equal((await call('PUT', `/api/appointments/${created.body.id}`, { status: 'done' }, { token: tokens.baska })).status, 404);
  const done = await call('PUT', `/api/appointments/${created.body.id}`, { status: 'done' }, { token: tokens.kaan });
  assert.equal(done.body.status, 'done');
  assert.equal((await call('GET', '/api/appointments', null, { token: tokens.kaan })).body.length, 1);
  assert.equal((await call('GET', '/api/appointments?status=all', null, { token: tokens.kaan })).body.length, 2);
  // Erteleme
  const later = new Date(Date.now() + 50 * 3600e3).toISOString();
  const moved = await call('PUT', `/api/appointments/${byPhone.body.id}`, { due_at: later }, { token: tokens.kaan });
  assert.equal(new Date(`${moved.body.due_at.replace(' ', 'T')}Z`).toISOString().slice(0, 16), later.slice(0, 16));
  assert.equal((await call('PUT', `/api/appointments/${byPhone.body.id}`, { status: 'x' }, { token: tokens.kaan })).status, 400);
  db.exec('DELETE FROM appointments');
});

test('SMS cevabı: kısa kod hata, uzun kimlik başarı; numara biçimi', async () => {
  const { parseSmsResult, formatSmsNumber } = await import('../src/sms.js');
  const xml = (c) => `<?xml version="1.0" encoding="utf-8"?><CORPORATESMS><RESULT>${c}</RESULT></CORPORATESMS>`;
  assert.equal(parseSmsResult(true, xml('081')), false);
  assert.equal(parseSmsResult(true, '<?xml version="1.0"?><CORPORATESMS><RESULT>1</RESULT><MSG_ID>4969635</MSG_ID><MSG_COUNT>1</MSG_COUNT></CORPORATESMS>'), true);
  assert.equal(parseSmsResult(true, xml('1')), true);
  assert.equal(parseSmsResult(true, xml('00'), ['00']), true);
  assert.equal(parseSmsResult(false, xml('1234567')), false);
  assert.deepEqual(['0', '10', '90'].map((f) => formatSmsNumber('+905061288930', f)), ['05061288930', '5061288930', '905061288930']);
});

test('SMS: şablon doldurulur, XML firmaya gider, loglanır; hata ve geçersiz numara', async () => {
  const t = await call('GET', '/api/sms/templates', null, { token: tokens.kaan });
  assert.equal(t.body.enabled, true);
  assert.ok(t.body.templates.some((x) => x.id === 'randevu'));
  const sent = await call('POST', '/api/sms', { contactId: 1, message: 'Sayın {ad}, danışmanınız {danisman} ({hat}). ]]> test' }, { token: tokens.kaan });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message, 'Sayın MUSTAFA UTKU, danışmanınız KAAN (08504660149). ]]> test');
  const xml = smsSeen.at(-1);
  assert.match(xml.type, /text\/xml/);
  assert.match(xml.body, /<USERNAME>kullanici<\/USERNAME>/);
  assert.match(xml.body, /<PASSWORD>gizli&amp;&lt;<\/PASSWORD>/);
  assert.match(xml.body, /<NUMBERS>905464962638<\/NUMBERS>/);
  assert.match(xml.body, /<SMS_MESSAGE><!\[CDATA\[Sayın MUSTAFA UTKU.*\]\]\]\]><!\[CDATA\[> test\]\]><\/SMS_MESSAGE>/s);
  assert.equal((await call('POST', '/api/sms', { phone: '03122191672', message: 'x' }, { token: tokens.kaan })).status, 400);
  assert.equal((await call('POST', '/api/sms', { phone: '05551112233', message: '' }, { token: tokens.kaan })).status, 400);
  const failed = await call('POST', '/api/sms', { phone: '05551112233', message: 'BOZUK' }, { token: tokens.kaan });
  assert.equal(failed.status, 502);
  const log = (await call('GET', '/api/sms?contactId=1', null, { token: tokens.kaan })).body;
  assert.deepEqual(log.map((l) => l.status), ['sent']);
  assert.equal((await call('GET', '/api/sms', null, { token: tokens.baska })).body.length, 0);
  // Randevu oluştururken müşteriye SMS
  const n = smsSeen.length;
  const a = await call('POST', '/api/appointments', { contactId: 1, due_at: new Date(Date.now() + 3600e3).toISOString(), sms: true }, { token: tokens.kaan });
  assert.equal(a.body.sms.ok, true);
  assert.match(smsSeen.at(-1).body, /MUSTAFA UTKU, XRE danismaniniz KAAN sizi \d\d\.\d\d \d\d:\d\d tarihinde arayacak/);
  assert.equal(smsSeen.length, n + 1);
  db.exec('DELETE FROM appointments');
});

test('ilan portalı: ilan eklenir, aranır; asistan aramayı ilanın danışmanına aktarır', async () => {
  // Danışman kendi ilanını ekler; başkası adına ekleyemez
  const mine = await call('POST', '/api/listings', { ref: '638', title: 'Çankaya 3+1 daire', category: 'konut', district: 'Çankaya', price: 7500000 }, { token: tokens.kaan });
  assert.equal(mine.status, 201);
  assert.deepEqual([mine.body.user_id, mine.body.user_name, mine.body.category], [1, 'KAAN', 'konut']);
  assert.equal((await call('POST', '/api/listings', { ref: '639', title: 'x', category: 'konut', user_id: 3 }, { token: tokens.kaan })).status, 403);
  assert.equal((await call('POST', '/api/listings', { ref: '640', title: 'x', category: 'villa' }, { token: tokens.kaan })).status, 400);
  // Broker başkası adına ekler
  const other = await call('POST', '/api/listings', { ref: '701', title: 'Gölbaşı arsa', category: 'arazi', user_id: 3 }, { token: tokens.broker });
  assert.equal(other.body.user_name, 'BAŞKA');
  assert.equal((await call('GET', '/api/listings?q=gölbaşı', null, { token: tokens.kaan })).body.length, 1);
  assert.equal((await call('GET', '/api/listings?q=638', null, { token: tokens.kaan })).body[0].title, 'Çankaya 3+1 daire');
  assert.equal((await call('PUT', `/api/listings/${other.body.id}`, { title: 'y' }, { token: tokens.kaan })).status, 403);

  // Santral: asistanın açtığı arama ilan 701'e aktarılır → BAŞKA'ya gider, ilan adı görünür
  const route = { from: '05551239999', to: '4442453', callId: 'tr-ilan-1' };
  await call('POST', '/webhooks/pbx/route', route, signed(route));
  db.exec("UPDATE users SET forward_phone = '+905070000000' WHERE id = 3");
  const ask = async (body) => (await fetch(`${base}/webhooks/pbx/transfer?token=hook`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
  })).json();
  const t = await ask({ callId: 'tr-ilan-1', listing: other.body.id });
  assert.deepEqual([t.action, t.destination, t.userId, t.callerName], ['forward', '+905070000000', 3, 'İlan 701 Gölbaşı arsa']);
  const row = db.prepare("SELECT user_id, listing_id FROM calls WHERE provider_call_id = 'tr-ilan-1'").get();
  assert.deepEqual([row.user_id, row.listing_id], [3, other.body.id]);
  const detail = (await call('GET', `/api/calls?scope=all`, null, { token: tokens.broker })).body.find((c) => c.provider_call_id === 'tr-ilan-1');
  assert.deepEqual([detail.listing_ref, detail.listing_title], ['701', 'Gölbaşı arsa']);
  assert.equal((await ask({ callId: 'tr-ilan-1', listing: 99999 })).action, 'reject');
  db.exec('UPDATE users SET forward_phone = NULL WHERE id = 3');
  db.exec("DELETE FROM calls WHERE provider_call_id = 'tr-ilan-1'");
  db.exec('DELETE FROM listings');
});

test('giriş: e-posta biçiminde yazılan kullanıcı adı da kabul edilir', async () => {
  db.exec("UPDATE users SET email = 'kaan.ince' WHERE id = 1");
  try {
    assert.equal((await call('POST', '/api/auth/login', { email: 'Kaan.Ince@xre.com.tr', password: 'Sifre1234' })).status, 200);
  } finally { db.exec("UPDATE users SET email = 'kaan@x.com' WHERE id = 1"); }
});

test('üye ol: başvuru onay bekler, yönetici onaylar ya da siler', async () => {
  const bad = await call('POST', '/api/auth/register', { name: 'Yeni Kişi', email: 'yeni.kisi', phone: '05321234567', password: 'kisa', specialties: ['konut'] });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/auth/register', { name: 'Yeni Kişi', email: 'yeni.kisi', phone: '05321234567', password: 'uzunSifre1' })).status, 400);
  const ok = await call('POST', '/api/auth/register', { name: 'Yeni Kişi', email: 'yeni.kisi', phone: '0532 123 45 67', password: 'uzunSifre1', specialties: ['konut', 'ticari'] });
  assert.equal(ok.status, 201);
  assert.equal((await call('POST', '/api/auth/register', { name: 'x', email: 'yeni.kisi', phone: '05321234567', password: 'uzunSifre1', specialties: ['konut'] })).status, 409);
  const pending = await call('POST', '/api/auth/login', { email: 'yeni.kisi', password: 'uzunSifre1' });
  assert.equal(pending.status, 403);
  assert.match(pending.body.error, /onay/);

  db.exec("UPDATE users SET role = 'admin' WHERE email = 'broker@x.com'");
  const adminToken = (await call('POST', '/api/auth/login', { email: 'broker@x.com', password: 'Sifre1234' })).body.token;
  try {
    const u = (await call('GET', '/api/users', null, { token: adminToken })).body.find((x) => x.email === 'yeni.kisi');
    assert.deepEqual([u.status, u.role, u.specialties, u.forward_phone], ['pending', 'danisman', 'konut,ticari', '+905321234567']);
    assert.equal(u.password_hash, undefined);
    assert.equal((await call('POST', `/api/users/${u.id}/approve`, null, { token: tokens.kaan })).status, 403);
    assert.equal((await call('POST', `/api/users/${u.id}/approve`, null, { token: adminToken })).body.status, 'active');
    assert.equal((await call('POST', '/api/auth/login', { email: 'yeni.kisi', password: 'uzunSifre1' })).status, 200);
    // Ekipten çıkarma: kendini silemez, danışman silemez; silinen giriş yapamaz, hattı boşa düşer
    db.exec(`INSERT INTO numbers (did, type, user_id, label) VALUES ('+905339990000', 'personal', ${u.id}, 'Test')`);
    const meId = (await call('GET', '/api/me', null, { token: adminToken })).body.id;
    assert.equal((await call('DELETE', `/api/users/${meId}`, null, { token: adminToken })).status, 400);
    assert.equal((await call('DELETE', `/api/users/${u.id}`, null, { token: tokens.kaan })).status, 403);
    assert.equal((await call('DELETE', `/api/users/${u.id}`, null, { token: adminToken })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: 'yeni.kisi', password: 'uzunSifre1' })).status, 401);
    assert.equal(db.prepare("SELECT user_id FROM numbers WHERE did = '+905339990000'").get().user_id, null);
    db.exec("DELETE FROM numbers WHERE did = '+905339990000'");
  } finally {
    db.exec("UPDATE users SET role = 'broker' WHERE email = 'broker@x.com'");
  }
});

test('şifremi unuttum: SMS ile kod gelir, kodla yeni şifre belirlenir', async () => {
  db.exec("UPDATE users SET forward_phone = '+905051112233' WHERE id = 3");
  try {
    const n = smsSeen.length;
    const r = await call('POST', '/api/auth/forgot', { email: 'baska@x.com' });
    assert.equal(r.status, 200);
    // Olmayan kullanıcıda da aynı cevap (kullanıcı adı tahmin edilmesin), SMS gitmez
    assert.equal((await call('POST', '/api/auth/forgot', { email: 'yok.boyle' })).status, 200);
    assert.equal(smsSeen.length, n + 1);
    const code = smsSeen.at(-1).body.match(/kodunuz: (\d{6})/)[1];
    assert.match(smsSeen.at(-1).body, /<NUMBERS>905051112233<\/NUMBERS>/);
    assert.equal((await call('POST', '/api/auth/reset', { email: 'baska@x.com', code: '000000', password: 'yeniSifre99' })).status, 400);
    assert.equal((await call('POST', '/api/auth/reset', { email: 'baska@x.com', code, password: 'kisa' })).status, 400);
    assert.equal((await call('POST', '/api/auth/reset', { email: 'baska@x.com', code, password: 'yeniSifre99' })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: 'baska@x.com', password: 'yeniSifre99' })).status, 200);
    // Kod bir kez kullanılır
    assert.equal((await call('POST', '/api/auth/reset', { email: 'baska@x.com', code, password: 'baskaSifre99' })).status, 400);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = 3').run(hashPassword('Sifre1234'));
  } finally {
    db.exec('UPDATE users SET forward_phone = NULL WHERE id = 3');
  }
});

test('randevu hatırlatma SMS\'i danışmanın cebine bir kez gider', async () => {
  db.exec("UPDATE users SET forward_phone = '+905050000000' WHERE id = 1");
  const due = new Date(Date.now() + 30 * 60e3).toISOString();
  await call('POST', '/api/appointments', { contactId: 1, due_at: due, note: 'Fiyat konuşulacak', remind_before: 60 }, { token: tokens.kaan });
  await call('POST', '/api/appointments', { contactId: 1, due_at: new Date(Date.now() + 5 * 3600e3).toISOString() }, { token: tokens.kaan });
  const n = smsSeen.length;
  await appInstance.locals.runReminders();
  await appInstance.locals.runReminders();
  assert.equal(smsSeen.length, n + 1);
  assert.match(smsSeen.at(-1).body, /<NUMBERS>905050000000<\/NUMBERS>/);
  assert.match(smsSeen.at(-1).body, /Hatirlatma: \d\d:\d\d MUSTAFA UTKU \(05464962638\) aranacak\. Fiyat konuşulacak/);
  db.exec('DELETE FROM appointments');
});

test('cevapsız çağrıda danışmana bildirim gider', async () => {
  const ev = { callId: 'in-2', direction: 'inbound', from: '05321112233', to: '908504660149', status: 'missed' };
  await call('POST', '/webhooks/pbx/event', ev, signed(ev));
  assert.deepEqual(pushes.at(-1).slice(0, 3), ['ExpoPushToken[kaan]', 'Cevapsız çağrı', '+905321112233 sizi aradı']);
});

test('santral ayarları doğrulanır ve kaydedilir', async () => {
  assert.equal((await call('PUT', '/api/me/santral', { work_end: '25:00' }, { token: tokens.kaan })).status, 400);
  const ok = await call('PUT', '/api/me/santral', { work_end: '23:46', sunday_enabled: false, forward_phone: '0505 035 29 40' }, { token: tokens.kaan });
  assert.equal(ok.body.work_end, '23:46');
  assert.equal(ok.body.sunday_enabled, 0);
  assert.equal(ok.body.forward_phone, '+905050352940');
  assert.equal(ok.body.password_hash, undefined);
});

test('yönetici ekip ve hatları yönetir, danışman yönetemez', async () => {
  db.exec("UPDATE users SET role = 'admin' WHERE email = 'broker@x.com'");
  const adminToken = (await call('POST', '/api/auth/login', { email: 'broker@x.com', password: 'Sifre1234' })).body.token;
  try {
    assert.equal((await call('GET', '/api/users', null, { token: tokens.baska })).status, 403);
    const created = await call('POST', '/api/users', { email: 'Yeni@x.com', name: 'yeni danışman', phone: '0532 000 00 00', specialties: ['konut'] }, { token: adminToken });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.name, 'YENİ DANIŞMAN');
    assert.equal((await call('POST', '/api/auth/login', { email: 'yeni@x.com', password: created.body.password })).status, 200);
    assert.equal((await call('POST', '/api/users', { email: 'yeni@x.com', name: 'x', phone: '05320000000', specialties: ['konut'] }, { token: adminToken })).status, 409);

    const did = encodeURIComponent('+908504660150');
    assert.equal((await call('PUT', `/api/numbers/${did}`, { user_id: created.body.user.id }, { token: tokens.kaan })).status, 403);
    const moved = await call('PUT', `/api/numbers/${did}`, { user_id: created.body.user.id, label: 'İlan 999' }, { token: adminToken });
    assert.deepEqual([moved.body.user_id, moved.body.label], [created.body.user.id, 'İlan 999']);
    const hunt = await call('PUT', `/api/numbers/4442453`, { user_id: created.body.user.id }, { token: adminToken });
    assert.equal(hunt.body.user_id, null);
    // Sadece ad değişince sahip korunur
    const renamed = await call('PUT', `/api/numbers/${did}`, { label: 'Yeni ad' }, { token: adminToken });
    assert.deepEqual([renamed.body.user_id, renamed.body.label], [created.body.user.id, 'Yeni ad']);
    // Operatör bağlantısı: geçerli ad ya da boş (varsayılan)
    assert.equal((await call('PUT', `/api/numbers/${did}`, { trunk: 'tt' }, { token: adminToken })).body.trunk, 'tt');
    assert.equal((await call('PUT', `/api/numbers/${did}`, { trunk: 'x y' }, { token: adminToken })).status, 400);
    // Tarayıcı telefonu kullanıcıları (u<id>) ve xre_ ayrılmış adlar bağlantı olamaz
    assert.equal((await call('PUT', `/api/numbers/${did}`, { trunk: 'u3' }, { token: adminToken })).status, 400);
    assert.equal((await call('PUT', `/api/numbers/${did}`, { trunk: 'xre_x' }, { token: adminToken })).status, 400);
    assert.equal((await call('PUT', `/api/numbers/${did}`, { trunk: 'u3x' }, { token: adminToken })).body.trunk, 'u3x');
    const cleared = await call('PUT', `/api/numbers/${did}`, { trunk: '' }, { token: adminToken });
    assert.deepEqual([cleared.body.trunk, cleared.body.user_id], [null, created.body.user.id]);
    await call('PUT', `/api/numbers/${did}`, { user_id: 1, label: 'İlan 638' }, { token: adminToken });

    const reset = await call('POST', `/api/users/${created.body.user.id}/reset-password`, null, { token: adminToken });
    assert.equal((await call('POST', '/api/auth/login', { email: 'yeni@x.com', password: reset.body.password })).status, 200);
  } finally {
    db.exec("UPDATE users SET role = 'broker' WHERE email = 'broker@x.com'");
  }
});

test('danışman yalnızca kendi çağrılarını, broker hepsini görür', async () => {
  assert.equal((await call('GET', '/api/calls', null, { token: tokens.baska })).body.length, 0);
  assert.ok((await call('GET', '/api/calls?scope=all', null, { token: tokens.broker })).body.length >= 3);
});

test('kişi: aynı numara iki kez eklenmez, sahibi/yönetici düzenler ve siler, sorumluyu yönetici değiştirir', async () => {
  const dup = await call('POST', '/api/contacts', { name: 'ikinci', phone: '0546 496 26 38' }, { token: tokens.baska });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /MUSTAFA UTKU.*KAAN/);
  const created = (await call('POST', '/api/contacts', { name: 'silinecek', phone: '05559998877' }, { token: tokens.kaan })).body;
  assert.equal((await call('GET', '/api/contacts?q=silinecek', null, { token: tokens.kaan })).body[0].owner_name, 'KAAN');
  // Başka danışman dokunamaz
  assert.equal((await call('PUT', `/api/contacts/${created.id}`, { name: 'x' }, { token: tokens.baska })).status, 403);
  assert.equal((await call('DELETE', `/api/contacts/${created.id}`, null, { token: tokens.baska })).status, 403);
  // Sahibi düzenler ama sorumluyu değiştiremez
  const edited = await call('PUT', `/api/contacts/${created.id}`, { name: 'yeni ad', type: 'SATICI' }, { token: tokens.kaan });
  assert.equal(edited.body.name, 'YENİ AD');
  assert.equal(edited.body.type, 'SATICI');
  assert.equal((await call('PUT', `/api/contacts/${created.id}`, { owner_id: 3 }, { token: tokens.kaan })).status, 403);
  assert.equal((await call('PUT', `/api/contacts/${created.id}`, { phone: '05464962638' }, { token: tokens.kaan })).status, 409);
  // Yönetici sorumluyu değiştirir; arama artık yeni sorumluya gider
  assert.equal((await call('PUT', `/api/contacts/${created.id}`, { owner_id: 3 }, { token: tokens.broker })).body.owner_id, 3);
  db.prepare("INSERT INTO calls (id, direction, customer_phone, user_id, contact_id, status) VALUES (9901, 'inbound', '+905559998877', 3, ?, 'completed')").run(created.id);
  assert.equal((await call('DELETE', `/api/contacts/${created.id}`, null, { token: tokens.broker })).status, 204);
  assert.equal(db.prepare('SELECT contact_id FROM calls WHERE id = 9901').get().contact_id, null);
  assert.equal((await call('DELETE', `/api/contacts/${created.id}`, null, { token: tokens.broker })).status, 404);
});

test('yönlendirilen telefon şirket hattı olamaz (arama santrale geri döner)', async () => {
  const before = db.prepare('SELECT forward_phone FROM users WHERE id = 1').get().forward_phone;
  const bad = await call('PUT', '/api/me/santral', { forward_phone: '0850 466 01 49' }, { token: tokens.kaan });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /şirket hattı/);
  assert.equal((await call('PUT', '/api/me/santral', { forward_phone: '444 24 53' }, { token: tokens.kaan })).status, 400);
  assert.equal(db.prepare('SELECT forward_phone FROM users WHERE id = 1').get().forward_phone, before);
});
