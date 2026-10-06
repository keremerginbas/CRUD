// Uçtan uca test: gerçek n8n (test build'i) + mock-server.mjs
//   1) node mock-server.mjs
//   2) n8n'e test/.build/*.json içe aktarılmış ve yayınlanmış olmalı (bkz. test/README.md)
//   3) node e2e.mjs
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:8787';
const N8N = process.env.N8N_URL || 'http://127.0.0.1:5678';
const AI = 'UC_3W9EXO';
const OLUMSUZ = 'UC_PTDA4Y';
const RANDEVU = 'UC_ML92HM';
const F = { DENEME: 'UF_CRM_EFAS_AI_TRY', SONRAKI: 'UF_CRM_EFAS_AI_NEXT', SONUC: 'UF_CRM_EFAS_AI_RES', CAGRI: 'UF_CRM_EFAS_AI_CALL', RANDEVU: 'UF_CRM_EFAS_AI_APPT' };

let gecen = 0;
let kalan = 0;
function kontrol(ad, kosul, detay) {
  if (kosul) {
    gecen++;
    console.log(`  ✅ ${ad}`);
  } else {
    kalan++;
    console.log(`  ❌ ${ad}${detay !== undefined ? ` → ${JSON.stringify(detay)}` : ''}`);
  }
}
let r;
const post = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  let json = null;
  try {
    json = t ? JSON.parse(t) : null;
  } catch (e) {}
  return { status: r.status, json, text: t };
};
const durum = async () => (await fetch(`${MOCK}/__state`)).json();
const lead = async (id) => (await durum()).leads[String(id)];
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
async function bekleKadar(fn, sure = 8000) {
  const bas = Date.now();
  while (Date.now() - bas < sure) {
    const s = await durum();
    if (await fn(s)) return s;
    await bekle(250);
  }
  return durum();
}

// İstanbul saatine göre yarın
const TR = 3 * 3600 * 1000;
const yarin = new Date(Date.now() + TR + 86400000).toISOString().slice(0, 10);
const telefonLead = (no) => [{ VALUE: no, VALUE_TYPE: 'MOBILE' }];
const gecmis = new Date(Date.now() - 3600 * 1000).toISOString();
const gelecek = new Date(Date.now() + 3600 * 1000).toISOString();

const kuyruk = () => post(`${N8N}/webhook/test-efas-kuyruk`, {});
const outbound = (message) => post(`${N8N}/webhook/efas-ntepe-outbound`, { message });
const inbound = (message) => post(`${N8N}/webhook/efas-ntepe-inbound`, { message });
const outCall = (callId, leadId, numara) => ({
  id: callId,
  type: 'outboundPhoneCall',
  customer: { number: numara },
  assistantOverrides: { variableValues: { lead_id: String(leadId), deneme: '1' } },
});
const inCall = (callId, numara) => ({ id: callId, type: 'inboundPhoneCall', customer: { number: numara } });
const arac = (callObj, ad, args, id = `tc-${ad}`) => ({
  type: 'tool-calls',
  call: callObj,
  toolCallList: [{ id, type: 'function', function: { name: ad, arguments: args } }],
});
const rapor = (callObj, ek = {}) => ({
  type: 'end-of-call-report',
  call: callObj,
  durationSeconds: 75,
  endedReason: 'customer-ended-call',
  ...ek,
  artifact: { messages: [], recordingUrl: 'https://kayit.example/x.wav', ...(ek.artifact || {}) },
});
const konusma = (...satirlar) => satirlar.map((m, i) => ({ role: i % 2 ? 'user' : 'bot', message: m }));

const raporAl = async () => {
  const once = (await durum()).telegram.length;
  await post(`${N8N}/webhook/test-efas-rapor`, {});
  const st = await bekleKadar((x) => x.telegram.length > once);
  const metin = st.telegram.at(-1)?.text || '';
  const sayiAl = (re) => Number((re.exec(metin) || [])[1]?.replace(/\./g, '') || 0);
  return {
    metin,
    arama: sayiAl(/Arama: <b>([\d.]+)<\/b>/),
    hata: sayiAl(/başlatılamayan ([\d.]+)/),
    ulasilan: sayiAl(/Ulaşılan: ([\d.]+)/),
    ulasilamayan: sayiAl(/Ulaşılamayan: ([\d.]+)/),
    inbound: sayiAl(/inbound\): ([\d.]+)/),
    randevu: sayiAl(/Randevu: <b>([\d.]+)<\/b>/),
    olumsuz: sayiAl(/Olumsuz: ([\d.]+)/),
    sms: sayiAl(/SMS: ([\d.]+)/),
    whatsapp: sayiAl(/WhatsApp: ([\d.]+)/),
  };
};

console.log('\n=== 0) Kurulum ve kontrol (00) ===');
await post(`${MOCK}/__reset`, {});
r = await post(`${N8N}/webhook/test-efas-kurulum`, {});
const kurulum = r.json?.satirlar || [];
kontrol('kurulum raporu üretildi', kurulum.length > 10, r.text.slice(0, 300));
kontrol('kurulum raporunda hata yok', !kurulum.some((x) => x.startsWith('❌')), kurulum.filter((x) => !x.startsWith('✅')));
kontrol('5 Bitrix alanı oluşturuldu', kurulum.filter((x) => /Lead alanı .* oluşturuldu/.test(x)).length === 5);
kontrol('pn-3 inbound asistanı EFAS değil uyarısı', kurulum.some((x) => x.startsWith('⚠️') && x.includes('+908503465993')));
kontrol('olay tablosu ve olay webhook\'u hazır', kurulum.some((x) => x.includes('Olay tablosu hazır')) && kurulum.some((x) => x.includes('Olay ve Mesaj Merkezi yanıt veriyor')));
r = await post(`${N8N}/webhook/test-efas-kurulum`, {});
kontrol('ikinci kurulumda alanlar "zaten vardı"', (r.json?.satirlar || []).filter((x) => x.includes('zaten vardı')).length === 5, r.json?.satirlar);
const rapor0 = await raporAl();
kontrol('başlangıç raporu Telegram\'a gitti', rapor0.metin.includes('Yapay Zeka'), rapor0.metin.slice(0, 200));

console.log('\n=== A) Outbound arama kuyruğu ===');
await post(`${MOCK}/__reset`, {
  pageSize: 3, // sayfalamayı test etmek için küçük sayfa
  activeCalls: [
    { id: 'c-busy', status: 'in-progress', phoneNumberId: 'pn-2' },
    { id: 'c-old', status: 'ended', phoneNumberId: 'pn-1' },
  ],
  failNumbers: ['+905321111102'],
  leads: [
    { ID: 101, NAME: 'AHMET', LAST_NAME: 'YILMAZ', PHONE: telefonLead('0532 111 11 01'), STATUS_ID: AI, ASSIGNED_BY_ID: '3' },
    { ID: 102, NAME: 'Zeynep', PHONE: telefonLead('5321111102'), STATUS_ID: AI, ASSIGNED_BY_ID: '3' },
    { ID: 103, NAME: 'Can', PHONE: telefonLead('+90 532 111 11 03'), STATUS_ID: AI, ASSIGNED_BY_ID: '3' },
    { ID: 104, NAME: 'Geçersiz', PHONE: telefonLead('123'), STATUS_ID: AI },
    { ID: 105, PHONE: telefonLead('05321111105'), STATUS_ID: AI, [F.DENEME]: '3', [F.SONUC]: 'ULASILAMADI', [F.SONRAKI]: gecmis },
    { ID: 106, PHONE: telefonLead('05321111106'), STATUS_ID: AI, [F.DENEME]: '1', [F.SONUC]: 'ULASILAMADI', [F.SONRAKI]: gelecek },
    { ID: 107, PHONE: telefonLead('05321111107'), STATUS_ID: AI, [F.DENEME]: '3', [F.SONUC]: 'TEKRAR_ARA', [F.SONRAKI]: gecmis },
    { ID: 108, PHONE: telefonLead('05321111108'), STATUS_ID: AI, [F.DENEME]: '1', [F.SONUC]: 'ULASILAMADI', [F.SONRAKI]: gecmis },
    { ID: 109, PHONE: telefonLead('05321111109'), STATUS_ID: 'NEW' },
    { ID: 110, PHONE: telefonLead('05321111101'), STATUS_ID: AI },
    { ID: 116, NAME: 'KAAN', LAST_NAME: 'İNCE', STATUS_ID: AI, CONTACT_ID: '9001' },
  ],
  contacts: [{ ID: '9001', PHONE: telefonLead('+90 505 035 29 40') }],
});
r = await kuyruk();
kontrol('tur 1 çalıştı', r.status === 200, r.text.slice(0, 300));
let s = await durum();
let cagrilar = s.requests.filter((q) => q.metod === 'POST /call').map((q) => q.body);
kontrol('tur 1: meşgul hat (pn-2) atlandı → 2 arama', cagrilar.length === 2, cagrilar.map((c) => c.phoneNumberId));
kontrol('tur 1: önce müşterinin istediği geri arama (107), sonra tekrar deneme (108)', cagrilar[0]?.assistantOverrides.variableValues.lead_id === '107' && cagrilar[1]?.assistantOverrides.variableValues.lead_id === '108', cagrilar.map((c) => c.assistantOverrides.variableValues.lead_id));
kontrol('tur 1: hatlar pn-1 ve pn-3', cagrilar.map((c) => c.phoneNumberId).join() === 'pn-1,pn-3');
kontrol('tur 1: asistan ve E.164 numara', cagrilar[0]?.assistantId === 'asst-out' && cagrilar[0]?.customer.number === '+905321111107');
kontrol('107 kilitlendi (deneme 4, ARANIYOR_TA, ek hak korunur)', String(s.leads['107'][F.DENEME]) === '4' && s.leads['107'][F.SONUC] === 'ARANIYOR_TA' && new Date(s.leads['107'][F.SONRAKI]) > new Date(), s.leads['107']);
kontrol('104 geçersiz numara → OLUMSUZ', s.leads['104'].STATUS_ID === OLUMSUZ && s.leads['104'][F.SONUC] === 'GECERSIZ_NUMARA');
kontrol('105 hakkı bitti → OLUMSUZ', s.leads['105'].STATUS_ID === OLUMSUZ && s.leads['105'][F.SONUC] === 'ULASILAMADI');
kontrol('106 (bekleyen) ve 109 (başka statü) dokunulmadı', s.leads['106'][F.DENEME] === '1' && s.leads['109'][F.SONUC] === undefined);
kontrol('sayfalama: crm.lead.list 4 sayfa', s.requests.filter((q) => q.metod === 'crm.lead.list').length === 4, s.requests.filter((q) => q.metod === 'crm.lead.list').length);
kontrol('call ID lead\'e yazıldı', s.leads['107'][F.CAGRI] === 'call-1' && s.leads['108'][F.CAGRI] === 'call-2', [s.leads['107'][F.CAGRI], s.leads['108'][F.CAGRI]]);

await post(`${MOCK}/__config`, { activeCalls: [] });
r = await kuyruk();
s = await durum();
cagrilar = s.requests.filter((q) => q.metod === 'POST /call').map((q) => q.body).slice(2);
kontrol('tur 2: 3 hat boş → 3 arama (101,102,103)', cagrilar.map((c) => c.assistantOverrides.variableValues.lead_id).join() === '101,102,103', cagrilar.map((c) => c.assistantOverrides.variableValues.lead_id));
kontrol('tur 2: aynı anda 3 farklı hat', new Set(cagrilar.map((c) => c.phoneNumberId)).size === 3);
kontrol('ilk mesajda isim düzeltildi (AHMET YILMAZ → Ahmet Yılmaz)', cagrilar[0]?.assistantOverrides.firstMessage.includes('Ahmet Yılmaz ile mi görüşüyorum'), cagrilar[0]?.assistantOverrides.firstMessage);
kontrol('102 Vapi hatası → HATA, 15 dk sonra tekrar', s.leads['102'][F.SONUC] === 'HATA' && s.comments.some((c) => c.leadId === '102' && c.text.includes('başlatılamadı')), s.leads['102']);
kontrol('110 (101 ile aynı numara) bu turda aranmadı', !cagrilar.some((c) => c.assistantOverrides.variableValues.lead_id === '110'));
const call101 = s.leads['101'][F.CAGRI];
kontrol('101 call ID yazıldı', !!call101, s.leads['101']);

r = await kuyruk();
s = await durum();
cagrilar = s.requests.filter((q) => q.metod === 'POST /call').map((q) => q.body).slice(5);
kontrol('tur 3: 110 ve telefonu bağlı kişide olan 116 aranır', cagrilar.map((c) => c.assistantOverrides.variableValues.lead_id).join() === '110,116', cagrilar.map((c) => c.assistantOverrides.variableValues.lead_id));
kontrol('116 kişi kaydındaki numaradan arandı', cagrilar.find((c) => c.assistantOverrides.variableValues.lead_id === '116')?.customer.number === '+905050352940');

console.log('\n=== B) Outbound araçlar (görüşme sırasında) ===');
r = await outbound(
  arac(outCall(call101, 101, '+905321111101'), 'randevu_olustur', {
    randevu_tarihi: yarin,
    randevu_saati: '14:00',
    ad_soyad: 'Ahmet Yılmaz',
    randevu_tipi: 'ofis_ziyareti',
    ilgilendigi_daire: '2+1 A Tipi',
    odeme_tercihi: 'vadeli',
    not: 'Yatırım amaçlı',
  })
);
kontrol('randevu yanıtı Vapi formatında', r.json?.results?.[0]?.toolCallId === 'tc-randevu_olustur' && r.json.results[0].result.startsWith('Randevu kaydedildi'), r.json);
let l = await lead(101);
kontrol('101 → RANDEVU statüsü', l.STATUS_ID === RANDEVU, l.STATUS_ID);
kontrol('101 sorumlu listeden atandı (7/9)', ['7', '9'].includes(String(l.ASSIGNED_BY_ID)), l.ASSIGNED_BY_ID);
kontrol('101 randevu tarihi İstanbul saatiyle', l[F.RANDEVU] === `${yarin}T14:00:00+03:00`, l[F.RANDEVU]);
kontrol('101 sayaç temizlendi, sonuç RANDEVU', String(l[F.DENEME]) === '0' && l[F.SONRAKI] === '' && l[F.SONUC] === 'RANDEVU');
s = await durum();
const todo101 = s.todos.find((t) => t.ownerId === '101');
kontrol('sorumluya randevu görevi açıldı', todo101 && todo101.deadline === `${yarin}T14:00:00+03:00` && todo101.responsibleId === String(l.ASSIGNED_BY_ID) && todo101.description.includes('2+1 A Tipi'), todo101);
s = await bekleKadar((x) => x.sms.length && x.whatsapp.length && x.telegram.some((t) => t.text.includes('Yeni randevu')));
const sms101 = s.sms.find((m) => m.no === '5321111101');
kontrol('randevu teyit SMS\'i (XML servisi)', sms101 && sms101.msg.includes('Ahmet Yılmaz') && sms101.msg.includes('14:00') && sms101.baslik === 'XRE TEST' && sms101.tip === 'UC', sms101);
const wa101 = s.whatsapp.find((m) => m.to === '905321111101');
kontrol('randevu teyit WhatsApp şablonu', wa101?.template.name === 'efas_randevu_teyit' && wa101.template.components[0].parameters[0].text === 'Ahmet Yılmaz' && wa101.telefonNumarasiId === 'PNID', wa101);
const tg101 = s.telegram.find((t) => t.text.includes('Yeni randevu'));
kontrol('Telegram grubuna anlık randevu bildirimi', tg101?.chat_id === '-100123' && tg101.text.includes('Ahmet Yılmaz') && tg101.text.includes('/crm/lead/details/101/') && !tg101.text.includes('n8n'), tg101);

r = await outbound(arac(outCall('call-x3', 103, '+905321111103'), 'randevu_olustur', { randevu_tarihi: yarin, randevu_saati: '22:00' }));
kontrol('ziyaret saati dışı randevu reddedildi', r.json?.results?.[0]?.result.includes('ziyaret saatlerimizin dışında'), r.json);
kontrol('103 statüsü değişmedi', (await lead(103)).STATUS_ID === AI);

r = await outbound(arac(outCall('call-x3', 103, '+905321111103'), 'geri_arama_planla', { tarih: yarin, saat: '11:30', not: 'Toplantıda' }));
l = await lead(103);
kontrol('geri arama kaydedildi', r.json?.results?.[0]?.result.startsWith('Geri arama kaydedildi') && l[F.SONUC] === 'TEKRAR_ARA' && l[F.SONRAKI] === `${yarin}T11:30:00+03:00`, [r.json, l]);

r = await outbound({
  ...arac(outCall('call-2', 108, '+905321111108'), 'olumsuz_kaydet', { neden: 'aranmak_istemiyor', aciklama: 'Listeden çıkarın dedi' }),
});
l = await lead(108);
kontrol('olumsuz kaydedildi (aranmak istemiyor)', l.STATUS_ID === OLUMSUZ && l[F.SONUC] === 'OLUMSUZ:aranmak_istemiyor' && r.json.results[0].result.includes('bir daha aranmayacak'), [l, r.json]);

r = await outbound(arac(outCall('call-yok', 99999, '+905320000000'), 'randevu_olustur', { randevu_tarihi: yarin, randevu_saati: '12:00' }));
kontrol('bilinmeyen lead → nazik yanıt', r.json?.results?.[0]?.result.includes('bulunamadı'), r.json);

r = await outbound({
  type: 'tool-calls',
  call: outCall('call-x3', 103, '+905321111103'),
  toolCallList: [
    { id: 'a1', type: 'function', function: { name: 'bilinmeyen_arac', arguments: '{}' } },
    { id: 'a2', type: 'function', function: { name: 'geri_arama_planla', arguments: JSON.stringify({ tarih: yarin, saat: '12:00' }) } },
  ],
});
kontrol('tek mesajda 2 araç çağrısı → 2 yanıt (string argümanlar da çözülür)', r.json?.results?.length === 2 && r.json.results[1].result.startsWith('Geri arama'), r.json);

console.log('\n=== C) Outbound çağrı sonu raporu ===');
const sayiYorum = async () => (await durum()).comments.length;
let once = await sayiYorum();
r = await outbound(rapor(outCall(call101, 101, '+905321111101'), { analysis: { summary: 'Müşteri yarın 14:00 için randevu aldı.', structuredData: { sonuc: 'randevu' } }, artifact: { messages: konusma('Merhaba', 'Evet benim', 'Randevu?', 'Olur') } }));
kontrol('rapor hemen 200 döner', r.status === 200);
s = await bekleKadar((x) => x.comments.length > once);
kontrol('araçla işlenen randevuya sadece rapor eklendi', s.leads['101'].STATUS_ID === RANDEVU && s.comments.at(-1).text.includes('görüşme sırasında kaydedildi') && s.comments.at(-1).text.includes('Ses kaydı'), s.comments.at(-1));
kontrol('ikinci (teyit) görevi açılmadı', s.todos.filter((t) => t.ownerId === '101').length === 1);

once = s.comments.length;
await outbound(rapor(outCall('call-1', 107, '+905321111107'), { endedReason: 'customer-did-not-answer', durationSeconds: 0 }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('107 açmadı → ULASILAMADI_TA, kuyrukta kalır (ek hak)', s.leads['107'].STATUS_ID === AI && s.leads['107'][F.SONUC] === 'ULASILAMADI_TA' && new Date(s.leads['107'][F.SONRAKI]) > new Date(Date.now() + 100 * 60000), s.leads['107']);

once = s.comments.length;
await outbound(rapor(outCall('call-6', 110, '+905321111101'), { artifact: { messages: konusma('Merhabalar', 'Aradığınız kişiye şu anda ulaşılamıyor, lütfen daha sonra tekrar deneyiniz') } }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('operatör anonsu = ulaşılamadı', s.leads['110'][F.SONUC] === 'ULASILAMADI', s.leads['110']);
s = await bekleKadar((x) => x.sms.some((m) => m.msg.includes('3.150.000')));
const tanitim = s.sms.find((m) => m.msg.includes('3.150.000'));
kontrol('ilk aramada ulaşılamayana tanıtım SMS\'i', tanitim?.no === '5321111101', tanitim);
kontrol('tanıtım WhatsApp şablonu', s.whatsapp.some((m) => m.template.name === 'efas_tanitim'));
kontrol('4. denemede ulaşılamayan 107\'ye tanıtım gitmedi', !s.sms.some((m) => m.no === '5321111107'));

const yeniLeadler = [
  { ID: 111, PHONE: telefonLead('05321111111'), STATUS_ID: AI, [F.DENEME]: 3, [F.SONUC]: 'ARANIYOR' },
  { ID: 112, PHONE: telefonLead('05321111112'), STATUS_ID: AI, [F.DENEME]: 1, [F.SONUC]: 'ARANIYOR' },
  { ID: 113, NAME: 'Elif', PHONE: telefonLead('05321111113'), STATUS_ID: AI, [F.DENEME]: 1, [F.SONUC]: 'ARANIYOR', ASSIGNED_BY_ID: '3' },
  { ID: 114, PHONE: telefonLead('05321111114'), STATUS_ID: AI, [F.DENEME]: 1, [F.SONUC]: 'ARANIYOR' },
  { ID: 115, PHONE: telefonLead('05321111115'), STATUS_ID: AI, [F.DENEME]: 1, [F.SONUC]: 'ARANIYOR' },
];
for (const yl of yeniLeadler) await post(`${MOCK}/__lead`, yl);

once = (await durum()).comments.length;
await outbound(rapor(outCall('c111', 111, '+905321111111'), { endedReason: 'customer-busy', durationSeconds: 0 }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('111 son hakta ulaşılamadı → OLUMSUZ', s.leads['111'].STATUS_ID === OLUMSUZ && s.leads['111'][F.SONUC] === 'ULASILAMADI' && String(s.leads['111'][F.DENEME]) === '0', s.leads['111']);

once = s.comments.length;
await outbound(rapor(outCall('c112', 112, '+905321111112'), { analysis: { summary: 'Bütçesi uymuyor.', structuredData: { sonuc: 'olumsuz', olumsuz_nedeni: 'butce_uygun_degil' } }, artifact: { messages: konusma('Merhaba', 'Buyrun', 'Fiyat...', 'Bütçeme uygun değil') } }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('112 olumsuz (yapılandırılmış veri)', s.leads['112'].STATUS_ID === OLUMSUZ && s.leads['112'][F.SONUC] === 'OLUMSUZ:butce_uygun_degil', s.leads['112']);

once = s.comments.length;
await outbound(rapor(outCall('c113', 113, '+905321111113'), { analysis: { summary: 'Randevu konuşuldu.', structuredData: { sonuc: 'randevu', randevu_tarihi: yarin, randevu_saati: '15:00' } }, artifact: { messages: konusma('Merhaba', 'Evet', 'Yarın 15?', 'Olur') } }));
s = await bekleKadar((x) => x.comments.length > once);
const todo113 = s.todos.find((t) => t.ownerId === '113');
kontrol('113 araç çağrılmadan randevu konuşuldu → RANDEVU + TEYİT görevi', s.leads['113'].STATUS_ID === RANDEVU && s.leads['113'][F.SONUC] === 'RANDEVU_TEYIT' && todo113?.title.includes('TEYİDİ') && todo113?.deadline === `${yarin}T15:00:00+03:00`, [s.leads['113'], todo113]);

once = s.comments.length;
await outbound(rapor(outCall('c114', 114, '+905321111114'), { artifact: { messages: konusma('Merhaba', 'Efendim', 'Projemiz...', 'Düşüneyim') } }));
s = await bekleKadar((x) => x.comments.length > once);
s = await bekleKadar((x) => x.whatsapp.some((m) => m.to === '905321111114'));
kontrol('karar vermeyen 114\'e WhatsApp bilgi şablonu (SMS yok)', s.whatsapp.find((m) => m.to === '905321111114')?.template.name === 'efas_bilgi' && !s.sms.some((m) => m.no === '5321111114'));
kontrol('114 yapılandırılmış veri yok → KARARSIZ, 1 gün sonra', s.leads['114'][F.SONUC] === 'KARARSIZ' && new Date(s.leads['114'][F.SONRAKI]) > new Date(Date.now() + 23 * 3600000), s.leads['114']);

once = s.comments.length;
await outbound(rapor(outCall('c115', 115, '+905321111115'), { artifact: { messages: konusma('Merhaba', 'Şimdi müsait değilim'), structuredOutputs: { 'so-1': { name: 'efas_sonuc', result: { sonuc: 'tekrar_ara' } } } } }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('Structured Outputs formatı da okunur (tekrar_ara)', s.leads['115'][F.SONUC] === 'TEKRAR_ARA', s.leads['115']);

console.log('\n=== D) Inbound ===');
await post(`${MOCK}/__lead`, { ID: 120, NAME: 'Ayşe', PHONE: telefonLead('+905557770001'), STATUS_ID: 'UC_TOPRAKTAN', ASSIGNED_BY_ID: '44' });
r = await inbound(arac(inCall('in-1', '+905559990001'), 'randevu_olustur', { randevu_tarihi: yarin, randevu_saati: '11:00', ad_soyad: 'mehmet demir', ilgilendigi_daire: '1+1' }));
s = await durum();
const yeni = Object.values(s.leads).find((x) => x.PHONE?.[0]?.VALUE === '+905559990001');
kontrol('yeni arayan randevu → yeni lead RANDEVU statüsünde', r.json?.results?.[0]?.result.startsWith('Randevu kaydedildi') && yeni?.STATUS_ID === RANDEVU && yeni.NAME === 'Mehmet' && yeni.LAST_NAME === 'Demir', [r.json, yeni]);
kontrol('yeni lead sorumlusu listeden, görev yeni lead\'e bağlı', ['7', '9'].includes(String(yeni?.ASSIGNED_BY_ID)) && s.todos.some((t) => t.ownerId === yeni?.ID), yeni);

r = await inbound(arac(inCall('in-2', '+905321111103'), 'randevu_olustur', { randevu_tarihi: yarin, randevu_saati: '16:30' }));
l = await lead(103);
kontrol('kuyruktaki EFAS lead\'i geri aradı → aynı lead RANDEVU', l.STATUS_ID === RANDEVU && l[F.RANDEVU] === `${yarin}T16:30:00+03:00`, l);

once = (await durum()).comments.length;
await inbound(rapor(inCall('in-3', '+905557770001'), { analysis: { summary: 'Fiyat bilgisi aldı.', structuredData: { sonuc: 'bilgi_aldi', musteri_adi: 'Ayşe Kaya' } }, artifact: { messages: konusma('Hoş geldiniz', 'Fiyat öğrenmek istiyorum') } }));
s = await bekleKadar((x) => x.comments.length > once);
const ayse = Object.values(s.leads).find((x) => x.ID !== '120' && x.PHONE?.[0]?.VALUE === '+905557770001');
kontrol('başka projenin lead\'i olan arayan → yeni EFAS lead (EFAS İÇİN GELEN) + dönüş görevi', ayse?.STATUS_ID === 'UC_PQDHUK' && String(ayse.ASSIGNED_BY_ID) === '21' && s.todos.some((t) => t.ownerId === ayse.ID && t.title.includes('dönüş')), ayse);
kontrol('diğer projenin lead\'ine dokunulmadı', s.leads['120'].STATUS_ID === 'UC_TOPRAKTAN' && !s.comments.some((c) => c.leadId === '120'));

once = s.comments.length;
await inbound(rapor(inCall('in-1', '+905559990001'), { analysis: { summary: 'Randevu aldı.', structuredData: { sonuc: 'randevu' } }, artifact: { messages: konusma('Hoş geldiniz', 'Randevu istiyorum') } }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('araçla randevu alan inbound → sadece rapor', s.comments.at(-1).leadId === yeni?.ID && s.comments.at(-1).text.includes('görüşme sırasında oluşturuldu') && s.todos.filter((t) => t.ownerId === yeni?.ID).length === 1, s.comments.at(-1));

const istekOnce = (await durum()).requests.length;
await inbound(rapor(inCall('in-5', '+905559990005'), { endedReason: 'customer-ended-call', artifact: { messages: [] } }));
await bekle(1500);
s = await durum();
kontrol('konuşmadan kapatan inbound → kayıt açılmaz', !Object.values(s.leads).some((x) => x.PHONE?.[0]?.VALUE === '+905559990005'));

once = s.comments.length;
await inbound(rapor(inCall('in-6', '+905321111102'), { analysis: { structuredData: { sonuc: 'olumsuz', olumsuz_nedeni: 'ilgilenmiyor' } }, artifact: { messages: konusma('Hoş geldiniz', 'Beni aramayı bırakın') } }));
s = await bekleKadar((x) => x.comments.length > once);
kontrol('kuyruktaki lead inbound olumsuz → OLUMSUZ', s.leads['102'].STATUS_ID === OLUMSUZ && s.leads['102'][F.SONUC] === 'OLUMSUZ:ilgilenmiyor', s.leads['102']);

console.log('\n=== E) Diğer mesaj tipleri ===');
const bas = Date.now();
const istekler = (await durum()).requests.length;
r = await outbound({ type: 'status-update', status: 'in-progress', call: outCall('z', 101, '+905321111101') });
await bekle(800);
kontrol('status-update → hemen 200, Bitrix\'e istek yok', r.status === 200 && Date.now() - bas < 3000 && (await durum()).requests.length === istekler);

console.log('\n=== F) Günlük rapor (05) ===');
await bekle(1500); // son olayların tabloya yazılmasını bekle
const rapor1 = await raporAl();
const fark = (k) => rapor1[k] - rapor0[k];
kontrol('rapor: 6 arama, 1 başlatılamayan', fark('arama') === 6 && fark('hata') === 1, { arama: fark('arama'), hata: fark('hata') });
kontrol('rapor: 4 randevu (101, 113 teyit, inbound yeni, 103 inbound)', fark('randevu') === 4, fark('randevu'));
kontrol('rapor: inbound görüşmeler sayıldı', fark('inbound') >= 3, fark('inbound'));
kontrol('rapor: ulaşılan / ulaşılamayan', fark('ulasilan') >= 5 && fark('ulasilamayan') === 3, { ulasilan: fark('ulasilan'), ulasilamayan: fark('ulasilamayan') });
kontrol('rapor: olumsuzlar sayıldı', fark('olumsuz') >= 6, fark('olumsuz'));
kontrol('rapor: SMS ve WhatsApp sayıları', fark('sms') === (await durum()).sms.length && fark('whatsapp') === (await durum()).whatsapp.length, { sms: fark('sms'), whatsapp: fark('whatsapp') });
kontrol('rapor: günün randevu listesi', rapor1.metin.includes('Bugünün randevuları') && rapor1.metin.includes('Ahmet Yılmaz'));
console.log('\n--- Örnek Telegram raporu ---\n' + rapor1.metin.replace(/<[^>]+>/g, '') + '\n---');

console.log(`\nSonuç: ${gecen} geçti, ${kalan} kaldı`);
process.exit(kalan ? 1 : 0);
