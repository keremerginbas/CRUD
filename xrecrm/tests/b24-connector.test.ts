import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { CONNECTOR_ID, checkLineHealth, instanceName, portalById, setB24Fetch, settingsTicket } from "../server/b24-connector";
import { setAiFetch } from "../server/b24-ai";
import { inWorkingHours, setAgentMergeDelay, DEFAULT_AGENT } from "../server/b24-agent";
import { dueReports, DEFAULT_REPORTS } from "../server/b24-live";
import { panelHtml } from "../server/b24-panel-html";
import { localizeMessage } from "../server/b24-i18n";
import { normalizeRecipient, setCampaignGap, setMetaFetch } from "../server/b24-campaigns";
import { revenueMetrics, runBillingReminders, setOwnerNotifyFetch, DEFAULT_PRICING } from "../server/b24-billing";

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
      if (refreshToken?.startsWith("mref") && new URL(url).searchParams.get("client_id") !== "market.app") return { error: "invalid_client" };
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
    if (method === "crm.lead.get") return { result: { ID: String(body.id), TITLE: "Web lead", NAME: "Ayşe", LAST_NAME: "Y.", PHONE: [{ VALUE: "+90 530 111 22 33" }], CONTACT_ID: null } };
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
    expect(register?.body).toMatchObject({ ID: CONNECTOR_ID, NAME: "WhatsApp by XRE", PLACEMENT_HANDLER: "https://crm.xre.test/b24/settings" });
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
    // Bitrix'in otomatik karşılama/değerlendirme mesajları kapalı açılır
    expect(bx.find((c) => c.method === "imopenlines.config.add")?.body.PARAMS).toEqual({ LINE_NAME: "Satış 7124 (WhatsApp)", WELCOME_MESSAGE: "N", VOTE_MESSAGE: "N", AGREEMENT_MESSAGE: "N", CLOSE_RULE: "none", AUTO_CLOSE_RULE: "none", NO_ANSWER_RULE: "none", WORKTIME_DAYOFF_RULE: "none" });
    bx.length = 0;
    await call("settings/save", { botMessages: true });
    expect(bx.find((c) => c.method === "imopenlines.config.update")?.body).toEqual(expect.objectContaining({ CONFIG_ID: "7", PARAMS: { WELCOME_MESSAGE: "Y", VOTE_MESSAGE: "Y" } }));
    await call("settings/save", { botMessages: false });

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

    // Personel panel yerine sohbet ekranını görür; yalnız kendi rolündeki numaralar.
    const kaan = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "user-auth" }))).text();
    expect(kaan).not.toContain("Numara ekle");
    const chatLines = async (pageHtml: string) => {
      const ct = JSON.parse(pageHtml.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]).t;
      return (await (await fetch(`${base}/b24/chat/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct }) })).json()).lines.map((l: any) => l.name);
    };
    expect(await chatLines(kaan)).toEqual(["Satış 7124"]);
    const merve = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "merve-auth" }))).text();
    expect(await chatLines(merve)).toEqual([]);
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
    expect(billing.body.periods.find((p: any) => p.months === 12)).toMatchObject({ discount: 35, perLine: 273 });
    // Deneme süresinde portal Pro+ sayılır
    expect(billing.body.plan).toMatchObject({ plan: "proplus", source: "trial" });
    expect(billing.body.plans.map((p: any) => [p.id, p.monthly])).toEqual([["basic", 15], ["pro", 25], ["proplus", 35]]);
    expect((await panel("live")).status).toBe(200);

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
    const request = await panel("billing/request", { lines: ["3"], months: 3, plan: "basic" });
    expect(request.body.request).toMatchObject({ status: "pending", amount: 40.5, currency: "USD", months: 3, plan: "basic" });
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
    expect(billing.body.licenses[0]).toMatchObject({ status: "active", plan: "basic" });
    expect(billing.body.licenses[0].daysLeft).toBeGreaterThan(85);
    // Basic: canlı izleme, performans, AI asistan ve raporlar kapalı
    expect(billing.body.plan).toMatchObject({ plan: "basic", source: "paid", features: { live: false, agent: false, translate: false } });
    const locked = await panel("live");
    expect(locked.status).toBe(402);
    expect(locked.body.message).toContain("Pro paketinde");
    expect((await panel("stats", { days: 7 })).status).toBe(402);
    expect((await panel("agent/save", { enabled: true })).status).toBe(402);
    expect((await panel("reports/save", { daily: true, userIds: ["1"] })).status).toBe(402);
    expect((await panel("agent/save", { enabled: false })).status).toBe(200);
    await inbound("L2");
    await new Promise((r) => setTimeout(r, 80));
    expect(forwarded()).toBe(before + 1);

    // Lisans kodu
    const codes = await (await admin("codes", { months: 12, maxLines: 1, count: 1 })).json();
    const code = codes.codes[0].id;
    const redeemed = await panel("billing/redeem", { code: code.toLowerCase(), lines: ["3"] });
    expect(redeemed.status).toBe(200);
    expect(redeemed.body.licenses[0].daysLeft).toBeGreaterThan(450);
    // Kod Pro+ paketinde: özellikler açılır
    expect(redeemed.body.licenses[0].plan).toBe("proplus");
    expect((await panel("live")).status).toBe(200);
    expect((await panel("billing/redeem", { code, lines: ["3"] })).status).toBe(409);

    // Fiyat güncelleme
    const pricing = await (await admin("pricing", { plans: { basic: 12.5, pro: 20, proplus: 30 }, trialDays: 14, discounts: { "12": 40 }, bank: { iban: "tr00 0000", holder: "XRE" } })).json();
    expect(pricing.pricing).toMatchObject({ plans: { basic: 12.5, pro: 20, proplus: 30 }, monthly: 30, trialDays: 14, discounts: { "12": 40 }, bank: { iban: "TR00 0000", holder: "XRE" } });
  });

  it("Pro kampanya: Meta hesabı bağlanır, önizleme, tek test ve izinli toplu gönderim; Basic pakette kapalı", async () => {
    expect(normalizeRecipient("0532 111 22 33")).toBe("905321112233");
    expect(normalizeRecipient("5321112233")).toBe("905321112233");
    expect(normalizeRecipient("0049 151 1234 5678")).toBe("4915112345678");
    expect(normalizeRecipient("123")).toBeNull();
    const sent: any[] = [];
    setCampaignGap(5);
    setMetaFetch((async (url: string, init: any) => {
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (init?.headers?.authorization !== "Bearer meta-token") return json({ error: { message: "Invalid OAuth access token." } }, 401);
      if (url.includes("/111?fields=")) return json({ display_phone_number: "+90 555 000 00 00", verified_name: "Demo Emlak" });
      if (url.includes("/222/message_templates")) return json({ data: [
        { name: "kampanya_ekim", language: "tr", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Merhaba {{1}}, yeni projemiz yayında." }] },
        { name: "taslak", language: "tr", status: "PENDING", components: [] },
      ] });
      if (url.endsWith("/111/messages")) {
        const body = JSON.parse(init.body);
        sent.push(body);
        if (body.to === "905000000000") return json({ error: { message: "Recipient phone number not in allowed list" } }, 400);
        return json({ messages: [{ id: `wamid.${sent.length}`, message_status: "accepted" }] });
      }
      return json({ error: { message: "unexpected " + url } }, 404);
    }) as any);
    const { store, base } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const t = home.match(/const T="([^"]+)"/)?.[1];
    const panel = async (path: string, body: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/b24/panel/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });
      return { status: r.status, body: await r.json() };
    };
    // Deneme (Pro+) → kampanyalar açık
    expect((await panel("campaigns/state")).body.meta).toEqual({ connected: false });
    expect((await panel("meta/save", { phoneNumberId: "111", wabaId: "222", token: "yanlis" })).status).toBe(400);
    const saved = await panel("meta/save", { phoneNumberId: "111", wabaId: "222", token: "meta-token" });
    expect(saved.body.meta).toMatchObject({ connected: true, displayPhone: "+90 555 000 00 00", verifiedName: "Demo Emlak" });
    const stored = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    expect(stored.meta.token).not.toContain("meta-token");
    expect(JSON.stringify(saved.body)).not.toContain("meta-token");
    const templates = await panel("meta/templates");
    expect(templates.body.templates).toEqual([expect.objectContaining({ name: "kampanya_ekim", language: "tr", header: "IMAGE", vars: 1 })]);

    const base0 = { template: { name: "kampanya_ekim", language: "tr" }, headerImage: "https://example.test/a.jpg", bodyParams: ["{ad}"] };
    const preview = await panel("campaigns/send", { ...base0, mode: "preview", recipients: "05321112233\n905321112233\nabc\n4915112345678" });
    expect(preview.body).toMatchObject({ count: 2, duplicates: 1, invalid: ["abc"] });
    expect(sent).toHaveLength(0);
    const test = await panel("campaigns/send", { ...base0, mode: "test", recipients: [{ phone: "905321112233", name: "Ayşe" }] });
    expect(test.body.result).toMatchObject({ status: "accepted" });
    expect(sent[0]).toMatchObject({ to: "905321112233", template: { name: "kampanya_ekim", language: { code: "tr" }, components: [{ type: "header" }, { type: "body", parameters: [{ type: "text", text: "Ayşe" }] }] } });
    expect((await panel("campaigns/send", { ...base0, mode: "send", recipients: "905321112233" })).status).toBe(400);
    const started = await panel("campaigns/send", { ...base0, mode: "send", consent: true, name: "Ekim", recipients: "905321112233\n905000000000\n4915112345678" });
    expect(started.body.campaign).toMatchObject({ name: "Ekim", total: 3, pending: 3, status: "running" });
    await new Promise((r) => setTimeout(r, 150));
    const state = await panel("campaigns/state");
    expect(state.body.campaigns[0]).toMatchObject({ status: "done", accepted: 2, failed: 1, pending: 0 });
    const detail = await panel("campaigns/get", { id: started.body.campaign.id });
    expect(detail.body.recipients.find((r: any) => r.phone === "905000000000")).toMatchObject({ status: "failed", error: expect.stringContaining("allowed list") });

    // Basic pakete düşünce kampanyalar kapanır
    const portal = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    portal.lines["3"].license = { trialStart: new Date(Date.now() - 30 * 86_400_000).toISOString(), paidUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(), plan: "basic" };
    await store.put("b24-portal", MEMBER, portal, "b24-connector");
    expect((await panel("campaigns/state")).status).toBe(402);
    portal.lines["3"].license.plan = "pro";
    await store.put("b24-portal", MEMBER, portal, "b24-connector");
    expect((await panel("campaigns/state")).status).toBe(200);
    expect((await panel("agent/test", { messages: [{ from: "müşteri", text: "Merhaba" }] })).status).not.toBe(200);
  });

  it("lisans hatırlatmaları bir kez gider; havale bildirimi XRE'ye iletilir; gelir özeti hesaplanır", async () => {
    const hooks: any[] = [];
    process.env.B24_ADMIN_WEBHOOK = "https://hook.example.test/xre";
    setOwnerNotifyFetch((async (_url: string, init: any) => { hooks.push(JSON.parse(init.body)); return new Response("{}"); }) as any);
    try {
      const { store, base, bx } = await setup({ evoState: "open" });
      await install(base);
      await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
      expect(hooks.map((h) => h.event)).toContain("install");
      const portal = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
      expect(portal.adminIds?.length).toBeGreaterThan(0);
      // Deneme yarın bitiyor
      portal.lines["3"].license = { trialStart: new Date(Date.now() - 6 * 86_400_000).toISOString() };
      await store.put("b24-portal", MEMBER, portal, "b24-connector");
      const notes = () => bx.filter((c) => c.method === "im.notify.system.add");
      await runBillingReminders(store);
      expect(notes()).toHaveLength(portal.adminIds.length);
      expect(String(notes()[0].body.MESSAGE)).toContain("deneme");
      await runBillingReminders(store);
      expect(notes()).toHaveLength(portal.adminIds.length);

      // Havale bildirimi → XRE webhook'u
      const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
      const t = home.match(/const T="([^"]+)"/)?.[1];
      await fetch(`${base}/b24/panel/billing/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, lines: ["3"], months: 12, plan: "pro" }) });
      await new Promise((r) => setTimeout(r, 20));
      expect(hooks.find((h) => h.event === "payment_request")).toMatchObject({ domain: DOMAIN, plan: "pro", amount: 195, currency: "USD" });
    } finally {
      delete process.env.B24_ADMIN_WEBHOOK;
    }

    const now = Date.parse("2026-10-19T12:00:00Z");
    const day = 86_400_000;
    const portals: any[] = [
      { id: "a", domain: "a.bitrix24.com", active: true, lines: { "1": { license: { trialStart: new Date(now - 40 * day).toISOString(), paidUntil: new Date(now + 10 * day).toISOString(), plan: "pro" } }, "2": { license: { trialStart: new Date(now - 40 * day).toISOString(), paidUntil: new Date(now + 200 * day).toISOString(), plan: "pro" } } } },
      { id: "b", domain: "b.bitrix24.com", active: true, lines: { "1": { license: { trialStart: new Date(now - 5 * day).toISOString() } } } },
    ];
    const payments: any[] = [
      { status: "approved", amount: 195, currency: "USD", createdAt: "2026-10-02T00:00:00Z", decidedAt: "2026-10-03T00:00:00Z" },
      { status: "approved", amount: 15, currency: "USD", createdAt: "2026-08-02T00:00:00Z" },
      { status: "pending", amount: 35, currency: "USD", createdAt: "2026-10-18T00:00:00Z" },
    ];
    const m = revenueMetrics(portals, payments, { ...DEFAULT_PRICING }, now);
    expect(m).toMatchObject({ mrr: 50, thisMonth: 195, total: 210, pendingCount: 1, pendingAmount: 35, activeLines: 2, trials: 1, payingPortals: 1, conversion: 50, planMix: { pro: 1 } });
    expect(m.byMonth.map((x) => x.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(m.expiringSoon.map((x) => [x.domain, x.status])).toEqual([["b.bitrix24.com", "trial"], ["a.bitrix24.com", "active"]]);
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
    expect(user).toContain('"newChat":"New chat"');
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
    expect(terms).toContain("WhatsApp by XRE");
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

  it("yerel ve pazar yeri uygulama anahtarları birlikte çalışır", async () => {
    process.env.B24_MARKET_CLIENT_ID = "market.app";
    process.env.B24_MARKET_CLIENT_SECRET = "market-secret";
    const { base, bx, store } = await setup();
    const res = await fetch(`${base}/b24/install`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "mref-1" }));
    expect(res.status).toBe(200);
    const portal = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    expect(portal.clientId).toBe("market.app");
    // Önce yerel anahtar denendi ve reddedildi, sonra pazar yeri anahtarı kabul edildi
    const tried = bx.filter((c) => c.method === "oauth.refresh").map((c) => new URL(c.url).searchParams.get("client_id"));
    expect(tried).toEqual(["app.test", "market.app"]);
    // Süresi dolunca kendi uygulamasının anahtarıyla yenilenir
    await store.put("b24-portal", MEMBER, { ...portal, expiresAt: Date.now() - 1000 }, "b24-connector");
    bx.length = 0;
    await fetch(`${base}/b24/panel/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "all") }) });
    expect(bx.filter((c) => c.method === "oauth.refresh").map((c) => new URL(c.url).searchParams.get("client_id"))[0]).toBe("market.app");
  });

  it("sohbet ekranı ve CRM kart sekmesi: rol yetkisi, yazışma, gönderim", async () => {
    const { base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    // Kurulumda kart sekmeleri kaydedilir
    const binds = bx.filter((c) => c.method === "placement.bind");
    expect(binds.map((c) => c.body.PLACEMENT)).toEqual(["CRM_LEAD_DETAIL_TAB", "CRM_CONTACT_DETAIL_TAB", "CRM_DEAL_DETAIL_TAB", "CRM_COMPANY_DETAIL_TAB"]);
    expect(binds[0].body.HANDLER).toBe("https://crm.xre.test/b24/card");
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const t = settingsTicket(MEMBER, "all");
    const panel = (p: string, body: object) => fetch(`${base}/b24/panel/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) }).then((r) => r.json());
    const sales = await panel("role/save", { name: "Satış", lines: ["3"] });
    await panel("role/save", { name: "Diğer", lines: [], isDefault: true });
    await panel("user/role", { userId: "2", roleId: sales.role.id });

    const instance = instanceName(MEMBER, "3");
    await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance, data: { key: { id: "C1", remoteJid: "905301112233@s.whatsapp.net" }, pushName: "Ayşe", message: { conversation: "Merhaba, fiyat alabilir miyim?" } } }),
    });
    await new Promise((r) => setTimeout(r, 80));

    const ticketOf = async (auth: string) => {
      const html = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: auth }))).text();
      return JSON.parse(html.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]).t as string;
    };
    const kaan = await ticketOf("user-auth");
    const merve = await ticketOf("merve-auth");
    const chat = (p: string, ct: string, body: object = {}) => fetch(`${base}/b24/chat/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t: ct }) });

    const list = await (await chat("threads", kaan)).json();
    expect(list.threads).toEqual([expect.objectContaining({ line: "3", phone: "905301112233", name: "Ayşe", waiting: true })]);
    expect((await (await chat("threads", merve)).json()).threads).toEqual([]);
    expect((await chat("messages", merve, { line: "3", phone: "905301112233" })).status).toBe(403);

    const sent = await chat("send", kaan, { line: "3", phone: "905301112233", text: "Merhaba Ayşe Hanım, hemen gönderiyorum." });
    expect(sent.status).toBe(200);
    expect(evo.filter((c) => c.url === `/message/sendText/${instance}`).at(-1)?.body).toMatchObject({ number: "905301112233", text: "Merhaba Ayşe Hanım, hemen gönderiyorum." });
    const msgs = await (await chat("messages", kaan, { line: "3", phone: "905301112233" })).json();
    expect(msgs.messages.map((m: any) => [m.dir, m.text, m.byName || ""])).toEqual([
      ["in", "Merhaba, fiyat alabilir miyim?", ""],
      ["out", "Merhaba Ayşe Hanım, hemen gönderiyorum.", "Kaan"],
    ]);
    expect((await (await chat("threads", kaan)).json()).threads[0].waiting).toBe(false);
    // Yeni bir numaraya ilk mesaj
    expect((await chat("send", kaan, { line: "3", phone: "0532 999 88 77", text: "İlk mesaj" })).status).toBe(200);
    expect(evo.some((c) => c.body?.number === "905329998877")).toBe(true);
    // Yetkisiz bağlantıdan gönderilemez, bilet olmadan erişilemez
    expect((await chat("send", merve, { line: "3", phone: "905301112233", text: "x" })).status).toBe(403);
    expect((await chat("threads", "sahte")).status).toBe(401);
    expect((await fetch(`${base}/b24/chat/media/med_000000000000000000000000?t=${encodeURIComponent(kaan)}&line=3&phone=905301112233`)).status).toBe(404);

    // CRM lead kartı: lead'in telefonu bulunur, sohbet o numarayla açılır
    const card = await fetch(`${base}/b24/card`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "user-auth", PLACEMENT: "CRM_LEAD_DETAIL_TAB", PLACEMENT_OPTIONS: JSON.stringify({ ID: "55" }) }));
    const cfg = JSON.parse((await card.text()).match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]);
    expect(cfg).toMatchObject({ mode: "card", phones: ["905301112233"], title: "Ayşe Y." });
    const only = await (await chat("threads", cfg.t, { phones: cfg.phones })).json();
    expect(only.threads.map((x: any) => x.phone)).toEqual(["905301112233"]);
    // Sahte oturumla kart açılmaz
    expect((await fetch(`${base}/b24/card`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "yanlis", PLACEMENT: "CRM_LEAD_DETAIL_TAB" }))).status).toBe(401);
  });

  it("sohbet ekranından dosya ve ses kaydı gider; kopan bağlantı fark edilir ve gönderim durur", async () => {
    const evoState = { evoState: "open" };
    const { base, evo, store } = await setup(evoState);
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const html = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const chatUrl = html.match(/CHAT_URL="([^"]+)"/)![1];
    const ct = decodeURIComponent(chatUrl.match(/t=([^&]+)/)![1]);
    const instance = instanceName(MEMBER, "3");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const up = (body: Buffer, type: string, extra: Record<string, string> = {}) =>
      fetch(`${base}/b24/chat/upload`, { method: "POST", headers: { "content-type": type, "x-xre-ticket": ct, "x-line": "3", "x-phone": "905301112233", "x-file-name": encodeURIComponent("plan.png"), ...extra }, body: new Uint8Array(body) });
    const img = await up(png, "image/png", { "x-caption": encodeURIComponent("Kat planı") });
    expect(img.status).toBe(200);
    expect(evo.find((c) => c.url === `/message/sendMedia/${instance}`)?.body).toMatchObject({ number: "905301112233", mediatype: "image", caption: "Kat planı", fileName: "plan.png" });
    const voice = await up(Buffer.from("OggS-kayit"), "audio/webm", { "x-voice": "1", "x-file-name": "ses-kaydi.webm" });
    expect(voice.status).toBe(200);
    expect(evo.some((c) => c.url === `/message/sendWhatsAppAudio/${instance}`)).toBe(true);
    const chat = (p: string, body: object = {}) => fetch(`${base}/b24/chat/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t: ct }) });
    const msgs = (await (await chat("messages", { line: "3", phone: "905301112233" })).json()).messages;
    expect(msgs.map((m: any) => m.media?.type)).toEqual(["image", "audio"]);
    expect(msgs[0].text).toBe("Kat planı");
    const media = await fetch(`${base}/b24/chat/media/${msgs[0].media.id}?t=${encodeURIComponent(ct)}&line=3&phone=905301112233`);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    // Başkasının bileti olmadan yüklenemez
    expect((await fetch(`${base}/b24/chat/upload`, { method: "POST", headers: { "content-type": "image/png", "x-line": "3", "x-phone": "905301112233" }, body: new Uint8Array(png) })).status).toBe(401);

    // WhatsApp oturumu düştü: kontrol durumu düzeltir, gönderim açık bir hatayla durur
    evoState.evoState = "close";
    await checkLineHealth(store, (await portalById(store, MEMBER))!, "3");
    expect((await portalById(store, MEMBER))!.lines["3"].status).toBe("disconnected");
    const lines = (await (await chat("threads")).json()).lines;
    expect(lines[0]).toMatchObject({ line: "3", connected: false, status: "disconnected" });
    const blocked = await chat("send", { line: "3", phone: "905301112233", text: "Merhaba" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).message).toContain("QR okutun");
    // Yeniden bağlanınca kendiliğinden düzelir
    evoState.evoState = "open";
    await checkLineHealth(store, (await portalById(store, MEMBER))!, "3");
    expect((await portalById(store, MEMBER))!.lines["3"].status).toBe("connected");
  });

  it("her temsilcinin kendi Google Meet odası", async () => {
    const { base } = await setup({ evoState: "open" });
    await install(base);
    const ticketOf = async (auth: string) => {
      const html = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: auth }))).text();
      const m = html.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/);
      return m ? (JSON.parse(m[1]).t as string) : decodeURIComponent(html.match(/CHAT_URL="[^"]*t=([^&"]+)/)![1]);
    };
    const meet = (t: string, body: object = {}) => fetch(`${base}/b24/chat/meet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });
    const kaan = await ticketOf("user-auth");
    const merve = await ticketOf("merve-auth");
    expect(await (await meet(kaan)).json()).toEqual({ url: "" });
    expect((await meet(kaan, { url: "https://meet.jit.si/XRE-1" })).status).toBe(400);
    expect((await meet(kaan, { url: "javascript:alert(1)" })).status).toBe(400);
    expect((await meet(kaan, { url: "https://meet.google.com/abc-defg-hij" })).status).toBe(200);
    expect(await (await meet(kaan)).json()).toEqual({ url: "https://meet.google.com/abc-defg-hij" });
    // Herkesin odası ayrı; personel başkasının odasını değiştiremez
    expect(await (await meet(merve)).json()).toEqual({ url: "" });
    await meet(merve, { userId: "2", url: "https://meet.google.com/zzz-zzzz-zzz" });
    expect(await (await meet(kaan)).json()).toEqual({ url: "https://meet.google.com/abc-defg-hij" });
    // Yönetici personelin odasını ayarlayabilir
    const admin = await ticketOf("admin-auth");
    await meet(admin, { userId: "3", url: "https://meet.google.com/mer-vemm-eet" });
    expect(await (await meet(merve)).json()).toEqual({ url: "https://meet.google.com/mer-vemm-eet" });
  });

  it("Bitrix adres kontrolü: parametresiz istekte 200 döner", async () => {
    const { base } = await setup();
    for (const path of ["/b24/app", "/b24/install"]) {
      expect((await fetch(`${base}${path}`, { method: "HEAD" })).status).toBe(200);
      const get = await fetch(`${base}${path}`);
      expect(get.status).toBe(200);
      expect(await get.text()).toContain("Bitrix24");
    }
  });
});

