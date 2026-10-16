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
import { panelHtml } from "./b24-panel-html.js";
import { onCustomerMessage, registerAgentPanelRoutes, type AgentConfig } from "./b24-agent.js";
import { registerLivePanelRoutes, type ReportSettings } from "./b24-live.js";
import { adminHtml } from "./b24-admin-html.js";
import { getPricing, licenseState, lineUsable, registerBillingPanelRoutes, withTrialStarted } from "./b24-billing.js";
import { aiConfigured, detectAndTranslate, languageName, qualificationComment, qualifyConversation, transcribe, translateTo, type Qualification } from "./b24-ai.js";
export { panelHtml };
import type { Store } from "./db.js";
import { evolutionBase, evolutionWebhookConfig, getEvolutionQr, jidPhone } from "./integrations.js";
import { envConfigured, fetchWithTimeout, normalizePhone, readJsonResponse } from "./security.js";
import {
  captureEvolutionMedia,
  isWaSystemMessage,
  readMedia,
  saveMedia,
  sendEvolutionMedia,
  unwrapWaMessage,
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
}
export interface B24Settings {
  translate?: boolean;
  transcribe?: boolean;
  qualify?: boolean;
  slaMinutes?: number;
}
export function portalSettings(portal: B24Portal): Required<B24Settings> {
  return {
    translate: portal.settings?.translate !== false,
    transcribe: portal.settings?.transcribe !== false,
    qualify: portal.settings?.qualify !== false,
    slaMinutes: Math.max(1, Math.min(1440, Number(portal.settings?.slaMinutes) || 15)),
  };
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
}
const chatId = (memberId: string, line: string, phone: string) => `${memberId}:${line}:${phone}`;
export async function loadChat(store: Store, memberId: string, line: string, phone: string, name = ""): Promise<B24Chat> {
  const id = chatId(memberId, line, phone);
  const found = (await store.get<B24Chat>(CHAT_KIND, id, SYSTEM_OWNER))?.payload;
  return found || { id, memberId, line, phone, name, inbound: 0, outbound: 0, sinceQualify: 0, history: [] };
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
  const q = await qualifyConversation(chat.history.map(({ from, text }) => ({ from, text })));
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
  await b24Call(store, portal, "crm.timeline.comment.add", { fields: { ENTITY_ID: entityId, ENTITY_TYPE: entityType, COMMENT: qualificationComment(q) } });
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
  paidUntil?: string;
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
const defaultFetch: Fetcher = async (url, init) => readJsonResponse(await fetchWithTimeout(url, init, 20_000));
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
function readTicket(ticket: unknown): { memberId: string; line: string } | null {
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

async function refresh(store: Store, portal: B24Portal): Promise<B24Portal> {
  if (!env("B24_CLIENT_ID") || !env("B24_CLIENT_SECRET"))
    throw Object.assign(new Error("B24_CLIENT_ID / B24_CLIENT_SECRET tanımlı değil."), { statusCode: 503 });
  const url = `https://oauth.bitrix.info/oauth/token/?${new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env("B24_CLIENT_ID"),
    client_secret: env("B24_CLIENT_SECRET"),
    refresh_token: portal.refreshToken,
  })}`;
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
export async function b24Call(store: Store, portalIn: B24Portal, method: string, params: Record<string, unknown> = {}) {
  let portal = portalIn;
  if (portal.expiresAt && portal.expiresAt < Date.now() + 60_000 && portal.refreshToken) portal = await refresh(store, portal);
  const call = (p: B24Portal) =>
    fetcher(`${p.clientEndpoint.replace(/\/?$/, "/")}${method}.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...params, auth: p.accessToken }),
    }).catch((error) => ({ error: "HTTP", error_description: error instanceof Error ? error.message : String(error) }));
  let data = await call(portal);
  if ((data?.error === "expired_token" || data?.error === "invalid_token") && portal.refreshToken) {
    portal = await refresh(store, portal);
    data = await call(portal);
  }
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
    NAME: "XRE WhatsApp",
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

async function activateLine(store: Store, portal: B24Portal, line: string, active: boolean) {
  await b24Call(store, portal, "imconnector.activate", { CONNECTOR: CONNECTOR_ID, LINE: line, ACTIVE: active ? 1 : 0 });
  if (active) {
    const info = portal.lines[line];
    await b24Call(store, portal, "imconnector.connector.data.set", {
      CONNECTOR: CONNECTOR_ID,
      LINE: line,
      DATA: {
        id: `${CONNECTOR_ID}_${line}`,
        name: info?.phone ? `WhatsApp +${info.phone}` : "XRE WhatsApp",
        url: info?.phone ? `https://wa.me/${info.phone}` : "https://wa.me",
        url_im: info?.phone ? `https://wa.me/${info.phone}` : "https://wa.me",
      },
    }).catch(() => undefined);
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
  const userId = isGroup ? msg.sender || msg.phone : msg.phone;
  await b24Call(store, portal, "imconnector.send.messages", {
    CONNECTOR: CONNECTOR_ID,
    LINE: line,
    MESSAGES: [
      {
        user: { id: userId, name: msg.name || (isGroup ? "Grup üyesi" : `+${msg.phone}`), ...(isGroup && !msg.sender ? {} : { phone: `+${userId}`, skip_phone_validate: "Y" }) },
        message: { id: msg.id, date: Math.floor(Date.now() / 1000), text: msg.text },
        chat: { id: msg.phone, name: isGroup ? "WhatsApp grubu" : msg.name || `+${msg.phone}` },
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
          license: open ? withTrialStarted(previous) : previous?.license,
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
        text: call?.isVideo ? "🎥 Görüntülü WhatsApp araması geldi. Cevaplamak için telefonu kullanın." : "📞 WhatsApp araması geldi. Cevaplamak için telefonu kullanın.",
      });
    }
    return;
  }

  if (!event.startsWith("messages.upsert") && !data?.key) return;
  const key = data?.key || {};
  if (key.fromMe) return;
  const remoteJid = String(key.remoteJid || "");
  const isGroup = remoteJid.endsWith("@g.us");
  if (!remoteJid.endsWith("@s.whatsapp.net") && !(isGroup && options.groups)) return; // durumlar ve (kapalıysa) gruplar aktarılmaz
  const sender = isGroup ? normalizePhone(jidPhone(key.participant || data?.participant || "")) : "";
  const phone = isGroup ? `${remoteJid.split("@")[0]}@g.us` : normalizePhone(remoteJid.split("@")[0]);
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
      text: edited ? `✏️ Müşteri mesajını düzenledi: ${edited}` : "🗑 Müşteri bir mesajını sildi.",
    });
    return;
  }
  const message = unwrapWaMessage(rawMessage);
  if (isWaSystemMessage(message)) return;
  const owner = `b24:${portal.id}`;
  const media = await captureEvolutionMedia(store, owner, instance, data);
  const settings = portalSettings(portal);
  let text = waMessageText(message) || "";
  if (media.mediaType === "audio" && media.mediaId && settings.transcribe && aiConfigured()) {
    try {
      const audio = await readMedia(store, owner, media.mediaId);
      const transcript = audio ? await transcribe(audio.buffer, audio.record.mime, audio.record.fileName) : "";
      if (transcript) text = `🎤 Sesli mesaj: ${transcript}`;
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
  let turkish = text;
  if (settings.translate && text && aiConfigured()) {
    try {
      const body = text.replace(/^🎤 Sesli mesaj: /, "");
      const result = await detectAndTranslate(body);
      if (result.lang) chat.lang = result.lang;
      if (result.lang && result.lang !== "tr" && result.translation) {
        turkish = (text.startsWith("🎤") ? "🎤 Sesli mesaj: " : "") + result.translation;
        display = `🌐 ${languageName(result.lang)} → Türkçe:\n${turkish}\n\n[i]Orijinal: ${body}[/i]`;
      }
    } catch (error) {
      console.warn("Çeviri yapılamadı:", (error as Error).message);
    }
  }
  const now = Date.now();
  chat.inbound += 1;
  chat.sinceQualify += 1;
  chat.lastInboundAt = now;
  if (!chat.waitingSince) chat.waitingSince = now;
  if (turkish) chat.history.push({ from: "müşteri", text: turkish, at: now });
  await saveChat(store, chat);
  await bumpStat(store, portal.id, (s) => {
    const l = lineStat(s, map.line);
    l.inbound += 1;
    if (isNew) l.newChats += 1;
    recordInbound(s, map.line);
  });
  const files = media.mediaId
    ? [{ url: mediaUrl(base, portal.id, media.mediaId), name: media.fileName || "dosya" }]
    : [];
  await b24Call(store, portal, "imconnector.send.messages", {
    CONNECTOR: CONNECTOR_ID,
    LINE: map.line,
    MESSAGES: [
      {
        user: isGroup
          ? { id: sender || phone, name: String(data?.pushName || "").slice(0, 120) || (sender ? `+${sender}` : "Grup üyesi"), ...(sender ? { phone: `+${sender}`, skip_phone_validate: "Y" } : {}) }
          : {
              id: phone,
              name: String(data?.pushName || "").slice(0, 120) || `+${phone}`,
              phone: `+${phone}`,
              skip_phone_validate: "Y",
            },
        message: {
          id: String(key.id || crypto.randomUUID()),
          date: Math.floor(Number(data?.messageTimestamp || Date.now() / 1000)),
          text: display || (files.length ? "" : "[Medya]"),
          ...(files.length ? { files } : {}),
        },
        chat: { id: phone, name: isGroup ? "WhatsApp grubu" : String(data?.pushName || `+${phone}`).slice(0, 120) },
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

/** Bitrix temsilcisinin yazdığı mesajları WhatsApp'a iletir. */
async function deliverFromBitrix(store: Store, portal: B24Portal, line: string, messages: any[]) {
  const info = portal.lines[line];
  if (!info?.instance) return;
  if (!(await lineUsable(store, portal, line))) {
    console.warn(`XRE WhatsApp: ${portal.domain} kanal ${line} lisansı dolduğu için mesaj gönderilmedi.`);
    return;
  }
  const delivered: any[] = [];
  for (const item of messages) {
    const chatRef = String(item?.chat?.id || "");
    const to = chatRef.endsWith("@g.us") ? `${chatRef.split("@")[0].replace(/\D/g, "")}@g.us` : normalizePhone(chatRef);
    if (!to) continue;
    const agentText = String(item?.message?.text || "")
      .replace(/\[br\]/gi, "\n")
      .replace(/\[\/?(b|i|u|s|url[^\]]*)\]/gi, "")
      .trim();
    const chat = await loadChat(store, portal.id, line, to);
    // "!" ile başlayan mesaj çevrilmeden gönderilir.
    const raw = agentText.startsWith("!");
    let text = raw ? agentText.slice(1).trim() : agentText;
    if (!raw && text && portalSettings(portal).translate && chat.lang && chat.lang !== "tr") {
      try {
        text = await translateTo(text, chat.lang);
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
    const now = Date.now();
    const agent = await agentOf(store, portal, item);
    const waited = chat.waitingSince ? Math.max(0, Math.round((now - chat.waitingSince) / 1000)) : null;
    chat.outbound += 1;
    chat.lastOutboundAt = now;
    chat.waitingSince = null;
    // Temsilci yazdı: AI asistan bu sohbette bir süre susar.
    chat.agentState = "human";
    chat.humanAt = now;
    if (agentText) chat.history.push({ from: "temsilci", text: agentText.replace(/^!/, ""), at: now });
    await saveChat(store, chat);
    await bumpStat(store, portal.id, (s) => {
      const ls = lineStat(s, line);
      ls.outbound += 1;
      if (waited !== null) {
        ls.responses = (ls.responses || 0) + 1;
        ls.responseSec = (ls.responseSec || 0) + waited;
        ls.samples = [...(ls.samples || []), waited].slice(-500);
      }
      const a = agentStat(s, agent);
      a.replies += 1;
      if (waited !== null) {
        a.responses += 1;
        a.responseSec += waited;
        a.maxSec = Math.max(a.maxSec, waited);
      }
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
  const qr = await getEvolutionQr(instance);
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
        [line]: { ...known, instance, phone: owner.phone || known?.phone, profileName: owner.profileName || known?.profileName, connectedAt: known?.connectedAt || new Date().toISOString(), license: withTrialStarted(known), status: "connected", updatedAt: new Date().toISOString() },
      },
    };
    await savePortal(store, next);
    await activateLine(store, next, line, true);
    return { status: "connected", phone: next.lines[line].phone || "" };
  }
  return { status: connected ? "connected" : state || "disconnected", phone: known?.phone || "" };
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

function page(res: Response, status: number, title: string, body: string, script = "") {
  res
    .status(status)
    .type("html")
    .setHeader("cache-control", "no-store")
    .send(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XRE WhatsApp</title>
<style>body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f8fb;color:#1d2b3a}
.wrap{max-width:560px;margin:24px auto;padding:28px 30px;background:#fff;border:1px solid #dfe7ee;border-radius:14px;box-shadow:0 8px 30px rgba(15,40,70,.08)}
h1{font-size:19px;margin:0 0 6px}p{margin:6px 0;color:#4b5d70}.qr{display:grid;place-items:center;min-height:270px;margin:16px 0;border:1px dashed #cfdae4;border-radius:12px}
.qr img{width:250px;height:250px}.ok{color:#128c4b;font-weight:600}.err{color:#b42318}ol{padding-left:20px;color:#4b5d70}
button{padding:9px 16px;border-radius:9px;border:1px solid #cfdae4;background:#fff;font-weight:600;cursor:pointer}button.primary{background:#25D366;border-color:#25D366;color:#fff}</style>${script}</head>
<body><div class="wrap"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`);
}

function readBitrixParams(req: Request) {
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
  if (!env("B24_CLIENT_ID") || !env("B24_CLIENT_SECRET"))
    throw Object.assign(new Error("Sunucuda B24_CLIENT_ID / B24_CLIENT_SECRET tanımlı değil."), { statusCode: 503 });
  if (!p.refreshId) throw Object.assign(new Error("Bitrix kurulum bilgisi eksik (REFRESH_ID)."), { statusCode: 400 });
  const url = `https://oauth.bitrix.info/oauth/token/?${new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env("B24_CLIENT_ID"),
    client_secret: env("B24_CLIENT_SECRET"),
    refresh_token: p.refreshId,
  })}`;
  const data = await fetcher(url, { method: "GET" }).catch(() => null);
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
  };
}

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
    accessToken: verified.accessToken,
    refreshToken: verified.refreshToken,
    expiresAt: verified.expiresAt,
    // Kaldırılıp yeniden kurulan uygulamaya Bitrix yeni anahtar verir.
    applicationToken: existing?.active ? existing.applicationToken : undefined,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
    active: true,
    lines: existing?.lines || {},
  };
  // Belirteç gerçekten bu portala ve bir yöneticiye mi ait?
  const user = await b24Call(store, portal, "user.current");
  if (!user?.ID) throw new Error("Bitrix oturumu doğrulanamadı.");
  if ((await b24Call(store, portal, "user.admin")) !== true)
    throw Object.assign(new Error("Uygulamayı yalnız Bitrix24 yöneticisi kurabilir."), { statusCode: 403 });
  await savePortal(store, portal);
  await registerConnector(store, portal, base);
  return portal;
}

// --- Rotalar -----------------------------------------------------------------

export function registerB24ConnectorRoutes(app: Express, store: Store) {
  const form = express.urlencoded({ extended: true, limit: "256kb" });

  // Kurulum: belirteçleri sakla, bağlayıcıyı ve olayları kaydet.
  const install = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    if (!memberIdOk(p.memberId) || !p.domain || !p.authId)
      return page(res, 400, "Kurulum bilgisi eksik", "<p>Uygulamayı Bitrix24 içinden kurun.</p>");
    try {
      await installPortal(store, p, origin(req));
      page(
        res,
        200,
        "XRE WhatsApp kuruldu",
        `<p class="ok">Kurulum tamamlandı.</p>
<ol><li><b>İletişim Merkezi</b>'ni açın ve <b>XRE WhatsApp</b> kutucuğuna tıklayın.</li>
<li>Açık Kanal seçip bağlanın; açılan ekranda telefonunuzla QR kodu okutun.</li>
<li>WhatsApp mesajları artık Bitrix sohbetine düşer, cevaplarınız WhatsApp'tan gider.</li></ol>`,
        `<script src="https://api.bitrix24.com/api/v1/"></script><script>window.addEventListener("load",function(){try{BX24.init(function(){BX24.installFinish();});}catch(e){}});</script>`,
      );
    } catch (error) {
      console.warn("Bitrix bağlayıcı kurulumu başarısız:", (error as Error).message);
      const code = (error as Error & { statusCode?: number }).statusCode;
      page(res, code && code >= 400 && code < 500 ? code : 502, "Kurulum tamamlanamadı", `<p class="err">${escapeHtml((error as Error).message)}</p>`);
    }
  };
  app.get("/b24/install", install);
  app.post("/b24/install", form, install);

  // Uygulama ana sayfası (sol menü): yöneticiye yönetim paneli, personele kendi numaraları.
  const home = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    let portal = memberIdOk(p.memberId) ? await portalById(store, p.memberId) : null;
    if ((!portal || !portal.active) && memberIdOk(p.memberId) && p.domain && p.authId) {
      try {
        portal = await installPortal(store, p, origin(req));
        // installPortal açan kişinin bu portalın yöneticisi olduğunu doğruladı.
        res.status(200).type("html").setHeader("cache-control", "no-store").send(panelHtml(settingsTicket(portal.id, "all"), portal.domain));
        return;
      } catch (error) {
        console.warn("Bitrix bağlayıcı otomatik kurulumu başarısız:", (error as Error).message);
        return page(res, 502, "Kurulum tamamlanamadı", `<p class="err">${escapeHtml((error as Error).message)}</p>`);
      }
    }
    if (!portal || !portal.active || portal.domain !== p.domain)
      return page(res, 404, "Uygulama kurulu değil", "<p>Uygulamayı Bitrix24 içinden açın.</p>");
    const viewer = { ...portal, accessToken: p.authId, refreshToken: "", expiresAt: 0 };
    let user: any;
    let admin = false;
    try {
      user = await b24Call(store, viewer, "user.current");
      admin = (await b24Call(store, viewer, "user.admin")) === true;
    } catch {
      return page(res, 401, "Bitrix oturumu doğrulanamadı", "<p>Sayfayı Bitrix24 içinden yeniden açın.</p>");
    }
    if (admin) {
      res.status(200).type("html").setHeader("cache-control", "no-store").send(panelHtml(settingsTicket(portal.id, "all"), portal.domain));
      return;
    }
    const role = roleOf(portal, String(user?.ID || ""));
    const mine = publicConnections(portal).filter((c) => roleAllows(role, c.line));
    page(
      res,
      200,
      "XRE WhatsApp",
      `<p>WhatsApp sohbetleri Bitrix'in <b>Açık Kanallar</b> sohbetine düşer.</p>
<p>Rolünüz: <b>${escapeHtml(role?.name || "atanmamış")}</b></p>
${mine.length ? `<ul>${mine.map((c) => `<li>${escapeHtml(c.name)} ${c.phone ? `(+${escapeHtml(c.phone)})` : ""}</li>`).join("")}</ul>` : "<p>Size atanmış numara yok. Yöneticinizle görüşün.</p>"}`,
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
      return page(res, 404, "Uygulama kurulu değil", "<p>Uygulamayı yeniden kurun.</p>");
    if (!line) return page(res, 400, "Açık Kanal seçilmedi", "<p>İletişim Merkezi'nden bir Açık Kanal seçin.</p>");
    try {
      // AUTH_ID bu portalın geçerli bir yöneticisine mi ait?
      const viewer = { ...portal, accessToken: p.authId, refreshToken: "", expiresAt: 0 };
      const admin = await b24Call(store, viewer, "user.admin");
      if (admin !== true) return page(res, 403, "Yetki gerekli", "<p>Kanalı yalnız Bitrix24 yöneticisi bağlayabilir.</p>");
    } catch {
      return page(res, 401, "Bitrix oturumu doğrulanamadı", "<p>Sayfayı Bitrix24 içinden yeniden açın.</p>");
    }
    const ticket = settingsTicket(portal.id, line);
    page(
      res,
      200,
      `WhatsApp bağla · Açık Kanal ${line}`,
      `<ol><li>Telefonunuzda WhatsApp'ı açın.</li><li><b>Ayarlar → Bağlı cihazlar → Cihaz bağla</b>.</li><li>Aşağıdaki kodu okutun.</li></ol>
<div class="qr" id="qr"><p>QR hazırlanıyor…</p></div>
<p><button id="disconnect" style="display:none">Bağlantıyı kes</button></p>`,
      `<script>
const T=${JSON.stringify(ticket)};const q=s=>document.getElementById(s);
async function api(path){const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({t:T})});return r.json();}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
async function tick(){try{const s=await api("/b24/api/status");
if(s.status==="connected"){q("qr").innerHTML='<p class="ok">Bağlandı: +'+esc(s.phone||"")+'</p><p>Mesajlar bu Açık Kanal'+"'"+'a düşecek.</p>';q("disconnect").style.display="inline-block";return setTimeout(tick,15000);}
const r=await api("/b24/api/qr");if(r.qr){q("qr").innerHTML='<img alt="WhatsApp QR" src="'+esc(r.qr)+'">';}else if(r.message){q("qr").innerHTML='<p class="err">'+esc(r.message)+'</p>';}}catch(e){q("qr").innerHTML='<p class="err">Sunucuya ulaşılamadı.</p>';}
setTimeout(tick,5000);}
q("disconnect").onclick=async()=>{if(!confirm("WhatsApp bağlantısı kesilsin mi?"))return;await api("/b24/api/disconnect");location.reload();};
tick();
</script>`,
    );
  };
  app.get("/b24/settings", settings);
  app.post("/b24/settings", form, settings);

  // Ayar sayfasının JSON uçları (bilet ile).
  const ticketed = (handler: (portal: B24Portal, line: string, req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      const ticket = readTicket(req.body?.t);
      if (!ticket) return res.status(401).json({ error: "TICKET", message: "Sayfanın süresi doldu; yeniden açın." });
      const portal = await portalById(store, ticket.memberId);
      if (!portal || !portal.active) return res.status(404).json({ error: "NOT_INSTALLED" });
      try {
        await handler(portal, ticket.line, req, res);
      } catch (error) {
        const e = error as Error & { statusCode?: number };
        res.status(e.statusCode && e.statusCode < 600 ? e.statusCode : 502).json({ error: "FAILED", message: e.message });
      }
    };
  const json = express.json({ limit: "8kb" });
  const lineTicketed = (fn: (portal: B24Portal, line: string) => Promise<unknown>) =>
    ticketed(async (portal, line, _req, res) => {
      if (!/^\d{1,9}$/.test(line)) return res.status(401).json({ error: "TICKET" });
      res.json(await fn(portal, line));
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
        for (const l of Object.values(portal.lines))
          await evolution(`/instance/logout/${encodeURIComponent(l.instance)}`, { method: "DELETE" }).catch(() => undefined);
        await savePortal(store, { ...portal, active: false, accessToken: "", refreshToken: "", lines: {} });
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
function roleOf(portal: B24Portal, userId: string): B24Role | undefined {
  const roles = portal.roles || [];
  const assigned = portal.assignments?.[userId];
  return roles.find((r) => r.id === assigned) || roles.find((r) => r.isDefault);
}
const roleAllows = (role: B24Role | undefined, line: string) =>
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

function registerPanelRoutes(
  app: Express,
  store: Store,
  ticketed: (h: (portal: B24Portal, line: string, req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => Promise<unknown>,
  json: express.RequestHandler,
) {
  const panel = (fn: (portal: B24Portal, body: any) => Promise<unknown>) =>
    ticketed(async (portal, scope, req, res) => {
      if (scope !== "all") return res.status(401).json({ error: "TICKET" });
      res.json(await fn(portal, req.body || {}));
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
        aiConfigured: aiConfigured(),
      };
    }),
  );

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
      };
      await savePortal(store, next);
      return { settings: portalSettings(next) };
    }),
  );

  // Ekip performansı: temsilci ilk cevap süreleri, numara hacimleri, bekleyen ve sıcak sohbetler.
  app.post(
    "/b24/panel/stats",
    json,
    panel(async (portal, body) => {
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
      const created = await b24Call(store, portal, "imopenlines.config.add", { PARAMS: { LINE_NAME: `${name} (WhatsApp)` } });
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
