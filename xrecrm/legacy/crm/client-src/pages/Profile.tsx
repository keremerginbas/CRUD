import { useEffect, useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { useAuth } from "../_core/hooks/useAuth";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import {
  Camera,
  Save,
  LogOut,
  Shield,
  Mail,
  Phone,
  Building2,
  Loader2,
  KeyRound,
  ChevronDown,
  Lock,
  Bell,
  Clock,
  Monitor,
  Smartphone,
  CheckCircle2,
} from "lucide-react";
import { ROLE_LABEL } from "../lib/permissions";

/* ----------------------------------------------------------------
   Profil — bilgi düzenleme + fotoğraf yükleme + çıkış + ayarlar
-----------------------------------------------------------------*/

function initials(n?: string | null) {
  if (!n) return "?";
  const p = n.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

// Fotoğrafı tarayıcıda küçült (max 256px) + jpeg ~0.82 -> küçük base64
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Okunamadı"));

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error("Geçersiz görsel"));

      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;

        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Canvas yok"));

        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };

      img.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  });
}

export default function Profile() {
  const { user, logout, refresh } = useAuth();
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [openSecurity, setOpenSecurity] = useState(false);
  const [openNotifications, setOpenNotifications] = useState(false);
  const [openWorkStatus, setOpenWorkStatus] = useState(false);
  const [openThemeSettings, setOpenThemeSettings] = useState(false);

  const [notifyLead, setNotifyLead] = useState(true);
  const [notifyAppointment, setNotifyAppointment] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [workStatus, setWorkStatus] = useState("active");
  const [themeChoice, setThemeChoice] = useState("system");
  const [densityChoice, setDensityChoice] = useState("comfortable");

  useEffect(() => {
    if (!user) return;

    const u = user as any;

    setName(u.name || "");
    setEmail(u.email || "");
    setPhone(u.phone || "");
    setDepartment(u.department || "");
    setAvatar(u.avatarUrl || null);
  }, [user]);

  const save = trpc.users.updateProfile.useMutation({
    onSuccess: async () => {
      toast.success("Profil güncellendi");
      await utils.auth.me.invalidate();
      refresh?.();
    },
    onError: () => toast.error("Güncellenemedi"),
  });

  const changePw = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Şifre değiştirildi");
      setCurPw("");
      setNewPw("");
      setShowPasswordForm(false);
    },
    onError: e => toast.error(e.message || "Şifre değiştirilemedi"),
  });

  // Kullanıcı tercihlerini DB'den yükle
  const { data: prefs } = trpc.users.getPreferences.useQuery(undefined);
  useEffect(() => {
    if (!prefs) return;
    const p = prefs as any;
    setNotifyLead(!!p.notifyLead);
    setNotifyAppointment(!!p.notifyAppointment);
    setNotifyEmail(!!p.notifyEmail);
    setWorkStatus(p.workStatus || "active");
    setThemeChoice(p.themeChoice || "system");
    setDensityChoice(p.densityChoice || "comfortable");
  }, [prefs]);

  // Tema seçimini gerçekten uygula (anlık)
  function applyTheme(choice: string) {
    const root = document.documentElement;
    const dark = choice === "dark" || (choice === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", !!dark);
  }
  useEffect(() => { applyTheme(themeChoice); }, [themeChoice]);

  const savePrefs = trpc.users.updatePreferences.useMutation({
    onSuccess: () => { toast.success("Ayarlar kaydedildi"); utils.users.getPreferences.invalidate(); },
    onError: (e) => toast.error(e.message || "Kaydedilemedi"),
  });

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Lütfen bir görsel seçin");
      return;
    }

    setUploading(true);

    try {
      const data = await compressImage(file);
      setAvatar(data);
      toast.success("Fotoğraf hazır — kaydetmeyi unutma");
    } catch {
      toast.error("Fotoğraf işlenemedi");
    } finally {
      setUploading(false);

      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  function onSave() {
    save.mutate({
      name,
      email,
      phone,
      department,
      avatarUrl: avatar ?? "",
    });
  }

  function onChangePassword() {
    if (!curPw) {
      toast.error("Mevcut şifreyi girin");
      return;
    }

    if (newPw.length < 6) {
      toast.error("Yeni şifre en az 6 karakter olmalı");
      return;
    }

    changePw.mutate({
      currentPassword: curPw,
      newPassword: newPw,
    });
  }

  function saveLocalSettings() {
    savePrefs.mutate({
      notifyLead,
      notifyAppointment,
      notifyEmail,
      workStatus: workStatus as "active" | "busy" | "meeting" | "away",
      themeChoice: themeChoice as "light" | "dark" | "system",
      densityChoice: densityChoice as "comfortable" | "compact",
    });
    applyTheme(themeChoice);
  }

  const role = (user as any)?.role as string | undefined;

  return (
    <DashboardLayout>
      <style>{CSS}</style>

      <div className="pf">
        <div className="pf-head">
          <div>
            <div className="pf-crumb">Ana Sayfa / Profil</div>
            <h1>Profilim</h1>
            <p>Bilgilerini güncelle, profil fotoğrafını değiştir.</p>
          </div>

          <button className="pf-logout" onClick={logout}>
            <LogOut size={17} />
            Çıkış Yap
          </button>
        </div>

        <div className="pf-grid">
          {/* Fotoğraf kartı */}
          <div className="pf-card pf-photo">
            <div className="ava-wrap">
              {avatar ? (
                <img className="ava" src={avatar} alt="Profil" />
              ) : (
                <div className="ava ava-fb">{initials(name)}</div>
              )}

              <button
                className="ava-btn"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                title="Fotoğraf değiştir"
              >
                {uploading ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Camera size={16} />
                )}
              </button>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPick}
              />
            </div>

            <b className="pf-name">{name || "İsimsiz"}</b>

            <span className="pf-role">
              <Shield size={13} />
              {role ? (ROLE_LABEL as any)[role] || role : "—"}
            </span>

            {avatar && (
              <button className="pf-remove" onClick={() => setAvatar(null)}>
                Fotoğrafı kaldır
              </button>
            )}
          </div>

          {/* Bilgi kartı */}
          <div className="pf-card">
            <div className="pf-sec">Hesap Bilgileri</div>

            <label>
              Ad Soyad
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ad Soyad"
              />
            </label>

            <div className="row2">
              <label>
                E-posta
                <div className="ico">
                  <Mail size={15} />
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="ornek@mail.com"
                  />
                </div>
              </label>

              <label>
                Telefon
                <div className="ico">
                  <Phone size={15} />
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+90 5xx…"
                  />
                </div>
              </label>
            </div>

            <label>
              Departman
              <div className="ico">
                <Building2 size={15} />
                <input
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                  placeholder="Ör. Satış, Çağrı Merkezi"
                />
              </div>
            </label>

            <div className="pf-note">
              <Shield size={14} />
              Rolünü yalnızca yönetici değiştirebilir.
            </div>

            <button className="pf-save" onClick={onSave} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              {save.isPending ? "Kaydediliyor…" : "Değişiklikleri Kaydet"}
            </button>
          </div>
        </div>

        {/* Şifre değiştirme kartı */}
        <div className="pf-card pf-accordion-card">
          <button
            type="button"
            className={`pf-accordion-toggle ${showPasswordForm ? "open" : ""}`}
            onClick={() => setShowPasswordForm(prev => !prev)}
          >
            <span className="pf-accordion-left">
              <span className="pf-accordion-icon">
                <KeyRound size={18} />
              </span>

              <span>
                <b>Şifre Değiştir</b>
                <small>Hesabının güvenliği için mevcut şifreni doğrula.</small>
              </span>
            </span>

            <ChevronDown size={19} className="pf-chevron" />
          </button>

          {showPasswordForm && (
            <div className="pf-accordion-panel">
              <div className="row2">
                <label>
                  Mevcut Şifre
                  <div className="ico">
                    <Lock size={15} />
                    <input
                      type="password"
                      value={curPw}
                      onChange={e => setCurPw(e.target.value)}
                      placeholder="Mevcut şifren"
                    />
                  </div>
                </label>

                <label>
                  Yeni Şifre
                  <div className="ico">
                    <KeyRound size={15} />
                    <input
                      type="password"
                      value={newPw}
                      onChange={e => setNewPw(e.target.value)}
                      placeholder="En az 6 karakter"
                    />
                  </div>
                </label>
              </div>

              <div className="pf-actions">
                <button
                  type="button"
                  className="pf-cancel"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setCurPw("");
                    setNewPw("");
                  }}
                  disabled={changePw.isPending}
                >
                  Vazgeç
                </button>

                <button
                  className="pf-save pf-inline-save"
                  onClick={onChangePassword}
                  disabled={changePw.isPending}
                >
                  {changePw.isPending ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  {changePw.isPending ? "Değiştiriliyor…" : "Şifreyi Kaydet"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Hesap güvenliği */}
        <div className="pf-card pf-accordion-card">
          <button
            type="button"
            className={`pf-accordion-toggle ${openSecurity ? "open" : ""}`}
            onClick={() => setOpenSecurity(prev => !prev)}
          >
            <span className="pf-accordion-left">
              <span className="pf-accordion-icon">
                <Shield size={18} />
              </span>

              <span>
                <b>Hesap Güvenliği</b>
                <small>Oturum, cihaz ve güvenlik bilgilerini görüntüle.</small>
              </span>
            </span>

            <ChevronDown size={19} className="pf-chevron" />
          </button>

          {openSecurity && (
            <div className="pf-accordion-panel">
              <div className="pf-info-grid">
                <div className="pf-info-box">
                  <span>Son giriş</span>
                  <b>Bugün</b>
                </div>

                <div className="pf-info-box">
                  <span>Aktif cihaz</span>
                  <b>Web tarayıcı</b>
                </div>

                <div className="pf-info-box">
                  <span>Hesap durumu</span>
                  <b>Aktif</b>
                </div>
              </div>

              <div className="pf-note">
                <Shield size={14} />
                Bu alan bilgilendirme amaçlıdır. Detaylı oturum yönetimi daha sonra eklenebilir.
              </div>
            </div>
          )}
        </div>

        {/* Bildirim tercihleri */}
        <div className="pf-card pf-accordion-card">
          <button
            type="button"
            className={`pf-accordion-toggle ${openNotifications ? "open" : ""}`}
            onClick={() => setOpenNotifications(prev => !prev)}
          >
            <span className="pf-accordion-left">
              <span className="pf-accordion-icon">
                <Bell size={18} />
              </span>

              <span>
                <b>Bildirim Tercihleri</b>
                <small>Müşteri, randevu ve e-posta bildirimlerini yönet.</small>
              </span>
            </span>

            <ChevronDown size={19} className="pf-chevron" />
          </button>

          {openNotifications && (
            <div className="pf-accordion-panel">
              <div className="pf-switch-list">
                <label className="pf-switch-row">
                  <span>
                    <b>Yeni müşteri bildirimi</b>
                    <small>Yeni lead geldiğinde bildirim al.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={notifyLead}
                    onChange={e => setNotifyLead(e.target.checked)}
                  />
                </label>

                <label className="pf-switch-row">
                  <span>
                    <b>Randevu hatırlatması</b>
                    <small>Yaklaşan randevular için uyarı al.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={notifyAppointment}
                    onChange={e => setNotifyAppointment(e.target.checked)}
                  />
                </label>

                <label className="pf-switch-row">
                  <span>
                    <b>E-posta bildirimi</b>
                    <small>Önemli işlem özetleri e-posta ile gelsin.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={e => setNotifyEmail(e.target.checked)}
                  />
                </label>
              </div>

              <div className="pf-actions">
                <button className="pf-save pf-inline-save" onClick={saveLocalSettings}>
                  <Save size={16} />
                  Tercihleri Kaydet
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Çalışma durumu */}
        <div className="pf-card pf-accordion-card">
          <button
            type="button"
            className={`pf-accordion-toggle ${openWorkStatus ? "open" : ""}`}
            onClick={() => setOpenWorkStatus(prev => !prev)}
          >
            <span className="pf-accordion-left">
              <span className="pf-accordion-icon">
                <Clock size={18} />
              </span>

              <span>
                <b>Çalışma Durumu</b>
                <small>CRM içinde görünmesini istediğin müsaitlik durumunu seç.</small>
              </span>
            </span>

            <ChevronDown size={19} className="pf-chevron" />
          </button>

          {openWorkStatus && (
            <div className="pf-accordion-panel">
              <div className="pf-choice-grid">
                {[
                  { value: "active", label: "Aktif", desc: "Müşteri atanabilir" },
                  { value: "busy", label: "Meşgul", desc: "Geçici olarak yoğun" },
                  { value: "meeting", label: "Toplantıda", desc: "Şu an uygun değil" },
                  { value: "away", label: "İzinli", desc: "Lead atanmasın" },
                ].map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={`pf-choice ${workStatus === item.value ? "selected" : ""}`}
                    onClick={() => setWorkStatus(item.value)}
                  >
                    <span>
                      <b>{item.label}</b>
                      <small>{item.desc}</small>
                    </span>

                    {workStatus === item.value && <CheckCircle2 size={17} />}
                  </button>
                ))}
              </div>

              <div className="pf-actions">
                <button className="pf-save pf-inline-save" onClick={saveLocalSettings}>
                  <Save size={16} />
                  Durumu Kaydet
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Tema ve arayüz */}
        <div className="pf-card pf-accordion-card">
          <button
            type="button"
            className={`pf-accordion-toggle ${openThemeSettings ? "open" : ""}`}
            onClick={() => setOpenThemeSettings(prev => !prev)}
          >
            <span className="pf-accordion-left">
              <span className="pf-accordion-icon">
                <Monitor size={18} />
              </span>

              <span>
                <b>Tema ve Arayüz</b>
                <small>Görünüm ve ekran yoğunluğu tercihlerini düzenle.</small>
              </span>
            </span>

            <ChevronDown size={19} className="pf-chevron" />
          </button>

          {openThemeSettings && (
            <div className="pf-accordion-panel">
              <div className="pf-subtitle">Tema seçimi</div>

              <div className="pf-choice-grid three">
                {[
                  { value: "light", label: "Açık", desc: "Aydınlık görünüm" },
                  { value: "dark", label: "Koyu", desc: "Gece modu" },
                  { value: "system", label: "Sistem", desc: "Cihaza göre" },
                ].map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={`pf-choice ${themeChoice === item.value ? "selected" : ""}`}
                    onClick={() => setThemeChoice(item.value)}
                  >
                    <span>
                      <b>{item.label}</b>
                      <small>{item.desc}</small>
                    </span>

                    {themeChoice === item.value && <CheckCircle2 size={17} />}
                  </button>
                ))}
              </div>

              <div className="pf-subtitle with-space">Arayüz yoğunluğu</div>

              <div className="pf-choice-grid">
                {[
                  { value: "comfortable", label: "Rahat", desc: "Daha geniş boşluklar" },
                  { value: "compact", label: "Kompakt", desc: "Daha sıkı tablo görünümü" },
                ].map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={`pf-choice ${densityChoice === item.value ? "selected" : ""}`}
                    onClick={() => setDensityChoice(item.value)}
                  >
                    <span>
                      <b>{item.label}</b>
                      <small>{item.desc}</small>
                    </span>

                    {densityChoice === item.value && <CheckCircle2 size={17} />}
                  </button>
                ))}
              </div>

              <div className="pf-actions">
                <button className="pf-save pf-inline-save" onClick={saveLocalSettings}>
                  <Save size={16} />
                  Görünümü Kaydet
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

const CSS = `
.pf{
  --ink:#0f1729;
  --ink2:#475069;
  --ink3:#8a93a8;
  --line:#e7ebf2;
  --line2:#eef1f6;
  --surf2:#f7f9fc;
  font-family:"Hanken Grotesk",system-ui,sans-serif;
  color:var(--ink);
  letter-spacing:-.01em;
  display:flex;
  flex-direction:column;
  gap:16px;
  max-width:1000px;
}

.pf h1{
  margin:0;
}

.pf-head{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:20px;
  flex-wrap:wrap;
  margin-bottom:4px;
}

.pf-crumb{
  font-size:13px;
  color:var(--ink3);
  font-weight:500;
  margin-bottom:6px;
}

.pf-head h1{
  font-size:26px;
  font-weight:800;
  letter-spacing:-.03em;
}

.pf-head p{
  color:var(--ink2);
  font-size:14.5px;
  margin-top:4px;
}

.pf-logout{
  height:42px;
  padding:0 18px;
  border-radius:12px;
  background:#fff;
  color:#f43f6e;
  font-weight:600;
  font-size:14px;
  border:1px solid #ffd9e2;
  cursor:pointer;
  display:flex;
  align-items:center;
  gap:8px;
}

.pf-logout:hover{
  background:#ffeaf0;
}

.pf-grid{
  display:grid;
  grid-template-columns:300px 1fr;
  gap:18px;
  margin-bottom:2px;
}

.pf-card{
  background:#fff;
  border:1px solid var(--line);
  border-radius:16px;
  padding:22px;
  box-shadow:
    0 1px 2px rgba(16,24,40,.04),
    0 8px 24px -12px rgba(16,24,40,.16);
}

.pf-photo{
  display:flex;
  flex-direction:column;
  align-items:center;
  text-align:center;
  gap:12px;
}

.ava-wrap{
  position:relative;
  width:128px;
  height:128px;
}

.ava{
  width:128px;
  height:128px;
  border-radius:50%;
  object-fit:cover;
  border:4px solid #fff;
  box-shadow:0 8px 28px -8px rgba(16,24,40,.35);
  display:block;
}

.ava-fb{
  background:linear-gradient(135deg,#2f6bff,#7c5cff);
  color:#fff;
  display:grid;
  place-items:center;
  font-size:42px;
  font-weight:800;
}

.ava-btn{
  position:absolute;
  right:4px;
  bottom:4px;
  width:38px;
  height:38px;
  border-radius:50%;
  background:#2f6bff;
  color:#fff;
  border:3px solid #fff;
  cursor:pointer;
  display:grid;
  place-items:center;
  box-shadow:0 4px 12px -4px rgba(47,107,255,.6);
}

.ava-btn:hover{
  background:#1f55e0;
}

.ava-btn:disabled{
  opacity:.6;
  cursor:wait;
}

.pf-name{
  font-size:18px;
  font-weight:700;
}

.pf-role{
  font-size:13px;
  color:#2f6bff;
  background:#eef3ff;
  padding:5px 12px;
  border-radius:20px;
  font-weight:600;
  display:inline-flex;
  align-items:center;
  gap:6px;
}

.pf-remove{
  background:none;
  border:none;
  color:var(--ink3);
  font-size:12.5px;
  cursor:pointer;
  text-decoration:underline;
  font-family:inherit;
}

.pf-sec{
  font-size:12px;
  font-weight:700;
  letter-spacing:.06em;
  text-transform:uppercase;
  color:var(--ink3);
  margin-bottom:14px;
}

.pf-card label{
  font-size:13px;
  font-weight:600;
  color:var(--ink2);
  display:flex;
  flex-direction:column;
  gap:6px;
  margin-bottom:14px;
}

.pf-card .row2{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
}

.pf-card input{
  height:44px;
  border-radius:11px;
  border:1px solid var(--line);
  padding:0 13px;
  font-size:14px;
  font-family:inherit;
  color:var(--ink);
  width:100%;
}

.pf-card .ico{
  position:relative;
  display:flex;
  align-items:center;
}

.pf-card .ico svg{
  position:absolute;
  left:13px;
  color:var(--ink3);
}

.pf-card .ico input{
  padding-left:38px;
}

.pf-card input:focus{
  outline:none;
  border-color:#2f6bff;
  box-shadow:0 0 0 4px #eef3ff;
}

.pf-note{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:12.5px;
  color:var(--ink3);
  background:var(--surf2);
  padding:11px 13px;
  border-radius:11px;
  margin-bottom:16px;
}

.pf-save{
  height:46px;
  width:100%;
  border-radius:12px;
  background:#2f6bff;
  color:#fff;
  font-weight:600;
  font-size:14.5px;
  border:none;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  box-shadow:0 8px 18px -8px rgba(47,107,255,.7);
}

.pf-save:hover{
  background:#1f55e0;
}

.pf-save:disabled{
  opacity:.7;
  cursor:wait;
}

.pf-accordion-card{
  max-width:100%;
  padding:0;
  overflow:hidden;
}

.pf-accordion-toggle{
  width:100%;
  min-height:78px;
  padding:18px 22px;
  background:#fff;
  border:0;
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  font-family:inherit;
  text-align:left;
}

.pf-accordion-toggle:hover{
  background:#f8faff;
}

.pf-accordion-left{
  display:flex;
  align-items:center;
  gap:14px;
}

.pf-accordion-icon{
  width:42px;
  height:42px;
  border-radius:13px;
  background:#eef3ff;
  color:#2f6bff;
  display:grid;
  place-items:center;
  flex-shrink:0;
}

.pf-accordion-left b{
  display:block;
  font-size:15px;
  font-weight:750;
  color:var(--ink);
  margin-bottom:3px;
}

.pf-accordion-left small{
  display:block;
  font-size:13px;
  color:var(--ink3);
  font-weight:500;
}

.pf-chevron{
  color:var(--ink3);
  transition:transform .2s ease;
  flex-shrink:0;
}

.pf-accordion-toggle.open .pf-chevron{
  transform:rotate(180deg);
}

.pf-accordion-panel{
  border-top:1px solid var(--line2);
  padding:20px 22px 22px;
  background:#fbfcff;
  animation:pfDrop .18s ease-out;
}

.pf-actions{
  display:flex;
  justify-content:flex-end;
  align-items:center;
  gap:10px;
  margin-top:4px;
}

.pf-cancel{
  height:44px;
  padding:0 18px;
  border-radius:12px;
  background:#fff;
  color:var(--ink2);
  font-weight:600;
  font-size:14px;
  border:1px solid var(--line);
  cursor:pointer;
  font-family:inherit;
}

.pf-cancel:hover{
  background:#f7f9fc;
}

.pf-cancel:disabled{
  opacity:.65;
  cursor:wait;
}

.pf-inline-save{
  width:auto;
  min-width:170px;
  padding:0 18px;
}

.pf-info-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:12px;
  margin-bottom:14px;
}

.pf-info-box{
  background:#fff;
  border:1px solid var(--line);
  border-radius:13px;
  padding:14px;
}

.pf-info-box span{
  display:block;
  font-size:12px;
  color:var(--ink3);
  font-weight:600;
  margin-bottom:5px;
}

.pf-info-box b{
  display:block;
  font-size:14px;
  color:var(--ink);
  font-weight:750;
}

.pf-switch-list{
  display:flex;
  flex-direction:column;
  gap:10px;
  margin-bottom:16px;
}

.pf-switch-row{
  background:#fff;
  border:1px solid var(--line);
  border-radius:13px;
  padding:14px;
  display:flex !important;
  flex-direction:row !important;
  align-items:center;
  justify-content:space-between;
  gap:16px;
  margin:0 !important;
}

.pf-switch-row span b{
  display:block;
  font-size:14px;
  color:var(--ink);
  margin-bottom:3px;
}

.pf-switch-row span small{
  display:block;
  font-size:12.5px;
  color:var(--ink3);
  font-weight:500;
}

.pf-switch-row input{
  width:42px;
  height:22px;
  accent-color:#2f6bff;
  flex-shrink:0;
}

.pf-choice-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
  margin-bottom:16px;
}

.pf-choice-grid.three{
  grid-template-columns:repeat(3,1fr);
}

.pf-choice{
  min-height:72px;
  background:#fff;
  border:1px solid var(--line);
  border-radius:13px;
  padding:14px;
  cursor:pointer;
  font-family:inherit;
  text-align:left;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  color:var(--ink);
}

.pf-choice:hover{
  border-color:#cfd8eb;
  background:#f9fbff;
}

.pf-choice.selected{
  border-color:#2f6bff;
  background:#f3f7ff;
  box-shadow:0 0 0 3px #eef3ff;
}

.pf-choice b{
  display:block;
  font-size:14px;
  margin-bottom:3px;
}

.pf-choice small{
  display:block;
  font-size:12.5px;
  color:var(--ink3);
  font-weight:500;
}

.pf-choice svg{
  color:#2f6bff;
  flex-shrink:0;
}

.pf-subtitle{
  font-size:12px;
  font-weight:750;
  color:var(--ink3);
  text-transform:uppercase;
  letter-spacing:.06em;
  margin-bottom:10px;
}

.pf-subtitle.with-space{
  margin-top:4px;
}

.spin{
  animation:pfspin 1s linear infinite;
}

@keyframes pfspin{
  to{
    transform:rotate(360deg);
  }
}

@keyframes pfDrop{
  from{
    opacity:0;
    transform:translateY(-6px);
  }
  to{
    opacity:1;
    transform:translateY(0);
  }
}

@media(max-width:760px){
  .pf-grid{
    grid-template-columns:1fr;
  }

  .pf-card .row2{
    grid-template-columns:1fr;
  }

  .pf-accordion-toggle{
    align-items:flex-start;
  }

  .pf-actions{
    flex-direction:column-reverse;
    align-items:stretch;
  }

  .pf-inline-save{
    width:100%;
  }

  .pf-cancel{
    width:100%;
  }

  .pf-info-grid{
    grid-template-columns:1fr;
  }

  .pf-choice-grid,
  .pf-choice-grid.three{
    grid-template-columns:1fr;
  }

  .pf-switch-row{
    align-items:flex-start;
  }
}
`;