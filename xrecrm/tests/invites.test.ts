import { afterEach, beforeEach, expect, it } from "vitest";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { setMailSender, type Mail } from "../server/mailer";
import { INVITE_KIND, resetInviteLimits } from "../server/invites";
import { resetSignupAttempts, WORKSPACE_SYSTEM_OWNER } from "../server/workspaces";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "PUBLIC_ORIGIN"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "invite-test-secret-0123456789abcdef";
  resetInviteLimits();
  resetSignupAttempts();
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  setMailSender(null);
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
async function start() {
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { store, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
const headers = (cookie?: string) => ({ "content-type": "application/json", ...(cookie ? { cookie } : {}) });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") || "").split(";")[0];
const send = (base: string, path: string, body?: unknown, cookie?: string, method = body === undefined ? "GET" : "POST") =>
  fetch(`${base}${path}`, { method, headers: headers(cookie), body: body === undefined ? undefined : JSON.stringify(body) });
async function setup(base: string) {
  const res = await send(base, "/api/auth/setup", { name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" });
  expect(res.status).toBe(201);
  return cookieOf(res);
}
const roleOf = async (base: string, cookie: string) =>
  ((await (await send(base, "/api/access", undefined, cookie)).json()).roles as { id: string }[]).find((r) => r.id !== "owner")!.id;

it("sahip davet gönderir; çalışan bağlantıdan kendi hesabını açar ve bağlantı bir kez kullanılır", async () => {
  const mails: Mail[] = [];
  setMailSender(async (mail) => void mails.push(mail));
  const { base, store } = await start();
  const owner = await setup(base);
  const roleId = await roleOf(base, owner);

  expect((await send(base, "/api/auth/invites", { email: "yeni@firma.test", roleId: "owner" }, owner)).status).toBe(400);
  expect((await send(base, "/api/auth/invites", { email: "sahip@xre.test", roleId }, owner)).status).toBe(409);
  const created = await send(base, "/api/auth/invites", { email: "Yeni@Firma.test", name: "Yeni Çalışan", roleId }, owner);
  expect(created.status).toBe(201);
  const { link, sent } = await created.json();
  expect(sent).toBe(true);
  expect(mails).toHaveLength(1);
  expect(mails[0].to).toBe("yeni@firma.test");
  expect(mails[0].text).toContain(link);
  const token = link.split("/davet/")[1];
  expect(token.length).toBeGreaterThan(30);

  // Kod veritabanında düz hâliyle durmaz.
  const stored = await store.list(INVITE_KIND, WORKSPACE_SYSTEM_OWNER);
  expect(JSON.stringify(stored)).not.toContain(token);
  const listed = await (await send(base, "/api/auth/invites", undefined, owner)).json();
  expect(listed.invites).toHaveLength(1);
  expect(JSON.stringify(listed)).not.toContain(token);

  expect((await send(base, "/api/auth/invite/" + "x".repeat(43))).status).toBe(404);
  expect(await (await send(base, `/api/auth/invite/${token}`)).json()).toMatchObject({ email: "yeni@firma.test", name: "Yeni Çalışan" });
  expect((await send(base, `/api/auth/invite/${token}`, { name: "Yeni Çalışan", password: "kisa" })).status).toBe(400);
  const accepted = await send(base, `/api/auth/invite/${token}`, { name: "Yeni Çalışan", password: "Deneme1234", phone: "+90 555 000 00 01" });
  expect(accepted.status).toBe(201);
  const me = await (await send(base, "/api/me", undefined, cookieOf(accepted))).json();
  expect(me.user).toMatchObject({ email: "yeni@firma.test", isOwner: false });

  // İkinci kullanım ve çalışanın davet yönetimi reddedilir.
  expect((await send(base, `/api/auth/invite/${token}`, { name: "Başkası", password: "Deneme1234" })).status).toBe(410);
  expect((await send(base, "/api/auth/invites", { email: "x@firma.test", roleId }, cookieOf(accepted))).status).toBe(403);
  expect((await send(base, "/api/auth/local-login", { email: "yeni@firma.test", password: "Deneme1234" })).status).toBe(200);
  expect((await (await send(base, "/api/auth/invites", undefined, owner)).json()).invites).toHaveLength(0);
});

it("iptal edilen ve süresi dolan davet kullanılamaz; e-posta ayarsızsa bağlantı yine döner", async () => {
  const { base, store } = await start();
  const owner = await setup(base);
  const roleId = await roleOf(base, owner);
  const first = await (await send(base, "/api/auth/invites", { email: "a@firma.test", roleId }, owner)).json();
  expect(first.sent).toBe(false);
  expect(first.link).toContain("/davet/");
  // Aynı adrese yeni davet eskisini geçersiz kılar.
  const second = await (await send(base, "/api/auth/invites", { email: "a@firma.test", roleId }, owner)).json();
  expect((await send(base, `/api/auth/invite/${first.link.split("/davet/")[1]}`)).status).toBe(404);
  const token = second.link.split("/davet/")[1];
  expect((await send(base, `/api/auth/invite/${token}`)).status).toBe(200);

  const [record] = await store.list<any>(INVITE_KIND, WORKSPACE_SYSTEM_OWNER);
  await store.put(INVITE_KIND, record.id, { ...record.payload, expiresAt: new Date(Date.now() - 1000).toISOString() }, WORKSPACE_SYSTEM_OWNER);
  expect((await send(base, `/api/auth/invite/${token}`, { name: "Geç Kalan", password: "Deneme1234" })).status).toBe(410);

  const third = await (await send(base, "/api/auth/invites", { email: "b@firma.test", roleId }, owner)).json();
  expect((await send(base, `/api/auth/invites/${third.invite.id}`, {}, owner, "DELETE")).status).toBe(200);
  expect((await send(base, `/api/auth/invite/${third.link.split("/davet/")[1]}`)).status).toBe(404);
});

it("kayıtla açılan firmanın daveti çalışanı o firmanın alanına alır, varsayılan alana değil", async () => {
  process.env.XRE_SIGNUP = "1";
  process.env.XRE_SIGNUP_VERIFY = "0";
  const { base } = await start();
  const owner = await setup(base);
  await send(base, "/api/leads", { lead: { id: "lead_xre", name: "XRE Müşterisi", phone: "+905550000001" } }, owner);
  const signup = await send(base, "/api/workspaces/signup", { company: "Ahmet İnşaat", slug: "ahmet", name: "Ahmet Yılmaz", email: "ahmet@firma.test", password: "Deneme1234" });
  expect(signup.status).toBe(201);
  const tenant = cookieOf(signup);
  const roleId = await roleOf(base, tenant);
  const { link } = await (await send(base, "/api/auth/invites", { email: "usta@firma.test", roleId }, tenant)).json();
  // Başka firmanın sahibi bu daveti göremez ve iptal edemez.
  expect((await (await send(base, "/api/auth/invites", undefined, owner)).json()).invites).toHaveLength(0);
  const accepted = await send(base, `/api/auth/invite/${link.split("/davet/")[1]}`, { name: "Usta Çalışan", password: "Deneme1234" });
  expect(accepted.status).toBe(201);
  expect((await accepted.json()).workspace).toBe("ahmet");
  const me = await (await send(base, "/api/me", undefined, cookieOf(accepted))).json();
  expect(me.workspace).toMatchObject({ slug: "ahmet", isDefault: false });
  const state = await (await send(base, "/api/state", undefined, cookieOf(accepted))).json();
  expect(state.leads.map((l: any) => l.id)).not.toContain("lead_xre");
  expect((await send(base, "/api/auth/local-login", { email: "usta@firma.test", password: "Deneme1234" })).status).toBe(401);
});

it("sahip bir hesabı siler: kişi giremez, açık oturumu düşer; kendi hesabını ve başka firmanınkini silemez", async () => {
  const { base } = await start();
  const owner = await setup(base);
  const roleId = await roleOf(base, owner);
  const created = await send(base, "/api/auth/accounts", { name: "Silinecek Kişi", email: "silinecek@firma.test", password: "Deneme1234", roleId }, owner);
  expect(created.status).toBe(201);
  const { account } = await created.json();
  const login = await send(base, "/api/auth/local-login", { email: "silinecek@firma.test", password: "Deneme1234" });
  const session = cookieOf(login);
  expect((await send(base, "/api/me", undefined, session)).status).toBe(200);
  // Çalışan başkasını silemez.
  expect((await send(base, `/api/auth/accounts/${account.id}`, {}, session, "DELETE")).status).toBe(403);
  // Sahip kendi hesabını silemez.
  const accounts = (await (await send(base, "/api/auth/accounts", undefined, owner)).json()).accounts as { id: string; email: string }[];
  const own = accounts.find((a) => a.email === "sahip@xre.test")!;
  expect((await send(base, `/api/auth/accounts/${own.id}`, {}, owner, "DELETE")).status).toBe(400);
  expect((await send(base, "/api/auth/accounts/olmayan", {}, owner, "DELETE")).status).toBe(404);

  expect((await send(base, `/api/auth/accounts/${account.id}`, {}, owner, "DELETE")).status).toBe(200);
  // Açık oturum anında geçersiz; yeniden giriş de olmaz; listede yok.
  expect((await send(base, "/api/state", undefined, session)).status).toBeGreaterThanOrEqual(401);
  expect((await send(base, "/api/auth/local-login", { email: "silinecek@firma.test", password: "Deneme1234" })).status).toBe(401);
  expect(((await (await send(base, "/api/auth/accounts", undefined, owner)).json()).accounts as { email: string }[]).some((a) => a.email === "silinecek@firma.test")).toBe(false);
  // Aynı e-posta ile yeniden hesap açılabilir.
  expect((await send(base, "/api/auth/accounts", { name: "Yeni Kişi", email: "silinecek@firma.test", password: "Deneme1234", roleId }, owner)).status).toBe(201);
});
