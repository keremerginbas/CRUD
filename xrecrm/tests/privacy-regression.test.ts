import { it, expect, afterEach } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
const env = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
});
it("CRM state sağlayıcı içeriği ve ham webhook verisini tarayıcıya taşımaz", async () => {
  process.env.MANUS_PROJECT_ID = "privacy-test";
  process.env.MANUS_JWT_SECRET = "privacy-test-secret";
  process.env.XRE_OWNER_OPEN_ID = "privacy-owner";
  const store = createMemoryStore();
  await store.put(
    "message",
    "message1",
    {
      id: "message1",
      leadId: "lead1",
      text: "Merhaba",
      direction: "inbound",
      providerResult: { secret: "PRIVATE" },
      payload: { apiKey: "PRIVATE" },
    },
    "privacy-owner",
  );
  await store.put(
    "call",
    "call1",
    {
      id: "call1",
      leadId: "lead1",
      summary: "Özet",
      providerResult: { apiKey: "PRIVATE" },
      payload: { secret: "PRIVATE" },
    },
    "privacy-owner",
  );
  await store.put(
    "connection",
    "connection1",
    { id: "connection1", state: "open", status: "connected", qr: "PRIVATE" },
    "privacy-owner",
  );
  await store.appendEvent(
    "privacy-owner",
    "private-key",
    {
      type: "webhook",
      provider: "n8n",
      payload: { secret: "PRIVATE" },
      config: { apiKey: "PRIVATE" },
    },
    "completed",
  );
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const token = await createSessionToken({ openId: "privacy-owner" });
    const r = await fetch(
      `http://127.0.0.1:${(server.address() as any).port}/api/state`,
      { headers: { cookie: `webdev_app_session=${token}` } },
    );
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(JSON.stringify(d)).not.toContain("PRIVATE");
    expect(d.calls[0].summary).toBe("Özet");
    expect(d.messages[0].text).toBe("Merhaba");
    expect(d.events[0].payload).toEqual({ type: "webhook", provider: "n8n" });
  } finally {
    server.close();
  }
});
it("kesilmiş processing işi otomatik çift göndermek yerine incelemeye alır", async () => {
  const store = createMemoryStore();
  const saved = await store.appendEvent(
    "owner",
    "crash",
    { type: "n8n-delivery" },
    "pending",
  );
  expect(await store.claimDueEvents()).toHaveLength(1);
  (store as any).events.get(saved.event.id).updatedAt = new Date(
    Date.now() - 660000,
  ).toISOString();
  expect(await store.claimDueEvents()).toHaveLength(0);
  expect(await store.getEvent(saved.event.id, "owner")).toMatchObject({
    status: "needs_review",
    attempts: 5,
  });
});
