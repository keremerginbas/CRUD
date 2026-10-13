import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAuth, createSessionToken } from "../server/auth";
import { createMemoryStore } from "../server/db";
import { registerAssistantRoutes } from "../server/assistant";
import { buildReport } from "../shared/assistant";

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function restoreEnv(): void {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  restoreEnv();
});

async function start() {
  process.env.MANUS_PROJECT_ID = "assistant-test";
  process.env.MANUS_JWT_SECRET = "assistant-secret";
  process.env.XRE_OWNER_OPEN_ID = "assistant-owner";
  const store = createMemoryStore();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", requireAuth(store));
  registerAssistantRoutes(app, store);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const token = await createSessionToken({
    openId: "assistant-owner",
    name: "Test Owner",
  });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  return { store, server, base: `http://127.0.0.1:${address.port}`, headers };
}

const lead = {
  id: "lead-1",
  name: "Ada Lead",
  phone: "+905551112233",
  email: "ada@example.com",
  company: "Acme",
  stage: "qualified",
  owner: "assistant-owner",
  value: 100,
  source: "manual",
  notes: "CRM notu",
  createdAt: "2025-01-01T00:00:00.000Z",
  lastActivity: "2025-01-01T00:00:00.000Z",
  tags: [],
};

describe("assistant server contract", () => {
  it("auth protects status and reports configuration without exposing the key", async () => {
    delete process.env.XRE_OPENAI_API_KEY;
    const { server, base, headers } = await start();
    try {
      const unauthorized = await fetch(`${base}/api/assistant/status`);
      expect(unauthorized.status).toBe(401);
      const status = await fetch(`${base}/api/assistant/status`, { headers });
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        configured: false,
        model: "gpt-4.1-mini",
        provider: "OpenAI",
      });
      process.env.XRE_OPENAI_API_KEY = "test-provider-key";
      const configured = await fetch(`${base}/api/assistant/status`, {
        headers,
      });
      expect(await configured.json()).toEqual({
        configured: true,
        model: "gpt-4.1-mini",
        provider: "OpenAI",
      });
    } finally {
      server.close();
    }
  });

  it("calls only the official provider, validates sources/actions, and persists owner history", async () => {
    const { server, store, base, headers } = await start();
    process.env.XRE_OPENAI_API_KEY = "test-provider-key";
    await store.put("lead", lead.id, lead, "assistant-owner");
    const provider = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        if (String(input) === "https://api.openai.com/v1/chat/completions") {
          const body = JSON.parse(String(init?.body));
          expect(body.model).toBe("gpt-4.1-mini");
          expect(body.store).toBe(false);
          expect(init?.redirect).toBe("error");
          expect(
            String((init?.headers as Record<string, string>).authorization),
          ).toBe("Bearer test-provider-key");
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      answer:
                        "Ada lead için güvenli bir görev önerisi hazırladım.",
                      actions: [
                        {
                          id: "task-proposal",
                          kind: "task",
                          operation: "create",
                          summary: "Takip görevi",
                          payload: {
                            title: "Ada'yı ara",
                            leadId: "lead-1",
                            assignee: "Test Owner",
                            dueAt: "2025-01-03T10:00:00+03:00",
                          },
                        },
                      ],
                      sources: [
                        {
                          kind: "lead",
                          id: "lead-1",
                          label: "uydurulmuş etiket",
                        },
                        { kind: "lead", id: "foreign", label: "yabancı" },
                      ],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return originalFetch(input, init);
      });
    try {
      const response = await fetch(`${base}/api/assistant/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: "Ada için takip görevi öner.",
          history: [],
          context: { path: "/leads", leadId: "lead-1" },
          clientMessageId: "client-1",
        }),
      });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({
        mode: "live",
        model: "gpt-4.1-mini",
        answer: expect.any(String),
      });
      expect(json.actions).toEqual([
        {
          id: expect.any(String),
          kind: "task",
          operation: "create",
          summary: "Takip görevi",
          payload: {
            title: "Ada'yı ara",
            leadId: "lead-1",
            assignee: "Test Owner",
            dueAt: "2025-01-03T10:00:00+03:00",
          },
        },
      ]);
      expect(json.sources).toEqual([
        { kind: "lead", id: "lead-1", label: "Ada Lead", path: "/leads" },
      ]);
      expect(provider).toHaveBeenCalled();
      const history = await fetch(`${base}/api/assistant/history`, { headers });
      const historyJson = await history.json();
      expect(historyJson.messages).toHaveLength(2);
      expect(historyJson.messages[0]).toMatchObject({
        role: "user",
        content: "Ada için takip görevi öner.",
      });
      expect(historyJson.messages[1]).toMatchObject({
        role: "assistant",
        actions: json.actions,
      });
    } finally {
      server.close();
    }
  });

  it("never invents historical counts at the UTC+3 day boundaries", () => {
    const report = buildReport(
      {
        leads: [
          { id: "before", createdAt: "2024-12-31T20:59:59.999Z", stage: "new" },
          {
            id: "at-start",
            createdAt: "2024-12-31T21:00:00.000Z",
            stage: "won",
          },
          {
            id: "at-end",
            createdAt: "2025-01-01T20:59:59.999Z",
            stage: "lost",
          },
          { id: "after", createdAt: "2025-01-01T21:00:00.000Z", stage: "new" },
        ],
        messages: [
          {
            id: "m1",
            direction: "inbound",
            createdAt: "2024-12-31T21:00:00.000Z",
          },
          {
            id: "m2",
            direction: "outbound",
            createdAt: "2025-01-01T21:00:00.000Z",
          },
        ],
        calls: [],
        tasks: [],
        activities: [],
        events: [],
      },
      { from: "2025-01-01", to: "2025-01-01" },
      new Date("2025-01-02T00:00:00.000Z"),
    );
    expect(report.metrics.find((item) => item.key === "newLeads")?.value).toBe(
      2,
    );
    expect(
      report.metrics.find((item) => item.key === "inboundMessages")?.value,
    ).toBe(1);
    expect(
      report.metrics.find((item) => item.key === "outboundMessages")?.value,
    ).toBe(0);
    expect(
      report.dataLimits.some((item) =>
        item.toLocaleLowerCase("tr-TR").includes("aşama değişikliği"),
      ),
    ).toBe(true);
  });
});
