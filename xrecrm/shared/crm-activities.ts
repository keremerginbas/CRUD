export type CrmActivityRecord = {
  id: string;
  leadId?: string;
  title?: string;
  startAt?: string | null;
  completed?: boolean;
  cancelled?: boolean;
};

export type CrmTaskRecord = {
  id: string;
  leadId?: string;
  title?: string;
  dueAt?: string | null;
  status?: string;
};

export type CrmRecordKind = "task" | "activity";

export type CrmOpenRecord = {
  id: string;
  leadId: string;
  title: string;
  date: string;
  kind: CrmRecordKind;
  record: CrmTaskRecord | CrmActivityRecord;
};

export const CRM_TIME_ZONE = "Europe/Istanbul";

const partsFor = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CRM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
};

/** A calendar date in the CRM's fixed Turkey timezone. */
export function istanbulDateKey(value: Date | string): string {
  const parts = partsFor(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function istanbulDateTimeLabel(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Tarih belirlenmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: CRM_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function istanbulTimeLabel(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Saat yok";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: CRM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const dayNumber = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
};

const dateOf = (value: string | null | undefined) => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

function openRecords(
  leadId: string,
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): CrmOpenRecord[] {
  const taskRecords = tasks
    .filter((task) => task.leadId === leadId && task.status !== "done")
    .flatMap((task) => {
      const date = dateOf(task.dueAt);
      return date
        ? [
            {
              id: task.id,
              leadId,
              title: task.title || "Görev",
              date: date.toISOString(),
              kind: "task" as const,
              record: task,
            },
          ]
        : [];
    });
  const activityRecords = activities
    .filter(
      (activity) =>
        activity.leadId === leadId &&
        !activity.completed &&
        !activity.cancelled,
    )
    .flatMap((activity) => {
      const date = dateOf(activity.startAt);
      return date
        ? [
            {
              id: activity.id,
              leadId,
              title: activity.title || "Etkinlik",
              date: date.toISOString(),
              kind: "activity" as const,
              record: activity,
            },
          ]
        : [];
    });
  return [...taskRecords, ...activityRecords].sort(
    (left, right) => Date.parse(left.date) - Date.parse(right.date),
  );
}

/** Return the closest dated open task/activity for one customer. */
export function next(
  lead: { id: string },
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): CrmOpenRecord | undefined;
export function next(
  leadId: string,
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): CrmOpenRecord | undefined;
export function next(
  leadId: string | { id: string },
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): CrmOpenRecord | undefined {
  return openRecords(
    typeof leadId === "string" ? leadId : leadId.id,
    tasks,
    activities,
  )[0];
}

/** Count every open task/activity, including tasks without a due date. */
export function openCount(
  lead: { id: string },
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): number;
export function openCount(
  leadId: string,
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): number;
export function openCount(
  leadId: string | { id: string },
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): number {
  const id = typeof leadId === "string" ? leadId : leadId.id;
  return (
    tasks.filter((task) => task.leadId === id && task.status !== "done")
      .length +
    activities.filter(
      (activity) =>
        activity.leadId === id && !activity.completed && !activity.cancelled,
    ).length
  );
}

export type CrmActivityBucket =
  | "overdue"
  | "today"
  | "this-week"
  | "next-week"
  | "two-weeks"
  | "later"
  | "none";

export const CRM_ACTIVITY_BUCKET_LABELS: Record<CrmActivityBucket, string> = {
  overdue: "Geciken",
  today: "Son tarihi bugün",
  "this-week": "Bu hafta",
  "next-week": "Gelecek hafta",
  "two-weeks": "İki hafta sonra",
  later: "Daha sonra",
  none: "Etkinlik yok",
};

/** Classify an open record using calendar weeks and exact Istanbul time. */
export function activityBucket(
  record: CrmOpenRecord | undefined,
  now: Date = new Date(),
): CrmActivityBucket {
  if (!record || !record.date) return "none";
  const date = dateOf(record.date);
  if (!date) return "none";
  if (date.getTime() < now.getTime()) return "overdue";

  const today = istanbulDateKey(now);
  const target = istanbulDateKey(date);
  const delta = dayNumber(target) - dayNumber(today);
  if (delta === 0) return "today";

  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const daysUntilNextMonday = weekday === 0 ? 1 : 8 - weekday;
  const nextMonday = daysUntilNextMonday;
  if (delta > 0 && delta < nextMonday) return "this-week";
  if (delta >= nextMonday && delta < nextMonday + 7) return "next-week";
  if (delta >= nextMonday + 7 && delta < nextMonday + 14) return "two-weeks";
  return "later";
}

export function bucketForLead(
  leadId: string,
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
  now: Date = new Date(),
): CrmActivityBucket {
  const record = next(leadId, tasks, activities);
  return record ? activityBucket(record, now) : "none";
}

export function openRecordsForLead(
  leadId: string,
  tasks: readonly CrmTaskRecord[],
  activities: readonly CrmActivityRecord[],
): CrmOpenRecord[] {
  return openRecords(leadId, tasks, activities);
}
