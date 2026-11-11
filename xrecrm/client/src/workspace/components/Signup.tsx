import { useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Loader2, LogOut, Mail, MessageCircle } from "lucide-react";
import { SLUG_PATTERN, suggestSlug, type WorkspaceInfo } from "../../../../shared/workspaces";
import { api } from "../store";
import "../login.css";

const SUPPORT_EMAIL = "xre.software@xre.com.tr";
const SUPPORT_WHATSAPP = "905337437426";

/** Ücretsiz kayıt: firma kendi çalışma alanını açar ve deneme süresi başlar. */
export function SignupScreen({ trialDays }: { trialDays: number }) {
  const [company, setCompany] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const effectiveSlug = slugTouched ? slug : suggestSlug(company);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!SLUG_PATTERN.test(effectiveSlug)) {
      setError("Adres 3-30 karakter olmalı; yalnız küçük harf, rakam ve tire içerebilir.");
      return;
    }
    setBusy(true);
    try {
      const r = await api("/api/workspaces/signup", { company, slug: effectiveSlug, name, email, password });
      try {
        sessionStorage.removeItem("xre-prefer-demo");
      } catch {
        /* depolama kapalı */
      }
      location.href = `/${r.workspace.slug}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen" role="dialog" aria-modal="true" aria-label="XRE CRM ücretsiz kayıt">
      <section className="login-brand">
        <div className="login-brand-text">
          <h2>Satış ekibiniz için CRM, {trialDays} gün ücretsiz.</h2>
          <ul>
            <li>Kanban satış hunisi, görevler ve takvim</li>
            <li>Kişiler, şirketler ve ekip yetkileri</li>
            <li>Excel'den veya Bitrix24'ten içe aktarma</li>
          </ul>
          <small><Check size={14} /> Kredi kartı gerekmez. Verileriniz yalnız size aittir.</small>
        </div>
      </section>
      <section className="login-card">
        <h1>Ücretsiz deneyin</h1>
        <p className="login-sub">Firmanız için ayrı bir çalışma alanı açılır. {trialDays} gün boyunca ücretsiz kullanırsınız.</p>
        <form onSubmit={submit} className="login-form">
          <label>
            Firma adı
            <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" required autoFocus />
          </label>
          <label>
            Giriş adresiniz
            <span className="login-slug">
              <span>{location.host}/</span>
              <input
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                aria-label="Adres kısa adı"
                maxLength={30}
                required
              />
            </span>
            <small>Ekibiniz CRM'e bu adresten girer.</small>
          </label>
          <label>
            Ad soyad
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
          <label>
            E-posta
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
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
            Çalışma alanımı oluştur
          </button>
        </form>
        <a className="login-signup-link" href="/">Zaten hesabım var: giriş yap</a>
      </section>
    </div>
  );
}

/** Adreste olmayan bir firma kısa adı yazıldığında. */
export function WorkspaceMissing({ slug, signup }: { slug: string; signup: boolean }) {
  return (
    <div className="login-screen qr-approve">
      <section className="login-card">
        <h1>Bu adreste bir çalışma alanı yok</h1>
        <p className="login-sub">
          <b>{location.host}/{slug}</b> adresi kayıtlı değil. Adresi kontrol edin ya da yöneticinizden doğru adresi isteyin.
        </p>
        {signup && <a className="btn primary login-submit" href="/kayit">Ücretsiz çalışma alanı aç</a>}
        <a className="login-signup-link" href="/">Ana girişe dön</a>
      </section>
    </div>
  );
}

/** Deneme süresi dolan veya askıya alınan alan: veriler durur, kullanım kapanır. */
export function WorkspaceLocked({ workspace, onLogout }: { workspace: WorkspaceInfo; onLogout: () => void }) {
  const expired = workspace.state === "expired";
  const text = encodeURIComponent(`Merhaba, XRE CRM'de "${workspace.name}" (${workspace.slug}) çalışma alanımızı kullanmaya devam etmek istiyoruz.`);
  return (
    <div className="login-screen qr-approve">
      <section className="login-card">
        <h1>{expired ? "Deneme süreniz doldu" : "Çalışma alanı askıda"}</h1>
        <p className="login-sub">
          {expired
            ? "Verileriniz saklanıyor; hiçbir şey silinmedi. Kullanmaya devam etmek için bize yazın, alanınızı hemen açalım."
            : "Bu çalışma alanı geçici olarak kapatıldı. Yeniden açmak için bize yazın."}
        </p>
        <a className="btn primary login-submit" href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`} target="_blank" rel="noopener">
          <MessageCircle size={16} /> WhatsApp'tan yazın
        </a>
        <a className="btn secondary login-submit" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`XRE CRM: ${workspace.name}`)}`}>
          <Mail size={16} /> {SUPPORT_EMAIL}
        </a>
        <button className="text-button login-demo" onClick={onLogout}>
          <LogOut size={14} /> Çıkış yap
        </button>
      </section>
    </div>
  );
}
