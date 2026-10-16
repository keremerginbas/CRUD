import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { CONNECTOR_ID, instanceName, setB24Fetch, settingsTicket } from "../server/b24-connector";
import { setAiFetch } from "../server/b24-ai";
import { inWorkingHours, setAgentMergeDelay, DEFAULT_AGENT } from "../server/b24-agent";
import { dueReports, DEFAULT_REPORTS } from "../server/b24-live";
import { panelHtml } from "../server/b24-panel-html";
import { localizeMessage } from "../server/b24-i18n";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID"]) delete process.env[k];
  Object.assign(process.env, {
    XRE_SESSION_SECRET: "b24-connector-test-secret-0123456789abcdef",
    XRE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "xre-b24-")),
    OUTBOUND_ALLOW_PRIVATE_HOSTS: "127.0.0.1",
    EVOLUTION_API_KEY: "evo",
    EVOLUTION_WEBHOOK_SECRET: "hook-secret",
    PUBLIC_ORIGIN: "https://crm.xre.test",
    B24_CLIENT_ID: "app.test",
    B24_CLIENT_SECRET: "secret",
  });
});
afterEach(() => {
  setB24Fetch(null);
  setAiFetch(null);
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

const MEMBER = "abc123member";
const DOMAIN = "musteri.bitrix24.com";

async function setup(opts: { evoState?: string } = {}) {
  const evo: { url: string; body: any }[] = [];
  process.env.EVOLUTION_API_URL = await listen((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      evo.push({ url: req.url || "", body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.startsWith("/instance/connectionState")) return res.end(JSON.stringify({ instance: { state: opts.evoState || "close" } }));
      if (req.url?.startsWith("/chat/getBase64FromMediaMessage")) return res.end(JSON.stringify({ base64: Buffer.from("OggS-ses").toString("base64") }));
      if (req.url?.startsWith("/instance/fetchInstances"))
        return res.end(JSON.stringify([{ name: instanceName(MEMBER, "3"), ownerJid: "905321110000@s.whatsapp.net", profileName: "Müşteri AŞ" }]));
      res.end(JSON.stringify({ key: { id: `WA-${evo.length}` } }));
    });
  });
  const bx: { method: string; body: any; url: string }[] = [];
  let tokenValid = "tok-1";
  setB24Fetch(async (url, init) => {
    if (url.startsWith("https://oauth.bitrix.info/")) {
      bx.push({ method: "oauth.refresh", body: {}, url });
      tokenValid = "tok-2";
      const refreshToken = new URL(url).searchParams.get("refresh_token");
      if (refreshToken === "forged") return { error: "invalid_grant" };
      return { access_token: "tok-2", refresh_token: "ref-2", expires_in: 3600, member_id: MEMBER, client_endpoint: `https://${DOMAIN}/rest/` };
    }
    const method = url.split("/rest/")[1].replace(/\.json$/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    bx.push({ method, body, url });
    if (body.auth === "admin-auth") return { result: method === "user.admin" ? true : { ID: "1" } };
    if (body.auth === "user-auth") return { result: method === "user.admin" ? false : { ID: "2" } };
    if (body.auth === "merve-auth") return { result: method === "user.admin" ? false : { ID: "3" } };
    if (body.auth !== tokenValid) return { error: "expired_token", error_description: "expired" };
    if (method === "user.current") return { result: { ID: "1" } };
    if (method === "imopenlines.config.add") return { result: 7 };
    if (method === "imopenlines.dialog.get") return { result: { id: 1, owner: "3" } };
    if (method === "crm.duplicate.findbycomm") return { result: body.entity_type === "LEAD" ? { LEAD: [55] } : [] };
    if (method === "crm.status.list") return { result: [{ STATUS_ID: "WEB", NAME: "Web sitesi" }, { STATUS_ID: "SAHIBINDEN", NAME: "Sahibinden" }] };
    if (method === "crm.lead.list")
      return { result: [{ ID: "1", TITLE: "Lead A", SOURCE_ID: "WEB", DATE_CREATE: new Date().toISOString() }, { ID: "2", TITLE: "Lead B", SOURCE_ID: "WEB" }, { ID: "3", TITLE: "Lead C", SOURCE_ID: "SAHIBINDEN" }] };
    if (method === "crm.deal.list")
      return { result: body.filter?.STAGE_SEMANTIC_ID === "S" ? [{ ID: "8", OPPORTUNITY: "2500000", CURRENCY_ID: "TRY" }] : [{ ID: "7", TITLE: "Daire satışı", OPPORTUNITY: "4200000", CURRENCY_ID: "TRY" }] };
    if (method === "user.get")
      return {
        result: [
          { ID: "1", NAME: "Erdal", EMAIL: "erdal@x.test", IS_ONLINE: "Y" },
          { ID: "2", NAME: "Kaan", EMAIL: "" },
          { ID: "3", NAME: "Merve", EMAIL: "merve@x.test" },
        ],
      };
    return { result: true };
  });
  const store = createMemoryStore();
  const base = await listen(createApp({ store }));
  return { store, base, evo, bx };
}

const formPost = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

async function install(base: string) {
  return fetch(`${base}/b24/install`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "ref-1", AUTH_EXPIRES: "3600" }));
}

describe("Bitrix24 Açık Kanal bağlayıcısı", () => {
  it("kurulumda bağlayıcıyı kaydeder ve olaylara abone olur", async () => {
    const { base, bx } = await setup();
    const res = await install(base);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("installFinish");
    const register = bx.find((c) => c.method === "imconnector.register");
    expect(register?.body).toMatchObject({ ID: CONNECTOR_ID, NAME: "XRE WhatsApp", PLACEMENT_HANDLER: "https://crm.xre.test/b24/settings" });
    expect(bx.filter((c) => c.method === "event.bind").map((c) => c.body.event)).toEqual([
      "OnImConnectorMessageAdd",
      "OnImConnectorLineDelete",
      "OnImConnectorStatusDelete",
      "OnAppUninstall",
    ]);
    // Önce Bitrix OAuth sunucusunda doğrulanır, sonra portalın kendi adresi çağrılır
    expect(bx[0].url).toMatch(/^https:\/\/oauth\.bitrix\.info\/oauth\/token\/\?grant_type=refresh_token/);
    expect(bx[1].url).toBe(`https://${DOMAIN}/rest/user.current.json`);
  });

  it("ayar sayfası yalnız portal yöneticisine açılır; bağlanınca kanal etkinleşir", async () => {
    const { base, bx } = await setup({ evoState: "open" });
    await install(base);
    const opts = { LANG: "tr", member_id: MEMBER, DOMAIN, PLACEMENT: "SETTING_CONNECTOR", PLACEMENT_OPTIONS: JSON.stringify({ LINE: "3" }) };
    expect((await fetch(`${base}/b24/settings`, formPost({ ...opts, AUTH_ID: "user-auth" }))).status).toBe(403);
    const ok = await fetch(`${base}/b24/settings`, formPost({ ...opts, AUTH_ID: "admin-auth" }));
    expect(ok.status).toBe(200);
    const html = await ok.text();
    const ticket = html.match(/const T="([^"]+)"/)?.[1];
    expect(ticket).toBeTruthy();

    expect((await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: "sahte" }) })).status).toBe(401);
    const status = await (await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ticket }) })).json();
    expect(status).toEqual({ status: "connected", phone: "905321110000" });
    expect(bx.find((c) => c.method === "imconnector.activate")?.body).toMatchObject({ CONNECTOR: CONNECTOR_ID, LINE: "3", ACTIVE: 1 });
    expect(bx.find((c) => c.method === "imconnector.connector.data.set")?.body.DATA).toMatchObject({ name: "WhatsApp +905321110000" });
  });

  it("WhatsApp mesajını Bitrix sohbetine aktarır, CRM çalışma alanına yazmaz", async () => {
    const { store, base, bx } = await setup({ evoState: "open" });
    await install(base);
    const instance = instanceName(MEMBER, "3");
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const hook = await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance,
        data: { key: { id: "WA-IN-1", remoteJid: "905551234567@s.whatsapp.net", fromMe: false }, pushName: "Ayşe", messageTimestamp: 1760000000, message: { conversation: "Merhaba, fiyat?" } },
      }),
    });
    expect(hook.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const sent = bx.find((c) => c.method === "imconnector.send.messages");
    expect(sent?.body).toMatchObject({
      CONNECTOR: CONNECTOR_ID,
      LINE: "3",
      MESSAGES: [
        {
          user: { id: "905551234567", name: "Ayşe", phone: "+905551234567" },
          message: { id: "WA-IN-1", date: 1760000000, text: "Merhaba, fiyat?" },
          chat: { id: "905551234567" },
        },
      ],
    });
    // Grup mesajları aktarılmaz
    bx.length = 0;
    await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id: "G1", remoteJid: "123@g.us" }, message: { conversation: "grup" } } }),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(bx.find((c) => c.method === "imconnector.send.messages")).toBeUndefined();
    const owner = await store.resolveOwner();
    expect(owner).toBeUndefined();
  });

  it("temsilci cevabını WhatsApp'a gönderir; uygulama anahtarı değişirse reddeder", async () => {
    const { base, evo, bx } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const event = (token: string, access = "") =>
      fetch(
        `${base}/b24/events`,
        formPost({
          event: "ONIMCONNECTORMESSAGEADD",
          "data[CONNECTOR]": CONNECTOR_ID,
          "data[LINE]": "3",
          "data[MESSAGES][0][im][chat_id]": "77",
          "data[MESSAGES][0][im][message_id]": "88",
          "data[MESSAGES][0][message][id]": "88",
          "data[MESSAGES][0][message][text]": "Merhaba [b]Ayşe[/b] hanım[br]Fiyat 3 milyon",
          "data[MESSAGES][0][chat][id]": "905551234567",
          "auth[member_id]": MEMBER,
          "auth[application_token]": token,
          ...(access ? { "auth[access_token]": access } : {}),
        }),
      );
    // Anahtar henüz sabitlenmemişken sahte olay (geçersiz/eksik erişim belirteci) kabul edilmez
    expect((await event("saldirgan-token", "sahte")).status).toBe(401);
    expect((await event("saldirgan-token", "")).status).toBe(401);
    expect(evo.some((c) => c.url.startsWith("/message/sendText/"))).toBe(false);
    expect((await event("app-token", "tok-2")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const sendText = evo.find((c) => c.url === `/message/sendText/${instanceName(MEMBER, "3")}`);
    expect(sendText?.body).toMatchObject({ number: "905551234567", text: "Merhaba Ayşe hanım\nFiyat 3 milyon" });
    expect(bx.find((c) => c.method === "imconnector.send.status.delivery")?.body.MESSAGES[0]).toMatchObject({ im: { chat_id: "77", message_id: "88" } });
    // Olayda temsilci yoksa sohbetin operatörü Bitrix'ten okunur.
    expect(bx.find((c) => c.method === "imopenlines.dialog.get")?.body).toMatchObject({ CHAT_ID: "77" });
    expect((await event("baska-token")).status).toBe(401);
  });

  it("sahte kurulumu reddeder: belirteç Bitrix OAuth sunucusunda doğrulanır", async () => {
    const { base, bx, store } = await setup();
    // Saldırganın kendi sunucusu "Bitrix" gibi davranıp evet dese bile kurulum olmaz
    const forged = await fetch(`${base}/b24/install`, formPost({ LANG: "tr", member_id: "saldirganportal1", DOMAIN: "kotu.example.com", AUTH_ID: "tok-1", REFRESH_ID: "ref-1" }));
    expect(forged.status).toBe(401);
    const forged2 = await fetch(`${base}/b24/install`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "forged" }));
    expect(forged2.status).toBe(401);
    const noRefresh = await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1" }));
    expect(noRefresh.status).toBe(502);
    expect(bx.some((c) => c.url.includes("kotu.example.com"))).toBe(false);
    expect(await store.get("b24-portal", "saldirganportal1", "b24-connector")).toBeFalsy();
    expect(await store.get("b24-portal", MEMBER, "b24-connector")).toBeFalsy();
    expect((await install(base)).status).toBe(200);
  });

  it("süresi dolan belirteci yeniler", async () => {
    const { base, bx, store } = await setup();
    await install(base);
    const portal = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    await store.put("b24-portal", MEMBER, { ...portal, accessToken: "eski" }, "b24-connector");
    const { b24Call } = await import("../server/b24-connector");
    await b24Call(store, { ...portal, accessToken: "eski" }, "profile");
    expect(bx.some((c) => c.method === "oauth.refresh")).toBe(true);
    expect((await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload).toMatchObject({ accessToken: "tok-2", refreshToken: "ref-2" });
  });

  it("imzasız medya adresini reddeder", async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/b24/media/${MEMBER}/med_000000000000000000000000?e=9999999999&s=x`)).status).toBe(403);
  });

  it("yönetim paneli: bağlantı ekler, roller ve personel ile Açık Kanal kuyruklarını ayarlar", async () => {
    const { base, bx } = await setup();
    await install(base);
    const home = await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }));
    const html = await home.text();
    expect(html).toContain("Numara ekle");
    const t = html.match(/const T="([^"]+)"/)?.[1];
    const call = async (path: string, body: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/b24/panel/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });
      return { status: r.status, body: await r.json() };
    };
    const added = await call("connection/add", { name: "Satış 7124" });
    expect(added.body.line).toBe("7");
    expect(bx.find((c) => c.method === "imopenlines.config.add")?.body.PARAMS).toEqual({ LINE_NAME: "Satış 7124 (WhatsApp)" });

    // Kanal ayar bileti panel uçlarını açamaz.
    const lineTicket = settingsTicket(MEMBER, "7");
    expect((await fetch(`${base}/b24/panel/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: lineTicket }) })).status).toBe(401);

    const sales = await call("role/save", { name: "Satış", lines: ["7"] });
    await call("role/save", { name: "Sigorta", lines: [], isDefault: true });
    bx.length = 0;
    await call("user/role", { userId: "2", roleId: sales.body.role.id });
    const update = bx.find((c) => c.method === "imopenlines.config.update");
    expect(update?.body).toEqual(expect.objectContaining({ CONFIG_ID: "7", PARAMS: { QUEUE: [2] } }));

    const state = await call("state");
    expect(state.body.connections).toEqual([expect.objectContaining({ line: "7", name: "Satış 7124" })]);
    expect(state.body.users.find((u: any) => u.id === "2").roleId).toBe(sales.body.role.id);

    // Personel yalnız kendi rolündeki numaraları görür; panel açılmaz.
    const kaan = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "user-auth" }))).text();
    expect(kaan).toContain("Satış 7124");
    expect(kaan).not.toContain("Numara ekle");
    const merve = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "merve-auth" }))).text();
    expect(merve).toContain("Sigorta");
    expect(merve).toContain("Size atanmış numara yok");
  });

  it("kurulum adresi çağrılmasa da ilk açılışta kendini kurar", async () => {
    const { base, bx } = await setup();
    const res = await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "ref-1" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Numara ekle");
    expect(bx.some((c) => c.method === "imconnector.register")).toBe(true);
    // Yönetici olmayan biri kuramaz
    const other = await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: "baskaportal1", DOMAIN: "baska.bitrix24.com", AUTH_ID: "user-auth" }));
    expect(other.status).toBe(502);
  });

  it("yabancı dili çevirir, sesi yazıya döker, cevabı müşterinin dilinde gönderir, nitelendirir ve performansı ölçer", async () => {
    process.env.XRE_OPENAI_API_KEY = "sk-test";
    const ai: string[] = [];
    setAiFetch((async (url: string, init: any) => {
      if (String(url).includes("/audio/transcriptions")) {
        ai.push("audio");
        return new Response(JSON.stringify({ text: "Здравствуйте, ищу квартиру" }), { status: 200 });
      }
      const body = JSON.parse(init.body);
      const name = body.response_format.json_schema.name;
      ai.push(name);
      const content =
        name === "translation"
          ? { language: "ru", translation: "Merhaba, daire arıyorum" }
          : name === "outgoing_translation"
            ? { translation: "Цена 3 миллиона" }
            : { summary: "Antalya'da 3+1 daire arıyor.", budget: 300000, currency: "USD", location: "Antalya", property_type: "daire", rooms: "3+1", purpose: "vatandaşlık", timeline: "1 ay", score: 82, temperature: "sıcak", next_step: "Yer görme randevusu önerin." };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }) as any);
    const { base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    const hook = (id: string, message: unknown) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id, remoteJid: "79161234567@s.whatsapp.net" }, pushName: "Ivan", message } }),
      });
    await hook("R1", { conversation: "Здравствуйте, ищу квартиру" });
    await new Promise((r) => setTimeout(r, 80));
    const first = bx.filter((c) => c.method === "imconnector.send.messages").at(-1)!.body.MESSAGES[0].message.text;
    expect(first).toContain("Rusça → Türkçe");
    expect(first).toContain("Merhaba, daire arıyorum");
    expect(first).toContain("Orijinal: Здравствуйте");

    await hook("R2", { audioMessage: { mimetype: "audio/ogg", seconds: 4 } });
    await new Promise((r) => setTimeout(r, 80));
    expect(ai).toContain("audio");
    const voice = bx.filter((c) => c.method === "imconnector.send.messages").at(-1)!.body.MESSAGES[0].message;
    expect(voice.text).toContain("🎤 Sesli mesaj: Merhaba, daire arıyorum");
    expect(voice.files).toHaveLength(1);

    await hook("R3", { conversation: "Бюджет 300 тысяч долларов, Анталья" });
    await new Promise((r) => setTimeout(r, 150));
    const comment = bx.find((c) => c.method === "crm.timeline.comment.add");
    expect(comment?.body.fields).toMatchObject({ ENTITY_ID: 55, ENTITY_TYPE: "lead" });
    expect(comment?.body.fields.COMMENT).toContain("sıcak müşteri (82/100)");
    expect(bx.find((c) => c.method === "crm.lead.update")?.body).toMatchObject({ id: 55, fields: { OPPORTUNITY: 300000, CURRENCY_ID: "USD" } });

    const reply = (text: string) =>
      fetch(
        `${base}/b24/events`,
        formPost({
          event: "ONIMCONNECTORMESSAGEADD",
          "data[CONNECTOR]": CONNECTOR_ID,
          "data[LINE]": "3",
          "data[MESSAGES][0][im][chat_id]": "9",
          "data[MESSAGES][0][im][message_id]": "10",
          "data[MESSAGES][0][message][id]": "10",
          "data[MESSAGES][0][message][user_id]": "2",
          "data[MESSAGES][0][message][text]": text,
          "data[MESSAGES][0][chat][id]": "79161234567",
          "auth[member_id]": MEMBER,
          "auth[application_token]": "app-token", "auth[access_token]": "tok-2",
        }),
      );
    await reply("Fiyat 3 milyon");
    await new Promise((r) => setTimeout(r, 80));
    const sends = evo.filter((c) => c.url === `/message/sendText/${instance}`);
    expect(sends.at(-1)?.body).toMatchObject({ number: "79161234567", text: "Цена 3 миллиона" });
    await reply("!Antalya");
    await new Promise((r) => setTimeout(r, 80));
    expect(evo.filter((c) => c.url === `/message/sendText/${instance}`).at(-1)?.body.text).toBe("Antalya");

    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const t = home.match(/const T="([^"]+)"/)?.[1];
    const stats = await (await fetch(`${base}/b24/panel/stats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, days: 7 }) })).json();
    expect(stats.waiting).toEqual([]);
    expect(stats.foreign).toBe(1);
    expect(stats.agents.find((a: any) => a.id === "2")).toMatchObject({ replies: 2 });
    expect(stats.agents.find((a: any) => a.id === "2").avgSec).toBeGreaterThanOrEqual(0);
    expect(stats.lines[0]).toMatchObject({ line: "3", inbound: 3, outbound: 2, newChats: 1 });
    expect(stats.hot[0]).toMatchObject({ score: 82, temperature: "sıcak", lang: "ru" });
    expect(stats.series).toHaveLength(7);
    expect(stats.series.at(-1)).toMatchObject({ inbound: 3, outbound: 2 });
    expect(stats.hours.reduce((a: number, b: number) => a + b, 0)).toBe(3);
    expect(stats.lines[0].medianSec).toBeGreaterThanOrEqual(0);
    const filtered = await (await fetch(`${base}/b24/panel/stats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, days: 90, line: "999" }) })).json();
    expect(filtered.series).toHaveLength(90);
    expect(filtered.lines).toEqual([]);
  });

  it("numara ayarları: arama bildirimi, grup sohbeti ve silinen/düzenlenen mesajlar", async () => {
    const { base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    const hook = (payload: unknown) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instance, ...(payload as object) }) });
    const sent = () => bx.filter((c) => c.method === "imconnector.send.messages").map((c) => c.body.MESSAGES[0]);
    const wait = () => new Promise((r) => setTimeout(r, 80));

    await hook({ event: "call", data: { id: "C1", from: "905551112233@s.whatsapp.net", status: "offer", isVideo: false } });
    await wait();
    expect(sent().at(-1)).toMatchObject({ chat: { id: "905551112233" }, message: { text: expect.stringContaining("WhatsApp araması") } });

    await hook({ event: "messages.upsert", data: { key: { id: "D1", remoteJid: "905551112233@s.whatsapp.net" }, message: { protocolMessage: { type: 0, key: { id: "X" } } } } });
    await wait();
    expect(sent().at(-1)?.message.text).toContain("sildi");
    await hook({ event: "messages.upsert", data: { key: { id: "E1", remoteJid: "905551112233@s.whatsapp.net" }, message: { protocolMessage: { type: 14, editedMessage: { conversation: "Yeni fiyat?" } } } } });
    await wait();
    expect(sent().at(-1)?.message.text).toContain("düzenledi: Yeni fiyat?");

    // Grup kapalıyken aktarılmaz
    const before = sent().length;
    const group = () => hook({ event: "messages.upsert", data: { key: { id: `G${Math.random()}`, remoteJid: "1203630001@g.us", participant: "905559998877@s.whatsapp.net" }, pushName: "Ali", message: { conversation: "Grup selam" } } });
    await group();
    await wait();
    expect(sent().length).toBe(before);

    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const t = home.match(/const T="([^"]+)"/)?.[1];
    const opt = await (await fetch(`${base}/b24/panel/connection/options`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, line: "3", calls: false, groups: true, edits: true }) })).json();
    expect(opt.options).toEqual({ calls: false, groups: true, edits: true });
    await group();
    await wait();
    expect(sent().at(-1)).toMatchObject({ chat: { id: "1203630001@g.us", name: "WhatsApp grubu" }, user: { id: "905559998877", name: "Ali" }, message: { text: "Grup selam" } });

    // Gruba cevap grup kimliğine gider; arama bildirimi kapalı
    await fetch(`${base}/b24/events`, formPost({ event: "ONIMCONNECTORMESSAGEADD", "data[CONNECTOR]": CONNECTOR_ID, "data[LINE]": "3", "data[MESSAGES][0][im][chat_id]": "5", "data[MESSAGES][0][message][id]": "6", "data[MESSAGES][0][message][text]": "Merhaba grup", "data[MESSAGES][0][chat][id]": "1203630001@g.us", "auth[member_id]": MEMBER, "auth[application_token]": "app-token", "auth[access_token]": "tok-2" }));
    await wait();
    expect(evo.filter((c) => c.url === `/message/sendText/${instance}`).at(-1)?.body).toMatchObject({ number: "1203630001@g.us", text: "Merhaba grup" });
    const count = sent().length;
    await hook({ event: "call", data: { id: "C2", from: "905551112233@s.whatsapp.net", status: "offer" } });
    await wait();
    expect(sent().length).toBe(count);

    const state = await (await fetch(`${base}/b24/panel/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t }) })).json();
    expect(state.connections[0]).toMatchObject({ line: "3", status: "connected", options: { groups: true }, chats: expect.any(Number) });
    expect(state.connections[0].connectedAt).toBeTruthy();
  });

  it("lisans: deneme ilk bağlantıda başlar, dolunca mesaj durur, havale onayı ve kod ile açılır", async () => {
    const { store, base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const t = home.match(/const T="([^"]+)"/)?.[1];
    const panel = async (path: string, body: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/b24/panel/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });
      return { status: r.status, body: await r.json() };
    };
    let billing = await panel("billing/state");
    expect(billing.body.licenses[0]).toMatchObject({ line: "3", status: "trial", daysLeft: 7 });
    expect(billing.body.periods.find((p: any) => p.months === 12)).toMatchObject({ discount: 35, perLine: Math.round(750 * 12 * 0.65) });

    // Deneme biter
    const portal = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    portal.lines["3"].license = { trialStart: new Date(Date.now() - 8 * 86_400_000).toISOString() };
    await store.put("b24-portal", MEMBER, portal, "b24-connector");
    const instance = instanceName(MEMBER, "3");
    const inbound = (id: string) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id, remoteJid: "905551112233@s.whatsapp.net" }, message: { conversation: "Merhaba" } } }) });
    const forwarded = () => bx.filter((c) => c.method === "imconnector.send.messages").length;
    const before = forwarded();
    await inbound("L1");
    await new Promise((r) => setTimeout(r, 80));
    expect(forwarded()).toBe(before);
    await fetch(`${base}/b24/events`, formPost({ event: "ONIMCONNECTORMESSAGEADD", "data[CONNECTOR]": CONNECTOR_ID, "data[LINE]": "3", "data[MESSAGES][0][message][text]": "Cevap", "data[MESSAGES][0][chat][id]": "905551112233", "auth[member_id]": MEMBER, "auth[application_token]": "app-token", "auth[access_token]": "tok-2" }));
    await new Promise((r) => setTimeout(r, 80));
    expect(evo.some((c) => c.url === `/message/sendText/${instance}`)).toBe(false);
    billing = await panel("billing/state");
    expect(billing.body.licenses[0].status).toBe("expired");

    // Havale bildirimi
    const request = await panel("billing/request", { lines: ["3"], months: 3 });
    expect(request.body.request).toMatchObject({ status: "pending", amount: Math.round(750 * 3 * 0.9), currency: "TRY", months: 3 });
    expect(request.body.request.reference).toMatch(/^XRE-[0-9A-F]{6}$/);

    // XRE yönetimi onaylar (yalnız CRM sahibi)
    const setupOwner = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "XRE", email: "xre@x.test", password: "Yonetici123" }) });
    const cookie = (setupOwner.headers.get("set-cookie") || "").split(";")[0];
    const admin = (path: string, body?: unknown) =>
      fetch(`${base}/api/b24-admin/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect((await fetch(`${base}/api/b24-admin/state`)).status).toBe(401);
    const adminState = await (await admin("state")).json();
    expect(adminState.payments[0]).toMatchObject({ status: "pending", domain: DOMAIN });
    expect(adminState.portals[0].lines[0]).toMatchObject({ line: "3", status: "expired" });
    expect((await admin(`payments/${request.body.request.id}/approve`, {})).status).toBe(200);
    billing = await panel("billing/state");
    expect(billing.body.licenses[0]).toMatchObject({ status: "active" });
    expect(billing.body.licenses[0].daysLeft).toBeGreaterThan(85);
    await inbound("L2");
    await new Promise((r) => setTimeout(r, 80));
    expect(forwarded()).toBe(before + 1);

    // Lisans kodu
    const codes = await (await admin("codes", { months: 12, maxLines: 1, count: 1 })).json();
    const code = codes.codes[0].id;
    const redeemed = await panel("billing/redeem", { code: code.toLowerCase(), lines: ["3"] });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.licenses[0].daysLeft).toBeGreaterThan(450);
    expect((await panel("billing/redeem", { code, lines: ["3"] })).status).toBe(409);

    // Fiyat güncelleme
    const pricing = await (await admin("pricing", { monthly: 900, trialDays: 14, discounts: { "12": 40 }, bank: { iban: "tr00 0000", holder: "XRE" } })).json();
    expect(pricing.pricing).toMatchObject({ monthly: 900, trialDays: 14, discounts: { "12": 40 }, bank: { iban: "TR00 0000", holder: "XRE" } });
  });

  it("AI asistan bilgi tabanından cevap verir, temsilci yazınca susar, gerektiğinde devreder", async () => {
    process.env.XRE_OPENAI_API_KEY = "sk-test";
    setAgentMergeDelay(20);
    const prompts: any[] = [];
    let next = { reply: "1+1 daireler 4,2 milyon TL'den başlar.", handoff: false, reason: "" };
    setAiFetch((async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      const name = body.response_format.json_schema.name;
      let content: unknown = { language: "tr", translation: "" };
      if (name === "agent_reply") {
        prompts.push(body.messages);
        content = next;
      } else if (name === "lead_qualification")
        content = { summary: "", budget: null, currency: "", location: "", property_type: "", rooms: "", purpose: "", timeline: "", score: 10, temperature: "soğuk", next_step: "" };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }) as any);
    try {
      const { base, bx, evo } = await setup({ evoState: "open" });
      await install(base);
      await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
      const t = settingsTicket(MEMBER, "all");
      const post = (p: string, body: object) => fetch(`${base}/b24/panel/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });
      const knowledge = "Deniz Konakları, Kartal. 1+1 daireler 4,2 milyon TL. " + "x".repeat(20000);
      const saved = await (await post("agent/save", { enabled: true, name: "Ece", company: "XRE", knowledge, lines: "all", schedule: "always" })).json();
      expect(saved.agent).toMatchObject({ enabled: true, name: "Ece", lines: "all" });
      expect(saved.agent.knowledge.length).toBeGreaterThan(20000);

      // Deneme sohbeti müşteriye bir şey göndermez
      const before = evo.length;
      const trial = await (await post("agent/test", { messages: [{ from: "müşteri", text: "Fiyatlar nedir?" }] })).json();
      expect(trial.reply).toContain("4,2 milyon");
      expect(evo.length).toBe(before);

      const instance = instanceName(MEMBER, "3");
      const hook = (id: string, jid: string, text: string) =>
        fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id, remoteJid: `${jid}@s.whatsapp.net` }, pushName: "Ayşe", message: { conversation: text } } }),
        });
      const sendsTo = (n: string) => evo.filter((c) => c.url === `/message/sendText/${instance}` && c.body.number === n);
      // Art arda iki mesaj tek cevapla karşılanır
      await hook("A1", "905301112233", "Merhaba");
      await hook("A2", "905301112233", "Kartal projesinin fiyatı nedir?");
      await new Promise((r) => setTimeout(r, 200));
      expect(sendsTo("905301112233")).toHaveLength(1);
      expect(sendsTo("905301112233")[0].body.text).toContain("4,2 milyon");
      expect(prompts).toHaveLength(2); // deneme + gerçek
      expect(prompts[1][0].content).toContain("Deniz Konakları");
      expect(JSON.parse(prompts[1][1].content).conversation.map((m: any) => m.text)).toEqual(["Merhaba", "Kartal projesinin fiyatı nedir?"]);
      const mirrored = bx.filter((c) => c.method === "imconnector.send.messages").at(-1)!.body.MESSAGES[0].message.text;
      expect(mirrored).toContain("🤖 Ece cevapladı");

      // Temsilci Bitrix'ten yazınca asistan o sohbete karışmaz
      await fetch(
        `${base}/b24/events`,
        formPost({
          event: "ONIMCONNECTORMESSAGEADD",
          "data[CONNECTOR]": CONNECTOR_ID,
          "data[LINE]": "3",
          "data[MESSAGES][0][im][chat_id]": "9",
          "data[MESSAGES][0][im][message_id]": "11",
          "data[MESSAGES][0][message][id]": "11",
          "data[MESSAGES][0][message][user_id]": "2",
          "data[MESSAGES][0][message][text]": "Ben Kaan, yardımcı olayım.",
          "data[MESSAGES][0][chat][id]": "905301112233",
          "auth[member_id]": MEMBER,
          "auth[application_token]": "app-token", "auth[access_token]": "tok-2",
        }),
      );
      await new Promise((r) => setTimeout(r, 80));
      await hook("A3", "905301112233", "Yer görmek istiyorum");
      await new Promise((r) => setTimeout(r, 200));
      expect(prompts).toHaveLength(2);
      expect(sendsTo("905301112233").map((c) => c.body.text)).toEqual(["1+1 daireler 4,2 milyon TL'den başlar.", "Ben Kaan, yardımcı olayım."]);

      // Devir: sonrasında asistan susar, müşteri temsilci beklemeye devam eder
      next = { reply: "Sizi temsilcimize aktarıyorum.", handoff: true, reason: "Pazarlık" };
      await hook("B1", "905309998877", "Son fiyat ne olur?");
      await new Promise((r) => setTimeout(r, 200));
      expect(sendsTo("905309998877")).toHaveLength(1);
      expect(bx.filter((c) => c.method === "imconnector.send.messages").at(-1)!.body.MESSAGES[0].message.text).toContain("Temsilciye devredildi: Pazarlık");
      await hook("B2", "905309998877", "Bekliyorum");
      await new Promise((r) => setTimeout(r, 200));
      expect(sendsTo("905309998877")).toHaveLength(1);
      const stats = await (await post("stats", { days: 1 })).json();
      expect(stats.waiting.map((w: any) => w.phone)).toContain("905309998877");
      const state = await (await post("agent/state", {})).json();
      expect(state.usage).toMatchObject({ today: 2, replies30: 2, handoffs30: 1 });

      // Kapatınca cevap vermez
      await post("agent/save", { enabled: false });
      await hook("C1", "905305554433", "Merhaba");
      await new Promise((r) => setTimeout(r, 200));
      expect(sendsTo("905305554433")).toHaveLength(0);
    } finally {
      setAgentMergeDelay(null);
    }
  });

  it("asistan mesai dışı modu ve rapor zamanlaması", () => {
    const cfg = { ...DEFAULT_AGENT, schedule: "offhours" as const };
    expect(inWorkingHours(cfg, new Date("2026-10-14T08:00:00Z"))).toBe(true); // Çarşamba 11:00
    expect(inWorkingHours(cfg, new Date("2026-10-14T17:00:00Z"))).toBe(false); // 20:00
    expect(inWorkingHours(cfg, new Date("2026-10-18T08:00:00Z"))).toBe(false); // Pazar
    const r = { ...DEFAULT_REPORTS, daily: true, weekly: true, monthly: true, hour: 9 };
    expect(dueReports(r, Date.parse("2026-10-12T05:00:00Z"))).toEqual([]); // Pazartesi 08:00
    expect(dueReports(r, Date.parse("2026-10-12T07:00:00Z")).map((d) => d.period)).toEqual(["daily", "weekly"]);
    expect(dueReports({ ...r, lastSent: { daily: "2026-10-12" } }, Date.parse("2026-10-12T07:00:00Z")).map((d) => d.period)).toEqual(["weekly"]);
    expect(dueReports(r, Date.parse("2026-11-01T07:00:00Z")).map((d) => d.period)).toEqual(["daily", "monthly"]);
  });

  it("canlı monitör ve AI yönetici raporu", async () => {
    process.env.XRE_OPENAI_API_KEY = "sk-test";
    setAiFetch((async (_url: string, init: any) => {
      const name = JSON.parse(init.body).response_format.json_schema.name;
      const content =
        name === "manager_report"
          ? { headline: "Yoğun ve hızlı bir gün.", summary: "Ekip hızlı cevap verdi.", highlights: ["Cevap süresi düşük"], risks: ["<script>alert(1)</script>"], actions: ["Sahibinden ilanlarını artırın"] }
          : { language: "tr", translation: "" };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }) as any);
    const { base, evo, bx } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id: "L1", remoteJid: "905301112233@s.whatsapp.net" }, pushName: "Ayşe", message: { conversation: "Merhaba fiyat nedir" } } }),
    });
    await new Promise((r) => setTimeout(r, 80));
    const t = settingsTicket(MEMBER, "all");
    const post = (p: string, body: object) => fetch(`${base}/b24/panel/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });

    const live = await (await post("live", {})).json();
    expect(live.online.map((u: any) => u.name)).toEqual(["Erdal"]);
    expect(live.totalUsers).toBe(3);
    expect(live.activeChats).toBe(1);
    expect(live.waiting).toBe(1);
    expect(live.today.inbound).toBe(1);
    expect(live.feed[0]).toMatchObject({ from: "müşteri", text: "Merhaba fiyat nedir", phone: "905301112233" });
    expect(live.crm).toMatchObject({ available: true, won: 1, wonAmount: { TRY: 2500000 }, bySource: { "Web sitesi": 2, Sahibinden: 1 } });
    expect(live.crm.deals[0]).toMatchObject({ title: "Daire satışı", amount: 4200000 });

    // Rapor ayarı: telefon olunca gönderim hattı zorunlu
    expect((await post("reports/save", { daily: true, phones: ["0532 111 22 33"] })).status).toBe(400);
    const saved = await (await post("reports/save", { daily: true, hour: 8, phones: "0532 111 22 33\n+90 533 000 00 00", line: "3", userIds: ["1"] })).json();
    expect(saved.settings).toMatchObject({ daily: true, hour: 8, phones: ["905321112233", "905330000000"], line: "3", userIds: ["1"] });

    const created = await (await post("reports/create", { period: "weekly", send: true })).json();
    expect(created.url).toMatch(/^https:\/\/crm\.xre\.test\/b24\/report\/[\w-]{20,}$/);
    expect(created.delivery).toEqual({ sent: 3, errors: [] });
    const sent = evo.filter((c) => c.url === `/message/sendText/${instance}` && c.body.number === "905321112233");
    expect(sent[0].body.text).toContain(created.url);
    expect(sent[0].body.text).toContain("Yoğun ve hızlı bir gün.");
    expect(bx.find((c) => c.method === "im.notify.system.add")?.body).toMatchObject({ USER_ID: 1 });

    const page = await fetch(created.url.replace("https://crm.xre.test", base));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toContain("no-store");
    const html = await page.text();
    expect(html).toContain("Haftalık yönetici raporu");
    expect(html).toContain("Yoğun ve hızlı bir gün.");
    expect(html).toContain("Sahibinden");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect((await fetch(`${base}/b24/report/olmayan-rapor-anahtari-123`)).status).toBe(404);

    const list = await (await post("reports/state", {})).json();
    expect(list.reports).toHaveLength(1);
    expect(list.reports[0]).toMatchObject({ period: "weekly", headline: "Yoğun ve hızlı bir gün." });
    expect(list.lines).toEqual([expect.objectContaining({ id: "3", open: true })]);
    // Yetkisiz bilet panele erişemez
    const bad = await fetch(`${base}/b24/panel/live`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    expect(bad.status).toBe(401);
  });

  it("İngilizce arayüz: panelde çevrilmemiş metin kalmaz, JS bozulmaz", () => {
    const html = panelHtml("ticket", "demo.bitrix24.com", "en");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Connections");
    expect(html).toContain("AI Assistant");
    const script = html.split("<script>")[1].split("</script>")[0];
    expect(() => new Function(script)).not.toThrow();
    // Stil dışında kalan Türkçe karakterler yalnız veri anahtarları olabilir (müşteri, sıcak, ılık, soğuk)
    const body = html.split("</style>")[1].replace(/"(müşteri|sıcak|ılık|soğuk)"/g, "");
    expect(body.match(/[^\s<>"']*[ğüşıöçĞÜŞİÖÇ][^\s<>"']*/g) || []).toEqual([]);
    // Türkçe karakter içermeyen kısa Türkçe kelimeler de dizgilerde kalmamalı
    const pieces = (script.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).flatMap((lit) => lit.slice(1, -1).split(/[<>"]|(?<!\\)'/).map((p) => p.trim()));
    const turkishWords = ["dk", "sn", "sa", "saat", "gecikti", "gelen", "giden", "indirim", "Banka:", "Referans:", "Kart", "Liste", "Durum", "Kaydet", "Sil", "Ayarlar", "Personel", "Roller"];
    expect(pieces.filter((p) => turkishWords.includes(p))).toEqual([]);
    expect(localizeMessage("Rol adı gerekli.", "en")).toBe("A role name is required.");
    expect(localizeMessage("Bu kod en fazla 3 numara için geçerli.", "en")).toBe("This code is valid for at most 3 numbers.");
    expect(localizeMessage("Rol adı gerekli.", "tr")).toBe("Rol adı gerekli.");
  });

  it("İngilizce portal: notlar, çeviri ve hata mesajları İngilizce", async () => {
    process.env.XRE_OPENAI_API_KEY = "sk-test";
    const targets: string[] = [];
    setAiFetch((async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      const name = body.response_format.json_schema.name;
      if (name === "translation") targets.push(body.messages[0].content);
      const content =
        name === "translation"
          ? { language: "de", translation: "Hello, I am looking for a flat" }
          : name === "outgoing_translation"
            ? { translation: "Der Preis beträgt 300.000" }
            : { language: "en", translation: "" };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    }) as any);
    const { base, bx, evo } = await setup({ evoState: "open" });
    const installed = await fetch(`${base}/b24/install`, formPost({ LANG: "en", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "ref-1" }));
    expect(await installed.text()).toContain("Installation complete");
    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "en", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    expect(home).toContain("Add number");
    const user = await (await fetch(`${base}/b24/app`, formPost({ LANG: "en", member_id: MEMBER, DOMAIN, AUTH_ID: "user-auth" }))).text();
    expect(user).toContain("Your WhatsApp numbers");
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id: "E1", remoteJid: "4915112345678@s.whatsapp.net" }, pushName: "Jonas", message: { conversation: "Hallo, ich suche eine Wohnung" } } }),
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(targets[0]).toContain("translate it into English");
    const shown = bx.filter((c) => c.method === "imconnector.send.messages").at(-1)!.body.MESSAGES[0].message.text;
    expect(shown).toContain("🌐 German → English:");
    expect(shown).toContain("Original: Hallo");
    await fetch(
      `${base}/b24/events`,
      formPost({
        event: "ONIMCONNECTORMESSAGEADD",
        "data[CONNECTOR]": CONNECTOR_ID,
        "data[LINE]": "3",
        "data[MESSAGES][0][im][chat_id]": "9",
        "data[MESSAGES][0][im][message_id]": "10",
        "data[MESSAGES][0][message][id]": "10",
        "data[MESSAGES][0][message][user_id]": "2",
        "data[MESSAGES][0][message][text]": "The price is 300,000",
        "data[MESSAGES][0][chat][id]": "4915112345678",
        "auth[member_id]": MEMBER,
        "auth[application_token]": "app-token",
        "auth[access_token]": "tok-2",
      }),
    );
    await new Promise((r) => setTimeout(r, 80));
    expect(evo.filter((c) => c.url === `/message/sendText/${instance}`).at(-1)?.body.text).toBe("Der Preis beträgt 300.000");
    const t = settingsTicket(MEMBER, "all");
    const bad = await (await fetch(`${base}/b24/panel/role/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, lang: "en", name: "" }) })).json();
    expect(bad.message).toBe("A role name is required.");
  });

  it("kaldırınca müşteri verisi silinir, lisans korunur; yasal sayfalar ve REST kaydı", async () => {
    const { base, store, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id: "U1", remoteJid: "905301112233@s.whatsapp.net" }, pushName: "Ayşe", message: { conversation: "Merhaba" } } }),
    });
    await new Promise((r) => setTimeout(r, 80));
    const portal = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    portal.lines["3"].license = { trialStart: "2026-01-01T00:00:00.000Z", paidUntil: "2099-01-01T00:00:00.000Z" };
    await store.put("b24-portal", MEMBER, portal, "b24-connector");
    expect((await store.list("b24-chat", "b24-connector")).length).toBe(1);

    const res = await fetch(`${base}/b24/events`, formPost({ event: "ONAPPUNINSTALL", "auth[member_id]": MEMBER, "auth[application_token]": "app-token", "auth[access_token]": "tok-2" }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 80));
    expect(evo.some((c) => c.url === `/instance/logout/${instance}`)).toBe(true);
    const after = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    expect(after).toMatchObject({ active: false, accessToken: "", refreshToken: "" });
    expect(after.applicationToken).toBeUndefined();
    expect(after.lines["3"]).toMatchObject({ status: "disconnected", license: { paidUntil: "2099-01-01T00:00:00.000Z" } });
    expect(await store.list("b24-chat", "b24-connector")).toEqual([]);
    expect(await store.list("b24-stat", "b24-connector")).toEqual([]);

    // Yeniden kurulum lisansı korur
    expect((await install(base)).status).toBe(200);
    expect((await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload.lines["3"].license.paidUntil).toBe("2099-01-01T00:00:00.000Z");

    process.env.B24_VENDOR_NAME = "XRE Yazılım <A.Ş.>";
    process.env.B24_SUPPORT_EMAIL = "support@example.com";
    const terms = await (await fetch(`${base}/b24/legal/terms`)).text();
    expect(terms).toContain("End User License Agreement");
    expect(terms).toContain("XRE Yazılım &lt;A.Ş.&gt;");
    expect(terms).toContain("XRE WhatsApp");
    const privacy = await (await fetch(`${base}/b24/legal/privacy?lang=tr`)).text();
    expect(privacy).toContain("Gizlilik Politikası");
    expect(privacy).toContain("support@example.com");
    expect((await fetch(`${base}/b24/support`)).status).toBe(200);

    // REST kayıtları: belirteç yazılmaz
    const dir = path.join(process.env.XRE_DATA_DIR!, "b24-rest");
    const log = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
    expect(log).toContain('"method":"imconnector.register"');
    expect(log).not.toContain("tok-2");
  });
});

