// Telegram bildirimleri: mesai hareketleri, günlük mesai raporu, hatırlatmalar ve otomasyon mesajları
// tek bir bot üzerinden firmanın Telegram grubuna gider. Ayarlar Entegrasyonlar ekranından girilir.
import type { Express, Request } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { setWorktimeListener, worktimeDaySnapshot, type WorktimeDayRow } from "./worktime.js";

const env = (key: string) => (process.env[key] || "").trim();
export const telegramConfigured = () => Boolean(env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID"));

type Sender = (chatId: string, html: string) => Promise<void>;
let override: Sender | null = null;
/** Testler için: gerçek Telegram çağrısı yerine verilen işlev kullanılır. */
export const setTelegramSender = (fn: Sender | null) => void (override = fn);

export const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Gruba (ya da verilen sohbete) HTML biçimli mesaj gönderir. Ayar yoksa sessizce atlar. */
export async function sendTelegram(html: string, chatId = env("TELEGRAM_CHAT_ID")): Promise<boolean> {
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
  if (!telegramConfigured() && !override) return [];
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
  setWorktimeListener(async (owner, move) => {
    if (!telegramConfigured() && !override) return;
    // Bot kurulumun sahibine aittir; aynı sunucudaki başka firmaların hareketleri gruba yazılmaz.
    if (owner !== (await rawStoreOf(store).resolveOwner().catch(() => undefined))) return;
    if (env("TELEGRAM_WORKTIME_MOVES").toLowerCase() === "kapali") return;
    await sendTelegram(worktimeMessage(move));
  });
  app.post("/api/integrations/telegram/test", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner) return void res.status(403).json({ error: "FORBIDDEN", message: "Bağlantıyı yalnız çalışma alanı sahibi test edebilir." });
    if (!telegramConfigured()) return void res.status(503).json({ error: "NOT_CONFIGURED", message: "Bot anahtarı ve grup kimliği girilmeli." });
    try {
      await sendTelegram(`✅ <b>${escapeHtml(env("XRE_BRAND_NAME") || "CRM")}</b> Telegram bağlantısı çalışıyor.\nMesai hareketleri ve günlük rapor bu gruba gelecek.`);
      res.json({ provider: "telegram", configured: true, connected: true, message: "Deneme mesajı gruba gönderildi." });
    } catch (error) {
      res.status(502).json({ error: "TELEGRAM_FAILED", message: `${(error as Error).message}. Botun gruba eklendiğinden ve grup kimliğinin doğru olduğundan emin olun.`.slice(0, 300) });
    }
  });
}
