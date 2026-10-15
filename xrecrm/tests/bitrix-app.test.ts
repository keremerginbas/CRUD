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
function fakeBitrix(email = "Sahip@XRE.test") {
  calls.length = 0;
  setBitrixAppFetch(async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body });
    if (!url.includes("auth=good")) return { error: "invalid_token" };
    if (url.includes("/user.current.json")) return { result: { ID: "7", NAME: "Kerem", EMAIL: email } };
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
    expect(calls.map((c) => c.url.split("/rest/")[1].split(".json")[0])).toEqual(["user.current", "crm.deal.get", "crm.contact.get"]);

    const noPhone = await fetch(
      `${base}/bitrix/app`,
      form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good", PLACEMENT: "CRM_LEAD_DETAIL_TAB", PLACEMENT_OPTIONS: '{"ID":"3"}' }),
    );
    expect(noPhone.status).toBe(200);
    expect(await noPhone.text()).toContain("telefon yok");
  });

  it("başka portalı, geçersiz AUTH_ID'yi ve CRM'de olmayan e-postayı reddeder", async () => {
    const { base } = await setup();
    fakeBitrix();
    const other = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "saldirgan.bitrix24.com", AUTH_ID: "good" }));
    expect(other.status).toBe(403);
    expect(other.headers.get("set-cookie")).toBeNull();
    expect(calls).toHaveLength(0);

    const bad = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "bad" }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    fakeBitrix("yabanci@xre.test");
    const stranger = await fetch(`${base}/bitrix/app`, form({ DOMAIN: "xre.bitrix24.com.tr", AUTH_ID: "good" }));
    expect(stranger.status).toBe(403);
    expect(await stranger.text()).toContain("yabanci@xre.test");
    expect(stranger.headers.get("set-cookie")).toBeNull();
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
