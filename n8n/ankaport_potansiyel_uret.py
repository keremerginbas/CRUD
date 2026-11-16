"""XRE ANKAPORT HİSSE | 04 Potansiyel Arama — n8n workflow üreticisi.

Akış:
  ANKAPORT HİSSE POTANSİYEL MÜŞTERİLER (sheet ile yüklenir)
    → arama başlayınca  ANKAPORT HİSSE ARANIYOR
    → randevu           RANDEVU OLUŞTURANLAR (satışçılara sırayla atanır, kişi kartı da)
    → ilgilenmiyor      ANKAPORT HİSSE OLUMSUZ (bir daha aranmaz)
    → ulaşılamadı       ANKAPORT HİSSE ULAŞILAMADI (ertesi gün tekrar aranır, en çok MAX_DENEME kez)

Kullanım: python3 ankaport_potansiyel_uret.py <cikti.json> [gizli]
  'gizli' verilirse BITRIX_WEBHOOK_KODU ortam değişkeninden okunur.
  Gizli çıktı repoya KONMAZ (.gitignore: *GIZLI*.json)."""
import json, os, sys, uuid

GIZLI = len(sys.argv) > 2 and sys.argv[2] == "gizli"
BX_KOD = os.environ["BITRIX_WEBHOOK_KODU"] if GIZLI else "YOUR_WEBHOOK"
VAPI_CRED = {"httpHeaderAuth": {"id": "5Pl6muHFf8RtSDsb", "name": "efas ntepe vapi"}}
TG_CRED = {"telegramApi": {"id": "9rdlvgk54bgsCz0s", "name": "Telegram account 2"}}
WEBHOOK_YOLU = "ankaport-hisse-potansiyel"

AYARLAR = r"""// ================================================================
//  ANKAPORT HİSSE | 04 POTANSİYEL ARAMA — AYARLAR
//  Değiştirmeniz gereken her şey burada.
// ================================================================
const AYARLAR = {
  PROJE_ADI: 'Ankaport Hisse Potansiyel',
  BITRIX_WEBHOOK: 'https://xre.bitrix24.com.tr/rest/1/__BX__/', // sonu "/" ile bitmeli

  // Vapi'de bu akış için açılan asistanın ID'si ("ANKAPORT HİSSE - POTANSİYEL").
  // Asistanın Server URL'i ve randevu_olustur aracının URL'i: https://xre111.shop/webhook/__YOL__
  VAPI_ASISTAN_ID: 'BURAYA_ASISTAN_ID',

  // Ankaport hatları (01 Form akışı çift dakikalarda, bu akış tek dakikalarda arar; çakışmaz)
  HATLAR: [
    { id: '568b0026-0667-4372-a075-f4c268ff2e7e', numara: '0533 743 59 66' },
    { id: '23c707db-ba33-45ab-a2bc-38df030b620d', numara: '0533 743 59 65' },
    { id: '43add8d3-ea51-4ca5-83c0-237557f5f617', numara: '0533 743 67 16' },
  ],

  STATU: {
    POTANSIYEL: 'UC_91EBLI', // ANKAPORT HİSSE POTANSİYEL MÜŞTERİLER → sheet buraya yüklenir
    ARANIYOR: 'UC_0T194T', // ANKAPORT HİSSE ARANIYOR
    OLUMSUZ: 'UC_PX5DIZ', // ANKAPORT HİSSE OLUMSUZ → bir daha aranmaz
    ULASILAMADI: 'UC_36TBZ8', // ANKAPORT HİSSE ULAŞILAMADI → ertesi gün tekrar aranır
    RANDEVU: 'UC_WK3LVR', // RANDEVU OLUŞTURANLAR
  },

  // Arama saatleri (Türkiye saati). 1=Pazartesi … 7=Pazar
  ARAMA_SAATLERI: { GUNLER: [1, 2, 3, 4, 5, 6, 7], BASLA: '09:30', BITIS: '19:00' },

  // Ulaşılamayan bir kişi toplam en fazla kaç kez aranır (ilk arama dahil). Sonra ULAŞILAMADI'da kalır.
  MAX_DENEME: 3,

  // Randevu oluşunca lead (ve kişi kartı) bu satışçılara SIRAYLA atanır
  SATIS_SORUMLU_IDLERI: [17984, 22186, 26120, 26352, 1174, 116, 25258, 5778, 11690],

  // Telegram: randevu bildirimi + 19:10 gün sonu raporu
  TELEGRAM: { CHAT_ID: '-4907631457' },
};
return [{ json: AYARLAR }];
""".replace("__BX__", BX_KOD).replace("__YOL__", WEBHOOK_YOLU)

ORTAK = r"""// ===================== ORTAK YARDIMCILAR =====================
const TR_OFFSET_MS = 3 * 3600e3;
const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const pad2 = (n) => String(n).padStart(2, '0');
function trParcalar(date) {
  const d = new Date(date.getTime() + TR_OFFSET_MS);
  return { yil: d.getUTCFullYear(), ay: d.getUTCMonth() + 1, gun: d.getUTCDate(), saat: d.getUTCHours(), dakika: d.getUTCMinutes(), haftaGunu: d.getUTCDay() };
}
function trIso(date) { const p = trParcalar(date); return `${p.yil}-${pad2(p.ay)}-${pad2(p.gun)}T${pad2(p.saat)}:${pad2(p.dakika)}:00+03:00`; }
function trMetin(date) { const p = trParcalar(date); return `${pad2(p.gun)}.${pad2(p.ay)}.${p.yil} ${GUN_ADLARI[p.haftaGunu]} ${pad2(p.saat)}:${pad2(p.dakika)}`; }
function trGun(date) { const p = trParcalar(date); return `${p.yil}-${pad2(p.ay)}-${pad2(p.gun)}`; }
function trGunBasi(date) { const p = trParcalar(date); return new Date(Date.UTC(p.yil, p.ay - 1, p.gun) - TR_OFFSET_MS); }
const saatDakikaya = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
function pencereIcinde(date, P) {
  const p = trParcalar(date); const g = p.haftaGunu === 0 ? 7 : p.haftaGunu;
  if (!P.GUNLER.includes(g)) return false;
  const dk = p.saat * 60 + p.dakika;
  return dk >= saatDakikaya(P.BASLA) && dk < saatDakikaya(P.BITIS);
}
function pencereyeTasi(date, P) {
  if (pencereIcinde(date, P)) return date;
  let gb = trGunBasi(date).getTime();
  for (let i = 0; i < 9; i++) {
    const aday = new Date(gb + saatDakikaya(P.BASLA) * 60000);
    if (aday > date && pencereIcinde(aday, P)) return aday;
    gb += 864e5;
  }
  return date;
}
function telefonNormalize(raw) {
  let s = String(raw || '').trim().replace(/[^\d+]/g, '');
  const yabanci = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/^\+/, '').replace(/^00/, '');
  if (s.length === 10 && /^[2-58]/.test(s)) s = '90' + s;
  else if (s.length === 11 && s.startsWith('0')) s = '9' + s;
  if (/^90[2-58]\d{9}$/.test(s)) return '+' + s;
  if (yabanci && !s.startsWith('90') && /^[1-9]\d{7,14}$/.test(s)) return '+' + s;
  return null;
}
function leadTelefonu(lead) {
  for (const p of Array.isArray(lead && lead.PHONE) ? lead.PHONE : []) { const n = telefonNormalize(p && p.VALUE); if (n) return n; }
  return null;
}
function isimDuzelt(s) {
  return String(s || '').trim().toLocaleLowerCase('tr-TR').split(/\s+/).filter(Boolean)
    .map((k) => k.charAt(0).toLocaleUpperCase('tr-TR') + k.slice(1)).join(' ');
}
function adSoyadBol(s) {
  const p = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return { NAME: p[0] || '', LAST_NAME: '' };
  return { NAME: p.slice(0, -1).join(' '), LAST_NAME: p[p.length - 1] };
}
function kisalt(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function sureMetni(sn) { sn = Math.round(Number(sn) || 0); return sn >= 60 ? `${Math.floor(sn / 60)} dk ${sn % 60} sn` : `${sn} sn`; }
const htmlKacis = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Bitrix 4 baytlık karakterleri (emoji) bozuyor → temizle
function bitrixMetni(s) { return String(s).replace(/[\u{10000}-\u{10FFFF}]️?/gu, '').replace(/ {2,}/g, ' '); }
function argumanCoz(a) {
  if (typeof a === 'string') { try { return JSON.parse(a); } catch (e) { return {}; } }
  return a && typeof a === 'object' ? a : {};
}
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
// Bitrix çağrısı: 503 / QUERY_LIMIT_EXCEEDED gelirse bekleyip tekrar dener
async function bitrix(ctx, A, metod, body) {
  let son;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await ctx.helpers.httpRequest({ method: 'POST', url: `${A.BITRIX_WEBHOOK}${metod}.json`, body, json: true });
      if (r && r.error) {
        son = new Error(`Bitrix ${metod}: ${r.error_description || r.error}`);
        if (/QUERY_LIMIT|OVERLOAD/i.test(String(r.error)) && i < 3) { await bekle(1500 * (i + 1)); continue; }
        throw son;
      }
      return r;
    } catch (e) {
      son = e;
      if (i < 3 && /503|429|QUERY_LIMIT|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String((e && e.message) || e))) { await bekle(1500 * (i + 1)); continue; }
      throw e;
    }
  }
  throw son;
}
async function bitrixBatch(ctx, A, cmd) {
  if (!Object.keys(cmd).length) return {};
  const r = await bitrix(ctx, A, 'batch', { halt: 0, cmd });
  return (r && r.result) || {};
}
function bitrixKomut(metod, params) {
  const qs = (obj, onEk) => {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const key = onEk ? `${onEk}[${k}]` : k;
      if (v !== null && typeof v === 'object') { const ic = qs(v, key); if (ic) out.push(ic); }
      else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v === null ? '' : typeof v === 'string' ? bitrixMetni(v) : String(v))}`);
    }
    return out.join('&');
  };
  return `${metod}?${qs(params)}`;
}
function gunlukSayac(sd, alan) {
  const g = trGun(new Date());
  sd.gunluk = sd.gunluk || {};
  for (const k of Object.keys(sd.gunluk)) if (k < trGun(new Date(Date.now() - 14 * 864e5))) delete sd.gunluk[k];
  sd.gunluk[g] = sd.gunluk[g] || {};
  sd.gunluk[g][alan] = (sd.gunluk[g][alan] || 0) + 1;
}

const ULASILAMADI_NEDEN_RE = /did-not-answer|customer-busy|voicemail|no-answer|failed-to-connect|unanswered|declined|rejected|not-reachable|unavailable/i;
const HAT_HATASI_RE = /^call\.in-progress\.error-|sip-5\d\d|vapifault|pipeline-error|providerfault/i;
const OPERATOR_ANONS_RE = /ulaşılamıyor|ulasilamiyor|şu an kapalı|telefonu kapalı|kapsama alanı|meşgul|sesli mesaj|sinyal sesinden|tekrar deneyiniz|kullanılmamaktadır|abonesine/i;
const TEKRAR_ARA_RE = /sonra ara|daha sonra|müsait değil|musait degil|şu an konuşamam|şimdi konuşamam|toplantıdayım|araba kullanıyorum|işteyim|meşgulüm|akşam ara|yarın ara/i;

// Vapi sunucu mesajını tek tip nesneye çevirir
function vapiMesajCoz(body) {
  const msg = (body && body.message) || {};
  const call = msg.call || {};
  const vv = (call.assistantOverrides && call.assistantOverrides.variableValues) || {};
  const artifact = msg.artifact || {};
  const toolCalls = (msg.toolCallList || msg.toolCalls || []).map((tc) => ({
    id: tc.id, ad: (tc.function && tc.function.name) || tc.name || '',
    arg: argumanCoz(tc.function ? tc.function.arguments : tc.arguments),
  }));
  const mesajlar = artifact.messages || msg.messages || [];
  let kullanici = mesajlar.filter((m) => m && m.role === 'user' && String(m.message || '').trim()).map((m) => String(m.message).trim());
  const transkript = artifact.transcript || msg.transcript || '';
  if (!kullanici.length && transkript) {
    kullanici = transkript.split('\n').filter((l) => /^(user|customer)\s*:/i.test(l)).map((l) => l.replace(/^[^:]+:\s*/, '').trim()).filter(Boolean);
  }
  const aracCagrildi = mesajlar.some((m) => m && (m.role === 'tool_calls' || m.role === 'tool_call_result') &&
    JSON.stringify(m).includes('randevu_olustur'));
  let yapi = {};
  const sd = msg.analysis && msg.analysis.structuredData;
  if (sd && typeof sd === 'object') Object.assign(yapi, sd);
  const so = artifact.structuredOutputs || (call.artifact && call.artifact.structuredOutputs) || msg.structuredOutputs;
  if (so && typeof so === 'object') {
    for (const v of Object.values(so)) {
      if (!v) continue;
      if (v.result && typeof v.result === 'object' && !Array.isArray(v.result)) Object.assign(yapi, v.result);
      else if (v.name && v.result !== undefined) yapi[v.name] = v.result;
    }
  }
  let sure = Number(msg.durationSeconds);
  if (!sure && msg.startedAt && msg.endedAt) sure = (new Date(msg.endedAt) - new Date(msg.startedAt)) / 1000;
  const kayit = artifact.recordingUrl || msg.recordingUrl ||
    (artifact.recording && artifact.recording.mono && artifact.recording.mono.combinedUrl) || (artifact.recording && artifact.recording.stereoUrl) || '';
  const endedReason = msg.endedReason || call.endedReason || '';
  const anlamli = kullanici.filter((t) => !OPERATOR_ANONS_RE.test(t));
  return {
    tip: msg.type || '',
    callId: call.id || '',
    leadId: String(vv.lead_id || (call.metadata && call.metadata.lead_id) || '').replace(/\D/g, ''),
    telefon: telefonNormalize((call.customer && call.customer.number) || (msg.customer && msg.customer.number)),
    toolCalls, endedReason, aracCagrildi,
    sure: Math.round(sure || 0),
    ozet: (typeof yapi.ozet === 'string' && yapi.ozet.trim()) || (msg.analysis && msg.analysis.summary) || msg.summary || '',
    sonuc: String(yapi.sonuc || yapi.arama_sonucu || '').toLowerCase().trim(),
    yapi, kayit,
    kullaniciMetni: anlamli.join(' | '),
    ulasildi: !ULASILAMADI_NEDEN_RE.test(endedReason) && anlamli.length > 0,
    hatHatasi: HAT_HATASI_RE.test(endedReason) && !anlamli.length,
  };
}

// Randevu: lead RANDEVU OLUŞTURANLAR'a geçer, sıradaki satışçıya atanır, kişi kartı da aynı satışçıya.
async function randevuIsle(ctx, A, sd, lead, arg, m) {
  const id = String(lead.ID);
  const liste = (A.SATIS_SORUMLU_IDLERI || []).map(String).filter(Boolean);
  let sorumlu = String(lead.ASSIGNED_BY_ID || '');
  if (liste.length) {
    const i = (Number(sd.rr) || 0) % liste.length;
    sorumlu = liste[i];
    sd.rr = i + 1;
  }
  const ad = isimDuzelt((arg && arg.ad_soyad) || [lead.NAME, lead.LAST_NAME].filter(Boolean).join(' '));
  const detay = [
    `${A.PROJE_ADI} — yapay zeka aramasında RANDEVU oluşturuldu. Danışman müşteriyi arayıp gün/saat belirleyecek.`,
    ad ? `Müşteri: ${ad}` : '',
    m.telefon ? `Telefon: ${m.telefon}` : '',
    arg && arg.ilgilendigi_hisse ? `İlgilendiği hisse: ${arg.ilgilendigi_hisse}` : '',
    arg && (arg.randevu_tarihi || arg.randevu_saati) ? `Müşterinin söylediği zaman: ${[arg.randevu_tarihi, arg.randevu_saati].filter(Boolean).join(' ')}` : '',
    arg && arg.not ? `Not: ${kisalt(arg.not, 500)}` : '',
    m.callId ? `Vapi Call ID: ${m.callId}` : '',
  ].filter(Boolean);
  const alanlar = { STATUS_ID: A.STATU.RANDEVU, ASSIGNED_BY_ID: sorumlu || undefined };
  if (ad && !String(lead.NAME || '').trim()) Object.assign(alanlar, adSoyadBol(ad));
  const cmd = {
    upd: bitrixKomut('crm.lead.update', { id, fields: alanlar }),
    not: bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: id, ENTITY_TYPE: 'lead', COMMENT: detay.join('\n') } }),
  };
  if (sorumlu && lead.CONTACT_ID && String(lead.CONTACT_ID) !== '0') {
    cmd.kisi = bitrixKomut('crm.contact.update', { id: String(lead.CONTACT_ID), fields: { ASSIGNED_BY_ID: sorumlu } });
  }
  if (sorumlu) {
    cmd.todo = bitrixKomut('crm.activity.todo.add', {
      ownerTypeId: 1, ownerId: id,
      deadline: trIso(pencereyeTasi(new Date(Date.now() + 15 * 60000), A.ARAMA_SAATLERI)),
      title: kisalt(`Ankaport Hisse randevu — müşteriyi arayın — ${ad || m.telefon || ''}`, 250),
      description: detay.join('\n'), responsibleId: sorumlu, pingOffsets: [0],
    });
  }
  const r = await bitrixBatch(ctx, A, cmd);
  const hata = (r.result_error && r.result_error.upd) || null;
  if (hata) throw new Error('Bitrix randevu kaydı: ' + JSON.stringify(hata));
  gunlukSayac(sd, 'randevu');
  let sorumluAdi = sorumlu ? `ID ${sorumlu}` : 'Atanmadı';
  try {
    const u = await bitrix(ctx, A, 'user.get', { ID: sorumlu });
    const k = u && u.result && u.result[0];
    if (k) sorumluAdi = [k.NAME, k.LAST_NAME].filter(Boolean).join(' ') || sorumluAdi;
  } catch (e) {}
  const telegram = [
    `📅 <b>ANKAPORT HİSSE — YENİ RANDEVU</b> (potansiyel arama)`,
    `👤 Müşteri: ${htmlKacis(ad || '-')} · ${htmlKacis(m.telefon || '-')}`,
    `👩‍💼 Atanan satışçı: ${htmlKacis(sorumluAdi)}`,
    arg && arg.not ? `📝 Not: ${htmlKacis(kisalt(arg.not, 300))}` : '',
    `🔗 https://xre.bitrix24.com.tr/crm/lead/details/${id}/`,
  ].filter(Boolean).join('\n');
  return { sorumlu, telegram };
}
// =================== /ORTAK YARDIMCILAR ===================
"""

KUYRUK = r"""
// Her 2 dakikada (tek dakikalarda) çalışır:
//  1) 30 dk'dan uzun süredir ARANIYOR'da kalan (sonucu gelmemiş) lead'leri ULAŞILAMADI'ya alır
//  2) Arama saatindeyse boş hatlara kişi dağıtır: önce bugün sırası gelen ULAŞILAMADI'lar, sonra POTANSİYEL'ler
const A = $('AYARLAR').first().json;
if (!/^[0-9a-f-]{36}$/i.test(String(A.VAPI_ASISTAN_ID))) throw new Error('AYARLAR → VAPI_ASISTAN_ID girilmemiş.');
const ctx = this;
const simdi = new Date();
const sd = $getWorkflowStaticData('global');
sd.deneme = sd.deneme || {}; sd.sonArama = sd.sonArama || {}; sd.hatSon = sd.hatSon || {};
for (const [k, v] of Object.entries(sd.sonArama)) if (Date.now() - v > 90 * 864e5) { delete sd.sonArama[k]; delete sd.deneme[k]; }

// 1) Takılı kalanlar
const takili = await bitrix(ctx, A, 'crm.lead.list', {
  filter: { STATUS_ID: A.STATU.ARANIYOR, '<DATE_MODIFY': trIso(new Date(Date.now() - 30 * 60000)) },
  select: ['ID'], order: { ID: 'ASC' },
});
const tcmd = {};
for (const l of (takili.result || []).slice(0, 25)) {
  tcmd[`u${l.ID}`] = bitrixKomut('crm.lead.update', { id: l.ID, fields: { STATUS_ID: A.STATU.ULASILAMADI } });
  tcmd[`c${l.ID}`] = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: l.ID, ENTITY_TYPE: 'lead', COMMENT: `${A.PROJE_ADI}: arama sonucu gelmedi, ULAŞILAMADI'ya alındı (tekrar aranacak).` } });
}
await bitrixBatch(ctx, A, tcmd);

// 2) Arama
if (!pencereIcinde(simdi, A.ARAMA_SAATLERI)) return [];
const cagrilar = $input.all().map((i) => i.json).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((c) => c && c.id);
const mesgul = new Set(cagrilar.filter((c) => c.status && c.status !== 'ended').map((c) => c.phoneNumberId));
const bosHatlar = A.HATLAR.filter((h) => !mesgul.has(h.id) && !(sd.hatSon[h.id] && Date.now() - sd.hatSon[h.id] < 90e3));
if (!bosHatlar.length) return [];

const bugun = trGun(simdi);
const gunBasi = trIso(trGunBasi(simdi));
const secilen = [];
const notlar = {};
const MAX = Math.max(1, Number(A.MAX_DENEME) || 1);

async function tara(statu, ekFiltre, uygunMu) {
  let start = 0;
  for (let sayfa = 0; sayfa < 10 && secilen.length < bosHatlar.length; sayfa++) {
    const r = await bitrix(ctx, A, 'crm.lead.list', {
      filter: Object.assign({ STATUS_ID: statu }, ekFiltre),
      select: ['ID', 'NAME', 'LAST_NAME', 'PHONE', 'DATE_MODIFY'], order: { ID: 'ASC' }, start,
    });
    for (const lead of r.result || []) {
      if (secilen.length >= bosHatlar.length) break;
      const id = String(lead.ID);
      if (secilen.some((s) => s.id === id) || !uygunMu(lead)) continue;
      const telefon = leadTelefonu(lead);
      if (!telefon) {
        sd.deneme[id] = MAX; sd.sonArama[id] = Date.now();
        notlar[`u${id}`] = bitrixKomut('crm.lead.update', { id, fields: { STATUS_ID: A.STATU.ULASILAMADI } });
        notlar[`c${id}`] = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: id, ENTITY_TYPE: 'lead', COMMENT: `${A.PROJE_ADI}: geçerli telefon numarası yok, aranamadı.` } });
        continue;
      }
      secilen.push({ id, telefon, ad: isimDuzelt([lead.NAME, lead.LAST_NAME].filter(Boolean).join(' ')) });
    }
    if (r.next === undefined || !(r.result || []).length) break;
    start = r.next;
  }
}

// Önce dünden kalan ULAŞILAMADI'lar (bugün henüz aranmamış ve deneme hakkı olanlar)
await tara(A.STATU.ULASILAMADI, { '<DATE_MODIFY': gunBasi }, (lead) => {
  const id = String(lead.ID);
  if ((Number(sd.deneme[id]) || 1) >= MAX) return false;
  const son = sd.sonArama[id];
  return !son || trGun(new Date(son)) < bugun;
});
// Sonra yeni POTANSİYEL'ler
await tara(A.STATU.POTANSIYEL, {}, () => true);
await bitrixBatch(ctx, A, notlar);

return secilen.map((s, i) => {
  const hat = bosHatlar[i];
  sd.hatSon[hat.id] = Date.now();
  const deneme = (Number(sd.deneme[s.id]) || 0) + 1;
  sd.deneme[s.id] = deneme;
  sd.sonArama[s.id] = Date.now();
  return { json: {
    leadId: s.id, ad: s.ad, telefon: s.telefon, hat: hat.numara, deneme,
    vapiBody: {
      assistantId: A.VAPI_ASISTAN_ID,
      phoneNumberId: hat.id,
      customer: { number: s.telefon, name: s.ad || undefined },
      name: kisalt(`Ankaport Potansiyel #${s.id} ${s.ad || s.telefon}`, 40),
      assistantOverrides: { variableValues: { lead_id: s.id, musteri_adi: s.ad } },
      metadata: { lead_id: s.id, kaynak: 'ankaport-potansiyel', deneme },
    },
  } };
});
"""

ARAMA_NOTU = r"""
// Arama başladıysa lead ARANIYOR'a geçer; başlamadıysa ULAŞILAMADI'ya (ertesi gün tekrar denenir).
const A = $('AYARLAR').first().json;
const sd = $getWorkflowStaticData('global');
const kuyruk = $('Arama Kuyruğu').all();
const yanitlar = $input.all();
const MAX = Math.max(1, Number(A.MAX_DENEME) || 1);
const cmd = {};
kuyruk.forEach((k, i) => {
  const q = k.json; const r = (yanitlar[i] && yanitlar[i].json) || {};
  if (r.id) {
    gunlukSayac(sd, 'arandi');
    cmd[`u${i}`] = bitrixKomut('crm.lead.update', { id: q.leadId, fields: { STATUS_ID: A.STATU.ARANIYOR } });
    cmd[`c${i}`] = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: q.leadId, ENTITY_TYPE: 'lead',
      COMMENT: `${A.PROJE_ADI}: yapay zeka araması başladı (${q.deneme}/${MAX}. deneme, arayan hat: ${q.hat}).` } });
  } else {
    const hata = String((r.error && (r.error.message || JSON.stringify(r.error))) || r.message || JSON.stringify(r)).slice(0, 300);
    cmd[`u${i}`] = bitrixKomut('crm.lead.update', { id: q.leadId, fields: { STATUS_ID: A.STATU.ULASILAMADI } });
    cmd[`c${i}`] = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: q.leadId, ENTITY_TYPE: 'lead',
      COMMENT: `${A.PROJE_ADI}: arama BAŞLATILAMADI (${q.hat}). Hata: ${hata}` } });
  }
});
await bitrixBatch(this, A, cmd);
return [{ json: { islenen: kuyruk.length } }];
"""

MESAJI_COZ = r"""
const body = $('Vapi Webhook').first().json.body || {};
return [{ json: vapiMesajCoz(body) }];
"""

ARAC = r"""
// Görüşme sırasında randevu_olustur aracı çağrıldı → randevu işlenir, Vapi'ye cevap döner.
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const sd = $getWorkflowStaticData('global');
sd.aracCagri = sd.aracCagri || {};
for (const [k, v] of Object.entries(sd.aracCagri)) if (Date.now() - v.t > 3 * 864e5) delete sd.aracCagri[k];
const results = [];
const telegram = [];
for (const tc of m.toolCalls) {
  if (tc.ad !== 'randevu_olustur') { results.push({ toolCallId: tc.id, result: `Bilinmeyen araç: ${tc.ad}` }); continue; }
  if (m.callId) sd.aracCagri[m.callId] = { t: Date.now(), arg: tc.arg };
  const KAPANIS = 'Kaydedildi. Müşteriye "Tamam, bilgilerinizi aldım. Danışmanımız en kısa sürede sizi arayıp detayları anlatacak." de, ardından "İksreli günler dilerim, iyi günler" diyerek görüşmeyi kapat. Başka soru sorma.';
  try {
    if (!m.leadId) throw new Error('lead_id yok');
    const r = await bitrix(this, A, 'crm.lead.get', { id: m.leadId });
    const lead = r && r.result;
    if (!lead || !lead.ID) throw new Error('lead bulunamadı');
    if (lead.STATUS_ID !== A.STATU.RANDEVU) {
      const s = await randevuIsle(this, A, sd, lead, tc.arg, m);
      telegram.push(s.telegram);
    }
    if (m.callId) sd.aracCagri[m.callId].islendi = true;
    results.push({ toolCallId: tc.id, result: KAPANIS });
  } catch (e) {
    results.push({ toolCallId: tc.id, result: 'Talebini not aldığını, danışmanımızın en kısa sürede arayacağını söyle ve kibarca görüşmeyi kapat.' });
  }
}
return [{ json: { results, telegram: telegram.join('\n\n') } }];
"""

SONUC = r"""
// Çağrı bitti (end-of-call-report): lead'in yeni statüsüne karar verir.
//  randevu → RANDEVU OLUŞTURANLAR | ilgilenmiyor/aranmak istemiyor/yanlış kişi → OLUMSUZ
//  açmadı/meşgul/hat hatası/"sonra arayın" → ULAŞILAMADI (deneme hakkı varsa ertesi gün tekrar)
const A = $('AYARLAR').first().json;
const m = $('Mesajı Çöz').first().json;
const sd = $getWorkflowStaticData('global');
sd.aracCagri = sd.aracCagri || {}; sd.deneme = sd.deneme || {};
if (!m.leadId) return [];
const r = await bitrix(this, A, 'crm.lead.get', { id: m.leadId });
const lead = r && r.result;
if (!lead || !lead.ID) return [];
const id = String(lead.ID);
const MAX = Math.max(1, Number(A.MAX_DENEME) || 1);
const deneme = Number(sd.deneme[id]) || 1;
const arac = m.callId ? sd.aracCagri[m.callId] : null;
let telegram = '';
let durum;
let yeniStatu = null;

if (lead.STATUS_ID === A.STATU.RANDEVU) {
  durum = 'Randevu oluşturuldu';
} else if (arac || m.sonuc === 'randevu') {
  // Araç çağrıldı ama kayıt başarısız olduysa ya da model aracı çağırmayı unuttuysa burada tamamlanır
  const s = await randevuIsle(this, A, sd, lead, (arac && arac.arg) || {}, m);
  telegram = s.telegram;
  durum = 'Randevu oluşturuldu (çağrı sonunda işlendi)';
} else if (lead.STATUS_ID !== A.STATU.ARANIYOR) {
  durum = `Statü elle değiştirilmiş (${lead.STATUS_ID}), dokunulmadı`;
} else if (m.hatHatasi || !m.ulasildi || /tekrar|sonra|musait|müsait|ulasilamadi/.test(m.sonuc) || (!m.sonuc && TEKRAR_ARA_RE.test(m.kullaniciMetni))) {
  yeniStatu = A.STATU.ULASILAMADI;
  const neden = m.hatHatasi ? `hat hatası (${m.endedReason})` : !m.ulasildi ? 'açmadı / meşgul' : 'müsait değil, sonra aranmak istedi';
  durum = deneme >= MAX ? `Ulaşılamadı — ${neden}. ${deneme}/${MAX} deneme doldu, tekrar ARANMAYACAK.` : `Ulaşılamadı — ${neden}. Yarın tekrar aranacak (${deneme}/${MAX}).`;
  gunlukSayac(sd, 'ulasilamadi');
} else {
  yeniStatu = A.STATU.OLUMSUZ;
  const neden = { ilgilenmiyor: 'ilgilenmiyor', aranmak_istemiyor: 'aranmak istemiyor', yanlis_kisi: 'yanlış kişi' }[m.sonuc] || 'görüştü, randevu oluşmadı';
  durum = `Olumsuz — ${neden}. Tekrar aranmayacak.`;
  gunlukSayac(sd, 'olumsuz');
}
if (m.callId) delete sd.aracCagri[m.callId];

const cmd = {};
if (yeniStatu) cmd.upd = bitrixKomut('crm.lead.update', { id, fields: { STATUS_ID: yeniStatu } });
cmd.rapor = bitrixKomut('crm.timeline.comment.add', { fields: { ENTITY_ID: id, ENTITY_TYPE: 'lead', COMMENT: [
  `${A.PROJE_ADI} yapay zeka araması — ${durum}`,
  `Süre: ${sureMetni(m.sure)} | Bitiş: ${m.endedReason || '-'}`,
  m.ozet ? `Özet: ${kisalt(m.ozet, 1500)}` : '',
  m.kayit ? `Ses kaydı: ${m.kayit}` : '',
  m.callId ? `Vapi Call ID: ${m.callId}` : '',
].filter(Boolean).join('\n') } });
await bitrixBatch(this, A, cmd);
return [{ json: { leadId: id, durum, telegram } }];
"""

RAPOR = r"""
// 19:10 gün sonu raporu
const A = $('AYARLAR').first().json;
const sd = $getWorkflowStaticData('global');
const g = (sd.gunluk || {})[trGun(new Date())] || {};
async function say(statu) {
  try { const r = await bitrix(this, A, 'crm.lead.list', { filter: { STATUS_ID: statu }, select: ['ID'] }); return Number(r.total) || (r.result || []).length; }
  catch (e) { return '?'; }
}
const bekleyen = await say.call(this, A.STATU.POTANSIYEL);
const ulasilamadi = await say.call(this, A.STATU.ULASILAMADI);
const metin = [
  `📊 <b>ANKAPORT HİSSE — POTANSİYEL ARAMA GÜN SONU</b> (${trGun(new Date()).split('-').reverse().join('.')})`,
  `☎ Bugün yapılan arama: ${g.arandi || 0}`,
  `📅 Randevu: ${g.randevu || 0}`,
  `❌ Olumsuz: ${g.olumsuz || 0}`,
  `📵 Ulaşılamadı: ${g.ulasilamadi || 0}`,
  ``,
  `⏳ Henüz aranmamış (POTANSİYEL): ${bekleyen}`,
  `🔁 ULAŞILAMADI statüsünde: ${ulasilamadi} (deneme hakkı olanlar yarın tekrar aranır)`,
].join('\n');
return [{ json: { telegram: metin } }];
"""

NOT = f"""## ANKAPORT HİSSE | 04 Potansiyel Arama
**Sheet** → Bitrix'te **ANKAPORT HİSSE POTANSİYEL MÜŞTERİLER** statüsüne yüklenir.

- Her 2 dk (tek dakikalar), 09:30–19:00, her gün: boş hatlar sırayla arar → lead **ARANIYOR**'a geçer
- Randevu → **RANDEVU OLUŞTURANLAR**, satışçılara sırayla atanır (kişi kartı da)
- İlgilenmiyor / aranmak istemiyor / yanlış kişi → **OLUMSUZ**, bir daha aranmaz
- Açmadı / meşgul / "sonra arayın" → **ULAŞILAMADI**, ertesi gün tekrar (en çok MAX_DENEME kez)
- 30 dk'dan uzun ARANIYOR'da kalan → ULAŞILAMADI
- Randevular anında, gün sonu raporu 19:10'da Telegram'a

**Vapi:** asistan "ANKAPORT HİSSE - POTANSİYEL" → Server URL ve randevu_olustur aracı URL'i:
`https://xre111.shop/webhook/{WEBHOOK_YOLU}`
Asistan ID'sini AYARLAR → VAPI_ASISTAN_ID'ye yazın."""


def nid():
    return str(uuid.uuid4())


def kod(ad, js, x, y, ortak=True):
    return {"parameters": {"jsCode": (ORTAK + js) if ortak else js}, "id": nid(), "name": ad,
            "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [x, y]}


def http_bitrix_yok():
    pass


def kosul(sol):
    return {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": nid(), "leftValue": sol, "rightValue": "",
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and"}


def esit(sol, sag):
    return {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": nid(), "leftValue": sol, "rightValue": sag,
                            "operator": {"type": "string", "operation": "equals"}}],
            "combinator": "and"}


def telegram_node(ad, x, y):
    return {"parameters": {"chatId": "={{ $('AYARLAR').first().json.TELEGRAM.CHAT_ID }}", "text": "={{ $json.telegram }}",
                           "additionalFields": {"appendAttribution": False, "disable_web_page_preview": True, "parse_mode": "HTML"}},
            "id": nid(), "name": ad, "type": "n8n-nodes-base.telegram", "typeVersion": 1.2, "position": [x, y],
            "webhookId": nid(), "credentials": TG_CRED, "onError": "continueRegularOutput"}


def respond(ad, x, y, json_body=None):
    p = {"respondWith": "noData", "options": {}}
    if json_body:
        p = {"respondWith": "json", "responseBody": json_body, "options": {}}
    return {"parameters": p, "id": nid(), "name": ad, "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [x, y]}


def telegram_var_mi(ad, x, y):
    return {"parameters": {"conditions": kosul("={{ !!$json.telegram }}"), "options": {}}, "id": nid(), "name": ad,
            "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [x, y]}


nodes = [
    {"parameters": {"content": NOT, "height": 520, "width": 600}, "id": nid(), "name": "Not", "type": "n8n-nodes-base.stickyNote",
     "typeVersion": 1, "position": [-260, -620]},
    {"parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "1-59/2 * * * *"}]}}, "id": nid(),
     "name": "Her 2 Dakikada", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 0]},
    {"parameters": {"httpMethod": "POST", "path": WEBHOOK_YOLU, "responseMode": "responseNode", "options": {}}, "id": nid(),
     "name": "Vapi Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 300], "webhookId": nid()},
    {"parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "10 19 * * *"}]}}, "id": nid(),
     "name": "Gün Sonu 19:10", "type": "n8n-nodes-base.scheduleTrigger", "typeVersion": 1.2, "position": [0, 600]},
    kod("AYARLAR", AYARLAR, 240, 300, ortak=False),
    {"parameters": {"rules": {"values": [
        {"conditions": kosul("={{ $('Vapi Webhook').isExecuted }}"), "renameOutput": True, "outputKey": "Vapi"},
        {"conditions": kosul("={{ $('Gün Sonu 19:10').isExecuted }}"), "renameOutput": True, "outputKey": "Rapor"}]},
        "options": {"fallbackOutput": "extra", "renameFallbackOutput": "Kuyruk"}},
     "id": nid(), "name": "Tetikleyen", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [480, 300]},
    # Kuyruk
    {"parameters": {"url": "https://api.vapi.ai/call", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
                    "sendQuery": True, "queryParameters": {"parameters": [
                        {"name": "createdAtGt", "value": "={{ new Date(Date.now() - 30*60000).toISOString() }}"},
                        {"name": "limit", "value": "100"}]}, "options": {"timeout": 20000}},
     "id": nid(), "name": "Vapi: Son Çağrılar", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [740, 0],
     "credentials": VAPI_CRED, "alwaysOutputData": True, "retryOnFail": True},
    kod("Arama Kuyruğu", KUYRUK, 980, 0),
    {"parameters": {"method": "POST", "url": "https://api.vapi.ai/call", "authentication": "genericCredentialType",
                    "genericAuthType": "httpHeaderAuth", "sendBody": True, "specifyBody": "json",
                    "jsonBody": "={{ JSON.stringify($json.vapiBody) }}", "options": {"timeout": 20000}},
     "id": nid(), "name": "Vapi: Aramayı Başlat", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1220, 0],
     "credentials": VAPI_CRED, "onError": "continueRegularOutput"},
    kod("Arama Notu", ARAMA_NOTU, 1460, 0),
    # Vapi webhook
    kod("Mesajı Çöz", MESAJI_COZ, 740, 300),
    {"parameters": {"rules": {"values": [
        {"conditions": esit("={{ $json.tip }}", "tool-calls"), "renameOutput": True, "outputKey": "Araç çağrısı"},
        {"conditions": esit("={{ $json.tip }}", "end-of-call-report"), "renameOutput": True, "outputKey": "Çağrı raporu"}]},
        "options": {"fallbackOutput": "extra", "renameFallbackOutput": "Diğer"}},
     "id": nid(), "name": "Mesaj Tipi", "type": "n8n-nodes-base.switch", "typeVersion": 3.2, "position": [980, 300]},
    kod("Randevu Aracı", ARAC, 1220, 200),
    respond("Yanıtla (Araç)", 1460, 140, "={{ JSON.stringify({ results: $json.results }) }}"),
    telegram_var_mi("Randevu Bildirimi Var mı?", 1460, 280),
    telegram_node("Telegram: Randevu", 1700, 280),
    respond("Hemen Yanıtla", 1220, 400),
    kod("Sonucu İşle", SONUC, 1460, 440),
    telegram_var_mi("Bildirim Var mı?", 1700, 440),
    telegram_node("Telegram: Randevu (Rapor)", 1940, 440),
    respond("Yanıtla (Diğer)", 1220, 560),
    # Rapor
    kod("Gün Sonu Raporu", RAPOR, 740, 640),
    telegram_node("Telegram: Gün Sonu", 980, 640),
]


def bag(*cikislar):
    return {"main": [[{"node": n, "type": "main", "index": 0} for n in c] for c in cikislar]}


connections = {
    "Her 2 Dakikada": bag(["AYARLAR"]),
    "Vapi Webhook": bag(["AYARLAR"]),
    "Gün Sonu 19:10": bag(["AYARLAR"]),
    "AYARLAR": bag(["Tetikleyen"]),
    "Tetikleyen": bag(["Mesajı Çöz"], ["Gün Sonu Raporu"], ["Vapi: Son Çağrılar"]),
    "Vapi: Son Çağrılar": bag(["Arama Kuyruğu"]),
    "Arama Kuyruğu": bag(["Vapi: Aramayı Başlat"]),
    "Vapi: Aramayı Başlat": bag(["Arama Notu"]),
    "Mesajı Çöz": bag(["Mesaj Tipi"]),
    "Mesaj Tipi": bag(["Randevu Aracı"], ["Hemen Yanıtla"], ["Yanıtla (Diğer)"]),
    "Randevu Aracı": bag(["Yanıtla (Araç)", "Randevu Bildirimi Var mı?"]),
    "Randevu Bildirimi Var mı?": bag(["Telegram: Randevu"]),
    "Hemen Yanıtla": bag(["Sonucu İşle"]),
    "Sonucu İşle": bag(["Bildirim Var mı?"]),
    "Bildirim Var mı?": bag(["Telegram: Randevu (Rapor)"]),
    "Gün Sonu Raporu": bag(["Telegram: Gün Sonu"]),
}

wf = {
    "name": "XRE ANKAPORT HİSSE | 04 Potansiyel Arama",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "timezone": "Europe/Istanbul", "errorWorkflow": "RAY5efwAaxnHR67o",
                 "callerPolicy": "workflowsFromSameOwner"},
    "pinData": {},
}

if __name__ == "__main__":
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=2)
    print("yazıldı:", sys.argv[1], len(nodes), "node")
