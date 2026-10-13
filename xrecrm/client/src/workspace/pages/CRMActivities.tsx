import { useMemo, useState } from "react";
import { Check, Edit3, Plus, Square } from "lucide-react";
import { toast } from "sonner";
import {
  openCount,
  next,
  activityBucket,
  CRM_ACTIVITY_BUCKET_LABELS,
  openRecordsForLead,
  type CrmActivityBucket,
  type CrmOpenRecord,
  istanbulDateTimeLabel,
} from "../../../../shared/crm-activities";
import type { Lead } from "../data";
import type { Activity, Task } from "../suite";
import { useStore } from "../store";
import { ActivityEditor, TaskEditor } from "./Work";
import { CRMContactCard } from "../components/CRMViews";
import { Empty } from "../components/ui";

const bucketOrder: CrmActivityBucket[] = [
  "overdue",
  "today",
  "this-week",
  "next-week",
  "two-weeks",
  "later",
  "none",
];

type EditorState = {
  activity?: Activity;
  task?: Task;
  leadId?: string;
  date?: Date;
};

export type CRMActivitiesProps = {
  leads?: Lead[];
  pipeline?: string;
  query?: string;
  owner?: string;
  source?: string;
  onLead?: (lead: Lead) => void;
  onMessage?: (id: string) => void;
  navigate?: (path: string) => void;
  /** The parent CRM page can own the shared ActivityEditor state. */
  onActivity?: (leadId?: string, date?: Date) => void;
  onEditActivity?: (activity: Activity) => void;
  onEditTask?: (task: Task) => void;
};

const matchesLead = (
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

export default function CRMActivities({
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
}: CRMActivitiesProps) {
  const { data, saveRecord } = useStore();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const leads = useMemo(
    () =>
      (suppliedLeads || data.leads).filter((lead) =>
        matchesLead(lead, query, owner, source, pipeline),
      ),
    [data.leads, owner, pipeline, query, source, suppliedLeads],
  );
  const addActivity = (leadId?: string) =>
    onActivity ? onActivity(leadId) : setEditor({ leadId });
  const editRecord = (record: CrmOpenRecord) => {
    if (record.kind === "activity") {
      if (onEditActivity) onEditActivity(record.record as unknown as Activity);
      else setEditor({ activity: record.record as unknown as Activity });
    } else if (onEditTask) onEditTask(record.record as unknown as Task);
    else setEditor({ task: record.record as unknown as Task });
  };
  const toggleRecord = async (record: CrmOpenRecord) => {
    try {
      if (record.kind === "activity") {
        const activity = record.record as unknown as Activity;
        await saveRecord("activities", {
          ...activity,
          completed: !activity.completed,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const task = record.record as unknown as Task;
        await saveRecord("tasks", {
          ...task,
          status: task.status === "done" ? "todo" : "done",
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const groups = useMemo(() => {
    const grouped = new Map<CrmActivityBucket, Lead[]>();
    bucketOrder.forEach((bucket) => grouped.set(bucket, []));
    leads.forEach((lead) => {
      const record = next(lead.id, data.tasks, data.activities);
      const bucket = activityBucket(record);
      grouped.get(bucket)!.push(lead);
    });
    grouped.forEach((items) =>
      items.sort((left, right) => {
        const leftNext = next(left.id, data.tasks, data.activities);
        const rightNext = next(right.id, data.tasks, data.activities);
        if (leftNext && rightNext) {
          const difference =
            Date.parse(leftNext.date) - Date.parse(rightNext.date);
          if (difference) return difference;
        }
        return left.name.localeCompare(right.name, "tr");
      }),
    );
    return grouped;
  }, [data.activities, data.tasks, leads]);
  const totalOpen = leads.reduce(
    (total, lead) => total + openCount(lead.id, data.tasks, data.activities),
    0,
  );

  return (
    <section className="crm-activities-view" aria-label="CRM etkinlikleri">
      <header className="crm-subview-heading">
        <div>
          <span className="crm-eyebrow">MÜŞTERİ TAKİBİ</span>
          <h2>Etkinlikler</h2>
          <p>
            {totalOpen} açık görev ve etkinlik, en yakın kayda göre sıralanır.
          </p>
        </div>
      </header>
      {!leads.length && (
        <Empty
          title="Müşteri bulunamadı"
          description="Filtreleri temizleyin veya yeni bir müşteri ekleyin."
        />
      )}
      {bucketOrder.map((bucket) => {
        const items = groups.get(bucket)!;
        if (!items.length) return null;
        return (
          <section className={`crm-activity-group ${bucket}`} key={bucket}>
            <header>
              <div>
                <h3>{CRM_ACTIVITY_BUCKET_LABELS[bucket]}</h3>
                <span>{items.length} müşteri</span>
              </div>
              <span className="crm-group-line" />
            </header>
            <div className="crm-activity-cards">
              {items.map((lead) => {
                const record = next(lead.id, data.tasks, data.activities);
                const records = openRecordsForLead(
                  lead.id,
                  data.tasks,
                  data.activities,
                );
                const count = openCount(lead.id, data.tasks, data.activities);
                return (
                  <CRMContactCard
                    key={lead.id}
                    lead={lead}
                    nextRecord={record}
                    openCount={count}
                    onLead={onLead}
                    onMessage={onMessage}
                    onActivity={() => addActivity(lead.id)}
                    navigate={navigate}
                  >
                    {!record &&
                      data.tasks
                        .filter(
                          (t) =>
                            t.leadId === lead.id &&
                            t.status !== "done" &&
                            !t.dueAt,
                        )
                        .map((task) => (
                          <button
                            type="button"
                            className="crm-record-edit"
                            key={task.id}
                            onClick={() =>
                              editRecord({
                                id: task.id,
                                leadId: lead.id,
                                title: task.title,
                                date: "",
                                kind: "task",
                                record: task,
                              })
                            }
                          >
                            {task.title} · Tarih belirlenmedi{" "}
                            <Edit3 size={14} />
                          </button>
                        ))}
                    {record ? (
                      <div className="crm-activity-card-records">
                        {records.map((entry) => (
                          <div
                            className="crm-activity-record-row"
                            key={`${entry.kind}-${entry.id}`}
                          >
                            <button
                              type="button"
                              className="crm-record-check"
                              aria-label={`${entry.title} tamamlanma durumunu değiştir`}
                              onClick={() => void toggleRecord(entry)}
                            >
                              {entry.kind === "activity" &&
                              (entry.record as unknown as Activity)
                                .completed ? (
                                <Check size={14} />
                              ) : entry.kind === "task" &&
                                (entry.record as unknown as Task).status ===
                                  "done" ? (
                                <Check size={14} />
                              ) : (
                                <Square size={14} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="crm-record-edit"
                              onClick={() => editRecord(entry)}
                              aria-label={`${entry.title} kaydını düzenle`}
                            >
                              <span>
                                <strong>{entry.title}</strong>
                                <small>
                                  {entry.kind === "task" ? "Görev" : "Etkinlik"}{" "}
                                  ·{" "}
                                  {new Date(entry.date).toLocaleString("tr-TR")}
                                </small>
                              </span>
                              <Edit3 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="crm-add-activity"
                        onClick={() => addActivity(lead.id)}
                      >
                        <Plus size={14} /> İlk etkinliği planla
                      </button>
                    )}
                  </CRMContactCard>
                );
              })}
            </div>
          </section>
        );
      })}
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
