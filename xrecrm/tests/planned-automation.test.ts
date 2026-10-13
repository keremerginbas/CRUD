import { stagePolicyStore } from "../server/crm-stage-policy";
import { it, expect, afterEach } from "vitest";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
const original = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in original)) delete process.env[k];
  Object.assign(process.env, original);
});
it("gelecek plan atomik saklanır; eski aşama girişi yeni girişte görev üretmeden atlanır", async () => {
  process.env.MANUS_PROJECT_ID = "planned-test";
  process.env.MANUS_JWT_SECRET = "planned-secret";
  process.env.XRE_OWNER_OPEN_ID = "planned-owner";
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "planned-owner" });
  const headers = {
    "content-type": "application/json",
    cookie: `webdev_app_session=${token}`,
  };
  const post = (path: string, body: any) =>
    fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    expect(
      (
        await post("/api/rules", {
          id: "planned-rule",
          name: "Ankara takip",
          triggerStage: "new",
          action: "task",
          enabled: true,
          config: { template: "Takip edin" },
          policy: {
            mode: "all",
            conditions: [{ field: "city", op: "eq", value: "Ankara" }],
            delayMinutes: 10,
            businessHours: false,
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post("/api/leads", {
          lead: {
            id: "planned-lead",
            name: "Test",
            phone: "+905550000001",
            city: "Ankara",
          },
        })
      ).status,
    ).toBe(201);
    const event = (await store.listEvents("planned-owner")).find(
      (e) => e.payload.type === "rule-action",
    )!;
    expect(
      Date.parse(event.nextAttemptAt!) -
        Date.parse(String(event.payload.transitionAt)),
    ).toBe(600000);
    expect(await processOutboxOnce(store)).toBe(0);
    const lead = (await store.get<any>(
      "lead",
      "planned-lead",
      "planned-owner",
    ))!.payload;
    const guarded = stagePolicyStore(store);
    await guarded.put(
      "lead",
      lead.id,
      { ...lead, stage: "contacted" },
      "planned-owner",
    );
    await guarded.put(
      "lead",
      lead.id,
      { ...lead, stage: "new" },
      "planned-owner",
    );
    await store.updateEvent(event.id, "planned-owner", {
      nextAttemptAt: new Date(0).toISOString(),
    });
    await processOutboxOnce(store);
    expect(await store.list("tasks", "planned-owner")).toHaveLength(0);
    expect(
      (await store.getEvent(event.id, "planned-owner"))?.payload.result,
    ).toMatchObject({ skipped: true });
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
it("bellek kuyruğu gelecek olayı claim etmez", async () => {
  const s = createMemoryStore();
  const event = await s.appendEvent(
    "o",
    "future",
    { type: "test" },
    "pending",
    "2099-01-01T00:00:00Z",
  );
  expect(event.event.nextAttemptAt).toBe("2099-01-01T00:00:00Z");
  expect(await s.claimDueEvents()).toHaveLength(0);
});
