import { useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { MessageCircle, Phone, Mail, Check, X, Settings, Plug, Trash2 } from "lucide-react";

/* ----------------------------------------------------------------
   Servis Bağlantıları — WhatCRM, NetGSM, E-posta (SMTP)
   API bilgileri DB'deki integrations tablosuna kaydedilir,
   communications.create(sendNow) bu bilgilerle gerçek gönderim yapar.
-----------------------------------------------------------------*/

type FieldDef = { key: string; label: string; placeholder?: string; type?: string; inMeta?: boolean };

const SERVICES: {
  type: string; name: string; icon: any; color: string; desc: string;
  // apiKey = ana sır; apiUrl = opsiyonel; meta alanları metadata'ya gider
  fields: FieldDef[];
}[] = [
  {
    type: "whatcrm", name: "WhatCRM (WhatsApp)", icon: MessageCircle, color: "#10b981",
    desc: "WhatsApp mesajlaşması. WhatCRM panelinden API anahtarını al.",
    fields: [
      { key: "apiKey", label: "API Anahtarı (Token)", placeholder: "whatcrm_xxx", type: "password" },
      { key: "apiUrl", label: "API URL (opsiyonel)", placeholder: "https://api.whatcrm.com" },
    ],
  },
  {
    type: "netgsm", name: "NetGSM (SMS)", icon: Phone, color: "#2f6bff",
    desc: "SMS gönderimi. NetGSM kullanıcı kodu/şifresi ve başlık.",
    fields: [
      { key: "apiKey", label: "Kullanıcı Kodu / Şifre", placeholder: "NetGSM usercode", type: "password" },
      { key: "senderName", label: "Gönderici Başlığı", placeholder: "Onaylı SMS başlığınız", inMeta: true },
    ],
  },
  {
    type: "email", name: "E-posta (SMTP)", icon: Mail, color: "#7c5cff",
    desc: "E-posta gönderimi. SMTP sunucu bilgileri.",
    fields: [
      { key: "apiUrl", label: "SMTP Sunucu", placeholder: "smtp.gmail.com" },
      { key: "smtpPort", label: "Port", placeholder: "587", inMeta: true },
      { key: "smtpUser", label: "Kullanıcı (e-posta)", placeholder: "you@firma.com", inMeta: true },
      { key: "apiKey", label: "Şifre / Uygulama Şifresi", placeholder: "••••••••", type: "password" },
      { key: "fromEmail", label: "Gönderen E-posta", placeholder: "you@firma.com", inMeta: true },
      { key: "fromName", label: "Gönderen Adı", placeholder: "X Real Estate", inMeta: true },
    ],
  },
];

export default function IntegrationServices() {
  const utils = trpc.useUtils();
  const { data: integrations = [], isLoading } = trpc.integrations.list.useQuery(undefined);

  const save = trpc.integrations.save.useMutation({
    onSuccess: () => { toast.success("Bağlantı kaydedildi"); utils.integrations.list.invalidate(); setEditing(null); setForm({}); },
    onError: (e) => toast.error(e.message || "Kaydedilemedi"),
  });
  const toggle = trpc.integrations.toggle.useMutation({
    onSuccess: () => utils.integrations.list.invalidate(),
    onError: () => toast.error("Güncellenemedi"),
  });
  const remove = trpc.integrations.remove.useMutation({
    onSuccess: () => { toast.success("Bağlantı silindi"); utils.integrations.list.invalidate(); },
    onError: () => toast.error("Silinemedi"),
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const byType = (t: string) => (integrations as any[]).find(i => i.type === t);

  function openEdit(type: string) {
    const svc = SERVICES.find(s => s.type === type)!;
    const existing = byType(type);
    const init: Record<string, string> = { name: svc.name };
    // mevcut metadata'yı forma doldur (apiKey maskeli olduğu için boş bırakılır)
    if (existing?.metadata) {
      for (const f of svc.fields) {
        if (f.inMeta && existing.metadata[f.key] != null) init[f.key] = String(existing.metadata[f.key]);
      }
    }
    if (existing?.apiUrl) init.apiUrl = existing.apiUrl;
    setForm(init);
    setEditing(type);
  }

  function submit(type: string) {
    const svc = SERVICES.find(s => s.type === type)!;
    const apiKey = form.apiKey?.trim();
    if (!apiKey) { toast.error("API anahtarı / şifre gerekli"); return; }
    const metadata: Record<string, unknown> = {};
    let apiUrl: string | undefined;
    for (const f of svc.fields) {
      const v = form[f.key]?.trim();
      if (!v) continue;
      if (f.key === "apiKey") continue;
      if (f.key === "apiUrl") { apiUrl = v; continue; }
      if (f.inMeta) metadata[f.key] = v;
    }
    save.mutate({ type: type as any, name: svc.name, apiKey, apiUrl, metadata, isActive: true });
  }

  return (
    <div className="int-section">
      <style>{CSS}</style>
      <div className="int-sec-head"><h3><Plug size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />Servis Bağlantıları</h3></div>
      <div className="svc-body">
        <p className="svc-intro">WhatsApp (WhatCRM), SMS (NetGSM) ve e-posta gönderimi için API bilgilerini buraya kaydet. Kaydedince iletişim ekranındaki "Gönder" işlemleri bu servisleri kullanır.</p>
        <div className="svc-grid">
          {SERVICES.map(svc => {
            const Ic = svc.icon;
            const existing = byType(svc.type);
            const connected = existing?.hasKey;
            const active = existing?.isActive;
            return (
              <div key={svc.type} className={"svc-card" + (connected ? " connected" : "")}>
                <div className="svc-top">
                  <div className="svc-ic" style={{ background: svc.color + "18", color: svc.color }}><Ic size={20} /></div>
                  <div className="svc-meta">
                    <b>{svc.name}</b>
                    {connected
                      ? <span className={"svc-st " + (active ? "on" : "off")}>{active ? "Bağlı" : "Pasif"} · {existing.keyMasked}</span>
                      : <span className="svc-st none">Bağlı değil</span>}
                  </div>
                </div>
                <p className="svc-desc">{svc.desc}</p>
                <div className="svc-actions">
                  <button className="svc-btn primary" onClick={() => openEdit(svc.type)}>
                    <Settings size={14} />{connected ? "Düzenle" : "Bağla"}
                  </button>
                  {connected && (
                    <>
                      <button className="svc-btn" onClick={() => toggle.mutate({ type: svc.type as any, isActive: !active })} disabled={toggle.isPending}>
                        {active ? "Durdur" : "Aktifleştir"}
                      </button>
                      <button className="svc-btn danger" title="Sil" onClick={() => { if (confirm(svc.name + " bağlantısı silinsin mi?")) remove.mutate({ type: svc.type as any }); }} disabled={remove.isPending}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* düzenleme modalı */}
      {editing && (() => {
        const svc = SERVICES.find(s => s.type === editing)!;
        return (
          <div className="svc-overlay" onClick={() => !save.isPending && setEditing(null)}>
            <div className="svc-modal" onClick={e => e.stopPropagation()}>
              <div className="svc-mhead">
                <h3><svc.icon size={18} style={{ verticalAlign: "-4px", marginRight: 8, color: svc.color }} />{svc.name}</h3>
                <button className="svc-x" onClick={() => setEditing(null)}><X size={18} /></button>
              </div>
              <div className="svc-mform">
                {byType(editing)?.hasKey && (
                  <div className="svc-note">Bu servis zaten bağlı. Sırrı değiştirmek istemiyorsan API alanını boş bırakamazsın — güvenlik için tekrar girmen gerekir.</div>
                )}
                {svc.fields.map(f => (
                  <label key={f.key}>{f.label}
                    <input
                      type={f.type || "text"}
                      value={form[f.key] || ""}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      autoComplete="off"
                    />
                  </label>
                ))}
              </div>
              <div className="svc-mfoot">
                <button className="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>İptal</button>
                <button className="primary" onClick={() => submit(editing)} disabled={save.isPending}>
                  <Check size={15} />{save.isPending ? "Kaydediliyor…" : "Kaydet"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const CSS = `
.svc-body{padding:18px 22px;display:flex;flex-direction:column;gap:16px}
.svc-intro{font-size:13.5px;color:#475069;margin:0;line-height:1.5}
.svc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.svc-card{border:1px solid #e7ebf2;border-radius:13px;padding:16px;display:flex;flex-direction:column;gap:11px;background:#fff;transition:.15s}
.svc-card.connected{border-color:#c3f0de;background:#fcfffe}
.svc-top{display:flex;align-items:center;gap:12px}
.svc-ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;flex-shrink:0}
.svc-meta b{font-size:14.5px;font-weight:700;display:block}
.svc-st{font-size:12px;font-weight:600}
.svc-st.on{color:#10b981}.svc-st.off{color:#f59e0b}.svc-st.none{color:#8a93a8}
.svc-desc{font-size:12.5px;color:#8a93a8;margin:0;line-height:1.45;flex:1}
.svc-actions{display:flex;gap:7px;flex-wrap:wrap}
.svc-btn{height:34px;padding:0 12px;border-radius:9px;border:1px solid #e7ebf2;background:#fff;font-size:12.5px;font-weight:600;color:#475069;cursor:pointer;display:flex;align-items:center;gap:5px;font-family:inherit}
.svc-btn:hover{border-color:#cdd8ec}
.svc-btn.primary{background:#2f6bff;color:#fff;border-color:#2f6bff}.svc-btn.primary:hover{background:#1f55e0}
.svc-btn.danger{color:#f43f6e;border-color:#ffd9e2;padding:0 10px}.svc-btn.danger:hover{background:#ffeaf0}
.svc-btn:disabled{opacity:.5;cursor:not-allowed}

.svc-overlay{position:fixed;inset:0;background:rgba(15,23,41,.5);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:120;padding:20px}
.svc-modal{background:#fff;border-radius:18px;width:100%;max-width:480px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 32px 80px -20px rgba(16,24,40,.4);font-family:"Hanken Grotesk",system-ui,sans-serif}
.svc-mhead{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #eef1f6}
.svc-mhead h3{font-size:17px;font-weight:700;margin:0}
.svc-x{width:34px;height:34px;border-radius:10px;border:none;background:#f7f9fc;color:#475069;cursor:pointer;display:grid;place-items:center}
.svc-mform{padding:20px 22px;display:flex;flex-direction:column;gap:13px;overflow-y:auto}
.svc-note{font-size:12.5px;color:#92690a;background:#fff7e6;border:1px solid #ffe2b0;padding:10px 12px;border-radius:10px;line-height:1.45}
.svc-mform label{font-size:13px;font-weight:600;color:#475069;display:flex;flex-direction:column;gap:6px}
.svc-mform input{height:42px;border-radius:11px;border:1px solid #e7ebf2;padding:0 13px;font-size:14px;font-family:inherit;color:#0f1729}
.svc-mform input:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 4px #eef3ff}
.svc-mfoot{display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid #eef1f6}
.svc-mfoot button{height:42px;padding:0 20px;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;border:none;display:flex;align-items:center;gap:6px}
.svc-mfoot .ghost{background:#f7f9fc;color:#475069}
.svc-mfoot .primary{background:#2f6bff;color:#fff}.svc-mfoot .primary:hover{background:#1f55e0}
.svc-mfoot button:disabled{opacity:.6;cursor:not-allowed}
@media(max-width:900px){.svc-grid{grid-template-columns:1fr}}
`;