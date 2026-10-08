// SMS / WhatsApp / e-posta gönderim sonuçlarını olay tablosuna yazılacak satırlara çevirir
const simdi = new Date();
return $input.all().map((item, i) => {
  const plan = $('Mesaj Planı').itemMatching(i).json;
  const r = item.json || {};
  let ok;
  let smsYaniti = '';
  if (plan.kanal === 'sms') {
    let yanit = typeof r.data === 'string' ? r.data : JSON.stringify(r);
    // Yanıt metin yerine bayt dizisi olarak geldiyse ("data":[60,63,...]) çöz
    if (!/<RESULT>/i.test(yanit)) {
      for (const m of yanit.matchAll(/"data":\[([\d,\s]+)\]/g)) {
        try {
          const metin = Buffer.from(m[1].split(',').map(Number)).toString('utf8');
          if (/<RESULT>/i.test(metin)) { yanit = metin; break; }
        } catch (e) {}
      }
    }
    smsYaniti = (/<RESULT>([^<]*)<\/RESULT>/i.exec(yanit) || [])[1] || kisalt(yanit, 120);
    const kodlar = ($('AYARLAR').first().json.SMS.BASARILI_KODLAR || []).map(String);
    ok = !r.error && (kodlar.length ? kodlar.includes(String(smsYaniti).trim()) : !/hata|error|fail|invalid|geçersiz|yetkisiz|unauthori[sz]ed|denied/i.test(yanit));
  }
  else if (plan.kanal === 'eposta') ok = !r.error && !(Array.isArray(r.rejected) && r.rejected.length) && !!(r.messageId || (Array.isArray(r.accepted) && r.accepted.length));
  else ok = !r.error && !!(r.messages && r.messages[0] && r.messages[0].id);
  const hata = r.error ? (typeof r.error === 'string' ? r.error : r.error.message || JSON.stringify(r.error)) : ok ? '' : JSON.stringify(r);
  return {
    json: {
      gun: trGun(simdi),
      tur: plan.kanal,
      yon: '',
      lead_id: String(plan.leadId || ''),
      telefon: plan.telefon,
      ad: kisalt(plan.ad, 120),
      sonuc: ok ? 'ok' : 'hata',
      detay: kisalt(`${plan.mesaj}${plan.alici ? ` | ${plan.alici}` : ''}${smsYaniti ? ` | RESULT ${smsYaniti}` : ''}${hata ? ` | ${hata}` : ''}`, 500),
      sure_sn: 0,
      maliyet: 0,
    },
  };
});
