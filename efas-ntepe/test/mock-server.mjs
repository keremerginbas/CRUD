// Test için sahte Bitrix24 REST + Vapi API sunucusu (bellekte çalışır)
//   Bitrix: http://127.0.0.1:8787/rest/1/test/<metod>.json
//   Vapi:   http://127.0.0.1:8787/vapi/...
//   Kontrol: GET /__state, POST /__reset { leads, activeCalls, failNumbers, pageSize }
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8787);
const VAPI_KEY = 'test-key';

let S;
function sifirla(seed = {}) {
  S = {
    leads: new Map(),
    nextLeadId: 1000,
    comments: [],
    todos: [],
    vapiCalls: [],
    requests: [],
    sms: [],
    whatsapp: [],
    telegram: [],
    userfields: [],
    activeCalls: seed.activeCalls || [],
    failNumbers: seed.failNumbers || [],
    pageSize: seed.pageSize || 50,
    phoneNumbers: seed.phoneNumbers || [
      { id: 'pn-1', number: '+905337436876', assistantId: 'asst-in' },
      { id: 'pn-2', number: '+905337437088', assistantId: 'asst-in' },
      { id: 'pn-3', number: '+908503465993', assistantId: 'asst-other' },
      { id: 'pn-x', number: '+905337436902', assistantId: 'asst-other' },
    ],
  };
  for (const l of seed.leads || []) S.leads.set(String(l.ID), { ...l, ID: String(l.ID) });
}
sifirla();

// ---- PHP parse_str (iç içe köşeli parantezler) ----
function parseStr(q) {
  const out = {};
  for (const parca of q.split('&')) {
    if (!parca) continue;
    const [kHam, vHam = ''] = parca.split('=');
    const k = decodeURIComponent(kHam.replace(/\+/g, ' '));
    const v = decodeURIComponent(vHam.replace(/\+/g, ' '));
    const yol = [k.split('[')[0], ...[...k.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1])];
    let o = out;
    yol.forEach((p, i) => {
      if (i === yol.length - 1) o[p] = v;
      else o = o[p] ??= {};
    });
  }
  return out;
}

function hataYanit(kod, aciklama) {
  return { __hata: true, error: kod, error_description: aciklama };
}

const STATUSES = [
  { STATUS_ID: 'NEW', NAME: 'Yeni' },
  { STATUS_ID: 'UC_3W9EXO', NAME: 'EFAS N-TEPE YAPAY ZEKA' },
  { STATUS_ID: 'UC_PTDA4Y', NAME: 'EFAS N-TEPE OLUMSUZ' },
  { STATUS_ID: 'UC_ML92HM', NAME: 'YAPAY ZEKA RANDEVU OLUŞTURANLAR' },
];

function bitrix(metod, p) {
  switch (metod) {
    case 'crm.lead.list': {
      let list = [...S.leads.values()];
      const f = p.filter || {};
      if (f.STATUS_ID) list = list.filter((l) => l.STATUS_ID === f.STATUS_ID);
      if (f.ID !== undefined) {
        const ids = (Array.isArray(f.ID) ? f.ID : typeof f.ID === 'object' ? Object.values(f.ID) : [f.ID]).map(String);
        list = list.filter((l) => ids.includes(l.ID));
      }
      const yon = (p.order && p.order.ID) === 'DESC' ? -1 : 1;
      list.sort((a, b) => yon * (Number(a.ID) - Number(b.ID)));
      const start = Number(p.start) || 0;
      const sayfa = list.slice(start, start + S.pageSize).map((l) => {
        if (!p.select) return l;
        const sel = Array.isArray(p.select) ? p.select : Object.values(p.select);
        return Object.fromEntries(sel.map((k) => [k, l[k] ?? null]));
      });
      const r = { result: sayfa, total: list.length };
      if (start + S.pageSize < list.length) r.next = start + S.pageSize;
      return r;
    }
    case 'crm.lead.get': {
      const l = S.leads.get(String(p.id));
      return l ? { result: l } : hataYanit('', 'Not found');
    }
    case 'crm.lead.update': {
      const l = S.leads.get(String(p.id));
      if (!l) return hataYanit('', 'Not found');
      Object.assign(l, p.fields || {});
      return { result: true };
    }
    case 'crm.lead.add': {
      const id = String(S.nextLeadId++);
      const fields = { ...(p.fields || {}) };
      if (fields.PHONE && !Array.isArray(fields.PHONE)) fields.PHONE = Object.values(fields.PHONE);
      S.leads.set(id, { ID: id, ...fields });
      return { result: Number(id) };
    }
    case 'crm.timeline.comment.add': {
      const f = p.fields || {};
      if (!S.leads.has(String(f.ENTITY_ID))) return hataYanit('', 'Owner not found');
      S.comments.push({ leadId: String(f.ENTITY_ID), text: f.COMMENT });
      return { result: S.comments.length };
    }
    case 'crm.activity.todo.add': {
      if (!S.leads.has(String(p.ownerId))) return hataYanit('', 'Owner not found');
      if (!p.deadline) return hataYanit('', 'deadline required');
      S.todos.push({ ...p, ownerId: String(p.ownerId) });
      return { result: { activity: { id: S.todos.length } } };
    }
    case 'crm.duplicate.findbycomm': {
      const vals = (Array.isArray(p.values) ? p.values : Object.values(p.values || {})).map((v) => String(v).replace(/\D/g, '').slice(-10));
      const ids = [...S.leads.values()]
        .filter((l) => (l.PHONE || []).some((ph) => vals.includes(String(ph.VALUE).replace(/\D/g, '').slice(-10))))
        .map((l) => Number(l.ID));
      return { result: ids.length ? { LEAD: ids } : [] };
    }
    case 'crm.lead.userfield.list':
      return { result: S.userfields.map((u) => ({ ...u })) };
    case 'crm.lead.userfield.add': {
      const name = `UF_CRM_${p.fields.FIELD_NAME}`;
      if (S.userfields.some((u) => u.FIELD_NAME === name)) return hataYanit('ERROR_CORE', 'FIELD_NAME already exists');
      S.userfields.push({ ID: String(S.userfields.length + 1), FIELD_NAME: name, USER_TYPE_ID: p.fields.USER_TYPE_ID });
      return { result: S.userfields.length };
    }
    case 'crm.status.list':
      return { result: STATUSES };
    default:
      return hataYanit('ERROR_METHOD_NOT_FOUND', `Method not found: ${metod}`);
  }
}

function referansCoz(deger, sonuclar) {
  if (typeof deger === 'object' && deger) {
    for (const k of Object.keys(deger)) deger[k] = referansCoz(deger[k], sonuclar);
    return deger;
  }
  const m = /^\$result\[([^\]]+)\]((?:\[[^\]]+\])*)$/.exec(String(deger));
  if (!m) return deger;
  let v = sonuclar[m[1]];
  for (const k of [...m[2].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1])) v = v == null ? v : v[k];
  return v == null ? '' : String(v);
}

function batch(p) {
  const result = {};
  const result_error = {};
  for (const [anahtar, komut] of Object.entries(p.cmd || {})) {
    const [metod, q = ''] = komut.split('?');
    const params = referansCoz(parseStr(q), result);
    const r = bitrix(metod, params);
    if (r.__hata) result_error[anahtar] = { error: r.error, error_description: r.error_description };
    else result[anahtar] = r.result;
    S.requests.push({ api: 'bitrix-batch', metod, params, hata: r.__hata ? r.error_description : undefined });
  }
  return { result: { result, result_error: Object.keys(result_error).length ? result_error : [], result_total: [], result_next: [] } };
}

function vapi(req, yol, govde, url) {
  if (req.headers.authorization !== `Bearer ${VAPI_KEY}`) return [401, { message: 'Unauthorized' }];
  if (req.method === 'GET' && yol === '/phone-number') return [200, S.phoneNumbers];
  if (req.method === 'GET' && yol === '/assistant')
    return [
      200,
      [
        { id: 'asst-out', name: 'EFAS N-TEPE - OUTBOUND', server: { url: 'http://x/webhook/efas-ntepe-outbound' } },
        { id: 'asst-in', name: 'EFAS N-TEPE - INBOUND', server: { url: 'http://x/webhook/efas-ntepe-inbound' } },
      ],
    ];
  if (req.method === 'GET' && yol === '/call') {
    S.requests.push({ api: 'vapi', metod: 'GET /call', query: Object.fromEntries(url.searchParams) });
    return [200, S.activeCalls];
  }
  if (req.method === 'POST' && yol === '/call') {
    S.requests.push({ api: 'vapi', metod: 'POST /call', body: govde });
    if (S.failNumbers.includes(govde.customer && govde.customer.number))
      return [400, { message: ['customer.number must be a valid phone number'], error: 'Bad Request', statusCode: 400 }];
    const call = { id: `call-${S.vapiCalls.length + 1}`, status: 'queued', ...govde };
    S.vapiCalls.push(call);
    return [201, call];
  }
  return [404, { message: 'not found' }];
}

const sunucu = http.createServer((req, res) => {
  let ham = '';
  req.on('data', (c) => (ham += c));
  req.on('end', () => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const gonder = (kod, veri) => {
      res.writeHead(kod, { 'content-type': 'application/json' });
      res.end(JSON.stringify(veri));
    };
    let govde = {};
    try {
      govde = ham ? JSON.parse(ham) : {};
    } catch (e) {
      return gonder(400, { error: 'invalid json' });
    }

    if (url.pathname === '/__state')
      return gonder(200, { ...S, leads: Object.fromEntries(S.leads) });
    if (url.pathname === '/__reset') {
      sifirla(govde);
      return gonder(200, { ok: true });
    }
    if (url.pathname === '/__lead') {
      S.leads.set(String(govde.ID), { ...govde, ID: String(govde.ID) });
      return gonder(200, { ok: true });
    }
    if (url.pathname === '/__config') {
      Object.assign(S, govde);
      return gonder(200, { ok: true });
    }

    const bm = /^\/rest\/1\/test\/(.+)\.json$/.exec(url.pathname);
    if (bm) {
      const params = { ...Object.fromEntries(url.searchParams), ...govde };
      const r = bm[1] === 'batch' ? batch(params) : bitrix(bm[1], params);
      if (bm[1] !== 'batch') S.requests.push({ api: 'bitrix', metod: bm[1], params, hata: r.__hata ? r.error_description : undefined });
      if (r.__hata) return gonder(400, { error: r.error, error_description: r.error_description });
      return gonder(200, r);
    }
    // Netgsm SMS (REST v2) — Basic auth
    if (url.pathname === '/netgsm/sms') {
      if (req.headers.authorization !== `Basic ${Buffer.from('netgsm-user:netgsm-pass').toString('base64')}`)
        return gonder(401, { code: '30', description: 'auth' });
      S.sms.push(govde);
      return gonder(200, { code: '00', jobid: `J${S.sms.length}`, description: 'queued' });
    }
    // WhatsApp Cloud API
    const wm = /^\/wa\/([^/]+)\/messages$/.exec(url.pathname);
    if (wm) {
      if (req.headers.authorization !== 'Bearer wa-token') return gonder(401, { error: { message: 'Invalid OAuth access token' } });
      S.whatsapp.push({ telefonNumarasiId: wm[1], ...govde });
      return gonder(200, { messaging_product: 'whatsapp', contacts: [{ wa_id: govde.to }], messages: [{ id: `wamid.${S.whatsapp.length}` }] });
    }
    // Telegram Bot API
    const tm = /^\/telegram\/bot([^/]+)\/sendMessage$/.exec(url.pathname);
    if (tm) {
      if (tm[1] !== 'tg-token') return gonder(401, { ok: false, description: 'Unauthorized' });
      S.telegram.push(govde);
      return gonder(200, { ok: true, result: { message_id: S.telegram.length, chat: { id: govde.chat_id }, text: govde.text } });
    }
    if (url.pathname.startsWith('/vapi/')) {
      const [kod, veri] = vapi(req, url.pathname.slice(5), govde, url);
      return gonder(kod, veri);
    }
    gonder(404, { error: 'not found' });
  });
});

sunucu.listen(PORT, '127.0.0.1', () => console.log(`mock hazır :${PORT}`));
