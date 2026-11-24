import express from "express";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createMemoryStore, type Store } from "../server/db";
import { registerWorktimeRoutes } from "../server/worktime";
import { dailyReportMessages, duration, registerTelegram, runTelegramSchedule, setTelegramSender, worktimeMessage } from "../server/telegram";

const savedEnv = { ...process.env };
let store: Store;
let server: ReturnType<express.Application["listen"]>;
let base = "";
let auth: any;
let sent: { chat: string; text: string }[] = [];

beforeEach(async () => {
  process.env.XRE_OWNER_OPEN_ID = "owner-1";
  process.env.TELEGRAM_CHAT_ID = "-100111";
  delete process.env.TELEGRAM_BOT_TOKEN;
  sent = [];
  setTelegramSender(async (chat, text) => void sent.push({ chat, text }));
  store = createMemoryStore();
  auth = { user: { openId: "employee-1", name: "Ayşe Yılmaz" }, displayName: "Ayşe Yılmaz", ownerOpenId: "owner-1", isOwner: true };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).auth = auth;
    next();
  });
  registerWorktimeRoutes(app, store);
  registerTelegram(app, store);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  setTelegramSender(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

const move = async (action: string, extra: Record<string, unknown> = {}) => {
  const response = await fetch(`${base}/api/worktime/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, operationId: crypto.randomUUID(), ...extra }),
  });
  expect(response.status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return response.json();
};

it("mesai hareketleri gruba yazılır; aynı işlem iki kez gönderilmez", async () => {
  await move("start");
  await move("pause", { pauseType: "meal" });
  await move("resume");
  await move("pause", { pauseType: "appointment", meetingWith: "Deniz <Arslan>", meetingProject: "Nova Life" });
  await move("resume");
  const operationId = crypto.randomUUID();
  await move("finish", { operationId });
  await move("finish", { operationId }); // yinelenen istek
  expect(sent.map((m) => m.chat)).toEqual(Array(6).fill("-100111"));
  expect(sent[0].text).toContain("🟢 <b>Ayşe Yılmaz</b> mesaiye başladı");
  expect(sent[1].text).toContain("yemek molasına çıktı");
  expect(sent[2].text).toContain("yemek molasından döndü");
  expect(sent[3].text).toContain("online randevuya girdi");
  expect(sent[3].text).toContain("Deniz &lt;Arslan&gt; · Nova Life");
  expect(sent[4].text).toContain("online randevudan çıktı");
  expect(sent[5].text).toContain("mesaiyi bitirdi");
});

it("başka çalışma alanının hareketi ve kapatılmış bildirim gruba gitmez", async () => {
  auth = { ...auth, ownerOpenId: "baska-firma" };
  await move("start");
  expect(sent).toHaveLength(0);
  auth = { ...auth, ownerOpenId: "owner-1" };
  process.env.TELEGRAM_WORKTIME_MOVES = "kapali";
  await move("start");
  expect(sent).toHaveLength(0);
});

it("süresi aşan mola, kapatma hatırlatması ve günlük rapor birer kez gider", async () => {
  process.env.TELEGRAM_WORKTIME_MOVES = "kapali";
  await store.put("employee", "e1", { id: "e1", name: "Ayşe Yılmaz", openId: "employee-1", active: true }, "owner-1");
  await store.put("employee", "e2", { id: "e2", name: "Mert Kaya", openId: "employee-2", active: true }, "owner-1");
  await move("start");
  await move("pause", { pauseType: "need" });
  const soon = new Date(Date.now() + 5 * 60_000);
  expect(await runTelegramSchedule(store, soon)).not.toContain("break");
  const later = new Date(Date.now() + 20 * 60_000);
  expect(await runTelegramSchedule(store, later)).toContain("break");
  expect(await runTelegramSchedule(store, later)).not.toContain("break");
  expect(sent.find((m) => m.text.includes("ihtiyaç molasında"))?.text).toContain("hak 15 dk");

  // Bugün İstanbul saatiyle 18:10 ve 20:05
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
  const at = (hm: string) => new Date(`${day}T${hm}:00+03:00`);
  sent = [];
  expect(await runTelegramSchedule(store, at("17:00"))).toEqual(expect.not.arrayContaining(["reminder", "report"]));
  expect(await runTelegramSchedule(store, at("18:10"))).toContain("reminder");
  expect(await runTelegramSchedule(store, at("18:20"))).not.toContain("reminder");
  expect(sent.some((m) => m.text.includes("Mesaisi hâlâ açık") && m.text.includes("Ayşe Yılmaz"))).toBe(true);
  expect(await runTelegramSchedule(store, at("20:05"))).toContain("report");
  expect(await runTelegramSchedule(store, at("20:30"))).not.toContain("report");
  const report = sent.find((m) => m.text.includes("GÜNLÜK MESAİ RAPORU"))!.text;
  expect(report).toContain("🥇 <b>Ayşe Yılmaz</b>");
  expect(report).toContain("Kayıt yok:</b> Mert Kaya");
  process.env.TELEGRAM_DAILY_REPORT = "kapali";
});

it("metinler: süre, hak aşımı ve rapor biçimi", () => {
  expect(duration(0)).toBe("0 dk");
  expect(duration(125 * 60_000)).toBe("2 sa 5 dk");
  const back = worktimeMessage({
    name: "Ali",
    action: "resume",
    at: "2026-11-16T10:30:00.000Z",
    netMs: 0,
    breakMs: 0,
    periods: [
      { type: "need", startAt: "2026-11-16T10:00:00.000Z", endAt: "2026-11-16T10:30:00.000Z" },
      { type: "work", startAt: "2026-11-16T10:30:00.000Z", endAt: null },
    ],
  });
  expect(back).toContain("ihtiyaç molasından döndü · 13:30 (30 dk) ⚠️ (hak 15 dk)");
  expect(dailyReportMessages("2026-11-16", [], ["Ali"], true)).toEqual([]);
});

it("görüşme analizi mesajı ve haftalık temsilci raporu", async () => {
  const { callAnalysisMessage, weeklyCallReport } = await import("../server/telegram");
  const text = callAnalysisMessage({ lead: "Ayşe <Yılmaz>", agent: "Mert Kaya", durationSeconds: 125, score: 62, summary: "Fiyat soruldu.", feedback: "Çok enerjik değildi.", nextSteps: "Cumartesi aranacak." });
  expect(text).toContain("Ayşe &lt;Yılmaz&gt; · 2 dk");
  expect(text).toContain("🟡 <b>Puan: 62/100</b>");
  expect(text).toContain("Çok enerjik değildi.");
  const now = new Date("2026-11-23T07:00:00.000Z");
  const o = "owner-1";
  await store.put("employee", "e1", { id: "e1", name: "Mert Kaya", openId: "local:e1", active: true }, o);
  await store.put("pbx-extension", "local:e1", { ext: "125" }, o);
  await store.put("call", "c1", { id: "c1", agent: "125", durationSeconds: 120 }, o);
  await store.put("call", "c2", { id: "c2", agent: "125", durationSeconds: 60 }, o);
  await store.put("call", "c3", { id: "c3", agent: "130", durationSeconds: 30 }, o);
  const post = (id: string, sourceId: string, score: number | undefined, createdAt: string) =>
    store.put("feed", id, { id, kind: "ai-analysis", sourceKind: "call", sourceId, createdAt, analysis: { summary: "x", ...(score === undefined ? {} : { callScore: score }) } }, o);
  await post("f1", "c1", 80, "2026-11-20T10:00:00.000Z");
  await post("f2", "c2", 60, "2026-11-21T10:00:00.000Z");
  await post("f3", "c3", undefined, "2026-11-22T10:00:00.000Z");
  await post("eski", "c1", 10, "2026-11-01T10:00:00.000Z");
  const report = await weeklyCallReport(store, o, now);
  expect(report).toContain("🥇 <b>Mert Kaya</b> — 🟡 ort. 70/100 · 2 görüşme · 3 dk");
  expect(report).toContain("<b>Dahili 130</b> — puan yok · 1 görüşme");
  expect(report).toContain("3 görüşme · ekip ortalaması 70/100");
  expect(await weeklyCallReport(createMemoryStore(), o, now)).toBe("");
});

it("bildirimlerin kopyası WhatsApp numaralarına gider; Telegram ayarı olmadan da çalışır", async () => {
  const { setWhatsappNotifySender, htmlToWhatsapp, sendTelegram: send } = await import("../server/telegram");
  expect(htmlToWhatsapp("🟢 <b>Ayşe &lt;Y&gt;</b> başladı &amp; bitti")).toBe("🟢 *Ayşe <Y>* başladı & bitti");
  const wa: string[] = [];
  setWhatsappNotifySender(async (line, to, text) => void wa.push(`${line}|${to}|${text}`));
  setTelegramSender(null);
  delete process.env.TELEGRAM_CHAT_ID;
  process.env.WHATSAPP_NOTIFY_TO = "0555 000 00 01, 05550000002, kisa";
  await store.put("connection", "cloud-2", { status: "disconnected" }, "owner-1");
  await store.put("connection", "cloud-3", { status: "connected" }, "owner-1");
  await move("start");
  expect(wa).toHaveLength(2);
  expect(wa[0]).toMatch(/^cloud-3\|905550000001\|🟢 \*Ayşe Yılmaz\* mesaiye başladı/);
  // Hat seçilirse o kullanılır; gönderim hatası Telegram'ı engellemez.
  process.env.WHATSAPP_NOTIFY_LINE = "cloud-9";
  setWhatsappNotifySender(async () => { throw new Error("hat bağlı değil"); });
  expect(await send("<b>x</b>")).toBe(false);
  setWhatsappNotifySender(null);
});
