// Kuyruktaki (ARANACAK) adaylardan bu turda aranacakları seçer, boş hatlara dağıtır.
// Hakkı biten / numarası geçersiz adayları AI_GORUSTU'ya taşır (tükendi, bir daha aranmaz).
const A = $('AYARLAR').first().json;
const F = A.ALAN;
const simdi = new Date();

const leadler = $('Bitrix: Kuyruktaki Leadler')
  .all()
  .flatMap((i) => (Array.isArray(i.json.result) ? i.json.result : []));

const numaraId = {};
for (const i of $('Vapi: Telefon Numaraları').all()) {
  const n = i.json;
  const e = n && n.id && telefonNormalize(n.number);
  if (e) numaraId[e] = n.id;
}

const aktif = {};
for (const i of $('Vapi: Aktif Çağrılar').all()) {
  const c = i.json;
  if (c && c.id && c.status && c.status !== 'ended') aktif[c.phoneNumberId] = (aktif[c.phoneNumberId] || 0) + 1;
}

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

const asistan = asistanBul(
  $('Vapi: Asistanlar').all().map((i) => i.json),
  A.VAPI_OUTBOUND_ASISTAN
);

const cmd = {};
const adaylar = [];
let kapatilan = 0;

for (const lead of leadler) {
  const deneme = parseInt(lead[F.DENEME], 10) || 0;
  const sonraki = bitrixTarih(lead[F.SONRAKI]);
  if (sonraki && sonraki > simdi) continue; // bekliyor ya da şu an aranıyor (kilitli)

  const telefon = leadTelefonu(lead);
  if (!telefon || deneme >= Number(A.MAX_DENEME)) {
    kapatilan++;
    const neden = telefon ? 'ULASILAMADI_TUKENDI' : 'GECERSIZ_NUMARA';
    cmd[`kapat_${lead.ID}`] = bitrixKomut('crm.lead.update', {
      id: lead.ID,
      fields: { STATUS_ID: A.STATU.AI_GORUSTU, [F.SONUC]: neden, [F.DENEME]: 0, [F.SONRAKI]: '' },
    });
    cmd[`not_${lead.ID}`] = bitrixKomut('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: lead.ID,
        ENTITY_TYPE: 'lead',
        COMMENT: telefon
          ? `🤖 ${A.PROJE_ADI}: ${deneme} aramada ulaşılamadı, deneme hakkı tükendi.`
          : `🤖 ${A.PROJE_ADI}: lead'de geçerli bir telefon numarası yok.`,
      },
    });
    continue;
  }
  adaylar.push({ lead, deneme, telefon, zaman: sonraki ? sonraki.getTime() : 0 });
}

adaylar.sort((a, b) => a.zaman - b.zaman || Number(a.lead.ID) - Number(b.lead.ID));

if (adaylar.length && kapasite && !asistan) {
  throw new Error(`Vapi'de "${A.VAPI_OUTBOUND_ASISTAN}" adlı/ID'li asistan bulunamadı. AYARLAR > VAPI_OUTBOUND_ASISTAN değerini kontrol edin.`);
}

const p = trParcalar(simdi);
const bugununTarihi = `${['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'][p.haftaGunu]}, ${String(p.gun).padStart(2, '0')}.${String(p.ay).padStart(2, '0')}.${p.yil}`;
const bugunIso = `${p.yil}-${String(p.ay).padStart(2, '0')}-${String(p.gun).padStart(2, '0')}`;
const suAnkiSaat = `${String(p.saat).padStart(2, '0')}:${String(p.dakika).padStart(2, '0')}`;

const aramalar = [];
const kullanilanTelefon = new Set();
for (const a of adaylar) {
  if (aramalar.length >= kapasite) break;
  if (kullanilanTelefon.has(a.telefon)) continue;
  kullanilanTelefon.add(a.telefon);

  const hat = yuvalar[aramalar.length];
  const id = String(a.lead.ID);
  const yeniDeneme = a.deneme + 1;
  const ad = isimDuzelt([a.lead.NAME, a.lead.LAST_NAME].filter(Boolean).join(' '));
  const eposta = leadEpostasi(a.lead);

  cmd[`kilit_${id}`] = bitrixKomut('crm.lead.update', {
    id,
    fields: { [F.DENEME]: yeniDeneme, [F.SONRAKI]: trIso(dakikaEkle(simdi, Number(A.KILIT_DK))), [F.SONUC]: 'ARANIYOR' },
    params: { REGISTER_SONET_EVENT: 'N' },
  });

  aramalar.push({
    leadId: id,
    ad,
    telefon: a.telefon,
    hat: hat.numara,
    deneme: yeniDeneme,
    vapiBody: {
      assistantId: asistan.id,
      phoneNumberId: hat.id,
      customer: ad ? { number: a.telefon, name: kisalt(ad, 40) } : { number: a.telefon },
      name: kisalt(`XRE Franchise #${id} ${yeniDeneme}/${A.MAX_DENEME}`, 40),
      assistantOverrides: {
        variableValues: {
          user_name: ad || '',
          isim: ad || '',
          start_mode: ad ? 'confirm_name' : 'ask_name',
          dynamic_greeting: ad
            ? `Merhabalar, ben iksre Gayrimenkul'den Selin. ${ad} ile mi görüşüyorum?`
            : "Merhabalar, ben iksre Gayrimenkul'den Selin. Kiminle görüşüyorum acaba?",
          bitrix_id: id,
          customer_phone: a.telefon,
          customer_email: eposta,
          bugunun_tarihi: bugununTarihi,
          bugun_iso: bugunIso,
          su_anki_saat: suAnkiSaat,
          arama_turu: 'Giden',
        },
      },
      metadata: { lead_id: id },
    },
  });
}

if (!Object.keys(cmd).length) return [];

return [
  {
    json: {
      cmd,
      aramalar,
      ozet: {
        kuyruktakiLead: leadler.length,
        aranabilir: adaylar.length,
        bosYuva: yuvalar.length,
        baslatilacak: aramalar.length,
        tukenenKapatilan: kapatilan,
        vapideBulunamayanNumaralar: eksikNumaralar,
      },
    },
  },
];
