// ===================== ORTAK YARDIMCILAR =====================
// build.mjs bu bloğu Code node'larının başına ekler.
// Değişiklik yapacaksanız efas-ntepe/n8n/src/lib.js dosyasını düzenleyip build alın.

const TR_OFFSET_MS = 3 * 60 * 60 * 1000; // Türkiye: UTC+3, yaz saati uygulaması yok
const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Date -> İstanbul yerel saat parçaları
function trParcalar(date) {
  const d = new Date(date.getTime() + TR_OFFSET_MS);
  return {
    yil: d.getUTCFullYear(),
    ay: d.getUTCMonth() + 1,
    gun: d.getUTCDate(),
    saat: d.getUTCHours(),
    dakika: d.getUTCMinutes(),
    haftaGunu: d.getUTCDay(), // 0=Pazar
  };
}

// Bitrix'e yazılacak format: 2026-10-08T14:00:00+03:00
function trIso(date) {
  const p = trParcalar(date);
  return `${p.yil}-${pad2(p.ay)}-${pad2(p.gun)}T${pad2(p.saat)}:${pad2(p.dakika)}:00+03:00`;
}

// İstanbul tarihine göre gün: 2026-10-08
function trGun(date) {
  const p = trParcalar(date);
  return `${p.yil}-${pad2(p.ay)}-${pad2(p.gun)}`;
}

// İnsan okuyacak format: 08.10.2026 Perşembe 14:00
function trMetin(date) {
  const p = trParcalar(date);
  return `${pad2(p.gun)}.${pad2(p.ay)}.${p.yil} ${GUN_ADLARI[p.haftaGunu]} ${pad2(p.saat)}:${pad2(p.dakika)}`;
}

// 'YYYY-MM-DD' + 'HH:MM' (İstanbul saati) -> Date, geçersizse null
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

// pencere: { GUNLER: [1..7] (1=Pazartesi, 7=Pazar), BASLA: 'HH:MM', BITIS: 'HH:MM' }
function pencereIcinde(date, pencere) {
  const p = trParcalar(date);
  const gun = p.haftaGunu === 0 ? 7 : p.haftaGunu;
  if (!pencere.GUNLER.includes(gun)) return false;
  const dk = p.saat * 60 + p.dakika;
  return dk >= saatDakikaya(pencere.BASLA) && dk < saatDakikaya(pencere.BITIS);
}

// Tarih pencere dışındaysa bir sonraki pencere başlangıcına taşır
function pencereyeTasi(date, pencere) {
  if (pencereIcinde(date, pencere)) return date;
  const basla = saatDakikaya(pencere.BASLA);
  const p = trParcalar(date);
  // İstanbul gece yarısı (UTC karşılığı)
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
  if (s.length === 10 && /^[2-58]/.test(s)) s = '90' + s; // 5321234567
  else if (s.length === 11 && s.startsWith('0')) s = '9' + s; // 05321234567
  if (/^90[2-58]\d{9}$/.test(s)) return '+' + s;
  if (yabanci && !s.startsWith('90') && /^[1-9]\d{7,14}$/.test(s)) return '+' + s; // yurt dışı
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

// Lead'in PHONE alanından ilk geçerli numara
function leadTelefonu(lead) {
  const liste = Array.isArray(lead && lead.PHONE) ? lead.PHONE : [];
  for (const p of liste) {
    const n = telefonNormalize(p && p.VALUE);
    if (n) return n;
  }
  return null;
}

// Lead'in EMAIL alanından ilk geçerli adres
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
      const deger = v === null ? '' : v === true ? 'Y' : v === false ? 'N' : String(v);
      parcalar.push(`${encodeURIComponent(anahtar)}=${encodeURIComponent(deger)}`);
    }
  }
  return parcalar.join('&');
}

function bitrixKomut(metod, parametreler) {
  return `${metod}?${qs(parametreler)}`;
}

// batch yanıtındaki hata nesnesi ({} veya { komutAdi: {...} })
function batchHatalari(yanit) {
  const e = yanit && yanit.result && yanit.result.result_error;
  return e && typeof e === 'object' && !Array.isArray(e) ? e : {};
}

function batchSonuclari(yanit) {
  const r = yanit && yanit.result && yanit.result.result;
  return r && typeof r === 'object' ? r : {};
}

function metinHash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Satış ekibine SIRAYLA dağıtım (round-robin). Sıra workflow'un statik verisinde tutulur;
// yalnızca yayındaki (aktif) workflow çalışmalarında kalıcıdır. Liste boşsa varsayılan sorumlu döner.
function siradakiSorumlu(A, varsayilan) {
  const liste = (Array.isArray(A.SATIS_SORUMLU_IDLERI) ? A.SATIS_SORUMLU_IDLERI : []).map(String).filter(Boolean);
  if (!liste.length) return String(varsayilan || A.VARSAYILAN_SORUMLU_ID || '');
  let sd = null;
  try {
    sd = $getWorkflowStaticData('global');
  } catch (e) {}
  const i = sd ? Number(sd.satisSirasi) || 0 : 0;
  if (sd) sd.satisSirasi = (i + 1) % liste.length;
  return liste[i % liste.length];
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

  // Konuşma kayıtları: kullanıcının söyledikleri
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

  // Yapılandırılmış veri: analysisPlan (structuredData) veya Structured Outputs
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

  return {
    tip: msg.type || '',
    callId: call.id || '',
    cagriTipi: call.type || '',
    leadId: String(vv.lead_id || (call.metadata && call.metadata.leadId) || '').replace(/\D/g, ''),
    deneme: Number(vv.deneme) || 0,
    telefon: telefonNormalize((call.customer && call.customer.number) || (msg.customer && msg.customer.number)),
    arananNumara: (msg.phoneNumber && msg.phoneNumber.number) || (call.phoneNumber && call.phoneNumber.number) || '',
    toolCalls,
    endedReason,
    sure: Math.round(sure || 0),
    maliyet: Number(msg.cost) || 0,
    // Türkçe özet tercih edilir: Structured Output'taki "ozet" alanı, yoksa Vapi özeti
    ozet: (typeof yapi.ozet === 'string' && yapi.ozet.trim()) || (msg.analysis && msg.analysis.summary) || msg.summary || '',
    yapi,
    kayit,
    transkript,
    ulasildi,
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

// "_TA" işareti: müşteri bir kez "sonra arayın" dediyse ek arama hakkı kalıcı olur
function tekrarAraIsaretli(sonuc) {
  return sonuc === 'TEKRAR_ARA' || /_TA$/.test(String(sonuc || ''));
}
function aramaLimiti(A, sonuc) {
  return Number(A.MAX_DENEME) + (tekrarAraIsaretli(sonuc) ? Number(A.TEKRAR_ARA_EK_HAK) : 0);
}

// randevu_olustur: asistan gün/saat SORMAZ. Müşteri kendiliğinden geçerli bir gün ve saat söylediyse o kullanılır;
// yoksa (ya da saat geçersizse) randevu SAATSİZ açılır, satış temsilcisi müşteriyi arayıp saati belirler → { tarih: Date|null }
function randevuKontrol(arg, A, simdi) {
  const tarih = trTarihSaatCoz(arg.randevu_tarihi, arg.randevu_saati);
  if (!tarih) return { tarih: null };
  const gecerli =
    tarih.getTime() >= simdi.getTime() + 30 * 60000 &&
    tarih.getTime() <= simdi.getTime() + Number(A.RANDEVU_MAX_GUN) * 86400000 &&
    pencereIcinde(tarih, A.RANDEVU_SAATLERI);
  return { tarih: gecerli ? tarih : null };
}

const ETIKET = {
  ofis_ziyareti: 'Satış ofisi ziyareti',
  proje_gezisi: 'Proje alanı gezisi',
  online_gorusme: 'Online görüşme',
  ilgilenmiyor: 'İlgilenmiyor',
  butce_uygun_degil: 'Bütçe uygun değil',
  konum_uygun_degil: 'Konum uygun değil',
  baska_yerden_aldi: 'Başka yerden aldı',
  yanlis_numara: 'Yanlış numara / kişi',
  aranmak_istemiyor: 'Aranmak istemiyor (bir daha aranmayacak)',
  diger: 'Diğer',
};
function etiket(k) {
  return ETIKET[k] || k || '-';
}

// Randevu için Bitrix komutları. Mevcut lead için leadId, yeni lead için yeniLead (crm.lead.add alanları) verilir.
function randevuKomutlari({ A, leadId, yeniLead, tarih, arg, callId, sorumlu, yon, onEk, telefon, teyitGerekli }) {
  const F = A.ALAN;
  const cmd = {};
  const ad = kisalt(arg.ad_soyad, 80);
  // tarih yoksa: SAATSİZ randevu talebi → temsilci 15 dk içinde arayıp gün/saati belirler
  const gorevZamani = tarih || pencereyeTasi(dakikaEkle(new Date(), 15), A.ARAMA_SAATLERI);
  const durum = !tarih ? 'randevu oluşturuldu (GÜN/SAAT BELİRLENMEDİ)' : teyitGerekli ? 'randevu konuşuldu (SAAT TEYİT EDİLMELİ)' : 'randevu oluşturuldu';
  const detay = [
    `${A.PROJE_ADI} — yapay zeka ${yon} görüşmesinde ${durum}.`,
    tarih ? `Randevu: ${trMetin(tarih)}` : 'Randevu: gün ve saat belirlenmedi — müşteriyi arayıp birlikte belirleyin.',
    arg.tercih_edilen_zaman ? `Müşterinin tercih ettiği zaman: ${kisalt(arg.tercih_edilen_zaman, 200)}` : '',
    `Tür: ${etiket(arg.randevu_tipi || 'ofis_ziyareti')}`,
    ad ? `Müşteri: ${ad}` : '',
    telefon ? `Telefon: ${telefon}` : '',
    arg.ilgilendigi_daire ? `İlgilendiği daire: ${arg.ilgilendigi_daire}` : '',
    arg.odeme_tercihi ? `Ödeme tercihi: ${arg.odeme_tercihi}` : '',
    arg.not ? `Not: ${kisalt(arg.not, 500)}` : '',
    tarih ? 'Randevudan önce müşteriyi arayıp konum bilgisini paylaşın.' : '',
    callId ? `Vapi Call ID: ${callId}` : '',
  ].filter(Boolean);

  const alanlar = {
    STATUS_ID: A.STATU.RANDEVU,
    [F.RANDEVU]: tarih ? trIso(tarih) : '',
    [F.SONUC]: !tarih ? 'RANDEVU_TALEP' : teyitGerekli ? 'RANDEVU_TEYIT' : 'RANDEVU',
    [F.CAGRI]: callId || undefined,
    [F.DENEME]: 0,
    [F.SONRAKI]: '',
  };
  if (sorumlu) alanlar.ASSIGNED_BY_ID = sorumlu;

  let ref;
  let anaKomut;
  if (yeniLead) {
    anaKomut = `${onEk}yeni`;
    cmd[anaKomut] = bitrixKomut('crm.lead.add', { fields: { ...yeniLead, ...alanlar }, params: { REGISTER_SONET_EVENT: 'Y' } });
    ref = `$result[${anaKomut}]`; // batch içinde yeni lead ID'sine referans
  } else {
    anaKomut = `${onEk}upd`;
    cmd[anaKomut] = bitrixKomut('crm.lead.update', { id: leadId, fields: alanlar });
    ref = String(leadId);
  }

  cmd[`${onEk}todo`] = bitrixKomut('crm.activity.todo.add', {
    ownerTypeId: 1,
    ownerId: ref,
    deadline: trIso(gorevZamani),
    title: kisalt(`${A.PROJE_ADI} ${!tarih ? 'randevu — GÜN/SAAT BELİRLEYİN' : teyitGerekli ? 'randevu TEYİDİ' : 'randevu'} — ${ad || telefon || ''}`, 250),
    description: detay.join('\n'),
    responsibleId: sorumlu || undefined,
    pingOffsets: tarih ? [1440, 60] : [0],
  });
  cmd[`${onEk}not`] = bitrixKomut('crm.timeline.comment.add', {
    fields: { ENTITY_ID: ref, ENTITY_TYPE: 'lead', COMMENT: `📅 ${detay.join('\n')}` },
  });
  return { cmd, anaKomut, ref };
}

// "Bilgi istiyor" → lead satış statüsüne geçer, satış temsilcisine atanır ve hemen arama görevi açılır
function bilgiKomutlari({ A, leadId, sorumlu, yon, telefon, ad, ozet, callId, onEk }) {
  const F = A.ALAN;
  const t = pencereyeTasi(dakikaEkle(new Date(), 15), A.ARAMA_SAATLERI);
  const alanlar = { STATUS_ID: A.STATU.BILGI, [F.SONUC]: 'BILGI_ISTIYOR', [F.DENEME]: 0, [F.SONRAKI]: '', [F.CAGRI]: callId || undefined };
  if (sorumlu) alanlar.ASSIGNED_BY_ID = sorumlu;
  return {
    [`${onEk}upd`]: bitrixKomut('crm.lead.update', { id: leadId, fields: alanlar }),
    [`${onEk}todo`]: bitrixKomut('crm.activity.todo.add', {
      ownerTypeId: 1,
      ownerId: leadId,
      deadline: trIso(t),
      title: kisalt(`${A.PROJE_ADI} — BİLGİ İSTİYOR, müşteriyi arayın (${ad || telefon || ''})`, 250),
      description: [
        `Müşteri yapay zeka ${yon} görüşmesinde proje hakkında bilgi istedi. Satış temsilcisi olarak müşteriyi arayıp bilgi verin ve randevu teklif edin.`,
        ad ? `Müşteri: ${ad}` : '',
        telefon ? `Telefon: ${telefon}` : '',
        ozet ? `Özet: ${kisalt(ozet, 1000)}` : '',
        callId ? `Vapi Call ID: ${callId}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      responsibleId: sorumlu || undefined,
    }),
  };
}

// "belirsiz" gibi boş anlamlı değerleri ayıklayıp birleştirir
function bilgiSatiri(...degerler) {
  return degerler.filter((v) => v && !/^(belirsiz|bilinmiyor|-)$/i.test(String(v).trim())).join(' · ');
}

// Vapi asistanını ID'si ya da adıyla bulur (büyük/küçük harf, tire ve boşluk farkı önemsiz)
function asistanBul(liste, deger) {
  const d = String(deger || '').trim();
  if (!d) return null;
  const norm = (s) => String(s || '').toLocaleLowerCase('tr-TR').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
  const l = (Array.isArray(liste) ? liste : []).filter((a) => a && a.id);
  return l.find((a) => a.id === d) || l.find((a) => norm(a.name) === norm(d)) || (/^[0-9a-f-]{36}$/i.test(d) ? { id: d, name: d } : null);
}

// Ad soyadı Bitrix NAME / LAST_NAME'e böl
function adSoyadBol(s) {
  const p = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return { NAME: p[0] || '', LAST_NAME: '' };
  return { NAME: p.slice(0, -1).join(' '), LAST_NAME: p[p.length - 1] };
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

// Telefonla bulunan lead'lerden bu projeye ait en yenisini seçer
function efasLeadSec(liste, A) {
  const F = A.ALAN;
  const dolu = (v) => v !== undefined && v !== null && v !== '' && v !== false;
  const efas = (Array.isArray(liste) ? liste : []).filter(
    (l) => l && ([A.STATU.YAPAY_ZEKA, A.STATU.OLUMSUZ].includes(l.STATUS_ID) || dolu(l[F.SONUC]) || dolu(l[F.CAGRI]) || dolu(l[F.RANDEVU]))
  );
  efas.sort((a, b) => Number(b.ID) - Number(a.ID));
  return efas[0] || null;
}

function sureMetni(sn) {
  sn = Math.round(Number(sn) || 0);
  return sn >= 60 ? `${Math.floor(sn / 60)} dk ${sn % 60} sn` : `${sn} sn`;
}

// Olay Merkezi'ne (04) gönderilecek olay. tur: arama | arama_hatasi | cagri_sonu | randevu | olumsuz | geri_arama
// mesaj: müşteriye gidecek SMS/WhatsApp türü (randevu | tanitim | bilgi), yoksa boş
function olay(tur, alanlar) {
  const o = { tur, zaman: new Date().toISOString(), ...alanlar };
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

// Randevu olayının tarih alanları (saatsiz randevuda "talep")
function randevuOlayi(tarih) {
  return tarih
    ? { randevu: trIso(tarih), tarih: trMetin(tarih), mesaj: 'randevu' }
    : { talep: true, tarih: 'gün/saat belirlenmedi — satış temsilcisi arayacak', mesaj: 'randevu_talep' };
}

// randevu_olustur aracının asistana dönen cevabı
function randevuYaniti(tarih) {
  return tarih
    ? `Randevu kaydedildi: ${trMetin(tarih)}. Müşteriye "Randevunuz oluşturuldu" de; satış temsilcimizin randevudan önce arayıp konum bilgisini paylaşacağını söyle, teşekkür et ve görüşmeyi kapat.`
    : 'Randevu kaydedildi. Müşteriye "Randevunuz oluşturuldu, satış temsilcimiz sizi arayıp gün ve saati birlikte belirleyecek." de, teşekkür et ve görüşmeyi kapat. Gün veya saat SORMA.';
}

// Çağrı raporu yorumu
function raporYorumu({ A, m, yon, baslik, ekSatirlar }) {
  const y = m.yapi || {};
  return [
    `🤖 ${A.PROJE_ADI} yapay zeka ${yon} görüşmesi — ${baslik}`,
    ...(ekSatirlar || []),
    `Süre: ${sureMetni(m.sure)} | Bitiş: ${m.endedReason || '-'}`,
    m.ozet ? `Özet: ${kisalt(m.ozet, 1500)}` : '',
    y.ilgilendigi_daire || y.odeme_tercihi || y.amac
      ? `İlgilendiği daire: ${y.ilgilendigi_daire || '-'} | Ödeme: ${y.odeme_tercihi || '-'} | Amaç: ${y.amac || '-'}`
      : '',
    y.not || y.talep_notu ? `Not: ${kisalt(y.not || y.talep_notu, 500)}` : '',
    m.kayit ? `Ses kaydı: ${m.kayit}` : '',
    m.callId ? `Vapi Call ID: ${m.callId}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
// =================== /ORTAK YARDIMCILAR ===================
