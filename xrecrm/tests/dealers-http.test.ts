import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { resetSignupAttempts } from "../server/workspaces";
import { DEALER_REG_KIND, type DealerRegistration } from "../shared/dealers";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let dataDir = "";
beforeEach(async () => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "XRE_SESSION_SECRET"])
    delete process.env[key];
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xre-dealers-test-"));
  process.env.XRE_DATA_DIR = dataDir;
  resetSignupAttempts();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await fs.rm(dataDir, { recursive: true, force: true });
});

type Call = (method: string, path: string, body?: unknown) => Promise<Response>;

describe("Bayi sistemi — 60 gün koruma ve ana bayiye devir", () => {
  it("D kaydeder, E kaydedemez; süre dolunca kayıt ve müşteri ana bayiye geçer, kimse yeniden kaydedemez", async () => {
    process.env.MANUS_PROJECT_ID = "dealers-test";
    process.env.MANUS_JWT_SECRET = "test-only-dealers-secret";
    const store = createMemoryStore();
    await store.claimOwner({ openId: "o", name: "Sahip" });
    const employee = (openId: string, name: string) => store.put("employee", `e-${openId}`, { id: `e-${openId}`, openId, name, active: true, roleId: "sales", departmentId: "d", title: "", phone: "", email: "" }, "o");
    await employee("a", "Ana Bayi Danışmanı");
    await employee("d", "D Bayi Danışmanı");
    await employee("e", "E Bayi Danışmanı");
    const lead = (id: string, owner: string, phone: string) =>
      store.put("lead", id, { id, name: "Ali Veli", phone, email: "", company: "", owner, stage: "new", value: 0, source: "manual", notes: "", tags: [], createdAt: new Date().toISOString(), lastActivity: new Date().toISOString() }, "o");
    await lead("lead-d", "D Bayi Danışmanı", "+90 555 111 22 33");
    await lead("lead-e", "E Bayi Danışmanı", "0555 111 22 33");
    const server = http.createServer(createApp({ store }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const session = async (openId: string, name: string): Promise<Call> => {
      const cookie = `webdev_app_session=${await createSessionToken({ openId, name })}`;
      return (method, url, body) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    };
    const owner = await session("o", "Sahip");
    const d = await session("d", "D Bayi Danışmanı");
    const e = await session("e", "E Bayi Danışmanı");
    for (const [id, name] of [["p1", "Örnek Konutları"], ["p2", "Başka Proje"]]) expect((await owner("POST", "/api/projects", { id, name, city: "İstanbul", district: "Kartal" })).status).toBe(201);

    // Bayileri yalnız yönetici kurar.
    expect((await d("POST", "/api/dealers", { id: "A", name: "A Bayi", main: true, members: ["a"] })).status).toBe(403);
    expect((await owner("POST", "/api/dealers", { id: "A", name: "A Bayi", main: true, members: ["a"] })).status).toBe(201);
    expect((await owner("POST", "/api/dealers", { id: "D", name: "D Bayi", members: ["d"] })).status).toBe(201);
    expect((await owner("POST", "/api/dealers", { id: "E", name: "E Bayi", members: ["e"] })).status).toBe(201);

    const reg = await d("POST", "/api/dealers/registrations", { leadId: "lead-d", projectId: "p1" });
    expect(reg.status).toBe(201);
    expect((await reg.json()).registration).toMatchObject({ dealerId: "D", status: "aktif", phoneKey: "5551112233" });
    // E aynı müşteriyi (farklı yazılmış aynı telefon) aynı projeye kaydedemez; başka projeye kaydedebilir.
    const blocked = await e("POST", "/api/dealers/registrations", { leadId: "lead-e", projectId: "p1" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).message).toContain("daha önce kayıtlı");
    expect((await e("POST", "/api/dealers/registrations", { leadId: "lead-e", projectId: "p2" })).status).toBe(201);
    // E, D'nin kaydını listede görmez; D kendi kaydını görür.
    const eView = await (await e("GET", "/api/dealers")).json();
    expect(eView.registrations.map((r: DealerRegistration) => r.projectId)).toEqual(["p2"]);
    expect(eView.myDealerId).toBe("E");
    expect((await (await d("GET", "/api/dealers")).json()).registrations).toHaveLength(1);

    // 61 gün geçti: koruma bitti, satış yok.
    const row = (await store.get<DealerRegistration>(DEALER_REG_KIND, "p1:5551112233", "o"))!.payload;
    await store.put(DEALER_REG_KIND, row.id, { ...row, protectedUntil: "2020-01-01" }, "o");
    const after = await (await owner("GET", "/api/dealers")).json();
    expect(after.registrations.find((r: DealerRegistration) => r.id === row.id)).toMatchObject({ status: "ana bayiye devredildi", dealerId: "A", originalDealerId: "D" });
    expect((await store.get<any>("lead", "lead-d", "o"))!.payload.owner).toBe("Ana Bayi Danışmanı");
    for (const [as, leadId] of [[e, "lead-e"], [d, "lead-d"]] as const) {
      const again = await as("POST", "/api/dealers/registrations", { leadId, projectId: "p1" });
      expect([404, 409]).toContain(again.status);
    }
    const eAgain = await e("POST", "/api/dealers/registrations", { leadId: "lead-e", projectId: "p1" });
    expect((await eAgain.json()).message).toContain("ana bayiye devredildi");
    // Ana bayi silinemez; kaydı olan bayi silinemez.
    expect((await owner("DELETE", "/api/dealers/A")).status).toBe(409);
    expect((await owner("DELETE", "/api/dealers/D")).status).toBe(409);
  });
});
