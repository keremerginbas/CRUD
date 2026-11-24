// Telegram bildirimleri: mesai hareketleri, günlük mesai raporu, hatırlatmalar ve otomasyon mesajları
// tek bir bot üzerinden firmanın Telegram grubuna gider. Ayarlar Entegrasyonlar ekranından girilir.
import type { Express, Request } from "express";
import type { Store } from "./db.js";
import { sendEvolutionText } from "./integrations.js";
import { normalizePhone } from "./security.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { setCallAnalysisListener } from "./conversation-analysis.js";
import { setWorktimeListener, worktimeDaySnapshot, type WorktimeDayRow } from "./worktime.js";

const env = (key: string) => (process.env[key] || "").trim();
export const telegramConfigured = () => Boolean(env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID"));

type Sender = (chatId: string, html: string) => Promise<void>;
let override: Sender | null = null;
/** Testler için: gerçek Telegram çağrısı yerine verilen işlev kullanılır. */
export const setTelegramSender = (fn: Sender | null) => void (override = fn);

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// ---- WhatsApp'a kopya -------------------------------------------------------------------
// Telegram kullanmayan ekipler için aynı bildirimler seçilen WhatsApp numaralarına da gider.
type WaSender = (lineId: string, to: string, text: string) => Promise<unknown>;
let waSender: WaSender = (lineId, to, text) => sendEvolutionText(lineId, to, text);
let waStore: Store | null = null;
/** Testler için WhatsApp gönderimini değiştirir. */
export const setWhatsappNotifySender = (fn: WaSender | null) => void (waSender = fn || ((lineId, to, text) => sendEvolutionText(lineId, to, text)));
export const whatsappNotifyNumbers = () => env("WHATSAPP_NOTIFY_TO").split(/[,;\n]+/).map((v) => normalizePhone(v)).filter((v) => v.length >= 10).slice(0, 10);
export const notificationsConfigured = () => telegramConfigured() || whatsappNotifyNumbers().length > 0;
/** Telegram'ın HTML biçimini WhatsApp yazısına çevirir (kalın: *…*). */
export const htmlToWhatsapp = (html: string) =>
  html
    .replace(/<b>(.*?)<\/b>/gs, "*$1*")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
async function notifyLine(): Promise<string> {
  const chosen = env("WHATSAPP_NOTIFY_LINE");
  if (chosen || !waStore) return chosen;
  // Hat seçilmediyse bağlı ilk WhatsApp hattı kullanılır.
  const owner = await waStore.resolveOwner().catch(() => undefined);
  if (!owner) return "";
  const rows = await waStore.list<{ status?: string }>("connection", owner);
  return rows.find((row) => row.payload.status === "connected")?.id || "";
}
/** Bildirimi WhatsApp numaralarına gönderir; gönderilen kişi sayısını döndürür. */
export async function sendWhatsappNotice(html: string): Promise<number> {
  const numbers = whatsappNotifyNumbers();
  if (!numbers.length) return 0;
  const lineId = await notifyLine();
  if (!lineId) throw new Error("WhatsApp bildirimi için bağlı bir hat yok. WhatsApp sayfasından bir hat bağlayın.");
  const text = htmlToWhatsapp(html).slice(0, 4000);
  let sent = 0;
  for (const to of numbers) {
    await waSender(lineId, to, text);
    sent += 1;
  }
  return sent;
}

/** Gruba (ya da verilen sohbete) HTML biçimli mesaj gönderir. Ayar yoksa sessizce atlar. */
export async function sendTelegram(html: string, chatId = env("TELEGRAM_CHAT_ID")): Promise<boolean> {
  // Varsayılan gruba giden her bildirimin kopyası WhatsApp'a da gider; biri hata verse diğeri etkilenmez.
  const wa = chatId === env("TELEGRAM_CHAT_ID") ? await sendWhatsappNotice(html).catch((error) => (console.warn("WhatsApp bildirimi gönderilemedi:", error instanceof Error ? error.message : error), 0)) : 0;
  return (await sendTelegramOnly(html, chatId)) || wa > 0;
}
async function sendTelegramOnly(html: string, chatId: string): Promise<boolean> {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (override) {
    await override(chatId, html);
    return true;
  }
  if (!token || !chatId) return false;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(`Telegram: ${body.description || `HTTP ${response.status}`}`);
  }
  return true;
}

// ---- Mesai metinleri -------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "—");
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}
const BREAK: Record<string, { emoji: string; name: string }> = {
  need: { emoji: "☕", name: "ihtiyaç molası" },
  meal: { emoji: "🍽", name: "yemek molası" },
  appointment: { emoji: "🎥", name: "online randevu" },
};
/** Mola hakları (dakika): aşılırsa gruba bir kez uyarı gider. */
export const BREAK_LIMIT_MIN: Record<string, number> = { need: 15, meal: 70 };

interface Period {
  type: string;
  startAt: string;
  endAt: string | null;
  meetingWith?: string;
  meetingProject?: string;
}
export interface WorktimeMove {
  name: string;
  action: "start" | "pause" | "resume" | "finish";
  pauseType?: string;
  at: string;
  periods: Period[];
  netMs: number;
  breakMs: number;
}

/** Bir mesai hareketinin grup mesajı. */
export function worktimeMessage(move: WorktimeMove): string {
  const who = `<b>${escapeHtml(move.name)}</b>`;
  const at = clock(move.at);
  if (move.action === "start") return `🟢 ${who} mesaiye başladı · ${at}`;
  if (move.action === "pause") {
    const info = BREAK[move.pauseType || "need"] || BREAK.need;
    const open = [...move.periods].reverse().find((p) => p.endAt === null);
    const meeting = move.pauseType === "appointment" && open ? [open.meetingWith, open.meetingProject].filter(Boolean).map(escapeHtml).join(" · ") : "";
    return move.pauseType === "appointment"
      ? `${info.emoji} ${who} online randevuya girdi · ${at}${meeting ? `\n      ${meeting}` : ""}`
      : `${info.emoji} ${who} ${info.name}na çıktı · ${at}`;
  }
  if (move.action === "resume") {
    // Az önce kapanan mola: sondan ikinci dönem.
    const closed = [...move.periods].reverse().find((p) => p.type !== "work" && p.endAt !== null);
    const info = BREAK[closed?.type || "need"] || BREAK.need;
    const took = closed?.endAt ? Date.parse(closed.endAt) - Date.parse(closed.startAt) : 0;
    const limit = BREAK_LIMIT_MIN[closed?.type || ""];
    const over = limit && took > limit * 60_000 ? ` ⚠️ (hak ${limit} dk)` : "";
    return closed?.type === "appointment"
      ? `↩️ ${who} online randevudan çıktı · ${at} (${duration(took)})`
      : `↩️ ${who} ${info.name}ndan döndü · ${at} (${duration(took)})${over}`;
  }
  return `🔴 ${who} mesaiyi bitirdi · ${at}\n      ⏱ ${duration(move.netMs)} çalıştı${move.breakMs ? ` · mola ${duration(move.breakMs)}` : ""}`;
}

const longDate = (day: string) =>
  new Date(`${day}T12:00:00+03:00`).toLocaleDateString("tr-TR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric", weekday: "long" });

/** Günlük toplu rapor: kim ne kadar çalıştı, hangi molaları verdi, kim kapatmadı, kimin kaydı yok. */
export function dailyReportMessages(day: string, rows: WorktimeDayRow[], absent: string[], isToday: boolean): string[] {
  const worked = rows.filter((r) => r.netMs + r.breakMs > 0).sort((a, b) => b.netMs - a.netMs);
  if (!worked.length) return [];
  const parts = [`📊 <b>GÜNLÜK MESAİ RAPORU</b>\n🗓 ${escapeHtml(longDate(day))}`];
  let total = 0;
  const open: string[] = [];
  worked.forEach((row, i) => {
    total += row.netMs;
    const rank = i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`;
    const breaks = (["need", "meal", "appointment"] as const)
      .filter((t) => row.byType[t] > 0)
      .map((t) => `${BREAK[t].emoji} ${BREAK[t].name} ${duration(row.byType[t])}${row.count[t] > 1 ? ` (${row.count[t]}×)` : ""}`);
    let block = `${rank} <b>${escapeHtml(row.name)}</b> — ${duration(row.netMs)} çalıştı`;
    block += `\n      ${breaks.length ? breaks.join(" · ") : "Mola yok"}`;
    block += `\n      🕘 ${clock(row.firstStartAt)} – ${row.open ? (isToday ? "şu an" : clock(row.lastSeenAt)) : clock(row.lastEndAt)}${row.open ? (isToday ? " 🟢 hâlâ mesaide" : " ⚠️ mesai kapatılmadı") : ""}`;
    if (row.open) open.push(escapeHtml(row.name.split(" ")[0]));
    parts.push(block);
  });
  let footer = `━━━━━━━━━━━━\n👥 ${worked.length} kişi · ⏱ toplam ${duration(total)} · ort. ${duration(Math.round(total / worked.length))}/kişi`;
  if (open.length) footer += isToday ? `\n🟢 <b>Hâlâ mesaide:</b> ${open.join(", ")}` : `\n⚠️ <b>Mesaiyi kapatmayan:</b> ${open.join(", ")}`;
  if (absent.length) footer += `\n🚫 <b>Kayıt yok:</b> ${absent.map(escapeHtml).join(", ")}`;
  parts.push(footer);
  // Telegram'ın mesaj sınırına göre böl.
  const messages: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && (current + "\n\n" + part).length > 3500) {
      messages.push(current);
      current = part;
    } else current = current ? `${current}\n\n${part}` : part;
  }
  if (current) messages.push(current);
  return messages;
}

// ---- Görüşme analizi --------------------------------------------------------------------

interface AnalysisPost {
  kind?: string;
  sourceKind?: string;
  sourceId?: string;
  createdAt?: string;
  analysis?: { summary?: string; callFeedback?: string; callScore?: number; nextSteps?: string };
}
/** Dahili numarasını çalışan adına çevirir (dahilisini kaydetmiş çalışanlar için). */
async function agentNames(store: Store, owner: string): Promise<Map<string, string>> {
  const [exts, employees] = await Promise.all([store.list<{ ext?: string }>("pbx-extension", owner), store.list<{ openId?: string; name?: string }>("employee", owner)]);
  const byOpenId = new Map(employees.map((row) => [String(row.payload.openId || ""), String(row.payload.name || "")]));
  const map = new Map<string, string>();
  for (const row of exts) if (row.payload.ext && byOpenId.get(row.id)) map.set(String(row.payload.ext), byOpenId.get(row.id)!);
  return map;
}
const agentLabel = (agent: unknown, names: Map<string, string>) => {
  const value = String(agent || "").trim();
  return names.get(value) || (/^\d{2,6}$/.test(value) ? `Dahili ${value}` : value || "Bilinmeyen temsilci");
};
const scoreIcon = (score: number) => (score >= 75 ? "🟢" : score >= 50 ? "🟡" : "🔴");

/** Tek görüşmenin analiz mesajı. */
export function callAnalysisMessage(input: { lead: string; agent: string; durationSeconds: number; score?: number; summary: string; feedback?: string; nextSteps?: string }): string {
  const lines = [
    `📞 <b>Görüşme analizi</b> · ${escapeHtml(input.agent)}`,
    `👤 ${escapeHtml(input.lead)}${input.durationSeconds ? ` · ${input.durationSeconds < 60 ? `${Math.round(input.durationSeconds)} sn` : duration(input.durationSeconds * 1000)}` : ""}`,
  ];
  if (input.score !== undefined) lines.push(`${scoreIcon(input.score)} <b>Puan: ${input.score}/100</b>`);
  lines.push(`📝 ${escapeHtml(input.summary.slice(0, 600))}`);
  if (input.feedback) lines.push(`💬 ${escapeHtml(input.feedback.slice(0, 700))}`);
  if (input.nextSteps) lines.push(`➡️ ${escapeHtml(input.nextSteps.slice(0, 300))}`);
  return lines.join("\n");
}

/** Haftalık temsilci raporu: son 7 günün analiz edilen görüşmeleri, temsilci bazında. */
export async function weeklyCallReport(store: Store, owner: string, now = new Date()): Promise<string> {
  const since = now.getTime() - 7 * 86_400_000;
  const [posts, calls, names] = await Promise.all([store.list<AnalysisPost>("feed", owner), store.list<{ agent?: string; durationSeconds?: number }>("call", owner), agentNames(store, owner)]);
  const callById = new Map(calls.map((row) => [row.id, row.payload]));
  const stats = new Map<string, { count: number; scored: number; total: number; seconds: number }>();
  for (const row of posts) {
    const post = row.payload;
    if (post.kind !== "ai-analysis" || post.sourceKind !== "call" || Date.parse(post.createdAt || "") < since) continue;
    const call = callById.get(String(post.sourceId || ""));
    const key = agentLabel(call?.agent, names);
    const item = stats.get(key) || { count: 0, scored: 0, total: 0, seconds: 0 };
    item.count += 1;
    item.seconds += Math.max(0, Number(call?.durationSeconds) || 0);
    if (typeof post.analysis?.callScore === "number") (item.scored += 1), (item.total += post.analysis.callScore);
    stats.set(key, item);
  }
  if (!stats.size) return "";
  const rows = [...stats.entries()]
    .map(([name, s]) => ({ name, ...s, avg: s.scored ? Math.round(s.total / s.scored) : null }))
    .sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.count - a.count);
  const lines = ["📈 <b>HAFTALIK GÖRÜŞME RAPORU</b>", "Son 7 günde analiz edilen görüşmeler"];
  rows.forEach((r, i) => {
    const rank = i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`;
    lines.push(`${rank} <b>${escapeHtml(r.name)}</b> — ${r.avg === null ? "puan yok" : `${scoreIcon(r.avg)} ort. ${r.avg}/100`} · ${r.count} görüşme · ${duration(r.seconds * 1000)}`);
  });
  const scored = rows.filter((r) => r.avg !== null);
  const all = rows.reduce((n, r) => n + r.count, 0);
  lines.push(`━━━━━━━━━━━━\n📞 ${all} görüşme${scored.length ? ` · ekip ortalaması ${Math.round(scored.reduce((n, r) => n + r.total, 0) / scored.reduce((n, r) => n + r.scored, 0))}/100` : ""}`);
  return lines.join("\n");
}

// ---- Zamanlanmış işler ------------------------------------------------------------------

const istanbul = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
};
const minutesOf = (value: string, fallback: number) => {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(value);
  return m ? Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2] || 0)) : fallback;
};
const SENT_KIND = "telegram-sent";

/** Dakikada bir çağrılır: günlük rapor, "mesaiyi kapatmayı unutma" ve süresi aşan mola uyarısı. Her biri bir kez gider. */
export async function runTelegramSchedule(store: Store, now = new Date()): Promise<string[]> {
  if (!notificationsConfigured() && !override) return [];
  const raw = rawStoreOf(store);
  const owner = await raw.resolveOwner().catch(() => undefined);
  if (!owner) return [];
  const { day, minutes } = istanbul(now);
  const once = async (key: string) => (await raw.insertIfAbsent(SENT_KIND, key, { at: now.toISOString() }, owner)).inserted;
  const done: string[] = [];
  const snapshot = await worktimeDaySnapshot(store, owner, day, now.getTime());

  // Süresi aşan mola
  for (const row of snapshot.rows) {
    const limit = row.open && row.activeType ? BREAK_LIMIT_MIN[row.activeType] : 0;
    if (!limit || !row.activeSince) continue;
    const took = now.getTime() - Date.parse(row.activeSince);
    if (took <= limit * 60_000) continue;
    if (!(await once(`mola:${row.userOpenId}:${row.activeSince}`))) continue;
    await sendTelegram(`⏰ <b>${escapeHtml(row.name)}</b> ${BREAK[row.activeType!].name}nda ${duration(took)} oldu (hak ${limit} dk).`);
    done.push("break");
  }
  // Mesaiyi kapatmayı unutma
  const remindAt = env("TELEGRAM_WORKTIME_REMINDER").toLowerCase() === "kapali" ? -1 : minutesOf(env("TELEGRAM_WORKTIME_REMINDER"), 18 * 60 + 5);
  if (remindAt >= 0 && minutes >= remindAt && minutes < remindAt + 90) {
    const open = snapshot.rows.filter((r) => r.open);
    if (open.length && (await once(`hatirlatma:${day}`))) {
      await sendTelegram(`🔔 <b>Mesaisi hâlâ açık:</b> ${open.map((r) => escapeHtml(r.name)).join(", ")}\nÇıkarken mesaiyi bitirmeyi unutmayın.`);
      done.push("reminder");
    }
  }
  // Haftalık görüşme raporu: pazartesi 09:00'dan sonra bir kez.
  if (new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now) === "Mon" && minutes >= 9 * 60 && minutes < 14 * 60 && env("TELEGRAM_CALL_ANALYSIS").toLowerCase() !== "kapali") {
    const report = await weeklyCallReport(raw, owner, now);
    if (report && (await once(`haftalik-gorusme:${day}`))) {
      await sendTelegram(report);
      done.push("weekly-calls");
    }
  }
  // Günlük toplu rapor
  const reportAt = env("TELEGRAM_DAILY_REPORT").toLowerCase() === "kapali" ? -1 : minutesOf(env("TELEGRAM_DAILY_REPORT"), 20 * 60);
  if (reportAt >= 0 && minutes >= reportAt && minutes < reportAt + 180) {
    const messages = dailyReportMessages(day, snapshot.rows, snapshot.absent, true);
    if (messages.length && (await once(`rapor:${day}`))) {
      for (const message of messages) await sendTelegram(message);
      done.push("report");
    }
  }
  return done;
}

let timer: NodeJS.Timeout | null = null;
export function startTelegramScheduler(store: Store): void {
  if (timer) return;
  timer = setInterval(() => void runTelegramSchedule(store).catch((error) => console.warn("Telegram zamanlayıcı:", error instanceof Error ? error.message : error)), 60_000);
  timer.unref?.();
}

/** Mesai hareketlerini gruba yazan dinleyiciyi bağlar ve test ucunu kaydeder. */
export function registerTelegram(app: Express, store: Store): void {
  waStore = rawStoreOf(store);
  setWorktimeListener(async (owner, move) => {
    if (!notificationsConfigured() && !override) return;
    // Bot kurulumun sahibine aittir; aynı sunucudaki başka firmaların hareketleri gruba yazılmaz.
    if (owner !== (await rawStoreOf(store).resolveOwner().catch(() => undefined))) return;
    if (env("TELEGRAM_WORKTIME_MOVES").toLowerCase() === "kapali") return;
    await sendTelegram(worktimeMessage(move));
  });
  setCallAnalysisListener(async (owner, info) => {
    if (!notificationsConfigured() && !override) return;
    const raw = rawStoreOf(store);
    if (owner !== (await raw.resolveOwner().catch(() => undefined))) return;
    if (env("TELEGRAM_CALL_ANALYSIS").toLowerCase() === "kapali") return;
    const [call, lead, names] = await Promise.all([
      raw.get<{ agent?: string; durationSeconds?: number; phone?: string }>("call", info.callId, owner),
      info.leadId ? raw.get<{ name?: string }>("lead", info.leadId, owner) : null,
      agentNames(raw, owner),
    ]);
    await sendTelegram(
      callAnalysisMessage({
        lead: lead?.payload?.name || "Kayıtsız numara",
        agent: agentLabel(call?.payload?.agent, names),
        durationSeconds: Number(call?.payload?.durationSeconds) || 0,
        score: info.analysis.callScore,
        summary: info.analysis.summary,
        feedback: info.analysis.callFeedback,
        nextSteps: info.analysis.nextSteps,
      }),
    );
  });
  app.post("/api/integrations/telegram/test", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner) return void res.status(403).json({ error: "FORBIDDEN", message: "Bağlantıyı yalnız çalışma alanı sahibi test edebilir." });
    if (!notificationsConfigured()) return void res.status(503).json({ error: "NOT_CONFIGURED", message: "Telegram için bot anahtarı ve grup kimliği, ya da WhatsApp için bildirim numarası girilmeli." });
    const html = `✅ <b>${escapeHtml(env("XRE_BRAND_NAME") || "CRM")}</b> bildirim bağlantısı çalışıyor.\nMesai hareketleri, raporlar ve görüşme analizleri buraya gelecek.`;
    const done: string[] = [];
    const failed: string[] = [];
    if (telegramConfigured())
      await sendTelegramOnly(html, env("TELEGRAM_CHAT_ID")).then(() => done.push("Telegram grubu"), (error) => failed.push(`${(error as Error).message} (bot gruba ekli mi, grup kimliği doğru mu?)`));
    if (whatsappNotifyNumbers().length)
      await sendWhatsappNotice(html).then((n) => done.push(`WhatsApp (${n} numara)`), (error) => failed.push(`WhatsApp: ${(error as Error).message}`));
    if (failed.length) return void res.status(502).json({ error: "NOTIFY_FAILED", message: `${done.length ? `Gönderildi: ${done.join(", ")}. ` : ""}Gönderilemedi: ${failed.join("; ")}`.slice(0, 400) });
    res.json({ provider: "telegram", configured: true, connected: true, message: `Deneme mesajı gönderildi: ${done.join(", ")}.` });
  });
}
