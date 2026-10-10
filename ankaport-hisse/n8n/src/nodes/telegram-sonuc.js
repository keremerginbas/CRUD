// Arama sonucu Telegram mesajı: sorumlu kişi, müşteri adı, form tarihi, hangi statüye düştüğü, özet.
const p = $('Rapor Planı').first().json;
const h = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let sorumluAdi = p.sorumluId ? `ID ${p.sorumluId}` : 'Atanmamış';
try {
  const kullanici = $('Bitrix: Sorumlu Kullanıcı').first().json.result;
  const u = Array.isArray(kullanici) ? kullanici[0] : kullanici;
  if (u) sorumluAdi = [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || sorumluAdi;
} catch (e) {}

const metin = [
  `☎ <b>Arama Sonucu</b> — ${h(p.durumMetni)}`,
  `👤 Müşteri: ${h(p.ad || '-')} · ${h(p.telefon || '-')}`,
  `👩‍💼 Sorumlu: ${h(sorumluAdi)}`,
  `🕐 Form tarihi: ${h(p.formTarihi)}`,
  `📋 Statü: ${h(p.statuMetni)}`,
  p.ozet ? `📝 Özet: ${h(p.ozet)}` : '',
].filter(Boolean).join('\n');

return [{ json: { metin } }];
