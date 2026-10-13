import {
  missingStageFields,
  requiredCrmFieldLabels,
} from "../../../../shared/crm-stage-policy";
import { availablePipelines, getPipelineStages } from "../suite";
import { useState } from "react";
import { Phone, Mail, MessageCircle, Clock, Save } from "lucide-react";
import { toast } from "sonner";
import { Lead, stages, money } from "../data";
import { useStore } from "../store";
import { Modal, Avatar, Badge } from "./ui";
export default function LeadModal({
  lead,
  onClose,
  onMessage,
  initialStage = "new",
  initialPipeline = "sales",
}: {
  lead?: Lead;
  initialStage?: Lead["stage"];
  initialPipeline?: string;
  onClose: () => void;
  onMessage?: (id: string) => void;
}) {
  const { saveLead, data, demo, user } = useStore();
  const [tab, setTab] = useState("details");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Lead>(
    lead || {
      id: crypto.randomUUID(),
      name: "",
      phone: "",
      email: "",
      company: "",
      stage: initialStage,
      pipelineId: initialPipeline,
      owner: user?.name || data.members[0]?.name || "XRE Ekibi",
      value: 0,
      source: "Web sitesi",
      notes: "",
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      tags: [],
    },
  );
  const missing = missingStageFields(
    form as unknown as Record<string, unknown>,
    data.pipelines,
  );
  const field = (key: keyof Lead, value: any) =>
    setForm((x) => ({ ...x, [key]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Müşteri adı gerekli.");
      return;
    }
    if (form.phone && !/^\+?[0-9\s()-]{10,20}$/.test(form.phone)) {
      toast.error("Geçerli bir telefon numarası girin.");
      return;
    }
    setBusy(true);
    try {
      await saveLead(form);
      toast.success(
        lead ? "Müşteri kaydı güncellendi." : "Yeni müşteri eklendi.",
      );
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={lead ? "Müşteri detayı" : "Yeni müşteri"}
      subtitle={
        demo
          ? "Örnek CRM verisi · Gerçek iletişim gönderilmez"
          : "CRM müşteri kaydı"
      }
      onClose={onClose}
      wide
    >
      {lead && (
        <div className="lead-profile">
          <Avatar name={lead.name} size={52} />
          <div>
            <h2>{lead.name}</h2>
            <p>{lead.company}</p>
          </div>
          <Badge tone="green">{money(lead.value)}</Badge>
        </div>
      )}
      {lead && (
        <div className="tabs">
          <button
            className={tab === "details" ? "active" : ""}
            onClick={() => setTab("details")}
          >
            Müşteri bilgileri
          </button>
          <button
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            Etkinlik geçmişi
          </button>
        </div>
      )}
      {tab === "history" ? (
        <div className="modal-content">
          {data.events.filter((e) => e.leadId === lead?.id).length ? (
            data.events
              .filter((e) => e.leadId === lead?.id)
              .map((e) => (
                <div className="activity-item" key={e.id}>
                  <span className="activity-icon">
                    <Clock size={17} />
                  </span>
                  <div>
                    <strong>{e.title}</strong>
                    <p>{e.detail}</p>
                  </div>
                </div>
              ))
          ) : (
            <p className="muted">
              Bu müşteriye ait kayıtlı etkinlik henüz yok.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={save}>
          <div className="modal-content form-grid">
            {missing.length > 0 && (
              <div className="full crm-required-hint">
                Bu aşamada zorunlu:{" "}
                <strong>
                  {missing.map((f) => requiredCrmFieldLabels[f]).join(", ")}
                </strong>
              </div>
            )}
            <label className="full">
              Portföy / işlem başlığı
              <input
                value={form.dealTitle || ""}
                onChange={(e) => field("dealTitle", e.target.value)}
                placeholder="Örn. Kadıköy · 3+1 daire satışı"
              />
            </label>
            <label>
              Satış hunisi
              <select
                value={form.pipelineId || "sales"}
                onChange={(e) => field("pipelineId", e.target.value)}
              >
                {availablePipelines(data.pipelines).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kişi kaydı
              <select
                value={form.contactId || ""}
                onChange={(e) => {
                  const c = data.contacts.find((x) => x.id === e.target.value);
                  setForm({
                    ...form,
                    contactId: e.target.value,
                    companyId: c?.companyId || "",
                    name: c?.name || form.name,
                    phone: c?.phone || form.phone,
                    email: c?.email || form.email,
                  });
                }}
              >
                <option value="">Kişi ile ilişkilendir</option>
                {data.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Şirket kaydı
              <select
                value={form.companyId || ""}
                onChange={(e) => field("companyId", e.target.value)}
              >
                <option value="">Şirket seçin</option>
                {data.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tahmini kapanış
              <input
                type="date"
                value={form.expectedCloseDate || ""}
                onChange={(e) => field("expectedCloseDate", e.target.value)}
              />
            </label>

            <label>
              Müşteri adı
              <input
                required
                value={form.name}
                onChange={(e) => field("name", e.target.value)}
                placeholder="Ad Soyad"
              />
            </label>
            <label>
              Telefon numarası
              <div className="input-icon">
                <Phone size={15} />
                <input
                  value={form.phone}
                  onChange={(e) => field("phone", e.target.value)}
                  placeholder="+90 5xx xxx xx xx"
                />
              </div>
            </label>
            <label>
              E-posta
              <div className="input-icon">
                <Mail size={15} />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => field("email", e.target.value)}
                  placeholder="ornek@firma.com"
                />
              </div>
            </label>
            <label>
              İlgilendiği portföy
              <input
                value={form.company}
                onChange={(e) => field("company", e.target.value)}
                placeholder="Kadıköy · Satılık daire"
              />
            </label>
            <label>
              Satış aşaması
              <select
                value={form.stage}
                onChange={(e) => field("stage", e.target.value)}
              >
                {getPipelineStages(data.pipelines, form.pipelineId).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sorumlu danışman
              <select
                value={form.owner}
                onChange={(e) => field("owner", e.target.value)}
              >
                {[
                  ...new Set([
                    ...data.members.map((m) => m.name),
                    ...data.leads.map((l) => l.owner),
                    form.owner,
                  ]),
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Müşteri bütçesi / işlem değeri (₺)
              <input
                type="number"
                min="0"
                value={form.value}
                onChange={(e) => field("value", Number(e.target.value))}
              />
            </label>
            <label>
              Müşteri kaynağı
              <select
                value={form.source}
                onChange={(e) => field("source", e.target.value)}
              >
                {[
                  "WhatsApp",
                  "Telefon",
                  "Web sitesi",
                  "Referans",
                  "Vapi AI",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Şehir
              <input
                value={form.city || ""}
                onChange={(e) => field("city", e.target.value)}
                placeholder="Örn. Ankara"
              />
            </label>
            <label className="full">
              Notlar
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => field("notes", e.target.value)}
                placeholder="Müşteri ihtiyaçları, görüşme notları…"
              />
            </label>
          </div>
          <footer className="modal-footer">
            {lead && onMessage && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  onMessage(lead.id);
                  onClose();
                }}
              >
                <MessageCircle size={16} />
                Mesajlaşma
              </button>
            )}
            <button type="button" className="btn secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button className="btn primary" disabled={busy}>
              <Save size={16} />
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
