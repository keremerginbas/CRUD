import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { CONNECTOR_ID, checkLineHealth, instanceName, portalById, setB24Fetch, setLidResolveDelay, setPhoneEchoDelay, settingsTicket, syncConnectorWebhooks } from "../server/b24-connector";
import { setAiFetch } from "../server/b24-ai";
import { inWorkingHours, setAgentMergeDelay, DEFAULT_AGENT } from "../server/b24-agent";
import { dueReports, DEFAULT_REPORTS, setTelegramFetch } from "../server/b24-live";
import { panelHtml } from "../server/b24-panel-html";
import { localizeMessage } from "../server/b24-i18n";
import { normalizeRecipient, setCampaignGap, setMetaFetch } from "../server/b24-campaigns";
import { runWaitAlerts } from "../server/b24-alerts";
import { getPricing, licenseForConnect, revenueMetrics, runBillingReminders, runOnboardingReminders, setOwnerNotifyFetch, DEFAULT_PRICING } from "../server/b24-billing";

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
      if (req.url?.startsWith("/chat/whatsappNumbers")) {
        const lids: Record<string, string> = { "905559990000": "777000111222@lid", "905301110006": "444555666777@lid" };
        const numbers: string[] = JSON.parse(raw || "{}").numbers || [];
        return res.end(JSON.stringify(numbers.map((n) => ({ exists: true, jid: `${n}@s.whatsapp.net`, number: n, ...(lids[n] ? { lid: lids[n] } : {}) }))));
      }
      if (req.url?.startsWith("/chat/findContacts")) {
        const all = [
          { remoteJid: "222333444555@lid", pushName: "Ayten Hanım" },
          { remoteJid: "905301110003@s.whatsapp.net", pushName: "905301110003" },
        ];
        const want = JSON.parse(raw || "{}").where?.remoteJid;
        return res.end(JSON.stringify(want ? all.filter((c) => c.remoteJid === want) : all));
      }
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
  it("bağlanınca WhatsApp geçmişini içe aktarır, telefondan yazılanları gösterir, listede tüm sohbetlerde arar", async () => {
    setPhoneEchoDelay(0);
    setLidResolveDelay(0);
    const { store, base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    const post = (body: Record<string, unknown>) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instance, ...body }) });
    const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

    // Bağlantı anında WhatsApp sohbet listesini ve son mesajları gönderir
    await post({
      event: "chats.set",
      data: [
        { remoteJid: "905301110001@s.whatsapp.net", name: "Zeynep Kaya" },
        { remoteJid: "905301110006@s.whatsapp.net", name: "Can Demir" },
        { remoteJid: "120363000@g.us", name: "Aile grubu" },
        { remoteJid: "status@broadcast" },
      ],
    });
    const history = [
      { key: { id: "H1", remoteJid: "905301110002@s.whatsapp.net", fromMe: false }, pushName: "Mehmet", messageTimestamp: 1760000000, message: { conversation: "Eski soru" } },
      { key: { id: "H2", remoteJid: "905301110002@s.whatsapp.net", fromMe: true }, pushName: "Firma", messageTimestamp: 1760000100, message: { conversation: "Eski cevap" } },
      { key: { id: "H3", remoteJid: "905301110002@s.whatsapp.net", fromMe: false }, messageTimestamp: 1760000200, message: { imageMessage: { mimetype: "image/jpeg" } } },
      { key: { id: "H4", remoteJid: "555000111@lid", remoteJidAlt: "905301110005@s.whatsapp.net", fromMe: false }, pushName: "Selin", messageTimestamp: 1760000300, message: { conversation: "Gizli kimlikle" } },
      // Numarası verilmeyen gizli kimlik: bilinen numaralar sorulunca Can Demir'in sohbetiyle birleşir
      { key: { id: "H5", remoteJid: "444555666777@lid", fromMe: false }, pushName: "Can", messageTimestamp: 1760000400, message: { conversation: "Numarasız geçmiş" } },
    ];
    await post({ event: "messages.set", data: history });
    await post({ event: "messages.set", data: { messages: history } }); // tekrar gelirse çoğalmaz
    await wait();
    // Geçmiş Bitrix'e yeni mesaj olarak gönderilmez
    expect(bx.find((c) => c.method === "imconnector.send.messages")).toBeUndefined();

    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const chatUrl = JSON.parse(home.match(/CHAT_URL=("[^"]*")/)![1]);
    const view = await (await fetch(new URL(chatUrl, base).toString())).text();
    const ct = JSON.parse(view.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]).t;
    const api = async (path: string, body: Record<string, unknown> = {}) =>
      (await fetch(`${base}/b24/chat/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct, ...body }) })).json();

    let list = await api("threads");
    const byPhone = (p: string) => list.threads.find((x: any) => x.phone === p);
    expect(byPhone("905301110001")).toMatchObject({ name: "Zeynep Kaya" });
    expect(byPhone("905301110002")).toMatchObject({ name: "Mehmet", lastText: "📷 Görsel", lastAt: 1760000200000 });
    expect(byPhone("905301110005")).toMatchObject({ name: "Selin" });
    expect(list.threads.some((x: any) => x.phone.endsWith("@g.us") || x.phone.includes("broadcast") || x.phone.endsWith("@lid"))).toBe(false);
    expect(byPhone("905301110006")).toMatchObject({ name: "Can Demir", lastText: "Numarasız geçmiş" });

    // Geçmişte numarasız kalan gizli sohbet, kişi yeniden yazınca (numarasıyla) birleşir
    await post({ event: "messages.set", data: [{ key: { id: "H6", remoteJid: "999888777666@lid", fromMe: false }, pushName: "Deniz", messageTimestamp: 1760000500, message: { conversation: "Eski gizli" } }] });
    await wait();
    expect((await api("threads")).threads.some((x: any) => x.phone === "999888777666@lid")).toBe(true);
    await post({ event: "messages.upsert", data: { key: { id: "L6", remoteJid: "999888777666@lid", remoteJidAlt: "905301110007@s.whatsapp.net", fromMe: false }, pushName: "Deniz", message: { conversation: "Yeni mesaj" } } });
    await wait();
    list = await api("threads");
    expect(list.threads.some((x: any) => x.phone === "999888777666@lid")).toBe(false);
    expect((await api("messages", { line: "3", phone: "905301110007" })).messages.map((m: any) => m.text)).toEqual(["Eski gizli", "Yeni mesaj"]);
    bx.length = 0;
    const old = await api("messages", { line: "3", phone: "905301110002" });
    expect(old.messages.map((m: any) => [m.dir, m.text, m.via || ""])).toEqual([
      ["in", "Eski soru", ""],
      ["out", "Eski cevap", "phone"],
      ["in", "📷 Görsel", ""],
    ]);

    // İşletme telefondan yazar: sohbet listede en üste çıkar, mesaj "telefondan" görünür
    await post({ event: "messages.upsert", data: { key: { id: "P1", remoteJid: "905301110003@s.whatsapp.net", fromMe: true }, message: { conversation: "Telefondan yazdım" } } });
    await wait();
    list = await api("threads");
    expect(list.threads[0]).toMatchObject({ phone: "905301110003", lastText: "Telefondan yazdım" });
    expect((await api("messages", { line: "3", phone: "905301110003" })).messages).toMatchObject([{ dir: "out", text: "Telefondan yazdım", via: "phone" }]);
    // Ad bilinmiyorsa numara ad olarak yazılmaz
    expect(list.threads[0].name).toBe("");
    // Telefondan gizli kimlikli birine yazılınca WhatsApp adı kişi listesinden gelir
    await post({ event: "messages.upsert", data: { key: { id: "P2", remoteJid: "222333444555@lid", fromMe: true }, message: { conversation: "Merhaba Ayten Hanım" } } });
    await wait();
    expect((await api("threads")).threads.find((x: any) => x.phone === "222333444555@lid")).toMatchObject({ name: "Ayten Hanım", lastText: "Merhaba Ayten Hanım" });

    // Sistemden gönderilen mesajın yankısı ikinci kez yazılmaz
    await api("send", { line: "3", phone: "905301110003", text: "Sistemden gönderdim" });
    const sentId = evo.filter((c) => c.url === `/message/sendText/${instance}`).length ? (await api("messages", { line: "3", phone: "905301110003" })).messages.at(-1).waId : "";
    await post({ event: "messages.upsert", data: { key: { id: sentId, remoteJid: "905301110003@s.whatsapp.net", fromMe: true }, message: { conversation: "Sistemden gönderdim" } } });
    await post({ event: "messages.upsert", data: { key: { id: "ECHO-2", remoteJid: "905301110003@s.whatsapp.net", fromMe: true }, message: { conversation: "Sistemden gönderdim" } } });
    await wait();
    expect((await api("messages", { line: "3", phone: "905301110003" })).messages.map((m: any) => m.text)).toEqual(["Telefondan yazdım", "Sistemden gönderdim"]);

    // Arama tüm sohbetlerde yapılır; liste sayfalanır
    expect((await api("threads", { q: "zeynep" })).threads.map((x: any) => x.phone)).toEqual(["905301110001"]);
    expect((await api("threads", { q: "0530 111 00 05" })).threads.map((x: any) => x.phone)).toEqual(["905301110005"]);
    const portal = (await portalById(store, MEMBER))!;
    for (let i = 0; i < 60; i += 1)
      await store.put("b24-chat", `${MEMBER}:3:9053900000${String(i).padStart(2, "0")}`, { id: `${MEMBER}:3:9053900000${String(i).padStart(2, "0")}`, memberId: portal.id, line: "3", phone: `9053900000${String(i).padStart(2, "0")}`, name: "", inbound: 1, outbound: 0, sinceQualify: 0, history: [] }, "b24-connector");
    const page = await api("threads", { limit: 50 });
    expect(page.threads).toHaveLength(50);
    expect(page.total).toBe(67);

    // Var olan numaraların webhook ayarına geçmiş olayları eklenir
    await syncConnectorWebhooks(store);
    const hookSet = evo.find((c) => c.url === `/webhook/set/${instance}`);
    expect(hookSet?.body.webhook.events).toEqual(expect.arrayContaining(["MESSAGES_UPSERT", "MESSAGES_SET", "CHATS_SET"]));
  });

  it("bekleyen sohbet alarmı personele ve yöneticiye bir kez gider; hazır cevaplar sohbet ekranına gelir; telefondan cevap performansa girer", async () => {
    setPhoneEchoDelay(0);
    const { store, base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const t = home.match(/const T="([^"]+)"/)?.[1];
    const panel = async (path: string, body: Record<string, unknown> = {}) => {
      const r = await fetch(`${base}/b24/panel/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, t }) });
      return { status: r.status, body: await r.json() };
    };
    // Kurulum kartı: numara bağlı ama henüz mesaj yok → 3. adım
    expect(home).toContain("Kuruluma hoş geldiniz");

    const saved = await panel("settings/save", { alerts: true, alertAgentMin: 10, alertManagerMin: 30, alertTelegram: false, alertWorkHours: false });
    expect(saved.body.settings).toMatchObject({ alerts: true, alertAgentMin: 10, alertManagerMin: 30, alertWorkHours: false });
    const sales = await panel("role/save", { name: "Satış", lines: ["3"] });
    await panel("user/role", { userId: "3", roleId: sales.body.role.id });

    const now = Date.now();
    const chat = (phone: string, minutes: number, name: string) => ({
      id: `${MEMBER}:3:${phone}`, memberId: MEMBER, line: "3", phone, name, inbound: 1, outbound: 0, sinceQualify: 0,
      history: [{ from: "müşteri", text: "Fiyat nedir?", at: now - minutes * 60_000 }], waitingSince: now - minutes * 60_000, lastInboundAt: now - minutes * 60_000,
    });
    await store.put("b24-chat", `${MEMBER}:3:905550000001`, chat("905550000001", 15, "Ayşe"), "b24-connector");
    await store.put("b24-chat", `${MEMBER}:3:905550000002`, chat("905550000002", 45, "Mehmet"), "b24-connector");
    await store.put("b24-chat", `${MEMBER}:3:905550000003`, chat("905550000003", 3, "Yeni"), "b24-connector");
    // Cevap gerektirmeyen son mesajlar (tepki, teşekkür) ve 24 saatten eski bekleyişler uyarılmaz
    await store.put("b24-chat", `${MEMBER}:3:905550000004`, { ...chat("905550000004", 50, "Tepkici"), history: [{ from: "müşteri", text: "Tepki: 👍", at: now - 50 * 60_000 }] }, "b24-connector");
    await store.put("b24-chat", `${MEMBER}:3:905550000005`, { ...chat("905550000005", 50, "Teşekkürcü"), history: [{ from: "müşteri", text: "Teşekkür ederim, iyi akşamlar 🙏", at: now - 50 * 60_000 }] }, "b24-connector");
    await store.put("b24-chat", `${MEMBER}:3:905550000006`, chat("905550000006", 26 * 60, "Eski"), "b24-connector");
    // Alarm açılmadan önce başlamış bekleyişler için uyarı gitmez
    bx.length = 0;
    await runWaitAlerts(store, now);
    expect(bx.filter((c) => c.method === "im.notify.system.add")).toEqual([]);
    const p0 = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    await store.put("b24-portal", MEMBER, { ...p0, settings: { ...p0.settings, alertsSince: now - 48 * 3_600_000 } }, "b24-connector");
    bx.length = 0;
    await runWaitAlerts(store, now);
    const notes = () => bx.filter((c) => c.method === "im.notify.system.add").map((c) => ({ to: c.body.USER_ID, msg: String(c.body.MESSAGE) }));
    // Personel (Merve, rolü numarayı kapsıyor): 10 dakikayı geçen ama 30'u geçmeyen sohbet
    expect(notes().find((n) => n.to === 3)?.msg).toContain("Ayşe");
    expect(notes().find((n) => n.to === 3)?.msg).not.toContain("Yeni");
    // Yönetici: 30 dakikayı geçen sohbet
    expect(notes().find((n) => n.to === 1)?.msg).toMatch(/Mehmet.*45 dk/s);
    expect(notes().map((n) => n.msg).join("\n")).not.toMatch(/Tepkici|Teşekkürcü|Eski/);
    // Aynı bekleme için tekrar uyarı gitmez
    bx.length = 0;
    await runWaitAlerts(store, now + 60_000);
    expect(notes()).toEqual([]);
    // Kapalıyken hiç uyarı gitmez
    await panel("settings/save", { alerts: false });
    bx.length = 0;
    await runWaitAlerts(store, now + 40 * 60_000);
    expect(notes()).toEqual([]);

    // Hazır cevaplar: temizlenir, sohbet ekranına gelir
    const q = await panel("quick/save", { items: [{ key: "/IBAN", text: "TR00 0000" }, { key: "konum bilgisi", text: "Kadıköy" }, { key: "iban", text: "tekrar" }, { key: "", text: "boş" }] });
    expect(q.body.quickReplies).toEqual([{ key: "iban", text: "TR00 0000" }, { key: "konum-bilgisi", text: "Kadıköy" }]);
    const chatUrl = JSON.parse(home.match(/CHAT_URL=("[^"]*")/)![1]);
    const view = await (await fetch(new URL(chatUrl, base).toString())).text();
    const ct = JSON.parse(view.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]).t;
    const threads = await (await fetch(`${base}/b24/chat/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct }) })).json();
    expect(threads.quick).toEqual(q.body.quickReplies);
    expect(threads.portalLines).toBe(1);

    // Hazır cevaba görsel eklenir, sohbet ekranından görselle birlikte gönderilir
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    expect((await fetch(`${base}/b24/panel/quick/upload`, { method: "POST", headers: { "x-xre-ticket": "sahte", "content-type": "image/png" }, body: png })).status).toBe(401);
    const up = await (await fetch(`${base}/b24/panel/quick/upload`, { method: "POST", headers: { "x-xre-ticket": t!, "content-type": "image/png", "x-file-name": encodeURIComponent("fiyat listesi.png") }, body: png })).json();
    expect(up.media).toMatchObject({ name: "fiyat listesi.png", type: "image", mime: "image/png" });
    const q2 = await panel("quick/save", { items: [...q.body.quickReplies, { key: "fiyat", text: "Güncel fiyat listemiz", media: up.media }, { key: "sahte", text: "", media: { id: "med_" + "0".repeat(24), name: "x" } }] });
    expect(q2.body.quickReplies.map((r: any) => r.key)).toEqual(["iban", "konum-bilgisi", "fiyat"]);
    expect((await fetch(`${base}/b24/panel/quick/media/${up.media.id}?t=${encodeURIComponent(t!)}`)).headers.get("content-type")).toBe("image/png");
    expect((await fetch(`${base}/b24/chat/quick-media/${up.media.id}?t=${encodeURIComponent(ct)}`)).status).toBe(200);
    const sentQuick = await (await fetch(`${base}/b24/chat/send-quick`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct, line: "3", phone: "905550000002", key: "fiyat", text: "Buyrun fiyat listemiz" }) })).json();
    expect(sentQuick).toEqual({ ok: true });
    const mediaCall = evo.filter((c) => c.url.startsWith("/message/sendMedia")).at(-1);
    expect(mediaCall?.body).toMatchObject({ number: "905550000002", mediatype: "image", caption: "Buyrun fiyat listemiz" });
    const thread = await (await fetch(`${base}/b24/chat/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct, line: "3", phone: "905550000002" }) })).json();
    expect(thread.messages.at(-1)).toMatchObject({ dir: "out", text: "Buyrun fiyat listemiz", media: { type: "image" } });

    // Kişisel hazır cevaplar: personel kendi listesini yönetir, yalnız kendisi görür
    const ticketOf = async (auth: string) => {
      const html = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: auth }))).text();
      return JSON.parse(html.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]).t as string;
    };
    const merve = await ticketOf("merve-auth");
    const kaan = await ticketOf("user-auth");
    const chatApi = async (tk: string, path: string, body: Record<string, unknown> = {}) =>
      (await fetch(`${base}/b24/chat/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: tk, ...body }) })).json();
    const myFile = await (await fetch(`${base}/b24/chat/quick/upload`, { method: "POST", headers: { "x-xre-ticket": merve, "content-type": "image/png", "x-file-name": "merve-fiyat.png" }, body: png })).json();
    const mine = await chatApi(merve, "quick/save", { items: [{ key: "fiyat", text: "Merve'nin fiyat listesi", media: myFile.media }, { key: "kartvizit", text: "Merve Y. · 0530 000 00 00" }] });
    expect(mine.quickMine.map((r: any) => r.key)).toEqual(["fiyat", "kartvizit"]);
    // Aynı kısayollu ortak cevap gizlenir, kişisel olan geçerli olur
    expect(mine.quick.filter((r: any) => r.key === "fiyat")).toEqual([expect.objectContaining({ mine: true, text: "Merve'nin fiyat listesi" })]);
    expect(mine.quick.map((r: any) => r.key)).toEqual(["fiyat", "kartvizit", "iban", "konum-bilgisi"]);
    // Başka personel görmez; dosyasına erişemez
    const other = await chatApi(kaan, "threads");
    expect(other.quickMine).toEqual([]);
    expect(other.quick.find((r: any) => r.key === "fiyat")).toMatchObject({ text: "Güncel fiyat listemiz" });
    expect((await fetch(`${base}/b24/chat/quick-media/${myFile.media.id}?t=${encodeURIComponent(kaan)}`)).status).toBe(404);
    expect((await fetch(`${base}/b24/chat/quick-media/${myFile.media.id}?t=${encodeURIComponent(merve)}`)).status).toBe(200);
    // Merve /fiyat gönderince kendi dosyası gider
    evo.length = 0;
    expect(await chatApi(merve, "send-quick", { line: "3", phone: "905550000002", key: "fiyat", text: "Fiyatlarım" })).toEqual({ ok: true });
    expect(evo.find((c) => c.url.startsWith("/message/sendMedia"))?.body).toMatchObject({ caption: "Fiyatlarım", fileName: "merve-fiyat.png" });

    // Telefondan verilen cevap performansta "phone" temsilcisi olarak sayılır
    await fetch(`${base}/api/webhooks/evolution?token=hook-secret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "messages.upsert", instance: instanceName(MEMBER, "3"), data: { key: { id: "PH1", remoteJid: "905550000001@s.whatsapp.net", fromMe: true }, message: { conversation: "Merhaba Ayşe Hanım" } } }),
    });
    await new Promise((r) => setTimeout(r, 120));
    const stats = await panel("stats", { days: 1 });
    expect(stats.body.agents.find((a: any) => a.id === "phone")).toMatchObject({ replies: 1 });
    expect(stats.body.waiting.some((w: any) => w.phone === "905550000001")).toBe(false);
  });

  it("numara bağlanmamış kurulum: 24 saat sonra yöneticiye bir kez hatırlatma gider", async () => {
    const { store, base, bx } = await setup();
    await install(base);
    await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }));
    const now = Date.now();
    bx.length = 0;
    await runOnboardingReminders(store, now);
    expect(bx.some((c) => c.method === "im.notify.system.add")).toBe(false); // henüz 24 saat olmadı
    await runOnboardingReminders(store, now + 25 * 3_600_000);
    const sent = bx.filter((c) => c.method === "im.notify.system.add");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ USER_ID: 1 });
    expect(String(sent[0].body.MESSAGE)).toContain("kurulumunuz henüz tamamlanmadı");
    await runOnboardingReminders(store, now + 30 * 3_600_000);
    expect(bx.filter((c) => c.method === "im.notify.system.add")).toHaveLength(1);
  });

  it("deneme numara başına bir kez: yeni kanal ya da başka portal yeni deneme vermez, ödenmiş lisans yeni kanala taşınır", async () => {
    const store = createMemoryStore();
    const now = Date.now();
    const day = 86_400_000;
    const portal = (lines: Record<string, any>, id = "p1") => ({ id, domain: `${id}.bitrix24.com`, active: true, lines }) as any;
    // İlk bağlantı: deneme başlar ve numaraya yazılır
    const first = await licenseForConnect(store, portal({ "1": { instance: "a" } }), "1", "905551110000", now);
    expect(first).toMatchObject({ trialDays: 3 });
    // Aynı numara başka kanalda / başka portalda: aynı deneme başlangıcı devralınır
    const again = await licenseForConnect(store, portal({ "2": { instance: "b" } }, "p2"), "2", "+90 555 111 00 00", now + 5 * day);
    expect(again!.trialStart).toBe(first!.trialStart);
    // Farklı numara yeni deneme alır
    expect((await licenseForConnect(store, portal({ "3": { instance: "c" } }), "3", "905552220000", now + 5 * day))!.trialStart).not.toBe(first!.trialStart);
    // Kayıttan önce başlamış eski deneme de bulunur
    const oldStart = new Date(now - 20 * day).toISOString();
    await store.put("b24-portal", "p9", portal({ "7": { instance: "x", phone: "905553330000", license: { trialStart: oldStart } } }, "p9"), "b24-connector");
    expect((await licenseForConnect(store, portal({ "8": { instance: "y" } }), "8", "905553330000", now))!.trialStart).toBe(oldStart);
    // Aynı portalda ödenmiş lisans yeni kanala taşınır
    const paidUntil = new Date(now + 30 * day).toISOString();
    const moved = await licenseForConnect(store, portal({ "4": { instance: "d", phone: "905554440000", license: { trialStart: oldStart, paidUntil, plan: "pro" } }, "5": { instance: "e" } }), "5", "905554440000", now);
    expect(moved).toMatchObject({ paidUntil, plan: "pro" });
    // Kanalın kendi lisansı varsa dokunulmaz
    const own = { trialStart: oldStart, trialDays: 3 };
    expect(await licenseForConnect(store, portal({ "6": { instance: "f", license: own } }), "6", "905551110000", now)).toBe(own);
  });

  it("deneme süresi varsayılan 3 gün; eski 7 günlük kayıt yeni varsayılana döner, yönetimden seçilen korunur", async () => {
    expect(DEFAULT_PRICING.trialDays).toBe(3);
    const store = createMemoryStore();
    await store.put("b24-pricing", "default", { ...DEFAULT_PRICING, trialDays: 7, rev: undefined }, "b24-connector");
    expect((await getPricing(store)).trialDays).toBe(3);
    await store.put("b24-pricing", "default", { ...DEFAULT_PRICING, trialDays: 7, rev: 2 }, "b24-connector");
    expect((await getPricing(store)).trialDays).toBe(7);
  });

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
    // Yeni denemeler 3 gün sürer; süre deneme başladığında kayda yazılır
    expect(billing.body.licenses[0]).toMatchObject({ line: "3", status: "trial", daysLeft: 3 });
    expect((await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload.lines["3"].license.trialDays).toBe(3);
    expect(billing.body.periods.find((p: any) => p.months === 12)).toMatchObject({ discount: 35, perLine: 273 });
    // Deneme süresinde portal Pro+ sayılır
    expect(billing.body.plan).toMatchObject({ plan: "proplus", source: "trial" });
    expect(billing.body.plans.map((p: any) => [p.id, p.monthly])).toEqual([["basic", 15], ["pro", 25], ["proplus", 35]]);
    expect((await panel("live")).status).toBe(200);

    // 3 güne inmeden önce başlamış deneme 7 gün sürer; yeni deneme 3 günde biter
    const legacy = (await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload;
    legacy.lines["3"].license = { trialStart: new Date(Date.now() - 5 * 86_400_000).toISOString() };
    await store.put("b24-portal", MEMBER, legacy, "b24-connector");
    expect((await panel("billing/state")).body.licenses[0]).toMatchObject({ status: "trial", daysLeft: 2 });
    legacy.lines["3"].license = { trialStart: new Date(Date.now() - 5 * 86_400_000).toISOString(), trialDays: 3 };
    await store.put("b24-portal", MEMBER, legacy, "b24-connector");
    expect((await panel("billing/state")).body.licenses[0].status).toBe("expired");

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

  it("seslendirme ucu yalnız yerelden çağrılır ve uygulamanın OpenAI anahtarıyla mp3 döner", async () => {
    process.env.XRE_OPENAI_API_KEY = "sk-test";
    const calls: any[] = [];
    setAiFetch((async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 }); }) as any);
    const { base } = await setup();
    const r = await fetch(`${base}/internal/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Merhaba", voice: "nova", instructions: "Sıcak" }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("audio/mpeg");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
    expect(calls[0]).toMatchObject({ url: "https://api.openai.com/v1/audio/speech", auth: "Bearer sk-test", body: { model: "gpt-4o-mini-tts", voice: "nova", input: "Merhaba", instructions: "Sıcak" } });
    setAiFetch(null);
  });

  it("rapor Telegram'a da gider: bot bağlanır, sohbet bulunur, anahtar panele sızmaz", async () => {
    const SECRET = "FAKE_test_secret_value_0123456789abcdef";
    const TOKEN = `111111111:${SECRET}`;
    const tg: any[] = [];
    setTelegramFetch((async (url: string, init: any) => {
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (!url.includes(`/bot${TOKEN}/`)) return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
      const method = url.split("/").pop();
      tg.push({ method, body: init?.body ? JSON.parse(init.body) : null });
      if (method === "getMe") return json({ ok: true, result: { username: "demo_rapor_bot" } });
      if (method === "getUpdates") return json({ ok: true, result: [{ my_chat_member: { chat: { id: -1009990001, title: "Demo Raporlar", type: "supergroup" } } }] });
      if (method === "sendMessage") return json({ ok: true, result: { message_id: 1 } });
      if (method === "getChat") {
        const id = JSON.parse(init.body).chat_id;
        return id === "-1009990001" ? json({ ok: true, result: { id: -1009990001, title: "Demo Raporlar", type: "supergroup" } }) : new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
      }
      return json({ ok: false, description: "?" });
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
    expect((await panel("reports/telegram/connect", { token: "yanlis" })).status).toBe(400);
    const connected = await panel("reports/telegram/connect", { token: TOKEN });
    expect(connected.body.telegram).toEqual({ connected: true, bot: "demo_rapor_bot", chats: [] });
    // Telegram Web bağlantısı yapıştırılırsa -100 önekli doğru kimlik bulunur
    expect((await panel("reports/telegram/resolve", { input: "https://web.telegram.org/k/#-9990001" })).body.chat).toEqual({ id: "-1009990001", title: "Demo Raporlar" });
    expect((await panel("reports/telegram/resolve", { input: "-12345" })).status).toBe(404);
    const found = await panel("reports/telegram/discover");
    expect(found.body.chats).toEqual([{ id: "-1009990001", title: "Demo Raporlar", type: "supergroup" }]);
    const saved = await panel("reports/save", { daily: true, hour: 9, phones: [], userIds: [], line: "", telegramChats: found.body.chats });
    expect(saved.body.settings.telegram).toEqual({ connected: true, bot: "demo_rapor_bot", chats: [{ id: "-1009990001", title: "Demo Raporlar" }] });
    expect(JSON.stringify((await panel("reports/state")).body)).not.toContain(SECRET);
    expect(JSON.stringify((await store.get<any>("b24-portal", MEMBER, "b24-connector"))!.payload)).not.toContain(SECRET);
    expect((await panel("reports/telegram/test")).body).toEqual({ sent: 1, errors: [] });
    const created = await panel("reports/create", { period: "daily", send: true, origin: "https://crm.xre.test" });
    expect(created.body.delivery).toMatchObject({ sent: 1, errors: [] });
    const report = tg.filter((c) => c.method === "sendMessage").at(-1);
    expect(report.body).toMatchObject({ chat_id: "-1009990001" });
    expect(report.body.text).toContain("https://crm.xre.test/b24/report/");
    expect((await panel("reports/telegram/disconnect")).body.telegram.connected).toBe(false);
  });

  it("WhatsApp gizli kimlik (@lid) mesajları: gerçek numara varsa ona, yoksa kimliğe bağlanır; cevap geri gider", async () => {
    const { base, bx, evo } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    const hook = (key: Record<string, unknown>, text: string) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "messages.upsert", instance, data: { key, pushName: "Ali", message: { conversation: text } } }) });
    const sent = () => bx.filter((c) => c.method === "imconnector.send.messages").map((c) => c.body.MESSAGES[0]);
    await hook({ id: "LID1", remoteJid: "112233445566@lid", remoteJidAlt: "905061234567@s.whatsapp.net" }, "Merhaba");
    await new Promise((r) => setTimeout(r, 60));
    expect(sent().at(-1)).toMatchObject({ chat: { id: "905061234567" }, user: { id: "905061234567", phone: "+905061234567" }, message: { text: "Merhaba" } });
    await hook({ id: "LID2", remoteJid: "998877665544@lid" }, "Numarasız");
    await new Promise((r) => setTimeout(r, 60));
    const anon = sent().at(-1);
    expect(anon).toMatchObject({ chat: { id: "998877665544@lid" }, user: { id: "998877665544@lid", name: "Ali" }, message: { text: "Numarasız" } });
    expect(anon.user.phone).toBeUndefined();
    // Bitrix'ten verilen cevap aynı gizli kimliğe gider
    await fetch(`${base}/b24/events`, formPost({ event: "ONIMCONNECTORMESSAGEADD", "data[CONNECTOR]": CONNECTOR_ID, "data[LINE]": "3", "data[MESSAGES][0][message][text]": "Cevap", "data[MESSAGES][0][chat][id]": "998877665544@lid", "auth[member_id]": MEMBER, "auth[application_token]": "app-token", "auth[access_token]": "tok-2" }));
    await new Promise((r) => setTimeout(r, 60));
    const out = evo.filter((c) => c.url === `/message/sendText/${instance}`).at(-1)!;
    expect((typeof out.body === "string" ? JSON.parse(out.body) : out.body).number).toBe("998877665544@lid");
    // Sohbet ekranında gizli kimlikli sohbet açılır ve mesajları görünür
    const home = await (await fetch(`${base}/b24/app`, formPost({ LANG: "tr", member_id: MEMBER, DOMAIN, AUTH_ID: "admin-auth" }))).text();
    const chatUrl = JSON.parse(home.match(/CHAT_URL=("[^"]*")/)![1]);
    const view = await (await fetch(new URL(chatUrl, base).toString())).text();
    const ct = JSON.parse(view.match(/window\.XRE_CHAT=(\{.*?\});<\/script>/)![1]).t;
    const msgs = await (await fetch(`${base}/b24/chat/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct, line: "3", phone: "998877665544@lid" }) })).json();
    expect(msgs.phone).toBe("998877665544@lid");
    expect(msgs.messages.map((m: any) => m.text)).toContain("Numarasız");
    // Temsilci gerçek numarayı eşleştirir: sohbetler birleşir, sonraki mesaj numaraya düşer
    const linked = await (await fetch(`${base}/b24/chat/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct, line: "3", phone: "998877665544@lid", target: "0532 111 22 33" }) })).json();
    expect(linked).toMatchObject({ line: "3", phone: "905321112233" });
    const merged = await (await fetch(`${base}/b24/chat/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct, line: "3", phone: "905321112233" }) })).json();
    expect(merged.messages.map((m: any) => m.text)).toContain("Numarasız");
    const threads = await (await fetch(`${base}/b24/chat/threads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: ct }) })).json();
    expect(threads.threads.some((x: any) => x.phone === "998877665544@lid")).toBe(false);
    await hook({ id: "LID3", remoteJid: "998877665544@lid" }, "Yeni mesaj");
    await new Promise((r) => setTimeout(r, 60));
    expect(sent().at(-1)).toMatchObject({ chat: { id: "905321112233" }, user: { phone: "+905321112233" }, message: { text: "Yeni mesaj" } });
  });

  it("gizli kimlikli cevap otomatik doğru sohbete düşer: gönderirken öğrenilir, farklı alandaki numara bulunur, tek bekleyen sohbete bağlanır", async () => {
    const { base, bx } = await setup({ evoState: "open" });
    await install(base);
    await fetch(`${base}/b24/api/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: settingsTicket(MEMBER, "3") }) });
    const instance = instanceName(MEMBER, "3");
    const hook = (key: Record<string, unknown>, text: string, extra: Record<string, unknown> = {}) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "messages.upsert", instance, data: { key, pushName: "Müşteri", message: { conversation: text }, ...extra } }) });
    const agentWrites = (to: string, text: string) =>
      fetch(`${base}/b24/events`, formPost({ event: "ONIMCONNECTORMESSAGEADD", "data[CONNECTOR]": CONNECTOR_ID, "data[LINE]": "3", "data[MESSAGES][0][message][text]": text, "data[MESSAGES][0][chat][id]": to, "auth[member_id]": MEMBER, "auth[application_token]": "app-token", "auth[access_token]": "tok-2" }));
    const sent = () => bx.filter((c) => c.method === "imconnector.send.messages").map((c) => c.body.MESSAGES[0]);
    const wait = () => new Promise((r) => setTimeout(r, 80));

    // 1) Temsilci yazınca WhatsApp sunucusundan gizli kimlik öğrenilir; cevap numaralı sohbete düşer
    await agentWrites("905559990000", "Merhaba Ahmet Bey");
    await wait();
    await hook({ id: "A1", remoteJid: "777000111222@lid" }, "Merhaba, buyrun");
    await wait();
    expect(sent().at(-1)).toMatchObject({ chat: { id: "905559990000" }, message: { text: "Merhaba, buyrun" } });

    // 2) Numara beklenmedik bir alanda gelirse de bulunur
    await hook({ id: "A2", remoteJid: "333444555666@lid", senderPhone: "905441230000@s.whatsapp.net" }, "Bilgi alabilir miyim");
    await wait();
    expect(sent().at(-1)).toMatchObject({ chat: { id: "905441230000" } });

    // 3) Cevap bekleyen tek sohbet varsa gizli kimlikli cevap ona bağlanır
    await agentWrites("905327778899", "Teklifimiz ektedir");
    await wait();
    await hook({ id: "A3", remoteJid: "888999000111@lid" }, "Teşekkürler");
    await wait();
    expect(sent().at(-1)).toMatchObject({ chat: { id: "905327778899" }, message: { text: "Teşekkürler" } });

    // İki sohbet cevap beklerken tahmin yapılmaz, gizli kimlikle kalır
    await agentWrites("905320000001", "A");
    await agentWrites("905320000002", "B");
    await wait();
    await hook({ id: "A4", remoteJid: "123123123123@lid" }, "Kimim ben?");
    await wait();
    expect(sent().at(-1)).toMatchObject({ chat: { id: "123123123123@lid" } });
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

