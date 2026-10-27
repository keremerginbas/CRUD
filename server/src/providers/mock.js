import { randomUUID } from 'node:crypto';

// Gerçek santral olmadan geliştirme ve test için. Webhook gövdeleri zaten normalize biçimdedir.
export function createMockProvider() {
  const originated = [];
  return {
    name: 'mock',
    originated,
    async originate(req) {
      const providerCallId = `mock-${randomUUID()}`;
      originated.push({ ...req, providerCallId });
      return { providerCallId };
    },
    parseEvent: (body) => ({
      providerCallId: body.callId,
      direction: body.direction,
      customerPhone: body.direction === 'outbound' ? body.to : body.from,
      dialedNumber: body.direction === 'outbound' ? body.callerId : body.to,
      status: body.status,
      durationSec: Number(body.duration ?? 0),
      recordingRef: body.recording ?? null,
    }),
    parseRouteRequest: (body) => ({ callerPhone: body.from, dialedNumber: body.to, providerCallId: body.callId }),
    formatRouteResponse: (decision) => decision,
    async fetchRecording() {
      return new Response('mock-audio', { headers: { 'content-type': 'audio/mpeg' } });
    },
  };
}
