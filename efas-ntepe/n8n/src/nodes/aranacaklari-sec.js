// Kuyruktaki lead'lerden bu turda aranacakları seçer, boş hatlara dağıtır.
// Hakkı biten / numarası geçersiz lead'leri OLUMSUZ'a taşır.
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const simdi = new Date();

// 1) Bitrix: kuyruktaki lead'ler (sayfa sayfa gelen yanıtlar)
const leadler = $('Bitrix: Kuyruktaki Leadler')
  .all()
  .flatMap((i) => (Array.isArray(i.json.result) ? i.json.result : []));

// 1b) Telefonu bağlı kişide olan (tekrarlayan) lead'ler için kişi telefonları
const kisiTel = {};
for (const i of $('Bitrix: Kişi Telefonları').all()) {
  for (const k of Array.isArray(i.json.result) ? i.json.result : []) {
    kisiTel[String(k.ID)] = leadTelefonu(k);
  }
}
const telefonBul = (lead) => leadTelefonu(lead) || (lead.CONTACT_ID ? kisiTel[String(lead.CONTACT_ID)] : null) || null;

// 2) Vapi numaralarını ID'ye eşle
const numaraId = {};
for (const i of $('Vapi: Telefon Numaraları').all()) {
  const n = i.json;
  const e = n && n.id && telefonNormalize(n.number);
  if (e) numaraId[e] = n.id;
}

// 3) Şu an görüşmede olan hatlar (inbound dahil) → numara başına aktif çağrı sayısı
const aktif = {};
for (const i of $('Vapi: Aktif Çağrılar').all()) {
  const c = i.json;
  if (c && c.id && c.status && c.status !== 'ended') aktif[c.phoneNumberId] = (aktif[c.phoneNumberId] || 0) + 1;
}

// Boş arama yuvaları: her numaraya HAT_BASINA_ESZAMANLI kadar, sırayla dağıtılır
const hatlar = [];
const eksikNumaralar = [];
for (const ham of A.ARAYAN_NUMARALAR) {
  const e = telefonNormalize(ham);
  const id = numaraId[e];
  if (!id) eksikNumaralar.push(ham);
  else hatlar.push({ numara: e, id, bos: Math.max(0, (Number(A.HAT_BASINA_ESZAMANLI) || 1) - (aktif[id] || 0)) });
}
const yuvalar = [];
while (hatlar.some((h) => h.bos > 0)) {
  for (const h of hatlar) {
    if (h.bos > 0) {
      yuvalar.push({ numara: h.numara, id: h.id });
      h.bos--;
    }
  }
}
const kapasite = Math.min(yuvalar.length, Number(A.TUR_BASINA_MAX_ARAMA) || yuvalar.length);

// 4) Outbound asistanı (ad ya da ID ile)
const asistan = asistanBul(
  $('Vapi: Asistanlar').all().map((i) => i.json),
  A.VAPI_OUTBOUND_ASISTAN
);

const cmd = {};
const olaylar = [];
const adaylar = [];
let kapatilan = 0;

for (const lead of leadler) {
  const deneme = parseInt(lead[F.DENEME], 10) || 0;
  const sonraki = bitrixTarih(lead[F.SONRAKI]);
  if (sonraki && sonraki > simdi) continue; // bekliyor ya da şu an aranıyor (kilitli)

  const sonuc = String(lead[F.SONUC] || '');
  const limit = aramaLimiti(A, sonuc);
  const telefon = telefonBul(lead);
  // Kişi kaydı bu turda okunamadıysa (ilk 50 dışında) kapatma, sonraki turda bakılır
  if (!telefon && lead.CONTACT_ID && !(String(lead.CONTACT_ID) in kisiTel)) continue;

  if (!telefon || deneme >= limit) {
    if (kapatilan >= Number(A.OLUMSUZA_TASIMA_TUR_LIMITI)) continue;
    kapatilan++;
    const neden = telefon ? 'ULASILAMADI' : 'GECERSIZ_NUMARA';
    const aciklama = telefon
      ? `${deneme} aramada sonuç alınamadı (son durum: ${sonuc || '-'}).`
      : 'Lead\'de ve bağlı kişide geçerli bir telefon numarası yok.';
    cmd[`kapat_${lead.ID}`] = bitrixKomut('crm.lead.update', {
      id: lead.ID,
      fields: { STATUS_ID: A.STATU.OLUMSUZ, [F.SONUC]: neden, [F.DENEME]: 0, [F.SONRAKI]: '' },
    });
    cmd[`not_${lead.ID}`] = bitrixKomut('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: lead.ID,
        ENTITY_TYPE: 'lead',
        COMMENT: `🤖 ${A.PROJE_ADI} yapay zeka: ${aciklama} Lead OLUMSUZ statüsüne taşındı.`,
      },
    });
    olaylar.push(olay('olumsuz', { yon: 'outbound', leadId: String(lead.ID), telefon: telefon || '', sonuc: neden, detay: aciklama }));
    continue;
  }

  // Öncelik: 0 = müşterinin istediği geri arama, 1 = tekrar deneme, 2 = hiç aranmamış
  const oncelik = sonuc === 'TEKRAR_ARA' ? 0 : deneme > 0 ? 1 : 2;
  adaylar.push({ lead, deneme, limit, telefon, oncelik, zaman: sonraki ? sonraki.getTime() : 0 });
}

adaylar.sort((a, b) => a.oncelik - b.oncelik || a.zaman - b.zaman || Number(a.lead.ID) - Number(b.lead.ID));

if (adaylar.length && kapasite && !asistan) {
  throw new Error(`Vapi'de "${A.VAPI_OUTBOUND_ASISTAN}" adlı/ID'li asistan bulunamadı. AYARLAR > VAPI_OUTBOUND_ASISTAN değerini kontrol edin.`);
}

const aramalar = [];
const kullanilanTelefon = new Set();
for (const a of adaylar) {
  if (aramalar.length >= kapasite) break;
  if (kullanilanTelefon.has(a.telefon)) continue; // aynı numaralı iki lead aynı turda aranmasın
  kullanilanTelefon.add(a.telefon);

  const hat = yuvalar[aramalar.length];
  const id = String(a.lead.ID);
  const yeniDeneme = a.deneme + 1;
  const ad = isimDuzelt([a.lead.NAME, a.lead.LAST_NAME].filter(Boolean).join(' '));
  const oncekiSonuc = String(a.lead[F.SONUC] || '');

  // Kilit: arama bitene kadar (en geç KILIT_DK) bu lead tekrar seçilmez
  cmd[`kilit_${id}`] = bitrixKomut('crm.lead.update', {
    id,
    fields: {
      [F.DENEME]: yeniDeneme,
      [F.SONRAKI]: trIso(dakikaEkle(simdi, Number(A.KILIT_DK))),
      [F.SONUC]: tekrarAraIsaretli(oncekiSonuc) ? 'ARANIYOR_TA' : 'ARANIYOR',
    },
    params: { REGISTER_SONET_EVENT: 'N' },
  });

  aramalar.push({
    leadId: id,
    ad,
    telefon: a.telefon,
    hat: hat.numara,
    deneme: yeniDeneme,
    limit: a.limit,
    vapiBody: {
      assistantId: asistan.id,
      phoneNumberId: hat.id,
      customer: ad ? { number: a.telefon, name: kisalt(ad, 40) } : { number: a.telefon },
      name: kisalt(`EFAS #${id} ${yeniDeneme}/${a.limit}`, 40),
      assistantOverrides: {
        firstMessage: ad
          ? `Merhabalar, ben İksre Project'ten Selin. ${ad} ile mi görüşüyorum?`
          : "Merhabalar, ben İksre Project'ten Selin. Yeni Yaşamkent'teki EFAS N-Tepe projemizde üç milyon yüz elli bin liradan başlayan fiyatlarla bir artı bir daire sahibi olmak ister misiniz?",
        variableValues: { lead_id: id, musteri_adi: ad, deneme: String(yeniDeneme) },
      },
    },
  });
}

if (!Object.keys(cmd).length) return [];

return [
  {
    json: {
      cmd,
      aramalar,
      olaylar,
      ozet: {
        kuyruktakiLead: leadler.length,
        aranabilir: adaylar.length,
        bosYuva: yuvalar.length,
        baslatilacak: aramalar.length,
        olumsuzaTasinan: kapatilan,
        vapideBulunamayanNumaralar: eksikNumaralar,
      },
    },
  },
];
