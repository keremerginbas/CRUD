export const WORKTIME_TIMEZONE = "Europe/Istanbul" as const;
export const WORKTIME_TARGET_MS = 8 * 60 * 60 * 1000;

export type WorktimeAction = "start" | "pause" | "resume" | "finish";
export type WorktimePauseType = "need" | "meal" | "appointment";
export type WorktimePeriodType = "work" | WorktimePauseType;
export type WorktimeStatus = "idle" | "working" | "paused" | "finished";

export interface WorktimePeriod {
  startAt: string;
  endAt: string | null;
  type: WorktimePeriodType;
}

export interface WorktimeLocation {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt?: string;
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

export interface WorktimeDayState {
  day: string;
  userOpenId: string;
  status: WorktimeStatus;
  version: number;
  periods: WorktimePeriod[];
  startedAt: string | null;
  finishedAt: string | null;
  location?: WorktimeLocation | Record<string, unknown> | null;
  creatorOpenId?: string;
  activePeriod?: WorktimePeriod | null;
  live?: boolean;
  serverNow?: string;
  totals?: WorktimeTotals;
}

export interface WorktimeSummary extends WorktimeTotals {
  day: string;
  status: WorktimeStatus;
  targetMs: number;
  progressPercent: number;
}

export interface WorktimeOwnResponse {
  timezone: typeof WORKTIME_TIMEZONE;
  serverNow: string;
  today: WorktimeDayState;
  history: WorktimeDayState[];
  summary: WorktimeSummary;
  previousOpen: WorktimeDayState | null;
}

export interface WorktimeTransitionRequest {
  action: WorktimeAction;
  pauseType?: WorktimePauseType;
  operationId: string;
  expectedVersion?: number;
  location?: WorktimeLocation;
  optionalPermissionProvided?: boolean;
  day?: string;
}

export interface WorktimeTeamRecord extends WorktimeDayState {
  name: string;
  summary: WorktimeSummary;
}

export interface WorktimeTeamResponse {
  timezone: typeof WORKTIME_TIMEZONE;
  from: string;
  to: string;
  serverNow: string;
  records: WorktimeTeamRecord[];
  days: Array<{
    day: string;
    people: number;
    netMs: number;
    breakMs: number;
    records: WorktimeTeamRecord[];
  }>;
}
