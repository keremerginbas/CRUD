const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createScheduler } = require('../src/scheduler');
const { computeDueAt, normalizePhone, renderTemplate } = require('../src/schedule');

function setup(startIso = '2026-10-01T07:00:00Z') {
  const db = openDb(':memory:');
  const clock = { now: new Date(startIso) };
  const sent = [];
  let failNext = 0;
  const provider = {
    name: 'fake',
    async send(phone, body) {
      if (failNext > 0) { failNext -= 1; throw new Error('sağlayıcı hatası'); }
      sent.push({ phone, body, at: clock.now.toISOString() });
      return { ref: `ref-${sent.length}` };
    },
  };
  const scheduler = createScheduler({ db, provider, now: () => clock.now, log: () => {} });
  const app = createApp({ db, scheduler, apiKey: 'secret', now: () => clock.now });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body),
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  return { db, clock, sent, scheduler, call, close: () => server.close(), failTimes: (n) => { failNext = n; } };
}

const STEPS = [3, 5, 10, 14, 30].map((d) => ({ day_offset: d, send_time: '10:00', message: `Merhaba {ad}, {kampanya} - ${d}. gün` }));

test('yardımcılar', () => {
  assert.strictEqual(normalizePhone('0532 123 45 67'), '5321234567');
  assert.strictEqual(normalizePhone('+90 (532) 123-4567'), '5321234567');
  assert.strictEqual(normalizePhone('212 123 45 67'), null);
  assert.strictEqual(computeDueAt('2026-10-01', 3, '10:00').toISOString(), '2026-10-04T07:00:00.000Z');
  assert.strictEqual(computeDueAt('2026-10-30', 3, '09:30').toISOString(), '2026-11-02T06:30:00.000Z');
  assert.strictEqual(renderTemplate('Selam {ad} {yok}', { ad: 'Ali' }), 'Selam Ali {yok}');
});

test('3-5-10-14-30. günlerde sırayla SMS gönderir ve akışı tamamlar', async (t) => {
  const env = setup();
  t.after(env.close);
  const camp = await env.call('POST', '/campaigns', { name: 'Kasım Reklamı', steps: STEPS });
  assert.strictEqual(camp.status, 201);
  const lead = await env.call('POST', '/leads', { name: 'Ayşe Yılmaz', phone: '0532 111 22 33', campaign_id: camp.body.id, consent: true }, { 'x-api-key': 'secret' });
  assert.strictEqual(lead.status, 201);
  assert.strictEqual(lead.body.enrollment.start_date, '2026-10-01');

  // Gün 0..31 boyunca her saat başı zamanlayıcıyı çalıştır.
  for (let h = 0; h < 32 * 24; h += 1) {
    env.clock.now = new Date(Date.parse('2026-10-01T07:00:00Z') + h * 3600 * 1000);
    await env.scheduler.tick();
  }
  assert.deepStrictEqual(env.sent.map((s) => s.at), [
    '2026-10-04T07:00:00.000Z', '2026-10-06T07:00:00.000Z', '2026-10-11T07:00:00.000Z',
    '2026-10-15T07:00:00.000Z', '2026-10-31T07:00:00.000Z',
  ]);
  assert.strictEqual(env.sent[0].body, 'Merhaba Ayşe, Kasım Reklamı - 3. gün');
  assert.strictEqual(env.sent[0].phone, '5321112233');
  const enr = await env.call('GET', '/enrollments');
  assert.strictEqual(enr.body[0].status, 'completed');
});

test('izinsiz, RET diyen ve durdurulmuş kampanyalara gönderim yapmaz', async (t) => {
  const env = setup();
  t.after(env.close);
  const a = await env.call('POST', '/campaigns', { name: 'A', steps: [{ day_offset: 0, send_time: '10:00', message: 'x' }] });
  const b = await env.call('POST', '/campaigns', { name: 'B', active: false, steps: [{ day_offset: 0, send_time: '10:00', message: 'y' }] });
  await env.call('POST', '/customers', { name: 'İzinsiz', phone: '5320000001', campaign_id: a.body.id });
  await env.call('POST', '/customers', { name: 'Ret', phone: '5320000002', consent: true, campaign_id: a.body.id });
  await env.call('POST', '/customers', { name: 'Pasif', phone: '5320000003', consent: true, campaign_id: b.body.id });
  const optOut = await env.call('POST', '/opt-out', { phone: '0532 000 00 02' });
  assert.strictEqual(optOut.body.opted_out, 1);
  await env.scheduler.tick();
  assert.strictEqual(env.sent.length, 0);
});

test('hata olursa 3 kez dener, 24 saatten eski adımları atlar', async (t) => {
  const env = setup('2026-10-10T07:00:00Z');
  t.after(env.close);
  const camp = await env.call('POST', '/campaigns', { name: 'P', type: 'proje', steps: [
    { day_offset: 3, send_time: '10:00', message: 'eski' },
    { day_offset: 9, send_time: '10:00', message: 'bugün' },
  ] });
  await env.call('POST', '/customers', { name: 'Can', phone: '5321234567', consent: true, campaign_id: camp.body.id, start_date: '2026-10-01' });
  env.failTimes(2);
  await env.scheduler.tick();
  await env.scheduler.tick();
  assert.strictEqual(env.sent.length, 0);
  await env.scheduler.tick();
  assert.deepStrictEqual(env.sent.map((s) => s.body), ['bugün']);
  const msgs = await env.call('GET', '/messages');
  const byBody = Object.fromEntries(msgs.body.map((m) => [m.body, m]));
  assert.strictEqual(byBody['eski'].status, 'skipped');
  assert.strictEqual(byBody['bugün'].attempts, 3);
});

test('adım güncellemesi gönderilmiş mesaj geçmişini korur, doğrulama hataları 400 döner', async (t) => {
  const env = setup('2026-10-04T07:00:00Z');
  t.after(env.close);
  const camp = await env.call('POST', '/campaigns', { name: 'K', steps: STEPS });
  await env.call('POST', '/customers', { name: 'Ece', phone: '5329998877', consent: true, campaign_id: camp.body.id, start_date: '2026-10-01' });
  await env.scheduler.tick();
  assert.strictEqual(env.sent.length, 1);
  const upd = await env.call('PUT', `/campaigns/${camp.body.id}`, { steps: [{ ...STEPS[0], message: 'yeni' }, STEPS[1]] });
  assert.strictEqual(upd.body.steps.length, 2);
  await env.scheduler.tick();
  assert.strictEqual(env.sent.length, 1);
  assert.strictEqual((await env.call('POST', '/campaigns', { name: 'X', steps: [{ day_offset: 3, message: '' }] })).status, 400);
  assert.strictEqual((await env.call('POST', '/customers', { name: 'Y', phone: '123' })).status, 400);
  assert.strictEqual((await env.call('POST', '/leads', { name: 'Z', phone: '5321111111', campaign_id: camp.body.id })).status, 401);
});
