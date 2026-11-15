import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";

const saved = { ...process.env };
const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("/api/state — değişmeyen veri yeniden gönderilmez", () => {
  it("aynı etiketle 204 döner; veri değişince tam yanıt verir; hareketler sınırlıdır", async () => {
    process.env.MANUS_PROJECT_ID = "state-test";
    process.env.MANUS_JWT_SECRET = "test-only-state-secret";
    const store = createMemoryStore();
    await store.claimOwner({ openId: "o", name: "Sahip" });
    const now = new Date().toISOString();
    const lead = (id: string) => ({ id, name: id, phone: "", email: "", company: "", owner: "Sahip", stage: "new", value: 0, source: "manual", notes: "", tags: [], createdAt: now, lastActivity: now });
    await store.put("lead", "l1", lead("l1"), "o");
    for (let i = 0; i < 1200; i++) await store.appendEvent("o", `e${i}`, { type: "lead.created", leadId: "l1", title: "t", detail: "d" }, "completed");
    // Dizin: listeleme yalnız ilgili tür ve sahibin kayıtlarını döndürür, silineni döndürmez.
    await store.put("lead", "x", lead("x"), "baska");
    await store.put("lead", "l2", lead("l2"), "o");
    await store.delete("lead", "l2", "o");
    expect((await store.list("lead", "o")).map((r) => r.id)).toEqual(["l1"]);
    expect((await store.appendEvent("o", "e5", {}, "completed")).inserted).toBe(false);

    const server = http.createServer(createApp({ store }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const cookie = `webdev_app_session=${await createSessionToken({ openId: "o", name: "Sahip" })}`;
    const get = (tag?: string) => fetch(`${base}/api/state`, { headers: { cookie, ...(tag ? { "x-xre-state": tag } : {}) } });

    const first = await get();
    expect(first.status).toBe(200);
    const tag = first.headers.get("x-xre-state")!;
    const body = await first.json();
    expect(body.leads).toHaveLength(1);
    expect(body.events).toHaveLength(1000);
    expect((await get(tag)).status).toBe(204);
    await store.put("lead", "l3", lead("l3"), "o");
    const changed = await get(tag);
    expect(changed.status).toBe(200);
    expect(changed.headers.get("x-xre-state")).not.toBe(tag);
    expect((await changed.json()).leads).toHaveLength(2);
  });
});
