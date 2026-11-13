// Tarayıcı telefonu motoru: SIP.js ile santrale WSS üzerinden kaydolur, arama
// yapar ve karşılar. Arayüzden bağımsızdır; durum değişikliklerini abonelere bildirir.
// SIP.js yalnız telefon gerçekten açıldığında yüklenir (ilk açılışı ağırlaştırmaz).
import type { Invitation, Inviter, Registerer, Session, UserAgent } from "sip.js";
import { comparablePhone, sipTargetUri, type WebphoneConfig } from "../../../shared/webphone";

export type PhoneStatus = "off" | "connecting" | "ready" | "error" | "other-tab";
export type CallPhase = "incoming" | "dialing" | "ringing" | "active";

export interface PhoneCall {
  id: string;
  direction: "inbound" | "outbound";
  /** Karşı tarafın numarası (yalnız rakam, mümkünse 905xxxxxxxxx). */
  phone: string;
  /** Ekranda gösterilecek ham numara/ad. */
  label: string;
  phase: CallPhase;
  startedAt: number;
  answeredAt?: number;
  muted: boolean;
  held: boolean;
  leadId?: string;
}

export interface EndedCall {
  sessionId: string;
  direction: "inbound" | "outbound";
  phone: string;
  answered: boolean;
  durationSeconds: number;
  startedAt: string;
  endedAt: string;
  leadId?: string;
}

export interface PhoneState {
  status: PhoneStatus;
  error?: string;
  call: PhoneCall | null;
}

type Listener = () => void;
type SipModule = typeof import("sip.js");

const LOCK_NAME = "xre-webphone";
const CHANNEL_NAME = "xre-webphone";

function describeMediaError(error: unknown): string {
  const name = (error as { name?: string })?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Mikrofon izni verilmedi. Adres çubuğundaki kilit simgesinden mikrofona izin verin.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Mikrofon bulunamadı. Kulaklığınızı takıp tekrar deneyin.";
  if (name === "NotReadableError") return "Mikrofon başka bir uygulama tarafından kullanılıyor.";
  return (error as Error)?.message || "Arama başlatılamadı.";
}

function rejectReason(status?: number): string {
  if (!status) return "Arama tamamlanamadı.";
  if (status === 486 || status === 600) return "Numara meşgul.";
  if (status === 480 || status === 408) return "Yanıt yok.";
  if (status === 404 || status === 484 || status === 604) return "Numara bulunamadı.";
  if (status === 403 || status === 401 || status === 407) return "Santral bu aramaya izin vermedi.";
  if (status === 487) return "";
  if (status === 603) return "Arama reddedildi.";
  if (status >= 500) return `Santral hatası (${status}).`;
  return `Arama tamamlanamadı (${status}).`;
}

export class Webphone {
  private state: PhoneState = { status: "off", call: null };
  private listeners = new Set<Listener>();
  private sip: SipModule | null = null;
  private ua: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private session: Session | null = null;
  private config: WebphoneConfig | null = null;
  private audio: HTMLAudioElement | null = null;
  private tones = new Tones();
  private generation = 0;
  private reconnectTimer: number | undefined;
  private reconnectAttempt = 0;
  private releaseLock: (() => void) | null = null;
  private channel: BroadcastChannel | null = null;
  private unload = () => this.shutdown();

  /** Görüşme bittiğinde çağrılır (arama kaydı için). */
  onEnded: (call: EndedCall) => void = () => {};
  /** Kullanıcıya gösterilecek kısa bilgi/hata. */
  onNotice: (message: string, kind: "info" | "error") => void = () => {};

  getState = () => this.state;
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<PhoneState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private patchCall(patch: Partial<PhoneCall>) {
    if (this.state.call) this.set({ call: { ...this.state.call, ...patch } });
  }

  /**
   * Telefonu açar. Aynı dahili iki sekmede birden kaydolursa santral eskisini
   * düşürür; bu yüzden yalnız kilidi alan sekme kaydolur, diğerleri ona aktarır.
   */
  async start(config: WebphoneConfig): Promise<void> {
    await this.stop();
    if (!config.enabled || !config.wssUrl || !config.domain || !config.authUser) return;
    const generation = ++this.generation;
    this.config = config;
    this.openChannel();
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      this.set({ status: "other-tab", error: undefined });
      void navigator.locks.request(LOCK_NAME, () => {
        if (generation !== this.generation) return undefined;
        return new Promise<void>((resolve) => {
          this.releaseLock = resolve;
          void this.connect(generation);
        });
      });
    } else await this.connect(generation);
  }

  private openChannel() {
    if (typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => {
      const message = event.data as { type?: string; phone?: string; leadId?: string };
      if (message?.type === "dial" && message.phone && this.ua && this.state.status === "ready")
        void this.dial(message.phone, message.leadId);
    };
  }

  private async connect(generation: number) {
    const config = this.config!;
    this.set({ status: "connecting", error: undefined });
    try {
      const sip = (this.sip ||= await import("sip.js"));
      if (generation !== this.generation) return;
      const uri = sip.UserAgent.makeURI(`sip:${config.authUser}@${config.domain}`);
      if (!uri) throw new Error("SIP adresi geçersiz. Dahili ve alan adını kontrol edin.");
      const ua = new sip.UserAgent({
        uri,
        transportOptions: { server: config.wssUrl, keepAliveInterval: 30, connectionTimeout: 10 },
        authorizationUsername: config.authUser,
        authorizationPassword: config.password,
        displayName: config.displayName || undefined,
        userAgentString: "XRE CRM Webphone",
        logLevel: "error",
        sessionDescriptionHandlerFactoryOptions: {
          iceGatheringTimeout: 2500,
          peerConnectionConfiguration: { iceServers: config.iceServers || [] },
        },
        delegate: {
          onInvite: (invitation) => this.incoming(invitation),
          onDisconnect: (error) => {
            // error yoksa bağlantıyı biz kapattık.
            if (error && generation === this.generation) this.scheduleReconnect(generation);
          },
        },
      });
      this.ua = ua;
      await ua.start();
      if (generation !== this.generation) return void ua.stop();
      await this.register(generation);
      window.addEventListener("pagehide", this.unload);
    } catch (error) {
      if (generation !== this.generation) return;
      this.set({ status: "error", error: (error as Error).message || "Santrale bağlanılamadı." });
      this.scheduleReconnect(generation);
    }
  }

  private async register(generation: number) {
    const sip = this.sip!;
    const registerer = new sip.Registerer(this.ua!, { expires: 300 });
    this.registerer = registerer;
    registerer.stateChange.addListener((state) => {
      if (generation !== this.generation || this.registerer !== registerer) return;
      if (state === sip.RegistererState.Registered) {
        this.reconnectAttempt = 0;
        this.set({ status: "ready", error: undefined });
      } else if (state === sip.RegistererState.Unregistered && this.state.status === "ready") this.set({ status: "connecting" });
    });
    await registerer.register({
      requestDelegate: {
        onReject: (response) => {
          if (generation !== this.generation) return;
          const code = response.message.statusCode;
          this.set({
            status: "error",
            error: code === 401 || code === 403 ? "Santral girişi reddetti. Dahili/SIP şifrenizi kontrol edin." : `Santral kaydı reddedildi (${code}).`,
          });
        },
      },
    });
  }

  private scheduleReconnect(generation: number) {
    window.clearTimeout(this.reconnectTimer);
    if (this.state.status !== "error") this.set({ status: "connecting" });
    const delay = Math.min(30_000, 2000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = window.setTimeout(async () => {
      if (generation !== this.generation || !this.ua) return;
      try {
        if (!this.ua.isConnected()) await this.ua.reconnect();
        await this.register(generation);
      } catch {
        this.scheduleReconnect(generation);
      }
    }, delay);
  }

  private shutdown() {
    // Sayfa kapanırken santral kaydını düşür (SIP.js 0.21 bunu kendisi yapmaz).
    try {
      if (this.session) void this.terminate(this.session).catch(() => undefined);
      void this.registerer?.unregister();
      void this.ua?.stop();
    } catch {
      /* kapanıyor */
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    window.clearTimeout(this.reconnectTimer);
    window.removeEventListener("pagehide", this.unload);
    this.tones.stop();
    this.channel?.close();
    this.channel = null;
    const { ua, registerer, session } = this;
    this.ua = this.registerer = this.session = null;
    try {
      if (session) await this.terminate(session);
      await registerer?.unregister();
      await ua?.stop();
    } catch {
      /* zaten kapalı */
    }
    this.releaseLock?.();
    this.releaseLock = null;
    this.config = null;
    this.reconnectAttempt = 0;
    this.set({ status: "off", error: undefined, call: null });
  }

  // -------------------------------------------------------------------------
  // Arama
  // -------------------------------------------------------------------------

  async dial(rawNumber: string, leadId?: string): Promise<boolean> {
    const config = this.config;
    if (this.state.status === "other-tab") {
      // Telefon başka sekmede kayıtlı: aramayı o sekmeye devret.
      this.channel?.postMessage({ type: "dial", phone: rawNumber, leadId });
      this.onNotice("Arama, telefonun açık olduğu diğer CRM sekmesinden başlatılıyor.", "info");
      return true;
    }
    if (!config || !this.ua || !this.sip || this.state.status !== "ready") {
      this.onNotice(this.state.error || "Telefon santrale bağlı değil.", "error");
      return false;
    }
    if (this.session) {
      this.onNotice("Devam eden bir görüşme var.", "error");
      return false;
    }
    const target = this.sip.UserAgent.makeURI(sipTargetUri(rawNumber, config.domain!, config.dialPrefix || ""));
    if (!target) {
      this.onNotice("Geçerli bir numara yazın.", "error");
      return false;
    }
    const sip = this.sip;
    const inviter = new sip.Inviter(this.ua, target, {
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
      earlyMedia: true,
    });
    this.track(inviter, {
      id: crypto.randomUUID(),
      direction: "outbound",
      phone: comparablePhone(rawNumber),
      label: rawNumber.trim(),
      phase: "dialing",
      startedAt: Date.now(),
      muted: false,
      held: false,
      leadId,
    });
    try {
      await inviter.invite({
        requestDelegate: {
          onProgress: (response) => {
            if (this.session !== inviter) return;
            this.patchCall({ phase: "ringing" });
            // 183 + SDP: operatörün kendi çalma sesi gelir; yoksa yerel ton çalınır.
            if (response.message.body) this.tones.stop();
            else this.tones.ringback();
          },
          onReject: (response) => {
            const reason = rejectReason(response.message.statusCode);
            if (reason) this.onNotice(reason, "error");
          },
        },
      });
      return true;
    } catch (error) {
      this.finish(inviter);
      this.onNotice(describeMediaError(error), "error");
      return false;
    }
  }

  private incoming(invitation: Invitation) {
    if (this.session) return void invitation.reject({ statusCode: 486 }).catch(() => undefined);
    const identity = invitation.remoteIdentity;
    const user = identity.uri.user || "";
    this.track(invitation, {
      id: crypto.randomUUID(),
      direction: "inbound",
      phone: comparablePhone(user),
      label: identity.displayName && identity.displayName !== user ? `${identity.displayName} · ${user}` : user || "Gizli numara",
      phase: "incoming",
      startedAt: Date.now(),
      muted: false,
      held: false,
    });
    this.tones.ring();
  }

  private track(session: Inviter | Invitation, call: PhoneCall) {
    const sip = this.sip!;
    this.session = session;
    this.set({ call });
    session.stateChange.addListener((state) => {
      if (this.session !== session) return;
      if (state === sip.SessionState.Establishing) this.attachAudio(session);
      else if (state === sip.SessionState.Established) {
        this.tones.stop();
        this.attachAudio(session);
        this.patchCall({ phase: "active", answeredAt: Date.now() });
      } else if (state === sip.SessionState.Terminated) this.finish(session);
    });
  }

  private attachAudio(session: Session) {
    const handler = session.sessionDescriptionHandler as { remoteMediaStream?: MediaStream } | undefined;
    const stream = handler?.remoteMediaStream;
    if (!stream) return;
    if (!this.audio) {
      this.audio = document.createElement("audio");
      this.audio.autoplay = true;
      this.audio.setAttribute("data-xre-webphone", "");
      this.audio.style.display = "none";
      document.body.appendChild(this.audio);
    }
    // Ses izi akışa sonradan eklenir; yeniden atamak oynatmayı kesin başlatır.
    if (this.audio.srcObject !== stream || this.audio.currentTime === 0) this.audio.srcObject = stream;
    void this.audio.play().catch(() => undefined);
  }

  private finish(session: Session) {
    if (this.session !== session) return;
    this.session = null;
    this.tones.stop();
    if (this.audio) this.audio.srcObject = null;
    const call = this.state.call;
    this.set({ call: null });
    if (!call) return;
    const end = Date.now();
    this.onEnded({
      sessionId: call.id,
      direction: call.direction,
      phone: call.phone,
      answered: Boolean(call.answeredAt),
      durationSeconds: call.answeredAt ? Math.round((end - call.answeredAt) / 1000) : 0,
      startedAt: new Date(call.startedAt).toISOString(),
      endedAt: new Date(end).toISOString(),
      leadId: call.leadId,
    });
  }

  async answer(): Promise<void> {
    const session = this.session;
    if (!session || this.state.call?.phase !== "incoming") return;
    this.tones.stop();
    try {
      await (session as Invitation).accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    } catch (error) {
      this.onNotice(describeMediaError(error), "error");
      await this.terminate(session).catch(() => undefined);
      this.finish(session);
    }
  }

  async hangup(): Promise<void> {
    const session = this.session;
    if (!session) return;
    try {
      await this.terminate(session);
    } catch {
      this.finish(session);
    }
  }

  private async terminate(session: Session) {
    const sip = this.sip!;
    const state = session.state;
    if (state === sip.SessionState.Established) await session.bye();
    else if (state === sip.SessionState.Initial || state === sip.SessionState.Establishing) {
      if (session instanceof sip.Inviter) await session.cancel();
      else await (session as Invitation).reject({ statusCode: 486 });
    }
  }

  setLead(leadId: string | undefined) {
    this.patchCall({ leadId });
  }

  toggleMute() {
    const call = this.state.call;
    if (!call || !this.session) return;
    const muted = !call.muted;
    this.applyMute(muted || call.held);
    this.patchCall({ muted });
  }

  private applyMute(silent: boolean) {
    const pc = (this.session?.sessionDescriptionHandler as { peerConnection?: RTCPeerConnection } | undefined)?.peerConnection;
    pc?.getSenders().forEach((sender) => {
      if (sender.track) sender.track.enabled = !silent;
    });
  }

  async toggleHold(): Promise<void> {
    const call = this.state.call;
    const session = this.session;
    if (!call || !session || call.phase !== "active") return;
    const held = !call.held;
    try {
      await session.invite({
        sessionDescriptionHandlerOptions: { hold: held, constraints: { audio: true, video: false } } as never,
      });
      this.patchCall({ held });
      this.applyMute(held || call.muted);
    } catch {
      this.onNotice("Bekletme şu an yapılamadı.", "error");
    }
  }

  /** Görüşme sırasında tuşlama (IVR menüleri için). */
  sendDtmf(tone: string) {
    if (!/^[0-9*#]$/.test(tone) || this.state.call?.phase !== "active") return;
    const handler = this.session?.sessionDescriptionHandler as { sendDtmf?: (tones: string) => boolean } | undefined;
    this.tones.key();
    if (!handler?.sendDtmf?.(tone)) {
      // RFC 2833 desteklenmiyorsa SIP INFO ile gönder.
      void this.session?.info({
        requestOptions: { body: { contentDisposition: "render", contentType: "application/dtmf-relay", content: `Signal=${tone}\r\nDuration=160` } },
      });
    }
  }

  /** Görüşmeyi başka dahiliye/numaraya doğrudan aktarır. */
  async transfer(rawNumber: string): Promise<boolean> {
    const config = this.config;
    const session = this.session;
    if (!config || !session || !this.sip || this.state.call?.phase !== "active") return false;
    const target = this.sip.UserAgent.makeURI(sipTargetUri(rawNumber, config.domain!, config.dialPrefix || ""));
    if (!target) {
      this.onNotice("Aktarılacak numarayı yazın.", "error");
      return false;
    }
    try {
      await session.refer(target);
      this.onNotice("Görüşme aktarılıyor…", "info");
      return true;
    } catch {
      this.onNotice("Aktarma yapılamadı.", "error");
      return false;
    }
  }
}

/** Zil, çalma ve tuş sesleri (ses dosyası indirmeden Web Audio ile üretilir). */
class Tones {
  private context: AudioContext | null = null;
  private timer: number | undefined;
  private nodes: OscillatorNode[] = [];

  private ctx(): AudioContext | null {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.context ||= new Ctor();
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
    return this.context;
  }

  private beep(frequencies: number[], seconds: number, volume: number) {
    const ctx = this.ctx();
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    for (const frequency of frequencies) {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + seconds);
      this.nodes.push(osc);
      osc.onended = () => {
        this.nodes = this.nodes.filter((n) => n !== osc);
      };
    }
  }

  private loop(play: () => void, everyMs: number) {
    this.stop();
    play();
    this.timer = window.setInterval(play, everyMs);
  }

  ring() {
    this.loop(() => {
      this.beep([440, 480], 0.4, 0.12);
      window.setTimeout(() => this.timer !== undefined && this.beep([440, 480], 0.4, 0.12), 550);
    }, 3000);
  }
  ringback() {
    if (this.timer !== undefined) return;
    this.loop(() => this.beep([450], 1.2, 0.05), 4000);
  }
  key() {
    this.beep([1209, 770], 0.09, 0.04);
  }
  stop() {
    window.clearInterval(this.timer);
    this.timer = undefined;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        /* bitmiş */
      }
    }
    this.nodes = [];
  }
}

export const webphone = new Webphone();

/** Uygulamanın herhangi bir yerinden tarayıcı telefonuyla arama başlatır. */
export function dialWithWebphone(phone: string, leadId?: string) {
  window.dispatchEvent(new CustomEvent("xre:webphone-dial", { detail: { phone, leadId } }));
}
