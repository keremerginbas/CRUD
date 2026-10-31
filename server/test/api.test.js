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
let base, provider, tokens = {};

before(async () => {
  const db = openDb(':memory:');
  const pw = hashPassword('Sifre1234');
  const add = db.prepare(`INSERT INTO users (name, role, email, password_hash, phone, forward_phone, extension, push_token,
    work_start, work_end, saturday_enabled, saturday_start, saturday_end, sunday_enabled, sunday_start, sunday_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '00:00', '23:59', 1, '00:00', '23:59', 1, '00:00', '23:59')`);
  add.run('KAAN', 'danisman', 'kaan@x.com', pw, '+905050000000', '+905050000000', '1001', 'ExpoPushToken[kaan]');
  add.run('BROKER', 'broker', 'broker@x.com', pw, '+905060000000', null, '1000', null);
  add.run('BAŞKA', 'danisman', 'baska@x.com', pw, '+905070000000', null, '1002', null);
  db.exec(`INSERT INTO numbers VALUES ('+908504660149', 'personal', 1, 'Dijital hat'),
    ('+908504660150', 'listing', 1, 'İlan 638'), ('4442453', 'hunt', NULL, '444')`);
  db.exec(`INSERT INTO contacts (name, phone, type, owner_id) VALUES ('MUSTAFA UTKU', '+905464962638', 'ALICI', 1)`);

  provider = createMockProvider();
  const server = createApp({ db, provider, config, notify: async (...a) => pushes.push(a) }).listen(0);
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

test('danışman yalnızca kendi çağrılarını, broker hepsini görür', async () => {
  assert.equal((await call('GET', '/api/calls', null, { token: tokens.baska })).body.length, 0);
  assert.ok((await call('GET', '/api/calls?scope=all', null, { token: tokens.broker })).body.length >= 3);
});
