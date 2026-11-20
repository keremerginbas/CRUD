import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAsteriskProvider } from '../src/providers/asterisk.js';

// Sahte ARI sunucusu: gelen istekleri kaydeder
const seen = [];
let ari, provider;

before(async () => {
  ari = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.url.startsWith('/ari/recordings/stored/')) {
        res.writeHead(200, { 'content-type': 'audio/wav' }).end('RIFF');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"x"}');
      }
    });
  }).listen(0);
  provider = createAsteriskProvider({ ariUrl: `http://127.0.0.1:${ari.address().port}`, ariUser: 'xre', ariPassword: 'gizli', trunk: 'trunk' });
});
after(() => ari.close());

test('arama başlatma önce danışmanı arar, müşteri ve hat değişken olarak gider', async () => {
  const { providerCallId } = await provider.originate({ agentPhone: '+905321112233', customerPhone: '+905464962638', callerId: '+905337435601' });
  const req = seen.at(-1);
  const url = new URL(req.url, 'http://x');
  assert.equal(req.method, 'POST');
  assert.equal(url.pathname, '/ari/channels');
  assert.equal(url.searchParams.get('endpoint'), 'PJSIP/05321112233@trunk');
  assert.equal(url.searchParams.get('context'), 'xre-click2call');
  assert.equal(url.searchParams.get('callerId'), '05337435601');
  assert.equal(url.searchParams.get('channelId'), providerCallId);
  assert.match(providerCallId, /^xre-[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(req.body).variables, { XRE_CUSTOMER: '05464962638', XRE_LINE: '05337435601' });
  assert.equal(req.auth, `Basic ${Buffer.from('xre:gizli').toString('base64')}`);
});

test('ayrı danışman bağlantısı varsa danışman ondan aranır', async () => {
  const p2 = createAsteriskProvider({ ariUrl: `http://127.0.0.1:${ari.address().port}`, ariUser: 'xre', ariPassword: 'gizli', trunk: 'trunk', agentTrunk: 'agent' });
  await p2.originate({ agentPhone: '+905321112233', customerPhone: '+905464962638', callerId: '+905337437589' });
  assert.equal(new URL(seen.at(-1).url, 'http://x').searchParams.get('endpoint'), 'PJSIP/05321112233@agent');
});

test('hattın operatör bağlantısı aramaya değişken olarak eklenir', async () => {
  await provider.originate({ agentPhone: '+905321112233', customerPhone: '+905464962638', callerId: '+903122191672', trunk: 'tt' });
  assert.deepEqual(JSON.parse(seen.at(-1).body).variables, { XRE_CUSTOMER: '05464962638', XRE_LINE: '03122191672', XRE_LINE_TRUNK: 'tt' });
});

test('gelen arama isteğinde aramanın geldiği bağlantı okunur', () => {
  assert.equal(provider.parseRouteRequest({ from: '05464962638', to: '03122191672', callId: 'c', trunk: 'tt' }).trunk, 'tt');
});

test('yönlendirme cevabı dialplan için düz metin', () => {
  // Danışmana giden aramada 5. alan tarayıcı telefonu; asistana giden aramada boş
  assert.equal(provider.formatRouteResponse({ action: 'forward', destination: '+905551112233', userId: 7, callerAnnouncement: 'x', whisper: 'Alıcı arıyor' }), 'forward,05551112233,1,1,u7');
  assert.equal(provider.formatRouteResponse({ action: 'forward', destination: '+905312814423', userId: 7, reason: 'kayitsiz-musteri', callerAnnouncement: null, whisper: 'x' }), 'forward,05312814423,0,1,');
  assert.equal(provider.formatRouteResponse({ action: 'queue', destination: 'queue:karsilama' }), 'queue,,0,0,');
  assert.equal(provider.formatRouteResponse({ action: 'reject' }), 'reject,,0,0,');
  // Asistana giden aramada 5. alan: asistanların tarayıcı telefonları (& ile), boştakiler aynı anda çalar
  assert.equal(provider.formatRouteResponse({ action: 'forward', destination: '+905312814423', userId: 7, reason: 'kayitsiz-musteri', whisper: 'x', browserGroup: ['u5', 'u6'] }), 'forward,05312814423,0,1,u5&u6');
  assert.equal(provider.formatRouteResponse({ action: 'queue', destination: 'queue:karsilama', browserGroup: ['u5'] }), 'queue,,0,0,u5');
  // 6. alan: karşılama hattı, santral "dahili tuşlayın" anonsunu çalar
  assert.equal(provider.formatRouteResponse({ action: 'forward', destination: '+905312814423', userId: null, reason: 'kayitsiz-musteri', whisper: 'x', ivr: true }), 'forward,05312814423,0,1,,1');
  assert.equal(provider.parseRouteRequest({ from: '1', to: '2', callId: 'c', ext: '2020' }).extension, '2020');
  assert.equal(provider.formatRouteResponse({ action: 'forward', destination: '+905070000000', userId: 3, whisper: 'x', callerName: 'İlan 701 Gölbaşı, arsa' }), 'forward,05070000000,0,1,u3,,İlan 701 Gölbaşı  arsa');
});

test('olaylar gelen ve giden aramada doğru ayrıştırılır', () => {
  assert.deepEqual(provider.parseEvent({ callId: 'a1', direction: 'inbound', from: '05464962638', to: '5337435601', status: 'completed', duration: '42', recording: 'rec1' }), {
    providerCallId: 'a1', direction: 'inbound', customerPhone: '05464962638', dialedNumber: '5337435601', status: 'completed', durationSec: 42, recordingRef: 'rec1',
  });
  const out = provider.parseEvent({ callId: 'b1', direction: 'outbound', from: '05337435601', to: '05464962638', callerId: '05337435601', status: 'missed', duration: '', recording: '' });
  assert.deepEqual([out.customerPhone, out.dialedNumber, out.status, out.durationSec, out.recordingRef], ['05464962638', '05337435601', 'missed', 0, null]);
});

test('ses kaydı ARI stored recordings üzerinden indirilir', async () => {
  const res = await provider.fetchRecording('xre-abc');
  assert.equal(await res.text(), 'RIFF');
  assert.equal(seen.at(-1).url, '/ari/recordings/stored/xre-abc/file');
});

test('santral durumu ARI\'den okunur: bağlantılar, açık paneller ve süren görüşmeler ayrılır', async () => {
  const replies = {
    '/ari/asterisk/info': { system: { version: '22.11.0' }, status: { startup_time: '2026-11-20T06:00:00.000+0300' } },
    '/ari/endpoints/PJSIP': [
      { technology: 'PJSIP', resource: 'n850', state: 'online', channel_ids: ['a'] },
      { technology: 'PJSIP', resource: 'u1', state: 'online', channel_ids: [] },
      { technology: 'PJSIP', resource: 'u7', state: 'offline', channel_ids: [] },
    ],
    '/ari/channels': [{ id: 'a', name: 'PJSIP/n850-00000001', state: 'Up', caller: { number: '05061288930' }, connected: { number: '' },
      dialplan: { exten: '8503035640' }, creationtime: '2026-11-20T09:00:00.000+0300' }],
  };
  const fake = createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify(replies[new URL(req.url, 'http://x').pathname] ?? {}))).listen(0);
  try {
    const p = createAsteriskProvider({ ariUrl: `http://127.0.0.1:${fake.address().port}`, ariUser: 'xre', ariPassword: 'x', trunk: 'n850' });
    const s = await p.status();
    assert.equal(s.version, '22.11.0');
    assert.deepEqual(s.trunks, [{ name: 'n850', state: 'online', channels: 1, isDefault: true, isAgent: true }]);
    assert.deepEqual(s.browsersOnline, [1]);
    assert.deepEqual([s.channels[0].caller, s.channels[0].exten, s.channels[0].state], ['05061288930', '8503035640', 'Up']);
  } finally { fake.close(); }
});

test('hattın giden çağrı ön eki santrale değişken olarak gider', async () => {
  await provider.originate({ agentPhone: '+905321112233', customerPhone: '+905464962638', callerId: '+905337436010', trunk: 'd125', dialPrefix: '701' });
  assert.deepEqual(JSON.parse(seen.at(-1).body).variables,
    { XRE_CUSTOMER: '05464962638', XRE_LINE: '05337436010', XRE_LINE_TRUNK: 'd125', XRE_LINE_PREFIX: '701' });
});
