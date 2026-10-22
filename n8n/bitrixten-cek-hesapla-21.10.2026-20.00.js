// =========================================================
// XRE GÜNLÜK ARAMA • RANDEVU • SATIŞ • ETKİNLİK RAPORU (v2)
// Her gün 20:00 — Kerem grubu (Telegram) + e-posta
//
// Kaynaklar (hepsi Bitrix REST, salt okunur):
//   voximplant.statistic.get   bugünkü aramalar
//   crm.stagehistory.list      bugün randevu / katılım / satış aşamasına giren lead ve anlaşmalar
//   crm.activity.list          bugün tamamlanan, bugün vadeli etkinlikler; lead'lerin açık etkinlikleri (kart sütunları)
//   crm.lead.list / deal.list  aşamaya giren kaydın sorumlusu
//   user.get                   personelin aktif/pasif durumu
//   voximplant.line.get        hat adları (hat kontrolü)
//
// Rapor yalnızca aşağıdaki güncel personel listesini kapsar.
// =========================================================

const WEBHOOK = 'https://xre.bitrix24.com.tr/rest/1/ewnx2pb69gv3cdqj/';

// =========================================================
// AYARLAR
// =========================================================

// false = gelen + giden tüm aramalar
// true  = sadece giden aramalar
const SADECE_GIDEN = false;

// Geçerli görüşme için minimum süre
const BASARILI_ESIK = 20;

// Lead aşamaları (Bitrix > CRM > Lead aşamaları)
const LEAD_ASAMA = {
  randevu: ['UC_WK3LVR', 'UC_Z3VV8S', 'UC_ML92HM'], // RANDEVU OLUŞTURANLAR, OFİS RANDEVUSU, YAPAY ZEKA RANDEVU OLUŞTURANLAR
  katildi: ['UC_UB8IU8'],                           // RANDEVUYA KATILIM OLDU
  katilmadi: ['UC_OHQ6DS'],                         // RANDEVUYA KATILIM OLMADI
  satis: ['UC_I8G5YP']                              // SATIŞ
};

// Anlaşma (deal) aşamaları her pipeline'da farklıdır; adına göre sınıflanır.
//   Randevu: adında "RANDEVU" geçen aşamalar ("KATILIM" ve "DÜZENLENECEK" hariç)
//   Satış:   başarılı kapanış (WON) aşamaları + aşağıdaki adlar
const ANLASMA_SATIS_ADLARI = ['SATIS', 'ANLASMA YAPILAN', 'ANLASMA SAGLANDI', 'POLICE ONAYLANDI'];

// Kendiliğinden oluşup kapanan etkinlikler "tamamlanan etkinlik" sayısına katılmaz
// (aramalar zaten arama satırında sayılıyor).
const OTOMATIK_ETKINLIK = ['VOXIMPLANT_CALL', 'CRM_WEBFORM', 'IMOPENLINES_SESSION'];

// Müşteri adayı kartları (Bitrix > Müşteri adayları > Etkinlikler ekranı ile aynı mantık):
// her lead TEK kart sayılır ve en yakın son tarihli açık etkinliğine göre tek sütuna girer.
// Son tarihi olmayan açık etkinliği (cevapsız arama, gelen e-posta, okunmamış sohbet) olan lead
// ekrandaki gibi "Son tarihi bugün" sütununa girer.
// true  = yalnızca işlemdeki (dönüştürülmemiş / başarısız olmamış) lead'ler — ekranın varsayılanı
// false = tüm lead'ler
const KART_SADECE_ACIK_LEAD = true;

// =========================================================
// PERSONELLER
// =========================================================

const personeller = {
  "23180": { isim: "Abdullah Açıkgöz",    dep: "XRE ARSA" },

  "17984": { isim: "Ali Karaoğlu",        dep: "XRE PROJE SATIŞ" },
  "22186": { isim: "Ali Kemal Çınar",     dep: "XRE PROJE SATIŞ" },
  "26120": { isim: "Sefa Tuna Şencan",    dep: "XRE PROJE SATIŞ" },
  "26352": { isim: "Emre Caner",          dep: "XRE PROJE SATIŞ" },
  "1174":  { isim: "Arda Kağan Ertaş",    dep: "XRE PROJE SATIŞ" },
  "116":   { isim: "Merve Gelleci",       dep: "XRE PROJE SATIŞ" },
  "25258": { isim: "Murat Çakıroğlu",     dep: "XRE PROJE SATIŞ" },
  "30070": { isim: "Burak Gülşen",     dep: "XRE PROJE SATIŞ" },
  "5778":  { isim: "Tuğba Kütük",         dep: "XRE PROJE SATIŞ" },
  "11690": { isim: "Zeliha Bilginsoy",    dep: "XRE PROJE SATIŞ" },

  "25314": { isim: "Hatice Aldemir",      dep: "XRE BARTER" },
  "25120": { isim: "Ozan Kabagöz",        dep: "XRE BARTER" },
  "27876": { isim: "Yiğitcan Dilek",      dep: "XRE BARTER" },
  "27878": { isim: "Aleyna Özdemir",      dep: "XRE BARTER" },

  "27446": { isim: "Beril Sarıyıldız",    dep: "XRE PARTNERS" },

  "27332": { isim: "Rüstem Sarıoğlan",    dep: "XRE FRANCHİSE" },

  "29484": { isim: "Enes Can Yıldırım",   dep: "XRE AUTO" },
  "78": { isim: "KAAN İNCE",   dep: "XRE MEMNUNİYET ARAMA" },
  
 "12482": { isim: "KEREM BERK ERGİNBAŞ",   dep: "XRE MEMNUNİYET ARAMA" },

  "22182": { isim: "Zarife Ayoğlu",       dep: "XRE RECRUITING" },
  "29240": { isim: "Ayça İnal",           dep: "XRE RECRUITING" },
  "30342": { isim: "Ceren Delice",        dep: "XRE RECRUITING" }
};

// =========================================================
// PERSONEL HAT NUMARALARI (hat kontrolü)
//
// Arama, başka bir personelin hattından yapıldıysa raporun sonunda gösterilir.
// Bitrix hat adları (voximplant.line.get, ör. "NetGSM 111 - 7616", "104-5337435988")
// numaranın sonuyla eşleştirilir. Listede olmayan hatlar kontrol edilmez.
// =========================================================

const HAT_KONTROLU = true;

const personelHat = {
  "23180": "+905337435601",
  "22186": "+905337437550",
  "25120": "+905337437589",
  "27878": "+905337435692",
  "26120": "+905337436858",
  "25258": "+905337436867",
  "27876": "+905337437096",
  "26352": "+905337437147",
  "27446": "+905337435970",
  "27332": "+905337437124",
  "22182": "+905422478514",
  "5778":  "+905337435988",
  "1174":  "+905337435976",
  "116":   "+905337437109",
  "25314": "+905337437616",
  "17984": "+905337437434",
  "11690": "+905337437435",
  "29484": "+905337435680"
};

// =========================================================
// DEPARTMAN SIRASI
// =========================================================

const depSira = [
  "XRE PROJE SATIŞ",
  "XRE SİGORTA",
  "XRE ELEKTRİK",
  "XRE BARTER",
  "XRE ARSA",
  "XRE PARTNERS",
  "XRE FRANCHİSE",
  "XRE AUTO",
  "XRE MEMNUNİYET ARAMA",
  "XRE RECRUITING"
];

const depEmoji = {
  "XRE PROJE SATIŞ": "🏢",
  "XRE SİGORTA": "🛡️",
  "XRE ELEKTRİK": "⚡",
  "XRE BARTER": "🔄",
  "XRE ARSA": "🌍",
  "XRE PARTNERS": "🤝",
  "XRE FRANCHİSE": "🏪",
  "XRE AUTO": "🚗",
  "XRE MEMNUNİYET ARAMA": "☎️",
  "XRE RECRUITING": "🧲"
};

// =========================================================
// TARİH
// Bugün 00:00 -> workflow'un çalıştığı an
// =========================================================

// Geçmiş bir günün raporunu yeniden göndermek için 'YYYY-MM-DD' yazın (ör. '2026-10-15').
// Boş bırakılırsa: bugün 00:00 -> şu an. Gönderdikten sonra tekrar boş bırakın.
const RAPOR_GUNU = '2026-10-21';
// RAPOR_GUNU ile birlikte kullanılır: o günün hangi saatine kadar sayılsın ('20:00'). Boş = gün sonu.
const RAPOR_SAATI = '20:00';

const simdi = $now.setZone('Europe/Istanbul');

const bas = RAPOR_GUNU ? DateTime.fromISO(RAPOR_GUNU, { zone: 'Europe/Istanbul' }).startOf('day') : simdi.startOf('day');
const bit = !RAPOR_GUNU ? simdi
  : RAPOR_SAATI ? DateTime.fromISO(RAPOR_GUNU + 'T' + RAPOR_SAATI, { zone: 'Europe/Istanbul' })
  : bas.endOf('day').set({ millisecond: 0 });
const yarin = bas.plus({ days: 1 });

const hedefStr = bas.toFormat('dd.MM.yyyy');
const saatStr = bit.toFormat('HH:mm');

const f = d => d.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
const basStr = f(bas);
const bitStr = f(bit);
const yarinStr = f(yarin);

const PERSONEL_IDLER = Object.keys(personeller);

// =========================================================
// BITRIX YARDIMCILARI
// =========================================================

const helpers = this.helpers;
const uyarilar = [];

const bekle = ms => (typeof setTimeout === 'function'
  ? new Promise(r => setTimeout(r, ms))
  : Promise.resolve());

async function bx(method, body) {
  let sonHata;
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      const resp = await helpers.httpRequest({
        method: 'POST',
        url: WEBHOOK + method + '.json',
        body: body || {},
        json: true,
        timeout: 60000
      });
      if (resp && resp.error) {
        throw new Error(method + ': ' + (resp.error_description || resp.error));
      }
      return resp;
    } catch (e) {
      sonHata = e;
      const metin = String(e.message || e);
      const gecici = /QUERY_LIMIT_EXCEEDED|OPERATION_TIME_LIMIT|429|50[234]|ECONNRESET|ETIMEDOUT|timeout/i.test(metin);
      if (!gecici || deneme === 3) break;
      await bekle(1500 * deneme);
    }
  }
  throw sonHata;
}

// PHP tarzı sorgu metni: filter[@ID][]=1&filter[@ID][]=2 ...
function qs(obj, prefix) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (Array.isArray(v)) {
      v.forEach(x => out.push(encodeURIComponent(key + '[]') + '=' + encodeURIComponent(x)));
    } else if (v && typeof v === 'object') {
      out.push(qs(v, key));
    } else {
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
    }
  }
  return out.filter(Boolean).join('&');
}

const satirlar = res => {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.items)) return res.items;
  return [];
};

// Tüm sayfaları çeker: ilk sayfa normal istek, kalan sayfalar 50'şerli batch ile.
async function hepsiniCek(method, params) {
  const ilk = await bx(method, { ...params, start: 0 });
  let rows = satirlar(ilk.result);
  const toplam = Number(ilk.total || 0);

  if (ilk.next !== undefined && ilk.next !== null && toplam > rows.length) {
    const baslangiclar = [];
    for (let s = Number(ilk.next); s < toplam; s += 50) baslangiclar.push(s);

    for (let i = 0; i < baslangiclar.length; i += 50) {
      const cmd = {};
      baslangiclar.slice(i, i + 50).forEach(s => {
        cmd['p' + s] = method + '?' + qs({ ...params, start: s });
      });
      const b = await bx('batch', { halt: 0, cmd });
      const sonuc = b.result?.result || {};
      const hata = b.result?.result_error || {};
      for (const k of Object.keys(cmd)) {
        if (hata[k]) throw new Error(method + ' sayfa ' + k + ': ' + JSON.stringify(hata[k]).slice(0, 200));
        rows = rows.concat(satirlar(sonuc[k]));
      }
    }
  }

  // Sayfalar arasında kayma olursa aynı kayıt iki kez gelebilir.
  const gorulen = new Set();
  return rows.filter(r => {
    const id = String(r.ID ?? r.CALL_ID ?? '');
    if (!id) return true;
    if (gorulen.has(id)) return false;
    gorulen.add(id);
    return true;
  });
}

// Bir bölüm hata verirse rapor yine gönderilir; bölüm "?" ile gösterilir.
const bolumHata = {};
async function bolum(ad, fn) {
  try {
    return await fn();
  } catch (e) {
    bolumHata[ad] = String(e.message || e).slice(0, 300);
    uyarilar.push(ad + ' alınamadı: ' + bolumHata[ad]);
    return null;
  }
}

function normAd(s) {
  return String(s || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/Ç/g, 'C').replace(/Ğ/g, 'G').replace(/İ/g, 'I').replace(/I/g, 'I')
    .replace(/Ö/g, 'O').replace(/Ş/g, 'S').replace(/Ü/g, 'U')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

// =========================================================
// SÜRE / SAYI FORMATLAMA
// =========================================================

function sureMetni(toplamSaniye) {

  toplamSaniye = Number(toplamSaniye) || 0;

  const hh = Math.floor(toplamSaniye / 3600);

  const mm = Math.floor(
    (toplamSaniye % 3600) / 60
  );

  const ss = toplamSaniye % 60;

  let sonuc = '';

  if (hh > 0) {
    sonuc += hh + ' saat ';
  }

  if (mm > 0) {
    sonuc += mm + ' dk ';
  }

  sonuc += ss + ' sn';

  return sonuc.trim();
}

const sayi = n => (n === null || n === undefined) ? '?' : Number(n).toLocaleString('tr-TR');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// =========================================================
// TÜM TANIMLI PERSONELLERİ ÖNCEDEN 0 İLE OLUŞTUR
//
// Böylece bugün hiç arama yapmayan personel de raporda görünür.
// =========================================================

function bosKayit(uid, isim, dep, listede) {
  return {
    uid, isim, dep, listede,
    pasif: false,

    adet: 0, basarili: 0, cevapsiz: 0, sure: 0, gelen: 0, giden: 0,

    randevu: new Set(), katildi: new Set(), katilmadi: new Set(), satis: new Set(), bekleyen: 0,

    tamamlanan: 0,
    vadeli: 0, vadeliTamam: 0,
    kartGeciken: 0, kartBugun: 0, kartBuHafta: 0, kartGelecekHafta: 0, kartSonra: 0,
    kartBos: null
  };
}

const stats = {};

for (const [uid, p] of Object.entries(personeller)) {
  stats[uid] = bosKayit(uid, p.isim, p.dep, true);
}

// Rapor yalnızca güncel personeli kapsar; listede olmayan kullanıcıların kayıtları sayılmaz.
const kisi = uid => stats[String(uid)] || null;

// =========================================================
// 1) ARAMALAR (voximplant)
// =========================================================

const tum = await bolum('Aramalar', () => hepsiniCek('voximplant.statistic.get', {
  FILTER: {
    '>=CALL_START_DATE': basStr,
    '<=CALL_START_DATE': bitStr
  },
  SORT: 'ID',
  ORDER: 'ASC'
})) || [];

// Hat kimliği (PORTAL_NUMBER, ör. "reg66966", "sip36") -> hattın sahibi olan personel
const hatSahibi = {};
const baskaHat = {}; // arayan uid -> { hat sahibi uid -> adet }

if (HAT_KONTROLU) {
  await bolum('Hat listesi', async () => {
    const r = await bx('voximplant.line.get', {});
    const numaralar = Object.entries(personelHat).map(([uid, tel]) => [uid, String(tel).replace(/\D/g, '')]);
    for (const [hatId, ad] of Object.entries(r.result || {})) {
      // Hat adındaki son rakam grubu (en az 4 hane) personel numarasının sonuyla eşleşmeli
      const gruplar = String(ad || '').match(/\d{4,}/g) || [];
      const son = gruplar[gruplar.length - 1];
      if (!son) continue;
      const eslesen = numaralar.filter(([, tel]) => tel.endsWith(son));
      if (eslesen.length === 1) hatSahibi[hatId] = eslesen[0][0];
    }
  });
}

tum.forEach(c => {

  const callType = String(c.CALL_TYPE || '');

  // Bitrix: 1 = giden, 2 = gelen, 3 = yönlendirilen gelen, 4 = geri arama
  const gidenMi = callType === '1' || callType === '4';
  const gelenMi = callType === '2' || callType === '3';

  if (SADECE_GIDEN && !gidenMi) {
    return;
  }

  const uid = String(c.PORTAL_USER_ID || '').trim();

  if (!uid) {
    return;
  }

  const s = kisi(uid);

  if (!s) {
    return;
  }

  const dur = parseInt(c.CALL_DURATION, 10) || 0;
  const kod = String(c.CALL_FAILED_CODE || '').trim();

  s.adet++;
  s.sure += dur;

  // Yalnızca giden arama: gelen aramayı başka birinin cevaplaması hat kullanımı sayılmaz.
  const sahip = gidenMi ? hatSahibi[String(c.PORTAL_NUMBER || '')] : null;
  if (sahip && sahip !== uid && personeller[sahip]) {
    if (!baskaHat[uid]) baskaHat[uid] = {};
    baskaHat[uid][sahip] = (baskaHat[uid][sahip] || 0) + 1;
  }

  if (gidenMi) s.giden++;
  if (gelenMi) s.gelen++;

  // Başarılı görüşme: sonuç 200 VE süre >= 20 sn
  if (kod === '200' && dur >= BASARILI_ESIK) {
    s.basarili++;
  }

  // Cevapsız / ulaşılamadı: sonucu 200 olmayan her arama.
  // Giden aramada karşı taraf açmazsa Bitrix 603 / 603-S / 503 / 500 / 486 döndürür;
  // 304 yalnızca kaçırılan GELEN aramadır.
  if (kod !== '200') {
    s.cevapsiz++;
  }
});

// =========================================================
// 2) RANDEVU / KATILIM / SATIŞ (aşama geçmişi)
// =========================================================

const asamaSonuc = await bolum('Randevu/satış', async () => {

  // Anlaşma aşamalarını adlarına göre sınıfla
  const durumlar = await hepsiniCek('crm.status.list', { order: { SORT: 'ASC' } });
  const anlasmaSinif = {};
  const asamaAdi = {};

  for (const st of durumlar) {
    const ent = String(st.ENTITY_ID || '');
    if (!ent.startsWith('DEAL_STAGE')) continue;
    const id = String(st.STATUS_ID);
    const ad = normAd(st.NAME);
    const sem = String(st.SEMANTICS || '');
    asamaAdi[id] = st.NAME;
    if (sem === 'F') continue;
    if (ad.includes('KATILIM') && /OLMADI|GELMEDI|GERCEKLESMEDI/.test(ad)) anlasmaSinif[id] = 'katilmadi';
    else if (ad.includes('KATILIM') && /OLDU|GELDI|GERCEKLESTI/.test(ad)) anlasmaSinif[id] = 'katildi';
    else if (ad.includes('RANDEVU') && !ad.includes('KATILIM') && !ad.includes('DUZENLENECEK')) anlasmaSinif[id] = 'randevu';
    else if (sem === 'S' || ANLASMA_SATIS_ADLARI.includes(ad)) anlasmaSinif[id] = 'satis';
  }

  const leadSinif = {};
  for (const [tur, idler] of Object.entries(LEAD_ASAMA)) idler.forEach(id => { leadSinif[id] = tur; });

  const leadGecmis = await hepsiniCek('crm.stagehistory.list', {
    entityTypeId: 1,
    order: { ID: 'ASC' },
    filter: { '>=CREATED_TIME': basStr, '<=CREATED_TIME': bitStr, '@STATUS_ID': Object.keys(leadSinif) },
    select: ['ID', 'OWNER_ID', 'STATUS_ID', 'CREATED_TIME']
  });

  const anlasmaIdler = Object.keys(anlasmaSinif);
  const anlasmaGecmis = anlasmaIdler.length ? await hepsiniCek('crm.stagehistory.list', {
    entityTypeId: 2,
    order: { ID: 'ASC' },
    filter: { '>=CREATED_TIME': basStr, '<=CREATED_TIME': bitStr, '@STAGE_ID': anlasmaIdler },
    select: ['ID', 'OWNER_ID', 'STAGE_ID', 'CATEGORY_ID', 'CREATED_TIME']
  }) : [];

  const hareketler = [
    ...leadGecmis.map(h => ({ tip: 'L', id: String(h.OWNER_ID), tur: leadSinif[String(h.STATUS_ID)] })),
    ...anlasmaGecmis.map(h => ({ tip: 'D', id: String(h.OWNER_ID), tur: anlasmaSinif[String(h.STAGE_ID)] }))
  ].filter(h => h.tur && h.id && h.id !== '0');

  // Kaydın sorumlusu (ASSIGNED_BY_ID)
  const sorumlu = {};
  for (const [tip, method] of [['L', 'crm.lead.list'], ['D', 'crm.deal.list']]) {
    const idler = [...new Set(hareketler.filter(h => h.tip === tip).map(h => h.id))];
    for (let i = 0; i < idler.length; i += 50) {
      const kayitlar = await hepsiniCek(method, {
        filter: { '@ID': idler.slice(i, i + 50) },
        select: ['ID', 'ASSIGNED_BY_ID']
      });
      kayitlar.forEach(k => { sorumlu[tip + ':' + k.ID] = String(k.ASSIGNED_BY_ID || ''); });
    }
  }

  let sahipsiz = 0;
  for (const h of hareketler) {
    const uid = sorumlu[h.tip + ':' + h.id];
    if (!uid) { sahipsiz++; continue; }
    const s = kisi(uid);
    if (s) s[h.tur].add(h.tip + ':' + h.id);
  }
  if (sahipsiz) uyarilar.push(sahipsiz + ' aşama hareketinin kaydı okunamadı (silinmiş olabilir).');

  // Bekleyen randevu: ŞU AN randevu aşamasında duran (katılımı henüz işlenmemiş) lead ve anlaşmalar.
  // Tarihe bağlı değildir; önceki günlerde verilmiş randevular da dahildir.
  await bolum('Bekleyen randevu', async () => {
    const bLead = await hepsiniCek('crm.lead.list', {
      filter: { '@STATUS_ID': LEAD_ASAMA.randevu, '@ASSIGNED_BY_ID': PERSONEL_IDLER },
      select: ['ID', 'ASSIGNED_BY_ID']
    });
    const randevuAsamalari = Object.keys(anlasmaSinif).filter(id => anlasmaSinif[id] === 'randevu');
    const bDeal = randevuAsamalari.length ? await hepsiniCek('crm.deal.list', {
      filter: { '@STAGE_ID': randevuAsamalari, '@ASSIGNED_BY_ID': PERSONEL_IDLER, CLOSED: 'N' },
      select: ['ID', 'ASSIGNED_BY_ID']
    }) : [];
    for (const k of [...bLead, ...bDeal]) {
      const s = kisi(k.ASSIGNED_BY_ID);
      if (s) s.bekleyen++;
    }
  });

  return { lead: leadGecmis.length, anlasma: anlasmaGecmis.length };
});

// =========================================================
// 3) ETKİNLİKLER
// =========================================================

// 3a) Bugün tamamlanan (gerçekleştirilen) etkinlikler
const tamamlananlar = await bolum('Tamamlanan etkinlikler', () => hepsiniCek('crm.activity.list', {
  order: { ID: 'ASC' },
  filter: { '@RESPONSIBLE_ID': PERSONEL_IDLER, COMPLETED: 'Y', '>=LAST_UPDATED': basStr, '<=LAST_UPDATED': bitStr },
  select: ['ID', 'RESPONSIBLE_ID', 'PROVIDER_ID']
}));

if (tamamlananlar) {
  for (const a of tamamlananlar) {
    if (OTOMATIK_ETKINLIK.includes(String(a.PROVIDER_ID || '').toUpperCase())) continue;
    const s = kisi(a.RESPONSIBLE_ID);
    if (s) s.tamamlanan++;
  }
}

// 3b) Son tarihi bugün olan etkinlikler
const vadeliler = await bolum('Bugün vadeli etkinlikler', () => hepsiniCek('crm.activity.list', {
  order: { ID: 'ASC' },
  filter: { '@RESPONSIBLE_ID': PERSONEL_IDLER, '>=DEADLINE': basStr, '<DEADLINE': yarinStr },
  select: ['ID', 'RESPONSIBLE_ID', 'PROVIDER_ID', 'COMPLETED']
}));

if (vadeliler) {
  for (const a of vadeliler) {
    if (OTOMATIK_ETKINLIK.includes(String(a.PROVIDER_ID || '').toUpperCase())) continue;
    const s = kisi(a.RESPONSIBLE_ID);
    if (!s) continue;
    s.vadeli++;
    if (String(a.COMPLETED).toUpperCase() === 'Y') s.vadeliTamam++;
  }
}

// 3c) Müşteri adayı kartları — kart başına (lead'in sorumlusuna göre), içindeki etkinlik sayısı değil.
// Bitrix "Müşteri adayları > Etkinlikler" ekranındaki sütunlar:
//   Son tarihi olmayan açık etkinliği varsa  -> Son tarihi bugün
//   yoksa en yakın son tarihe göre           -> Geciken (bugünden önce) / Son tarihi bugün (saati geçmiş olsa da) / Bu hafta / Gelecek hafta / İki haftadan sonra
//   hiç açık etkinliği yoksa                 -> Boş
// Ekran o anki durumu gösterdiği için kartlar da raporun çalıştığı anki durumdur (RAPOR_GUNU'dan bağımsız).

// Büyük listeleri ID imleciyle çeker: bir batch içinde 50 sayfa birbirine zincirlenir (sayfa başına 50 kayıt).
async function zincirCek(method, params) {
  const sablon = method + '?' + qs({ ...params, order: { ID: 'ASC' }, filter: { ...params.filter, '>ID': '__SON_ID__' }, start: -1 });
  let sonId = 0;
  let rows = [];
  for (;;) {
    const cmd = {};
    for (let i = 0; i < 50; i++) {
      cmd['c' + i] = sablon.replace('__SON_ID__', i === 0 ? String(sonId) : '$result[c' + (i - 1) + '][49][ID]');
    }
    const b = await bx('batch', { halt: 0, cmd });
    const sonuc = b.result?.result || {};
    const hata = b.result?.result_error || {};
    if (hata.c0) throw new Error(method + ': ' + JSON.stringify(hata.c0).slice(0, 200));
    let bitti = false;
    for (let i = 0; i < 50; i++) {
      const sayfa = satirlar(sonuc['c' + i]);
      rows = rows.concat(sayfa);
      if (sayfa.length < 50) { bitti = true; break; }
    }
    if (bitti || !rows.length) break;
    sonId = rows[rows.length - 1].ID;
  }
  return rows;
}

await bolum('Müşteri adayı kartları', async () => {
  const leadDurum = KART_SADECE_ACIK_LEAD ? { STATUS_SEMANTIC_ID: 'P' } : {};

  // Lead'lere bağlı tüm açık etkinlikler (etkinliğin sorumlusu kim olursa olsun; ekran lead'in sorumlusuna bakar)
  const acikLeadEtkinlik = await zincirCek('crm.activity.list', {
    filter: { OWNER_TYPE_ID: 1, COMPLETED: 'N' },
    select: ['ID', 'OWNER_ID', 'DEADLINE']
  });

  // Lead başına: son tarihsiz etkinlik var mı, en yakın son tarih ne
  // (Bitrix son tarihsiz etkinliği 9999-12-31 olarak döndürür)
  const lead = {};
  for (const a of acikLeadEtkinlik) {
    const id = String(a.OWNER_ID || '');
    if (!id || id === '0') continue;
    const l = lead[id] || (lead[id] = { tarihsiz: false, enYakin: Infinity });
    const d = DateTime.fromISO(String(a.DEADLINE || ''), { zone: 'Europe/Istanbul' });
    if (!d.isValid || d.year >= 9999) l.tarihsiz = true;
    else l.enYakin = Math.min(l.enYakin, d.toMillis());
  }

  // Bu lead'lerin sorumlusu (50'şerli ID listesi, 50 sorgu bir batch'te)
  const leadIdler = Object.keys(lead);
  const sorumlu = {};
  const parcalar = [];
  for (let i = 0; i < leadIdler.length; i += 50) parcalar.push(leadIdler.slice(i, i + 50));
  for (let i = 0; i < parcalar.length; i += 50) {
    const cmd = {};
    parcalar.slice(i, i + 50).forEach((p, j) => {
      cmd['l' + (i + j)] = 'crm.lead.list?' + qs({
        filter: { '@ID': p, '@ASSIGNED_BY_ID': PERSONEL_IDLER, ...leadDurum },
        select: ['ID', 'ASSIGNED_BY_ID']
      });
    });
    const b = await bx('batch', { halt: 0, cmd });
    const sonuc = b.result?.result || {};
    const hata = b.result?.result_error || {};
    for (const k of Object.keys(cmd)) {
      if (hata[k]) throw new Error('crm.lead.list ' + k + ': ' + JSON.stringify(hata[k]).slice(0, 200));
      satirlar(sonuc[k]).forEach(l => { sorumlu[String(l.ID)] = String(l.ASSIGNED_BY_ID || ''); });
    }
  }

  // Sütun sınırları (hafta pazartesi başlar). Bitrix, saati geçmiş olsa da bugün vadeli etkinliği
  // gün bitene kadar "Son tarihi bugün" sütununda tutar; Geciken = son tarihi bugünden önce.
  const bugunBasi = simdi.startOf('day').toMillis();
  const bugunSonu = simdi.endOf('day').toMillis();
  const haftaSonu = simdi.endOf('week').toMillis();
  const gelecekHaftaSonu = simdi.plus({ weeks: 1 }).endOf('week').toMillis();

  for (const [id, l] of Object.entries(lead)) {
    const s = kisi(sorumlu[id]);
    if (!s) continue;
    const ms = l.enYakin;
    if (l.tarihsiz) s.kartBugun++;
    else if (ms < bugunBasi) s.kartGeciken++;
    else if (ms <= bugunSonu) s.kartBugun++;
    else if (ms <= haftaSonu) s.kartBuHafta++;
    else if (ms <= gelecekHaftaSonu) s.kartGelecekHafta++;
    else s.kartSonra++;
  }

  // Boş = sorumlunun toplam lead sayısı - açık etkinliği olan lead sayısı
  const cmd = {};
  PERSONEL_IDLER.forEach(uid => {
    cmd['u' + uid] = 'crm.lead.list?' + qs({ filter: { ASSIGNED_BY_ID: uid, ...leadDurum }, select: ['ID'] });
  });
  const b = await bx('batch', { halt: 0, cmd });
  const toplamlar = b.result?.result_total || {};
  PERSONEL_IDLER.forEach(uid => {
    const t = toplamlar['u' + uid];
    const s = stats[uid];
    if (t === undefined || t === null) return;
    const dolu = s.kartGeciken + s.kartBugun + s.kartBuHafta + s.kartGelecekHafta + s.kartSonra;
    s.kartBos = Math.max(0, Number(t) - dolu);
  });
});

// =========================================================
// 4) KULLANICI DURUMU (Bitrix'te pasife alınan personel)
// =========================================================

await bolum('Kullanıcılar', async () => {
  const r = await bx('user.get', { FILTER: { '@ID': PERSONEL_IDLER } });
  for (const u of (r.result || [])) {
    const s = stats[String(u.ID)];
    if (s && (u.ACTIVE === false || u.ACTIVE === 'N')) s.pasif = true;
  }
});

// =========================================================
// KAYITLAR
// =========================================================

const sayac = s => ({
  randevu: s.randevu.size,
  katildi: s.katildi.size,
  katilmadi: s.katilmadi.size,
  satis: s.satis.size
});

const kayitlar = Object.values(stats).map(s => ({ ...s, ...sayac(s) }));

const hepsiSifir = p =>
  !(p.adet || p.randevu || p.katildi || p.katilmadi || p.satis || p.tamamlanan || p.vadeli || p.kartGeciken);

// Pasif ve bugün hiçbir verisi olmayan personel listelenmez (sona not düşülür).
const gizlenenPasif = kayitlar.filter(p => p.pasif && hepsiSifir(p)).map(p => p.isim);

const gruplar = {};

kayitlar
  .filter(p => !(p.pasif && hepsiSifir(p)))
  .forEach(p => {
    if (!gruplar[p.dep]) gruplar[p.dep] = [];
    gruplar[p.dep].push(p);
  });

const ALANLAR = ['adet', 'basarili', 'cevapsiz', 'sure', 'gelen', 'giden', 'randevu', 'katildi', 'katilmadi', 'satis', 'bekleyen',
  'tamamlanan', 'vadeli', 'vadeliTamam', 'kartGeciken', 'kartBugun', 'kartBuHafta', 'kartGelecekHafta', 'kartSonra', 'kartBos'];

const topla = liste => Object.fromEntries(ALANLAR.map(k => [k, liste.reduce((t, p) => t + (Number(p[k]) || 0), 0)]));

// Bölüm alınamadıysa 0 yerine "?" göster
const H = {
  arama: Boolean(bolumHata['Aramalar']),
  asama: Boolean(bolumHata['Randevu/satış']),
  bekleyen: Boolean(bolumHata['Randevu/satış'] || bolumHata['Bekleyen randevu']),
  tamam: Boolean(bolumHata['Tamamlanan etkinlikler']),
  vade: Boolean(bolumHata['Bugün vadeli etkinlikler']),
  kart: Boolean(bolumHata['Müşteri adayı kartları'])
};
const v = (hataVar, n) => hataVar ? '?' : sayi(n);

// =========================================================
// TELEGRAM (HTML) + EMAIL
// =========================================================

function aramaSatiri(t) {
  return '📞 ' + v(H.arama, t.adet) + ' arama · ' + v(H.arama, t.basarili) + ' görüşme (' + BASARILI_ESIK + 'sn+) · ' +
    v(H.arama, t.cevapsiz) + ' cevapsız · ' + (H.arama ? '?' : sureMetni(t.sure));
}

function randevuSatiri(t) {
  return '📅 Randevu ' + v(H.asama, t.randevu) + ' · ✅ Katıldı ' + v(H.asama, t.katildi) +
    ' · ❌ Katılmadı ' + v(H.asama, t.katilmadi) + ' · 💰 Satış ' + v(H.asama, t.satis) +
    '\n⏳ Bekleyen randevu ' + v(H.bekleyen, t.bekleyen) + ' (katılımı henüz işlenmemiş)';
}

function etkinlikSatiri(t) {
  return '📋 Tamamlanan etkinlik ' + v(H.tamam, t.tamamlanan) +
    ' · Bugün vadeli ' + v(H.vade, t.vadeli) + ' (tamamlanan ' + v(H.vade, t.vadeliTamam) + ')';
}

function gecikenSatiri(t) {
  return '🗂 Müşteri adayı kartı' + (RAPOR_GUNU ? ' (şu anki durum)' : '') + ': ⏰ Geciken ' + v(H.kart, t.kartGeciken) +
    ' · Son tarihi bugün ' + v(H.kart, t.kartBugun) +
    ' · Bu hafta ' + v(H.kart, t.kartBuHafta) +
    ' · Gelecek hafta ' + v(H.kart, t.kartGelecekHafta) +
    ' · İki haftadan sonra ' + v(H.kart, t.kartSonra) +
    ' · Boş ' + (t.kartBos === null || t.kartBos === undefined ? '?' : v(H.kart, t.kartBos));
}

const tgBloklar = [];

tgBloklar.push(
  '📊 <b>GÜNLÜK ARAMA • RANDEVU • ETKİNLİK RAPORU</b>\n' +
  '<i>' + esc(hedefStr) + ' · ' + esc(saatStr) + ' itibarıyla</i>'
);

let html = `
<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;max-width:1100px;">
<h2 style="margin-bottom:4px;">📊 Günlük Arama • Randevu • Etkinlik Raporu — ${esc(hedefStr)}</h2>
<p style="margin-top:0;color:#6b7280;">${esc(saatStr)} itibarıyla Bitrix verisi.</p>
`;

const th = t => `<th style="padding:6px 8px;border:1px solid #d1d5db;background:#1f3864;color:#fff;font-size:12px;">${esc(t)}</th>`;
const td = (x, stil = '') => `<td style="padding:5px 8px;border:1px solid #e5e7eb;text-align:center;font-size:12px;${stil}">${esc(x)}</td>`;
const BASLIK = ['Personel', 'Arama', 'Görüşme ' + BASARILI_ESIK + 'sn+', 'Cevapsız', 'Süre', 'Randevu', 'Katıldı', 'Katılmadı', 'Satış', 'Bekleyen randevu',
  'Tamamlanan etkinlik', 'Bugün vadeli', 'Vadeli tamamlanan',
  'Kart: Geciken', 'Kart: Son tarihi bugün', 'Kart: Bu hafta', 'Kart: Gelecek hafta', 'Kart: İki haftadan sonra', 'Kart: Boş'];

function tabloSatiri(p, kalin) {
  const stil = kalin ? 'font-weight:bold;background:#fff4ce;' : '';
  return '<tr>' +
    `<td style="padding:5px 8px;border:1px solid #e5e7eb;font-size:12px;${kalin ? 'font-weight:bold;background:#fff4ce;' : 'font-weight:bold;'}">${esc(p.isim)}</td>` +
    td(v(H.arama, p.adet), stil) + td(v(H.arama, p.basarili), stil) + td(v(H.arama, p.cevapsiz), stil) + td(H.arama ? '?' : sureMetni(p.sure), stil) +
    td(v(H.asama, p.randevu), stil + (p.randevu ? 'color:#1d4ed8;font-weight:bold;' : '')) +
    td(v(H.asama, p.katildi), stil + (p.katildi ? 'color:#047857;font-weight:bold;' : '')) +
    td(v(H.asama, p.katilmadi), stil) +
    td(v(H.asama, p.satis), stil + (p.satis ? 'color:#047857;font-weight:bold;' : '')) +
    td(v(H.bekleyen, p.bekleyen), stil) +
    td(v(H.tamam, p.tamamlanan), stil) + td(v(H.vade, p.vadeli), stil) + td(v(H.vade, p.vadeliTamam), stil) +
    td(v(H.kart, p.kartGeciken), stil + (p.kartGeciken ? 'color:#b91c1c;font-weight:bold;' : '')) +
    td(v(H.kart, p.kartBugun), stil) + td(v(H.kart, p.kartBuHafta), stil) + td(v(H.kart, p.kartGelecekHafta), stil) +
    td(v(H.kart, p.kartSonra), stil) +
    td(p.kartBos === null || p.kartBos === undefined ? '-' : v(H.kart, p.kartBos), stil) +
    '</tr>';
}

const depToplamlari = [];

depSira.concat(Object.keys(gruplar).filter(d => !depSira.includes(d))).forEach(dep => {

  if (!gruplar[dep]) {
    return;
  }

  // Arama sayısına göre büyükten küçüğe
  const liste = gruplar[dep].sort(
    (a, b) => b.adet - a.adet || b.kartGeciken - a.kartGeciken || a.isim.localeCompare(b.isim, 'tr')
  );

  const t = topla(liste);
  depToplamlari.push(t);

  const emoji = depEmoji[dep] || '📁';

  // TELEGRAM — departman özeti (tek kişilik departmanda kişi satırı yeterli)
  let blok = '━━━━━━━━━━━━\n' + emoji + ' <b>' + esc(dep) + '</b>';
  if (liste.length > 1) {
    blok += '\n' + aramaSatiri(t) + '\n' +
      '↗️ ' + sayi(t.giden) + ' giden · ↙️ ' + sayi(t.gelen) + ' gelen\n' +
      randevuSatiri(t);
    blok += '\n' + etkinlikSatiri(t) + '\n' + gecikenSatiri(t);
  }
  tgBloklar.push(blok);

  // TELEGRAM — personeller
  liste.forEach(p => {
    let k = '👤 <b>' + esc(p.isim) + '</b>' + (p.pasif ? ' (pasif)' : '') + '\n' +
      aramaSatiri(p) + '\n' + randevuSatiri(p);
    k += '\n' + etkinlikSatiri(p) + '\n' + gecikenSatiri(p);
    tgBloklar.push(k);
  });

  // EMAIL
  html += `<h3 style="margin:22px 0 6px;">${emoji} ${esc(dep)}</h3>`;
  html += '<table style="border-collapse:collapse;width:100%;"><thead><tr>' + BASLIK.map(th).join('') + '</tr></thead><tbody>';
  liste.forEach(p => { html += tabloSatiri({ ...p, isim: p.isim + (p.pasif ? ' (pasif)' : '') }, false); });
  html += tabloSatiri({ ...t, isim: 'TOPLAM' }, true);
  html += '</tbody></table>';
});

// =========================================================
// GENEL ÖZET
// =========================================================

const g = topla(depToplamlari);

const enCokGeciken = kayitlar
  .filter(p => p.listede && p.kartGeciken > 0)
  .sort((a, b) => b.kartGeciken - a.kartGeciken)
  .slice(0, 5);

let genel = '━━━━━━━━━━━━\n📈 <b>GENEL</b>\n' +
  aramaSatiri(g) + '\n' +
  '↗️ ' + sayi(g.giden) + ' giden · ↙️ ' + sayi(g.gelen) + ' gelen\n' +
  randevuSatiri(g) + '\n' +
  etkinlikSatiri(g) + '\n' +
  gecikenSatiri(g);

if (enCokGeciken.length && !H.kart) {
  genel += '\n\n⏰ <b>En çok geciken müşteri adayı kartı</b>\n' +
    enCokGeciken.map((p, i) => (i + 1) + '. ' + esc(p.isim) + ': ' + sayi(p.kartGeciken)).join('\n');
}

const hatSatirlari = Object.entries(baskaHat)
  .flatMap(([uid, sahipler]) => Object.entries(sahipler).map(([sahip, n]) => ({ uid, sahip, n })))
  .sort((a, b) => b.n - a.n)
  .map(x => personeller[x.uid].isim + ' → ' + personeller[x.sahip].isim + ' hattı: ' + sayi(x.n) + ' arama');

if (hatSatirlari.length) genel += '\n\n☎️ <b>Başka personelin hattından yapılan giden aramalar</b>\n' + esc(hatSatirlari.join('\n'));

if (gizlenenPasif.length) genel += '\n\nPasif (listelenmedi): ' + esc(gizlenenPasif.join(', '));

genel += '\n\nℹ️ Randevu / Katılım / Satış: BUGÜN o aşamaya giren lead ve anlaşma sayısı (kaydın sorumlusuna yazılır). Bugün verilen randevunun katılımı genelde ileri bir tarihte işlenir; bu yüzden Katıldı/Katılmadı, aynı günün Randevu sayısıyla toplanmaz.' +
  ' Bekleyen randevu: şu an randevu aşamasında duran, katılımı henüz işlenmemiş kayıtlar.' +
  ' Müşteri adayı kartı: Bitrix Müşteri adayları > Etkinlikler ekranındaki gibi her lead 1 kart sayılır (içindeki etkinlik sayısı değil), lead\'in sorumlusuna yazılır ve en yakın son tarihli açık etkinliğine göre tek sütuna girer (son tarihsiz etkinliği olan: Son tarihi bugün); Boş = açık etkinliği olmayan lead.' +
  ' Cevapsız: sonucu başarılı (200) olmayan aramalar.';

if (uyarilar.length) genel += '\n\n⚠️ ' + esc(uyarilar.join(' | '));

tgBloklar.push(genel);

// Telegram 4096 karakter sınırı: blokları bölmeden 3500 karakterlik parçalara topla.
// Departman başlığı, ilk personeliyle aynı parçada kalsın diye birleştirilir.
const birlesik = [];
for (const blok of tgBloklar) {
  const onceki = birlesik[birlesik.length - 1];
  if (onceki && onceki.startsWith('━━━━━━━━━━━━\n') && !onceki.includes('👤') && blok.startsWith('👤')) {
    birlesik[birlesik.length - 1] = onceki + '\n\n' + blok;
  } else {
    birlesik.push(blok);
  }
}

const telegramParcalar = [];
let parca = '';
for (const blok of birlesik) {
  const aday = parca ? parca + '\n\n' + blok : blok;
  if (aday.length > 3500 && parca) {
    telegramParcalar.push(parca);
    parca = blok;
  } else {
    parca = aday;
  }
}
if (parca) telegramParcalar.push(parca);

const telegramMesaj = tgBloklar.join('\n\n');

// EMAIL — genel
html += `
<hr style="margin-top:25px;border:none;border-top:1px solid #ddd;">
<h3>📈 GENEL</h3>
<table style="border-collapse:collapse;width:100%;"><thead><tr>${BASLIK.map(th).join('')}</tr></thead><tbody>
${tabloSatiri({ ...g, isim: 'TÜM EKİP' }, true)}
</tbody></table>
`;

if (enCokGeciken.length && !H.kart) {
  html += '<p><b>⏰ En çok geciken müşteri adayı kartı:</b> ' +
    enCokGeciken.map(p => esc(p.isim) + ' ' + sayi(p.kartGeciken)).join(' · ') + '</p>';
}
if (hatSatirlari.length) html += '<p><b>☎️ Başka personelin hattından yapılan giden aramalar:</b><br>' + hatSatirlari.map(esc).join('<br>') + '</p>';
if (gizlenenPasif.length) html += `<p style="color:#6b7280;">Pasif (listelenmedi): ${esc(gizlenenPasif.join(', '))}</p>`;
if (uyarilar.length) html += `<p style="background:#fde7e9;border:1px solid #d13438;padding:8px;border-radius:6px;">⚠️ ${esc(uyarilar.join(' | '))}</p>`;

html += `
<div style="font-size:12px;color:#6b7280;line-height:1.6;margin-top:16px;">
<p><b>Arama:</b> Bitrix telefoni kaydı. Görüşme = sonucu 200 ve süresi ${BASARILI_ESIK} sn ve üzeri. Cevapsız = sonucu 200 olmayan (açılmayan, reddedilen, iptal, meşgul, ulaşılamayan) aramalar.</p>
<p><b>Randevu:</b> bugün RANDEVU OLUŞTURANLAR / OFİS RANDEVUSU / YAPAY ZEKA RANDEVU OLUŞTURANLAR lead aşamasına veya anlaşma pipeline'larındaki randevu aşamalarına giren kayıt. <b>Katıldı / Katılmadı:</b> bugün RANDEVUYA KATILIM OLDU / OLMADI aşamasına giren lead. <b>Satış:</b> bugün SATIŞ lead aşamasına ya da anlaşmalarda başarılı kapanış / satış aşamasına giren kayıt. Aynı kayıt gün içinde birden fazla randevu aşamasından geçse de 1 sayılır; kaydın şu anki sorumlusuna yazılır.</p>
<p><b>Tamamlanan etkinlik:</b> bugün tamamlanmış görev, toplantı, e-posta vb. (arama kayıtları, web formu ve açık hat oturumları hariç; Bitrix tamamlama anını tutmadığı için "bugün güncellenmiş ve tamamlanmış" etkinlik sayılır). <b>Bugün vadeli:</b> son tarihi bugün olan etkinlikler.</p>
<p><b>Müşteri adayı kartı:</b> Bitrix "Müşteri adayları &gt; Etkinlikler" ekranı ile aynı mantık. Her lead 1 kart sayılır (içindeki etkinlik sayısı değil) ve lead'in sorumlusuna yazılır. Kart, en yakın son tarihli açık etkinliğine göre tek sütuna girer: Geciken (son tarihi bugünden önce), Son tarihi bugün (saati geçmiş olsa da), Bu hafta, Gelecek hafta, İki haftadan sonra. Son tarihi olmayan açık etkinliği (cevapsız arama, gelen e-posta, okunmamış sohbet) olan lead "Son tarihi bugün" sütununa girer. <b>Boş:</b> açık etkinliği olmayan lead. Raporun çalıştığı anki durumdur.</p>
<p>Bitrix API ham arama kaydı: ${tum.length}</p>
</div>
<p>İyi çalışmalar dileriz.</p>
</div>
`;

// =========================================================
// DEBUG
//
// Buradaki alanlar Telegram'a gitmez.
// n8n execution ekranından kontrol edilebilir.
// =========================================================

const debugKullanicilar = kayitlar
  .filter(p => !hepsiSifir(p))
  .sort((a, b) => b.adet - a.adet)
  .map(p => ({
    id: p.uid,
    isim: p.isim,
    departman: p.dep,
    pasif: p.pasif,
    arama: p.adet,
    gorusme20sn: p.basarili,
    cevapsiz: p.cevapsiz,
    gelen: p.gelen,
    giden: p.giden,
    toplamSureSn: p.sure,
    randevu: p.randevu,
    katildi: p.katildi,
    katilmadi: p.katilmadi,
    satis: p.satis,
    bekleyenRandevu: p.bekleyen,
    tamamlananEtkinlik: p.tamamlanan,
    bugunVadeli: p.vadeli,
    bugunVadeliTamamlanan: p.vadeliTamam,
    kartGeciken: p.kartGeciken,
    kartBugun: p.kartBugun,
    kartBuHafta: p.kartBuHafta,
    kartGelecekHafta: p.kartGelecekHafta,
    kartIkiHaftadanSonra: p.kartSonra,
    kartBos: p.kartBos
  }));

// =========================================================
// OUTPUT
// =========================================================

return [
  {
    json: {

      tarih: hedefStr,

      api_toplam_kayit: tum.length,

      toplam_arama: g.adet,
      toplam_gorusme_20sn: g.basarili,
      toplam_cevapsiz: g.cevapsiz,

      toplam_gelen: g.gelen,
      toplam_giden: g.giden,

      toplam_sure_sn: g.sure,

      toplam_randevu: g.randevu,
      toplam_randevu_katildi: g.katildi,
      toplam_randevu_katilmadi: g.katilmadi,
      toplam_satis: g.satis,
      toplam_bekleyen_randevu: g.bekleyen,

      toplam_tamamlanan_etkinlik: g.tamamlanan,
      toplam_bugun_vadeli: g.vadeli,
      toplam_geciken_kart: g.kartGeciken,
      toplam_bugun_kart: g.kartBugun,
      toplam_bos_kart: g.kartBos,

      asama_gecmisi: asamaSonuc,
      baska_hattan_arama: hatSatirlari,
      uyarilar,

      aktif_kullanicilar: debugKullanicilar,

      telegram_mesaj: telegramMesaj,
      telegram_parcalar: telegramParcalar,

      email_mesaj: html
    }
  }
];
