import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { resetWhatsappThrottle } from "../server/whatsapp-chat";
import { istanbulDayStart, lineReplyKey, summarizeLineMessages } from "../server/line-panel";
import { resetLineInventory } from "../shared/lines";

const NOW = Date.parse("2026-03-10T09:00:00.000Z"); // Türkiye saatiyle 12:00
const savedEnv = { ...process.env };
const servers: http.Server[] = [];
beforeEach(() => {
  for (const k of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "META_ACCESS_TOKEN", "META_LINE_MAP_JSON", "WHATSAPP_AUTO_LEAD", "EVOLUTION_WEBHOOK_SECRET"]) delete process.env[k];
  Object.assign(process.env, {
    XRE_SESSION_SECRET: "line-panel-test-secret-0123456789",
    XRE_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "xre-lp-")),
    OUTBOUND_ALLOW_PRIVATE_HOSTS: "127.0.0.1",
    WHATSAPP_MIN_INTERVAL_MS: "0",
    EVOLUTION_API_KEY: "evo",
  });
  resetWhatsappThrottle();
});
afterEach(() => {
  vi.useRealTimers();
  resetLineInventory();
  for (const s of servers.splice(0)) s.close();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

// Sıra bilerek karışık: depo sıralaması veritabanına göre değişir.
const seed = [
  { id: "m5", lineId: "cloud-1", phone: "905550000003", direction: "inbound", createdAt: "2026-03-01T10:00:00.000Z" },
  { id: "m2", lineId: "cloud-1", phone: "905550000001", direction: "outbound", createdAt: "2026-03-09T21:00:00.000Z" },
  { id: "m4", lineId: "cloud-1", phone: "905550000002", direction: "inbound", createdAt: "2026-03-10T08:30:00.000Z" },
  { id: "m1", lineId: "cloud-1", phone: "905550000001", direction: "inbound", createdAt: "2026-03-09T20:59:59.000Z" },
  { id: "m3", lineId: "cloud-1", phone: "905550000002", direction: "outbound", createdAt: "2026-03-10T07:00:00.000Z" },
  { id: "m6", lineId: "cloud-2", phone: "905550000004", direction: "inbound", createdAt: "2026-03-10T06:00:00.000Z" },
  { id: "m7", lineId: "", phone: "905550000005", direction: "inbound", createdAt: "2026-03-10T06:00:00.000Z" },
].map((m) => ({ ...m, leadId: null, provider: "evolution", type: "text", text: "Merhaba", status: "sent" }));
const asRows = () => seed.map((payload) => ({ kind: "message", id: payload.id, payload, ownerOpenId: "o" }));

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
const json = (cookie?: string) => ({ "content-type": "application/json", ...(cookie ? { cookie } : {}) });
const cookieOf = (r: Response) => (r.headers.get("set-cookie") || "").split(";")[0];

async function setup() {
  process.env.EVOLUTION_API_URL = await listen((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url?.startsWith("/instance/connectionState")) return res.end(JSON.stringify({ instance: { state: "open" } }));
      res.end(JSON.stringify({ key: { id: `WA-${Math.random().toString(36).slice(2)}` } }));
    });
  });
  const store = createMemoryStore();
  const base = await listen(createApp({ store }));
  const r = await fetch(`${base}/api/auth/setup`, { method: "POST", headers: json(), body: JSON.stringify({ name: "Sahip", email: "sahip@x.test", password: "Sahip12345" }) });
  const owner = json(cookieOf(r));
  const ownerId = (await store.resolveOwner())!;
  const staff = async (name: string, email: string, roleId = "sales") => {
    const created = await fetch(`${base}/api/auth/accounts`, { method: "POST", headers: owner, body: JSON.stringify({ name, email, password: "Personel123", roleId }) });
    expect(created.status).toBe(201);
    const login = await fetch(`${base}/api/auth/local-login`, { method: "POST", headers: json(), body: JSON.stringify({ email, password: "Personel123" }) });
    return json(cookieOf(login));
  };
  const ayse = await staff("Ayşe Danışman", "ayse@x.test");
  const mert = await staff("Mert Danışman", "mert@x.test");
  for (const id of ["cloud-1", "cloud-2"])
    await store.put("connection", id, { id, status: "connected", phone: id === "cloud-1" ? "905553000001" : "905553000002", profileName: "Satış Ofisi", connectedAt: "2026-03-08T10:00:00.000Z" }, ownerId);
  for (const message of seed) await store.put("message", message.id, message, ownerId);
  const get = async (url: string, headers: any) => (await fetch(`${base}${url}`, { headers })).json();
  const summary = async (headers: any) => get("/api/whatsapp/lines/summary", headers);
  const send = (headers: any, lineId: string, to: string) =>
    fetch(`${base}/api/whatsapp/send`, { method: "POST", headers, body: JSON.stringify({ to, lineId, text: "Merhaba" }) });
  const settings = (headers: any, lineId: string, body: unknown) =>
    fetch(`${base}/api/whatsapp/lines/${lineId}/settings`, { method: "PUT", headers, body: JSON.stringify(body) });
  const employees: { id: string; name: string }[] = (await summary(owner)).employees;
  const idOf = (name: string) => employees.find((e) => e.name === name)!.id;
  return { base, store, ownerId, owner, ayse, mert, staff, get, summary, send, settings, idOf };
}
const lineOf = (body: any, id: string) => body.lines.find((l: any) => l.id === id);

describe("Hat panosu özeti", () => {
  it("Türkiye gününe göre bugünkü mesajları, sohbetleri ve bekleyenleri tek geçişte sayar", () => {
    expect(new Date(istanbulDayStart(NOW)).toISOString()).toBe("2026-03-09T21:00:00.000Z");
    const result = summarizeLineMessages(asRows(), { now: NOW, lineIds: new Set(["cloud-1", "cloud-2", "cloud-3"]) });
    expect(result.get("cloud-1")).toEqual({
      lastMessageAt: Date.parse("2026-03-10T08:30:00.000Z"),
      todayIn: 1, // dün 23:59:59'da gelen mesaj bugüne sayılmaz
      todayOut: 2,
      chats: 3,
      waiting: 1, // son mesajı müşteriden gelen iki sohbetten biri 7 günden eski: sayılmaz
    });
    expect(result.get("cloud-2")).toEqual({ lastMessageAt: Date.parse("2026-03-10T06:00:00.000Z"), todayIn: 1, todayOut: 0, chats: 1, waiting: 1 });
    expect(result.get("cloud-3")).toEqual({ lastMessageAt: 0, todayIn: 0, todayOut: 0, chats: 0, waiting: 0 });
    // Görme yetkisi olmayan mesajlar ve listede olmayan hatlar sayılmaz.
    const limited = summarizeLineMessages(asRows(), { now: NOW, lineIds: new Set(["cloud-1"]), visible: (m) => m.phone === "905550000002" });
    expect([...limited.keys()]).toEqual(["cloud-1"]);
    expect(limited.get("cloud-1")).toMatchObject({ chats: 1, waiting: 1, todayIn: 1, todayOut: 1 });
  });

  it("telefondan yanıtlanan sohbeti bekleyen saymaz; yanıttan sonra yeni mesaj gelirse yeniden sayar", () => {
    const options = { now: NOW, lineIds: new Set(["cloud-1", "cloud-2"]) };
    const answered = new Map([[lineReplyKey("cloud-1", "905550000002"), Date.parse("2026-03-10T08:40:00.000Z")]]);
    const result = summarizeLineMessages(asRows(), { ...options, replies: answered });
    expect(result.get("cloud-1")).toMatchObject({ chats: 3, waiting: 0 });
    // Başka hattaki aynı numaranın yanıtı bu hattı etkilemez.
    expect(result.get("cloud-2")).toMatchObject({ waiting: 1 });
    const stale = new Map([[lineReplyKey("cloud-1", "905550000002"), Date.parse("2026-03-10T08:00:00.000Z")]]);
    expect(summarizeLineMessages(asRows(), { ...options, replies: stale }).get("cloud-1")).toMatchObject({ waiting: 1 });
  });

  it("telefonu olmayan kayıtlı müşteri mesajını aynı sohbete bağlar ve mesajları hat sayısından bağımsız tek kez okur", () => {
    const rows = [
      { kind: "message", id: "a", ownerOpenId: "o", payload: { lineId: "cloud-1", phone: "905550000009", leadId: null, direction: "inbound", createdAt: "2026-03-10T08:00:00.000Z" } },
      { kind: "message", id: "b", ownerOpenId: "o", payload: { lineId: "cloud-1", leadId: "L1", direction: "outbound", createdAt: "2026-03-10T08:05:00.000Z" } },
    ];
    const linked = summarizeLineMessages(rows, { now: NOW, lineIds: new Set(["cloud-1"]), leadPhones: new Map([["L1", "905550000009"]]) });
    expect(linked.get("cloud-1")).toMatchObject({ chats: 1, waiting: 0 });

    const many = Array.from({ length: 60_000 }, (_, i) => ({
      kind: "message",
      id: `x${i}`,
      ownerOpenId: "o",
      payload: { lineId: `cloud-${(i % 20) + 1}`, phone: `90555${String(1_000_000 + (i % 5000))}`, direction: i % 2 ? "inbound" : "outbound", createdAt: new Date(NOW - i * 60_000).toISOString() },
    }));
    // Süre ölçmek yerine okuma sayılır: 20 hat olsa da liste bir kez, her mesaj bir kez okunur.
    let passes = 0;
    let reads = 0;
    const counted = {
      *[Symbol.iterator]() {
        passes += 1;
        for (const row of many) {
          reads += 1;
          yield row;
        }
      },
    };
    const big = summarizeLineMessages(counted, { now: NOW, lineIds: new Set(Array.from({ length: 20 }, (_, i) => `cloud-${i + 1}`)) });
    expect([passes, reads]).toEqual([1, 60_000]);
    expect([...big.values()].reduce((sum, a) => sum + a.chats, 0)).toBe(5000);
  });

  it("sahibe hat kartı bilgilerini sabit saatle döndürür", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { owner, summary } = await setup();
    const body = await summary(owner);
    expect(body.canManage).toBe(true);
    expect(body.employees.map((e: any) => e.name).sort()).toEqual(["Ayşe Danışman", "Mert Danışman"]);
    expect(lineOf(body, "cloud-1")).toMatchObject({
      name: "XRE Bulut 1",
      status: "connected",
      phone: "+905553000001",
      profileName: "Satış Ofisi",
      connectedAt: "2026-03-08T10:00:00.000Z",
      lastMessageAt: "2026-03-10T08:30:00.000Z",
      todayIn: 1,
      todayOut: 2,
      chats: 3,
      waiting: 1,
      staff: [],
    });
    expect(lineOf(body, "cloud-3")).toMatchObject({ status: "disconnected", profileName: "", connectedAt: null, lastMessageAt: null, chats: 0, waiting: 0 });
  });
});

describe("Hatta yetkili personel", () => {
  it("liste boşken eski davranış sürer; personel yalnız görebildiği sohbetlerin sayısını alır", async () => {
    const { ayse, owner, summary, send, get, settings } = await setup();
    expect((await send(ayse, "cloud-1", "905550000021")).status).toBe(201);
    const mine = await summary(ayse);
    expect(mine.canManage).toBe(false);
    expect(mine.employees).toEqual([]);
    // Ayşe "yalnız kendi kayıtları" yetkisinde: başkalarının 3 sohbeti sayıya girmez.
    expect(lineOf(mine, "cloud-1")).toMatchObject({ chats: 1, waiting: 0, todayOut: 1, todayIn: 0 });
    expect(lineOf(mine, "cloud-2")).toMatchObject({ chats: 0, waiting: 0 });
    expect(lineOf(await summary(owner), "cloud-1")).toMatchObject({ chats: 4 });
    expect((await get("/api/whatsapp/lines", ayse)).lines.map((l: any) => l.lineId)).toEqual(["cloud-1", "cloud-2"]);
    // Satış personeli hat ayarını değiştiremez.
    expect((await settings(ayse, "cloud-1", { employeeIds: [] })).status).toBe(403);
  });

  it("yetkisiz personel hattan yazamaz, hattın mesajlarını ve sayılarını göremez; sahip etkilenmez", async () => {
    const { ayse, mert, owner, summary, send, get, settings, idOf } = await setup();
    expect((await send(ayse, "cloud-1", "905550000021")).status).toBe(201);
    expect((await get("/api/state", ayse)).messages.some((m: any) => m.lineId === "cloud-1")).toBe(true);

    const saved = await settings(owner, "cloud-1", { name: "Satış hattı", employeeIds: [idOf("Mert Danışman"), "olmayan-kisi"] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ id: "cloud-1", name: "Satış hattı", employeeIds: [idOf("Mert Danışman")] });

    const blocked = await send(ayse, "cloud-1", "905550000021");
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toBe("LINE_FORBIDDEN");
    const ayseSummary = await summary(ayse);
    expect(lineOf(ayseSummary, "cloud-1")).toBeUndefined();
    expect(lineOf(ayseSummary, "cloud-2")).toBeDefined();
    expect((await get("/api/whatsapp/lines", ayse)).lines.map((l: any) => l.lineId)).toEqual(["cloud-2"]);
    expect((await get("/api/state", ayse)).messages.some((m: any) => m.lineId === "cloud-1")).toBe(false);
    // Diğer hat serbest kalır.
    expect((await send(ayse, "cloud-2", "905550000022")).status).toBe(201);

    // Listedeki personel ve sahip kullanmaya devam eder.
    expect((await send(mert, "cloud-1", "905550000023")).status).toBe(201);
    expect(lineOf(await summary(mert), "cloud-1")).toMatchObject({ name: "Satış hattı", staff: [{ name: "Mert Danışman" }] });
    expect((await send(owner, "cloud-1", "905550000024")).status).toBe(201);
    const ownerSummary = await summary(owner);
    expect(lineOf(ownerSummary, "cloud-1")).toMatchObject({ name: "Satış hattı", chats: 6, staff: [{ id: idOf("Mert Danışman"), name: "Mert Danışman" }] });
    expect((await get("/api/state", owner)).messages.filter((m: any) => m.lineId === "cloud-1").length).toBe(8);

    // Liste boşaltılınca herkes yeniden kullanır.
    expect((await settings(owner, "cloud-1", { employeeIds: [] })).status).toBe(200);
    expect((await send(ayse, "cloud-1", "905550000021")).status).toBe(201);
    expect(lineOf(await summary(ayse), "cloud-1")).toBeDefined();
  });

  it("şablon ve numara kontrolü uçları da hat yetkisini denetler", async () => {
    const { base, ayse, owner, settings, idOf } = await setup();
    await settings(owner, "cloud-1", { employeeIds: [idOf("Mert Danışman")] });
    for (const url of ["/api/whatsapp/template", "/api/whatsapp/check", "/api/messages"]) {
      const r = await fetch(`${base}${url}`, { method: "POST", headers: ayse, body: JSON.stringify({ lineId: "cloud-1", phone: "905550000021", to: "905550000021", name: "merhaba", leadId: "x", text: "Selam" }) });
      expect([url, r.status]).toEqual([url, 403]);
      expect((await r.json()).error).toBe("LINE_FORBIDDEN");
    }
  });

  it("toplu düzenlemede yetkili personel, bağlı WhatsApp hesabının durduğu hat kimliğinde kalır", async () => {
    const { base, ayse, owner, summary, send, settings, get, idOf } = await setup();
    await settings(owner, "cloud-2", { employeeIds: [idOf("Mert Danışman")] });
    const put = (list: unknown) => fetch(`${base}/api/lines`, { method: "PUT", headers: owner, body: JSON.stringify({ lines: list }) });
    // Envanterde numaraların sırası değişir; bağlantı ve mesajlar kimlikle tutulduğu için cloud-2'de kalır.
    expect((await put([
      { id: "cloud-1", phone: "+905553000002", group: "cloud" },
      { id: "cloud-2", phone: "+905553000001", group: "cloud" },
    ])).status).toBe(200);
    const body = await summary(owner);
    expect(lineOf(body, "cloud-1").staff).toEqual([]);
    expect(lineOf(body, "cloud-2")).toMatchObject({ phone: "+905553000002", staff: [{ id: idOf("Mert Danışman"), name: "Mert Danışman" }] });
    expect((await send(ayse, "cloud-2", "905550000021")).status).toBe(403);
    expect((await send(ayse, "cloud-1", "905550000021")).status).toBe(201);
    expect((await get("/api/state", ayse)).messages.some((m: any) => m.lineId === "cloud-2")).toBe(false);
    // Hat envanterden çıkarılsa da eski sohbetleri herkese açılmaz; hat geri eklenince liste yerindedir.
    expect((await put([{ id: "cloud-1", phone: "+905553000002", group: "cloud" }])).status).toBe(200);
    expect((await get("/api/state", ayse)).messages.some((m: any) => m.lineId === "cloud-2")).toBe(false);
    expect((await get("/api/state", owner)).messages.some((m: any) => m.lineId === "cloud-2")).toBe(true);
    expect((await put([
      { id: "cloud-1", phone: "+905553000002", group: "cloud" },
      { id: "cloud-2", phone: "+905553000009", group: "cloud" },
    ])).status).toBe(200);
    expect(lineOf(await summary(owner), "cloud-2").staff).toEqual([{ id: idOf("Mert Danışman"), name: "Mert Danışman", active: true }]);
  });

  it("yetkisiz yönetici o hattan mesaj gönderen otomasyon kuralı kaydedemez", async () => {
    const { base, owner, staff, settings, idOf } = await setup();
    const manager = await staff("Yusuf Yönetici", "yusuf@x.test", "manager");
    await settings(owner, "cloud-1", { employeeIds: [idOf("Mert Danışman")] });
    const rule = (lineId: string) => ({ name: "Hoş geldin", triggerStage: "contacted", action: "whatsapp", enabled: true, config: { lineId, template: "Merhaba {{name}}" } });
    const blocked = await fetch(`${base}/api/rules`, { method: "POST", headers: manager, body: JSON.stringify(rule("cloud-1")) });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toBe("LINE_FORBIDDEN");
    // Yetkili olduğu hat için kural kaydeder; sonra yetkisiz hatta çeviremez.
    const allowed = await fetch(`${base}/api/rules`, { method: "POST", headers: manager, body: JSON.stringify(rule("cloud-2")) });
    expect(allowed.status).toBe(201);
    const id = (await allowed.json()).id;
    const moved = await fetch(`${base}/api/rules/${id}`, { method: "PATCH", headers: manager, body: JSON.stringify({ config: { lineId: "cloud-1", template: "Merhaba" } }) });
    expect(moved.status).toBe(403);
    expect((await fetch(`${base}/api/rules/${id}`, { method: "PATCH", headers: manager, body: JSON.stringify({ name: "Karşılama" }) })).status).toBe(200);
    // Sahip her hat için kural kaydeder.
    expect((await fetch(`${base}/api/rules`, { method: "POST", headers: owner, body: JSON.stringify(rule("cloud-1")) })).status).toBe(201);
  });

  it("pasife alınan personel listede kalır; yalnız ad değişince hat herkese açılmaz", async () => {
    const { store, ownerId, ayse, owner, summary, send, settings, idOf } = await setup();
    const mertId = idOf("Mert Danışman");
    await settings(owner, "cloud-1", { employeeIds: [mertId] });
    const record = (await store.get<any>("employee", mertId, ownerId))!;
    await store.put("employee", mertId, { ...record.payload, active: false }, ownerId);
    const before = await summary(owner);
    expect(before.employees.map((e: any) => e.name)).toEqual(["Ayşe Danışman"]);
    expect(lineOf(before, "cloud-1").staff).toEqual([{ id: mertId, name: "Mert Danışman", active: false }]);
    // Pencere listeyi olduğu gibi geri yollar; yalnız ad değişir.
    const renamed = await settings(owner, "cloud-1", { name: "Satış hattı", employeeIds: [mertId] });
    expect(await renamed.json()).toMatchObject({ name: "Satış hattı", employeeIds: [mertId] });
    expect((await send(ayse, "cloud-1", "905550000021")).status).toBe(403);
    // Tanınmayan kişilerden oluşan liste hattı açmaz, hata verir.
    expect((await settings(owner, "cloud-2", { employeeIds: ["olmayan-kisi"] })).status).toBe(400);
    expect(lineOf(await summary(owner), "cloud-2").staff).toEqual([]);
    // Sahip işareti kaldırınca hat bilerek açılır; pasif kişi sonradan yeniden seçilemez.
    expect((await settings(owner, "cloud-1", { employeeIds: [] })).status).toBe(200);
    expect((await send(ayse, "cloud-1", "905550000021")).status).toBe(201);
    expect((await settings(owner, "cloud-1", { employeeIds: [mertId] })).status).toBe(400);
  });

  it("yetkisiz personele hattın bağlı hesabı ve o hattan çıkarılan sohbet özeti gönderilmez", async () => {
    const { base, store, ownerId, owner, staff, get, settings, idOf } = await setup();
    const at = "2026-03-10T08:00:00.000Z";
    const post = (id: string, lineIds?: string[]) =>
      store.put("feed", id, { id, author: "XRE Asistan", text: `Özet ${id}`, leadId: "", likes: [], comments: [], createdAt: at, updatedAt: at, ...(lineIds ? { lineIds } : {}) }, ownerId);
    await post("ozet-1", ["cloud-1"]);
    await post("ozet-2", ["cloud-2"]);
    await post("duyuru");
    await store.put("conversation_analysis", "ca-1", { id: "ca-1", type: "conversation-analysis", kind: "whatsapp", sourceKind: "whatsapp", sourceId: "m4", fingerprint: "f1", status: "completed", lineIds: ["cloud-1"], createdAt: at, updatedAt: at }, ownerId);
    const feedIds = async (headers: any) => (await get("/api/state", headers)).feed.map((p: any) => p.id).sort();
    const version = (await get("/api/state", owner)).lineStaffVersion;
    // Yöneticiler tüm kayıtları görür; Yusuf hatta yetkili değil, Zeynep yetkili.
    const yusuf = await staff("Yusuf Yönetici", "yusuf@x.test", "manager");
    const zeynep = await staff("Zeynep Yönetici", "zeynep@x.test", "manager");
    const zeynepId = (await get("/api/whatsapp/lines/summary", owner)).employees.find((e: any) => e.name === "Zeynep Yönetici").id;
    expect(await feedIds(yusuf)).toEqual(["duyuru", "ozet-1", "ozet-2"]);

    await settings(owner, "cloud-1", { employeeIds: [idOf("Mert Danışman"), zeynepId] });
    expect(await feedIds(yusuf)).toEqual(["duyuru", "ozet-2"]);
    expect(await feedIds(zeynep)).toEqual(["duyuru", "ozet-1", "ozet-2"]);
    expect(await feedIds(owner)).toEqual(["duyuru", "ozet-1", "ozet-2"]);
    // Açık ekranların hat özetini yenilemesi için durum imzası değişir.
    expect((await get("/api/state", owner)).lineStaffVersion).not.toBe(version);
    expect((await get("/api/conversation-analysis", owner)).annotations.map((a: any) => a.id)).toEqual(["ca-1"]);
    // Bağlı hesap bilgisi (numara, profil adı) yalnız yetkili olunan hatlar için gelir.
    expect((await get("/api/state", owner)).connections.map((c: any) => c.id).sort()).toEqual(["cloud-1", "cloud-2"]);
    expect((await get("/api/state", owner)).connections[0].connectedAt).toBe("2026-03-08T10:00:00.000Z");
    expect((await get("/api/state", yusuf)).connections.map((c: any) => c.id)).toEqual(["cloud-2"]);
    expect((await get("/api/conversation-analysis", yusuf)).annotations).toEqual([]);
    // Beğeni/yorum gibi güncellemeler hat bilgisini silemez.
    const liked = await fetch(`${base}/api/feed/ozet-1`, { method: "PATCH", headers: owner, body: JSON.stringify({ likes: ["sahip"], lineIds: [] }) });
    expect(liked.status).toBe(200);
    expect(await feedIds(yusuf)).toEqual(["duyuru", "ozet-2"]);
    expect(await feedIds(zeynep)).toEqual(["duyuru", "ozet-1", "ozet-2"]);
  });
});

describe("Hat bağlantısı", () => {
  it("bağlı hatta QR istenince anlaşılır bir açıklama döner; bağlantı tarihi durumla birlikte gelir", async () => {
    const { base, owner } = await setup();
    const r = await fetch(`${base}/api/connections/cloud-1/qr`, { method: "POST", headers: owner, body: "{}" });
    expect(r.status).toBe(409);
    const message = (await r.json()).message;
    expect(message).toContain("zaten bağlı");
    expect(message).not.toMatch(/Evolution|instance/i);
  });

  it("telefondan yazılan yanıt sohbete kaydedilmez ama bekleyen sayısını düşürür", async () => {
    process.env.EVOLUTION_WEBHOOK_SECRET = "hook-secret";
    const { base, store, ownerId, owner, summary } = await setup();
    const hook = (body: unknown) =>
      fetch(`${base}/api/webhooks/evolution?token=hook-secret`, { method: "POST", headers: json(), body: JSON.stringify(body) });
    const upsert = (fromMe: boolean, id: string) => ({
      event: "messages.upsert",
      instance: "cloud-3",
      data: { key: { remoteJid: "905550000031@s.whatsapp.net", fromMe, id }, pushName: "Deneme", message: { conversation: "Merhaba" } },
    });
    expect((await hook(upsert(false, "WA-IN-1"))).status).toBe(200);
    await vi.waitFor(async () => expect(lineOf(await summary(owner), "cloud-3")).toMatchObject({ chats: 1, waiting: 1 }));
    // Okundu bilgisi yanıt sayılmaz.
    await hook({ event: "messages.update", instance: "cloud-3", data: { key: { remoteJid: "905550000031@s.whatsapp.net", fromMe: true, id: "ESKI" }, status: "READ" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(lineOf(await summary(owner), "cloud-3")).toMatchObject({ waiting: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect((await hook(upsert(true, "WA-OUT-1"))).status).toBe(200);
    await vi.waitFor(async () => expect(lineOf(await summary(owner), "cloud-3")).toMatchObject({ chats: 1, waiting: 0 }));
    expect((await store.list<any>("message", ownerId)).filter((m) => m.payload.lineId === "cloud-3").length).toBe(1);
  });
});
