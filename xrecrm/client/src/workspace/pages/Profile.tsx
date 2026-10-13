import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, KeyRound, Save, Copy, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "../components/ui";
import { ChangePassword } from "../components/LoginAccounts";
import { useStore } from "../store";
import "../access.css";
type ProfileData = {
  name: string;
  email: string;
  openId: string;
  phone: string;
  position: string;
  lastSeen?: string;
  verified?: boolean;
  roleId?: string;
};
const demoKey = "xre-profile-demo-v1";
function demoProfile(): ProfileData {
  try {
    const p = JSON.parse(localStorage.getItem(demoKey) || "null");
    if (p?.openId) return p;
  } catch {}
  return {
    name: "Demo kullanıcısı",
    email: "",
    openId: "demo-open-id",
    phone: "",
    position: "",
    verified: false,
    roleId: "owner",
  };
}
export default function Profile() {
  const { demo, request, user } = useStore();
  const [profile, setProfile] = useState<ProfileData>(demoProfile);
  const [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(!demo),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [identity, setIdentity] = useState<{
    openId: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    void request("/api/identity")
      .then((x) => setIdentity(x.identity || null))
      .catch(() => {});
  }, [request]);
  useEffect(() => {
    setError("");
    if (demo) {
      setProfile(demoProfile());
      setLoading(false);
      return;
    }
    setLoading(true);
    request("/api/profile")
      .then((x) => setProfile(x.profile))
      .catch((e) => {
        setProfile({
          name: "",
          email: "",
          openId: "",
          phone: "",
          position: "",
        });
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [demo, request]);
  const change = (key: "name" | "phone" | "position", value: string) =>
    setProfile((p) => ({ ...p, [key]: value }));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setSaved(false);
    try {
      if (demo)
        localStorage.setItem(
          demoKey,
          JSON.stringify({ ...profile, lastSeen: new Date().toISOString() }),
        );
      else {
        const x = await request(
          "/api/profile",
          {
            name: profile.name,
            phone: profile.phone,
            position: profile.position,
          },
          "PUT",
        );
        setProfile(x.profile);
      }
      setSaved(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="access-page profile-page">
      <PageTitle
        eyebrow="HESABIM"
        title="Profilim"
        description="Kişisel bilgilerinizi güncelleyin. Erişim rolü ve doğrulanmış kimlik buradan değiştirilemez."
      />
      <ChangePassword />
      {demo && (
        <div className="access-notice">
          Örnek profil · düzenleme gerçek bir kullanıcı veya yetki oluşturmaz.
        </div>
      )}
      {identity && !user?.canAccess && (
        <div className="access-notice">
          <KeyRound size={17} />
          <span>
            Giriş yaptınız; CRM erişimi için aşağıdaki gerçek kimliği çalışma
            alanı sahibine iletin: <code>{identity.openId}</code>{" "}
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(identity.openId)
                  .then(() => toast.success("Kimlik kopyalandı."))
              }
            >
              Kimliği kopyala
            </button>
          </span>
        </div>
      )}
      {error && <div className="access-notice">{error}</div>}
      <div className="profile-layout">
        <section className="panel profile-card">
          <div className="profile-identity">
            <span className="profile-avatar">
              {(profile.name || user?.name || "X").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <h2>{profile.name || "Profil"}</h2>
              <p>{profile.email || "E-posta paylaşılmadı"}</p>
            </div>
            <span className="verified-badge">
              <ShieldCheck size={15} />
              {demo
                ? "Örnek profil"
                : profile.verified
                  ? "Doğrulandı"
                  : "Yükleniyor"}
            </span>
          </div>
          <form onSubmit={(e) => void save(e)}>
            <div className="access-form-grid">
              <label>
                Ad soyad
                <input
                  required
                  maxLength={200}
                  value={profile.name}
                  onChange={(e) => change("name", e.target.value)}
                />
              </label>
              <label>
                Telefon
                <input
                  maxLength={80}
                  value={profile.phone}
                  onChange={(e) => change("phone", e.target.value)}
                />
              </label>
              <label className="full">
                Pozisyon
                <input
                  maxLength={200}
                  value={profile.position}
                  onChange={(e) => change("position", e.target.value)}
                  placeholder="Örn. Satış danışmanı"
                />
              </label>
            </div>
            <div className="profile-actions">
              <span>
                {saved ? (
                  <>
                    <CheckCircle2 size={15} />
                    Kaydedildi
                  </>
                ) : (
                  "Yalnızca kişisel profil alanları"
                )}
              </span>
              <button
                className="btn primary"
                disabled={loading || busy || Boolean(error)}
              >
                <Save size={15} />
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </form>
        </section>
        <aside className="panel profile-security">
          <div className="eyebrow">OTURUM KİMLİĞİ</div>
          <KeyRound size={24} />
          <h3>Kimliğiniz korunuyor</h3>
          <p>
            Erişim, e-posta veya görünen adla değil, imzalı kimlik ve etkin
            çalışan eşleşmesiyle doğrulanır. Profil adı değişimi kayıt
            sahipliğini değiştirmez.
          </p>
          <dl>
            <dt>Kimlik</dt>
            <dd>
              <code>
                {!demo
                  ? profile.openId || identity?.openId || "—"
                  : identity?.openId || profile.openId}
              </code>
            </dd>
            <dt>Rol</dt>
            <dd>{profile.roleId || "—"}</dd>
            <dt>Son görülme</dt>
            <dd>
              {profile.lastSeen
                ? new Date(profile.lastSeen).toLocaleString("tr-TR")
                : "—"}
            </dd>
          </dl>
        </aside>
      </div>
    </div>
  );
}
