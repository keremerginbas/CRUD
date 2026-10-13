import { AsyncLocalStorage } from "node:async_hooks";
import type { Express, NextFunction, Request, Response } from "express";
import type { Store } from "./db.js";
import type {
  AuthContext,
  StoredEvent,
  StoredRecord,
  UserIdentity,
} from "./types.js";
import {
  ACCESS_MODULES,
  type AccessDepartment,
  type AccessEmployee,
  type AccessModule,
  type AccessRole,
  type ModulePermission,
  type PermissionMap,
  DEFAULT_ROLES,
  clonePermissionMap,
  defaultRole,
  emptyPermissionMap,
} from "../shared/access.js";

export class AccessError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 403, code = "FORBIDDEN") {
    super(message);
    this.name = "AccessError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type PermissionContext = { auth: AuthContext; rawStore: Store };
const permissionContexts = new AsyncLocalStorage<PermissionContext>();
const rawStores = new WeakMap<object, Store>();

export function rawStoreOf<T extends Store>(store: T): Store {
  return rawStores.get(store as object) || store;
}

export function currentPermissionContext(): PermissionContext | undefined {
  return permissionContexts.getStore();
}

export const getPermissionContext = currentPermissionContext;

/** Run the remainder of an Express request in the authorization scope. */
export function withPermissionContext(
  store: Store,
  auth: AuthContext,
  next: () => void,
): void {
  permissionContexts.run({ auth, rawStore: rawStoreOf(store) }, next);
}

export function permissionFor(
  auth: AuthContext | undefined,
  module: AccessModule,
): ModulePermission {
  if (auth?.isOwner) return { read: true, write: true, scope: "all" };
  return (
    auth?.permissions?.[module] || {
      read: false,
      write: false,
      scope: "own",
    }
  );
}

export function canAccess(
  auth: AuthContext | undefined,
  module: AccessModule,
  action: "read" | "write" = "read",
): boolean {
  const permission = permissionFor(auth, module);
  return action === "read" ? permission.read : permission.write;
}

export const hasPermission = canAccess;

function deny(message: string, code = "FORBIDDEN"): never {
  throw new AccessError(message, 403, code);
}

export const KIND_MODULE: Record<string, AccessModule> = {
  lead: "crm",
  pipeline: "crm",
  pipelines: "crm",
  contact: "contacts",
  contacts: "contacts",
  company: "companies",
  companies: "companies",
  task: "tasks",
  tasks: "tasks",
  activity: "calendar",
  activities: "calendar",
  calendar: "calendar",
  feed: "feed",
  message: "whatsapp",
  messages: "whatsapp",
  call: "calls",
  calls: "calls",
  report: "reports",
  ai_chat: "ai",
  assistant_thread: "ai",
  conversation_analysis: "ai",
  integration: "integrations",
  integrations: "integrations",
  connection: "integrations",
  line: "integrations",
  rule: "automations",
  automation: "automations",
  n8n: "integrations",
  n8n_report: "integrations",
  member: "users",
  members: "users",
  employee: "users",
  profile: "users",
  user: "users",
  role: "access",
  department: "departments",
  worktime: "worktime",
  worktime_operation: "worktime",
  notification: "feed",
  notification_ack: "feed",
};

function moduleForKind(kind: string): AccessModule | undefined {
  return KIND_MODULE[kind.toLowerCase()];
}

export const moduleForRecordKind = moduleForKind;

function payloadOf(
  record: StoredRecord | null | undefined,
): Record<string, any> {
  return record?.payload && typeof record.payload === "object"
    ? (record.payload as Record<string, any>)
    : {};
}

function authValues(auth: AuthContext): Set<string> {
  return new Set(
    [auth.employeeId, auth.user.openId]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

async function knownEmployee(
  store: Store,
  ownerOpenId: string,
  auth: AuthContext,
  value: unknown,
): Promise<AccessEmployee | undefined> {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const employees = await store.list<AccessEmployee>("employee", ownerOpenId);
  return employees
    .map((item) => item.payload)
    .find(
      (employee) =>
        employee.openId === value ||
        employee.id === value ||
        employee.name === value,
    );
}

/**
 * Row ownership intentionally never trusts the JWT email. It uses the signed
 * Manus openId, the admitted employee id, or the lead's explicitly assigned
 * employee identity. Related objects inherit the lead's ownership.
 */
async function isOwnRecord(
  store: Store,
  ownerOpenId: string,
  auth: AuthContext,
  kind: string,
  record: StoredRecord,
  seen = new Set<string>(),
): Promise<boolean> {
  if (auth.isOwner) return true;
  const payload = payloadOf(record);
  const values = authValues(auth);
  const ownKeys = [
    "ownerOpenId",
    "assignedOpenId",
    "assigneeOpenId",
    "createdByOpenId",
    "userOpenId",
    "actorOpenId",
    "employeeId",
    "assignee",
    "assignedTo",
    "owner",
    "createdBy",
  ];
  for (const key of ownKeys) {
    const value = payload[key];
    if (typeof value === "string" && values.has(value)) return true;
    const employee = await knownEmployee(store, ownerOpenId, auth, value);
    if (employee && values.has(employee.openId)) return true;
  }
  if (kind === "assistant_thread" || kind === "notification_ack")
    return payload.userOpenId === auth.user.openId;
  if (payload.openId && values.has(String(payload.openId))) return true;
  if (payload.email && auth.user.email && payload.email === auth.user.email) {
    // Email is only a convenience for a profile row after openId matching has
    // already admitted the actor; it is never used by verifyRequestSession.
    if (["profile", "employee"].includes(kind)) return true;
  }
  const leadId = payload.leadId || payload.entityLeadId || payload.sourceLeadId;
  if (leadId && !seen.has(String(leadId))) {
    seen.add(String(leadId));
    const lead = await store.get("lead", String(leadId), ownerOpenId);
    if (
      lead &&
      (await isOwnRecord(store, ownerOpenId, auth, "lead", lead, seen))
    )
      return true;
  }
  if (["contact", "contacts", "company", "companies"].includes(kind)) {
    const relationKey = kind.startsWith("company") ? "companyId" : "contactId";
    const relation = record.id;
    if (relation) {
      const leads = await store.list<any>("lead", ownerOpenId);
      for (const lead of leads) {
        if (payloadOf(lead)[relationKey] === record.id) {
          if (await isOwnRecord(store, ownerOpenId, auth, "lead", lead, seen))
            return true;
        }
      }
    }
  }
  // A feed/event may carry its lead id under the event payload.
  const nestedLeadId = payload.payload?.leadId;
  if (nestedLeadId && !seen.has(String(nestedLeadId))) {
    const lead = await store.get("lead", String(nestedLeadId), ownerOpenId);
    if (
      lead &&
      (await isOwnRecord(store, ownerOpenId, auth, "lead", lead, seen))
    )
      return true;
  }
  return false;
}

async function filterRecords(
  store: Store,
  ownerOpenId: string,
  auth: AuthContext,
  kind: string,
  records: StoredRecord[],
): Promise<StoredRecord[]> {
  const permission = moduleForKind(kind);
  if (!permission || auth.isOwner) return records;
  const grant = permissionFor(auth, permission);
  if (!grant.read) return [];
  if (grant.scope === "all" || ["pipeline", "pipelines"].includes(kind))
    return records;
  const result: StoredRecord[] = [];
  for (const record of records) {
    if (await isOwnRecord(store, ownerOpenId, auth, kind, record))
      result.push(record);
  }
  return result;
}

function eventRecord(event: StoredEvent): StoredRecord {
  return {
    kind: "feed",
    id: event.id,
    payload: { ...event.payload, leadId: event.payload?.leadId },
    ownerOpenId: event.ownerOpenId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

async function filterEvents(
  store: Store,
  ownerOpenId: string,
  auth: AuthContext,
  events: StoredEvent[],
): Promise<StoredEvent[]> {
  if (auth.isOwner) return events;
  const grant = permissionFor(auth, "feed");
  if (!grant.read) return [];
  if (grant.scope === "all") return events;
  const records = await filterRecords(
    store,
    ownerOpenId,
    auth,
    "feed",
    events.map(eventRecord),
  );
  const allowed = new Set(records.map((record) => record.id));
  return events.filter((event) => allowed.has(event.id));
}

function assertOwnerArgument(auth: AuthContext, ownerOpenId: string): void {
  if (!auth.isOwner && ownerOpenId !== auth.ownerOpenId)
    deny("Başka bir çalışma alanının kayıtlarına erişilemez.");
}

async function scopedList<T>(
  raw: Store,
  auth: AuthContext,
  kind: string,
  ownerOpenId: string,
): Promise<StoredRecord<T>[]> {
  assertOwnerArgument(auth, ownerOpenId);
  const permission = moduleForKind(kind);
  if (!permission && !auth.isOwner) return [];
  if (permission && !auth.isOwner && !canAccess(auth, permission, "read"))
    return [];
  const records = await raw.list<T>(kind, ownerOpenId);
  return (await filterRecords(
    raw,
    ownerOpenId,
    auth,
    kind,
    records,
  )) as StoredRecord<T>[];
}

async function scopedGet<T>(
  raw: Store,
  auth: AuthContext,
  kind: string,
  id: string,
  ownerOpenId: string,
): Promise<StoredRecord<T> | null> {
  assertOwnerArgument(auth, ownerOpenId);
  const permission = moduleForKind(kind);
  if (!permission && !auth.isOwner) return null;
  if (permission && !auth.isOwner && !canAccess(auth, permission, "read"))
    return null;
  const record = await raw.get<T>(kind, id, ownerOpenId);
  if (!record || auth.isOwner || !permission) return record;
  const visible = await filterRecords(raw, ownerOpenId, auth, kind, [record]);
  return (visible[0] as StoredRecord<T> | undefined) || null;
}

function forceOwnPayload(
  kind: string,
  payload: Record<string, any>,
  auth: AuthContext,
): Record<string, any> {
  const next = { ...payload };
  const id = auth.employeeId || auth.user.openId;
  const name = auth.displayName || auth.user.name || id;
  if (["lead", "contacts", "companies"].includes(kind)) {
    next.owner = name;
    next.ownerOpenId = id;
  }
  if (["task", "tasks", "activity", "calendar"].includes(kind)) {
    next.assignee = name;
    next.assigneeOpenId = id;
  }
  if (["feed", "message", "messages", "call", "calls"].includes(kind)) {
    next.createdByOpenId = id;
    next.ownerOpenId = id;
  }
  return next;
}

function ensureSameOwnership(
  kind: string,
  oldPayload: Record<string, any>,
  newPayload: Record<string, any>,
  auth: AuthContext,
): void {
  const sensitive = [
    "ownerOpenId",
    "assignedOpenId",
    "assigneeOpenId",
    "createdByOpenId",
    "employeeId",
  ];
  for (const key of sensitive) {
    if (
      oldPayload[key] !== undefined &&
      newPayload[key] !== undefined &&
      oldPayload[key] !== newPayload[key]
    )
      deny(
        "Kendi kapsamınızdaki kaydın sahipliği başka kullanıcıya aktarılamaz.",
        "OWNERSHIP_TRANSFER",
      );
  }
  const displayKey = ["lead", "contacts", "companies"].includes(kind)
    ? "owner"
    : "assignee";
  if (
    oldPayload[displayKey] !== undefined &&
    newPayload[displayKey] !== undefined &&
    oldPayload[displayKey] !== newPayload[displayKey] &&
    newPayload[displayKey] !== (auth.displayName || auth.user.name)
  )
    deny(
      "Kendi kapsamınızdaki kaydın sorumlusu değiştirilemez.",
      "OWNERSHIP_TRANSFER",
    );
}

async function scopedPut<T>(
  raw: Store,
  auth: AuthContext,
  kind: string,
  id: string,
  payload: T,
  ownerOpenId: string,
): Promise<StoredRecord<T>> {
  assertOwnerArgument(auth, ownerOpenId);
  const permission = moduleForKind(kind);
  if (!permission && !auth.isOwner)
    deny("Bu kayıt türü için yetkiniz yok.", "UNKNOWN_KIND");
  if (kind === "notification_ack" && !auth.isOwner) {
    const input = payloadOf({ payload } as StoredRecord);
    if (input.userOpenId && input.userOpenId !== auth.user.openId)
      deny(
        "Bildirim yalnızca kendi oturumunuz için işaretlenebilir.",
        "OUT_OF_SCOPE",
      );
    return raw.put(
      kind,
      id,
      { ...input, userOpenId: auth.user.openId } as T,
      ownerOpenId,
    );
  }
  if (permission && !auth.isOwner && !canAccess(auth, permission, "write"))
    deny(`${permission} modülünde yazma yetkiniz yok.`, "WRITE_DENIED");
  const old = await raw.get(kind, id, ownerOpenId);
  let nextPayload = payload;
  if (
    permission &&
    !auth.isOwner &&
    permissionFor(auth, permission).scope === "own"
  ) {
    if (old && !(await isOwnRecord(raw, ownerOpenId, auth, kind, old)))
      deny("Bu kayıt kendi kapsamınızın dışında.", "OUT_OF_SCOPE");
    const input = payloadOf({ payload } as StoredRecord);
    if (old) ensureSameOwnership(kind, payloadOf(old), input, auth);
    nextPayload = forceOwnPayload(kind, input, auth) as T;
  }
  return raw.put(kind, id, nextPayload, ownerOpenId);
}

async function scopedDelete(
  raw: Store,
  auth: AuthContext,
  kind: string,
  id: string,
  ownerOpenId: string,
): Promise<void> {
  assertOwnerArgument(auth, ownerOpenId);
  const permission = moduleForKind(kind);
  if (!permission && !auth.isOwner)
    deny("Bu kayıt türü için yetkiniz yok.", "UNKNOWN_KIND");
  if (permission && !auth.isOwner && !canAccess(auth, permission, "write"))
    deny(`${permission} modülünde yazma yetkiniz yok.`, "WRITE_DENIED");
  if (
    !auth.isOwner &&
    permissionFor(auth, permission || "crm").scope === "own"
  ) {
    const old = await raw.get(kind, id, ownerOpenId);
    if (!old || !(await isOwnRecord(raw, ownerOpenId, auth, kind, old)))
      deny("Bu kayıt kendi kapsamınızın dışında.", "OUT_OF_SCOPE");
  }
  return raw.delete(kind, id, ownerOpenId);
}

/**
 * Store proxy used by all request handlers. The raw store remains available to
 * admission, webhooks and workers through rawStoreOf/currentPermissionContext.
 */
export function createPermissionStore(rawStore: Store): Store {
  const raw = rawStoreOf(rawStore);
  // Ownership queries use the persistence layer. Writes must retain the
  // supplied invariant wrappers after the actor/ownership checks succeed.
  const validatedWrites: Store = new Proxy(raw, {
    get(target, key) {
      if (key === "put") return rawStore.put.bind(rawStore);
      if (key === "insertIfAbsent")
        return rawStore.insertIfAbsent.bind(rawStore);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const proxy: Store = {
    init: () => raw.init(),
    readiness: () => raw.readiness(),
    resolveOwner: () => raw.resolveOwner(),
    claimOwner: (user) => raw.claimOwner(user),
    list: async <T>(kind: string, ownerOpenId: string) => {
      const context = permissionContexts.getStore();
      return context
        ? scopedList<T>(context.rawStore, context.auth, kind, ownerOpenId)
        : raw.list<T>(kind, ownerOpenId);
    },
    get: async <T>(kind: string, id: string, ownerOpenId: string) => {
      const context = permissionContexts.getStore();
      return context
        ? scopedGet<T>(context.rawStore, context.auth, kind, id, ownerOpenId)
        : raw.get<T>(kind, id, ownerOpenId);
    },
    put: async <T>(
      kind: string,
      id: string,
      payload: T,
      ownerOpenId: string,
    ) => {
      const context = permissionContexts.getStore();
      return context
        ? scopedPut<T>(
            validatedWrites,
            context.auth,
            kind,
            id,
            payload,
            ownerOpenId,
          )
        : validatedWrites.put<T>(kind, id, payload, ownerOpenId);
    },
    insertIfAbsent: async <T>(
      kind: string,
      id: string,
      payload: T,
      ownerOpenId: string,
    ) => {
      const context = permissionContexts.getStore();
      let safePayload = payload;
      if (context) {
        assertOwnerArgument(context.auth, ownerOpenId);
        const permission = moduleForKind(kind);
        if (
          !context.auth.isOwner &&
          (!permission || !canAccess(context.auth, permission, "write"))
        )
          deny("Bu kayıt türünde yazma yetkiniz yok.", "WRITE_DENIED");
        if (
          permission &&
          !context.auth.isOwner &&
          permissionFor(context.auth, permission).scope === "own"
        )
          safePayload = forceOwnPayload(
            kind,
            payloadOf({ payload } as StoredRecord),
            context.auth,
          ) as T;
      }
      return validatedWrites.insertIfAbsent<T>(
        kind,
        id,
        safePayload,
        ownerOpenId,
      );
    },
    delete: async (kind: string, id: string, ownerOpenId: string) => {
      const context = permissionContexts.getStore();
      return context
        ? scopedDelete(context.rawStore, context.auth, kind, id, ownerOpenId)
        : raw.delete(kind, id, ownerOpenId);
    },
    appendEvent: async (
      ownerOpenId,
      eventKey,
      payload,
      status,
      scheduledAt,
    ) => {
      const context = permissionContexts.getStore();
      if (context && !context.auth.isOwner) {
        assertOwnerArgument(context.auth, ownerOpenId);
        // Audit/outbox events are generated by trusted server routes, not editable feed posts.
      }
      return raw.appendEvent(
        ownerOpenId,
        eventKey,
        payload,
        status,
        scheduledAt,
      );
    },
    getEvent: async (id, ownerOpenId) => {
      const context = permissionContexts.getStore();
      if (!context) return raw.getEvent(id, ownerOpenId);
      assertOwnerArgument(context.auth, ownerOpenId);
      const event = await raw.getEvent(id, ownerOpenId);
      if (!event) return null;
      const filtered = await filterEvents(
        context.rawStore,
        ownerOpenId,
        context.auth,
        [event],
      );
      return filtered[0] || null;
    },
    listEvents: async (ownerOpenId) => {
      const context = permissionContexts.getStore();
      if (!context) return raw.listEvents(ownerOpenId);
      assertOwnerArgument(context.auth, ownerOpenId);
      return filterEvents(
        context.rawStore,
        ownerOpenId,
        context.auth,
        await raw.listEvents(ownerOpenId),
      );
    },
    updateEvent: async (id, ownerOpenId, patch) => {
      const context = permissionContexts.getStore();
      if (context && !context.auth.isOwner) {
        assertOwnerArgument(context.auth, ownerOpenId);
        if (!canAccess(context.auth, "feed", "write"))
          deny("Akış olayını değiştirme yetkiniz yok.", "WRITE_DENIED");
        const event = await raw.getEvent(id, ownerOpenId);
        if (
          !event ||
          !(
            await filterEvents(context.rawStore, ownerOpenId, context.auth, [
              event,
            ])
          ).length
        )
          deny("Bu akış olayı kendi kapsamınızın dışında.", "OUT_OF_SCOPE");
      }
      return raw.updateEvent(id, ownerOpenId, patch);
    },
    claimDueEvents: (limit) => raw.claimDueEvents(limit),
  };
  rawStores.set(proxy as object, raw);
  return proxy;
}

function safePermissionMap(value: unknown): PermissionMap {
  const input =
    value && typeof value === "object" ? (value as Record<string, any>) : {};
  const grants = emptyPermissionMap();
  for (const module of ACCESS_MODULES) {
    const item = input[module];
    if (!item || typeof item !== "object") continue;
    grants[module] = {
      read: Boolean(item.read),
      write: Boolean(item.write),
      scope: item.scope === "all" ? "all" : "own",
    };
  }
  return grants;
}

export async function resolveAuthContext(
  rawStore: Store,
  user: UserIdentity,
  ownership: { ownerOpenId: string; isOwner: boolean },
): Promise<AuthContext | null> {
  const raw = rawStoreOf(rawStore);
  if (ownership.isOwner) {
    return {
      user,
      ownerOpenId: ownership.ownerOpenId,
      isOwner: true,
      employeeId: user.openId,
      displayName: user.name || "Çalışma alanı sahibi",
      permissions: safePermissionMap(
        Object.fromEntries(
          ACCESS_MODULES.map((item) => [
            item,
            { read: true, write: true, scope: "all" },
          ]),
        ),
      ),
    };
  }
  const employees = await raw.list<AccessEmployee>(
    "employee",
    ownership.ownerOpenId,
  );
  // Exact openId is the only admission key. Email/name/JWT claims cannot admit.
  const employeeRecord = employees.find(
    (item) =>
      item.payload.openId === user.openId && item.payload.active === true,
  );
  if (!employeeRecord || !employeeRecord.payload.roleId) return null;
  const storedRole = (
    await raw.get<AccessRole>(
      "role",
      employeeRecord.payload.roleId,
      ownership.ownerOpenId,
    )
  )?.payload;
  const role = storedRole || defaultRole(employeeRecord.payload.roleId);
  if (!role || role.id === "owner") return null;
  return {
    user,
    ownerOpenId: ownership.ownerOpenId,
    isOwner: false,
    employeeId: employeeRecord.payload.id,
    displayName: employeeRecord.payload.name,
    permissions: clonePermissionMap(safePermissionMap(role.grants)),
  };
}

export async function validateDepartmentTree(
  departments: AccessDepartment[],
): Promise<void> {
  const byId = new Map<string, AccessDepartment>();
  for (const department of departments) {
    if (!department.id || !department.name.trim())
      throw new AccessError(
        "Departman adı ve id gerekli.",
        400,
        "INVALID_DEPARTMENT",
      );
    if (byId.has(department.id))
      throw new AccessError(
        "Departman id değeri benzersiz olmalı.",
        400,
        "INVALID_DEPARTMENT",
      );
    byId.set(department.id, department);
  }
  for (const department of departments) {
    if (!department.parentId) continue;
    if (department.parentId === department.id || !byId.has(department.parentId))
      throw new AccessError(
        "Departman ağacında geçersiz üst departman.",
        400,
        "INVALID_DEPARTMENT_TREE",
      );
    const path = new Set<string>([department.id]);
    let current = department.parentId;
    while (current) {
      if (path.has(current))
        throw new AccessError(
          "Departman ağacında döngü oluşturulamaz.",
          400,
          "DEPARTMENT_CYCLE",
        );
      path.add(current);
      current = byId.get(current)?.parentId || "";
    }
  }
}

function requestAuth(req: Request): AuthContext | undefined {
  return (req as Request & { auth?: AuthContext }).auth;
}

function requireRequestAuth(req: Request, res: Response): AuthContext | null {
  const auth = requestAuth(req);
  if (!auth) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Geçerli Manus oturumu gerekli.",
    });
    return null;
  }
  return auth;
}

function requireOwner(req: Request, res: Response): AuthContext | null {
  const auth = requireRequestAuth(req, res);
  if (!auth) return null;
  if (!auth.isOwner) {
    res.status(403).json({
      error: "OWNER_REQUIRED",
      message:
        "Bu erişim değişikliği yalnızca çalışma alanı sahibi tarafından yapılabilir.",
    });
    return null;
  }
  return auth;
}

function bodyString(body: any, key: string, fallback = ""): string {
  return typeof body?.[key] === "string" ? body[key].trim() : fallback;
}

function mapRole(
  record: StoredRecord<AccessRole>,
): AccessRole & { id: string } {
  return {
    ...record.payload,
    id: record.id,
    grants: safePermissionMap(record.payload.grants),
  };
}

async function allRoles(
  raw: Store,
  ownerOpenId: string,
): Promise<AccessRole[]> {
  const stored = await raw.list<AccessRole>("role", ownerOpenId);
  const byId = new Map<string, AccessRole>();
  for (const role of DEFAULT_ROLES)
    byId.set(role.id, { ...role, grants: clonePermissionMap(role.grants) });
  for (const record of stored) byId.set(record.id, mapRole(record));
  return [...byId.values()];
}

function now(): string {
  return new Date().toISOString();
}

export function registerAccessRoutes(app: Express, rawStore: Store): void {
  const raw = rawStoreOf(rawStore);
  app.get("/api/access", async (req, res) => {
    const auth = requireRequestAuth(req, res);
    if (!auth) return;
    if (
      !auth.isOwner &&
      (!canAccess(auth, "users", "read") ||
        permissionFor(auth, "users").scope !== "all")
    ) {
      return res.status(403).json({
        error: "ACCESS_ADMIN_REQUIRED",
        message:
          "Erişim yönetimi verileri yalnızca tam ekip görünürlüğüne sahip yöneticilere açıktır.",
      });
    }
    try {
      const [roles, employees, departments] = await Promise.all([
        allRoles(raw, auth.ownerOpenId),
        raw.list<AccessEmployee>("employee", auth.ownerOpenId),
        raw.list<AccessDepartment>("department", auth.ownerOpenId),
      ]);
      return res.json({
        roles,
        employees: employees.map((item) => ({ ...item.payload, id: item.id })),
        departments: departments.map((item) => ({
          ...item.payload,
          id: item.id,
        })),
      });
    } catch (error) {
      return res.status(500).json({
        error: "SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Erişim verileri okunamadı.",
      });
    }
  });

  const saveRole = async (req: Request, res: Response) => {
    const auth = requireOwner(req, res);
    if (!auth) return;
    const id = req.params.id;
    const current =
      (await raw.get<AccessRole>("role", id, auth.ownerOpenId))?.payload ||
      defaultRole(id);
    if (!current)
      return res
        .status(404)
        .json({ error: "NOT_FOUND", message: "Rol bulunamadı." });
    if (id === "owner" || current.locked)
      return res.status(403).json({
        error: "ROLE_LOCKED",
        message: "Sahip rolü kilitlidir ve değiştirilemez.",
      });
    const name = bodyString(req.body, "name", current.name);
    if (!name)
      return res
        .status(400)
        .json({ error: "INVALID_ROLE", message: "Rol adı gerekli." });
    const payload: AccessRole = {
      ...current,
      id,
      name,
      description: bodyString(req.body, "description", current.description),
      locked: false,
      grants: safePermissionMap(req.body?.grants || current.grants),
      updatedAt: now(),
    };
    const saved = await raw.put("role", id, payload, auth.ownerOpenId);
    return res.json(saved.payload);
  };
  app.put("/api/access/roles/:id", saveRole);
  app.put("/api/access/roles/:id/", saveRole);

  const createEmployee = async (req: Request, res: Response) => {
    const auth = requireOwner(req, res);
    if (!auth) return;
    const openId = bodyString(req.body, "openId");
    if (!openId)
      return res.status(400).json({
        error: "OPEN_ID_REQUIRED",
        message: "Çalışanın Manus kimliği (openId) gerekli.",
      });
    const existing = await raw.list<AccessEmployee>(
      "employee",
      auth.ownerOpenId,
    );
    if (existing.some((item) => item.payload.openId === openId))
      return res.status(409).json({
        error: "EMPLOYEE_EXISTS",
        message: "Bu Manus kimliği zaten kayıtlı.",
      });
    const roleId = bodyString(req.body, "roleId", "observer");
    const role = (await allRoles(raw, auth.ownerOpenId)).find(
      (item) => item.id === roleId,
    );
    if (!role || roleId === "owner")
      return res.status(400).json({
        error: "INVALID_ROLE",
        message: "Geçerli ve sahibi olmayan bir rol seçin.",
      });
    const employee: AccessEmployee = {
      id: bodyString(req.body, "id", `employee_${cryptoRandom()}`),
      name: bodyString(req.body, "name", openId),
      email: bodyString(req.body, "email"),
      openId,
      departmentId: bodyString(req.body, "departmentId"),
      roleId,
      active: req.body?.active === true,
      title: bodyString(req.body, "title"),
      phone: bodyString(req.body, "phone"),
      createdAt: now(),
      updatedAt: now(),
    };
    const saved = await raw.put(
      "employee",
      employee.id,
      employee,
      auth.ownerOpenId,
    );
    return res.status(201).json(saved.payload);
  };
  app.post("/api/access/employees", createEmployee);
  app.post("/api/access/employees/:id", async (req, res) => {
    if (!req.body || Object.keys(req.body).length === 0)
      return createEmployee(req, res);
    return updateEmployee(req, res);
  });

  async function updateEmployee(req: Request, res: Response) {
    const auth = requireOwner(req, res);
    if (!auth) return;
    const id = req.params.id;
    const record = await raw.get<AccessEmployee>(
      "employee",
      id,
      auth.ownerOpenId,
    );
    if (!record)
      return res
        .status(404)
        .json({ error: "NOT_FOUND", message: "Çalışan bulunamadı." });
    const current = record.payload;
    if (current.openId === auth.user.openId || id === auth.employeeId)
      return res.status(403).json({
        error: "OWNER_PROTECTED",
        message:
          "Kendi owner hesabınız devre dışı bırakılamaz veya zayıflatılamaz.",
      });
    if (
      req.body?.openId !== undefined &&
      String(req.body.openId).trim() !== current.openId
    )
      return res.status(400).json({
        error: "OPEN_ID_IMMUTABLE",
        message: "Manus openId değiştirilemez; yeni çalışan kaydı oluşturun.",
      });
    const roleId = bodyString(req.body, "roleId", current.roleId);
    const roles = await allRoles(raw, auth.ownerOpenId);
    if (!roles.some((role) => role.id === roleId) || roleId === "owner")
      return res.status(400).json({
        error: "INVALID_ROLE",
        message: "Geçerli ve sahibi olmayan bir rol seçin.",
      });
    const next: AccessEmployee = {
      ...current,
      name: bodyString(req.body, "name", current.name),
      email: bodyString(req.body, "email", current.email),
      departmentId: bodyString(req.body, "departmentId", current.departmentId),
      roleId,
      active:
        typeof req.body?.active === "boolean"
          ? req.body.active
          : current.active,
      title: bodyString(req.body, "title", current.title),
      phone: bodyString(req.body, "phone", current.phone),
      updatedAt: now(),
    };
    const saved = await raw.put("employee", id, next, auth.ownerOpenId);
    return res.json(saved.payload);
  }
  app.patch("/api/access/employees/:id", updateEmployee);

  const saveDepartment = async (req: Request, res: Response) => {
    const auth = requireOwner(req, res);
    if (!auth) return;
    const id =
      req.params.id ||
      bodyString(req.body, "id", `department_${cryptoRandom()}`);
    const old = (
      await raw.get<AccessDepartment>("department", id, auth.ownerOpenId)
    )?.payload;
    const next: AccessDepartment = {
      ...(old || {}),
      id,
      name: bodyString(req.body, "name", old?.name || ""),
      parentId:
        bodyString(req.body, "parentId", old?.parentId || "") || undefined,
      active:
        typeof req.body?.active === "boolean"
          ? req.body.active
          : old?.active !== false,
      createdAt: old?.createdAt || now(),
      updatedAt: now(),
    };
    const all = (
      await raw.list<AccessDepartment>("department", auth.ownerOpenId)
    )
      .filter((item) => item.id !== id)
      .map((item) => item.payload);
    all.push(next);
    await validateDepartmentTree(all);
    const saved = await raw.put("department", id, next, auth.ownerOpenId);
    return res.status(old ? 200 : 201).json(saved.payload);
  };
  app.post("/api/access/departments", saveDepartment);
  app.post("/api/access/departments/:id", saveDepartment);
  app.patch("/api/access/departments/:id", saveDepartment);

  app.get("/api/profile", async (req, res) => {
    const auth = requireRequestAuth(req, res);
    if (!auth) return;
    try {
      const profileRecord = await raw.get<any>(
        "profile",
        auth.employeeId || auth.user.openId,
        auth.ownerOpenId,
      );
      const employee = auth.employeeId
        ? (
            await raw.get<AccessEmployee>(
              "employee",
              auth.employeeId,
              auth.ownerOpenId,
            )
          )?.payload
        : undefined;
      return res.json({
        profile: {
          id: auth.employeeId || auth.user.openId,
          name:
            employee?.name ||
            profileRecord?.payload?.name ||
            auth.displayName ||
            auth.user.name ||
            "",
          email: employee?.email || auth.user.email || "",
          openId: auth.user.openId,
          phone: employee?.phone || profileRecord?.payload?.phone || "",
          position: employee?.title || profileRecord?.payload?.position || "",
          lastSeen: profileRecord?.payload?.lastSeen || now(),
          verified: true,
          employeeId: auth.employeeId || auth.user.openId,
          roleId: employee?.roleId || (auth.isOwner ? "owner" : ""),
        },
      });
    } catch (error) {
      return res.status(500).json({
        error: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "Profil okunamadı.",
      });
    }
  });

  app.put("/api/profile", async (req, res) => {
    const auth = requireRequestAuth(req, res);
    if (!auth) return;
    const id = auth.employeeId || auth.user.openId;
    const existing =
      (await raw.get<any>("profile", id, auth.ownerOpenId))?.payload || {};
    const employeeRecord = auth.employeeId
      ? await raw.get<AccessEmployee>(
          "employee",
          auth.employeeId,
          auth.ownerOpenId,
        )
      : null;
    const profile = {
      ...existing,
      id,
      name: bodyString(
        req.body,
        "name",
        existing.name || auth.displayName || auth.user.name || "",
      ),
      phone: bodyString(req.body, "phone", existing.phone || ""),
      position: bodyString(
        req.body,
        "position",
        existing.position || employeeRecord?.payload.title || "",
      ),
      lastSeen: now(),
      verified: true,
      verifiedOpenId: auth.user.openId,
      updatedAt: now(),
    };
    await raw.put("profile", id, profile, auth.ownerOpenId);
    if (employeeRecord) {
      await raw.put(
        "employee",
        id,
        {
          ...employeeRecord.payload,
          name: employeeRecord.payload.name,
          phone: profile.phone,
          title: profile.position,
          updatedAt: now(),
        },
        auth.ownerOpenId,
      );
    }
    return res.json({ profile });
  });
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function ownsLead(store: Store, auth: AuthContext, id: string) {
  const raw = rawStoreOf(store);
  const row = await raw.get("lead", id, auth.ownerOpenId);
  return Boolean(
    row && (await isOwnRecord(raw, auth.ownerOpenId, auth, "lead", row)),
  );
}
