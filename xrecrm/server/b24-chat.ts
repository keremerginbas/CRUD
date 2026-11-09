// XRE WhatsApp sohbet ekranı: WhatCRM benzeri gelen kutusu (sol listede
// sohbetler, sağda yazışma) ve Bitrix CRM kartlarındaki "XRE WhatsApp" sekmesi.
//
// - Herkes yalnız rolündeki numaraları görür (yönetici hepsini).
// - Açık Kanallar çalışmaya devam eder; burada yazılan cevap doğrudan WhatsApp'a
//   gider, sohbet durumu ve istatistikler ortak tutulur.
// - Erişim, Bitrix kullanıcısının doğrulanmış oturumundan üretilen imzalı biletle.
import express, { type Express, type Request, type Response } from "express";
import type { Store } from "./db.js";
import { lineUsable } from "./b24-billing.js";
import { translateTo } from "./b24-ai.js";
import { langOf, normLang, pick, type Lang } from "./b24-i18n.js";
import { PANEL_STYLE } from "./b24-panel-html.js";
import { MAX_MEDIA_BYTES, deleteMedia, readMedia, saveMedia, sendEvolutionMedia } from "./whatsapp-media.js";
import { normalizePhone } from "./security.js";
import {
  CHAT_KIND,
  SYSTEM_OWNER,
  b24Call,
  evolution,
  loadChat,
  saveChat,
  saveLidPhone,
  page,
  portalById,
  activeSettings,
  portalUsers,
  readBitrixParams,
  readTicket,
  recordOutbound,
  refreshLines,
  roleAllows,
  roleOf,
  savePortal,
  settingsTicket,
  quickOwner,
  quickUserKey,
  quickUserOwner,
  QUICK_USER_KIND,
  cleanQuickReplies,
  userQuickReplies,
  sendQuickMedia,
  type QuickReply,
  type UserQuickReplies,
  type B24Chat,
  type B24Portal,
} from "./b24-connector.js";

// ---------- Yazışma geçmişi ----------

export const THREAD_KIND = "b24-thread";
const THREAD_MAX = 400;

export interface ThreadMessage {
  dir: "in" | "out";
  text: string;
  /** Gelen mesajın temsilci diline çevirisi */
  translation?: string;
  /** Giden mesajın çevrilmeden önceki hali (temsilcinin yazdığı) */
  original?: string;
  /** Giden: Bitrix kullanıcı kimliği ya da "ai" */
  by?: string;
  /** phone: işletmenin kendi telefonundan (WhatsApp uygulaması) yazdığı mesaj */
  via?: "bitrix" | "xre" | "ai" | "phone";
  at: number;
  waId?: string;
  sender?: string;
  senderName?: string;
  media?: { id?: string; name?: string; type?: string; mime?: string };
}
interface Thread {
  id: string;
  memberId: string;
  line: string;
  phone: string;
  messages: ThreadMessage[];
}

export async function appendThread(store: Store, chat: Pick<B24Chat, "id" | "memberId" | "line" | "phone">, msg: ThreadMessage) {
  const found = (await store.get<Thread>(THREAD_KIND, chat.id, SYSTEM_OWNER))?.payload;
  const thread: Thread = found || { id: chat.id, memberId: chat.memberId, line: chat.line, phone: chat.phone, messages: [] };
  thread.messages = [...thread.messages, msg].slice(-THREAD_MAX);
  await store.put(THREAD_KIND, chat.id, thread, SYSTEM_OWNER);
}

/**
 * Toplu mesaj ekler (ör. bağlantı anındaki WhatsApp geçmişi): aynı WhatsApp kimliğine
 * sahip mesajlar bir kez yazılır, sıra zamana göre korunur. Eklenen mesajları döndürür.
 */
export async function mergeThread(store: Store, chat: Pick<B24Chat, "id" | "memberId" | "line" | "phone">, msgs: ThreadMessage[]): Promise<ThreadMessage[]> {
  const found = (await store.get<Thread>(THREAD_KIND, chat.id, SYSTEM_OWNER))?.payload;
  const thread: Thread = found || { id: chat.id, memberId: chat.memberId, line: chat.line, phone: chat.phone, messages: [] };
  const seen = new Set(thread.messages.map((m) => m.waId).filter(Boolean));
  const fresh = msgs.filter((m) => !m.waId || !seen.has(m.waId));
  if (!fresh.length) return [];
  thread.messages = [...thread.messages, ...fresh].sort((a, b) => a.at - b.at).slice(-THREAD_MAX);
  await store.put(THREAD_KIND, chat.id, thread, SYSTEM_OWNER);
  return fresh;
}

/** Gizli kimlikli (…@lid) sohbeti gerçek numaralı sohbetle birleştirir ve gizli kaydı siler. */
export async function mergeLidChat(store: Store, lidChat: B24Chat, target: string): Promise<B24Chat> {
  await saveLidPhone(store, lidChat.memberId, lidChat.line, lidChat.phone, target);
  const main = await loadChat(store, lidChat.memberId, lidChat.line, target, lidChat.name);
  main.name = main.name || lidChat.name;
  main.history = [...main.history, ...lidChat.history].sort((a, b) => a.at - b.at);
  main.inbound += lidChat.inbound;
  main.outbound += lidChat.outbound;
  main.lang = main.lang || lidChat.lang;
  main.lastInboundAt = Math.max(main.lastInboundAt || 0, lidChat.lastInboundAt || 0) || undefined;
  main.lastOutboundAt = Math.max(main.lastOutboundAt || 0, lidChat.lastOutboundAt || 0) || undefined;
  main.waitingSince = lidChat.waitingSince ?? main.waitingSince;
  main.createdAt = Math.min(main.createdAt || Date.now(), lidChat.createdAt || Date.now());
  await saveChat(store, main);
  const lidThread = (await store.get<Thread>(THREAD_KIND, lidChat.id, SYSTEM_OWNER))?.payload;
  if (lidThread?.messages.length) await mergeThread(store, main, lidThread.messages);
  await store.delete(THREAD_KIND, lidChat.id, SYSTEM_OWNER).catch(() => undefined);
  await store.delete(CHAT_KIND, lidChat.id, SYSTEM_OWNER).catch(() => undefined);
  return main;
}

/** Son 2 dakikada bu mesaj zaten sistemden (Bitrix, sohbet ekranı, AI) gönderildi mi? */
export async function alreadySent(store: Store, chatKey: string, waId: string, text: string, now = Date.now()) {
  const thread = (await store.get<Thread>(THREAD_KIND, chatKey, SYSTEM_OWNER))?.payload;
  const t = text.trim();
  return Boolean(
    thread?.messages.some(
      (m) => m.dir === "out" && ((waId && m.waId === waId) || (t && Math.abs(now - m.at) < 120_000 && (m.text.trim() === t || (m.original || "").trim() === t))),
    ),
  );
}

async function threadMessages(store: Store, chat: B24Chat): Promise<ThreadMessage[]> {
  const found = (await store.get<Thread>(THREAD_KIND, chat.id, SYSTEM_OWNER))?.payload;
  if (found?.messages.length) return found.messages;
  // Bu özellikten önceki sohbetler: kısa geçmişten göster.
  return chat.history.map((h) => ({ dir: h.from === "müşteri" ? "in" : "out", text: h.text, at: h.at, by: h.from === "asistan" ? "ai" : undefined }));
}

// ---------- Erişim ----------

export interface Viewer {
  memberId: string;
  userId: string;
  admin: boolean;
}
/** Sohbet ekranı bileti: kullanıcıya bağlı, 12 saat geçerli. */
export const chatTicket = (memberId: string, userId: string, admin: boolean) => settingsTicket(memberId, `${admin ? "a" : "u"}${userId}`, 12 * 60 * 60);
function viewerOf(ticket: unknown): Viewer | null {
  const t = readTicket(ticket);
  const m = t && /^([au])(\d{1,12})$/.exec(t.line);
  return m ? { memberId: t!.memberId, userId: m[2], admin: m[1] === "a" } : null;
}
/** Kullanıcının görebileceği bağlantılar. Hiç rol tanımlanmamışsa kısıt yok. */
export function visibleLines(portal: B24Portal, viewer: Viewer): string[] {
  const all = Object.keys(portal.lines);
  if (viewer.admin || !(portal.roles || []).length) return all;
  return all.filter((line) => roleAllows(roleOf(portal, viewer.userId), line));
}

const usersCache = new Map<string, { at: number; names: Record<string, string> }>();
async function userNames(store: Store, portal: B24Portal): Promise<Record<string, string>> {
  const hit = usersCache.get(portal.id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.names;
  const names = Object.fromEntries((await portalUsers(store, portal).catch(() => [])).map((u) => [u.id, u.name]));
  usersCache.set(portal.id, { at: Date.now(), names });
  return names;
}

const lineName = (portal: B24Portal, line: string) => portal.lines[line]?.name || portal.lines[line]?.phone || `#${line}`;

// ---------- CRM kart sekmesi ----------

export const CARD_PLACEMENTS = ["CRM_LEAD_DETAIL_TAB", "CRM_CONTACT_DETAIL_TAB", "CRM_DEAL_DETAIL_TAB", "CRM_COMPANY_DETAIL_TAB"];
export const CARD_TABS_VERSION = 2;

/** Kart sekmelerini Bitrix'e kaydeder; kaydedilemeyenler için uyarı döndürür. */
export async function bindCardTabs(store: Store, portal: B24Portal, base: string): Promise<string[]> {
  const warnings: string[] = [];
  let ok = 0;
  for (const placement of CARD_PLACEMENTS) {
    // Başlık değişince eski sekme kalmasın: aynı adrese yeniden bağlanmak başlığı güncellemez.
    await b24Call(store, portal, "placement.unbind", { PLACEMENT: placement, HANDLER: `${base}/b24/card` }).catch(() => null);
    try {
      await b24Call(store, portal, "placement.bind", {
        PLACEMENT: placement,
        HANDLER: `${base}/b24/card`,
        TITLE: "WhatsApp by XRE",
        LANG_ALL: { tr: { TITLE: "WhatsApp by XRE" }, en: { TITLE: "WhatsApp by XRE" } },
      });
      ok++;
    } catch (error) {
      const msg = (error as Error).message;
      if (/already|ALREADY|binded|bound/i.test(msg)) ok++;
      else warnings.push(`${placement}: ${msg}`);
    }
  }
  if (!ok) warnings.unshift("Kart sekmesi eklenemedi (uygulamaya 'placement' izni verilmiş olmalı).");
  return warnings;
}

const toWa = (v: unknown) => {
  // WhatsApp gizli kimliği (…@lid) numara gibi temizlenmez; sohbet anahtarı olarak korunur.
  const raw = String(v ?? "").trim();
  if (/^\d{6,20}@lid$/.test(raw)) return raw;
  const d = normalizePhone(v);
  return d.length >= 10 && d.length <= 15 ? d : "";
};
const phonesOf = (entity: any): string[] => (Array.isArray(entity?.PHONE) ? entity.PHONE : []).map((p: any) => toWa(p?.VALUE)).filter(Boolean);

/** Kartın (lead/kişi/anlaşma/şirket) ve bağlı kişilerinin telefonları. */
export async function entityPhones(store: Store, portal: B24Portal, placement: string, id: string): Promise<{ phones: string[]; title: string }> {
  const call = (method: string, params: Record<string, unknown>) => b24Call(store, portal, method, params).catch(() => null);
  const phones = new Set<string>();
  let title = "";
  const addContact = async (contactId: unknown) => {
    if (!Number(contactId)) return;
    const c = await call("crm.contact.get", { id: Number(contactId) });
    phonesOf(c).forEach((p) => phones.add(p));
    if (!title) title = [c?.NAME, c?.LAST_NAME].filter(Boolean).join(" ");
  };
  if (placement === "CRM_LEAD_DETAIL_TAB") {
    const lead = await call("crm.lead.get", { id: Number(id) });
    phonesOf(lead).forEach((p) => phones.add(p));
    title = [lead?.NAME, lead?.LAST_NAME].filter(Boolean).join(" ") || String(lead?.TITLE || "");
    await addContact(lead?.CONTACT_ID);
  } else if (placement === "CRM_CONTACT_DETAIL_TAB") {
    await addContact(id);
  } else if (placement === "CRM_COMPANY_DETAIL_TAB") {
    const company = await call("crm.company.get", { id: Number(id) });
    phonesOf(company).forEach((p) => phones.add(p));
    title = String(company?.TITLE || "");
  } else if (placement === "CRM_DEAL_DETAIL_TAB") {
    const deal = await call("crm.deal.get", { id: Number(id) });
    title = String(deal?.TITLE || "");
    const items = await call("crm.deal.contact.items.get", { id: Number(id) });
    const ids = Array.isArray(items) ? items.map((i: any) => i.CONTACT_ID) : [deal?.CONTACT_ID];
    for (const cid of ids.slice(0, 5)) await addContact(cid);
    if (Number(deal?.COMPANY_ID)) phonesOf(await call("crm.company.get", { id: Number(deal.COMPANY_ID) })).forEach((p) => phones.add(p));
  }
  return { phones: [...phones].slice(0, 10), title };
}

// ---------- Uçlar ----------

export const MEET_URL = /^https:\/\/meet\.google\.com\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[A-Za-z0-9_-]{4,64})(?:\?[A-Za-z0-9=&._-]*)?$/;

type Ctx = { portal: B24Portal; viewer: Viewer; lines: string[] };
const fail = (status: number, message: string) => {
  throw Object.assign(new Error(message), { statusCode: status });
};

export function registerChatRoutes(app: Express, store: Store) {
  const json = express.json({ limit: "32kb" });

  const withViewer =
    (fn: (ctx: Ctx, body: any, req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const viewer = viewerOf(req.get("x-xre-ticket") || (req.body && !Buffer.isBuffer(req.body) ? req.body.t : undefined) || req.query.t);
      if (!viewer) return res.status(401).json({ error: "TICKET", message: "Oturum süresi doldu. Sayfayı yenileyin." });
      const portal = await portalById(store, viewer.memberId);
      if (!portal?.active) return res.status(404).json({ error: "NOT_INSTALLED" });
      try {
        const out = await fn({ portal, viewer, lines: visibleLines(portal, viewer) }, req.body || {}, req, res);
        if (out !== undefined && !res.headersSent) res.json(out);
      } catch (error) {
        const e = error as Error & { statusCode?: number };
        if (!res.headersSent) res.status(e.statusCode && e.statusCode < 600 ? e.statusCode : 502).json({ error: "FAILED", message: e.message });
      }
    };

  // Personelin gördüğü hazır cevaplar: kendi cevapları önce, aynı kısayollu ortak cevap gizlenir.
  const quickFor = async (ctx: Ctx) => {
    const mine = await userQuickReplies(store, ctx.portal.id, ctx.viewer.userId);
    const keys = new Set(mine.map((r) => r.key));
    const shared = (ctx.portal.quickReplies || []).filter((r) => !keys.has(r.key));
    return { quick: [...mine.map((r) => ({ ...r, mine: true })), ...shared], quickMine: mine, quickShared: ctx.portal.quickReplies || [] };
  };
  const findQuick = async (ctx: Ctx, key: string) => {
    const mine = (await userQuickReplies(store, ctx.portal.id, ctx.viewer.userId)).find((r) => r.key === key);
    if (mine) return { reply: mine, owner: quickUserOwner(ctx.portal.id, ctx.viewer.userId) };
    const shared = (ctx.portal.quickReplies || []).find((r) => r.key === key);
    return shared ? { reply: shared, owner: quickOwner(ctx.portal.id) } : null;
  };

  const chatFor = async (ctx: Ctx, body: any) => {
    const line = String(body.line || "").replace(/\D/g, "");
    const phone = toWa(body.phone);
    if (!line || !ctx.portal.lines[line] || !ctx.lines.includes(line)) fail(403, "Bu numaraya erişiminiz yok.");
    if (!phone) fail(400, "Geçerli bir telefon numarası girin.");
    return loadChat(store, ctx.portal.id, line, phone);
  };

  app.post(
    "/b24/chat/threads",
    json,
    withViewer(async (ctx, body) => {
      // Ekran açıkken bağlantı durumu en fazla 1 dakika eski olsun.
      ctx.portal = await refreshLines(store, ctx.portal, ctx.lines, 60_000);
      const only = Array.isArray(body.phones) ? new Set(body.phones.map(toWa).filter(Boolean)) : null;
      // Arama tüm sohbetlerde yapılır; liste en yeni sohbetten başlayarak sayfa sayfa gelir.
      const q = String(body.q || "").trim().toLocaleLowerCase("tr").slice(0, 80);
      const qDigits = q.replace(/\D/g, "");
      const limit = Math.min(5000, Math.max(50, Math.floor(Number(body.limit) || 500)));
      const all = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER))
        .map((r) => r.payload)
        .filter((c) => c.memberId === ctx.portal.id && ctx.lines.includes(c.line) && (!only || only.has(c.phone)))
        .map((c) => {
          const last = c.history.at(-1);
          return {
            line: c.line,
            lineName: lineName(ctx.portal, c.line),
            phone: c.phone,
            name: c.name || "",
            lastText: last?.text.slice(0, 120) || "",
            lastFrom: last?.from || "",
            lastAt: Math.max(c.lastInboundAt || 0, c.lastOutboundAt || 0, last?.at || 0),
            waiting: Boolean(c.waitingSince),
            lang: c.lang || "",
          };
        })
        .filter(
          (t) =>
            !q ||
            `${t.name} ${t.lastText}`.toLocaleLowerCase("tr").includes(q) ||
            (qDigits.length >= 3 && t.phone.includes(qDigits.replace(/^0/, ""))),
        )
        .sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name, "tr"));
      const chats = all.slice(0, limit);
      const lines = ctx.lines.map((line) => ({
        line,
        name: lineName(ctx.portal, line),
        phone: ctx.portal.lines[line].phone || "",
        connected: ctx.portal.lines[line].status === "connected",
        status: ctx.portal.lines[line].status,
      }));
      return { threads: chats, total: all.length, lines, admin: ctx.viewer.admin, ...(await quickFor(ctx)), portalLines: Object.keys(ctx.portal.lines).length };
    }),
  );

  // Gizli numaralı (…@lid) sohbeti gerçek numarayla eşleştirir ve iki sohbeti birleştirir.
  app.post(
    "/b24/chat/link",
    json,
    withViewer(async (ctx, body) => {
      const lidChat = await chatFor(ctx, body);
      if (!lidChat.phone.endsWith("@lid")) fail(400, "Bu sohbet zaten bir numaraya bağlı.");
      const target = toWa(body.target);
      if (!target || target.endsWith("@lid")) fail(400, "Geçerli bir telefon numarası girin.");
      const main = await mergeLidChat(store, lidChat, target);
      return { line: main.line, phone: main.phone, name: main.name };
    }),
  );

  app.post(
    "/b24/chat/messages",
    json,
    withViewer(async (ctx, body) => {
      const chat = await chatFor(ctx, body);
      const names = await userNames(store, ctx.portal);
      const messages = (await threadMessages(store, chat)).slice(-200).map((m) => ({
        ...m,
        byName: m.by === "ai" ? "AI" : m.by ? names[m.by] || "" : "",
      }));
      return { name: chat.name, phone: chat.phone, line: chat.line, lang: chat.lang || "", messages };
    }),
  );

  app.post(
    "/b24/chat/send",
    json,
    withViewer(async (ctx, body) => {
      const chat = await chatFor(ctx, body);
      ctx.portal = await refreshLines(store, ctx.portal, [chat.line], 30_000);
      const info = ctx.portal.lines[chat.line];
      const lang = langOf(ctx.portal);
      let text = String(body.text || "").replace(/\r/g, "").trim().slice(0, 4000);
      if (!text) fail(400, "Mesaj boş olamaz.");
      if (info.status !== "connected" || !info.instance)
        fail(409, ctx.viewer.admin ? "Bu numaranın WhatsApp bağlantısı kopmuş. Panel → Bağlantılar'dan QR okutun." : "Bu numaranın WhatsApp bağlantısı kopmuş. Yöneticinizden numarayı yeniden bağlamasını isteyin.");
      if (!(await lineUsable(store, ctx.portal, chat.line))) fail(402, "Bu numaranın lisans süresi doldu.");
      // "!" ile başlayan mesaj çevrilmez; aksi halde müşterinin diline çevrilir.
      const raw = text.startsWith("!");
      if (raw) text = text.slice(1).trim();
      const original = text;
      if (!raw && (await activeSettings(store, ctx.portal)).translate && chat.lang && chat.lang !== lang) {
        try {
          text = await translateTo(text, chat.lang, lang);
        } catch (error) {
          console.warn("Cevap çevrilemedi, olduğu gibi gönderiliyor:", (error as Error).message);
        }
      }
      let result: any;
      try {
        result = await evolution(`/message/sendText/${encodeURIComponent(info.instance)}`, {
          method: "POST",
          body: JSON.stringify({ number: chat.phone, text, linkPreview: true }),
        });
      } catch (error) {
        // Bağlantı gönderim sırasında kopmuş olabilir: durumu hemen yenile.
        await refreshLines(store, ctx.portal, [chat.line], 0).catch(() => undefined);
        fail(502, `Mesaj gönderilemedi: ${(error as Error).message}`);
      }
      await recordOutbound(store, ctx.portal, chat.line, chat, {
        agent: ctx.viewer.userId,
        text,
        original: text !== original ? original : undefined,
        local: original,
        via: "xre",
        waId: String(result?.key?.id || ""),
      });
      return { ok: true, text, original };
    }),
  );

  // Kişisel Google Meet odası: her temsilci kendi sabit bağlantısını bir kez kaydeder.
  // Görüşme kayıtları Google'ın kendi düzeniyle oda sahibinin Drive'ına düşer.
  app.post(
    "/b24/chat/meet",
    json,
    withViewer(async (ctx, body) => {
      const target = ctx.viewer.admin && body.userId ? String(body.userId).replace(/\D/g, "") : ctx.viewer.userId;
      if (body.url === undefined) return { url: ctx.portal.meetRooms?.[target] || "" };
      const url = String(body.url || "").trim();
      if (url && !MEET_URL.test(url)) fail(400, "Geçerli bir Google Meet bağlantısı girin (https://meet.google.com/...).");
      const fresh = (await portalById(store, ctx.portal.id)) || ctx.portal;
      const meetRooms = { ...(fresh.meetRooms || {}) };
      if (url) meetRooms[target] = url;
      else delete meetRooms[target];
      await savePortal(store, { ...fresh, meetRooms });
      return { url };
    }),
  );

  // Dosya, görsel, video ve ses kaydı gönderimi (ham gövde, en fazla 16 MB).
  app.post(
    "/b24/chat/upload",
    express.raw({ type: () => true, limit: MAX_MEDIA_BYTES + 1024 }),
    withViewer(async (ctx, _body, req) => {
      const header = (k: string) => {
        try {
          return decodeURIComponent(String(req.get(k) || ""));
        } catch {
          return "";
        }
      };
      const chat = await chatFor(ctx, { line: header("x-line"), phone: header("x-phone") });
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) fail(400, "Dosya boş.");
      if (buffer.length > MAX_MEDIA_BYTES) fail(413, "Dosya 16 MB sınırını aşıyor.");
      ctx.portal = await refreshLines(store, ctx.portal, [chat.line], 30_000);
      const info = ctx.portal.lines[chat.line];
      if (info.status !== "connected" || !info.instance) fail(409, "Bu numaranın WhatsApp bağlantısı kopmuş.");
      if (!(await lineUsable(store, ctx.portal, chat.line))) fail(402, "Bu numaranın lisans süresi doldu.");
      const voice = req.get("x-voice") === "1";
      const mime = String(req.get("content-type") || "application/octet-stream");
      const name = header("x-file-name").slice(0, 120) || (voice ? "ses-kaydi.ogg" : "dosya");
      const caption = header("x-caption").slice(0, 1000);
      const record = await saveMedia(store, `b24:${ctx.portal.id}`, buffer, voice && !/^audio\//.test(mime) ? "audio/ogg" : mime, name);
      let result: any;
      try {
        result = await sendEvolutionMedia(info.instance, chat.phone, record, buffer, caption);
      } catch (error) {
        await refreshLines(store, ctx.portal, [chat.line], 0).catch(() => undefined);
        fail(502, `Dosya gönderilemedi: ${(error as Error).message}`);
      }
      await recordOutbound(store, ctx.portal, chat.line, chat, {
        agent: ctx.viewer.userId,
        text: caption,
        local: caption || `[${record.mediaType === "audio" ? (voice ? "Sesli mesaj" : "Ses") : record.mediaType === "image" ? "Görsel" : record.mediaType === "video" ? "Video" : "Dosya"}]`,
        via: "xre",
        waId: String(result?.key?.id || ""),
        media: { id: record.id, name: record.fileName, type: record.mediaType, mime: record.mime },
      });
      return { ok: true, id: record.id, type: record.mediaType };
    }),
  );

  // Kişisel hazır cevaplar: personel kendi listesini sohbet ekranından yönetir.
  app.post(
    "/b24/chat/quick/save",
    express.json({ limit: "256kb" }),
    withViewer(async (ctx, body) => {
      const owner = quickUserOwner(ctx.portal.id, ctx.viewer.userId);
      const items: QuickReply[] = [];
      for (const r of cleanQuickReplies(body.items)) {
        if (r.media && !(await readMedia(store, owner, r.media.id))) {
          if (!r.text) continue;
          delete r.media;
        }
        items.push(r);
      }
      const record: UserQuickReplies = { memberId: ctx.portal.id, userId: ctx.viewer.userId, items };
      await store.put(QUICK_USER_KIND, quickUserKey(ctx.portal.id, ctx.viewer.userId), record, SYSTEM_OWNER);
      const used = new Set(items.map((r) => r.media?.id).filter(Boolean));
      await deleteMedia(store, owner, (m) => !used.has(m.id) && Date.now() - Date.parse(m.createdAt) > 60 * 60_000);
      return quickFor(ctx);
    }),
  );
  app.post(
    "/b24/chat/quick/upload",
    express.raw({ type: () => true, limit: MAX_MEDIA_BYTES + 1024 }),
    withViewer(async (ctx, _body, req) => {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) fail(400, "Dosya boş.");
      if (buffer.length > MAX_MEDIA_BYTES) fail(413, "Dosya 16 MB sınırını aşıyor.");
      let name = "";
      try {
        name = decodeURIComponent(String(req.get("x-file-name") || "")).slice(0, 120);
      } catch {
        name = "";
      }
      const record = await saveMedia(store, quickUserOwner(ctx.portal.id, ctx.viewer.userId), buffer, String(req.get("content-type") || "application/octet-stream"), name);
      return { media: { id: record.id, name: record.fileName, mime: record.mime, type: record.mediaType } };
    }),
  );

  // Dosyalı hazır cevabı gönderir (dosya + isteğe bağlı açıklama).
  app.post(
    "/b24/chat/send-quick",
    json,
    withViewer(async (ctx, body) => {
      const chat = await chatFor(ctx, body);
      const found = await findQuick(ctx, String(body.key || ""));
      const reply = found?.reply;
      if (!reply?.media) fail(404, "Hazır cevap bulunamadı.");
      const stored = await readMedia(store, found!.owner, reply!.media!.id);
      if (!stored) fail(410, "Hazır cevabın dosyası bulunamadı. Yönetici dosyayı yeniden eklemeli.");
      ctx.portal = await refreshLines(store, ctx.portal, [chat.line], 30_000);
      const info = ctx.portal.lines[chat.line];
      if (info.status !== "connected" || !info.instance) fail(409, "Bu numaranın WhatsApp bağlantısı kopmuş.");
      if (!(await lineUsable(store, ctx.portal, chat.line))) fail(402, "Bu numaranın lisans süresi doldu.");
      const caption = String(body.text ?? reply!.text ?? "").replace(/\r/g, "").trim().slice(0, 1000);
      // Yazışmada gösterilebilsin diye sohbet medyasına kopyalanır (sohbet medyası gibi süresi dolunca silinir).
      const record = await saveMedia(store, `b24:${ctx.portal.id}`, stored!.buffer, stored!.record.mime, stored!.record.fileName);
      let result: any;
      try {
        result = await sendEvolutionMedia(info.instance, chat.phone, record, stored!.buffer, caption);
      } catch (error) {
        await refreshLines(store, ctx.portal, [chat.line], 0).catch(() => undefined);
        fail(502, `Dosya gönderilemedi: ${(error as Error).message}`);
      }
      await recordOutbound(store, ctx.portal, chat.line, chat, {
        agent: ctx.viewer.userId,
        text: caption,
        local: caption || `[${record.mediaType === "image" ? "Görsel" : record.mediaType === "video" ? "Video" : "Dosya"}]`,
        via: "xre",
        waId: String(result?.key?.id || ""),
        media: { id: record.id, name: record.fileName, type: record.mediaType, mime: record.mime },
      });
      return { ok: true };
    }),
  );
  // Hazır cevap dosyasının önizlemesi (sohbet ekranı)
  app.get(
    "/b24/chat/quick-media/:id",
    withViewer(async (ctx, _body, req, res) => {
      const id = String(req.params.id || "");
      const mine = (await userQuickReplies(store, ctx.portal.id, ctx.viewer.userId)).some((r) => r.media?.id === id);
      if (!mine && !(ctx.portal.quickReplies || []).some((r) => r.media?.id === id)) fail(404, "Dosya bulunamadı.");
      const media = await readMedia(store, mine ? quickUserOwner(ctx.portal.id, ctx.viewer.userId) : quickOwner(ctx.portal.id), id);
      if (!media) fail(404, "Dosya bulunamadı.");
      sendQuickMedia(res, media!);
      return undefined;
    }),
  );

  // Yazışmadaki medya: yalnız o sohbete erişimi olan kullanıcıya.
  app.get(
    "/b24/chat/media/:id",
    withViewer(async (ctx, _body, req, res) => {
      const chat = await chatFor(ctx, req.query);
      const id = String(req.params.id || "");
      const messages = await threadMessages(store, chat);
      if (!messages.some((m) => m.media?.id === id)) fail(404, "Dosya bulunamadı.");
      const media = await readMedia(store, `b24:${ctx.portal.id}`, id);
      if (!media) fail(410, "Dosyanın saklama süresi doldu.");
      const inline = /^(image\/(png|jpeg|gif|webp)|audio\/|video\/(mp4|webm|3gpp))/.test(media!.record.mime);
      res.setHeader("content-type", inline ? media!.record.mime : "application/octet-stream");
      res.setHeader("content-disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(media!.record.fileName)}"`);
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", "sandbox; default-src 'none'");
      res.setHeader("cache-control", "private, max-age=3600");
      res.send(media!.buffer);
      return undefined;
    }),
  );

  // Sohbet ekranı (yönetici panelindeki "Sohbetler" sekmesi iframe olarak açar).
  app.get("/b24/chat/view", async (req, res) => {
    const viewer = viewerOf(req.query.t);
    const lang = normLang(req.query.lang);
    if (!viewer) return page(res, 401, pick(lang, "Oturum süresi doldu", "Session expired"), pick(lang, "<p>Sayfayı yenileyin.</p>", "<p>Please reload the page.</p>"), "", lang);
    res.setHeader("referrer-policy", "no-referrer");
    res.status(200).type("html").setHeader("cache-control", "no-store").send(chatHtml(String(req.query.t), lang, { mode: "inbox" }));
  });

  // CRM kartı sekmesi (Bitrix yerleşimi).
  const card = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    const portal = /^[a-zA-Z0-9_]{6,64}$/.test(p.memberId) ? await portalById(store, p.memberId) : null;
    if (!portal?.active || portal.domain !== p.domain)
      return page(res, 404, pick(p.lang, "Uygulama kurulu değil", "The app is not installed"), "", "", p.lang);
    let user: any;
    let admin = false;
    try {
      const viewer = { ...portal, accessToken: p.authId, refreshToken: "", expiresAt: 0 };
      user = await b24Call(store, viewer, "user.current");
      admin = (await b24Call(store, viewer, "user.admin")) === true;
    } catch {
      return page(res, 401, pick(p.lang, "Bitrix oturumu doğrulanamadı", "Bitrix24 session could not be verified"), "", "", p.lang);
    }
    const userId = String(user?.ID || "").replace(/\D/g, "");
    if (!userId) return page(res, 401, pick(p.lang, "Bitrix oturumu doğrulanamadı", "Bitrix24 session could not be verified"), "", "", p.lang);
    const entityId = String(p.options.ID || p.options.id || "").replace(/\D/g, "");
    const { phones, title } = entityId && CARD_PLACEMENTS.includes(p.placement) ? await entityPhones(store, portal, p.placement, entityId) : { phones: [], title: "" };
    res.setHeader("referrer-policy", "no-referrer");
    res.status(200).type("html").setHeader("cache-control", "no-store").send(chatHtml(chatTicket(portal.id, userId, admin), p.lang, { mode: "card", phones, title }));
  };
  const form = express.urlencoded({ extended: true, limit: "64kb" });
  app.get("/b24/card", card);
  app.post("/b24/card", form, card);
}

// ---------- Arayüz ----------

const TEXT = {
  tr: {
    chats: "Sohbetler", search: "İsim veya numara ara", all: "Tümü", waiting: "Yanıt bekleyen", allLines: "Tüm numaralar",
    newChat: "Yeni sohbet", phone: "Telefon", from: "Gönderen numara", start: "Başlat", empty: "Henüz sohbet yok.",
    pick: "Soldan bir sohbet seçin ya da yeni sohbet başlatın.", placeholder: "Mesajınızı yazın… (Enter gönderir, Shift+Enter yeni satır)",
    send: "Gönder", hint: "Çevrilmeden göndermek için mesajı ! ile başlatın.", translated: "Çeviri", sentAs: "Müşteriye giden",
    ai: "AI asistan", you: "Siz", noAccess: "Size atanmış numara yok. Yöneticinizden rol isteyin.", load: "Yükleniyor…",
    notConnected: "bağlı değil", cardNoPhone: "Bu kartta telefon numarası yok. Karta numara ekleyin ya da aşağıdan yazın.",
    cardStart: "Bu müşteriyle henüz WhatsApp yazışması yok. İlk mesajı buradan gönderebilirsiniz.", file: "Dosya", expired: "dosya süresi doldu",
    waitingTag: "Yanıt bekliyor", back: "Sohbetler", error: "İşlem tamamlanamadı.",
    attach: "Dosya, görsel veya video ekle", record: "Ses kaydı", stop: "Gönder", cancel: "Vazgeç", recording: "Kaydediliyor",
    meeting: "Google Meet", meetingText: "📹 Görüntülü görüşme bağlantımız: ", meetSend: "Görüşme bağlantımı gönder",
    meetChange: "Oda bağlantımı değiştir", meetSetup: "Google Meet odanız",
    meetHelp: "Kendi sabit odanızı bir kez kaydedin: Google Takvim'de kendinize tekrar eden bir etkinlik oluşturup \"Google Meet ile görüntülü görüşme ekle\" deyin (ya da meet.google.com → Yeni toplantı → Sonraki bir toplantı için toplantı oluştur). Bağlantıyı buraya yapıştırın. Kayıtlar sizin Google Drive'ınıza düşer.",
    save: "Kaydet", saved: "Oda bağlantınız kaydedildi.", call: "Ara", callPhone: "Telefonla ara (Bitrix)",
    hidden: "Gizli numara", link: "Numarayla eşleştir", linkAsk: "WhatsApp bu kişinin numarasını göstermedi. Gerçek numarasını yazın; iki sohbet birleşir ve sonraki mesajlar bu numaraya düşer.", linked: "Sohbetler birleştirildi.", callWa: "WhatsApp Web ile ara", callApp: "WhatsApp masaüstü uygulamasıyla ara", callNote: "Sohbet yeni sekmede WhatsApp Web'de açılır; sağ üstteki 📞 ile arayın. İlk seferde şirket telefonuyla QR'ı okutun (WhatsApp → Ayarlar → Bağlı cihazlar → Cihaz bağla); arama şirket numarasından yapılır. Tarayıcınızda arama düğmesi yoksa masaüstü uygulamasını kullanın.",
    connected: "Bağlı", disconnected: "Bağlantı yok", connecting: "Bağlanıyor",
    offAdmin: "Bu numaranın WhatsApp bağlantısı kopmuş. Panel → Bağlantılar'dan QR okutun.",
    offUser: "Bu numaranın WhatsApp bağlantısı kopmuş. Yöneticinizden numarayı yeniden bağlamasını isteyin.",
    warnLines: "Bağlantısı kopan numara: ", mic: "Mikrofona erişilemedi. Tarayıcı izni verin ya da ekranı yeni sekmede açın.",
    tooBig: "Dosya 16 MB sınırını aşıyor.", uploading: "Gönderiliyor…", newTab: "Yeni sekmede aç", caption: "Açıklama (isteğe bağlı)",
    viaPhone: "Telefondan", more: "Daha fazla göster", shown: "gösterilen", noMatch: "Aramaya uyan sohbet yok.",
    noLines: "Henüz WhatsApp numarası bağlı değil. Uygulamanın Bağlantılar sekmesinden yeni bir numara ekleyip QR kodu telefonunuzla okutun; 2 dakika sürer. Bağlandıktan sonra son sohbetleriniz buraya gelir.",
    noLinesUser: "Yöneticiniz henüz bir WhatsApp numarası bağlamadı.",
    noConnected: "Numaralarınızın WhatsApp bağlantısı yok. Bağlantılar sekmesinden QR kodu okutun.",
    quick: "Hazır cevaplar", quickEmpty: "Henüz hazır cevap yok. Kendi cevaplarınızı aşağıdan ekleyebilirsiniz.", quickHint: "Mesaj kutusuna / yazarak da seçebilirsiniz.",
    bellOn: "Yeni mesaj bildirimleri açık", bellOff: "Yeni mesajlarda sesli ve masaüstü bildirim almak için tıklayın", bellBlocked: "Tarayıcı masaüstü bildirimine izin vermedi; yeni mesajlarda yalnız ses çalınacak.",
    newMsg: "Yeni WhatsApp mesajı", unread: "okunmamış", qattRemove: "Dosyayı kaldır",
    quickEdit: "Hazır cevaplarımı düzenle", quickMineTitle: "Hazır cevaplarım", quickMineHint: "Bu cevapları yalnız siz görürsünüz. Mesaj kutusuna / ve kısayolu yazarak ya da ⚡ menüsünden kullanın. Aynı kısayolla ortak bir cevap varsa sizinki geçerli olur.",
    quickShared: "ortak", quickSharedTitle: "Ortak cevaplar (yönetici tanımlar)", quickAdd: "Cevap ekle", quickSave: "Kaydet", quickSaved: "Hazır cevaplarınız kaydedildi.",
    quickKey: "kısayol (ör. fiyat)", quickText: "Mesaj metni (dosyayla birlikte açıklama olarak gider)", quickFile: "Görsel / dosya ekle", quickFileHint: "Görsel, video veya PDF · en fazla 16 MB", quickDel: "Sil", quickNone: "Henüz kişisel hazır cevabınız yok. Fiyat listeniz, kartvizitiniz veya sık yazdığınız mesajları ekleyin.", close: "Kapat", uploaded: "Dosya eklendi. Kaydetmeyi unutmayın.",
  },
  en: {
    chats: "Chats", search: "Search name or number", all: "All", waiting: "Awaiting reply", allLines: "All numbers",
    newChat: "New chat", phone: "Phone", from: "Send from", start: "Start", empty: "No chats yet.",
    pick: "Select a chat on the left or start a new one.", placeholder: "Type a message… (Enter sends, Shift+Enter new line)",
    send: "Send", hint: "Start the message with ! to send it untranslated.", translated: "Translation", sentAs: "Sent to customer",
    ai: "AI assistant", you: "You", noAccess: "No numbers are assigned to you. Ask your administrator for a role.", load: "Loading…",
    notConnected: "not connected", cardNoPhone: "This record has no phone number. Add one to the record or type it below.",
    cardStart: "No WhatsApp conversation with this customer yet. You can send the first message here.", file: "File", expired: "file expired",
    waitingTag: "Awaiting reply", back: "Chats", error: "The action could not be completed.",
    attach: "Attach file, image or video", record: "Voice message", stop: "Send", cancel: "Cancel", recording: "Recording",
    meeting: "Google Meet", meetingText: "📹 Our video call link: ", meetSend: "Send my meeting link",
    meetChange: "Change my room link", meetSetup: "Your Google Meet room",
    meetHelp: "Save your permanent room once: create a recurring event for yourself in Google Calendar and add Google Meet video conferencing (or meet.google.com → New meeting → Create a meeting for later). Paste the link here. Recordings are saved to your Google Drive.",
    save: "Save", saved: "Your room link was saved.", call: "Call", callPhone: "Call by phone (Bitrix24)",
    hidden: "Hidden number", link: "Link to number", linkAsk: "WhatsApp did not reveal this person’s number. Enter their real number; both chats are merged and later messages go to this number.", linked: "Chats merged.", callWa: "Call with WhatsApp Web", callApp: "Call with the WhatsApp desktop app", callNote: "The chat opens in WhatsApp Web in a new tab; press 📞 at the top right to call. The first time, scan the QR code with the company phone (WhatsApp → Settings → Linked devices → Link a device); the call is made from the company number. If your browser shows no call button, use the desktop app.",
    connected: "Connected", disconnected: "Disconnected", connecting: "Connecting",
    offAdmin: "This number's WhatsApp connection is lost. Scan the QR code again in Panel → Connections.",
    offUser: "This number's WhatsApp connection is lost. Ask your administrator to reconnect it.",
    warnLines: "Disconnected numbers: ", mic: "Microphone is not available. Allow access in the browser or open the screen in a new tab.",
    tooBig: "The file exceeds the 16 MB limit.", uploading: "Sending…", newTab: "Open in new tab", caption: "Caption (optional)",
    viaPhone: "From phone", more: "Show more", shown: "shown", noMatch: "No chats match your search.",
    noLines: "No WhatsApp number is connected yet. On the app's Connections tab, click Add number and scan the QR code with your phone; it takes 2 minutes. Your recent chats appear here once connected.",
    noLinesUser: "Your administrator has not connected a WhatsApp number yet.",
    noConnected: "Your numbers are not connected to WhatsApp. Scan the QR code on the Connections tab.",
    quick: "Quick replies", quickEmpty: "No quick replies yet. You can add your own below.", quickHint: "You can also type / in the message box.",
    bellOn: "New message notifications are on", bellOff: "Click to get sound and desktop notifications for new messages", bellBlocked: "The browser blocked desktop notifications; only a sound will play for new messages.",
    newMsg: "New WhatsApp message", unread: "unread", qattRemove: "Remove file",
    quickEdit: "Edit my quick replies", quickMineTitle: "My quick replies", quickMineHint: "Only you see these replies. Type / and the shortcut in the message box or use the ⚡ menu. If a shared reply has the same shortcut, yours is used.",
    quickShared: "shared", quickSharedTitle: "Shared replies (set by an administrator)", quickAdd: "Add reply", quickSave: "Save", quickSaved: "Your quick replies were saved.",
    quickKey: "shortcut (e.g. prices)", quickText: "Message text (sent as the caption with a file)", quickFile: "Add image / file", quickFileHint: "Image, video or PDF · up to 16 MB", quickDel: "Delete", quickNone: "You have no personal quick replies yet. Add your price list, business card or messages you send often.", close: "Close", uploaded: "File added. Don’t forget to save.",
  },
};

export function chatHtml(ticket: string, lang: Lang, ctx: { mode: "inbox" | "card"; phones?: string[]; title?: string }) {
  const cfg = { t: ticket, lang, mode: ctx.mode, phones: ctx.phones || [], title: ctx.title || "", txt: TEXT[lang] };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp by XRE</title>
<style>${PANEL_STYLE}
html,body{height:100%}body{overflow:hidden}[hidden]{display:none!important}
.app{display:grid;grid-template-columns:320px 1fr;height:100vh;background:var(--paper)}
.app.card{grid-template-columns:260px 1fr}
.side{border-right:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;min-height:0}
.side header{padding:14px 14px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.side h1{font-size:16px;margin:0}
.side .tools{padding:0 14px 10px;display:grid;gap:8px}
.side input,.side select,.pane select,.newform input,.newform select{width:100%;padding:7px 10px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper);color:inherit;font:inherit}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chips button{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:3px 10px;font-size:12.5px;cursor:pointer;color:var(--ink-2)}
.chips button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent);border-color:transparent;font-weight:600}
.list{flex:1;overflow:auto;border:0;border-radius:0}
.list .more{display:block;margin:10px auto 14px;font-size:12.5px}
.item.unread .nm{font-weight:750}.item.unread .ls{color:var(--ink);font-weight:550}
.udot{display:block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-top:7px}
.bell{border:1px solid var(--line);background:var(--surface);border-radius:var(--r-s);padding:5px 8px;cursor:pointer;font-size:14px;line-height:1}
.bell[aria-pressed="true"]{background:var(--accent-soft,#e6f6f4);border-color:var(--accent)}
.qmenu{max-height:260px;overflow:auto;min-width:320px}
.qmenu button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 9px;border-radius:6px;cursor:pointer;color:inherit;font:inherit}
.qmenu button:hover,.qmenu button.on{background:var(--paper)}
.qmenu b{font-size:12.5px;color:var(--accent)}.qmenu span{display:block;font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:420px}
.qmenu p{margin:6px 9px;font-size:12px;color:var(--ink-3,#8a96a3)}
.qmenu .qm{display:grid;grid-template-columns:1fr 44px;gap:8px;align-items:center}
.qmenu img,.qatt img{width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--line)}
.qatt{display:flex;align-items:center;gap:10px;padding:6px 8px;margin-bottom:6px;border:1px dashed var(--accent);border-radius:var(--r-s);background:var(--paper);font-size:13px}
.qatt b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.qatt button{border:0;background:none;cursor:pointer;font-size:15px;color:var(--ink-2)}
.qmenu .qtag{display:inline;font-weight:500;color:var(--ink-3,#8a96a3);font-size:11px;margin-left:4px}
.qmenu .qedit-btn{border-top:1px solid var(--line);border-radius:0;margin-top:4px;padding-top:9px;color:var(--accent);font-weight:600;font-size:12.5px}
.qedit{position:fixed;inset:0;background:rgba(10,20,30,.45);display:flex;align-items:flex-start;justify-content:center;padding:28px 14px;z-index:50;overflow:auto}
.qedit[hidden]{display:none}
.qbox{background:var(--surface);border-radius:var(--r-l,14px);box-shadow:var(--shadow);width:min(760px,100%);padding:18px 20px}
.qbox header{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:0;border:0;background:none}
.qbox h2{margin:0;font-size:17px}.qbox>p{margin:6px 0 14px;font-size:13px;color:var(--ink-2)}
.qbox h3{margin:18px 0 8px;font-size:13px;color:var(--ink-2)}
.qer{display:grid;grid-template-columns:140px 1fr 150px auto;gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--line-2,var(--line))}
.qer input,.qer textarea{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper);color:inherit;font:inherit;font-size:13px}
.qer textarea{min-height:56px;resize:vertical}
.qer .qf{display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--ink-2)}
.qer .qf img{width:84px;height:62px;object-fit:cover;border-radius:6px;border:1px solid var(--line)}
.qer .qf .nm{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qshared{font-size:13px;color:var(--ink-2)}.qshared div{padding:5px 0;border-top:1px solid var(--line-2,var(--line))}.qshared b{color:var(--accent)}
.qebar{display:flex;justify-content:space-between;margin-top:14px;gap:8px}
@media (max-width:640px){.qer{grid-template-columns:1fr}}
.item{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 14px;border:0;border-top:1px solid var(--line-2);border-left:3px solid transparent;cursor:pointer;width:100%;text-align:left;background:none;color:inherit;font:inherit}
.item:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.item:hover{background:var(--paper)}.item[aria-current=true]{background:var(--accent-soft);border-left-color:var(--accent)}
.item .nm{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item .ls{display:block;color:var(--ink-3);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
.item time{white-space:nowrap}
.item time{color:var(--ink-3);font-size:11.5px}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;background:var(--warn-soft);color:var(--warn);margin-top:3px}
.tag.ln{background:var(--line-2);color:var(--ink-2)}
.pane{display:flex;flex-direction:column;min-width:0;min-height:0}
.pane header{padding:12px 18px;border-bottom:1px solid var(--line);background:var(--surface);display:flex;align-items:center;gap:12px}
.pane header .who{flex:1;min-width:0}.pane header b{display:block}.pane header span{color:var(--ink-3);font-size:12.5px}
.msgs{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:8px}
.b{max-width:min(620px,78%);padding:8px 12px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45;font-size:14px}
.b.in{align-self:flex-start;background:var(--surface);border:1px solid var(--line)}
.b.out{align-self:flex-end;background:var(--accent-soft)}
.b .meta{display:block;font-size:11px;color:var(--ink-3);margin-top:4px;text-align:right}
.b .tr{display:block;margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);color:var(--ink-2);font-size:13px}
.b .tr i{font-style:normal;font-weight:600;color:var(--accent)}
.b img,.b video{max-width:260px;max-height:260px;border-radius:8px;display:block;margin-bottom:4px}
.b audio{max-width:260px;display:block;margin-bottom:4px}
.day{align-self:center;font-size:11.5px;color:var(--ink-3);background:var(--line-2);padding:2px 10px;border-radius:999px;margin:6px 0}
.composer{border-top:1px solid var(--line);background:var(--surface);padding:10px 14px}
.composer .row1{display:flex;gap:8px;align-items:flex-end}
.composer textarea{flex:1;resize:none;min-height:42px;max-height:160px;padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper);color:inherit;font:inherit}
.composer small{display:block;color:var(--ink-3);font-size:11.5px;margin-top:6px}
.blank{flex:1;display:grid;place-items:center;color:var(--ink-3);padding:24px;text-align:center}
.newform{padding:12px 14px;border-top:1px solid var(--line-2);display:grid;gap:8px;background:var(--paper)}
.newform label{font-size:12px;font-weight:600;color:var(--ink-2);display:grid;gap:4px}
.backbtn{display:none}
.warn{margin:0 14px 10px;padding:8px 10px;border-radius:var(--r-s);background:var(--danger-soft);color:var(--danger);font-size:12.5px;font-weight:600;line-height:1.4}
.st{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
.st::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.st.ok{color:var(--ok);background:var(--ok-soft)}.st.bad{color:var(--danger);background:var(--danger-soft)}.st.wait{color:var(--warn);background:var(--warn-soft)}
.composer.off textarea,.composer.off button{opacity:.5;pointer-events:none}
.tools2{display:flex;gap:4px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.tools2 .ic{border:1px solid var(--line);background:var(--surface);border-radius:var(--r-s);padding:5px 9px;cursor:pointer;font-size:13px;color:var(--ink-2);display:inline-flex;gap:5px;align-items:center}
.tools2 .ic:hover{border-color:var(--ink-3)}
.rec{display:flex;align-items:center;gap:10px;padding:8px 0}.rec .dot{width:10px;height:10px;border-radius:50%;background:var(--danger);animation:blink 1s infinite}
@keyframes blink{50%{opacity:.3}}@media (prefers-reduced-motion:reduce){.rec .dot{animation:none}}
.menu{position:absolute;bottom:100%;left:0;margin-bottom:6px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-m);box-shadow:var(--shadow);min-width:240px;padding:6px;z-index:5}
.menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:6px;cursor:pointer;color:inherit;font:inherit}
.menu button:hover{background:var(--paper)}.menu p{margin:6px 10px;color:var(--ink-3);font-size:11.5px;line-height:1.4}
.linkbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--accent-soft);font-size:13px}.linkbar span{flex:1 1 260px}.linkbar input{width:170px;padding:7px 10px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper);color:inherit;font:inherit}
.composer .offmsg{color:var(--danger);font-weight:600;font-size:12.5px;margin-bottom:8px}
@media (max-width:720px){
  .app,.app.card{grid-template-columns:1fr}
  .app.open .side{display:none}.app:not(.open) .pane{display:none}
  .backbtn{display:inline-flex}
}
</style></head><body>
<div class="app${ctx.mode === "card" ? " card" : ""}" id="app">
  <aside class="side">
    <header><h1 id="ttl"></h1><span style="display:flex;gap:6px"><button type="button" class="bell" id="bell" aria-pressed="false">🔔</button><button class="btn primary" id="newBtn"></button></span></header>
    <div class="tools"><input id="q" type="search"><select id="lineFilter"></select><div class="chips" id="chips"></div></div>
    <div class="warn" id="warn" hidden></div>
    <div class="list" id="list" role="list"></div>
    <form class="newform" id="newForm" hidden></form>
  </aside>
  <section class="pane" id="pane"><div class="blank" id="blank"></div></section>
</div>
<div class="toast" id="toast" role="status"></div>
<div class="qedit" id="qedit" hidden role="dialog" aria-modal="true" aria-labelledby="qeTitle"><div class="qbox"><header><h2 id="qeTitle"></h2><button type="button" class="btn ghost" id="qeClose"></button></header><p id="qeHint"></p><div id="qeList"></div><div class="qebar"><button type="button" class="btn" id="qeAdd"></button><button type="button" class="btn primary" id="qeSave"></button></div><div id="qeShared"></div></div></div>
<script>
// Bitrix, CRM kart sekmesini kısa sabit bir çerçevede açar; ekrana göre büyütülür.
window.xreFit=function(){try{var h=Math.max(760,((window.screen&&screen.availHeight)||900)-170);BX24.resizeWindow(document.documentElement.scrollWidth||document.body.offsetWidth,h)}catch(e){}};
</script>
<script src="https://api.bitrix24.com/api/v1/" async onload="try{BX24.init(function(){window.XRE_BX=true;window.xreFit()})}catch(e){}"></script>
<script>window.XRE_CHAT=${JSON.stringify(cfg).replace(/</g, "\\u003c")};</script>
<script>${CHAT_JS}</script>
</body></html>`;
}

const CHAT_JS = String.raw`
(function(){
var C=window.XRE_CHAT,X=C.txt,$=function(s){return document.querySelector(s)};
var S={threads:[],lines:[],cur:null,filter:"all",line:"",q:"",count:"",limit:500,total:0,quick:[],prev:null};
// Okunmamışlar bu tarayıcıda tutulur; ilk kullanımda eski sohbetler okunmuş sayılır.
var SEEN={},BASE=Date.now(),TITLE=document.title;
try{SEEN=JSON.parse(localStorage.getItem("xre-seen")||"{}")||{};BASE=Number(localStorage.getItem("xre-seen-base"))||Date.now();localStorage.setItem("xre-seen-base",String(BASE))}catch(e){}
function ck(t){return t.line+"|"+t.phone}
function markSeen(t,at){var k=ck(t);SEEN[k]=Math.max(SEEN[k]||0,at||Date.now());try{var keys=Object.keys(SEEN);if(keys.length>3000)keys.sort(function(a,b){return SEEN[a]-SEEN[b]}).slice(0,keys.length-3000).forEach(function(x){delete SEEN[x]});localStorage.setItem("xre-seen",JSON.stringify(SEEN))}catch(e){}}
function isCur(t){return S.cur&&S.cur.line===t.line&&S.cur.phone===t.phone}
function isUnread(t){return t.lastFrom==="müşteri"&&t.lastAt>(SEEN[ck(t)]||BASE)&&!(isCur(t)&&!document.hidden)}
// Bildirim: ses (ilk tıklamadan sonra) ve izin verildiyse masaüstü bildirimi
var AC=null;function unlockAudio(){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();if(AC.state==="suspended")AC.resume()}catch(e){}}
document.addEventListener("click",unlockAudio,{once:true});
function beep(){try{if(!AC)return;[0,0.18].forEach(function(d){var o=AC.createOscillator(),g=AC.createGain();o.frequency.value=d?1175:880;g.gain.setValueAtTime(0.0001,AC.currentTime+d);g.gain.exponentialRampToValueAtTime(0.18,AC.currentTime+d+0.02);g.gain.exponentialRampToValueAtTime(0.0001,AC.currentTime+d+0.16);o.connect(g);g.connect(AC.destination);o.start(AC.currentTime+d);o.stop(AC.currentTime+d+0.17)})}catch(e){}}
function canNotify(){try{return "Notification" in window&&Notification.permission==="granted"}catch(e){return false}}
function bellState(){var b=$("#bell");if(!b)return;var on=canNotify()||!!AC;b.setAttribute("aria-pressed",String(canNotify()));b.textContent=canNotify()?"🔔":"🔕";b.title=canNotify()?X.bellOn:X.bellOff}
function onArrivals(list){if(!list.length||C.mode==="card")return;beep();
  if(canNotify()&&(document.hidden||!list.every(isCur))){var t=list[0];try{var n=new Notification((t.name||phone(t.phone))+(list.length>1?" +"+(list.length-1):""),{body:t.lastText||X.newMsg,tag:"xre-wa",renotify:true});n.onclick=function(){try{window.focus()}catch(e){}open(t);n.close()}}catch(e){}}}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function phone(p){p=String(p||"");if(/@lid$/.test(p))return X.hidden;return p?"+"+p.replace(/^(\d{2})(\d{3})(\d{3})(\d{2})(\d{2})$/,"$1 $2 $3 $4 $5"):""}
var loc=C.lang==="tr"?"tr-TR":"en-US";
function hm(t){return new Date(t).toLocaleTimeString(loc,{hour:"2-digit",minute:"2-digit"})}
function dayOf(t){return new Date(t).toLocaleDateString(loc,{day:"numeric",month:"long",year:"numeric"})}
function when(t){if(!t)return"";var d=new Date(t),n=new Date();return d.toDateString()===n.toDateString()?hm(t):d.toLocaleDateString(loc,{day:"numeric",month:"short"})}
function initials(n){return (String(n||"?").trim().split(/\s+/).map(function(w){return w[0]}).join("").slice(0,2)||"?").toUpperCase()}
var tt;function toast(m,e){var t=$("#toast");t.textContent=m;t.className="toast show"+(e?" err":"");clearTimeout(tt);tt=setTimeout(function(){t.className="toast"},e?6000:2500)}
function api(path,body){return fetch("/b24/chat/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.assign({},body||{},{t:C.t}))}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok)throw new Error(j.message||X.error);return j})})}
function mediaUrl(m){return "/b24/chat/media/"+encodeURIComponent(m.media.id)+"?t="+encodeURIComponent(C.t)+"&line="+encodeURIComponent(S.cur.line)+"&phone="+encodeURIComponent(S.cur.phone)}

$("#ttl").textContent=C.mode==="card"?(C.title||X.chats):X.chats;
$("#newBtn").textContent=X.newChat;$("#q").placeholder=X.search;
if(C.mode==="card")$("#bell").hidden=true;
$("#bell").onclick=function(){unlockAudio();try{if("Notification" in window&&Notification.permission==="default")Notification.requestPermission().then(function(p){bellState();if(p!=="granted")toast(X.bellBlocked)});else if(!canNotify())toast(X.bellBlocked);else toast(X.bellOn)}catch(e){toast(X.bellBlocked)}bellState()};
bellState();
$("#chips").innerHTML='<button data-f="all" aria-pressed="true">'+esc(X.all)+'</button><button data-f="waiting" aria-pressed="false">'+esc(X.waiting)+'</button>';
$("#chips").onclick=function(e){var f=e.target.getAttribute("data-f");if(!f)return;S.filter=f;[].forEach.call($("#chips").children,function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-f")===f))});renderList()};
var qt;$("#q").oninput=function(e){S.q=e.target.value.toLocaleLowerCase(C.lang==="tr"?"tr-TR":"en-US");renderList();clearTimeout(qt);qt=setTimeout(function(){S.limit=500;loadThreads()},350)};
$("#lineFilter").onchange=function(e){S.line=e.target.value;renderList()};
$("#newBtn").onclick=function(){var f=$("#newForm");f.hidden=!f.hidden;if(!f.hidden)renderNew()};

function renderNew(){
  var ls=S.lines.filter(function(l){return l.connected});
  var phones=C.phones||[];
  $("#newForm").innerHTML='<label>'+esc(X.phone)+(phones.length>1?'<select id="nPhone">'+phones.map(function(p){return '<option value="'+esc(p)+'">'+esc(phone(p))+'</option>'}).join("")+'</select>':'<input id="nPhone" inputmode="tel" placeholder="0532 000 00 00" value="'+esc(phones[0]?phone(phones[0]):"")+'">')+'</label>'
    +'<label>'+esc(X.from)+'<select id="nLine">'+ls.map(function(l){return '<option value="'+esc(l.line)+'">'+esc(l.name)+(l.phone?" · "+esc(phone(l.phone)):"")+'</option>'}).join("")+'</select></label>'
    +'<button class="btn primary" type="submit">'+esc(X.start)+'</button>';
  $("#newForm").onsubmit=function(e){e.preventDefault();var p=String($("#nPhone").value||"").replace(/\D/g,"");if(p.length===11&&p[0]==="0")p="90"+p.slice(1);if(p.length===10&&p[0]==="5")p="90"+p;if(p.length<10){toast(X.phone+"?",true);return}
    var l=$("#nLine").value;if(!l)return;$("#newForm").hidden=true;open({line:l,phone:p,name:"",lineName:(S.lines.find(function(x){return x.line===l})||{}).name})};
}

function visible(){return S.threads.filter(function(t){
  if(S.filter==="waiting"&&!t.waiting)return false;if(S.line&&t.line!==S.line)return false;
  if(S.q&&(t.name+" "+t.phone+" "+t.lastText).toLowerCase().indexOf(S.q.replace(/\s/g,""))<0&&(t.name+" "+t.lastText).toLowerCase().indexOf(S.q)<0)return false;return true})}
function emptyText(){
  if(!S.lines.length)return C.admin||!S.portalLines?(C.admin?X.noLines:X.noLinesUser):X.noAccess;
  if(S.q)return X.noMatch;
  if(!S.lines.some(function(l){return l.connected}))return X.noConnected;
  return X.empty}
function unreadTitle(){var n=S.threads.filter(isUnread).length;document.title=(n?"("+n+") ":"")+TITLE}
function renderList(){
  var v=visible();
  $("#list").innerHTML=v.length?v.map(function(t){var cur=S.cur&&S.cur.line===t.line&&S.cur.phone===t.phone,un=isUnread(t);
    return '<button class="item'+(un?" unread":"")+'" role="listitem" data-l="'+esc(t.line)+'" data-p="'+esc(t.phone)+'" aria-current="'+cur+'"><span class="avatar" aria-hidden="true">'+esc(initials(t.name||t.phone))+'</span><span style="min-width:0"><span class="nm">'+esc(t.name||phone(t.phone))+'</span><span class="ls">'+esc(t.lastText)+'</span>'
      +(t.waiting?'<span class="tag">'+esc(X.waitingTag)+'</span> ':'')+(S.lines.length>1?'<span class="tag ln">'+esc(t.lineName)+'</span>':'')+'</span><span style="display:flex;flex-direction:column;align-items:flex-end"><time>'+esc(when(t.lastAt))+'</time>'+(un?'<span class="udot" role="img" aria-label="'+esc(X.unread)+'"></span>':'')+'</span></button>'}).join("")
    :'<div class="blank">'+esc(emptyText())+'</div>';
  if(v.length&&S.total>S.threads.length)$("#list").insertAdjacentHTML("beforeend",'<button type="button" class="btn ghost more" id="more">'+esc(X.more)+' · '+S.threads.length+' / '+S.total+'</button>');
  if($("#more"))$("#more").onclick=function(){S.limit+=500;this.disabled=true;loadThreads()};
  [].forEach.call(document.querySelectorAll(".item"),function(b){b.onclick=function(){var t=S.threads.find(function(x){return x.line===b.getAttribute("data-l")&&x.phone===b.getAttribute("data-p")});if(t)open(t)}});
}
function loadThreads(){var req=C.mode==="card"?{phones:C.phones}:{q:S.q,limit:S.limit};return api("threads",req).then(function(d){
  var arrived=[];if(S.prev){d.threads.forEach(function(t){if(t.lastFrom==="müşteri"&&t.lastAt>(S.prev[ck(t)]||0)&&t.lastAt>(SEEN[ck(t)]||BASE))arrived.push(t)})}
  S.prev={};d.threads.forEach(function(t){S.prev[ck(t)]=t.lastAt});
  S.threads=d.threads;S.total=d.total||d.threads.length;S.quick=d.quick||[];S.quickMine=d.quickMine||[];S.quickShared=d.quickShared||[];S.portalLines=d.portalLines||0;
  d.threads.forEach(function(t){if(isCur(t)&&!document.hidden)markSeen(t,t.lastAt)});
  onArrivals(arrived);C.admin=d.admin;var first=!S.lines.length;S.lines=d.lines;
  if(first){$("#lineFilter").innerHTML='<option value="">'+esc(X.allLines)+'</option>'+S.lines.map(function(l){return '<option value="'+esc(l.line)+'">'+esc(l.name)+(l.connected?"":" ("+esc(X.notConnected)+")")+'</option>'}).join("");$("#lineFilter").hidden=S.lines.length<2;
    if(!S.lines.some(function(l){return l.connected}))$("#newBtn").hidden=true;
    if(C.mode==="card"){if(S.threads.length)open(S.threads[0]);else blankCard()}}
  var down=S.lines.filter(function(l){return l.status==="disconnected"||l.status==="connecting"});
  $("#warn").hidden=!down.length;$("#warn").textContent=down.length?"⚠ "+X.warnLines+down.map(function(l){return l.name}).join(", "):"";
  renderList();unreadTitle();lineState()}).catch(function(e){$("#list").innerHTML='<div class="blank">'+esc(e.message)+'</div>'})}
function curLine(){return S.cur&&S.lines.find(function(l){return l.line===S.cur.line})}
function lineState(){var l=curLine(),st=$("#lst"),cmp=$("#cmp");if(!l||!st||!cmp)return;
  var ok=l.status==="connected",k=ok?"ok":l.status==="connecting"?"wait":"bad";
  st.className="st "+k;st.textContent=ok?X.connected:l.status==="connecting"?X.connecting:X.disconnected;
  cmp.classList.toggle("off",!ok);$("#offmsg").hidden=ok;$("#offmsg").textContent=ok?"":(C.admin?X.offAdmin:X.offUser)}
function blankCard(){
  var l=S.lines.find(function(x){return x.connected});
  $("#newForm").hidden=false;renderNew();
  if(C.phones.length&&l){open({line:l.line,phone:C.phones[0],name:C.title,lineName:l.name})}
  else $("#blank").textContent=C.phones.length?X.noAccess:X.cardNoPhone;
}

function open(t){
  S.cur={line:t.line,phone:t.phone,name:t.name,lineName:t.lineName};S.count="";S.qatt=null;markSeen(t,t.lastAt);setTimeout(unreadTitle,0);$("#app").classList.add("open");renderList();
  $("#pane").innerHTML='<header><button class="btn ghost backbtn" id="back">← '+esc(X.back)+'</button><span class="avatar" aria-hidden="true">'+esc(initials(t.name||t.phone))+'</span><div class="who"><b id="hn">'+esc(t.name||phone(t.phone))+'</b><span>'+esc(phone(t.phone))+(t.lineName?" · "+esc(t.lineName):"")+'</span></div><span class="st" id="lst"></span>'+(/@lid$/.test(t.phone)?'<button type="button" class="btn ghost" id="bLink">🔗 '+esc(X.link)+'</button>':'')+'</header>'
    +(/@lid$/.test(t.phone)?'<form class="linkbar" id="linkBar" hidden><span>'+esc(X.linkAsk)+'</span><input id="linkNum" inputmode="tel" placeholder="0506 123 45 67"><button class="btn primary" id="linkGo">'+esc(X.link)+'</button></form>':'')+'<div class="msgs" id="msgs" aria-live="polite"><div class="blank">'+esc(X.load)+'</div></div>'
    +'<form class="composer" id="cmp"><div class="offmsg" id="offmsg" hidden></div>'
    +'<div class="tools2" style="position:relative"><button type="button" class="ic" id="bAttach" title="'+esc(X.attach)+'" aria-label="'+esc(X.attach)+'">📎</button><input type="file" id="file" hidden accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar">'
    +'<button type="button" class="ic" id="bRec" title="'+esc(X.record)+'" aria-label="'+esc(X.record)+'">🎤</button>'
    +'<button type="button" class="ic" id="bMeet">📹 '+esc(X.meeting)+'</button><div class="menu" id="meetMenu" hidden></div>'
    +'<button type="button" class="ic" id="bCall">📞 '+esc(X.call)+'</button><div class="menu" id="callMenu" hidden></div>'
    +'<button type="button" class="ic" id="bQuick" title="'+esc(X.quickHint)+'">⚡ '+esc(X.quick)+'</button><div class="menu qmenu" id="quickMenu" hidden></div></div>'
    +'<div class="rec" id="recBar" hidden><span class="dot" aria-hidden="true"></span><b>'+esc(X.recording)+'</b> <span id="recT">0:00</span><button type="button" class="btn primary" id="recSend">'+esc(X.stop)+'</button><button type="button" class="btn ghost" id="recCancel">'+esc(X.cancel)+'</button></div>'
    +'<div class="qatt" id="qatt" hidden></div><div class="row1" id="row1"><textarea id="txt" rows="1" placeholder="'+esc(X.placeholder)+'"></textarea><button class="btn primary" id="sendBtn">'+esc(X.send)+'</button></div><small>'+esc(X.hint)+'</small></form>';
  $("#back").onclick=function(){$("#app").classList.remove("open")};
  if($("#bLink")){$("#bLink").onclick=function(){var b=$("#linkBar");b.hidden=!b.hidden;if(!b.hidden)$("#linkNum").focus()};$("#linkBar").onsubmit=function(e){e.preventDefault();var v=$("#linkNum").value.trim();if(!v){$("#linkNum").focus();return}$("#linkGo").disabled=true;api("link",{line:t.line,phone:t.phone,target:v}).then(function(r){toast(X.linked);loadThreads().then(function(){var n=S.threads.find(function(x){return x.line===r.line&&x.phone===r.phone});if(n)open(n)})}).catch(function(e){$("#linkGo").disabled=false;toast(e.message,true)})}};
  var ta=$("#txt");ta.oninput=function(){ta.style.height="auto";ta.style.height=Math.min(160,ta.scrollHeight)+"px";var m=/^\/(\S*)$/.exec(ta.value);if(m)quickMenu(m[1]);else if(QM.slash)hideQuick()};
  ta.onkeydown=function(e){
    if(!$("#quickMenu").hidden&&QM.items.length){
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();QM.sel=(QM.sel+(e.key==="ArrowDown"?1:QM.items.length-1))%QM.items.length;drawQuick();return}
      if(e.key==="Enter"||e.key==="Tab"){e.preventDefault();pickQuick(QM.items[QM.sel]);return}
      if(e.key==="Escape"){hideQuick();return}}
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
  $("#bQuick").onclick=function(e){e.stopPropagation();if($("#quickMenu").hidden){QM.slash=false;quickMenu("")}else hideQuick()};
  $("#cmp").onsubmit=function(e){e.preventDefault();send()};
  $("#bAttach").onclick=function(){$("#file").click()};
  $("#file").onchange=function(e){var f=e.target.files[0];e.target.value="";if(f)upload(f,f.name,false,$("#txt").value.trim())};
  $("#bRec").onclick=startRec;
  $("#bMeet").onclick=function(e){e.stopPropagation();meetMenu()};
  $("#bCall").onclick=function(e){e.stopPropagation();var m=$("#callMenu");m.hidden=!m.hidden;
    m.innerHTML='<button type="button" id="cPhone">☎️ '+esc(X.callPhone)+'</button><button type="button" id="cWa">🌐 '+esc(X.callWa)+'</button><button type="button" id="cWaApp">💻 '+esc(X.callApp)+'</button><p>'+esc(X.callNote)+'</p>';
    $("#cPhone").onclick=function(){m.hidden=true;var num="+"+S.cur.phone;try{if(window.XRE_BX&&BX24.im&&BX24.im.phoneTo){BX24.im.phoneTo(num);return}}catch(x){}location.href="tel:"+num};
    $("#cWa").onclick=function(){m.hidden=true;window.open("https://web.whatsapp.com/send?phone="+S.cur.phone,"xre-wa-web")};
    $("#cWaApp").onclick=function(){m.hidden=true;var p=S.cur.phone,left=false,onBlur=function(){left=true};
      window.addEventListener("blur",onBlur);location.href="whatsapp://send?phone="+p;
      setTimeout(function(){window.removeEventListener("blur",onBlur);if(!left)window.open("https://wa.me/"+p,"_blank","noopener")},1500)}};
  document.addEventListener("click",function(e){var m=$("#callMenu");if(m)m.hidden=true;var mm=$("#meetMenu");if(mm&&!mm.contains(e.target))mm.hidden=true});
  lineState();ta.focus();loadMessages(true);
}
function upload(blob,name,voice,caption){
  if(!S.cur)return;if(blob.size>16*1024*1024){toast(X.tooBig,true);return}var cur=S.cur;toast(X.uploading);
  fetch("/b24/chat/upload",{method:"POST",headers:{"content-type":blob.type||"application/octet-stream","x-xre-ticket":C.t,"x-line":encodeURIComponent(cur.line),"x-phone":encodeURIComponent(cur.phone),"x-file-name":encodeURIComponent(name||""),"x-caption":encodeURIComponent(caption||""),"x-voice":voice?"1":"0"},body:blob})
    .then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok)throw new Error(j.message||X.error);return j})})
    .then(function(){if(caption){$("#txt").value=""}toast("✓");return loadMessages(true).then(loadThreads)}).catch(function(e){toast(e.message,true)})}
var rec=null,recChunks=[],recTimer=null,recStart=0,recCancelled=false;
function startRec(){
  if(!navigator.mediaDevices||!window.MediaRecorder){toast(X.mic,true);return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    var type=["audio/ogg;codecs=opus","audio/webm;codecs=opus","audio/webm"].find(function(t){return MediaRecorder.isTypeSupported(t)})||"";
    rec=new MediaRecorder(stream,type?{mimeType:type}:{});recChunks=[];recCancelled=false;
    rec.ondataavailable=function(e){if(e.data.size)recChunks.push(e.data)};
    rec.onstop=function(){stream.getTracks().forEach(function(t){t.stop()});clearInterval(recTimer);$("#recBar").hidden=true;$("#row1").hidden=false;
      if(recCancelled||!recChunks.length)return;var mime=(rec.mimeType||"audio/webm").split(";")[0];var blob=new Blob(recChunks,{type:mime});upload(blob,"ses-kaydi."+(mime.indexOf("ogg")>=0?"ogg":"webm"),true,"")};
    rec.start();recStart=Date.now();$("#recBar").hidden=false;$("#row1").hidden=true;
    recTimer=setInterval(function(){var sec=Math.round((Date.now()-recStart)/1000);$("#recT").textContent=Math.floor(sec/60)+":"+String(sec%60).padStart(2,"0");if(sec>=300)rec.stop()},500);
    $("#recSend").onclick=function(){rec.stop()};$("#recCancel").onclick=function(){recCancelled=true;rec.stop()};
  }).catch(function(){toast(X.mic,true)})}
var meetUrl=null;
function getMeet(){return meetUrl!==null?Promise.resolve(meetUrl):api("meet",{}).then(function(d){meetUrl=d.url||"";return meetUrl})}
function meetMenu(){
  var m=$("#meetMenu");if(!m.hidden){m.hidden=true;return}
  getMeet().then(function(url){
    if(!url){meetForm("");return}
    m.innerHTML='<button type="button" id="mSend">📹 '+esc(X.meetSend)+'</button><button type="button" id="mChange">⚙️ '+esc(X.meetChange)+'</button><p>'+esc(url)+'</p>';m.hidden=false;
    $("#mSend").onclick=function(){m.hidden=true;insertMeet(url)};$("#mChange").onclick=function(e){e.stopPropagation();meetForm(url)};
  }).catch(function(e){toast(e.message,true)})}
function meetForm(cur){
  var m=$("#meetMenu");m.style.minWidth="340px";
  m.innerHTML='<p style="color:var(--ink);font-weight:600;font-size:13px">'+esc(X.meetSetup)+'</p><p>'+esc(X.meetHelp)+'</p><div style="display:flex;gap:6px;padding:4px 6px 6px"><input id="meetIn" style="flex:1;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:inherit;font:inherit" placeholder="https://meet.google.com/abc-defg-hij" value="'+esc(cur)+'"><button type="button" class="btn primary" id="meetSave">'+esc(X.save)+'</button></div>';
  m.hidden=false;$("#meetIn").focus();
  $("#meetSave").onclick=function(e){e.stopPropagation();var v=$("#meetIn").value.trim();
    api("meet",{url:v}).then(function(d){meetUrl=d.url;m.hidden=true;toast(X.saved);if(d.url)insertMeet(d.url)}).catch(function(err){toast(err.message,true)})}}
function insertMeet(url){var ta=$("#txt");ta.value=(ta.value?ta.value+"\n":"")+X.meetingText+url;ta.focus();ta.oninput();window.open(url,"_blank","noopener")}
var QM={items:[],sel:0,slash:false};
function quickMenu(q){var m=$("#quickMenu");if(!m)return;q=String(q||"").toLowerCase();QM.slash=/^\//.test($("#txt").value);
  QM.items=S.quick.filter(function(r){return !q||r.key.indexOf(q)===0||r.key.indexOf(q)>0||r.text.toLowerCase().indexOf(q)>=0}).slice(0,30);QM.sel=0;
  if(QM.slash&&!QM.items.length&&q){hideQuick();return}
  drawQuick();m.hidden=false}
function drawQuick(){var m=$("#quickMenu");
  m.innerHTML=S.quick.length?QM.items.map(function(r,i){return '<button type="button" data-qi="'+i+'" class="'+(i===QM.sel?"on":"")+'"><div class="qm"><div style="min-width:0"><b>/'+esc(r.key)+(r.media?' 📎':'')+(r.mine?'':'<span class="qtag">· '+esc(X.quickShared)+'</span>')+'</b><span>'+esc(r.text||(r.media&&r.media.name)||"")+'</span></div>'+(r.media&&r.media.type==="image"?'<img src="'+esc(quickUrl(r))+'" alt="" loading="lazy">':'')+'</div></button>'}).join("")+'<p>'+esc(X.quickHint)+'</p>'+editBtn():'<p>'+esc(X.quickEmpty)+'</p>'+editBtn();
  var eb=m.querySelector("[data-qedit]");if(eb)eb.onmousedown=function(e){e.preventDefault();hideQuick();openQuickEditor()};
  [].forEach.call(m.querySelectorAll("[data-qi]"),function(b){b.onmousedown=function(e){e.preventDefault();pickQuick(QM.items[Number(b.getAttribute("data-qi"))])}})}
function editBtn(){return '<button type="button" class="qedit-btn" data-qedit="1">✏️ '+esc(X.quickEdit)+'</button>'}
// Kişisel hazır cevap düzenleyici
var QE=[];
function openQuickEditor(){QE=(S.quickMine||[]).map(function(r){return {key:r.key,text:r.text,media:r.media}});
  $("#qeTitle").textContent=X.quickMineTitle;$("#qeHint").textContent=X.quickMineHint;$("#qeClose").textContent=X.close;$("#qeAdd").textContent="+ "+X.quickAdd;$("#qeSave").textContent=X.quickSave;
  $("#qeShared").innerHTML=(S.quickShared||[]).length?'<h3>'+esc(X.quickSharedTitle)+'</h3><div class="qshared">'+S.quickShared.map(function(r){return '<div><b>/'+esc(r.key)+'</b> '+(r.media?'📎 ':'')+esc(r.text||(r.media&&r.media.name)||"")+'</div>'}).join("")+'</div>':"";
  drawQE();$("#qedit").hidden=false;if(!QE.length)addQE()}
function drawQE(){var L=$("#qeList");
  L.innerHTML=QE.length?QE.map(function(r,i){return '<div class="qer"><input data-ek="'+i+'" maxlength="24" placeholder="'+esc(X.quickKey)+'" value="'+esc(r.key)+'"><textarea data-et="'+i+'" maxlength="1000" placeholder="'+esc(X.quickText)+'">'+esc(r.text)+'</textarea><div class="qf">'
    +(r.media?(r.media.type==="image"?'<img src="'+esc(quickUrl(r))+'" alt="">':'<span>📎</span>')+'<span class="nm" title="'+esc(r.media.name)+'">'+esc(r.media.name)+'</span><button type="button" class="btn ghost" data-erm="'+i+'">'+esc(X.qattRemove)+'</button>'
      :'<button type="button" class="btn" data-eup="'+i+'">🖼 '+esc(X.quickFile)+'</button><span>'+esc(X.quickFileHint)+'</span>')
    +'<input type="file" data-efile="'+i+'" hidden accept="image/*,video/*,application/pdf"></div><button type="button" class="btn ghost" data-edel="'+i+'">'+esc(X.quickDel)+'</button></div>'}).join(""):'<p class="qshared">'+esc(X.quickNone)+'</p>';
  [].forEach.call(L.querySelectorAll("[data-ek]"),function(e){e.oninput=function(){QE[+e.getAttribute("data-ek")].key=e.value}});
  [].forEach.call(L.querySelectorAll("[data-et]"),function(e){e.oninput=function(){QE[+e.getAttribute("data-et")].text=e.value}});
  [].forEach.call(L.querySelectorAll("[data-edel]"),function(b){b.onclick=function(){QE.splice(+b.getAttribute("data-edel"),1);drawQE()}});
  [].forEach.call(L.querySelectorAll("[data-erm]"),function(b){b.onclick=function(){delete QE[+b.getAttribute("data-erm")].media;drawQE()}});
  [].forEach.call(L.querySelectorAll("[data-eup]"),function(b){b.onclick=function(){L.querySelector('[data-efile="'+b.getAttribute("data-eup")+'"]').click()}});
  [].forEach.call(L.querySelectorAll("[data-efile]"),function(inp){inp.onchange=function(){var f=inp.files[0],i=+inp.getAttribute("data-efile");if(!f)return;
    if(f.size>16*1024*1024){toast(X.tooBig,true);return}
    var b=L.querySelector('[data-eup="'+i+'"]');if(b){b.disabled=true;b.textContent=X.uploading}
    fetch("/b24/chat/quick/upload",{method:"POST",headers:{"x-xre-ticket":C.t,"content-type":f.type||"application/octet-stream","x-file-name":encodeURIComponent(f.name)},body:f})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok)throw new Error(j.message||X.error);return j})})
      .then(function(j){QE[i].media=j.media;S.quickMine=S.quickMine||[];drawQE();toast(X.uploaded)}).catch(function(e){toast(e.message,true);drawQE()})}})}
function addQE(){QE.push({key:"",text:""});drawQE();var ins=$("#qeList").querySelectorAll("[data-ek]");if(ins.length)ins[ins.length-1].focus()}
$("#qeAdd").onclick=addQE;
$("#qeClose").onclick=function(){$("#qedit").hidden=true};
$("#qedit").onclick=function(e){if(e.target.id==="qedit")$("#qedit").hidden=true};
$("#qeSave").onclick=function(){var btn=$("#qeSave");btn.disabled=true;
  api("quick/save",{items:QE.filter(function(r){return (r.key||"").trim()&&((r.text||"").trim()||r.media)})}).then(function(d){S.quick=d.quick;S.quickMine=d.quickMine;S.quickShared=d.quickShared;$("#qedit").hidden=true;toast(X.quickSaved)}).catch(function(e){toast(e.message,true)}).then(function(){btn.disabled=false})};
function hideQuick(){var m=$("#quickMenu");if(m)m.hidden=true;QM.slash=false}
function quickUrl(r){return "/b24/chat/quick-media/"+encodeURIComponent(r.media.id)+"?t="+encodeURIComponent(C.t)}
function pickQuick(r){if(!r)return;var ta=$("#txt");ta.value=QM.slash||!ta.value.trim()?r.text:ta.value.replace(/\s*$/,"")+"\n"+r.text;hideQuick();if(r.media){S.qatt=r;drawAtt()}ta.focus();ta.style.height="auto";ta.style.height=Math.min(160,ta.scrollHeight)+"px"}
function drawAtt(){var a=$("#qatt");if(!a)return;var r=S.qatt;a.hidden=!r;if(!r){a.innerHTML="";return}
  a.innerHTML=(r.media.type==="image"?'<img src="'+esc(quickUrl(r))+'" alt="">':'<span aria-hidden="true">📎</span>')+'<b>'+esc(r.media.name||r.key)+'</b><button type="button" id="qattX" title="'+esc(X.qattRemove)+'" aria-label="'+esc(X.qattRemove)+'">✕</button>';
  $("#qattX").onclick=function(){S.qatt=null;drawAtt()}}
document.addEventListener("click",function(e){var m=$("#quickMenu");if(m&&!m.hidden&&!m.contains(e.target)&&e.target.id!=="bQuick")hideQuick()});
function bubble(m){
  var media="";
  if(m.media&&m.media.id){var u=mediaUrl(m),ty=m.media.type;
    media=ty==="image"?'<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'['+esc(X.expired)+']\'))"></a>':ty==="audio"?'<audio controls preload="none" src="'+esc(u)+'"></audio>':ty==="video"?'<video controls preload="none" src="'+esc(u)+'"></video>':'<a href="'+esc(u)+'" target="_blank" rel="noopener">📎 '+esc(m.media.name||X.file)+'</a><br>'}
  var by=m.dir==="out"?(m.by==="ai"?"🤖 "+X.ai:m.via==="phone"?"📱 "+X.viaPhone:(m.byName||"")):(m.senderName||m.sender||"");
  var body=m.dir==="out"&&m.original?esc(m.original)+'<span class="tr"><i>'+esc(X.sentAs)+':</i> '+esc(m.text)+'</span>':esc(m.text)+(m.translation?'<span class="tr"><i>'+esc(X.translated)+':</i> '+esc(m.translation)+'</span>':'');
  return '<div class="b '+m.dir+'">'+media+body+'<span class="meta">'+(by?esc(by)+" · ":"")+esc(hm(m.at))+'</span></div>'}
function loadMessages(scroll){if(!S.cur)return Promise.resolve();var cur=S.cur;
  return api("messages",{line:cur.line,phone:cur.phone}).then(function(d){if(S.cur!==cur)return;if(d.name&&!cur.name){cur.name=d.name;$("#hn").textContent=d.name}
    var lm=d.messages[d.messages.length-1],sig=d.messages.length+":"+(lm?lm.at+":"+(lm.waId||""):"");if(sig===S.count)return;S.count=sig;var box=$("#msgs"),atEnd=box.scrollHeight-box.scrollTop-box.clientHeight<60,last="";
    box.innerHTML=d.messages.length?d.messages.map(function(m){var dd=dayOf(m.at),h=dd!==last?'<div class="day">'+esc(dd)+'</div>':"";last=dd;return h+bubble(m)}).join(""):'<div class="blank">'+esc(C.mode==="card"?X.cardStart:X.empty)+'</div>';
    if(scroll||atEnd)box.scrollTop=box.scrollHeight}).catch(function(e){toast(e.message,true)})}
function send(){var ta=$("#txt"),text=ta.value.trim(),att=S.qatt;if((!text&&!att)||!S.cur)return;var btn=$("#sendBtn");btn.disabled=true;
  (att?api("send-quick",{line:S.cur.line,phone:S.cur.phone,key:att.key,text:text}).then(function(r){S.qatt=null;drawAtt();return r}):api("send",{line:S.cur.line,phone:S.cur.phone,text:text})).then(function(){ta.value="";ta.style.height="auto";return loadMessages(true).then(loadThreads)}).catch(function(e){toast(e.message,true)}).then(function(){btn.disabled=false;ta.focus()})}

loadThreads();
setInterval(function(){if(document.hidden)return;loadThreads();loadMessages(false)},5000);
})();
`;
