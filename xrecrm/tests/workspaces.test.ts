import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { createApp, processOutboxOnce } from "../server/app";
import { createMemoryStore } from "../server/db";
import { resetSignupAttempts, slugProblem, workspaceBySlug, WORKSPACE_KIND, WORKSPACE_SYSTEM_OWNER } from "../server/workspaces";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];

beforeEach(() => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_TRIAL_DAYS", "XRE_DEFAULT_SLUG"])
    delete process.env[key];
  process.env.XRE_SESSION_SECRET = "workspace-test-secret-0123456789abcdef";
  resetSignupAttempts();
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
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
const post = (base: string, path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, { method: "POST", headers: headers(cookie), body: JSON.stringify(body) });
const get = (base: string, path: string, cookie?: string) => fetch(`${base}${path}`, { headers: headers(cookie) });

/** Varsayılan alanı (XRE) kurar ve sahibinin çerezini döndürür. */
async function setupDefault(base: string) {
  const res = await post(base, "/api/auth/setup", { name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" });
  expect(res.status).toBe(201);
  return cookieOf(res);
}
const ahmet = { company: "Ahmet İnşaat", slug: "ahmet", name: "Ahmet Yılmaz", email: "ahmet@firma.test", password: "Deneme1234" };
const lead = (id: string, name: string) => ({ lead: { id, name, phone: "+905550000001" } });

describe("Çalışma alanları", () => {
  it("kısa ad kurallarını uygular", () => {
    expect(slugProblem("ahmet")).toBeNull();
    expect(slugProblem("ahmet-insaat2")).toBeNull();
    expect(slugProblem("ab")).toBeTruthy();
    expect(slugProblem("Ahmet")).toBeTruthy();
    expect(slugProblem("-ahmet")).toBeTruthy();
    expect(slugProblem("api")).toBeTruthy();
    expect(slugProblem("leads")).toBeTruthy();
    expect(slugProblem("xre")).toBeTruthy();
  });

  it("kayıt kapalıyken yeni alan açılamaz ve mevcut giriş değişmez", async () => {
    const { base } = await start();
    const owner = await setupDefault(base);
    expect(await (await get(base, "/api/workspaces/config")).json()).toMatchObject({ signup: false, defaultSlug: "xre" });
    expect((await post(base, "/api/workspaces/signup", ahmet)).status).toBe(404);
    const me = await (await get(base, "/api/me", owner)).json();
    expect(me.workspace).toMatchObject({ isDefault: true, communication: true, state: "active" });
    // Kısa adsız ve varsayılan kısa adla giriş eskisi gibi çalışır.
    for (const workspace of [undefined, "xre"])
      expect((await post(base, "/api/auth/local-login", { email: "sahip@xre.test", password: "Yonetici123", workspace })).status).toBe(200);
  });

  it("kayıt olan firma kendi alanında çalışır; veriler birbirine karışmaz", async () => {
    process.env.XRE_SIGNUP = "1";
    const { base, store } = await start();
    // Kurulumdan önce kayıt alınmaz: ilk hesap her zaman sistem sahibidir.
    expect((await post(base, "/api/workspaces/signup", ahmet)).status).toBe(409);
    const owner = await setupDefault(base);
    expect((await post(base, "/api/leads", lead("lead_xre", "XRE Müşterisi"), owner)).status).toBeLessThan(300);

    expect((await post(base, "/api/workspaces/signup", { ...ahmet, slug: "api" })).status).toBe(400);
    expect((await post(base, "/api/workspaces/signup", { ...ahmet, password: "kisa" })).status).toBe(400);
    const signup = await post(base, "/api/workspaces/signup", ahmet);
    expect(signup.status).toBe(201);
    const tenant = cookieOf(signup);
    expect((await post(base, "/api/workspaces/signup", { ...ahmet, email: "baska@firma.test" })).status).toBe(409);
    expect(await (await get(base, "/api/workspaces/public/ahmet")).json()).toEqual({ slug: "ahmet", name: "Ahmet İnşaat", isDefault: false });
    expect((await get(base, "/api/workspaces/public/yok-boyle")).status).toBe(404);

    const me = await (await get(base, "/api/me", tenant)).json();
    expect(me.user).toMatchObject({ isOwner: true, email: "ahmet@firma.test" });
    expect(me.workspace).toMatchObject({ slug: "ahmet", isDefault: false, state: "trial", daysLeft: 5, communication: false });

    expect((await post(base, "/api/leads", lead("lead_ahmet", "Ahmet'in Müşterisi"), tenant)).status).toBeLessThan(300);
    const tenantState = await (await get(base, "/api/state", tenant)).json();
    expect(tenantState.leads.map((l: any) => l.id)).toEqual(["lead_ahmet"]);
    expect(tenantState.lines).toEqual([]);
    const ownerState = await (await get(base, "/api/state", owner)).json();
    expect(ownerState.leads.map((l: any) => l.id)).toEqual(["lead_xre"]);
    expect(ownerState.lines.length).toBeGreaterThan(0);

    // Sistem sahibi hâlâ ilk hesap; firma hesabı varsayılan alana giremez.
    expect(await store.resolveOwner()).not.toBe((await workspaceBySlug(store, "ahmet"))!.ownerOpenId);
    expect((await post(base, "/api/auth/local-login", { email: ahmet.email, password: ahmet.password })).status).toBe(401);
    expect((await post(base, "/api/auth/local-login", { email: "sahip@xre.test", password: "Yonetici123", workspace: "ahmet" })).status).toBe(401);
    expect((await post(base, "/api/auth/local-login", { email: ahmet.email, password: ahmet.password, workspace: "yok-boyle" })).status).toBe(404);
    const login = await post(base, "/api/auth/local-login", { email: ahmet.email, password: ahmet.password, workspace: "ahmet" });
    expect(login.status).toBe(200);
    expect((await (await get(base, "/api/state", cookieOf(login))).json()).leads).toHaveLength(1);
  });

  it("yeni alanlarda ortak iletişim ve sistem uçları kapalıdır", async () => {
    process.env.XRE_SIGNUP = "1";
    const { base } = await start();
    const owner = await setupDefault(base);
    const tenant = cookieOf(await post(base, "/api/workspaces/signup", ahmet));
    for (const path of ["/api/settings/integrations", "/api/system/backups", "/api/lines", "/api/n8n/status", "/api/webhook-hub/hooks", "/api/pbx/me", "/api/workspaces"]) {
      const res = await get(base, path, tenant);
      expect([path, res.status]).toEqual([path, 403]);
    }
    expect((await post(base, "/api/whatsapp/send", { lineId: "ai-1", to: "+905550000001", text: "selam" }, tenant)).status).toBe(403);
    expect((await post(base, "/api/leads/lead_x/analyze", {}, tenant)).status).toBe(403);
    expect((await get(base, "/api/settings/integrations", owner)).status).toBe(200);
    for (const path of ["/api/state", "/api/access", "/api/profile", "/api/notifications", "/api/audit"])
      expect([path, (await get(base, path, tenant)).status]).toEqual([path, 200]);
  });

  it("yeni alanın kuralları ortak WhatsApp hattından mesaj gönderemez", async () => {
    process.env.XRE_SIGNUP = "1";
    const { base, store } = await start();
    await setupDefault(base);
    const tenant = cookieOf(await post(base, "/api/workspaces/signup", ahmet));
    const owner = (await workspaceBySlug(store, "ahmet"))!.ownerOpenId;
    const rule = { id: "wa-rule", name: "Hoş geldin", triggerStage: "new", action: "whatsapp", enabled: true, config: { template: "Merhaba", lineId: "ai-1", provider: "evolution" } };
    expect((await post(base, "/api/rules", rule, tenant)).status).toBeLessThan(300);
    expect((await post(base, "/api/leads", lead("lead_wa", "Deneme"), tenant)).status).toBe(201);
    await processOutboxOnce(store);
    const events = (await store.listEvents(owner)).filter((e) => e.payload.type === "rule-action");
    expect(events).toHaveLength(1);
    expect(events[0].payload.result).toMatchObject({ skipped: true });
  });

  it("kaydı olmayan bir alanı gösteren oturum kabul edilmez", async () => {
    process.env.XRE_SIGNUP = "1";
    const { base, store } = await start();
    await setupDefault(base);
    const tenant = cookieOf(await post(base, "/api/workspaces/signup", ahmet));
    expect((await get(base, "/api/state", tenant)).status).toBe(200);
    await store.delete(WORKSPACE_KIND, "ahmet", WORKSPACE_SYSTEM_OWNER);
    expect((await get(base, "/api/state", tenant)).status).toBe(401);
    expect((await get(base, "/api/settings/integrations", tenant)).status).toBe(401);
    expect((await (await get(base, "/api/me", tenant)).json()).user).toBeNull();
  });

  it("firma kendi çalışanını ekler; çalışan o alana girer", async () => {
    process.env.XRE_SIGNUP = "1";
    const { base } = await start();
    await setupDefault(base);
    const tenant = cookieOf(await post(base, "/api/workspaces/signup", ahmet));
    const roles = (await (await get(base, "/api/access", tenant)).json()).roles as { id: string }[];
    const roleId = roles.find((r) => r.id !== "owner")!.id;
    const created = await post(base, "/api/auth/accounts", { name: "Ayşe Satış", email: "ayse@firma.test", password: "Calisan1234", roleId }, tenant);
    expect(created.status).toBe(201);
    expect((await post(base, "/api/auth/local-login", { email: "ayse@firma.test", password: "Calisan1234" })).status).toBe(401);
    const login = await post(base, "/api/auth/local-login", { email: "ayse@firma.test", password: "Calisan1234", workspace: "ahmet" });
    expect(login.status).toBe(200);
    const me = await (await get(base, "/api/me", cookieOf(login))).json();
    expect(me.user).toMatchObject({ isOwner: false, email: "ayse@firma.test" });
    expect(me.workspace.slug).toBe("ahmet");
  });

  it("deneme süresi dolunca alan kilitlenir; sistem sahibi uzatır, askıya alır, etkinleştirir", async () => {
    process.env.XRE_SIGNUP = "1";
    process.env.XRE_TRIAL_DAYS = "3";
    const { base, store } = await start();
    const owner = await setupDefault(base);
    const tenant = cookieOf(await post(base, "/api/workspaces/signup", ahmet));
    expect((await (await get(base, "/api/me", tenant)).json()).workspace.daysLeft).toBe(3);

    const ws = (await workspaceBySlug(store, "ahmet"))!;
    await store.put(WORKSPACE_KIND, "ahmet", { ...ws, trialEndsAt: new Date(Date.now() - 60_000).toISOString() }, WORKSPACE_SYSTEM_OWNER);
    const blocked = await get(base, "/api/state", tenant);
    expect(blocked.status).toBe(402);
    expect((await blocked.json()).error).toBe("TRIAL_EXPIRED");
    expect((await (await get(base, "/api/me", tenant)).json()).workspace.state).toBe("expired");

    const list = await (await get(base, "/api/workspaces", owner)).json();
    expect(list.workspaces).toHaveLength(1);
    expect(list.workspaces[0]).toMatchObject({ slug: "ahmet", state: "expired", users: 1, contactEmail: "ahmet@firma.test" });
    expect(list.workspaces[0].ownerOpenId).toBeUndefined();

    expect((await post(base, "/api/workspaces/ahmet", { extendDays: 7 }, tenant)).status).toBe(402);
    const extended = await (await post(base, "/api/workspaces/ahmet", { extendDays: 7 }, owner)).json();
    expect(extended.workspace).toMatchObject({ state: "trial", daysLeft: 7 });
    expect((await get(base, "/api/state", tenant)).status).toBe(200);

    await post(base, "/api/workspaces/ahmet", { status: "suspended" }, owner);
    expect((await (await get(base, "/api/state", tenant)).json()).error).toBe("WORKSPACE_SUSPENDED");
    await post(base, "/api/workspaces/ahmet", { status: "active" }, owner);
    expect((await get(base, "/api/state", tenant)).status).toBe(200);
    expect((await (await get(base, "/api/me", tenant)).json()).workspace).toMatchObject({ state: "active", daysLeft: null });
  });
});
