import { createMockProvider } from './mock.js';
import { createVerimorProvider } from './verimor.js';
import { createAsteriskProvider } from './asterisk.js';

/**
 * Her santral adaptörü şu arayüzü uygular:
 *   originate({ agentExtension, agentPhone, customerPhone, callerId, announcement }) → { providerCallId }
 *   parseEvent(body)          → { providerCallId, direction, customerPhone, dialedNumber, status, durationSec, recordingRef }
 *   parseRouteRequest(body)   → { callerPhone, dialedNumber, providerCallId }
 *   formatRouteResponse(decision) → santralin beklediği cevap (nesne → JSON, metin → düz metin)
 *   fetchRecording(ref)       → fetch Response (ses dosyası)
 */
export function createProvider(pbx) {
  switch (pbx.provider) {
    case 'mock': return createMockProvider();
    case 'verimor': return createVerimorProvider(pbx.verimor);
    case 'asterisk': return createAsteriskProvider(pbx.asterisk);
    default: throw new Error(`Bilinmeyen santral sağlayıcı: ${pbx.provider}`);
  }
}
