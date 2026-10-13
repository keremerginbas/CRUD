import type { Express, Request } from "express";
import type { Store } from "./db.js";
import { fetchWithTimeout } from "./security.js";
import type { AuthContext } from "./types.js";

const INTEGRATION_KIND = "integration";
const INTEGRATION_ID = "n8n";
const REPORT_KIND = "n8n_report";
const DEFAULT_BASE_URL = "https://xre111.shop";
const API_ROOT = "/api/v1";
const FETCH_TIMEOUT_MS = 8_000;
const REFRESH_DEADLINE_MS = 60_000;
const MAX_CONCURRENCY = 3;
const REFRESH_CONCURRENCY = 1;
const ID_RE = /^[A-Za-z0-9_-]{1,191}$/;
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,200}$/;
const METHOD_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i;
const AUTH_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,63}$/;

/**
 * This is deliberately a small, fixed registry. It is not a user supplied
 * list of n8n resources. The parent application may expose the richer shared
 * registry; this module only needs IDs and display names to build fixed URLs.
 */
const WORKFLOWS = [
  { id: "KWD5Yr7uuz2gMlI5", name: "Bitrix Etkinlik Takibi" },
  { id: "0PIWrbVUIcWf7AiZ", name: "Call Center Performansı" },
  { id: "IDJi8fQoxPxpWU5F", name: "Günlük Arama Raporu" },
  { id: "LD8jlJvE1LBmMeE3", name: "Bitrix Ekip Raporu" },
  { id: "gWKseHEZL96T26iC", name: "XRE Bitrix Assistant v8" },
  { id: "ImTuxSRxDugg33aI", name: "Günlük GROWTH Raporu" },
] as const;

// Keep the known IDs unique even if a future registry edit accidentally repeats one.
const WORKFLOW_MAP = new Map<string, (typeof WORKFLOWS)[number]>();
for (const workflow of WORKFLOWS) WORKFLOW_MAP.set(workflow.id, workflow);
const DEFAULT_WORKFLOW_IDS = [
  "KWD5Yr7uuz2gMlI5",
  "0PIWrbVUIcWf7AiZ",
  "IDJi8fQoxPxpWU5F",
  "LD8jlJvE1LBmMeE3",
  "gWKseHEZL96T26iC",
  "ImTuxSRxDugg33aI",
] as const;

export type N8nReport = {
  workflowId: string;
  name: string;
  status?: string;
  executionId?: string;
  finishedAt?: string;
  summary?: string;
  metrics?: unknown;
  generatedAt?: string;
  limits: string[];
};

export type N8nReportRefreshResult = {
  reports: N8nReport[];
  errors: Array<{
    workflowId: string;
    name: string;
    error: string;
    code?: string;
  }>;
};

export const N8N_EXECUTION_STATUS_MAP = {
  success: "success",
  error: "error",
  crashed: "error",
  canceled: "canceled",
  cancelled: "canceled",
  running: "running",
  waiting: "waiting",
  new: "new",
} as const;

type AuthenticatedRequest = Request & { auth?: AuthContext };
type JsonRecord = Record<string, unknown>;

class ReportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "ReportError";
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nonEmptyString(value: unknown, max = 300): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().slice(0, max);
}

function ownerFromRequest(req: Request): string {
  const auth = (req as AuthenticatedRequest).auth;
  const owner = auth?.ownerOpenId?.trim();
  if (!owner || !auth?.user?.openId?.trim())
    throw new ReportError(
      "UNAUTHORIZED",
      "Geçerli owner oturumu gerekli.",
      401,
    );
  if (!auth.isOwner)
    throw new ReportError(
      "FORBIDDEN",
      "Bu uygulama owner hesabına özeldir.",
      403,
    );
  if (auth.user.openId.trim() !== owner)
    throw new ReportError(
      "FORBIDDEN",
      "Oturum owner hesabıyla eşleşmiyor.",
      403,
    );
  return owner;
}

function apiKey(): string {
  const key = process.env.N8N_API_KEY?.trim();
  if (!key)
    throw new ReportError(
      "N8N_NOT_CONFIGURED",
      "n8n API anahtarı sunucuda yapılandırılmamış.",
      503,
    );
  return key;
}

function publicError(error: unknown): { status: number; body: JsonRecord } {
  if (error instanceof ReportError)
    return {
      status: error.statusCode,
      body: { error: error.code, message: error.message },
    };
  return {
    status: 500,
    body: { error: "SERVER_ERROR", message: "n8n rapor işlemi tamamlanamadı." },
  };
}

function sendError(res: any, error: unknown): void {
  const result = publicError(error);
  res.status(result.status).json(result.body);
}

function baseUrlFromSettings(raw: unknown): string {
  const value = record(raw).baseUrl;
  if (typeof value !== "string" || !value.trim())
    throw new ReportError(
      "N8N_BASE_URL_REQUIRED",
      "Önce n8n baseUrl ayarını kaydedin.",
      503,
    );
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ReportError(
      "INVALID_N8N_URL",
      "Kaydedilmiş n8n baseUrl geçersiz.",
      400,
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host ||
    !/^[a-z0-9.-]+$/.test(host)
  )
    throw new ReportError(
      "INVALID_N8N_URL",
      "n8n baseUrl yalnızca güvenli, herkese açık HTTPS URL olabilir.",
      400,
    );
  let pathname = url.pathname.replace(/\/+$/, "");
  if (/\/api\/v1$/i.test(pathname))
    pathname = pathname.slice(0, -API_ROOT.length) || "";
  if (/^\/home(?:\/.*)?$/i.test(pathname)) pathname = "";
  const result = new URL(url.origin);
  result.pathname = pathname || "/";
  return result.toString().replace(/\/$/, "");
}

async function settingsFor(store: Store, owner: string): Promise<JsonRecord> {
  const row = await store.get<JsonRecord>(
    INTEGRATION_KIND,
    INTEGRATION_ID,
    owner,
  );
  return record(row?.payload);
}

function selectedIds(settings: JsonRecord): string[] {
  const saved = settings.selectedWorkflowIds;
  const source = Array.isArray(saved)
    ? saved.filter((value): value is string => typeof value === "string")
    : [...DEFAULT_WORKFLOW_IDS];
  const seen = new Set<string>();
  return source.filter((id) => {
    if (!ID_RE.test(id) || !WORKFLOW_MAP.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function workflowFor(id: string): (typeof WORKFLOWS)[number] {
  if (!ID_RE.test(id))
    throw new ReportError(
      "INVALID_WORKFLOW_ID",
      "Workflow kimliği geçersiz.",
      400,
    );
  const workflow = WORKFLOW_MAP.get(id);
  if (!workflow)
    throw new ReportError(
      "WORKFLOW_NOT_SELECTED",
      "Workflow seçili değil.",
      404,
    );
  return workflow;
}

function endpoint(base: string, resource: string): string {
  return `${base}${API_ROOT}/${resource.replace(/^\/+/, "")}`;
}

async function n8nJson(url: string, key: string): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json", "X-N8N-API-KEY": key },
      },
      FETCH_TIMEOUT_MS,
    );
  } catch {
    throw new ReportError(
      "N8N_UNREACHABLE",
      "n8n sunucusuna güvenli bağlantı kurulamadı.",
      502,
    );
  }
  if (response.status === 401)
    throw new ReportError(
      "N8N_API_KEY_INVALID",
      "n8n API anahtarı geçersiz veya süresi dolmuş.",
      401,
    );
  if (response.status === 403)
    throw new ReportError(
      "N8N_PERMISSION_DENIED",
      "n8n API anahtarının gerekli okuma izni yok.",
      403,
    );
  if (!response.ok)
    throw new ReportError(
      "N8N_UPSTREAM_ERROR",
      "n8n isteği tamamlanamadı.",
      502,
    );
  const text = await response.text().catch(() => "");
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not object");
    return parsed as JsonRecord;
  } catch {
    throw new ReportError(
      "N8N_INVALID_RESPONSE",
      "n8n geçerli JSON yanıtı vermedi.",
      502,
    );
  }
}

function safeDate(value: unknown): string | undefined {
  const text = nonEmptyString(value, 80);
  return text && !/[\u0000-\u001f\u007f]/.test(text) ? text : undefined;
}

function safeId(value: unknown): string | undefined {
  const text = nonEmptyString(value, 191);
  return text && ID_RE.test(text) ? text : undefined;
}

function webhookPath(value: unknown): string | undefined {
  const text = nonEmptyString(value, 200);
  if (!text || text.includes("?") || text.includes("#")) return undefined;
  const path = text.startsWith("/") ? text : `/webhook/${text}`;
  return PATH_RE.test(path) ? path : undefined;
}

function safeLabel(value: unknown, pattern: RegExp): string | undefined {
  const text = nonEmptyString(value, 64);
  return text && pattern.test(text) ? text : undefined;
}

function webhookDetails(
  raw: JsonRecord,
): Array<{ path: string; method?: string; authentication?: string }> {
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const result: Array<{
    path: string;
    method?: string;
    authentication?: string;
  }> = [];
  const seen = new Set<string>();
  for (const item of nodes) {
    const node = record(item);
    const type = String(node.type || "").toLowerCase();
    const parameters = record(node.parameters);
    if (
      !type.includes("webhook") &&
      parameters.path === undefined &&
      parameters.webhookPath === undefined
    )
      continue;
    const path = webhookPath(
      parameters.path ?? parameters.webhookPath ?? node.webhookPath,
    );
    if (!path || seen.has(path)) continue;
    const method = safeLabel(
      parameters.httpMethod ?? parameters.method ?? node.webhookMethod,
      METHOD_RE,
    );
    const authentication = safeLabel(
      parameters.authentication ?? node.authentication,
      AUTH_RE,
    );
    result.push({
      path,
      ...(method ? { method: method.toUpperCase() } : {}),
      ...(authentication ? { authentication } : {}),
    });
    seen.add(path);
    if (result.length >= 10) break;
  }
  return result;
}

function selectedSummary(id: string, raw: unknown): JsonRecord {
  const workflow = record(raw);
  const details = webhookDetails(workflow);
  const result: JsonRecord = {
    id,
    name: redactText(
      nonEmptyString(workflow.name, 300) || workflowFor(id).name,
    ).slice(0, 300),
    active: workflow.active === true,
    updatedAt: safeDate(workflow.updatedAt) || null,
  };
  if (details.length) {
    result.webhooks = details;
    result.webhookPaths = details.map((entry) => entry.path);
    result.webhookMethods = details.map((entry) => entry.method || null);
    result.webhookAuthentication = details.map(
      (entry) => entry.authentication || null,
    );
  }
  return result;
}

function redactText(input: string): string {
  let text = input
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\bsk(?:-[A-Za-z0-9]+)?-[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    )
    .replace(/\b\d{5,12}:[A-Za-z0-9_-]{20,}\b/g, "[gizli değer]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [gizli değer]")
    .replace(
      /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|password|secret|credential|cookie)\s*[:=]\s*["']?[^\s,"']{4,}/gi,
      "[gizli değer]",
    );
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    try {
      const url = new URL(raw);
      if (url.username || url.password) {
        url.username = "";
        url.password = "";
      }
      const pathParts = url.pathname.split("/");
      const restIndex = pathParts.findIndex(
        (part) => part.toLowerCase() === "rest",
      );
      if (restIndex >= 0 && pathParts.length > restIndex + 1)
        url.pathname = `${pathParts.slice(0, restIndex + 1).join("/")}/[gizli-deger]`;
      for (const key of [...url.searchParams.keys()]) {
        if (
          /(token|key|secret|password|auth|credential|signature|code)/i.test(
            key,
          )
        )
          url.searchParams.set(key, "[REDACTED]");
      }
      return url.toString();
    } catch {
      return "[REDACTED_URL]";
    }
  });
  return text.replace(/[ \t\r\n]+/g, " ").trim();
}

type SanitizeState = { depth: boolean; items: boolean; strings: boolean };
const SENSITIVE_KEYS =
  /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|(?:bot)?token|secret|password|credential(?:s)?|cookie|headers?|raw(?:[_-]?event|[_-]?request)?|request|response|body|code|debug|input|provider(?:[_-]?(?:result|response))?)$/i;

function sanitize(value: unknown, state: SanitizeState, depth = 0): unknown {
  if (depth >= 4) {
    state.depth = true;
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    const text = redactText(value);
    if (text.length > 3_000) {
      state.strings = true;
      return text.slice(0, 3_000);
    }
    return text;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null)
    return value;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (const item of value.slice(0, 30))
      output.push(sanitize(item, state, depth + 1));
    if (value.length > 30) state.items = true;
    return output;
  }
  if (value && typeof value === "object") {
    const output: JsonRecord = {};
    const entries = Object.entries(value as JsonRecord);
    for (const [key, child] of entries.slice(0, 30)) {
      if (SENSITIVE_KEYS.test(key)) continue;
      const cleanKey = redactText(key).slice(0, 100);
      if (!cleanKey) continue;
      output[cleanKey] = sanitize(child, state, depth + 1);
    }
    if (entries.length > 30) state.items = true;
    return output;
  }
  return undefined;
}

function sanitizeReportValue(value: unknown): {
  value: unknown;
  state: SanitizeState;
} {
  const state: SanitizeState = { depth: false, items: false, strings: false };
  return { value: sanitize(value, state), state };
}

const OUTPUT_FIELDS = [
  "report",
  "summary",
  "telegram_mesaj",
  "email_mesaj",
  "telegram_mesaji",
  "eposta_mesaji",
  "telegramMessage",
  "emailMessage",
  "telegram_message",
  "email_message",
  "rapor",
  "ozet",
  "raporMetni",
  "ozetMetni",
  "summary_text",
  "reportText",
  "reportMarkdown",
  "reportHtml",
  "daily_report",
  "dailyReport",
  "html",
  "text",
  "message",
  "totals",
  "total",
  "counts",
  "users",
  "customers",
  "daily",
  "statistics",
  "metrics",
  "answer",
  "telegramSummary",
  "tarih",
  "api_toplam_kayit",
  "toplam_arama",
  "toplam_gorusme_20sn",
  "toplam_cevapsiz",
  "toplam_gelen",
  "toplam_giden",
  "toplam_sure_sn",
  "aktif_kullanicilar",
] as const;
const SUMMARY_FIELDS = new Set([
  "report",
  "summary",
  "telegram_mesaj",
  "email_mesaj",
  "telegram_mesaji",
  "eposta_mesaji",
  "telegrammessage",
  "emailmessage",
  "telegram_message",
  "email_message",
  "telegramsummary",
  "rapor",
  "ozet",
  "rapormetni",
  "ozetmetni",
  "summary_text",
  "reporttext",
  "reportmarkdown",
  "reporthtml",
  "daily_report",
  "dailyreport",
  "html",
  "text",
  "message",
  "answer",
]);
const METRIC_FIELDS = new Set([
  "totals",
  "total",
  "counts",
  "users",
  "customers",
  "daily",
  "statistics",
  "metrics",
  "tarih",
  "api_toplam_kayit",
  "toplam_arama",
  "toplam_gorusme_20sn",
  "toplam_cevapsiz",
  "toplam_gelen",
  "toplam_giden",
  "toplam_sure_sn",
  "aktif_kullanicilar",
]);

function outputCandidateRank(
  field: string,
  nodeName: string,
  lastNode: string,
): number {
  const normalized = field.toLowerCase();
  const fieldRank: Record<string, number> = {
    report: 700,
    rapor: 680,
    summary: 660,
    ozet: 640,
    telegram_mesaj: 620,
    telegram_mesaji: 620,
    email_mesaj: 600,
    eposta_mesaji: 600,
    telegrammessage: 620,
    emailmessage: 600,
    telegramsummary: 620,
    answer: 540,
    html: 420,
    text: 300,
    message: 120,
  };
  let rank = fieldRank[normalized] || 100;
  if (nodeName === lastNode) rank += 30;
  if (
    /(report|rapor|summary|ozet|statistic|daily|telegram|email)/i.test(nodeName)
  )
    rank += 20;
  return rank;
}

function summaryText(value: unknown): string | undefined {
  if (typeof value === "string")
    return redactText(value).slice(0, 12_000) || undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as JsonRecord;
    for (const key of [
      "summary",
      "report",
      "rapor",
      "ozet",
      "text",
      "message",
      "telegramMessage",
      "emailMessage",
    ]) {
      if (object[key] !== undefined) {
        const nested = summaryText(object[key]);
        if (nested) return nested;
      }
    }
  }
  const encoded = JSON.stringify(value);
  return encoded ? redactText(encoded).slice(0, 12_000) : undefined;
}

function candidateValues(
  execution: JsonRecord,
): Array<{ field: string; value: unknown; node: string; rank: number }> {
  const data = record(execution.data);
  const resultData = record(
    data.resultData && typeof data.resultData === "object"
      ? data.resultData
      : execution.resultData,
  );
  const runData = record(resultData.runData);
  const lastNode = nonEmptyString(resultData.lastNodeExecuted, 200) || "";
  const candidates: Array<{
    field: string;
    value: unknown;
    node: string;
    rank: number;
  }> = [];
  for (const [nodeName, nodeRuns] of Object.entries(runData)) {
    const runs = Array.isArray(nodeRuns) ? nodeRuns : [nodeRuns];
    for (const run of runs) {
      const main = record(record(run).data).main;
      const branches = Array.isArray(main) ? main : [];
      for (const branch of branches) {
        if (!Array.isArray(branch)) continue;
        for (const item of branch) {
          const json = record(record(item).json);
          for (const field of OUTPUT_FIELDS) {
            if (json[field] === undefined) continue;
            candidates.push({
              field,
              value: json[field],
              node: nodeName,
              rank: outputCandidateRank(field, nodeName, lastNode),
            });
          }
        }
      }
    }
  }
  return candidates.sort((a, b) => b.rank - a.rank).slice(0, 8);
}

function extractOutput(execution: JsonRecord): {
  summary?: string;
  metrics?: unknown;
  limits: string[];
} {
  const candidates = candidateValues(execution);
  const limits = [
    "Yalnız etiketli son rapor çıktıları tutuldu; workflow girdisi, debug verisi, provider yanıtı, header ve credential alanları dışlandı.",
  ];
  if (!candidates.length) {
    limits.push(
      "Başarılı yürütmede etiketli rapor çıktısı bulunamadı; toplamlar uydurulmadı.",
    );
    return { limits };
  }
  const state: SanitizeState = { depth: false, items: false, strings: false };
  let summary: string | undefined;
  const metrics: JsonRecord = {};
  for (const candidate of candidates) {
    const field = candidate.field.toLowerCase();
    const clean = sanitize(candidate.value, state);
    if (SUMMARY_FIELDS.has(field) && summary === undefined)
      summary = summaryText(clean);
    if (METRIC_FIELDS.has(field) && clean !== undefined)
      metrics[candidate.field] = clean;
  }
  if (state.depth)
    limits.push("İç içe çıktı derinliği 4 seviye ile sınırlandı.");
  if (state.items)
    limits.push("Dizi ve nesne alanları en fazla 30 öğe ile sınırlandı.");
  if (state.strings)
    limits.push("Metin alanları 3000 karakter ile sınırlandı.");
  const result: { summary?: string; metrics?: unknown; limits: string[] } = {
    limits,
  };
  if (summary) result.summary = summary.slice(0, 12_000);
  if (Object.keys(metrics).length) result.metrics = metrics;
  return result;
}

function normalizedStatus(value: unknown): string | undefined {
  const raw = nonEmptyString(value, 64)?.toLowerCase();
  if (!raw) return undefined;
  return (
    N8N_EXECUTION_STATUS_MAP[raw as keyof typeof N8N_EXECUTION_STATUS_MAP] ||
    raw.slice(0, 64)
  );
}

async function mapBounded<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function consume(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => consume()),
  );
  return output;
}

function ensureDeadline(deadline: number): void {
  if (Date.now() > deadline)
    throw new ReportError(
      "N8N_REPORT_DEADLINE",
      "n8n rapor yenileme süresi aşıldı.",
      504,
    );
}

async function latestReport(
  store: Store,
  owner: string,
  base: string,
  key: string,
  workflowId: string,
  deadline: number,
): Promise<N8nReport> {
  ensureDeadline(deadline);
  const workflow = workflowFor(workflowId);
  const listUrl = new URL(endpoint(base, "executions"));
  listUrl.searchParams.set("workflowId", workflowId);
  listUrl.searchParams.set("status", "success");
  listUrl.searchParams.set("limit", "10");
  const list = await n8nJson(listUrl.toString(), key);
  const executions = Array.isArray(list.data) ? list.data : [];
  let listed: JsonRecord | undefined;
  let detail: JsonRecord | undefined;
  let output:
    | { summary?: string; metrics?: unknown; limits: string[] }
    | undefined;
  for (const candidate of executions.slice(0, 3)) {
    const candidateListed = record(candidate);
    const candidateId = safeId(candidateListed.id);
    if (!candidateId) continue;
    ensureDeadline(deadline);
    const detailUrl = new URL(
      endpoint(base, `executions/${encodeURIComponent(candidateId)}`),
    );
    detailUrl.searchParams.set("includeData", "true");
    const candidateDetail = await n8nJson(detailUrl.toString(), key);
    const candidateOutput = extractOutput(candidateDetail);
    if (!detail) {
      listed = candidateListed;
      detail = candidateDetail;
      output = candidateOutput;
    }
    if (candidateOutput.summary || candidateOutput.metrics !== undefined) {
      listed = candidateListed;
      detail = candidateDetail;
      output = candidateOutput;
      break;
    }
  }
  if (!listed || !detail || !output || !safeId(listed.id))
    throw new ReportError(
      "N8N_NO_SUCCESS_EXECUTION",
      "Workflow için başarılı yürütme bulunamadı.",
      404,
    );
  const executionId = safeId(listed.id)!;
  const previousRow = await store.get<JsonRecord>(
    REPORT_KIND,
    workflowId,
    owner,
  );
  const previous = previousRow
    ? safeStoredReport(workflowId, previousRow.payload)
    : null;
  const hasFreshOutput = Boolean(
    output.summary || output.metrics !== undefined,
  );
  const limits = [...new Set([...(previous?.limits || []), ...output.limits])];
  if (!hasFreshOutput && previous)
    limits.push(
      "Bu yürütmede etiketli çıktı yoktu; önceki güvenli rapor alanları korundu.",
    );
  const report: N8nReport = {
    workflowId,
    name: workflow.name,
    ...(normalizedStatus(detail.status ?? listed.status)
      ? { status: normalizedStatus(detail.status ?? listed.status) }
      : {}),
    executionId,
    ...(safeDate(
      detail.finishedAt ??
        detail.stoppedAt ??
        listed.finishedAt ??
        listed.stoppedAt,
    )
      ? {
          finishedAt: safeDate(
            detail.finishedAt ??
              detail.stoppedAt ??
              listed.finishedAt ??
              listed.stoppedAt,
          ),
        }
      : {}),
    ...(output.summary || !previous
      ? {}
      : previous.summary
        ? { summary: previous.summary }
        : {}),
    ...(output.summary ? { summary: output.summary } : {}),
    ...(output.metrics !== undefined || !previous
      ? {}
      : previous.metrics !== undefined
        ? { metrics: previous.metrics }
        : {}),
    ...(output.metrics !== undefined ? { metrics: output.metrics } : {}),
    generatedAt: new Date().toISOString(),
    limits,
  };
  await store.put(REPORT_KIND, workflowId, report, owner);
  return report;
}

function safeStoredReport(id: string, payload: unknown): N8nReport | null {
  const workflow = WORKFLOW_MAP.get(id);
  if (!workflow) return null;
  const raw = record(payload);
  const state: SanitizeState = { depth: false, items: false, strings: false };
  const result: N8nReport = {
    workflowId: id,
    name: redactText(nonEmptyString(raw.name, 300) || workflow.name).slice(
      0,
      300,
    ),
    limits: Array.isArray(raw.limits)
      ? raw.limits
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => redactText(entry).slice(0, 300))
          .slice(0, 30)
      : [],
  };
  const status = normalizedStatus(raw.status);
  const executionId = safeId(raw.executionId);
  const finishedAt = safeDate(raw.finishedAt);
  const generatedAt = safeDate(raw.generatedAt);
  if (status) result.status = status;
  if (executionId) result.executionId = executionId;
  if (finishedAt) result.finishedAt = finishedAt;
  if (generatedAt) result.generatedAt = generatedAt;
  if (typeof raw.summary === "string")
    result.summary = redactText(raw.summary).slice(0, 12_000);
  if (raw.metrics !== undefined) result.metrics = sanitize(raw.metrics, state);
  if (state.depth)
    result.limits.push("İç içe çıktı derinliği 4 seviye ile sınırlandı.");
  if (state.items)
    result.limits.push(
      "Dizi ve nesne alanları en fazla 30 öğe ile sınırlandı.",
    );
  if (state.strings)
    result.limits.push("Metin alanları 3000 karakter ile sınırlandı.");
  return result;
}

async function persistRefreshFailure(
  store: Store,
  owner: string,
  workflowId: string,
  error: unknown,
): Promise<void> {
  const workflow = workflowFor(workflowId);
  const safeError = publicError(error);
  const previousRow = await store.get<JsonRecord>(
    REPORT_KIND,
    workflowId,
    owner,
  );
  const previous = previousRow
    ? safeStoredReport(workflowId, previousRow.payload)
    : null;
  const code =
    typeof safeError.body.error === "string"
      ? safeError.body.error
      : "N8N_REFRESH_FAILED";
  const message =
    typeof safeError.body.message === "string"
      ? safeError.body.message
      : "n8n raporu yenilenemedi.";
  const limits = [
    ...new Set([
      ...(previous?.limits || []),
      `Son yenileme başarısız (${code}): ${message}`,
    ]),
  ];
  const failed: N8nReport = {
    workflowId,
    name: workflow.name,
    status: "error",
    ...(previous?.executionId ? { executionId: previous.executionId } : {}),
    ...(previous?.finishedAt ? { finishedAt: previous.finishedAt } : {}),
    ...(previous?.summary ? { summary: previous.summary } : {}),
    ...(previous?.metrics !== undefined ? { metrics: previous.metrics } : {}),
    generatedAt: new Date().toISOString(),
    limits,
  };
  try {
    await store.put(REPORT_KIND, workflowId, failed, owner);
  } catch {
    // A cache-write failure must not replace the sanitized refresh error.
  }
}

export async function getStoredN8nReports(
  store: Store,
  owner: string,
): Promise<N8nReport[]> {
  if (!owner.trim())
    throw new ReportError(
      "UNAUTHORIZED",
      "Geçerli owner oturumu gerekli.",
      401,
    );
  const rows = await store.list<JsonRecord>(REPORT_KIND, owner);
  return rows
    .map((row) => safeStoredReport(row.id, row.payload))
    .filter((row): row is N8nReport => Boolean(row));
}

export async function refreshN8nReports(
  store: Store,
  owner: string,
): Promise<N8nReportRefreshResult> {
  if (!owner.trim())
    throw new ReportError(
      "UNAUTHORIZED",
      "Geçerli owner oturumu gerekli.",
      401,
    );
  const settings = await settingsFor(store, owner);
  const base = baseUrlFromSettings(settings);
  const key = apiKey();
  const ids = selectedIds(settings);
  const deadline = Date.now() + REFRESH_DEADLINE_MS;
  const results = await mapBounded(
    ids,
    REFRESH_CONCURRENCY,
    async (workflowId) => {
      try {
        return {
          report: await latestReport(
            store,
            owner,
            base,
            key,
            workflowId,
            deadline,
          ),
        };
      } catch (error) {
        const workflow = workflowFor(workflowId);
        await persistRefreshFailure(store, owner, workflowId, error);
        const safe = publicError(error);
        return {
          error: {
            workflowId,
            name: workflow.name,
            error: String(safe.body.message),
            ...(typeof safe.body.error === "string"
              ? { code: safe.body.error }
              : {}),
          },
        };
      }
    },
  );
  return {
    reports: results.flatMap((result) =>
      "report" in result && result.report ? [result.report] : [],
    ),
    errors: results.flatMap((result) =>
      "error" in result && result.error ? [result.error] : [],
    ),
  };
}

export function registerN8nReportRoutes(app: Express, store: Store): void {
  app.get("/api/n8n/selected", async (req, res) => {
    try {
      const owner = ownerFromRequest(req);
      const settings = await settingsFor(store, owner);
      const base = baseUrlFromSettings(settings);
      const key = apiKey();
      const ids = selectedIds(settings);
      const results = await mapBounded(
        ids,
        MAX_CONCURRENCY,
        async (workflowId) => {
          try {
            const body = await n8nJson(
              endpoint(base, `workflows/${encodeURIComponent(workflowId)}`),
              key,
            );
            return { data: selectedSummary(workflowId, body) };
          } catch (error) {
            const safe = publicError(error);
            return {
              error: {
                workflowId,
                name: workflowFor(workflowId).name,
                error: String(safe.body.message),
                ...(typeof safe.body.error === "string"
                  ? { code: safe.body.error }
                  : {}),
              },
            };
          }
        },
      );
      return res.json({
        data: results.flatMap((result) =>
          "data" in result && result.data ? [result.data] : [],
        ),
        ...(results.some((result) => "error" in result)
          ? {
              errors: results.flatMap((result) =>
                "error" in result && result.error ? [result.error] : [],
              ),
            }
          : {}),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/n8n/reports", async (req, res) => {
    try {
      const owner = ownerFromRequest(req);
      return res.json({ data: await getStoredN8nReports(store, owner) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/n8n/reports/refresh", async (req, res) => {
    try {
      const owner = ownerFromRequest(req);
      return res.json(await refreshN8nReports(store, owner));
    } catch (error) {
      return sendError(res, error);
    }
  });
}
