import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { resetLiveClients } from "../server/live";

const saved = { ...process.env };
const servers: http.Server[] = [];
afterEach(() => {
  resetLiveClients();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Akışı açar ve gelen metni biriktirir. */
function listen(base: string, cookie: string) {
  const state = { text: "", status: 0 };
  const req = http.get(`${base}/api/live`, { headers: { cookie } }, (res) => {
    state.status = res.statusCode || 0;
    res.setEncoding("utf8");
    res.on("data", (chunk) => (state.text += chunk));
  });
  req.on("error", () => undefined);
  return { state, close: () => req.destroy() };
}

describe("canlı güncelleme akışı", () => {
  it("veri değişince yalnız o çalışma alanının oturumlarına haber gider; oturumsuz erişilemez", async () => {
    process.env.MANUS_PROJECT_ID = "live-test";
    process.env.MANUS_JWT_SECRET = "test-only-live-secret";
    const store = createMemoryStore();
    await store.claimOwner({ openId: "o", name: "Sahip" });
    const server = http.createServer(createApp({ store }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const cookie = `webdev_app_session=${await createSessionToken({ openId: "o", name: "Sahip" })}`;

    expect((await fetch(`${base}/api/live`)).status).toBe(401);
    const stream = listen(base, cookie);
    await wait(150);
    expect(stream.state.status).toBe(200);
    expect(stream.state.text).not.toContain("event: changed");

    const now = new Date().toISOString();
    const lead = { id: "l1", name: "Ali", phone: "", email: "", company: "", owner: "Sahip", stage: "new", value: 0, source: "manual", notes: "", tags: [], createdAt: now, lastActivity: now };
    // Başka çalışma alanındaki değişiklik ve durum ekranında görünmeyen tür haber üretmez.
    await store.put("lead", "x", lead, "baska-alan");
    await store.put("audit", "a1", { any: 1 }, "o");
    await wait(600);
    expect(stream.state.text).not.toContain("event: changed");

    // Art arda üç değişiklik tek haber olarak gelir.
    await store.put("lead", "l1", lead, "o");
    await store.put("lead", "l2", { ...lead, id: "l2" }, "o");
    await store.delete("lead", "l2", "o");
    await wait(600);
    expect(stream.state.text.match(/event: changed/g)).toHaveLength(1);
    stream.close();
  });
});
