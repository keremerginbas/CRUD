import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { createMockProvider } from '../src/providers/mock.js';
import { createApp } from '../src/app.js';

const config = {
  jwtSecret: 'test', timezone: 'Europe/Istanbul',
  pbx: { webhookSecret: 'hook', huntGroupDestination: 'queue:karsilama', customerAnnouncement: 'anons' },
};
const pushes = [];
const bitrixCalls = [];
const bitrix = { call: async (method, params) => { bitrixCalls.push([method, params]); return method.endsWith('register') ? { CALL_ID: 'externalCall.1' } : true; } };
let base, provider, db, tokens = {};

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
  const server = createApp({ db, provider, config, bitrix, notify: async (...a) => pushes.push(a) }).listen(0);
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
  assert.equal(await ask({ user: 'u1', to: '05464962638', callId: 'web-1' }), 'ok,08504660149,05464962638');
  const calls = (await call('GET', '/api/calls', null, { token: tokens.kaan })).body;
  const row = calls.find((c) => c.provider_call_id === 'web-1');
  assert.deepEqual([row.direction, row.contact_name, row.dialed_number], ['outbound', 'MUSTAFA UTKU', '+908504660149']);
  assert.equal(await ask({ user: 'u999', to: '05464962638' }), 'deny,kullanici-yok');
  assert.equal(await ask({ user: 'u1', to: '00441234567890' }), 'deny,gecersiz-numara');
  assert.equal(await ask({ user: 'u3', to: '05464962638' }), 'deny,hat-yok');
  const unsigned = await fetch(`${base}/webhooks/pbx/outbound`, { method: 'POST', body: 'user=u1&to=05464962638', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(unsigned.status, 401);
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
    const created = await call('POST', '/api/users', { email: 'Yeni@x.com', name: 'yeni danışman', phone: '0532 000 00 00' }, { token: adminToken });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.name, 'YENİ DANIŞMAN');
    assert.equal((await call('POST', '/api/auth/login', { email: 'yeni@x.com', password: created.body.password })).status, 200);
    assert.equal((await call('POST', '/api/users', { email: 'yeni@x.com', name: 'x', phone: '05320000000' }, { token: adminToken })).status, 409);

    const did = encodeURIComponent('+908504660150');
    assert.equal((await call('PUT', `/api/numbers/${did}`, { user_id: created.body.user.id }, { token: tokens.kaan })).status, 403);
    const moved = await call('PUT', `/api/numbers/${did}`, { user_id: created.body.user.id, label: 'İlan 999' }, { token: adminToken });
    assert.deepEqual([moved.body.user_id, moved.body.label], [created.body.user.id, 'İlan 999']);
    const hunt = await call('PUT', `/api/numbers/4442453`, { user_id: created.body.user.id }, { token: adminToken });
    assert.equal(hunt.body.user_id, null);
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
