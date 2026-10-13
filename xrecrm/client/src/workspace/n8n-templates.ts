// İçe aktarılabilir n8n iş akışı şablonları (n8n → Workflows → Import from file).

function download(name: string, workflow: unknown) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" }),
  );
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const node = (
  name: string,
  type: string,
  typeVersion: number,
  position: [number, number],
  parameters: Record<string, unknown>,
) => ({ id: crypto.randomUUID(), name, type, typeVersion, position, parameters });

const link = (to: string) => ({ main: [[{ node: to, type: "main", index: 0 }]] });

/** XRE giden webhook → n8n: olayları alır, imzayı doğrular, olaya göre dallandırır. */
export function downloadEventReceiverTemplate() {
  const verify = `// XRE CRM giden webhook imzası: HMAC-SHA256(secret, timestamp + "." + gövde)
// SECRET değerini Webhook merkezinden "Gizli anahtarı göster" ile alın ve
// n8n ortam değişkeni (XRE_WEBHOOK_SECRET) olarak tanımlayın.
const crypto = require('crypto');
const secret = $env.XRE_WEBHOOK_SECRET;
return $input.all().map((item) => {
  const headers = item.json.headers || {};
  const body = item.json.body || {};
  if (secret) {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(headers['x-xre-timestamp'] + '.' + JSON.stringify(body))
      .digest('hex');
    if (expected !== headers['x-xre-signature']) throw new Error('XRE imzası geçersiz');
  }
  return {
    json: {
      event: body.event,
      deliveryId: body.id,
      occurredAt: body.occurredAt,
      lead: body.lead || (body.entity?.kind === 'lead' ? body.data : null),
      data: body.data,
      previous: body.previous || null,
    },
  };
});`;
  const route = `// Olaya göre işlem yapın. Örnek: cevapsız aramada Telegram'a bildirim,
// "qualified" aşamasında satış ekibine görev, yeni müşteride karşılama mesajı.
return $input.all().map((item) => {
  const { event, lead, data, previous } = item.json;
  let action = 'yok';
  if (event === 'lead.created') action = 'karşılama mesajı gönder';
  if (event === 'lead.stage_changed') action = previous?.stage + ' → ' + data?.stage;
  if (event === 'call.missed') action = 'geri arama görevi aç';
  return { json: { ...item.json, action, leadName: lead?.name || data?.name } };
});`;
  download("xre-crm-olay-alici.n8n.json", {
    name: "XRE CRM · Olay alıcı",
    nodes: [
      node("XRE Webhook", "n8n-nodes-base.webhook", 2, [0, 0], {
        httpMethod: "POST",
        path: "xre-crm-events",
        responseMode: "onReceived",
        options: {},
      }),
      node("İmzayı doğrula", "n8n-nodes-base.code", 2, [260, 0], { jsCode: verify }),
      node("Olaya göre yönlendir", "n8n-nodes-base.code", 2, [520, 0], { jsCode: route }),
    ],
    connections: {
      "XRE Webhook": link("İmzayı doğrula"),
      "İmzayı doğrula": link("Olaya göre yönlendir"),
    },
    settings: { executionOrder: "v1" },
  });
}

/** n8n → XRE gelen webhook: müşteri oluşturur veya arama kaydı gönderir. */
export function downloadLeadSenderTemplate(inboundUrl: string) {
  const url = inboundUrl || "https://CRM_ADRESINIZ/api/hooks/in/HOOK_ID/TOKEN";
  download("xre-crm-musteri-gonder.n8n.json", {
    name: "XRE CRM · Müşteri gönder",
    nodes: [
      node("Elle başlat", "n8n-nodes-base.manualTrigger", 1, [0, 0], {}),
      node("Örnek form verisi", "n8n-nodes-base.set", 3.4, [240, 0], {
        mode: "raw",
        jsonOutput:
          '{\n  "name": "Ayşe Demir",\n  "phone": "05550000000",\n  "email": "ayse@example.com",\n  "source": "Meta Lead Ads",\n  "city": "İstanbul",\n  "notes": "Kampanya formu"\n}',
        options: {},
      }),
      node("XRE müşteri oluştur", "n8n-nodes-base.httpRequest", 4.2, [480, 0], {
        method: "POST",
        url: `${url.replace(/\/$/, "")}/lead.create`,
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: "X-Idempotency-Key", value: "={{ $execution.id }}" }],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json) }}",
        options: {},
      }),
    ],
    connections: {
      "Elle başlat": link("Örnek form verisi"),
      "Örnek form verisi": link("XRE müşteri oluştur"),
    },
    settings: { executionOrder: "v1" },
  });
}
