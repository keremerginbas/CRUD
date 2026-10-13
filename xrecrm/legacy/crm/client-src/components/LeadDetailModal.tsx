import { useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import {
  X, Phone, Mail, MapPin, Building2, Calendar, User, Save,
  MessageSquarePlus, CalendarPlus, Clock, Video, Users as UsersIcon, StickyNote, Trash2,
} from "lucide-react";

/* ----------------------------------------------------------------
   Bitrix tarzı Kişi (Lead) Kartı — Kanban'da çift tıkla açılır
   Sol: bilgiler (düzenlenebilir)  ·  Sağ: yorum/not + toplantı + zaman çizelgesi
-----------------------------------------------------------------*/

const PRIO: Record<string, [string, string, string]> = {
  urgent: ["Acil", "#f43f6e", "#ffeaf0"], high: ["Yüksek", "#f59e0b", "#fef4e1"],
  medium: ["Orta", "#2f6bff", "#eef3ff"], low: ["Düşük", "#8a93a8", "#eef1f6"],
};
const ACT_ICON: Record<string, any> = { note: StickyNote, call: Phone, email: Mail, meeting: Video, task: Clock, whatsapp: MessageSquarePlus, sms: MessageSquarePlus, form_submission: StickyNote };

function initials(n?: string) { return (n || "?").trim().charAt(0).toUpperCase() || "?"; }
function toLocalInput(d?: any) {
  if (!d) return "";
  const dt = new Date(d); if (isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
function fmtDateTime(d?: any) {
  if (!d) return "";
  return new Date(d).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

type Form = {
  firstName: string; lastName: string; email: string; phone: string;
  projectName: string; city: string; source: string;
  priority: "low" | "medium" | "high" | "urgent"; statusId: number;
  assignedToId: number | 0; nextFollowUpDate: string;
};

export default function LeadDetailModal({ leadId, onClose }: { leadId: number | null; onClose: () => void }) {
  const enabled = leadId != null;
  const utils = trpc.useUtils();

  const { data: lead } = trpc.leads.getById.useQuery({ id: leadId ?? 0 }, { enabled });
  const { data: statuses = [] } = trpc.statuses.list.useQuery(undefined);
  const { data: users = [] } = trpc.users.list.useQuery(undefined);
  const { data: activities = [] } = trpc.activities.getByLeadId.useQuery({ leadId: leadId ?? 0 }, { enabled });
  const { data: meetings = [] } = trpc.meetings.getByLeadId.useQuery({ leadId: leadId ?? 0 }, { enabled });
  const { data: allLeads = [] } = trpc.leads.list.useQuery(undefined);

  // Kaynak önerileri: yaygın kaynaklar + mevcut müşterilerde geçen kaynaklar (yeni yazılan otomatik eklenir)
  const sourceOptions = useMemo(() => {
    const base = ["Web sitesi", "Reklam", "Arama", "Sahibinden", "Hürriyet Emlak", "Emlakjet", "Instagram", "Facebook", "WhatsApp", "Referans", "Yürüyen Müşteri"];
    const fromLeads = (allLeads as any[]).map((l) => l.source).filter(Boolean);
    return Array.from(new Set([...base, ...fromLeads]));
  }, [allLeads]);

  const [form, setForm] = useState<Form>({
    firstName: "", lastName: "", email: "", phone: "", projectName: "", city: "", source: "",
    priority: "medium", statusId: 0, assignedToId: 0, nextFollowUpDate: "",
  });
  const [comment, setComment] = useState("");
  const [mTitle, setMTitle] = useState("");
  const [mTime, setMTime] = useState("");
  const [mType, setMType] = useState<"video" | "phone" | "in_person">("video");

  useEffect(() => {
    if (!lead) return;
    const l = lead as any;
    setForm({
      firstName: l.firstName || "", lastName: l.lastName || "", email: l.email || "",
      phone: l.phone || "", projectName: l.projectName || "", city: l.city || "",
      source: l.source || "", priority: l.priority || "medium", statusId: l.statusId || 0,
      assignedToId: l.assignedToId || 0, nextFollowUpDate: toLocalInput(l.nextFollowUpDate),
    });
  }, [lead]);

  const refresh = () => {
    if (leadId == null) return;
    utils.leads.getById.invalidate({ id: leadId });
    utils.leads.list.invalidate();
    utils.activities.getByLeadId.invalidate({ leadId });
    utils.meetings.getByLeadId.invalidate({ leadId });
  };

  const updateLead = trpc.leads.update.useMutation({
    onSuccess: () => { toast.success("Bilgiler kaydedildi"); refresh(); },
    onError: (e) => toast.error(e.message || "Kaydedilirken hata oluştu"),
  });
  const deleteLead = trpc.leads.delete.useMutation({
    onSuccess: () => {
      toast.success("Müşteri silindi");
      utils.leads.list.invalidate();
      utils.statuses.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message || "Silinemedi"),
  });
  function onDelete() {
    if (leadId == null) return;
    const ad = `${form.firstName} ${form.lastName}`.trim() || "bu müşteri";
    if (confirm(`"${ad}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) {
      deleteLead.mutate({ id: leadId });
    }
  }
  const addActivity = trpc.activities.create.useMutation({
    onSuccess: () => { toast.success("Yorum eklendi"); setComment(""); refresh(); },
    onError: () => toast.error("Yorum eklenemedi"),
  });
  const addMeeting = trpc.meetings.create.useMutation({
    onSuccess: () => { toast.success("Toplantı oluşturuldu"); setMTitle(""); setMTime(""); refresh(); },
    onError: () => toast.error("Toplantı oluşturulamadı"),
  });

  const status = useMemo(() => (statuses as any[]).find((s) => s.id === form.statusId), [statuses, form.statusId]);
  const assignedUser = useMemo(() => (users as any[]).find((u) => u.id === form.assignedToId), [users, form.assignedToId]);

  const timeline = useMemo(() => {
    const a = (activities as any[]).map((x) => ({ kind: "activity", date: x.createdAt, type: x.type, title: x.title, desc: x.description }));
    const m = (meetings as any[]).map((x) => ({ kind: "meeting", date: x.createdAt, type: "meeting", title: x.title, desc: `Toplantı · ${fmtDateTime(x.startTime)}` }));
    return [...a, ...m].sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  }, [activities, meetings]);

  if (!enabled) return null;

  function save() {
    if (leadId == null) return;
    updateLead.mutate({
      id: leadId,
      firstName: form.firstName || undefined,
      lastName: form.lastName || undefined,
      email: form.email ? form.email : undefined,
      phone: form.phone || undefined,
      projectName: form.projectName || undefined,
      city: form.city || undefined,
      source: form.source || undefined,
      priority: form.priority,
      statusId: form.statusId || undefined,
      assignedToId: form.assignedToId || undefined,
      nextFollowUpDate: form.nextFollowUpDate ? new Date(form.nextFollowUpDate) : undefined,
    });
  }
  function postComment() {
    if (leadId == null || !comment.trim()) return;
    addActivity.mutate({ leadId, type: "note", title: "Not", description: comment.trim() });
  }
  function createMeeting() {
    if (leadId == null || !mTitle.trim() || !mTime) { toast.error("Başlık ve tarih gerekli"); return; }
    addMeeting.mutate({ leadId, title: mTitle.trim(), startTime: new Date(mTime), meetingType: mType });
  }

  const [pl, pc, pb] = PRIO[form.priority] || PRIO.medium;
  const fullName = `${form.firstName} ${form.lastName}`.trim() || "İsimsiz";

  return (
    <div className="ldm-overlay" onClick={onClose}>
      <style>{CSS}</style>
      <div className="ldm" onClick={(e) => e.stopPropagation()}>
        {/* başlık */}
        <div className="ldm-head">
          <div className="who">
            <div className="av">{initials(form.firstName || fullName)}</div>
            <div>
              <h2>{fullName}</h2>
              <div className="sub">
                {form.projectName && <span><Building2 size={13} />{form.projectName}</span>}
                {status && <span className="st" style={{ background: status.color }}>{status.displayName || status.name}</span>}
                <span className="pr" style={{ color: pc, background: pb }}>{pl}</span>
              </div>
            </div>
          </div>
          <button className="ldm-x" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="ldm-body">
          {/* SOL — bilgiler */}
          <div className="ldm-left">
            <div className="sec-title">Müşteri Bilgileri</div>
            <div className="row2">
              <label>Ad<input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
              <label>Soyad<input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
            </div>
            <label>Telefon
              <div className="with-btn">
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+90 5xx…" />
                {form.phone && <a className="callbtn" href={`tel:${form.phone}`} title="Ara"><Phone size={15} /></a>}
              </div>
            </label>
            <label>E-posta
              <div className="with-btn">
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ornek@mail.com" />
                {form.email && <a className="callbtn" href={`mailto:${form.email}`} title="E-posta"><Mail size={15} /></a>}
              </div>
            </label>
            <div className="row2">
              <label>Proje<input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} /></label>
              <label>Şehir<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
            </div>
            <div className="row2">
              <label>Kaynak
                <input value={form.source} list="ldm-source-list" placeholder="Seç veya yeni yaz"
                  onChange={(e) => setForm({ ...form, source: e.target.value })} />
                <datalist id="ldm-source-list">
                  {sourceOptions.map((s) => <option key={s} value={s} />)}
                </datalist>
              </label>
              <label>Öncelik
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as any })}>
                  <option value="low">Düşük</option><option value="medium">Orta</option>
                  <option value="high">Yüksek</option><option value="urgent">Acil</option>
                </select>
              </label>
            </div>
            <div className="row2">
              <label>Durum
                <select value={form.statusId} onChange={(e) => setForm({ ...form, statusId: Number(e.target.value) })}>
                  {(statuses as any[]).map((s) => <option key={s.id} value={s.id}>{s.displayName || s.name}</option>)}
                </select>
              </label>
              <label>Sorumlu Kişi
                <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: Number(e.target.value) })}>
                  <option value={0}>— atanmamış —</option>
                  {(users as any[]).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </label>
            </div>
            <label>Randevu Tarihi
              <input type="datetime-local" value={form.nextFollowUpDate} onChange={(e) => setForm({ ...form, nextFollowUpDate: e.target.value })} />
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
              <button className="ldm-save" onClick={save} disabled={updateLead.isPending} style={{ flex: 1 }}>
                <Save size={16} /> {updateLead.isPending ? "Kaydediliyor…" : "Bilgileri Kaydet"}
              </button>
              <button
                onClick={onDelete}
                disabled={deleteLead.isPending}
                title="Müşteriyi sil"
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "0 16px", borderRadius: 12, border: "1px solid #fecaca",
                  background: "#fff1f2", color: "#e11d48", fontWeight: 600, fontSize: 14,
                  cursor: deleteLead.isPending ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                }}
              >
                <Trash2 size={16} /> {deleteLead.isPending ? "Siliniyor…" : "Sil"}
              </button>
            </div>
          </div>

          {/* SAĞ — aktivite */}
          <div className="ldm-right">
            {/* toplantı oluştur */}
            <div className="box">
              <div className="box-h"><CalendarPlus size={16} /> Toplantı Oluştur</div>
              <input className="full" placeholder="Toplantı başlığı (ör. Daire gösterimi)" value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
              <div className="row2">
                <input type="datetime-local" value={mTime} onChange={(e) => setMTime(e.target.value)} />
                <select value={mType} onChange={(e) => setMType(e.target.value as any)}>
                  <option value="video">Video</option><option value="phone">Telefon</option><option value="in_person">Yüz yüze</option>
                </select>
              </div>
              <button className="mini" onClick={createMeeting} disabled={addMeeting.isPending}>
                {addMeeting.isPending ? "Oluşturuluyor…" : "Toplantı Ekle"}
              </button>
            </div>

            {/* yorum / not */}
            <div className="box">
              <div className="box-h"><MessageSquarePlus size={16} /> Yorum / Not</div>
              <textarea rows={2} placeholder="Bir not bırak…" value={comment} onChange={(e) => setComment(e.target.value)} />
              <button className="mini" onClick={postComment} disabled={addActivity.isPending || !comment.trim()}>
                {addActivity.isPending ? "Ekleniyor…" : "Yorum Ekle"}
              </button>
            </div>

            {/* zaman çizelgesi */}
            <div className="tl-title">Zaman Çizelgesi</div>
            <div className="tl">
              {timeline.length === 0 && <div className="tl-empty">Henüz aktivite yok.</div>}
              {timeline.map((t, i) => {
                const Ic = ACT_ICON[t.type] || StickyNote;
                return (
                  <div className="tl-item" key={i}>
                    <div className="tl-ic"><Ic size={14} /></div>
                    <div className="tl-c">
                      <div className="tl-top"><b>{t.title}</b><span>{fmtDateTime(t.date)}</span></div>
                      {t.desc && <p>{t.desc}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.ldm-overlay{position:fixed;inset:0;background:rgba(15,23,41,.55);backdrop-filter:blur(5px);z-index:200;display:grid;place-items:center;padding:24px;font-family:"Hanken Grotesk",system-ui,sans-serif;animation:ldmf .15s}
@keyframes ldmf{from{opacity:0}}
.ldm{--ink:#0f1729;--ink2:#475069;--ink3:#8a93a8;--line:#e7ebf2;--line2:#eef1f6;--surf2:#f7f9fc;
  background:#fff;border-radius:20px;width:100%;max-width:1040px;height:86vh;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 40px 100px -24px rgba(16,24,40,.5);color:var(--ink);letter-spacing:-.01em;animation:ldmu .22s cubic-bezier(.2,.7,.3,1)}
@keyframes ldmu{from{opacity:0;transform:translateY(18px) scale(.99)}}
.ldm h2{margin:0;font-size:20px;font-weight:800;letter-spacing:-.03em}
.ldm-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;
  background:linear-gradient(120deg,#2f6bff,#5b8bff);color:#fff;flex-shrink:0}
.ldm-head h2{color:#fff}
.ldm-head .who{display:flex;align-items:center;gap:14px}
.ldm-head .av{width:54px;height:54px;border-radius:15px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.35);
  display:grid;place-items:center;font-size:20px;font-weight:800;flex-shrink:0}
.ldm-head .sub{display:flex;align-items:center;gap:10px;margin-top:5px;flex-wrap:wrap}
.ldm-head .sub span{font-size:12.5px;color:rgba(255,255,255,.92);display:inline-flex;align-items:center;gap:5px}
.ldm-head .sub .st{padding:3px 10px;border-radius:20px;font-weight:600;color:#fff !important;border:1px solid rgba(255,255,255,.4)}
.ldm-head .sub .pr{padding:3px 10px;border-radius:20px;font-weight:700}
.ldm-x{width:38px;height:38px;border-radius:11px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;display:grid;place-items:center;flex-shrink:0}
.ldm-x:hover{background:rgba(255,255,255,.28)}

.ldm-body{display:grid;grid-template-columns:42% 58%;flex:1;min-height:0}
.ldm-left{padding:20px 22px;overflow-y:auto;border-right:1px solid var(--line2);display:flex;flex-direction:column;gap:13px}
.ldm-right{padding:20px 22px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;background:var(--surf2)}
.sec-title{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.ldm-left .row2{display:grid;grid-template-columns:1fr 1fr;gap:11px}
.ldm-left label{font-size:12.5px;font-weight:600;color:var(--ink2);display:flex;flex-direction:column;gap:5px}
.ldm-left input,.ldm-left select{height:40px;border-radius:10px;border:1px solid var(--line);padding:0 12px;font-size:14px;font-family:inherit;color:var(--ink);background:#fff;width:100%}
.ldm-left input:focus,.ldm-left select:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.with-btn{display:flex;gap:8px}
.with-btn input{flex:1}
.callbtn{width:40px;border-radius:10px;background:#e7f9f1;color:#10b981;display:grid;place-items:center;flex-shrink:0;text-decoration:none;border:1px solid #d1f0e2}
.callbtn:hover{background:#10b981;color:#fff}
.ldm-save{margin-top:6px;height:44px;border-radius:12px;background:#2f6bff;color:#fff;font-weight:600;font-size:14px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 18px -8px rgba(47,107,255,.7)}
.ldm-save:hover{background:#1f55e0}.ldm-save:disabled{opacity:.6;cursor:not-allowed}

.box{background:#fff;border:1px solid var(--line);border-radius:13px;padding:14px;display:flex;flex-direction:column;gap:10px}
.box-h{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;color:var(--ink)}
.box .full,.box textarea,.box input,.box select{border-radius:10px;border:1px solid var(--line);padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--ink);background:#fff}
.box textarea{resize:vertical}
.box .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.box input:focus,.box select:focus,.box textarea:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.mini{align-self:flex-start;height:38px;padding:0 16px;border-radius:10px;background:#0f1729;color:#fff;font-weight:600;font-size:13px;border:none;cursor:pointer}
.mini:hover{background:#1e293b}.mini:disabled{opacity:.5;cursor:not-allowed}

.tl-title{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);margin-top:2px}
.tl{display:flex;flex-direction:column;gap:10px}
.tl-empty{color:var(--ink3);font-size:13.5px;padding:8px 0}
.tl-item{display:flex;gap:11px}
.tl-ic{width:30px;height:30px;border-radius:9px;background:#eef3ff;color:#2f6bff;display:grid;place-items:center;flex-shrink:0}
.tl-c{flex:1;background:#fff;border:1px solid var(--line);border-radius:11px;padding:10px 12px}
.tl-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.tl-top b{font-size:13.5px;font-weight:600}
.tl-top span{font-size:11.5px;color:var(--ink3);white-space:nowrap}
.tl-c p{font-size:13px;color:var(--ink2);margin:5px 0 0;white-space:pre-wrap}

@media(max-width:820px){.ldm-body{grid-template-columns:1fr;overflow-y:auto}.ldm-left{border-right:none;border-bottom:1px solid var(--line2)}}
`;