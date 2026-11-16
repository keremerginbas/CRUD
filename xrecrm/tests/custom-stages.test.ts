import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { newStageId, stageListProblem, isStageId } from "../shared/stages";

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

const BASE = [
  { id: "new", label: "Yeni fırsat", color: "#38bdf8" },
  { id: "contacted", label: "İlk görüşme", color: "#60a5fa" },
  { id: "qualified", label: "Portföy sunumu", color: "#a28beb" },
  { id: "proposal", label: "Teklif", color: "#f3b743" },
  { id: "won", label: "Kazanıldı", color: "#22c55e" },
  { id: "lost", label: "Kaybedildi", color: "#ef4444" },
];

describe("özel satış aşamaları", () => {
  it("aşama kimliği ve liste kuralları", () => {
    expect(isStageId(newStageId())).toBe(true);
    expect(isStageId("s_ab")).toBe(false);
    expect(isStageId("herhangi")).toBe(false);
    expect(stageListProblem(BASE)).toBeNull();
    expect(stageListProblem(BASE.filter((s) => s.id !== "won"))).toMatch(/silinemez/);
    expect(stageListProblem([...BASE, BASE[0]])).toMatch(/iki kez/);
  });

  it("huniye yeni aşama eklenir, müşteri o aşamaya taşınır; içinde müşteri olan aşama kaldırılamaz", async () => {
    process.env.MANUS_PROJECT_ID = "stage-test";
    process.env.MANUS_JWT_SECRET = "test-only-stage-secret";
    const store = createMemoryStore();
    await store.claimOwner({ openId: "o", name: "Sahip" });
    const server = http.createServer(createApp({ store }));
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const cookie = `webdev_app_session=${await createSessionToken({ openId: "o", name: "Sahip" })}`;
    const call = (method: string, url: string, body?: unknown) => fetch(`${base}${url}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const now = new Date().toISOString();
    const custom = "s_randevu01";
    const pipeline = (stages: unknown[]) => ({ id: "sales", name: "Satış", stages, createdAt: now, updatedAt: now });
    const withCustom = [BASE[0], BASE[1], { id: custom, label: "Tapu bekleniyor", color: "#f472b6" }, ...BASE.slice(2)];

    const lead = { id: "l1", name: "Ali Veli", phone: "+90 532 111 22 33", email: "", company: "", stage: "new", owner: "Sahip", value: 0, source: "Manuel", notes: "", tags: [], createdAt: now, lastActivity: now };
    expect((await call("POST", "/api/leads", { lead })).status).toBe(201);
    // Hunide olmayan aşamaya taşınamaz.
    expect((await call("PATCH", "/api/leads/l1", { stage: custom })).status).toBe(400);
    expect((await call("PATCH", "/api/leads/l1", { stage: "uydurma" })).status).toBe(400);

    const created = await call("POST", "/api/pipelines", pipeline(withCustom));
    expect(created.status).toBeLessThan(300);
    expect((await call("PATCH", "/api/leads/l1", { stage: custom })).status).toBe(200);
    const state = await (await call("GET", "/api/state")).json();
    expect(state.leads[0].stage).toBe(custom);
    expect(state.pipelines[0].stages.map((s: { id: string }) => s.id)).toEqual(["new", "contacted", custom, "qualified", "proposal", "won", "lost"]);

    // İçinde müşteri varken aşama kaldırılamaz; yerleşik aşama hiç kaldırılamaz.
    expect((await call("PATCH", "/api/pipelines/sales", pipeline(BASE))).status).toBe(409);
    expect((await call("PATCH", "/api/pipelines/sales", pipeline(withCustom.filter((s) => s.id !== "lost")))).status).toBe(400);
    expect((await call("PATCH", "/api/leads/l1", { stage: "contacted" })).status).toBe(200);
    expect((await call("PATCH", "/api/pipelines/sales", pipeline(BASE))).status).toBeLessThan(300);
  });
});
