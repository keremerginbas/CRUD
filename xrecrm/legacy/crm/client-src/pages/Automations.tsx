import { useState, useMemo } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Plus, Trash2, Power, X, Zap, ArrowRight, UserCog, Webhook, ListTodo, GripVertical } from "lucide-react";

/* ----------------------------------------------------------------
   Otomasyon Kuralları — Bitrix tarzı arka plan otomasyonları
   "Lead X statüsüne geçince → sırayla sorumlu ata / webhook / görev"
-----------------------------------------------------------------*/

const ACTIONS = [
  { value: "assign",   label: "Sorumlu ata (sırayla)", icon: UserCog,  color: "#2f6bff", desc: "Round-robin: seçtiğin kişilere sırayla dağıtır" },
  { value: "webhook",  label: "n8n'e webhook gönder",  icon: Webhook,  color: "#7c5cff", desc: "Belirttiğin URL'e lead bilgisini POST eder" },
  { value: "activity", label: "Görev/aktivite oluştur",icon: ListTodo, color: "#10b981", desc: "Otomatik bir görev açar" },
];

export default function Automations() {
  const utils = trpc.useUtils();
  const { data: rules = [], isLoading } = trpc.automations.list.useQuery(undefined);
  const { data: statuses = [] } = trpc.statuses.list.useQuery(undefined);
  const { data: users = [] } = trpc.users.list.useQuery(undefined);

  const stMap = useMemo(() => {
    const m = new Map<number, any>();
    (statuses as any[]).forEach(s => m.set(s.id, s));
    return m;
  }, [statuses]);
  const userMap = useMemo(() => {
    const m = new Map<number, any>();
    (users as any[]).forEach(u => m.set(u.id, u));
    return m;
  }, [users]);

  const create = trpc.automations.create.useMutation({
    onSuccess: () => { toast.success("Otomasyon kuralı oluşturuldu"); utils.automations.list.invalidate(); setOpen(false); reset(); },
    onError: (e) => toast.error(e.message || "Oluşturulamadı"),
  });
  const del = trpc.automations.delete.useMutation({
    onSuccess: () => { toast.success("Silindi"); utils.automations.list.invalidate(); },
    onError: () => toast.error("Silinemedi"),
  });
  const toggle = trpc.automations.toggle.useMutation({
    onSuccess: () => utils.automations.list.invalidate(),
    onError: () => toast.error("Güncellenemedi"),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [triggerStatusId, setTriggerStatusId] = useState(0);
  const [actions, setActions] = useState<string[]>(["assign"]);
  const [pool, setPool] = useState<number[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [activityTitle, setActivityTitle] = useState("");

  function reset() {
    setName(""); setTriggerStatusId(0); setActions(["assign"]); setPool([]); setWebhookUrl(""); setActivityTitle("");
  }
  function toggleAction(v: string) {
    setActions(prev => prev.includes(v) ? prev.filter(a => a !== v) : [...prev, v]);
  }
  function addToPool(id: number) {
    if (!id || pool.includes(id)) return;
    setPool(prev => [...prev, id]);
  }
  function removeFromPool(id: number) {
    setPool(prev => prev.filter(p => p !== id));
  }
  function movePool(idx: number, dir: -1 | 1) {
    setPool(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function submit() {
    if (!name.trim()) { toast.error("Kural adı gerekli"); return; }
    if (!triggerStatusId) { toast.error("Tetikleyici statü seçin"); return; }
    if (!actions.length) { toast.error("En az bir eylem seçin"); return; }
    if (actions.includes("assign") && pool.length === 0) { toast.error("Sorumlu atama için en az bir kişi seçin"); return; }
    if (actions.includes("webhook") && !webhookUrl.trim()) { toast.error("Webhook URL'i girin"); return; }
    if (actions.includes("activity") && !activityTitle.trim()) { toast.error("Görev başlığı girin"); return; }
    create.mutate({
      name: name.trim(),
      triggerStatusId,
      actions: actions as any,
      pool,
      webhookUrl: webhookUrl.trim() || undefined,
      activityTitle: activityTitle.trim() || undefined,
    });
  }

  const salesUsers = (users as any[]).filter(u => u.isActive !== false);

  return (
    <DashboardLayout>
      <style>{CSS}</style>
      <div className="au">
        <div className="au-head">
          <div>
            <div className="au-crumb">Ana Sayfa / Otomasyon Kuralları</div>
            <h1>Otomasyon Kuralları</h1>
            <p>Bir lead belirli bir statüye taşınınca arka planda otomatik işlemler çalıştır: sırayla sorumlu ata, n8n'e webhook gönder, görev aç.</p>
          </div>
          <button className="au-cta" onClick={() => setOpen(true)}><Plus size={18} /> Yeni Kural</button>
        </div>

        {/* nasıl çalışır */}
        <div className="au-explain">
          <div className="au-step"><span className="n">1</span><b>Tetikleyici</b><p>Lead şu statüye geçince…</p></div>
          <ArrowRight size={18} className="au-arrow" />
          <div className="au-step"><span className="n">2</span><b>Eylem</b><p>Sırayla ata / webhook / görev</p></div>
          <ArrowRight size={18} className="au-arrow" />
          <div className="au-step"><span className="n">3</span><b>Otomatik</b><p>Kimse uğraşmadan çalışır</p></div>
        </div>

        {/* kural listesi */}
        <div className="au-list">
          {isLoading && [0, 1].map(i => <div key={i} className="au-skel" />)}
          {!isLoading && (rules as any[]).length === 0 && (
            <div className="au-empty">
              <div className="ic"><Zap size={26} /></div>
              <b>Henüz otomasyon kuralı yok</b>
              <span>"Yeni Kural" ile ilk otomasyonunu oluştur. Örn: "Randevu Oluşturanlar" statüsüne geçen lead'i satış ekibine sırayla dağıt.</span>
            </div>
          )}
          {!isLoading && (rules as any[]).map((r: any) => {
            const cfg = r.config || {};
            const st = stMap.get(cfg.triggerStatusId);
            return (
              <div className="au-card" key={r.id} style={{ opacity: r.isActive ? 1 : 0.6 }}>
                <div className="au-card-main">
                  <div className="au-card-top">
                    <b>{r.name}</b>
                    {r.isActive ? <span className="au-badge on">Aktif</span> : <span className="au-badge off">Pasif</span>}
                  </div>
                  <div className="au-flow">
                    <span className="au-trigger">
                      Statü: <i style={{ background: st?.color || "#888" }} />{st ? (st.displayName || st.name) : `#${cfg.triggerStatusId}`}
                    </span>
                    <ArrowRight size={14} />
                    <div className="au-acts">
                      {(cfg.actions || []).map((a: string) => {
                        const meta = ACTIONS.find(x => x.value === a);
                        if (!meta) return null;
                        const Ic = meta.icon;
                        return <span key={a} className="au-act" style={{ color: meta.color, background: meta.color + "15" }}><Ic size={12} />{meta.label}</span>;
                      })}
                    </div>
                  </div>
                  {(cfg.actions || []).includes("assign") && cfg.pool?.length > 0 && (
                    <div className="au-pool">
                      <span className="au-pool-lbl">Sıra:</span>
                      {cfg.pool.map((uid: number, i: number) => {
                        const u = userMap.get(uid);
                        return <span key={uid} className="au-chip">{i + 1}. {u?.name || `#${uid}`}</span>;
                      })}
                    </div>
                  )}
                  {(cfg.actions || []).includes("webhook") && cfg.webhookUrl && (
                    <div className="au-url"><Webhook size={12} /> {cfg.webhookUrl}</div>
                  )}
                </div>
                <div className="au-card-actions">
                  <button className={"au-ico" + (r.isActive ? " warn" : " ok")} title={r.isActive ? "Durdur" : "Çalıştır"}
                    onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })} disabled={toggle.isPending}>
                    <Power size={15} />
                  </button>
                  <button className="au-ico danger" title="Sil"
                    onClick={() => { if (confirm("Kural silinsin mi?")) del.mutate({ id: r.id }); }} disabled={del.isPending}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* oluşturma modalı */}
      {open && (
        <div className="au-overlay" onClick={() => !create.isPending && setOpen(false)}>
          <div className="au-modal" onClick={e => e.stopPropagation()}>
            <div className="au-mhead"><h3>Yeni Otomasyon Kuralı</h3><button className="au-x" onClick={() => setOpen(false)}><X size={18} /></button></div>
            <div className="au-mform">
              <label>Kural Adı
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Ör. Randevu → satış ekibine dağıt" autoFocus />
              </label>

              <label>Tetikleyici — lead şu statüye geçince:
                <select value={triggerStatusId} onChange={e => setTriggerStatusId(Number(e.target.value))}>
                  <option value={0}>— Statü seçin —</option>
                  {(statuses as any[]).map(s => <option key={s.id} value={s.id}>{s.displayName || s.name}</option>)}
                </select>
              </label>

              <div>
                <span className="lbl">Eylemler (birden fazla seçebilirsin)</span>
                <div className="au-actgrid">
                  {ACTIONS.map(a => {
                    const Ic = a.icon; const on = actions.includes(a.value);
                    return (
                      <button key={a.value} type="button" onClick={() => toggleAction(a.value)}
                        className={"au-actopt" + (on ? " on" : "")} style={on ? { borderColor: a.color, background: a.color + "10" } : {}}>
                        <span className="ic" style={{ color: a.color }}><Ic size={17} /></span>
                        <div><b style={on ? { color: a.color } : {}}>{a.label}</b><small>{a.desc}</small></div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* round-robin havuzu */}
              {actions.includes("assign") && (
                <div className="au-poolpick">
                  <span className="lbl">Sorumlu sırası (round-robin) — sırayla dağıtılır</span>
                  <select value={0} onChange={e => { addToPool(Number(e.target.value)); }}>
                    <option value={0}>+ Kişi ekle…</option>
                    {salesUsers.filter(u => !pool.includes(u.id)).map(u => (
                      <option key={u.id} value={u.id}>{u.name || u.email || `#${u.id}`}</option>
                    ))}
                  </select>
                  <div className="au-pool-edit">
                    {pool.length === 0 && <div className="au-pool-empty">Henüz kişi eklenmedi</div>}
                    {pool.map((uid, idx) => {
                      const u = userMap.get(uid);
                      return (
                        <div key={uid} className="au-pool-row">
                          <GripVertical size={14} className="grip" />
                          <span className="ord">{idx + 1}</span>
                          <span className="nm">{u?.name || u?.email || `#${uid}`}</span>
                          <div className="mv">
                            <button type="button" onClick={() => movePool(idx, -1)} disabled={idx === 0}>↑</button>
                            <button type="button" onClick={() => movePool(idx, 1)} disabled={idx === pool.length - 1}>↓</button>
                          </div>
                          <button type="button" className="rm" onClick={() => removeFromPool(uid)}><X size={13} /></button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {actions.includes("webhook") && (
                <label>n8n Webhook URL'i
                  <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://your-n8n.com/webhook/xxxx" />
                </label>
              )}

              {actions.includes("activity") && (
                <label>Oluşturulacak görev başlığı
                  <input value={activityTitle} onChange={e => setActivityTitle(e.target.value)} placeholder="Ör. Müşteriyi ara ve randevuyu teyit et" />
                </label>
              )}

              <div className="au-hint"><Zap size={13} /> Örnek: Call center bir lead'i "Randevu Oluşturanlar" statüsüne taşıyınca, bu kural sorumluyu satış ekibine sırayla atar ve n8n'e bildirim gönderir.</div>
            </div>
            <div className="au-mfoot">
              <button className="ghost" onClick={() => setOpen(false)} disabled={create.isPending}>İptal</button>
              <button className="primary" onClick={submit} disabled={create.isPending}>{create.isPending ? "Oluşturuluyor…" : "Kuralı Oluştur"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

const CSS = `
.au{--ink:#0f1729;--ink2:#475069;--ink3:#8a93a8;--line:#e7ebf2;--line2:#eef1f6;--surf2:#f7f9fc;
  font-family:"Hanken Grotesk",system-ui,sans-serif;color:var(--ink);letter-spacing:-.01em;display:flex;flex-direction:column;gap:20px;max-width:1100px}
.au h1,.au h3{margin:0}
.au-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.au-crumb{font-size:13px;color:var(--ink3);font-weight:500;margin-bottom:6px}
.au-head h1{font-size:26px;font-weight:800;letter-spacing:-.03em}
.au-head p{color:var(--ink2);font-size:14px;margin-top:4px;max-width:680px;line-height:1.5}
.au-cta{height:42px;padding:0 18px;border-radius:12px;background:#2f6bff;color:#fff;font-weight:600;font-size:14px;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 8px 18px -8px rgba(47,107,255,.7);white-space:nowrap}
.au-cta:hover{background:#1f55e0}

.au-explain{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 22px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.14)}
.au-step{flex:1}
.au-step .n{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#eef3ff;color:#2f6bff;font-weight:700;font-size:13px;margin-bottom:6px}
.au-step b{display:block;font-size:14px;font-weight:700}
.au-step p{margin:2px 0 0;font-size:12.5px;color:var(--ink3)}
.au-arrow{color:#cdd8ec;flex-shrink:0}

.au-list{display:flex;flex-direction:column;gap:12px}
.au-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;gap:16px;align-items:flex-start;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.14)}
.au-card-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}
.au-card-top{display:flex;align-items:center;gap:10px}
.au-card-top b{font-size:15.5px;font-weight:700}
.au-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px}
.au-badge.on{background:#e7f9f1;color:#10b981}.au-badge.off{background:#eef1f6;color:#8a93a8}
.au-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--ink3)}
.au-trigger{font-size:13px;color:var(--ink2);display:inline-flex;align-items:center;gap:6px;font-weight:500;background:var(--surf2);padding:5px 11px;border-radius:9px}
.au-trigger i{width:9px;height:9px;border-radius:50%}
.au-acts{display:flex;gap:6px;flex-wrap:wrap}
.au-act{font-size:11.5px;font-weight:600;padding:4px 10px;border-radius:8px;display:inline-flex;align-items:center;gap:5px}
.au-pool{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.au-pool-lbl{font-size:12px;color:var(--ink3);font-weight:600}
.au-chip{font-size:12px;font-weight:500;padding:3px 9px;border-radius:7px;background:#eef3ff;color:#2f6bff}
.au-url{font-size:12px;color:var(--ink3);display:flex;align-items:center;gap:6px;font-family:monospace;word-break:break-all}
.au-card-actions{display:flex;gap:8px;flex-shrink:0}
.au-ico{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink2);cursor:pointer;display:grid;place-items:center;transition:.14s}
.au-ico.warn:hover{border-color:#f59e0b;color:#f59e0b;background:#fef4e1}
.au-ico.ok:hover{border-color:#10b981;color:#10b981;background:#e7f9f1}
.au-ico.danger:hover{border-color:#f43f6e;color:#f43f6e;background:#ffeaf0}
.au-ico:disabled{opacity:.4;cursor:not-allowed}

.au-empty{padding:48px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:16px}
.au-empty .ic{width:60px;height:60px;border-radius:16px;background:#f0ecff;color:#7c5cff;display:grid;place-items:center;margin-bottom:6px}
.au-empty b{font-size:16px;font-weight:700}.au-empty span{font-size:13.5px;color:var(--ink3);max-width:440px;line-height:1.5}
.au-skel{height:88px;border-radius:14px;background:linear-gradient(90deg,#eef1f6,#f7f9fc,#eef1f6);background-size:200% 100%;animation:ausk 1.2s infinite}
@keyframes ausk{0%{background-position:200% 0}100%{background-position:-200% 0}}

.au-overlay{position:fixed;inset:0;background:rgba(15,23,41,.5);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:100;padding:20px}
.au-modal{background:#fff;border-radius:18px;width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 32px 80px -20px rgba(16,24,40,.4)}
.au-mhead{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line2);flex-shrink:0}
.au-mhead h3{font-size:18px;font-weight:700}
.au-x{width:34px;height:34px;border-radius:10px;border:none;background:var(--surf2);color:var(--ink2);cursor:pointer;display:grid;place-items:center}
.au-mform{padding:20px 22px;display:flex;flex-direction:column;gap:16px;overflow-y:auto}
.au-mform label{font-size:13px;font-weight:600;color:var(--ink2);display:flex;flex-direction:column;gap:6px}
.au-mform input,.au-mform select{height:42px;border-radius:11px;border:1px solid var(--line);padding:0 13px;font-size:14px;font-family:inherit;color:var(--ink);background:#fff}
.au-mform input:focus,.au-mform select:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.au-mform .lbl{font-size:13px;font-weight:600;color:var(--ink2);display:block;margin-bottom:8px}
.au-actgrid{display:flex;flex-direction:column;gap:9px}
.au-actopt{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid var(--line);background:#fff;cursor:pointer;font-family:inherit;text-align:left;transition:.14s}
.au-actopt:hover{border-color:#cdd8ec}
.au-actopt .ic{width:38px;height:38px;border-radius:10px;background:var(--surf2);display:grid;place-items:center;flex-shrink:0}
.au-actopt b{font-size:13.5px;font-weight:600;color:var(--ink);display:block}
.au-actopt small{font-size:12px;color:var(--ink3)}
.au-poolpick{background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:14px}
.au-pool-edit{margin-top:10px;display:flex;flex-direction:column;gap:7px}
.au-pool-empty{font-size:12.5px;color:var(--ink3);text-align:center;padding:8px}
.au-pool-row{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line);border-radius:9px;padding:7px 10px}
.au-pool-row .grip{color:#cdd8ec;flex-shrink:0}
.au-pool-row .ord{width:20px;height:20px;border-radius:50%;background:#eef3ff;color:#2f6bff;font-size:11px;font-weight:700;display:grid;place-items:center;flex-shrink:0}
.au-pool-row .nm{flex:1;font-size:13.5px;font-weight:500}
.au-pool-row .mv{display:flex;gap:3px}
.au-pool-row .mv button{width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:#fff;cursor:pointer;font-size:12px;color:var(--ink2)}
.au-pool-row .mv button:disabled{opacity:.3;cursor:not-allowed}
.au-pool-row .rm{width:26px;height:26px;border-radius:7px;border:none;background:#ffeaf0;color:#f43f6e;cursor:pointer;display:grid;place-items:center;flex-shrink:0}
.au-hint{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:#475069;background:#fff7e6;border:1px solid #ffe2b0;padding:11px 13px;border-radius:11px;line-height:1.5}
.au-mfoot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--line2);flex-shrink:0}
.au-mfoot button{height:42px;padding:0 20px;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;border:none}
.au-mfoot .ghost{background:var(--surf2);color:var(--ink2)}
.au-mfoot .primary{background:#2f6bff;color:#fff}.au-mfoot .primary:hover{background:#1f55e0}
.au-mfoot button:disabled{opacity:.6;cursor:not-allowed}
@media(max-width:680px){.au-explain{flex-direction:column;align-items:stretch}.au-arrow{transform:rotate(90deg);align-self:center}}
`;