// Test için sahte Bitrix24 REST + Vapi API sunucusu (bellekte çalışır)
//   Bitrix: http://127.0.0.1:8787/rest/1/test/<metod>.json
//   Vapi:   http://127.0.0.1:8787/vapi/...
//   Kontrol: GET /__state, POST /__reset { leads, activeCalls, failNumbers, pageSize, phoneNumbers, assistants, statuses }
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';

const PORT = Number(process.env.MOCK_PORT || 8787);
const VAPI_KEY = 'test-key';

const VARSAYILAN_ASISTANLAR = [
  { id: 'asst-out', name: 'XRE FRANCHISE - OUTBOUND', server: { url: 'http://x/webhook/xre-franchise-outbound' } },
];
const VARSAYILAN_STATUSES = [
  { STATUS_ID: 'NEW', NAME: 'Yeni' },
  { STATUS_ID: 'UC_ARANACAK', NAME: 'Aranacak' },
  { STATUS_ID: 'UC_AIGORUSTU', NAME: 'AI Görüştü' },
  { STATUS_ID: 'UC_ILGILENIYOR', NAME: 'İlgileniyor' },
  { STATUS_ID: 'UC_VIDEOGONDERILDI', NAME: 'Video Gönderildi' },
  { STATUS_ID: 'UC_ASISTANARAYACAK', NAME: 'Asistan Arayacak' },
  { STATUS_ID: 'UC_SUNUMYAPILDI', NAME: 'Sunum Yapıldı' },
  { STATUS_ID: 'UC_ERDALONAYI', NAME: 'Erdal Bey Onayı' },
  { STATUS_ID: 'UC_SOZLESME', NAME: 'Sözleşme' },
  { STATUS_ID: 'UC_FRANCHISEACILIS', NAME: 'Franchise Açılış' },
];

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
    eposta: [],
    userfields: [],
    activeCalls: seed.activeCalls || [],
    contacts: seed.contacts || [],
    failNumbers: seed.failNumbers || [],
    pageSize: seed.pageSize || 50,
    phoneNumbers: seed.phoneNumbers || [
      { id: 'pn-1', number: '+905000000001', assistantId: 'asst-out' },
      { id: 'pn-2', number: '+905000000002', assistantId: 'asst-out' },
    ],
    assistants: seed.assistants || VARSAYILAN_ASISTANLAR,
    statuses: seed.statuses || VARSAYILAN_STATUSES,
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

function bitrix(metod, p) {
  switch (metod) {
    case 'crm.lead.list': {
      let list = [...S.leads.values()];
      const f = p.filter || {};
      for (const [k, v] of Object.entries(f)) if (k.startsWith('!')) list = list.filter((l) => String(l[k.slice(1)] ?? '') !== String(v ?? ''));
      if (f.ASSIGNED_BY_ID !== undefined) list = list.filter((l) => String(l.ASSIGNED_BY_ID) === String(f.ASSIGNED_BY_ID));
      if (f.STATUS_ID) {
        const st = (Array.isArray(f.STATUS_ID) ? f.STATUS_ID : typeof f.STATUS_ID === 'object' ? Object.values(f.STATUS_ID) : [f.STATUS_ID]).map(String);
        list = list.filter((l) => st.includes(l.STATUS_ID));
      }
      if (f.ID !== undefined) {
        const ids = (Array.isArray(f.ID) ? f.ID : typeof f.ID === 'object' ? Object.values(f.ID) : [f.ID]).map(String);
        list = list.filter((l) => ids.includes(l.ID));
      }
      if (f['>=DATE_MODIFY']) list = list.filter((l) => new Date(l.DATE_MODIFY || 0) >= new Date(f['>=DATE_MODIFY']));
      // UF_ ile başlayan tek değerli alanlara tam eşleşme (ör. SONUC alanı)
      for (const [k, v] of Object.entries(f)) if (k.startsWith('UF_') && v !== undefined) list = list.filter((l) => String(l[k] ?? '') === String(v));
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
    case 'crm.contact.list': {
      const f = p.filter || {};
      const ids = (Array.isArray(f.ID) ? f.ID : typeof f.ID === 'object' ? Object.values(f.ID) : [f.ID]).map(String);
      return { result: (S.contacts || []).filter((c) => ids.includes(String(c.ID))) };
    }
    case 'crm.lead.get': {
      const l = S.leads.get(String(p.id));
      return l ? { result: l } : hataYanit('', 'Not found');
    }
    case 'crm.lead.update': {
      const l = S.leads.get(String(p.id));
      if (!l) return hataYanit('', 'Not found');
      Object.assign(l, p.fields || {}, { DATE_MODIFY: new Date().toISOString() });
      return { result: true };
    }
    case 'crm.lead.add': {
      const id = String(S.nextLeadId++);
      const fields = { ...(p.fields || {}) };
      if (fields.PHONE && !Array.isArray(fields.PHONE)) fields.PHONE = Object.values(fields.PHONE);
      S.leads.set(id, { ID: id, DATE_MODIFY: new Date().toISOString(), ...fields });
      return { result: Number(id) };
    }
    case 'crm.timeline.comment.add': {
      const f = p.fields || {};
      if (!S.leads.has(String(f.ENTITY_ID))) return hataYanit('', 'Owner not found');
      S.comments.push({ leadId: String(f.ENTITY_ID), text: f.COMMENT, files: (Array.isArray(f.FILES) ? f.FILES : Object.values(f.FILES || {})).map((x) => ({ ad: x[0], boyut: Buffer.from(String(x[1] || ''), 'base64').length })) });
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
      return { result: S.statuses };
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
  const result_total = {};
  for (const [anahtar, komut] of Object.entries(p.cmd || {})) {
    const [metod, q = ''] = komut.split('?');
    const params = referansCoz(parseStr(q), result);
    const r = bitrix(metod, params);
    if (r.__hata) result_error[anahtar] = { error: r.error, error_description: r.error_description };
    else {
      result[anahtar] = r.result;
      if (r.total !== undefined) result_total[anahtar] = r.total;
    }
    S.requests.push({ api: 'bitrix-batch', metod, params, hata: r.__hata ? r.error_description : undefined });
  }
  return { result: { result, result_error: Object.keys(result_error).length ? result_error : [], result_total, result_next: [] } };
}

function vapi(req, yol, govde, url) {
  if (req.headers.authorization !== `Bearer ${VAPI_KEY}`) return [401, { message: 'Unauthorized' }];
  if (req.method === 'GET' && yol === '/phone-number') return [200, S.phoneNumbers];
  if (req.method === 'GET' && yol === '/assistant') return [200, S.assistants];
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
    const xmlMi = /xml/i.test(req.headers['content-type'] || '');
    try {
      govde = ham && !xmlMi ? JSON.parse(ham) : {};
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
    // Vapi ses kaydı (test)
    if (url.pathname.startsWith('/kayit/')) {
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      return res.end(Buffer.alloc(4096, 7));
    }
    // CORPORATESMS XML servisi
    if (url.pathname === '/sms-xml') {
      const al = (etiket) => ((new RegExp(`<${etiket}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${etiket}>`).exec(ham) || [])[1] || '');
      const xml = (kod, ek = '') => `<?xml version="1.0" encoding="UTF-8"?><CORPORATESMS><RESULT>${kod}</RESULT>${ek}</CORPORATESMS>`;
      const yanitla = (govde) => {
        if (/\bbr\b/.test(req.headers['accept-encoding'] || '')) {
          res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'content-encoding': 'br' });
          return res.end(zlib.brotliCompressSync(govde));
        }
        res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' });
        return res.end(govde);
      };
      if (al('USERNAME') !== 'sms-user' || al('PASSWORD') !== 'sms-pass') return yanitla(xml('002'));
      if (!/^905\d{9}$/.test(al('NUMBERS'))) return yanitla(xml('081'));
      S.sms.push({ baslik: al('SMSHEADER'), msg: al('SMS_MESSAGE'), no: al('NUMBERS'), tip: al('SMSTYPE') });
      return yanitla(xml('1', `<MSG_ID>${S.sms.length}</MSG_ID><MSG_COUNT>1</MSG_COUNT>`));
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
