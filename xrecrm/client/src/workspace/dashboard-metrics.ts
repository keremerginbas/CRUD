// Genel bakış ekranının saf (test edilebilir) metrik hesapları.
// Tüm gün sınırları Türkiye saatine (Europe/Istanbul) göredir.
import type { AppState, Lead } from "./data";

export type Period = "today" | "7d" | "30d";
export const periodLabels: Record<Period, string> = {
  today: "Bugün",
  "7d": "7 gün",
  "30d": "30 gün",
};
const periodDays: Record<Period, number> = { today: 1, "7d": 7, "30d": 30 };

const TZ = "Europe/Istanbul";
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const dayKey = (value: string | number | Date) =>
  dayFormatter.format(new Date(value));
const time = (value: unknown) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isNaN(parsed) ? NaN : parsed;
};
const DAY = 86_400_000;

/** Son `days` günün anahtarları (en eski → bugün). */
export function dayKeys(days: number, nowMs = Date.now()): string[] {
  return Array.from({ length: days }, (_, i) =>
    dayKey(nowMs - (days - 1 - i) * DAY),
  );
}

function inWindow(value: unknown, keys: Set<string>) {
  const t = time(value);
  return !Number.isNaN(t) && keys.has(dayKey(t));
}

const isOpen = (lead: Lead) => lead.stage !== "won" && lead.stage !== "lost";
const isMissed = (call: any) =>
  call?.status === "missed" ||
  /no-?answer|busy|missed|cancel/i.test(String(call?.endedReason || ""));
const isAnswered = (call: any) =>
  !isMissed(call) && ["ended", "completed", "answered"].includes(String(call?.status));
const inbound = (direction: unknown) =>
  direction === "inbound" || direction === "in";

export interface DashboardMetrics {
  period: Period;
  kpis: {
    newLeads: number;
    newLeadsPrev: number;
    openValue: number;
    openCount: number;
    wonCount: number;
    wonValue: number;
    conversion: number;
    calls: number;
    callsAnswered: number;
    callsMissed: number;
    messagesIn: number;
    messagesOut: number;
    overdueTasks: number;
    openTasks: number;
  };
  trend: { key: string; name: string; leads: number; won: number; calls: number; messages: number }[];
  agenda: {
    id: string;
    kind: "activity" | "task" | "appointment";
    title: string;
    at: string;
    leadId?: string;
    overdue: boolean;
    type?: string;
  }[];
  attention: {
    missedCalls: { id: string; leadId?: string; phone?: string; at: string }[];
    unansweredChats: { leadId: string; text: string; at: string }[];
    idleLeads: Lead[];
  };
  owners: {
    owner: string;
    open: number;
    won: number;
    wonValue: number;
    newLeads: number;
    overdue: number;
    calls: number;
  }[];
  sources: { source: string; count: number }[];
}

export function computeDashboard(
  data: Pick<AppState, "leads" | "messages" | "calls" | "tasks" | "activities">,
  period: Period,
  nowMs = Date.now(),
): DashboardMetrics {
  const days = periodDays[period];
  const current = new Set(dayKeys(days, nowMs));
  const previous = new Set(dayKeys(days * 2, nowMs).slice(0, days));
  const today = dayKey(nowMs);
  const leads = data.leads || [];
  const calls = data.calls || [];
  const messages = data.messages || [];
  const tasks = data.tasks || [];
  const activities = (data.activities || []).filter((a) => !a.cancelled);

  const newLeads = leads.filter((l) => inWindow(l.createdAt, current));
  // Kazanılma tarihi ayrıca tutulmadığı için son hareket tarihi kullanılır.
  const won = leads.filter((l) => l.stage === "won" && inWindow(l.lastActivity, current));
  const periodCalls = calls.filter((c) => inWindow(c.startedAt || c.createdAt, current));
  const periodMessages = messages.filter((m) => inWindow(m.createdAt, current));
  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdueTasks = openTasks.filter((t) => t.dueAt && time(t.dueAt) < nowMs);
  const open = leads.filter(isOpen);

  const trendKeys = dayKeys(period === "today" ? 7 : days, nowMs);
  const shortDay = new Intl.DateTimeFormat("tr-TR", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
  });
  const trend = trendKeys.map((key) => {
    const match = (v: unknown) => !Number.isNaN(time(v)) && dayKey(time(v)) === key;
    return {
      key,
      name: shortDay.format(new Date(`${key}T12:00:00+03:00`)),
      leads: leads.filter((l) => match(l.createdAt)).length,
      won: leads.filter((l) => l.stage === "won" && match(l.lastActivity)).length,
      calls: calls.filter((c) => match(c.startedAt || c.createdAt)).length,
      messages: messages.filter((m) => match(m.createdAt)).length,
    };
  });

  const agenda: DashboardMetrics["agenda"] = [
    ...activities
      .filter((a) => !a.completed && (dayKey(time(a.startAt)) === today || time(a.startAt) < nowMs))
      .map((a) => ({
        id: a.id,
        kind: "activity" as const,
        title: a.title,
        at: a.startAt,
        leadId: a.leadId || undefined,
        overdue: time(a.endAt || a.startAt) < nowMs,
        type: a.type,
      })),
    ...openTasks
      .filter((t) => t.dueAt && (dayKey(time(t.dueAt)) === today || time(t.dueAt) < nowMs))
      .map((t) => ({
        id: t.id,
        kind: "task" as const,
        title: t.title,
        at: t.dueAt,
        leadId: t.leadId || undefined,
        overdue: time(t.dueAt) < nowMs,
      })),
    ...leads
      .filter((l) => l.appointmentAt && dayKey(time(l.appointmentAt)) === today)
      .filter((l) => !activities.some((a) => a.appointmentLinked && a.leadId === l.id))
      .map((l) => ({
        id: `appt-${l.id}`,
        kind: "appointment" as const,
        title: `Randevu · ${l.name}`,
        at: l.appointmentAt!,
        leadId: l.id,
        overdue: time(l.appointmentAt) < nowMs,
      })),
  ].sort((a, b) => time(a.at) - time(b.at));

  // Cevapsız aramalar: son 7 günde, sonrasında aynı müşteriye giden arama/mesaj yoksa.
  const week = nowMs - 7 * DAY;
  const missedCalls = calls
    .filter((c) => isMissed(c) && time(c.startedAt || c.createdAt) >= week)
    .filter((c) => {
      const at = time(c.startedAt || c.createdAt);
      if (!c.leadId) return true;
      return !calls.some(
        (o) => o.leadId === c.leadId && o.direction === "outbound" && time(o.startedAt || o.createdAt) > at,
      ) && !messages.some(
        (m) => m.leadId === c.leadId && !inbound(m.direction) && time(m.createdAt) > at,
      );
    })
    .map((c) => ({ id: String(c.id), leadId: c.leadId || undefined, phone: c.phone, at: String(c.startedAt || c.createdAt) }))
    .sort((a, b) => time(b.at) - time(a.at));

  // Yanıt bekleyen konuşmalar: müşterinin son mesajı gelen yönlüyse.
  const lastByLead = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (!m.leadId) continue;
    const prev = lastByLead.get(m.leadId);
    if (!prev || time(m.createdAt) >= time(prev.createdAt)) lastByLead.set(m.leadId, m);
  }
  const unansweredChats = [...lastByLead.values()]
    .filter((m) => inbound(m.direction))
    .map((m) => ({ leadId: m.leadId, text: m.text, at: m.createdAt }))
    .sort((a, b) => time(b.at) - time(a.at));

  // Bitrix "etkinlik yok" uyarısı: açık fırsat ama planlı iş yok.
  const idleLeads = open.filter(
    (l) =>
      !activities.some((a) => a.leadId === l.id && !a.completed) &&
      !openTasks.some((t) => t.leadId === l.id),
  );

  const ownerNames = [...new Set(leads.map((l) => l.owner || "Atanmamış"))];
  const owners = ownerNames
    .map((owner) => {
      const mine = leads.filter((l) => (l.owner || "Atanmamış") === owner);
      const ids = new Set(mine.map((l) => l.id));
      const wonMine = mine.filter((l) => won.includes(l));
      return {
        owner,
        open: mine.filter(isOpen).length,
        won: wonMine.length,
        wonValue: wonMine.reduce((s, l) => s + (l.value || 0), 0),
        newLeads: mine.filter((l) => newLeads.includes(l)).length,
        overdue: overdueTasks.filter((t) => t.assignee === owner || (t.leadId && ids.has(t.leadId))).length,
        calls: periodCalls.filter((c) => c.leadId && ids.has(c.leadId)).length,
      };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.open - a.open);

  const sourceCounts = new Map<string, number>();
  for (const l of newLeads.length ? newLeads : open)
    sourceCounts.set(l.source || "Belirtilmemiş", (sourceCounts.get(l.source || "Belirtilmemiş") || 0) + 1);
  const sources = [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  const closedInPeriod = leads.filter(
    (l) => (l.stage === "won" || l.stage === "lost") && inWindow(l.lastActivity, current),
  ).length;

  return {
    period,
    kpis: {
      newLeads: newLeads.length,
      newLeadsPrev: leads.filter((l) => inWindow(l.createdAt, previous)).length,
      openValue: open.reduce((s, l) => s + (l.value || 0), 0),
      openCount: open.length,
      wonCount: won.length,
      wonValue: won.reduce((s, l) => s + (l.value || 0), 0),
      conversion: closedInPeriod ? Math.round((won.length / closedInPeriod) * 100) : 0,
      calls: periodCalls.length,
      callsAnswered: periodCalls.filter(isAnswered).length,
      callsMissed: periodCalls.filter(isMissed).length,
      messagesIn: periodMessages.filter((m) => inbound(m.direction)).length,
      messagesOut: periodMessages.filter((m) => !inbound(m.direction)).length,
      overdueTasks: overdueTasks.length,
      openTasks: openTasks.length,
    },
    trend,
    agenda,
    attention: { missedCalls, unansweredChats, idleLeads },
    owners,
    sources,
  };
}
