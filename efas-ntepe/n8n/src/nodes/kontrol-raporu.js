// Kurulum kontrol listesi: Bitrix alanları, statüler, Vapi numaraları ve asistanlar
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
    s.push(st ? `✅ Statü ${ad}: ${kod} (${st.NAME})` : `❌ Statü ${ad}: ${kod} Bitrix'te bulunamadı`);
  }
}

const numaralar = $('Vapi: Telefon Numaraları').all().map((i) => i.json).filter((n) => n && n.id);
const asistanlar = $('Vapi: Asistanlar').all().map((i) => i.json).filter((a) => a && a.id);
const asistanAdi = (id) => (asistanlar.find((a) => a.id === id) || {}).name || id || '-';

if (!numaralar.length) s.push('❌ Vapi telefon numaraları okunamadı. "Vapi API" credential\'ını kontrol edin.');
for (const ham of A.ARAYAN_NUMARALAR) {
  const e = telefonNormalize(ham);
  const n = numaralar.find((x) => telefonNormalize(x.number) === e);
  if (!n) {
    if (numaralar.length) s.push(`❌ ${ham} Vapi'de bulunamadı`);
    continue;
  }
  const inboundOk = n.assistantId === A.VAPI_INBOUND_ASISTAN_ID;
  s.push(`${inboundOk ? '✅' : '⚠️'} ${ham} → Vapi ID ${n.id} | gelen çağrı asistanı: ${asistanAdi(n.assistantId)}${inboundOk ? '' : ' (EFAS inbound asistanı değil)'}`);
}

for (const [etiketi, id] of [
  ['Outbound', A.VAPI_OUTBOUND_ASISTAN_ID],
  ['Inbound', A.VAPI_INBOUND_ASISTAN_ID],
]) {
  const a = asistanlar.find((x) => x.id === id);
  if (!a) {
    if (asistanlar.length) s.push(`❌ ${etiketi} asistanı (${id}) Vapi'de bulunamadı`);
    continue;
  }
  const url = (a.server && a.server.url) || a.serverUrl || '';
  const araclar = ((a.model && a.model.tools) || []).map((t) => (t.function && t.function.name) || t.type);
  s.push(`${url ? '✅' : '⚠️'} ${etiketi} asistanı: ${a.name} | Server URL: ${url || 'TANIMLI DEĞİL'}`);
  if (araclar.length) s.push(`   satır içi araçlar: ${araclar.join(', ')}`);
  if ((a.model && a.model.toolIds && a.model.toolIds.length) || 0) s.push(`   bağlı araç sayısı (toolIds): ${a.model.toolIds.length}`);
}

// Olay tablosu ve Olay Merkezi (04)
const tablo = $('Tablo: Olay Tablosu').first().json || {};
s.push(tablo.id && !tablo.error ? `✅ Olay tablosu hazır: ${tablo.name || 'efas_ntepe_olaylar'}` : `❌ Olay tablosu oluşturulamadı (n8n Data Tables): ${kisalt(JSON.stringify(tablo.error || tablo), 200)}`);
const olayTest = $('Olay Merkezi Testi').first().json || {};
s.push(olayTest.error ? `❌ OLAY_WEBHOOK_URL'e ulaşılamadı — 04 workflow'u aktif mi? (${kisalt(JSON.stringify(olayTest.error), 200)})` : '✅ 04 Olay ve Mesaj Merkezi webhook\'u yanıt veriyor');
s.push(`ℹ️ SMS ${A.SMS.AKTIF ? 'AÇIK' : 'kapalı'} · WhatsApp ${A.WHATSAPP.AKTIF ? 'AÇIK' : 'kapalı'} · Telegram ${A.TELEGRAM.AKTIF ? 'AÇIK' : 'kapalı'}`);

return [{ json: { rapor: s.join('\n'), satirlar: s } }];
