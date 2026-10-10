// Vapi webhook gövdesini tek tip nesneye çevirir (randevu_olustur araç çağrısı ya da çağrı sonu raporu)
const body = $('Vapi Webhook').first().json.body || {};
return [{ json: vapiMesajCoz(body) }];
