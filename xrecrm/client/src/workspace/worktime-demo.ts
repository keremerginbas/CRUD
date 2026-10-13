import {
  WORKTIME_TARGET_MS,
  WORKTIME_TIMEZONE,
  type WorktimeAction,
  type WorktimeDayState,
  type WorktimeOwnResponse,
  type WorktimePauseType,
  type WorktimePeriod,
  type WorktimePeriodType,
  type WorktimeSummary,
  type WorktimeTotals,
  type WorktimeTransitionRequest,
} from "../../../shared/worktime";

export const WORKTIME_DEMO_STORAGE_KEY = "xre-worktime-demo-v1";
export const WORKTIME_DEMO_USER_OPEN_ID = "demo-user";

type DemoStore = {
  days: WorktimeDayState[];
  operations: Record<string, { day: string; state: WorktimeDayState }>;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function turkeyDay(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WORKTIME_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function initialState(day: string): WorktimeDayState {
  return {
    day,
    userOpenId: WORKTIME_DEMO_USER_OPEN_ID,
    status: "idle",
    version: 0,
    periods: [],
    startedAt: null,
    finishedAt: null,
    location: null,
  };
}

function readStore(): DemoStore {
  if (typeof window === "undefined") return { days: [], operations: {} };
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(WORKTIME_DEMO_STORAGE_KEY) || "null",
    ) as Partial<DemoStore> | null;
    const days = Array.isArray(raw?.days)
      ? raw.days.filter((state): state is WorktimeDayState =>
          Boolean(
            state &&
              typeof state.day === "string" &&
              Array.isArray(state.periods),
          ),
        )
      : [];
    const operations =
      raw?.operations && typeof raw.operations === "object"
        ? raw.operations
        : {};
    return { days: clone(days), operations: clone(operations) };
  } catch {
    return { days: [], operations: {} };
  }
}

function writeStore(store: DemoStore): void {
  if (typeof window !== "undefined")
    window.localStorage.setItem(
      WORKTIME_DEMO_STORAGE_KEY,
      JSON.stringify(store),
    );
}

function dateMs(value: string): number {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : 0;
}

function shiftDay(day: string, amount: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount, 12))
    .toISOString()
    .slice(0, 10);
}

function durationForPeriod(period: WorktimePeriod, now: number): number {
  return Math.max(
    0,
    (period.endAt ? dateMs(period.endAt) : now) - dateMs(period.startAt),
  );
}

export function totalsForDemoState(
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
    const ms = durationForPeriod(period, now);
    byType[period.type] += ms;
    if (!firstStartAt || dateMs(period.startAt) < dateMs(firstStartAt))
      firstStartAt = period.startAt;
    if (
      period.endAt &&
      (!lastEndAt || dateMs(period.endAt) > dateMs(lastEndAt))
    )
      lastEndAt = period.endAt;
    if (!period.endAt) liveMs += ms;
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

function publicState(source: WorktimeDayState, now: number): WorktimeDayState {
  const state = clone(source);
  const activePeriod =
    state.periods.find((period) => period.endAt === null) || null;
  return {
    ...state,
    activePeriod,
    totals: totalsForDemoState(state, now),
    live: state.status === "working" || state.status === "paused",
    serverNow: new Date(now).toISOString(),
  };
}

function summaryFor(state: WorktimeDayState, now: number): WorktimeSummary {
  const totals = totalsForDemoState(state, now);
  return {
    day: state.day,
    status: state.status,
    targetMs: WORKTIME_TARGET_MS,
    progressPercent: Math.min(
      100,
      Math.round((totals.netMs / WORKTIME_TARGET_MS) * 100),
    ),
    ...totals,
  };
}

function makeResponse(
  store: DemoStore,
  day: string,
  now: number,
): WorktimeOwnResponse {
  const today =
    store.days.find((state) => state.day === day) || initialState(day);
  const history = store.days
    .filter((state) => state.day !== day)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 31)
    .map((state) => publicState(state, now));
  const previousOpen = store.days
    .filter(
      (state) =>
        state.day !== day &&
        (state.status === "working" || state.status === "paused"),
    )
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  return {
    timezone: WORKTIME_TIMEZONE,
    serverNow: new Date(now).toISOString(),
    today: publicState(today, now),
    history,
    summary: summaryFor(today, now),
    previousOpen: previousOpen ? publicState(previousOpen, now) : null,
  };
}

function closeActive(state: WorktimeDayState, at: string): void {
  const active = state.periods[state.periods.length - 1];
  if (active && active.endAt === null) active.endAt = at;
}

function applyTransition(
  state: WorktimeDayState,
  input: WorktimeTransitionRequest,
  at: string,
): WorktimeDayState {
  const next = clone(state);
  next.version += 1;
  next.creatorOpenId = WORKTIME_DEMO_USER_OPEN_ID;
  if (input.location) next.location = clone(input.location);
  if (input.action === "start") {
    closeActive(next, at);
    next.periods.push({ startAt: at, endAt: null, type: "work" });
    next.status = "working";
    next.startedAt = next.startedAt || at;
    next.finishedAt = null;
  } else if (input.action === "pause") {
    closeActive(next, at);
    next.periods.push({
      startAt: at,
      endAt: null,
      type: input.pauseType || "need",
    });
    next.status = "paused";
  } else if (input.action === "resume") {
    closeActive(next, at);
    next.periods.push({ startAt: at, endAt: null, type: "work" });
    next.status = "working";
    next.finishedAt = null;
  } else {
    closeActive(next, at);
    next.status = "finished";
    next.finishedAt = at;
  }
  return next;
}

function transitionError(message: string): Error {
  return new Error(message);
}

export function readDemoWorktime(now = Date.now()): WorktimeOwnResponse {
  return makeResponse(readStore(), turkeyDay(new Date(now)), now);
}

export function transitionDemoWorktime(
  input: WorktimeTransitionRequest,
  now = Date.now(),
): WorktimeOwnResponse & {
  ok: true;
  duplicate: boolean;
  operationId: string;
  state: WorktimeDayState;
} {
  const store = readStore();
  const currentDay = turkeyDay(new Date(now));
  const day = input.day || currentDay;
  const existingOperation = store.operations[input.operationId];
  if (existingOperation) {
    return {
      ...makeResponse(store, currentDay, now),
      ok: true,
      duplicate: true,
      operationId: input.operationId,
      state: publicState(existingOperation.state, now),
    };
  }

  let state = store.days.find((item) => item.day === day) || initialState(day);
  const previousOpen = store.days
    .filter(
      (item) =>
        item.day !== day &&
        (item.status === "working" || item.status === "paused"),
    )
    .sort((a, b) => b.day.localeCompare(a.day))[0];
  if (previousOpen)
    throw transitionError("Önce önceki günün açık mesaisini bitirin.");
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== state.version
  )
    throw transitionError("Mesai başka bir sekmede değişti; ekranı yenileyin.");
  if (input.action === "pause" && state.status !== "working")
    throw transitionError("Yalnızca çalışan mesai mola durumuna alınabilir.");
  if (input.action === "resume" && state.status !== "paused")
    throw transitionError("Aktif bir mola bulunamadı.");
  if (
    input.action === "finish" &&
    !["working", "paused"].includes(state.status)
  )
    throw transitionError("Bitirilecek açık mesai bulunamadı.");
  if (input.action === "start" && ["working", "paused"].includes(state.status))
    throw transitionError("Mesai zaten açık.");
  if (input.action === "pause" && !input.pauseType)
    throw transitionError("Mola türü gerekli.");

  state = applyTransition(state, input, new Date(now).toISOString());
  store.days = [...store.days.filter((item) => item.day !== day), state];
  store.operations[input.operationId] = { day, state: clone(state) };
  writeStore(store);
  return {
    ...makeResponse(store, currentDay, now),
    ok: true,
    duplicate: false,
    operationId: input.operationId,
    state: publicState(state, now),
  };
}

export function seedDemoWorktimeState(states: WorktimeDayState[]): void {
  const store = readStore();
  writeStore({ ...store, days: clone(states), operations: {} });
}

export function demoOpenPreviousDay(now = Date.now()): string {
  const day = shiftDay(turkeyDay(new Date(now)), -1);
  seedDemoWorktimeState([
    {
      ...initialState(day),
      status: "working",
      periods: [
        {
          startAt: new Date(now - 3_600_000).toISOString(),
          endAt: null,
          type: "work",
        },
      ],
      startedAt: new Date(now - 3_600_000).toISOString(),
    },
  ]);
  return day;
}
