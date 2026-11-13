import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Delete,
  Grid3x3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Play,
  Settings,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { formatPhone } from "../data";
import { webphone, type EndedCall, type PhoneStatus } from "../webphone";
import { comparablePhone, formatCallDuration, type WebphoneConfig } from "../../../../shared/webphone";
import "../webphone.css";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const STATUS_TEXT: Record<PhoneStatus, string> = {
  off: "Telefon kapalı",
  connecting: "Santrale bağlanıyor…",
  ready: "Aramaya hazır",
  error: "Bağlantı hatası",
  "other-tab": "Telefon başka sekmede açık",
};

interface Me {
  extension: string;
  webphone?: { configured: boolean; sipUser: string; hasPassword: boolean };
}

function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/** Üst çubuktaki tarayıcı telefonu: tuş takımı, gelen/giden görüşme ve kişisel SIP ayarı. */
export default function Webphone({ onLead }: { onLead: (id: string) => void }) {
  const { demo, user, workspace, data, request, refresh } = useStore();
  const state = useSyncExternalStore(webphone.subscribe, webphone.getState);
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"dial" | "settings">("dial");
  const [number, setNumber] = useState("");
  const [pad, setPad] = useState(false);
  const [transfer, setTransfer] = useState<string | null>(null);
  const [form, setForm] = useState({ extension: "", sipUser: "", sipPassword: "" });
  const [saving, setSaving] = useState(false);
  const logsOnServer = useRef(false);
  const leadsRef = useRef(data.leads);
  leadsRef.current = data.leads;

  const canCall = Boolean(user) && (user.isOwner || user.permissions?.calls?.write);
  const active = !demo && canCall && workspace?.communication !== false;
  const call = state.call;
  useTicker(Boolean(call));

  const leadFor = (phone: string, leadId?: string) =>
    leadsRef.current.find((l) => l.id === leadId) ||
    (phone.length >= 10 ? leadsRef.current.find((l) => comparablePhone(l.phone) === phone) : undefined);

  const connect = async () => {
    const config = (await request("/api/pbx/webphone")) as WebphoneConfig;
    logsOnServer.current = Boolean(config.serverLogsCalls);
    if (config.enabled) await webphone.start(config);
    else await webphone.stop();
    return config;
  };

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    request("/api/pbx/me")
      .then((r: Me) => {
        if (cancelled) return;
        setMe(r);
        setForm({ extension: r.extension || "", sipUser: r.webphone?.sipUser || "", sipPassword: "" });
        if (r.webphone?.configured && r.webphone.hasPassword) void connect().catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void webphone.stop();
    };
  }, [active, user?.openId]);

  useEffect(() => {
    if (!active) return;
    webphone.onNotice = (message, kind) => (kind === "error" ? toast.error(message) : toast.info(message));
    webphone.onEnded = (ended: EndedCall) => {
      setPad(false);
      setTransfer(null);
      if (logsOnServer.current) return void window.setTimeout(() => void refresh().catch(() => undefined), 2500);
      request("/api/pbx/webphone/log", ended)
        .then(() => refresh())
        .catch(() => undefined);
    };
    const dial = (e: Event) => {
      const detail = (e as CustomEvent).detail as { phone?: string; leadId?: string };
      if (!detail?.phone) return;
      setOpen(true);
      setView("dial");
      void webphone.dial(detail.phone, detail.leadId);
    };
    window.addEventListener("xre:webphone-dial", dial);
    return () => window.removeEventListener("xre:webphone-dial", dial);
  }, [active]);

  // Gelen aramada panel kendiliğinden açılır.
  useEffect(() => {
    if (call?.phase !== "incoming") return;
    setOpen(true);
    setView("dial");
    const lead = leadFor(call.phone);
    if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted")
      new Notification(`Gelen arama · ${lead?.name || call.label}`, { tag: call.id });
  }, [call?.id, call?.phase]);

  if (!active || !me?.webphone?.configured) return null;

  const lead = call ? leadFor(call.phone, call.leadId) : undefined;
  const title = call ? lead?.name || (call.phone.length >= 10 ? formatPhone(`+${call.phone}`) : call.label) : "";
  const dot = call ? "busy" : state.status;

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = { extension: form.extension, sipUser: form.sipUser };
      if (form.sipPassword) body.sipPassword = form.sipPassword;
      const saved = (await request("/api/pbx/me", body, "PUT")) as Me;
      setMe({ ...me, ...saved });
      setForm((f) => ({ ...f, sipPassword: "" }));
      const config = await connect();
      if (config.enabled) setView("dial");
      else toast.error("Dahili (veya SIP kullanıcı adı) ve SIP şifresi gerekli.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      const saved = (await request("/api/pbx/me", { sipPassword: "" }, "PUT")) as Me;
      setMe({ ...me, ...saved });
      await webphone.stop();
      toast.success("SIP şifreniz silindi, telefon kapatıldı.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const press = (key: string) => {
    if (call?.phase === "active") webphone.sendDtmf(key);
    else setNumber((n) => (n + key).slice(0, 32));
  };

  const startCall = () => {
    if (!number.trim()) return;
    void webphone.dial(number).then((ok) => ok && setNumber(""));
  };

  const keypad = (
    <div className="wp-keys">
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => press(k)} aria-label={`Tuş ${k}`}>
          {k}
        </button>
      ))}
    </div>
  );

  return (
    <div className="wp-wrap">
      <button
        className={`icon-button wp-toggle ${open ? "selected" : ""}`}
        aria-label={`Telefon · ${call ? "Görüşme sürüyor" : STATUS_TEXT[state.status]}`}
        title={`Telefon · ${call ? "Görüşme sürüyor" : STATUS_TEXT[state.status]}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Phone size={16} />
        <i className={`wp-dot ${dot}`} />
      </button>
      {open && (
        <section className="wp-panel" aria-label="Tarayıcı telefonu">
          <header>
            <span className={`wp-dot ${dot}`} />
            <strong>{call ? "Görüşme" : STATUS_TEXT[state.status]}</strong>
            {me.extension && <small>Dahili {me.extension}</small>}
            <button
              className={`icon-button ${view === "settings" ? "selected" : ""}`}
              aria-label="Telefon ayarları"
              onClick={() => setView((v) => (v === "settings" ? "dial" : "settings"))}
            >
              <Settings size={15} />
            </button>
            <button className="icon-button" aria-label="Telefonu küçült" onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </header>

          {call ? (
            <div className="wp-call">
              <span className={`wp-avatar ${call.phase}`}>
                {call.phase === "incoming" ? <PhoneIncoming size={22} /> : <Phone size={22} />}
              </span>
              <strong>{title}</strong>
              <small>
                {call.phase === "incoming"
                  ? "Gelen arama"
                  : call.phase === "dialing"
                    ? "Aranıyor…"
                    : call.phase === "ringing"
                      ? "Çalıyor…"
                      : `${call.held ? "Beklemede · " : ""}${formatCallDuration((Date.now() - (call.answeredAt || Date.now())) / 1000)}`}
                {lead?.company ? ` · ${lead.company}` : ""}
              </small>
              {lead && (
                <button className="btn secondary small" onClick={() => onLead(lead.id)}>
                  <ArrowUpRight size={14} /> Müşteri kartı
                </button>
              )}
              {call.phase === "incoming" ? (
                <div className="wp-answer">
                  <button className="wp-round reject" aria-label="Reddet" onClick={() => void webphone.hangup()}>
                    <PhoneOff size={20} />
                  </button>
                  <button className="wp-round accept" aria-label="Yanıtla" onClick={() => void webphone.answer()}>
                    <Phone size={20} />
                  </button>
                </div>
              ) : (
                <>
                  {call.phase === "active" && (
                    <div className="wp-tools">
                      <button className={call.muted ? "on" : ""} onClick={() => webphone.toggleMute()}>
                        {call.muted ? <MicOff size={17} /> : <Mic size={17} />}
                        {call.muted ? "Sesi aç" : "Sessiz"}
                      </button>
                      <button className={call.held ? "on" : ""} onClick={() => void webphone.toggleHold()}>
                        {call.held ? <Play size={17} /> : <Pause size={17} />}
                        {call.held ? "Devam" : "Beklet"}
                      </button>
                      <button className={pad ? "on" : ""} onClick={() => setPad((p) => !p)}>
                        <Grid3x3 size={17} />
                        Tuşlar
                      </button>
                      <button className={transfer !== null ? "on" : ""} onClick={() => setTransfer((t) => (t === null ? "" : null))}>
                        <ArrowRightLeft size={17} />
                        Aktar
                      </button>
                    </div>
                  )}
                  {call.phase === "active" && pad && keypad}
                  {call.phase === "active" && transfer !== null && (
                    <form
                      className="wp-transfer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void webphone.transfer(transfer).then((ok) => ok && setTransfer(null));
                      }}
                    >
                      <input
                        autoFocus
                        value={transfer}
                        inputMode="tel"
                        placeholder="Dahili veya numara"
                        aria-label="Aktarılacak numara"
                        onChange={(e) => setTransfer(e.target.value.replace(/[^\d+*#]/g, "").slice(0, 20))}
                      />
                      <button className="btn primary small" disabled={!transfer}>
                        Aktar
                      </button>
                    </form>
                  )}
                  <button className="wp-round reject" aria-label="Görüşmeyi bitir" onClick={() => void webphone.hangup()}>
                    <PhoneOff size={20} />
                  </button>
                </>
              )}
            </div>
          ) : view === "settings" || !me.webphone.hasPassword ? (
            <form
              className="wp-settings"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <p>Santraldeki dahili bilgilerinizi girin. Şifreniz şifrelenerek saklanır ve yalnız sizin tarayıcınıza gönderilir.</p>
              <label>
                Dahili numaranız
                <input
                  value={form.extension}
                  inputMode="numeric"
                  placeholder="101"
                  onChange={(e) => setForm({ ...form, extension: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                />
              </label>
              <label>
                SIP kullanıcı adı <em>(dahiliden farklıysa)</em>
                <input
                  value={form.sipUser}
                  autoComplete="off"
                  placeholder="ör. 8501234567-101"
                  onChange={(e) => setForm({ ...form, sipUser: e.target.value.trim().slice(0, 64) })}
                />
              </label>
              <label>
                SIP şifresi
                <input
                  type="password"
                  value={form.sipPassword}
                  autoComplete="new-password"
                  placeholder={me.webphone.hasPassword ? "Kayıtlı · değiştirmek için yazın" : "Santraldeki dahili şifresi"}
                  onChange={(e) => setForm({ ...form, sipPassword: e.target.value })}
                />
              </label>
              <div className="wp-settings-actions">
                {me.webphone.hasPassword && (
                  <button type="button" className="btn secondary small" disabled={saving} onClick={() => void disconnect()}>
                    Şifreyi sil
                  </button>
                )}
                <button
                  className="btn primary small"
                  disabled={saving || (!form.extension && !form.sipUser) || (!form.sipPassword && !me.webphone.hasPassword)}
                >
                  {saving ? "Kaydediliyor…" : "Kaydet ve bağlan"}
                </button>
              </div>
            </form>
          ) : (
            <div className="wp-dial">
              {state.status === "error" && <p className="wp-error">{state.error}</p>}
              {state.status === "other-tab" && (
                <p className="wp-hint">Telefon diğer CRM sekmenizde kayıtlı. Buradan başlattığınız aramalar o sekmeden yapılır.</p>
              )}
              <form
                className="wp-number"
                onSubmit={(e) => {
                  e.preventDefault();
                  startCall();
                }}
              >
                <input
                  value={number}
                  inputMode="tel"
                  placeholder="Numara veya dahili"
                  aria-label="Aranacak numara"
                  onChange={(e) => setNumber(e.target.value.replace(/[^\d+*#\s()-]/g, "").slice(0, 32))}
                />
                {number && (
                  <button type="button" className="icon-button" aria-label="Son rakamı sil" onClick={() => setNumber((n) => n.slice(0, -1))}>
                    <Delete size={16} />
                  </button>
                )}
              </form>
              {keypad}
              <button
                className="wp-round accept"
                aria-label="Ara"
                disabled={!number.trim() || (state.status !== "ready" && state.status !== "other-tab")}
                onClick={startCall}
              >
                <Phone size={20} />
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
