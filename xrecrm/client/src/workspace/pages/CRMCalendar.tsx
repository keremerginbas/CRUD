import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  Plus,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import {
  istanbulDateKey,
  istanbulDateTimeLabel,
  istanbulTimeLabel,
  CRM_TIME_ZONE,
} from "../../../../shared/crm-activities";
import type { Lead } from "../data";
import type { Activity, Task } from "../suite";
import { useStore } from "../store";
import { ActivityEditor, TaskEditor } from "./Work";
import { Empty } from "../components/ui";

type CalendarItem =
  | { kind: "activity"; record: Activity; date: string; lead?: Lead }
  | { kind: "task"; record: Task; date: string; lead?: Lead };

type EditorState = {
  activity?: Activity;
  task?: Task;
  leadId?: string;
  date?: Date;
};

export type CRMCalendarProps = {
  leads?: Lead[];
  pipeline?: string;
  query?: string;
  owner?: string;
  source?: string;
  onLead?: (lead: Lead) => void;
  onMessage?: (id: string) => void;
  navigate?: (path: string) => void;
  onActivity?: (leadId?: string, date?: Date) => void;
  onEditActivity?: (activity: Activity) => void;
  onEditTask?: (task: Task) => void;
};

const localParts = (key: string) => key.split("-").map(Number);
const keyForDay = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const atNoon = (key: string) => new Date(`${key}T12:00:00+03:00`);
const isWithin = (
  lead: Lead,
  query: string,
  owner: string,
  source: string,
  pipeline: string,
) =>
  (pipeline === "all" || (lead.pipelineId || "sales") === pipeline) &&
  (owner === "all" || !owner || lead.owner === owner) &&
  (source === "all" || !source || lead.source === source) &&
  `${lead.name} ${lead.dealTitle || ""} ${lead.company} ${lead.phone}`
    .toLocaleLowerCase("tr")
    .includes(query.toLocaleLowerCase("tr"));

export default function CRMCalendar({
  leads: suppliedLeads,
  pipeline = "all",
  query = "",
  owner = "all",
  source = "all",
  onLead,
  onMessage,
  navigate,
  onActivity,
  onEditActivity,
  onEditTask,
}: CRMCalendarProps) {
  const { data, saveRecord } = useStore();
  const todayKey = istanbulDateKey(new Date());
  const todayParts = localParts(todayKey);
  const [month, setMonth] = useState({
    year: todayParts[0],
    month: todayParts[1] - 1,
  });
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const leads = useMemo(
    () =>
      (suppliedLeads || data.leads).filter((lead) =>
        isWithin(lead, query, owner, source, pipeline),
      ),
    [data.leads, owner, pipeline, query, source, suppliedLeads],
  );
  const leadIds = useMemo(() => new Set(leads.map((lead) => lead.id)), [leads]);
  const leadById = useMemo(
    () => new Map(leads.map((lead) => [lead.id, lead])),
    [leads],
  );
  const items = useMemo<CalendarItem[]>(
    () =>
      [
        ...data.activities
          .filter(
            (activity) =>
              !activity.cancelled &&
              !!activity.startAt &&
              Number.isFinite(Date.parse(activity.startAt)) &&
              leadIds.has(activity.leadId),
          )
          .map((activity) => ({
            kind: "activity" as const,
            record: activity,
            date: activity.startAt,
            lead: leadById.get(activity.leadId),
          })),
        ...data.tasks
          .filter(
            (task) =>
              !!task.dueAt &&
              Number.isFinite(Date.parse(task.dueAt)) &&
              leadIds.has(task.leadId),
          )
          .map((task) => ({
            kind: "task" as const,
            record: task,
            date: task.dueAt,
            lead: leadById.get(task.leadId),
          })),
      ].sort((left, right) => Date.parse(left.date) - Date.parse(right.date)),
    [data.activities, data.tasks, leadById, leadIds],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    items.forEach((item) => {
      const key = istanbulDateKey(item.date);
      map.set(key, [...(map.get(key) || []), item]);
    });
    return map;
  }, [items]);
  const firstDay = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
  const mondayOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(month.year, month.month + 1, 0),
  ).getUTCDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - mondayOffset + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const selectedItems = byDay.get(selectedKey) || [];
  const changeMonth = (amount: number) => {
    const date = new Date(Date.UTC(month.year, month.month + amount, 1));
    setMonth({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
  };
  const addActivity = (leadId?: string, date = atNoon(selectedKey)) =>
    onActivity ? onActivity(leadId, date) : setEditor({ leadId, date });
  const editItem = (item: CalendarItem) => {
    if (item.kind === "activity") {
      if (onEditActivity) onEditActivity(item.record);
      else setEditor({ activity: item.record });
    } else if (onEditTask) onEditTask(item.record);
    else setEditor({ task: item.record });
  };
  const toggle = async (item: CalendarItem) => {
    try {
      if (item.kind === "activity") {
        await saveRecord("activities", {
          ...item.record,
          completed: !item.record.completed,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await saveRecord("tasks", {
          ...item.record,
          status: item.record.status === "done" ? "todo" : "done",
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const onlineMeeting = (leadId?: string) => {
    if (!leadId || typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("xre:meeting", { detail: { leadId } }),
    );
  };
  const monthLabel = new Date(
    Date.UTC(month.year, month.month, 15),
  ).toLocaleDateString("tr-TR", {
    month: "long",
    year: "numeric",
    timeZone: CRM_TIME_ZONE,
  });

  return (
    <section className="crm-calendar-view" aria-label="CRM takvimi">
      <div className="crm-calendar-layout">
        <section className="panel crm-calendar-panel">
          <header className="crm-calendar-head">
            <button
              type="button"
              className="icon-button"
              aria-label="Önceki ay"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={17} />
            </button>
            <h2>{monthLabel}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Sonraki ay"
              onClick={() => changeMonth(1)}
            >
              <ChevronRight size={17} />
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setMonth({ year: todayParts[0], month: todayParts[1] - 1 });
                setSelectedKey(todayKey);
              }}
            >
              Bugün
            </button>
          </header>
          <div className="crm-calendar-weekdays">
            {["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="crm-calendar-grid">
            {cells.map((day, index) => {
              if (!day)
                return (
                  <span className="crm-calendar-empty" key={`empty-${index}`} />
                );
              const key = keyForDay(month.year, month.month, day);
              const dayItems = byDay.get(key) || [];
              return (
                <button
                  type="button"
                  key={key}
                  className={`crm-calendar-day ${selectedKey === key ? "selected" : ""} ${todayKey === key ? "today" : ""}`}
                  onClick={() => setSelectedKey(key)}
                >
                  <strong>{day}</strong>
                  <div className="crm-calendar-events">
                    {dayItems.slice(0, 4).map((item) => (
                      <span
                        className={`crm-calendar-event ${item.kind}`}
                        key={`${item.kind}-${item.record.id}`}
                      >
                        <b>{item.lead?.name || "Müşteri"}</b> ·{" "}
                        {istanbulTimeLabel(item.date)}
                      </span>
                    ))}
                    {dayItems.length > 4 && (
                      <small>+{dayItems.length - 4} kayıt</small>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="crm-calendar-legend">
            <span>
              <i className="activity" /> Etkinlik
            </span>
            <span>
              <i className="task" /> Görev
            </span>
            <span>
              <CalendarDays size={14} /> {items.length} kayıt
            </span>
          </div>
        </section>
        <aside className="panel crm-calendar-day-detail">
          <header>
            <div>
              <span className="crm-eyebrow">SEÇİLİ GÜN</span>
              <h2>
                {atNoon(selectedKey).toLocaleDateString("tr-TR", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: CRM_TIME_ZONE,
                })}
              </h2>
            </div>
            <button
              type="button"
              className="btn primary small"
              onClick={() => addActivity(undefined, atNoon(selectedKey))}
            >
              <Plus size={14} /> Etkinlik
            </button>
          </header>
          {!selectedItems.length && (
            <Empty
              title="Bu gün boş"
              description="Müşteri etkinliği veya görev ekleyin."
            />
          )}
          <div className="crm-calendar-day-items">
            {selectedItems.map((item) => {
              const completed =
                item.kind === "activity"
                  ? item.record.completed
                  : item.record.status === "done";
              return (
                <article
                  className={`crm-calendar-day-item ${item.kind} ${completed ? "completed" : ""}`}
                  key={`${item.kind}-${item.record.id}`}
                >
                  <button
                    type="button"
                    className="crm-record-check"
                    onClick={() => void toggle(item)}
                    aria-label={`${item.record.title} tamamlanma durumunu değiştir`}
                  >
                    {completed ? <Check size={15} /> : <Square size={15} />}
                  </button>
                  <div className="crm-calendar-day-body">
                    <strong>
                      {item.record.title ||
                        (item.kind === "task" ? "Görev" : "Etkinlik")}
                    </strong>
                    <span>
                      {item.lead?.name || "Müşteri bağlantısı yok"} ·{" "}
                      {istanbulDateTimeLabel(item.date)}
                    </span>
                    {item.kind === "activity" && item.record.description && (
                      <p>{item.record.description}</p>
                    )}
                    {item.kind === "activity" && item.record.meetingUrl && (
                      <a
                        href={item.record.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="crm-linked-lead"
                      >
                        Google Meet’e katıl <ExternalLink size={12} />
                      </a>
                    )}
                    {item.lead && (
                      <button
                        type="button"
                        className="crm-linked-lead"
                        onClick={() => onLead?.(item.lead!)}
                      >
                        {item.lead.name} ↗
                      </button>
                    )}
                  </div>
                  {item.kind === "activity" && item.record.leadId && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`${item.lead?.name || "Müşteri"} için online toplantı planla`}
                      title="Online toplantı"
                      onClick={() => onlineMeeting(item.record.leadId)}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => editItem(item)}
                    aria-label={`${item.record.title} kaydını düzenle`}
                  >
                    <Edit3 size={14} />
                  </button>
                </article>
              );
            })}
          </div>
        </aside>
      </div>
      {editor?.activity && (
        <ActivityEditor
          requireLead
          activity={editor.activity}
          onClose={() => setEditor(null)}
        />
      )}
      {editor && !editor.activity && !editor.task && (
        <ActivityEditor
          requireLead
          leadId={editor.leadId}
          date={editor.date}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.task && (
        <TaskEditor task={editor.task} onClose={() => setEditor(null)} />
      )}
    </section>
  );
}
