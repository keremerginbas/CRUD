import { useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { useAuth } from "../_core/hooks/useAuth";
import {
  Users, UserPlus, Shield, Headphones, Briefcase, Calculator,
  UserCircle, Search, Pencil, Power, X, Check, Crown,
} from "lucide-react";
import { toast } from "sonner";

/* ----------------------------------------------------------------
   Admin Paneli — Kullanıcı & Rol Yönetimi
-----------------------------------------------------------------*/

type Role = "admin" | "sales_manager" | "sales_rep" | "call_center" | "accountant" | "user";

const ROLE_META: Record<Role, { label: string; color: string; bg: string; icon: any; desc: string }> = {
  admin:         { label: "Yönetici",         color: "#f43f6e", bg: "#ffeaf0", icon: Crown,      desc: "Tam yetki" },
  sales_manager: { label: "Satış Müdürü",     color: "#7c5cff", bg: "#f0ecff", icon: Briefcase,  desc: "Ekip yönetimi" },
  sales_rep:     { label: "Satış Temsilcisi", color: "#2f6bff", bg: "#eef3ff", icon: UserCircle, desc: "Satışçı" },
  call_center:   { label: "Çağrı Merkezi",    color: "#06b6d4", bg: "#e3f9fc", icon: Headphones, desc: "Çağrı / destek" },
  accountant:    { label: "Muhasebe",         color: "#10b981", bg: "#e7f9f1", icon: Calculator, desc: "Finans" },
  user:          { label: "Kullanıcı",        color: "#8a93a8", bg: "#eef1f6", icon: UserCircle, desc: "Standart" },
};
const ROLE_ORDER: Role[] = ["admin", "sales_manager", "sales_rep", "call_center", "accountant", "user"];

const GRADS = [["#2f6bff", "#5b8bff"], ["#7c5cff", "#a855f7"], ["#10b981", "#34d399"], ["#f59e0b", "#fbbf24"], ["#06b6d4", "#22d3ee"], ["#f43f6e", "#fb7185"]];
function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}
function hashIdx(s: string, m: number) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % m; }

type FormState = { id?: number; name: string; email: string; role: Role; phone: string; department: string };
const EMPTY: FormState = { name: "", email: "", role: "sales_rep", phone: "", department: "" };

export default function AdminPanel() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { data: users = [], isLoading } = trpc.users.list.useQuery({ includeInactive: true });

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formPassword, setFormPassword] = useState("");
  const [pwUserId, setPwUserId] = useState<number | null>(null);
  const [pwNew, setPwNew] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const isEdit = form.id != null;

  const invalidate = () => utils.users.list.invalidate();
  const setPassword = trpc.auth.setPassword.useMutation({
    onSuccess: () => { toast.success("Şifre belirlendi"); setPwOpen(false); setPwNew(""); },
    onError: (e) => toast.error(e.message || "Şifre belirlenemedi"),
  });
  const createUser = trpc.users.create.useMutation({
    onSuccess: () => { toast.success("Kullanıcı oluşturuldu"); invalidate(); setOpen(false); setForm(EMPTY); },
    onError: (e) => toast.error(e.message || "Hata oluştu"),
  });
  const updateUser = trpc.users.update.useMutation({
    onSuccess: () => { toast.success("Kullanıcı güncellendi"); invalidate(); setOpen(false); setForm(EMPTY); },
    onError: (e) => toast.error(e.message || "Hata oluştu"),
  });
  const setActive = trpc.users.setActive.useMutation({
    onSuccess: () => { invalidate(); },
    onError: (e) => toast.error(e.message || "Hata oluştu"),
  });

  const stats = useMemo(() => {
    const list = users as any[];
    const byRole: Record<string, number> = {};
    list.forEach((u) => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
    return {
      total: list.length,
      active: list.filter((u) => u.isActive).length,
      admins: byRole["admin"] || 0,
      sales: (byRole["sales_rep"] || 0) + (byRole["sales_manager"] || 0),
      callCenter: byRole["call_center"] || 0,
      byRole,
    };
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users as any[]).filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  function openCreate() { setForm(EMPTY); setOpen(true); }
  function openEdit(u: any) {
    setForm({ id: u.id, name: u.name || "", email: u.email || "", role: u.role, phone: u.phone || "", department: u.department || "" });
    setOpen(true);
  }
  function submit() {
    if (!form.name.trim()) { toast.error("İsim gerekli"); return; }
    if (isEdit) {
      updateUser.mutate({ id: form.id!, name: form.name, email: form.email, role: form.role, phone: form.phone, department: form.department });
    } else {
      createUser.mutate({ name: form.name, email: form.email, role: form.role, phone: form.phone, department: form.department });
    }
  }

  const saving = createUser.isPending || updateUser.isPending;

  return (
    <DashboardLayout>
      <style>{CSS}</style>
      <div className="ap">
        <div className="ap-head">
          <div>
            <div className="ap-crumb">Ana Sayfa / Yönetim</div>
            <h1>Kullanıcı Yönetimi</h1>
            
          </div>
          <button className="ap-cta" onClick={openCreate}><UserPlus size={18} strokeWidth={2.3} /> Yeni Kullanıcı</button>
        </div>

        {/* özet kartları */}
        <section className="ap-stats">
          <Stat icon={<Users size={22} />} cls="blue" label="Toplam Kullanıcı" value={stats.total} loading={isLoading} />
          <Stat icon={<Check size={22} />} cls="emerald" label="Aktif" value={stats.active} loading={isLoading} />
          <Stat icon={<UserCircle size={22} />} cls="violet" label="Satış Ekibi" value={stats.sales} loading={isLoading} />
          <Stat icon={<Headphones size={22} />} cls="cyan" label="Çağrı Merkezi" value={stats.callCenter} loading={isLoading} />
        </section>

        {/* filtre + arama */}
        <div className="ap-toolbar">
          <div className="ap-search">
            <Search size={17} />
            <input placeholder="İsim veya e-posta ara…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="ap-roles">
            <button className={roleFilter === "all" ? "on" : ""} onClick={() => setRoleFilter("all")}>Tümü</button>
            {ROLE_ORDER.map((r) => (
              <button key={r} className={roleFilter === r ? "on" : ""} onClick={() => setRoleFilter(r)}
                style={roleFilter === r ? { background: ROLE_META[r].color, color: "#fff" } : {}}>
                {ROLE_META[r].label}{stats.byRole[r] ? ` (${stats.byRole[r]})` : ""}
              </button>
            ))}
          </div>
        </div>

        {/* tablo */}
        <div className="ap-card">
          <table className="ap-table">
            <thead><tr><th>Kullanıcı</th><th>Rol</th><th>İletişim</th><th>Departman</th><th>Durum</th><th>Çalışma</th><th style={{ textAlign: "right" }}>İşlem</th></tr></thead>
            <tbody>
              {isLoading && [0, 1, 2].map((i) => <tr key={i}><td colSpan={7}><div className="ap-skel" /></td></tr>)}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7}><div className="ap-empty">Kullanıcı bulunamadı.</div></td></tr>
              )}
              {!isLoading && filtered.map((u: any) => {
                const meta = ROLE_META[u.role as Role] || ROLE_META.user;
                const RIcon = meta.icon;
                const g = GRADS[hashIdx(u.name || String(u.id), GRADS.length)];
                const isSelf = u.id === user?.id;
                return (
                  <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
                    <td>
                      <div className="ap-user">
                        <div className="av" style={{ background: `linear-gradient(135deg,${g[0]},${g[1]})` }}>{initials(u.name)}</div>
                        <div><b>{u.name || "İsimsiz"}{isSelf && <span className="ap-you">siz</span>}</b><span>#{u.id} · {u.loginMethod || "—"}</span></div>
                      </div>
                    </td>
                    <td>
                      <span className="ap-pill" style={{ color: meta.color, background: meta.bg }}>
                        <RIcon size={13} strokeWidth={2.2} />{meta.label}
                      </span>
                    </td>
                    <td>
                      <div className="ap-contact">
                        <span>{u.email || "—"}</span>
                        {u.phone && <span className="muted">{u.phone}</span>}
                      </div>
                    </td>
                    <td>{u.department || "—"}</td>
                    <td>
                      {u.isActive
                        ? <span className="ap-status on"><i />Aktif</span>
                        : <span className="ap-status off"><i />Pasif</span>}
                    </td>
                    <td>
                      {(() => {
                        const WS: Record<string, { l: string; c: string; b: string }> = {
                          active: { l: "Müsait", c: "#10b981", b: "#e7f9f1" },
                          busy: { l: "Meşgul", c: "#f59e0b", b: "#fff7e6" },
                          meeting: { l: "Toplantıda", c: "#7c5cff", b: "#f0ecff" },
                          away: { l: "İzinli", c: "#8a93a8", b: "#eef1f6" },
                        };
                        const ws = WS[u.workStatus || "active"] || WS.active;
                        return (
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: ws.c, background: ws.b, padding: "4px 10px", borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <i style={{ width: 7, height: 7, borderRadius: "50%", background: ws.c }} />{ws.l}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="ap-actions">
                        <button className="ap-ico" title="Şifre Belirle" onClick={() => { setPwUserId(u.id); setPwNew(""); setPwOpen(true); }}>🔑</button>
                        <button className="ap-ico" title="Düzenle" onClick={() => openEdit(u)}><Pencil size={15} /></button>
                        <button className={"ap-ico " + (u.isActive ? "danger" : "ok")} title={u.isActive ? "Pasifleştir" : "Aktifleştir"}
                          disabled={isSelf || setActive.isPending}
                          onClick={() => setActive.mutate({ id: u.id, isActive: !u.isActive })}>
                          <Power size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* rol açıklama kartları */}
        <section className="ap-rolegrid">
          {ROLE_ORDER.map((r) => {
            const m = ROLE_META[r]; const Ic = m.icon;
            return (
              <div className="ap-rolecard" key={r}>
                <div className="ic" style={{ background: m.bg, color: m.color }}><Ic size={18} /></div>
                <div><b>{m.label}</b><span>{m.desc} · {stats.byRole[r] || 0} kişi</span></div>
              </div>
            );
          })}
        </section>
      </div>

      {/* modal */}
      {open && (
        <div className="ap-overlay" onClick={() => !saving && setOpen(false)}>
          <div className="ap-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ap-modal-head">
              <h3>{isEdit ? "Kullanıcıyı Düzenle" : "Yeni Kullanıcı"}</h3>
              <button className="ap-x" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <div className="ap-form">
              <label>İsim Soyisim
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ör. Ahmet Yılmaz" autoFocus />
              </label>
              <div className="row2">
                <label>E-posta
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ornek@firma.com" />
                </label>
                <label>Telefon
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+90 5xx xxx xx xx" />
                </label>
              </div>
              <label>Departman
                <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Ör. Satış, Çağrı Merkezi" />
              </label>
              {!isEdit && (
                <label>Giriş Şifresi <span style={{fontWeight:400,fontSize:12,color:"#8a93a8"}}>(opsiyonel)</span>
                  <input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="En az 6 karakter" autoComplete="new-password" />
                </label>
              )}
              <div className="ap-rolepick">
                <span className="lbl">Rol</span>
                <div className="grid">
                  {ROLE_ORDER.map((r) => {
                    const m = ROLE_META[r]; const Ic = m.icon; const on = form.role === r;
                    return (
                      <button key={r} type="button" onClick={() => setForm({ ...form, role: r })}
                        className={"role-opt" + (on ? " on" : "")}
                        style={on ? { borderColor: m.color, background: m.bg } : {}}>
                        <span className="ic" style={{ color: m.color }}><Ic size={17} /></span>
                        <b style={on ? { color: m.color } : {}}>{m.label}</b>
                        {on && <Check size={15} style={{ color: m.color, marginLeft: "auto" }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="ap-modal-foot">
              <button className="ghost" onClick={() => setOpen(false)} disabled={saving}>İptal</button>
              <button className="primary" onClick={submit} disabled={saving}>
                {saving ? "Kaydediliyor…" : isEdit ? "Güncelle" : "Oluştur"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Şifre Belirleme Modalı */}
      {pwOpen && (
        <div className="ap-overlay" onClick={() => !setPassword.isPending && setPwOpen(false)}>
          <div className="ap-modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:400}}>
            <div className="ap-modal-head">
              <h3>🔑 Şifre Belirle</h3>
              <button className="ap-x" onClick={() => setPwOpen(false)}><X size={18} /></button>
            </div>
            <div className="ap-form" style={{padding:"20px 22px"}}>
              <p style={{fontSize:13.5,color:"#475069",margin:"0 0 12px"}}>
                Bu kullanıcı belirlediğin şifreyle <strong>/api/dev-login</strong> sayfasından giriş yapabilecek.
              </p>
              <label>Yeni Şifre (en az 6 karakter)
                <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder="••••••••" autoFocus autoComplete="new-password" />
              </label>
            </div>
            <div className="ap-modal-foot">
              <button className="ghost" onClick={() => setPwOpen(false)} disabled={setPassword.isPending}>İptal</button>
              <button className="primary" onClick={() => {
                if (!pwUserId) return;
                if (pwNew.length < 6) { toast.error("En az 6 karakter"); return; }
                setPassword.mutate({ userId: pwUserId, password: pwNew });
              }} disabled={setPassword.isPending}>
                {setPassword.isPending ? "Kaydediliyor…" : "Şifreyi Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function Stat({ icon, cls, label, value, loading }: any) {
  return (
    <div className="ap-stat">
      <div className={"ic " + cls}>{icon}</div>
      <div><div className="v">{loading ? "…" : value}</div><div className="l">{label}</div></div>
    </div>
  );
}

const CSS = `
.ap{--ink:#0f1729;--ink2:#475069;--ink3:#8a93a8;--line:#e7ebf2;--line2:#eef1f6;--surf2:#f7f9fc;
  font-family:"Hanken Grotesk",system-ui,sans-serif;color:var(--ink);letter-spacing:-.01em;display:flex;flex-direction:column;gap:20px;max-width:1380px}
.ap h1,.ap h3{margin:0}
.ap-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.ap-crumb{font-size:13px;color:var(--ink3);font-weight:500;margin-bottom:6px}
.ap-head h1{font-size:26px;font-weight:800;letter-spacing:-.03em}
.ap-head p{color:var(--ink2);font-size:14.5px;margin-top:4px}
.ap-cta{height:42px;padding:0 18px;border-radius:12px;background:#2f6bff;color:#fff;font-weight:600;font-size:14px;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 8px 18px -8px rgba(47,107,255,.7)}
.ap-cta:hover{background:#1f55e0}

.ap-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.ap-stat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;align-items:center;gap:14px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.16)}
.ap-stat .ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex-shrink:0}
.ap-stat .ic.blue{background:#eef3ff;color:#2f6bff}.ap-stat .ic.emerald{background:#e7f9f1;color:#10b981}
.ap-stat .ic.violet{background:#f0ecff;color:#7c5cff}.ap-stat .ic.cyan{background:#e3f9fc;color:#06b6d4}
.ap-stat .v{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1}
.ap-stat .l{font-size:13px;color:var(--ink2);font-weight:500;margin-top:3px}

.ap-toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.ap-search{position:relative;flex:1;min-width:240px;max-width:380px}
.ap-search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--ink3)}
.ap-search input{width:100%;height:42px;border-radius:12px;border:1px solid var(--line);background:#fff;padding:0 14px 0 40px;font-size:14px;font-family:inherit;color:var(--ink)}
.ap-search input:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.ap-roles{display:flex;gap:8px;flex-wrap:wrap}
.ap-roles button{height:38px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:13px;font-weight:600;color:var(--ink2);cursor:pointer;font-family:inherit}
.ap-roles button.on{background:#2f6bff;color:#fff;border-color:transparent}

.ap-card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.16)}
.ap-table{width:100%;border-collapse:collapse}
.ap-table thead th{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:16px 18px 12px}
.ap-table tbody td{padding:13px 18px;border-top:1px solid var(--line2);font-size:14px;vertical-align:middle}
.ap-table tbody tr:hover{background:var(--surf2)}
.ap-user{display:flex;align-items:center;gap:12px}
.ap-user .av{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0}
.ap-user b{font-weight:600;display:flex;align-items:center;gap:7px}
.ap-user span{font-size:12px;color:var(--ink3)}
.ap-you{font-size:10px;font-weight:700;background:#eef3ff;color:#2f6bff;padding:1px 7px;border-radius:20px;letter-spacing:.02em}
.ap-pill{font-size:12.5px;font-weight:600;padding:5px 11px;border-radius:20px;display:inline-flex;align-items:center;gap:6px}
.ap-contact{display:flex;flex-direction:column;gap:2px;font-size:13.5px}
.ap-contact .muted{font-size:12px;color:var(--ink3)}
.ap-status{font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:7px}
.ap-status i{width:7px;height:7px;border-radius:50%}
.ap-status.on{color:#10b981}.ap-status.on i{background:#10b981}
.ap-status.off{color:#8a93a8}.ap-status.off i{background:#8a93a8}
.ap-actions{display:flex;gap:8px;justify-content:flex-end}
.ap-ico{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink2);cursor:pointer;display:grid;place-items:center;transition:.15s}
.ap-ico:hover{border-color:#2f6bff;color:#2f6bff;background:#eef3ff}
.ap-ico.danger:hover{border-color:#f43f6e;color:#f43f6e;background:#ffeaf0}
.ap-ico.ok:hover{border-color:#10b981;color:#10b981;background:#e7f9f1}
.ap-ico:disabled{opacity:.4;cursor:not-allowed}
.ap-empty{padding:32px;text-align:center;color:var(--ink3);font-size:14px}
.ap-skel{height:42px;border-radius:10px;background:linear-gradient(90deg,#eef1f6,#f7f9fc,#eef1f6);background-size:200% 100%;animation:apsk 1.2s infinite}
@keyframes apsk{0%{background-position:200% 0}100%{background-position:-200% 0}}

.ap-rolegrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.ap-rolecard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:13px}
.ap-rolecard .ic{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;flex-shrink:0}
.ap-rolecard b{font-size:14px;font-weight:600;display:block}
.ap-rolecard span{font-size:12.5px;color:var(--ink3)}

.ap-overlay{position:fixed;inset:0;background:rgba(15,23,41,.5);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:100;padding:20px;animation:apfade .15s}
@keyframes apfade{from{opacity:0}}
.ap-modal{background:#fff;border-radius:18px;width:100%;max-width:520px;box-shadow:0 32px 80px -20px rgba(16,24,40,.4);animation:apup .2s cubic-bezier(.2,.7,.3,1)}
@keyframes apup{from{opacity:0;transform:translateY(16px)}}
.ap-modal-head{display:flex;align-items:center;justify-content:space-between;padding:20px 22px;border-bottom:1px solid var(--line2)}
.ap-modal-head h3{font-size:18px;font-weight:700}
.ap-x{width:34px;height:34px;border-radius:10px;border:none;background:var(--surf2);color:var(--ink2);cursor:pointer;display:grid;place-items:center}
.ap-x:hover{background:#eef1f6}
.ap-form{padding:20px 22px;display:flex;flex-direction:column;gap:15px}
.ap-form label{font-size:13px;font-weight:600;color:var(--ink2);display:flex;flex-direction:column;gap:6px}
.ap-form input{height:42px;border-radius:11px;border:1px solid var(--line);padding:0 13px;font-size:14px;font-family:inherit;color:var(--ink)}
.ap-form input:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.ap-form .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ap-rolepick .lbl{font-size:13px;font-weight:600;color:var(--ink2);display:block;margin-bottom:8px}
.ap-rolepick .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.role-opt{display:flex;align-items:center;gap:10px;padding:12px 13px;border-radius:11px;border:1.5px solid var(--line);background:#fff;cursor:pointer;font-family:inherit;transition:.15s}
.role-opt b{font-size:13.5px;font-weight:600;color:var(--ink)}
.role-opt:hover{border-color:#cdd8ec}
.ap-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--line2)}
.ap-modal-foot button{height:42px;padding:0 20px;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;border:none}
.ap-modal-foot .ghost{background:var(--surf2);color:var(--ink2)}
.ap-modal-foot .primary{background:#2f6bff;color:#fff}
.ap-modal-foot .primary:hover{background:#1f55e0}
.ap-modal-foot button:disabled{opacity:.6;cursor:not-allowed}

@media(max-width:1080px){.ap-stats,.ap-rolegrid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:680px){.ap-stats,.ap-rolegrid,.ap-rolepick .grid,.ap-form .row2{grid-template-columns:1fr}}
`;