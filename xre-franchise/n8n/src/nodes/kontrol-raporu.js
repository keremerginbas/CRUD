// Kurulum kontrol listesi: Bitrix alanları, statüler, Vapi numaraları ve asistan
const A = $('AYARLAR').first().json;
const plan = $('Alan Planı').first().json;
const yanit = $('Bitrix: Alanları Oluştur').first().json;
const s = [];

if (!yanit || yanit.error || !yanit.result) {
  s.push(`❌ Bitrix'e bağlanılamadı. BITRIX_WEBHOOK adresini kontrol edin. (${kisalt(JSON.stringify(yanit && yanit.error), 200)})`);
} else {
  const r = batchSonuclari(yanit);
  const h = batchHatalari(yanit);
  const mevcut = new Set((Array.isArray(r.mevcut) ? r.mevcut : []).map((f) => f.FIELD_NAME));
  plan.tanimlar.forEach((t, i) => {
    if (mevcut.has(t.kod)) s.push(`✅ Lead alanı ${t.kod} zaten vardı`);
    else if (r[`ekle_${i}`]) s.push(`✅ Lead alanı ${t.kod} oluşturuldu (${t.etiket})`);
    else s.push(`❌ Lead alanı ${t.kod} oluşturulamadı: ${kisalt(JSON.stringify(h[`ekle_${i}`] || ''), 200)}`);
  });
  const statuler = Array.isArray(r.statuler) ? r.statuler : [];
  for (const [ad, kod] of Object.entries(A.STATU)) {
    const st = statuler.find((x) => x.STATUS_ID === kod);
    s.push(st ? `✅ Statü ${ad}: ${kod} (${st.NAME})` : `❌ Statü ${ad}: ${kod} Bitrix'te bulunamadı — önce bu statüyü Bitrix'te oluşturup kodunu AYARLAR'a yazın`);
  }
}

const numaralar = $('Vapi: Telefon Numaraları').all().map((i) => i.json).filter((n) => n && n.id);
const asistanlar = $('Vapi: Asistanlar').all().map((i) => i.json).filter((a) => a && a.id);

if (!numaralar.length) s.push('❌ Vapi telefon numaraları okunamadı. "Vapi API" credential\'ını kontrol edin.');
for (const ham of A.ARAYAN_NUMARALAR) {
  const e = telefonNormalize(ham);
  const n = numaralar.find((x) => telefonNormalize(x.number) === e);
  s.push(n ? `✅ ${ham} → Vapi ID ${n.id}` : (numaralar.length ? `❌ ${ham} Vapi'de bulunamadı` : '⚠️ numaralar okunamadığı için kontrol edilemedi'));
}

const bulunan = asistanBul(asistanlar, A.VAPI_OUTBOUND_ASISTAN);
const a = bulunan && asistanlar.find((x) => x.id === bulunan.id);
if (!a) {
  if (asistanlar.length) s.push(`❌ Outbound asistanı "${A.VAPI_OUTBOUND_ASISTAN}" Vapi'de bulunamadı`);
} else {
  const url = (a.server && a.server.url) || a.serverUrl || '';
  s.push(`${url ? '✅' : '⚠️'} Outbound asistanı: ${a.name} | Server URL: ${url || 'TANIMLI DEĞİL'}`);
}

s.push(`ℹ️ WhatsApp ${A.WHATSAPP.AKTIF ? 'AÇIK' : 'kapalı'} · Telegram ${A.TELEGRAM.AKTIF ? 'AÇIK' : 'kapalı'}`);

return [{ json: { rapor: s.join('\n'), satirlar: s } }];
