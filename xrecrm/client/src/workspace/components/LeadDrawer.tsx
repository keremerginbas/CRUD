import {
  missingStageFields,
  requiredCrmFieldLabels,
} from "../../../../shared/crm-stage-policy";
import LeadQuickActions, { openOnlineMeeting } from "./LeadQuickActions";
import { Video } from "lucide-react";
import CustomerTimeline from "./CustomerTimeline";
import {
  appointmentIso,
  appointmentParts,
} from "../../../../shared/appointments";
import { useState, lazy, Suspense } from "react";
import {
  X,
  Phone,
  Mail,
  MessageCircle,
  Plus,
  CheckSquare,
  CalendarClock,
  Save,
  Activity,
  Clock,
  ArrowUpRight,
  FileText,
  Users,
  Building2,
  ChevronDown,
  Check,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Lead, Stage, money } from "../data";
import {
  availablePipelines,
  getPipelineStages,
  dateTimeLabel,
  isOverdue,
} from "../suite";
import { useStore } from "../store";
import { Avatar, Badge } from "./ui";
const TaskEditor = lazy(() =>
  import("../pages/Work").then((m) => ({ default: m.TaskEditor })),
);
const ActivityEditor = lazy(() =>
  import("../pages/Work").then((m) => ({ default: m.ActivityEditor })),
);
export default function LeadDrawer({
  lead,
  onClose,
  onMessage,
}: {
  lead: Lead;
  onClose: () => void;
  onMessage: (id: string) => void;
}) {
  const { data, saveLead, moveLead, addNote, demo, saveRecord } = useStore();
  const current = data.leads.find((l) => l.id === lead.id) || lead;
  const [form, setForm] = useState<Lead>({ ...current });
  const [tab, setTab] = useState("timeline");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<"task" | "activity" | null>(null);
  const [appointmentDay, setAppointmentDay] = useState(
    appointmentParts(current.appointmentAt).day,
  );
  const [appointmentTime, setAppointmentTime] = useState(
    appointmentParts(current.appointmentAt).time,
  );
  const [customName, setCustomName] = useState("");
  const [customValue, setCustomValue] = useState("");
  const missing = missingStageFields(
    form as unknown as Record<string, unknown>,
    data.pipelines,
  );
  const stages = getPipelineStages(data.pipelines, current.pipelineId);
  const contact = data.contacts.find((c) => c.id === current.contactId);
  const company = data.companies.find((c) => c.id === current.companyId);
  const tasks = data.tasks.filter((t) => t.leadId === current.id);
  const activities = data.activities.filter((a) => a.leadId === current.id);
  const members = [
    ...new Set([
      ...data.members.map((m) => m.name),
      ...data.leads.map((l) => l.owner),
    ]),
  ];
  const timeline = [
    ...data.feed
      .filter((p) => p.leadId === current.id)
      .map((p) => ({
        id: p.id,
        type: "note",
        title: p.author,
        text: p.text,
        date: p.createdAt,
      })),
    ...data.messages
      .filter((m) => m.leadId === current.id)
      .map((m) => ({
        id: m.id,
        type: "message",
        title:
          m.direction === "inbound"
            ? "Gelen WhatsApp mesajı"
            : "Giden WhatsApp mesajı",
        text: m.text,
        date: m.createdAt,
      })),
    ...data.calls
      .filter((c) => c.leadId === current.id)
      .map((c) => ({
        id: c.id,
        type: "call",
        title: "Yapay zekâ araması",
        text: c.summary || c.status,
        date: c.createdAt,
      })),
    ...data.events
      .filter((e) => e.leadId === current.id)
      .map((e) => ({
        id: e.id,
        type: "event",
        title: e.title,
        text: e.detail || e.type,
        date: e.createdAt,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (
        (appointmentDay && !appointmentTime) ||
        (!appointmentDay && appointmentTime)
      )
        throw new Error("Randevu için hem tarih hem saat seçmelisiniz.");
      await saveLead({
        ...form,
        appointmentAt:
          appointmentDay && appointmentTime
            ? appointmentIso(appointmentDay, appointmentTime)
            : form.appointmentAt,
      });
      toast.success("Müşteri bilgileri güncellendi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function postNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await addNote(current.id, note.trim());
      setNote("");
      toast.success("Not zaman çizelgesine eklendi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="b24-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="b24-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Müşteri detayları"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="b24-drawer-close"
          onClick={onClose}
          aria-label="Kapat"
        >
          <X size={22} />
        </button>
        <header className="b24-drawer-header">
          <div>
            <span>MÜŞTERİ · {current.id.slice(0, 8).toUpperCase()}</span>
            <h2>{current.name}</h2>
            <p>
              {
                availablePipelines(data.pipelines).find(
                  (p) => p.id === (current.pipelineId || "sales"),
                )?.name
              }
              <i />
              Sorumlu: {current.owner}
            </p>
          </div>
          <strong>{money(current.value)}</strong>
        </header>
        <div className="b24-stage-strip">
          {stages.map((s) => (
            <button
              key={s.id}
              style={{
                background: current.stage === s.id ? s.color : undefined,
              }}
              className={current.stage === s.id ? "active" : ""}
              onClick={async () => {
                try {
                  await moveLead(current.id, s.id);
                  setForm({ ...form, stage: s.id });
                  toast.success("Aşama güncellendi.");
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              {s.label}
              {current.stage === s.id && <Check size={12} />}
            </button>
          ))}
        </div>
        <div className="b24-drawer-tools">
          <LeadQuickActions
            lead={current}
            onMessage={onMessage}
            onActivity={() => setEditor("activity")}
          />
          <button
            className="btn secondary small"
            onClick={() => setEditor("task")}
          >
            <CheckSquare size={14} />
            Görev oluştur
          </button>
          <Badge tone={demo ? "amber" : "green"}>{demo ? "Demo" : "CRM"}</Badge>
        </div>
        <div className="b24-drawer-content">
          <section className="b24-drawer-info">
            <div className="b24-info-person">
              <Avatar name={current.name} size={42} />
              <div>
                <h3>{current.name}</h3>
                <span>{current.phone || "Telefon eklenmedi"}</span>
              </div>
            </div>
            <div className="b24-detail-links">
              {current.phone && (
                <a href={`tel:${current.phone}`}>
                  <Phone size={13} />
                  {current.phone}
                </a>
              )}
              {current.email && (
                <a href={`mailto:${current.email}`}>
                  <Mail size={13} />
                  {current.email}
                </a>
              )}
            </div>
            <form onSubmit={save}>
              <h4>Müşteri bilgileri</h4>
              {missing.length > 0 && (
                <div className="crm-required-hint">
                  Bu aşamada tamamlanması gereken alanlar:{" "}
                  <strong>
                    {missing.map((f) => requiredCrmFieldLabels[f]).join(", ")}
                  </strong>
                </div>
              )}
              <label>
                Portföy / işlem başlığı
                <input
                  value={form.dealTitle || ""}
                  onChange={(e) =>
                    setForm({ ...form, dealTitle: e.target.value })
                  }
                  placeholder="Portföy / satış fırsatı"
                />
              </label>
              <label>
                Müşteri adı
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Telefon
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label>
                E-posta
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              <div className="b24-info-row">
                <label>
                  Tutar (₺)
                  <input
                    type="number"
                    min="0"
                    value={form.value}
                    onChange={(e) =>
                      setForm({ ...form, value: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Olasılık (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.probability ?? 0}
                    onChange={(e) =>
                      setForm({ ...form, probability: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label>
                Satış hunisi
                <select
                  value={form.pipelineId || "sales"}
                  onChange={(e) =>
                    setForm({ ...form, pipelineId: e.target.value })
                  }
                >
                  {availablePipelines(data.pipelines).map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sorumlu
                <select
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                >
                  {members.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                Tahmini kapanış
                <input
                  type="date"
                  value={form.expectedCloseDate?.slice(0, 10) || ""}
                  onChange={(e) =>
                    setForm({ ...form, expectedCloseDate: e.target.value })
                  }
                />
              </label>
              <h4>Kişi ve şirket kartı</h4>
              <label>
                Kişi
                <select
                  value={form.contactId || ""}
                  onChange={(e) => {
                    const c = data.contacts.find(
                      (x) => x.id === e.target.value,
                    );
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
                Şirket
                <select
                  value={form.companyId || ""}
                  onChange={(e) =>
                    setForm({ ...form, companyId: e.target.value })
                  }
                >
                  <option value="">Şirket ile ilişkilendir</option>
                  {data.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cx-linked-cards">
                <div>
                  <Users size={16} />
                  <span>
                    <strong>{contact?.name || current.name}</strong>
                    <small>
                      Kişi kartı ·{" "}
                      {contact?.phone || current.phone || "Telefon yok"}
                    </small>
                  </span>
                </div>
                <div>
                  <Building2 size={16} />
                  <span>
                    <strong>
                      {company?.name || current.company || "Şirket seçilmedi"}
                    </strong>
                    <small>
                      Şirket kartı · {company?.industry || "CRM bağlantısı"}
                    </small>
                  </span>
                </div>
              </div>
              {current.stage === "lost" && (
                <label>
                  Kaybetme nedeni
                  <textarea
                    rows={2}
                    value={form.lostReason || ""}
                    onChange={(e) =>
                      setForm({ ...form, lostReason: e.target.value })
                    }
                  />
                </label>
              )}
              <label>
                Kalıcı açıklama
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              <h4>Kaynak ve randevu</h4>
              <label>
                Kaynak
                <select
                  value={form.source}
                  onChange={(e) => setForm({ ...form, source: e.target.value })}
                >
                  {[
                    ...new Set([
                      form.source,
                      "Reklam",
                      "WhatsApp",
                      "Telefon",
                      "Web sitesi",
                      "Referans",
                      "manual",
                    ]),
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Şehir
                <input
                  value={form.city || ""}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="Örn. Ankara"
                />
              </label>
              <div className="cx-date-row">
                <label>
                  Randevu günü
                  <input
                    type="date"
                    value={appointmentDay}
                    onChange={(e) => setAppointmentDay(e.target.value)}
                  />
                </label>
                <label>
                  Randevu saati
                  <input
                    type="time"
                    value={appointmentTime}
                    onChange={(e) => setAppointmentTime(e.target.value)}
                  />
                </label>
              </div>
              {form.appointmentAt && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setAppointmentDay("");
                    setAppointmentTime("");
                    setForm({ ...form, appointmentAt: "" });
                  }}
                >
                  Randevu tarihini temizle
                </button>
              )}
              <small className="cx-required-note">
                Randevu statüsünde tarih ve saat zorunludur. Türkiye saati.
              </small>
              <h4>Özel alanlar</h4>
              {Object.entries(form.customFields || {}).map(([k, v]) => (
                <label key={k}>
                  {k}
                  <input
                    value={v}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        customFields: {
                          ...form.customFields,
                          [k]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
              <div className="b24-custom-add">
                <input
                  placeholder="Alan adı"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
                <input
                  placeholder="Değer"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Özel alan ekle"
                  onClick={() => {
                    if (
                      customName.trim() &&
                      !["__proto__", "constructor", "prototype"].includes(
                        customName.trim(),
                      )
                    ) {
                      setForm({
                        ...form,
                        customFields: {
                          ...form.customFields,
                          [customName.trim()]: customValue,
                        },
                      });
                      setCustomName("");
                      setCustomValue("");
                    }
                  }}
                >
                  <Plus size={16} />
                </button>
              </div>
              <button className="btn primary full-width" disabled={busy}>
                <Save size={15} />
                {busy ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
              </button>
            </form>
          </section>
          <CustomerTimeline lead={current} />
        </div>
        <Suspense fallback={null}>
          {editor === "task" && (
            <TaskEditor leadId={current.id} onClose={() => setEditor(null)} />
          )}{" "}
          {editor === "activity" && (
            <ActivityEditor
              leadId={current.id}
              onClose={() => setEditor(null)}
            />
          )}
        </Suspense>
      </aside>
    </div>
  );
}
