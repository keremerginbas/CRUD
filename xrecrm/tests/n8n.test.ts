import express, { type Request } from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../server/security.js", () => ({
  fetchWithTimeout: (url: string, init: RequestInit) => fetch(url, init),
  signedOutboundHeaders: (body: string, secret: string) => ({
    "content-type": "application/json",
    "x-xre-timestamp": "1700000000",
    "x-xre-signature": `sha256:${secret.slice(0, 8)}:${body.length}`,
  }),
  timingSafeEqualText: (a: string | undefined, b: string | undefined) =>
    Boolean(a && b && a.length === b.length && a === b),
}));

import { createMemoryStore, type Store } from "../server/db.js";
import {
  deriveN8nInboundToken,
  deliverN8nEvent,
  registerN8nInboundRoute,
  registerN8nRoutes,
} from "../server/n8n.js";

const env = { ...process.env };
const nativeFetch = globalThis.fetch.bind(globalThis);

function ownerMiddleware(req: Request, _res: any, next: () => void) {
  (req as Request & { auth?: unknown }).auth = {
    ownerOpenId: "owner-n8n",
    isOwner: true,
    user: { openId: "owner-n8n" },
  };
  next();
}

async function start(
  store: Store,
  callback?: (store: Store, owner: string, body: unknown) => Promise<void>,
) {
  const app = express();
  registerN8nInboundRoute(app, store, callback);
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", ownerMiddleware);
  registerN8nRoutes(app, store);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { server, base: `http://127.0.0.1:${address.port}` };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.N8N_API_KEY = "management-secret-test-only";
  process.env.MANUS_OWNER_OPEN_ID = "owner-n8n";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env))
    if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

describe("n8n entegrasyonu", () => {
  it("owner-scope settings normalizes /api/v1 and never stores the management key", async () => {
    const store = createMemoryStore();
    const { server, base } = await start(store);
    try {
      const saved = await nativeFetch(`${base}/api/n8n/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: "https://n8n.example.test/home/workflows",
          webhookUrl: "https://n8n.example.test/webhook/xre-crm",
        }),
      });
      expect(saved.status).toBe(200);
      const body = await saved.json();
      expect(body.baseUrl).toBe("https://n8n.example.test");
      expect(body.webhookUrl).toBe("https://n8n.example.test/webhook/xre-crm");
      expect(body.apiKeyConfigured).toBe(true);
      expect(JSON.stringify(body)).not.toContain("management-secret-test-only");
      expect(
        (await store.get<any>("integration", "n8n", "owner-n8n"))?.payload,
      ).not.toHaveProperty("apiKey");
    } finally {
      server.close();
    }
  });

  it("uses the API key only for read-only management calls and strips workflow internals", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      {
        baseUrl: "https://n8n.example.test",
        webhookUrl: "https://n8n.example.test/webhook/xre",
      },
      "owner-n8n",
    );
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["X-N8N-API-KEY"]).toBe(
        "management-secret-test-only",
      );
      return response({
        data: [
          {
            id: "wf-1",
            name: "Lead akışı",
            active: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
            nodes: [
              {
                type: "n8n-nodes-base.webhook",
                parameters: { path: "xre-lead" },
                credentials: { secret: "never-return" },
              },
            ],
            secret: "never-return",
          },
        ],
        nextCursor: "cursor-2",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { server, base } = await start(store);
    try {
      const result = await nativeFetch(`${base}/api/n8n/workflows?limit=1`);
      expect(result.status).toBe(200);
      const body = await result.json();
      expect(body).toEqual({
        data: [
          {
            id: "wf-1",
            name: "Lead akışı",
            active: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
            webhookPaths: ["/webhook/xre-lead"],
          },
        ],
        nextCursor: "cursor-2",
      });
      expect(JSON.stringify(body)).not.toContain("credentials");
      expect(JSON.stringify(body)).not.toContain("never-return");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });

  it("maps n8n 401 and 403 to sanitized API errors", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      { baseUrl: "https://n8n.example.test" },
      "owner-n8n",
    );
    let status = 401;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ message: "provider secret should not leak" }, status),
      ),
    );
    const { server, base } = await start(store);
    try {
      let result = await nativeFetch(`${base}/api/n8n/test`, {
        method: "POST",
      });
      expect(result.status).toBe(401);
      expect(await result.json()).toEqual({
        error: "N8N_API_KEY_INVALID",
        message: "n8n API anahtarı geçersiz veya süresi dolmuş.",
      });
      status = 403;
      result = await nativeFetch(`${base}/api/n8n/test`, { method: "POST" });
      expect(result.status).toBe(403);
      expect(await result.json()).toEqual({
        error: "N8N_PERMISSION_DENIED",
        message: "n8n API anahtarının gerekli okuma izni yok.",
      });
    } finally {
      server.close();
    }
  });

  it("derives an owner-scoped inbound token and deduplicates events", async () => {
    const store = createMemoryStore();
    const processed = vi.fn(async () => undefined);
    const { server, base } = await start(store, processed);
    try {
      const tokenResponse = await nativeFetch(`${base}/api/n8n/token`, {
        method: "POST",
      });
      const token = (await tokenResponse.json()).token;
      expect(token).toBe(deriveN8nInboundToken("owner-n8n"));
      const init = {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "evt-1",
          type: "lead.updated",
          lead: { id: "lead-1" },
        }),
      };
      const first = await nativeFetch(`${base}/api/webhooks/n8n`, init);
      const second = await nativeFetch(`${base}/api/webhooks/n8n`, init);
      expect(first.status).toBe(200);
      expect((await first.json()).duplicate).toBe(false);
      expect((await second.json()).duplicate).toBe(true);
      expect(processed).toHaveBeenCalledTimes(1);
      const events = await store.listEvents("owner-n8n");
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        type: "webhook",
        provider: "inbound",
      });
    } finally {
      server.close();
    }
  });

  it("queues a delivery without sending the API key to a webhook", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      {
        baseUrl: "https://n8n.example.test",
        webhookUrl: "https://n8n.example.test/webhook/xre",
      },
      "owner-n8n",
    );
    await store.put(
      "lead",
      "lead-1",
      {
        id: "lead-1",
        name: "Test lead",
        phone: "",
        email: "",
        company: "",
        stage: "new",
        owner: "owner-n8n",
        value: 0,
        source: "test",
        notes: "",
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        tags: [],
      },
      "owner-n8n",
    );
    let capturedInit: RequestInit | undefined;
    const providerFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return response({ ok: true });
    });
    vi.stubGlobal("fetch", providerFetch);
    const { server, base } = await start(store);
    try {
      const queued = await nativeFetch(`${base}/api/n8n/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: "lead-1",
          eventType: "lead.updated",
          eventId: "event-1",
        }),
      });
      expect(queued.status).toBe(202);
      const event = (await store.listEvents("owner-n8n"))[0];
      await deliverN8nEvent(store, event);
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers.Authorization).not.toContain(
        "management-secret-test-only",
      );
      expect(headers["X-XRE-Event-ID"]).toBe(event.id);
      expect(providerFetch).toHaveBeenCalledTimes(1);
    } finally {
      server.close();
    }
  });
});
