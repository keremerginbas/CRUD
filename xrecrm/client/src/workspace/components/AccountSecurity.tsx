// Profil sayfası: giriş e-postasını ve şifreyi değiştirme. İkisi de mevcut şifreyle doğrulanır.
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { toast } from "sonner";
import { passwordProblem } from "../../../../shared/password";
import { useStore } from "../store";

function Secret({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <label>
      {label}
      <span className="acc-secret">
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required />
        <button type="button" className="icon-button" onClick={() => setShow(!show)} aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </label>
  );
}

export default function AccountSecurity({ email, onEmailChanged }: { email: string; onEmailChanged: (email: string) => void }) {
  const { demo, user, request } = useStore();
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState<"" | "email" | "password">("");
  const local = String(user?.openId || "").startsWith("local:");

  if (demo)
    return (
      <section className="panel acc-security">
        <h3>
          <KeyRound size={17} /> Hesap güvenliği
        </h3>
        <p className="muted">Demo modunda e-posta ve şifre değiştirilemez. Gerçek hesapla giriş yaptığınızda bu bölüm açılır.</p>
      </section>
    );
  if (!local)
    return (
      <section className="panel acc-security">
        <h3>
          <KeyRound size={17} /> Hesap güvenliği
        </h3>
        <p className="muted">Bu oturum CRM’de açılmış bir e-posta/şifre hesabına ait değil; e-posta ve şifre giriş yaptığınız sağlayıcıdan yönetilir.</p>
      </section>
    );

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("email");
    try {
      const r = await request("/api/auth/email", { current: emailPw, email: newEmail.trim() });
      toast.success("E-posta adresiniz değiştirildi. Artık yeni adresle giriş yapacaksınız.");
      onEmailChanged(r.email);
      setNewEmail("");
      setEmailPw("");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy("");
    }
  };
  const problem = next ? passwordProblem(next) : null;
  const mismatch = Boolean(again) && again !== next;
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) return void toast.error(problem);
    if (again !== next) return void toast.error("Yeni şifreler birbirini tutmuyor.");
    setBusy("password");
    try {
      await request("/api/auth/password", { current, next });
      toast.success("Şifreniz değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.");
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="acc-security-grid">
      <section className="panel acc-security">
        <h3>
          <Mail size={17} /> E-posta adresini değiştir
        </h3>
        <p className="muted">
          Giriş yaparken kullandığınız adres: <strong>{email || "—"}</strong>
        </p>
        <form onSubmit={changeEmail}>
          <label>
            Yeni e-posta
            <input type="email" required maxLength={320} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" placeholder="ad@firma.com" />
          </label>
          <Secret label="Mevcut şifreniz" value={emailPw} onChange={setEmailPw} autoComplete="current-password" />
          <small className="muted">Değişiklikten sonra diğer cihazlardaki oturumlarınız kapanır; bu cihazda açık kalırsınız.</small>
          <button className="btn primary" disabled={busy !== "" || !newEmail.trim() || !emailPw}>
            {busy === "email" ? "Değiştiriliyor…" : "E-postayı değiştir"}
          </button>
        </form>
      </section>
      <section className="panel acc-security">
        <h3>
          <KeyRound size={17} /> Şifreyi değiştir
        </h3>
        <p className="muted">En az 8 karakter; harf ve rakam içermeli, kolay tahmin edilen bir şifre olmamalı.</p>
        <form onSubmit={changePassword}>
          <Secret label="Mevcut şifre" value={current} onChange={setCurrent} autoComplete="current-password" />
          <Secret label="Yeni şifre" value={next} onChange={setNext} autoComplete="new-password" />
          {problem && <small className="acc-bad">{problem}</small>}
          <Secret label="Yeni şifre (tekrar)" value={again} onChange={setAgain} autoComplete="new-password" />
          {mismatch && <small className="acc-bad">Yeni şifreler birbirini tutmuyor.</small>}
          <button className="btn primary" disabled={busy !== "" || !current || !next || !again || Boolean(problem) || mismatch}>
            {busy === "password" ? "Değiştiriliyor…" : "Şifreyi değiştir"}
          </button>
        </form>
      </section>
    </div>
  );
}
