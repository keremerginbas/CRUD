// Bitrix24 pazar yeri uygulaması: "XRE WhatsApp" Açık Kanal bağlayıcısı.
//
// Her Bitrix portalı ayrı bir müşteridir (member_id). Uygulama kurulunca
// Bitrix İletişim Merkezi'ne "XRE WhatsApp" kanalı olarak kaydolur. Müşteri
// kanal ayarında QR okutur; o Açık Kanal için ayrı bir WhatsApp oturumu açılır.
//   WhatsApp → Evolution webhook → imconnector.send.messages → Bitrix sohbeti
//   Bitrix sohbeti → OnImConnectorMessageAdd → Evolution → WhatsApp
// CRM'in kendi çalışma alanından tamamen ayrıdır.
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { PANEL_STYLE, panelHtml } from "./b24-panel-html.js";
import { onCustomerMessage, registerAgentPanelRoutes, type AgentConfig } from "./b24-agent.js";
import { registerLivePanelRoutes, type ReportSettings } from "./b24-live.js";
import { CAMPAIGN_KIND, registerCampaignRoutes } from "./b24-campaigns.js";
import { langOf, localizeMessage, normLang, pick, type Lang } from "./b24-i18n.js";
import { alreadySent, appendThread, bindCardTabs, CARD_PLACEMENTS, CARD_TABS_VERSION, chatHtml, chatTicket, mergeLidChat, mergeThread, registerChatRoutes, THREAD_KIND, type ThreadMessage } from "./b24-chat.js";
import { logRestCall } from "./b24-restlog.js";
import { needsReply } from "./b24-reply.js";
import { registerLegalRoutes } from "./b24-legal.js";
import { adminHtml } from "./b24-admin-html.js";
import { getPricing, licenseForConnect, licenseState, lineUsable, notifyOwner, planOf, portalPlan, registerBillingPanelRoutes, requireFeature } from "./b24-billing.js";
import { aiConfigured, detectAndTranslate, languageName, qualificationComment, qualifyConversation, transcribe, translateTo, type Qualification } from "./b24-ai.js";
export { panelHtml };
import type { Store } from "./db.js";
import { evolutionBase, evolutionWebhookConfig, getEvolutionQr, HISTORY_EVENTS, jidPhone, setEvolutionWebhook } from "./integrations.js";
import { envConfigured, fetchWithTimeout, normalizePhone, readJsonResponse } from "./security.js";
import {
  captureEvolutionMedia,
  deleteMedia,
  isWaSystemMessage,
  MAX_MEDIA_BYTES,
  readMedia,
  saveMedia,
  sendEvolutionMedia,
  unwrapWaMessage,
  waContentKey,
  waMessageText,
} from "./whatsapp-media.js";

export const CONNECTOR_ID = "xre_whatsapp";
export const SYSTEM_OWNER = "b24-connector";
export const PORTAL_KIND = "b24-portal";
const INSTANCE_KIND = "b24-instance";
const INSTANCE_PREFIX = "b24-";
const env = (k: string) => process.env[k]?.trim() || "";

export interface B24Portal {
  id: string; // member_id
  domain: string;
  clientEndpoint: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  applicationToken?: string;
  installedAt: string;
  updatedAt: string;
  active: boolean;
  lines: Record<string, B24Line>;
  roles?: B24Role[];
  /** Bitrix kullanıcı kimliği → rol kimliği */
  assignments?: Record<string, string>;
  settings?: B24Settings;
  agent?: AgentConfig;
  reports?: ReportSettings;
  /** Bitrix kullanıcı kimliği → kişisel Google Meet oda bağlantısı */
  meetRooms?: Record<string, string>;
  /** Açık Kanal otomatik mesajlarının kapatıldığı sürüm */
  quietLines?: number;
  /** Kayıtlı CRM kart sekmelerinin sürümü */
  cardTabs?: number;
  /** Portalın kurulduğu Bitrix uygulamasının client_id'si (yoksa B24_CLIENT_ID). */
  clientId?: string;
  /** Arayüz ve sohbet notlarının dili (Bitrix LANG); yoksa Türkçe. */
  lang?: Lang;
  /** Uygulamayı kuran / açan Bitrix yöneticileri; lisans hatırlatmaları bunlara gider. */
  adminIds?: string[];
  /** Bitrix'e kaydedilen uygulama adresi (olay, kanal ayarı, kart sekmesi); değişince yeniden bağlanır. */
  baseUrl?: string;
  /** Sohbet ekranındaki hazır cevaplar (/kısayol) */
  quickReplies?: QuickReply[];
  /** "Kurulum yarım kaldı" hatırlatmasının gönderildiği zaman */
  onboardingNotified?: string;
}
export interface QuickReply {
  key: string;
  text: string;
  /** Cevapla birlikte gönderilen görsel / video / belge */
  media?: { id: string; name: string; mime: string; type: string };
}
/** Hazır cevap dosyalarının sahibi: sohbet medyası gibi süre dolunca silinmez. */
export const quickOwner = (memberId: string) => `b24q:${memberId}`;
/** Personelin kişisel hazır cevapları (yalnız kendisi görür) ve dosyalarının sahibi */
export const QUICK_USER_KIND = "b24-quick";
export const quickUserKey = (memberId: string, userId: string) => `${memberId}:${userId}`;
export const quickUserOwner = (memberId: string, userId: string) => `b24qu:${memberId}:${userId}`;
export interface UserQuickReplies {
  memberId: string;
  userId: string;
  items: QuickReply[];
}
export async function userQuickReplies(store: Store, memberId: string, userId: string): Promise<QuickReply[]> {
  return (await store.get<UserQuickReplies>(QUICK_USER_KIND, quickUserKey(memberId, userId), SYSTEM_OWNER))?.payload?.items || [];
}
export const QUICK_MAX = 100;
/** Hazır cevap dosyasını güvenli başlıklarla döndürür. */
export function sendQuickMedia(res: Response, media: { record: { mime: string; fileName: string }; buffer: Buffer }) {
  const inline = /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|3gpp))/.test(media.record.mime);
  res.setHeader("content-type", inline ? media.record.mime : "application/octet-stream");
  res.setHeader("content-disposition", `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(media.record.fileName)}"`);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", "sandbox; default-src 'none'");
  res.setHeader("cache-control", "private, max-age=3600");
  res.send(media.buffer);
}
/** Panelden gelen hazır cevapları temizler: kısayol harf/rakam, metin en fazla 1000 karakter. */
export function cleanQuickReplies(items: unknown): QuickReply[] {
  const seen = new Set<string>();
  const out: QuickReply[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = String((item as any)?.key || "")
      .trim()
      .replace(/^\//, "")
      .replace(/[Iİ]/g, "i")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^0-9a-zçğıöşü_-]/g, "")
      .slice(0, 24);
    const text = String((item as any)?.text || "").replace(/\r/g, "").trim().slice(0, 1000);
    const m = (item as any)?.media;
    const media = m && /^med_[a-f0-9]{24}$/.test(String(m.id || "")) ? { id: String(m.id), name: String(m.name || "").slice(0, 120), mime: String(m.mime || "").slice(0, 100), type: String(m.type || "").slice(0, 20) } : undefined;
    if (!key || (!text && !media) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text, ...(media ? { media } : {}) });
    if (out.length >= QUICK_MAX) break;
  }
  return out;
}
export interface B24Settings {
  translate?: boolean;
  transcribe?: boolean;
  qualify?: boolean;
  slaMinutes?: number;
  /** Bitrix Açık Kanal otomatik mesajları (karşılama, değerlendirme, kapanış) müşteriye gitsin mi? */
  botMessages?: boolean;
  /** Bekleyen sohbet alarmı (Pro) */
  alerts?: boolean;
  /** Bu kadar dakika cevapsız kalan sohbet numaranın personeline bildirilir */
  alertAgentMin?: number;
  /** Bu kadar dakika cevapsız kalan sohbet yöneticilere bildirilir */
  alertManagerMin?: number;
  /** Yönetici uyarısı Telegram'a da gitsin (Raporlar'da bağlanan bot ve sohbetler) */
  alertTelegram?: boolean;
  /** Yalnız mesai saatlerinde (AI Asistan sekmesindeki saatler) uyar */
  alertWorkHours?: boolean;
  /** Alarmın açıldığı an: öncesinde başlamış bekleyişler için uyarı gitmez */
  alertsSince?: number;
}
export function portalSettings(portal: B24Portal): Required<B24Settings> {
  return {
    translate: portal.settings?.translate !== false,
    transcribe: portal.settings?.transcribe !== false,
    qualify: portal.settings?.qualify !== false,
    slaMinutes: Math.max(1, Math.min(1440, Number(portal.settings?.slaMinutes) || 15)),
    botMessages: portal.settings?.botMessages === true,
    alerts: portal.settings?.alerts === true,
    alertAgentMin: clampMin(portal.settings?.alertAgentMin, 15),
    alertManagerMin: clampMin(portal.settings?.alertManagerMin, 30),
    alertTelegram: portal.settings?.alertTelegram !== false,
    alertWorkHours: portal.settings?.alertWorkHours !== false,
    alertsSince: Number(portal.settings?.alertsSince) || 0,
  };
}
const clampMin = (v: unknown, fallback: number) => Math.max(1, Math.min(1440, Math.round(Number(v) || fallback)));

/** Ayarlar, paketin açmadığı AI özellikleri kapalı olarak. */
export async function activeSettings(store: Store, portal: B24Portal): Promise<Required<B24Settings>> {
  const s = portalSettings(portal);
  const { features } = await planOf(store, portal);
  return { ...s, translate: s.translate && features.translate, transcribe: s.transcribe && features.transcribe, qualify: s.qualify && features.qualify };
}

/**
 * Bitrix'in Açık Kanal otomatik mesajları ("Açık Kanal'a hoş geldiniz",
 * sohbet değerlendirme, kapanış ve mesai dışı yanıtları) WhatsApp'ta müşteriye
 * gider. Varsayılan olarak bizim kanallarımızda kapatılır.
 */
export const QUIET_LINE_PARAMS = {
  WELCOME_MESSAGE: "N",
  VOTE_MESSAGE: "N",
  AGREEMENT_MESSAGE: "N",
  CLOSE_RULE: "none",
  AUTO_CLOSE_RULE: "none",
  NO_ANSWER_RULE: "none",
  WORKTIME_DAYOFF_RULE: "none",
};
export const QUIET_LINES_VERSION = 1;
export async function applyLineAutoMessages(store: Store, portal: B24Portal, lines = Object.keys(portal.lines)): Promise<string[]> {
  const on = portalSettings(portal).botMessages;
  const params = on ? { WELCOME_MESSAGE: "Y", VOTE_MESSAGE: "Y" } : QUIET_LINE_PARAMS;
  const warnings: string[] = [];
  for (const line of lines) {
    try {
      await b24Call(store, portal, "imopenlines.config.update", { CONFIG_ID: line, PARAMS: params });
    } catch (error) {
      warnings.push(`${portal.lines[line]?.name || line}: ${(error as Error).message}`);
    }
  }
  return warnings;
}

// --- Sohbet durumu ve istatistik ---------------------------------------------

export const CHAT_KIND = "b24-chat";
export const STAT_KIND = "b24-stat";
export interface B24Chat {
  id: string;
  memberId: string;
  line: string;
  phone: string;
  name: string;
  lang?: string;
  waitingSince?: number | null;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  inbound: number;
  outbound: number;
  sinceQualify: number;
  history: { from: "müşteri" | "temsilci" | "asistan"; text: string; at: number }[];
  qualification?: Qualification & { at: number };
  createdAt?: number;
  /** AI asistan durumu: temsilci yazdıysa "human", devredildiyse "handoff" */
  agentState?: "human" | "handoff";
  humanAt?: number;
  aiReplies?: number;
  /** Bekleyen sohbet alarmı: hangi bekleme için hangi kademe gönderildi */
  alert?: { since: number; level: number };
}
const chatId = (memberId: string, line: string, phone: string) => `${memberId}:${line}:${phone}`;
export async function loadChat(store: Store, memberId: string, line: string, phone: string, name = ""): Promise<B24Chat> {
  const id = chatId(memberId, line, phone);
  const found = (await store.get<B24Chat>(CHAT_KIND, id, SYSTEM_OWNER))?.payload;
  return found || { id, memberId, line, phone, name, inbound: 0, outbound: 0, sinceQualify: 0, history: [] };
}
// WhatsApp gizli kimliği (…@lid) → gerçek numara eşleştirmesi (hat başına).
export const LID_KIND = "b24-lid";
const lidKey = (memberId: string, line: string, lid: string) => `${memberId}:${line}:${lid}`;
export async function lidPhone(store: Store, memberId: string, line: string, lid: string): Promise<string> {
  return (await store.get<{ phone: string }>(LID_KIND, lidKey(memberId, line, lid), SYSTEM_OWNER))?.payload?.phone || "";
}
export async function saveLidPhone(store: Store, memberId: string, line: string, lid: string, phone: string) {
  await store.put(LID_KIND, lidKey(memberId, line, lid), { memberId, line, lid, phone }, SYSTEM_OWNER);
}

/**
 * Son çare: aynı hatta son 12 saatte yazılmış ve henüz cevap gelmemiş TEK bir sohbet
 * varsa gizli kimlikli cevap ona aittir. Birden fazla aday varsa tahmin edilmez.
 */
export async function guessLidPhone(store: Store, memberId: string, line: string, lid: string): Promise<string> {
  if ((await store.get<B24Chat>(CHAT_KIND, chatId(memberId, line, lid), SYSTEM_OWNER))?.payload) return ""; // bu kimlikle zaten sohbet var
  const since = Date.now() - 12 * 3_600_000;
  const candidates = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER))
    .map((r) => r.payload)
    .filter((c) => c.memberId === memberId && c.line === line && /^\d+$/.test(c.phone) && (c.lastOutboundAt || 0) > since && (c.lastInboundAt || 0) < (c.lastOutboundAt || 0));
  if (candidates.length !== 1) return "";
  await saveLidPhone(store, memberId, line, lid, candidates[0].phone);
  return candidates[0].phone;
}

export async function saveChat(store: Store, chat: B24Chat) {
  chat.history = chat.history.slice(-40);
  await store.put(CHAT_KIND, chat.id, chat, SYSTEM_OWNER);
}
export const istanbulDay = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(t));
export interface DayStat {
  id: string;
  memberId: string;
  day: string;
  agents: Record<string, { replies: number; responses: number; responseSec: number; maxSec: number }>;
  lines: Record<string, { inbound: number; outbound: number; newChats: number; responses?: number; responseSec?: number; samples?: number[] }>;
  /** Gelen mesajların saatlere dağılımı (İstanbul saati) */
  hours?: number[];
  lineHours?: Record<string, number[]>;
}
const istanbulHour = (t = Date.now()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
export async function bumpStat(store: Store, memberId: string, fn: (s: DayStat) => void) {
  const day = istanbulDay();
  const id = `${memberId}:${day}`;
  const stat = (await store.get<DayStat>(STAT_KIND, id, SYSTEM_OWNER))?.payload || { id, memberId, day, agents: {}, lines: {} };
  fn(stat);
  await store.put(STAT_KIND, id, stat, SYSTEM_OWNER);
}
const lineStat = (s: DayStat, line: string) => (s.lines[line] ||= { inbound: 0, outbound: 0, newChats: 0 });
function recordInbound(s: DayStat, line: string) {
  const h = istanbulHour();
  (s.hours ||= Array.from({ length: 24 }, () => 0))[h] += 1;
  ((s.lineHours ||= {})[line] ||= Array.from({ length: 24 }, () => 0))[h] += 1;
}
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};
const agentStat = (s: DayStat, agent: string) => (s.agents[agent] ||= { replies: 0, responses: 0, responseSec: 0, maxSec: 0 });

/** Sohbeti nitelendirip Bitrix'teki lead (yoksa kişi) kartının zaman akışına yazar. */
async function qualifyChat(store: Store, portal: B24Portal, chat: B24Chat) {
  const lang = langOf(portal);
  const q = await qualifyConversation(chat.history.map(({ from, text }) => ({ from, text })), lang);
  if (!q) return;
  chat.qualification = { ...q, at: Date.now() };
  chat.sinceQualify = 0;
  await saveChat(store, chat);
  const found = await b24Call(store, portal, "crm.duplicate.findbycomm", { entity_type: "LEAD", type: "PHONE", values: [`+${chat.phone}`] }).catch(() => null);
  let entityType = "lead";
  let ids: unknown[] = Array.isArray(found?.LEAD) ? found.LEAD : [];
  if (!ids.length) {
    const contacts = await b24Call(store, portal, "crm.duplicate.findbycomm", { entity_type: "CONTACT", type: "PHONE", values: [`+${chat.phone}`] }).catch(() => null);
    ids = Array.isArray(contacts?.CONTACT) ? contacts.CONTACT : [];
    entityType = "contact";
  }
  const entityId = Number(ids[ids.length - 1]);
  if (!entityId) return;
  await b24Call(store, portal, "crm.timeline.comment.add", { fields: { ENTITY_ID: entityId, ENTITY_TYPE: entityType, COMMENT: qualificationComment(q, lang) } });
  if (entityType === "lead" && q.budget && ["TRY", "USD", "EUR", "GBP"].includes(q.currency))
    await b24Call(store, portal, "crm.lead.update", { id: entityId, fields: { OPPORTUNITY: q.budget, CURRENCY_ID: q.currency } }).catch(() => undefined);
}
export interface B24LineOptions {
  /** WhatsApp aramaları sohbete not olarak düşsün */
  calls?: boolean;
  /** Grup sohbetleri Açık Kanal'a aktarılsın */
  groups?: boolean;
  /** Silinen ve düzenlenen mesajlar sohbette gösterilsin */
  edits?: boolean;
}
export const lineOptions = (l?: B24Line): Required<B24LineOptions> => ({
  calls: l?.options?.calls !== false,
  groups: l?.options?.groups === true,
  edits: l?.options?.edits !== false,
});
export interface B24License {
  /** Deneme, numara ilk bağlandığında başlar. */
  trialStart?: string;
  /** Deneme başladığında geçerli olan süre (gün); eski kayıtlarda yoktur. */
  trialDays?: number;
  paidUntil?: string;
  /** Ödenen paket; eski lisanslarda yoktur ve Pro+ sayılır. */
  plan?: "basic" | "pro" | "proplus";
  /** Gönderilen hatırlatmalar (aynı bitiş için bir kez): deneme başlangıcı / lisans bitişi */
  notified?: { trial?: string; paid?: string; expired?: string };
}
export interface B24Line {
  instance: string;
  license?: B24License;
  options?: B24LineOptions;
  connectedAt?: string;
  name?: string;
  phone?: string;
  profileName?: string;
  status: string;
  updatedAt: string;
}
export interface B24Role {
  id: string;
  name: string;
  /** Erişilebilen Açık Kanal numaraları; "all" tüm bağlantılar. */
  lines: string[] | "all";
  isDefault?: boolean;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<any>;
// Bitrix hata durumunda da (401/403/400) JSON gövdesinde nedeni döndürür
// ({error, error_description}); gövde okunmazsa neden kaybolur ve süresi dolan
// anahtar yenilenemez. Bu yüzden Bitrix hata gövdeleri b24Call'a olduğu gibi verilir.
const defaultFetch: Fetcher = async (url, init) => {
  const response = await fetchWithTimeout(url, init, 20_000);
  if (!response.ok) {
    const body = await response.clone().json().catch(() => null);
    if (body && typeof body.error === "string") return body;
  }
  return readJsonResponse(response);
};
let fetcher: Fetcher = defaultFetch;
/** Testler için Bitrix REST/OAuth çağrılarını değiştirir. */
export function setB24Fetch(next: Fetcher | null) {
  fetcher = next || defaultFetch;
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const cleanDomain = (v: unknown) =>
  String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const memberIdOk = (v: string) => /^[a-zA-Z0-9_]{6,64}$/.test(v);

function secret() {
  const value = env("XRE_SESSION_SECRET") || env("JWT_SECRET");
  if (!value) throw Object.assign(new Error("Oturum sırrı tanımlı değil."), { statusCode: 503 });
  return value;
}
function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}
/** Ayar sayfası için kısa ömürlü bilet: portal + açık kanal. */
export function settingsTicket(memberId: string, line: string, ttlSeconds = 2 * 60 * 60) {
  const payload = `${memberId}.${line}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return `${payload}.${sign(`ticket:${payload}`)}`;
}
export function readTicket(ticket: unknown): { memberId: string; line: string } | null {
  const parts = String(ticket || "").split(".");
  if (parts.length !== 4) return null;
  const [memberId, line, exp, mac] = parts;
  const expected = sign(`ticket:${memberId}.${line}.${exp}`);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return { memberId, line };
}
/** Bitrix'in gelen medyayı indirmesi için imzalı, süreli adres. */
function mediaUrl(origin: string, memberId: string, mediaId: string) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  return `${origin}/b24/media/${memberId}/${mediaId}?e=${exp}&s=${sign(`media:${memberId}:${mediaId}:${exp}`)}`;
}

export const instanceName = (memberId: string, line: string) =>
  `${INSTANCE_PREFIX}${crypto.createHash("sha256").update(memberId).digest("hex").slice(0, 10)}-${String(line).replace(/\D/g, "")}`;
export const isConnectorInstance = (instance: unknown) => String(instance || "").startsWith(INSTANCE_PREFIX);

function origin(req?: Request) {
  const configured = env("PUBLIC_ORIGIN").replace(/\/$/, "");
  if (configured) return configured;
  if (!req) return "";
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0];
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

// --- Bitrix REST -------------------------------------------------------------

/**
 * Uygulama anahtarları. Aynı sunucu iki Bitrix uygulamasına hizmet edebilir:
 * kendi portalımızdaki yerel uygulama (B24_CLIENT_ID) ve pazar yeri uygulaması
 * (B24_MARKET_CLIENT_ID). Her portal hangi uygulamayla kurulduysa onun
 * anahtarıyla yenilenir.
 */
export function appCredentials(): { id: string; secret: string }[] {
  return [
    { id: env("B24_CLIENT_ID"), secret: env("B24_CLIENT_SECRET") },
    { id: env("B24_MARKET_CLIENT_ID"), secret: env("B24_MARKET_CLIENT_SECRET") },
  ].filter((c, i, all) => c.id && c.secret && all.findIndex((x) => x.id === c.id) === i);
}
const noCredentials = () => Object.assign(new Error("Sunucuda B24_CLIENT_ID / B24_CLIENT_SECRET tanımlı değil."), { statusCode: 503 });
const tokenUrl = (cred: { id: string; secret: string }, refreshToken: string) =>
  `https://oauth.bitrix.info/oauth/token/?${new URLSearchParams({ grant_type: "refresh_token", client_id: cred.id, client_secret: cred.secret, refresh_token: refreshToken })}`;

async function refresh(store: Store, portal: B24Portal): Promise<B24Portal> {
  const creds = appCredentials();
  if (!creds.length) throw noCredentials();
  const cred = creds.find((c) => c.id === portal.clientId) || creds[0];
  const url = tokenUrl(cred, portal.refreshToken);
  const data = await fetcher(url, { method: "GET" });
  if (!data?.access_token) throw new Error(`Bitrix belirteci yenilenemedi: ${data?.error_description || data?.error || "bilinmiyor"}`);
  const next: B24Portal = {
    ...portal,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || portal.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    clientEndpoint: data.client_endpoint || portal.clientEndpoint,
    updatedAt: new Date().toISOString(),
  };
  await store.put(PORTAL_KIND, portal.id, next, SYSTEM_OWNER);
  return next;
}

/** Portal adına Bitrix REST çağrısı; süresi dolan belirteci bir kez yeniler. */
const scopeOf = (method: string) => {
  const head = method.split(".")[0];
  return { im: "im: Chat and notifications", imopenlines: "imopenlines: Open Channels", imconnector: "imconnector", crm: "crm: CRM", placement: "placement", user: "user" }[head] || head;
};

export async function b24Call(store: Store, portalIn: B24Portal, method: string, params: Record<string, unknown> = {}) {
  let portal = portalIn;
  if (portal.expiresAt && portal.expiresAt < Date.now() + 60_000 && portal.refreshToken) portal = await refresh(store, portal);
  const call = (p: B24Portal) =>
    fetcher(`${p.clientEndpoint.replace(/\/?$/, "/")}${method}.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...params, auth: p.accessToken }),
    }).catch((error) => ({ error: "HTTP", error_description: error instanceof Error ? error.message : String(error) }));
  const started = Date.now();
  let data = await call(portal);
  if ((data?.error === "expired_token" || data?.error === "invalid_token") && portal.refreshToken) {
    portal = await refresh(store, portal);
    data = await call(portal);
  }
  logRestCall({
    domain: portal.domain,
    memberId: portal.id,
    method,
    params,
    ms: Date.now() - started,
    ok: !data?.error,
    error: data?.error ? `${data.error}: ${data.error_description || ""}` : undefined,
    result: data?.error ? undefined : data?.result,
  });
  if (data?.error === "insufficient_scope" || data?.error === "ACCESS_DENIED")
    throw new Error(`Bitrix ${method}: uygulamanın bu işlem için izni yok (${scopeOf(method)}). Uygulama ayarlarında izni ekleyip uygulamayı yeniden açın.`);
  if (data?.error) throw new Error(`Bitrix ${method}: ${data.error_description || data.error}`);
  return data?.result;
}

export async function portalById(store: Store, memberId: string) {
  return (await store.get<B24Portal>(PORTAL_KIND, memberId, SYSTEM_OWNER))?.payload || null;
}
export async function savePortal(store: Store, portal: B24Portal) {
  await store.put(PORTAL_KIND, portal.id, { ...portal, updatedAt: new Date().toISOString() }, SYSTEM_OWNER);
}

// --- Evolution ---------------------------------------------------------------

export async function evolution(path: string, init: RequestInit = {}) {
  if (!envConfigured("EVOLUTION_API_URL", "EVOLUTION_API_KEY"))
    throw Object.assign(new Error("WhatsApp sunucusu yapılandırılmamış."), { statusCode: 503 });
  return readJsonResponse(
    await fetchWithTimeout(
      `${evolutionBase()}${path}`,
      { ...init, headers: { apikey: env("EVOLUTION_API_KEY"), "content-type": "application/json", ...(init.headers || {}) } },
      30_000,
    ),
  );
}
async function evolutionState(instance: string) {
  try {
    const data = await evolution(`/instance/connectionState/${encodeURIComponent(instance)}`);
    return String(data?.instance?.state || data?.state || "").toLowerCase();
  } catch {
    return "";
  }
}
async function evolutionOwnerPhone(instance: string) {
  try {
    const list = await evolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
    const item = (Array.isArray(list) ? list : []).map((i: any) => i?.instance || i).find((i: any) => (i?.name || i?.instanceName) === instance);
    return { phone: jidPhone(item?.ownerJid || item?.owner || ""), profileName: String(item?.profileName || "") };
  } catch {
    return { phone: "", profileName: "" };
  }
}

// --- Bağlayıcı işlemleri -----------------------------------------------------

const ICON_SVG =
  "data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2070%2071%22%3E%3Cpath%20fill%3D%22%23FFF%22%20d%3D%22M35%2012a23%2023%200%200%200-19.7%2034.9L12%2059l12.5-3.2A23%2023%200%201%200%2035%2012zm13.4%2032.6c-.6%201.6-3.3%203-4.6%203.2-1.2.2-2.7.3-4.4-.3a40%2040%200%200%201-4-1.5c-7-3-11.6-10-12-10.5-.3-.5-2.8-3.7-2.8-7.1s1.8-5%202.4-5.7c.6-.7%201.4-.9%201.8-.9h1.3c.4%200%201%200%201.5%201.2l2%204.8c.2.4.3.8%200%201.3-.2.5-.4.8-.7%201.2l-1.1%201.2c-.3.4-.7.8-.3%201.5.4.8%201.8%203%203.9%204.8%202.7%202.4%204.9%203.1%205.6%203.5.7.3%201.1.3%201.5-.2l1.9-2.3c.5-.6%201-.5%201.6-.3l4.7%202.2c.7.3%201.1.5%201.3.8.2.3.2%201.6-.4%203.2z%22/%3E%3C/svg%3E";

async function registerConnector(store: Store, portal: B24Portal, base: string) {
  await b24Call(store, portal, "imconnector.register", {
    ID: CONNECTOR_ID,
    NAME: "WhatsApp by XRE",
    ICON: { DATA_IMAGE: ICON_SVG, COLOR: "#25D366", SIZE: "90%", POSITION: "center" },
    ICON_DISABLED: { DATA_IMAGE: ICON_SVG, COLOR: "#9aa5b1", SIZE: "90%", POSITION: "center" },
    PLACEMENT_HANDLER: `${base}/b24/settings`,
  });
  for (const event of ["OnImConnectorMessageAdd", "OnImConnectorLineDelete", "OnImConnectorStatusDelete", "OnAppUninstall"]) {
    try {
      await b24Call(store, portal, "event.bind", { event, handler: `${base}/b24/events` });
    } catch (error) {
      if (!/already|binded|bound/i.test(String((error as Error).message))) throw error;
    }
  }
}

/**
 * Uygulama yeni adrese taşındıysa (PUBLIC_ORIGIN değişti) kurulu portallardaki Bitrix
 * kayıtlarını yeni adrese çevirir: eski olay ve kart sekmesi kayıtları kaldırılır,
 * yenileri eklenir, kanal ayar sayfası yeni adresle kaydedilir. Eski adres
 * B24_LEGACY_ORIGIN ile verilir (ilk taşımada portalda kayıtlı adres yoktur).
 */
export async function rebindPortal(store: Store, portal: B24Portal, base = origin()): Promise<boolean> {
  if (!base) return false;
  const old = (portal.baseUrl || env("B24_LEGACY_ORIGIN") || base).replace(/\/$/, "");
  if (old === base) {
    if (portal.baseUrl !== base) await savePortal(store, { ...((await portalById(store, portal.id)) || portal), baseUrl: base });
    return false;
  }
  for (const event of ["OnImConnectorMessageAdd", "OnImConnectorLineDelete", "OnImConnectorStatusDelete", "OnAppUninstall"])
    await b24Call(store, portal, "event.unbind", { event, handler: `${old}/b24/events` }).catch(() => undefined);
  for (const placement of CARD_PLACEMENTS)
    await b24Call(store, portal, "placement.unbind", { PLACEMENT: placement, HANDLER: `${old}/b24/card` }).catch(() => undefined);
  await registerConnector(store, portal, base);
  const warnings = await bindCardTabs(store, portal, base);
  await savePortal(store, { ...((await portalById(store, portal.id)) || portal), baseUrl: base, ...(warnings.length ? {} : { cardTabs: CARD_TABS_VERSION }) });
  console.info(`WhatsApp by XRE: ${portal.domain} Bitrix bağlantıları ${old} → ${base} adresine taşındı.`);
  return true;
}
/** Tüm etkin portalları yeni adrese taşır (açılışta bir kez). */
export async function rebindPortals(store: Store) {
  let moved = 0;
  for (const row of await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)) {
    if (!row.payload.active) continue;
    try {
      if (await rebindPortal(store, row.payload)) moved++;
    } catch (error) {
      console.warn(`WhatsApp by XRE: ${row.payload.domain} yeni adrese taşınamadı:`, (error as Error).message);
    }
  }
  return moved;
}

async function activateLine(store: Store, portal: B24Portal, line: string, active: boolean) {
  await b24Call(store, portal, "imconnector.activate", { CONNECTOR: CONNECTOR_ID, LINE: line, ACTIVE: active ? 1 : 0 });
  if (active) {
    const info = portal.lines[line];
    await b24Call(store, portal, "imconnector.connector.data.set", {
      CONNECTOR: CONNECTOR_ID,
      LINE: line,
      DATA: {
        id: `${CONNECTOR_ID}_${line}`,
        name: info?.phone ? `WhatsApp +${info.phone}` : "WhatsApp by XRE",
        url: info?.phone ? `https://wa.me/${info.phone}` : "https://wa.me",
        url_im: info?.phone ? `https://wa.me/${info.phone}` : "https://wa.me",
      },
    }).catch(() => undefined);
  }
}

/** Nesnede (en fazla 3 seviye) verilen sonekle biten ilk JID; mesaj içeriği taranmaz. */
function findJid(obj: unknown, suffix: string, skip: string[] = [], depth = 0): string {
  if (typeof obj === "string") return obj.endsWith(suffix) && !skip.includes(obj) ? obj : "";
  if (!obj || typeof obj !== "object" || depth > 3) return "";
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "message" || k === "contextInfo" || k === "quoted") continue;
    const hit = findJid(v, suffix, skip, depth + 1);
    if (hit) return hit;
  }
  return "";
}

/** Bir gönderimden sonra numaranın gizli kimliğini WhatsApp sunucusundan öğrenir (hat başına bir kez). */
const lidLookups = new Set<string>();
export async function learnLid(store: Store, portal: B24Portal, line: string, phone: string) {
  const instance = portal.lines[line]?.instance;
  if (!instance || !/^\d{8,15}$/.test(phone)) return;
  const cacheKey = `${portal.id}:${line}:${phone}`;
  if (lidLookups.has(cacheKey)) return;
  lidLookups.add(cacheKey);
  try {
    const res = await evolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, { method: "POST", body: JSON.stringify({ numbers: [phone] }) });
    const lid = findJid(res, "@lid");
    if (lid) {
      const lidId = `${lid.split("@")[0].replace(/\D/g, "")}@lid`;
      await saveLidPhone(store, portal.id, line, lidId, phone);
      // Bu kişiyle daha önce gizli kimlikle açılmış sohbet varsa birleştir.
      const hidden = (await store.get<B24Chat>(CHAT_KIND, chatId(portal.id, line, lidId), SYSTEM_OWNER))?.payload;
      if (hidden) await mergeLidChat(store, hidden, phone);
    }
  } catch {
    lidLookups.delete(cacheKey);
  }
}

/**
 * Gizli kimlikli (…@lid) sohbetleri gerçek numaraya bağlar. WhatsApp gizli kimliğin
 * numarasını vermez ama numaranın gizli kimliğini verir: portalda bilinen tüm
 * numaralar toplu sorulur, eşleşen sohbetler numaralı sohbetle birleştirilir.
 */
const lidChecked = new Set<string>();
export async function resolveLidChats(store: Store, portal: B24Portal, line: string) {
  const instance = portal.lines[line]?.instance;
  const chats = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((c) => c.memberId === portal.id);
  const hidden = chats.filter((c) => c.line === line && c.phone.endsWith("@lid"));
  if (!hidden.length || !instance || portal.lines[line]?.status !== "connected") return { matched: 0, left: hidden.length };
  const own = portal.lines[line]?.phone || "";
  const candidates = [...new Set(chats.map((c) => c.phone).filter((p) => /^\d{8,15}$/.test(p) && p !== own && !lidChecked.has(`${portal.id}:${line}:${p}`)))];
  for (let i = 0; i < candidates.length; i += 50) {
    const chunk = candidates.slice(i, i + 50);
    try {
      const res = await evolution(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, { method: "POST", body: JSON.stringify({ numbers: chunk }) });
      for (const item of Array.isArray(res) ? res : []) {
        const lid = findJid(item, "@lid");
        const pn = findJid(item, "@s.whatsapp.net");
        const phone = normalizePhone(pn ? pn.split("@")[0] : String(item?.number || ""));
        if (lid && phone && chunk.includes(phone)) await saveLidPhone(store, portal.id, line, `${lid.split("@")[0].replace(/\D/g, "")}@lid`, phone);
      }
      for (const p of chunk) lidChecked.add(`${portal.id}:${line}:${p}`);
    } catch (error) {
      console.warn("Gizli numaralar sorgulanamadı:", (error as Error).message);
      break;
    }
  }
  let matched = 0;
  for (const chat of hidden) {
    const phone = await lidPhone(store, portal.id, line, chat.phone);
    if (!phone) continue;
    await mergeLidChat(store, chat, phone);
    matched += 1;
  }
  if (matched || hidden.length) console.info(`WhatsApp by XRE: ${portal.domain} hat ${line}: ${matched} gizli numaralı sohbet numarayla eşleşti, ${hidden.length - matched} eşleşmedi.`);
  return { matched, left: hidden.length - matched };
}

const jidOf = (phone: string) => (phone.includes("@") ? phone : `${phone}@s.whatsapp.net`);
/** WhatsApp sunucusunun kişi listesinden adlar (gizli kimlikli kişiler dahil). */
async function contactNames(instance: string, jids?: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const res = await evolution(`/chat/findContacts/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify(jids?.length === 1 ? { where: { remoteJid: jids[0] } } : { where: {} }),
  });
  for (const c of Array.isArray(res) ? res : []) {
    const jid = String(c?.remoteJid || c?.id || "");
    const name = String(c?.pushName || c?.name || c?.verifiedName || "").trim().slice(0, 120);
    // Ad yoksa Evolution numarayı ad olarak yazar; onu kullanma.
    if (jid && name && name !== jid.split("@")[0]) names.set(jid, name);
  }
  return names;
}
/** Adı boş sohbetlere WhatsApp adını yazar. */
export async function fillChatNames(store: Store, portal: B24Portal, line: string) {
  const instance = portal.lines[line]?.instance;
  if (!instance) return 0;
  const nameless = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((c) => c.memberId === portal.id && c.line === line && !c.name && !c.phone.endsWith("@g.us"));
  if (!nameless.length) return 0;
  const names = await contactNames(instance, nameless.length === 1 ? [jidOf(nameless[0].phone)] : undefined).catch(() => new Map<string, string>());
  let filled = 0;
  for (const chat of nameless) {
    const name = names.get(jidOf(chat.phone));
    if (!name) continue;
    const fresh = await loadChat(store, portal.id, line, chat.phone);
    if (fresh.name) continue;
    await saveChat(store, { ...fresh, name });
    filled += 1;
  }
  if (filled) console.info(`WhatsApp by XRE: ${portal.domain} hat ${line}: ${filled} sohbete WhatsApp adı yazıldı.`);
  return filled;
}

/** Açılışta: önceden kalmış gizli numaralı sohbetleri eşleştirmeyi dener. */
async function resolveAllLidChats(store: Store) {
  for (const row of await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)) {
    if (!row.payload.active) continue;
    for (const line of Object.keys(row.payload.lines || {})) {
      await resolveLidChats(store, row.payload, line).catch(() => undefined);
      await fillChatNames(store, row.payload, line).catch(() => undefined);
    }
  }
}

/** …@lid adresinin yerine, gelmişse gerçek numaralı adresi döndürür. */
function withPhoneJid(jid: string, ...alts: unknown[]): string {
  if (!jid.endsWith("@lid")) return jid;
  for (const alt of alts) {
    const v = String(alt || "");
    if (v.endsWith("@s.whatsapp.net")) return v;
  }
  return jid;
}

type ChatTarget = { phone: string; isGroup: boolean; isLid: boolean; remoteJid: string };
/**
 * Mesajın ait olduğu sohbet: gerçek numara, grup ya da (numara bilinmiyorsa) gizli kimlik.
 * Durum mesajları, kanallar ve (kapalıysa) gruplar için null döner.
 */
async function resolveChatTarget(store: Store, portal: B24Portal, line: string, key: any, data: any, opts: { guess: boolean; warn: boolean }): Promise<ChatTarget | null> {
  const own = portal.lines[line]?.phone ? [`${portal.lines[line].phone}@s.whatsapp.net`] : [];
  // WhatsApp bazı sohbetlerde numara yerine gizli kimlik (…@lid) kullanır; gerçek
  // numara varsa ayrı alanda gelir (remoteJidAlt / senderPn).
  const rawJid = String(key?.remoteJid || "");
  let remoteJid = withPhoneJid(rawJid, key?.remoteJidAlt, key?.senderPn, key?.senderPN, data?.senderPn, data?.senderPN, data?.remoteJidAlt);
  if (rawJid.endsWith("@lid")) {
    const lid = `${rawJid.split("@")[0].replace(/\D/g, "")}@lid`;
    if (!remoteJid.endsWith("@s.whatsapp.net")) {
      // Alan adı sürüme göre değişiyor: numarayı anahtar ve veri alanlarında ara (kendi hattımız hariç).
      const found = findJid(key, "@s.whatsapp.net", own) || findJid({ ...data, key: undefined }, "@s.whatsapp.net", own);
      if (found) remoteJid = found;
    }
    if (remoteJid.endsWith("@s.whatsapp.net")) {
      const pn = normalizePhone(remoteJid.split("@")[0]);
      await saveLidPhone(store, portal.id, line, lid, pn);
      // Daha önce gizli kimlikle açılmış sohbet (ör. geçmişten) varsa numaralı sohbetle birleşir.
      const hidden = (await store.get<B24Chat>(CHAT_KIND, chatId(portal.id, line, lid), SYSTEM_OWNER))?.payload;
      if (hidden && pn) await mergeLidChat(store, hidden, pn);
    } else {
      const known = (await lidPhone(store, portal.id, line, lid)) || (opts.guess ? await guessLidPhone(store, portal.id, line, lid) : "");
      if (known) remoteJid = `${known}@s.whatsapp.net`;
      else if (opts.warn)
        console.warn(`WhatsApp by XRE: gizli numara eşleşmedi (${portal.domain} hat ${line}); alanlar: key[${Object.keys(key || {}).join(",")}] data[${Object.keys(data || {}).join(",")}]`);
    }
  }
  const isGroup = remoteJid.endsWith("@g.us");
  const isLid = remoteJid.endsWith("@lid");
  if (!remoteJid.endsWith("@s.whatsapp.net") && !isLid && !(isGroup && lineOptions(portal.lines[line]).groups)) return null; // durumlar ve (kapalıysa) gruplar aktarılmaz
  const phone = isGroup ? `${remoteJid.split("@")[0]}@g.us` : isLid ? `${remoteJid.split("@")[0].replace(/\D/g, "")}@lid` : normalizePhone(remoteJid.split("@")[0]);
  if (!phone || phone === "@lid" || (!isGroup && !isLid && own.includes(`${phone}@s.whatsapp.net`))) return null;
  return { phone, isGroup, isLid, remoteJid };
}

/** Metni olmayan medya mesajları için kısa etiket. */
function mediaLabel(message: any, lang: Lang): string {
  const key = waContentKey(message);
  const doc = message?.documentMessage || message?.documentWithCaptionMessage?.message?.documentMessage;
  if (key === "imageMessage") return pick(lang, "📷 Görsel", "📷 Image");
  if (key === "videoMessage" || key === "ptvMessage") return pick(lang, "🎥 Video", "🎥 Video");
  if (key === "audioMessage") return pick(lang, "🎤 Sesli mesaj", "🎤 Voice message");
  if (key === "stickerMessage") return pick(lang, "🏷 Çıkartma", "🏷 Sticker");
  if (doc) return `📄 ${doc.fileName || pick(lang, "Belge", "Document")}`;
  return "";
}

const tsMs = (v: any) => {
  const n = Number(typeof v === "object" && v ? (v.low ?? v.toString?.()) : v);
  return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : 0;
};

/** Aynı numaranın geçmiş olaylarını sırayla işler (paralel yazımlar birbirini ezmesin). */
const historyQueues = new Map<string, Promise<unknown>>();
function queued<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (historyQueues.get(key) || Promise.resolve()).catch(() => undefined).then(fn);
  historyQueues.set(key, next);
  void next.finally(() => historyQueues.get(key) === next && historyQueues.delete(key)).catch(() => undefined);
  return next;
}

const HISTORY_CHAT_MAX = 3000;
/**
 * Numara bağlanınca WhatsApp son sohbetleri ve mesajları gönderir (chats.set / messages.set).
 * Bunlar sohbet ekranına geçmiş olarak yazılır; Bitrix'e yeni mesaj olarak gönderilmez.
 */
export async function importHistory(store: Store, portal: B24Portal, line: string, event: string, data: any) {
  const lang = langOf(portal);
  if (event === "chats.set") {
    const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.chats) ? data.chats : [];
    const known = new Map(
      (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((c) => c.memberId === portal.id && c.line === line).map((c) => [c.id, c]),
    );
    let added = 0;
    for (const item of list) {
      const target = await resolveChatTarget(store, portal, line, { remoteJid: String(item?.remoteJid || item?.id || "") }, item, { guess: false, warn: false });
      if (!target || target.isLid) continue;
      const id = chatId(portal.id, line, target.phone);
      const name = String(item?.name || item?.pushName || "").slice(0, 120);
      const found = known.get(id);
      if (found) {
        if (name && !found.name) await saveChat(store, { ...found, name });
        continue;
      }
      if (known.size + added >= HISTORY_CHAT_MAX) break;
      await saveChat(store, { id, memberId: portal.id, line, phone: target.phone, name, inbound: 0, outbound: 0, sinceQualify: 0, history: [], createdAt: Date.now() });
      added += 1;
    }
    if (added) console.info(`WhatsApp by XRE: ${portal.domain} hat ${line} için ${added} sohbet içe aktarıldı.`);
    return added;
  }
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [];
  const byChat = new Map<string, { target: ChatTarget; name: string; msgs: ThreadMessage[] }>();
  for (const m of list) {
    const key = m?.key || {};
    const message = unwrapWaMessage(m?.message || {});
    if (!m?.message || message.protocolMessage || message.reactionMessage || isWaSystemMessage(message)) continue;
    const at = tsMs(m.messageTimestamp);
    if (!at) continue;
    const target = await resolveChatTarget(store, portal, line, key, m, { guess: false, warn: false });
    if (!target) continue;
    const text = waMessageText(message) || mediaLabel(message, lang);
    if (!text) continue;
    const group = byChat.get(target.phone) || { target, name: "", msgs: [] };
    const participant = withPhoneJid(String(key.participant || m?.participant || ""), key.participantAlt, key.participantPn);
    const sender = target.isGroup && !key.fromMe && participant.endsWith("@s.whatsapp.net") ? normalizePhone(jidPhone(participant)) : "";
    group.msgs.push({
      dir: key.fromMe ? "out" : "in",
      text,
      at,
      waId: String(key.id || ""),
      ...(key.fromMe ? { via: "phone" as const } : {}),
      ...(sender ? { sender: `+${sender}`, senderName: String(m?.pushName || "").slice(0, 120) } : {}),
    });
    if (!key.fromMe && !target.isGroup && m?.pushName) group.name = String(m.pushName).slice(0, 120);
    byChat.set(target.phone, group);
  }
  let count = 0;
  for (const { target, name, msgs } of byChat.values()) {
    const chat = await loadChat(store, portal.id, line, target.phone, name);
    const fresh = await mergeThread(store, chat, msgs);
    if (!fresh.length) continue;
    count += fresh.length;
    if (name && !chat.name && !target.isGroup) chat.name = name;
    for (const m of fresh) {
      if (m.dir === "in") {
        chat.inbound += 1;
        chat.lastInboundAt = Math.max(chat.lastInboundAt || 0, m.at);
      } else {
        chat.outbound += 1;
        chat.lastOutboundAt = Math.max(chat.lastOutboundAt || 0, m.at);
      }
    }
    chat.createdAt = Math.min(chat.createdAt || Date.now(), ...fresh.map((m) => m.at));
    chat.history = [...chat.history, ...fresh.map((m) => ({ from: m.dir === "in" ? ("müşteri" as const) : ("temsilci" as const), text: m.text, at: m.at }))].sort((a, b) => a.at - b.at);
    await saveChat(store, chat);
  }
  if (count) console.info(`WhatsApp by XRE: ${portal.domain} hat ${line} için ${count} geçmiş mesaj içe aktarıldı (${byChat.size} sohbet).`);
  return count;
}

const lidTimers = new Map<string, NodeJS.Timeout>();
let lidResolveDelay = 30_000;
/** Testler için: geçmiş aktarımı bittikten sonra gizli numara eşleştirmesinin bekleme süresi. */
export function setLidResolveDelay(ms: number) {
  lidResolveDelay = ms;
}

/** Performansta telefondan verilen cevapların temsilci kimliği */
export const PHONE_AGENT = "phone";
let phoneEchoDelay = 4000;
/** Testler için: kendi gönderimimizin yankısını beklerken kullanılan süre. */
export function setPhoneEchoDelay(ms: number) {
  phoneEchoDelay = ms;
}
/**
 * İşletmenin WhatsApp uygulamasından (telefon, WhatsApp Web) yazdığı mesajı sohbet
 * geçmişine ekler. Sistemden gönderdiğimiz mesajların yankısı ayıklanır.
 */
export async function recordPhoneMessage(store: Store, portal: B24Portal, line: string, instance: string, key: any, data: any) {
  const message = unwrapWaMessage(data?.message || {});
  if (!data?.message || message.protocolMessage || message.reactionMessage || isWaSystemMessage(message)) return;
  const target = await resolveChatTarget(store, portal, line, key, data, { guess: false, warn: false });
  if (!target) return;
  const lang = langOf(portal);
  const text = waMessageText(message) || "";
  const waId = String(key?.id || "");
  // Bizim gönderimimiz kaydını yazana kadar bekle; sonra yankı mı diye bak.
  if (phoneEchoDelay) await new Promise((r) => setTimeout(r, phoneEchoDelay));
  const id = chatId(portal.id, line, target.phone);
  if (await alreadySent(store, id, waId, text)) return;
  const media = await captureEvolutionMedia(store, `b24:${portal.id}`, instance, data).catch(() => ({}) as Awaited<ReturnType<typeof captureEvolutionMedia>>);
  const label = text || mediaLabel(message, lang);
  if (!label && !media.mediaId) return;
  const at = tsMs(data?.messageTimestamp) || Date.now();
  const chat = await loadChat(store, portal.id, line, target.phone);
  if (!chat.createdAt) chat.createdAt = at;
  const waited = chat.waitingSince ? Math.max(0, Math.round((Date.now() - chat.waitingSince) / 1000)) : null;
  // Telefondan yeni birine yazıldı: kişinin WhatsApp adını getir.
  if (!chat.name && !target.isGroup && instance)
    chat.name = (await contactNames(instance, [jidOf(target.phone)]).catch(() => new Map<string, string>())).get(jidOf(target.phone)) || "";
  chat.outbound += 1;
  chat.lastOutboundAt = Math.max(chat.lastOutboundAt || 0, at);
  chat.waitingSince = null;
  // İşletme telefondan cevap verdi: AI asistan bu sohbette bir süre susar.
  chat.agentState = "human";
  chat.humanAt = Date.now();
  if (label) chat.history.push({ from: "temsilci", text: label, at });
  await saveChat(store, chat);
  // Performans: telefondan verilen cevaplar "Telefondan" temsilcisi olarak sayılır.
  await bumpStat(store, portal.id, (s) => {
    const ls = lineStat(s, line);
    ls.outbound += 1;
    if (waited !== null) {
      ls.responses = (ls.responses || 0) + 1;
      ls.responseSec = (ls.responseSec || 0) + waited;
      ls.samples = [...(ls.samples || []), waited].slice(-500);
    }
    const a = agentStat(s, PHONE_AGENT);
    a.replies += 1;
    if (waited !== null) {
      a.responses += 1;
      a.responseSec += waited;
      a.maxSec = Math.max(a.maxSec, waited);
    }
  });
  await mergeThread(store, chat, [
    {
      dir: "out",
      text: label,
      via: "phone",
      at,
      waId,
      ...(media.mediaId ? { media: { id: media.mediaId, name: media.fileName || "", type: media.mediaType || "", mime: media.mime || "" } } : {}),
    },
  ]);
}

/** Var olan numaraların webhook ayarına geçmiş olaylarını ekler (sunucu başına bir kez). */
let webhooksSynced = false;
export async function syncConnectorWebhooks(store: Store) {
  if (webhooksSynced) return;
  webhooksSynced = true;
  for (const row of await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)) {
    if (!row.payload.active) continue;
    for (const l of Object.values(row.payload.lines || {})) {
      if (l.instance) await setEvolutionWebhook(l.instance, HISTORY_EVENTS).catch(() => false);
    }
  }
}

/** Müşteri adına Bitrix sohbetine kısa bir not (arama, silme, düzenleme). */
export async function sendClientMessage(
  store: Store,
  portal: B24Portal,
  line: string,
  msg: { phone: string; name: string; id: string; text: string; sender?: string },
) {
  const isGroup = msg.phone.endsWith("@g.us");
  const anon = !isGroup && msg.phone.endsWith("@lid");
  const userId = isGroup ? msg.sender || msg.phone : msg.phone;
  const lang = langOf(portal);
  await b24Call(store, portal, "imconnector.send.messages", {
    CONNECTOR: CONNECTOR_ID,
    LINE: line,
    MESSAGES: [
      {
        user: { id: userId, name: msg.name || (isGroup ? pick(lang, "Grup üyesi", "Group member") : `+${msg.phone}`), ...((isGroup && !msg.sender) || anon ? {} : { phone: `+${userId}`, skip_phone_validate: "Y" }) },
        message: { id: msg.id, date: Math.floor(Date.now() / 1000), text: msg.text },
        chat: { id: msg.phone, name: isGroup ? pick(lang, "WhatsApp grubu", "WhatsApp group") : msg.name || `+${msg.phone}` },
      },
    ],
  });
}

/** Evolution'dan gelen olay bir bağlayıcı oturumuna aitse işler. */
export async function handleConnectorEvolution(store: Store, body: any, base = origin()) {
  const instance = String(body?.instance || "");
  const map = (await store.get<{ memberId: string; line: string }>(INSTANCE_KIND, instance, SYSTEM_OWNER))?.payload;
  if (!map) return;
  let portal = await portalById(store, map.memberId);
  if (!portal || !portal.active) return;
  const event = String(body?.event || "").toLowerCase().replace(/_/g, ".");
  const data = body?.data || {};

  // Bağlantı anındaki WhatsApp geçmişi: sohbet listesine ve yazışmalara eklenir.
  if (event === "messages.set" || event === "chats.set") {
    await queued(instance, () => importHistory(store, portal!, map.line, event, data));
    // Geçmişte gizli kimlikle gelen sohbetleri numaralarıyla birleştir (son gruptan sonra bir kez).
    clearTimeout(lidTimers.get(instance));
    lidTimers.set(
      instance,
      setTimeout(
        () =>
          void queued(instance, async () => {
            const fresh = (await portalById(store, portal!.id)) || portal!;
            await resolveLidChats(store, fresh, map.line);
            await fillChatNames(store, fresh, map.line);
          }).catch(() => undefined),
        lidResolveDelay,
      ),
    );
    return;
  }

  if (event === "connection.update" || (!data?.key && (data?.state || data?.instance?.state))) {
    const state = String(data?.state || data?.instance?.state || "").toLowerCase();
    const open = ["open", "connected"].includes(state);
    const phone = open ? jidPhone(data?.wuid || body?.sender) : "";
    const previous = portal.lines[map.line];
    portal = {
      ...portal,
      lines: {
        ...portal.lines,
        [map.line]: {
          ...previous,
          instance,
          phone: phone || previous?.phone,
          profileName: open && data?.profileName ? String(data.profileName).slice(0, 120) : previous?.profileName,
          connectedAt: open ? (previous?.status === "connected" && previous?.connectedAt) || new Date().toISOString() : previous?.connectedAt,
          license: open ? await licenseForConnect(store, portal, map.line, phone || previous?.phone || "") : previous?.license,
          status: open ? "connected" : state || "disconnected",
          updatedAt: new Date().toISOString(),
        },
      },
    };
    await savePortal(store, portal);
    if (open && previous?.status !== "connected") await activateLine(store, portal, map.line, true).catch((e) => console.warn("Bitrix kanal etkinleştirilemedi:", e.message));
    return;
  }

  const options = lineOptions(portal.lines[map.line]);
  // Lisansı dolan numaranın mesajları aktarılmaz.
  if (!(await lineUsable(store, portal, map.line))) return;

  // WhatsApp araması: sohbete not olarak düşer.
  if (event === "call" || event.startsWith("call")) {
    if (!options.calls) return;
    const calls: any[] = Array.isArray(data) ? data : [data];
    for (const call of calls) {
      if (String(call?.status || "offer") !== "offer" || call?.isGroup) continue;
      const caller = normalizePhone(jidPhone(call?.from || call?.chatId || ""));
      if (!caller) continue;
      await sendClientMessage(store, portal, map.line, {
        phone: caller,
        name: "",
        id: `call-${String(call?.id || crypto.randomUUID())}`,
        text: call?.isVideo
          ? pick(langOf(portal), "🎥 Görüntülü WhatsApp araması geldi. Cevaplamak için telefonu kullanın.", "🎥 Incoming WhatsApp video call. Use the phone to answer.")
          : pick(langOf(portal), "📞 WhatsApp araması geldi. Cevaplamak için telefonu kullanın.", "📞 Incoming WhatsApp call. Use the phone to answer."),
      });
    }
    return;
  }

  if (!event.startsWith("messages.upsert") && !data?.key) return;
  const key = data?.key || {};
  if (key.fromMe) {
    // Kendi gönderdiğimiz mesajın yankısı: numara ile gizli kimlik birlikte gelirse eşleştirmeyi kaydet.
    const own = portal.lines[map.line]?.phone ? [`${portal.lines[map.line].phone}@s.whatsapp.net`] : [];
    const lidJid = findJid(key, "@lid") || findJid(data, "@lid");
    const pnJid = findJid(key, "@s.whatsapp.net", own) || findJid(data, "@s.whatsapp.net", own);
    if (lidJid && pnJid) await saveLidPhone(store, portal.id, map.line, `${lidJid.split("@")[0].replace(/\D/g, "")}@lid`, normalizePhone(pnJid.split("@")[0]));
    // Telefondan / WhatsApp Web'den yazılan mesaj sohbet ekranında da görünsün.
    if (event.startsWith("messages.upsert"))
      await queued(`${instance}:out`, () => recordPhoneMessage(store, portal!, map.line, instance, key, data)).catch((e) => console.warn("Telefondan yazılan mesaj kaydedilemedi:", (e as Error).message));
    return;
  }
  // Numara gizliyse (…@lid) ve eşleşme yoksa sohbet gizli kimlikle açılır; cevaplar da o kimliğe gider.
  const target = await resolveChatTarget(store, portal, map.line, key, data, { guess: true, warn: true });
  if (!target) return;
  const { isGroup, isLid, phone } = target;
  const participant = withPhoneJid(String(key.participant || data?.participant || ""), key.participantAlt, key.participantPn);
  const sender = isGroup && !participant.endsWith("@lid") ? normalizePhone(jidPhone(participant)) : "";
  const rawMessage = data?.message || {};
  // Silinen ve düzenlenen mesajlar
  const protocol = rawMessage.protocolMessage;
  if (protocol) {
    if (!options.edits) return;
    const edited = protocol.editedMessage ? waMessageText(unwrapWaMessage(protocol.editedMessage)) : "";
    const revoked = protocol.type === 0 || protocol.type === "REVOKE";
    if (!edited && !revoked) return;
    await sendClientMessage(store, portal, map.line, {
      phone,
      name: String(data?.pushName || "").slice(0, 120),
      sender,
      id: `${String(key.id || crypto.randomUUID())}-${edited ? "edit" : "del"}`,
      text: edited
        ? `${pick(langOf(portal), "✏️ Müşteri mesajını düzenledi", "✏️ The customer edited a message")}: ${edited}`
        : pick(langOf(portal), "🗑 Müşteri bir mesajını sildi.", "🗑 The customer deleted a message."),
    });
    return;
  }
  const message = unwrapWaMessage(rawMessage);
  if (isWaSystemMessage(message)) return;
  const owner = `b24:${portal.id}`;
  const media = await captureEvolutionMedia(store, owner, instance, data);
  const settings = await activeSettings(store, portal);
  const uiLang = langOf(portal);
  const voiceLabel = pick(uiLang, "🎤 Sesli mesaj: ", "🎤 Voice message: ");
  let text = waMessageText(message) || "";
  if (media.mediaType === "audio" && media.mediaId && settings.transcribe && aiConfigured()) {
    try {
      const audio = await readMedia(store, owner, media.mediaId);
      const transcript = audio ? await transcribe(audio.buffer, audio.record.mime, audio.record.fileName) : "";
      if (transcript) text = `${voiceLabel}${transcript}`;
    } catch (error) {
      console.warn("Sesli mesaj yazıya dökülemedi:", (error as Error).message);
    }
  }
  const pushName = String(data?.pushName || "").slice(0, 120);
  const chat = await loadChat(store, portal.id, map.line, phone, pushName);
  const isNew = chat.inbound === 0 && chat.outbound === 0;
  if (!chat.createdAt) chat.createdAt = Date.now();
  if (pushName) chat.name = pushName;
  let display = text;
  // Temsilcinin dilindeki metin (sohbet geçmişi ve AI için)
  let local = text;
  if (settings.translate && text && aiConfigured()) {
    try {
      const voice = text.startsWith(voiceLabel);
      const body = voice ? text.slice(voiceLabel.length) : text;
      const result = await detectAndTranslate(body, uiLang);
      if (result.lang) chat.lang = result.lang;
      if (result.lang && result.lang !== uiLang && result.translation) {
        local = (voice ? voiceLabel : "") + result.translation;
        display = `🌐 ${languageName(result.lang, uiLang)} → ${languageName(uiLang, uiLang)}:\n${local}\n\n[i]${pick(uiLang, "Orijinal", "Original")}: ${body}[/i]`;
      }
    } catch (error) {
      console.warn("Çeviri yapılamadı:", (error as Error).message);
    }
  }
  const now = Date.now();
  chat.inbound += 1;
  chat.sinceQualify += 1;
  chat.lastInboundAt = now;
  // Tepki, yalnız emoji ya da "teşekkürler / tamam" gibi kapanış mesajı sohbeti bekletmez.
  if (!chat.waitingSince && needsReply(text, Boolean(media.mediaId || media.mediaType))) chat.waitingSince = now;
  if (local) chat.history.push({ from: "müşteri", text: local, at: now });
  await saveChat(store, chat);
  await appendThread(store, chat, {
    dir: "in",
    text,
    ...(local !== text ? { translation: local } : {}),
    at: now,
    waId: String(key.id || ""),
    ...(isGroup && sender ? { sender: `+${sender}`, senderName: pushName } : {}),
    ...(media.mediaId ? { media: { id: media.mediaId, name: media.fileName || "", type: media.mediaType || "", mime: media.mime || "" } } : {}),
  });
  await bumpStat(store, portal.id, (s) => {
    const l = lineStat(s, map.line);
    l.inbound += 1;
    if (isNew) l.newChats += 1;
    recordInbound(s, map.line);
  });
  const files = media.mediaId
    ? [{ url: mediaUrl(base, portal.id, media.mediaId), name: media.fileName || pick(uiLang, "dosya", "file") }]
    : [];
  await b24Call(store, portal, "imconnector.send.messages", {
    CONNECTOR: CONNECTOR_ID,
    LINE: map.line,
    MESSAGES: [
      {
        user: isGroup
          ? { id: sender || phone, name: String(data?.pushName || "").slice(0, 120) || (sender ? `+${sender}` : pick(uiLang, "Grup üyesi", "Group member")), ...(sender ? { phone: `+${sender}`, skip_phone_validate: "Y" } : {}) }
          : isLid
            ? { id: phone, name: String(data?.pushName || "").slice(0, 120) || pick(uiLang, "WhatsApp kullanıcısı", "WhatsApp user") }
            : {
                id: phone,
                name: String(data?.pushName || "").slice(0, 120) || `+${phone}`,
                phone: `+${phone}`,
                skip_phone_validate: "Y",
              },
        message: {
          id: String(key.id || crypto.randomUUID()),
          date: Math.floor(Number(data?.messageTimestamp || Date.now() / 1000)),
          text: display || (files.length ? "" : pick(uiLang, "[Medya]", "[Media]")),
          ...(files.length ? { files } : {}),
        },
        chat: { id: phone, name: isGroup ? pick(uiLang, "WhatsApp grubu", "WhatsApp group") : String(data?.pushName || (isLid ? pick(uiLang, "WhatsApp kullanıcısı", "WhatsApp user") : `+${phone}`)).slice(0, 120) },
      },
    ],
  });
  // Yeterli konuşma birikince müşteriyi nitelendir (arka planda).
  if (settings.qualify && aiConfigured() && chat.sinceQualify >= 3 && chat.history.length >= 3)
    void qualifyChat(store, portal, chat).catch((error) => console.warn("Nitelendirme yapılamadı:", (error as Error).message));
  // AI asistan (gruplarda çalışmaz)
  if (!isGroup) onCustomerMessage(store, portal, map.line, chat);
}

const agentCache = new Map<string, { id: string; at: number }>();
/**
 * Cevabı yazan temsilci. Olay gövdesinde yoksa Açık Kanal sohbetinin
 * sorumlu operatörü (imopenlines.dialog.get → owner) kullanılır.
 */
async function agentOf(store: Store, portal: B24Portal, item: any): Promise<string> {
  const direct = item?.message?.user_id || item?.message?.author_id || item?.message?.USER_ID || item?.user?.id || item?.im?.user_id || item?.im?.author_id;
  if (direct && String(direct) !== "0") return String(direct);
  const chatId = String(item?.im?.chat_id || "").replace(/\D/g, "");
  if (!chatId) return "0";
  const cacheKey = `${portal.id}:${chatId}`;
  const cached = agentCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.id;
  try {
    const dialog = await b24Call(store, portal, "imopenlines.dialog.get", { CHAT_ID: chatId });
    const owner = String(dialog?.owner || dialog?.OWNER || dialog?.operator_id || "");
    if (owner && owner !== "0") {
      agentCache.set(cacheKey, { id: owner, at: Date.now() });
      return owner;
    }
  } catch (error) {
    console.warn("Temsilci belirlenemedi:", (error as Error).message);
  }
  console.info("Bitrix mesaj olayında temsilci alanı yok; alanlar:", JSON.stringify({ message: Object.keys(item?.message || {}), im: Object.keys(item?.im || {}) }));
  return "0";
}

/**
 * Temsilci (Bitrix'ten ya da XRE sohbet ekranından) müşteriye yazdı: sohbet
 * durumu, istatistik ve tam yazışma geçmişi güncellenir.
 */
export async function recordOutbound(
  store: Store,
  portal: B24Portal,
  line: string,
  chat: B24Chat,
  msg: { agent: string; text: string; original?: string; local?: string; via: "bitrix" | "xre"; waId?: string; media?: ThreadMessage["media"] },
) {
  const now = Date.now();
  const waited = chat.waitingSince ? Math.max(0, Math.round((now - chat.waitingSince) / 1000)) : null;
  chat.outbound += 1;
  chat.lastOutboundAt = now;
  chat.waitingSince = null;
  // Temsilci yazdı: AI asistan bu sohbette bir süre susar.
  chat.agentState = "human";
  chat.humanAt = now;
  const local = msg.local ?? msg.original ?? msg.text;
  if (local) chat.history.push({ from: "temsilci", text: local, at: now });
  await saveChat(store, chat);
  void learnLid(store, portal, line, chat.phone);
  await appendThread(store, chat, { dir: "out", text: msg.text, ...(msg.original ? { original: msg.original } : {}), by: msg.agent, via: msg.via, at: now, ...(msg.waId ? { waId: msg.waId } : {}), ...(msg.media ? { media: msg.media } : {}) });
  await bumpStat(store, portal.id, (s) => {
    const ls = lineStat(s, line);
    ls.outbound += 1;
    if (waited !== null) {
      ls.responses = (ls.responses || 0) + 1;
      ls.responseSec = (ls.responseSec || 0) + waited;
      ls.samples = [...(ls.samples || []), waited].slice(-500);
    }
    const a = agentStat(s, msg.agent);
    a.replies += 1;
    if (waited !== null) {
      a.responses += 1;
      a.responseSec += waited;
      a.maxSec = Math.max(a.maxSec, waited);
    }
  });
}

/** Bitrix temsilcisinin yazdığı mesajları WhatsApp'a iletir. */
async function deliverFromBitrix(store: Store, portal: B24Portal, line: string, messages: any[]) {
  const info = portal.lines[line];
  if (!info?.instance) return;
  if (!(await lineUsable(store, portal, line))) {
    console.warn(`WhatsApp by XRE: ${portal.domain} kanal ${line} lisansı dolduğu için mesaj gönderilmedi.`);
    return;
  }
  const delivered: any[] = [];
  for (const item of messages) {
    const chatRef = String(item?.chat?.id || "");
    const to = chatRef.endsWith("@g.us") || chatRef.endsWith("@lid") ? `${chatRef.split("@")[0].replace(/\D/g, "")}@${chatRef.split("@")[1]}` : normalizePhone(chatRef);
    if (!to) continue;
    const agentText = String(item?.message?.text || "")
      .replace(/\[br\]/gi, "\n")
      .replace(/\[\/?(b|i|u|s|url[^\]]*)\]/gi, "")
      .trim();
    const chat = await loadChat(store, portal.id, line, to);
    // "!" ile başlayan mesaj çevrilmeden gönderilir.
    const raw = agentText.startsWith("!");
    let text = raw ? agentText.slice(1).trim() : agentText;
    if (!raw && text && (await activeSettings(store, portal)).translate && chat.lang && chat.lang !== langOf(portal)) {
      try {
        text = await translateTo(text, chat.lang, langOf(portal));
      } catch (error) {
        console.warn("Cevap çevrilemedi, olduğu gibi gönderiliyor:", (error as Error).message);
      }
    }
    const files: any[] = Array.isArray(item?.message?.files) ? item.message.files : Object.values(item?.message?.files || {});
    let sentId = "";
    for (const file of files) {
      const link = String(file?.link || file?.url || "");
      if (!/^https:\/\//.test(link)) continue;
      const response = await fetchWithTimeout(link, {}, 30_000);
      if (!response.ok) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      const record = await saveMedia(store, `b24:${portal.id}`, buffer, response.headers.get("content-type") || String(file?.type || ""), String(file?.name || ""));
      const result = await sendEvolutionMedia(info.instance, to, record, buffer, files.length === 1 ? text : "");
      sentId = String(result?.key?.id || sentId);
    }
    if (text && !(files.length === 1 && sentId)) {
      const result = await evolution(`/message/sendText/${encodeURIComponent(info.instance)}`, {
        method: "POST",
        body: JSON.stringify({ number: to, text, linkPreview: true }),
      });
      sentId = String(result?.key?.id || sentId);
    }
    delivered.push({ im: item?.im, message: { id: [sentId || String(item?.message?.id || "")] }, chat: { id: item?.chat?.id } });
    const agent = await agentOf(store, portal, item);
    await recordOutbound(store, portal, line, chat, {
      agent,
      text,
      original: !raw && text !== agentText ? agentText : undefined,
      local: agentText.replace(/^!/, ""),
      via: "bitrix",
      waId: sentId,
      media: files.length ? { name: String(files[0]?.name || "") } : undefined,
    });
  }
  if (delivered.length)
    await b24Call(store, portal, "imconnector.send.status.delivery", { CONNECTOR: CONNECTOR_ID, LINE: line, MESSAGES: delivered }).catch(() => undefined);
}

// --- Bağlantı işlemleri (ayar sayfası ve panel ortak) ------------------------

async function connectionQr(store: Store, portal: B24Portal, line: string) {
  const instance = instanceName(portal.id, line);
  await store.put(INSTANCE_KIND, instance, { id: instance, memberId: portal.id, line }, SYSTEM_OWNER);
  if (!evolutionWebhookConfig())
    throw Object.assign(new Error("WhatsApp sunucusunun webhook adresi tanımlı değil."), { statusCode: 503 });
  const qr = await getEvolutionQr(instance, HISTORY_EVENTS);
  const image = typeof qr === "string" ? qr : qr?.base64 || qr?.qr || qr?.qrcode?.base64 || "";
  return { qr: image ? (String(image).startsWith("data:") ? image : `data:image/png;base64,${image}`) : "", message: image ? "" : "QR henüz hazır değil." };
}

async function connectionStatus(store: Store, portal: B24Portal, line: string) {
  const instance = instanceName(portal.id, line);
  await store.put(INSTANCE_KIND, instance, { id: instance, memberId: portal.id, line }, SYSTEM_OWNER);
  const state = await evolutionState(instance);
  const connected = ["open", "connected"].includes(state);
  const known = portal.lines[line];
  if (connected && known?.status !== "connected") {
    // Webhook kaçırıldıysa durumu buradan tamamla.
    const owner = await evolutionOwnerPhone(instance);
    const next = {
      ...portal,
      lines: {
        ...portal.lines,
        [line]: { ...known, instance, phone: owner.phone || known?.phone, profileName: owner.profileName || known?.profileName, connectedAt: known?.connectedAt || new Date().toISOString(), license: await licenseForConnect(store, portal, line, owner.phone || known?.phone || ""), status: "connected", updatedAt: new Date().toISOString() },
      },
    };
    await savePortal(store, next);
    await activateLine(store, next, line, true);
    return { status: "connected", phone: next.lines[line].phone || "" };
  }
  return { status: connected ? "connected" : state || "disconnected", phone: known?.phone || "" };
}

/**
 * Bir numaranın gerçek WhatsApp bağlantısını sorar ve kayıttaki durumu düzeltir.
 * WhatsApp sunucusuna ulaşılamazsa durum değiştirilmez.
 */
export async function checkLineHealth(store: Store, portal: B24Portal, line: string): Promise<B24Line | undefined> {
  const known = portal.lines[line];
  if (!known?.instance) return known;
  const state = await evolutionState(known.instance);
  if (!state) return known;
  if (["open", "connected"].includes(state)) {
    if (known.status !== "connected") await connectionStatus(store, portal, line);
  } else if (known.status === "connected" || known.status === "connecting") {
    // Yalnız bağlı görünen numaralar düşürülür; hiç bağlanmamış olanlara dokunulmaz.
    const status = state === "connecting" ? "connecting" : "disconnected";
    if (known.status !== status) {
      const fresh = (await portalById(store, portal.id)) || portal;
      if (fresh.lines[line]) await savePortal(store, { ...fresh, lines: { ...fresh.lines, [line]: { ...fresh.lines[line], status, updatedAt: new Date().toISOString() } } });
      console.warn(`WhatsApp by XRE: ${portal.domain} kanal ${line} bağlantısı koptu (${state}).`);
    }
  }
  lineChecks.set(`${portal.id}:${line}`, Date.now());
  return ((await portalById(store, portal.id)) || portal).lines[line];
}
const lineChecks = new Map<string, number>();
/** Son kontrolü maxAgeMs'den eski olan numaraları yeniden kontrol eder (paralel). */
export async function refreshLines(store: Store, portal: B24Portal, lines: string[], maxAgeMs = 60_000) {
  const stale = lines.filter((l) => portal.lines[l]?.instance && Date.now() - (lineChecks.get(`${portal.id}:${l}`) || 0) > maxAgeMs);
  if (!stale.length) return portal;
  await Promise.all(stale.map((l) => checkLineHealth(store, portal, l).catch(() => undefined)));
  return (await portalById(store, portal.id)) || portal;
}

/** Arka planda tüm bağlı numaraları 2 dakikada bir kontrol eder. */
let healthTimer: NodeJS.Timeout | null = null;
export function startLineHealthMonitor(store: Store) {
  if (healthTimer) return;
  setTimeout(
    () =>
      void syncConnectorWebhooks(store)
        .then(() => resolveAllLidChats(store))
        .catch((e) => console.warn("Webhook ayarı güncellenemedi:", (e as Error).message)),
    20_000,
  ).unref?.();
  healthTimer = setInterval(() => {
    void (async () => {
      for (const row of await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)) {
        if (!row.payload.active) continue;
        await refreshLines(store, row.payload, Object.keys(row.payload.lines), 90_000).catch(() => undefined);
      }
    })().catch((e) => console.warn("Bağlantı kontrolü:", (e as Error).message));
  }, 2 * 60_000);
  healthTimer.unref?.();
}

async function connectionDisconnect(store: Store, portal: B24Portal, line: string) {
  const instance = instanceName(portal.id, line);
  await evolution(`/instance/logout/${encodeURIComponent(instance)}`, { method: "DELETE" }).catch(() => undefined);
  const lines = { ...portal.lines, [line]: { ...(portal.lines[line] || { instance }), status: "disconnected", updatedAt: new Date().toISOString() } };
  await savePortal(store, { ...portal, lines });
  await activateLine(store, { ...portal, lines }, line, false).catch(() => undefined);
  return { ok: true };
}

// --- HTML --------------------------------------------------------------------

export function page(res: Response, status: number, title: string, body: string, script = "", lang: Lang = "tr") {
  res
    .status(status)
    .type("html")
    .setHeader("cache-control", "no-store")
    .send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp by XRE</title>
<style>${PANEL_STYLE}
.wrap{max-width:560px;margin:28px auto;padding:28px 30px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 30px rgba(15,40,70,.08)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:14px;color:var(--ink-3);font-size:12.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.brand i{width:28px;height:28px;border-radius:8px;background:var(--accent);display:inline-block}
.wrap h1{font-size:20px;margin:0 0 8px}.wrap p{margin:6px 0;color:var(--ink-2)}.wrap ol,.wrap ul{padding-left:20px;color:var(--ink-2)}
.wrap .qr{margin:16px 0}.ok{color:var(--ok);font-weight:600}.err{color:var(--danger)}
.wrap a{color:var(--accent);font-weight:600}
.wrap button{padding:9px 16px;border-radius:var(--r-s);border:1px solid var(--line);background:var(--surface);font-weight:600;cursor:pointer}
@media (max-width:600px){.wrap{margin:0;border-radius:0;border-width:0 0 1px;padding:22px 16px}}</style>${script}</head>
<body><div class="wrap"><div class="brand"><i aria-hidden="true"></i>WhatsApp by XRE</div><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`);
}

export function readBitrixParams(req: Request) {
  const all = { ...(req.query as Record<string, any>), ...((req.body as Record<string, any>) || {}) };
  let options: Record<string, any> = {};
  if (typeof all.PLACEMENT_OPTIONS === "string") {
    try {
      options = JSON.parse(all.PLACEMENT_OPTIONS);
    } catch {
      options = {};
    }
  } else if (all.PLACEMENT_OPTIONS && typeof all.PLACEMENT_OPTIONS === "object") options = all.PLACEMENT_OPTIONS;
  return {
    memberId: String(all.member_id || all.MEMBER_ID || ""),
    domain: cleanDomain(all.DOMAIN),
    authId: String(all.AUTH_ID || "").slice(0, 4096),
    refreshId: String(all.REFRESH_ID || "").slice(0, 4096),
    expires: Number(all.AUTH_EXPIRES || 3600),
    serverEndpoint: String(all.SERVER_ENDPOINT || ""),
    placement: String(all.PLACEMENT || ""),
    lang: normLang(all.LANG || all.lang),
    options,
  };
}

type BitrixParams = ReturnType<typeof readBitrixParams>;

/**
 * Portalı kaydeder ya da belirteçlerini yeniler ve bağlayıcıyı kaydeder.
 * Yalnız portal yöneticisinin belirteciyle çalışır. Kurulum adresi çağrılmasa
 * da (Bitrix "uygulama kurulumu kendisi tamamlar" kapalıyken) uygulama ilk
 * açıldığında buradan kurulur.
 */
/** Kurulum belirtecini Bitrix OAuth sunucusunda doğrular (yenileme ile). */
async function verifyInstallTokens(p: BitrixParams) {
  const creds = appCredentials();
  if (!creds.length) throw noCredentials();
  if (!p.refreshId) throw Object.assign(new Error("Bitrix kurulum bilgisi eksik (REFRESH_ID)."), { statusCode: 400 });
  // Yenileme belirteci yalnız kendi uygulamasının anahtarıyla kabul edilir; sırayla denenir.
  let data: any = null;
  let clientId = "";
  for (const cred of creds) {
    const res = await fetcher(tokenUrl(cred, p.refreshId), { method: "GET" }).catch(() => null);
    if (res?.access_token) {
      data = res;
      clientId = cred.id;
      break;
    }
  }
  const endpoint = String(data?.client_endpoint || "");
  let host = "";
  try {
    const u = new URL(endpoint);
    host = u.protocol === "https:" ? u.host.toLowerCase() : "";
  } catch {
    host = "";
  }
  if (!data?.access_token || String(data.member_id || "") !== p.memberId || !host || host !== p.domain)
    throw Object.assign(new Error("Bitrix kurulum belirteci doğrulanamadı. Uygulamayı Bitrix24 içinden yeniden açın."), { statusCode: 401 });
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || p.refreshId),
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    clientEndpoint: `https://${host}/rest/`,
    clientId,
  };
}

const withAdmin = (list: string[] | undefined, id: unknown) => {
  const uid = String(id || "").replace(/\D/g, "");
  return uid ? [uid, ...(list || []).filter((x) => x !== uid)].slice(0, 10) : list || [];
};

async function installPortal(store: Store, p: BitrixParams, base: string): Promise<B24Portal> {
  const existing = await portalById(store, p.memberId);
  if (existing?.active && existing.domain !== p.domain)
    throw Object.assign(new Error("Bu portal kimliği başka bir alan adına kayıtlı."), { statusCode: 403 });
  const now = new Date().toISOString();
  // Belirteçler gerçekten Bitrix24'ün verdiği ve bu portala ait belirteçler mi?
  // İstekteki alan adına sormak yetmez (sahte bir "Bitrix" sunucusu evet der);
  // bu yüzden yenileme belirteci Bitrix'in OAuth sunucusunda, uygulamamızın
  // gizli anahtarıyla doğrulanır. Dönen member_id ve portal adresi esas alınır.
  const verified = await verifyInstallTokens(p);
  const portal: B24Portal = {
    ...existing,
    roles: existing?.roles,
    assignments: existing?.assignments,
    id: p.memberId,
    domain: p.domain,
    clientEndpoint: verified.clientEndpoint,
    clientId: verified.clientId,
    accessToken: verified.accessToken,
    refreshToken: verified.refreshToken,
    expiresAt: verified.expiresAt,
    // Kaldırılıp yeniden kurulan uygulamaya Bitrix yeni anahtar verir.
    applicationToken: existing?.active ? existing.applicationToken : undefined,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
    active: true,
    lang: p.lang,
    lines: existing?.lines || {},
  };
  // Belirteç gerçekten bu portala ve bir yöneticiye mi ait?
  const user = await b24Call(store, portal, "user.current");
  if (!user?.ID) throw new Error("Bitrix oturumu doğrulanamadı.");
  if ((await b24Call(store, portal, "user.admin")) !== true)
    throw Object.assign(new Error("Uygulamayı yalnız Bitrix24 yöneticisi kurabilir."), { statusCode: 403 });
  portal.adminIds = withAdmin(portal.adminIds, user.ID);
  await savePortal(store, portal);
  if (!existing?.active) notifyOwner("install", `Yeni kurulum: ${portal.domain}`, { domain: portal.domain, lang: portal.lang || "" });
  await registerConnector(store, portal, base);
  const tabWarnings = await bindCardTabs(store, portal, base);
  if (tabWarnings.length) console.warn(`WhatsApp by XRE kart sekmesi (${portal.domain}):`, tabWarnings.join("; "));
  await savePortal(store, { ...portal, baseUrl: base, ...(tabWarnings.length ? {} : { cardTabs: CARD_TABS_VERSION }) });
  return portal;
}

/** Bitrix dışından (ya da Bitrix'in adres kontrolüyle) açılan sayfa: 200 ve kısa bilgi. */
function landing(res: Response, lang: Lang) {
  page(
    res,
    200,
    "WhatsApp by XRE",
    pick(
      lang,
      `<p>WhatsApp by XRE, WhatsApp numaralarını Bitrix24 Açık Kanallarına bağlar. Uygulamayı Bitrix24 içinden açın.</p><p><a href="/b24/support?lang=tr">Destek</a> · <a href="/b24/legal/terms?lang=tr">Lisans sözleşmesi</a> · <a href="/b24/legal/privacy?lang=tr">Gizlilik</a></p>`,
      `<p>WhatsApp by XRE connects WhatsApp numbers to Bitrix24 Open Channels. Please open the app from inside Bitrix24.</p><p><a href="/b24/support">Support</a> · <a href="/b24/legal/terms">License agreement</a> · <a href="/b24/legal/privacy">Privacy policy</a></p>`,
    ),
    "",
    lang,
  );
}

const chatViewUrl = (memberId: string, userId: string, admin: boolean, lang: Lang) =>
  userId ? `/b24/chat/view?t=${encodeURIComponent(chatTicket(memberId, userId, admin))}&lang=${lang}` : "";

/**
 * Uygulama kaldırıldı: WhatsApp oturumları kapatılır, belirteçler ve müşteri
 * verileri (sohbet geçmişi, istatistik, rapor, medya) silinir. Numara adları ve
 * satın alınmış lisanslar korunur; aynı portal yeniden kurarsa ödediği süre kaybolmaz.
 */
export async function uninstallPortal(store: Store, portal: B24Portal) {
  notifyOwner("uninstall", `Uygulama kaldırıldı: ${portal.domain}`, { domain: portal.domain });
  for (const l of Object.values(portal.lines)) {
    if (l.instance) {
      await evolution(`/instance/logout/${encodeURIComponent(l.instance)}`, { method: "DELETE" }).catch(() => undefined);
      await store.delete(INSTANCE_KIND, l.instance, SYSTEM_OWNER).catch(() => undefined);
    }
  }
  const lines = Object.fromEntries(
    Object.entries(portal.lines).map(([id, l]) => [id, { ...l, status: "disconnected", phone: undefined, profileName: undefined, updatedAt: new Date().toISOString() }]),
  );
  await savePortal(store, { ...portal, active: false, accessToken: "", refreshToken: "", applicationToken: undefined, lines });
  for (const row of await store.list<UserQuickReplies>(QUICK_USER_KIND, SYSTEM_OWNER))
    if (row.payload?.memberId === portal.id) await deleteMedia(store, quickUserOwner(portal.id, row.payload.userId));
  for (const kind of [CHAT_KIND, STAT_KIND, "b24-report", THREAD_KIND, CAMPAIGN_KIND, LID_KIND, QUICK_USER_KIND]) {
    for (const row of await store.list<{ memberId?: string }>(kind, SYSTEM_OWNER))
      if (row.payload?.memberId === portal.id) await store.delete(kind, row.id, SYSTEM_OWNER);
  }
  await deleteMedia(store, `b24:${portal.id}`);
  await deleteMedia(store, quickOwner(portal.id));
}

// --- Rotalar -----------------------------------------------------------------

export function registerB24ConnectorRoutes(app: Express, store: Store) {
  const form = express.urlencoded({ extended: true, limit: "256kb" });
  registerLegalRoutes(app);
  registerChatRoutes(app, store);

  // Kurulum: belirteçleri sakla, bağlayıcıyı ve olayları kaydet.
  const install = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    // Bitrix adresi kaydederken parametresiz istek atar ve 200 bekler.
    if (!p.memberId && !p.authId) return landing(res, p.lang);
    if (!memberIdOk(p.memberId) || !p.domain || !p.authId)
      return page(res, 400, pick(p.lang, "Kurulum bilgisi eksik", "Installation data missing"), pick(p.lang, "<p>Uygulamayı Bitrix24 içinden kurun.</p>", "<p>Please install the app from inside Bitrix24.</p>"), "", p.lang);
    try {
      await installPortal(store, p, origin(req));
      // Kurulum bitince Bitrix uygulamayı yeniden yükler ve yönetim paneli açılır.
      page(
        res,
        200,
        pick(p.lang, "WhatsApp by XRE kuruldu", "WhatsApp by XRE is installed"),
        pick(
          p.lang,
          `<p class="ok">Kurulum tamamlandı. Yönetim paneli açılıyor…</p>`,
          `<p class="ok">Installation complete. Opening the dashboard…</p>`,
        ),
        `<script src="https://api.bitrix24.com/api/v1/"></script><script>window.addEventListener("load",function(){try{BX24.init(function(){BX24.installFinish();});}catch(e){}});</script>`,
        p.lang,
      );
    } catch (error) {
      console.warn("Bitrix bağlayıcı kurulumu başarısız:", (error as Error).message);
      const code = (error as Error & { statusCode?: number }).statusCode;
      page(res, code && code >= 400 && code < 500 ? code : 502, pick(p.lang, "Kurulum tamamlanamadı", "Installation failed"), `<p class="err">${escapeHtml(localizeMessage((error as Error).message, p.lang))}</p>`, "", p.lang);
    }
  };
  app.get("/b24/install", install);
  app.post("/b24/install", form, install);

  // Uygulama ana sayfası (sol menü): yöneticiye yönetim paneli, personele kendi numaraları.
  const home = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    if (!p.memberId && !p.authId) return landing(res, p.lang);
    let portal = memberIdOk(p.memberId) ? await portalById(store, p.memberId) : null;
    if ((!portal || !portal.active) && memberIdOk(p.memberId) && p.domain && p.authId) {
      try {
        portal = await installPortal(store, p, origin(req));
        // installPortal açan kişinin bu portalın yöneticisi olduğunu doğruladı.
        res.status(200).type("html").setHeader("cache-control", "no-store").send(panelHtml(settingsTicket(portal.id, "all"), portal.domain, p.lang, chatViewUrl(portal.id, "", true, p.lang)));
        return;
      } catch (error) {
        console.warn("Bitrix bağlayıcı otomatik kurulumu başarısız:", (error as Error).message);
        return page(res, 502, pick(p.lang, "Kurulum tamamlanamadı", "Installation failed"), `<p class="err">${escapeHtml(localizeMessage((error as Error).message, p.lang))}</p>`, "", p.lang);
      }
    }
    if (!portal || !portal.active || portal.domain !== p.domain)
      return page(res, 404, pick(p.lang, "Uygulama kurulu değil", "The app is not installed"), pick(p.lang, "<p>Uygulamayı Bitrix24 içinden açın.</p>", "<p>Please open the app from inside Bitrix24.</p>"), "", p.lang);
    const viewer = { ...portal, accessToken: p.authId, refreshToken: "", expiresAt: 0 };
    let user: any;
    let admin = false;
    try {
      user = await b24Call(store, viewer, "user.current");
      admin = (await b24Call(store, viewer, "user.admin")) === true;
    } catch {
      return page(res, 401, pick(p.lang, "Bitrix oturumu doğrulanamadı", "Bitrix24 session could not be verified"), pick(p.lang, "<p>Sayfayı Bitrix24 içinden yeniden açın.</p>", "<p>Please reopen the page from inside Bitrix24.</p>"), "", p.lang);
    }
    const userId = String(user?.ID || "").replace(/\D/g, "");
    if (admin) {
      if (userId && !(portal.adminIds || []).includes(userId)) {
        const current = (await portalById(store, portal.id)) || portal;
        await savePortal(store, { ...current, adminIds: withAdmin(current.adminIds, userId) });
      }
      // Sohbet notları ve raporlar yöneticinin Bitrix dilinde yazılır.
      if (portal.lang !== p.lang) await savePortal(store, { ...((await portalById(store, portal.id)) || portal), lang: p.lang });
      // Mevcut kanallarda Bitrix'in otomatik mesajları bir kez kapatılır.
      if (portal.quietLines !== QUIET_LINES_VERSION && Object.keys(portal.lines).length) {
        const current = (await portalById(store, portal.id)) || portal;
        const warnings = await applyLineAutoMessages(store, current);
        if (!warnings.length) await savePortal(store, { ...current, quietLines: QUIET_LINES_VERSION });
        else console.warn(`WhatsApp by XRE otomatik mesajlar (${portal.domain}):`, warnings.join("; "));
      }
      // Eski kurulumlarda CRM kart sekmesi yoksa bir kez eklenir.
      if (portal.cardTabs !== CARD_TABS_VERSION) {
        const warnings = await bindCardTabs(store, portal, origin(req));
        if (!warnings.length) await savePortal(store, { ...((await portalById(store, portal.id)) || portal), cardTabs: CARD_TABS_VERSION });
        else console.warn(`WhatsApp by XRE kart sekmesi (${portal.domain}):`, warnings.join("; "));
      }
      res.status(200).type("html").setHeader("cache-control", "no-store").send(panelHtml(settingsTicket(portal.id, "all"), portal.domain, p.lang, chatViewUrl(portal.id, userId, true, p.lang)));
      return;
    }
    // Personel: WhatCRM benzeri sohbet ekranı, yalnız rolündeki numaralar.
    if (userId) {
      res.setHeader("referrer-policy", "no-referrer");
      res.status(200).type("html").setHeader("cache-control", "no-store").send(chatHtml(chatTicket(portal.id, userId, false), p.lang, { mode: "inbox" }));
      return;
    }
    const role = roleOf(portal, String(user?.ID || ""));
    const mine = publicConnections(portal).filter((c) => roleAllows(role, c.line));
    const L = p.lang;
    page(
      res,
      200,
      pick(L, "WhatsApp numaralarınız", "Your WhatsApp numbers"),
      `<p>${pick(L, "WhatsApp sohbetleri Bitrix24'ün <b>Açık Kanallar</b> sohbetine düşer; cevaplarınız WhatsApp'tan gider.", "WhatsApp chats arrive in Bitrix24 <b>Open Channels</b>; your replies are sent via WhatsApp.")}</p>
<p>${pick(L, "Rolünüz", "Your role")}: <b>${escapeHtml(role?.name || pick(L, "atanmamış", "not assigned"))}</b></p>
${mine.length ? `<ul>${mine.map((c) => `<li>${escapeHtml(c.name)} ${c.phone ? `(+${escapeHtml(c.phone)})` : ""}</li>`).join("")}</ul>` : `<p>${pick(L, "Size atanmış numara yok. Yöneticinizle görüşün.", "No numbers are assigned to you. Please contact your administrator.")}</p>`}`,
      "",
      L,
    );
  };
  // XRE yönetim ekranı: sayfa herkese açık iskelet, veriler CRM sahibi oturumuyla gelir.
  app.get("/b24/admin", (_req, res) => {
    res.type("html").setHeader("cache-control", "no-store").send(adminHtml());
  });
  app.get("/b24/app", home);
  app.post("/b24/app", form, home);

  // İletişim Merkezi'ndeki kanal ayarı (PLACEMENT_HANDLER).
  const settings = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    const line = String(p.options.LINE || p.options.line || "").replace(/\D/g, "");
    const portal = memberIdOk(p.memberId) ? await portalById(store, p.memberId) : null;
    if (!portal || !portal.active || portal.domain !== p.domain)
      return page(res, 404, pick(p.lang, "Uygulama kurulu değil", "The app is not installed"), pick(p.lang, "<p>Uygulamayı yeniden kurun.</p>", "<p>Please reinstall the app.</p>"), "", p.lang);
    if (!line) return page(res, 400, pick(p.lang, "Açık Kanal seçilmedi", "No Open Channel selected"), pick(p.lang, "<p>İletişim Merkezi'nden bir Açık Kanal seçin.</p>", "<p>Please select an Open Channel in the Contact Center.</p>"), "", p.lang);
    try {
      // AUTH_ID bu portalın geçerli bir yöneticisine mi ait?
      const viewer = { ...portal, accessToken: p.authId, refreshToken: "", expiresAt: 0 };
      const admin = await b24Call(store, viewer, "user.admin");
      if (admin !== true) return page(res, 403, pick(p.lang, "Yetki gerekli", "Permission required"), pick(p.lang, "<p>Kanalı yalnız Bitrix24 yöneticisi bağlayabilir.</p>", "<p>Only a Bitrix24 administrator can connect the channel.</p>"), "", p.lang);
    } catch {
      return page(res, 401, pick(p.lang, "Bitrix oturumu doğrulanamadı", "Bitrix24 session could not be verified"), pick(p.lang, "<p>Sayfayı Bitrix24 içinden yeniden açın.</p>", "<p>Please reopen the page from inside Bitrix24.</p>"), "", p.lang);
    }
    const ticket = settingsTicket(portal.id, line);
    const L = p.lang;
    const text = {
      connected: pick(L, "Bağlandı", "Connected"),
      arrive: pick(L, "Mesajlar bu Açık Kanal'a düşecek.", "Messages will arrive in this Open Channel."),
      offline: pick(L, "Sunucuya ulaşılamadı.", "The server could not be reached."),
      confirm: pick(L, "WhatsApp bağlantısı kesilsin mi?", "Disconnect WhatsApp?"),
    };
    page(
      res,
      200,
      `${pick(L, "WhatsApp bağla", "Connect WhatsApp")} · ${pick(L, "Açık Kanal", "Open Channel")} ${line}`,
      `<ol class="steps"><li>${pick(L, "Telefonunuzda WhatsApp'ı açın.", "Open WhatsApp on your phone.")}</li><li><b>${pick(L, "Ayarlar → Bağlı cihazlar → Cihaz bağla", "Settings → Linked devices → Link a device")}</b>.</li><li>${pick(L, "Aşağıdaki kodu okutun.", "Scan the code below.")}</li></ol>
<div class="qr" id="qr"><p>${pick(L, "QR hazırlanıyor…", "Preparing QR…")}</p></div>
<p><button id="disconnect" style="display:none">${pick(L, "Bağlantıyı kes", "Disconnect")}</button></p>`,
      `<script>
const T=${JSON.stringify(ticket)},X=${JSON.stringify(text).replace(/</g, "\\u003c")};const q=s=>document.getElementById(s);
async function api(path){const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({t:T,lang:${JSON.stringify(L)}})});return r.json();}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
async function tick(){try{const s=await api("/b24/api/status");
if(s.status==="connected"){q("qr").innerHTML='<p class="ok">'+esc(X.connected)+': +'+esc(s.phone||"")+'</p><p>'+esc(X.arrive)+'</p>';q("disconnect").style.display="inline-block";return setTimeout(tick,15000);}
const r=await api("/b24/api/qr");if(r.qr){q("qr").innerHTML='<img alt="WhatsApp QR" src="'+esc(r.qr)+'">';}else if(r.message){q("qr").innerHTML='<p class="err">'+esc(r.message)+'</p>';}}catch(e){q("qr").innerHTML='<p class="err">'+esc(X.offline)+'</p>';}
setTimeout(tick,5000);}
q("disconnect").onclick=async()=>{if(!confirm(X.confirm))return;await api("/b24/api/disconnect");location.reload();};
tick();
</script>`,
      L,
    );
  };
  app.get("/b24/settings", settings);
  app.post("/b24/settings", form, settings);

  // Ayar sayfasının JSON uçları (bilet ile).
  const ticketed = (handler: (portal: B24Portal, line: string, req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const ticket = readTicket(req.body?.t);
      const reqLang = req.body?.lang === "en" || req.body?.lang === "tr" ? (req.body.lang as Lang) : null;
      if (!ticket) return res.status(401).json({ error: "TICKET", message: localizeMessage("Sayfanın süresi doldu; yeniden açın.", reqLang || "tr") });
      const portal = await portalById(store, ticket.memberId);
      if (!portal || !portal.active) return res.status(404).json({ error: "NOT_INSTALLED" });
      try {
        await handler(portal, ticket.line, req, res);
      } catch (error) {
        const e = error as Error & { statusCode?: number };
        res.status(e.statusCode && e.statusCode < 600 ? e.statusCode : 502).json({ error: "FAILED", message: localizeMessage(e.message, reqLang || langOf(portal)) });
      }
    };
  const json = express.json({ limit: "8kb" });
  const lineTicketed = (fn: (portal: B24Portal, line: string) => Promise<unknown>) =>
    ticketed(async (portal, line, _req, res) => {
      if (!/^\d{1,9}$/.test(line)) return res.status(401).json({ error: "TICKET" });
      res.json(localizeResult(await fn(portal, line), langOf(portal)));
    });
  app.post("/b24/api/qr", json, lineTicketed((portal, line) => connectionQr(store, portal, line)));
  app.post("/b24/api/status", json, lineTicketed((portal, line) => connectionStatus(store, portal, line)));
  app.post("/b24/api/disconnect", json, lineTicketed((portal, line) => connectionDisconnect(store, portal, line)));

  registerPanelRoutes(app, store, ticketed, json);

  // Bitrix olayları: temsilci mesajı, kanal silme, uygulama kaldırma.
  app.post("/b24/events", form, async (req, res) => {
    const body = req.body || {};
    const auth = body.auth || {};
    const memberId = String(auth.member_id || "");
    const portal = memberIdOk(memberId) ? await portalById(store, memberId) : null;
    if (!portal) return res.status(404).json({ error: "NOT_INSTALLED" });
    const token = String(auth.application_token || "");
    if (!token) return res.status(401).json({ error: "NO_TOKEN" });
    if (portal.applicationToken) {
      const a = Buffer.from(portal.applicationToken);
      const b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "BAD_TOKEN" });
    } else {
      // Anahtar henüz bilinmiyor: olayın içindeki erişim belirteciyle portalın
      // kendi (kurulumda doğrulanmış) REST adresine sorarız. Ancak gerçek bir
      // Bitrix olayıysa anahtar sabitlenir; sonrakiler bununla doğrulanır.
      const accessToken = String(auth.access_token || "");
      const sameDomain = !auth.domain || cleanDomain(auth.domain) === portal.domain;
      const genuine =
        accessToken && sameDomain
          ? await b24Call(store, { ...portal, accessToken, refreshToken: "", expiresAt: 0 }, "app.info").then(
              (r) => Boolean(r),
              () => false,
            )
          : false;
      if (!genuine) return res.status(401).json({ error: "UNVERIFIED" });
      portal.applicationToken = token;
      await savePortal(store, portal);
    }
    res.json({ ok: true });
    const event = String(body.event || "").toUpperCase();
    const data = body.data || {};
    try {
      if (event === "ONIMCONNECTORMESSAGEADD" && data.CONNECTOR === CONNECTOR_ID) {
        const messages = Array.isArray(data.MESSAGES) ? data.MESSAGES : Object.values(data.MESSAGES || {});
        await deliverFromBitrix(store, portal, String(data.LINE || ""), messages);
      } else if ((event === "ONIMCONNECTORLINEDELETE" || event === "ONIMCONNECTORSTATUSDELETE") && (data.CONNECTOR === CONNECTOR_ID || data.connector === CONNECTOR_ID || !data.CONNECTOR)) {
        const line = String(data.LINE || data.line || data || "").replace(/\D/g, "");
        if (line && portal.lines[line]) {
          await evolution(`/instance/logout/${encodeURIComponent(portal.lines[line].instance)}`, { method: "DELETE" }).catch(() => undefined);
          const lines = { ...portal.lines };
          delete lines[line];
          await savePortal(store, { ...portal, lines });
        }
      } else if (event === "ONAPPUNINSTALL") {
        await uninstallPortal(store, portal);
      }
    } catch (error) {
      console.warn("Bitrix olayı işlenemedi:", (error as Error).message);
    }
  });

  // Bitrix'in WhatsApp medyasını indirdiği imzalı adres.
  app.get("/b24/media/:memberId/:mediaId", async (req, res) => {
    const { memberId, mediaId } = req.params;
    const exp = Number(req.query.e || 0);
    const expected = sign(`media:${memberId}:${mediaId}:${exp}`);
    const given = String(req.query.s || "");
    if (!exp || exp < Date.now() / 1000 || given.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected)))
      return res.status(403).send("forbidden");
    const media = await readMedia(store, `b24:${memberId}`, mediaId);
    if (!media) return res.status(404).send("not found");
    res.setHeader("content-type", media.record.mime);
    res.setHeader("content-disposition", `attachment; filename="${encodeURIComponent(media.record.fileName)}"`);
    res.setHeader("x-content-type-options", "nosniff");
    res.send(media.buffer);
  });
}

// --- Yönetim paneli: bağlantılar, personel, roller ---------------------------
//
// Her bağlantı (WhatsApp numarası) ayrı bir Bitrix Açık Kanalı'dır. Kimin hangi
// numaranın sohbetlerini göreceği Bitrix'in kendi kuralıyla sağlanır: rolü o
// numarayı içeren personel, o Açık Kanal'ın operatör kuyruğuna yazılır.

export interface B24User {
  id: string;
  name: string;
  email: string;
  position: string;
}

export async function portalUsers(store: Store, portal: B24Portal): Promise<B24User[]> {
  const users: B24User[] = [];
  for (let start = 0; start < 2000; start += 50) {
    const batch = await b24Call(store, portal, "user.get", { FILTER: { ACTIVE: true, USER_TYPE: "employee" }, start });
    const list: any[] = Array.isArray(batch) ? batch : [];
    for (const u of list)
      users.push({
        id: String(u.ID),
        name: [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim() || String(u.EMAIL || `#${u.ID}`),
        email: String(u.EMAIL || ""),
        position: String(u.WORK_POSITION || ""),
      });
    if (list.length < 50) break;
  }
  return users;
}

/** Bir kullanıcının rolü (atanmış yoksa varsayılan rol). */
export function roleOf(portal: B24Portal, userId: string): B24Role | undefined {
  const roles = portal.roles || [];
  const assigned = portal.assignments?.[userId];
  return roles.find((r) => r.id === assigned) || roles.find((r) => r.isDefault);
}
export const roleAllows = (role: B24Role | undefined, line: string) =>
  Boolean(role && (role.lines === "all" || role.lines.includes(line)));

/** Açık Kanal kuyruklarını rollere göre günceller; hataları döndürür. */
export async function syncQueues(store: Store, portal: B24Portal, users?: B24User[]): Promise<string[]> {
  if (!(portal.roles || []).length) return [];
  const list = users || (await portalUsers(store, portal));
  const warnings: string[] = [];
  for (const [line, info] of Object.entries(portal.lines)) {
    const queue = list.filter((u) => roleAllows(roleOf(portal, u.id), line)).map((u) => Number(u.id));
    if (!queue.length) {
      warnings.push(`${info.name || `Kanal ${line}`}: hiçbir personelin rolü bu numarayı içermiyor; kuyruk değiştirilmedi.`);
      continue;
    }
    try {
      await b24Call(store, portal, "imopenlines.config.update", { CONFIG_ID: line, PARAMS: { QUEUE: queue } });
    } catch (error) {
      warnings.push(`${info.name || `Kanal ${line}`}: ${(error as Error).message}`);
    }
  }
  return warnings;
}

function publicConnections(portal: B24Portal) {
  return Object.entries(portal.lines).map(([line, l]) => ({
    line,
    name: l.name || `WhatsApp ${line}`,
    phone: l.phone || "",
    profileName: l.profileName || "",
    status: l.status,
    connectedAt: l.connectedAt || "",
    options: lineOptions(l),
  }));
}

/** Kartlar için numara başına özet: son mesaj, bugünkü hacim, sohbet ve bekleyen sayısı. */
async function connectionActivity(store: Store, portal: B24Portal) {
  const chats = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((c) => c.memberId === portal.id);
  const today = (await store.get<DayStat>(STAT_KIND, `${portal.id}:${istanbulDay()}`, SYSTEM_OWNER))?.payload;
  const out: Record<string, { lastMessageAt: number; chats: number; waiting: number; todayIn: number; todayOut: number }> = {};
  for (const line of Object.keys(portal.lines))
    out[line] = { lastMessageAt: 0, chats: 0, waiting: 0, todayIn: today?.lines[line]?.inbound || 0, todayOut: today?.lines[line]?.outbound || 0 };
  for (const c of chats) {
    const a = out[c.line];
    if (!a) continue;
    a.chats += 1;
    if (c.waitingSince) a.waiting += 1;
    a.lastMessageAt = Math.max(a.lastMessageAt, c.lastInboundAt || 0, c.lastOutboundAt || 0);
  }
  return out;
}

const cleanName = (v: unknown, max = 80) => String(v || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

/** Uç cevabındaki kullanıcıya dönük metinleri (message, warnings) çevirir. */
function localizeResult(result: unknown, lang: Lang) {
  if (lang === "tr" || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const out: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  if (typeof out.message === "string") out.message = localizeMessage(out.message, lang);
  if (Array.isArray(out.warnings)) out.warnings = out.warnings.map((w) => (typeof w === "string" ? localizeMessage(w, lang) : w));
  return out;
}

function registerPanelRoutes(
  app: Express,
  store: Store,
  ticketed: (h: (portal: B24Portal, line: string, req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => Promise<unknown>,
  json: express.RequestHandler,
) {
  const panel = (fn: (portal: B24Portal, body: any) => Promise<unknown>) =>
    ticketed(async (portal, scope, req, res) => {
      if (scope !== "all") return res.status(401).json({ error: "TICKET" });
      const lang = req.body?.lang === "en" || req.body?.lang === "tr" ? (req.body.lang as Lang) : langOf(portal);
      res.json(localizeResult(await fn(portal, req.body || {}), lang));
    });
  const lineOf = (portal: B24Portal, body: any) => {
    const line = String(body.line || "").replace(/\D/g, "");
    if (!line || !portal.lines[line]) throw Object.assign(new Error("Bağlantı bulunamadı."), { statusCode: 404 });
    return line;
  };
  const fresh = async (portal: B24Portal) => (await portalById(store, portal.id)) || portal;
  registerBillingPanelRoutes(app, store, panel, json);
  registerAgentPanelRoutes(app, store, panel, json);
  registerLivePanelRoutes(app, store, panel, json);
  registerCampaignRoutes(app, store, panel, json);

  app.post(
    "/b24/panel/state",
    json,
    panel(async (portal) => {
      // Kartlar gerçek durumu göstersin: webhook kaçsa da Evolution'dan oku.
      for (const line of Object.keys(portal.lines)) {
        try {
          await connectionStatus(store, (await fresh(portal)), line);
        } catch {
          /* WhatsApp sunucusuna ulaşılamazsa son bilinen durum gösterilir */
        }
      }
      const current = await fresh(portal);
      const users = await portalUsers(store, current).catch(() => [] as B24User[]);
      const activity = await connectionActivity(store, current);
      const pricing = await getPricing(store);
      return {
        domain: current.domain,
        connections: publicConnections(current).map((c) => ({ ...c, ...(activity[c.line] || {}), license: licenseState(current, current.lines[c.line], pricing.trialDays) })),
        roles: current.roles || [],
        users: users.map((u) => ({ ...u, roleId: current.assignments?.[u.id] || "" })),
        settings: portalSettings(current),
        quickReplies: current.quickReplies || [],
        plan: portalPlan(current, pricing.trialDays),
        aiConfigured: aiConfigured(),
      };
    }),
  );

  app.post(
    "/b24/panel/quick/save",
    express.json({ limit: "256kb" }),
    panel(async (portal, body) => {
      const next = await fresh(portal);
      const owner = quickOwner(portal.id);
      // Yalnız bu portala yüklenmiş dosyalar kabul edilir; kullanılmayanlar silinir.
      const items = [];
      for (const r of cleanQuickReplies(body.items)) {
        if (r.media && !(await readMedia(store, owner, r.media.id))) {
          if (!r.text) continue;
          delete r.media;
        }
        items.push(r);
      }
      next.quickReplies = items;
      await savePortal(store, next);
      const used = new Set(items.map((r) => r.media?.id).filter(Boolean));
      await deleteMedia(store, owner, (m) => !used.has(m.id) && Date.now() - Date.parse(m.createdAt) > 60 * 60_000);
      return { quickReplies: next.quickReplies };
    }),
  );
  // Hazır cevaba dosya yükleme (ham gövde; bilet başlıkta)
  app.post("/b24/panel/quick/upload", express.raw({ type: () => true, limit: MAX_MEDIA_BYTES + 1024 }), async (req, res) => {
    const ticket = readTicket(req.get("x-xre-ticket"));
    if (!ticket || ticket.line !== "all") return res.status(401).json({ error: "TICKET" });
    const portal = await portalById(store, ticket.memberId);
    if (!portal?.active) return res.status(404).json({ error: "NOT_INSTALLED" });
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const lang = langOf(portal);
    if (!buffer.length) return res.status(400).json({ error: "EMPTY", message: localizeMessage("Dosya boş.", lang) });
    if (buffer.length > MAX_MEDIA_BYTES) return res.status(413).json({ error: "TOO_BIG", message: localizeMessage("Dosya 16 MB sınırını aşıyor.", lang) });
    let name = "";
    try {
      name = decodeURIComponent(String(req.get("x-file-name") || "")).slice(0, 120);
    } catch {
      name = "";
    }
    const record = await saveMedia(store, quickOwner(portal.id), buffer, String(req.get("content-type") || "application/octet-stream"), name);
    res.json({ media: { id: record.id, name: record.fileName, mime: record.mime, type: record.mediaType } });
  });
  // Hazır cevap dosyasının önizlemesi (panel)
  app.get("/b24/panel/quick/media/:id", async (req, res) => {
    const ticket = readTicket(req.query.t);
    if (!ticket || ticket.line !== "all") return res.status(401).end();
    const media = await readMedia(store, quickOwner(ticket.memberId), String(req.params.id || ""));
    if (!media) return res.status(404).end();
    sendQuickMedia(res, media);
  });

  app.post(
    "/b24/panel/settings/save",
    json,
    panel(async (portal, body) => {
      const next = await fresh(portal);
      next.settings = {
        translate: body.translate !== false,
        transcribe: body.transcribe !== false,
        qualify: body.qualify !== false,
        slaMinutes: Math.max(1, Math.min(1440, Math.round(Number(body.slaMinutes) || 15))),
        botMessages: body.botMessages === true,
        alerts: body.alerts === true,
        alertAgentMin: clampMin(body.alertAgentMin, 15),
        alertManagerMin: clampMin(body.alertManagerMin, 30),
        alertTelegram: body.alertTelegram !== false,
        alertWorkHours: body.alertWorkHours !== false,
        // Alarm yeni açıldıysa eski bekleyişler uyarı göndermez.
        alertsSince: body.alerts === true ? (portalSettings(next).alerts ? portalSettings(next).alertsSince || Date.now() : Date.now()) : 0,
      };
      if (next.settings.alerts) await requireFeature(store, next, "alerts");
      const changed = portalSettings(next).botMessages !== portalSettings(portal).botMessages;
      await savePortal(store, next);
      const warnings = changed ? await applyLineAutoMessages(store, next) : [];
      return { settings: portalSettings(next), warnings };
    }),
  );

  // Ekip performansı: temsilci ilk cevap süreleri, numara hacimleri, bekleyen ve sıcak sohbetler.
  app.post(
    "/b24/panel/stats",
    json,
    panel(async (portal, body) => {
      await requireFeature(store, portal, "perf");
      const days = [1, 7, 30, 90].includes(Number(body.days)) ? Number(body.days) : 7;
      const onlyLine = String(body.line || "").replace(/\D/g, "");
      const from = istanbulDay(Date.now() - (days - 1) * 86_400_000);
      const stats = (await store.list<DayStat>(STAT_KIND, SYSTEM_OWNER))
        .map((r) => r.payload)
        .filter((s) => s.memberId === portal.id && s.day >= from)
        .sort((a, b) => a.day.localeCompare(b.day));
      const pick = (s: DayStat) => Object.entries(s.lines).filter(([id]) => !onlyLine || id === onlyLine);
      const byDay = new Map(stats.map((s) => [s.day, s]));
      const series: { day: string; inbound: number; outbound: number }[] = [];
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = istanbulDay(Date.now() - i * 86_400_000);
        const s = byDay.get(d);
        const rows = s ? pick(s) : [];
        series.push({ day: d, inbound: rows.reduce((a, [, l]) => a + l.inbound, 0), outbound: rows.reduce((a, [, l]) => a + l.outbound, 0) });
      }
      const hours = Array.from({ length: 24 }, () => 0);
      for (const s of stats) {
        const src = onlyLine ? s.lineHours?.[onlyLine] : s.hours;
        src?.forEach((v, i) => (hours[i] += v));
      }
      const agents: Record<string, { replies: number; responses: number; responseSec: number; maxSec: number }> = {};
      const lines: Record<string, { inbound: number; outbound: number; newChats: number; responses: number; responseSec: number; samples: number[] }> = {};
      for (const s of stats) {
        for (const [id, a] of Object.entries(s.agents)) {
          const t = (agents[id] ||= { replies: 0, responses: 0, responseSec: 0, maxSec: 0 });
          t.replies += a.replies;
          t.responses += a.responses;
          t.responseSec += a.responseSec;
          t.maxSec = Math.max(t.maxSec, a.maxSec);
        }
        for (const [id, l] of pick(s)) {
          const t = (lines[id] ||= { inbound: 0, outbound: 0, newChats: 0, responses: 0, responseSec: 0, samples: [] });
          t.inbound += l.inbound;
          t.outbound += l.outbound;
          t.newChats += l.newChats;
          t.responses += l.responses || 0;
          t.responseSec += l.responseSec || 0;
          t.samples.push(...(l.samples || []));
        }
      }
      const chats = (await store.list<B24Chat>(CHAT_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((c) => c.memberId === portal.id && (!onlyLine || c.line === onlyLine));
      const now = Date.now();
      const sla = portalSettings(portal).slaMinutes * 60_000;
      const waiting = chats
        .filter((c) => c.waitingSince)
        .map((c) => ({ line: c.line, phone: c.phone, name: c.name, waitingMinutes: Math.round((now - (c.waitingSince as number)) / 60_000), late: now - (c.waitingSince as number) > sla }))
        .sort((a, b) => b.waitingMinutes - a.waitingMinutes)
        .slice(0, 50);
      const hot = chats
        .filter((c) => c.qualification && now - c.qualification.at < days * 86_400_000)
        .sort((a, b) => (b.qualification!.score || 0) - (a.qualification!.score || 0))
        .slice(0, 20)
        .map((c) => ({
          line: c.line,
          phone: c.phone,
          name: c.name,
          lang: c.lang || "",
          score: c.qualification!.score,
          temperature: c.qualification!.temperature,
          summary: c.qualification!.summary,
          budget: c.qualification!.budget,
          currency: c.qualification!.currency,
          location: c.qualification!.location,
        }));
      return {
        days,
        slaMinutes: portalSettings(portal).slaMinutes,
        agents: Object.entries(agents).map(([id, a]) => ({ id, replies: a.replies, avgSec: a.responses ? Math.round(a.responseSec / a.responses) : null, maxSec: a.maxSec })),
        lines: Object.entries(lines).map(([line, l]) => ({
          line,
          inbound: l.inbound,
          outbound: l.outbound,
          newChats: l.newChats,
          avgSec: l.responses ? Math.round(l.responseSec / l.responses) : null,
          medianSec: median(l.samples),
          waiting: chats.filter((c) => c.line === line && c.waitingSince).length,
        })),
        series,
        hours,
        medianSec: median(Object.values(lines).flatMap((l) => l.samples)),
        waiting,
        hot,
        foreign: chats.filter((c) => c.lang && c.lang !== "tr").length,
      };
    }),
  );

  app.post(
    "/b24/panel/connection/add",
    json,
    panel(async (portal, body) => {
      const name = cleanName(body.name) || "WhatsApp";
      const created = await b24Call(store, portal, "imopenlines.config.add", {
        PARAMS: { LINE_NAME: `${name} (WhatsApp)`, ...(portalSettings(portal).botMessages ? {} : QUIET_LINE_PARAMS) },
      });
      const line = String(created || "").replace(/\D/g, "");
      if (!line) throw new Error("Bitrix yeni Açık Kanal oluşturmadı.");
      const instance = instanceName(portal.id, line);
      await store.put(INSTANCE_KIND, instance, { id: instance, memberId: portal.id, line }, SYSTEM_OWNER);
      const next = await fresh(portal);
      next.lines = { ...next.lines, [line]: { instance, name, status: "new", updatedAt: new Date().toISOString() } };
      await savePortal(store, next);
      return { line, warnings: await syncQueues(store, next).catch(() => []) };
    }),
  );
  app.post("/b24/panel/connection/qr", json, panel((portal, body) => connectionQr(store, portal, lineOf(portal, body))));
  app.post("/b24/panel/connection/status", json, panel((portal, body) => connectionStatus(store, portal, lineOf(portal, body))));
  app.post("/b24/panel/connection/disconnect", json, panel((portal, body) => connectionDisconnect(store, portal, lineOf(portal, body))));
  app.post(
    "/b24/panel/connection/options",
    json,
    panel(async (portal, body) => {
      const line = lineOf(portal, body);
      const next = await fresh(portal);
      next.lines[line] = { ...next.lines[line], options: { calls: body.calls !== false, groups: body.groups === true, edits: body.edits !== false } };
      await savePortal(store, next);
      return { options: lineOptions(next.lines[line]) };
    }),
  );
  app.post(
    "/b24/panel/connection/rename",
    json,
    panel(async (portal, body) => {
      const line = lineOf(portal, body);
      const name = cleanName(body.name);
      if (!name) throw Object.assign(new Error("Ad boş olamaz."), { statusCode: 400 });
      const next = await fresh(portal);
      next.lines[line] = { ...next.lines[line], name };
      await savePortal(store, next);
      await b24Call(store, next, "imopenlines.config.update", { CONFIG_ID: line, PARAMS: { LINE_NAME: `${name} (WhatsApp)` } }).catch(() => undefined);
      return { ok: true };
    }),
  );
  app.post(
    "/b24/panel/connection/delete",
    json,
    panel(async (portal, body) => {
      const line = lineOf(portal, body);
      await connectionDisconnect(store, portal, line);
      const next = await fresh(portal);
      const lines = { ...next.lines };
      delete lines[line];
      const roles = (next.roles || []).map((r) => (r.lines === "all" ? r : { ...r, lines: r.lines.filter((l) => l !== line) }));
      await savePortal(store, { ...next, lines, roles });
      return { ok: true };
    }),
  );

  app.post(
    "/b24/panel/role/save",
    json,
    panel(async (portal, body) => {
      const name = cleanName(body.name, 60);
      if (!name) throw Object.assign(new Error("Rol adı gerekli."), { statusCode: 400 });
      const next = await fresh(portal);
      const lines: string[] | "all" =
        body.lines === "all"
          ? "all"
          : (Array.isArray(body.lines) ? body.lines : []).map((l: unknown) => String(l)).filter((l: string) => next.lines[l]);
      const roles = [...(next.roles || [])];
      const id = String(body.id || "") || `role_${crypto.randomBytes(5).toString("hex")}`;
      const role: B24Role = { id, name, lines, isDefault: Boolean(body.isDefault) };
      const index = roles.findIndex((r) => r.id === id);
      if (index >= 0) roles[index] = role;
      else roles.push(role);
      next.roles = role.isDefault ? roles.map((r) => (r.id === id ? r : { ...r, isDefault: false })) : roles;
      await savePortal(store, next);
      return { role, warnings: await syncQueues(store, next) };
    }),
  );
  app.post(
    "/b24/panel/role/delete",
    json,
    panel(async (portal, body) => {
      const next = await fresh(portal);
      const id = String(body.id || "");
      next.roles = (next.roles || []).filter((r) => r.id !== id);
      next.assignments = Object.fromEntries(Object.entries(next.assignments || {}).filter(([, roleId]) => roleId !== id));
      await savePortal(store, next);
      return { ok: true, warnings: await syncQueues(store, next) };
    }),
  );
  app.post(
    "/b24/panel/user/role",
    json,
    panel(async (portal, body) => {
      const userId = String(body.userId || "").replace(/\D/g, "");
      const roleId = String(body.roleId || "");
      if (!userId) throw Object.assign(new Error("Personel seçilmedi."), { statusCode: 400 });
      const next = await fresh(portal);
      if (roleId && !(next.roles || []).some((r) => r.id === roleId))
        throw Object.assign(new Error("Rol bulunamadı."), { statusCode: 400 });
      const assignments = { ...(next.assignments || {}) };
      if (roleId) assignments[userId] = roleId;
      else delete assignments[userId];
      next.assignments = assignments;
      await savePortal(store, next);
      return { ok: true, warnings: await syncQueues(store, next) };
    }),
  );
}


/**
 * XRE WhatsApp panelindeki role göre bir Bitrix kullanıcısının kullanabileceği
 * WhatsApp numaraları. null: kısıt yok (rol tanımlanmamış ya da "tüm numaralar").
 * CRM'in kendi gelen kutusu da (Bitrix içindeki eski uygulama) bu listeye uyar.
 */
export async function allowedPhonesForBitrixUser(store: Store, domain: string, userId: string): Promise<string[] | null> {
  const portals = (await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)).map((r) => r.payload);
  const portal = portals.find((p) => p.active && p.domain === domain);
  if (!portal || !(portal.roles || []).length) return null;
  const role = roleOf(portal, userId);
  if (!role) return [];
  if (role.lines === "all") return null;
  return role.lines.map((line) => portal.lines[line]?.phone || "").filter(Boolean);
}
