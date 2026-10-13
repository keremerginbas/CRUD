import express, { type Request } from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upstream } = vi.hoisted(() => ({ upstream: vi.fn() }));
vi.mock("../server/security.js", () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => upstream(url, init),
}));

import { createMemoryStore, type Store } from "../server/db.js";
import {
  getStoredN8nReports,
  refreshN8nReports,
  registerN8nReportRoutes,
} from "../server/n8n-reports.js";

const env = { ...process.env };
const OWNER = "owner-report";
const BASE = "https://xre111.shop";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ownerMiddleware(req: Request, _res: unknown, next: () => void): void {
  (req as Request & { auth?: unknown }).auth = {
    ownerOpenId: OWNER,
    isOwner: true,
    user: { openId: OWNER },
  };
  next();
}

async function start(store: Store) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", ownerMiddleware);
  registerN8nReportRoutes(app, store);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { server, base: `http://127.0.0.1:${address.port}` };
}

beforeEach(() => {
  process.env.N8N_API_KEY = "management-secret-test-only";
  upstream.mockReset();
});

afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in env)) delete process.env[key];
  Object.assign(process.env, env);
});

describe("n8n report routes", () => {
  it("reads only the owner-selected fixed workflows and returns safe metadata", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      {
        baseUrl: BASE,
        selectedWorkflowIds: ["KWD5Yr7uuz2gMlI5", "not-user-controlled"],
      },
      OWNER,
    );
    upstream.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>)["X-N8N-API-KEY"]).toBe(
        "management-secret-test-only",
      );
      const id = url.includes("KWD5Yr7uuz2gMlI5")
        ? "KWD5Yr7uuz2gMlI5"
        : "other";
      return json({
        id,
        name: "Canlı rapor akışı",
        active: true,
        updatedAt: "2026-01-02T03:04:05.000Z",
        nodes: [
          {
            type: "n8n-nodes-base.webhook",
            parameters: {
              path: "xre-report",
              httpMethod: "POST",
              authentication: "headerAuth",
            },
            credentials: { headerAuth: { id: "never-return" } },
          },
        ],
        secret: "never-return",
      });
    });
    const { server, base } = await start(store);
    try {
      const response = await fetch(`${base}/api/n8n/selected`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toEqual([
        {
          id: "KWD5Yr7uuz2gMlI5",
          name: "Canlı rapor akışı",
          active: true,
          updatedAt: "2026-01-02T03:04:05.000Z",
          webhooks: [
            {
              path: "/webhook/xre-report",
              method: "POST",
              authentication: "headerAuth",
            },
          ],
          webhookPaths: ["/webhook/xre-report"],
          webhookMethods: ["POST"],
          webhookAuthentication: ["headerAuth"],
        },
      ]);
      expect(JSON.stringify(body)).not.toContain("never-return");
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fetches latest successful output read-only, extracts labels, redacts secrets, and caches safely", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      { baseUrl: BASE, selectedWorkflowIds: ["KWD5Yr7uuz2gMlI5"] },
      OWNER,
    );
    upstream.mockImplementation(async (url: string) => {
      if (url.includes("/executions?") || url.includes("/executions?"))
        return json({
          data: [
            {
              id: "exec-1",
              status: "success",
              stoppedAt: "2026-01-03T20:00:00.000Z",
            },
          ],
        });
      expect(url).toContain("/api/v1/executions/exec-1?includeData=true");
      return json({
        id: "exec-1",
        status: "success",
        finishedAt: "2026-01-03T20:00:01.000Z",
        data: {
          resultData: {
            lastNodeExecuted: "Final Report",
            runData: {
              Webhook: [
                {
                  data: {
                    main: [[{ json: { input: "provider raw request" } }]],
                  },
                },
              ],
              "Final Report": [
                {
                  data: {
                    main: [
                      [
                        {
                          json: {
                            report: {
                              summary:
                                "<b>Bugün 4 yeni müşteri</b> sk-proj-abcdefghijklmnopqrstuvwxyz https://xre111.shop/rest/user123/secret987?token=abc123",
                            },
                            totals: {
                              customers: 4,
                              credentials: "do-not-store",
                              raw_event: "do-not-store",
                            },
                            providerResult: { token: "do-not-store" },
                          },
                        },
                      ],
                    ],
                  },
                },
              ],
            },
          },
        },
        workflowData: { nodes: [{ code: "do-not-read" }] },
      });
    });
    const result = await refreshN8nReports(store, OWNER);
    expect(result.errors).toEqual([]);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      workflowId: "KWD5Yr7uuz2gMlI5",
      executionId: "exec-1",
      status: "success",
      finishedAt: "2026-01-03T20:00:01.000Z",
      metrics: { totals: { customers: 4 } },
    });
    expect(result.reports[0].summary).toContain("Bugün 4 yeni müşteri");
    expect(result.reports[0].summary).not.toContain("sk-proj");
    expect(result.reports[0].summary).not.toContain("<b>");
    expect(result.reports[0].summary).not.toContain("secret987");
    expect(result.reports[0].summary).not.toContain("abc123");
    expect(JSON.stringify(result)).not.toContain("do-not-store");
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(upstream.mock.calls.every((call) => call[1]?.method === "GET")).toBe(
      true,
    );
    const stored = await getStoredN8nReports(store, OWNER);
    expect(stored[0]).toMatchObject({
      workflowId: "KWD5Yr7uuz2gMlI5",
      executionId: "exec-1",
    });
    expect(JSON.stringify(stored)).not.toContain("do-not-store");
  });

  it("does not fabricate a report when no successful execution exists", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      { baseUrl: BASE, selectedWorkflowIds: ["KWD5Yr7uuz2gMlI5"] },
      OWNER,
    );
    upstream.mockResolvedValue(json({ data: [] }));
    const result = await refreshN8nReports(store, OWNER);
    expect(result.reports).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      workflowId: "KWD5Yr7uuz2gMlI5",
      code: "N8N_NO_SUCCESS_EXECUTION",
    });
    expect(await getStoredN8nReports(store, OWNER)).toMatchObject([
      {
        workflowId: "KWD5Yr7uuz2gMlI5",
        status: "error",
        limits: [
          "Son yenileme başarısız (N8N_NO_SUCCESS_EXECUTION): Workflow için başarılı yürütme bulunamadı.",
        ],
      },
    ]);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("keeps refresh concurrency at three and rejects unauthenticated HTTP access", async () => {
    const store = createMemoryStore();
    await store.put(
      "integration",
      "n8n",
      {
        baseUrl: BASE,
        selectedWorkflowIds: [
          "KWD5Yr7uuz2gMlI5",
          "0PIWrbVUIcWf7AiZ",
          "IDJi8fQoxPxpWU5F",
          "LD8jlJvE1LBmMeE3",
          "gWKseHEZL96T26iC",
          "ImTuxSRxDugg33aI",
        ],
      },
      OWNER,
    );
    let active = 0;
    let maxActive = 0;
    upstream.mockImplementation(async (url: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      if (url.includes("/executions?") || url.includes("/executions?"))
        return json({ data: [] });
      return json({});
    });
    const result = await refreshN8nReports(store, OWNER);
    expect(result.reports).toEqual([]);
    expect(result.errors).toHaveLength(6);
    expect(maxActive).toBeLessThanOrEqual(3);

    const app = express();
    registerN8nReportRoutes(app, store);
    const server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/n8n/reports`);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "UNAUTHORIZED" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
