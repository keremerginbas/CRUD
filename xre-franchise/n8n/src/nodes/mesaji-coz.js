// Vapi webhook gövdesini tek tip nesneye çevirir (çağrı sonu raporu)
const body = $('Vapi Webhook').first().json.body || {};
return [{ json: vapiMesajCoz(body) }];
