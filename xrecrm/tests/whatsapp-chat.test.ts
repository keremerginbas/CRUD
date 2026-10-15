import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { resetWhatsappThrottle } from "../server/whatsapp-chat";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "META_ACCESS_TOKEN", "META_LINE_MAP_JSON", "WHATSAPP_AUTO_LEAD"]) delete process.env[k];
  Object.assign(process.env, {
    XRE_SESSION_SECRET: "wa-test-secret-0123456789abcdef",
    XRE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "xre-wa-")),
    OUTBOUND_ALLOW_PRIVATE_HOSTS: "127.0.0.1",
    WHATSAPP_MIN_INTERVAL_MS: "0",
    WHATSAPP_DAILY_NEW_CONTACTS: "2",
    EVOLUTION_API_KEY: "evo",
  });
  resetWhatsappThrottle();
});
afterEach(() => {
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
  const sent: { url: string; body: any }[] = [];
  process.env.EVOLUTION_API_URL = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : {};
      sent.push({ url: req.url || "", body: parsed });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.startsWith("/instance/connectionState")) return res.end(JSON.stringify({ instance: { state: "open" } }));
      if (req.url?.startsWith("/chat/whatsappNumbers")) return res.end(JSON.stringify([{ exists: parsed.numbers[0].endsWith("1"), jid: "x", number: parsed.numbers[0] }]));
      res.end(JSON.stringify({ key: { id: `WA-${sent.length}` } }));
    });
  });
  const store = createMemoryStore();
  const base = await listen(createApp({ store }));
  const r = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sahip", email: "s@x.test", password: "Sahip12345" }) });
  const headers = { "content-type": "application/json", cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
  const owner = (await store.resolveOwner())!;
  await store.put("connection", "cloud-1", { id: "cloud-1", status: "connected" }, owner);
  return { store, base, headers, owner, sent };
}
const post = (base: string, url: string, headers: any, body: unknown) => fetch(`${base}${url}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("WhatsApp sohbet (WhatCRM tarzı)", () => {
  it("kayıtsız numaraya şablonsuz yazar, müşteri açmaz ve günlük yeni kişi sınırı uygular", async () => {
    const { base, headers, sent } = await setup();
    const lines = await (await fetch(`${base}/api/whatsapp/lines`, { headers })).json();
    expect(lines.lines.find((l: any) => l.lineId === "cloud-1")).toMatchObject({ provider: "evolution" });

    const first = await post(base, "/api/whatsapp/send", headers, { to: "0555 111 22 31", lineId: "cloud-1", text: "Merhaba" });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ leadId: null, phone: "905551112231", firstContact: true, provider: "evolution" });
    expect(sent.find((s) => s.url === "/message/sendText/cloud-1")?.body).toMatchObject({ number: "905551112231", text: "Merhaba" });
    // Aynı kişiye ikinci mesaj sınırı tüketmez
    expect((await post(base, "/api/whatsapp/send", headers, { to: "905551112231", lineId: "cloud-1", text: "Nasılsınız?" })).status).toBe(201);
    expect((await post(base, "/api/whatsapp/send", headers, { to: "05551112232", lineId: "cloud-1", text: "Selam" })).status).toBe(201);
    const capped = await post(base, "/api/whatsapp/send", headers, { to: "05551112233", lineId: "cloud-1", text: "Selam" });
    expect(capped.status).toBe(429);
    expect((await capped.json()).error).toBe("DAILY_LIMIT");

    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.leads).toHaveLength(0);
    expect(state.messages.filter((m: any) => m.phone === "905551112231")).toHaveLength(2);

    const check = await (await post(base, "/api/whatsapp/check", headers, { lineId: "cloud-1", phone: "05551112231" })).json();
    expect(check).toMatchObject({ checked: true, exists: true });

    const saved = await post(base, "/api/whatsapp/contacts", headers, { phone: "05551112231", name: "Ayşe Yılmaz" });
    expect(saved.status).toBe(201);
    const { lead, linked } = await saved.json();
    expect(linked).toBe(2);
    const after = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(after.messages.filter((m: any) => m.leadId === lead.id)).toHaveLength(2);
  });

  it("gelen mesaj varsayılan olarak müşteri açmaz, ayar açıkken açar", async () => {
    const { base, headers } = await setup();
    process.env.EVOLUTION_WEBHOOK_SECRET = "hook-secret";
    const inbound = (id: string, phone: string) =>
      fetch(`${base}/api/webhooks/evolution`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer hook-secret", apikey: "hook-secret" },
        body: JSON.stringify({ event: "messages.upsert", instance: "cloud-1", data: { key: { id, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false }, pushName: "Mehmet", message: { conversation: "Fiyat nedir?" } } }),
      });
    expect((await inbound("IN-1", "905551119999")).status).toBeLessThan(300);
    let state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.leads).toHaveLength(0);
    expect(state.messages[0]).toMatchObject({ phone: "905551119999", contactName: "Mehmet", direction: "inbound" });
    process.env.WHATSAPP_AUTO_LEAD = "1";
    await inbound("IN-2", "905551118888");
    state = await (await fetch(`${base}/api/state`, { headers })).json();
    expect(state.leads.map((l: any) => l.phone)).toEqual(["905551118888"]);
  });

  it("zarflı, konum, kişi ve sistem mesajlarını okunur kaydeder", async () => {
    const { base, headers } = await setup();
    process.env.EVOLUTION_WEBHOOK_SECRET = "hook-secret";
    const inbound = (id: string, message: unknown) =>
      fetch(`${base}/api/webhooks/evolution`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer hook-secret" },
        body: JSON.stringify({ event: "messages.upsert", instance: "cloud-1", data: { key: { id, remoteJid: "905551110000@s.whatsapp.net", fromMe: false }, pushName: "Murat", message } }),
      });
    await inbound("E-1", { ephemeralMessage: { message: { extendedTextMessage: { text: "Süreli selam" } } }, messageContextInfo: {} });
    await inbound("E-2", { locationMessage: { degreesLatitude: 41.01, degreesLongitude: 28.97, name: "Ofis" } });
    await inbound("E-3", { contactMessage: { displayName: "Ayşe Hanım" } });
    await inbound("E-4", { viewOnceMessageV2: { message: { imageMessage: { mimetype: "image/jpeg", caption: "Tek görümlük" } } } });
    await inbound("E-5", { ptvMessage: { mimetype: "video/mp4" } });
    await inbound("E-6", { protocolMessage: { type: 0 } });
    await inbound("E-7", { someNewMessage: {} });
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    const byId = Object.fromEntries(state.messages.map((m: any) => [m.id, m]));
    expect(byId["E-1"].text).toBe("Süreli selam");
    expect(byId["E-2"].text).toContain("📍 Konum: Ofis");
    expect(byId["E-2"].text).toContain("maps.google.com/?q=41.01,28.97");
    expect(byId["E-3"].text).toBe("👤 Kişi kartı: Ayşe Hanım");
    expect(byId["E-4"]).toMatchObject({ text: "Tek görümlük", mediaType: "image" });
    expect(byId["E-5"]).toMatchObject({ text: "[Video]", mediaType: "video" });
    expect(byId["E-6"]).toBeUndefined();
    expect(byId["E-7"].text).toBe("[Desteklenmeyen mesaj türü: someNewMessage]");
  });

  it("bağlı numara ve profil adı durum verisinde görünür", async () => {
    const { base, headers, store, owner } = await setup();
    await store.put("connection", "ai-1", { id: "ai-1", status: "connected", phone: "905321116976", profileName: "XRE", secretish: "x" }, owner);
    const state = await (await fetch(`${base}/api/state`, { headers })).json();
    const c = state.connections.find((x: any) => x.id === "ai-1");
    expect(c).toMatchObject({ phone: "905321116976", profileName: "XRE" });
    expect(c.secretish).toBeUndefined();
  });

  it("Meta hattında 24 saat penceresi kapalıysa serbest metni engeller", async () => {
    const { base, headers } = await setup();
    Object.assign(process.env, { META_ACCESS_TOKEN: "meta", META_LINE_MAP_JSON: JSON.stringify({ "office-2": "12345" }) });
    const blocked = await post(base, "/api/whatsapp/send", headers, { to: "05551117777", lineId: "office-2", text: "Merhaba" });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("TEMPLATE_REQUIRED");
  });
});

describe("Evolution webhook ayarı", () => {
  it("gizli anahtarı başlık ve adreste taşır, olay başına adres kullanmaz", async () => {
    const { evolutionWebhookConfig } = await import("../server/integrations");
    process.env.EVOLUTION_WEBHOOK_URL = "http://crm:3000/api/webhooks/evolution";
    process.env.EVOLUTION_WEBHOOK_SECRET = "gizli-123";
    const config = evolutionWebhookConfig()!;
    expect(config).toMatchObject({ byEvents: false, headers: { authorization: "Bearer gizli-123" } });
    expect(config.url).toBe("http://crm:3000/api/webhooks/evolution?token=gizli-123");
    delete process.env.EVOLUTION_WEBHOOK_SECRET;
    expect(evolutionWebhookConfig()).toBeUndefined();
  });
});
