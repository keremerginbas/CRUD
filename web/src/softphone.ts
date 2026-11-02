// Tarayıcı telefonu: panel santrale (Asterisk) WebRTC ile bağlanır; danışman panelden konuşur.
import { UA, WebSocketInterface } from 'jssip';
import type { RTCSessionEvent } from 'jssip/lib/UA';
import type { RTCSession } from 'jssip/lib/RTCSession';
import { useSyncExternalStore } from 'react';
import { api } from './api';

export type PhoneStatus = 'off' | 'connecting' | 'ready' | 'error';
export type ActiveCall = {
  direction: 'out' | 'in';
  name: string;
  number: string;
  phase: 'calling' | 'ringing' | 'incoming' | 'active';
  startedAt?: number;
  muted: boolean;
};
type State = { status: PhoneStatus; call: ActiveCall | null; error?: string };
type SipInfo = { enabled: boolean; wsUrl: string; domain: string; user: string; password: string };

const PC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const MEDIA = { audio: true, video: false };

let state: State = { status: 'off', call: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const setCall = (patch: Partial<ActiveCall> | null) => set({ call: patch && state.call ? { ...state.call, ...patch } : (patch as ActiveCall | null) });

let ua: UA | null = null;
let session: RTCSession | null = null;
let domain = '';
let onEnded: ((reason: string | null) => void) | null = null;

const remoteAudio = typeof document !== 'undefined' ? Object.assign(document.createElement('audio'), { autoplay: true }) : null;

// Gelen arama zil sesi (dosya gerektirmez)
let ringCtx: AudioContext | null = null;
let ringTimer: number | undefined;
function startRing() {
  stopRing();
  try {
    ringCtx = new AudioContext();
    const beep = () => {
      if (!ringCtx) return;
      for (const offset of [0, 0.5]) {
        const osc = ringCtx.createOscillator();
        const gain = ringCtx.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0.15;
        osc.connect(gain).connect(ringCtx.destination);
        osc.start(ringCtx.currentTime + offset);
        osc.stop(ringCtx.currentTime + offset + 0.4);
      }
    };
    beep();
    ringTimer = window.setInterval(beep, 3000);
  } catch { /* ses desteklenmiyor */ }
}
function stopRing() {
  window.clearInterval(ringTimer);
  ringCtx?.close().catch(() => {});
  ringCtx = null;
}

const FAILURES: Record<string, string> = {
  Busy: 'Numara meşgul',
  Rejected: 'Arama reddedildi',
  Unavailable: 'Numaraya ulaşılamıyor',
  'Not Found': 'Numara bulunamadı',
  'No Answer': 'Cevap verilmedi',
  'User Denied Media Access': 'Mikrofon izni verilmedi. Tarayıcının adres çubuğundan mikrofona izin verin.',
  'Connection Error': 'Santral bağlantısı koptu',
  'Request Timeout': 'Santral cevap vermedi',
  'Authentication Error': 'Santral girişi reddedildi',
};

function bind(s: RTCSession) {
  session = s;
  const attach = (pc: RTCPeerConnection) => pc.addEventListener('track', (e) => {
    if (remoteAudio) remoteAudio.srcObject = e.streams[0];
  });
  if (s.connection) attach(s.connection as unknown as RTCPeerConnection);
  s.on('peerconnection', (e) => attach(e.peerconnection as unknown as RTCPeerConnection));
  s.on('progress', () => { if (state.call?.direction === 'out') setCall({ phase: 'ringing' }); });
  s.on('confirmed', () => { stopRing(); setCall({ phase: 'active', startedAt: Date.now() }); });
  const finish = (reason: string | null) => {
    stopRing();
    session = null;
    setCall(null);
    onEnded?.(reason);
  };
  s.on('ended', () => finish(null));
  s.on('failed', (e) => finish(e.originator === 'local' && e.cause === 'Canceled' ? null : (FAILURES[e.cause] ?? e.cause)));
}

export const softphone = {
  getState: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  onEnded(fn: (reason: string | null) => void) { onEnded = fn; },

  async start(displayName: string) {
    if (ua) return;
    let info: SipInfo;
    try { info = await api<SipInfo>('/api/me/sip'); } catch { return; }
    if (!info.enabled) return;
    domain = info.domain;
    set({ status: 'connecting', error: undefined });
    ua = new UA({
      sockets: [new WebSocketInterface(info.wsUrl)],
      uri: `sip:${info.user}@${info.domain}`,
      password: info.password,
      display_name: displayName,
      register: true,
      session_timers: false,
      user_agent: 'XRE Panel',
    });
    ua.on('registered', () => set({ status: 'ready', error: undefined }));
    ua.on('unregistered', () => set({ status: 'connecting' }));
    ua.on('registrationFailed', (e) => set({ status: 'error', error: FAILURES[e.cause ?? ''] ?? String(e.cause) }));
    ua.on('disconnected', () => { if (state.status !== 'off') set({ status: 'connecting' }); });
    ua.on('newRTCSession', ({ session: s, originator }: RTCSessionEvent) => {
      if (originator !== 'remote') return;
      if (session) { s.terminate({ status_code: 486, reason_phrase: 'Busy Here' }); return; }
      const number = s.remote_identity.uri.user;
      setCall({ direction: 'in', name: s.remote_identity.display_name || number, number, phase: 'incoming', muted: false });
      bind(s);
      startRing();
    });
    ua.start();
  },

  stop() {
    stopRing();
    session?.terminate();
    ua?.stop();
    ua = null;
    session = null;
    set({ status: 'off', call: null });
  },

  // Müşteriyi arar: santral danışmanın hattını gösterir, kaydı başlatır
  call(phone: string, name: string) {
    if (!ua || state.status !== 'ready') throw new Error('Tarayıcı telefonu bağlı değil');
    if (session) throw new Error('Önce süren görüşmeyi kapatın');
    const digits = phone.replace(/\D/g, '').replace(/^90(?=\d{10}$)/, '0');
    setCall({ direction: 'out', name, number: phone, phase: 'calling', muted: false });
    bind(ua.call(`sip:${digits}@${domain}`, { mediaConstraints: MEDIA, pcConfig: PC_CONFIG }));
  },

  answer() { session?.answer({ mediaConstraints: MEDIA, pcConfig: PC_CONFIG }); stopRing(); },
  hangup() { session?.terminate(); },
  toggleMute() {
    if (!session || !state.call) return;
    if (state.call.muted) session.unmute({ audio: true }); else session.mute({ audio: true });
    setCall({ muted: !state.call.muted });
  },
};

export const useSoftphone = () => useSyncExternalStore(softphone.subscribe, softphone.getState);
