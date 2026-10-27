import { toLocalFormat } from '../phone.js';

/**
 * Verimor Bulut Santral adaptörü.
 * Dokümantasyon: https://github.com/verimor/Bulutsantralim-API
 *
 * ÖNEMLİ: Webhook alan adları santral panelindeki webhook ayarına göre değişebilir.
 * Canlıya almadan önce panelden örnek bir istek alıp parseEvent/parseRouteRequest
 * içindeki alan adlarını doğrulayın. Bütün sağlayıcıya özgü bilgi bu dosyadadır.
 */
export function createVerimorProvider({ apiKey, baseUrl }) {
  if (!apiKey) throw new Error('VERIMOR_API_KEY tanımlı değil');

  const pick = (body, ...keys) => keys.map((k) => body[k]).find((v) => v !== undefined && v !== '');

  const STATUS = {
    CHANNEL_CREATE: 'ringing', ringing: 'ringing',
    CHANNEL_ANSWER: 'answered', answered: 'answered',
    CHANNEL_HANGUP: 'completed', hangup: 'completed',
  };

  return {
    name: 'verimor',

    // Click-to-call: santral önce danışmanın dahilisini/telefonunu arar, açınca müşteriyi
    // danışmanın dijital numarası (caller_id) ile arar. Müşteri danışmanın gerçek numarasını görmez.
    async originate({ agentExtension, customerPhone, callerId }) {
      const url = new URL('/originate', baseUrl);
      url.search = new URLSearchParams({
        key: apiKey,
        extension: agentExtension,
        destination: toLocalFormat(customerPhone),
        caller_id: toLocalFormat(callerId).replace(/^0/, ''),
      });
      const res = await fetch(url);
      const text = (await res.text()).trim();
      if (!res.ok) throw new Error(`Verimor originate hatası (${res.status}): ${text}`);
      return { providerCallId: text };
    },

    parseEvent(body) {
      const direction = pick(body, 'direction') === 'outbound' ? 'outbound' : 'inbound';
      const caller = pick(body, 'caller_id_number', 'caller_id', 'from');
      const dest = pick(body, 'destination_number', 'called_number', 'to');
      const answered = Number(pick(body, 'answer_epoch', 'billsec') ?? 0) > 0;
      let status = STATUS[pick(body, 'event_type', 'event', 'status')] ?? 'completed';
      if (status === 'completed' && !answered) status = 'missed';
      return {
        providerCallId: pick(body, 'uuid', 'call_uuid', 'call_id'),
        direction,
        customerPhone: direction === 'outbound' ? dest : caller,
        dialedNumber: direction === 'outbound' ? caller : dest,
        status,
        durationSec: Number(pick(body, 'billsec', 'duration') ?? 0),
        recordingRef: pick(body, 'uuid', 'call_uuid') ?? null,
      };
    },

    parseRouteRequest(body) {
      return {
        callerPhone: pick(body, 'caller_id_number', 'caller_id', 'from'),
        dialedNumber: pick(body, 'destination_number', 'called_number', 'to'),
        providerCallId: pick(body, 'uuid', 'call_uuid'),
      };
    },

    // Dinamik yönlendirme cevabı. Santralin beklediği biçime göre uyarlanmalıdır.
    formatRouteResponse(decision) {
      return decision.action === 'forward'
        ? { action: 'transfer', target: toLocalFormat(decision.destination), announce_text: decision.whisper }
        : { action: 'transfer', target: decision.destination };
    },

    async fetchRecording(recordingRef) {
      const url = new URL(`/recording/${encodeURIComponent(recordingRef)}`, baseUrl);
      url.searchParams.set('key', apiKey);
      return fetch(url);
    },
  };
}
