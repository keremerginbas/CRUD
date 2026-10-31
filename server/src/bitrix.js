import { toLocalFormat } from './phone.js';

// Bitrix24 gelen webhook'u ile REST çağrısı. Webhook URL'si: https://<portal>/rest/<kullanici_id>/<anahtar>
// Gerekli izinler: telephony, crm, user
export function createBitrix(webhookUrl) {
  if (!webhookUrl) return null;
  const base = webhookUrl.replace(/\/+$/, '');
  return {
    async call(method, params) {
      const res = await fetch(`${base}/${method}.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(`Bitrix ${method}: ${data.error_description ?? data.error ?? res.status}`);
      return data.result;
    },
  };
}

const STATUS_CODE = { completed: '200', missed: '304', failed: '603' };

// Biten çağrıyı Bitrix CRM'e yazar: müşteri kartında arama aktivitesi + ses kaydı.
// Kayıtlı olmayan numara için Bitrix yeni potansiyel müşteri (lead) açar.
export async function syncCallToBitrix({ bitrix, provider, call, bitrixUserId }) {
  const callId = (await bitrix.call('telephony.externalcall.register', {
    USER_ID: bitrixUserId,
    PHONE_NUMBER: toLocalFormat(call.customer_phone),
    TYPE: call.direction === 'outbound' ? 1 : 2,
    CALL_START_DATE: new Date(`${call.started_at.replace(' ', 'T')}Z`).toISOString(),
    LINE_NUMBER: call.dialed_number ? toLocalFormat(call.dialed_number) : undefined,
    CRM_CREATE: 1,
    SHOW: 0,
  })).CALL_ID;

  await bitrix.call('telephony.externalcall.finish', {
    CALL_ID: callId,
    USER_ID: bitrixUserId,
    DURATION: call.duration_sec,
    STATUS_CODE: STATUS_CODE[call.status] ?? '200',
  });

  if (call.recording_ref && call.status === 'completed') {
    const rec = await provider.fetchRecording(call.recording_ref);
    if (rec.ok) {
      await bitrix.call('telephony.externalcall.attachRecord', {
        CALL_ID: callId,
        FILENAME: `kayit-${call.id}.mp3`,
        FILE_CONTENT: Buffer.from(await rec.arrayBuffer()).toString('base64'),
      });
    }
  }
  return callId;
}
