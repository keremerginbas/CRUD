import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { RESERVED_SLUGS, slugFromPath } from "../shared/workspaces";

const saved = { ...process.env };
const servers: http.Server[] = [];
let dir = "";
beforeEach(async () => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SESSION_SECRET"]) delete process.env[key];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "xre-session-test-"));
  process.env.XRE_DATA_DIR = dir;
  process.env.XRE_SESSION_SECRET = "test-only-session-secret-0123456789";
});
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  await fs.rm(dir, { recursive: true, force: true });
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function boot() {
  const server = http.createServer(createApp({ store: createMemoryStore() }));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = (url: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") =>
    fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookieOf = (res: Response) => (res.headers.get("set-cookie") || "").split(";")[0];
  const setup = await send("/api/auth/setup", { name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" });
  expect(setup.status).toBeLessThan(300);
  return { send, cookieOf, owner: cookieOf(setup) };
}

describe("oturum güvenliği", () => {
  it("çıkıştan sonra kopyalanmış oturum çerezi artık geçmez", async () => {
    const { send, cookieOf, owner } = await boot();
    expect((await send("/api/state", undefined, { cookie: owner })).status).toBe(200);
    await wait(1100); // belirteç zamanı saniye hassasiyetindedir
    expect((await send("/api/auth/logout", {}, { cookie: owner })).status).toBe(204);
    expect((await send("/api/state", undefined, { cookie: owner })).status).toBe(401);
    // Yeniden giriş yeni ve geçerli bir oturum verir.
    await wait(1100);
    const again = await send("/api/auth/local-login", { email: "sahip@xre.test", password: "Yonetici123" });
    expect(again.status).toBe(200);
    expect((await send("/api/state", undefined, { cookie: cookieOf(again) })).status).toBe(200);
  });

  it("şifre değişince eski oturumlar kapanır, şifreyi değiştiren cihaz açık kalır", async () => {
    const { send, cookieOf, owner } = await boot();
    await wait(1100);
    const changed = await send("/api/auth/password", { current: "Yonetici123", next: "YeniSifre456" }, { cookie: owner });
    expect(changed.status).toBe(200);
    const fresh = cookieOf(changed);
    expect(fresh).toContain("webdev_app_session=");
    expect((await send("/api/state", undefined, { cookie: owner })).status).toBe(401);
    expect((await send("/api/state", undefined, { cookie: fresh })).status).toBe(200);
  });

  it("başka siteden çerezle gelen değişiklik isteği reddedilir; aynı siteden gelen kabul edilir", async () => {
    const { send, owner } = await boot();
    const evil = await send("/api/auth/logout", {}, { cookie: owner, origin: "https://kotu-site.example" });
    expect(evil.status).toBe(403);
    expect((await evil.json()).error).toBe("CROSS_SITE_REQUEST");
    expect((await send("/api/state", undefined, { cookie: owner })).status).toBe(200);
    // Çerezsiz dış bildirimler (webhook) bu denetime takılmaz.
    expect((await send("/api/auth/local-login", { email: "x@y.test", password: "yanlis" }, { origin: "https://kotu-site.example" })).status).toBe(401);
  });

  it("menüdeki her sayfa adı çalışma alanı kısa adı olarak ayrılmıştır (sayfa yenilenince açılır)", async () => {
    const source = await fs.readFile(path.join(__dirname, "..", "client", "src", "workspace", "App.tsx"), "utf8");
    const routes = [...source.matchAll(/^\s*\["\/([a-z0-9-]+)", "/gm)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(20);
    for (const route of routes) {
      expect(RESERVED_SLUGS.has(route), `/${route} ayrılmış adlar listesinde olmalı`).toBe(true);
      expect(slugFromPath(`/${route}`)).toBe("");
    }
  });
});

describe("şifre kuralı ve deneme sınırı", () => {
  it("basit ve yaygın şifreler reddedilir", async () => {
    const { passwordProblem } = await import("../shared/password");
    expect(passwordProblem("aaaaaaa1")).toMatch(/basit/);
    expect(passwordProblem("Password123")).toMatch(/yaygın/);
    expect(passwordProblem("kısa1")).toMatch(/8 karakter/);
    expect(passwordProblem("sadeceharfler")).toMatch(/rakam/);
    expect(passwordProblem("Yonetici123")).toBeNull();
    expect(passwordProblem("Güçlü-Şifre-2026")).toBeNull();
  });

  it("şifre değiştirirken mevcut şifre için deneme sınırı vardır", async () => {
    const { send, owner } = await boot();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await send("/api/auth/password", { current: `yanlis${i}`, next: "YeniSifre456" }, { cookie: owner })).status;
    expect(last).toBe(429);
    // Sınır dolunca doğru şifre de kabul edilmez (15 dakika).
    expect((await send("/api/auth/password", { current: "Yonetici123", next: "YeniSifre456" }, { cookie: owner })).status).toBe(429);
    const weak = await boot();
    const res = await weak.send("/api/auth/password", { current: "Yonetici123", next: "aaaaaaa1" }, { cookie: weak.owner });
    expect(res.status).toBe(400);
  });
});
