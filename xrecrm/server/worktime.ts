import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import mysql from "mysql2/promise";
import { z } from "zod";
import type { AuthContext, StoredEvent, StoredRecord } from "./types.js";
import type { Store } from "./db.js";
import { rawStoreOf } from "./access.js";

type WorktimeStatus = "idle" | "working" | "paused" | "finished";
export type WorktimePeriodType = "work" | "need" | "meal" | "appointment";

export interface WorktimePeriod {
  startAt: string;
  endAt: string | null;
  type: WorktimePeriodType;
}

export interface WorktimeDayState {
  day: string;
  userOpenId: string;
  status: WorktimeStatus;
  version: number;
  periods: WorktimePeriod[];
  startedAt: string | null;
  finishedAt: string | null;
  location?: Record<string, unknown> | null;
  creatorOpenId?: string;
}

interface WorktimePayload extends WorktimeDayState {
  creatorOpenId: string;
}

type WorktimeAuth = AuthContext & { grants?: unknown };

type AuthedRequest = Request & { auth?: WorktimeAuth };

const TURKEY_TZ = "Europe/Istanbul";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TARGET_WORK_MS = 8 * 60 * 60 * 1000;
const transitionSchema = z.object({
  action: z.enum(["start", "pause", "resume", "finish"]),
  pauseType: z.enum(["need", "meal", "appointment"]).optional(),
  operationId: z.string().uuid(),
  expectedVersion: z.number().int().min(0).optional(),
  location: z
    .object({
      lat: z.number().finite().min(-90).max(90),
      lng: z.number().finite().min(-180).max(180),
      accuracy: z.number().finite().min(0).max(1_000_000).optional(),
      capturedAt: z.string().datetime({ offset: true }).optional(),
    })
    .strict()
    .optional(),
  optionalPermissionProvided: z.boolean().optional(),
  // Explicit historical-day finishing is intentionally narrow and is not an identity field.
  day: z.string().regex(DAY_RE).optional(),
});

type TransitionInput = z.infer<typeof transitionSchema>;

class WorktimeError extends Error {
  statusCode: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(
    message: string,
    statusCode = 400,
    code = "INVALID_REQUEST",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorktimeError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function turkeyDay(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TURKEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDay(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + amount, 12));
  return value.toISOString().slice(0, 10);
}

function validDay(value: unknown, fallback = turkeyDay()): string {
  if (value === undefined || value === "") return fallback;
  const day = String(value);
  if (!DAY_RE.test(day))
    throw new WorktimeError("Geçerli bir Türkiye günü gerekli.");
  const parsed = new Date(`${day}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  )
    throw new WorktimeError("Geçerli bir Türkiye günü gerekli.");
  return day;
}

function authOf(req: Request): WorktimeAuth {
  const auth = (req as AuthedRequest).auth;
  if (!auth?.user?.openId || !auth.ownerOpenId)
    throw new WorktimeError(
      "Geçerli Manus oturumu gerekli.",
      401,
      "UNAUTHORIZED",
    );
  return auth;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function initialState(userOpenId: string, day: string): WorktimeDayState {
  return {
    day,
    userOpenId,
    status: "idle",
    version: 0,
    periods: [],
    startedAt: null,
    finishedAt: null,
    location: null,
  };
}

function eventPayload(event: StoredEvent): Record<string, unknown> {
  return event.payload || {};
}

function eventStamp(event: StoredEvent): number {
  const payload = eventPayload(event);
  const candidate = payload.serverAt || event.createdAt;
  const stamp = Date.parse(String(candidate || ""));
  return Number.isFinite(stamp) ? stamp : 0;
}

function eventOrder(a: StoredEvent, b: StoredEvent): number {
  const byTime = eventStamp(a) - eventStamp(b);
  if (byTime) return byTime;
  const av = Number(eventPayload(a).version || 0);
  const bv = Number(eventPayload(b).version || 0);
  if (av !== bv) return av - bv;
  const ai = Number(a.id);
  const bi = Number(b.id);
  if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
  return String(a.id).localeCompare(String(b.id));
}

function dateMs(value: string): number {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : 0;
}

function closeActive(state: WorktimeDayState, at: string): void {
  const active = state.periods[state.periods.length - 1];
  if (active && active.endAt === null) {
    active.endAt = at;
  }
}

function applyTransition(
  source: WorktimeDayState,
  payload: Record<string, unknown>,
): WorktimeDayState {
  const state = clone(source);
  const action = String(payload.action || "");
  const at = String(payload.serverAt || nowIso());
  const pauseType = payload.pauseType as WorktimePeriodType | undefined;
  state.version = Math.max(
    state.version,
    Number(payload.version || state.version + 1),
  );
  state.creatorOpenId = String(
    payload.creatorOpenId || state.creatorOpenId || state.userOpenId,
  );
  const location = payload.location;
  if (location && typeof location === "object")
    state.location = clone(location as Record<string, unknown>);

  if (action === "start") {
    closeActive(state, at);
    state.periods.push({ startAt: at, endAt: null, type: "work" });
    state.status = "working";
    state.startedAt = state.startedAt || at;
    state.finishedAt = null;
  } else if (action === "pause") {
    closeActive(state, at);
    state.periods.push({ startAt: at, endAt: null, type: pauseType || "need" });
    state.status = "paused";
  } else if (action === "resume") {
    closeActive(state, at);
    state.periods.push({ startAt: at, endAt: null, type: "work" });
    state.status = "working";
    state.finishedAt = null;
  } else if (action === "finish") {
    closeActive(state, at);
    state.status = "finished";
    state.finishedAt = at;
  }
  return state;
}

function stateFromEvents(
  events: StoredEvent[],
  userOpenId: string,
  day: string,
  fallback?: WorktimeDayState,
): WorktimeDayState {
  const state =
    fallback && fallback.userOpenId === userOpenId && fallback.day === day
      ? clone(fallback)
      : initialState(userOpenId, day);
  const relevant = events
    .filter((event) => {
      const payload = eventPayload(event);
      return (
        payload.type === "worktime.transition" &&
        String(payload.userOpenId || "") === userOpenId &&
        String(payload.day || "") === day
      );
    })
    .sort(eventOrder);
  // A persisted snapshot is only a fallback for an event store that has not returned history.
  // Replaying events from an empty state is authoritative when history exists.
  const base = relevant.length ? initialState(userOpenId, day) : state;
  return relevant.reduce(
    (current, event) => applyTransition(current, eventPayload(event)),
    base,
  );
}

function durationForPeriod(period: WorktimePeriod, now: number): number {
  const start = dateMs(period.startAt);
  const end = period.endAt ? dateMs(period.endAt) : now;
  return Math.max(0, end - start);
}

export interface WorktimeTotals {
  netMs: number;
  networkMs: number;
  breakMs: number;
  elapsedMs: number;
  liveMs: number;
  byType: Record<WorktimePeriodType, number>;
  firstStartAt: string | null;
  lastEndAt: string | null;
}

function totalsForState(
  state: WorktimeDayState,
  now = Date.now(),
): WorktimeTotals {
  const byType: Record<WorktimePeriodType, number> = {
    work: 0,
    need: 0,
    meal: 0,
    appointment: 0,
  };
  let liveMs = 0;
  let firstStartAt: string | null = null;
  let lastEndAt: string | null = null;
  for (const period of state.periods) {
    const duration = durationForPeriod(period, now);
    byType[period.type] += duration;
    if (!firstStartAt || dateMs(period.startAt) < dateMs(firstStartAt))
      firstStartAt = period.startAt;
    if (
      period.endAt &&
      (!lastEndAt || dateMs(period.endAt) > dateMs(lastEndAt))
    )
      lastEndAt = period.endAt;
    if (!period.endAt) liveMs += duration;
  }
  const breakMs = byType.need + byType.meal;
  const netMs = byType.work + byType.appointment;
  return {
    netMs,
    networkMs: netMs,
    breakMs,
    elapsedMs: netMs + breakMs,
    liveMs,
    byType,
    firstStartAt,
    lastEndAt,
  };
}

export function publicState(state: WorktimeDayState, now = Date.now()) {
  const totals = totalsForState(state, now);
  const active = state.periods.find((period) => period.endAt === null) || null;
  return {
    ...clone(state),
    totals,
    activePeriod: active,
    live: state.status === "working" || state.status === "paused",
    serverNow: new Date(now).toISOString(),
  };
}

function publicSummary(state: WorktimeDayState, now = Date.now()) {
  const totals = totalsForState(state, now);
  return {
    day: state.day,
    status: state.status,
    targetMs: TARGET_WORK_MS,
    netMs: totals.netMs,
    networkMs: totals.networkMs,
    breakMs: totals.breakMs,
    elapsedMs: totals.elapsedMs,
    progressPercent: Math.min(
      100,
      Math.round((totals.netMs / TARGET_WORK_MS) * 100),
    ),
    byType: totals.byType,
    firstStartAt: totals.firstStartAt,
    lastEndAt: totals.lastEndAt,
  };
}

function isWorktimeEvent(event: StoredEvent): boolean {
  const type = eventPayload(event).type;
  return type === "worktime.transition";
}

interface StateCollection {
  events: StoredEvent[];
  records: StoredRecord<WorktimePayload>[];
  states: Map<string, Map<string, WorktimeDayState>>;
}

async function loadStateCollection(
  store: Store,
  ownerOpenId: string,
): Promise<StateCollection> {
  const [events, records] = await Promise.all([
    store.listEvents(ownerOpenId),
    store.list<WorktimePayload>("worktime", ownerOpenId),
  ]);
  const worktimeEvents = events.filter(isWorktimeEvent);
  const states = new Map<string, Map<string, WorktimeDayState>>();
  const put = (state: WorktimeDayState) => {
    if (!state.userOpenId || !DAY_RE.test(state.day)) return;
    let userDays = states.get(state.userOpenId);
    if (!userDays) {
      userDays = new Map();
      states.set(state.userOpenId, userDays);
    }
    userDays.set(state.day, state);
  };
  for (const record of records) {
    const payload = record.payload;
    if (payload && payload.userOpenId && DAY_RE.test(payload.day))
      put(clone(payload));
  }
  const grouped = new Map<string, Map<string, StoredEvent[]>>();
  for (const event of worktimeEvents) {
    const payload = eventPayload(event);
    const user = String(payload.userOpenId || "");
    const day = String(payload.day || "");
    if (!user || !DAY_RE.test(day)) continue;
    let userDays = grouped.get(user);
    if (!userDays) {
      userDays = new Map();
      grouped.set(user, userDays);
    }
    const dayEvents = userDays.get(day) || [];
    dayEvents.push(event);
    userDays.set(day, dayEvents);
  }
  for (const [user, userDays] of grouped) {
    for (const [day, dayEvents] of userDays) {
      put(stateFromEvents(dayEvents, user, day, states.get(user)?.get(day)));
    }
  }
  return { events: worktimeEvents, records, states };
}

function userDays(
  collection: StateCollection,
  userOpenId: string,
): Map<string, WorktimeDayState> {
  return (
    collection.states.get(userOpenId) || new Map<string, WorktimeDayState>()
  );
}

function allOpenDays(days: Map<string, WorktimeDayState>): WorktimeDayState[] {
  return [...days.values()].filter(
    (state) => state.status === "working" || state.status === "paused",
  );
}

function parseRange(query: Request["query"]): { from: string; to: string } {
  const today = turkeyDay();
  const date = query.date || query.day;
  const from = validDay(query.from ?? date, date ? String(date) : today);
  const to = validDay(query.to, from);
  const diff = Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  );
  if (diff < 0) throw new WorktimeError("Rapor aralığı ters olamaz.");
  if (diff > 31)
    throw new WorktimeError("Ekip raporu en fazla 32 günlük olabilir.");
  return { from, to };
}

function profileName(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as Record<string, unknown>;
  return String(value.name || value.displayName || fallback);
}

function hasAllReadGrant(auth: WorktimeAuth): boolean {
  if (auth.isOwner) return true;
  const sources = [
    auth.grants,
    auth.permissions,
    (auth.user as unknown as Record<string, unknown>).grants,
    (auth.user as unknown as Record<string, unknown>).permissions,
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const worktime = (source as Record<string, unknown>).worktime;
    if (
      typeof worktime === "string" &&
      ["all", "all:read", "read:all"].includes(worktime)
    )
      return true;
    if (
      Array.isArray(worktime) &&
      worktime.some((item) =>
        ["all", "read", "all:read"].includes(String(item)),
      )
    )
      return true;
    if (!worktime || typeof worktime !== "object") continue;
    const grant = worktime as Record<string, unknown>;
    const actions = [grant.actions, grant.scopes, grant.permissions].flatMap(
      (value) =>
        Array.isArray(value)
          ? value.map(String)
          : typeof value === "string"
            ? [value]
            : [],
    );
    const scopeAll =
      grant.scope === "all" ||
      grant.scope === "all(read)" ||
      grant.access === "all";
    const readable =
      grant.read === true ||
      actions.includes("read") ||
      actions.includes("all") ||
      grant.access === "read";
    if (scopeAll && readable) return true;
  }
  return false;
}

function errorResponse(res: Response, error: unknown): void {
  const status = Number((error as WorktimeError)?.statusCode) || 500;
  const code = String(
    (error as WorktimeError)?.code ||
      (status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 409
            ? "CONFLICT"
            : "SERVER_ERROR"),
  );
  res.status(status).json({
    error: code,
    message:
      error instanceof Error ? error.message : "Beklenmeyen sunucu hatası.",
    ...((error as WorktimeError)?.details || {}),
  });
}

const lockQueues = new Map<string, Promise<void>>();

async function processLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = lockQueues.get(key) || Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => turn);
  lockQueues.set(key, queued);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (lockQueues.get(key) === queued) lockQueues.delete(key);
  }
}

async function withDurableLock<T>(
  store: Store,
  userOpenId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return processLock(`worktime:${userOpenId}`, async () => {
    // MemoryStore and test doubles must never attempt a network database connection.
    if (store.constructor?.name !== "MysqlStore" || !process.env.DATABASE_URL)
      return fn();
    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    const lockName = `xrecrm-worktime-${crypto.createHash("sha256").update(userOpenId).digest("hex").slice(0, 48)}`;
    let acquired = false;
    try {
      const [rows] = await connection.query<any[]>(
        "SELECT GET_LOCK(?, 15) AS locked",
        [lockName],
      );
      acquired = Number(rows[0]?.locked) === 1;
      if (!acquired)
        throw new WorktimeError(
          "Mesai kaydı kilitlenemedi; tekrar deneyin.",
          503,
          "LOCK_UNAVAILABLE",
        );
      return await fn();
    } finally {
      if (acquired) {
        try {
          await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
        } catch {
          // The connection is closed immediately below; the server releases the lock.
        }
      }
      await connection.end();
    }
  });
}

async function makeOwnResponse(
  store: Store,
  auth: WorktimeAuth,
  requestedDay?: string,
) {
  const todayDay = validDay(requestedDay, turkeyDay());
  const collection = await loadStateCollection(store, auth.ownerOpenId);
  const days = userDays(collection, auth.user.openId);
  const today = days.get(todayDay) || initialState(auth.user.openId, todayDay);
  const history = [...days.values()]
    .filter((state) => state.day !== todayDay)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 31)
    .map((state) => publicState(state));
  const previousOpen = [...days.values()]
    .filter(
      (state) =>
        state.day !== todayDay &&
        (state.status === "working" || state.status === "paused"),
    )
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  return {
    timezone: TURKEY_TZ,
    serverNow: nowIso(),
    today: publicState(today),
    history,
    summary: publicSummary(today),
    previousOpen: previousOpen ? publicState(previousOpen) : null,
  };
}

async function teamResponse(
  store: Store,
  auth: WorktimeAuth,
  query: Request["query"],
) {
  if (!hasAllReadGrant(auth))
    throw new WorktimeError(
      "Ekip mesai raporu yetkisi gerekli.",
      403,
      "FORBIDDEN",
    );
  const { from, to } = parseRange(query);
  const collection = await loadStateCollection(store, auth.ownerOpenId);
  const users = await store.list<any>("user", auth.ownerOpenId);
  const names = new Map(
    users.map((row) => [row.id, profileName(row.payload, row.id)]),
  );
  const rows: Array<Record<string, unknown>> = [];
  for (const [userOpenId, days] of collection.states) {
    for (const state of days.values()) {
      if (state.day < from || state.day > to) continue;
      const output = publicState(state);
      rows.push({
        ...output,
        userOpenId,
        name: names.get(userOpenId) || userOpenId,
        summary: publicSummary(state),
      });
    }
  }
  rows.sort(
    (a, b) =>
      String(a.day).localeCompare(String(b.day)) ||
      String(a.name).localeCompare(String(b.name), "tr"),
  );
  const days = [...new Set(rows.map((row) => String(row.day)))].map((day) => {
    const dayRows = rows.filter((row) => row.day === day);
    const totalNetMs = dayRows.reduce(
      (sum, row) => sum + Number((row.summary as any)?.netMs || 0),
      0,
    );
    const totalBreakMs = dayRows.reduce(
      (sum, row) => sum + Number((row.summary as any)?.breakMs || 0),
      0,
    );
    return {
      day,
      people: dayRows.length,
      netMs: totalNetMs,
      breakMs: totalBreakMs,
      records: dayRows,
    };
  });
  return {
    timezone: TURKEY_TZ,
    from,
    to,
    serverNow: nowIso(),
    records: rows,
    days,
  };
}

async function transition(
  store: Store,
  auth: WorktimeAuth,
  input: TransitionInput,
) {
  const userOpenId = auth.user.openId;
  return withDurableLock(store, userOpenId, async () => {
    const operationEventKey = `worktime:${userOpenId}:operation:${input.operationId}`;
    const existingEvents = await store.listEvents(auth.ownerOpenId);
    const existing = existingEvents.find(
      (event) => event.eventKey === operationEventKey,
    );
    if (existing) {
      const existingPayload = eventPayload(existing);
      const collection = await loadStateCollection(store, auth.ownerOpenId);
      const day = validDay(existingPayload.day, turkeyDay());
      const state =
        userDays(collection, userOpenId).get(day) ||
        initialState(userOpenId, day);
      return {
        ...(await makeOwnResponse(store, auth, turkeyDay())),
        ok: true,
        duplicate: true,
        operationId: input.operationId,
        state: publicState(state),
      };
    }

    const currentDay = turkeyDay();
    let collection = await loadStateCollection(store, auth.ownerOpenId);
    const days = userDays(collection, userOpenId);
    const requestedDay = input.day ? validDay(input.day) : currentDay;
    const requestedState =
      days.get(requestedDay) || initialState(userOpenId, requestedDay);
    if (
      input.day &&
      requestedDay !== currentDay &&
      (input.action !== "finish" ||
        !allOpenDays(days).some((s) => s.day === requestedDay))
    )
      throw new WorktimeError(
        "Geçmiş güne mesai açılamaz; yalnız açık önceki gün bitirilebilir.",
        400,
        "INVALID_SHIFT_DAY",
      );
    const oldOpen = allOpenDays(days)
      .filter((state) => state.day !== requestedDay)
      .sort((a, b) => b.day.localeCompare(a.day))[0];
    let day = requestedDay;
    let state = requestedState;
    if (oldOpen) {
      if (
        input.action === "finish" &&
        !input.day &&
        requestedDay === currentDay
      ) {
        // A midnight-open shift is explicitly finished on its original Turkey day.
        day = oldOpen.day;
        state = oldOpen;
      } else {
        throw new WorktimeError(
          "Önce önceki günün açık mesaisini bitirin.",
          409,
          "PREVIOUS_DAY_OPEN",
          { previousDay: oldOpen.day },
        );
      }
    }
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== state.version
    )
      throw new WorktimeError(
        "Mesai başka bir sekmede değişti; ekranı yenileyin.",
        409,
        "VERSION_CONFLICT",
        {
          expectedVersion: input.expectedVersion,
          actualVersion: state.version,
        },
      );
    if (input.action === "pause" && state.status !== "working")
      throw new WorktimeError(
        "Yalnızca çalışan mesai mola durumuna alınabilir.",
        409,
        "INVALID_TRANSITION",
      );
    if (input.action === "resume" && state.status !== "paused")
      throw new WorktimeError(
        "Aktif bir mola bulunamadı.",
        409,
        "INVALID_TRANSITION",
      );
    if (
      input.action === "finish" &&
      !["working", "paused"].includes(state.status)
    )
      throw new WorktimeError(
        "Bitirilecek açık mesai bulunamadı.",
        409,
        "INVALID_TRANSITION",
      );
    if (
      input.action === "start" &&
      ["working", "paused"].includes(state.status)
    )
      throw new WorktimeError("Mesai zaten açık.", 409, "INVALID_TRANSITION");
    if (input.action === "pause" && !input.pauseType)
      throw new WorktimeError("Mola türü gerekli.", 400, "INVALID_REQUEST");

    const serverAt = nowIso();
    const version = state.version + 1;
    const payload: WorktimePayload & Record<string, unknown> = {
      ...clone(state),
      type: "worktime.transition",
      action: input.action,
      pauseType: input.pauseType,
      operationId: input.operationId,
      day,
      version,
      serverAt,
      userOpenId,
      creatorOpenId: userOpenId,
      location: input.location || null,
    };
    const claimed = await store.appendEvent(
      auth.ownerOpenId,
      operationEventKey,
      payload,
      "completed",
    );
    if (!claimed.inserted) {
      collection = await loadStateCollection(store, auth.ownerOpenId);
      const duplicateState = userDays(collection, userOpenId).get(day) || state;
      return {
        ...(await makeOwnResponse(store, auth, currentDay)),
        ok: true,
        duplicate: true,
        operationId: input.operationId,
        state: publicState(duplicateState),
      };
    }
    const nextState = applyTransition(state, payload);
    await store.put<WorktimePayload>(
      "worktime",
      `${userOpenId}:${day}`,
      { ...nextState, userOpenId, day, creatorOpenId: userOpenId },
      auth.ownerOpenId,
    );
    const response = await makeOwnResponse(store, auth, currentDay);
    return {
      ...response,
      ok: true,
      duplicate: false,
      operationId: input.operationId,
      state: publicState(nextState),
      serverAt,
    };
  });
}

export function registerWorktimeRoutes(app: Express, store: Store): void {
  let persistence = rawStoreOf(store);
  while ((persistence as any).__rawStore)
    persistence = (persistence as any).__rawStore;
  app.get("/api/worktime", async (req, res) => {
    try {
      const auth = authOf(req);
      res.json(
        await makeOwnResponse(
          persistence,
          auth,
          typeof req.query.day === "string"
            ? req.query.day
            : typeof req.query.today === "string"
              ? req.query.today
              : undefined,
        ),
      );
    } catch (error) {
      errorResponse(res, error);
    }
  });

  app.post(
    "/api/worktime/transition",
    express.json({ limit: "32kb" }),
    async (req, res) => {
      try {
        const auth = authOf(req);
        const input = transitionSchema.parse(req.body);
        res.json(await transition(persistence, auth, input));
      } catch (error) {
        errorResponse(
          res,
          error instanceof z.ZodError
            ? new WorktimeError(
                "Geçersiz mesai geçişi.",
                400,
                "INVALID_REQUEST",
                { issues: error.issues },
              )
            : error,
        );
      }
    },
  );

  app.get("/api/worktime/team", async (req, res) => {
    try {
      const auth = authOf(req);
      res.json(await teamResponse(persistence, auth, req.query));
    } catch (error) {
      errorResponse(res, error);
    }
  });
}

export async function getWorktimeState(
  store: Store,
  auth: AuthContext,
  day?: string,
) {
  return makeOwnResponse(rawStoreOf(store), auth as WorktimeAuth, day);
}
