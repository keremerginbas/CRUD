import { useMemo, useState, useEffect } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Plus, Search, Trash2, Eye, Users, X, Upload, CheckSquare, ChevronDown } from "lucide-react";
import ImportLeads from "../components/ImportLeads";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

/* ----------------------------------------------------------------
   Müşteri Adayları — checkbox + toplu işlemler (Bitrix tarzı)
-----------------------------------------------------------------*/

const GRADS = [["#2f6bff","#5b8bff"],["#7c5cff","#a855f7"],["#10b981","#34d399"],["#f59e0b","#fbbf24"],["#06b6d4","#22d3ee"],["#f43f6e","#fb7185"]];
const PRIO: Record<string,string[]> = { urgent:["Acil","#f43f6e","#ffeaf0"], high:["Yüksek","#f59e0b","#fef4e1"], medium:["Orta","#2f6bff","#eef3ff"], low:["Düşük","#8a93a8","#eef1f6"] };

function initials(n?:string){return(n||"?").trim().charAt(0).toUpperCase()||"?";}
function hashIdx(s:string,m:number){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h%m;}

// 1. Tip Tanımlamaları (TypeScript Güvenliği İçin)
interface Lead {
  id: number; firstName: string; lastName: string; email?: string; phone?: string;
  projectName?: string; city?: string; source?: string; priority: string; statusId: number; createdAt: string;
}
interface Status { id: number; name: string; displayName?: string; color: string; }
interface User { id: number; name?: string; email: string; isActive: boolean; }

// 2. Zod Form Validasyon Şeması
const leadSchema = z.object({
  firstName: z.string().min(2, "Ad en az 2 karakter olmalıdır"),
  lastName: z.string().min(2, "Soyad en az 2 karakter olmalıdır"),
  email: z.string().email("Geçerli e-posta girin").or(z.literal("")).optional(),
  phone: z.string().optional(),
  projectName: z.string().optional(),
  city: z.string().optional(),
  source: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  statusId: z.number().min(1, "Lütfen bir statü seçin"),
  notes: z.string().optional()
});

type LeadFormValues = z.infer<typeof leadSchema>;

export default function Leads() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Toplu seçim stateleri
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [showBulkAssign, setShowBulkAssign] = useState(false);

  const utils = trpc.useUtils();
  const { data: rawLeads = [], isLoading } = trpc.leads.list.useQuery(undefined);
  const { data: rawStatuses = [] } = trpc.statuses.list.useQuery(undefined);
  const { data: rawUsers = [] } = trpc.users.list.useQuery(undefined);

  const leads = rawLeads as Lead[];
  const statuses = rawStatuses as Status[];
  const users = rawUsers as User[];

  // 3. React Hook Form Entegrasyonu
  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: { priority: "medium", statusId: 0, notes: "", email: "" }
  });

  // 4. Arama Optimizasyonu (Debounce) - 300ms gecikme
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Mutations
  const createLead = trpc.leads.create.useMutation({
    onSuccess: () => {
      toast.success("Müşteri adayı oluşturuldu");
      utils.leads.list.invalidate();
      setOpen(false);
      reset(); 
    },
    onError: (e) => toast.error(e.message || "Hata oluştu"),
  });
  
  const deleteLead = trpc.leads.delete.useMutation({
    onSuccess: () => { toast.success("Silindi"); utils.leads.list.invalidate(); },
    onError: () => toast.error("Silinemedi"),
  });
  
  const bulkDelete = trpc.leads.bulkDelete.useMutation({
    onSuccess: (r: any) => { toast.success(`${r.count} kayıt silindi`); utils.leads.list.invalidate(); setSelected(new Set()); },
    onError: () => toast.error("Toplu silme başarısız"),
  });
  
  const bulkUpdate = trpc.leads.bulkUpdate.useMutation({
    onSuccess: (r: any) => { toast.success(`${r.count} kayıt güncellendi`); utils.leads.list.invalidate(); setSelected(new Set()); setShowBulkStatus(false); setShowBulkAssign(false); },
    onError: () => toast.error("Toplu güncelleme başarısız"),
  });

  const statusById = useMemo(() => {
    const m = new Map<number, Status>();
    statuses.forEach(s => m.set(s.id, s));
    return m;
  }, [statuses]);

  // Filtreleme işleminde artık debouncedSearch kullanılıyor (Performans artışı)
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(l => 
      `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) || 
      (l.email || "").toLowerCase().includes(q) || 
      (l.phone || "").toLowerCase().includes(q) || 
      (l.city || "").toLowerCase().includes(q)
    );
  }, [leads, debouncedSearch]);

  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));
  
  function toggleAll() {
    const s = new Set(selected);
    if (allSelected) filtered.forEach(l => s.delete(l.id));
    else filtered.forEach(l => s.add(l.id));
    setSelected(s);
  }
  
  function toggleOne(id: number) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }

  function openCreate() {
    reset(); // Formu tamamen sıfırla
    if (statuses.length > 0) setValue("statusId", statuses[0].id); // İlk statüyü otomatik seç
    setOpen(true);
  }

  const onSubmit = (data: LeadFormValues) => {
    createLead.mutate(data);
  };

  function remove(id: number) { if (confirm("Silinsin mi?")) deleteLead.mutate({ id }); }
  function doBulkDelete() { if (confirm(`${selected.size} kayıt silinsin mi? Bu işlem geri alınamaz.`)) bulkDelete.mutate({ ids: Array.from(selected) }); }

  const selArr = Array.from(selected);

  return (
    <DashboardLayout>
      <style>{CSS}</style>
      <div className="lp">
        <div className="lp-head">
          <div>
            <div className="lp-crumb">Ana Sayfa / Müşteri Adayları</div>
            <h1>Müşteri Adayları</h1>
            <p>{isLoading ? "Yükleniyor…" : `${filtered.length} kayıt listeleniyor`}</p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="lp-imp" onClick={() => setImportOpen(true)}><Upload size={17} /> İçe Aktar</button>
            <button className="lp-cta" onClick={openCreate}><Plus size={18} strokeWidth={2.3} /> Yeni Aday</button>
          </div>
        </div>

        <div className="lp-search">
          <Search size={17} />
          {/* Arama Inputu */}
          <input 
            placeholder="Ad, e-posta, telefon veya şehir ara…" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
          />
        </div>

        <div className="lp-card">
          <table className="lp-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input type="checkbox" className="lp-cb" checked={allSelected} onChange={toggleAll} title="Tümünü seç" />
                </th>
                <th>Müşteri</th><th>İletişim</th><th>Proje / Şehir</th><th>Kaynak</th><th>Durum</th><th>Öncelik</th><th style={{ textAlign: "right" }}>İşlem</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && [0, 1, 2, 3].map(i => <tr key={i}><td colSpan={8}><div className="lp-skel" /></td></tr>)}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8}><div className="lp-empty"><div className="ic"><Users size={22} /></div><b>{search ? "Sonuç bulunamadı" : "Henüz müşteri adayı yok"}</b><span>{search ? "Arama kriterini değiştirin" : "İlk adayını ekleyerek başla"}</span></div></td></tr>
              )}
              {!isLoading && filtered.map((l) => {
                const g = GRADS[hashIdx(`${l.firstName}${l.lastName}`, GRADS.length)];
                const st = statusById.get(l.statusId);
                const [pl, pc, pb] = PRIO[l.priority] || PRIO.medium;
                const isSel = selected.has(l.id);
                return (
                  <tr key={l.id} className={isSel ? "sel" : ""}>
                    <td><input type="checkbox" className="lp-cb" checked={isSel} onChange={() => toggleOne(l.id)} /></td>
                    <td><div className="lp-cell"><div className="av" style={{ background: `linear-gradient(135deg,${g[0]},${g[1]})` }}>{initials(l.firstName)}</div><div><b>{l.firstName} {l.lastName}</b><span>{new Date(l.createdAt).toLocaleDateString("tr-TR")}</span></div></div></td>
                    <td><div className="lp-contact"><span>{l.email || "—"}</span>{l.phone && <span className="muted">{l.phone}</span>}</div></td>
                    <td>{l.projectName || "—"}{l.city ? ` · ${l.city}` : ""}</td>
                    <td>{l.source || "—"}</td>
                    <td>{st ? <span className="lp-pill" style={{ color: st.color, background: (st.color || "#888") + "1A" }}><i style={{ background: st.color }} />{st.displayName || st.name}</span> : "—"}</td>
                    <td><span className="lp-prio" style={{ color: pc, background: pb }}>{pl}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <div className="lp-actions">
                        <button className="lp-ico" title="Detay" onClick={() => navigate(`/leads/${l.id}`)}><Eye size={15} /></button>
                        <button className="lp-ico danger" title="Sil" onClick={() => remove(l.id)} disabled={deleteLead.isPending}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toplu İşlem Çubuğu */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <div className="bulk-info">
            <CheckSquare size={18} />
            <b>{selected.size}</b> kayıt seçildi
            <button className="bulk-clr" onClick={() => setSelected(new Set())}><X size={14} /></button>
          </div>
          <div className="bulk-acts">
            <div className="bulk-dd">
              <button className="bulk-btn" onClick={() => { setShowBulkStatus(s => !s); setShowBulkAssign(false); }}>
                Aşama Değiştir <ChevronDown size={14} />
              </button>
              {showBulkStatus && (
                <div className="bulk-menu">
                  {statuses.map(s => (
                    <button key={s.id} onClick={() => bulkUpdate.mutate({ ids: selArr, statusId: s.id })}>
                      <i style={{ background: s.color }} />{s.displayName || s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="bulk-dd">
              <button className="bulk-btn" onClick={() => { setShowBulkAssign(s => !s); setShowBulkStatus(false); }}>
                Sorumlu Değiştir <ChevronDown size={14} />
              </button>
              {showBulkAssign && (
                <div className="bulk-menu">
                  <button onClick={() => bulkUpdate.mutate({ ids: selArr, assignedToId: null })}>— Atanmamış</button>
                  {users.filter(u => u.isActive).map(u => (
                    <button key={u.id} onClick={() => bulkUpdate.mutate({ ids: selArr, assignedToId: u.id })}>
                      {u.name || u.email}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="bulk-del" onClick={doBulkDelete} disabled={bulkDelete.isPending}>
              <Trash2 size={15} /> {bulkDelete.isPending ? "Siliniyor…" : "Seçilenleri Sil"}
            </button>
          </div>
        </div>
      )}

      {/* RHF Entegreli Yeni Aday Modal */}
      {open && (
        <div className="lp-overlay" onClick={() => !createLead.isPending && setOpen(false)}>
          <div className="lp-modal" onClick={e => e.stopPropagation()}>
            <div className="lp-modal-head"><h3>Yeni Müşteri Adayı</h3><button className="lp-x" onClick={() => setOpen(false)}><X size={18} /></button></div>
            <form onSubmit={handleSubmit(onSubmit)} className="lp-form">
              <div className="row2">
                <label>Ad
                  <input {...register("firstName")} autoFocus />
                  {errors.firstName && <span className="lp-error">{errors.firstName.message}</span>}
                </label>
                <label>Soyad
                  <input {...register("lastName")} />
                  {errors.lastName && <span className="lp-error">{errors.lastName.message}</span>}
                </label>
              </div>
              <div className="row2">
                <label>E-posta
                  <input {...register("email")} placeholder="ornek@mail.com" />
                  {errors.email && <span className="lp-error">{errors.email.message}</span>}
                </label>
                <label>Telefon
                  <input {...register("phone")} placeholder="+90 5xx…" />
                </label>
              </div>
              <div className="row2">
                <label>Proje
                  <input {...register("projectName")} placeholder="3+1 Daire" />
                </label>
                <label>Şehir
                  <input {...register("city")} placeholder="İstanbul" />
                </label>
              </div>
              <div className="row2">
                <label>Kaynak
                  <input {...register("source")} placeholder="Sahibinden, Web…" />
                </label>
                <label>Statü
                  <select {...register("statusId", { valueAsNumber: true })}>
                    {statuses.length === 0 && <option value={0}>— yok —</option>}
                    {statuses.map(s => <option key={s.id} value={s.id}>{s.displayName || s.name}</option>)}
                  </select>
                  {errors.statusId && <span className="lp-error">{errors.statusId.message}</span>}
                </label>
              </div>
              <div className="row2">
                <label>Öncelik
                  <select {...register("priority")}>
                    <option value="low">Düşük</option>
                    <option value="medium">Orta</option>
                    <option value="high">Yüksek</option>
                    <option value="urgent">Acil</option>
                  </select>
                </label>
                <div />
              </div>
              <label>Notlar
                <textarea rows={2} {...register("notes")} />
              </label>
              <div className="lp-modal-foot">
                <button type="button" className="ghost" onClick={() => setOpen(false)} disabled={createLead.isPending}>İptal</button>
                <button type="submit" className="primary" disabled={createLead.isPending}>{createLead.isPending ? "Kaydediliyor…" : "Oluştur"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {importOpen && <ImportLeads onClose={() => setImportOpen(false)} defaultStatusId={statuses[0]?.id} />}
    </DashboardLayout>
  );
}

// Orijinal CSS Yapınız ve Hata mesajları için eklenen (.lp-error) sınıfı
const CSS = `
.lp{--ink:#0f1729;--ink2:#475069;--ink3:#8a93a8;--line:#e7ebf2;--line2:#eef1f6;--surf2:#f7f9fc;
  font-family:"Hanken Grotesk",system-ui,sans-serif;color:var(--ink);letter-spacing:-.01em;display:flex;flex-direction:column;gap:20px;max-width:1380px}
.lp h1,.lp h3{margin:0}
.lp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.lp-crumb{font-size:13px;color:var(--ink3);font-weight:500;margin-bottom:6px}
.lp-head h1{font-size:26px;font-weight:800;letter-spacing:-.03em}
.lp-head p{color:var(--ink2);font-size:14.5px;margin-top:4px}
.lp-cta{height:42px;padding:0 18px;border-radius:12px;background:#2f6bff;color:#fff;font-weight:600;font-size:14px;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 8px 18px -8px rgba(47,107,255,.7)}
.lp-cta:hover{background:#1f55e0}
.lp-imp{height:42px;padding:0 16px;border-radius:12px;background:#fff;color:#2f6bff;font-weight:600;font-size:14px;border:1.5px solid #cdd8ec;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:inherit}
.lp-imp:hover{background:#eef3ff;border-color:#2f6bff}
.lp-search{position:relative;max-width:420px}
.lp-search svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--ink3)}
.lp-search input{width:100%;height:44px;border-radius:12px;border:1px solid var(--line);background:#fff;padding:0 14px 0 42px;font-size:14px;font-family:inherit;color:var(--ink)}
.lp-search input:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.lp-card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.16)}
.lp-table{width:100%;border-collapse:collapse}
.lp-cb{width:17px;height:17px;accent-color:#2f6bff;cursor:pointer}
.lp-table thead th{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:14px 16px 10px}
.lp-table thead th:first-child{padding-left:18px}
.lp-table tbody td{padding:12px 16px;border-top:1px solid var(--line2);font-size:14px;vertical-align:middle}
.lp-table tbody td:first-child{padding-left:18px}
.lp-table tbody tr:hover{background:var(--surf2)}
.lp-table tbody tr.sel{background:#eef3ff}
.lp-cell{display:flex;align-items:center;gap:12px}
.lp-cell .av{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:14px;flex-shrink:0}
.lp-cell b{font-weight:600;display:block}.lp-cell span{font-size:12px;color:var(--ink3)}
.lp-contact{display:flex;flex-direction:column;gap:2px;font-size:13.5px}.lp-contact .muted{font-size:12px;color:var(--ink3)}
.lp-pill{font-size:12px;font-weight:600;padding:5px 11px;border-radius:20px;display:inline-flex;align-items:center;gap:6px}.lp-pill i{width:6px;height:6px;border-radius:50%}
.lp-prio{font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px}
.lp-actions{display:flex;gap:8px;justify-content:flex-end}
.lp-ico{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink2);cursor:pointer;display:grid;place-items:center;transition:.15s}
.lp-ico:hover{border-color:#2f6bff;color:#2f6bff;background:#eef3ff}
.lp-ico.danger:hover{border-color:#f43f6e;color:#f43f6e;background:#ffeaf0}
.lp-ico:disabled{opacity:.4;cursor:not-allowed}
.lp-empty{padding:40px 8px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px}
.lp-empty .ic{width:54px;height:54px;border-radius:15px;background:#eef3ff;color:#2f6bff;display:grid;place-items:center;margin-bottom:4px}
.lp-empty b{font-size:15px;font-weight:700}.lp-empty span{font-size:13.5px;color:var(--ink3)}
.lp-skel{height:44px;border-radius:10px;background:linear-gradient(90deg,#eef1f6,#f7f9fc,#eef1f6);background-size:200% 100%;animation:lpsk 1.2s infinite}
@keyframes lpsk{0%{background-position:200% 0}100%{background-position:-200% 0}}

/* toplu işlem çubuğu */
.bulk-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f1729;color:#fff;border-radius:16px;padding:12px 18px;display:flex;align-items:center;gap:16px;box-shadow:0 20px 60px -10px rgba(16,24,40,.5);z-index:50;white-space:nowrap;animation:bulkup .2s cubic-bezier(.2,.7,.3,1)}
@keyframes bulkup{from{opacity:0;transform:translateX(-50%) translateY(12px)}}
.bulk-info{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;padding-right:12px;border-right:1px solid rgba(255,255,255,.15)}
.bulk-clr{background:rgba(255,255,255,.12);border:none;color:#fff;width:22px;height:22px;border-radius:6px;cursor:pointer;display:grid;place-items:center;margin-left:4px}
.bulk-clr:hover{background:rgba(255,255,255,.22)}
.bulk-acts{display:flex;align-items:center;gap:8px}
.bulk-btn{height:36px;padding:0 14px;border-radius:10px;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit}
.bulk-btn:hover{background:rgba(255,255,255,.18)}
.bulk-del{height:36px;padding:0 14px;border-radius:10px;background:#f43f6e;color:#fff;border:none;font-size:13.5px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit}
.bulk-del:hover{background:#e02d5a}.bulk-del:disabled{opacity:.6;cursor:wait}
.bulk-dd{position:relative}
.bulk-menu{position:absolute;bottom:calc(100% + 10px);left:0;background:#fff;border:1px solid #e7ebf2;border-radius:12px;min-width:220px;max-height:300px;overflow-y:auto;box-shadow:0 16px 40px -8px rgba(16,24,40,.28);z-index:9999}
.bulk-menu button{width:100%;text-align:left;padding:11px 14px;border:none;background:#fff;color:#0f1729;font-size:14px;font-family:inherit;cursor:pointer;display:flex;align-items:center;gap:8px}
.bulk-menu button i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.bulk-menu button:hover{background:#f7f9fc}

.lp-overlay{position:fixed;inset:0;background:rgba(15,23,41,.5);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:100;padding:20px}
.lp-modal{background:#fff;border-radius:18px;width:100%;max-width:560px;box-shadow:0 32px 80px -20px rgba(16,24,40,.4)}
.lp-modal-head{display:flex;align-items:center;justify-content:space-between;padding:20px 22px;border-bottom:1px solid var(--line2)}
.lp-modal-head h3{font-size:18px;font-weight:700}
.lp-x{width:34px;height:34px;border-radius:10px;border:none;background:#f7f9fc;color:var(--ink2);cursor:pointer;display:grid;place-items:center}
.lp-form{padding:20px 22px;display:flex;flex-direction:column;gap:14px}
.lp-form .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.lp-form label{font-size:13px;font-weight:600;color:var(--ink2);display:flex;flex-direction:column;gap:6px}
.lp-form input,.lp-form select,.lp-form textarea{height:42px;border-radius:11px;border:1px solid var(--line);padding:0 13px;font-size:14px;font-family:inherit;color:var(--ink);background:#fff}
.lp-form textarea{height:auto;padding:10px 13px;resize:vertical}
.lp-form input:focus,.lp-form select:focus,.lp-form textarea:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.lp-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--line2)}
.lp-modal-foot button{height:42px;padding:0 20px;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;border:none}
.lp-modal-foot .ghost{background:#f7f9fc;color:var(--ink2)}
.lp-modal-foot .primary{background:#2f6bff;color:#fff}.lp-modal-foot .primary:hover{background:#1f55e0}
.lp-modal-foot button:disabled{opacity:.6;cursor:not-allowed}
.lp-error { color: #f43f6e; font-size: 12px; font-weight: 500; }
@media(max-width:680px){.lp-form .row2{grid-template-columns:1fr}.bulk-bar{flex-direction:column;gap:10px;bottom:12px}}
`;