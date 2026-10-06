// Kilidi başarıyla yazılan her lead için bir arama item'ı üretir
const plan = $('Aranacakları Seç').first().json;
const yanit = $input.first().json;
const hatalar = batchHatalari(yanit);
const sonuclar = batchSonuclari(yanit);

return plan.aramalar
  .filter((a) => !hatalar[`kilit_${a.leadId}`] && sonuclar[`kilit_${a.leadId}`] !== undefined)
  .map((a) => ({ json: a }));
