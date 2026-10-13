import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
const env = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
});
describe("Statü otomasyonları", () => {
  it("yeni müşteri kuralını tek kez kuyruğa alır ve görev çıktısını saklar", async () => {
    process.env.MANUS_PROJECT_ID = "automation-test";
    process.env.MANUS_JWT_SECRET = "automation-secret";
    process.env.XRE_OWNER_OPEN_ID = "test-owner";
    const store = createMemoryStore();
    const server = http.createServer(createApp({ store }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const token = await createSessionToken({ openId: "test-owner" });
    const headers = {
      cookie: `webdev_app_session=${token}`,
      "content-type": "application/json",
    };
    try {
      await fetch(base + "/api/rules", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "task-rule",
          name: "Yeni müşteri takibi",
          triggerStage: "new",
          action: "task",
          enabled: true,
          config: { template: "Müşteriyi ara" },
        }),
      });
      const create = await fetch(base + "/api/leads", {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead: {
            id: "new-lead",
            name: "Görev Müşterisi",
            phone: "+905550001122",
          },
        }),
      });
      expect(create.status).toBe(201);
      let events = await store.listEvents("test-owner");
      expect(
        events.filter((e) => e.payload.type === "rule-action"),
      ).toHaveLength(1);
      expect(events[0].status).toBe("pending");
      expect(await processOutboxOnce(store)).toBe(1);
      events = await store.listEvents("test-owner");
      expect(events[0].status).toBe("completed");
      expect((events[0].payload.result as any).activity).toBe("task");
      expect(await processOutboxOnce(store)).toBe(0);
      const duplicate = await fetch(base + "/api/leads", {
        method: "POST",
        headers,
        body: JSON.stringify({ lead: { id: "new-lead", name: "Duplicate" } }),
      });
      expect(duplicate.status).toBe(409);
    } finally {
      server.close();
    }
  });
});
