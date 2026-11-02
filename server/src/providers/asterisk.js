import { randomUUID } from 'node:crypto';
import { toLocalFormat } from '../phone.js';

/**
 * Kendi Asterisk santralimiz (pbx/ klasöründeki ayarlarla).
 * - Arama başlatma: ARI ile önce danışmanın cebi aranır, açınca dialplan (xre-click2call) müşteriyi
 *   danışmanın hattından arar.
 * - Gelen arama: dialplan (from-trunk) /webhooks/pbx/route'a sorar; cevap düz metindir:
 *   "eylem,hedef,arayana_anons,danismana_anons" (dialplan'da CUT ile ayrıştırılır).
 * - Olaylar: dialplan kapanışta (xre-hangup) /webhooks/pbx/event'e form gövdesi gönderir.
 * - Kayıtlar: /var/spool/asterisk/recording altında, ARI "stored recordings" ile indirilir.
 */
export function createAsteriskProvider({ ariUrl, ariUser, ariPassword, trunk = 'trunk', agentTrunk = trunk }) {
  if (!ariUrl || !ariUser || !ariPassword) throw new Error('ASTERISK_ARI_URL / ASTERISK_ARI_USER / ASTERISK_ARI_PASSWORD tanımlı değil');
  const auth = `Basic ${Buffer.from(`${ariUser}:${ariPassword}`).toString('base64')}`;
  const ari = (path, init = {}) => fetch(new URL(`/ari${path}`, ariUrl), {
    ...init,
    headers: { authorization: auth, 'content-type': 'application/json', ...init.headers },
  });

  return {
    name: 'asterisk',
    supportsBrowserPhone: true,

    async originate({ agentPhone, customerPhone, callerId }) {
      const id = `xre-${randomUUID()}`;
      const line = toLocalFormat(callerId);
      const params = new URLSearchParams({
        endpoint: `PJSIP/${toLocalFormat(agentPhone)}@${agentTrunk}`,
        context: 'xre-click2call', extension: 's', priority: '1',
        callerId: line, timeout: '30', channelId: id,
      });
      const res = await ari(`/channels?${params}`, {
        method: 'POST',
        body: JSON.stringify({ variables: { XRE_CUSTOMER: toLocalFormat(customerPhone), XRE_LINE: line } }),
      });
      if (!res.ok) throw new Error(`Asterisk arama başlatamadı (${res.status}): ${await res.text()}`);
      return { providerCallId: id };
    },

    // Dialplan gelen aramada from/to, giden aramada to=müşteri ve callerId=hat gönderir
    parseEvent: (body) => ({
      providerCallId: body.callId,
      direction: body.direction === 'outbound' ? 'outbound' : 'inbound',
      customerPhone: body.direction === 'outbound' ? body.to : body.from,
      dialedNumber: body.direction === 'outbound' ? body.callerId : body.to,
      status: ['completed', 'missed', 'failed'].includes(body.status) ? body.status : 'completed',
      durationSec: Number(body.duration) || 0,
      recordingRef: body.recording || null,
    }),

    parseRouteRequest: (body) => ({ callerPhone: body.from, dialedNumber: body.to, providerCallId: body.callId }),

    // 5. alan: danışmanın tarayıcı telefonu (u<id>); panelde açıksa önce orası çalar
    formatRouteResponse(decision) {
      if (decision.action !== 'forward') return 'queue,,0,0,';
      const browser = !decision.reason && decision.userId ? `u${decision.userId}` : '';
      return ['forward', toLocalFormat(decision.destination), decision.callerAnnouncement ? 1 : 0, decision.whisper ? 1 : 0, browser].join(',');
    },

    fetchRecording: (ref) => ari(`/recordings/stored/${encodeURIComponent(ref)}/file`),
  };
}
