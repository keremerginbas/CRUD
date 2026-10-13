import crypto from "node:crypto";
import net from "node:net";
import express, {
  type Express,
  type Request,
  type Response as ExpressResponse,
} from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import {
  fetchWithTimeout,
  signedOutboundHeaders,
  timingSafeEqualText,
} from "./security.js";
import {
  LeadStage,
  RuleSchema,
  type AuthContext,
  type Lead,
  type Rule,
  type StoredEvent,
} from "./types.js";

/**
 * XRE keeps the n8n management credential in the process environment only.
 * These records intentionally contain no credential and are scoped by owner in
 * the existing xre_records table.
 */
const INTEGRATION_KIND = "integration";
const INTEGRATION_ID = "n8n";
const API_PATH = "/api/v1";
const MAX_PAGE_SIZE = 50;
const EVENT_TYPES = ["lead.created", "lead.updated", "stage.changed"] as const;

type N8nEventType = (typeof EVENT_TYPES)[number];
type AuthedRequest = Request & { auth?: AuthContext };

export type N8nInboundProcessor = (
  store: Store,
  ownerOpenId: string,
  body: unknown,
) => Promise<void>;

export interface N8nSettingsRecord {
  selectedWorkflowIds?: string[];
  baseUrl?: string;
  webhookUrl?: string;
  connected?: boolean;
  lastCheckedAt?: string;
}

class N8nError extends Error {
  statusCode: number;
  code: string;
  providerStatus?: number;

  constructor(
    code: string,
    message: string,
    statusCode = 502,
    providerStatus?: number,
  ) {
    super(message);
    this.name = "N8nError";
    this.code = code;
    this.statusCode = statusCode;
    this.providerStatus = providerStatus;
  }
}

function now(): string {
  return new Date().toISOString();
}

function ownerOf(req: Request): string {
  const owner = (req as AuthedRequest).auth?.ownerOpenId?.trim();
  if (!owner)
    throw new N8nError("UNAUTHORIZED", "Geçerli owner oturumu gerekli.", 401);
  return owner;
}

function apiKey(): string {
  return process.env.N8N_API_KEY?.trim() || "";
}

function publicError(error: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  if (error instanceof N8nError) {
    return {
      status: error.statusCode,
      body: { error: error.code, message: error.message },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: { error: "INVALID_REQUEST", message: "İstek alanları geçersiz." },
    };
  }
  return {
    status: 500,
    body: { error: "SERVER_ERROR", message: "n8n işlemi tamamlanamadı." },
  };
}

function sendError(res: ExpressResponse, error: unknown): void {
  const result = publicError(error);
  res.status(result.status).json(result.body);
}

function requireApiKey(): string {
  const key = apiKey();
  if (!key)
    throw new N8nError(
      "N8N_NOT_CONFIGURED",
      "n8n API anahtarı sunucuda yapılandırılmamış.",
      503,
    );
  return key;
}

function isPrivateIp(host: string): boolean {
  const version = net.isIP(host);
  if (version === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (version === 6) {
    const normalized = host.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.")
    );
  }
  return false;
}

function parseHttpsUrl(raw: unknown, field: string): URL {
  if (typeof raw !== "string" || !raw.trim())
    throw new N8nError(
      "INVALID_N8N_URL",
      `${field} alanı HTTPS URL olmalı.`,
      400,
    );
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new N8nError(
      "INVALID_N8N_URL",
      `${field} alanı geçerli bir URL olmalı.`,
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
    host === "metadata.google.internal" ||
    isPrivateIp(host)
  )
    throw new N8nError(
      "INVALID_N8N_URL",
      `${field} yalnızca kimlik bilgisi, sorgu ve fragment içermeyen herkese açık HTTPS URL olabilir.`,
      400,
    );
  return url;
}

function normalizeBaseUrl(raw: unknown): string {
  const url = parseHttpsUrl(raw, "baseUrl");
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.toLowerCase() === API_PATH) pathname = "";
  // n8n shares UI links such as /home/workflows; the API root is the public
  // origin, unless the installation intentionally lives under another path.
  if (/^\/home(?:\/.*)?$/i.test(pathname)) pathname = "";
  const result = new URL(url.origin);
  result.pathname = pathname || "/";
  return result.toString().replace(/\/$/, "");
}

function normalizeWebhookUrl(raw: unknown, baseUrl: string): string {
  const url = parseHttpsUrl(raw, "webhookUrl");
  const base = parseHttpsUrl(baseUrl, "baseUrl");
  const basePath = new URL(base.toString()).pathname.replace(/\/+$/, "");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const expectedPrefix = `${basePath}/webhook`.replace(/^\/\//, "/");
  if (
    url.origin !== base.origin ||
    !(path === expectedPrefix || path.startsWith(`${expectedPrefix}/`)) ||
    path.startsWith(`${basePath}/webhook-test`)
  )
    throw new N8nError(
      "INVALID_N8N_WEBHOOK_URL",
      "webhookUrl, baseUrl ile aynı origin üzerindeki üretim /webhook yolunda olmalı.",
      400,
    );
  const result = new URL(url.origin);
  result.pathname = path;
  return result.toString().replace(/\/$/, "");
}

function integrationPayload(payload: unknown): N8nSettingsRecord {
  if (!payload || typeof payload !== "object") return {};
  const value = payload as Record<string, unknown>;
  return {
    ...(Array.isArray(value.selectedWorkflowIds)
      ? {
          selectedWorkflowIds: value.selectedWorkflowIds
            .filter(
              (id): id is string =>
                typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id),
            )
            .slice(0, 50),
        }
      : {}),
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
    ...(typeof value.webhookUrl === "string"
      ? { webhookUrl: value.webhookUrl }
      : {}),
    ...(typeof value.connected === "boolean"
      ? { connected: value.connected }
      : {}),
    ...(typeof value.lastCheckedAt === "string"
      ? { lastCheckedAt: value.lastCheckedAt }
      : {}),
  };
}

async function readSettings(
  store: Store,
  owner: string,
): Promise<N8nSettingsRecord> {
  const row = await store.get<N8nSettingsRecord>(
    INTEGRATION_KIND,
    INTEGRATION_ID,
    owner,
  );
  return integrationPayload(row?.payload);
}

function publicSettings(record: N8nSettingsRecord): Record<string, unknown> {
  const result: Record<string, unknown> = {
    selectedWorkflowIds: record.selectedWorkflowIds || [],
    baseUrl: record.baseUrl || "",
    webhookUrl: record.webhookUrl || "",
    apiKeyConfigured: Boolean(apiKey()),
    configured: Boolean(record.baseUrl && apiKey()),
  };
  // connected is a last verified state, never inferred from a saved URL or key.
  if (typeof record.connected === "boolean")
    result.connected = record.connected;
  if (record.lastCheckedAt) result.lastCheckedAt = record.lastCheckedAt;
  return result;
}

function saveSettingsPayload(record: N8nSettingsRecord): N8nSettingsRecord {
  return {
    ...(record.selectedWorkflowIds
      ? { selectedWorkflowIds: record.selectedWorkflowIds }
      : {}),
    ...(record.baseUrl ? { baseUrl: record.baseUrl } : {}),
    ...(record.webhookUrl ? { webhookUrl: record.webhookUrl } : {}),
    ...(typeof record.connected === "boolean"
      ? { connected: record.connected }
      : {}),
    ...(record.lastCheckedAt ? { lastCheckedAt: record.lastCheckedAt } : {}),
  };
}

function ensureBaseUrl(record: N8nSettingsRecord): string {
  if (!record.baseUrl)
    throw new N8nError(
      "N8N_BASE_URL_REQUIRED",
      "Önce n8n baseUrl ayarını kaydedin.",
      503,
    );
  return record.baseUrl;
}

function apiEndpoint(baseUrl: string, resource: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = resource.replace(/^\/+/, "");
  return `${base}${API_PATH}/${path}`;
}

function readPage(req: Request): { limit: number; cursor?: string } {
  const rawLimit =
    req.query.limit === undefined ? "25" : String(req.query.limit);
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
    throw new N8nError(
      "INVALID_PAGINATION",
      `limit 1 ile ${MAX_PAGE_SIZE} arasında olmalı.`,
      400,
    );
  const rawCursor = req.query.cursor;
  if (rawCursor === undefined || rawCursor === "") return { limit };
  const cursor = String(rawCursor);
  if (cursor.length > 512 || /[\u0000-\u001f\u007f]/.test(cursor))
    throw new N8nError("INVALID_PAGINATION", "cursor geçersiz.", 400);
  return { limit, cursor };
}

function apiUrl(
  baseUrl: string,
  resource: string,
  page: { limit: number; cursor?: string },
): string {
  const url = new URL(apiEndpoint(baseUrl, resource));
  url.searchParams.set("limit", String(page.limit));
  if (page.cursor) url.searchParams.set("cursor", page.cursor);
  return url.toString();
}

async function n8nFetchJson(
  url: string,
  key: string,
): Promise<Record<string, unknown>> {
  let response: globalThis.Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-N8N-API-KEY": key,
        },
      },
      8000,
    );
  } catch {
    throw new N8nError(
      "N8N_UNREACHABLE",
      "n8n sunucusuna güvenli bağlantı kurulamadı.",
      502,
    );
  }
  if (response.status === 401)
    throw new N8nError(
      "N8N_API_KEY_INVALID",
      "n8n API anahtarı geçersiz veya süresi dolmuş.",
      401,
      401,
    );
  if (response.status === 403)
    throw new N8nError(
      "N8N_PERMISSION_DENIED",
      "n8n API anahtarının gerekli okuma izni yok.",
      403,
      403,
    );
  if (!response.ok)
    throw new N8nError(
      "N8N_UPSTREAM_ERROR",
      "n8n isteği tamamlanamadı.",
      502,
      response.status,
    );
  const text = await response.text().catch(() => "");
  try {
    const parsed = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new N8nError(
      "N8N_INVALID_RESPONSE",
      "n8n geçerli JSON yanıtı vermedi.",
      502,
    );
  }
}

function arrayData(body: Record<string, unknown>): unknown[] {
  return Array.isArray(body.data) ? body.data : [];
}

function nextCursor(body: Record<string, unknown>): string | null {
  const candidate = body.nextCursor ?? body.nextPageToken ?? body.next;
  return typeof candidate === "string" && candidate.length <= 512
    ? candidate
    : null;
}

function safeString(value: unknown, max = 300): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.slice(0, max);
}

function safeWebhookPaths(
  workflow: Record<string, unknown>,
): string[] | undefined {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const paths = new Set<string>();
  for (const rawNode of nodes) {
    if (!rawNode || typeof rawNode !== "object") continue;
    const node = rawNode as Record<string, unknown>;
    const parameters =
      node.parameters && typeof node.parameters === "object"
        ? (node.parameters as Record<string, unknown>)
        : {};
    const type = String(node.type || "").toLowerCase();
    const values = [
      parameters.path,
      parameters.webhookPath,
      parameters.webhookId,
      node.webhookPath,
    ];
    if (
      !type.includes("webhook") &&
      values.every((value) => typeof value !== "string")
    )
      continue;
    for (const value of values) {
      const candidate = safeString(value, 200);
      if (!candidate || candidate.includes("?") || candidate.includes("#"))
        continue;
      const path = candidate.startsWith("/")
        ? candidate
        : `/webhook/${candidate}`;
      if (/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(path)) {
        paths.add(path);
        if (paths.size >= 10) break;
      }
    }
    if (paths.size >= 10) break;
  }
  return paths.size ? [...paths] : undefined;
}

function workflowSummary(raw: unknown): Record<string, unknown> {
  const workflow =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = {
    id: safeString(workflow.id, 191) || "",
    name: safeString(workflow.name, 300) || "İsimsiz workflow",
    active: workflow.active === true,
    updatedAt: safeString(workflow.updatedAt, 80) || null,
  };
  const paths = safeWebhookPaths(workflow);
  if (paths) result.webhookPaths = paths;
  return result;
}

function executionSummary(raw: unknown): Record<string, unknown> {
  const execution =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    id: safeString(execution.id, 191) || "",
    workflowId:
      safeString(execution.workflowId, 191) ||
      (execution.workflow && typeof execution.workflow === "object"
        ? safeString((execution.workflow as Record<string, unknown>).id, 191) ||
          null
        : null),
    status: safeString(execution.status, 64) || null,
    mode: safeString(execution.mode, 64) || null,
    startedAt: safeString(execution.startedAt, 80) || null,
    stoppedAt: safeString(execution.stoppedAt, 80) || null,
    finished:
      typeof execution.finished === "boolean" ? execution.finished : null,
    retryOf: safeString(execution.retryOf, 191) || null,
    retrySuccessId: safeString(execution.retrySuccessId, 191) || null,
  };
}

function eventType(body: unknown): N8nEventType {
  const raw =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested =
    raw.payload && typeof raw.payload === "object"
      ? (raw.payload as Record<string, unknown>)
      : {};
  const type = String(raw.type || raw.event || nested.type || "");
  if (!(EVENT_TYPES as readonly string[]).includes(type))
    throw new N8nError(
      "INVALID_INBOUND_EVENT",
      "Yalnız lead.created, lead.updated veya stage.changed kabul edilir.",
      400,
    );
  return type as N8nEventType;
}

function eventKey(provider: string, body: unknown, fallback = ""): string {
  const raw =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const candidate = raw.id || raw.eventId || raw.messageId;
  const stable = candidate
    ? String(candidate)
    : crypto
        .createHash("sha256")
        .update(fallback || JSON.stringify(body))
        .digest("hex");
  return `${provider}:${stable.slice(0, 220)}`;
}

function deriveN8nTokenFromKey(key: string, owner: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(`xre:n8n:inbound:v1:${owner}`)
    .digest("hex");
}

/** Returns the stable owner-scoped token only when explicitly requested by an authenticated owner. */
export function deriveN8nInboundToken(owner: string): string {
  const key = requireApiKey();
  return deriveN8nTokenFromKey(key, owner);
}

function authorizationToken(req: Request): string {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || "";
}

function verifyN8nBearer(req: Request, expected: string): boolean {
  return timingSafeEqualText(authorizationToken(req), expected);
}

async function resolveInboundOwner(store: Store): Promise<string> {
  const configured =
    process.env.XRE_OWNER_OPEN_ID?.trim() ||
    process.env.MANUS_OWNER_OPEN_ID?.trim();
  if (configured) return configured;
  const owner = await store.resolveOwner();
  if (!owner)
    throw new N8nError(
      "OWNER_NOT_CONFIGURED",
      "Webhook için erişilebilir owner bulunamadı.",
      503,
    );
  return owner;
}

function safeOutboundValue(key: string, value: unknown): unknown {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("authorization") ||
    normalized.includes("apikey") ||
    normalized.includes("token") ||
    normalized === "jwt" ||
    normalized.startsWith("sk")
  )
    return undefined;
  if (
    typeof value === "string" &&
    (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ||
      /\bsk(?:[-_][A-Za-z0-9_-]+|value[A-Za-z0-9_-]*)/i.test(value))
  )
    return "[REDACTED]";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const safe = safeOutboundValue(nestedKey, nestedValue);
      if (safe !== undefined) nested[nestedKey] = safe;
    }
    return nested;
  }
  return value;
}

function safeLead(lead: Lead): Record<string, unknown> {
  const allowed = [
    "id",
    "name",
    "phone",
    "email",
    "company",
    "stage",
    "owner",
    "value",
    "source",
    "notes",
    "createdAt",
    "lastActivity",
    "tags",
    "pipelineId",
    "contactId",
    "companyId",
    "dealTitle",
    "expectedCloseDate",
    "probability",
    "customFields",
    "lostReason",
    "lostReasonDetail",
  ] as const;
  const result: Record<string, unknown> = {};
  const record = lead as unknown as Record<string, unknown>;
  for (const key of allowed) {
    const safe = safeOutboundValue(key, record[key]);
    if (safe !== undefined) result[key] = structuredClone(safe);
  }
  return result;
}

function eventTypeForOutbound(event: StoredEvent): N8nEventType {
  const payload = event.payload || {};
  if (EVENT_TYPES.includes(String(payload.eventType) as N8nEventType))
    return payload.eventType as N8nEventType;
  if (payload.toStage || payload.fromStage) return "stage.changed";
  return "lead.updated";
}

function payloadConfig(event: StoredEvent): Record<string, unknown> {
  return event.payload.config && typeof event.payload.config === "object"
    ? (event.payload.config as Record<string, unknown>)
    : {};
}

async function postN8nWebhook(
  url: string,
  owner: string,
  lead: Lead,
  event: StoredEvent,
): Promise<Record<string, unknown>> {
  const key = requireApiKey();
  const token = deriveN8nTokenFromKey(key, owner);
  const outboundLead = safeLead(lead);
  outboundLead.owner = owner;
  const body = JSON.stringify({
    eventId: event.id,
    type: eventTypeForOutbound(event),
    lead: outboundLead,
  });
  let response: globalThis.Response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          ...signedOutboundHeaders(body, token),
          Authorization: `Bearer ${token}`,
          "X-XRE-Event-ID": event.id,
        },
        body,
      },
      8000,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      (error as { name?: string })?.name === "AbortError" ||
      /timeout|aborted|timed out/i.test(message)
    ) {
      const timeout = new Error("n8n webhook request timed out.");
      timeout.name = "AbortError";
      throw timeout;
    }
    throw new N8nError(
      "N8N_WEBHOOK_UNREACHABLE",
      "n8n üretim webhook hedefine güvenli bağlantı kurulamadı.",
      502,
    );
  }
  if (response.status === 401)
    throw new N8nError(
      "N8N_WEBHOOK_REJECTED",
      "n8n üretim webhook hedefi kimlik doğrulamasını reddetti.",
      502,
      401,
    );
  if (response.status === 403)
    throw new N8nError(
      "N8N_WEBHOOK_FORBIDDEN",
      "n8n üretim webhook hedefi isteğe izin vermedi.",
      502,
      403,
    );
  if (!response.ok)
    throw new N8nError(
      "N8N_WEBHOOK_ERROR",
      "n8n üretim webhook hedefi hata döndürdü.",
      502,
      response.status,
    );
  await response.arrayBuffer().catch(() => undefined);
  return { delivered: true, status: response.status };
}

/**
 * Sends a rule-created n8n webhook. The URL is always checked against the
 * owner's saved trusted target; a rule cannot smuggle in a different host.
 */
export async function deliverN8nWebhook(
  store: Store,
  owner: string,
  lead: Lead,
  event: StoredEvent,
): Promise<Record<string, unknown>> {
  const settings = await readSettings(store, owner);
  if (!settings.webhookUrl)
    throw new N8nError(
      "N8N_WEBHOOK_NOT_CONFIGURED",
      "n8n üretim webhook hedefi kaydedilmemiş.",
      503,
    );
  const config = payloadConfig(event);
  const requested =
    typeof config.url === "string" ? config.url : settings.webhookUrl;
  if (requested !== settings.webhookUrl)
    throw new N8nError(
      "N8N_WEBHOOK_NOT_TRUSTED",
      "Kuralın webhook hedefi kaydedilmiş n8n hedefiyle eşleşmiyor.",
      400,
    );
  return postN8nWebhook(settings.webhookUrl, owner, lead, event);
}

/** Outbox handler for events with payload.type === 'n8n-delivery'. */
export async function deliverN8nEvent(
  store: Store,
  event: StoredEvent,
): Promise<Record<string, unknown>> {
  if (event.payload.type !== "n8n-delivery")
    throw new N8nError(
      "INVALID_N8N_EVENT",
      "Bilinmeyen n8n outbox olayı.",
      400,
    );
  const leadId = String(event.payload.leadId || "");
  if (!leadId)
    throw new N8nError("LEAD_REQUIRED", "n8n olayı için leadId gerekli.", 400);
  const record = await store.get<Lead>("lead", leadId, event.ownerOpenId);
  if (!record)
    throw new N8nError("NOT_FOUND", "n8n olayı için müşteri bulunamadı.", 404);
  return deliverN8nWebhook(store, event.ownerOpenId, record.payload, event);
}

function ruleInput(body: unknown): {
  name: string;
  triggerStage: z.infer<typeof LeadStage>;
  pipelineId?: string;
  enabled: boolean;
} {
  const raw =
    body && typeof body === "object" && (body as Record<string, unknown>).rule
      ? (body as Record<string, unknown>).rule
      : body;
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(200),
      triggerStage: LeadStage,
      pipelineId: z.string().trim().max(191).optional(),
      enabled: z.boolean().optional().default(true),
    })
    .safeParse(raw);
  if (!parsed.success)
    throw new N8nError(
      "INVALID_RULE",
      "n8n otomasyon kuralı alanları geçersiz.",
      400,
    );
  return parsed.data;
}

/** Mount authenticated management routes after the app's /api requireAuth middleware. */
export function registerN8nRoutes(app: Express, store: Store): void {
  app.get("/api/n8n/settings", async (req, res) => {
    try {
      const owner = ownerOf(req);
      return res.json(publicSettings(await readSettings(store, owner)));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.put("/api/n8n/settings", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const current = await readSettings(store, owner);
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const rawBase = (body as Record<string, unknown>).baseUrl;
      const rawWebhook = (body as Record<string, unknown>).webhookUrl;
      const baseUrl =
        rawBase === undefined
          ? current.baseUrl || ""
          : typeof rawBase === "string" && !rawBase.trim()
            ? ""
            : normalizeBaseUrl(rawBase);
      const webhookUrl =
        rawWebhook === undefined
          ? current.webhookUrl || ""
          : typeof rawWebhook === "string" && !rawWebhook.trim()
            ? ""
            : normalizeWebhookUrl(rawWebhook, baseUrl);
      if (webhookUrl && !baseUrl)
        throw new N8nError(
          "N8N_BASE_URL_REQUIRED",
          "webhookUrl kaydetmek için baseUrl gerekli.",
          400,
        );
      const changed =
        baseUrl !== current.baseUrl || webhookUrl !== current.webhookUrl;
      const saved: N8nSettingsRecord = saveSettingsPayload({
        selectedWorkflowIds: current.selectedWorkflowIds,
        ...(baseUrl ? { baseUrl } : {}),
        ...(webhookUrl ? { webhookUrl } : {}),
        ...(changed
          ? {}
          : typeof current.connected === "boolean"
            ? { connected: current.connected }
            : {}),
        ...(changed
          ? {}
          : current.lastCheckedAt
            ? { lastCheckedAt: current.lastCheckedAt }
            : {}),
      });
      await store.put(INTEGRATION_KIND, INTEGRATION_ID, saved, owner);
      return res.json(publicSettings(saved));
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/n8n/test", async (req, res) => {
    let owner = "";
    try {
      owner = ownerOf(req);
      const settings = await readSettings(store, owner);
      const baseUrl = ensureBaseUrl(settings);
      const key = requireApiKey();
      await n8nFetchJson(`${apiEndpoint(baseUrl, "workflows")}?limit=1`, key);
      const saved = saveSettingsPayload({
        ...settings,
        connected: true,
        lastCheckedAt: now(),
      });
      await store.put(INTEGRATION_KIND, INTEGRATION_ID, saved, owner);
      return res.json({
        ...publicSettings(saved),
        connected: true,
        readOnly: true,
      });
    } catch (error) {
      if (owner) {
        try {
          const settings = await readSettings(store, owner);
          await store.put(
            INTEGRATION_KIND,
            INTEGRATION_ID,
            saveSettingsPayload({
              ...settings,
              connected: false,
              lastCheckedAt: now(),
            }),
            owner,
          );
        } catch {
          /* A failed status write must never mask the sanitized provider error. */
        }
      }
      return sendError(res, error);
    }
  });

  app.get("/api/n8n/workflows", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const settings = await readSettings(store, owner);
      const page = readPage(req);
      const body = await n8nFetchJson(
        apiUrl(ensureBaseUrl(settings), "workflows", page),
        requireApiKey(),
      );
      return res.json({
        data: arrayData(body).map(workflowSummary),
        nextCursor: nextCursor(body),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.get("/api/n8n/executions", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const settings = await readSettings(store, owner);
      const page = readPage(req);
      const body = await n8nFetchJson(
        apiUrl(ensureBaseUrl(settings), "executions", page),
        requireApiKey(),
      );
      return res.json({
        data: arrayData(body).map(executionSummary),
        nextCursor: nextCursor(body),
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/n8n/token", async (req, res) => {
    try {
      const owner = ownerOf(req);
      return res.json({ token: deriveN8nInboundToken(owner) });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/n8n/delivery", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const settings = await readSettings(store, owner);
      if (!settings.baseUrl || !settings.webhookUrl)
        throw new N8nError(
          "N8N_NOT_CONFIGURED",
          "Önce n8n baseUrl ve üretim webhook hedefini kaydedin.",
          503,
        );
      requireApiKey();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const leadId = String(
        (body as Record<string, unknown>).leadId || "",
      ).trim();
      if (!leadId || leadId.length > 191)
        throw new N8nError("LEAD_REQUIRED", "Geçerli bir leadId gerekli.", 400);
      const requestedType = String(
        (body as Record<string, unknown>).eventType ||
          (body as Record<string, unknown>).type ||
          "lead.updated",
      );
      if (!(EVENT_TYPES as readonly string[]).includes(requestedType))
        throw new N8nError(
          "INVALID_EVENT_TYPE",
          "Olay tipi desteklenmiyor.",
          400,
        );
      const inputEventId = String(
        (body as Record<string, unknown>).eventId || "",
      ).trim();
      const eventId = inputEventId || crypto.randomUUID();
      if (eventId.length > 191 || /[\u0000-\u001f\u007f]/.test(eventId))
        throw new N8nError("INVALID_EVENT_ID", "eventId geçersiz.", 400);
      const lead = await store.get<Lead>("lead", leadId, owner);
      if (!lead) throw new N8nError("NOT_FOUND", "Müşteri bulunamadı.", 404);
      const saved = await store.appendEvent(
        owner,
        `n8n-delivery:${eventId}`,
        {
          type: "n8n-delivery",
          provider: "n8n",
          leadId,
          eventId,
          eventType: requestedType,
        },
        "pending",
      );
      return res.status(202).json({
        queued: true,
        duplicate: !saved.inserted,
        eventId,
        status: saved.event.status,
      });
    } catch (error) {
      return sendError(res, error);
    }
  });

  app.post("/api/n8n/rule", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const settings = await readSettings(store, owner);
      if (!settings.baseUrl || !settings.webhookUrl)
        throw new N8nError(
          "N8N_NOT_CONFIGURED",
          "Önce n8n baseUrl ve üretim webhook hedefini kaydedin.",
          503,
        );
      requireApiKey();
      const input = ruleInput(req.body);
      const rule: Rule = RuleSchema.parse({
        id: `rule_${crypto.randomUUID()}`,
        name: input.name,
        triggerStage: input.triggerStage,
        ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
        action: "webhook",
        enabled: input.enabled,
        config: {
          provider: "n8n",
          url: settings.webhookUrl,
        },
      });
      const saved = await store.put("rule", rule.id, rule, owner);
      return res.status(201).json(saved.payload);
    } catch (error) {
      return sendError(res, error);
    }
  });
}

/**
 * Mount before the parent app's authenticated /api middleware. It owns its
 * body parser and never accepts a session cookie or n8n management key.
 */
export function registerN8nInboundRoute(
  app: Express,
  store: Store,
  processEventCallback?: N8nInboundProcessor,
): void {
  app.post(
    "/api/webhooks/n8n",
    express.json({ limit: "1mb" }),
    async (req, res) => {
      let owner = "";
      let saved: Awaited<ReturnType<Store["appendEvent"]>> | undefined;
      try {
        const key = requireApiKey();
        owner = await resolveInboundOwner(store);
        const expected = deriveN8nTokenFromKey(key, owner);
        if (!verifyN8nBearer(req, expected))
          return res.status(401).json({
            error: "UNAUTHORIZED",
            message: "Geçerli n8n webhook Bearer token gerekli.",
          });
        eventType(req.body);
        const rawBody = JSON.stringify(req.body);
        saved = await store.appendEvent(
          owner,
          eventKey("inbound", req.body, rawBody),
          {
            type: "webhook",
            provider: "inbound",
            origin: "n8n",
            payload: req.body,
          },
          "received",
        );
        if (saved.inserted) {
          if (processEventCallback)
            await processEventCallback(store, owner, req.body);
          await store.updateEvent(saved.event.id, owner, {
            status: "completed",
          });
        }
        return res.status(200).json({
          received: true,
          duplicate: !saved.inserted,
        });
      } catch (error) {
        if (saved && owner) {
          try {
            await store.updateEvent(saved.event.id, owner, {
              status: "failed",
              lastError:
                error instanceof N8nError
                  ? error.message
                  : "Inbound n8n olayı işlenemedi.",
            });
          } catch {
            /* Do not replace the sanitized request error with a persistence error. */
          }
        }
        return sendError(res, error);
      }
    },
  );
}
