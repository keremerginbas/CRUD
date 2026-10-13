import { afterEach, describe, it, expect, vi } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import * as integrations from "../server/integrations";
import { stages } from "../client/src/workspace/data";
const env = { ...process.env };
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env))
    if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
});
async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    store,
    server,
    base: `http://127.0.0.1:${(server.address() as any).port}`,
  };
}
describe("Bağımsız inceleme regresyonları", () => {
  it("QR yanıtını frontend beklediği base64 alanında döndürür", async () => {
    process.env.MANUS_PROJECT_ID = "qr-regression";
    process.env.MANUS_JWT_SECRET = "test-secret";
    process.env.XRE_OWNER_OPEN_ID = "owner";
    process.env.EVOLUTION_API_URL = "https://example.com";
    process.env.EVOLUTION_API_KEY = "test-only";
    vi.spyOn(integrations, "getEvolutionQr").mockResolvedValue(
      "data:image/png;base64,TEST_FIXTURE_ONLY",
    );
    const { server, base } = await start();
    const token = await createSessionToken({ openId: "owner" });
    try {
      const r = await fetch(base + "/api/connections/office-1/qr", {
        method: "POST",
        headers: { cookie: `webdev_app_session=${token}` },
      });
      expect(r.status).toBe(200);
      expect((await r.json()).base64).toBe(
        "data:image/png;base64,TEST_FIXTURE_ONLY",
      );
    } finally {
      server.close();
    }
  });
  it("işlenemeyen inbound olayı failed ve hata ayrıntısıyla saklar", async () => {
    process.env.INBOUND_WEBHOOK_SECRET = "test-secret";
    process.env.XRE_OWNER_OPEN_ID = "owner";
    const { server, base, store } = await start();
    try {
      await fetch(base + "/api/webhooks/inbound", {
        method: "POST",
        headers: {
          authorization: "Bearer test-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventId: "invalid1",
          type: "lead.updated",
          lead: { id: "does-not-exist", name: "No customer" },
        }),
      });
      const events = await store.listEvents("owner");
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe("failed");
      expect(events[0].lastError).toContain("bulunamadı");
    } finally {
      server.close();
    }
  });
  it("kaybedildi aşaması Kanban ve otomasyonun ortak kaynağında vardır", () => {
    expect(stages.some((s) => s.id === "lost")).toBe(true);
    expect(stages).toHaveLength(6);
  });
});
