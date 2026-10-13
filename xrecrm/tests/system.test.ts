import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { diffRecords } from "../server/audit";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID"]) delete process.env[k];
  process.env.XRE_SESSION_SECRET = "system-test-secret-0123456789abcdef";
  process.env.XRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "xre-sys-"));
});
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Kerem Sahip", email: "k@x.test", password: "Sahip12345" }) });
  const headers = { "content-type": "application/json", cookie: (setup.headers.get("set-cookie") || "").split(";")[0] };
  return { store, base, headers };
}
const stamp = new Date().toISOString();
const lead = { id: "lead-a", name: "Denetim Müşterisi", phone: "05553000011", email: "", company: "", stage: "new", owner: "Ali", value: 100, source: "Web", notes: "", createdAt: stamp, lastActivity: stamp, tags: [] };

describe("Denetim günlüğü ve aşama geçmişi", () => {
  it("değişiklikleri kişiyle birlikte kaydeder, gizli alanları maskeler", async () => {
    expect(diffRecords({ a: 1, passwordHash: "x", updatedAt: "1" }, { a: 2, passwordHash: "y", updatedAt: "2" })).toEqual([
      { field: "a", from: 1, to: 2 },
      { field: "passwordHash", from: "••••", to: "••••" },
    ]);
    const { base, headers } = await start();
    await fetch(`${base}/api/leads`, { method: "POST", headers, body: JSON.stringify({ lead }) });
    await fetch(`${base}/api/leads/lead-a`, { method: "PATCH", headers, body: JSON.stringify({ stage: "contacted", value: 250 }) });
    await fetch(`${base}/api/leads/lead-a`, { method: "PATCH", headers, body: JSON.stringify({ stage: "won" }) });
    const audit = await (await fetch(`${base}/api/audit?kind=lead`, { headers })).json();
    expect(audit.entries[0]).toMatchObject({ actor: "Kerem Sahip", action: "update", title: "Denetim Müşterisi" });
    expect(audit.entries.at(-1)).toMatchObject({ action: "create" });
    expect(audit.entries.some((e: any) => e.changes.some((c: any) => c.field === "value" && c.from === 100 && c.to === 250))).toBe(true);
    const accounts = await (await fetch(`${base}/api/audit?kind=local-account`, { headers })).json();
    expect(JSON.stringify(accounts)).not.toContain("scrypt$");
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.stageHistory.map((h: any) => `${h.from}>${h.to}`)).toEqual(expect.arrayContaining(["null>new", "new>contacted", "contacted>won"]));
  });
});

describe("Yedekleme", () => {
  it("yedek alır, listeler, indirir ve geri yükler", async () => {
    const { base, headers } = await start();
    await fetch(`${base}/api/leads`, { method: "POST", headers, body: JSON.stringify({ lead }) });
    const created = await fetch(`${base}/api/system/backups`, { method: "POST", headers, body: "{}" });
    expect(created.status).toBe(201);
    const { backup } = await created.json();
    await fetch(`${base}/api/leads/lead-a`, { method: "PATCH", headers, body: JSON.stringify({ name: "Değişti" }) });
    const download = await fetch(`${base}/api/system/backups/${backup.name}/download`, { headers });
    expect(download.headers.get("content-type")).toBe("application/gzip");
    expect((await fetch(`${base}/api/system/backups/${backup.name}/restore`, { method: "POST", headers, body: JSON.stringify({ confirm: "evet" }) })).status).toBe(400);
    const restored = await fetch(`${base}/api/system/backups/${backup.name}/restore`, { method: "POST", headers, body: JSON.stringify({ confirm: "GERİ YÜKLE" }) });
    expect(restored.status).toBe(200);
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.leads[0].name).toBe("Denetim Müşterisi");
    const list = await (await fetch(`${base}/api/system/backups`, { headers })).json();
    expect(list.backups.map((b: any) => b.reason)).toEqual(expect.arrayContaining(["elle", "oncesi"]));
    expect((await fetch(`${base}/api/system/backups/..%2Fsession-secret/download`, { headers })).status).toBe(400);
  });
});

describe("Canlı bildirimler", () => {
  it("cevapsız arama bildirimi açık oturuma ulaşır", async () => {
    const { store, base, headers } = await start();
    await fetch(`${base}/api/leads`, { method: "POST", headers, body: JSON.stringify({ lead }) });
    const hook = await (await fetch(`${base}/api/webhook-hub/inbound`, { method: "POST", headers, body: JSON.stringify({ name: "Santral", actions: ["call.log"] }) })).json();
    const got = new Promise<string>((resolve) => {
      const req = http.get(`${base}/api/pbx/stream`, { headers: { cookie: headers.cookie } }, (res) => {
        let text = "";
        res.on("data", (c) => {
          text += c;
          if (text.includes("event: notice")) {
            req.destroy();
            resolve(text);
          }
        });
      });
    });
    await new Promise((r) => setTimeout(r, 150));
    await fetch(`${base}/api/hooks/in/${hook.hook.id}/${hook.token}/call.log`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "05553000011", status: "no-answer", callId: "n1" }) });
    const text = await got;
    expect(JSON.parse(text.split("data: ").pop()!.split("\n")[0])).toMatchObject({ kind: "missed-call", leadId: "lead-a" });
    void store;
  });
});
