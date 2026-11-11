// WhatsApp by XRE'nin CRM'den ayrılması: bağımsız sunucu, yönetim girişi, veri taşıma, adres taşıma.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createConnectorApp, migrateFromCrm, pickConnectorRecords } from "../server/connector-app";
import { rebindPortal, setB24Fetch } from "../server/b24-connector";
import { encryptValue } from "../server/integration-settings";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  Object.assign(process.env, {
    XRE_SESSION_SECRET: "split-test-secret-0123456789abcdef0123456789",
    XRE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "xre-split-")),
    PUBLIC_ORIGIN: "https://whatsapp.xre.test",
    B24_CLIENT_ID: "app.test",
    B24_CLIENT_SECRET: "secret",
    EVOLUTION_WEBHOOK_SECRET: "hook-secret",
    B24_ADMIN_PASSWORD: "dogru-sifre-123",
  });
});
afterEach(() => {
  setB24Fetch(null);
  for (const s of servers.splice(0)) s.close();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});
async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
const MEMBER = "splitmember01";
const DOMAIN = "firma.bitrix24.com";
function bitrixMock() {
  const calls: { method: string; body: any }[] = [];
  setB24Fetch(async (url, init) => {
    if (url.startsWith("https://oauth.bitrix.info/"))
      return { access_token: "tok-2", refresh_token: "ref-2", expires_in: 3600, member_id: MEMBER, client_endpoint: `https://${DOMAIN}/rest/` };
    const method = url.split("/rest/")[1].replace(/\.json$/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ method, body });
    if (method === "user.current") return { result: { ID: "1" } };
    if (method === "user.admin") return { result: true };
    return { result: true };
  });
  return calls;
}
const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

describe("WhatsApp by XRE bağımsız sunucu", () => {
  it("yalnız uygulama uçlarını açar; CRM uçları yoktur; yönetim şifreyle açılır", async () => {
    const calls = bitrixMock();
    const store = createMemoryStore();
    const base = await listen(createConnectorApp({ store }));
    // Bitrix kurulumu çalışır ve yeni adresle kaydedilir
    const res = await fetch(`${base}/b24/install`, form({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "ref-1", AUTH_EXPIRES: "3600" }));
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.method === "imconnector.register")?.body.PLACEMENT_HANDLER).toBe("https://whatsapp.xre.test/b24/settings");
    expect((await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload.baseUrl).toBe("https://whatsapp.xre.test");
    // CRM uçları ve arayüzü yok
    expect((await fetch(`${base}/api/me`)).status).toBe(404);
    expect((await fetch(`${base}/api/crm/contacts`)).status).toBe(404);
    expect((await fetch(`${base}/`, { redirect: "manual" })).headers.get("location")).toBe("/b24/support");
    expect((await fetch(`${base}/health`)).status).toBe(200);
    // Yönetim: girişsiz kapalı, yanlış şifre reddedilir, doğru şifreyle açılır
    expect(await (await fetch(`${base}/api/b24-admin/state`)).json()).toMatchObject({ error: "LOGIN_REQUIRED" });
    expect((await fetch(`${base}/api/b24-admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "yanlis" }) })).status).toBe(401);
    const login = await fetch(`${base}/api/b24-admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "dogru-sifre-123" }) });
    expect(login.status).toBe(200);
    const cookie = String(login.headers.get("set-cookie")).split(";")[0];
    expect(cookie).toMatch(/^xre_wa_admin=\d+\./);
    const state = await (await fetch(`${base}/api/b24-admin/state`, { headers: { cookie } })).json();
    expect(state.portals.map((p: any) => p.domain)).toEqual([DOMAIN]);
    // Sahte çerez geçmez
    expect((await fetch(`${base}/api/b24-admin/state`, { headers: { cookie: "xre_wa_admin=9999999999999.sahte" } })).status).toBe(401);
    // Yönetim sayfası CRM bağlantısı yerine çıkış gösterir
    process.env.XRE_APP_MODE = "connector";
    expect(await (await fetch(`${base}/b24/admin`)).text()).toContain('id="logout"');
  });

  it("CRM veri dosyasından yalnız uygulama verisini, dosyaları ve izin verilen ayarları taşır", async () => {
    const from = fs.mkdtempSync(path.join(os.tmpdir(), "xre-crm-"));
    fs.mkdirSync(path.join(from, "media"));
    fs.writeFileSync(path.join(from, "media", "med_aaaaaaaaaaaaaaaaaaaaaaaa"), "gorsel");
    fs.writeFileSync(path.join(from, "media", "med_bbbbbbbbbbbbbbbbbbbbbbbb"), "crm-dosyasi");
    fs.mkdirSync(path.join(from, "b24-video"));
    fs.writeFileSync(path.join(from, "b24-video", "tr.mp4"), "video");
    const rec = (ownerOpenId: string, kind: string, id: string, payload: unknown) => ({ ownerOpenId, kind, id, payload, createdAt: "x", updatedAt: "x" });
    const records = [
      rec("b24-connector", "b24-portal", MEMBER, { id: MEMBER, domain: DOMAIN, active: true, lines: {} }),
      rec("b24-connector", "b24-chat", `${MEMBER}:3:905550000001`, { id: "c" }),
      rec("b24-connector", "b24-pricing", "default", { trialDays: 3 }),
      rec("b24:" + MEMBER, "media", "med_aaaaaaaaaaaaaaaaaaaaaaaa", { id: "med_aaaaaaaaaaaaaaaaaaaaaaaa" }),
      rec("crm-owner", "media", "med_bbbbbbbbbbbbbbbbbbbbbbbb", { id: "med_bbbbbbbbbbbbbbbbbbbbbbbb" }),
      rec("crm-owner", "crm-contact", "k1", { name: "CRM müşterisi" }),
      rec("crm-owner", "system-settings", "integrations", { values: { XRE_OPENAI_API_KEY: encryptValue("sk-test"), B24_FREE_DOMAINS: encryptValue("xre.bitrix24.com.tr"), PUBLIC_ORIGIN: encryptValue("https://crm.xre.test"), META_ACCESS_TOKEN: encryptValue("meta") } }),
    ];
    fs.writeFileSync(path.join(from, "xrecrm-data.json"), JSON.stringify({ version: 1, records, events: [] }));
    expect(pickConnectorRecords(records as any).map((r) => r.kind)).toEqual(["b24-portal", "b24-chat", "b24-pricing", "media", "system-settings"]);

    const store = createMemoryStore();
    const result = await migrateFromCrm(store, from);
    expect(result.records).toBe(5);
    expect(await store.list("crm-contact", "crm-owner")).toEqual([]);
    const settings = (await store.get<any>("system-settings", "integrations", "b24-connector"))!.payload.values;
    expect(Object.keys(settings).sort()).toEqual(["B24_FREE_DOMAINS", "XRE_OPENAI_API_KEY"]);
    const to = process.env.XRE_DATA_DIR!;
    expect(fs.readFileSync(path.join(to, "media", "med_aaaaaaaaaaaaaaaaaaaaaaaa"), "utf8")).toBe("gorsel");
    expect(fs.existsSync(path.join(to, "media", "med_bbbbbbbbbbbbbbbbbbbbbbbb"))).toBe(false);
    expect(fs.existsSync(path.join(to, "b24-video", "tr.mp4"))).toBe(true);
    // İkinci kez yanlışlıkla çalıştırılırsa durur
    await expect(migrateFromCrm(store, from)).rejects.toThrow(/--force/);
  });

  it("adres değişince Bitrix kayıtları eski adresten kaldırılıp yenisine bağlanır", async () => {
    const calls = bitrixMock();
    const store = createMemoryStore();
    process.env.B24_LEGACY_ORIGIN = "https://crm.xre.test";
    const portal: any = { id: MEMBER, domain: DOMAIN, clientEndpoint: `https://${DOMAIN}/rest/`, accessToken: "tok-2", refreshToken: "ref-2", expiresAt: Date.now() + 3_600_000, active: true, lines: {}, installedAt: "x", updatedAt: "x" };
    await store.put("b24-portal", MEMBER, portal, "b24-connector");
    expect(await rebindPortal(store, portal)).toBe(true);
    const unbound = calls.filter((c) => c.method === "event.unbind").map((c) => c.body.handler);
    expect(new Set(unbound)).toEqual(new Set(["https://crm.xre.test/b24/events"]));
    expect(calls.filter((c) => c.method === "event.bind").every((c) => c.body.handler === "https://whatsapp.xre.test/b24/events")).toBe(true);
    expect(calls.some((c) => c.method === "placement.unbind" && c.body.HANDLER === "https://crm.xre.test/b24/card")).toBe(true);
    expect(calls.some((c) => c.method === "placement.bind" && c.body.HANDLER === "https://whatsapp.xre.test/b24/card")).toBe(true);
    expect(calls.find((c) => c.method === "imconnector.register")?.body.PLACEMENT_HANDLER).toBe("https://whatsapp.xre.test/b24/settings");
    // Bir kez taşındıktan sonra tekrar çağrı yapılmaz
    calls.length = 0;
    expect(await rebindPortal(store, (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("CRM modunda WhatsApp by XRE uçları kapalıdır", async () => {
    process.env.XRE_APP_MODE = "crm";
    const base = await listen(createApp({ store: createMemoryStore() }));
    expect((await fetch(`${base}/b24/support`)).status).toBe(404);
    expect((await fetch(`${base}/b24/admin`)).status).toBe(404);
    // WhatsApp sunucusunun eski olayları sessizce kabul edilir, işlenmez
    const hook = await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "messages.upsert", instance: "b24-abc-3", data: {} }) });
    expect(hook.status).toBe(200);
  });
});
