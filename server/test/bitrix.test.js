const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createScheduler } = require('../src/scheduler');

// Bellekte sahte Bitrix24: deal'ler, contact'lar ve aşamalar.
function fakeBitrix() {
  const deals = {};
  const leads = {};
  const contacts = {
    7: { ID: '7', NAME: 'Mehmet', LAST_NAME: 'Kaya', PHONE: [{ VALUE: '0312 444 55 66' }, { VALUE: '+90 533 444 55 66' }], UF_IYS: 'Y' },
  };
  const client = {
    async call(method, params) {
      if (method === 'crm.deal.get') return { result: deals[params.id] };
      if (method === 'crm.lead.get') return { result: leads[params.id] };
      if (method === 'crm.contact.get') return { result: contacts[params.id] };
      if (method === 'crm.category.list') return { result: { categories: [{ id: 0, name: 'Genel' }, { id: 1, name: 'Ankaport' }] } };
      if (method === 'crm.deal.fields') return { result: { UF_PROJE: { type: 'enumeration', items: [{ ID: '45', VALUE: 'Ankaport Saray' }, { ID: '46', VALUE: 'West Point' }] } } };
      throw new Error(`beklenmeyen ${method}`);
    },
    async callAll(method) {
      assert.strictEqual(method, 'crm.status.list');
      return [
        { ENTITY_ID: 'STATUS', STATUS_ID: 'NEW', NAME: 'Yeni lead' },
        { ENTITY_ID: 'DEAL_STAGE', STATUS_ID: 'NEW', NAME: 'Yeni' },
        { ENTITY_ID: 'DEAL_STAGE_1', STATUS_ID: 'C1:NEW', NAME: 'İlk görüşme' },
        { ENTITY_ID: 'SOURCE', STATUS_ID: 'WEB', NAME: 'Web' },
      ];
    },
  };
  return { client, deals, leads, contacts };
}

function setup() {
  const db = openDb(':memory:');
  const clock = { now: new Date('2026-10-14T09:00:00Z') }; // 12:00 TR
  const sent = [];
  const provider = { name: 'fake', async send(phone, body) { sent.push({ phone, body }); return { ref: 'x' }; } };
  const scheduler = createScheduler({ db, provider, now: () => clock.now, log: () => {} });
  const fb = fakeBitrix();
  const config = { appToken: 'tok', projectField: 'UF_PROJE', consentField: 'UF_IYS', optOutField: 'UF_STOP', defaultConsent: false };
  const app = createApp({ db, scheduler, now: () => clock.now, bitrix: { client: fb.client, config, log: () => {} } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const json = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  // Bitrix giden webhook'u gibi form-urlencoded gönder.
  const hook = async (event, id, token = 'tok') => {
    const form = new URLSearchParams({ event, 'data[FIELDS][ID]': String(id), 'auth[application_token]': token });
    const res = await fetch(`${base}/bitrix/webhook`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };
  return { db, clock, sent, scheduler, fb, json, hook, close: () => server.close() };
}

const steps = (label) => [
  { day_offset: 0, send_time: '00:00', message: `Merhaba {ad}, {proje} ${label}` },
  { day_offset: 3, send_time: '11:00', message: `{proje} hâlâ değerlendiriyor musunuz? (${label})` },
];

test('Bitrix aşamasına giren müşteriye o projenin serisi başlar, aşama değişince eski seri durur', async (t) => {
  const env = setup();
  t.after(env.close);
  const a = await env.json('POST', '/campaigns', { name: 'Ankaport - İlk görüşme', type: 'proje', project: 'Ankaport Saray',
    bitrix_entity: 'deal', bitrix_stages: ['C1:NEW'], bitrix_project: '45', steps: steps('ilk') });
  const b = await env.json('POST', '/campaigns', { name: 'Ankaport - Teklif', type: 'proje', project: 'Ankaport Saray',
    bitrix_entity: 'deal', bitrix_stages: ['C1:PREPARATION', 'C1:PREPAYMENT'], bitrix_project: '45', steps: steps('teklif') });
  assert.strictEqual(a.status, 201);

  env.fb.deals[10] = { ID: '10', STAGE_ID: 'C1:NEW', CONTACT_ID: '7', UF_PROJE: '45' };
  let r = await env.hook('ONCRMDEALADD', 10);
  assert.strictEqual(r.body.action, 'enrolled');
  await env.scheduler.tick();
  assert.deepStrictEqual(env.sent, [{ phone: '5334445566', body: 'Merhaba Mehmet, Ankaport Saray ilk' }]);

  // Başka bir alan güncellendi, aşama aynı: tekrar başlatma yok.
  r = await env.hook('ONCRMDEALUPDATE', 10);
  assert.strictEqual(r.body.action, 'unchanged');

  // Teklif aşamasına geçti.
  env.fb.deals[10].STAGE_ID = 'C1:PREPARATION';
  r = await env.hook('ONCRMDEALUPDATE', 10);
  assert.strictEqual(r.body.action, 'enrolled');
  assert.strictEqual(r.body.cancelled, 1);
  await env.scheduler.tick();
  assert.strictEqual(env.sent[1].body, 'Merhaba Mehmet, Ankaport Saray teklif');
  let enr = (await env.json('GET', '/enrollments')).body;
  assert.deepStrictEqual(Object.fromEntries(enr.map((e) => [e.campaign_id, e.status])), { [a.body.id]: 'cancelled', [b.body.id]: 'active' });

  // Aynı kampanyanın diğer statüsüne geçti: seri baştan başlamaz, devam eder.
  env.fb.deals[10].STAGE_ID = 'C1:PREPAYMENT';
  r = await env.hook('ONCRMDEALUPDATE', 10);
  assert.deepStrictEqual([r.body.action, r.body.cancelled], ['enrolled', 0]);
  await env.scheduler.tick();
  assert.strictEqual(env.sent.length, 2);

  // Kampanyasız ara statü (ör. "yapay zeka arıyor"): seri devam eder.
  env.fb.deals[10].STAGE_ID = 'C1:CALLING';
  r = await env.hook('ONCRMDEALUPDATE', 10);
  assert.deepStrictEqual([r.body.action, r.body.cancelled], ['no-campaign', 0]);
  assert.strictEqual((await env.json('GET', '/enrollments?status=active')).body.length, 1);

  // Durdurma statüsü (satış): seri durur.
  await env.json('PUT', '/settings', { bitrix_stop_stages: ['C1:WON', 'C1:LOSE'] });
  env.fb.deals[10].STAGE_ID = 'C1:WON';
  r = await env.hook('ONCRMDEALUPDATE', 10);
  assert.deepStrictEqual([r.body.action, r.body.cancelled], ['stopped', 1]);
  enr = (await env.json('GET', '/enrollments?status=active')).body;
  assert.strictEqual(enr.length, 0);
});

test('farklı proje, telefonsuz kayıt, izinsiz kişi ve yanlış anahtar', async (t) => {
  const env = setup();
  t.after(env.close);
  await env.json('POST', '/campaigns', { name: 'A', bitrix_entity: 'deal', bitrix_stages: ['C1:NEW'], bitrix_project: '45', steps: steps('x') });

  env.fb.deals[20] = { ID: '20', STAGE_ID: 'C1:NEW', CONTACT_ID: '7', UF_PROJE: '46' };
  assert.strictEqual((await env.hook('ONCRMDEALADD', 20)).body.action, 'no-campaign');

  env.fb.deals[21] = { ID: '21', STAGE_ID: 'C1:NEW', CONTACT_ID: '0', UF_PROJE: '45' };
  assert.strictEqual((await env.hook('ONCRMDEALADD', 21)).body.action, 'no-phone');

  env.fb.contacts[8] = { ID: '8', NAME: 'İzinsiz', PHONE: [{ VALUE: '05351112233' }], UF_IYS: 'N' };
  env.fb.deals[22] = { ID: '22', STAGE_ID: 'C1:NEW', CONTACT_ID: '8', UF_PROJE: '45' };
  assert.strictEqual((await env.hook('ONCRMDEALADD', 22)).body.action, 'enrolled');
  await env.scheduler.tick();
  assert.strictEqual(env.sent.length, 0);

  assert.strictEqual((await env.hook('ONCRMDEALADD', 22, 'yanlis')).status, 401);
  assert.strictEqual((await env.hook('ONCRMCONTACTUPDATE', 7)).body.action, 'ignored');
});

test('panel için aşama ve proje listeleri', async (t) => {
  const env = setup();
  t.after(env.close);
  assert.deepStrictEqual((await env.json('GET', '/bitrix/stages?type=deal')).body, [
    { id: 'NEW', name: 'Genel › Yeni' }, { id: 'C1:NEW', name: 'Ankaport › İlk görüşme' },
  ]);
  assert.deepStrictEqual((await env.json('GET', '/bitrix/stages?type=lead')).body, [{ id: 'NEW', name: 'Yeni lead' }]);
  assert.strictEqual((await env.json('GET', '/bitrix/project-options?type=deal')).body[1].name, 'West Point');
  const bad = await env.json('POST', '/campaigns', { name: 'X', bitrix_entity: 'deal', steps: [] });
  assert.strictEqual(bad.status, 400);
});

test('lead: telefon bağlı kişiden alınır, "bir daha aranmasın" seriyi başlatmaz', async (t) => {
  const env = setup();
  t.after(env.close);
  await env.json('POST', '/campaigns', { name: 'Ankaport', project: 'Ankaport', bitrix_entity: 'lead', bitrix_stages: ['UC_0RQEPM'], steps: steps('x') });
  env.fb.leads[5] = { ID: '5', STATUS_ID: 'UC_0RQEPM', TITLE: 'Facebook form', HAS_PHONE: 'N', CONTACT_ID: '7' };
  const r = await env.hook('ONCRMLEADADD', 5);
  assert.strictEqual(r.body.action, 'enrolled');
  await env.scheduler.tick();
  assert.deepStrictEqual(env.sent, [{ phone: '5334445566', body: 'Merhaba Mehmet, Ankaport x' }]);

  env.fb.leads[6] = { ID: '6', STATUS_ID: 'UC_0RQEPM', NAME: 'Ali', PHONE: [{ VALUE: '05557778899' }], UF_STOP: '1' };
  assert.strictEqual((await env.hook('ONCRMLEADADD', 6)).body.action, 'stopped');
});

test('doldurulmamış [ALAN] içeren kampanya aktif edilemez', async (t) => {
  const env = setup();
  t.after(env.close);
  const bad = { name: 'F', steps: [{ day_offset: 5, send_time: '10:30', message: 'Fiyat: [FİYAT]' }] };
  const r = await env.json('POST', '/campaigns', bad);
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /\[FİYAT\]/);
  const draft = await env.json('POST', '/campaigns', { ...bad, active: false });
  assert.strictEqual(draft.status, 201);
  assert.strictEqual((await env.json('PUT', `/campaigns/${draft.body.id}`, { active: true })).status, 400);
});

test('XRE kurulumu pasif kampanyaları ve durdurma statülerini oluşturur, tekrar çalışınca çoğaltmaz', () => {
  const { run, PROJECTS } = require('../scripts/xre-kurulum');
  const db = openDb(':memory:');
  run(db, () => {});
  run(db, () => {});
  const rows = db.prepare('SELECT * FROM campaigns').all();
  assert.strictEqual(rows.length, PROJECTS.length);
  assert.ok(rows.every((r) => r.active === 0 && r.bitrix_entity === 'lead'));
  const days = db.prepare('SELECT day_offset FROM campaign_steps WHERE campaign_id = ? ORDER BY day_offset').all(rows[0].id).map((r) => r.day_offset);
  assert.deepStrictEqual(days, [3, 5, 10, 14, 30]);
  assert.ok(db.prepare(`SELECT value FROM settings WHERE key = 'bitrix_stop_stages'`).get().value.includes('UC_I8G5YP'));
});
