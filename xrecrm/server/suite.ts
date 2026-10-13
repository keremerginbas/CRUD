import { StagePolicySchema } from "../shared/crm-stage-policy.js";
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import { normalizePhone } from "./security.js";

export const suiteKinds = [
  "contacts",
  "companies",
  "pipelines",
  "tasks",
  "activities",
  "feed",
  "members",
] as const;
export type SuiteKind = (typeof suiteKinds)[number];

const stages = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;
export type SuiteStage = (typeof stages)[number];

const nonEmptySafeString = (max: number) => z.string().trim().min(1).max(max);
const safeString = (max: number) => z.string().max(max);
const emailString = z
  .string()
  .max(320)
  .refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: "Geçerli bir e-posta adresi gerekli.",
  });
const isoDate = z.string().datetime({ offset: true });
const isoOrEmpty = z.union([isoDate, z.literal("")]);
const idString = nonEmptySafeString(191);

const checklistItemSchema = z.object({
  id: idString,
  text: nonEmptySafeString(1000),
  done: z.boolean(),
});
const commentSchema = z.object({
  id: idString,
  author: nonEmptySafeString(191),
  text: nonEmptySafeString(5000),
  createdAt: isoDate,
});
const stageSchema = z.object({
  id: z.enum(stages),
  label: nonEmptySafeString(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Renk geçerli hex biçiminde olmalı."),
});
const pipelineStagesSchema = z
  .array(stageSchema)
  .length(6)
  .refine(
    (items) =>
      new Set(items.map((item) => item.id)).size === 6 &&
      stages.every((stage) => items.some((item) => item.id === stage)),
    "Pipeline tüm altı aşamayı birer kez içermeli.",
  );

export const ContactSchema = z.object({
  id: idString,
  name: nonEmptySafeString(200),
  phone: safeString(80).default(""),
  email: emailString.default(""),
  companyId: safeString(191).default(""),
  owner: safeString(191).default(""),
  tags: z.array(safeString(80)).max(100).default([]),
  notes: safeString(10000).default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Contact = z.infer<typeof ContactSchema>;

export const CompanySchema = z.object({
  id: idString,
  name: nonEmptySafeString(200),
  industry: safeString(200).default(""),
  phone: safeString(80).default(""),
  email: emailString.default(""),
  website: safeString(2048).default(""),
  address: safeString(1000).default(""),
  owner: safeString(191).default(""),
  notes: safeString(10000).default(""),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Company = z.infer<typeof CompanySchema>;

export const PipelineSchema = z.object({
  id: idString,
  name: nonEmptySafeString(200),
  description: safeString(10000).default(""),
  stages: pipelineStagesSchema,
  requiredFieldsByStage: StagePolicySchema.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Pipeline = z.infer<typeof PipelineSchema>;

export const TaskSchema = z.object({
  id: idString,
  title: nonEmptySafeString(300),
  description: safeString(10000).default(""),
  status: z.enum(["todo", "progress", "done"]),
  priority: z.enum(["low", "normal", "high"]),
  assignee: safeString(191).default(""),
  leadId: safeString(191).default(""),
  dueAt: isoOrEmpty.default(""),
  checklist: z.array(checklistItemSchema).max(200).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Task = z.infer<typeof TaskSchema>;

export const ActivitySchema = z
  .object({
    id: idString,
    leadId: safeString(191).default(""),
    type: z.enum(["call", "meeting", "task"]),
    title: nonEmptySafeString(300),
    description: safeString(10000).default(""),
    startAt: isoDate,
    endAt: isoDate,
    assignee: safeString(191).default(""),
    cancelled: z.boolean().optional(),
    appointmentLinked: z.boolean().optional(),
    meetingUrl: z.string().max(2048).optional(),
    provider: z.enum(["google", "manual"]).optional(),
    meetingProvider: z.enum(["google", "manual"]).optional(),
    googleEventId: safeString(1024).optional(),
    conferenceStatus: z
      .enum(["ready", "pending", "failed", "unavailable"])
      .optional(),
    attendees: z.array(emailString).max(100).optional(),
    completed: z.boolean().default(false),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .superRefine((value, context) => {
    if (Date.parse(value.endAt) < Date.parse(value.startAt))
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Bitiş tarihi başlangıçtan önce olamaz.",
      });
  });
export type Activity = z.infer<typeof ActivitySchema>;

export const FeedPostSchema = z.object({
  id: idString,
  author: nonEmptySafeString(191),
  text: nonEmptySafeString(10000),
  leadId: safeString(191).default(""),
  likes: z.array(safeString(191)).max(10000).default([]),
  comments: z.array(commentSchema).max(1000).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type FeedPost = z.infer<typeof FeedPostSchema>;

export const MemberSchema = z.object({
  id: idString,
  name: nonEmptySafeString(200),
  email: emailString.default(""),
  title: safeString(200).default(""),
  department: safeString(200).default(""),
  status: z.enum(["active", "away"]).default("active"),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Member = z.infer<typeof MemberSchema>;

const schemas = {
  contacts: ContactSchema,
  companies: CompanySchema,
  pipelines: PipelineSchema,
  tasks: TaskSchema,
  activities: ActivitySchema,
  feed: FeedPostSchema,
  members: MemberSchema,
} as const;

const prefixes: Record<SuiteKind, string> = {
  contacts: "contact",
  companies: "company",
  pipelines: "pipeline",
  tasks: "task",
  activities: "activity",
  feed: "feed",
  members: "member",
};

function now(): string {
  return new Date().toISOString();
}
function makeId(kind: SuiteKind): string {
  return `${prefixes[kind]}_${crypto.randomUUID()}`;
}
function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");
}
function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}
function statusError(
  statusCode: number,
  message: string,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
function owner(req: Request): string {
  return (req as Request & { auth?: { ownerOpenId: string } }).auth!
    .ownerOpenId;
}
function errorStatus(error: unknown): number {
  if (error instanceof z.ZodError) return 400;
  return Number((error as { statusCode?: number })?.statusCode) || 500;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Beklenmeyen sunucu hatası.";
}
function sendSuiteError(res: Response, error: unknown): void {
  const status = errorStatus(error);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error:
      status === 400
        ? "INVALID_REQUEST"
        : status === 409
          ? "CONFLICT"
          : "SERVER_ERROR",
    message: errorMessage(error),
  });
}
function safePayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw statusError(400, "İstek gövdesi nesne olmalı.");
  return body as Record<string, unknown>;
}
function parseInput(
  kind: SuiteKind,
  input: Record<string, unknown>,
  id: string,
  timestamp: string,
): any {
  return schemas[kind].parse({
    ...input,
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
function parsePatch(
  kind: SuiteKind,
  input: Record<string, unknown>,
  old: any,
  timestamp: string,
): any {
  const patch = { ...input };
  delete patch.id;
  delete patch.createdAt;
  delete patch.updatedAt;
  return schemas[kind].parse({
    ...old,
    ...patch,
    id: old.id,
    createdAt: old.createdAt,
    updatedAt: timestamp,
  });
}

async function assertCompany(
  store: Store,
  ownerOpenId: string,
  companyId: string,
): Promise<void> {
  if (companyId && !(await store.get("companies", companyId, ownerOpenId)))
    throw statusError(400, "Şirket bağlantısı bu owner kapsamına ait değil.");
}
async function assertLead(
  store: Store,
  ownerOpenId: string,
  leadId: string,
): Promise<Record<string, unknown> | null> {
  if (!leadId) return null;
  const record = await store.get<Record<string, unknown>>(
    "lead",
    leadId,
    ownerOpenId,
  );
  if (!record)
    throw statusError(400, "Lead bağlantısı bu owner kapsamına ait değil.");
  return record.payload;
}
async function assertContact(
  store: Store,
  ownerOpenId: string,
  contactId: string,
): Promise<Contact | null> {
  if (!contactId) return null;
  const record = await store.get<Contact>("contacts", contactId, ownerOpenId);
  if (!record)
    throw statusError(400, "Kişi bağlantısı bu owner kapsamına ait değil.");
  return record.payload;
}
async function assertPipeline(
  store: Store,
  ownerOpenId: string,
  pipelineId: string,
): Promise<void> {
  if (!pipelineId || pipelineId === "sales") return;
  if (!(await store.get("pipelines", pipelineId, ownerOpenId)))
    throw statusError(400, "Pipeline bağlantısı bu owner kapsamına ait değil.");
}

export async function validateLeadReferences(
  store: Store,
  ownerOpenId: string,
  lead: Record<string, unknown>,
): Promise<void> {
  const companyId = typeof lead.companyId === "string" ? lead.companyId : "";
  const contactId = typeof lead.contactId === "string" ? lead.contactId : "";
  const pipelineId = typeof lead.pipelineId === "string" ? lead.pipelineId : "";
  await assertCompany(store, ownerOpenId, companyId);
  await assertPipeline(store, ownerOpenId, pipelineId);
  const contact = await assertContact(store, ownerOpenId, contactId);
  if (
    contact &&
    companyId &&
    contact.companyId &&
    contact.companyId !== companyId
  )
    throw statusError(400, "Lead kişi ve şirket bağlantıları eşleşmiyor.");
}

async function assertForeignKeys(
  store: Store,
  ownerOpenId: string,
  kind: SuiteKind,
  value: any,
): Promise<void> {
  if (kind === "contacts")
    await assertCompany(store, ownerOpenId, value.companyId);
  if (kind === "tasks" || kind === "activities" || kind === "feed")
    await assertLead(store, ownerOpenId, value.leadId);
}
async function assertDuplicates(
  store: Store,
  ownerOpenId: string,
  kind: SuiteKind,
  value: any,
  currentId?: string,
): Promise<void> {
  const rows = await store.list<any>(kind, ownerOpenId);
  if (kind === "companies") {
    const target = normalizeName(value.name);
    if (
      rows.some(
        (row) =>
          row.id !== currentId &&
          normalizeName(String(row.payload.name || "")) === target,
      )
    )
      throw statusError(409, "Bu şirket adıyla kayıt zaten var.");
  }
  if (kind === "contacts") {
    const phone = normalizePhone(value.phone);
    const email = normalizeEmail(value.email);
    const duplicate = rows.find((row) => {
      if (row.id === currentId) return false;
      const oldPhone = normalizePhone(row.payload.phone);
      const oldEmail = normalizeEmail(String(row.payload.email || ""));
      return (phone && oldPhone === phone) || (email && oldEmail === email);
    });
    if (duplicate)
      throw statusError(409, "Bu telefon veya e-posta ile kişi zaten var.");
  }
}

async function appendSuiteEvent(
  store: Store,
  ownerOpenId: string,
  kind: SuiteKind,
  entity: any,
  action: "oluşturuldu" | "güncellendi",
): Promise<void> {
  const labels: Record<SuiteKind, string> = {
    contacts: "Kişi",
    companies: "Şirket",
    pipelines: "Pipeline",
    tasks: "Görev",
    activities: "Aktivite",
    feed: "Akış gönderisi",
    members: "Ekip dizini kaydı",
  };
  await store.appendEvent(
    ownerOpenId,
    `suite:${kind}:${entity.id}:${entity.updatedAt}:${action}:${crypto.randomUUID()}`,
    {
      type: "suite-change",
      kind,
      entityId: entity.id,
      ...(entity.leadId ? { leadId: entity.leadId } : {}),
      title: `${labels[kind]} ${action}`,
      detail: `${labels[kind]}: ${entity.name || entity.title || entity.text || entity.id}`,
      createdAt: entity.updatedAt,
    },
    "completed",
  );
}

export async function getSuiteState(
  store: Store,
  ownerOpenId: string,
): Promise<{
  contacts: Contact[];
  companies: Company[];
  pipelines: Pipeline[];
  tasks: Task[];
  activities: Activity[];
  feed: FeedPost[];
  members: Member[];
}> {
  const [contacts, companies, pipelines, tasks, activities, feed, members] =
    await Promise.all(
      suiteKinds.map((kind) => store.list<any>(kind, ownerOpenId)),
    );
  const due = (value: Task) =>
    value.dueAt ? Date.parse(value.dueAt) : Number.POSITIVE_INFINITY;
  const taskPayloads = tasks
    .map((row) => row.payload as Task)
    .sort(
      (a, b) =>
        due(a) - due(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  return {
    contacts: contacts.map((row) => row.payload as Contact),
    companies: companies.map((row) => row.payload as Company),
    pipelines: pipelines.map((row) => row.payload as Pipeline),
    tasks: taskPayloads,
    activities: activities.map((row) => row.payload as Activity),
    feed: feed
      .map((row) => row.payload as FeedPost)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    members: members.map((row) => row.payload as Member),
  };
}

export function registerSuiteRoutes(app: Express, store: Store): void {
  for (const kind of suiteKinds) {
    app.post(`/api/${kind}`, async (req, res) => {
      try {
        const input = safePayload(req.body);
        const timestamp = now();
        const entity = parseInput(
          kind,
          input,
          typeof input.id === "string" && input.id.trim()
            ? input.id
            : makeId(kind),
          timestamp,
        );
        const ownerOpenId = owner(req);
        if (await store.get(kind, entity.id, ownerOpenId))
          throw statusError(409, "Bu kimlikte kayıt zaten var.");
        await assertForeignKeys(store, ownerOpenId, kind, entity);
        await assertDuplicates(store, ownerOpenId, kind, entity);
        const inserted = await store.insertIfAbsent(
          kind,
          entity.id,
          entity,
          ownerOpenId,
        );
        if (!inserted.inserted)
          throw statusError(
            409,
            "Bu kimlikte kayıt zaten var; mevcut kayıt değiştirilmedi.",
          );
        const saved = inserted.record!;
        await appendSuiteEvent(
          store,
          ownerOpenId,
          kind,
          saved.payload,
          "oluşturuldu",
        );
        return res.status(201).json(saved.payload);
      } catch (error) {
        sendSuiteError(res, error);
      }
    });

    app.patch(`/api/${kind}/:id`, async (req, res) => {
      try {
        const ownerOpenId = owner(req);
        const old = await store.get<any>(kind, req.params.id, ownerOpenId);
        if (!old)
          return res
            .status(404)
            .json({ error: "NOT_FOUND", message: "Kayıt bulunamadı." });
        const entity = parsePatch(
          kind,
          safePayload(req.body),
          old.payload,
          now(),
        );
        await assertForeignKeys(store, ownerOpenId, kind, entity);
        await assertDuplicates(store, ownerOpenId, kind, entity, req.params.id);
        const saved = await store.put(kind, req.params.id, entity, ownerOpenId);
        await appendSuiteEvent(
          store,
          ownerOpenId,
          kind,
          saved.payload,
          "güncellendi",
        );
        return res.json(saved.payload);
      } catch (error) {
        sendSuiteError(res, error);
      }
    });
  }
}

export function taskFromRuleEvent(
  eventId: string,
  lead: Record<string, unknown> | null,
  config: Record<string, unknown>,
  timestamp: string,
): Task {
  const assignee =
    typeof config.assignee === "string" && config.assignee.trim()
      ? config.assignee
      : typeof lead?.owner === "string"
        ? lead.owner
        : "";
  const configuredDueAt =
    typeof config.dueAt === "string" && config.dueAt ? config.dueAt : "";
  const dueHoursValue =
    typeof config.dueHours === "string"
      ? Number(config.dueHours)
      : Number(config.dueHours);
  const dueHours =
    Number.isFinite(dueHoursValue) && dueHoursValue >= 1 && dueHoursValue <= 720
      ? dueHoursValue
      : 24;
  const dueAt =
    configuredDueAt ||
    new Date(Date.parse(timestamp) + dueHours * 60 * 60 * 1000).toISOString();
  return TaskSchema.parse({
    id: `task-event-${eventId}`,
    title: String(config.title || config.template || "Takip görevi"),
    description:
      typeof config.description === "string" ? config.description : "",
    status: "todo",
    priority:
      config.priority === "low" || config.priority === "high"
        ? config.priority
        : "normal",
    assignee,
    leadId:
      typeof lead?.id === "string"
        ? lead.id
        : typeof config.leadId === "string"
          ? config.leadId
          : "",
    dueAt,
    checklist: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
