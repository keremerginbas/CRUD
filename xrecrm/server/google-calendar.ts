import crypto from "node:crypto";
import type { Express, Request, Response as ExpressResponse } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import {
  canAccess,
  currentPermissionContext,
  permissionFor,
  rawStoreOf,
} from "./access.js";
import type { AuthContext } from "./types.js";
import { ActivitySchema, type Activity } from "./suite.js";
import {
  MeetingInputSchema,
  type MeetingInput,
  assertMeetingInFuture,
  meetingEndIso,
  meetingStartIso,
  manualMeetingUrlPattern,
} from "../shared/meetings.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const STATE_COOKIE = "xre_google_calendar_state";
const STATE_TTL_SECONDS = 10 * 60;
const GOOGLE_HOSTS = new Set(["oauth2.googleapis.com", "www.googleapis.com"]);
const ACCOUNT_KIND = "google_calendar_account";
const STATE_KIND = "google_calendar_oauth_state";
const INTENT_KIND = "google_calendar_meeting_intent";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const meetingLocks = new Map<string, Promise<void>>();

type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: Buffer;
};

type EncryptedSecret = {
  iv: string;
  tag: string;
  data: string;
};

type GoogleAccount = {
  provider: "google";
  userHash: string;
  ownerOpenId: string;
  scope: string;
  refreshToken: EncryptedSecret;
  accessToken: EncryptedSecret;
  accessTokenExpiresAt: number;
  connectedAt: string;
  updatedAt: string;
};

type MeetingIntentStatus = "pending" | "unknown" | "ready" | "failed";
type MeetingIntent = {
  requestId: string;
  inputFingerprint: string;
  input: MeetingInput;
  ownerOpenId: string;
  userOpenId: string;
  userHash: string;
  provider: MeetingInput["provider"];
  eventId?: string;
  googleEventId?: string;
  status: MeetingIntentStatus;
  conferenceStatus: "ready" | "pending" | "failed";
  meetingUrl?: string;
  activityId: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

type GoogleEvent = {
  id?: unknown;
  hangoutLink?: unknown;
  conferenceData?: {
    createRequest?: { status?: unknown };
    entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }>;
  };
};

type AuthedRequest = Request & { auth?: AuthContext };

function now(): string {
  return new Date().toISOString();
}

function statusError(
  statusCode: number,
  message: string,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function requestAuth(req: Request, res: ExpressResponse): AuthContext | null {
  const auth = (req as AuthedRequest).auth;
  if (!auth) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Geçerli Manus oturumu gerekli.",
    });
    return null;
  }
  return auth;
}

function sendError(res: ExpressResponse, error: unknown): void {
  const status =
    error instanceof z.ZodError
      ? 400
      : Number((error as { statusCode?: number })?.statusCode) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error:
      status === 400
        ? "INVALID_REQUEST"
        : status === 401
          ? "UNAUTHORIZED"
          : status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "NOT_FOUND"
              : status === 409
                ? "CONFLICT"
                : status === 503
                  ? "GOOGLE_CALENDAR_NOT_CONFIGURED"
                  : "SERVER_ERROR",
    message:
      error instanceof z.ZodError
        ? "Toplantı isteği geçersiz."
        : error instanceof Error
          ? error.message
          : "Beklenmeyen sunucu hatası.",
  });
}

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=None; Secure`;
}

function clearStateCookie(): string {
  return cookieHeader(STATE_COOKIE, "", 0);
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function userHash(openId: string): string {
  return hashText(openId);
}

function accountId(openId: string): string {
  return userHash(openId);
}

function intentId(openId: string, requestId: string): string {
  return hashText(`meeting-intent:${openId}:${requestId}`);
}

/** Google event IDs accept the base32hex alphabet. SHA-256 hex is a subset;
 * prefixing `a` when needed guarantees the required leading letter. */
function googleEventId(
  ownerOpenId: string,
  userOpenId: string,
  requestId: string,
): string {
  const digest = hashText(
    `google-event:${ownerOpenId}:${userOpenId}:${requestId}`,
  );
  return /^[a-v]/.test(digest[0]) ? digest : `a${digest}`;
}

function configuredGoogle(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() || "";
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || "";
  const encodedKey = process.env.GOOGLE_CALENDAR_TOKEN_KEY?.trim() || "";
  if (!clientId || !clientSecret || !redirectUri || !encodedKey) return null;
  let parsedRedirect: URL;
  let tokenKey: Buffer;
  try {
    parsedRedirect = new URL(redirectUri);
    tokenKey = Buffer.from(encodedKey, "base64");
  } catch {
    return null;
  }
  if (
    parsedRedirect.protocol !== "https:" ||
    parsedRedirect.username ||
    parsedRedirect.password ||
    parsedRedirect.search ||
    parsedRedirect.hash ||
    parsedRedirect.pathname !== "/api/google-calendar/callback" ||
    tokenKey.length !== 32
  )
    return null;
  return { clientId, clientSecret, redirectUri, tokenKey };
}

function configuredTrustedOrigin(req: Request, config: GoogleConfig): boolean {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const redirect = new URL(config.redirectUri);
    return parsed.origin === redirect.origin;
  } catch {
    return false;
  }
}

function encryptSecret(value: string, key: Buffer): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

function decryptSecret(value: unknown, key: Buffer): string {
  if (!value || typeof value !== "object")
    throw new Error("invalid encrypted token");
  const item = value as Partial<EncryptedSecret>;
  const iv = Buffer.from(String(item.iv || ""), "base64url");
  const tag = Buffer.from(String(item.tag || ""), "base64url");
  const data = Buffer.from(String(item.data || ""), "base64url");
  if (iv.length !== 12 || tag.length !== 16 || data.length === 0)
    throw new Error("invalid encrypted token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

class GoogleTimeoutError extends Error {
  statusCode = 504;
  constructor() {
    super("Google Calendar isteği zaman aşımına uğradı.");
    this.name = "GoogleTimeoutError";
  }
}

class GoogleTransportError extends Error {
  statusCode = 502;
  constructor() {
    super("Google Calendar'a erişilemedi.");
    this.name = "GoogleTransportError";
  }
}

function assertGoogleUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw statusError(502, "Google Calendar hedefi geçersiz.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !GOOGLE_HOSTS.has(url.hostname.toLowerCase())
  )
    throw statusError(502, "Google Calendar hedefi güvenilir değil.");
}

async function googleJson(
  rawUrl: string,
  init: RequestInit,
): Promise<{ status: number; ok: boolean; body: Record<string, any> }> {
  assertGoogleUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(rawUrl, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    let body: Record<string, any> = {};
    try {
      const text = await response.text();
      if (text) {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          body = parsed as Record<string, any>;
      }
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError")
        throw new GoogleTimeoutError();
      if (error instanceof SyntaxError) body = {};
      else throw new GoogleTransportError();
    }
    return { status: response.status, ok: response.ok, body };
  } catch (error) {
    if (
      error instanceof GoogleTimeoutError ||
      error instanceof GoogleTransportError
    )
      throw error;
    if ((error as { name?: string })?.name === "AbortError")
      throw new GoogleTimeoutError();
    throw new GoogleTransportError();
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };
}

function readAccount(
  rawStore: Store,
  auth: AuthContext,
): Promise<GoogleAccount | null> {
  return rawStore
    .get<GoogleAccount>(
      ACCOUNT_KIND,
      accountId(auth.user.openId),
      auth.ownerOpenId,
    )
    .then((record) => {
      const payload = record?.payload;
      if (!payload || payload.userHash !== userHash(auth.user.openId))
        return null;
      if (
        payload.provider !== "google" ||
        !payload.refreshToken ||
        !payload.accessToken
      )
        return null;
      return payload;
    });
}

async function exchangeAuthorizationCode(
  config: GoogleConfig,
  code: string,
): Promise<Record<string, any>> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const result = await googleJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok || typeof result.body.access_token !== "string")
    throw statusError(502, "Google OAuth yetkilendirmesi tamamlanamadı.");
  return result.body;
}

async function accessTokenFor(
  config: GoogleConfig,
  rawStore: Store,
  auth: AuthContext,
  beforeExternal: () => Promise<void>,
): Promise<string> {
  const account = await readAccount(rawStore, auth);
  if (!account) throw statusError(409, "Google Calendar hesabı bağlanmamış.");
  let accessToken: string;
  try {
    accessToken = decryptSecret(account.accessToken, config.tokenKey);
  } catch {
    throw statusError(503, "Google Calendar hesabı yeniden bağlanmalı.");
  }
  if (account.accessTokenExpiresAt > Date.now() + 60_000) return accessToken;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(account.refreshToken, config.tokenKey);
  } catch {
    throw statusError(503, "Google Calendar hesabı yeniden bağlanmalı.");
  }
  await beforeExternal();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const result = await googleJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok || typeof result.body.access_token !== "string")
    throw statusError(502, "Google Calendar erişim anahtarı yenilenemedi.");
  accessToken = result.body.access_token;
  const expiresIn = Number(result.body.expires_in);
  const updated: GoogleAccount = {
    ...account,
    accessToken: encryptSecret(accessToken, config.tokenKey),
    accessTokenExpiresAt:
      Date.now() +
      (Number.isFinite(expiresIn) ? Math.max(60, expiresIn) : 3600) * 1000,
    updatedAt: now(),
  };
  await rawStore.put(
    ACCOUNT_KIND,
    accountId(auth.user.openId),
    updated,
    auth.ownerOpenId,
  );
  return accessToken;
}

function safeFingerprint(input: MeetingInput): string {
  return hashText(JSON.stringify(input));
}

function intentActivityId(requestId: string, userOpenId: string): string {
  return `activity-meeting-${hashText(`activity:${userOpenId}:${requestId}`)}`;
}

function intentRecordId(input: MeetingInput, auth: AuthContext): string {
  return intentId(auth.user.openId, input.requestId);
}

function conferenceStatusOf(
  event: GoogleEvent,
): "ready" | "pending" | "failed" {
  if (meetingUrlOf(event)) return "ready";
  const rawStatus = event.conferenceData?.createRequest?.status;
  const status = String(
    rawStatus && typeof rawStatus === "object"
      ? (rawStatus as { statusCode?: unknown; status?: unknown }).statusCode ||
          (rawStatus as { status?: unknown }).status ||
          ""
      : rawStatus || "",
  ).toLowerCase();
  if (["failure", "failed"].includes(status)) return "failed";
  return "pending";
}

function meetingUrlOf(event: GoogleEvent): string | undefined {
  if (
    typeof event.hangoutLink === "string" &&
    manualMeetingUrlPattern.test(event.hangoutLink)
  )
    return event.hangoutLink;
  const item = event.conferenceData?.entryPoints?.find(
    (entry) =>
      entry.entryPointType === "video" && typeof entry.uri === "string",
  );
  return typeof item?.uri === "string" && manualMeetingUrlPattern.test(item.uri)
    ? item.uri
    : undefined;
}

function activityFor(
  intent: MeetingIntent,
  extra: {
    conferenceStatus: "ready" | "pending" | "failed";
    meetingUrl?: string;
    googleEventId?: string;
  },
): Activity {
  const startAt = meetingStartIso(intent.input.date, intent.input.time);
  const endAt = meetingEndIso(
    intent.input.date,
    intent.input.time,
    intent.input.durationMinutes,
  );
  return ActivitySchema.parse({
    id: intent.activityId,
    leadId: intent.input.leadId,
    type: "meeting",
    title: intent.input.title,
    description: intent.input.description,
    startAt,
    endAt,
    assignee: intent.input.assignee,
    completed: false,
    ...(extra.meetingUrl ? { meetingUrl: extra.meetingUrl } : {}),
    provider: intent.provider,
    meetingProvider: intent.provider,
    ...(extra.googleEventId ? { googleEventId: extra.googleEventId } : {}),
    conferenceStatus: extra.conferenceStatus,
    ...(intent.input.attendees.length
      ? { attendees: intent.input.attendees }
      : {}),
    createdAt: intent.createdAt,
    updatedAt: now(),
  });
}

async function saveActivity(
  store: Store,
  ownerOpenId: string,
  intent: MeetingIntent,
  extra: {
    conferenceStatus: "ready" | "pending" | "failed";
    meetingUrl?: string;
    googleEventId?: string;
  },
): Promise<Activity> {
  const activity = activityFor(intent, extra);
  const saved = await store.put(
    "activities",
    intent.activityId,
    activity,
    ownerOpenId,
  );
  return ActivitySchema.parse(saved.payload);
}

function authIdentityValues(auth: AuthContext): Set<string> {
  return new Set(
    [auth.employeeId, auth.user.openId, auth.displayName, auth.user.name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function leadBelongsToAuth(payload: unknown, auth: AuthContext): boolean {
  if (auth.isOwner || !payload || typeof payload !== "object")
    return auth.isOwner;
  const values = authIdentityValues(auth);
  const item = payload as Record<string, unknown>;
  return [
    "ownerOpenId",
    "assignedOpenId",
    "assigneeOpenId",
    "createdByOpenId",
    "employeeId",
    "assignee",
    "assignedTo",
    "owner",
    "createdBy",
  ].some(
    (key) => typeof item[key] === "string" && values.has(item[key] as string),
  );
}

async function assertMeetingScope(
  store: Store,
  ownerOpenId: string,
  input: MeetingInput,
  fallbackAuth?: AuthContext,
): Promise<void> {
  const context = currentPermissionContext();
  const auth = context?.auth || fallbackAuth;
  if (auth) {
    if (ownerOpenId !== auth.ownerOpenId)
      throw statusError(
        403,
        "Başka bir çalışma alanının kayıtlarına erişilemez.",
      );
    if (!canAccess(auth, "calendar", "read"))
      throw statusError(403, "calendar modülünde okuma yetkiniz yok.");
    if (!canAccess(auth, "crm", "read"))
      throw statusError(403, "Lead erişim yetkiniz yok.");
  }
  const lead = await store.get<Record<string, unknown>>(
    "lead",
    input.leadId,
    ownerOpenId,
  );
  if (!lead)
    throw statusError(404, "Lead bulunamadı veya erişim kapsamı dışında.");
  if (
    auth &&
    !auth.isOwner &&
    !context &&
    permissionFor(auth, "crm").scope === "own" &&
    !leadBelongsToAuth(lead.payload, auth)
  )
    throw statusError(403, "Lead erişim kapsamı dışında.");
}

/**
 * Validate the same calendar write scope used by the activity permission store.
 * This function is deliberately read-only: it must never create or delete a
 * record while deciding whether a provider call is allowed.
 */
async function preflightActivityWrite(
  store: Store,
  ownerOpenId: string,
  intent: MeetingIntent,
  fallbackAuth?: AuthContext,
): Promise<void> {
  const context = currentPermissionContext();
  const auth = context?.auth || fallbackAuth;
  if (auth) {
    if (ownerOpenId !== auth.ownerOpenId)
      throw statusError(
        403,
        "Başka bir çalışma alanının kayıtlarına erişilemez.",
      );
    if (!canAccess(auth, "calendar", "write"))
      throw statusError(403, "calendar modülünde yazma yetkiniz yok.");
    if (!canAccess(auth, "crm", "read"))
      throw statusError(403, "Lead erişim yetkiniz yok.");
    if (
      !auth.isOwner &&
      permissionFor(auth, "calendar").scope === "own" &&
      intent.input.assignee &&
      !authIdentityValues(auth).has(intent.input.assignee.trim())
    )
      throw statusError(403, "Toplantı sorumlusu kendi kapsamınızın dışında.");
  }
  const lead = await store.get<Record<string, unknown>>(
    "lead",
    intent.input.leadId,
    ownerOpenId,
  );
  if (!lead)
    throw statusError(404, "Lead bulunamadı veya erişim kapsamı dışında.");
  if (
    auth &&
    !auth.isOwner &&
    !context &&
    permissionFor(auth, "crm").scope === "own" &&
    !leadBelongsToAuth(lead.payload, auth)
  )
    throw statusError(403, "Lead erişim kapsamı dışında.");
}

function responseBody(
  activity: Activity | null,
  conferenceStatus: "ready" | "pending" | "failed",
  message?: string,
): Record<string, unknown> {
  return {
    activity,
    conferenceStatus,
    ...(activity?.meetingUrl ? { meetingUrl: activity.meetingUrl } : {}),
    ...(message ? { message } : {}),
  };
}

async function loadIntent(
  rawStore: Store,
  auth: AuthContext,
  requestId: string,
): Promise<MeetingIntent | null> {
  const record = await rawStore.get<MeetingIntent>(
    INTENT_KIND,
    intentId(auth.user.openId, requestId),
    auth.ownerOpenId,
  );
  const value = record?.payload;
  if (
    !value ||
    value.userOpenId !== auth.user.openId ||
    value.ownerOpenId !== auth.ownerOpenId ||
    value.requestId !== requestId
  )
    return null;
  return value;
}

async function saveIntent(
  rawStore: Store,
  auth: AuthContext,
  id: string,
  intent: MeetingIntent,
): Promise<void> {
  await rawStore.put(INTENT_KIND, id, intent, auth.ownerOpenId);
}

function eventBody(
  input: MeetingInput,
  eventId: string,
  startAt: string,
  endAt: string,
): Record<string, unknown> {
  return {
    id: eventId,
    summary: input.title,
    description: input.description,
    start: { dateTime: startAt, timeZone: "Europe/Istanbul" },
    end: { dateTime: endAt, timeZone: "Europe/Istanbul" },
    ...(input.attendees.length
      ? { attendees: input.attendees.map((email) => ({ email })) }
      : {}),
    conferenceData: {
      createRequest: {
        requestId: eventId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };
}

async function fetchGoogleEvent(
  config: GoogleConfig,
  rawStore: Store,
  store: Store,
  auth: AuthContext,
  intent: MeetingIntent,
): Promise<{ status: number; body: GoogleEvent }> {
  await assertMeetingScope(store, auth.ownerOpenId, intent.input, auth);
  const accessToken = await accessTokenFor(config, rawStore, auth, async () => {
    await assertMeetingScope(store, auth.ownerOpenId, intent.input, auth);
  });
  await assertMeetingScope(store, auth.ownerOpenId, intent.input, auth);
  const eventId = intent.googleEventId || intent.eventId;
  if (!eventId || !/^[a-z0-9_-]{5,1024}$/.test(eventId))
    throw statusError(500, "Toplantı sağlayıcı kimliği bulunamadı.");
  const result = await googleJson(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "GET", headers: authHeaders(accessToken) },
  );
  return { status: result.status, body: result.body as GoogleEvent };
}

async function createGoogleMeeting(
  config: GoogleConfig,
  rawStore: Store,
  store: Store,
  auth: AuthContext,
  intent: MeetingIntent,
): Promise<{
  status: "ready" | "pending" | "failed";
  eventId?: string;
  meetingUrl?: string;
  message?: string;
}> {
  const eventId = intent.eventId!;
  await preflightActivityWrite(store, auth.ownerOpenId, intent, auth);
  const accessToken = await accessTokenFor(config, rawStore, auth, async () => {
    await preflightActivityWrite(store, auth.ownerOpenId, intent, auth);
  });
  await preflightActivityWrite(store, auth.ownerOpenId, intent, auth);
  const startAt = meetingStartIso(intent.input.date, intent.input.time);
  const endAt = meetingEndIso(
    intent.input.date,
    intent.input.time,
    intent.input.durationMinutes,
  );
  const query = new URLSearchParams({
    conferenceDataVersion: "1",
    sendUpdates: intent.input.sendInvites ? "all" : "none",
  });
  let result = await googleJson(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query.toString()}`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(eventBody(intent.input, eventId, startAt, endAt)),
    },
  );
  if (result.status === 409) {
    await preflightActivityWrite(store, auth.ownerOpenId, intent, auth);
    result = await googleJson(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "GET", headers: authHeaders(accessToken) },
    );
  }
  if (result.status === 404) {
    return {
      status: "pending",
      eventId,
      message:
        "Google Calendar işlemi belirsiz; aynı istek yeniden gönderilmedi. Durumu daha sonra kontrol edin.",
    };
  }
  if (!result.ok) {
    return {
      status: "failed",
      eventId,
      message: "Google Calendar toplantısı oluşturulamadı.",
    };
  }
  const event = result.body as GoogleEvent;
  const status = conferenceStatusOf(event);
  return {
    status,
    eventId: typeof event.id === "string" ? event.id : eventId,
    meetingUrl: meetingUrlOf(event),
    ...(status === "pending"
      ? {
          message:
            "Google Meet bağlantısı hazırlanıyor; durumu daha sonra kontrol edin.",
        }
      : {}),
  };
}

type CalendarRouteHandler = (req: Request, res: ExpressResponse) => unknown;

function safeCalendarRoute(handler: CalendarRouteHandler) {
  return (req: Request, res: ExpressResponse): void => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error: unknown) => {
        if (!res.headersSent) sendError(res, error);
      });
  };
}

export function registerGoogleCalendarRoutes(
  app: Express,
  store: Store,
  rawStore: Store,
): void {
  const privateStore = rawStoreOf(rawStore);

  app.get(
    "/api/google-calendar/status",
    safeCalendarRoute(async (req, res) => {
      const auth = requestAuth(req, res);
      if (!auth) return;
      const config = configuredGoogle();
      let connected = false;
      if (config) connected = Boolean(await readAccount(privateStore, auth));
      return res.json({
        configured: Boolean(config),
        setupRequired: !config,
        connected,
      });
    }),
  );

  app.post(
    "/api/google-calendar/connect",
    safeCalendarRoute(async (req, res) => {
      const auth = requestAuth(req, res);
      if (!auth) return;
      if (!canAccess(auth, "calendar", "write"))
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "calendar modülünde yazma yetkiniz yok.",
        });
      const config = configuredGoogle();
      if (!config)
        return res.status(503).json({
          error: "GOOGLE_CALENDAR_SETUP_REQUIRED",
          setupRequired: true,
          message: "Google Calendar OAuth ayarları henüz yapılandırılmamış.",
        });
      if (!configuredTrustedOrigin(req, config))
        return res.status(403).json({
          error: "CSRF_BLOCKED",
          message:
            "Google Calendar bağlantısı güvenilir tarayıcı origin'i gerektirir.",
        });
      const state = crypto.randomBytes(32).toString("base64url");
      const timestamp = Date.now();
      await privateStore.put(
        STATE_KIND,
        hashText(state),
        {
          stateHash: hashText(state),
          userOpenId: auth.user.openId,
          ownerOpenId: auth.ownerOpenId,
          expiresAt: timestamp + STATE_TTL_SECONDS * 1000,
        },
        auth.ownerOpenId,
      );
      const authorizeUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      authorizeUrl.searchParams.set("client_id", config.clientId);
      authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", CALENDAR_SCOPE);
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("prompt", "consent");
      authorizeUrl.searchParams.set("state", state);
      res.setHeader(
        "Set-Cookie",
        cookieHeader(STATE_COOKIE, state, STATE_TTL_SECONDS),
      );
      return res.json({ authorizeUrl: authorizeUrl.toString() });
    }),
  );

  app.get(
    "/api/google-calendar/callback",
    safeCalendarRoute(async (req, res) => {
      const auth = requestAuth(req, res);
      if (!auth) return;
      if (!canAccess(auth, "calendar", "write"))
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "calendar modülünde yazma yetkiniz yok.",
        });
      const config = configuredGoogle();
      if (!config)
        return res.status(503).json({
          error: "GOOGLE_CALENDAR_SETUP_REQUIRED",
          setupRequired: true,
          message: "Google Calendar OAuth ayarları henüz yapılandırılmamış.",
        });
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const cookieState = cookieValue(req, STATE_COOKIE);
      const recordId = state ? hashText(state) : "";
      const stateRecord = recordId
        ? await privateStore.get<any>(STATE_KIND, recordId, auth.ownerOpenId)
        : null;
      const statePayload = stateRecord?.payload as
        | {
            stateHash?: string;
            userOpenId?: string;
            ownerOpenId?: string;
            expiresAt?: number;
          }
        | undefined;
      const validState =
        Boolean(code) &&
        Boolean(state) &&
        Boolean(cookieState) &&
        cookieState === state &&
        Boolean(statePayload) &&
        statePayload?.stateHash === recordId &&
        statePayload?.userOpenId === auth.user.openId &&
        statePayload?.ownerOpenId === auth.ownerOpenId &&
        Number(statePayload?.expiresAt) > Date.now();
      res.setHeader("Set-Cookie", clearStateCookie());
      if (recordId)
        await privateStore.delete(STATE_KIND, recordId, auth.ownerOpenId);
      if (!validState)
        return res.status(400).json({
          error: "INVALID_OAUTH_STATE",
          message: "Google OAuth state doğrulanamadı.",
        });
      try {
        const token = await exchangeAuthorizationCode(config, code);
        const old = await readAccount(privateStore, auth);
        const refreshToken =
          typeof token.refresh_token === "string"
            ? token.refresh_token
            : old
              ? decryptSecret(old.refreshToken, config.tokenKey)
              : "";
        if (!refreshToken)
          throw statusError(502, "Google OAuth yenileme anahtarı alınamadı.");
        const expiresIn = Number(token.expires_in);
        const account: GoogleAccount = {
          provider: "google",
          userHash: userHash(auth.user.openId),
          ownerOpenId: auth.ownerOpenId,
          scope: CALENDAR_SCOPE,
          refreshToken: encryptSecret(refreshToken, config.tokenKey),
          accessToken: encryptSecret(
            String(token.access_token),
            config.tokenKey,
          ),
          accessTokenExpiresAt:
            Date.now() +
            (Number.isFinite(expiresIn) ? Math.max(60, expiresIn) : 3600) *
              1000,
          connectedAt: old?.connectedAt || now(),
          updatedAt: now(),
        };
        await privateStore.put(
          ACCOUNT_KIND,
          accountId(auth.user.openId),
          account,
          auth.ownerOpenId,
        );
        return res.redirect(303, "/whatsapp?google=connected");
      } catch (error) {
        return res
          .status(Number((error as any)?.statusCode) === 503 ? 503 : 502)
          .json({
            error: "GOOGLE_OAUTH_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "Google OAuth bağlantısı başarısız.",
          });
      }
    }),
  );

  app.post(
    "/api/meetings",
    safeCalendarRoute(async (req, res) => {
      const auth = requestAuth(req, res);
      if (!auth) return;
      const lockKey = `${auth.user.openId}:${String(req.body?.requestId || "")}`;
      const previous = meetingLocks.get(lockKey);
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      meetingLocks.set(lockKey, current);
      if (previous) await previous;
      let intentSaved = false;
      try {
        const input = MeetingInputSchema.parse(req.body);
        const startAt = meetingStartIso(input.date, input.time);
        assertMeetingInFuture(startAt);
        await assertMeetingScope(store, auth.ownerOpenId, input, auth);
        const id = intentRecordId(input, auth);
        const fingerprint = safeFingerprint(input);
        const existingRecord = await privateStore.get<MeetingIntent>(
          INTENT_KIND,
          id,
          auth.ownerOpenId,
        );
        if (existingRecord) {
          const existing = existingRecord.payload;
          if (
            existing.userOpenId !== auth.user.openId ||
            existing.ownerOpenId !== auth.ownerOpenId ||
            existing.inputFingerprint !== fingerprint
          )
            throw statusError(
              409,
              "requestId daha önce farklı bir toplantı isteği için kullanılmış.",
            );
          await preflightActivityWrite(store, auth.ownerOpenId, existing, auth);
          const activityRecord = await store.get<Activity>(
            "activities",
            existing.activityId,
            auth.ownerOpenId,
          );
          const activity = activityRecord?.payload || null;
          if (existing.provider === "manual") {
            const readyIntent: MeetingIntent = {
              ...existing,
              status: "ready",
              conferenceStatus: "ready",
              meetingUrl: existing.meetingUrl || existing.input.meetingUrl,
              updatedAt: now(),
            };
            const repaired =
              activity ||
              (await saveActivity(store, auth.ownerOpenId, readyIntent, {
                conferenceStatus: "ready",
                meetingUrl: readyIntent.meetingUrl,
              }));
            await saveIntent(privateStore, auth, id, readyIntent);
            return res.status(200).json(responseBody(repaired, "ready"));
          }
          if (existing.status === "failed")
            return res
              .status(502)
              .json(
                responseBody(
                  activity,
                  "failed",
                  "Google Calendar toplantısı oluşturulamadı.",
                ),
              );
          if (!activity && existing.status === "ready" && existing.meetingUrl) {
            const repaired = await saveActivity(
              store,
              auth.ownerOpenId,
              existing,
              {
                conferenceStatus: "ready",
                meetingUrl: existing.meetingUrl,
                googleEventId: existing.googleEventId || existing.eventId,
              },
            );
            return res.status(200).json(responseBody(repaired, "ready"));
          }
          return res
            .status(200)
            .json(
              responseBody(
                activity,
                existing.conferenceStatus,
                existing.status === "unknown"
                  ? "Aynı toplantı isteği zaten belirsiz durumda; yeniden oluşturulmadı."
                  : undefined,
              ),
            );
        }

        const baseIntent: MeetingIntent = {
          requestId: input.requestId,
          inputFingerprint: fingerprint,
          input,
          ownerOpenId: auth.ownerOpenId,
          userOpenId: auth.user.openId,
          userHash: userHash(auth.user.openId),
          provider: input.provider,
          eventId:
            input.provider === "google"
              ? googleEventId(
                  auth.ownerOpenId,
                  auth.user.openId,
                  input.requestId,
                )
              : undefined,
          status: "pending",
          conferenceStatus: "pending",
          activityId: intentActivityId(input.requestId, auth.user.openId),
          createdAt: now(),
          updatedAt: now(),
        };

        // Validate configuration and account before reserving the request id. A
        // setup/connect error must be retryable with the same UUID.
        let config: GoogleConfig | null = null;
        if (input.provider === "google") {
          config = configuredGoogle();
          if (!config)
            throw statusError(
              503,
              "Google Calendar OAuth ayarları henüz yapılandırılmamış.",
            );
          if (!(await readAccount(privateStore, auth)))
            throw statusError(409, "Önce Google Calendar hesabınızı bağlayın.");
        }
        await preflightActivityWrite(store, auth.ownerOpenId, baseIntent, auth);
        await saveIntent(privateStore, auth, id, baseIntent);
        intentSaved = true;

        if (input.provider === "manual") {
          const readyIntent: MeetingIntent = {
            ...baseIntent,
            status: "ready",
            conferenceStatus: "ready",
            meetingUrl: input.meetingUrl,
            updatedAt: now(),
          };
          const activity = await saveActivity(
            store,
            auth.ownerOpenId,
            readyIntent,
            {
              conferenceStatus: "ready",
              meetingUrl: input.meetingUrl,
            },
          );
          await saveIntent(privateStore, auth, id, readyIntent);
          return res.status(201).json(responseBody(activity, "ready"));
        }

        try {
          const result = await createGoogleMeeting(
            config!,
            privateStore,
            store,
            auth,
            baseIntent,
          );
          const updated: MeetingIntent = {
            ...baseIntent,
            status:
              result.status === "ready"
                ? "ready"
                : result.status === "pending"
                  ? "pending"
                  : "failed",
            conferenceStatus: result.status,
            googleEventId: result.eventId,
            meetingUrl: result.meetingUrl,
            lastError:
              result.status === "failed" ? "google_event_failed" : undefined,
            updatedAt: now(),
          };
          if (result.status === "failed") {
            let activity: Activity | null = null;
            try {
              activity = await saveActivity(store, auth.ownerOpenId, updated, {
                conferenceStatus: "failed",
                googleEventId: result.eventId,
              });
              await saveIntent(privateStore, auth, id, updated);
            } catch {
              // Keep the provider failure visible without pretending CRM success.
              try {
                await saveIntent(privateStore, auth, id, updated);
              } catch {
                /* best effort; the request remains non-successful */
              }
            }
            return res
              .status(502)
              .json(responseBody(activity, "failed", result.message));
          }
          try {
            const activity = await saveActivity(
              store,
              auth.ownerOpenId,
              updated,
              {
                conferenceStatus: result.status,
                meetingUrl: result.meetingUrl,
                googleEventId: result.eventId,
              },
            );
            await saveIntent(privateStore, auth, id, updated);
            return res
              .status(201)
              .json(responseBody(activity, result.status, result.message));
          } catch {
            const uncertain: MeetingIntent = {
              ...updated,
              status: "unknown",
              conferenceStatus: "pending",
              lastError: "crm_persistence_unknown",
              updatedAt: now(),
            };
            try {
              await saveIntent(privateStore, auth, id, uncertain);
            } catch {
              /* best effort; never report a completed CRM write */
            }
            return res
              .status(202)
              .json(
                responseBody(
                  null,
                  "pending",
                  "Google toplantısı oluşturuldu ancak CRM kaydı kesinleşmedi; durumu kontrol edin.",
                ),
              );
          }
        } catch (error) {
          const uncertain =
            error instanceof GoogleTimeoutError ||
            error instanceof GoogleTransportError;
          if (uncertain) {
            const pending: MeetingIntent = {
              ...baseIntent,
              status: "unknown",
              conferenceStatus: "pending",
              lastError:
                error instanceof GoogleTimeoutError
                  ? "provider_timeout_unknown"
                  : "provider_transport_unknown",
              updatedAt: now(),
            };
            if (intentSaved) {
              try {
                await saveIntent(privateStore, auth, id, pending);
              } catch {
                /* best effort; do not issue a second provider insert */
              }
            }
            return res
              .status(202)
              .json(
                responseBody(
                  null,
                  "pending",
                  "Google Calendar yanıtı kesinleşmedi; çift toplantı oluşturulmadı. Durumu daha sonra kontrol edin.",
                ),
              );
          }
          throw error;
        }
      } finally {
        release();
        if (meetingLocks.get(lockKey) === current) meetingLocks.delete(lockKey);
      }
    }),
  );

  app.get(
    "/api/meetings/:requestId",
    safeCalendarRoute(async (req, res) => {
      const auth = requestAuth(req, res);
      if (!auth) return;
      try {
        const requestId = String(req.params.requestId || "");
        if (!z.string().uuid().safeParse(requestId).success)
          throw statusError(400, "requestId UUID biçiminde olmalı.");
        const intent = await loadIntent(privateStore, auth, requestId);
        if (!intent) throw statusError(404, "Toplantı isteği bulunamadı.");
        await assertMeetingScope(store, auth.ownerOpenId, intent.input, auth);
        let activityRecord = await store.get<Activity>(
          "activities",
          intent.activityId,
          auth.ownerOpenId,
        );
        if (
          intent.provider === "manual" ||
          intent.status === "ready" ||
          intent.status === "failed"
        ) {
          return res.json(
            responseBody(
              activityRecord?.payload || null,
              intent.conferenceStatus,
            ),
          );
        }
        const config = configuredGoogle();
        if (!config)
          return res.json(
            responseBody(
              activityRecord?.payload || null,
              "pending",
              "Google Calendar ayarları henüz yapılandırılmamış.",
            ),
          );
        try {
          const result = await fetchGoogleEvent(
            config,
            privateStore,
            store,
            auth,
            intent,
          );
          if (result.status === 200) {
            const event = result.body;
            const conferenceStatus = conferenceStatusOf(event);
            const meetingUrl = meetingUrlOf(event);
            const updated: MeetingIntent = {
              ...intent,
              status:
                conferenceStatus === "ready"
                  ? "ready"
                  : conferenceStatus === "failed"
                    ? "failed"
                    : "pending",
              conferenceStatus,
              googleEventId: intent.googleEventId || intent.eventId,
              meetingUrl,
              updatedAt: now(),
            };
            const activity = await saveActivity(
              store,
              auth.ownerOpenId,
              updated,
              {
                conferenceStatus,
                meetingUrl,
                googleEventId: updated.googleEventId,
              },
            );
            await saveIntent(
              privateStore,
              auth,
              intentId(auth.user.openId, requestId),
              updated,
            );
            return res.json(responseBody(activity, conferenceStatus));
          }
          if (result.status === 404)
            return res.json(
              responseBody(
                activityRecord?.payload || null,
                "pending",
                "Google Meet bağlantısı henüz hazır değil.",
              ),
            );
          return res.json(
            responseBody(
              activityRecord?.payload || null,
              "pending",
              "Google Calendar toplantısı henüz kesinleşmedi.",
            ),
          );
        } catch (error) {
          if (
            error instanceof GoogleTimeoutError ||
            error instanceof GoogleTransportError
          )
            return res
              .status(202)
              .json(
                responseBody(
                  activityRecord?.payload || null,
                  "pending",
                  "Google Calendar yanıtı bekleniyor.",
                ),
              );
          throw error;
        }
      } catch (error) {
        return sendError(res, error);
      }
    }),
  );
}
