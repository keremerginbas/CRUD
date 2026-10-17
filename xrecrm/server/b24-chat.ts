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
import { readMedia } from "./whatsapp-media.js";
import { normalizePhone } from "./security.js";
import {
  CHAT_KIND,
  SYSTEM_OWNER,
  b24Call,
  evolution,
  loadChat,
  page,
  portalById,
  portalSettings,
  portalUsers,
  readBitrixParams,
  readTicket,
  recordOutbound,
  roleAllows,
  roleOf,
  settingsTicket,
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
  via?: "bitrix" | "xre" | "ai";
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
export const CARD_TABS_VERSION = 1;

/** Kart sekmelerini Bitrix'e kaydeder; kaydedilemeyenler için uyarı döndürür. */
export async function bindCardTabs(store: Store, portal: B24Portal, base: string): Promise<string[]> {
  const warnings: string[] = [];
  let ok = 0;
  for (const placement of CARD_PLACEMENTS) {
    try {
      await b24Call(store, portal, "placement.bind", {
        PLACEMENT: placement,
        HANDLER: `${base}/b24/card`,
        TITLE: "XRE WhatsApp Chat",
        LANG_ALL: { tr: { TITLE: "XRE WhatsApp Sohbet" }, en: { TITLE: "XRE WhatsApp Chat" } },
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

type Ctx = { portal: B24Portal; viewer: Viewer; lines: string[] };
const fail = (status: number, message: string) => {
  throw Object.assign(new Error(message), { statusCode: status });
};

export function registerChatRoutes(app: Express, store: Store) {
  const json = express.json({ limit: "32kb" });

  const withViewer =
    (fn: (ctx: Ctx, body: any, req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const viewer = viewerOf(req.body?.t ?? req.query.t);
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
      const only = Array.isArray(body.phones) ? new Set(body.phones.map(toWa).filter(Boolean)) : null;
      const chats = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER))
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
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, 300);
      const lines = ctx.lines.map((line) => ({ line, name: lineName(ctx.portal, line), phone: ctx.portal.lines[line].phone || "", connected: ctx.portal.lines[line].status === "connected" }));
      return { threads: chats, lines, admin: ctx.viewer.admin };
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
      const info = ctx.portal.lines[chat.line];
      const lang = langOf(ctx.portal);
      let text = String(body.text || "").replace(/\r/g, "").trim().slice(0, 4000);
      if (!text) fail(400, "Mesaj boş olamaz.");
      if (info.status !== "connected" || !info.instance) fail(409, "Bu numara şu an WhatsApp'a bağlı değil.");
      if (!(await lineUsable(store, ctx.portal, chat.line))) fail(402, "Bu numaranın lisans süresi doldu.");
      // "!" ile başlayan mesaj çevrilmez; aksi halde müşterinin diline çevrilir.
      const raw = text.startsWith("!");
      if (raw) text = text.slice(1).trim();
      const original = text;
      if (!raw && portalSettings(ctx.portal).translate && chat.lang && chat.lang !== lang) {
        try {
          text = await translateTo(text, chat.lang, lang);
        } catch (error) {
          console.warn("Cevap çevrilemedi, olduğu gibi gönderiliyor:", (error as Error).message);
        }
      }
      const result = await evolution(`/message/sendText/${encodeURIComponent(info.instance)}`, {
        method: "POST",
        body: JSON.stringify({ number: chat.phone, text, linkPreview: true }),
      });
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
  },
};

export function chatHtml(ticket: string, lang: Lang, ctx: { mode: "inbox" | "card"; phones?: string[]; title?: string }) {
  const cfg = { t: ticket, lang, mode: ctx.mode, phones: ctx.phones || [], title: ctx.title || "", txt: TEXT[lang] };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XRE WhatsApp</title>
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
@media (max-width:720px){
  .app,.app.card{grid-template-columns:1fr}
  .app.open .side{display:none}.app:not(.open) .pane{display:none}
  .backbtn{display:inline-flex}
}
</style></head><body>
<div class="app${ctx.mode === "card" ? " card" : ""}" id="app">
  <aside class="side">
    <header><h1 id="ttl"></h1><button class="btn primary" id="newBtn"></button></header>
    <div class="tools"><input id="q" type="search"><select id="lineFilter"></select><div class="chips" id="chips"></div></div>
    <div class="list" id="list" role="list"></div>
    <form class="newform" id="newForm" hidden></form>
  </aside>
  <section class="pane" id="pane"><div class="blank" id="blank"></div></section>
</div>
<div class="toast" id="toast" role="status"></div>
<script>window.XRE_CHAT=${JSON.stringify(cfg).replace(/</g, "\\u003c")};</script>
<script>${CHAT_JS}</script>
</body></html>`;
}

const CHAT_JS = String.raw`
(function(){
var C=window.XRE_CHAT,X=C.txt,$=function(s){return document.querySelector(s)};
var S={threads:[],lines:[],cur:null,filter:"all",line:"",q:"",count:-1};
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function phone(p){p=String(p||"");return p?"+"+p.replace(/^(\d{2})(\d{3})(\d{3})(\d{2})(\d{2})$/,"$1 $2 $3 $4 $5"):""}
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
$("#chips").innerHTML='<button data-f="all" aria-pressed="true">'+esc(X.all)+'</button><button data-f="waiting" aria-pressed="false">'+esc(X.waiting)+'</button>';
$("#chips").onclick=function(e){var f=e.target.getAttribute("data-f");if(!f)return;S.filter=f;[].forEach.call($("#chips").children,function(b){b.setAttribute("aria-pressed",String(b.getAttribute("data-f")===f))});renderList()};
$("#q").oninput=function(e){S.q=e.target.value.toLowerCase();renderList()};
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
function renderList(){
  var v=visible();
  $("#list").innerHTML=v.length?v.map(function(t){var cur=S.cur&&S.cur.line===t.line&&S.cur.phone===t.phone;
    return '<button class="item" role="listitem" data-l="'+esc(t.line)+'" data-p="'+esc(t.phone)+'" aria-current="'+cur+'"><span class="avatar" aria-hidden="true">'+esc(initials(t.name||t.phone))+'</span><span style="min-width:0"><span class="nm">'+esc(t.name||phone(t.phone))+'</span><span class="ls">'+esc(t.lastText)+'</span>'
      +(t.waiting?'<span class="tag">'+esc(X.waitingTag)+'</span> ':'')+(S.lines.length>1?'<span class="tag ln">'+esc(t.lineName)+'</span>':'')+'</span><time>'+esc(when(t.lastAt))+'</time></button>'}).join("")
    :'<div class="blank">'+esc(S.lines.length?X.empty:X.noAccess)+'</div>';
  [].forEach.call(document.querySelectorAll(".item"),function(b){b.onclick=function(){var t=S.threads.find(function(x){return x.line===b.getAttribute("data-l")&&x.phone===b.getAttribute("data-p")});if(t)open(t)}});
}
function loadThreads(){return api("threads",C.mode==="card"?{phones:C.phones}:{}).then(function(d){
  S.threads=d.threads;var first=!S.lines.length;S.lines=d.lines;
  if(first){$("#lineFilter").innerHTML='<option value="">'+esc(X.allLines)+'</option>'+S.lines.map(function(l){return '<option value="'+esc(l.line)+'">'+esc(l.name)+(l.connected?"":" ("+esc(X.notConnected)+")")+'</option>'}).join("");$("#lineFilter").hidden=S.lines.length<2;
    if(!S.lines.some(function(l){return l.connected}))$("#newBtn").hidden=true;
    if(C.mode==="card"){if(S.threads.length)open(S.threads[0]);else blankCard()}}
  renderList()}).catch(function(e){$("#list").innerHTML='<div class="blank">'+esc(e.message)+'</div>'})}
function blankCard(){
  var l=S.lines.find(function(x){return x.connected});
  $("#newForm").hidden=false;renderNew();
  if(C.phones.length&&l){open({line:l.line,phone:C.phones[0],name:C.title,lineName:l.name})}
  else $("#blank").textContent=C.phones.length?X.noAccess:X.cardNoPhone;
}

function open(t){
  S.cur={line:t.line,phone:t.phone,name:t.name,lineName:t.lineName};S.count=-1;$("#app").classList.add("open");renderList();
  $("#pane").innerHTML='<header><button class="btn ghost backbtn" id="back">← '+esc(X.back)+'</button><span class="avatar" aria-hidden="true">'+esc(initials(t.name||t.phone))+'</span><div class="who"><b id="hn">'+esc(t.name||phone(t.phone))+'</b><span>'+esc(phone(t.phone))+(t.lineName?" · "+esc(t.lineName):"")+'</span></div></header>'
    +'<div class="msgs" id="msgs" aria-live="polite"><div class="blank">'+esc(X.load)+'</div></div>'
    +'<form class="composer" id="cmp"><div class="row1"><textarea id="txt" rows="1" placeholder="'+esc(X.placeholder)+'"></textarea><button class="btn primary" id="sendBtn">'+esc(X.send)+'</button></div><small>'+esc(X.hint)+'</small></form>';
  $("#back").onclick=function(){$("#app").classList.remove("open")};
  var ta=$("#txt");ta.oninput=function(){ta.style.height="auto";ta.style.height=Math.min(160,ta.scrollHeight)+"px"};
  ta.onkeydown=function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};
  $("#cmp").onsubmit=function(e){e.preventDefault();send()};
  ta.focus();loadMessages(true);
}
function bubble(m){
  var media="";
  if(m.media&&m.media.id){var u=mediaUrl(m),ty=m.media.type;
    media=ty==="image"?'<a href="'+esc(u)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'['+esc(X.expired)+']\'))"></a>':ty==="audio"?'<audio controls preload="none" src="'+esc(u)+'"></audio>':ty==="video"?'<video controls preload="none" src="'+esc(u)+'"></video>':'<a href="'+esc(u)+'" target="_blank" rel="noopener">📎 '+esc(m.media.name||X.file)+'</a><br>'}
  var by=m.dir==="out"?(m.by==="ai"?"🤖 "+X.ai:(m.byName||"")):(m.senderName||m.sender||"");
  var body=m.dir==="out"&&m.original?esc(m.original)+'<span class="tr"><i>'+esc(X.sentAs)+':</i> '+esc(m.text)+'</span>':esc(m.text)+(m.translation?'<span class="tr"><i>'+esc(X.translated)+':</i> '+esc(m.translation)+'</span>':'');
  return '<div class="b '+m.dir+'">'+media+body+'<span class="meta">'+(by?esc(by)+" · ":"")+esc(hm(m.at))+'</span></div>'}
function loadMessages(scroll){if(!S.cur)return Promise.resolve();var cur=S.cur;
  return api("messages",{line:cur.line,phone:cur.phone}).then(function(d){if(S.cur!==cur)return;if(d.name&&!cur.name){cur.name=d.name;$("#hn").textContent=d.name}
    if(d.messages.length===S.count)return;S.count=d.messages.length;var box=$("#msgs"),atEnd=box.scrollHeight-box.scrollTop-box.clientHeight<60,last="";
    box.innerHTML=d.messages.length?d.messages.map(function(m){var dd=dayOf(m.at),h=dd!==last?'<div class="day">'+esc(dd)+'</div>':"";last=dd;return h+bubble(m)}).join(""):'<div class="blank">'+esc(C.mode==="card"?X.cardStart:X.empty)+'</div>';
    if(scroll||atEnd)box.scrollTop=box.scrollHeight}).catch(function(e){toast(e.message,true)})}
function send(){var ta=$("#txt"),text=ta.value.trim();if(!text||!S.cur)return;var btn=$("#sendBtn");btn.disabled=true;
  api("send",{line:S.cur.line,phone:S.cur.phone,text:text}).then(function(){ta.value="";ta.style.height="auto";return loadMessages(true).then(loadThreads)}).catch(function(e){toast(e.message,true)}).then(function(){btn.disabled=false;ta.focus()})}

loadThreads();
setInterval(function(){if(document.hidden)return;loadThreads();loadMessages(false)},5000);
})();
`;
