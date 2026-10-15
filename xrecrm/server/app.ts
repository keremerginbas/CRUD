import { nextTurkeyBusinessHoursSlot } from "../shared/automation-policy.js";
import {
  planAutomationRule,
  recheckAutomationPolicyForWorker,
} from "./automation-planning.js";
import { registerCrmWorkspaceRoutes } from "./crm-workspace.js";
import { registerCrmImportRoutes } from "./crm-import.js";
import { registerAutomationPlanningRoutes } from "./automation-planning.js";
import { stagePolicyStore } from "./crm-stage-policy.js";
import { getVapiCatalog } from "./vapi-catalog.js";
import { registerPreferenceRoutes } from "./preferences.js";
import { registerGoogleCalendarRoutes } from "./google-calendar.js";
import { requireModulePermissions } from "./api-permissions.js";
import {
  rawStoreOf,
  ownsLead,
  currentPermissionContext,
  resolveAuthContext,
  canAccess,
  createPermissionStore,
  registerAccessRoutes,
} from "./access.js";
import { registerWorktimeRoutes } from "./worktime.js";
import { appointmentStore, registerAppointmentRoutes } from "./appointments.js";
import {
  scheduleConversationAnalysis,
  processConversationAnalysisEvent,
  registerConversationAnalysisRoutes,
} from "./conversation-analysis.js";
import { registerN8nReportRoutes } from "./n8n-reports.js";
import { registerAssistantRoutes } from "./assistant.js";
import {
  registerN8nRoutes,
  registerN8nInboundRoute,
  deliverN8nEvent,
  deliverN8nWebhook,
} from "./n8n.js";
import crypto from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
  type Express,
} from "express";
import { z } from "zod";
import { createStore, type Store } from "./db.js";
import {
  clearSession,
  handleCallback,
  handleLogin,
  requireAuth,
  verifyRequestSession,
  verifySessionIdentity,
} from "./auth.js";
import {
  createVapiCall,
  evolutionConnectionState,
  getEvolutionQr,
  jidPhone,
  providerConfigured,
  sendEvolutionText,
  sendMetaText,
  testProvider,
} from "./integrations.js";
import {
  bearerMatches,
  envConfigured,
  fetchWithTimeout,
  normalizePhone,
  readJsonResponse,
  signedOutboundHeaders,
  verifyHmac,
} from "./security.js";
import {
  LeadSchema,
  LeadStage,
  RuleSchema,
  type AuthContext,
  type Lead,
  type Provider,
  type Rule,
  type StoredEvent,
} from "./types.js";
import { verifyBitrixContext } from "./bitrix.js";
import { lines } from "../shared/lines.js";
import { registerLocalAccountRoutes, registerLocalAuthRoutes } from "./local-auth.js";
import { registerQrApproveRoute, registerSocialAuthRoutes } from "./social-auth.js";
import { registerBitrixAppRoutes } from "./bitrix-app.js";
import { handleConnectorEvolution, isConnectorInstance, registerB24ConnectorRoutes } from "./b24-connector.js";
import { registerBitrixImportRoutes } from "./bitrix-import.js";
import { registerIntegrationSettingsRoutes } from "./integration-settings.js";
import { registerPbxRoutes, startPbxSupervisor } from "./pbx.js";
import { loadLineInventoryFromStore, registerLineInventoryRoutes } from "./line-inventory.js";
import { STAGE_KIND, auditStore, registerAuditRoutes } from "./audit.js";
import { registerBackupRoutes, startBackupScheduler } from "./backup.js";
import { liveNotifyStore } from "./live-notify.js";
import { guardOutbound, lineProvider, registerWhatsappChatRoutes } from "./whatsapp-chat.js";
import { loadIntegrationSettings } from "./integration-settings.js";
import {
  isWaSystemMessage,
  unwrapWaMessage,
  waContentKey,
  waMessageText,
  captureEvolutionMedia,
  captureMetaMedia,
  registerMediaBodyParser,
  registerMediaRoutes,
  stripMediaPayload,
} from "./whatsapp-media.js";
import { runInboundAction } from "./webhook-hub.js";
import {
  deliverHookEvent,
  registerHookInboundRoute,
  registerWebhookHubRoutes,
  webhookEmitterStore,
} from "./webhook-hub.js";
import {
  getSuiteState,
  registerSuiteRoutes,
  taskFromRuleEvent,
  validateLeadReferences,
} from "./suite.js";

const leadPatchSchema = LeadSchema.partial();
const createLeadEnvelope = z.object({
  lead: z.record(z.string(), z.unknown()),
});
const ruleEnvelope = z.object({ rule: z.record(z.string(), z.unknown()) });
const messageSchema = z.object({
  leadId: z.string().min(1),
  lineId: z.string().max(191).optional(),
  text: z.string().min(1).max(10000),
});
const callSchema = z.object({
  leadId: z.string().min(1),
  lineId: z.string().max(191).optional(),
  assistantId: z.string().max(191).optional(),
});
const providerSchema = z.enum([
  "meta",
  "evolution",
  "vapi",
  "netgsm",
  "bitrix",
  "webhook",
]);

type AuthedRequest = Request & { auth?: AuthContext };

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
function now(): string {
  return new Date().toISOString();
}
function ownerOf(req: Request): string {
  return (req as AuthedRequest).auth!.ownerOpenId;
}
function authOf(req: Request): AuthContext {
  return (req as AuthedRequest).auth!;
}
function errorStatus(error: unknown): number {
  if (error instanceof z.ZodError) return 400;
  return Number((error as any)?.statusCode) || 500;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Beklenmeyen sunucu hatası.";
}
function sendError(res: Response, error: unknown): void {
  const status = errorStatus(error);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error:
      status === 400
        ? "INVALID_REQUEST"
        : status === 401
          ? "UNAUTHORIZED"
          : status === 409
            ? "CONFLICT"
            : "SERVER_ERROR",
    message: errorMessage(error),
  });
}
function publicFields(source: Record<string, unknown>, fields: string[]) {
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const value = source[key];
    if (value !== undefined)
      result[key] =
        typeof value === "string"
          ? value
              .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, "[gizli değer]")
              .replace(
                /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
                "[gizli değer]",
              )
          : value;
  }
  return result;
}
function publicCall(call: Record<string, unknown>) {
  return publicFields(call, [
    "id",
    "leadId",
    "lineId",
    "assistantId",
    "provider",
    "status",
    "endedReason",
    "summary",
    "transcript",
    "direction",
    "durationSeconds",
    "successEvaluation",
    "startedAt",
    "endedAt",
    "createdAt",
    "updatedAt",
  ]);
}
function publicConnection(connection: Record<string, unknown>) {
  return publicFields(connection, [
    "id",
    "provider",
    "state",
    "status",
    "connected",
    "phone",
    "profileName",
    "updatedAt",
  ]);
}
function whatsappAutoLead(): boolean {
  return process.env.WHATSAPP_AUTO_LEAD?.trim() === "1";
}
function mediaLabel(type?: string): string {
  return (
    { image: "[Fotoğraf]", video: "[Video]", audio: "[Sesli mesaj]", document: "[Belge]" } as Record<string, string>
  )[type || ""] || "[Medya mesajı]";
}
function publicMessage(
  message: Record<string, unknown>,
): Record<string, unknown> {
  const inbound = message.direction === "in" || message.direction === "inbound";
  return {
    ...publicFields(message, [
      "id",
      "leadId",
      "lineId",
      "provider",
      "direction",
      "type",
      "text",
      "status",
      "createdAt",
      "mediaId",
      "mime",
      "fileName",
      "mediaType",
      "size",
      "phone",
      "contactName",
      "templateName",
    ]),
    direction: inbound ? "inbound" : "outbound",
    text: message.text ?? "[Medya mesajı]",
    status: message.status || (inbound ? "received" : "sent"),
  };
}

function publicEvent(event: StoredEvent): Record<string, unknown> {
  const payload = event.payload || {};
  const type = String(payload.type || "event");
  const title = String(
    payload.title ||
      (
        {
          "stage-change": "Aşama değişti",
          "rule-action": "Otomasyon kuralı",
          webhook: "Webhook alındı",
          "connection.update": "Bağlantı güncellendi",
        } as Record<string, string>
      )[type] ||
      type,
  );
  const detail = String(
    payload.detail ||
      payload.message ||
      (
        {
          "stage-change": `${String(payload.fromStage || "")} → ${String(payload.toStage || "")}`,
          "rule-action": String(payload.action || "Kural aksiyonu"),
          webhook: `${String(payload.provider || "")} webhook`,
        } as Record<string, string>
      )[type] ||
      "CRM olayı",
  );
  const status =
    event.status === "completed"
      ? (payload.result as any)?.skipped
        ? "skipped"
        : "success"
      : event.status === "needs_review"
        ? "needs_review"
        : event.status;
  return {
    ...publicFields(event as unknown as Record<string, unknown>, [
      "id",
      "type",
      "attempts",
      "nextAttemptAt",
      "lastError",
      "updatedAt",
    ]),
    type,
    status,
    title,
    detail:
      type === "rule-action"
        ? String(
            (payload.result as any)?.reason || payload.planReason || detail,
          )
        : detail,
    createdAt: event.createdAt || payload.createdAt || now(),
    leadId: payload.leadId || null,
    payload: {
      ...publicFields(payload, [
        "type",
        "provider",
        "leadId",
        "ruleId",
        "fromStage",
        "toStage",
        "action",
        "entityId",
        "origin",
        "kind",
        "actorName",
        "scheduledAt",
        "planReason",
      ]),
      ...(payload.result && typeof payload.result === "object"
        ? {
            result: publicFields(payload.result as Record<string, unknown>, [
              "taskId",
              "activity",
              "completed",
              "leadId",
              "dueAt",
              "assignee",
              "delivered",
              "skipped",
              "reason",
              "status",
            ]),
          }
        : {}),
    },
  };
}

function integrationSettings() {
  return {
    meta: { configured: providerConfigured("meta") },
    evolution: { configured: providerConfigured("evolution") },
    vapi: {
      configured: providerConfigured("vapi"),
      keyConfigured: envConfigured("VAPI_API_KEY"),
      defaultAssistantConfigured: envConfigured("VAPI_ASSISTANT_ID"),
      webhookConfigured: envConfigured("VAPI_WEBHOOK_SECRET"),
    },
    netgsm: { configured: providerConfigured("netgsm"), browserSip: false },
    bitrix: { configured: providerConfigured("bitrix") },
    webhook: { configured: providerConfigured("webhook") },
  };
}

async function ownerScope(store: Store): Promise<string> {
  const owner =
    (await store.resolveOwner()) ||
    process.env.XRE_OWNER_OPEN_ID?.trim() ||
    process.env.MANUS_OWNER_OPEN_ID?.trim();
  if (!owner)
    throw Object.assign(
      new Error("Webhook için erişilebilir ownerOpenId yapılandırılmalı."),
      { statusCode: 503 },
    );
  return owner;
}

async function findLead(
  store: Store,
  owner: string,
  leadId: string,
): Promise<Lead | null> {
  const record = await store.get<Lead>("lead", leadId, owner);
  return record?.payload || null;
}

async function findLeadByPhone(
  store: Store,
  owner: string,
  phone: string,
): Promise<Lead | null> {
  const target = normalizePhone(phone);
  if (!target) return null;
  const leads = await store.list<Lead>("lead", owner);
  return (
    leads
      .map((item) => item.payload)
      .find((lead) => normalizePhone(lead.phone) === target) || null
  );
}

async function ensureInboundLead(
  store: Store,
  owner: string,
  phone: string,
  name: string | undefined,
  source: string,
): Promise<Lead | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const existing = await findLeadByPhone(store, owner, normalized);
  if (existing) return existing;
  const timestamp = now();
  const lead: Lead = {
    id: id("lead"),
    name: name || normalized,
    phone: normalized,
    email: "",
    company: "",
    stage: "new",
    owner,
    value: 0,
    source,
    notes: "",
    createdAt: timestamp,
    lastActivity: timestamp,
    tags: [],
  };
  await store.put("lead", lead.id, lead, owner);
  await triggerRules(store, owner, lead, "", lead.stage, `created:${lead.id}`);
  return lead;
}

async function triggerRules(
  store: Store,
  owner: string,
  lead: Lead,
  fromStage: string,
  toStage: string,
  transitionKey?: string,
): Promise<void> {
  const rules = (await rawStoreOf(store).list<Rule>("rule", owner))
    .map((row) => row.payload)
    .filter(
      (rule) =>
        rule.enabled &&
        rule.triggerStage === toStage &&
        (rule.pipelineId === undefined ||
          rule.pipelineId === "all" ||
          rule.pipelineId === lead.pipelineId ||
          (rule.pipelineId === "sales" &&
            (!lead.pipelineId || lead.pipelineId === "sales"))),
    );
  for (const rule of rules) {
    const transitionAt = now();
    const persistedLead = (
      await rawStoreOf(store).get<Lead>("lead", lead.id, owner)
    )?.payload;
    const transitionToken = persistedLead?.stageTransitionToken;
    const plan = planAutomationRule(rule, lead, transitionAt);
    const eventKey =
      "stage:" +
      crypto
        .createHash("sha256")
        .update(
          `${lead.id}:${fromStage}:${toStage}:${rule.id}:${transitionKey || lead.lastActivity}`,
        )
        .digest("hex");
    const fingerprint = automationFingerprint(rule);
    await store.appendEvent(
      owner,
      eventKey,
      {
        actorOpenId: currentPermissionContext()?.auth.user.openId || owner,
        actorName:
          currentPermissionContext()?.auth.displayName ||
          currentPermissionContext()?.auth.user.name ||
          "Sistem",
        type: "rule-action",
        eventType: fromStage ? "stage.changed" : "lead.created",
        action: rule.action,
        ruleId: rule.id,
        leadId: lead.id,
        fromStage,
        toStage,
        config: rule.config,
        context: { lead: structuredClone(lead), fromStage, toStage },
        createdAt: transitionAt,
        planningVersion: 1,
        transitionToken,
        transitionAt,
        scheduledAt: plan.runAt,
        ruleFingerprint: fingerprint,
        planReason: plan.reason,
        ...(!plan.eligible
          ? { result: { skipped: true, reason: plan.reason } }
          : {}),
      },
      plan.eligible ? "pending" : "completed",
      plan.runAt,
    );
  }
}

function automationFingerprint(rule: Rule): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        triggerStage: rule.triggerStage,
        pipelineId: rule.pipelineId || "all",
        action: rule.action,
        config: rule.config,
        policy: rule.policy || null,
      }),
    )
    .digest("hex");
}

function renderTemplate(template: string | undefined, lead: Lead): string {
  const source = template || "";
  return source.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_match, key: keyof Lead) => String(lead[key] ?? ""),
  );
}

async function executeOutbox(
  store: Store,
  event: StoredEvent,
): Promise<Record<string, unknown>> {
  const payload = event.payload;
  const owner = event.ownerOpenId;
  if (
    payload.type === "rule-action" &&
    payload.actorOpenId &&
    payload.actorOpenId !== owner
  ) {
    const actor = await resolveAuthContext(
      store,
      { openId: String(payload.actorOpenId) },
      { ownerOpenId: owner, isOwner: false },
    );
    const module =
      payload.action === "whatsapp"
        ? "whatsapp"
        : payload.action === "vapi"
          ? "calls"
          : payload.action === "webhook"
            ? "integrations"
            : "tasks";
    if (
      actor &&
      actor.permissions?.[module].scope === "own" &&
      payload.leadId &&
      !(await ownsLead(store, actor, String(payload.leadId)))
    )
      throw Object.assign(
        new Error("Otomasyon müşterisi aktörün kendi kayıt kapsamında değil."),
        { statusCode: 403 },
      );
    if (!actor || !canAccess(actor, module, "write"))
      throw Object.assign(
        new Error(
          "Otomasyon aktörünün bu işlem için güncel yetkisi yok; dış iletişim yapılmadı.",
        ),
        { statusCode: 403 },
      );
  }
  if (payload.type === "conversation-analysis")
    return { ...(await processConversationAnalysisEvent(store, event)) };
  if (payload.type === "n8n-delivery") return deliverN8nEvent(store, event);
  if (payload.type === "hook-delivery") return deliverHookEvent(store, event);
  if (payload.type === "webhook" && payload.provider && payload.payload) {
    const body = payload.payload;
    if (payload.provider === "meta")
      await processMetaWebhook(store, owner, body);
    else if (payload.provider === "evolution")
      await processEvolutionWebhook(store, owner, body);
    else if (payload.provider === "vapi")
      await processVapiWebhook(store, owner, body);
    else if (payload.provider === "inbound")
      await processInboundWebhook(store, owner, body);
    return { replayed: true, provider: payload.provider };
  }
  const lead = payload.leadId
    ? await findLead(store, owner, String(payload.leadId))
    : null;
  if (payload.type === "rule-action" && payload.planningVersion === 1) {
    const latest = (
      await rawStoreOf(store).get<Rule>(
        "rule",
        String(payload.ruleId || ""),
        owner,
      )
    )?.payload;
    if (!lead || !latest || !latest.enabled)
      return { skipped: true, reason: "Müşteri veya etkin kural artık yok." };
    if (
      !payload.transitionToken ||
      lead.stageTransitionToken !== payload.transitionToken
    )
      return {
        skipped: true,
        reason:
          "Müşteri bu aşamaya yeniden girdi; önceki girişin otomasyonu iptal edildi.",
      };
    if (
      latest.triggerStage !== lead.stage ||
      String(payload.toStage) !== lead.stage
    )
      return {
        skipped: true,
        reason: "Müşteri tetikleme aşamasından ayrıldı.",
      };
    if (
      latest.pipelineId &&
      latest.pipelineId !== "all" &&
      latest.pipelineId !== (lead.pipelineId || "sales")
    )
      return {
        skipped: true,
        reason: "Müşterinin güncel satış hunisi kural kapsamı dışında.",
      };
    if (automationFingerprint(latest) !== payload.ruleFingerprint)
      return {
        skipped: true,
        reason: "Kural planlamadan sonra değişti; eski aksiyon çalıştırılmadı.",
      };
    const plan = recheckAutomationPolicyForWorker(
      latest,
      lead,
      String(payload.transitionAt),
      Date.now(),
    );
    if (!plan.eligible) return { skipped: true, reason: plan.reason };
    if (!plan.ready)
      return {
        deferred: true,
        runAt: plan.runAt,
        reason: "Planlanan işlem zamanı henüz gelmedi.",
      };
    if (latest.policy?.businessHours) {
      const clock = Date.now();
      const slot = nextTurkeyBusinessHoursSlot(clock);
      if (Date.parse(slot) > clock)
        return {
          deferred: true,
          runAt: slot,
          reason: "Mesai dışındaki işlem sonraki çalışma saatine ertelendi.",
        };
    }
  }
  const config = (
    payload.config && typeof payload.config === "object" ? payload.config : {}
  ) as Record<string, unknown>;
  const action = String(payload.action || "task");
  if (action === "task") {
    const task = taskFromRuleEvent(event.id, lead, config, now());
    await store.put("tasks", task.id, task, owner);
    return {
      completed: true,
      activity: "task",
      leadId: task.leadId,
      taskId: task.id,
      dueAt: task.dueAt,
      assignee: task.assignee,
    };
  }
  if (!lead)
    throw Object.assign(new Error("Kural olayı için lead bulunamadı."), {
      statusCode: 404,
    });
  if (action === "whatsapp") {
    const text = renderTemplate(
      typeof config.template === "string"
        ? config.template
        : "Lead aşaması güncellendi.",
      lead,
    );
    const lineId = typeof config.lineId === "string" ? config.lineId : "";
    if (!lineId)
      throw Object.assign(
        new Error("WhatsApp otomasyonu için mantıksal lineId gerekli."),
        { statusCode: 400 },
      );
    const useEvolution =
      config.provider === "evolution" ||
      (config.provider !== "meta" &&
        (await store.get<any>("connection", lineId, owner))?.payload?.status ===
          "connected");
    const result = useEvolution
      ? await sendEvolutionText(lineId, lead.phone, text)
      : await sendMetaText(lineId, normalizePhone(lead.phone), text);
    await store.put(
      "message",
      `event-${event.id}`,
      {
        id: `event-${event.id}`,
        leadId: lead.id,
        lineId,
        provider: useEvolution ? "evolution" : "meta",
        direction: "outbound",
        type: "text",
        text,
        status: "sent",
        providerMessageId: String(
          result?.messages?.[0]?.id || result?.key?.id || "",
        ),
        providerResult: result,
        createdAt: now(),
      },
      owner,
    );
    await scheduleConversationAnalysis(
      store,
      owner,
      "whatsapp",
      `event-${event.id}`,
    );
    return result;
  }
  if (action === "vapi") {
    const assistantId = String(
      config.assistantId || process.env.VAPI_ASSISTANT_ID || "",
    );
    const lineId = String(config.lineId || "");
    if (!lineId)
      throw Object.assign(
        new Error("Vapi otomasyonu için mantıksal lineId gerekli."),
        { statusCode: 400 },
      );
    const result = await createVapiCall(lead.phone, assistantId, lineId);
    const callId = String(result?.id || `event-${event.id}`);
    await store.put(
      "call",
      callId,
      {
        id: callId,
        leadId: lead.id,
        lineId,
        assistantId,
        provider: "vapi",
        direction: "outbound",
        status: result?.status || "queued",
        providerResult: result,
        createdAt: now(),
      },
      owner,
    );
    return result;
  }
  if (action === "webhook") {
    if (config.provider === "n8n")
      return deliverN8nWebhook(store, owner, lead, event);
    const url = typeof config.url === "string" ? config.url : "";
    const secret = process.env.OUTBOUND_WEBHOOK_SECRET;
    if (!url || !secret)
      throw Object.assign(
        new Error(
          "Webhook URL veya OUTBOUND_WEBHOOK_SECRET yapılandırılmamış.",
        ),
        { statusCode: 503 },
      );
    const body = JSON.stringify({ event: payload, lead });
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: signedOutboundHeaders(body, secret),
      body,
    });
    return await readJsonResponse(response);
  }
  throw Object.assign(new Error("Bilinmeyen outbox aksiyonu."), {
    statusCode: 400,
  });
}

async function processMetaWebhook(
  store: Store,
  owner: string,
  body: any,
): Promise<void> {
  for (const entry of body?.entry || [])
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const lineId = String(value.metadata?.phone_number_id || "");
      const contact = value.contacts?.[0];
      for (const message of value.messages || []) {
        const lead = whatsappAutoLead()
          ? await ensureInboundLead(
              store,
              owner,
              message.from,
              contact?.profile?.name,
              "whatsapp",
            )
          : await findLeadByPhone(store, owner, message.from);
        const messageId = String(message.id || id("meta-message"));
        const type = String(message.type || "unknown");
        const media = await captureMetaMedia(store, owner, message);
        const text =
          message.text?.body ??
          message[type]?.caption ??
          (type === "location"
            ? `Konum: ${message.location?.latitude}, ${message.location?.longitude}`
            : null) ??
          null;
        await store.put(
          "message",
          messageId,
          {
            id: messageId,
            leadId: lead?.id || null,
            lineId,
            phone: normalizePhone(message.from),
            contactName: String(contact?.profile?.name || "").slice(0, 120) || null,
            provider: "meta",
            direction: "inbound",
            type,
            text: text ?? mediaLabel(media.mediaType),
            status: "received",
            providerMessageId: message.id || null,
            ...media,
            payload: message,
            createdAt: now(),
          },
          owner,
        );
      }
      for (const status of value.statuses || []) {
        const messages = await store.list<any>("message", owner);
        const row = messages.find(
          (item) => item.payload.providerMessageId === status.id,
        );
        if (row)
          await store.put(
            "message",
            row.id,
            {
              ...row.payload,
              status: String(status.status || "received"),
              statusPayload: status,
            },
            owner,
          );
      }
    }
}

async function processEvolutionWebhook(
  store: Store,
  owner: string,
  body: any,
): Promise<void> {
  const data = body?.data || body;
  const eventName = String(body?.event || body?.type || "").toLowerCase();
  if (
    eventName === "connection.update" ||
    data?.state ||
    data?.instance?.state
  ) {
    const instance = String(
      body?.instance ||
        data?.instance?.instanceName ||
        data?.instance ||
        body?.sender ||
        "",
    );
    const state = String(
      data?.state || data?.instance?.state || "",
    ).toLowerCase();
    if (instance && state) {
      const open = ["open", "connected"].includes(state);
      const previous =
        (await store.get<any>("connection", instance, owner))?.payload || {};
      const phone = open ? jidPhone(data?.wuid || body?.sender) : "";
      await store.put(
        "connection",
        instance,
        {
          ...previous,
          id: instance,
          provider: "evolution",
          state,
          status: open ? "connected" : "disconnected",
          connected: open,
          ...(phone ? { phone } : {}),
          ...(open && data?.profileName
            ? { profileName: String(data.profileName).slice(0, 120) }
            : {}),
          updatedAt: now(),
        },
        owner,
      );
    }
    if (eventName === "connection.update" || !data?.key) return;
  }
  const key = data?.key || data?.message?.key || {};
  if (key.fromMe) return;
  const remoteJid = String(key.remoteJid || data?.remoteJid || "");
  const phone = remoteJid.split("@")[0];
  if (!phone) return;
  // WhatCRM tarzı: varsayılan olarak gelen mesaj müşteri kartı açmaz;
  // numara kayıtlıysa bağlanır. WHATSAPP_AUTO_LEAD=1 ile eski davranış.
  const lead = whatsappAutoLead()
    ? await ensureInboundLead(
        store,
        owner,
        phone,
        data?.pushName || data?.notifyName,
        "evolution",
      )
    : await findLeadByPhone(store, owner, phone);
  const message = unwrapWaMessage(data?.message);
  // Silme/düzenleme bildirimleri ve şifreleme anahtarları sohbete yazılmaz.
  if (isWaSystemMessage(message)) return;
  const text = waMessageText(message);
  const messageId = String(key.id || data?.id || id("evolution-message"));
  const media = await captureEvolutionMedia(
    store,
    owner,
    String(body?.instance || body?.sender || ""),
    data,
  );
  await store.put(
    "message",
    messageId,
    {
      id: messageId,
      leadId: lead?.id || null,
      lineId: body?.instance || body?.sender || null,
      phone: normalizePhone(phone),
      contactName: String(data?.pushName || data?.notifyName || "").slice(0, 120) || null,
      provider: "evolution",
      direction: "inbound",
      type: media.mediaType || waContentKey(message) || "text",
      text: text ?? mediaLabel(media.mediaType),
      status: "received",
      providerMessageId: messageId,
      ...media,
      payload: stripMediaPayload(data),
      createdAt: now(),
    },
    owner,
  );
}

async function processVapiWebhook(
  store: Store,
  owner: string,
  body: any,
): Promise<void> {
  const message = body?.message || body;
  if (String(message?.type || "") !== "end-of-call-report") return;
  const call = message.call || {};
  const phone = call.customer?.number || call.destination?.number || "";
  const callId = String(call.id || id("vapi-call"));
  const existing = await store.get<any>("call", callId, owner);
  const lead = existing?.payload?.leadId
    ? await findLead(store, owner, String(existing.payload.leadId))
    : await ensureInboundLead(store, owner, phone, undefined, "vapi");
  const analysis = message.analysis || {};
  await store.put(
    "call",
    callId,
    {
      ...(existing?.payload || {}),
      id: callId,
      leadId: existing?.payload?.leadId || lead?.id || null,
      lineId:
        existing?.payload?.lineId ||
        call.phoneNumberId ||
        call.phoneNumber?.id ||
        null,
      provider: "vapi",
      status: "ended",
      endedReason: message.endedReason || call.endedReason || null,
      direction: call.type?.toLowerCase().includes("inbound")
        ? "inbound"
        : call.type?.toLowerCase().includes("outbound")
          ? "outbound"
          : existing?.payload?.direction || "unknown",
      startedAt: call.startedAt || message.startedAt || null,
      endedAt: call.endedAt || message.endedAt || null,
      durationSeconds:
        typeof message.durationSeconds === "number"
          ? message.durationSeconds
          : call.startedAt && call.endedAt
            ? Math.max(
                0,
                (Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000,
              )
            : null,
      successEvaluation: analysis.successEvaluation ?? null,
      summary: analysis.summary || existing?.payload?.summary || null,
      analysis,
      transcript:
        message.artifact?.transcript || existing?.payload?.transcript || null,
      recording:
        message.artifact?.recording || existing?.payload?.recording || null,
      payload: message,
      createdAt: existing?.payload?.createdAt || now(),
      updatedAt: now(),
    },
    owner,
  );
}

async function processInboundWebhook(
  store: Store,
  owner: string,
  body: any,
): Promise<void> {
  const type = String(body?.type || body?.event || body?.payload?.type || "");
  if (!["lead.created", "lead.updated", "stage.changed"].includes(type))
    throw Object.assign(new Error("Desteklenmeyen inbound olay tipi."), {
      statusCode: 400,
    });
  const source =
    body?.lead ||
    body?.data?.lead ||
    body?.payload?.lead ||
    body?.data ||
    body?.payload ||
    body;
  const leadId = String(
    source?.id || body?.leadId || body?.payload?.leadId || "",
  );
  if (!leadId)
    throw Object.assign(new Error("Inbound olayında lead id gerekli."), {
      statusCode: 400,
    });
  const old = await findLead(store, owner, leadId);
  if (type === "lead.created") {
    const timestamp = String(source.createdAt || now());
    const lead = LeadSchema.parse({
      ...source,
      id: leadId,
      name: String(source.name || ""),
      phone: String(source.phone || ""),
      email: String(source.email || ""),
      company: String(source.company || ""),
      stage: source.stage || "new",
      owner: String(source.owner || owner),
      value: typeof source.value === "number" ? source.value : 0,
      source: String(source.source || "inbound"),
      notes: String(source.notes || ""),
      createdAt: timestamp,
      lastActivity: String(source.lastActivity || timestamp),
      tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
    });
    await validateLeadReferences(store, owner, lead as any);
    await store.put("lead", lead.id, lead, owner);
    if (!old)
      await triggerRules(
        store,
        owner,
        lead,
        "",
        lead.stage,
        `created:${lead.id}`,
      );
    return;
  }
  if (!old)
    throw Object.assign(new Error("Inbound olayındaki lead bulunamadı."), {
      statusCode: 404,
    });
  const toStage =
    type === "stage.changed"
      ? source.toStage || source.stage || body.toStage
      : source.stage;
  const changedStage = Boolean(toStage && toStage !== old.stage);
  const updated = LeadSchema.parse({
    ...old,
    ...source,
    id: old.id,
    createdAt: old.createdAt,
    owner: source.owner === undefined ? old.owner : String(source.owner),
    stage: toStage || old.stage,
    lastActivity: changedStage ? now() : old.lastActivity,
  });
  await validateLeadReferences(store, owner, updated as any);
  await store.put("lead", updated.id, updated, owner);
  if (changedStage) {
    const transitionKey = `lead-stage:${updated.id}:${old.stage}:${updated.stage}:${old.lastActivity}`;
    await store.appendEvent(
      owner,
      transitionKey,
      {
        type: "stage-change",
        actorName:
          currentPermissionContext()?.auth.displayName ||
          currentPermissionContext()?.auth.user.name ||
          "Sistem / webhook",
        leadId: updated.id,
        fromStage: old.stage,
        toStage: updated.stage,
        createdAt: now(),
      },
      "completed",
    );
    await triggerRules(
      store,
      owner,
      updated,
      old.stage,
      updated.stage,
      transitionKey,
    );
  }
}

function webhookKey(provider: string, body: unknown, fallbackRaw = ""): string {
  const text = JSON.stringify(body);
  const candidate =
    (body as any)?.id ||
    (body as any)?.eventId ||
    (body as any)?.message?.call?.id ||
    (body as any)?.data?.key?.id;
  return `${provider}:${String(
    candidate ||
      crypto
        .createHash("sha256")
        .update(fallbackRaw || text)
        .digest("hex"),
  )}`;
}

function isUncertainProviderError(error: unknown): boolean {
  const value = error as any;
  return (
    value?.name === "AbortError" ||
    /timeout|aborted|timed out/i.test(errorMessage(error))
  );
}

function providerStatus(error: unknown): number | undefined {
  const status = Number(
    (error as any)?.providerStatus || (error as any)?.statusCode,
  );
  return Number.isFinite(status) && status > 0 ? status : undefined;
}

export async function processOutboxOnce(store: Store): Promise<number> {
  const events = await store.claimDueEvents(10);
  for (const event of events) {
    try {
      const result = await executeOutbox(store, event);
      if (result.deferred && typeof result.runAt === "string") {
        await store.updateEvent(event.id, event.ownerOpenId, {
          status: "pending",
          attempts: Math.max(0, event.attempts - 1),
          nextAttemptAt: result.runAt,
          lastError: null,
        });
        continue;
      }
      await store.updateEvent(event.id, event.ownerOpenId, {
        status: "completed",
        nextAttemptAt: null,
        lastError: null,
        payload: { ...event.payload, result },
      });
    } catch (error) {
      if (isUncertainProviderError(error)) {
        await store.updateEvent(event.id, event.ownerOpenId, {
          status: "needs_review",
          attempts: 5,
          nextAttemptAt: null,
          lastError: `Belirsiz sağlayıcı sonucu; yeniden gönderilmedi: ${errorMessage(error)}`,
        });
      } else if (
        (providerStatus(error) || 0) >= 400 &&
        (providerStatus(error) || 0) < 500
      ) {
        await store.updateEvent(event.id, event.ownerOpenId, {
          status: "failed",
          attempts: 5,
          nextAttemptAt: null,
          lastError: errorMessage(error),
        });
      } else if (event.attempts >= 5) {
        await store.updateEvent(event.id, event.ownerOpenId, {
          status: "failed",
          nextAttemptAt: null,
          lastError: errorMessage(error),
        });
      } else {
        const delay = Math.min(3600, 2 ** Math.max(0, event.attempts - 1));
        await store.updateEvent(event.id, event.ownerOpenId, {
          status: "failed",
          nextAttemptAt: new Date(Date.now() + delay * 1000).toISOString(),
          lastError: errorMessage(error),
        });
      }
    }
  }
  return events.length;
}

export function startOutboxWorker(
  store: Store,
  intervalMs = 5000,
): NodeJS.Timeout {
  const tick = () => {
    void processOutboxOnce(store).catch((error) =>
      console.warn("Outbox worker failed:", errorMessage(error)),
    );
  };
  tick();
  const timer = setInterval(tick, Math.max(1000, intervalMs));
  timer.unref?.();
  return timer;
}

export function createApp(
  options: { store?: Store; background?: boolean } = {},
): Express {
  const baseStore = options.store || createStore();
  const rawStore = liveNotifyStore(auditStore(webhookEmitterStore(baseStore)));
  const store = createPermissionStore(
    stagePolicyStore(appointmentStore(rawStore)),
  );
  const app = express();
  app.disable("x-powered-by");
  // Express 4 does not catch rejected async route handlers by itself.
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const original = (app[method] as any).bind(app);
    (app as any)[method] = (...args: any[]) =>
      original(
        ...args.map((arg) =>
          typeof arg === "function"
            ? (req: any, res: any, next: any) => {
                try {
                  Promise.resolve(arg(req, res, next)).catch((error) =>
                    sendError(res, error),
                  );
                } catch (error) {
                  sendError(res, error);
                }
              }
            : arg,
        ),
      );
  }

  app.get("/health", async (_req, res) => {
    try {
      const readiness = await store.readiness();
      return res.status(readiness.database ? 200 : 503).json({
        ok: readiness.database,
        database: readiness.database,
        service: "xrecrm-server",
        time: now(),
      });
    } catch {
      return res.status(503).json({
        ok: false,
        database: false,
        service: "xrecrm-server",
        time: now(),
      });
    }
  });

  app.get("/api/identity", async (req, res) => {
    const identity = await verifySessionIdentity(req);
    res.json({
      identity: identity
        ? { openId: identity.openId, name: identity.name || "" }
        : null,
    });
  });
  app.get("/api/me", async (req, res) => {
    try {
      const auth = await verifyRequestSession(req, store);
      res.json({
        user: auth
          ? {
              ...auth.user,
              name: auth.displayName || auth.user.name,
              isOwner: auth.isOwner,
              canAccess: true,
              employeeId: auth.employeeId,
              permissions: auth.permissions,
            }
          : null,
      });
    } catch {
      res.json({ user: null });
    }
  });
  app.get("/api/auth/login", (req, res) => {
    void handleLogin(req, res);
  });
  app.get("/api/auth/callback", (req, res) => {
    void handleCallback(req, res, store);
  });
  app.post("/api/auth/logout", (req, res) => clearSession(req, res));

  app.get("/api/webhooks/meta", (req, res) => {
    const token = process.env.META_VERIFY_TOKEN;
    if (!token)
      return res.status(503).send("META_VERIFY_TOKEN yapılandırılmamış.");
    const mode = String(req.query["hub.mode"] || "");
    const verifyToken = String(req.query["hub.verify_token"] || "");
    const challenge = String(req.query["hub.challenge"] || "");
    if (mode === "subscribe" && verifyToken === token && challenge)
      return res.status(200).send(challenge);
    return res.status(403).send("forbidden");
  });
  app.post(
    "/api/webhooks/meta",
    express.raw({ type: "*/*", limit: "2mb" }),
    async (req, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      if (!process.env.META_APP_SECRET)
        return res.status(503).send("META_APP_SECRET yapılandırılmamış.");
      if (
        !verifyHmac(
          raw,
          process.env.META_APP_SECRET,
          String(req.headers["x-hub-signature-256"] || ""),
        )
      )
        return res.status(401).send("bad signature");
      let body: any;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        return res.status(400).send("invalid json");
      }
      let owner: string;
      try {
        owner = await ownerScope(store);
      } catch (error) {
        sendError(res, error);
        return;
      }
      const key = webhookKey("meta", body, raw.toString("utf8"));
      let saved: Awaited<ReturnType<Store["appendEvent"]>> | undefined;
      try {
        saved = await store.appendEvent(
          owner,
          key,
          { type: "webhook", provider: "meta", payload: body },
          "received",
        );
        if (saved.inserted) {
          await processMetaWebhook(store, owner, body);
          await store.updateEvent(saved.event.id, owner, {
            status: "completed",
          });
        }
        return res.status(200).send("EVENT_RECEIVED");
      } catch (error) {
        if (saved)
          await store.updateEvent(saved.event.id, owner, {
            status: "failed",
            lastError: errorMessage(error),
          });
        return res.status(500).send(errorMessage(error));
      }
    },
  );

  app.post(
    "/api/webhooks/vapi",
    express.json({ limit: "2mb" }),
    async (req, res) => {
      if (!process.env.VAPI_WEBHOOK_SECRET)
        return res.status(503).send("VAPI_WEBHOOK_SECRET yapılandırılmamış.");
      if (
        !bearerMatches(
          String(
            req.headers.authorization || req.headers["x-vapi-secret"] || "",
          ),
          process.env.VAPI_WEBHOOK_SECRET,
        )
      )
        return res.status(401).send("unauthorized");
      let owner: string;
      try {
        owner = await ownerScope(store);
      } catch (error) {
        sendError(res, error);
        return;
      }
      const key = webhookKey("vapi", req.body);
      let saved: Awaited<ReturnType<Store["appendEvent"]>> | undefined;
      try {
        saved = await store.appendEvent(
          owner,
          key,
          { type: "webhook", provider: "vapi", payload: req.body },
          "received",
        );
        if (saved.inserted) {
          await processVapiWebhook(store, owner, req.body);
          await store.updateEvent(saved.event.id, owner, {
            status: "completed",
          });
        }
        return res.status(200).json({ received: true });
      } catch (error) {
        if (saved)
          await store.updateEvent(saved.event.id, owner, {
            status: "failed",
            lastError: errorMessage(error),
          });
        return res.status(500).json({ error: errorMessage(error) });
      }
    },
  );

  app.post(
    "/api/webhooks/evolution",
    express.json({ limit: "2mb" }),
    async (req, res) => {
      if (!process.env.EVOLUTION_WEBHOOK_SECRET)
        return res
          .status(503)
          .send("EVOLUTION_WEBHOOK_SECRET yapılandırılmamış.");
      if (
        !bearerMatches(
          String(req.headers.authorization || ""),
          process.env.EVOLUTION_WEBHOOK_SECRET,
        ) &&
        !bearerMatches(
          String(req.headers["x-evolution-webhook-secret"] || ""),
          process.env.EVOLUTION_WEBHOOK_SECRET,
        ) &&
        !bearerMatches(
          typeof req.query.token === "string" ? req.query.token : "",
          process.env.EVOLUTION_WEBHOOK_SECRET,
        )
      )
        return res.status(401).send("unauthorized");
      // Bitrix pazar yeri bağlayıcısının oturumları CRM çalışma alanına girmez.
      if (isConnectorInstance(req.body?.instance)) {
        res.status(200).json({ ok: true });
        void handleConnectorEvolution(baseStore, req.body).catch((error) =>
          console.warn("Bitrix bağlayıcısına iletilemedi:", errorMessage(error)),
        );
        return;
      }
      let owner: string;
      try {
        owner = await ownerScope(store);
      } catch (error) {
        sendError(res, error);
        return;
      }
      const key = webhookKey("evolution", req.body);
      let saved: Awaited<ReturnType<Store["appendEvent"]>> | undefined;
      try {
        saved = await store.appendEvent(
          owner,
          key,
          { type: "webhook", provider: "evolution", payload: req.body },
          "received",
        );
        if (saved.inserted) {
          await processEvolutionWebhook(store, owner, req.body);
          await store.updateEvent(saved.event.id, owner, {
            status: "completed",
          });
        }
        return res.status(200).json({ received: true });
      } catch (error) {
        if (saved)
          await store.updateEvent(saved.event.id, owner, {
            status: "failed",
            lastError: errorMessage(error),
          });
        return res.status(500).json({ error: errorMessage(error) });
      }
    },
  );

  app.post(
    "/api/webhooks/inbound",
    express.json({ limit: "2mb" }),
    async (req, res) => {
      if (!process.env.INBOUND_WEBHOOK_SECRET)
        return res
          .status(503)
          .json({ error: "INBOUND_WEBHOOK_SECRET yapılandırılmamış." });
      if (
        !bearerMatches(
          String(req.headers.authorization || ""),
          process.env.INBOUND_WEBHOOK_SECRET,
        )
      )
        return res.status(401).json({ error: "UNAUTHORIZED" });
      let owner: string | undefined;
      let saved: Awaited<ReturnType<Store["appendEvent"]>> | undefined;
      try {
        const type = String(
          req.body?.type || req.body?.event || req.body?.payload?.type || "",
        );
        if (!["lead.created", "lead.updated", "stage.changed"].includes(type))
          return res.status(400).json({
            error: "INVALID_INBOUND_EVENT",
            message:
              "Yalnız lead.created, lead.updated veya stage.changed kabul edilir.",
          });
        owner = await ownerScope(store);
        const key = webhookKey("inbound", req.body);
        saved = await store.appendEvent(
          owner,
          key,
          { type: "webhook", provider: "inbound", payload: req.body },
          "received",
        );
        if (saved.inserted) {
          await processInboundWebhook(store, owner, req.body);
          await store.updateEvent(saved.event.id, owner, {
            status: "completed",
          });
        }
        return res
          .status(200)
          .json({ received: true, duplicate: !saved.inserted });
      } catch (error) {
        if (saved && owner)
          await store.updateEvent(saved.event.id, owner, {
            status: "failed",
            lastError: errorMessage(error),
          });
        const status = errorStatus(error);
        return res
          .status(status >= 400 && status < 600 ? status : 500)
          .json({ error: errorMessage(error) });
      }
    },
  );

  registerLocalAuthRoutes(app, store);
  registerSocialAuthRoutes(app, store);
  registerBitrixAppRoutes(app, store);
  registerB24ConnectorRoutes(app, baseStore);
  registerN8nInboundRoute(app, store, processInboundWebhook);
  const hubDeps = {
    ownerScope,
    processInboundWebhook,
    ensureInboundLead,
    scheduleCallAnalysis: (target: Store, owner: string, callId: string) =>
      scheduleConversationAnalysis(target, owner, "call", callId),
  };
  registerHookInboundRoute(app, store, hubDeps);
  if (options.background)
    startPbxSupervisor(store, (target, owner, input) =>
      runInboundAction(
        target,
        owner,
        { id: "asterisk", name: "Santral" },
        "call.log",
        input,
        hubDeps,
      ),
    );
  registerMediaBodyParser(app);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", requireAuth(store), requireModulePermissions);
  registerSuiteRoutes(app, store);
  registerPreferenceRoutes(app, rawStore);
  registerCrmWorkspaceRoutes(app, rawStore);
  registerCrmImportRoutes(app, store, rawStore);
  registerAutomationPlanningRoutes(app, store);
  registerGoogleCalendarRoutes(app, store, rawStore);
  registerAssistantRoutes(app, store);
  registerAccessRoutes(app, rawStore);
  registerWorktimeRoutes(app, store);
  registerN8nRoutes(app, store);
  registerAppointmentRoutes(app, store);
  registerConversationAnalysisRoutes(app, store);
  registerN8nReportRoutes(app, store);
  registerWebhookHubRoutes(app, store);
  registerLocalAccountRoutes(app, store);
  registerBitrixImportRoutes(app, store, baseStore);
  registerIntegrationSettingsRoutes(app, store);
  registerPbxRoutes(app, store);
  registerLineInventoryRoutes(app, store);
  registerAuditRoutes(app, store);
  registerBackupRoutes(app, baseStore, async () => {
    await loadLineInventoryFromStore(store);
    await loadIntegrationSettings(store);
  });
  if (options.background) startBackupScheduler(baseStore);
  registerMediaRoutes(app, store, {
    providerFor: (lineId, owner) => lineProvider(store, owner, lineId),
    guard: (owner, lineId, phone, provider) =>
      guardOutbound(store, owner, { lineId, phone, provider }),
  });
  registerWhatsappChatRoutes(app, store, { ensureLead: ensureInboundLead });
  registerQrApproveRoute(app, store);

  app.get("/api/state", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const [leads, rules, messages, events, connections, calls, suite, stages] =
        await Promise.all([
          store.list<Lead>("lead", owner),
          store.list<Rule>("rule", owner),
          store.list("message", owner),
          store.listEvents(owner),
          store.list("connection", owner),
          store.list("call", owner),
          getSuiteState(store, owner),
          rawStoreOf(store).list<any>(STAGE_KIND, owner),
        ]);
      const visibleLeads = new Set(leads.map((r) => r.id));
      const since = Date.now() - 400 * 86_400_000;
      res.json({
        leads: leads.map((r) => r.payload),
        rules: rules.map((r) => r.payload),
        messages: messages.map((r) =>
          publicMessage(r.payload as Record<string, unknown>),
        ),
        events: events.map(publicEvent),
        connections: connections.map((r) =>
          publicConnection(r.payload as Record<string, unknown>),
        ),
        calls: calls.map((r) =>
          publicCall(r.payload as Record<string, unknown>),
        ),
        ...suite,
        lines,
        stageHistory: stages
          .map((r) => r.payload)
          .filter((h) => visibleLeads.has(h.leadId) && Date.parse(h.at) >= since),
        settings: {},
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/settings", (_req, res) =>
    res.json({
      integrations: integrationSettings(),
      env: {
        database: Boolean(process.env.DATABASE_URL),
        manusOAuth: envConfigured(
          "MANUS_PROJECT_ID",
          "MANUS_OAUTH_PORTAL_URL",
          "MANUS_OAUTH_API_URL",
          "MANUS_JWT_SECRET",
        ),
        outboundWebhookSigning: Boolean(process.env.OUTBOUND_WEBHOOK_SECRET),
        inboundWebhook: Boolean(process.env.INBOUND_WEBHOOK_SECRET),
      },
    }),
  );
  app.get("/api/integrations/status", (_req, res) =>
    res.json(integrationSettings()),
  );

  app.post("/api/leads", async (req, res) => {
    try {
      const parsed = createLeadEnvelope.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "INVALID_LEAD", message: parsed.error.message });
      const input = parsed.data.lead as any;
      const timestamp = now();
      const candidate = {
        ...input,
        id: String(input.id || id("lead")),
        name: String(input.name || ""),
        phone: String(input.phone || ""),
        email: String(input.email || ""),
        company: String(input.company || ""),
        stage: input.stage || "new",
        owner: String(input.owner || authOf(req).user.openId),
        value: typeof input.value === "number" ? input.value : 0,
        source: String(input.source || "manual"),
        notes: String(input.notes || ""),
        createdAt: String(input.createdAt || timestamp),
        lastActivity: String(input.lastActivity || timestamp),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      };
      const lead = LeadSchema.parse(candidate);
      const existing = await findLead(store, ownerOf(req), lead.id);
      if (existing)
        return res.status(409).json({
          error: "ALREADY_EXISTS",
          message: "Bu kimlikte müşteri zaten var.",
        });
      await validateLeadReferences(store, ownerOf(req), lead as any);
      const inserted = await store.insertIfAbsent(
        "lead",
        lead.id,
        lead,
        ownerOf(req),
      );
      if (!inserted.inserted)
        return res
          .status(409)
          .json({
            error: "ALREADY_EXISTS",
            message: "Müşteri kimliği kullanımda; mevcut kayıt değiştirilmedi.",
          });
      const saved = inserted.record!;
      await triggerRules(
        store,
        ownerOf(req),
        lead,
        "",
        lead.stage,
        `created:${lead.id}`,
      );
      res.status(201).json(saved.payload);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/leads/:id", async (req, res) => {
    try {
      const existing = await findLead(store, ownerOf(req), req.params.id);
      if (!existing)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Lead bulunamadı." });
      const parsed = leadPatchSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "INVALID_LEAD", message: parsed.error.message });
      const patch: any = { ...parsed.data };
      delete patch.id;
      delete patch.createdAt;
      const changedStage = patch.stage && patch.stage !== existing.stage;
      const updated: Lead = LeadSchema.parse({
        ...existing,
        ...patch,
        lastActivity: changedStage
          ? now()
          : patch.lastActivity || existing.lastActivity,
      });
      await validateLeadReferences(store, ownerOf(req), updated as any);
      const saved = await store.put("lead", updated.id, updated, ownerOf(req));
      if (changedStage) {
        const key = `lead-stage:${updated.id}:${existing.stage}:${updated.stage}:${existing.lastActivity}`;
        await store.appendEvent(
          ownerOf(req),
          key,
          {
            type: "stage-change",
            actorName:
              currentPermissionContext()?.auth.displayName ||
              currentPermissionContext()?.auth.user.name ||
              "Sistem",
            leadId: updated.id,
            fromStage: existing.stage,
            toStage: updated.stage,
            createdAt: now(),
          },
          "completed",
        );
        await triggerRules(
          store,
          ownerOf(req),
          updated,
          existing.stage,
          updated.stage,
          key,
        );
      }
      res.json(saved.payload);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/rules", async (req, res) => {
    try {
      const input = req.body?.rule ?? req.body;
      const parsed = z.record(z.string(), z.unknown()).safeParse(input);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "INVALID_RULE", message: parsed.error.message });
      const rule = RuleSchema.parse({
        ...(parsed.data as any),
        id: String((parsed.data as any).id || id("rule")),
      });
      const saved = await store.put("rule", rule.id, rule, ownerOf(req));
      res.status(201).json(saved.payload);
    } catch (error) {
      sendError(res, error);
    }
  });
  app.patch("/api/rules/:id", async (req, res) => {
    try {
      const old = await store.get<Rule>("rule", req.params.id, ownerOf(req));
      if (!old)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Kural bulunamadı." });
      const parsed = RuleSchema.partial().safeParse({
        ...(req.body || {}),
        id: req.params.id,
      });
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "INVALID_RULE", message: parsed.error.message });
      const rule = RuleSchema.parse({
        ...old.payload,
        ...parsed.data,
        id: req.params.id,
      });
      const saved = await store.put("rule", rule.id, rule, ownerOf(req));
      res.json(saved.payload);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/connections/:id/qr", async (req, res) => {
    try {
      if (!providerConfigured("evolution"))
        return res.status(503).json({
          error: "EVOLUTION_NOT_CONFIGURED",
          message: "Evolution API ayarları yok; gerçek QR üretilemez.",
        });
      const instance = req.params.id;
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(instance))
        return res.status(400).json({
          error: "INVALID_INSTANCE",
          message: "Geçersiz Evolution instance adı.",
        });
      const qr = await getEvolutionQr(instance);
      await store.put(
        "connection",
        instance,
        { id: instance, provider: "evolution", qr, fetchedAt: now() },
        ownerOf(req),
      );
      res.json(typeof qr === "string" ? { base64: qr } : qr);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const parsed = messageSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "INVALID_MESSAGE", message: parsed.error.message });
      const lead = await findLead(store, ownerOf(req), parsed.data.leadId);
      if (!lead)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Lead bulunamadı." });
      const lineId = parsed.data.lineId || "";
      if (!lineId)
        return res.status(400).json({
          error: "LINE_ID_REQUIRED",
          message: "Mesaj için mantıksal lineId gerekli.",
        });
      const useEvolution =
        (await store.get<any>("connection", lineId, ownerOf(req)))?.payload
          ?.status === "connected";
      let provider: "meta" | "evolution";
      let result: any;
      if (useEvolution && providerConfigured("evolution")) {
        provider = "evolution";
        result = await sendEvolutionText(lineId, lead.phone, parsed.data.text);
      } else if (!useEvolution && providerConfigured("meta")) {
        provider = "meta";
        result = await sendMetaText(
          lineId,
          normalizePhone(lead.phone),
          parsed.data.text,
        );
      } else
        return res.status(503).json({
          error: "WHATSAPP_NOT_CONFIGURED",
          message:
            "Meta veya bağlı Evolution WhatsApp hattı yapılandırılmamış.",
        });
      const message = {
        id: String(
          result?.messages?.[0]?.id || result?.key?.id || id("message"),
        ),
        leadId: lead.id,
        lineId,
        provider,
        direction: "outbound",
        type: "text",
        text: parsed.data.text,
        status: "sent",
        providerMessageId: String(
          result?.messages?.[0]?.id || result?.key?.id || "",
        ),
        providerResult: result,
        createdAt: now(),
      };
      await store.put("message", message.id, message, ownerOf(req));
      res.status(201).json(publicMessage(message));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/calls/options", async (_req, res) => {
    try {
      res.json(await getVapiCatalog());
    } catch (error) {
      sendError(res, error);
    }
  });
  app.get("/api/integrations/vapi/catalog", async (_req, res) => {
    try {
      res.json(await getVapiCatalog());
    } catch (error) {
      sendError(res, error);
    }
  });
  app.post("/api/calls", async (req, res) => {
    try {
      const parsed = callSchema.safeParse(req.body);
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "INVALID_CALL", message: parsed.error.message });
      const lead = await findLead(store, ownerOf(req), parsed.data.leadId);
      if (!lead)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Lead bulunamadı." });
      if (!providerConfigured("vapi"))
        return res.status(503).json({
          error: "VAPI_NOT_CONFIGURED",
          message: "Vapi arama ayarları yapılandırılmamış.",
        });
      if (!parsed.data.lineId)
        return res.status(400).json({
          error: "LINE_ID_REQUIRED",
          message: "Çağrı için mantıksal lineId gerekli.",
        });
      const result = await createVapiCall(
        lead.phone,
        parsed.data.assistantId || process.env.VAPI_ASSISTANT_ID || "",
        parsed.data.lineId,
      );
      const call = {
        id: String(result?.id || id("call")),
        leadId: lead.id,
        lineId: parsed.data.lineId,
        assistantId: parsed.data.assistantId || process.env.VAPI_ASSISTANT_ID,
        provider: "vapi",
        direction: "outbound",
        status: result?.status || "queued",
        providerResult: result,
        createdAt: now(),
      };
      await store.put("call", call.id, call, ownerOf(req));
      res.status(201).json(publicCall(call));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/integrations/:provider/test", async (req, res) => {
    try {
      const parsed = providerSchema.safeParse(req.params.provider);
      if (!parsed.success)
        return res.status(404).json({ error: "UNKNOWN_PROVIDER" });
      if (!providerConfigured(parsed.data))
        return res.status(503).json({
          provider: parsed.data,
          configured: false,
          message: "Entegrasyon yapılandırılmamış.",
        });
      const result = await testProvider(parsed.data);
      res.json({
        provider: parsed.data,
        configured: true,
        readOnly: true,
        result,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/events/:id/retry", async (req, res) => {
    try {
      const event = await store.getEvent(req.params.id, ownerOf(req));
      if (!event)
        return res
          .status(404)
          .json({ error: "NOT_FOUND", message: "Olay bulunamadı." });
      if (!["pending", "failed"].includes(event.status))
        return res.status(409).json({
          error: "NOT_RETRYABLE",
          message:
            event.status === "needs_review"
              ? "Belirsiz sağlayıcı sonucu otomatik yeniden gönderilmez."
              : "Olay yeniden denenebilir durumda değil.",
        });
      const attempts = event.attempts + 1;
      await store.updateEvent(event.id, ownerOf(req), {
        status: "processing",
        attempts,
        lastError: null,
      });
      try {
        const result = await executeOutbox(store, event);
        const updated = await store.updateEvent(event.id, ownerOf(req), {
          status: "completed",
          nextAttemptAt: null,
          payload: { ...event.payload, result },
        });
        return res.json(updated ? publicEvent(updated) : null);
      } catch (error) {
        if (isUncertainProviderError(error)) {
          const updated = await store.updateEvent(event.id, ownerOf(req), {
            status: "needs_review",
            attempts: 5,
            nextAttemptAt: null,
            lastError: `Belirsiz sağlayıcı sonucu; yeniden gönderilmedi: ${errorMessage(error)}`,
          });
          return res.status(502).json({
            error: "OUTBOX_NEEDS_REVIEW",
            message: errorMessage(error),
            event: updated ? publicEvent(updated) : null,
          });
        }
        const transient = !(
          (providerStatus(error) || 0) >= 400 &&
          (providerStatus(error) || 0) < 500
        );
        const next =
          transient && attempts < 5
            ? new Date(
                Date.now() +
                  Math.min(3600, 2 ** Math.max(0, attempts - 1)) * 1000,
              ).toISOString()
            : null;
        const updated = await store.updateEvent(event.id, ownerOf(req), {
          status: "failed",
          attempts: transient ? attempts : 5,
          nextAttemptAt: next,
          lastError: errorMessage(error),
        });
        return res.status(502).json({
          error: "OUTBOX_RETRY_FAILED",
          message: errorMessage(error),
          event: updated ? publicEvent(updated) : null,
        });
      }
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/bitrix/placement", async (req, res) => {
    try {
      const authId = String(
        req.headers["x-bitrix-auth"] || req.body?.AUTH_ID || "",
      );
      const placement = String(req.body?.PLACEMENT || "");
      const context = await verifyBitrixContext(
        authId,
        placement,
        req.body?.PLACEMENT_OPTIONS,
      );
      res.json({ ok: true, context });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) =>
    sendError(res, error),
  );
  return app;
}
