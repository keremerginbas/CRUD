import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, QrCode, ShieldCheck, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../store";
import "../login.css";

export interface AuthStatus {
  needsSetup: boolean;
  database?: boolean;
  providers: {
    local: boolean;
    qr: boolean;
    manus: boolean;
    google: boolean;
    facebook: boolean;
    apple: boolean;
  };
}

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z" />
  </svg>
);
const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
  </svg>
);

function QrPanel({ onDone }: { onDone: () => void }) {
  const [qr, setQr] = useState<{ id: string; pollSecret: string; qr: string; expiresAt: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState("");
  const active = useRef(true);

  const start = async () => {
    setError("");
    try {
      const r = await api("/api/auth/qr/start", {});
      setQr({ ...r, expiresAt: Date.now() + r.expiresInSeconds * 1000 });
      setLeft(r.expiresInSeconds);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    active.current = true;
    void start();
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(async () => {
      const remaining = Math.max(0, Math.round((qr.expiresAt - Date.now()) / 1000));
      setLeft(remaining);
      if (!remaining) {
        clearInterval(timer);
        return;
      }
      try {
        const r = await api("/api/auth/qr/poll", { id: qr.id, pollSecret: qr.pollSecret });
        if (!active.current) return;
        if (r.status === "approved") {
          clearInterval(timer);
          onDone();
        } else if (r.status === "expired") {
          clearInterval(timer);
          setLeft(0);
        }
      } catch {
        /* geçici ağ hatası; tekrar denenir */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [qr?.id]);

  return (
    <div className="login-qr">
      {qr && left > 0 ? (
        <img src={qr.qr} alt="Giriş QR kodu" width={220} height={220} />
      ) : (
        <button className="login-qr-refresh" onClick={() => void start()}>
          <QrCode size={42} />
          <span>{error || (qr ? "Kodun süresi doldu. Yenilemek için dokunun." : "QR kodu hazırlanıyor…")}</span>
        </button>
      )}
      <ol>
        <li>Telefonunuzda XRE CRM'i açın ve giriş yapın.</li>
        <li>Telefon kamerasıyla bu kodu okutun.</li>
        <li>Açılan sayfada <b>Girişi onayla</b>'ya dokunun.</li>
      </ol>
      {qr && left > 0 && <small>Kod {left} saniye geçerli</small>}
    </div>
  );
}

export default function LoginScreen({
  status,
  onDemo,
  onClose,
}: {
  status: AuthStatus;
  onDemo: () => void;
  onClose?: () => void;
}) {
  const setup = status.needsSetup;
  const [mode, setMode] = useState<"password" | "qr">("password");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => new URLSearchParams(location.search).get("login_error") || "");

  useEffect(() => {
    if (new URLSearchParams(location.search).has("login_error"))
      history.replaceState({}, "", location.pathname);
  }, []);

  const finish = () => {
    sessionStorage.removeItem("xre-prefer-demo");
    location.reload();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (setup && password !== password2) {
      setError("Şifreler aynı değil.");
      return;
    }
    setBusy(true);
    try {
      await api(setup ? "/api/auth/setup" : "/api/auth/local-login", setup ? { name, email, password } : { email, password });
      toast.success(setup ? "Yönetici hesabı oluşturuldu." : "Giriş yapıldı.");
      finish();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const social = [
    { id: "google", label: "Google", icon: <GoogleIcon /> },
    { id: "facebook", label: "Facebook", icon: <FacebookIcon /> },
    { id: "apple", label: "Apple / iCloud", icon: <AppleIcon /> },
  ] as const;

  return (
    <div className="login-screen" role="dialog" aria-modal="true" aria-label="XRE CRM giriş">
      <section className="login-brand">
        <video
          className="login-video"
          poster="/login-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          ref={(el) => {
            if (el && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) el.pause();
          }}
        >
          <source src="/login-video.webm" type="video/webm" />
          <source src="/login-video.mp4" type="video/mp4" />
        </video>
        <div className="login-brand-text">
        <h2>Müşterileriniz, aramalarınız ve ekibiniz tek ekranda.</h2>
        <ul>
          <li>Kanban satış hunisi ve etkinlik takibi</li>
          <li>WhatsApp, santral ve yapay zekâ aramaları</li>
          <li>n8n ve webhook otomasyonları</li>
        </ul>
        <small><ShieldCheck size={14} /> Verileriniz kendi sunucunuzda kalır.</small>
        </div>
      </section>
      <section className="login-card">
        {onClose && (
          <button className="icon-button login-close" onClick={onClose} aria-label="Kapat">
            <X size={18} />
          </button>
        )}
        <h1>{setup ? "Hoş geldiniz" : "Giriş yap"}</h1>
        <p className="login-sub">
          {setup
            ? "İlk kurulum: çalışma alanının yönetici hesabını oluşturun. Bu hesap tüm yetkilere sahip olur."
            : "XRE CRM hesabınızla devam edin."}
        </p>
        {status.database === false && (
          <p className="login-error">Veritabanına ulaşılamıyor. Sunucu kayıtlarını kontrol edin.</p>
        )}
        {!setup && (
          <div className="login-tabs" role="tablist">
            <button role="tab" aria-selected={mode === "password"} className={mode === "password" ? "active" : ""} onClick={() => setMode("password")}>
              E-posta ile
            </button>
            <button role="tab" aria-selected={mode === "qr"} className={mode === "qr" ? "active" : ""} onClick={() => setMode("qr")}>
              <QrCode size={15} /> QR ile
            </button>
          </div>
        )}
        {mode === "qr" && !setup ? (
          <QrPanel onDone={finish} />
        ) : (
          <form onSubmit={submit} className="login-form">
            {setup && (
              <label>
                Ad soyad
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
              </label>
            )}
            <label>
              E-posta
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
            </label>
            <label>
              Şifre
              <span className="login-password">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={setup ? "new-password" : "current-password"}
                  required
                />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            {setup && (
              <label>
                Şifre (tekrar)
                <input type={show ? "text" : "password"} value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
                <small>En az 8 karakter; harf ve rakam içermeli.</small>
              </label>
            )}
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="btn primary login-submit" disabled={busy}>
              {busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
              {setup ? "Hesabı oluştur ve başla" : "Giriş yap"}
            </button>
          </form>
        )}
        {!setup && (
          <>
            <div className="login-divider"><span>veya</span></div>
            <div className="login-social">
              {social.map((p) => {
                const enabled = status.providers[p.id];
                return (
                  <button
                    key={p.id}
                    className="login-social-btn"
                    disabled={!enabled}
                    title={enabled ? `${p.label} ile giriş` : "Yönetici Entegrasyonlar sayfasından etkinleştirmeli"}
                    onClick={() => (location.href = `/api/auth/social/${p.id}/start`)}
                  >
                    {p.icon}
                    <span>{p.label}</span>
                  </button>
                );
              })}
              <button className="login-social-btn" onClick={() => setMode("qr")}>
                <Smartphone size={18} />
                <span>Telefonla QR</span>
              </button>
            </div>
            {status.providers.manus && (
              <button
                className="text-button login-manus"
                onClick={() => (location.href = "/api/auth/login?origin=" + encodeURIComponent(location.origin))}
              >
                Manus hesabıyla giriş
              </button>
            )}
            <p className="login-note">
              Sosyal girişler yalnız yöneticinin CRM'de açtığı hesabın e-postasıyla eşleşirse çalışır.
            </p>
          </>
        )}
        <button className="text-button login-demo" onClick={onDemo}>
          Giriş yapmadan demoyu incele
        </button>
      </section>
    </div>
  );
}

/** Telefonda QR kodunu okutunca açılan onay sayfası. */
export function QrApprove({ loggedIn, onLogin }: { loggedIn: boolean; onLogin: () => void }) {
  const code = new URLSearchParams(location.search).get("c") || "";
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const approve = async () => {
    setState("busy");
    try {
      await api("/api/auth/qr/approve", { code });
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };
  return (
    <div className="login-screen qr-approve">
      <section className="login-card">
        <Smartphone size={34} />
        <h1>Bilgisayarda giriş</h1>
        {!loggedIn ? (
          <>
            <p className="login-sub">Onaylamak için önce bu telefonda giriş yapın, sonra kodu tekrar okutun.</p>
            <button className="btn primary login-submit" onClick={onLogin}>Giriş yap</button>
          </>
        ) : state === "done" ? (
          <p className="login-sub">Onaylandı. Bilgisayardaki oturum birkaç saniye içinde açılacak.</p>
        ) : (
          <>
            <p className="login-sub">Bir bilgisayar hesabınızla giriş yapmak istiyor. Bu siz değilseniz onaylamayın.</p>
            {error && <p className="login-error">{error}</p>}
            <button className="btn primary login-submit" disabled={state === "busy" || !code} onClick={() => void approve()}>
              Girişi onayla
            </button>
            <button className="text-button login-demo" onClick={() => (location.href = "/")}>Vazgeç</button>
          </>
        )}
      </section>
    </div>
  );
}
