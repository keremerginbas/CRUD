import "../login.css";
import { useEffect, useState } from "react";
import { Copy, KeyRound, Mail, Plus, Trash2, UserCheck, UserX, X } from "lucide-react";
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

interface Invite {
  id: string;
  email: string;
  name: string;
  roleId: string;
  createdAt: string;
  expiresAt: string;
}
const emptyInvite = { email: "", name: "", roleId: "" };

const emptyForm = { name: "", email: "", password: "", roleId: "", title: "", phone: "" };

/** Sahip için: çalışanlara e-posta + şifre ile giriş hesabı açma. */
export default function LoginAccounts() {
  const { demo, user, request } = useStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [reset, setReset] = useState<{ account: Account; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [mailReady, setMailReady] = useState(true);
  const [invite, setInvite] = useState<typeof emptyInvite | null>(null);
  const [sentLink, setSentLink] = useState<{ email: string; link: string; sent: boolean; note: string } | null>(null);
  const owner = !demo && Boolean(user?.isOwner);

  const load = async () => {
    if (!owner) return;
    try {
      const [a, access] = await Promise.all([request("/api/auth/accounts"), request("/api/access")]);
      setAccounts(a.accounts);
      setRoles((access.roles || []).filter((r: any) => r.id !== "owner"));
      const pending = await request("/api/auth/invites");
      setInvites(pending.invites || []);
      setMailReady(Boolean(pending.mail));
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
  const sendInvite = async () => {
    if (!invite) return;
    setBusy(true);
    try {
      const r = await request("/api/auth/invites", invite);
      setSentLink({ email: r.invite.email, link: r.link, sent: Boolean(r.sent), note: r.mailError || "" });
      if (r.sent) toast.success(`Davet ${r.invite.email} adresine gönderildi.`);
      setInvite(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancelInvite = async (item: Invite) => {
    try {
      await request(`/api/auth/invites/${item.id}`, {}, "DELETE");
      toast.success("Davet iptal edildi.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const copyLink = (link: string) =>
    navigator.clipboard
      .writeText(link)
      .then(() => toast.success("Davet bağlantısı kopyalandı."))
      .catch(() => toast.error("Kopyalanamadı; bağlantıyı elle seçip kopyalayın."));
  const removeAccount = async (account: Account) => {
    if (
      !window.confirm(
        `${account.name} (${account.email}) hesabı kalıcı olarak silinsin mi?\n\nKişi sisteme giremez. Müşteri, görev ve geçmiş kayıtları silinmez. Yalnızca geçici olarak kapatmak istiyorsanız "pasifleştir" düğmesini kullanın.`,
      )
    )
      return;
    try {
      await request(`/api/auth/accounts/${account.id}`, {}, "DELETE");
      toast.success("Hesap silindi.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
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
        <div className="login-account-head-actions">
          <button className="btn secondary small" onClick={() => setForm({ ...emptyForm, roleId: roles[0]?.id || "" })}>
            <Plus size={15} /> Hesap aç
          </button>
          <button className="btn primary small" onClick={() => setInvite({ ...emptyInvite, roleId: roles[0]?.id || "" })}>
            <Mail size={15} /> E-posta ile davet et
          </button>
        </div>
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
                      className="icon-button danger"
                      aria-label={`${a.name} hesabını sil`}
                      title="Hesabı kalıcı olarak sil"
                      onClick={() => void removeAccount(a)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
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
      {invites.length > 0 && (
        <div className="login-invites">
          <h4>Bekleyen davetler</h4>
          <ul>
            {invites.map((item) => (
              <li key={item.id}>
                <Mail size={15} />
                <span>
                  <strong>{item.email}</strong>
                  <small>
                    {roles.find((r) => r.id === item.roleId)?.name || "Rol"} · son gün{" "}
                    {new Date(item.expiresAt).toLocaleDateString("tr-TR")}
                  </small>
                </span>
                <button className="text-button" onClick={() => void cancelInvite(item)}>
                  <X size={14} /> İptal et
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {invite && (
        <Modal
          title="Çalışan davet et"
          subtitle="Çalışan e-postasındaki bağlantıya tıklar, adını ve şifresini kendisi belirler"
          onClose={() => setInvite(null)}
        >
          <div className="modal-content">
            <div className="form-grid">
              <label className="full">
                E-posta
                <input type="email" value={invite.email} autoFocus onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="calisan@firma.com" />
              </label>
              <label>
                Ad soyad (isteğe bağlı)
                <input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
              </label>
              <label>
                Rol
                <select value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
            </div>
            {!mailReady && (
              <p className="muted login-invite-note">
                Sunucuda e-posta gönderimi ayarlı değil. Davet bağlantısı oluşturulur; kopyalayıp çalışana kendiniz iletirsiniz.
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button className="btn secondary" onClick={() => setInvite(null)}>Vazgeç</button>
            <button className="btn primary" disabled={busy || !invite.email.includes("@") || !invite.roleId} onClick={() => void sendInvite()}>
              {mailReady ? "Daveti gönder" : "Bağlantı oluştur"}
            </button>
          </footer>
        </Modal>
      )}
      {sentLink && (
        <Modal
          title={sentLink.sent ? "Davet gönderildi" : "Davet bağlantısı hazır"}
          subtitle={sentLink.email}
          onClose={() => setSentLink(null)}
        >
          <div className="modal-content">
            <p className="muted login-invite-note">
              {sentLink.sent
                ? "E-posta gönderildi. İsterseniz aynı bağlantıyı WhatsApp gibi başka bir yoldan da iletebilirsiniz."
                : sentLink.note || "Bağlantıyı kopyalayıp çalışana iletin."}{" "}
              Bağlantı 7 gün geçerlidir ve yalnızca şimdi görüntülenir.
            </p>
            <div className="login-invite-link">
              <input readOnly value={sentLink.link} onFocus={(e) => e.target.select()} aria-label="Davet bağlantısı" />
              <button className="btn secondary" onClick={() => void copyLink(sentLink.link)}>
                <Copy size={15} /> Kopyala
              </button>
            </div>
          </div>
          <footer className="modal-footer">
            <button className="btn primary" onClick={() => setSentLink(null)}>Tamam</button>
          </footer>
        </Modal>
      )}
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
