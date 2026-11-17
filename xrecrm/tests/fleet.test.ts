import http from "node:http";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { collectHeartbeat, installProblems, runFleetAlerts, sendHeartbeat } from "../server/fleet";
import { setTelegramSender } from "../server/telegram";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let sent: string[] = [];
beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "XRE_PANEL", "PANEL_URL", "PANEL_KEY", "PUBLIC_ORIGIN"]) delete process.env[key];
  process.env.XRE_SESSION_SECRET = "fleet-test-secret-0123456789abcdef";
  sent = [];
  setTelegramSender(async (_chat, text) => void sent.push(text));
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  setTelegramSender(null);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Panel Sahibi", email: "sahip@xre.test", password: "Guvenli-4321" }) });
  expect(setup.status).toBe(201);
  const cookie = (setup.headers.get("set-cookie") || "").split(";")[0];
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { cookie }) =>
    fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { store, base, call };
}
const beat = { version: "abc1234", commitDate: "2026-11-16T10:00:00+03:00", users: 4, activeUsers7d: 3, leads: 5045, lastBackupAt: new Date().toISOString(), disk: { totalBytes: 100, freeBytes: 60 }, whatsappLines: { total: 2, connected: 1 } };

it("panel kapalıyken uçlar çalışmaz; kenar çubuğu 'kapalı' görür", async () => {
  const { call } = await start();
  expect(await (await call("GET", "/api/fleet")).json()).toEqual({ enabled: false });
  expect((await call("GET", "/api/fleet/installs")).status).toBe(404);
  expect((await call("POST", "/api/webhooks/fleet", beat, { authorization: "Bearer k-000000000000.x" })).status).toBe(404);
});

it("kurulum eklenir, anahtarıyla durum bildirir, sorunlar hesaplanır ve uyarı günde bir kez gider", async () => {
  process.env.XRE_PANEL = "1";
  process.env.PUBLIC_ORIGIN = "https://panel.example.test";
  const { store, call } = await start();
  expect(await (await call("GET", "/api/fleet")).json()).toEqual({ enabled: true });
  expect((await call("POST", "/api/fleet/installs", { name: "A" })).status).toBe(400);
  const created = await (await call("POST", "/api/fleet/installs", { name: "Örnek Gayrimenkul", domain: "ornek.example.test", licenseEnd: "2099-01-01" })).json();
  expect(created.key).toMatch(/^k-[0-9a-f]{12}\.[0-9a-f]{64}$/);
  expect(created.panelUrl).toBe("https://panel.example.test");
  expect(JSON.stringify(created.install)).not.toContain("keyHash");
  const id = created.install.id;
  let list = await (await call("GET", "/api/fleet/installs")).json();
  expect(list.installs[0]).toMatchObject({ id, lastSeenAt: null, problems: ["never"] });
  expect(JSON.stringify(list)).not.toContain(created.key.split(".")[1]);

  // Yanlış anahtar, bozuk kimlik ve izin verilmeyen alan reddedilir.
  const hook = (body: unknown, token: string) => call("POST", "/api/webhooks/fleet", body, { authorization: `Bearer ${token}` });
  expect((await hook(beat, `${id}.${"0".repeat(64)}`)).status).toBe(401);
  expect((await hook(beat, "k-ffffffffffff." + created.key.split(".")[1])).status).toBe(401);
  expect((await hook(beat, "")).status).toBe(401);
  expect((await hook({ ...beat, leadNames: ["Ayşe"] }, created.key)).status).toBe(400);
  expect((await hook(beat, created.key)).status).toBe(200);
  list = await (await call("GET", "/api/fleet/installs")).json();
  expect(list.installs[0]).toMatchObject({ problems: [], status: { leads: 5045, users: 4, version: "abc1234" } });
  expect(list.installs[0].lastSeenAt).toBeTruthy();

  // Anahtar yenilenince eskisi geçersiz olur.
  const rotated = await (await call("POST", `/api/fleet/installs/${id}/key`, {})).json();
  expect((await hook(beat, created.key)).status).toBe(401);
  expect((await hook({ ...beat, disk: { totalBytes: 100, freeBytes: 5 }, lastBackupAt: null }, rotated.key)).status).toBe(200);
  list = await (await call("GET", "/api/fleet/installs")).json();
  expect(list.installs[0].problems).toEqual(["backup", "disk"]);

  // Düzenleme anahtarı ve durumu korur; lisans yaklaşınca sorun olarak görünür.
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  expect((await call("PUT", `/api/fleet/installs/${id}`, { name: "Örnek Gayrimenkul A.Ş.", licenseEnd: soon })).status).toBe(200);
  list = await (await call("GET", "/api/fleet/installs")).json();
  expect(list.installs[0]).toMatchObject({ name: "Örnek Gayrimenkul A.Ş.", problems: ["backup", "disk", "license-soon"] });
  expect(list.installs[0].status.disk.freeBytes).toBe(5);

  process.env.TELEGRAM_CHAT_ID = "-1001";
  expect((await runFleetAlerts(store)).sort()).toEqual([`${id}:backup`, `${id}:disk`, `${id}:license-soon`]);
  expect(await runFleetAlerts(store)).toEqual([]);
  expect(sent.join("\n")).toContain("Örnek Gayrimenkul A.Ş.</b> diski dolmak üzere");

  expect((await call("DELETE", `/api/fleet/installs/${id}`, {})).status).toBe(200);
  expect((await (await call("GET", "/api/fleet/installs")).json()).installs).toEqual([]);
});

it("çevrimdışı ve lisansı dolan kurulum doğru işaretlenir", () => {
  const now = Date.parse("2026-11-17T12:00:00+03:00");
  const fresh = new Date(now - 60_000).toISOString();
  const ok = { ...beat, lastBackupAt: fresh };
  expect(installProblems({ lastSeenAt: fresh, status: ok, licenseEnd: null }, now)).toEqual([]);
  expect(installProblems({ lastSeenAt: new Date(now - 25 * 60_000).toISOString(), status: ok, licenseEnd: null }, now)).toEqual(["offline"]);
  expect(installProblems({ lastSeenAt: fresh, status: ok, licenseEnd: "2026-11-16" }, now)).toEqual(["license-expired"]);
  expect(installProblems({ lastSeenAt: fresh, status: ok, licenseEnd: "2026-11-17" }, now)).toEqual(["license-soon"]);
  expect(installProblems({ lastSeenAt: null, status: null, licenseEnd: null }, now)).toEqual(["never"]);
});

it("kurulum panele yalnız sayı ve teknik bilgi gönderir; müşteri verisi göndermez", async () => {
  process.env.XRE_PANEL = "1";
  const { store, base, call } = await start();
  const created = await (await call("POST", "/api/fleet/installs", { name: "Kendisi" })).json();
  await call("POST", "/api/system/test-data", { count: 3 });
  const body = await collectHeartbeat(store);
  expect(body).toMatchObject({ leads: 3, users: 1 });
  const text = JSON.stringify(body);
  for (const lead of await store.list<{ name: string; phone: string }>("lead", (await store.resolveOwner())!)) {
    expect(text).not.toContain(lead.payload.name);
    expect(text).not.toContain(lead.payload.phone);
  }
  expect(text).not.toContain("sahip@xre.test");
  // Ayar yokken bildirim denenmez; ayar girilince panel kabul eder.
  expect((await sendHeartbeat(store)).ok).toBe(false);
  process.env.OUTBOUND_ALLOW_PRIVATE_HOSTS = "127.0.0.1";
  process.env.PANEL_URL = base;
  process.env.PANEL_KEY = created.key;
  expect(await sendHeartbeat(store)).toEqual({ ok: true, message: "Durum yönetim paneline bildirildi." });
  process.env.PANEL_KEY = created.key.slice(0, -1) + (created.key.endsWith("0") ? "1" : "0");
  expect((await sendHeartbeat(store)).message).toContain("anahtarı kabul edilmedi");
});
