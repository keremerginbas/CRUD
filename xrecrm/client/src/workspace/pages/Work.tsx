import {
  appointmentParts,
  appointmentIso,
} from "../../../../shared/appointments";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  GripVertical,
  List,
  Plus,
  Search,
  Square,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, Badge, Empty, Modal, PageTitle } from "../components/ui";
import { useStore } from "../store";
import {
  dateTimeLabel,
  isOverdue,
  localDateInput,
  startOfDay,
  toIso,
} from "../suite";
import type { Activity, Task } from "../suite";
import type { Lead } from "../data";
import "../suite-pages.css";

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const dayKey = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const localDate = (value: Date) => {
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
};
const formatDay = (value: Date) =>
  value.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
const statusLabels: Record<Task["status"], string> = {
  todo: "Yapılacak",
  progress: "Devam ediyor",
  done: "Tamamlandı",
};
const statusTone: Record<Task["status"], string> = {
  todo: "gray",
  progress: "blue",
  done: "green",
};

function emptyTask(leadId = "", assignee = ""): Task {
  const now = nowIso();
  const due = new Date();
  due.setHours(17, 0, 0, 0);
  return {
    id: uuid(),
    title: "",
    description: "",
    status: "todo",
    priority: "normal",
    assignee,
    leadId,
    dueAt: due.toISOString(),
    checklist: [],
    createdAt: now,
    updatedAt: now,
  };
}
function emptyActivity(
  leadId = "",
  assignee = "",
  date = new Date(),
): Activity {
  const start = new Date(date);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);
  const now = nowIso();
  return {
    id: uuid(),
    leadId,
    type: "meeting",
    title: "Müşteriyle görüşün",
    description: "",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    assignee,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
}

function LeadSelect({
  value,
  onChange,
  leads,
}: {
  value: string;
  onChange: (value: string) => void;
  leads: Lead[];
}) {
  return (
    <label className="sx-field">
      Bağlı CRM müşterisi
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Bağlantı yok</option>
        {leads.map((lead) => (
          <option key={lead.id} value={lead.id}>
            {lead.name} · {lead.company}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TaskEditor({
  task,
  leadId = "",
  onClose,
}: {
  task?: Task;
  leadId?: string;
  onClose: () => void;
}) {
  const { data, saveRecord, user } = useStore();
  const [draft, setDraft] = useState<Task>(() =>
    task
      ? { ...task, checklist: task.checklist || [] }
      : emptyTask(leadId, user?.name || data.members[0]?.name || ""),
  );
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof Task>(key: K, value: Task[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const addChecklist = () =>
    update("checklist", [
      ...draft.checklist,
      { id: uuid(), text: "", done: false },
    ]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      toast.error("Görev başlığı gerekli.");
      return;
    }
    setSaving(true);
    try {
      const checklist = draft.checklist
        .filter((item) => item.text.trim())
        .map((item) => ({ ...item, text: item.text.trim() }));
      await saveRecord("tasks", {
        ...draft,
        title: draft.title.trim(),
        checklist,
        updatedAt: nowIso(),
      });
      toast.success("Görev kaydedildi.");
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "Görev kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      wide
      title={task ? "Görevi düzenle" : "Yeni görev"}
      subtitle="Takip işini planlayın; dış iletişim bu ekrandan başlatılmaz."
      onClose={onClose}
    >
      <form className="sx-modal-form" onSubmit={save}>
        <div className="sx-form-grid">
          <label className="sx-field sx-span-2">
            Başlık
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Örn. Portföy sunumunu hazırla"
            />
          </label>
          <label className="sx-field sx-span-2">
            Açıklama
            <textarea
              rows={3}
              value={draft.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Görevin kapsamı ve sonraki adım"
            />
          </label>
          <label className="sx-field">
            Sorumlu
            <select
              value={draft.assignee}
              onChange={(event) => update("assignee", event.target.value)}
            >
              <option value="">Atanmamış</option>
              {data.members.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
              {draft.assignee &&
                !data.members.some(
                  (member) => member.name === draft.assignee,
                ) && <option value={draft.assignee}>{draft.assignee}</option>}
            </select>
          </label>
          <label className="sx-field">
            Son tarih
            <input
              type="datetime-local"
              value={localDateInput(draft.dueAt)}
              onChange={(event) => update("dueAt", toIso(event.target.value))}
            />
          </label>
          <label className="sx-field">
            Öncelik
            <select
              value={draft.priority}
              onChange={(event) =>
                update("priority", event.target.value as Task["priority"])
              }
            >
              <option value="low">Düşük</option>
              <option value="normal">Normal</option>
              <option value="high">Yüksek</option>
            </select>
          </label>
          <label className="sx-field">
            Durum
            <select
              value={draft.status}
              onChange={(event) =>
                update("status", event.target.value as Task["status"])
              }
            >
              <option value="todo">Yapılacak</option>
              <option value="progress">Devam ediyor</option>
              <option value="done">Tamamlandı</option>
            </select>
          </label>
          <LeadSelect
            value={draft.leadId}
            onChange={(value) => update("leadId", value)}
            leads={data.leads}
          />
          <div className="sx-field sx-span-2">
            <span>Kontrol listesi</span>
            <div className="sx-checklist">
              {draft.checklist.map((item) => (
                <div className="sx-check-row" key={item.id}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      update(
                        "checklist",
                        draft.checklist.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, done: !entry.done }
                            : entry,
                        ),
                      )
                    }
                    aria-label={`${item.text || "Kontrol maddesi"} tamamlandı`}
                  />
                  <input
                    value={item.text}
                    onChange={(event) =>
                      update(
                        "checklist",
                        draft.checklist.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, text: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Kontrol maddesi"
                  />
                  <button
                    className="sx-icon-button"
                    type="button"
                    onClick={() =>
                      update(
                        "checklist",
                        draft.checklist.filter((entry) => entry.id !== item.id),
                      )
                    }
                    aria-label="Kontrol maddesini kaldır"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="sx-add-row"
                onClick={addChecklist}
              >
                <Plus size={14} /> Madde ekle
              </button>
            </div>
          </div>
        </div>
        <div className="sx-modal-footer">
          <span className="sx-muted">
            Görev kaydı CRM çalışma alanında tutulur.
          </span>
          <div className="sx-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Görevi kaydet"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function ActivityEditor({
  activity,
  leadId = "",
  date,
  onClose,
  requireLead = false,
}: {
  activity?: Activity;
  leadId?: string;
  date?: Date;
  onClose: () => void;
  requireLead?: boolean;
}) {
  const { data, saveRecord, user } = useStore();
  const [draft, setDraft] = useState<Activity>(() =>
    activity
      ? { ...activity }
      : {
          ...emptyActivity(
            leadId,
            user?.name || data.members[0]?.name || "",
            date || new Date(),
          ),
          startAt: "",
          endAt: "",
        },
  );
  const [saving, setSaving] = useState(false);
  const update = <K extends keyof Activity>(key: K, value: Activity[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (requireLead && !draft.leadId) {
      toast.error("CRM etkinliği için müşteri seçmelisiniz.");
      return;
    }
    if (!draft.title.trim()) {
      toast.error("Etkinlik başlığı gerekli.");
      return;
    }
    if (!draft.startAt || !draft.endAt) {
      toast.error("Başlangıç ve bitiş zamanı gerekli.");
      return;
    }
    if (new Date(draft.endAt).getTime() < new Date(draft.startAt).getTime()) {
      toast.error("Bitiş zamanı başlangıçtan önce olamaz.");
      return;
    }
    setSaving(true);
    try {
      await saveRecord("activities", {
        ...draft,
        title: draft.title.trim(),
        updatedAt: nowIso(),
      });
      toast.success("Etkinlik kaydedildi.");
      onClose();
    } catch (error) {
      toast.error((error as Error).message || "Etkinlik kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      wide
      title={activity ? "Etkinliği düzenle" : "Takvime etkinlik ekle"}
      subtitle="Arama ve toplantılar için planlama kaydıdır; otomatik arama veya mesaj göndermez."
      onClose={onClose}
    >
      <form className="sx-modal-form" onSubmit={save}>
        <div className="sx-form-grid">
          <label className="sx-field sx-span-2">
            Başlık
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Örn. Portföy görüşmesi"
            />
          </label>
          <label className="sx-field">
            Tür
            <select
              value={draft.type}
              onChange={(event) =>
                update("type", event.target.value as Activity["type"])
              }
            >
              <option value="meeting">Toplantı</option>
              <option value="call">Arama planı</option>
              <option value="task">Görev etkinliği</option>
            </select>
          </label>
          <label className="sx-field">
            Sorumlu
            <select
              value={draft.assignee}
              onChange={(event) => update("assignee", event.target.value)}
            >
              <option value="">Atanmamış</option>
              {data.members.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
              {draft.assignee &&
                !data.members.some(
                  (member) => member.name === draft.assignee,
                ) && <option value={draft.assignee}>{draft.assignee}</option>}
            </select>
          </label>
          <label className="sx-field">
            Başlangıç
            <input
              required
              type="datetime-local"
              value={
                draft.startAt
                  ? `${appointmentParts(draft.startAt).day}T${appointmentParts(draft.startAt).time}`
                  : ""
              }
              onChange={(event) =>
                update(
                  "startAt",
                  event.target.value
                    ? appointmentIso(
                        ...(event.target.value.split("T") as [string, string]),
                      )
                    : "",
                )
              }
            />
          </label>
          <label className="sx-field">
            Bitiş
            <input
              required
              type="datetime-local"
              value={
                draft.endAt
                  ? `${appointmentParts(draft.endAt).day}T${appointmentParts(draft.endAt).time}`
                  : ""
              }
              onChange={(event) =>
                update(
                  "endAt",
                  event.target.value
                    ? appointmentIso(
                        ...(event.target.value.split("T") as [string, string]),
                      )
                    : "",
                )
              }
            />
          </label>
          <LeadSelect
            value={draft.leadId}
            onChange={(value) => update("leadId", value)}
            leads={data.leads}
          />
          <label className="sx-field sx-span-2">
            Açıklama
            <textarea
              rows={4}
              value={draft.description}
              onChange={(event) => update("description", event.target.value)}
              placeholder="Görüşme amacı ve notlar"
            />
          </label>
          <label className="sx-checkbox sx-span-2">
            <input
              type="checkbox"
              checked={draft.completed}
              onChange={(event) => update("completed", event.target.checked)}
            />{" "}
            Tamamlandı olarak işaretle
          </label>
        </div>
        <div className="sx-modal-footer">
          <span className="sx-muted">
            Planlama kaydıdır; telefon görüşmesi başlatmaz.
          </span>
          <div className="sx-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button className="btn primary" type="submit" disabled={saving}>
              {saving ? "Kaydediliyor…" : "Etkinliği kaydet"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function TaskCard({
  task,
  lead,
  onLead,
  onEdit,
  onStatus,
}: {
  task: Task;
  lead?: Lead;
  onLead: (lead: Lead) => void;
  onEdit: () => void;
  onStatus: (status: Task["status"]) => void;
}) {
  const overdue = isOverdue(task.dueAt, task.status === "done");
  return (
    <article
      className={`sx-task-card ${overdue ? "overdue" : ""}`}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", task.id)}
    >
      <div className="sx-task-card-head">
        <Badge
          tone={
            task.priority === "high"
              ? "red"
              : task.priority === "normal"
                ? "blue"
                : "gray"
          }
        >
          {task.priority === "high"
            ? "Yüksek"
            : task.priority === "normal"
              ? "Normal"
              : "Düşük"}
        </Badge>
        <button
          className="sx-icon-button"
          onClick={onEdit}
          aria-label={`${task.title} görevini düzenle`}
        >
          <Edit3 size={14} />
        </button>
      </div>
      <button className="sx-task-title" onClick={onEdit}>
        {task.title || "Başlıksız görev"}
      </button>
      {task.description && <p>{task.description}</p>}
      <div className="sx-task-meta">
        <span className={overdue ? "sx-overdue" : ""}>
          <Clock3 size={13} />
          {task.dueAt ? dateTimeLabel(task.dueAt) : "Tarih yok"}
        </span>
        {task.assignee && (
          <span>
            <Avatar name={task.assignee} size={19} />
            {task.assignee}
          </span>
        )}
      </div>
      {lead && (
        <button className="sx-linked-lead" onClick={() => onLead(lead)}>
          {lead.name}
          <span>↗</span>
        </button>
      )}
      <div className="sx-task-footer">
        <span>
          <GripVertical size={13} />
          Sürükle
        </span>
        <select
          value={task.status}
          onChange={(event) => onStatus(event.target.value as Task["status"])}
          aria-label={`${task.title} durumunu değiştir`}
        >
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function TaskBoard({
  tasks,
  data,
  onLead,
  onEdit,
  onStatus,
}: {
  tasks: Task[];
  data: ReturnType<typeof useStore>["data"];
  onLead: (lead: Lead) => void;
  onEdit: (task: Task) => void;
  onStatus: (task: Task, status: Task["status"]) => void;
}) {
  const [over, setOver] = useState<Task["status"] | null>(null);
  return (
    <div className="sx-kanban-board">
      {(Object.keys(statusLabels) as Task["status"][]).map((status) => (
        <section
          key={status}
          className={`sx-kanban-column ${over === status ? "drag-over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(status);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            const task = tasks.find(
              (item) => item.id === event.dataTransfer.getData("text/plain"),
            );
            if (task) onStatus(task, status);
            setOver(null);
          }}
        >
          <header>
            <span className={`sx-status-dot ${status}`} />
            <h3>{statusLabels[status]}</h3>
            <b>{tasks.filter((task) => task.status === status).length}</b>
          </header>
          <div className="sx-kanban-items">
            {tasks
              .filter((task) => task.status === status)
              .map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  lead={data.leads.find((lead) => lead.id === task.leadId)}
                  onLead={onLead}
                  onEdit={() => onEdit(task)}
                  onStatus={(next) => onStatus(task, next)}
                />
              ))}
            {tasks.filter((task) => task.status === status).length === 0 && (
              <div className="sx-drop-hint">Görevi buraya bırakın</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskList({
  tasks,
  data,
  onLead,
  onEdit,
  onStatus,
}: {
  tasks: Task[];
  data: ReturnType<typeof useStore>["data"];
  onLead: (lead: Lead) => void;
  onEdit: (task: Task) => void;
  onStatus: (task: Task, status: Task["status"]) => void;
}) {
  if (!tasks.length)
    return (
      <section className="panel">
        <Empty
          title="Görev bulunamadı"
          description="Filtreleri değiştirin veya yeni bir takip görevi oluşturun."
        />
      </section>
    );
  return (
    <section className="panel sx-task-list">
      <div className="sx-table-scroll">
        <table className="sx-table">
          <thead>
            <tr>
              <th>GÖREV</th>
              <th>DURUM</th>
              <th>SORUMLU</th>
              <th>SON TARİH</th>
              <th>ÖNCELİK</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const lead = data.leads.find((item) => item.id === task.leadId);
              const overdue = isOverdue(task.dueAt, task.status === "done");
              return (
                <tr key={task.id} className={overdue ? "is-overdue" : ""}>
                  <td>
                    <div className="sx-list-task">
                      <button
                        className="sx-check-button"
                        onClick={() =>
                          onStatus(
                            task,
                            task.status === "done" ? "todo" : "done",
                          )
                        }
                        aria-label={`${task.title} tamamlanma durumunu değiştir`}
                      >
                        {task.status === "done" ? (
                          <Check size={15} />
                        ) : (
                          <Square size={15} />
                        )}
                      </button>
                      <span>
                        <button
                          className="sx-task-title"
                          onClick={() => onEdit(task)}
                        >
                          {task.title || "Başlıksız görev"}
                        </button>
                        {lead && (
                          <button
                            className="sx-linked-lead"
                            onClick={() => onLead(lead)}
                          >
                            {lead.name} ↗
                          </button>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={statusTone[task.status]}>
                      {statusLabels[task.status]}
                    </Badge>
                  </td>
                  <td>
                    {task.assignee ? (
                      <span className="sx-owner">
                        <Avatar name={task.assignee} size={22} />
                        {task.assignee}
                      </span>
                    ) : (
                      <span className="sx-muted">Atanmamış</span>
                    )}
                  </td>
                  <td className={overdue ? "sx-overdue" : ""}>
                    {task.dueAt ? dateTimeLabel(task.dueAt) : "Tarih yok"}
                  </td>
                  <td>
                    <Badge tone={task.priority === "high" ? "red" : "gray"}>
                      {task.priority === "high"
                        ? "Yüksek"
                        : task.priority === "normal"
                          ? "Normal"
                          : "Düşük"}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="sx-icon-button"
                      onClick={() => onEdit(task)}
                      aria-label={`${task.title} görevini düzenle`}
                    >
                      <Edit3 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CalendarView({
  data,
  onLead,
  onEditActivity,
  onEditTask,
  onNewActivity,
  onToggleActivity,
  onToggleTask,
}: {
  data: ReturnType<typeof useStore>["data"];
  onLead: (lead: Lead) => void;
  onEditActivity: (activity: Activity) => void;
  onEditTask: (task: Task) => void;
  onNewActivity: (date: Date) => void;
  onToggleActivity: (activity: Activity) => void;
  onToggleTask: (task: Task) => void;
}) {
  const [month, setMonth] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const cells = Array.from(
    { length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 },
    (_, index) => {
      const number = index - firstWeekday + 1;
      return number < 1 || number > daysInMonth
        ? null
        : new Date(month.getFullYear(), month.getMonth(), number);
    },
  );
  const selectedKey = dayKey(selected);
  const dayActivities = data.activities
    .filter((a) => !a.cancelled)
    .filter((activity) => dayKey(activity.startAt) === selectedKey)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const dayTasks = data.tasks
    .filter((task) => task.dueAt && dayKey(task.dueAt) === selectedKey)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return (
    <div className="sx-calendar-layout">
      <section className="panel sx-calendar-panel">
        <div className="sx-calendar-head">
          <button
            className="sx-icon-button"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
            aria-label="Önceki ay"
          >
            <ChevronLeft size={17} />
          </button>
          <h2>
            {month.toLocaleDateString("tr-TR", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            className="sx-icon-button"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
            aria-label="Sonraki ay"
          >
            <ChevronRight size={17} />
          </button>
          <button
            className="btn secondary sx-today-button"
            onClick={() => {
              const today = new Date();
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(startOfDay(today));
            }}
          >
            Bugün
          </button>
        </div>
        <div className="sx-calendar-weekdays">
          {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="sx-calendar-grid">
          {cells.map((date, index) =>
            date ? (
              <button
                key={date.toISOString()}
                className={`sx-calendar-day ${dayKey(date) === selectedKey ? "selected" : ""} ${dayKey(date) === dayKey(new Date()) ? "today" : ""}`}
                onClick={() => setSelected(startOfDay(date))}
              >
                <strong>{date.getDate()}</strong>
                <div className="sx-calendar-events">
                  {data.activities
                    .filter((a) => !a.cancelled)
                    .filter(
                      (activity) => dayKey(activity.startAt) === dayKey(date),
                    )
                    .slice(0, 3)
                    .map((activity) => (
                      <span
                        key={activity.id}
                        className={`sx-calendar-event ${activity.type}`}
                      >
                        {activity.title || "Etkinlik"}
                      </span>
                    ))}
                  {data.tasks
                    .filter(
                      (task) =>
                        task.dueAt && dayKey(task.dueAt) === dayKey(date),
                    )
                    .slice(0, 2)
                    .map((task) => (
                      <span key={task.id} className="sx-calendar-event task">
                        {task.title || "Görev"}
                      </span>
                    ))}
                </div>
              </button>
            ) : (
              <span className="sx-calendar-empty" key={`empty-${index}`} />
            ),
          )}
        </div>
        <div className="sx-calendar-legend">
          <span>
            <i className="meeting" />
            Toplantı
          </span>
          <span>
            <i className="call" />
            Arama planı
          </span>
          <span>
            <i className="task" />
            Görev teslimi
          </span>
        </div>
      </section>
      <aside className="panel sx-day-detail">
        <div className="sx-day-head">
          <div>
            <span className="sx-eyebrow">SEÇİLİ GÜN</span>
            <h2>{formatDay(selected)}</h2>
          </div>
          <button
            className="btn primary"
            onClick={() => onNewActivity(selected)}
          >
            <Plus size={15} /> Etkinlik
          </button>
        </div>
        {dayActivities.length === 0 && dayTasks.length === 0 && (
          <Empty
            title="Bu gün boş"
            description="Takvime planlama kaydı ekleyin."
          />
        )}
        {dayActivities.map((activity) => (
          <div
            className={`sx-day-item ${activity.type} ${activity.completed ? "completed" : ""}`}
            key={activity.id}
          >
            <button
              className="sx-check-button"
              onClick={() => onToggleActivity(activity)}
              aria-label={`${activity.title} tamamlanma durumunu değiştir`}
            >
              {activity.completed ? <Check size={15} /> : <Square size={15} />}
            </button>
            <div className="sx-day-item-body">
              <strong>{activity.title || "Başlıksız etkinlik"}</strong>
              <span>
                {activity.type === "meeting"
                  ? "Toplantı"
                  : activity.type === "call"
                    ? "Arama planı"
                    : "Görev etkinliği"}{" "}
                · {dateTimeLabel(activity.startAt)}
              </span>
              {activity.description && <p>{activity.description}</p>}
              {activity.leadId &&
                data.leads.find((lead) => lead.id === activity.leadId) && (
                  <button
                    className="sx-linked-lead"
                    onClick={() =>
                      onLead(
                        data.leads.find((lead) => lead.id === activity.leadId)!,
                      )
                    }
                  >
                    {
                      data.leads.find((lead) => lead.id === activity.leadId)
                        ?.name
                    }{" "}
                    ↗
                  </button>
                )}
            </div>
            <button
              className="sx-icon-button"
              onClick={() => onEditActivity(activity)}
              aria-label={`${activity.title} etkinliğini düzenle`}
            >
              <Edit3 size={14} />
            </button>
          </div>
        ))}
        {dayTasks.map((task) => (
          <div
            className={`sx-day-item task ${task.status === "done" ? "completed" : ""}`}
            key={task.id}
          >
            <button
              className="sx-check-button"
              onClick={() => onToggleTask(task)}
              aria-label={`${task.title} tamamlanma durumunu değiştir`}
            >
              {task.status === "done" ? (
                <Check size={15} />
              ) : (
                <Square size={15} />
              )}
            </button>
            <div className="sx-day-item-body">
              <strong>{task.title || "Başlıksız görev"}</strong>
              <span>
                Görev teslimi ·{" "}
                {task.dueAt ? dateTimeLabel(task.dueAt) : "Tarih yok"}
              </span>
              {task.assignee && <span>{task.assignee}</span>}
            </div>
            <button
              className="sx-icon-button"
              onClick={() => onEditTask(task)}
              aria-label={`${task.title} görevini düzenle`}
            >
              <Edit3 size={14} />
            </button>
          </div>
        ))}
      </aside>
    </div>
  );
}

export default function Work({
  calendar = false,
  onLead,
  initialLeadId = "",
}: {
  calendar?: boolean;
  onLead: (lead: Lead) => void;
  initialLeadId?: string;
}) {
  const { data, saveRecord, user } = useStore();
  const defaultAssignee = user?.name || data.members[0]?.name || "";
  const [view, setView] = useState<"list" | "kanban">("list");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [priority, setPriority] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [taskEditor, setTaskEditor] = useState<{
    task?: Task;
    leadId?: string;
  } | null>(initialLeadId ? { leadId: initialLeadId } : null);
  const [activityEditor, setActivityEditor] = useState<{
    activity?: Activity;
    date?: Date;
  } | null>(null);
  const owners = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...data.members.map((member) => member.name),
            ...data.tasks.map((task) => task.assignee),
          ].filter(Boolean),
        ),
      ),
    [data.members, data.tasks],
  );
  const filteredTasks = data.tasks.filter((task) => {
    const search =
      `${task.title} ${task.description} ${task.assignee} ${data.leads.find((lead) => lead.id === task.leadId)?.name || ""}`.toLocaleLowerCase(
        "tr",
      );
    return (
      (!query || search.includes(query.toLocaleLowerCase("tr"))) &&
      (assignee === "all" || task.assignee === assignee) &&
      (priority === "all" || task.priority === priority) &&
      (!overdueOnly || isOverdue(task.dueAt, task.status === "done"))
    );
  });
  const updateTaskStatus = async (task: Task, status: Task["status"]) => {
    if (task.status === status) return;
    try {
      await saveRecord("tasks", { ...task, status, updatedAt: nowIso() });
      toast.success("Görev durumu güncellendi.");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const toggleActivity = async (activity: Activity) => {
    try {
      await saveRecord("activities", {
        ...activity,
        completed: !activity.completed,
        updatedAt: nowIso(),
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const toggleTask = async (task: Task) =>
    updateTaskStatus(task, task.status === "done" ? "todo" : "done");
  const title = calendar ? "Takvim" : "Görevler";
  return (
    <>
      <PageTitle
        eyebrow="PLANLAMA & TAKİP"
        title={title}
        description={
          calendar
            ? "Toplantı, arama planı ve görev teslimlerini tek takvimde görün."
            : "Görevleri sorumlulara atayın, önceliklendirin ve ilerlemeyi güncel tutun."
        }
        actions={
          <button
            className="btn primary"
            onClick={() =>
              calendar
                ? setActivityEditor({ date: new Date() })
                : setTaskEditor({ leadId: initialLeadId })
            }
          >
            <Plus size={16} /> {calendar ? "Etkinlik ekle" : "Yeni görev"}
          </button>
        }
      />
      {!calendar ? (
        <>
          <div
            className="sx-tabs sx-view-tabs"
            role="tablist"
            aria-label="İş görünümü"
          >
            <button
              role="tab"
              aria-selected={view === "list"}
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              <List size={15} /> Liste
            </button>
            <button
              role="tab"
              aria-selected={view === "kanban"}
              className={view === "kanban" ? "active" : ""}
              onClick={() => setView("kanban")}
            >
              <UsersRound size={15} /> Kanban
            </button>
          </div>
          <section className="sx-toolbar panel">
            <label className="sx-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Görev, müşteri veya sorumlu ara…"
                aria-label="Görevlerde ara"
              />
            </label>
            <label className="sx-filter-label">
              Sorumlu
              <select
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="all">Tümü</option>
                {owners.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>
            </label>
            <label className="sx-filter-label">
              Öncelik
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="all">Tümü</option>
                <option value="high">Yüksek</option>
                <option value="normal">Normal</option>
                <option value="low">Düşük</option>
              </select>
            </label>
            <label className="sx-check-filter">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
              />{" "}
              Gecikenler
            </label>
            <span className="sx-toolbar-count">
              {filteredTasks.length} görev
            </span>
          </section>
          {view === "kanban" ? (
            <TaskBoard
              tasks={filteredTasks}
              data={data}
              onLead={onLead}
              onEdit={(task) => setTaskEditor({ task })}
              onStatus={updateTaskStatus}
            />
          ) : (
            <TaskList
              tasks={filteredTasks}
              data={data}
              onLead={onLead}
              onEdit={(task) => setTaskEditor({ task })}
              onStatus={updateTaskStatus}
            />
          )}
        </>
      ) : (
        <CalendarView
          data={data}
          onLead={onLead}
          onEditActivity={(activity) => setActivityEditor({ activity })}
          onEditTask={(task) => setTaskEditor({ task })}
          onNewActivity={(date) => setActivityEditor({ date })}
          onToggleActivity={toggleActivity}
          onToggleTask={toggleTask}
        />
      )}
      {taskEditor && (
        <TaskEditor
          task={taskEditor.task}
          leadId={taskEditor.leadId}
          onClose={() => setTaskEditor(null)}
        />
      )}
      {activityEditor && (
        <ActivityEditor
          activity={activityEditor.activity}
          date={activityEditor.date}
          onClose={() => setActivityEditor(null)}
        />
      )}
    </>
  );
}
