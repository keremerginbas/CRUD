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

  const ariJson = async (path) => {
    const res = await ari(path);
    if (!res.ok) throw new Error(`ARI ${path}: ${res.status}`);
    return res.json();
  };

  return {
    name: 'asterisk',
    supportsBrowserPhone: true,

    // Santral durumu (yönetici ekranı): sürüm, açılış zamanı, operatör bağlantıları, açık paneller, süren görüşmeler
    async status() {
      const [info, endpoints, channels] = await Promise.all([
        ariJson('/asterisk/info?only=build,system,status'),
        ariJson('/endpoints/PJSIP'),
        ariJson('/channels'),
      ]);
      const isBrowser = (r) => /^u\d+$/.test(r);
      return {
        version: info.system?.version ?? null,
        startedAt: info.status?.startup_time ?? null,
        trunks: endpoints.filter((e) => !isBrowser(e.resource)).map((e) => ({
          name: e.resource, state: e.state, channels: e.channel_ids?.length ?? 0,
          isDefault: e.resource === trunk, isAgent: e.resource === agentTrunk,
        })),
        browsersOnline: endpoints.filter((e) => isBrowser(e.resource) && e.state === 'online').map((e) => Number(e.resource.slice(1))),
        channels: channels.map((c) => ({
          id: c.id, name: c.name, state: c.state, caller: c.caller?.number ?? '', connected: c.connected?.number ?? '',
          exten: c.dialplan?.exten ?? '', createdAt: c.creationtime,
        })),
      };
    },

    async originate({ agentPhone, customerPhone, callerId, trunk: lineTrunk }) {
      const id = `xre-${randomUUID()}`;
      const line = toLocalFormat(callerId);
      const params = new URLSearchParams({
        endpoint: `PJSIP/${toLocalFormat(agentPhone)}@${agentTrunk}`,
        context: 'xre-click2call', extension: 's', priority: '1',
        callerId: line, timeout: '30', channelId: id,
      });
      const res = await ari(`/channels?${params}`, {
        method: 'POST',
        // XRE_LINE_TRUNK: hattın bağlı olduğu operatör bağlantısı; müşteri o bağlantıdan aranır
        body: JSON.stringify({ variables: {
          XRE_CUSTOMER: toLocalFormat(customerPhone), XRE_LINE: line, ...(lineTrunk && { XRE_LINE_TRUNK: lineTrunk }),
        } }),
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

    // trunk: aramanın geldiği operatör bağlantısı (santraldeki endpoint adı)
    // ext: karşılama hattında arayanın tuşladığı dahili
    parseRouteRequest: (body) => ({
      callerPhone: body.from, dialedNumber: body.to, providerCallId: body.callId, trunk: body.trunk, extension: body.ext,
    }),

    // 5. alan: danışmanın tarayıcı telefonu (u<id>); panelde açıksa önce orası çalar.
    //   Asistana giden aramada asistanların tarayıcı telefonları (u5&u6): boştakiler birlikte çalar
    // 6. alan: 1 ise karşılama hattı; santral "dahili numarayı tuşlayın" anonsunu çalar
    // 7. alan: danışmanın panelinde arayan adı yerine görünecek metin (ilana aktarma)
    formatRouteResponse(decision) {
      if (decision.action === 'reject') return 'reject,,0,0,';
      const ivr = decision.ivr ? ',1' : '';
      const group = (decision.browserGroup ?? []).join('&');
      if (decision.action !== 'forward') return `queue,,0,0,${group}${ivr}`;
      const browser = !decision.reason && decision.userId ? `u${decision.userId}` : group;
      const fields = ['forward', toLocalFormat(decision.destination), decision.callerAnnouncement ? 1 : 0, decision.whisper ? 1 : 0, browser];
      // 7. alan: danışmanın panelinde görünecek ad (ilana aktarma); dialplan'ı bozmasın diye harf/rakam/boşluk/.-/ dışı atılır
      if (decision.callerName) return [...fields, decision.ivr ? 1 : '', String(decision.callerName).replace(/[^\p{L}\p{N} .\/-]/gu, ' ')].join(',');
      return fields.join(',') + ivr;
    },

    fetchRecording: (ref) => ari(`/recordings/stored/${encodeURIComponent(ref)}/file`),
  };
}
