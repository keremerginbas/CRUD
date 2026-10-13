import { beforeEach, afterEach, it, expect, describe, vi } from "vitest";
import type { Server } from "node:http";
import { createMemoryStore } from "../server/db";
import { createApp, processOutboxOnce } from "../server/app";
import { createSessionToken } from "../server/auth";
import { defaultRole } from "../shared/access";
const original = { ...process.env };
let store: ReturnType<typeof createMemoryStore>;
let ownerToken: string;
let memberToken: string;
let server: Server;
let url: string;
beforeEach(async () => {
  process.env.MANUS_PROJECT_ID = "rbac-api-test";
  process.env.MANUS_JWT_SECRET = "test-only-rbac-secret";
  delete process.env.XRE_OWNER_OPEN_ID;
  delete process.env.MANUS_OWNER_OPEN_ID;
  store = createMemoryStore();
  await store.claimOwner({ openId: "o", name: "Sahip" });
  ownerToken = await createSessionToken({ openId: "o", name: "Sahip" });
  memberToken = await createSessionToken({
    openId: "m",
    name: "Other spoofed name",
  });
  await store.put(
    "employee",
    "e",
    {
      id: "e",
      openId: "m",
      name: "Satış",
      active: true,
      roleId: "sales",
      departmentId: "d",
      title: "",
      phone: "",
      email: "",
    },
    "o",
  );
  for (const [id, own] of [
    ["mine", "Satış"],
    ["other", "Other spoofed name"],
  ])
    await store.put(
      "lead",
      id,
      {
        id,
        name: id,
        phone: "",
        email: "",
        company: "",
        owner: own,
        stage: "new",
        value: 0,
        source: "manual",
        notes: "",
        tags: [],
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
      "o",
    );
  server = await new Promise<Server>((r) => {
    const s = createApp({ store }).listen(0, "127.0.0.1", () => r(s));
  });
  url = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  for (const k of Object.keys(process.env))
    if (!(k in original)) delete process.env[k];
  Object.assign(process.env, original);
});
const realFetch = globalThis.fetch;
async function api(
  method: string,
  path: string,
  token = memberToken,
  data?: unknown,
) {
  return realFetch(url + path, {
    method,
    headers: {
      Cookie: `webdev_app_session=${token}`,
      "Content-Type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
describe("CRM API rol sınırı", () => {
  it("yetkili satış rolü sadece atanmış kaydı görür, JWT adı diğer kayıtları açmaz", async () => {
    const state = await api("GET", "/api/state");
    expect(state.status).toBe(200);
    expect((await state.json()).leads.map((l: any) => l.id)).toEqual(["mine"]);
    expect(
      (
        await api("PATCH", "/api/leads/other", memberToken, {
          notes: "unauthorized",
        })
      ).status,
    ).toBe(404);
  });
  it("rol izin değişikliği anında arama ve mesai yazımını durdurur", async () => {
    const role = defaultRole("sales")!;
    role.grants.calls.write = false;
    role.grants.worktime.write = false;
    await store.put("role", "sales", role, "o");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(
      (
        await api("POST", "/api/calls", memberToken, {
          leadId: "mine",
          lineId: "x",
        })
      ).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
    expect(
      (
        await api("POST", "/api/worktime/transition", memberToken, {
          action: "start",
          operationId: "op-test",
        })
      ).status,
    ).toBe(403);
  });
  it("sahip dışı rol değişikliği reddedilir ve pasif hesap mevcut JWT ile de giremez", async () => {
    expect(
      (
        await api(
          "PUT",
          "/api/access/roles/sales",
          memberToken,
          defaultRole("sales"),
        )
      ).status,
    ).toBe(403);
    await store.put(
      "employee",
      "e",
      { id: "e", openId: "m", name: "Satış", active: false, roleId: "sales" },
      "o",
    );
    expect((await api("GET", "/api/state")).status).toBe(401);
    expect((await api("GET", "/api/state", ownerToken)).status).toBe(200);
  });
  it("sahibin rolü kilitli, özel departman döngüsü reddedilir", async () => {
    expect(
      (
        await api(
          "PUT",
          "/api/access/roles/owner",
          ownerToken,
          defaultRole("sales"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api("POST", "/api/access/departments", ownerToken, {
          id: "cycle",
          name: "Döngü",
          parentId: "cycle",
        })
      ).status,
    ).toBe(400);
  });
  it("AI sohbetindeki dateRange rapor izni gerektirir ve provider çağrılmaz", async () => {
    const role = defaultRole("sales")!;
    role.grants.reports.read = false;
    await store.put("role", "sales", role, "o");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(
      (
        await api("POST", "/api/assistant/chat", memberToken, {
          message: "kaç arama?",
          history: [],
          context: { path: "/ai" },
          dateRange: { from: "2026-10-13", to: "2026-10-13" },
        })
      ).status,
    ).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
  it("geçmiş gün start işlemi reddedilir", async () => {
    expect(
      (
        await api("POST", "/api/worktime/transition", memberToken, {
          action: "start",
          operationId: "past-day-operation",
          day: "2020-01-01",
        })
      ).status,
    ).toBe(400);
  });
  it("kuyruk işçisi aktörün kaldırılmış dış iletişim yetkisini yeniden doğrular", async () => {
    const role = defaultRole("sales")!;
    role.grants.calls.write = false;
    await store.put("role", "sales", role, "o");
    const event = await store.appendEvent(
      "o",
      "actor-sideeffect",
      {
        type: "rule-action",
        actorOpenId: "m",
        action: "vapi",
        leadId: "mine",
        config: {},
      },
      "pending",
    );
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await processOutboxOnce(store);
    expect(spy).not.toHaveBeenCalled();
    const done = await store.getEvent(event.event.id, "o");
    expect(done?.status).toBe("failed");
    expect(done?.lastError).toContain("yetkisi yok");
  });
  it("satışın CRM statüsü görev kuralını tetikler; kural düzenleme izni şart değildir", async () => {
    await store.put(
      "rule",
      "rule-task",
      {
        id: "rule-task",
        name: "Takip",
        enabled: true,
        triggerStage: "contacted",
        action: "task",
        config: { title: "Müşteriyi takip et" },
      },
      "o",
    );
    const r = await api("PATCH", "/api/leads/mine", memberToken, {
      stage: "contacted",
    });
    expect(r.status).toBe(200);
    const events = await store.listEvents("o");
    expect(
      events.some(
        (e) =>
          e.payload.type === "rule-action" && e.payload.actorOpenId === "m",
      ),
    ).toBe(true);
    await processOutboxOnce(store);
    expect(await store.list("tasks", "o")).toHaveLength(1);
  });
});
