import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import http from "node:http";
import crypto from "node:crypto";
import { createMemoryStore, type Store } from "../server/db";
import { registerGoogleCalendarRoutes } from "../server/google-calendar";
import type { AuthContext } from "../server/types";

const savedEnv = { ...process.env };
const realFetch = globalThis.fetch.bind(globalThis);

function futureDate(days = 2): string {
  const value = new Date(Date.now() + days * 86_400_000);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function start(
  options: {
    auth?: AuthContext;
    lead?: Record<string, unknown>;
  } = {},
) {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client-id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_CALENDAR_REDIRECT_URI =
    "https://crm.example.test/api/google-calendar/callback";
  process.env.GOOGLE_CALENDAR_TOKEN_KEY = crypto
    .randomBytes(32)
    .toString("base64");
  const raw = createMemoryStore();
  const auth: AuthContext = options.auth || {
    user: { openId: "meeting-user", name: "Meeting User" },
    ownerOpenId: "meeting-owner",
    isOwner: true,
    employeeId: "meeting-user",
    displayName: "Meeting User",
  };
  await raw.put(
    "lead",
    "lead-1",
    { id: "lead-1", name: "Lead", stage: "new", ...options.lead },
    auth.ownerOpenId,
  );
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res, next) => {
    (req as Request & { auth?: AuthContext }).auth = auth;
    next();
  });
  registerGoogleCalendarRoutes(app, raw, raw);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { raw, server, base: `http://127.0.0.1:${port}` };
}

const request = () => ({
  requestId: crypto.randomUUID(),
  leadId: "lead-1",
  title: "Demo görüşmesi",
  date: futureDate(),
  time: "11:00",
  durationMinutes: 60,
  assignee: "Meeting User",
  attendees: ["Musteri@Example.com"],
  description: "İlk tanışma",
  sendInvites: false,
  provider: "manual" as const,
  meetingUrl: "https://meet.google.com/abc-defg-hij",
});

function googleRequest(overrides: Partial<ReturnType<typeof request>> = {}) {
  const value = { ...request(), provider: "google" as const, ...overrides };
  delete (value as Partial<typeof value>).meetingUrl;
  return value;
}

async function completeGoogleOAuth(base: string) {
  const connected = await realFetch(`${base}/api/google-calendar/connect`, {
    method: "POST",
    headers: { origin: "https://crm.example.test" },
  });
  expect(connected.status).toBe(200);
  const authorizeUrl = new URL((await connected.json()).authorizeUrl);
  const state = authorizeUrl.searchParams.get("state");
  const cookie = (connected.headers.get("set-cookie") || "").split(";", 1)[0];
  expect(state).toBeTruthy();
  expect(cookie).toContain("xre_google_calendar_state=");
  const callback = await realFetch(
    `${base}/api/google-calendar/callback?code=oauth-code&state=${encodeURIComponent(state!)}`,
    { headers: { cookie }, redirect: "manual" },
  );
  return { callback, state: state!, cookie };
}

afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  vi.unstubAllGlobals();
});

describe("Google Meet meeting routes", () => {
  it("manual bağlantıyı strict doğrular, activity yazar ve GET ile idempotent okur", async () => {
    const { server, base } = await start();
    try {
      const body = request();
      const created = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(created.status).toBe(201);
      const payload = await created.json();
      expect(payload).toMatchObject({
        conferenceStatus: "ready",
        meetingUrl: body.meetingUrl,
        activity: {
          leadId: "lead-1",
          type: "meeting",
          provider: "manual",
          meetingProvider: "manual",
          attendees: ["musteri@example.com"],
        },
      });

      const fetched = await realFetch(`${base}/api/meetings/${body.requestId}`);
      expect(fetched.status).toBe(200);
      expect(await fetched.json()).toMatchObject({
        conferenceStatus: "ready",
        activity: { id: payload.activity.id, meetingUrl: body.meetingUrl },
      });

      const retry = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(retry.status).toBe(200);
      expect((await retry.json()).activity.id).toBe(payload.activity.id);
    } finally {
      server.close();
    }
  });

  it("unknown keys and fake manual links are rejected without provider calls", async () => {
    const { server, base } = await start();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const invalid = { ...request(), unexpected: true };
      const extra = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalid),
      });
      expect(extra.status).toBe(400);

      const fake = {
        ...request(),
        requestId: crypto.randomUUID(),
        meetingUrl: "https://example.com/fake",
      };
      const rejected = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fake),
      });
      expect(rejected.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("reports setupRequired and never calls Google when credentials are absent", async () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    delete process.env.GOOGLE_CALENDAR_TOKEN_KEY;
    const { raw, server, base } = await start();
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    delete process.env.GOOGLE_CALENDAR_TOKEN_KEY;
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const status = await realFetch(`${base}/api/google-calendar/status`);
      expect(await status.json()).toMatchObject({
        configured: false,
        connected: false,
        setupRequired: true,
      });
      const google = {
        ...request(),
        requestId: crypto.randomUUID(),
        provider: "google" as const,
      };
      delete (google as Partial<typeof google>).meetingUrl;
      const result = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(google),
      });
      expect(result.status).toBe(503);
      expect(await result.json()).toMatchObject({
        error: "GOOGLE_CALENDAR_NOT_CONFIGURED",
      });
      expect(
        await raw.list("google_calendar_meeting_intent", "meeting-owner"),
      ).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("requires a trusted browser origin for connect and does not exchange credentials", async () => {
    const { server, base } = await start();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const denied = await realFetch(`${base}/api/google-calendar/connect`, {
        method: "POST",
      });
      expect(denied.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();

      const connected = await realFetch(`${base}/api/google-calendar/connect`, {
        method: "POST",
        headers: { origin: "https://crm.example.test" },
      });
      expect(connected.status).toBe(200);
      expect((await connected.json()).authorizeUrl).toContain(
        "accounts.google.com",
      );
      expect(connected.headers.get("set-cookie")).toContain("HttpOnly");
      expect(connected.headers.get("set-cookie")).toContain("SameSite=None");
      expect(connected.headers.get("set-cookie")).toContain("Secure");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("retries the same UUID after setup and account connection are repaired", async () => {
    const { raw, server, base } = await start();
    const config = {
      clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI!,
      tokenKey: process.env.GOOGLE_CALENDAR_TOKEN_KEY!,
    };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const body = googleRequest();
      for (const key of Object.keys(config))
        delete process.env[
          `GOOGLE_CALENDAR_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`
        ];
      const first = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(first.status).toBe(503);
      expect(
        await raw.list("google_calendar_meeting_intent", "meeting-owner"),
      ).toHaveLength(0);

      process.env.GOOGLE_CALENDAR_CLIENT_ID = config.clientId;
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET = config.clientSecret;
      process.env.GOOGLE_CALENDAR_REDIRECT_URI = config.redirectUri;
      process.env.GOOGLE_CALENDAR_TOKEN_KEY = config.tokenKey;
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
      await completeGoogleOAuth(base);
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "a-retry-event",
            hangoutLink: "https://meet.google.com/abc-defg-hij",
          }),
          { status: 200 },
        ),
      );
      const retried = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(retried.status).toBe(201);
      expect((await retried.json()).conferenceStatus).toBe("ready");
    } finally {
      server.close();
    }
  });

  it("rejects an invalid OAuth state without exchanging credentials", async () => {
    const { server, base } = await start();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const connected = await realFetch(`${base}/api/google-calendar/connect`, {
        method: "POST",
        headers: { origin: "https://crm.example.test" },
      });
      const authorizeUrl = new URL((await connected.json()).authorizeUrl);
      const state = authorizeUrl.searchParams.get("state")!;
      const callback = await realFetch(
        `${base}/api/google-calendar/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
        { redirect: "manual" },
      );
      expect(callback.status).toBe(400);
      expect(await callback.json()).toMatchObject({
        error: "INVALID_OAUTH_STATE",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });

  it("stores only encrypted token material and redirects OAuth success relatively", async () => {
    const { raw, server, base } = await start();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-secret-value",
          refresh_token: "refresh-secret-value",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { callback } = await completeGoogleOAuth(base);
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe(
        "/whatsapp?google=connected",
      );
      expect(callback.headers.get("set-cookie")).toContain("Secure");
      const accounts = await raw.list(
        "google_calendar_account",
        "meeting-owner",
      );
      expect(accounts).toHaveLength(1);
      const serialized = JSON.stringify(accounts[0].payload);
      expect(serialized).not.toContain("access-secret-value");
      expect(serialized).not.toContain("refresh-secret-value");
      expect((accounts[0].payload as { userHash: string }).userHash).toMatch(
        /^[a-f0-9]{64}$/,
      );
    } finally {
      server.close();
    }
  });

  it("recovers pending Meet asynchronously and honors sendUpdates consent", async () => {
    const { server, base } = await start();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
      await completeGoogleOAuth(base);
      fetchMock.mockClear();
      let insertedEventId = "";
      let insertQuery = "";
      fetchMock.mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/events?") && init?.method === "POST") {
          insertQuery = url;
          const body = JSON.parse(String(init.body || "{}")) as { id: string };
          insertedEventId = body.id;
          return new Response(
            JSON.stringify({
              id: insertedEventId,
              conferenceData: {
                createRequest: { status: { statusCode: "pending" } },
              },
            }),
            { status: 200 },
          );
        }
        if (
          url.includes(`/events/${insertedEventId}`) &&
          init?.method === "GET"
        ) {
          return new Response(
            JSON.stringify({
              id: insertedEventId,
              hangoutLink: "https://meet.google.com/abc-defg-hij",
              conferenceData: {
                createRequest: { status: { statusCode: "success" } },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected provider call: ${url}`);
      });

      const body = googleRequest({ sendInvites: true });
      const created = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({
        conferenceStatus: "pending",
      });
      expect(insertQuery).toContain("sendUpdates=all");

      const recovered = await realFetch(
        `${base}/api/meetings/${body.requestId}`,
      );
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        conferenceStatus: "ready",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
      });
    } finally {
      server.close();
    }
  });

  it("does not call Google for a lead outside an own permission scope", async () => {
    const auth: AuthContext = {
      user: { openId: "scoped-user", name: "Alice" },
      ownerOpenId: "meeting-owner",
      isOwner: false,
      employeeId: "employee-alice",
      displayName: "Alice",
      permissions: {
        calendar: { read: true, write: true, scope: "own" },
        crm: { read: true, write: true, scope: "own" },
      } as AuthContext["permissions"],
    };
    const { server, base } = await start({
      auth,
      lead: { ownerOpenId: "employee-bob", owner: "Bob" },
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const body = googleRequest({ assignee: "Alice" });
      const denied = await realFetch(`${base}/api/meetings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(denied.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
