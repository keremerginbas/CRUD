const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { createScheduler } = require('../src/scheduler');

function serve(app) {
  const server = app.listen(0);
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

test('panel şifresi: girişsiz 401, doğru şifreyle erişim, webhook açık', async (t) => {
  const db = openDb(':memory:');
  const scheduler = createScheduler({ db, provider: { send: async () => ({}) }, log: () => {} });
  const s = serve(createApp({ db, scheduler, panelUser: 'xre', panelPassword: 'gizli' }));
  t.after(s.close);
  assert.strictEqual((await fetch(`${s.base}/api/stats`)).status, 401);
  const auth = { authorization: `Basic ${Buffer.from('xre:yanlis').toString('base64')}` };
  assert.strictEqual((await fetch(`${s.base}/api/stats`, { headers: auth })).status, 401);
  const ok = { authorization: `Basic ${Buffer.from('xre:gizli').toString('base64')}` };
  assert.strictEqual((await fetch(`${s.base}/api/stats`, { headers: ok })).status, 200);
  // Bitrix yapılandırılmamış: 401 değil 503 döner, yani şifre engellemiyor.
  assert.strictEqual((await fetch(`${s.base}/api/bitrix/webhook`, { method: 'POST' })).status, 503);
});

test('iki süreç aynı anda çalışırsa kilit ikincisini bekletir', async () => {
  const db = openDb(':memory:');
  let release;
  const slow = { send: () => new Promise((r) => { release = () => r({ ref: 'x' }); }) };
  const a = createScheduler({ db, provider: slow, now: () => new Date('2026-10-14T10:00:00Z'), log: () => {} });
  const b = createScheduler({ db, provider: slow, now: () => new Date('2026-10-14T10:00:00Z'), log: () => {} });
  db.exec(`INSERT INTO campaigns (name) VALUES ('K');
    INSERT INTO campaign_steps (campaign_id, day_offset, send_time, message) VALUES (1, 0, '00:00', 'm');
    INSERT INTO customers (name, phone, consent) VALUES ('A', '5321112233', 1);
    INSERT INTO enrollments (customer_id, campaign_id, start_date) VALUES (1, 1, '2026-10-14');`);
  const first = a.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(await b.tick(), { busy: true });
  release();
  assert.strictEqual((await first).sent, 1);
  assert.strictEqual((await b.tick()).sent, 0); // kilit bırakıldı, mesaj zaten gönderilmiş
});

test('test SMS: sağlayıcı yanıtını döner, hatayı 502 ile bildirir', async (t) => {
  const db = openDb(':memory:');
  const sent = [];
  let fail = false;
  const provider = { name: 'fake', async send(phone, body) { if (fail) throw new Error('Erccell hata: X'); sent.push([phone, body]); return { ref: '<OK>1</OK>' }; } };
  const s = serve(createApp({ db, scheduler: createScheduler({ db, provider, log: () => {} }), provider }));
  t.after(s.close);
  const post = (body) => fetch(`${s.base}/api/test-sms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const r = await post({ phone: '0532 111 22 33', message: 'deneme' });
  assert.deepStrictEqual(await r.json(), { ok: true, provider: 'fake', phone: '5321112233', response: '<OK>1</OK>' });
  assert.deepStrictEqual(sent, [['5321112233', 'deneme']]);
  fail = true;
  assert.strictEqual((await post({ phone: '5321112233', message: 'x' })).status, 502);
  assert.strictEqual((await post({ phone: '123', message: 'x' })).status, 400);
});

test('BASE_PATH=/sms: önekli ve öneksiz istekler aynı rotaya gider, kimlik doğrulama korunur', async (t) => {
  const db = openDb(':memory:');
  const scheduler = createScheduler({ db, provider: { send: async () => ({}) }, log: () => {} });
  const s = serve(createApp({ db, scheduler, basePath: '/sms', panelPassword: 'p' }));
  t.after(s.close);
  const ok = { authorization: `Basic ${Buffer.from('admin:p').toString('base64')}` };
  assert.strictEqual((await fetch(`${s.base}/sms/api/stats`, { headers: ok })).status, 200);
  assert.strictEqual((await fetch(`${s.base}/api/stats`, { headers: ok })).status, 200);
  assert.strictEqual((await fetch(`${s.base}/sms/api/stats`)).status, 401);
  assert.strictEqual((await fetch(`${s.base}/sms/api/bitrix/webhook`, { method: 'POST' })).status, 503);
  const r = await fetch(`${s.base}/sms`, { headers: ok, redirect: 'manual' });
  assert.deepStrictEqual([r.status, r.headers.get('location')], [301, '/sms/']);
});

test('BASE_PATH yoksa alt yol derleme dosyasından algılanır; canlıda şifresiz panel kilitlenir', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-'));
  fs.mkdirSync(path.join(dir, 'static', 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'asset-manifest.json'), JSON.stringify({ files: { 'main.js': '/sms/static/js/main.abc.js' } }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(dir, 'static', 'js', 'main.abc.js'), 'console.log(1)');
  const db = openDb(':memory:');
  const scheduler = createScheduler({ db, provider: { send: async () => ({}) }, log: () => {} });

  const s = serve(createApp({ db, scheduler, buildDir: dir, basePath: '', panelPassword: '' }));
  t.after(s.close);
  const js = await fetch(`${s.base}/sms/static/js/main.abc.js`);
  assert.strictEqual(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);

  const locked = serve(createApp({ db, scheduler, buildDir: dir, panelPassword: '', requirePassword: true }));
  t.after(locked.close);
  assert.strictEqual((await fetch(`${locked.base}/sms/`)).status, 503);
  assert.strictEqual((await fetch(`${locked.base}/sms/api/bitrix/webhook`, { method: 'POST' })).status, 503);
  assert.match(await (await fetch(`${locked.base}/sms/api/stats`)).text(), /PANEL_PASSWORD/);
});
