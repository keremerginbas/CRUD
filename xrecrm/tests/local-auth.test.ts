import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { FileStore, createMemoryStore } from "../server/db";
import { exchangeCode, matchAccount, peekQrCode, resetQrSessions, setSocialFetch } from "../server/social-auth";
import { hashPassword, verifyPassword } from "../server/local-auth";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];

beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "local-auth-test-secret-0123456789abcdef";
  resetQrSessions();
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  setSocialFetch(null);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

async function start(store = createMemoryStore()) {
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { store, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

const json = (cookie?: string) => ({
  "content-type": "application/json",
  ...(cookie ? { cookie } : {}),
});
const cookieOf = (res: Response) => (res.headers.get("set-cookie") || "").split(";")[0];

describe("Bağımsız giriş", () => {
  it("şifreyi scrypt ile saklar ve doğrular", async () => {
    const hash = await hashPassword("Gizli1234");
    expect(hash).not.toContain("Gizli1234");
    expect(await verifyPassword("Gizli1234", hash)).toBe(true);
    expect(await verifyPassword("yanlis123", hash)).toBe(false);
  });

  it("ilk kurulum, giriş, çalışan hesabı ve yetki akışı", async () => {
    const { base } = await start();
    const status = await (await fetch(`${base}/api/auth/status`)).json();
    expect(status).toMatchObject({ needsSetup: true, providers: { local: true, qr: true, google: false } });

    expect((await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json(), body: JSON.stringify({ name: "Kerem", email: "k@xre.test", password: "kisa" }) })).status).toBe(400);
    const setup = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ name: "Kerem Yönetici", email: "Kerem@XRE.test", password: "Yonetici123" }),
    });
    expect(setup.status).toBe(201);
    const ownerCookie = cookieOf(setup);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: ownerCookie } })).json();
    expect(me.user).toMatchObject({ isOwner: true, name: "Kerem Yönetici" });

    // İkinci kurulum reddedilir
    expect((await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json(), body: JSON.stringify({ name: "Saldırgan", email: "x@x.test", password: "Saldiri123" }) })).status).toBe(409);

    const bad = await fetch(`${base}/api/auth/local-login`, { method: "POST", headers: json(), body: JSON.stringify({ email: "kerem@xre.test", password: "Yanlis123" }) });
    expect(bad.status).toBe(401);
    const good = await fetch(`${base}/api/auth/local-login`, { method: "POST", headers: json(), body: JSON.stringify({ email: "kerem@xre.test", password: "Yonetici123" }) });
    expect(good.status).toBe(200);
    expect(cookieOf(good)).toContain("webdev_app_session=");

    const created = await fetch(`${base}/api/auth/accounts`, {
      method: "POST",
      headers: json(ownerCookie),
      body: JSON.stringify({ name: "Ayşe Danışman", email: "ayse@xre.test", password: "Danisman123", roleId: "sales" }),
    });
    expect(created.status).toBe(201);
    const { account } = await created.json();

    const login = await fetch(`${base}/api/auth/local-login`, { method: "POST", headers: json(), body: JSON.stringify({ email: "ayse@xre.test", password: "Danisman123" }) });
    const staffCookie = cookieOf(login);
    const staff = await (await fetch(`${base}/api/me`, { headers: { cookie: staffCookie } })).json();
    expect(staff.user).toMatchObject({ isOwner: false, name: "Ayşe Danışman" });
    expect((await fetch(`${base}/api/auth/accounts`, { headers: { cookie: staffCookie } })).status).toBe(403);

    await fetch(`${base}/api/auth/accounts/${account.id}`, { method: "PATCH", headers: json(ownerCookie), body: JSON.stringify({ active: false }) });
    const disabled = await fetch(`${base}/api/auth/local-login`, { method: "POST", headers: json(), body: JSON.stringify({ email: "ayse@xre.test", password: "Danisman123" }) });
    expect(disabled.status).toBe(403);
    const afterDisable = await (await fetch(`${base}/api/me`, { headers: { cookie: staffCookie } })).json();
    expect(afterDisable.user).toBeNull();
  });

  it("QR ile giriş telefondaki oturumun onayıyla açılır", async () => {
    const { base } = await start();
    const setup = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json(), body: JSON.stringify({ name: "Telefon Sahibi", email: "tel@xre.test", password: "Telefon123" }) });
    const phoneCookie = cookieOf(setup);
    const qr = await (await fetch(`${base}/api/auth/qr/start`, { method: "POST", headers: json(), body: "{}" })).json();
    expect(qr.qr).toMatch(/^data:image\/png;base64,/);
    const pending = await (await fetch(`${base}/api/auth/qr/poll`, { method: "POST", headers: json(), body: JSON.stringify({ id: qr.id, pollSecret: qr.pollSecret }) })).json();
    expect(pending.status).toBe("pending");
    expect((await fetch(`${base}/api/auth/qr/poll`, { method: "POST", headers: json(), body: JSON.stringify({ id: qr.id, pollSecret: "yanlis" }) })).status).toBe(401);

    expect((await fetch(`${base}/api/auth/qr/approve`, { method: "POST", headers: json(phoneCookie), body: JSON.stringify({ code: "yok" }) })).status).toBe(410);
    expect((await fetch(`${base}/api/auth/qr/approve`, { method: "POST", headers: json(), body: JSON.stringify({ code: "yok" }) })).status).toBe(401);
    const approve = await fetch(`${base}/api/auth/qr/approve`, { method: "POST", headers: json(phoneCookie), body: JSON.stringify({ code: peekQrCode(qr.id) }) });
    expect(approve.status).toBe(200);
    const done = await fetch(`${base}/api/auth/qr/poll`, { method: "POST", headers: json(), body: JSON.stringify({ id: qr.id, pollSecret: qr.pollSecret }) });
    expect((await done.json()).status).toBe("approved");
    const desktop = await (await fetch(`${base}/api/me`, { headers: { cookie: cookieOf(done) } })).json();
    expect(desktop.user).toMatchObject({ name: "Telefon Sahibi", isOwner: true });
    // Tek kullanımlık
    expect((await (await fetch(`${base}/api/auth/qr/poll`, { method: "POST", headers: json(), body: JSON.stringify({ id: qr.id, pollSecret: qr.pollSecret }) })).json()).status).toBe("expired");
  });

  it("sosyal giriş yalnız kayıtlı ve doğrulanmış e-postayı kabul eder", async () => {
    const { base, store } = await start();
    await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json(), body: JSON.stringify({ name: "Sahip", email: "sahip@xre.test", password: "Sahip12345" }) });
    const owner = (await store.resolveOwner())!;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
    setSocialFetch(async (input) => {
      const url = String(input);
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "at" }), { status: 200 });
      return new Response(JSON.stringify({ sub: "g-1", email: "SAHIP@xre.test", email_verified: true, name: "Sahip" }), { status: 200 });
    });
    const profile = await exchangeCode("google", "code", "https://crm.test/cb");
    expect(profile).toMatchObject({ subject: "g-1", email: "sahip@xre.test", emailVerified: true });
    expect((await matchAccount(store, owner, "google", profile))?.email).toBe("sahip@xre.test");
    // Bağlandıktan sonra e-posta değişse bile aynı Google kimliği aynı hesaba girer.
    expect((await matchAccount(store, owner, "google", { ...profile, email: "" }))?.email).toBe("sahip@xre.test");
    expect(await matchAccount(store, owner, "google", { subject: "g-2", email: "yabanci@x.test", emailVerified: true })).toBeNull();
    expect(await matchAccount(store, owner, "google", { subject: "g-3", email: "sahip@xre.test", emailVerified: false })).toBeNull();

    const start302 = await fetch(`${base}/api/auth/social/google/start`, { redirect: "manual" });
    expect(start302.status).toBe(302);
    expect(start302.headers.get("location")).toContain("accounts.google.com");
    const forged = await fetch(`${base}/api/auth/social/google/callback?code=x&state=google.sahte`, { redirect: "manual" });
    expect(forged.headers.get("location")).toContain("login_error");
  });
});

describe("Yerel dosya veritabanı", () => {
  it("kayıtları ve olayları yeniden başlatmada korur", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xre-")), "db.json");
    const first = new FileStore(file);
    await first.init();
    await first.put("lead", "l1", { id: "l1", name: "Kalıcı" }, "owner");
    await first.appendEvent("owner", "k1", { type: "x" }, "completed");
    first.flushSync();
    const second = new FileStore(file);
    await second.init();
    expect((await second.get<any>("lead", "l1", "owner"))?.payload.name).toBe("Kalıcı");
    expect(await second.listEvents("owner")).toHaveLength(1);
    const next = await second.appendEvent("owner", "k2", { type: "y" });
    expect(next.event.id).toBe("2");
  });
});
