// Vapi'den gelen sunucu mesajını tek tip nesneye çevirir
const body = $('Vapi Webhook').first().json.body || {};
return [{ json: vapiMesajCoz(body) }];
