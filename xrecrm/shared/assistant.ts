import { callFacts } from "./communications";
export type AssistantActionKind =
  | "lead"
  | "task"
  | "activity"
  | "note"
  | "contact"
  | "company"
  | "rule"
  | "message"
  | "call";

export type AssistantActionOperation = "create" | "update";

export interface AssistantAction {
  id: string;
  kind: AssistantActionKind;
  operation: AssistantActionOperation;
  recordId?: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface AssistantSource {
  kind: string;
  id: string;
  label: string;
  path?: string;
}

export interface AssistantHistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  actions?: AssistantAction[];
  report?: ReportSnapshot;
  /** Stored internally to make client retries idempotent; not required in API responses. */
  clientMessageId?: string;
  sources?: AssistantSource[];
}

export interface AssistantDateRange {
  from: string;
  to: string;
}

export interface AssistantContext {
  path: string;
  leadId?: string;
}

export interface AssistantInput {
  message: string;
  history: Array<Pick<AssistantHistoryMessage, "role" | "content">>;
  context: AssistantContext;
  dateRange?: AssistantDateRange;
  clientMessageId?: string;
}

export interface ReportMetric {
  key: string;
  label: string;
  value: number;
  unit?: string;
}

export interface ReportSnapshot {
  title: string;
  from: string;
  to: string;
  generatedAt: string;
  metrics: ReportMetric[];
  overview?: string;
  breakdown?: Record<string, unknown>;
  dataLimits: string[];
}

export interface AssistantResponse {
  answer: string;
  actions: AssistantAction[];
  report?: ReportSnapshot;
  model?: string;
  mode: "live" | "demo";
  sources: AssistantSource[];
  generatedAt: string;
}

/**
 * Deliberately broad, JSON-only state shape.  The server adapts its domain
 * models to this shape so this shared module remains free of React/server
 * imports and can also be used by a local demo client.
 */
export interface AssistantReportState {
  leads?: readonly unknown[];
  rules?: readonly unknown[];
  messages?: readonly unknown[];
  calls?: readonly unknown[];
  events?: readonly unknown[];
  contacts?: readonly unknown[];
  companies?: readonly unknown[];
  tasks?: readonly unknown[];
  activities?: readonly unknown[];
  feed?: readonly unknown[];
  members?: readonly unknown[];
  dataLimits?: readonly string[];
}

export interface DemoAssistantResponseInput {
  message: string;
  state: AssistantReportState;
  context?: AssistantContext;
  dateRange?: AssistantDateRange;
  history?: Array<Pick<AssistantHistoryMessage, "role" | "content">>;
  now?: Date;
}

const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringValue(value: unknown, key: string): string {
  const result = objectValue(value, key);
  return typeof result === "string" ? result : "";
}

function arrayValue(
  state: AssistantReportState,
  key: keyof AssistantReportState,
): readonly unknown[] {
  const result = state[key];
  return Array.isArray(result) ? result : [];
}

function dateOnlyMs(value: string): number | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null;
  return utc - TURKEY_OFFSET_MS;
}

export interface AssistantDateBounds {
  fromMs: number;
  toExclusiveMs: number;
  days: number;
}

/** Validate YYYY-MM-DD range using fixed Turkey UTC+3 calendar boundaries. */
export function assistantDateRangeBounds(
  range: AssistantDateRange,
): AssistantDateBounds {
  if (!DATE_ONLY.test(range.from) || !DATE_ONLY.test(range.to))
    throw new Error("Tarih aralığı YYYY-MM-DD biçiminde olmalı.");
  const fromMs = dateOnlyMs(range.from);
  const toStartMs = dateOnlyMs(range.to);
  if (fromMs === null || toStartMs === null || toStartMs < fromMs)
    throw new Error("Tarih aralığı geçersiz.");
  const days = Math.floor((toStartMs - fromMs) / 86_400_000) + 1;
  if (days > 366) throw new Error("Tarih aralığı en fazla 366 gün olabilir.");
  return { fromMs, toExclusiveMs: toStartMs + 86_400_000, days };
}

export function normalizeAssistantDateRange(
  range: AssistantDateRange,
): AssistantDateRange {
  assistantDateRangeBounds(range);
  return { from: range.from, to: range.to };
}

function certainTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const dateOnly = dateOnlyMs(value.trim());
  if (dateOnly !== null) return dateOnly;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function turkeyDateKey(timestamp: number): string {
  const date = new Date(timestamp + TURKEY_OFFSET_MS);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) =>
      index === 0 ? String(part) : String(part).padStart(2, "0"),
    )
    .join("-");
}

function inRange(
  timestamp: number | null,
  bounds: AssistantDateBounds,
): boolean {
  return (
    timestamp !== null &&
    timestamp >= bounds.fromMs &&
    timestamp < bounds.toExclusiveMs
  );
}

function eventPayload(event: unknown): Record<string, unknown> {
  const payload = objectValue(event, "payload");
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function eventType(event: unknown): string {
  const payload = eventPayload(event);
  return stringValue(payload, "type") || stringValue(event, "type");
}

function eventTimestamp(event: unknown): number | null {
  const payload = eventPayload(event);
  return certainTimestamp(
    stringValue(payload, "createdAt") ||
      stringValue(event, "createdAt") ||
      stringValue(event, "updatedAt"),
  );
}

function incrementDaily(
  daily: Record<string, Record<string, number>>,
  timestamp: number,
  key: string,
): void {
  const day = turkeyDateKey(timestamp);
  daily[day] ||= {};
  daily[day][key] = (daily[day][key] || 0) + 1;
}

function metric(key: string, label: string, value: number): ReportMetric {
  return { key, label, value, unit: "count" };
}

/**
 * Build a deterministic report. Historical counters are only incremented when
 * the source row has a usable timestamp inside the requested Turkey-time
 * range. Current pipeline counts intentionally remain a state snapshot.
 */
export function buildReport(
  sourceState: AssistantReportState,
  range: AssistantDateRange,
  now: Date = new Date(),
): ReportSnapshot {
  const bounds = assistantDateRangeBounds(range);
  const generated = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(generated.getTime()))
    throw new Error("Rapor zamanı geçersiz.");

  const leads = arrayValue(sourceState, "leads");
  const messages = arrayValue(sourceState, "messages");
  const calls = arrayValue(sourceState, "calls");
  const tasks = arrayValue(sourceState, "tasks");
  const activities = arrayValue(sourceState, "activities");
  const events = arrayValue(sourceState, "events");
  const daily: Record<string, Record<string, number>> = {};
  const limits = [...(sourceState.dataLimits || [])];
  let newLeads = 0;
  let inboundMessages = 0;
  let outboundMessages = 0;
  let callsInRange = 0;
  let incomingCalls = 0,
    outgoingCalls = 0,
    connectedCalls = 0,
    successfulCalls = 0,
    failedCalls = 0,
    unknownOutcomeCalls = 0,
    unknownDirectionCalls = 0,
    createdMeetings = 0,
    completedMeetings = 0;
  let tasksCompleted = 0;
  let activitiesInRange = 0;
  let stageChanges = 0;
  let wonInRange = 0;
  let stageHistoryAvailable = false;
  let missingLeadTimestamps = 0;
  let missingMessageTimestamps = 0;
  let missingCallTimestamps = 0;
  let missingCompletedTaskTimestamps = 0;
  let missingActivityTimestamps = 0;
  let missingStageChangeTimestamps = 0;
  let unknownMessageDirections = 0;

  for (const lead of leads) {
    const timestamp = certainTimestamp(stringValue(lead, "createdAt"));
    if (timestamp === null) missingLeadTimestamps += 1;
    if (inRange(timestamp, bounds)) {
      newLeads += 1;
      incrementDaily(daily, timestamp!, "newLeads");
    }
  }

  for (const message of messages) {
    const timestamp = certainTimestamp(stringValue(message, "createdAt"));
    if (timestamp === null) missingMessageTimestamps += 1;
    if (!inRange(timestamp, bounds)) continue;
    const direction = stringValue(message, "direction").toLowerCase();
    if (direction === "in" || direction === "inbound") {
      inboundMessages += 1;
      incrementDaily(daily, timestamp!, "inboundMessages");
    } else if (direction === "out" || direction === "outbound") {
      outboundMessages += 1;
      incrementDaily(daily, timestamp!, "outboundMessages");
    } else {
      unknownMessageDirections += 1;
    }
  }

  for (const call of calls) {
    const timestamp = certainTimestamp(stringValue(call, "createdAt"));
    if (timestamp === null) missingCallTimestamps += 1;
    if (!inRange(timestamp, bounds)) continue;
    callsInRange += 1;
    const f = callFacts(call);
    if (f.direction === "inbound") incomingCalls++;
    else if (f.direction === "outbound") outgoingCalls++;
    else unknownDirectionCalls++;
    if (f.connected) connectedCalls++;
    if (f.outcome === "success") successfulCalls++;
    else if (f.outcome === "failed") failedCalls++;
    else unknownOutcomeCalls++;
    incrementDaily(daily, timestamp!, "calls");
  }

  for (const task of tasks) {
    if (stringValue(task, "status").toLowerCase() !== "done") continue;
    const timestamp = certainTimestamp(
      stringValue(task, "completedAt") ||
        stringValue(task, "doneAt") ||
        stringValue(task, "updatedAt"),
    );
    if (timestamp === null) missingCompletedTaskTimestamps += 1;
    if (!inRange(timestamp, bounds)) continue;
    tasksCompleted += 1;
    incrementDaily(daily, timestamp!, "tasksCompleted");
  }

  for (const activity of activities) {
    if (objectValue(activity, "cancelled") === true) continue;
    if (stringValue(activity, "type") === "meeting") {
      if (inRange(certainTimestamp(stringValue(activity, "createdAt")), bounds))
        createdMeetings++;
      if (
        objectValue(activity, "completed") === true &&
        inRange(
          certainTimestamp(
            stringValue(activity, "completedAt") ||
              stringValue(activity, "updatedAt"),
          ),
          bounds,
        )
      )
        completedMeetings++;
    }
    const timestamp = certainTimestamp(
      stringValue(activity, "completedAt") ||
        stringValue(activity, "startAt") ||
        stringValue(activity, "createdAt"),
    );
    if (timestamp === null) missingActivityTimestamps += 1;
    if (!inRange(timestamp, bounds)) continue;
    activitiesInRange += 1;
    incrementDaily(daily, timestamp!, "activities");
  }

  for (const event of events) {
    if (eventType(event) !== "stage-change") continue;
    const timestamp = eventTimestamp(event);
    if (timestamp === null) {
      missingStageChangeTimestamps += 1;
      continue;
    }
    stageHistoryAvailable = true;
    if (!inRange(timestamp, bounds)) continue;
    stageChanges += 1;
    incrementDaily(daily, timestamp!, "stageChanges");
    const payload = eventPayload(event);
    if (stringValue(payload, "toStage") === "won") {
      wonInRange += 1;
      incrementDaily(daily, timestamp!, "won");
    }
  }

  const currentOpen = leads.filter(
    (lead) => !["won", "lost"].includes(stringValue(lead, "stage")),
  ).length;
  const currentWon = leads.filter(
    (lead) => stringValue(lead, "stage") === "won",
  ).length;
  const currentLost = leads.filter(
    (lead) => stringValue(lead, "stage") === "lost",
  ).length;
  if (!stageHistoryAvailable)
    limits.push(
      "Aşama değişikliği geçmişi yok; dönemsel kazanım ve günlük kazanım sayısı hesaplanmadı.",
    );
  limits.push(
    "Açık/kazanılan/kaybedilen pipeline sayıları tarih aralığı değil, rapor anındaki mevcut durum snapshot'ıdır.",
  );
  if (missingLeadTimestamps)
    limits.push(
      `${missingLeadTimestamps} lead kaydında geçerli oluşturulma zamanı yok; bu kayıtlar dönemsel yeni lead sayısına dahil edilmedi.`,
    );
  if (missingMessageTimestamps)
    limits.push(
      `${missingMessageTimestamps} mesaj kaydında geçerli oluşturulma zamanı yok; bu kayıtlar dönemsel mesaj sayısına dahil edilmedi.`,
    );
  if (missingCallTimestamps)
    limits.push(
      `${missingCallTimestamps} arama kaydında geçerli oluşturulma zamanı yok; bu kayıtlar dönemsel arama sayısına dahil edilmedi.`,
    );
  if (missingCompletedTaskTimestamps)
    limits.push(
      `${missingCompletedTaskTimestamps} tamamlanmış görevde geçerli tamamlanma zamanı yok; bu görevler dönemsel tamamlanan görev sayısına dahil edilmedi.`,
    );
  if (missingActivityTimestamps)
    limits.push(
      `${missingActivityTimestamps} aktivite kaydında geçerli zaman yok; bu kayıtlar dönemsel aktivite sayısına dahil edilmedi.`,
    );
  if (missingStageChangeTimestamps)
    limits.push(
      `${missingStageChangeTimestamps} aşama değişikliği olayında geçerli zaman yok; bu olaylar dönemsel aşama değişikliği ve kazanım sayısına dahil edilmedi.`,
    );
  if (unknownMessageDirections)
    limits.push(
      `${unknownMessageDirections} mesaj kaydının yönü bilinmiyor; yalnızca açıkça in/inbound ve out/outbound yönleri sayıldı.`,
    );
  if (
    tasks.some(
      (task) =>
        stringValue(task, "status").toLowerCase() === "done" &&
        !stringValue(task, "completedAt") &&
        !stringValue(task, "doneAt"),
    )
  )
    limits.push(
      "Tamamlanma zamanı olmayan görevlerde güncellenme zamanı kullanıldı.",
    );

  if (unknownOutcomeCalls)
    limits.push(
      `${unknownOutcomeCalls} aramada doğrulanmış başarı sonucu yok; ended durumu tek başına başarılı sayılmadı.`,
    );
  if (unknownDirectionCalls)
    limits.push(
      `${unknownDirectionCalls} aramada gelen/giden yön bilgisi eksik.`,
    );
  limits.push(
    "Müşteriyle görüşün etkinlikleri planlama kayıtlarıdır; gerçekleşmiş telefon çağrısıyla aynı şey değildir.",
  );
  const metrics: ReportMetric[] = [
    metric("newLeads", "Yeni lead", newLeads),
    metric("stageChanges", "Aşama değişikliği", stageChanges),
    metric("inboundMessages", "Gelen mesaj", inboundMessages),
    metric("outboundMessages", "Giden mesaj", outboundMessages),
    metric("calls", "Arama kaydı", callsInRange),
    metric("incomingCalls", "Gelen arama", incomingCalls),
    metric("outgoingCalls", "Giden arama", outgoingCalls),
    metric("connectedCalls", "Bağlantısı doğrulanan arama", connectedCalls),
    metric("successfulCalls", "Başarısı doğrulanan arama", successfulCalls),
    metric("failedCalls", "Başarısız arama", failedCalls),
    metric(
      "unknownOutcomeCalls",
      "Sonucu bilinmeyen arama",
      unknownOutcomeCalls,
    ),
    metric("createdMeetings", "Oluşturulan görüşün etkinliği", createdMeetings),
    metric(
      "completedMeetings",
      "Tamamlanan görüşün etkinliği",
      completedMeetings,
    ),
    metric("tasksCompleted", "Tamamlanan görev", tasksCompleted),
    metric("activities", "Aktivite", activitiesInRange),
    metric("pipelineOpen", "Açık pipeline (mevcut)", currentOpen),
    metric("pipelineWon", "Kazanılan pipeline (mevcut)", currentWon),
    metric("pipelineLost", "Kaybedilen pipeline (mevcut)", currentLost),
  ];
  if (stageHistoryAvailable)
    metrics.push(metric("wonInRange", "Dönemde kazanılan", wonInRange));

  return {
    title: "CRM faaliyet raporu",
    from: range.from,
    to: range.to,
    generatedAt: generated.toISOString(),
    metrics,
    overview: `${range.from} – ${range.to} döneminde ${newLeads} yeni lead, ${inboundMessages} gelen ve ${outboundMessages} giden mesaj kaydı bulundu. Pipeline mevcut durumunda ${currentOpen} açık, ${currentWon} kazanılan ve ${currentLost} kaybedilen lead var.`,
    breakdown: {
      daily,
      pipeline: { open: currentOpen, won: currentWon, lost: currentLost },
    },
    dataLimits: [...new Set(limits)],
  };
}

function firstLead(
  state: AssistantReportState,
  leadId?: string,
): Record<string, unknown> | null {
  const rows = arrayValue(state, "leads");
  const selected = leadId
    ? rows.find((row) => stringValue(row, "id") === leadId)
    : undefined;
  const value = selected || rows[0];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceForLead(
  lead: Record<string, unknown> | null,
): AssistantSource[] {
  if (!lead) return [];
  const id = stringValue(lead, "id");
  if (!id) return [];
  return [
    {
      kind: "lead",
      id,
      label: stringValue(lead, "name") || id,
      path: `/leads/${encodeURIComponent(id)}`,
    },
  ];
}

/** A deterministic, explicitly marked local mode for previews/offline UI work. */
export function makeDemoAssistantResponse(
  input: DemoAssistantResponseInput,
): AssistantResponse {
  const generatedAt = (input.now || new Date()).toISOString();
  const lead = firstLead(input.state, input.context?.leadId);
  const lower = input.message.toLocaleLowerCase("tr-TR");
  const report = input.dateRange
    ? buildReport(input.state, input.dateRange, input.now || new Date())
    : undefined;
  const sources = sourceForLead(lead);
  const actions: AssistantAction[] = [];
  let answer = "Bu, CRM verilerini değiştirmeyen yerel demo yanıtıdır.";

  if (report) {
    const newLeads =
      report.metrics.find((item) => item.key === "newLeads")?.value || 0;
    const calls =
      report.metrics.find((item) => item.key === "calls")?.value || 0;
    answer += ` ${report.from}–${report.to} aralığında ${newLeads} yeni lead ve ${calls} arama kaydı var.`;
  } else if (lead) {
    answer += ` Seçili lead: ${stringValue(lead, "name") || stringValue(lead, "id")} (${stringValue(lead, "stage") || "aşama bilgisi yok"}).`;
  } else {
    answer +=
      " Canlı sağlayıcı bağlı olmadığından yalnızca örnek yanıt üretebilirim.";
  }

  const explicitTask = input.message.match(
    /(?:görev|task)\s*[:\-]\s*[“"]([^”"]+)[”"]/i,
  );
  if (lower.includes("görev") || lower.includes("task")) {
    if (explicitTask) {
      actions.push({
        id: globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}`,
        kind: "task",
        operation: "create",
        summary: `Demo görev önerisi: ${explicitTask[1]}`,
        payload: {
          title: explicitTask[1],
          ...(lead ? { leadId: stringValue(lead, "id") } : {}),
        },
      });
      answer +=
        " Görev adı açıkça verildi; assignee ve dueAt bilgisi verilmediği için bunları istemeden kayıt önermiyorum.";
    } else {
      answer +=
        " Görev önermek için başlık, assignee ve dueAt bilgilerini açıkça belirtin.";
    }
  }

  return {
    answer,
    actions,
    ...(report ? { report } : {}),
    mode: "demo",
    sources,
    generatedAt,
  };
}

export type AssistantMessage = AssistantHistoryMessage;

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

/** Export either a response (including its answer) or a bare report as Markdown. */
export function reportToMarkdown(
  input: AssistantResponse | ReportSnapshot,
): string {
  const isResponse = "answer" in input;
  const report = isResponse ? input.report : input;
  const lines: string[] = [];
  if (isResponse && input.answer) lines.push(input.answer, "");
  if (!report) return lines.join("\n");
  lines.push(
    `# ${report.title}`,
    "",
    `**Dönem:** ${report.from} – ${report.to}`,
    `**Oluşturulma:** ${report.generatedAt}`,
    "",
  );
  if (report.overview) lines.push(report.overview, "");
  lines.push(
    "| Metrik | Değer | Birim |",
    "| --- | ---: | --- |",
    ...report.metrics.map(
      (item) =>
        `| ${markdownCell(item.label)} | ${markdownCell(item.value)} | ${markdownCell(item.unit || "")} |`,
    ),
    "",
  );
  const daily = report.breakdown?.daily;
  if (daily && typeof daily === "object") {
    lines.push(
      "## Günlük kırılım",
      "",
      "```json",
      JSON.stringify(daily, null, 2),
      "```",
      "",
    );
  }
  if (report.dataLimits.length) {
    lines.push(
      "## Veri sınırları",
      "",
      ...report.dataLimits.map((item) => `- ${item}`),
      "",
    );
  }
  return lines.join("\n").trim() + "\n";
}
