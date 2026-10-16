import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { CONNECTOR_ID, instanceName, setB24Fetch, settingsTicket } from "../server/b24-connector";
import { setAiFetch } from "../server/b24-ai";

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
      return { access_token: "tok-2", refresh_token: "ref-2", expires_in: 3600 };
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
    if (method === "crm.duplicate.findbycomm") return { result: body.entity_type === "LEAD" ? { LEAD: [55] } : [] };
    if (method === "user.get")
      return {
        result: [
          { ID: "1", NAME: "Erdal", EMAIL: "erdal@x.test" },
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
  return fetch(`${base}/b24/install`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "ref-1", AUTH_EXPIRES: "3600" }));
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
    expect(bx[0].url).toBe(`https://${DOMAIN}/rest/user.current.json`);
  });

  it("ayar sayfası yalnız portal yöneticisine açılır; bağlanınca kanal etkinleşir", async () => {
    const { base, bx } = await setup({ evoState: "open" });
    await install(base);
    const opts = { member_id: MEMBER, DOMAIN, PLACEMENT: "SETTING_CONNECTOR", PLACEMENT_OPTIONS: JSON.stringify({ LINE: "3" }) };
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
    const event = (token: string) =>
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
        }),
      );
    expect((await event("app-token")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    const sendText = evo.find((c) => c.url === `/message/sendText/${instanceName(MEMBER, "3")}`);
    expect(sendText?.body).toMatchObject({ number: "905551234567", text: "Merhaba Ayşe hanım\nFiyat 3 milyon" });
    expect(bx.find((c) => c.method === "imconnector.send.status.delivery")?.body.MESSAGES[0]).toMatchObject({ im: { chat_id: "77", message_id: "88" } });
    expect((await event("baska-token")).status).toBe(401);
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
    const home = await fetch(`${base}/b24/app`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }));
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
    const kaan = await (await fetch(`${base}/b24/app`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "user-auth" }))).text();
    expect(kaan).toContain("Satış 7124");
    expect(kaan).not.toContain("Numara ekle");
    const merve = await (await fetch(`${base}/b24/app`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "merve-auth" }))).text();
    expect(merve).toContain("Sigorta");
    expect(merve).toContain("Size atanmış numara yok");
  });

  it("kurulum adresi çağrılmasa da ilk açılışta kendini kurar", async () => {
    const { base, bx } = await setup();
    const res = await fetch(`${base}/b24/app`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "tok-1", REFRESH_ID: "ref-1" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Numara ekle");
    expect(bx.some((c) => c.method === "imconnector.register")).toBe(true);
    // Yönetici olmayan biri kuramaz
    const other = await fetch(`${base}/b24/app`, formPost({ member_id: "baskaportal1", DOMAIN: "baska.bitrix24.com", AUTH_ID: "user-auth" }));
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
          ? { language: "ru", turkish_translation: "Merhaba, daire arıyorum" }
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
          "auth[application_token]": "app-token",
        }),
      );
    await reply("Fiyat 3 milyon");
    await new Promise((r) => setTimeout(r, 80));
    const sends = evo.filter((c) => c.url === `/message/sendText/${instance}`);
    expect(sends.at(-1)?.body).toMatchObject({ number: "79161234567", text: "Цена 3 миллиона" });
    await reply("!Antalya");
    await new Promise((r) => setTimeout(r, 80));
    expect(evo.filter((c) => c.url === `/message/sendText/${instance}`).at(-1)?.body.text).toBe("Antalya");

    const home = await (await fetch(`${base}/b24/app`, formPost({ member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const t = home.match(/const T="([^"]+)"/)?.[1];
    const stats = await (await fetch(`${base}/b24/panel/stats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t, days: 7 }) })).json();
    expect(stats.waiting).toEqual([]);
    expect(stats.foreign).toBe(1);
    expect(stats.agents.find((a: any) => a.id === "2")).toMatchObject({ replies: 2 });
    expect(stats.agents.find((a: any) => a.id === "2").avgSec).toBeGreaterThanOrEqual(0);
    expect(stats.lines[0]).toMatchObject({ line: "3", inbound: 3, outbound: 2, newChats: 1 });
    expect(stats.hot[0]).toMatchObject({ score: 82, temperature: "sıcak", lang: "ru" });
  });
});
