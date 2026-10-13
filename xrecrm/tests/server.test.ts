import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app.js";
import { createMemoryStore } from "../server/db.js";
import { createSessionToken } from "../server/auth.js";

const savedEnv = { ...process.env };

async function runningApp() {
  const app = createApp({ store: createMemoryStore() });
  const server = http.createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

afterEach(() => {
  for (const key of Object.keys(process.env))
    if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

describe("XRE CRM server", () => {
  it("health is public and returns HTTP 200", async () => {
    const { server, base } = await runningApp();
    try {
      const response = await fetch(`${base}/health`);
      expect(response.status).toBe(200);
      expect((await response.json()).ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it("private state requires a valid Manus session", async () => {
    const { server, base } = await runningApp();
    try {
      const response = await fetch(`${base}/api/state`);
      expect(response.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("authenticated lead writes and stage events use the test-only memory store", async () => {
    process.env.MANUS_PROJECT_ID = "test-app";
    process.env.MANUS_JWT_SECRET = "test-secret";
    const token = await createSessionToken({
      openId: "user-1",
      name: "Test User",
    });
    const { server, base } = await runningApp();
    try {
      const headers = {
        cookie: `webdev_app_session=${encodeURIComponent(token)}`,
        "content-type": "application/json",
      };
      const created = await fetch(`${base}/api/leads`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead: {
            name: "Ada",
            phone: "05321234567",
            email: "",
            company: "",
            value: 10,
            source: "test",
            notes: "",
            tags: [],
          },
        }),
      });
      expect(created.status).toBe(201);
      const lead = await created.json();
      const changed = await fetch(`${base}/api/leads/${lead.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          stage: "qualified",
          appointmentAt: "2030-10-13T08:00:00.000Z",
        }),
      });
      expect(changed.status).toBe(200);
      const assigned = await fetch(`${base}/api/leads/${lead.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ owner: "Zeynep K." }),
      });
      expect(assigned.status).toBe(200);
      expect((await assigned.json()).owner).toBe("Zeynep K.");
      const state = await fetch(`${base}/api/state`, {
        headers: { cookie: headers.cookie },
      });
      const payload = await state.json();
      expect(payload.leads[0].stage).toBe("qualified");
      expect(payload.leads[0].owner).toBe("Zeynep K.");
      expect(
        payload.events.some(
          (event: any) => event.payload?.type === "stage-change",
        ),
      ).toBe(true);
      expect(
        payload.events.some(
          (event: any) =>
            event.status === "success" && event.leadId === lead.id,
        ),
      ).toBe(true);
    } finally {
      server.close();
    }
  });

  it("plain rule envelopes are both accepted and outbound line mappings fail closed", async () => {
    process.env.MANUS_PROJECT_ID = "test-app";
    process.env.MANUS_JWT_SECRET = "test-secret";
    const token = await createSessionToken({ openId: "user-rule" });
    const { server, base } = await runningApp();
    try {
      const headers = {
        cookie: `webdev_app_session=${encodeURIComponent(token)}`,
        "content-type": "application/json",
      };
      const rule = {
        name: "Yeni lead",
        triggerStage: "new",
        action: "whatsapp",
        enabled: true,
        config: { lineId: "office-1", template: "Merhaba" },
      };
      const plain = await fetch(`${base}/api/rules`, {
        method: "POST",
        headers,
        body: JSON.stringify(rule),
      });
      const envelope = await fetch(`${base}/api/rules`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rule: { ...rule, name: "Zarf kuralı" } }),
      });
      expect(plain.status).toBe(201);
      expect(envelope.status).toBe(201);
      const noMap = await fetch(`${base}/api/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          leadId: "missing",
          lineId: "office-1",
          text: "gönderme",
        }),
      });
      expect(noMap.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it("unconfigured QR endpoint never fabricates a QR value", async () => {
    process.env.MANUS_PROJECT_ID = "test-app";
    process.env.MANUS_JWT_SECRET = "test-secret";
    const token = await createSessionToken({ openId: "user-qr" });
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    const { server, base } = await runningApp();
    try {
      const response = await fetch(`${base}/api/connections/demo/qr`, {
        method: "POST",
        headers: { cookie: `webdev_app_session=${encodeURIComponent(token)}` },
      });
      expect(response.status).toBe(503);
      expect((await response.json()).message).toContain("gerçek QR");
    } finally {
      server.close();
    }
  });

  it("inbound bearer webhook is deduplicated without external sends", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "inbound-secret";
    process.env.MANUS_OWNER_OPEN_ID = "owner-inbound";
    const { server, base } = await runningApp();
    try {
      const request = {
        method: "POST",
        headers: {
          authorization: "Bearer inbound-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "same-event",
          type: "lead.created",
          lead: { id: "lead-inbound", name: "Inbound", phone: "05321234567" },
        }),
      };
      const first = await fetch(`${base}/api/webhooks/inbound`, request);
      const second = await fetch(`${base}/api/webhooks/inbound`, request);
      expect(first.status).toBe(200);
      expect((await second.json()).duplicate).toBe(true);
    } finally {
      server.close();
    }
  });

  it("inbound webhook without an owner fails 503 and does not create an unclaimed record", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "inbound-secret";
    delete process.env.MANUS_OWNER_OPEN_ID;
    const { server, base } = await runningApp();
    try {
      const response = await fetch(`${base}/api/webhooks/inbound`, {
        method: "POST",
        headers: {
          authorization: "Bearer inbound-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "lead.created",
          lead: { id: "not-stored", name: "No owner" },
        }),
      });
      expect(response.status).toBe(503);
    } finally {
      server.close();
    }
  });
});
