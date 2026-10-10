// ===================== ORTAK YARDIMCILAR =====================
// build.mjs bu bloğu Code node'larının başına ekler.
// Değişiklik yapacaksanız ankaport-hisse/n8n/src/lib.js dosyasını düzenleyip build alın.
// EFAS N-TEPE projesindeki test edilmiş yardımcılardan türetildi.

const TR_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye: UTC+3, yaz saati uygulaması yok
const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function trParcalar(date) {
  const d = new Date(date.getTime() + TR_OFFSET_MS);
  return {
    yil: d.getUTCFullYear(),
    ay: d.getUTCMonth() + 1,
    gun: d.getUTCDate(),
    saat: d.getUTCHours(),
    dakika: d.getUTCMinutes(),
    haftaGunu: d.getUTCDay(),
  };
}

function trIso(date) {
  const p = trParcalar(date);
  return `${p.yil}-${pad2(p.ay)}-${pad2(p.gun)}T${pad2(p.saat)}:${pad2(p.dakika)}:00+03:00`;
}

function trMetin(date) {
  const p = trParcalar(date);
  return `${pad2(p.gun)}.${pad2(p.ay)}.${p.yil} ${GUN_ADLARI[p.haftaGunu]} ${pad2(p.saat)}:${pad2(p.dakika)}`;
}

function trTarihSaatCoz(tarih, saat) {
  const t = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(tarih || '').trim());
  const s = /^(\d{1,2})[:.](\d{2})$/.exec(String(saat || '').trim());
  if (!t || !s) return null;
  const [y, m, d, hh, mm] = [+t[1], +t[2], +t[3], +s[1], +s[2]];
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm) - TR_OFFSET_MS);
  const p = trParcalar(date);
  if (p.yil !== y || p.ay !== m || p.gun !== d || p.saat !== hh || p.dakika !== mm) return null;
  return date;
}

function dakikaEkle(date, dk) {
  return new Date(date.getTime() + dk * 60000);
}

function saatDakikaya(str) {
  const [h, m] = String(str).split(':').map(Number);
  return h * 60 + (m || 0);
}

function pencereIcinde(date, pencere) {
  const p = trParcalar(date);
  const gun = p.haftaGunu === 0 ? 7 : p.haftaGunu;
  if (!pencere.GUNLER.includes(gun)) return false;
  const dk = p.saat * 60 + p.dakika;
  return dk >= saatDakikaya(pencere.BASLA) && dk < saatDakikaya(pencere.BITIS);
}

function pencereyeTasi(date, pencere) {
  if (pencereIcinde(date, pencere)) return date;
  const basla = saatDakikaya(pencere.BASLA);
  const p = trParcalar(date);
  let gunBasi = Date.UTC(p.yil, p.ay - 1, p.gun) - TR_OFFSET_MS;
  const dk = p.saat * 60 + p.dakika;
  for (let i = 0; i < 8; i++) {
    const aday = new Date(gunBasi + basla * 60000);
    if ((i > 0 || dk < basla) && pencereIcinde(aday, pencere)) return aday;
    gunBasi += 24 * 60 * 60000;
  }
  return date;
}

// Herhangi bir telefon yazımını E.164'e çevirir (+905321234567). Geçersizse null.
function telefonNormalize(raw) {
  const ham = String(raw || '').trim();
  let s = ham.replace(/[^\d+]/g, '');
  const yabanci = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/^\+/, '').replace(/^00/, '');
  if (s.length === 10 && /^[2-58]/.test(s)) s = '90' + s;
  else if (s.length === 11 && s.startsWith('0')) s = '9' + s;
  if (/^90[2-58]\d{9}$/.test(s)) return '+' + s;
  if (yabanci && !s.startsWith('90') && /^[1-9]\d{7,14}$/.test(s)) return '+' + s;
  return null;
}

// Bitrix'te numara farklı yazılmış olabilir; arama için varyantlar
function telefonVaryantlari(e164) {
  if (!e164) return [];
  const rakam = e164.replace(/\D/g, '');
  const v = new Set([e164, rakam]);
  if (rakam.startsWith('90') && rakam.length === 12) {
    const yerel = rakam.slice(2);
    v.add('0' + yerel);
    v.add(yerel);
    v.add(`0${yerel.slice(0, 3)} ${yerel.slice(3, 6)} ${yerel.slice(6, 8)} ${yerel.slice(8)}`);
    v.add(`+90 ${yerel.slice(0, 3)} ${yerel.slice(3, 6)} ${yerel.slice(6, 8)} ${yerel.slice(8)}`);
  }
  return [...v];
}

function leadTelefonu(lead) {
  const liste = Array.isArray(lead && lead.PHONE) ? lead.PHONE : [];
  for (const p of liste) {
    const n = telefonNormalize(p && p.VALUE);
    if (n) return n;
  }
  return null;
}

function leadEpostasi(lead) {
  const liste = Array.isArray(lead && lead.EMAIL) ? lead.EMAIL : [];
  for (const e of liste) {
    const v = String((e && e.VALUE) || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  }
  return '';
}

function bitrixTarih(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// PHP http_build_query eşdeğeri (Bitrix batch komutları için)
function qs(obj, onEk) {
  const parcalar = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const anahtar = onEk ? `${onEk}[${k}]` : k;
    if (v !== null && typeof v === 'object') {
      const ic = qs(v, anahtar);
      if (ic) parcalar.push(ic);
    } else {
      const deger = v === null ? '' : v === true ? 'Y' : v === false ? 'N' : bitrixMetni(v);
      parcalar.push(`${encodeURIComponent(anahtar)}=${encodeURIComponent(deger)}`);
    }
  }
  return parcalar.join('&');
}

function bitrixKomut(metod, parametreler) {
  return `${metod}?${qs(parametreler)}`;
}

// Bitrix (4 baytlık unicode karakterleri desteklemiyor, emojileri ":xxxxxxxx:" diye bozuyor) → BMP karşılıkları
const BITRIX_EMOJI = { '🤖': '', '📝': '☑', '📞': '☎', '📵': '☎', '📅': '☑', '💬': '✉', '📧': '✉', '🟢': '✆', '🎧': '♫', '👤': '', '🔗': '', '❌': '✕', '✅': '✓', '⚠️': '!', '🎉': '★' };
function bitrixMetni(s) {
  return String(s)
    .replace(/[\u{10000}-\u{10FFFF}]️?/gu, (e) => BITRIX_EMOJI[e.replace(/️$/, '')] ?? '')
    .replace(/^ +| +$/gm, '')
    .replace(/ {2,}/g, ' ');
}

function batchHatalari(yanit) {
  const e = yanit && yanit.result && yanit.result.result_error;
  return e && typeof e === 'object' && !Array.isArray(e) ? e : {};
}

function batchSonuclari(yanit) {
  const r = yanit && yanit.result && yanit.result.result;
  return r && typeof r === 'object' ? r : {};
}

function kisalt(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function argumanCoz(a) {
  if (typeof a === 'string') {
    try {
      return JSON.parse(a);
    } catch (e) {
      return {};
    }
  }
  return a && typeof a === 'object' ? a : {};
}

const ULASILAMADI_NEDEN_RE = /did-not-answer|customer-busy|voicemail|no-answer|failed-to-connect|unanswered|declined|rejected|not-reachable|unavailable/i;
// Vapi'nin "call.in-progress.error-..." öneki, çağrı müşteriye hiç ulaşmadan hat/altyapı
// tarafında düştüğü her durumu kapsar (SIP 503, bağlanamadı, sağlayıcı hatası, vb.)
const HAT_HATASI_RE = /^call\.in-progress\.error-|sip-5\d\d|vapifault|pipeline-error|providerfault(?![\w.-]*sip-4\d\d)/i;
const OPERATOR_ANONS_RE = /ulaşılamıyor|ulasilamiyor|şu an kapalı|telefonu kapalı|kapsama alanı|meşgul|sesli mesaj|sinyal sesinden|tekrar deneyiniz|kullanılmamaktadır|abonesine/i;

// Vapi sunucu mesajını tek tip nesneye çevirir
function vapiMesajCoz(body) {
  const msg = (body && body.message) || {};
  const call = msg.call || {};
  const ov = call.assistantOverrides || {};
  const vv = ov.variableValues || {};
  const artifact = msg.artifact || {};

  const toolCalls = (msg.toolCallList || msg.toolCalls || []).map((tc) => ({
    id: tc.id,
    ad: (tc.function && tc.function.name) || tc.name || '',
    arg: argumanCoz(tc.function ? tc.function.arguments : tc.arguments),
  }));

  const mesajlar = artifact.messages || msg.messages || [];
  let kullanici = mesajlar
    .filter((m) => m && m.role === 'user' && String(m.message || '').trim())
    .map((m) => String(m.message).trim());
  const transkript = artifact.transcript || msg.transcript || '';
  if (!kullanici.length && transkript) {
    kullanici = transkript
      .split('\n')
      .filter((l) => /^(user|customer)\s*:/i.test(l))
      .map((l) => l.replace(/^[^:]+:\s*/, '').trim())
      .filter(Boolean);
  }

  let yapi = {};
  const sd = msg.analysis && msg.analysis.structuredData;
  if (sd && typeof sd === 'object') yapi = sd;
  else {
    const so = artifact.structuredOutputs || (call.artifact && call.artifact.structuredOutputs) || msg.structuredOutputs;
    if (so && typeof so === 'object') {
      for (const v of Object.values(so)) {
        if (!v) continue;
        if (v.result && typeof v.result === 'object' && !Array.isArray(v.result)) Object.assign(yapi, v.result);
        else if (v.name && v.result !== undefined) yapi[v.name] = v.result;
      }
    }
  }

  let sure = Number(msg.durationSeconds);
  if (!sure && msg.startedAt && msg.endedAt) sure = (new Date(msg.endedAt) - new Date(msg.startedAt)) / 1000;

  const kayit =
    artifact.recordingUrl ||
    msg.recordingUrl ||
    (artifact.recording && artifact.recording.mono && artifact.recording.mono.combinedUrl) ||
    (artifact.recording && artifact.recording.stereoUrl) ||
    '';

  const endedReason = msg.endedReason || call.endedReason || '';
  const anlamliKonusma = kullanici.filter((t) => !OPERATOR_ANONS_RE.test(t));
  const ulasildi = !ULASILAMADI_NEDEN_RE.test(endedReason) && anlamliKonusma.length > 0;
  const hatHatasi = HAT_HATASI_RE.test(endedReason) && !anlamliKonusma.length && !(Number(msg.durationSeconds) > 0);

  return {
    tip: msg.type || '',
    callId: call.id || '',
    cagriTipi: call.type || '',
    leadId: String(vv.lead_id || (call.metadata && call.metadata.leadId) || '').replace(/\D/g, ''),
    telefon: telefonNormalize((call.customer && call.customer.number) || (msg.customer && msg.customer.number)),
    arananNumara: (msg.phoneNumber && msg.phoneNumber.number) || (call.phoneNumber && call.phoneNumber.number) || '',
    toolCalls,
    endedReason,
    sure: Math.round(sure || 0),
    maliyet: Number(msg.cost) || 0,
    ozet: (typeof yapi.ozet === 'string' && yapi.ozet.trim()) || (msg.analysis && msg.analysis.summary) || msg.summary || '',
    yapi,
    kayit,
    transkript,
    ulasildi,
    hatHatasi,
    telefonVaryantlari: telefonVaryantlari(telefonNormalize((call.customer && call.customer.number) || (msg.customer && msg.customer.number))),
  };
}

function pencereMetni(p) {
  const kisa = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const g = [...p.GUNLER].sort((a, b) => a - b);
  let gunler;
  if (g.length === 7) gunler = 'her gün';
  else if (g.every((x, i) => i === 0 || x === g[i - 1] + 1)) gunler = `${kisa[g[0]]}-${kisa[g[g.length - 1]]}`;
  else gunler = g.map((x) => kisa[x]).join(', ');
  return `${gunler} ${p.BASLA}-${p.BITIS}`;
}

// randevu_olustur: asistan gün/saat SORMAZ. Müşteri kendiliğinden geçerli bir gün ve saat söylediyse o kullanılır;
// yoksa randevu SAATSİZ açılır, satış temsilcisi müşteriyi arayıp saati belirler → { tarih: Date|null }
function randevuKontrol(arg, A, simdi) {
  const tarih = trTarihSaatCoz(arg.randevu_tarihi, arg.randevu_saati);
  if (!tarih) return { tarih: null };
  const gecerli =
    tarih.getTime() >= simdi.getTime() + 30 * 60000 &&
    tarih.getTime() <= simdi.getTime() + Number(A.RANDEVU_MAX_GUN) * 86400000 &&
    pencereIcinde(tarih, A.RANDEVU_SAATLERI);
  return { tarih: gecerli ? tarih : null };
}

// "AHMET YILMAZ" → "Ahmet Yılmaz" (TTS'in harf harf okumaması için)
function isimDuzelt(s) {
  return String(s || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .split(/\s+/)
    .filter(Boolean)
    .map((k) => k.charAt(0).toLocaleUpperCase('tr-TR') + k.slice(1))
    .join(' ');
}

// Vapi asistanını ID'si ya da adıyla bulur (büyük/küçük harf, tire ve boşluk farkı önemsiz)
function asistanBul(liste, deger) {
  const d = String(deger || '').trim();
  if (!d) return null;
  const norm = (s) => String(s || '').toLocaleLowerCase('tr-TR').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
  const l = (Array.isArray(liste) ? liste : []).filter((a) => a && a.id);
  return l.find((a) => a.id === d) || l.find((a) => norm(a.name) === norm(d)) || (/^[0-9a-f-]{36}$/i.test(d) ? { id: d, name: d } : null);
}

function adSoyadBol(s) {
  const p = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return { NAME: p[0] || '', LAST_NAME: '' };
  return { NAME: p.slice(0, -1).join(' '), LAST_NAME: p[p.length - 1] };
}

function sureMetni(sn) {
  sn = Math.round(Number(sn) || 0);
  return sn >= 60 ? `${Math.floor(sn / 60)} dk ${sn % 60} sn` : `${sn} sn`;
}

// Erccell CORPORATESMS XML gövdesi
function smsXml({ kullanici, sifre, baslik, mesaj, numaralar }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<CORPORATESMS>
    <HEADER>
        <USERNAME>${esc(kullanici)}</USERNAME>
        <PASSWORD>${esc(sifre)}</PASSWORD>
        <SMSHEADER><![CDATA[${baslik}]]></SMSHEADER>
        <SMSTYPE>UC</SMSTYPE>
        <SENDTYPE>1:N</SENDTYPE>
    </HEADER>
    <SMS>
        <SMS_MESSAGE><![CDATA[${mesaj}]]></SMS_MESSAGE>
        <NUMBERS>${numaralar}</NUMBERS>
    </SMS>
</CORPORATESMS>`;
}

// E.164 (+905XXXXXXXXX) → Erccell'in kabul ettiği 905XXXXXXXXX biçimi
function smsNumarasi(e164) {
  return String(e164 || '').replace(/\D/g, '');
}

// Olay Merkezi / rapor için düz nesne (undefined alanlar silinir)
function temizle(o) {
  const c = { ...o };
  for (const k of Object.keys(c)) if (c[k] === undefined || c[k] === null) delete c[k];
  return c;
}
// =================== /ORTAK YARDIMCILAR ===================
