import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { setBitrixAppFetch } from "../server/bitrix-app";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "BITRIX_WEBHOOK", "PUBLIC_ORIGIN"]) delete process.env[k];
  Object.assign(process.env, {
    XRE_SESSION_SECRET: "bitrix-app-test-secret-0123456789abcdef",
    XRE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "xre-bx-")),
    BITRIX_DOMAIN: "https://xre.bitrix24.com.tr/",
    OUTBOUND_ALLOW_PRIVATE_HOSTS: "127.0.0.1",
  });
});
afterEach(() => {
  setBitrixAppFetch(null);
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

async function setup() {
  const store = createMemoryStore();
  const base = await listen(createApp({ store }));
  const r = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Sahip", email: "sahip@xre.test", password: "Sahip12345" }),
  });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return { store, base, cookie };
}

const calls: { url: string; body: any }[] = [];
function fakeBitrix(email = "Sahip@XRE.test", userId = "7", admin = false) {
  calls.length = 0;
  setBitrixAppFetch(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    if (!url.includes("auth=good")) return { error: "invalid_token" };
    if (url.includes("/user.current.json")) return { result: { ID: userId, NAME: "Kerem", LAST_NAME: "Bitrix", EMAIL: email } };
    if (url.includes("/user.admin.json")) return { result: admin };
    if (url.includes("/crm.deal.get.json")) return { result: { ID: body.id, CONTACT_ID: "55", COMPANY_ID: "0" } };
    if (url.includes("/crm.contact.get.json")) return { result: { ID: body.id, PHONE: [{ VALUE: "0532 111 22 33" }] } };
    if (url.includes("/crm.lead.get.json")) return { result: { ID: body.id, PHONE: [] } };
    return { result: true };
  });
}
const form = (fields: Record<string, string>) => ({
  method: "POST",
  redirect: "manual" as const,
  headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-proto": "https" },
  body: new URLSearchParams(fields).toString(),
});

describe("Bitrix24 yerel uygulaması", () => {
  it("ayarlı portaldan gelen kullanıcıyı e-postasıyla eşler, bölümlenmiş çerezle oturum açar", async () => {
    const { base } = await setup();
    fakeBitrix();
    const res = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good", PLACEMENT: "DEFAULT" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/whatsapp?embed=bitrix");
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("webdev_app_session=");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Partitioned");
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: setCookie.split(";")[0] } })).json();
    expect(me.user).toMatchObject({ isOwner: true });
  });

  it("anlaşma sekmesinde bağlı kişinin telefonuyla sohbeti açar", async () => {
    const { base } = await setup();
    fakeBitrix();
    const res = await fetch(
      `${base}/bitrix/app`,
      form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good", PLACEMENT: "CRM_DEAL_DETAIL_TAB", PLACEMENT_OPTIONS: '{"ID":"12"}' }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/whatsapp?embed=bitrix&phone=905321112233");
    expect(calls.map((c) => c.url.split("/rest/")[1].split(".json")[0])).toEqual(["user.current", "user.admin", "crm.deal.get", "crm.contact.get"]);

    const noPhone = await fetch(
      `${base}/bitrix/app`,
      form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good", PLACEMENT: "CRM_LEAD_DETAIL_TAB", PLACEMENT_OPTIONS: '{"ID":"3"}' }),
    );
    expect(noPhone.status).toBe(200);
    expect(await noPhone.text()).toContain("telefon yok");
  });

  it("başka portalı ve geçersiz AUTH_ID'yi reddeder", async () => {
    const { base } = await setup();
    fakeBitrix();
    const other = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "saldirgan.bitrix24.com", AUTH_ID: "good" }));
    expect(other.status).toBe(403);
    expect(other.headers.get("set-cookie")).toBeNull();
    expect(calls).toHaveLength(0);

    const bad = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "bad" }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
  });

  it("e-postası olmayan Bitrix kullanıcısına otomatik hesap açar ve kimliğiyle tekrar tanır", async () => {
    const { store, base } = await setup();
    const owner = (await store.resolveOwner())!;
    fakeBitrix("", "42", false);
    const first = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    expect(first.status).toBe(303);
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: (first.headers.get("set-cookie") || "").split(";")[0] } })).json();
    expect(me.user).toMatchObject({ name: "Kerem Bitrix" });
    expect(me.user.isOwner).toBeFalsy();
    const accounts = (await store.list<any>("local-account", owner)).map((r) => r.payload);
    const created = accounts.find((a) => a.email === "bitrix-42@xre.bitrix24.com.tr");
    expect(created).toBeTruthy();
    const employee = (await store.get<any>("employee", created.employeeId, owner))?.payload;
    expect(employee.roleId).toBe("sales");

    // Aynı Bitrix kullanıcısı ikinci kez geldiğinde yeni hesap açılmaz.
    fakeBitrix("", "42", false);
    await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    expect((await store.list("local-account", owner)).length).toBe(accounts.length);

    // Bitrix yöneticisi Yönetici rolü alır.
    fakeBitrix("erdal@bitrix.test", "1", true);
    await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    const admin = (await store.list<any>("local-account", owner)).map((r) => r.payload).find((a) => a.email === "erdal@bitrix.test");
    expect((await store.get<any>("employee", admin.employeeId, owner))?.payload.roleId).toBe("manager");

    // Otomatik hesap kapatılabilir.
    process.env.BITRIX_AUTO_ACCOUNTS = "0";
    fakeBitrix("", "99", false);
    const closed = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    expect(closed.status).toBe(403);
    expect(closed.headers.get("set-cookie")).toBeNull();
  });

  it("kurulumda müşteri kartlarına WhatsApp sekmesini bağlar", async () => {
    const { base } = await setup();
    process.env.PUBLIC_ORIGIN = "https://crm.xre.test";
    fakeBitrix();
    const res = await fetch(`${base}/bitrix/install`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("installFinish");
    const binds = calls.filter((c) => c.url.includes("/placement.bind.json"));
    expect(binds.map((b) => b.body.PLACEMENT)).toEqual([
      "CRM_LEAD_DETAIL_TAB",
      "CRM_DEAL_DETAIL_TAB",
      "CRM_CONTACT_DETAIL_TAB",
      "CRM_COMPANY_DETAIL_TAB",
    ]);
    expect(binds[0].body).toMatchObject({ HANDLER: "https://crm.xre.test/bitrix/app", TITLE: "WhatsApp" });
  });
});

describe("XRE WhatsApp rolleri CRM gelen kutusunda", () => {
  it("personel yalnız rolündeki numaranın hattını görür ve ondan yazar", async () => {
    Object.assign(process.env, { EVOLUTION_API_URL: "http://127.0.0.1:9", EVOLUTION_API_KEY: "evo" });
    const { store, base } = await setup();
    const owner = (await store.resolveOwner())!;
    await store.put("connection", "cloud-18", { id: "cloud-18", status: "connected", phone: "905337435976" }, owner);
    await store.put("connection", "cloud-21", { id: "cloud-21", status: "connected", phone: "905337437435" }, owner);
    await store.put("message", "m-arda", { id: "m-arda", lineId: "cloud-18", phone: "905551110001", direction: "inbound", text: "Arda hattı", createdAt: new Date().toISOString() }, owner);
    await store.put("message", "m-zeliha", { id: "m-zeliha", lineId: "cloud-21", phone: "905551110002", direction: "inbound", text: "Zeliha hattı", createdAt: new Date().toISOString() }, owner);
    await store.put(
      "b24-portal",
      "member123",
      {
        id: "member123",
        domain: "xre.bitrix24.com.tr",
        active: true,
        lines: { "7": { instance: "b24-x-7", phone: "905337437435", status: "connected" }, "9": { instance: "b24-x-9", phone: "905337435976", status: "connected" } },
        roles: [{ id: "r-zeliha", name: "7435", lines: ["7"] }],
        assignments: { "42": "r-zeliha" },
      },
      "b24-connector",
    );
    fakeBitrix("", "42", false);
    const login = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    const headers = { "content-type": "application/json", cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
    const lines = await (await fetch(`${base}/api/whatsapp/lines`, { headers })).json();
    expect(lines.lines.map((l: any) => l.lineId)).toEqual(["cloud-21"]);
    const blocked = await fetch(`${base}/api/whatsapp/send`, { method: "POST", headers, body: JSON.stringify({ lineId: "cloud-18", to: "05551110001", text: "x" }) });
    expect(blocked.status).toBe(403);
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    const texts = state.messages.map((m: any) => m.text);
    expect(texts).not.toContain("Arda hattı");

    // Rolü olmayan kullanıcı hiçbir hattı görmez
    fakeBitrix("", "77", false);
    const other = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    const otherLines = await (await fetch(`${base}/api/whatsapp/lines`, { headers: { cookie: (other.headers.get("set-cookie") || "").split(";")[0] } })).json();
    expect(otherLines.lines).toEqual([]);
  });
});

describe("WhatsApp bağlantı eşitleme", () => {
  it("Evolution'daki bağlı numarayı hat kartına ve hat listesine yazar", async () => {
    Object.assign(process.env, { EVOLUTION_API_KEY: "evo" });
    process.env.EVOLUTION_API_URL = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/instance/fetchInstances")
        return res.end(
          JSON.stringify([
            { name: "ai-1", connectionStatus: "open", ownerJid: "905321116976@s.whatsapp.net", profileName: "XRE" },
            { name: "baska-oturum", connectionStatus: "open", ownerJid: "905000000000@s.whatsapp.net" },
          ]),
        );
      res.end("{}");
    });
    const { store, base, cookie } = await setup();
    const headers = { "content-type": "application/json", cookie };
    const sync = await fetch(`${base}/api/whatsapp/connections/sync`, { method: "POST", headers, body: "{}" });
    expect(await sync.json()).toEqual({ synced: 1 });
    const owner = (await store.resolveOwner())!;
    expect((await store.get<any>("connection", "ai-1", owner))?.payload).toMatchObject({
      status: "connected",
      phone: "905321116976",
      profileName: "XRE",
    });
    expect(await store.get("connection", "baska-oturum", owner)).toBeFalsy();
    const lines = await (await fetch(`${base}/api/whatsapp/lines`, { headers })).json();
    expect(lines.lines.find((l: any) => l.lineId === "ai-1")).toMatchObject({ phone: "905321116976", provider: "evolution" });
  });
});
