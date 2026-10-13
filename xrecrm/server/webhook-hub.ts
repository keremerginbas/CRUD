import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { Lead, StoredEvent } from "./types.js";
import { rawStoreOf } from "./access.js";
import { forwardedOrigin } from "./auth.js";
import {
  assertSafeOutboundUrl,
  fetchWithTimeout,
  normalizePhone,
  signedOutboundHeaders,
  timingSafeEqualText,
} from "./security.js";
import { ActivitySchema, TaskSchema } from "./suite.js";
import { lines } from "../shared/lines.js";
import { announceRinging } from "./pbx.js";
import {
  INBOUND_ACTIONS,
  OUTBOUND_EVENTS,
  inboundActionIds,
  outboundEventIds,
  type InboundAction,
  type InboundHookView,
  type OutboundEvent,
  type OutboundHookView,
} from "../shared/webhook-hub.js";

const IN_KIND = "webhook-in";
const OUT_KIND = "webhook-out";

interface InboundHookRecord {
  id: string;
  name: string;
  actions: InboundAction[];
  enabled: boolean;
  tokenHash: string;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  lastError?: string;
}

interface OutboundHookRecord {
  id: string;
  name: string;
  url: string;
  events: OutboundEvent[];
  enabled: boolean;
  skipInboundEcho: boolean;
  secret: string;
  headers: { name: string; value: string }[];
  createdAt: string;
  updatedAt: string;
  lastDeliveryAt?: string;
  lastStatus?: number | null;
  lastError?: string;
  successCount: number;
  failureCount: number;
}

export interface WebhookHubDeps {
  ownerScope(store: Store): Promise<string>;
  processInboundWebhook(store: Store, owner: string, body: any): Promise<void>;
  ensureInboundLead(
    store: Store,
    owner: string,
    phone: string,
    name: string | undefined,
    source: string,
  ): Promise<Lead | null>;
  scheduleCallAnalysis?(store: Store, owner: string, callId: string): Promise<unknown>;
}

const now = () => new Date().toISOString();
const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const preview = (value: string) =>
  value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "••••";

function statusError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

// ---------------------------------------------------------------------------
// Olay yayıcı: kayıt yazımlarını izler ve abone giden webhooklara kuyruk açar.
// ---------------------------------------------------------------------------

const inboundOrigin = new AsyncLocalStorage<{ inboundHookId: string }>();
/** Şu anki yazım bir gelen webhooktan mı geliyor? (denetim günlüğü için) */
export function currentInboundHookId(): string | undefined {
  return inboundOrigin.getStore()?.inboundHookId;
}

const WATCHED_KINDS: Record<string, string> = {
  lead: "lead.",
  contacts: "contact.",
  companies: "company.",
  tasks: "task.",
  activities: "activity.",
  message: "message.",
  call: "call.",
};

const IGNORED_LEAD_FIELDS = new Set([
  "lastActivity",
  "stageTransitionToken",
  "updatedAt",
]);

const SECRET_KEY = /providerResult|^payload$|^raw|token|secret|password|apikey|api_key|^analysis$/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      result[key] = sanitize(item, depth + 1);
    }
    return result;
  }
  if (typeof value === "string") return value.slice(0, 20000);
  return value;
}

function isEnded(status: unknown) {
  return ["ended", "completed", "answered"].includes(String(status || ""));
}

/** Bir kayıt yazımından doğan olay tiplerini hesaplar. */
export function eventsForWrite(
  kind: string,
  old: any,
  next: any,
): { type: OutboundEvent; previous?: Record<string, unknown> }[] {
  const out: { type: OutboundEvent; previous?: Record<string, unknown> }[] = [];
  if (!next || typeof next !== "object") return out;
  switch (kind) {
    case "lead": {
      if (!old) return [{ type: "lead.created" }];
      const stageChanged =
        old.stage !== next.stage ||
        (old.pipelineId || "sales") !== (next.pipelineId || "sales");
      if (stageChanged)
        out.push({
          type: "lead.stage_changed",
          previous: { stage: old.stage, pipelineId: old.pipelineId || "sales" },
        });
      const changed = Object.keys({ ...old, ...next }).filter(
        (key) =>
          !IGNORED_LEAD_FIELDS.has(key) &&
          key !== "stage" &&
          key !== "pipelineId" &&
          JSON.stringify(old[key]) !== JSON.stringify(next[key]),
      );
      if (changed.length)
        out.push({
          type: "lead.updated",
          previous: Object.fromEntries(
            changed.map((key) => [key, old[key] ?? null]),
          ),
        });
      return out;
    }
    case "contacts":
      return old ? [] : [{ type: "contact.created" }];
    case "companies":
      return old ? [] : [{ type: "company.created" }];
    case "tasks":
      if (!old) out.push({ type: "task.created" });
      if (next.status === "done" && old?.status !== "done")
        out.push({ type: "task.completed" });
      return out;
    case "activities":
      if (!old) out.push({ type: "activity.created" });
      if (next.completed && !old?.completed)
        out.push({ type: "activity.completed" });
      return out;
    case "message": {
      if (old) return [];
      const inbound = next.direction === "inbound" || next.direction === "in";
      return [{ type: inbound ? "message.received" : "message.sent" }];
    }
    case "call": {
      const missed = next.status === "missed";
      if (missed && old?.status !== "missed") return [{ type: "call.missed" }];
      if (isEnded(next.status) && !isEnded(old?.status))
        return [{ type: "call.ended" }];
      if (!old && !missed) return [{ type: "call.created" }];
      return [];
    }
  }
  return out;
}

const EVENT_LABELS = Object.fromEntries(
  OUTBOUND_EVENTS.map((e) => [e.id, e.label]),
) as Record<OutboundEvent, string>;

async function queueDeliveries(
  target: Store,
  owner: string,
  kind: string,
  id: string,
  old: any,
  next: any,
  hooks: OutboundHookRecord[],
) {
  const events = eventsForWrite(kind, old, next);
  if (!events.length) return;
  const origin = inboundOrigin.getStore();
  const leadId = kind === "lead" ? id : String(next.leadId || "");
  let lead: Record<string, unknown> | undefined;
  if (kind !== "lead" && leadId) {
    const row = (await target.get<Lead>("lead", leadId, owner))?.payload;
    if (row)
      lead = {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        stage: row.stage,
        owner: row.owner,
        pipelineId: row.pipelineId || "sales",
      };
  }
  for (const event of events)
    for (const hook of hooks) {
      if (!hook.enabled || !hook.events.includes(event.type)) continue;
      if (origin && hook.skipInboundEcho) continue;
      await target.appendEvent(
        owner,
        `hook:${hook.id}:${crypto.randomUUID()}`,
        {
          type: "hook-delivery",
          title: `Giden webhook · ${EVENT_LABELS[event.type]}`,
          detail: `${hook.name} → ${event.type}`,
          hookId: hook.id,
          eventType: event.type,
          entityKind: kind,
          entityId: id,
          leadId: leadId || null,
          data: sanitize(next),
          ...(event.previous ? { previous: sanitize(event.previous) } : {}),
          ...(lead ? { lead } : {}),
          ...(origin ? { origin: { inboundHookId: origin.inboundHookId } } : {}),
          occurredAt: now(),
        },
        "pending",
      );
    }
}

export function webhookEmitterStore(base: Store): Store {
  return new Proxy(base, {
    get(target, key) {
      if (key === "put" || key === "insertIfAbsent")
        return async (kind: string, id: string, payload: any, owner: string) => {
          const prefix = WATCHED_KINDS[kind];
          const write = () =>
            key === "put"
              ? target.put(kind, id, payload, owner)
              : target.insertIfAbsent(kind, id, payload, owner);
          if (!prefix) return write();
          let hooks: OutboundHookRecord[] = [];
          try {
            hooks = (await target.list<OutboundHookRecord>(OUT_KIND, owner))
              .map((row) => row.payload)
              .filter(
                (hook) =>
                  hook.enabled && hook.events.some((e) => e.startsWith(prefix)),
              );
          } catch {
            hooks = [];
          }
          if (!hooks.length) return write();
          const old = (await target.get<any>(kind, id, owner))?.payload;
          const result: any = await write();
          if (key === "insertIfAbsent" && !result?.inserted) return result;
          try {
            await queueDeliveries(target, owner, kind, id, old, payload, hooks);
          } catch (error) {
            console.warn(
              "Giden webhook kuyruğa alınamadı:",
              error instanceof Error ? error.message : error,
            );
          }
          return result;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

// ---------------------------------------------------------------------------
// Giden teslimat
// ---------------------------------------------------------------------------

function outboundBody(
  deliveryId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  return JSON.stringify({
    id: deliveryId,
    event: eventType,
    occurredAt: payload.occurredAt || now(),
    source: "xre-crm",
    entity: payload.entityKind
      ? { kind: payload.entityKind, id: payload.entityId }
      : undefined,
    data: payload.data ?? {},
    previous: payload.previous,
    lead: payload.lead,
    origin: payload.origin,
  });
}

async function postToHook(
  hook: OutboundHookRecord,
  deliveryId: string,
  eventType: string,
  body: string,
): Promise<{ status: number; durationMs: number; response: string }> {
  const started = Date.now();
  const headers: Record<string, string> = {
    ...signedOutboundHeaders(body, hook.secret),
    "user-agent": "XRE-CRM-Webhook/1.0",
    "x-xre-event": eventType,
    "x-xre-delivery": deliveryId,
    "x-xre-hook-id": hook.id,
  };
  for (const header of hook.headers) headers[header.name.toLowerCase()] = header.value;
  const response = await fetchWithTimeout(hook.url, {
    method: "POST",
    headers,
    body,
  });
  const text = (await response.text()).slice(0, 500);
  return { status: response.status, durationMs: Date.now() - started, response: text };
}

async function recordDelivery(
  store: Store,
  owner: string,
  hook: OutboundHookRecord,
  status: number | null,
  error?: string,
) {
  const latest =
    (await store.get<OutboundHookRecord>(OUT_KIND, hook.id, owner))?.payload || hook;
  await store.put(
    OUT_KIND,
    hook.id,
    {
      ...latest,
      lastDeliveryAt: now(),
      lastStatus: status,
      lastError: error ? error.slice(0, 500) : undefined,
      successCount: latest.successCount + (error ? 0 : 1),
      failureCount: latest.failureCount + (error ? 1 : 0),
    },
    owner,
  );
}

/** Outbox çalışanı tarafından çağrılır. */
export async function deliverHookEvent(
  store: Store,
  event: StoredEvent,
): Promise<Record<string, unknown>> {
  const raw = rawStoreOf(store);
  const owner = event.ownerOpenId;
  const payload = event.payload;
  const hook = (
    await raw.get<OutboundHookRecord>(OUT_KIND, String(payload.hookId || ""), owner)
  )?.payload;
  if (!hook) return { skipped: true, reason: "Giden webhook silinmiş." };
  if (!hook.enabled) return { skipped: true, reason: "Giden webhook pasif." };
  const eventType = String(payload.eventType || "");
  if (!hook.events.includes(eventType as OutboundEvent))
    return { skipped: true, reason: "Webhook artık bu olaya abone değil." };
  const body = outboundBody(`dlv_${event.id}`, eventType, payload);
  try {
    const result = await postToHook(hook, `dlv_${event.id}`, eventType, body);
    if (result.status < 200 || result.status >= 300) {
      await recordDelivery(raw, owner, hook, result.status, `HTTP ${result.status}`);
      throw Object.assign(
        new Error(`Webhook hedefi HTTP ${result.status} döndürdü.`),
        { providerStatus: result.status, statusCode: 502 },
      );
    }
    await recordDelivery(raw, owner, hook, result.status);
    return { delivered: true, status: result.status };
  } catch (error) {
    if (!(error as any)?.providerStatus)
      await recordDelivery(
        raw,
        owner,
        hook,
        null,
        error instanceof Error ? error.message : String(error),
      );
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Gelen webhook işlemleri
// ---------------------------------------------------------------------------

const leadFields = [
  "name",
  "phone",
  "email",
  "company",
  "source",
  "notes",
  "value",
  "owner",
  "city",
  "pipelineId",
  "stage",
  "tags",
  "dealTitle",
  "appointmentAt",
  "expectedCloseDate",
  "probability",
  "customFields",
] as const;

function pickLead(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of leadFields) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (key === "value" || key === "probability") {
      const n = Number(value);
      if (Number.isFinite(n)) result[key] = n;
    } else if (key === "tags")
      result[key] = Array.isArray(value)
        ? value.map(String).slice(0, 100)
        : String(value).split(",").map((t) => t.trim()).filter(Boolean);
    else if (key === "customFields" && typeof value === "object")
      result[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k.slice(0, 120),
          String(v ?? "").slice(0, 2000),
        ]),
      );
    else result[key] = String(value);
  }
  return result;
}

async function findLeadBy(
  store: Store,
  owner: string,
  input: Record<string, unknown>,
): Promise<Lead | null> {
  const id = String(input.id || input.leadId || "").trim();
  if (id) return (await store.get<Lead>("lead", id, owner))?.payload || null;
  const phone = normalizePhone(input.phone);
  const email = String(input.email || "").trim().toLowerCase();
  if (!phone && !email) return null;
  const leads = (await store.list<Lead>("lead", owner)).map((r) => r.payload);
  return (
    leads.find(
      (lead) =>
        (phone && normalizePhone(lead.phone) === phone) ||
        (email && String(lead.email || "").toLowerCase() === email),
    ) || null
  );
}

function leadSummary(lead: Lead | null) {
  return lead
    ? {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        company: lead.company,
        stage: lead.stage,
        pipelineId: lead.pipelineId || "sales",
        owner: lead.owner,
        source: lead.source,
        city: lead.city || "",
        value: lead.value,
        appointmentAt: lead.appointmentAt || "",
        createdAt: lead.createdAt,
        lastActivity: lead.lastActivity,
      }
    : null;
}

async function requireLead(store: Store, owner: string, input: Record<string, unknown>) {
  const lead = await findLeadBy(store, owner, input);
  if (!lead) throw statusError(404, "Müşteri bulunamadı (id, phone veya email gönderin).");
  return lead;
}

function isoOr(value: unknown, fallback: string) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) throw statusError(400, `Geçersiz tarih: ${String(value)}`);
  return new Date(parsed).toISOString();
}

function lineIdFor(input: Record<string, unknown>): string {
  const direct = String(input.lineId || "").trim();
  if (direct && lines.some((line) => line.id === direct)) return direct;
  const dialed = normalizePhone(input.line || input.did || input.lineNumber || "");
  if (!dialed) return direct;
  return lines.find((line) => normalizePhone(line.phone) === dialed)?.id || direct;
}

function callStatus(raw: unknown): string {
  const value = String(raw || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (["missed", "no-answer", "noanswer", "busy", "unanswered", "cancel", "canceled", "cancelled", "failed"].includes(value))
    return "missed";
  if (["answered", "completed", "ended", "success"].includes(value)) return "ended";
  if (["ringing", "in-progress", "queued", "started"].includes(value)) return value;
  return value || "ended";
}

export async function runInboundAction(
  store: Store,
  owner: string,
  hook: { id: string; name: string },
  action: InboundAction,
  input: Record<string, unknown>,
  deps: WebhookHubDeps,
): Promise<Record<string, unknown>> {
  switch (action) {
    case "lead.find": {
      const lead = await findLeadBy(store, owner, input);
      return { found: Boolean(lead), lead: leadSummary(lead) };
    }
    case "lead.create": {
      const fields = pickLead(input);
      if (!fields.name && !fields.phone)
        throw statusError(400, "Müşteri için en az name veya phone gerekli.");
      if (input.dedupe !== false && (fields.phone || fields.email)) {
        const existing = await findLeadBy(store, owner, {
          phone: fields.phone,
          email: fields.email,
        });
        if (existing)
          return { leadId: existing.id, duplicate: true, lead: leadSummary(existing) };
      }
      const id = `lead-${crypto.randomUUID()}`;
      await deps.processInboundWebhook(store, owner, {
        type: "lead.created",
        lead: {
          ...fields,
          id,
          name: String(fields.name || fields.phone),
          source: String(fields.source || hook.name),
        },
      });
      return {
        leadId: id,
        duplicate: false,
        lead: leadSummary((await store.get<Lead>("lead", id, owner))?.payload || null),
      };
    }
    case "lead.update": {
      const lead = await requireLead(store, owner, input);
      const fields = pickLead(
        (input.fields && typeof input.fields === "object"
          ? input.fields
          : input) as Record<string, unknown>,
      );
      if (input.fields === undefined) {
        // Arama anahtarı olarak gönderilen telefon/e-posta alanı değişiklik sayılmaz.
        if (!input.id && !input.leadId) delete fields.phone;
      }
      await deps.processInboundWebhook(store, owner, {
        type: "lead.updated",
        lead: { ...fields, id: lead.id },
      });
      return {
        leadId: lead.id,
        lead: leadSummary((await store.get<Lead>("lead", lead.id, owner))?.payload || null),
      };
    }
    case "lead.stage": {
      const lead = await requireLead(store, owner, input);
      const stage = String(input.stage || input.toStage || "");
      if (!["new", "contacted", "qualified", "proposal", "won", "lost"].includes(stage))
        throw statusError(400, "stage: new, contacted, qualified, proposal, won veya lost olmalı.");
      await deps.processInboundWebhook(store, owner, {
        type: "stage.changed",
        lead: {
          id: lead.id,
          stage,
          ...(input.appointmentAt ? { appointmentAt: isoOr(input.appointmentAt, "") } : {}),
          ...(input.lostReason ? { lostReason: String(input.lostReason) } : {}),
        },
      });
      return { leadId: lead.id, fromStage: lead.stage, toStage: stage };
    }
    case "note.add": {
      const lead = await requireLead(store, owner, input);
      const text = String(input.text || input.note || "").trim();
      if (!text) throw statusError(400, "Not metni (text) gerekli.");
      const stamp = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
      const notes = `${lead.notes ? `${lead.notes}\n` : ""}[${stamp} · ${hook.name}] ${text}`.slice(-10000);
      await deps.processInboundWebhook(store, owner, {
        type: "lead.updated",
        lead: { id: lead.id, notes },
      });
      return { leadId: lead.id };
    }
    case "task.create": {
      const lead = input.leadId || input.phone ? await findLeadBy(store, owner, input) : null;
      if ((input.leadId || input.phone) && !lead)
        throw statusError(404, "Görevin bağlanacağı müşteri bulunamadı.");
      const stamp = now();
      const task = TaskSchema.parse({
        id: `task-${crypto.randomUUID()}`,
        title: String(input.title || "").trim(),
        description: String(input.description || ""),
        status: "todo",
        priority: ["low", "normal", "high"].includes(String(input.priority))
          ? input.priority
          : "normal",
        assignee: String(input.assignee || lead?.owner || ""),
        leadId: lead?.id || "",
        dueAt: input.dueAt ? isoOr(input.dueAt, "") : "",
        checklist: [],
        createdAt: stamp,
        updatedAt: stamp,
      });
      await store.put("tasks", task.id, task, owner);
      return { taskId: task.id, leadId: task.leadId || null };
    }
    case "activity.create": {
      const lead = input.leadId || input.phone ? await findLeadBy(store, owner, input) : null;
      if ((input.leadId || input.phone) && !lead)
        throw statusError(404, "Etkinliğin bağlanacağı müşteri bulunamadı.");
      const stamp = now();
      const startAt = isoOr(input.startAt, "");
      if (!startAt) throw statusError(400, "startAt (ISO tarih-saat) gerekli.");
      const activity = ActivitySchema.parse({
        id: `activity-${crypto.randomUUID()}`,
        leadId: lead?.id || "",
        type: ["call", "meeting", "task"].includes(String(input.type)) ? input.type : "call",
        title: String(input.title || "").trim() || "Webhook etkinliği",
        description: String(input.description || ""),
        startAt,
        endAt: isoOr(input.endAt, new Date(Date.parse(startAt) + 30 * 60000).toISOString()),
        assignee: String(input.assignee || lead?.owner || ""),
        completed: input.completed === true,
        createdAt: stamp,
        updatedAt: stamp,
      });
      await store.put("activities", activity.id, activity, owner);
      return { activityId: activity.id, leadId: activity.leadId || null };
    }
    case "call.log": {
      const phone = normalizePhone(input.phone || input.from || input.to || input.caller);
      if (!phone) throw statusError(400, "Arama için müşteri telefonu (phone) gerekli.");
      const direction = String(input.direction || "inbound").toLowerCase().startsWith("out")
        ? "outbound"
        : "inbound";
      let lead = await findLeadBy(store, owner, { phone });
      let createdLead = false;
      if (!lead && input.createLead !== false) {
        lead = await deps.ensureInboundLead(
          store,
          owner,
          phone,
          input.name ? String(input.name) : undefined,
          "Telefon",
        );
        createdLead = Boolean(lead);
      }
      const providerId = String(input.callId || input.uniqueId || input.uniqueid || "").replace(/[^\w.:-]/g, "").slice(0, 120);
      const id = `pbx-${providerId || crypto.randomUUID()}`;
      const existing = (await store.get<any>("call", id, owner))?.payload;
      const startedAt = isoOr(input.startedAt, existing?.startedAt || now());
      const duration = Number(input.durationSeconds ?? input.duration ?? input.billsec);
      const recording = String(input.recordingUrl || "");
      const stamp = now();
      await store.put(
        "call",
        id,
        {
          ...(existing || {}),
          id,
          leadId: lead?.id || existing?.leadId || null,
          lineId: lineIdFor(input) || existing?.lineId || null,
          provider: String(input.provider || "pbx").slice(0, 40),
          direction,
          status: callStatus(input.status || input.disposition),
          agent: input.agent ? String(input.agent).slice(0, 191) : existing?.agent || null,
          phone,
          durationSeconds: Number.isFinite(duration) ? Math.max(0, duration) : existing?.durationSeconds ?? null,
          startedAt,
          endedAt: input.endedAt ? isoOr(input.endedAt, "") : existing?.endedAt || null,
          recording: /^https?:\/\//i.test(recording) ? recording.slice(0, 2048) : existing?.recording || null,
          summary: input.summary ? String(input.summary).slice(0, 10000) : existing?.summary || null,
          transcript: input.transcript ? String(input.transcript).slice(0, 100000) : existing?.transcript || null,
          createdAt: existing?.createdAt || stamp,
          updatedAt: stamp,
        },
        owner,
      );
      if (input.transcript && deps.scheduleCallAnalysis)
        await deps.scheduleCallAnalysis(store, owner, id).catch(() => undefined);
      return { callId: id, leadId: lead?.id || null, createdLead };
    }
    case "call.ringing": {
      const phone = normalizePhone(input.phone || input.from || input.caller);
      if (!phone) throw statusError(400, "Arayan numara (phone) gerekli.");
      const result = await announceRinging(store, owner, {
        phone,
        ext: input.ext ? String(input.ext).replace(/\D/g, "").slice(0, 6) : undefined,
        lineId: lineIdFor(input) || undefined,
        direction: String(input.direction || "inbound").startsWith("out") ? "outbound" : "inbound",
        id: input.callId ? String(input.callId).slice(0, 120) : undefined,
      });
      return { ...result, phone };
    }
    case "message.log": {
      const phone = normalizePhone(input.phone || input.from || input.to);
      const text = String(input.text || input.body || "").trim();
      if (!phone || !text) throw statusError(400, "Mesaj için phone ve text gerekli.");
      const direction = String(input.direction || "inbound").toLowerCase().startsWith("out")
        ? "outbound"
        : "inbound";
      let lead = await findLeadBy(store, owner, { phone });
      if (!lead && input.createLead !== false && direction === "inbound")
        lead = await deps.ensureInboundLead(
          store,
          owner,
          phone,
          input.name ? String(input.name) : undefined,
          String(input.channel || "Mesaj"),
        );
      const id = `ext-${String(input.messageId || "").replace(/[^\w.:-]/g, "").slice(0, 120) || crypto.randomUUID()}`;
      const result = await store.insertIfAbsent(
        "message",
        id,
        {
          id,
          leadId: lead?.id || null,
          lineId: lineIdFor(input) || null,
          provider: String(input.channel || "external").slice(0, 40),
          direction,
          type: "text",
          text: text.slice(0, 10000),
          status: direction === "inbound" ? "received" : "sent",
          createdAt: isoOr(input.createdAt, now()),
        },
        owner,
      );
      return { messageId: id, leadId: lead?.id || null, duplicate: !result.inserted };
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP rotaları
// ---------------------------------------------------------------------------

const rateWindows = new Map<string, { start: number; count: number }>();
function rateLimited(hookId: string, limit = 120): boolean {
  const current = Date.now();
  const window = rateWindows.get(hookId);
  if (!window || current - window.start > 60_000) {
    rateWindows.set(hookId, { start: current, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > limit;
}

function viewInbound(hook: InboundHookRecord): InboundHookView {
  return {
    id: hook.id,
    name: hook.name,
    actions: hook.actions,
    enabled: hook.enabled,
    tokenPreview: hook.tokenPreview,
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
    lastUsedAt: hook.lastUsedAt,
    useCount: hook.useCount,
    lastError: hook.lastError,
  };
}

function viewOutbound(hook: OutboundHookRecord): OutboundHookView {
  return {
    id: hook.id,
    name: hook.name,
    url: hook.url,
    events: hook.events,
    enabled: hook.enabled,
    skipInboundEcho: hook.skipInboundEcho,
    headers: hook.headers.map((h) => ({ name: h.name, valuePreview: preview(h.value) })),
    secretPreview: preview(hook.secret),
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
    lastDeliveryAt: hook.lastDeliveryAt,
    lastStatus: hook.lastStatus,
    lastError: hook.lastError,
    successCount: hook.successCount,
    failureCount: hook.failureCount,
  };
}

const nameSchema = z.string().trim().min(1, "Ad gerekli.").max(120);
const inboundCreateSchema = z.object({
  name: nameSchema,
  actions: z.array(z.enum(inboundActionIds as [InboundAction, ...InboundAction[]])).min(1, "En az bir işlem seçin.").max(20),
});
const inboundPatchSchema = inboundCreateSchema.partial().extend({ enabled: z.boolean().optional() });
const headerSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, "Başlık adı yalnız harf, rakam ve tire içerebilir.")
    .refine((n) => !/^(host|content-length|content-type|x-xre-.*|connection|transfer-encoding)$/i.test(n), "Bu başlık değiştirilemez."),
  value: z.string().max(2000),
});
const outboundCreateSchema = z.object({
  name: nameSchema,
  url: z.string().trim().url("Geçerli URL girin.").max(2048),
  events: z.array(z.enum(outboundEventIds as [OutboundEvent, ...OutboundEvent[]])).min(1, "En az bir olay seçin.").max(50),
  headers: z.array(headerSchema).max(5).optional(),
  skipInboundEcho: z.boolean().optional(),
});
const outboundPatchSchema = outboundCreateSchema.partial().extend({
  enabled: z.boolean().optional(),
  // Var olan başlık değerini korumak için boş value gönderilebilir.
  headers: z.array(headerSchema.extend({ value: z.string().max(2000).optional() })).max(5).optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw statusError(400, result.error.issues[0]?.message || "Geçersiz istek.");
  return result.data;
}

function sendError(res: Response, error: unknown) {
  const status = Number((error as any)?.statusCode) || 500;
  const safe = status >= 400 && status < 500;
  res.status(status).json({
    error: safe ? "REQUEST_FAILED" : "SERVER_ERROR",
    message: safe || status === 502 || status === 503
      ? error instanceof Error ? error.message : String(error)
      : "Beklenmeyen sunucu hatası.",
  });
}

function ownerOf(req: Request): string {
  return (req as any).auth.ownerOpenId;
}

function publicOrigin(req: Request): string {
  return (process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, "") || forwardedOrigin(req) || "");
}

/** Kimlik doğrulamasından ÖNCE bağlanmalıdır: dış sistemler token ile çağırır. */
export function registerHookInboundRoute(app: Express, store: Store, deps: WebhookHubDeps) {
  const raw = rawStoreOf(store);
  app.post(
    ["/api/hooks/in/:hookId/:token", "/api/hooks/in/:hookId/:token/:action"],
    express.json({ limit: "1mb" }),
    async (req: Request, res: Response) => {
      let owner = "";
      let hook: InboundHookRecord | undefined;
      try {
        owner = await deps.ownerScope(store);
        hook = (await raw.get<InboundHookRecord>(IN_KIND, String(req.params.hookId), owner))?.payload;
        if (!hook || !timingSafeEqualText(sha256(String(req.params.token || "")), hook.tokenHash))
          return res.status(401).json({ error: "UNAUTHORIZED", message: "Webhook adresi veya anahtarı geçersiz." });
        if (!hook.enabled)
          return res.status(403).json({ error: "DISABLED", message: "Bu gelen webhook pasif." });
        if (rateLimited(hook.id))
          return res.status(429).json({ error: "RATE_LIMITED", message: "Dakikada en fazla 120 istek." });
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const action = String(req.params.action || body.action || "") as InboundAction;
        if (!inboundActionIds.includes(action))
          return res.status(400).json({
            error: "UNKNOWN_ACTION",
            message: `action şunlardan biri olmalı: ${inboundActionIds.join(", ")}`,
          });
        if (!hook.actions.includes(action))
          return res.status(403).json({ error: "SCOPE", message: `Bu webhook ${action} işlemine yetkili değil.` });
        const input = (body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body) as Record<string, unknown>;
        const idempotency = String(req.get("x-idempotency-key") || body.eventId || "").slice(0, 120);
        const readOnly = action === "lead.find" || action === "call.ringing";
        let logged: Awaited<ReturnType<Store["appendEvent"]>> | undefined;
        if (!readOnly) {
          logged = await raw.appendEvent(
            owner,
            `hook-in:${hook.id}:${idempotency || crypto.randomUUID()}`,
            {
              type: "hook-inbound",
              title: `Gelen webhook · ${INBOUND_ACTIONS.find((a) => a.id === action)?.label}`,
              detail: hook.name,
              hookId: hook.id,
              action,
              createdAt: now(),
            },
            "received",
          );
          if (!logged.inserted)
            return res.json({ ok: true, duplicate: true, result: (logged.event.payload as any).result || null });
        }
        const hookRef = { id: hook.id, name: hook.name };
        const result = await inboundOrigin.run({ inboundHookId: hook.id }, () =>
          runInboundAction(store, owner, hookRef, action, input, deps),
        );
        if (logged)
          await raw.updateEvent(logged.event.id, owner, {
            status: "completed",
            payload: { ...logged.event.payload, leadId: (result as any).leadId || null, result: { ...result, lead: undefined, completed: true } },
          });
        await raw.put(IN_KIND, hook.id, { ...hook, lastUsedAt: now(), useCount: hook.useCount + 1, lastError: undefined }, owner);
        return res.json({ ok: true, action, result });
      } catch (error) {
        if (hook && owner)
          await raw
            .put(IN_KIND, hook.id, { ...hook, lastUsedAt: now(), useCount: hook.useCount + 1, lastError: error instanceof Error ? error.message.slice(0, 300) : "Hata" }, owner)
            .catch(() => undefined);
        return sendError(res, error);
      }
    },
  );
}

export function registerWebhookHubRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const listIn = async (owner: string) =>
    (await raw.list<InboundHookRecord>(IN_KIND, owner)).map((r) => r.payload);
  const listOut = async (owner: string) =>
    (await raw.list<OutboundHookRecord>(OUT_KIND, owner)).map((r) => r.payload);
  const getIn = async (owner: string, id: string) => {
    const hook = (await raw.get<InboundHookRecord>(IN_KIND, id, owner))?.payload;
    if (!hook) throw statusError(404, "Gelen webhook bulunamadı.");
    return hook;
  };
  const getOut = async (owner: string, id: string) => {
    const hook = (await raw.get<OutboundHookRecord>(OUT_KIND, id, owner))?.payload;
    if (!hook) throw statusError(404, "Giden webhook bulunamadı.");
    return hook;
  };
  const wrap =
    (handler: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        await handler(req, res);
      } catch (error) {
        sendError(res, error);
      }
    };

  app.get("/api/webhook-hub", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const [inbound, outbound] = await Promise.all([listIn(owner), listOut(owner)]);
    res.json({
      origin: publicOrigin(req),
      inbound: inbound.map(viewInbound),
      outbound: outbound.map(viewOutbound),
      actions: INBOUND_ACTIONS,
      events: OUTBOUND_EVENTS,
      allowPrivateHosts: (process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
    });
  }));

  app.post("/api/webhook-hub/inbound", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const input = parse(inboundCreateSchema, req.body);
    const token = crypto.randomBytes(24).toString("base64url");
    const stamp = now();
    const hook: InboundHookRecord = {
      id: `in${crypto.randomBytes(6).toString("hex")}`,
      name: input.name,
      actions: [...new Set(input.actions)],
      enabled: true,
      tokenHash: sha256(token),
      tokenPreview: preview(token),
      createdAt: stamp,
      updatedAt: stamp,
      useCount: 0,
    };
    await raw.put(IN_KIND, hook.id, hook, owner);
    res.status(201).json({ hook: viewInbound(hook), token });
  }));

  app.patch("/api/webhook-hub/inbound/:id", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const hook = await getIn(owner, String(req.params.id));
    const input = parse(inboundPatchSchema, req.body);
    const next: InboundHookRecord = {
      ...hook,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.actions !== undefined ? { actions: [...new Set(input.actions)] } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: now(),
    };
    await raw.put(IN_KIND, hook.id, next, owner);
    res.json({ hook: viewInbound(next) });
  }));

  app.post("/api/webhook-hub/inbound/:id/rotate", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const hook = await getIn(owner, String(req.params.id));
    const token = crypto.randomBytes(24).toString("base64url");
    const next = { ...hook, tokenHash: sha256(token), tokenPreview: preview(token), updatedAt: now() };
    await raw.put(IN_KIND, hook.id, next, owner);
    res.json({ hook: viewInbound(next), token });
  }));

  app.delete("/api/webhook-hub/inbound/:id", wrap(async (req, res) => {
    const owner = ownerOf(req);
    await getIn(owner, String(req.params.id));
    await raw.delete(IN_KIND, String(req.params.id), owner);
    res.json({ deleted: true });
  }));

  app.post("/api/webhook-hub/outbound", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const input = parse(outboundCreateSchema, req.body);
    await assertSafeOutboundUrl(input.url).catch((error) => {
      throw statusError(400, error.message);
    });
    const stamp = now();
    const hook: OutboundHookRecord = {
      id: `out${crypto.randomBytes(6).toString("hex")}`,
      name: input.name,
      url: input.url,
      events: [...new Set(input.events)],
      enabled: true,
      skipInboundEcho: input.skipInboundEcho ?? true,
      secret: crypto.randomBytes(32).toString("hex"),
      headers: (input.headers || []).filter((h) => h.value),
      createdAt: stamp,
      updatedAt: stamp,
      successCount: 0,
      failureCount: 0,
    };
    await raw.put(OUT_KIND, hook.id, hook, owner);
    res.status(201).json({ hook: viewOutbound(hook), secret: hook.secret });
  }));

  app.patch("/api/webhook-hub/outbound/:id", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const hook = await getOut(owner, String(req.params.id));
    const input = parse(outboundPatchSchema, req.body);
    if (input.url !== undefined && input.url !== hook.url)
      await assertSafeOutboundUrl(input.url).catch((error) => {
        throw statusError(400, error.message);
      });
    const headers =
      input.headers === undefined
        ? hook.headers
        : input.headers
            .map((h) => ({
              name: h.name,
              value: h.value || hook.headers.find((old) => old.name.toLowerCase() === h.name.toLowerCase())?.value || "",
            }))
            .filter((h) => h.value);
    const next: OutboundHookRecord = {
      ...hook,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.events !== undefined ? { events: [...new Set(input.events)] } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.skipInboundEcho !== undefined ? { skipInboundEcho: input.skipInboundEcho } : {}),
      headers,
      updatedAt: now(),
    };
    await raw.put(OUT_KIND, hook.id, next, owner);
    res.json({ hook: viewOutbound(next) });
  }));

  app.post("/api/webhook-hub/outbound/:id/secret", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const hook = await getOut(owner, String(req.params.id));
    if (req.body?.rotate === true) {
      const next = { ...hook, secret: crypto.randomBytes(32).toString("hex"), updatedAt: now() };
      await raw.put(OUT_KIND, hook.id, next, owner);
      return res.json({ secret: next.secret, rotated: true });
    }
    res.json({ secret: hook.secret, rotated: false });
  }));

  app.post("/api/webhook-hub/outbound/:id/test", wrap(async (req, res) => {
    const owner = ownerOf(req);
    const hook = await getOut(owner, String(req.params.id));
    const deliveryId = `test_${crypto.randomUUID()}`;
    const body = outboundBody(deliveryId, "ping", {
      occurredAt: now(),
      data: { message: "XRE CRM test olayı", hook: { id: hook.id, name: hook.name }, subscribedEvents: hook.events },
    });
    try {
      const result = await postToHook(hook, deliveryId, "ping", body);
      const ok = result.status >= 200 && result.status < 300;
      await recordDelivery(raw, owner, hook, result.status, ok ? undefined : `HTTP ${result.status}`);
      res.json({ ok, status: result.status, durationMs: result.durationMs, response: result.response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordDelivery(raw, owner, hook, null, message);
      res.json({ ok: false, status: null, error: message });
    }
  }));

  app.delete("/api/webhook-hub/outbound/:id", wrap(async (req, res) => {
    const owner = ownerOf(req);
    await getOut(owner, String(req.params.id));
    await raw.delete(OUT_KIND, String(req.params.id), owner);
    res.json({ deleted: true });
  }));
}
