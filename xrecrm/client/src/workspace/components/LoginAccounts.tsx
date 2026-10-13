import "../login.css";
import { useEffect, useState } from "react";
import { KeyRound, Plus, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Modal } from "./ui";

interface Account {
  id: string;
  name: string;
  email: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

const emptyForm = { name: "", email: "", password: "", roleId: "", title: "", phone: "" };

/** Sahip için: çalışanlara e-posta + şifre ile giriş hesabı açma. */
export default function LoginAccounts() {
  const { demo, user, request } = useStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [reset, setReset] = useState<{ account: Account; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = !demo && Boolean(user?.isOwner);

  const load = async () => {
    if (!owner) return;
    try {
      const [a, access] = await Promise.all([request("/api/auth/accounts"), request("/api/access")]);
      setAccounts(a.accounts);
      setRoles((access.roles || []).filter((r: any) => r.id !== "owner"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, [owner]);

  if (!owner)
    return demo ? (
      <section className="panel login-accounts">
        <h3><KeyRound size={17} /> Giriş hesapları</h3>
        <p className="muted">Canlı modda sahip, çalışanlara e-posta ve şifreyle giriş hesabı açar.</p>
      </section>
    ) : null;

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await request("/api/auth/accounts", form);
      toast.success(`${form.name} için giriş hesabı açıldı. Şifreyi kişiye güvenli iletin.`);
      setForm(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = async (account: Account, body: Record<string, unknown>, message: string) => {
    try {
      await request(`/api/auth/accounts/${account.id}`, body, "PATCH");
      toast.success(message);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="panel login-accounts">
      <header>
        <div>
          <h3><KeyRound size={17} /> Giriş hesapları</h3>
          <p className="muted">
            Çalışanlar e-posta + şifre, QR veya aynı e-postalı Google/Facebook/Apple hesabıyla girer. Yetkileri seçtiğiniz rolden gelir.
          </p>
        </div>
        <button className="btn primary small" onClick={() => setForm({ ...emptyForm, roleId: roles[0]?.id || "" })}>
          <Plus size={15} /> Hesap aç
        </button>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>KİŞİ</th>
              <th>E-POSTA</th>
              <th>DURUM</th>
              <th>SON GİRİŞ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.name}</strong></td>
                <td>{a.email}</td>
                <td><Badge tone={a.active ? "green" : "gray"}>{a.active ? "Aktif" : "Pasif"}</Badge></td>
                <td className="mono">{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString("tr-TR") : "—"}</td>
                <td className="login-account-actions">
                  <button className="text-button" onClick={() => setReset({ account: a, password: "" })}>
                    Şifre sıfırla
                  </button>
                  {user?.openId !== `local:${a.id}` && (
                    <button
                      className="icon-button"
                      aria-label={a.active ? "Hesabı pasifleştir" : "Hesabı etkinleştir"}
                      onClick={() => void patch(a, { active: !a.active }, a.active ? "Hesap pasifleştirildi." : "Hesap etkinleştirildi.")}
                    >
                      {a.active ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Modal title="Yeni giriş hesabı" subtitle="Çalışan kaydı ve erişim rolü birlikte oluşturulur" onClose={() => setForm(null)}>
          <div className="modal-content">
            <div className="form-grid">
              <label>Ad soyad<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
              <label>E-posta<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>
                Geçici şifre
                <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="En az 8 karakter, harf + rakam" />
              </label>
              <label>
                Rol
                <select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label>Unvan<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <label>Telefon / dahili<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            </div>
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setForm(null)}>Vazgeç</button>
            <button className="btn primary" disabled={busy || !form.name || !form.email || !form.password || !form.roleId} onClick={() => void save()}>
              Hesabı aç
            </button>
          </footer>
        </Modal>
      )}
      {reset && (
        <Modal title="Şifre sıfırla" subtitle={reset.account.email} onClose={() => setReset(null)}>
          <div className="modal-content form-grid">
            <label className="full">
              Yeni şifre
              <input type="text" value={reset.password} autoFocus onChange={(e) => setReset({ ...reset, password: e.target.value })} />
            </label>
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setReset(null)}>Vazgeç</button>
            <button
              className="btn primary"
              disabled={reset.password.length < 8}
              onClick={() => {
                void patch(reset.account, { password: reset.password }, "Şifre güncellendi.");
                setReset(null);
              }}
            >
              Kaydet
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}

/** Kullanıcının kendi şifresini değiştirmesi (Profil sayfası). */
export function ChangePassword() {
  const { demo, user, request } = useStore();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  if (demo || !String(user?.openId || "").startsWith("local:")) return null;
  return (
    <section className="panel login-accounts">
      <h3><KeyRound size={17} /> Şifre değiştir</h3>
      <div className="form-grid">
        <label>Mevcut şifre<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
        <label>Yeni şifre<input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
      </div>
      <button
        className="btn primary small"
        disabled={!current || next.length < 8}
        onClick={() =>
          request("/api/auth/password", { current, next })
            .then(() => {
              toast.success("Şifreniz değiştirildi.");
              setCurrent("");
              setNext("");
            })
            .catch((e: Error) => toast.error(e.message))
        }
      >
        Şifreyi güncelle
      </button>
    </section>
  );
}
