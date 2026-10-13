import { useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Eye, EyeOff, LogIn } from "lucide-react";

/* ----------------------------------------------------------------
   Giriş Sayfası — e-posta + şifre
   Admin panelinden oluşturulan kullanıcılar buradan giriş yapar.
-----------------------------------------------------------------*/

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
      toast.success("Giriş yapıldı");
      window.location.href = "/";
    },
    onError: (e) => toast.error(e.message || "Giriş başarısız"),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { toast.error("E-posta gerekli"); return; }
    if (!password) { toast.error("Şifre gerekli"); return; }
    login.mutate({ email: email.trim(), password });
  }

  return (
    <div className="lg-page">
      <style>{CSS}</style>
      <div className="lg-card">
        <img src="/logo.png" alt="X Real Estate Beştepe" className="lg-logo" />
        <h2>Giriş Yap</h2>
        <p>E-posta ve şifrenizle devam edin</p>
        <form onSubmit={submit}>
          <label>E-posta
            <input
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="ornek@xrealestate.com"
              autoComplete="email" autoFocus
            />
          </label>
          <label>Şifre
            <div className="pw">
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
              <button type="button" className="eye" onClick={() => setShow(s => !s)}>
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          <button type="submit" className="lg-btn" disabled={login.isPending}>
            {login.isPending ? <span className="spin" /> : <LogIn size={18} />}
            {login.isPending ? "Giriş yapılıyor…" : "Giriş Yap"}
          </button>
        </form>
        <div className="lg-footer">Hesabınız yok? Yöneticinizden şifre talep edin.</div>
      </div>
    </div>
  );
}

const CSS = `
.lg-page{min-height:100vh;display:grid;place-items:center;padding:20px;
  background:radial-gradient(900px 500px at 20% -10%,rgba(47,107,255,.15),transparent 55%),
  radial-gradient(800px 500px at 100% 10%,rgba(124,92,255,.12),transparent 50%),
  linear-gradient(160deg,#eef2f9,#e6ecf6)}
.lg-card{background:#fff;border-radius:24px;padding:44px 40px 36px;width:100%;max-width:440px;
  box-shadow:0 24px 80px rgba(16,24,40,.14);text-align:center;font-family:"Hanken Grotesk",system-ui,sans-serif}
.lg-logo{height:72px;width:auto;object-fit:contain;margin:0 auto 24px;display:block}
.lg-card h2{font-size:26px;font-weight:800;letter-spacing:-.03em;color:#0f1729;margin:0 0 6px}
.lg-card p{font-size:14.5px;color:#8a93a8;margin:0 0 28px}
.lg-card form{display:flex;flex-direction:column;gap:16px;text-align:left}
.lg-card label{font-size:13px;font-weight:600;color:#475069;display:flex;flex-direction:column;gap:6px}
.lg-card input{height:48px;border-radius:12px;border:1.5px solid #e7ebf2;padding:0 14px;font-size:15px;font-family:inherit;color:#0f1729;transition:.16s;width:100%;box-sizing:border-box}
.lg-card input:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.pw{position:relative}
.pw input{padding-right:48px}
.eye{position:absolute;right:13px;top:50%;transform:translateY(-50%);background:none;border:none;color:#8a93a8;cursor:pointer;display:grid;place-items:center;padding:4px}
.eye:hover{color:#2f6bff}
.lg-btn{height:52px;border-radius:14px;background:linear-gradient(135deg,#2f6bff,#1f55e0);color:#fff;font-weight:700;font-size:16px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 10px 24px -8px rgba(47,107,255,.65);margin-top:4px;font-family:inherit;width:100%}
.lg-btn:hover:not(:disabled){background:linear-gradient(135deg,#1f55e0,#1648c8)}
.lg-btn:disabled{opacity:.7;cursor:wait}
.spin{width:20px;height:20px;border:2.5px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:lgspin 1s linear infinite}
@keyframes lgspin{to{transform:rotate(360deg)}}
.lg-footer{margin-top:22px;font-size:13px;color:#8a93a8}
`