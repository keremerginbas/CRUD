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
const SYSTEM_OWNER = "b24-connector";
const PORTAL_KIND = "b24-portal";
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
}
export interface B24Line {
  instance: string;
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

async function portalById(store: Store, memberId: string) {
  return (await store.get<B24Portal>(PORTAL_KIND, memberId, SYSTEM_OWNER))?.payload || null;
}
async function savePortal(store: Store, portal: B24Portal) {
  await store.put(PORTAL_KIND, portal.id, { ...portal, updatedAt: new Date().toISOString() }, SYSTEM_OWNER);
}

// --- Evolution ---------------------------------------------------------------

async function evolution(path: string, init: RequestInit = {}) {
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
          status: open ? "connected" : state || "disconnected",
          updatedAt: new Date().toISOString(),
        },
      },
    };
    await savePortal(store, portal);
    if (open && previous?.status !== "connected") await activateLine(store, portal, map.line, true).catch((e) => console.warn("Bitrix kanal etkinleştirilemedi:", e.message));
    return;
  }

  if (!event.startsWith("messages.upsert") && !data?.key) return;
  const key = data?.key || {};
  if (key.fromMe) return;
  const remoteJid = String(key.remoteJid || "");
  if (!remoteJid.endsWith("@s.whatsapp.net")) return; // gruplar ve durumlar aktarılmaz
  const phone = normalizePhone(remoteJid.split("@")[0]);
  const message = unwrapWaMessage(data?.message);
  if (isWaSystemMessage(message)) return;
  const owner = `b24:${portal.id}`;
  const media = await captureEvolutionMedia(store, owner, instance, data);
  const text = waMessageText(message);
  const files = media.mediaId
    ? [{ url: mediaUrl(base, portal.id, media.mediaId), name: media.fileName || "dosya" }]
    : [];
  await b24Call(store, portal, "imconnector.send.messages", {
    CONNECTOR: CONNECTOR_ID,
    LINE: map.line,
    MESSAGES: [
      {
        user: {
          id: phone,
          name: String(data?.pushName || "").slice(0, 120) || `+${phone}`,
          phone: `+${phone}`,
          skip_phone_validate: "Y",
        },
        message: {
          id: String(key.id || crypto.randomUUID()),
          date: Math.floor(Number(data?.messageTimestamp || Date.now() / 1000)),
          text: text || (files.length ? "" : "[Medya]"),
          ...(files.length ? { files } : {}),
        },
        chat: { id: phone, name: String(data?.pushName || `+${phone}`).slice(0, 120) },
      },
    ],
  });
}

/** Bitrix temsilcisinin yazdığı mesajları WhatsApp'a iletir. */
async function deliverFromBitrix(store: Store, portal: B24Portal, line: string, messages: any[]) {
  const info = portal.lines[line];
  if (!info?.instance) return;
  const delivered: any[] = [];
  for (const item of messages) {
    const to = normalizePhone(item?.chat?.id || "");
    if (!to) continue;
    const text = String(item?.message?.text || "")
      .replace(/\[br\]/gi, "\n")
      .replace(/\[\/?(b|i|u|s|url[^\]]*)\]/gi, "")
      .trim();
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
        [line]: { ...known, instance, phone: owner.phone || known?.phone, profileName: owner.profileName || known?.profileName, status: "connected", updatedAt: new Date().toISOString() },
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

// --- Rotalar -----------------------------------------------------------------

export function registerB24ConnectorRoutes(app: Express, store: Store) {
  const form = express.urlencoded({ extended: true, limit: "256kb" });

  // Kurulum: belirteçleri sakla, bağlayıcıyı ve olayları kaydet.
  const install = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    if (!memberIdOk(p.memberId) || !p.domain || !p.authId)
      return page(res, 400, "Kurulum bilgisi eksik", "<p>Uygulamayı Bitrix24 içinden kurun.</p>");
    try {
      const existing = await portalById(store, p.memberId);
      const now = new Date().toISOString();
      const portal: B24Portal = {
        id: p.memberId,
        domain: p.domain,
        clientEndpoint: `https://${p.domain}/rest/`,
        accessToken: p.authId,
        refreshToken: p.refreshId || existing?.refreshToken || "",
        expiresAt: Date.now() + p.expires * 1000,
        applicationToken: existing?.applicationToken,
        installedAt: existing?.installedAt || now,
        updatedAt: now,
        active: true,
        lines: existing?.lines || {},
      };
      // Belirteç gerçekten bu portala mı ait?
      const user = await b24Call(store, portal, "user.current");
      if (!user?.ID) throw new Error("Bitrix oturumu doğrulanamadı.");
      await savePortal(store, portal);
      await registerConnector(store, portal, origin(req));
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
      page(res, 502, "Kurulum tamamlanamadı", `<p class="err">${escapeHtml((error as Error).message)}</p>`);
    }
  };
  app.get("/b24/install", install);
  app.post("/b24/install", form, install);

  // Uygulama ana sayfası (sol menü): yöneticiye yönetim paneli, personele kendi numaraları.
  const home = async (req: Request, res: Response) => {
    const p = readBitrixParams(req);
    const portal = memberIdOk(p.memberId) ? await portalById(store, p.memberId) : null;
    if (!portal || !portal.active || portal.domain !== p.domain)
      return page(res, 404, "Uygulama kurulu değil", "<p>Uygulamayı yeniden kurun.</p>");
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
      // İlk olayda uygulama anahtarı sabitlenir; sonrakiler bununla doğrulanır.
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

interface B24User {
  id: string;
  name: string;
  email: string;
  position: string;
}

async function portalUsers(store: Store, portal: B24Portal): Promise<B24User[]> {
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
  }));
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

  app.post(
    "/b24/panel/state",
    json,
    panel(async (portal) => {
      const users = await portalUsers(store, portal).catch(() => [] as B24User[]);
      return {
        domain: portal.domain,
        connections: publicConnections(portal),
        roles: portal.roles || [],
        users: users.map((u) => ({ ...u, roleId: portal.assignments?.[u.id] || "" })),
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

export function panelHtml(ticket: string, domain: string) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XRE WhatsApp</title>
<style>
:root{--bg:#1f2329;--panel:#2a2f36;--card:#323841;--line:#3d444e;--text:#e8edf2;--muted:#9aa5b1;--green:#25D366;--green2:#1da851;--red:#ef5350;--amber:#f5b041}
*{box-sizing:border-box}body{margin:0;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--text)}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:var(--panel);border-bottom:1px solid var(--line)}
header b{font-size:14px}header small{color:var(--muted);display:block}.brand{color:var(--green);font-weight:800;letter-spacing:.5px}
nav{display:flex;gap:4px;padding:10px 18px;border-bottom:1px solid var(--line)}nav button{background:none;border:0;color:var(--muted);padding:8px 12px;border-radius:8px;cursor:pointer;font-weight:600}
nav button.active{background:var(--card);color:var(--text)}main{padding:18px}
.bar{display:flex;gap:10px;align-items:center;margin-bottom:14px}.btn{border:1px solid var(--line);background:var(--card);color:var(--text);padding:7px 12px;border-radius:8px;cursor:pointer;font-weight:600}
.btn.primary{background:var(--green);border-color:var(--green);color:#06210f}.btn.danger{color:var(--red)}.btn:disabled{opacity:.5}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.card h3{margin:0 0 4px;font-size:14px;display:flex;gap:6px;align-items:center}.card .phone{color:var(--muted)}.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);color:var(--muted)}.row span:last-child{color:var(--text)}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#3d444e}.badge.ok{background:rgba(37,211,102,.18);color:var(--green)}.badge.warn{background:rgba(245,176,65,.18);color:var(--amber)}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}table{width:100%;border-collapse:collapse;background:var(--panel);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;text-transform:uppercase}select,input[type=text]{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:100%}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;place-items:center;padding:16px}.modal.open{display:grid}.dialog{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;width:min(420px,100%);max-height:90vh;overflow:auto}
.dialog h2{margin:0 0 12px;font-size:16px}.qr{display:grid;place-items:center;min-height:260px;background:#fff;border-radius:12px;margin:10px 0}.qr img{width:240px;height:240px}.qr p{color:#333}
label.check{display:flex;gap:8px;align-items:center;padding:6px 0}.muted{color:var(--muted)}.warn{color:var(--amber);margin:10px 0;white-space:pre-line}.empty{color:var(--muted);padding:30px;text-align:center}
</style></head><body>
<header><div><b>${escapeHtml(domain)}</b><small>XRE WhatsApp yönetimi</small></div><span class="brand">XRE WHATSAPP</span></header>
<nav><button data-tab="connections" class="active">Bağlantılar</button><button data-tab="staff">Personel</button><button data-tab="roles">Roller</button></nav>
<main id="main"><p class="muted">Yükleniyor…</p></main>
<div class="modal" id="modal"><div class="dialog" id="dialog"></div></div>
<script>
const T=${JSON.stringify(ticket)};let S={connections:[],roles:[],users:[]};let tab="connections";let poll=null;
const $=s=>document.querySelector(s);const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
async function api(path,body={}){const r=await fetch("/b24/panel/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,t:T})});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||"İşlem başarısız.");return j;}
function warn(w){if(w&&w.length)alert(w.join("\\n"));}
async function load(){try{S=await api("state");render();}catch(e){$("#main").innerHTML='<p class="warn">'+esc(e.message)+'</p>';}}
function close(){$("#modal").classList.remove("open");if(poll){clearInterval(poll);poll=null;}}
function open(html){$("#dialog").innerHTML=html;$("#modal").classList.add("open");}
$("#modal").onclick=e=>{if(e.target.id==="modal")close();};
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("active",x===b));render();});
const phone=p=>p?"+"+p.replace(/^(\\d{2})(\\d{3})(\\d{3})(\\d{2})(\\d{2})$/,"$1 $2 $3 $4 $5"):"Numara bağlı değil";
function render(){const m=$("#main");
if(tab==="connections"){m.innerHTML='<div class="bar"><button class="btn primary" id="add">+ Bağlantı ekle</button><span class="muted">Her bağlantı Bitrix\\'te ayrı bir Açık Kanal olur.</span></div>'+(S.connections.length?'<div class="grid">'+S.connections.map(c=>'<div class="card"><h3>'+(c.status==="connected"?"🟢":"⚪")+' '+esc(c.name)+'</h3><div class="phone">'+esc(phone(c.phone))+(c.profileName?' · '+esc(c.profileName):'')+'</div><div style="margin:8px 0">'+(c.status==="connected"?'<span class="badge ok">Bağlı</span>':'<span class="badge warn">Bağlı değil</span>')+'</div><div class="row"><span>Açık Kanal</span><span>#'+esc(c.line)+'</span></div><div class="row"><span>Erişen roller</span><span>'+esc(S.roles.filter(r=>r.lines==="all"||r.lines.includes(c.line)).map(r=>r.name).join(", ")||"—")+'</span></div><div class="actions"><button class="btn" data-qr="'+c.line+'">'+(c.status==="connected"?"Yeniden bağla":"QR ile bağla")+'</button><button class="btn" data-rename="'+c.line+'">Adı değiştir</button>'+(c.status==="connected"?'<button class="btn" data-off="'+c.line+'">Bağlantıyı kes</button>':'')+'<button class="btn danger" data-del="'+c.line+'">Sil</button></div></div>').join("")+'</div>':'<div class="empty">Henüz bağlantı yok. “Bağlantı ekle” ile ilk WhatsApp numaranızı bağlayın.</div>');
$("#add").onclick=async()=>{const n=prompt("Bağlantı adı (ör. Satış 7124):");if(!n)return;try{const r=await api("connection/add",{name:n});await load();qr(r.line);}catch(e){alert(e.message);}};
m.querySelectorAll("[data-qr]").forEach(b=>b.onclick=()=>qr(b.dataset.qr));
m.querySelectorAll("[data-rename]").forEach(b=>b.onclick=async()=>{const c=S.connections.find(x=>x.line===b.dataset.rename);const n=prompt("Yeni ad:",c.name);if(!n)return;try{await api("connection/rename",{line:c.line,name:n});load();}catch(e){alert(e.message);}});
m.querySelectorAll("[data-off]").forEach(b=>b.onclick=async()=>{if(!confirm("WhatsApp bağlantısı kesilsin mi?"))return;await api("connection/disconnect",{line:b.dataset.off}).catch(e=>alert(e.message));load();});
m.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!confirm("Bağlantı silinsin mi? WhatsApp oturumu kapanır, Bitrix Açık Kanalı ve sohbet geçmişi kalır."))return;await api("connection/delete",{line:b.dataset.del}).catch(e=>alert(e.message));load();});}
if(tab==="staff"){const opts=r=>'<option value="">'+(S.roles.some(x=>x.isDefault)?"Varsayılan rol":"Rol yok")+'</option>'+S.roles.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===r?" selected":"")+'>'+esc(x.name)+'</option>').join("");
m.innerHTML=S.roles.length?'<table><thead><tr><th>İsim</th><th>Pozisyon</th><th>E-posta</th><th>Rol</th><th>Görebildiği numaralar</th></tr></thead><tbody>'+S.users.map(u=>{const role=S.roles.find(r=>r.id===u.roleId)||S.roles.find(r=>r.isDefault);const nums=!role?"Hiçbiri":role.lines==="all"?"Tümü":(S.connections.filter(c=>role.lines.includes(c.line)).map(c=>c.name).join(", ")||"Hiçbiri");return '<tr><td>'+esc(u.name)+'</td><td>'+esc(u.position)+'</td><td>'+esc(u.email)+'</td><td><select data-user="'+esc(u.id)+'">'+opts(u.roleId)+'</select></td><td>'+esc(nums)+'</td></tr>';}).join("")+'</tbody></table>':'<div class="empty">Önce “Roller” sekmesinden en az bir rol oluşturun.</div>';
m.querySelectorAll("[data-user]").forEach(s=>s.onchange=async()=>{try{const r=await api("user/role",{userId:s.dataset.user,roleId:s.value});warn(r.warnings);load();}catch(e){alert(e.message);}});}
if(tab==="roles"){m.innerHTML='<div class="bar"><button class="btn primary" id="addRole">+ Rol ekle</button><span class="muted">Personel yalnız rolündeki numaraların sohbetlerini alır.</span></div>'+(S.roles.length?'<table><thead><tr><th>Rol</th><th>Numaralar</th><th>Personel</th><th></th></tr></thead><tbody>'+S.roles.map(r=>'<tr><td>'+esc(r.name)+(r.isDefault?' <span class="badge ok">Varsayılan</span>':'')+'</td><td>'+esc(r.lines==="all"?"Tümü":(S.connections.filter(c=>r.lines.includes(c.line)).map(c=>c.name).join(", ")||"Hiçbiri"))+'</td><td>'+S.users.filter(u=>u.roleId===r.id||(!u.roleId&&r.isDefault)).length+'</td><td style="text-align:right"><button class="btn" data-edit="'+esc(r.id)+'">Düzenle</button> <button class="btn danger" data-rdel="'+esc(r.id)+'">Sil</button></td></tr>').join("")+'</tbody></table>':'<div class="empty">Henüz rol yok. Rol oluşturmadan Bitrix kuyruklarına dokunulmaz.</div>');
$("#addRole").onclick=()=>roleForm();m.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>roleForm(S.roles.find(r=>r.id===b.dataset.edit)));
m.querySelectorAll("[data-rdel]").forEach(b=>b.onclick=async()=>{if(!confirm("Rol silinsin mi?"))return;try{const r=await api("role/delete",{id:b.dataset.rdel});warn(r.warnings);load();}catch(e){alert(e.message);}});}}
function roleForm(role){const r=role||{id:"",name:"",lines:[],isDefault:false};const all=r.lines==="all";
open('<h2>'+(role?"Rolü düzenle":"Yeni rol")+'</h2><label>Adı<input type="text" id="rn" value="'+esc(r.name)+'"></label><p class="muted" style="margin:12px 0 4px">Görebileceği numaralar</p><label class="check"><input type="checkbox" id="rall"'+(all?" checked":"")+'> Tüm numaralar</label><div id="rlines">'+S.connections.map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.line)+'"'+(!all&&r.lines.includes(c.line)?" checked":"")+'> '+esc(c.name)+' <span class="muted">'+esc(phone(c.phone))+'</span></label>').join("")+'</div><label class="check"><input type="checkbox" id="rdef"'+(r.isDefault?" checked":"")+'> Varsayılan rol (rol atanmamış personel)</label><div class="actions" style="justify-content:flex-end"><button class="btn" id="rc">Kapat</button><button class="btn primary" id="rs">Kaydet</button></div>');
$("#rc").onclick=close;$("#rs").onclick=async()=>{const lines=$("#rall").checked?"all":[...document.querySelectorAll("#rlines input:checked")].map(i=>i.value);try{const res=await api("role/save",{id:r.id,name:$("#rn").value,lines,isDefault:$("#rdef").checked});close();warn(res.warnings);load();}catch(e){alert(e.message);}};}
async function qr(line){const c=S.connections.find(x=>x.line===String(line))||{name:"WhatsApp"};
open('<h2>'+esc(c.name)+' · QR ile bağla</h2><ol class="muted"><li>Telefonda WhatsApp → Ayarlar → Bağlı cihazlar</li><li>“Cihaz bağla” ile aşağıdaki kodu okutun</li></ol><div class="qr" id="qrbox"><p>QR hazırlanıyor…</p></div><div class="actions" style="justify-content:flex-end"><button class="btn" id="qc">Kapat</button></div>');
$("#qc").onclick=()=>{close();load();};
const tick=async()=>{try{const s=await api("connection/status",{line});if(s.status==="connected"){$("#qrbox").innerHTML='<p style="color:#128c4b;font-weight:700">Bağlandı: '+esc(phone(s.phone))+'</p>';clearInterval(poll);poll=null;setTimeout(()=>{close();load();},1500);return;}const q=await api("connection/qr",{line});if(q.qr)$("#qrbox").innerHTML='<img alt="WhatsApp QR" src="'+esc(q.qr)+'">';else $("#qrbox").innerHTML='<p>'+esc(q.message)+'</p>';}catch(e){$("#qrbox").innerHTML='<p>'+esc(e.message)+'</p>';}};
await tick();poll=setInterval(tick,5000);}
load();
</script></body></html>`;
}
