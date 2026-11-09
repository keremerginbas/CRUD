// Bekleyen sohbet alarmı (Pro): müşteri yazdı, belirli süre cevap verilmedi.
// 1. kademe: o numaranın sohbetlerini alan personel (rolüne göre) Bitrix bildirimi alır.
// 2. kademe: portal yöneticileri Bitrix bildirimi, istenirse Telegram mesajı alır.
// Her bekleme için her kademe bir kez gönderilir; cevap verilince sıfırlanır.
import type { Store } from "./db.js";
import { DEFAULT_AGENT, inWorkingHours } from "./b24-agent.js";
import { planAllows } from "./b24-billing.js";
import {
  CHAT_KIND,
  PORTAL_KIND,
  SYSTEM_OWNER,
  b24Call,
  loadChat,
  portalById,
  portalSettings,
  portalUsers,
  roleAllows,
  roleOf,
  saveChat,
  type B24Chat,
  type B24Portal,
} from "./b24-connector.js";
import { pick, type Lang } from "./b24-i18n.js";
import { sendTelegramText } from "./b24-live.js";

type Waiting = { chat: B24Chat; minutes: number; level: 1 | 2 };

const lineLabel = (portal: B24Portal, line: string) => portal.lines[line]?.name || (portal.lines[line]?.phone ? `+${portal.lines[line].phone}` : `#${line}`);
const who = (chat: B24Chat, lang: Lang) => chat.name || (chat.phone.endsWith("@lid") ? pick(lang, "Gizli numara", "Hidden number") : `+${chat.phone}`);
const lastText = (chat: B24Chat) => {
  const last = [...chat.history].reverse().find((h) => h.from === "müşteri");
  const t = (last?.text || "").replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
};
const lineOf = (w: Waiting, portal: B24Portal, lang: Lang) =>
  `• ${who(w.chat, lang)} (${lineLabel(portal, w.chat.line)}) — ${pick(lang, `${w.minutes} dk`, `${w.minutes} min`)}${lastText(w.chat) ? `: “${lastText(w.chat)}”` : ""}`;

/** Bu portalda şimdi hangi sohbetler için hangi kademe uyarısı gitmeli? */
export function dueAlerts(portal: B24Portal, chats: B24Chat[], now = Date.now()): Waiting[] {
  const s = portalSettings(portal);
  if (!s.alerts) return [];
  if (s.alertWorkHours && !inWorkingHours({ ...DEFAULT_AGENT, ...(portal.agent || {}) }, new Date(now))) return [];
  const agentMs = s.alertAgentMin * 60_000;
  const managerMs = Math.max(s.alertManagerMin, s.alertAgentMin) * 60_000;
  const out: Waiting[] = [];
  for (const chat of chats) {
    if (chat.memberId !== portal.id || !chat.waitingSince || chat.phone.endsWith("@g.us") || !portal.lines[chat.line]) continue;
    const waited = now - chat.waitingSince;
    const sent = chat.alert?.since === chat.waitingSince ? chat.alert.level : 0;
    const level = waited >= managerMs ? 2 : waited >= agentMs ? 1 : 0;
    if (level > sent) out.push({ chat, minutes: Math.round(waited / 60_000), level: level as 1 | 2 });
  }
  return out;
}

async function notify(store: Store, portal: B24Portal, userIds: string[], message: string) {
  for (const id of [...new Set(userIds)].slice(0, 25))
    await b24Call(store, portal, "im.notify.system.add", { USER_ID: Number(id), MESSAGE: message }).catch((e) =>
      console.warn(`Bekleyen sohbet uyarısı gönderilemedi (${portal.domain}):`, (e as Error).message),
    );
}

/** Dakikalık: tüm portallarda bekleyen sohbetleri kontrol eder ve uyarıları gönderir. */
export async function runWaitAlerts(store: Store, now = Date.now()) {
  const portals = (await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((p) => p.active && portalSettings(p).alerts);
  if (!portals.length) return;
  const chats = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER)).map((r) => r.payload);
  for (const portal of portals) {
    const due = dueAlerts(portal, chats, now);
    if (!due.length || !(await planAllows(store, portal, "alerts"))) continue;
    const lang: Lang = portal.lang === "en" ? "en" : "tr";
    // Önce işaretle: gönderim yarıda kalsa da aynı uyarı tekrar tekrar gitmesin.
    for (const w of due) {
      const current = await loadChat(store, w.chat.memberId, w.chat.line, w.chat.phone);
      if (current.waitingSince === w.chat.waitingSince) await saveChat(store, { ...current, alert: { since: w.chat.waitingSince as number, level: w.level } });
    }
    const fresh = (await portalById(store, portal.id)) || portal;

    // 1. kademe: numaranın personeli (rol tanımlı değilse yöneticilere 2. kademede gider)
    const agentLevel = due.filter((w) => w.level === 1);
    if (agentLevel.length && (fresh.roles || []).length) {
      const users = await portalUsers(store, fresh).catch(() => []);
      const byUser = new Map<string, Waiting[]>();
      for (const w of agentLevel)
        for (const u of users) if (roleAllows(roleOf(fresh, u.id), w.chat.line)) byUser.set(u.id, [...(byUser.get(u.id) || []), w]);
      for (const [userId, list] of byUser) {
        const head = pick(lang, `⏰ WhatsApp by XRE: ${list.length} sohbet cevap bekliyor.`, `⏰ WhatsApp by XRE: ${list.length} chat(s) are waiting for a reply.`);
        await notify(store, fresh, [userId], [head, ...list.slice(0, 10).map((w) => lineOf(w, fresh, lang))].join("\n"));
      }
    }

    // 2. kademe: yöneticiler (Bitrix) ve Telegram
    const managerLevel = due.filter((w) => w.level === 2);
    if (managerLevel.length) {
      const head = pick(
        lang,
        `🚨 WhatsApp by XRE: ${managerLevel.length} sohbet ${portalSettings(fresh).alertManagerMin} dakikadan uzun süredir cevapsız.`,
        `🚨 WhatsApp by XRE: ${managerLevel.length} chat(s) have had no reply for more than ${portalSettings(fresh).alertManagerMin} minutes.`,
      );
      const text = [head, ...managerLevel.slice(0, 15).map((w) => lineOf(w, fresh, lang))].join("\n");
      await notify(store, fresh, fresh.adminIds || [], text);
      if (portalSettings(fresh).alertTelegram) await sendTelegramText(fresh.reports?.telegram, text);
    }
  }
}

let alertTimer: NodeJS.Timeout | null = null;
export function startWaitAlerts(store: Store) {
  if (alertTimer) return;
  alertTimer = setInterval(() => void runWaitAlerts(store).catch((e) => console.warn("Bekleyen sohbet uyarıları:", (e as Error).message)), 60_000);
  alertTimer.unref?.();
}
