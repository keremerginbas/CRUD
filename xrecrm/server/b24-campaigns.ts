// Pro paketi: müşterinin kendi Meta (WhatsApp Cloud API) hesabıyla onaylı
// şablon mesajlarından toplu kampanya. QR ile bağlanan numaradan toplu mesaj
// atılmaz (WhatsApp numarayı kapatır); kampanyalar yalnız resmi API'den gider.
//
// Akış: ÖNİZLEME (gönderim yok) → TEK TEST (bir numara) → TOPLU GÖNDERİM (izin
// teyidiyle). Gönderim arka planda, mesajlar arasında beklemeyle yapılır; her
// alıcının Meta yanıtı kaydedilir. Meta'nın "accepted" yanıtı teslimat garantisi
// değildir.
import crypto from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import type { Store } from "./db.js";
import { requireFeature } from "./b24-billing.js";
import { SYSTEM_OWNER, b24Call, portalById, savePortal, type B24Portal } from "./b24-connector.js";
import { decryptValue, encryptValue } from "./integration-settings.js";

export const CAMPAIGN_KIND = "b24-campaign";
const MAX_RECIPIENTS = 1000;
const env = (k: string) => process.env[k]?.trim() || "";
const graphBase = () => `https://graph.facebook.com/${env("META_GRAPH_VERSION") || "v26.0"}`;

export interface MetaAccount {
  phoneNumberId: string;
  wabaId: string;
  /** Şifreli sistem kullanıcısı erişim anahtarı */
  token: string;
  displayPhone?: string;
  verifiedName?: string;
  connectedAt?: string;
}
type PortalWithMeta = B24Portal & { meta?: MetaAccount };

export interface CampaignRecipient {
  phone: string;
  name?: string;
  status: "pending" | "accepted" | "failed";
  messageId?: string;
  error?: string;
  at?: string;
}
export interface Campaign {
  id: string;
  memberId: string;
  name: string;
  template: { name: string; language: string };
  headerImage?: string;
  bodyParams: string[];
  status: "running" | "done" | "stopped";
  createdAt: string;
  finishedAt?: string;
  recipients: CampaignRecipient[];
}

let metaFetch: typeof fetch = (...args) => fetch(...args);
/** Testler için Meta isteklerini yönlendirir. */
export function setMetaFetch(fn: typeof fetch) {
  metaFetch = fn;
}
let sendGapMs = 1500;
export function setCampaignGap(ms: number) {
  sendGapMs = ms;
}

const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode: status });
};

async function graph(token: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await metaFetch(`${graphBase()}/${path}`, {
    method: init.method || "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  }).catch((error) => fail(502, `Meta'ya ulaşılamadı: ${(error as Error).message}`));
  const data: any = await (res as globalThis.Response).json().catch(() => ({}));
  if (!(res as globalThis.Response).ok || data?.error) {
    const msg = data?.error?.error_user_msg || data?.error?.message || `HTTP ${(res as globalThis.Response).status}`;
    throw Object.assign(new Error(`Meta: ${msg}`), { statusCode: 400, meta: data?.error });
  }
  return data;
}

/** n8n akışındaki gibi: 0 / 00 / ülke kodu olmadan yazılan Türkiye numaralarını düzeltir. */
export function normalizeRecipient(raw: string): string | null {
  let phone = String(raw || "").replace(/\D/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (/^05\d{9}$/.test(phone)) phone = `9${phone}`;
  if (/^5\d{9}$/.test(phone)) phone = `90${phone}`;
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

export function prepareRecipients(list: { phone: string; name?: string }[]) {
  const seen = new Set<string>();
  const valid: { phone: string; name?: string }[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const r of list) {
    const phone = normalizeRecipient(r.phone);
    if (!phone) {
      if (String(r.phone || "").trim()) invalid.push(String(r.phone).slice(0, 40));
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(phone);
    valid.push({ phone, ...(r.name ? { name: String(r.name).slice(0, 80) } : {}) });
  }
  return { valid, invalid, duplicates };
}

function templatePayload(c: Pick<Campaign, "template" | "headerImage" | "bodyParams">, to: string, name?: string) {
  const components: unknown[] = [];
  if (c.headerImage) components.push({ type: "header", parameters: [{ type: "image", image: { link: c.headerImage } }] });
  if (c.bodyParams.length)
    components.push({
      type: "body",
      parameters: c.bodyParams.map((p) => ({ type: "text", text: (p.replace(/\{ad\}|\{name\}/gi, name || "").trim() || "-").slice(0, 1000) })),
    });
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: { name: c.template.name, language: { code: c.template.language }, ...(components.length ? { components } : {}) },
  };
}

async function sendOne(account: MetaAccount, c: Pick<Campaign, "template" | "headerImage" | "bodyParams">, r: { phone: string; name?: string }) {
  try {
    const data = await graph(decryptValue(account.token), `${account.phoneNumberId}/messages`, { method: "POST", body: templatePayload(c, r.phone, r.name) });
    const id = data?.messages?.[0]?.id;
    return id ? { status: "accepted" as const, messageId: String(id) } : { status: "failed" as const, error: "Meta mesaj kimliği döndürmedi." };
  } catch (error) {
    return { status: "failed" as const, error: (error as Error).message.slice(0, 300) };
  }
}

const running = new Set<string>();

/** Bekleyen alıcılara sırayla gönderir; sunucu yeniden başlarsa kaldığı yerden devam eder. */
async function runCampaign(store: Store, id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    for (;;) {
      const c = (await store.get<Campaign>(CAMPAIGN_KIND, id, SYSTEM_OWNER))?.payload;
      if (!c || c.status !== "running") return;
      const idx = c.recipients.findIndex((r) => r.status === "pending");
      if (idx < 0) {
        await store.put(CAMPAIGN_KIND, id, { ...c, status: "done", finishedAt: new Date().toISOString() }, SYSTEM_OWNER);
        return;
      }
      const portal = (await portalById(store, c.memberId)) as PortalWithMeta | null;
      if (!portal?.active || !portal.meta) {
        await store.put(CAMPAIGN_KIND, id, { ...c, status: "stopped", finishedAt: new Date().toISOString() }, SYSTEM_OWNER);
        return;
      }
      const result = await sendOne(portal.meta, c, c.recipients[idx]);
      const latest = (await store.get<Campaign>(CAMPAIGN_KIND, id, SYSTEM_OWNER))?.payload || c;
      const recipients = latest.recipients.slice();
      recipients[idx] = { ...recipients[idx], ...result, at: new Date().toISOString() };
      await store.put(CAMPAIGN_KIND, id, { ...latest, recipients }, SYSTEM_OWNER);
      await new Promise((r) => setTimeout(r, sendGapMs));
    }
  } finally {
    running.delete(id);
  }
}

export async function resumeCampaigns(store: Store) {
  const list = (await store.list<Campaign>(CAMPAIGN_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((c) => c.status === "running");
  for (const c of list) void runCampaign(store, c.id).catch((e) => console.warn("Kampanya devam ettirilemedi:", (e as Error).message));
}

export async function deleteCampaigns(store: Store, memberId: string) {
  for (const r of await store.list<Campaign>(CAMPAIGN_KIND, SYSTEM_OWNER)) if (r.payload.memberId === memberId) await store.delete(CAMPAIGN_KIND, r.payload.id, SYSTEM_OWNER);
}

const summary = (c: Campaign) => ({
  id: c.id,
  name: c.name,
  template: c.template,
  status: c.status,
  createdAt: c.createdAt,
  finishedAt: c.finishedAt || null,
  total: c.recipients.length,
  accepted: c.recipients.filter((r) => r.status === "accepted").length,
  failed: c.recipients.filter((r) => r.status === "failed").length,
  pending: c.recipients.filter((r) => r.status === "pending").length,
});

const publicMeta = (m?: MetaAccount) =>
  m ? { connected: true, phoneNumberId: m.phoneNumberId, wabaId: m.wabaId, displayPhone: m.displayPhone || "", verifiedName: m.verifiedName || "", connectedAt: m.connectedAt || null } : { connected: false };

type PanelFactory = (fn: (portal: B24Portal, body: any) => Promise<unknown>) => (req: Request, res: Response) => Promise<unknown>;

export function registerCampaignRoutes(app: Express, store: Store, panel: PanelFactory, json: RequestHandler) {
  const fresh = async (p: B24Portal) => ((await portalById(store, p.id)) || p) as PortalWithMeta;
  const pro = (fn: (portal: PortalWithMeta, body: any) => Promise<unknown>) =>
    panel(async (portal, body) => {
      await requireFeature(store, portal, "campaigns");
      return fn(await fresh(portal), body || {});
    });
  const account = (p: PortalWithMeta) => p.meta || fail(409, "Önce Meta (WhatsApp Cloud API) hesabınızı bağlayın.");
  const ids = (v: unknown, max: number) => String(v || "").replace(/\D/g, "").slice(0, max);

  app.post(
    "/b24/panel/campaigns/state",
    json,
    pro(async (portal) => {
      const campaigns = (await store.list<Campaign>(CAMPAIGN_KIND, SYSTEM_OWNER))
        .map((r) => r.payload)
        .filter((c) => c.memberId === portal.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30)
        .map(summary);
      return { meta: publicMeta(portal.meta), campaigns, gapMs: sendGapMs, maxRecipients: MAX_RECIPIENTS };
    }),
  );

  app.post(
    "/b24/panel/meta/save",
    json,
    pro(async (portal, b) => {
      const phoneNumberId = ids(b.phoneNumberId, 30);
      const wabaId = ids(b.wabaId, 30);
      const tokenIn = String(b.token || "").trim();
      if (!phoneNumberId || !wabaId) fail(400, "Telefon numarası kimliğini ve WhatsApp Business hesap kimliğini girin.");
      const token = tokenIn || (portal.meta ? decryptValue(portal.meta.token) : "");
      if (!token) fail(400, "Meta erişim anahtarını (sistem kullanıcısı tokenı) girin.");
      const info = await graph(token, `${phoneNumberId}?fields=display_phone_number,verified_name`);
      const meta: MetaAccount = {
        phoneNumberId,
        wabaId,
        token: encryptValue(token),
        displayPhone: String(info?.display_phone_number || ""),
        verifiedName: String(info?.verified_name || ""),
        connectedAt: new Date().toISOString(),
      };
      await savePortal(store, { ...portal, meta } as B24Portal);
      return { meta: publicMeta(meta) };
    }),
  );

  app.post(
    "/b24/panel/meta/disconnect",
    json,
    pro(async (portal) => {
      const { meta: _drop, ...rest } = portal;
      await savePortal(store, rest as B24Portal);
      return { meta: publicMeta() };
    }),
  );

  app.post(
    "/b24/panel/meta/templates",
    json,
    pro(async (portal) => {
      const m = account(portal);
      const data = await graph(decryptValue(m.token), `${m.wabaId}/message_templates?fields=name,language,status,category,components&limit=200`);
      const templates = (Array.isArray(data?.data) ? data.data : [])
        .filter((t: any) => t?.status === "APPROVED")
        .map((t: any) => {
          const comps: any[] = Array.isArray(t.components) ? t.components : [];
          const header = comps.find((c) => c.type === "HEADER");
          const body = comps.find((c) => c.type === "BODY");
          const vars = new Set(String(body?.text || "").match(/\{\{\s*\d+\s*\}\}/g) || []).size;
          return { name: String(t.name), language: String(t.language), category: String(t.category || ""), header: header?.format || "", body: String(body?.text || "").slice(0, 1024), vars };
        });
      return { templates };
    }),
  );

  // Bitrix CRM'den alıcı: lead durumuna göre ya da tüm kişiler.
  app.post(
    "/b24/panel/campaigns/crm",
    json,
    pro(async (portal, b) => {
      if (b.options) {
        const statuses = ((await b24Call(store, portal, "crm.status.list", { filter: { ENTITY_ID: "STATUS" }, order: { SORT: "ASC" } }).catch(() => [])) as any[]) || [];
        return { leadStatuses: statuses.map((s) => ({ id: String(s.STATUS_ID), name: String(s.NAME) })) };
      }
      const entity = b.entity === "contact" ? "contact" : "lead";
      const filter: Record<string, unknown> = { HAS_PHONE: "Y" };
      if (entity === "lead" && b.status) filter.STATUS_ID = String(b.status).slice(0, 50);
      const out: { phone: string; name?: string }[] = [];
      for (let start = 0; start < MAX_RECIPIENTS * 2; start += 50) {
        const page = ((await b24Call(store, portal, `crm.${entity}.list`, { filter, select: ["ID", "NAME", "LAST_NAME", "TITLE", "PHONE"], order: { ID: "DESC" }, start })) as any[]) || [];
        for (const e of page) {
          const name = [e.NAME, e.LAST_NAME].filter(Boolean).join(" ").trim() || String(e.TITLE || "");
          const phone = (Array.isArray(e.PHONE) ? e.PHONE : [])[0]?.VALUE;
          if (phone) out.push({ phone: String(phone), name });
        }
        if (page.length < 50 || out.length >= MAX_RECIPIENTS) break;
      }
      const prepared = prepareRecipients(out);
      return { recipients: prepared.valid.slice(0, MAX_RECIPIENTS), invalid: prepared.invalid.length, duplicates: prepared.duplicates };
    }),
  );

  app.post(
    "/b24/panel/campaigns/send",
    json,
    pro(async (portal, b) => {
      const mode = ["preview", "test", "send"].includes(b.mode) ? (b.mode as "preview" | "test" | "send") : "preview";
      const template = { name: String(b.template?.name || "").trim().slice(0, 512), language: String(b.template?.language || "").trim().slice(0, 15) };
      if (!/^[a-z0-9_]+$/.test(template.name) || !template.language) fail(400, "Onaylı bir şablon seçin.");
      const headerImage = String(b.headerImage || "").trim();
      if (headerImage && !/^https:\/\/\S+$/i.test(headerImage)) fail(400, "Başlık görseli https:// ile başlayan herkese açık bir bağlantı olmalı.");
      const bodyParams = (Array.isArray(b.bodyParams) ? b.bodyParams : []).slice(0, 10).map((p: unknown) => String(p ?? "").slice(0, 1000));
      const input: { phone: string; name?: string }[] = Array.isArray(b.recipients)
        ? b.recipients.map((r: any) => (typeof r === "string" ? { phone: r } : { phone: String(r?.phone || ""), name: r?.name ? String(r.name) : undefined }))
        : String(b.recipients || "")
            .split(/\r?\n/)
            .map((l) => ({ phone: l }));
      const prepared = prepareRecipients(input);
      if (!prepared.valid.length) fail(400, "Geçerli alıcı yok. Her satıra ülke koduyla bir numara yazın: 905XXXXXXXXX");
      if (prepared.valid.length > MAX_RECIPIENTS) fail(400, `Bir kampanyada en fazla ${MAX_RECIPIENTS} alıcı olabilir.`);
      const base = { template, headerImage: headerImage || undefined, bodyParams };
      if (mode === "preview")
        return { mode, count: prepared.valid.length, invalid: prepared.invalid, duplicates: prepared.duplicates, sample: templatePayload(base, prepared.valid[0].phone, prepared.valid[0].name), minutes: Math.ceil((prepared.valid.length * sendGapMs) / 60_000) };
      const m = account(portal);
      if (mode === "test") {
        if (prepared.valid.length !== 1) fail(400, "Tek test için yalnız bir numara girin.");
        const result = await sendOne(m, base, prepared.valid[0]);
        if (result.status === "failed") fail(400, result.error || "Gönderilemedi.");
        return { mode, result };
      }
      if (b.consent !== true) fail(400, "Toplu gönderim için alıcıların WhatsApp pazarlama iletisine izin verdiğini onaylayın.");
      const busy = (await store.list<Campaign>(CAMPAIGN_KIND, SYSTEM_OWNER)).some((r) => r.payload.memberId === portal.id && r.payload.status === "running");
      if (busy) fail(409, "Devam eden bir kampanya var. Bitmesini bekleyin ya da durdurun.");
      const campaign: Campaign = {
        id: `cmp_${crypto.randomBytes(8).toString("hex")}`,
        memberId: portal.id,
        name: String(b.name || "").trim().slice(0, 120) || template.name,
        ...base,
        status: "running",
        createdAt: new Date().toISOString(),
        recipients: prepared.valid.map((r) => ({ ...r, status: "pending" as const })),
      };
      await store.put(CAMPAIGN_KIND, campaign.id, campaign, SYSTEM_OWNER);
      void runCampaign(store, campaign.id).catch((e) => console.warn("Kampanya gönderimi:", (e as Error).message));
      return { mode, campaign: summary(campaign) };
    }),
  );

  app.post(
    "/b24/panel/campaigns/get",
    json,
    pro(async (portal, b) => {
      const c = (await store.get<Campaign>(CAMPAIGN_KIND, String(b.id || ""), SYSTEM_OWNER))?.payload;
      if (!c || c.memberId !== portal.id) fail(404, "Kampanya bulunamadı.");
      return { campaign: summary(c!), recipients: c!.recipients.slice(0, MAX_RECIPIENTS) };
    }),
  );

  app.post(
    "/b24/panel/campaigns/stop",
    json,
    pro(async (portal, b) => {
      const c = (await store.get<Campaign>(CAMPAIGN_KIND, String(b.id || ""), SYSTEM_OWNER))?.payload;
      if (!c || c.memberId !== portal.id) fail(404, "Kampanya bulunamadı.");
      if (c!.status === "running") await store.put(CAMPAIGN_KIND, c!.id, { ...c!, status: "stopped", finishedAt: new Date().toISOString() }, SYSTEM_OWNER);
      return { ok: true };
    }),
  );
}

