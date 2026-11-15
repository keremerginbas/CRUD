// Şifre sıfırlama sayfası (/sifre-sifirla/<kod>): e-postadaki bağlantıdan gelen kullanıcı yeni şifresini belirler.
import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { passwordProblem } from "../../../../shared/password";
import { api } from "../store";
import { useBranding } from "../branding";
import FluidBackdrop from "./FluidBackdrop";
import "../login.css";

export default function PasswordReset({ token }: { token: string }) {
  const branding = useBranding();
  const [info, setInfo] = useState<{ email: string; workspace: string } | null>(null);
  const [invalid, setInvalid] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    api(`/api/auth/reset/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((e: Error) => setInvalid(e.message || "Bağlantı geçersiz."));
  }, [token]);

  const problem = password ? passwordProblem(password) : null;
  const mismatch = Boolean(again) && again !== password;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    if (again !== password) return setError("Şifreler birbirini tutmuyor.");
    setError("");
    setBusy(true);
    try {
      const r = await api(`/api/auth/reset/${encodeURIComponent(token)}`, { password });
      setDone(r.workspace ? `/${r.workspace}` : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen" role="dialog" aria-modal="true" aria-label="Şifre sıfırlama">
      <section className="login-brand">
        <FluidBackdrop />
        {branding.logoUrl ? (
          <img className="login-brand-logo login-brand-custom" src={branding.logoUrl} alt={branding.name || "Firma logosu"} />
        ) : (
          <img className="login-brand-logo" src="/xre-crm-logo-white.png" alt="XRE CRM" />
        )}
        <div className="login-brand-text">
          <h2>Yeni şifrenizi belirleyin.</h2>
          <ul>
            <li>Bağlantı bir kez kullanılabilir</li>
            <li>Şifre değişince diğer cihazlardaki oturumlar kapanır</li>
          </ul>
        </div>
      </section>
      <section className="login-card">
        {done ? (
          <>
            <h1>Şifreniz değiştirildi</h1>
            <p className="login-sub">Artık yeni şifrenizle giriş yapabilirsiniz.</p>
            <a className="btn primary login-submit" href={done}>
              Giriş ekranına git
            </a>
          </>
        ) : invalid ? (
          <>
            <h1>Bağlantı kullanılamıyor</h1>
            <p className="login-sub">{invalid}</p>
            <a className="btn primary login-submit" href="/">
              Giriş ekranına git
            </a>
          </>
        ) : !info ? (
          <p className="login-sub">
            <Loader2 size={16} className="spin" /> Bağlantı kontrol ediliyor…
          </p>
        ) : (
          <>
            <h1>Yeni şifre</h1>
            <p className="login-sub">
              <b>{info.email}</b> hesabı için yeni şifrenizi yazın.
            </p>
            <form onSubmit={submit} className="login-form">
              <label>
                Yeni şifre
                <span className="login-password">
                  <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
                <small>{problem || "En az 8 karakter; harf ve rakam içermeli."}</small>
              </label>
              <label>
                Yeni şifre (tekrar)
                <input type={show ? "text" : "password"} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
                {mismatch && <small>Şifreler birbirini tutmuyor.</small>}
              </label>
              {error && (
                <p className="login-error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn primary login-submit" disabled={busy || !password || !again}>
                {busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
                Şifreyi kaydet
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
