import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Plus, Trash2, Power, X, Copy, ExternalLink, Webhook, Zap, Globe } from "lucide-react";
import IntegrationServices from "../components/IntegrationServices";

/* ----------------------------------------------------------------
   Entegrasyonlar & Geliştirici Kaynakları
   Giden webhook'lar (n8n, Zapier...) + Gelen REST API token
-----------------------------------------------------------------*/

const EVENTS = [
  { value: "lead.created",       label: "Yeni Müşteri Adayı Oluşturuldu" },
  { value: "lead.updated",       label: "Müşteri Adayı Güncellendi" },
  { value: "lead.status_changed",label: "Statü Değişti (Kanban)" },
  { value: "lead.deleted",       label: "Müşteri Adayı Silindi" },
  { value: "meeting.created",    label: "Toplantı Oluşturuldu" },
  { value: "activity.created",   label: "Aktivite / Not Eklendi" },
];

export default function Integrations() {
  const utils = trpc.useUtils();
  const { data: hooks = [], isLoading } = trpc.webhooks.list.useQuery(undefined);
  const { data: me } = trpc.auth.me.useQuery(undefined);

  const createHook = trpc.webhooks.create.useMutation({
    onSuccess: () => { toast.success("Webhook oluşturuldu"); utils.webhooks.list.invalidate(); setOpen(false); reset(); },
    onError: (e) => toast.error(e.message || "Oluşturulamadı"),
  });
  const deleteHook = trpc.webhooks.delete.useMutation({
    onSuccess: () => { toast.success("Silindi"); utils.webhooks.list.invalidate(); },
    onError: () => toast.error("Silinemedi"),
  });
  const toggleHook = trpc.webhooks.toggle.useMutation({
    onSuccess: () => utils.webhooks.list.invalidate(),
    onError: () => toast.error("Güncellenemedi"),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["lead.created", "lead.status_changed"]);

  function reset() { setName(""); setUrl(""); setSelectedEvents(["lead.created", "lead.status_changed"]); }
  function toggleEvent(v: string) {
    setSelectedEvents(prev => prev.includes(v) ? prev.filter(e => e !== v) : [...prev, v]);
  }
  function create() {
    if (!name.trim()) { toast.error("İsim gerekli"); return; }
    if (!url.trim()) { toast.error("URL gerekli"); return; }
    if (!selectedEvents.length) { toast.error("En az bir olay seçin"); return; }
    createHook.mutate({ name, url, events: selectedEvents });
  }

  const restBase = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <DashboardLayout>
      <style>{CSS}</style>
      <div className="int">
        <div className="int-head">
          <div>
            <div className="int-crumb">Ana Sayfa / Entegrasyonlar</div>
            <h1>Entegrasyonlar & Webhook'lar</h1>
            <p>n8n, Zapier veya herhangi bir sisteme CRM olayları gönder. Gelen API ile dışardan veri çek.</p>
          </div>
          <button className="int-cta" onClick={() => setOpen(true)}><Plus size={18} /> Giden Webhook Ekle</button>
        </div>

        {/* bilgi kartları */}
        <div className="int-cards">
          <div className="int-card">
            <div className="ic blue"><Zap size={22} /></div>
            <div>
              <b>Giden Webhook (Outgoing)</b>
              <p>CRM'de bir olay olunca (yeni lead, statü değişimi…) seçtiğin URL'e otomatik POST gönderir. n8n, Zapier, Make uyumlu.</p>
            </div>
          </div>
          <div className="int-card">
            <div className="ic emerald"><Globe size={22} /></div>
            <div>
              <b>Gelen Webhook / REST API (Incoming)</b>
              <p>Dışardan CRM'e lead eklemek, güncellemek için REST uçlarını kullan. Bearer token ile kimlik doğrula.</p>
            </div>
          </div>
          <div className="int-card">
            <div className="ic violet"><Webhook size={22} /></div>
            <div>
              <b>n8n Entegrasyonu</b>
              <p>n8n'de "Webhook" trigger oluştur → URL'i buraya yapıştır → olayları seç → kaydet. Otomasyonlar tetiklenmeye başlar.</p>
            </div>
          </div>
        </div>

        {/* servis bağlantıları (WhatCRM, NetGSM, e-posta) */}
        <IntegrationServices />

        {/* giden webhook listesi */}
        <div className="int-section">
          <div className="int-sec-head">
            <h3>Giden Webhook'lar <span>({hooks.length})</span></h3>
          </div>
          <div className="int-table-wrap">
            <table className="int-table">
              <thead><tr><th>İsim</th><th>URL</th><th>Olaylar</th><th>Durum</th><th style={{textAlign:"right"}}>İşlem</th></tr></thead>
              <tbody>
                {isLoading && <tr><td colSpan={5}><div className="int-skel" /></td></tr>}
                {!isLoading && hooks.length === 0 && (
                  <tr><td colSpan={5}><div className="int-empty">Henüz webhook yok. "+ Giden Webhook Ekle" ile başla.</div></td></tr>
                )}
                {(hooks as any[]).map((h) => (
                  <tr key={h.id} style={{opacity: h.isActive ? 1 : 0.55}}>
                    <td><b style={{fontWeight:600}}>{h.name}</b></td>
                    <td>
                      <div className="url-cell">
                        <span>{h.url.length > 45 ? h.url.slice(0, 45) + "…" : h.url}</span>
                        <button onClick={() => { navigator.clipboard.writeText(h.url); toast.success("Kopyalandı"); }} title="URL'i kopyala"><Copy size={13} /></button>
                      </div>
                    </td>
                    <td>
                      <div className="evts">
                        {(Array.isArray(h.events) ? h.events as string[] : JSON.parse(String(h.events))).map((e: string) => {
                          const meta = EVENTS.find(ev => ev.value === e);
                          return <span key={e} className="evt">{meta?.label || e}</span>;
                        })}
                      </div>
                    </td>
                    <td>
                      {h.isActive
                        ? <span className="st on"><i />Aktif</span>
                        : <span className="st off"><i />Pasif</span>}
                    </td>
                    <td style={{textAlign:"right"}}>
                      <div className="int-actions">
                        <button className={"ico" + (h.isActive ? " warn" : " ok")} title={h.isActive ? "Devre dışı bırak" : "Aktifleştir"}
                          onClick={() => toggleHook.mutate({ id: h.id, isActive: !h.isActive })} disabled={toggleHook.isPending}>
                          <Power size={14} />
                        </button>
                        <button className="ico danger" title="Sil" onClick={() => { if (confirm("Webhook silinsin mi?")) deleteHook.mutate({ id: h.id }); }} disabled={deleteHook.isPending}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* gelen API bilgisi */}
        <div className="int-section">
          <div className="int-sec-head"><h3>Gelen REST API (Incoming)</h3></div>
          <div className="int-api">
            <div className="api-row">
              <span>Base URL</span>
              <div className="api-val">
                <code>{restBase}/api</code>
                <button onClick={() => { navigator.clipboard.writeText(restBase + "/api"); toast.success("Kopyalandı"); }}><Copy size={13} /></button>
              </div>
            </div>
            <div className="api-row">
              <span>Yetkilendirme</span>
              <div className="api-val"><code>Header: Authorization: Bearer {"<token>"}</code></div>
            </div>
            <div className="api-endpoints">
              <div className="endpoint"><span className="method get">GET</span><code>/api/trpc/leads.list</code><span>Lead listesi</span></div>
              <div className="endpoint"><span className="method post">POST</span><code>/api/trpc/leads.create</code><span>Yeni lead</span></div>
              <div className="endpoint"><span className="method post">POST</span><code>/api/trpc/leads.bulkCreate</code><span>Toplu lead (JSON array)</span></div>
              <div className="endpoint"><span className="method get">GET</span><code>/api/trpc/statuses.list</code><span>Statü listesi</span></div>
            </div>
            <div className="api-docs">
              <a href="https://trpc.io/docs" target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> tRPC dokümantasyonu</a>
            </div>
          </div>
        </div>

        {/* Gelen Webhook (Incoming) */}
        <div className="int-section">
          <div className="int-sec-head"><h3>Gelen Webhook (Incoming)</h3></div>
          <div className="int-api">
            <div className="inc-banner">
              <div className="ic violet"><Webhook size={20} /></div>
              <div>
                <b>Dışarıdan CRM'e veri gönder</b>
                <p>Harici sistemler (form, site, bot...) aşağıdaki endpoint'e POST yaparak lead ekleyebilir.</p>
              </div>
            </div>
            <div className="api-row">
              <span>Endpoint</span>
              <div className="api-val">
                <code>{restBase}/api/trpc/leads.create</code>
                <button onClick={() => { navigator.clipboard.writeText(restBase + "/api/trpc/leads.create"); toast.success("Kopyalandı"); }}><Copy size={13} /></button>
              </div>
            </div>
            <div className="api-row">
              <span>Toplu Ekle</span>
              <div className="api-val">
                <code>{restBase}/api/trpc/leads.bulkCreate</code>
                <button onClick={() => { navigator.clipboard.writeText(restBase + "/api/trpc/leads.bulkCreate"); toast.success("Kopyalandı"); }}><Copy size={13} /></button>
              </div>
            </div>
            <div className="api-row">
              <span>Metod</span>
              <div className="api-val"><code>POST</code><span style={{fontSize:13,color:"#475069",marginLeft:8}}>Content-Type: application/json</span></div>
            </div>
            <div className="inc-example">
              <div className="ex-title">Örnek istek (lead ekle)</div>
              <pre>{`POST /api/trpc/leads.create
{
  "json": {
    "firstName": "Ahmet",
    "lastName": "Yılmaz",
    "phone": "05xxxxxxxxx",
    "source": "Web Formu",
    "statusId": 1,
    "priority": "medium"
  }
}`}</pre>
              <button onClick={() => { navigator.clipboard.writeText('{\n  "json": {\n    "firstName": "Ahmet",\n    "lastName": "Yılmaz",\n    "phone": "05xxxxxxxxx",\n    "source": "Web Formu",\n    "statusId": 1,\n    "priority": "medium"\n  }\n}'); toast.success("Kopyalandı"); }}>
                <Copy size={13} /> Kopyala
              </button>
            </div>
          </div>
        </div>

        {/* Yerel Uygulama */}
        <div className="int-section">
          <div className="int-sec-head"><h3>Yerel Uygulama (Local App)</h3></div>
          <div className="int-api">
            <div className="inc-banner" style={{background:"#f0ecff",borderColor:"#d8d0f7"}}>
              <div className="ic violet" style={{background:"#7c5cff",color:"#fff"}}><Zap size={20} /></div>
              <div>
                <b>Kendi uygulamanı entegre et</b>
                <p>Başka bir uygulama veya bot bu CRM'e bağlanacaksa, aşağıdaki bilgileri kullan.</p>
              </div>
            </div>
            <div className="app-grid">
              <div className="app-item">
                <div className="app-ic"><Globe size={18} /></div>
                <div><b>tRPC REST API</b><span>Her endpoint JSON üzerinden erişilebilir. Yukarıdaki URL'leri kullan.</span></div>
              </div>
              <div className="app-item">
                <div className="app-ic"><Webhook size={18} /></div>
                <div><b>Giden Webhook</b><span>CRM olaylarını dinlemek için yukarıdan webhook ekle.</span></div>
              </div>
              <div className="app-item">
                <div className="app-ic"><Zap size={18} /></div>
                <div><b>n8n / Zapier / Make</b><span>Webhook URL'ini otomasyon aracına ver, workflow tasarla.</span></div>
              </div>
              <div className="app-item">
                <div className="app-ic"><ExternalLink size={18} /></div>
                <div><b>Form Entegrasyonu</b><span>Web formu lead.bulkCreate endpoint'ine POST yaparak lead otomatik eklesin.</span></div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Modal */}
      {open && (
        <div className="int-overlay" onClick={() => !createHook.isPending && setOpen(false)}>
          <div className="int-modal" onClick={e => e.stopPropagation()}>
            <div className="int-mhead"><h3>Yeni Giden Webhook</h3><button className="int-x" onClick={() => setOpen(false)}><X size={18} /></button></div>
            <div className="int-mform">
              <label>Webhook Adı<input value={name} onChange={e => setName(e.target.value)} placeholder="Ör. n8n Otomasyon, Zapier CRM" autoFocus /></label>
              <label>Hedef URL (n8n Webhook URL'i)
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://your-n8n.com/webhook/xxxx" />
              </label>
              <div>
                <span className="lbl">Tetiklenecek Olaylar</span>
                <div className="evt-grid">
                  {EVENTS.map(ev => (
                    <label key={ev.value} className={"evt-opt" + (selectedEvents.includes(ev.value) ? " on" : "")}>
                      <input type="checkbox" checked={selectedEvents.includes(ev.value)} onChange={() => toggleEvent(ev.value)} />
                      {ev.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="int-hint"><Zap size={13} />n8n'de: New Workflow → Webhook trigger → URL'i buraya yapıştır → olayları seç → Kaydet. Artık n8n otomasyonun tetiklenir.</div>
            </div>
            <div className="int-mfoot">
              <button className="ghost" onClick={() => setOpen(false)} disabled={createHook.isPending}>İptal</button>
              <button className="primary" onClick={create} disabled={createHook.isPending}>{createHook.isPending ? "Oluşturuluyor…" : "Webhook Oluştur"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

const CSS = `
.int{--ink:#0f1729;--ink2:#475069;--ink3:#8a93a8;--line:#e7ebf2;--line2:#eef1f6;--surf2:#f7f9fc;
  font-family:"Hanken Grotesk",system-ui,sans-serif;color:var(--ink);letter-spacing:-.01em;display:flex;flex-direction:column;gap:22px;max-width:1380px}
.int h1,.int h3{margin:0}
.int-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.int-crumb{font-size:13px;color:var(--ink3);font-weight:500;margin-bottom:6px}
.int-head h1{font-size:26px;font-weight:800;letter-spacing:-.03em}
.int-head p{color:var(--ink2);font-size:14.5px;margin-top:4px}
.int-cta{height:42px;padding:0 18px;border-radius:12px;background:#2f6bff;color:#fff;font-weight:600;font-size:14px;border:none;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:0 8px 18px -8px rgba(47,107,255,.7)}
.int-cta:hover{background:#1f55e0}
.int-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.int-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;display:flex;align-items:flex-start;gap:14px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.14)}
.int-card .ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex-shrink:0}
.ic.blue{background:#eef3ff;color:#2f6bff}.ic.emerald{background:#e7f9f1;color:#10b981}.ic.violet{background:#f0ecff;color:#7c5cff}
.int-card b{font-size:15px;font-weight:700;display:block;margin-bottom:4px}
.int-card p{font-size:13px;color:var(--ink2);margin:0;line-height:1.5}
.int-section{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.14)}
.int-sec-head{padding:16px 22px;border-bottom:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between}
.int-sec-head h3{font-size:16px;font-weight:700}.int-sec-head span{color:var(--ink3);font-weight:500}
.int-table-wrap{overflow-x:auto}
.int-table{width:100%;border-collapse:collapse}
.int-table thead th{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:14px 18px 10px}
.int-table tbody td{padding:12px 18px;border-top:1px solid var(--line2);font-size:14px;vertical-align:middle}
.int-table tbody tr:hover{background:var(--surf2)}
.url-cell{display:flex;align-items:center;gap:8px;max-width:320px}
.url-cell span{font-size:13px;color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace}
.url-cell button{flex-shrink:0;width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:#fff;color:var(--ink3);cursor:pointer;display:grid;place-items:center}
.url-cell button:hover{border-color:#2f6bff;color:#2f6bff}
.evts{display:flex;flex-wrap:wrap;gap:5px}.evt{font-size:11.5px;font-weight:600;padding:3px 9px;border-radius:20px;background:#eef3ff;color:#2f6bff}
.st{font-size:12.5px;font-weight:600;display:inline-flex;align-items:center;gap:7px}
.st i{width:7px;height:7px;border-radius:50%}.st.on{color:#10b981}.st.on i{background:#10b981}.st.off{color:#8a93a8}.st.off i{background:#8a93a8}
.int-actions{display:flex;gap:7px;justify-content:flex-end}
.ico{width:32px;height:32px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--ink2);cursor:pointer;display:grid;place-items:center;transition:.14s}
.ico:hover{border-color:#2f6bff;color:#2f6bff;background:#eef3ff}.ico.danger:hover{border-color:#f43f6e;color:#f43f6e;background:#ffeaf0}
.ico.warn:hover{border-color:#f59e0b;color:#f59e0b;background:#fef4e1}.ico.ok:hover{border-color:#10b981;color:#10b981;background:#e7f9f1}
.ico:disabled{opacity:.4;cursor:not-allowed}
.int-empty{padding:28px;text-align:center;color:var(--ink3);font-size:14px}
.int-skel{height:44px;border-radius:10px;background:linear-gradient(90deg,#eef1f6,#f7f9fc,#eef1f6);background-size:200% 100%;animation:isk 1.2s infinite}
@keyframes isk{0%{background-position:200% 0}100%{background-position:-200% 0}}
.int-api{padding:18px 22px;display:flex;flex-direction:column;gap:14px}
.api-row{display:flex;align-items:center;gap:16px;font-size:14px}
.api-row>span{font-weight:600;min-width:130px;color:var(--ink2)}
.api-val{display:flex;align-items:center;gap:8px}
.api-val code{background:#f7f9fc;border:1px solid var(--line);border-radius:8px;padding:5px 10px;font-size:13px;font-family:monospace;color:#2f6bff}
.api-val button{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:#fff;color:var(--ink3);cursor:pointer;display:grid;place-items:center}
.api-endpoints{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line2);padding-top:14px}
.endpoint{display:flex;align-items:center;gap:12px;font-size:13.5px}
.method{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;min-width:50px;text-align:center}
.method.get{background:#e7f9f1;color:#10b981}.method.post{background:#eef3ff;color:#2f6bff}
.endpoint code{font-family:monospace;font-size:13px;color:#475069}
.api-docs{padding-top:8px}
.api-docs a{font-size:13px;color:#2f6bff;font-weight:600;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.api-docs a:hover{text-decoration:underline}
.int-hint{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:#475069;background:#f7f9fc;padding:11px 13px;border-radius:11px;line-height:1.5}
.inc-banner{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;background:#e7f9f1;border:1px solid #c3f0de;border-radius:13px}
.inc-banner b{font-size:14.5px;font-weight:700;display:block;margin-bottom:3px}
.inc-banner p{font-size:13px;color:#475069;margin:0;line-height:1.5}
.inc-example{background:#1e2a40;border-radius:13px;padding:16px;margin-top:4px;position:relative}
.inc-example .ex-title{font-size:11.5px;font-weight:700;color:#8a93a8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
.inc-example pre{font-family:monospace;font-size:13px;color:#a8d0f0;margin:0;white-space:pre-wrap;line-height:1.6}
.inc-example button{position:absolute;top:14px;right:14px;display:flex;align-items:center;gap:5px;font-size:12px;color:#8a93a8;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:4px 10px;cursor:pointer;font-family:inherit}
.inc-example button:hover{color:#fff;background:rgba(255,255,255,.14)}
.app-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.app-item{display:flex;align-items:flex-start;gap:12px;padding:14px;background:#f7f9fc;border:1px solid var(--line);border-radius:12px}
.app-ic{width:38px;height:38px;border-radius:10px;background:#eef3ff;color:#2f6bff;display:grid;place-items:center;flex-shrink:0}
.app-item b{font-size:14px;font-weight:600;display:block;margin-bottom:3px}
.app-item span{font-size:12.5px;color:#475069;line-height:1.4}
@media(max-width:900px){.int-cards{grid-template-columns:1fr}.evt-grid,.app-grid{grid-template-columns:1fr}}
.int-modal{background:#fff;border-radius:18px;width:100%;max-width:560px;box-shadow:0 32px 80px -20px rgba(16,24,40,.4)}
.int-mhead{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line2)}
.int-mhead h3{font-size:18px;font-weight:700}
.int-x{width:34px;height:34px;border-radius:10px;border:none;background:#f7f9fc;color:var(--ink2);cursor:pointer;display:grid;place-items:center}
.int-mform{padding:20px 22px;display:flex;flex-direction:column;gap:15px}
.int-mform label{font-size:13px;font-weight:600;color:var(--ink2);display:flex;flex-direction:column;gap:6px}
.int-mform input{height:42px;border-radius:11px;border:1px solid var(--line);padding:0 13px;font-size:14px;font-family:inherit;color:var(--ink)}
.int-mform input:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.int-mform .lbl{font-size:13px;font-weight:600;color:var(--ink2);display:block;margin-bottom:8px}
.evt-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.evt-opt{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:500;padding:10px 12px;border-radius:10px;border:1.5px solid var(--line);cursor:pointer;transition:.14s;color:var(--ink2)}
.evt-opt.on{border-color:#2f6bff;background:#eef3ff;color:#2f6bff;font-weight:600}
.evt-opt input{width:15px;height:15px;accent-color:#2f6bff;flex-shrink:0}
.int-mfoot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--line2)}
.int-mfoot button{height:42px;padding:0 20px;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;border:none}
.int-mfoot .ghost{background:#f7f9fc;color:var(--ink2)}.int-mfoot .primary{background:#2f6bff;color:#fff}
.int-mfoot .primary:hover{background:#1f55e0}.int-mfoot button:disabled{opacity:.6;cursor:not-allowed}
@media(max-width:900px){.int-cards{grid-template-columns:1fr}.evt-grid{grid-template-columns:1fr}}
`;