import { useEffect, useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "../store";
import PhoneInput from "./PhoneInput";
import FluidBackdrop from "./FluidBackdrop";
import "../login.css";

interface InviteInfo {
  email: string;
  name: string;
  company: string;
  role: string;
}

/** Davet bağlantısı (/davet/<kod>): çalışan adını ve şifresini kendisi belirleyip hesabını açar. */
export default function InviteAccept({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [invalid, setInvalid] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((r: InviteInfo) => {
        setInfo(r);
        setName(r.name || "");
      })
      .catch((e: Error) => setInvalid(e.message || "Davet bağlantısı geçersiz."));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api(`/api/auth/invite/${encodeURIComponent(token)}`, { name, password, phone, title });
      try {
        sessionStorage.removeItem("xre-prefer-demo");
      } catch {
        /* depolama kapalı */
      }
      location.href = r.workspace ? `/${r.workspace}` : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen" role="dialog" aria-modal="true" aria-label="XRE CRM davet">
      <section className="login-brand">
        <FluidBackdrop />
        <img className="login-brand-logo" src="/xre-crm-logo-white.png" alt="XRE CRM" />
        <div className="login-brand-text">
          <h2>{info ? `${info.company} sizi ekibine davet etti.` : "Ekibinize katılın."}</h2>
          <ul>
            <li>Müşterileriniz, görevleriniz ve takviminiz tek ekranda</li>
            <li>Adınızı ve şifrenizi kendiniz belirlersiniz</li>
          </ul>
        </div>
      </section>
      <section className="login-card">
        {invalid ? (
          <>
            <h1>Davet kullanılamıyor</h1>
            <p className="login-sub">{invalid}</p>
            <a className="btn primary login-submit" href="/">Giriş ekranına git</a>
          </>
        ) : !info ? (
          <p className="login-sub"><Loader2 size={16} className="spin" /> Davet kontrol ediliyor…</p>
        ) : (
          <>
            <h1>{info.company} ekibine katılın</h1>
            <p className="login-sub">
              <b>{info.email}</b> adresi için hesabınızı oluşturun.{info.role ? ` Rolünüz: ${info.role}.` : ""}
            </p>
            <form onSubmit={submit} className="login-form">
              <label>
                Ad soyad
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
              </label>
              <label>
                Telefon (isteğe bağlı)
                <PhoneInput value={phone} onChange={setPhone} ariaLabel="Telefon" />
              </label>
              <label>
                Unvan (isteğe bağlı)
                <input value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" placeholder="Satış danışmanı" />
              </label>
              <label>
                Şifre
                <span className="login-password">
                  <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
                <small>En az 8 karakter; harf ve rakam içermeli.</small>
              </label>
              {error && <p className="login-error" role="alert">{error}</p>}
              <button className="btn primary login-submit" disabled={busy}>
                {busy ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
                Hesabımı oluştur
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
