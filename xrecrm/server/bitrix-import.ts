// Bitrix24 → XRE CRM veri aktarımı.
//
// Bitrix24 "gelen webhook" taban adresi (ör. https://firma.bitrix24.com.tr/rest/1/abc123/)
// üzerinden REST çağrılarıyla lead, anlaşma, kişi, şirket, aktivite ve arama
// kayıtlarını okur; XRE kayıtlarına `bx-*` kimlikleriyle yazar. Yeniden
// çalıştırmak aynı kayıtları günceller; hiçbir şey silinmez ve `bx-*` olmayan
// kayıtlara dokunulmaz.

import crypto from "node:crypto";
import type { Express, Request, Response as ExpressResponse } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import { rawStoreOf } from "./access.js";
import { fetchWithTimeout, normalizePhone } from "./security.js";
import { LeadSchema } from "./types.js";
import { ActivitySchema, CompanySchema, ContactSchema } from "./suite.js";
import {
  BITRIX_IMPORT_ENTITIES,
  XRE_STAGES,
  bitrixSemantics,
  stageKey,
  suggestStageMapping,
  type BitrixDetectedStage,
  type BitrixEntityCounter,
  type BitrixImportEntity,
  type BitrixImportJobView,
  type BitrixJobStatus,
  type BitrixPreview,
  type BitrixStatusInput,
  type XreStage,
} from "../shared/bitrix-import.js";

export {
  suggestStageMapping,
  bitrixSemantics,
} from "../shared/bitrix-import.js";

// ---------------------------------------------------------------------------
// Hatalar ve yardımcılar

export class BitrixImportError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = "BITRIX_IMPORT_ERROR",
  ) {
    super(message);
    this.name = "BitrixImportError";
  }
}

class CancelledError extends Error {
  constructor() {
    super("Aktarım kullanıcı tarafından iptal edildi.");
  }
}

type AnyRecord = Record<string, any>;

const nowIso = () => new Date().toISOString();

function toIso(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function stripHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\[(\/?)(b|i|u|s|p|br|url[^\]]*|color[^\]]*|size[^\]]*|list|\*)\]/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}

function multiField(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  const first = value.find((entry) => entry && String(entry.VALUE ?? "").trim());
  return first ? String(first.VALUE).trim() : "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanEmail(value: unknown): string {
  const email = String(value ?? "").trim().slice(0, 320);
  return EMAIL_RE.test(email) ? email : "";
}

function personName(row: AnyRecord): string {
  return [row.NAME, row.SECOND_NAME, row.LAST_NAME]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

const SOURCE_LABELS: Record<string, string> = {
  CALL: "Telefon",
  WEB: "Web",
  EMAIL: "E-posta",
  ADVERTISING: "Reklam",
  PARTNER: "İş ortağı",
  RECOMMENDATION: "Tavsiye",
  TRADE_SHOW: "Fuar",
  WEBFORM: "Web formu",
  CALLBACK: "Geri arama",
  RC_GENERATOR: "Satış artırıcı",
  STORE: "Online mağaza",
  OTHER: "Diğer",
};

export function mapBitrixSource(
  sourceId: unknown,
  sourceNames: Record<string, string> = {},
): string {
  const id = String(sourceId ?? "").trim();
  if (!id) return "Bitrix24";
  return clip(SOURCE_LABELS[id] || sourceNames[id] || id, 120);
}

function customFields(row: AnyRecord): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(row)) {
    if (!key.startsWith("UF_")) continue;
    if (raw === null || raw === undefined || raw === "" || raw === false) continue;
    if (Array.isArray(raw) && !raw.length) continue;
    let text: string;
    if (Array.isArray(raw))
      text = raw
        .map((item) => (item && typeof item === "object" ? JSON.stringify(item) : String(item)))
        .filter(Boolean)
        .join(", ");
    else if (typeof raw === "object") text = JSON.stringify(raw);
    else text = String(raw);
    text = text.trim();
    if (!text || text === "{}" || text === "[]") continue;
    out[key] = text.slice(0, 2000);
  }
  return Object.keys(out).length ? out : undefined;
}

function safeIdPart(value: unknown): string {
  return String(value ?? "")
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, 160);
}

// ---------------------------------------------------------------------------
// Webhook adresi

export function normalizeBitrixWebhook(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text)
    throw new BitrixImportError(
      "Bitrix24 gelen webhook adresi gerekli.",
      400,
      "BITRIX_WEBHOOK_REQUIRED",
    );
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new BitrixImportError("Bitrix24 webhook adresi geçersiz.", 400, "BITRIX_WEBHOOK_INVALID");
  }
  if (url.protocol !== "https:")
    throw new BitrixImportError("Bitrix24 webhook adresi HTTPS olmalı.", 400, "BITRIX_WEBHOOK_INVALID");
  if (url.username || url.password || url.search || url.hash)
    throw new BitrixImportError(
      "Bitrix24 webhook adresi kimlik bilgisi veya sorgu parametresi içeremez.",
      400,
      "BITRIX_WEBHOOK_INVALID",
    );
  // /rest/<kullanıcı>/<anahtar>/ biçimi; sondaki yöntem adı (ör. profile.json) atılır.
  const match = url.pathname.match(/^(.*?\/rest\/\d+\/[A-Za-z0-9_-]+)(\/.*)?$/);
  if (!match)
    throw new BitrixImportError(
      "Webhook adresi https://<portal>/rest/<kullanıcı-id>/<anahtar>/ biçiminde olmalı.",
      400,
      "BITRIX_WEBHOOK_INVALID",
    );
  return `${url.origin}${match[1]}/`;
}

export function maskBitrixWebhook(base: string): string {
  return base.replace(/(\/rest\/\d+\/)([^/]+)(\/?)/, (_m, pre, secret: string, post) => {
    const masked = secret.length <= 4 ? "••••" : `${secret.slice(0, 2)}••••${secret.slice(-2)}`;
    return `${pre}${masked}${post}`;
  });
}

// ---------------------------------------------------------------------------
// Bitrix REST istemcisi (test için enjekte edilebilir)

export type BitrixFetch = (url: string, init: RequestInit) => Promise<Response>;

const defaultFetch: BitrixFetch = (url, init) => fetchWithTimeout(url, init, 30_000);
let fetchOverride: BitrixFetch | null = null;
let sleepOverride: number | null = null;

/** Testler için Bitrix HTTP çağrısını değiştirir; `null` varsayılana döner. */
export function setBitrixFetch(fn: BitrixFetch | null): void {
  fetchOverride = fn;
}
/** Testler için istekler arası bekleme süresini değiştirir; `null` varsayılana döner. */
export function setBitrixSleepMs(ms: number | null): void {
  sleepOverride = ms;
}

export interface BitrixClientOptions {
  fetch?: BitrixFetch;
  sleepMs?: number;
  maxRetries?: number;
  isCancelled?: () => boolean;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class BitrixClient {
  private lastCall = 0;
  private fetcher: BitrixFetch;
  private sleepMs: number;
  private maxRetries: number;
  requests = 0;

  constructor(
    private base: string,
    private options: BitrixClientOptions = {},
  ) {
    this.fetcher = options.fetch || fetchOverride || defaultFetch;
    this.sleepMs = options.sleepMs ?? sleepOverride ?? 500;
    this.maxRetries = options.maxRetries ?? 5;
  }

  private checkCancelled() {
    if (this.options.isCancelled?.()) throw new CancelledError();
  }

  private scrub(text: string): string {
    return text.split(this.base).join(maskBitrixWebhook(this.base));
  }

  async call(method: string, params: AnyRecord = {}): Promise<AnyRecord> {
    for (let attempt = 0; ; attempt += 1) {
      this.checkCancelled();
      const wait = this.lastCall + this.sleepMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      this.requests += 1;
      let status = 0;
      let body: AnyRecord = {};
      try {
        const response = await this.fetcher(`${this.base}${method}.json`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(params),
        });
        status = response.status;
        const text = await response.text();
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { error: "INVALID_RESPONSE", error_description: "Bitrix24 yanıtı JSON değil." };
        }
      } catch (error) {
        if (attempt < this.maxRetries) {
          await sleep(Math.max(this.sleepMs, 1) * 2 ** attempt);
          continue;
        }
        throw new BitrixImportError(
          `Bitrix24'e ulaşılamadı (${method}): ${this.scrub((error as Error).message || "ağ hatası")}`,
          502,
          "BITRIX_UNREACHABLE",
        );
      }
      const code = String(body?.error || "");
      if (code === "QUERY_LIMIT_EXCEEDED" || status === 429 || status === 503) {
        if (attempt < this.maxRetries) {
          await sleep(Math.max(this.sleepMs, 1) * 2 ** (attempt + 1));
          continue;
        }
        throw new BitrixImportError(
          "Bitrix24 istek sınırı aşıldı; lütfen biraz sonra tekrar deneyin.",
          429,
          "BITRIX_RATE_LIMIT",
        );
      }
      if (code || status >= 400) {
        const description = this.scrub(
          String(body?.error_description || code || `HTTP ${status}`),
        );
        const unauthorized =
          status === 401 || ["INVALID_CREDENTIALS", "insufficient_scope", "NO_AUTH_FOUND", "expired_token"].includes(code);
        throw new BitrixImportError(
          unauthorized
            ? `Bitrix24 yetki hatası (${method}): ${description}. Webhook izinlerini (crm, user, telephony) kontrol edin.`
            : `Bitrix24 hatası (${method}): ${description}`,
          unauthorized ? 401 : 502,
          unauthorized ? "BITRIX_UNAUTHORIZED" : "BITRIX_ERROR",
        );
      }
      return body;
    }
  }

  /** Sayfalı liste yöntemlerini (`start` / `next`) baştan sona dolaşır. */
  async listAll(
    method: string,
    params: AnyRecord,
    onPage: (items: AnyRecord[], total: number) => Promise<void> | void,
  ): Promise<number> {
    let start: number | undefined = 0;
    let total = 0;
    let guard = 0;
    while (start !== undefined) {
      const body = await this.call(method, { ...params, start });
      const items = Array.isArray(body.result) ? body.result : [];
      total = Number(body.total ?? total ?? items.length) || items.length;
      await onPage(items, total);
      const next = body.next === undefined || body.next === null ? undefined : Number(body.next);
      start = next !== undefined && Number.isFinite(next) && next > (start ?? 0) ? next : undefined;
      if (++guard > 100_000) break;
    }
    return total;
  }

  async count(method: string, params: AnyRecord = {}): Promise<number> {
    const body = await this.call(method, { ...params, start: 0 });
    const items = Array.isArray(body.result) ? body.result : [];
    return Number(body.total ?? items.length) || 0;
  }
}

// ---------------------------------------------------------------------------
// Aşamalar ve kullanıcılar

interface StageContext {
  stages: BitrixDetectedStage[];
  stageMap: Record<string, XreStage>;
  sourceNames: Record<string, string>;
}

export async function loadBitrixStages(client: BitrixClient): Promise<StageContext> {
  const all: AnyRecord[] = [];
  await client.listAll("crm.status.list", { order: { SORT: "ASC" } }, (items) => {
    all.push(...items);
  });
  const categoryNames: Record<string, string> = {};
  if (all.some((row) => /^DEAL_STAGE_\d+$/.test(String(row.ENTITY_ID)))) {
    try {
      const body = await client.call("crm.dealcategory.list", {});
      for (const cat of Array.isArray(body.result) ? body.result : [])
        categoryNames[String(cat.ID)] = String(cat.NAME || "");
    } catch {
      /* Kategori adları isteğe bağlıdır. */
    }
  }
  const sourceNames: Record<string, string> = {};
  const groups = new Map<string, { entity: "lead" | "deal"; group: string; rows: AnyRecord[] }>();
  for (const row of all) {
    const entityId = String(row.ENTITY_ID || "");
    if (entityId === "SOURCE") {
      sourceNames[String(row.STATUS_ID)] = String(row.NAME || "");
      continue;
    }
    let entity: "lead" | "deal";
    let group: string;
    if (entityId === "STATUS") {
      entity = "lead";
      group = "Lead durumları";
    } else if (entityId === "DEAL_STAGE") {
      entity = "deal";
      group = "Anlaşma hunisi: Genel";
    } else if (/^DEAL_STAGE_\d+$/.test(entityId)) {
      const catId = entityId.slice("DEAL_STAGE_".length);
      entity = "deal";
      group = `Anlaşma hunisi: ${categoryNames[catId] || `Kategori ${catId}`}`;
    } else continue;
    if (!groups.has(entityId)) groups.set(entityId, { entity, group, rows: [] });
    groups.get(entityId)!.rows.push(row);
  }
  const stages: BitrixDetectedStage[] = [];
  const stageMap: Record<string, XreStage> = {};
  for (const { entity, group, rows } of groups.values()) {
    const suggested = suggestStageMapping(rows as BitrixStatusInput[]);
    const ordered = [...rows].sort((a, b) => (Number(a.SORT) || 0) - (Number(b.SORT) || 0));
    for (const row of ordered) {
      const statusId = String(row.STATUS_ID || "");
      if (!statusId) continue;
      const key = stageKey(entity, statusId);
      stageMap[key] = suggested[statusId] || "new";
      stages.push({
        key,
        entity,
        statusId,
        name: String(row.NAME || statusId),
        sort: Number(row.SORT) || 0,
        semantics: bitrixSemantics(row as BitrixStatusInput),
        group,
        suggested: stageMap[key],
      });
    }
  }
  return { stages, stageMap, sourceNames };
}

export async function loadBitrixUsers(client: BitrixClient): Promise<Record<string, string>> {
  const users: Record<string, string> = {};
  const collect = (items: AnyRecord[]) => {
    for (const user of items) {
      const name = personName(user) || String(user.EMAIL || user.LOGIN || `Kullanıcı ${user.ID}`);
      users[String(user.ID)] = clip(name, 191);
    }
  };
  try {
    // ADMIN_MODE yöneticilerde pasif (ayrılmış) kullanıcıları da döndürür.
    await client.listAll("user.get", { ADMIN_MODE: true }, collect);
  } catch (error) {
    if (error instanceof CancelledError) throw error;
    await client.listAll("user.get", {}, collect);
  }
  return users;
}

// ---------------------------------------------------------------------------
// Eşleme fonksiyonları

export interface MappingContext {
  users: Record<string, string>;
  stageMap: Record<string, XreStage>;
  sourceNames: Record<string, string>;
  contacts: Map<string, AnyRecord>;
  companies: Map<string, AnyRecord>;
  importedAt: string;
}

function resolveStage(ctx: MappingContext, entity: "lead" | "deal", statusId: unknown): XreStage {
  const id = String(statusId ?? "");
  const mapped = ctx.stageMap[stageKey(entity, id)];
  if (mapped && (XRE_STAGES as readonly string[]).includes(mapped)) return mapped;
  return bitrixSemantics({ STATUS_ID: id }) === "S"
    ? "won"
    : bitrixSemantics({ STATUS_ID: id }) === "F"
      ? "lost"
      : "new";
}

export function mapBitrixLead(row: AnyRecord, ctx: MappingContext): AnyRecord {
  const createdAt = toIso(row.DATE_CREATE) || ctx.importedAt;
  const lead: AnyRecord = {
    id: `bx-lead-${row.ID}`,
    name: clip(personName(row) || row.TITLE || `Bitrix lead #${row.ID}`, 200),
    phone: clip(normalizePhone(multiField(row.PHONE)), 80),
    email: cleanEmail(multiField(row.EMAIL)),
    company: clip(row.COMPANY_TITLE, 200),
    stage: resolveStage(ctx, "lead", row.STATUS_ID),
    owner: ctx.users[String(row.ASSIGNED_BY_ID)] || "",
    value: Number(row.OPPORTUNITY) || 0,
    source: mapBitrixSource(row.SOURCE_ID, ctx.sourceNames),
    notes: clip(stripHtml(row.COMMENTS), 10000),
    createdAt,
    lastActivity: toIso(row.DATE_MODIFY) || createdAt,
    tags: ["Bitrix24"],
    bitrixId: String(row.ID),
    bitrixType: "lead",
    bitrixStatusId: String(row.STATUS_ID ?? ""),
    bitrixImportedAt: ctx.importedAt,
  };
  if (row.TITLE && personName(row)) lead.dealTitle = clip(row.TITLE, 300);
  if (row.ADDRESS_CITY) lead.city = clip(row.ADDRESS_CITY, 120);
  if (Number(row.CONTACT_ID) > 0) lead.contactId = `bx-contact-${row.CONTACT_ID}`;
  if (Number(row.COMPANY_ID) > 0) lead.companyId = `bx-company-${row.COMPANY_ID}`;
  const custom = customFields(row);
  if (custom) lead.customFields = custom;
  return lead;
}

export function mapBitrixDeal(row: AnyRecord, ctx: MappingContext): AnyRecord {
  const createdAt = toIso(row.DATE_CREATE) || ctx.importedAt;
  const contact = Number(row.CONTACT_ID) > 0 ? ctx.contacts.get(String(row.CONTACT_ID)) : undefined;
  const company = Number(row.COMPANY_ID) > 0 ? ctx.companies.get(String(row.COMPANY_ID)) : undefined;
  const ownPhone = normalizePhone(multiField(row.PHONE));
  const deal: AnyRecord = {
    id: `bx-deal-${row.ID}`,
    name: clip(
      (contact && personName(contact)) || company?.TITLE || row.TITLE || `Bitrix anlaşma #${row.ID}`,
      200,
    ),
    phone: clip(
      ownPhone ||
        normalizePhone(multiField(contact?.PHONE)) ||
        normalizePhone(multiField(company?.PHONE)),
      80,
    ),
    email: cleanEmail(multiField(row.EMAIL) || multiField(contact?.EMAIL) || multiField(company?.EMAIL)),
    company: clip(company?.TITLE || "", 200),
    stage: resolveStage(ctx, "deal", row.STAGE_ID),
    owner: ctx.users[String(row.ASSIGNED_BY_ID)] || "",
    value: Number(row.OPPORTUNITY) || 0,
    source: mapBitrixSource(row.SOURCE_ID, ctx.sourceNames),
    notes: clip(stripHtml(row.COMMENTS), 10000),
    createdAt,
    lastActivity: toIso(row.DATE_MODIFY) || createdAt,
    tags: ["Bitrix24", "Anlaşma"],
    dealTitle: clip(row.TITLE || "", 300),
    bitrixId: String(row.ID),
    bitrixType: "deal",
    bitrixStatusId: String(row.STAGE_ID ?? ""),
    bitrixCategoryId: String(row.CATEGORY_ID ?? "0"),
    bitrixImportedAt: ctx.importedAt,
  };
  if (Number(row.CONTACT_ID) > 0) deal.contactId = `bx-contact-${row.CONTACT_ID}`;
  if (Number(row.COMPANY_ID) > 0) deal.companyId = `bx-company-${row.COMPANY_ID}`;
  if (contact?.ADDRESS_CITY) deal.city = clip(contact.ADDRESS_CITY, 120);
  const closeDate = toIso(row.CLOSEDATE);
  if (closeDate) deal.expectedCloseDate = closeDate;
  const probability = Number(row.PROBABILITY);
  if (row.PROBABILITY !== null && row.PROBABILITY !== undefined && row.PROBABILITY !== "" && Number.isFinite(probability))
    deal.probability = Math.max(0, Math.min(100, probability));
  const custom = customFields(row);
  if (custom) deal.customFields = custom;
  return deal;
}

export function mapBitrixContact(row: AnyRecord, ctx: MappingContext): AnyRecord {
  const createdAt = toIso(row.DATE_CREATE) || ctx.importedAt;
  return {
    id: `bx-contact-${row.ID}`,
    name: clip(personName(row) || `Bitrix kişi #${row.ID}`, 200),
    phone: clip(normalizePhone(multiField(row.PHONE)), 80),
    email: cleanEmail(multiField(row.EMAIL)),
    companyId: Number(row.COMPANY_ID) > 0 ? `bx-company-${row.COMPANY_ID}` : "",
    owner: ctx.users[String(row.ASSIGNED_BY_ID)] || "",
    tags: ["Bitrix24"],
    notes: clip(stripHtml(row.COMMENTS), 10000),
    createdAt,
    updatedAt: toIso(row.DATE_MODIFY) || createdAt,
  };
}

export function mapBitrixCompany(row: AnyRecord, ctx: MappingContext): AnyRecord {
  const createdAt = toIso(row.DATE_CREATE) || ctx.importedAt;
  const address = [row.ADDRESS, row.ADDRESS_CITY, row.ADDRESS_PROVINCE, row.ADDRESS_COUNTRY]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(", ");
  const website = multiField(row.WEB);
  return {
    id: `bx-company-${row.ID}`,
    name: clip(row.TITLE || `Bitrix şirket #${row.ID}`, 200),
    industry: clip(row.INDUSTRY || "", 200),
    phone: clip(normalizePhone(multiField(row.PHONE)), 80),
    email: cleanEmail(multiField(row.EMAIL)),
    website: clip(website, 2048),
    address: clip(address, 1000),
    owner: ctx.users[String(row.ASSIGNED_BY_ID)] || "",
    notes: clip(stripHtml(row.COMMENTS), 10000),
    createdAt,
    updatedAt: toIso(row.DATE_MODIFY) || createdAt,
  };
}

export interface LeadLookup {
  ids: Set<string>;
  byPhone: Map<string, string>;
  byContact: Map<string, string>;
}

function lookupLead(lookup: LeadLookup, id: string): string {
  return lookup.ids.has(id) ? id : "";
}

export function mapBitrixActivity(
  row: AnyRecord,
  ctx: MappingContext,
  lookup: LeadLookup,
): AnyRecord {
  const ownerType = Number(row.OWNER_TYPE_ID);
  const ownerId = String(row.OWNER_ID ?? "");
  let leadId = "";
  if (ownerType === 1) leadId = lookupLead(lookup, `bx-lead-${ownerId}`);
  else if (ownerType === 2) leadId = lookupLead(lookup, `bx-deal-${ownerId}`);
  else if (ownerType === 3) leadId = lookup.byContact.get(`bx-contact-${ownerId}`) || "";
  const typeId = Number(row.TYPE_ID);
  const type = typeId === 1 ? "meeting" : typeId === 2 ? "call" : "task";
  const createdAt = toIso(row.CREATED) || ctx.importedAt;
  const startAt = toIso(row.START_TIME) || createdAt;
  let endAt = toIso(row.END_TIME) || new Date(Date.parse(startAt) + 30 * 60_000).toISOString();
  if (Date.parse(endAt) < Date.parse(startAt)) endAt = startAt;
  const defaultTitle = type === "meeting" ? "Bitrix toplantısı" : type === "call" ? "Bitrix araması" : "Bitrix görevi";
  return {
    id: `bx-activity-${row.ID}`,
    leadId,
    type,
    title: clip(String(row.SUBJECT || "").trim() || defaultTitle, 300),
    description: clip(stripHtml(row.DESCRIPTION), 10000),
    startAt,
    endAt,
    assignee: ctx.users[String(row.RESPONSIBLE_ID)] || "",
    completed: String(row.COMPLETED) === "Y",
    createdAt,
    updatedAt: toIso(row.LAST_UPDATED) || createdAt,
  };
}

export function mapBitrixCall(
  row: AnyRecord,
  ctx: MappingContext,
  lookup: LeadLookup,
): AnyRecord {
  const callType = Number(row.CALL_TYPE);
  const direction = callType === 1 ? "outbound" : "inbound";
  const duration = Math.max(0, Number(row.CALL_DURATION) || 0);
  const failedCode = String(row.CALL_FAILED_CODE ?? "200");
  const status = failedCode !== "200" || duration === 0 ? "missed" : "ended";
  const phone = normalizePhone(row.PHONE_NUMBER);
  const startedAt = toIso(row.CALL_START_DATE) || ctx.importedAt;
  const endedAt = new Date(Date.parse(startedAt) + duration * 1000).toISOString();
  const entityType = String(row.CRM_ENTITY_TYPE || "").toUpperCase();
  const entityId = String(row.CRM_ENTITY_ID ?? "");
  let leadId = "";
  if (entityId && entityType === "LEAD") leadId = lookupLead(lookup, `bx-lead-${entityId}`);
  else if (entityId && entityType === "DEAL") leadId = lookupLead(lookup, `bx-deal-${entityId}`);
  else if (entityId && entityType === "CONTACT")
    leadId = lookup.byContact.get(`bx-contact-${entityId}`) || "";
  if (!leadId && phone) leadId = lookup.byPhone.get(phone) || "";
  const call: AnyRecord = {
    id: `bx-call-${safeIdPart(row.CALL_ID || row.ID)}`,
    leadId,
    lineId: clip(row.PORTAL_NUMBER || "bitrix24", 191),
    provider: "bitrix24",
    direction,
    status,
    phone,
    durationSeconds: duration,
    startedAt,
    endedAt,
    agent: ctx.users[String(row.PORTAL_USER_ID)] || "",
    createdAt: startedAt,
    updatedAt: ctx.importedAt,
    bitrixId: String(row.ID ?? ""),
    bitrixCallId: String(row.CALL_ID ?? ""),
    bitrixType: "call",
    bitrixCallType: callType,
  };
  if (row.CALL_RECORD_URL) call.recording = String(row.CALL_RECORD_URL);
  if (failedCode !== "200") call.failedCode = failedCode;
  return call;
}

// ---------------------------------------------------------------------------
// İş (job) kaydı

export interface BitrixImportOptions {
  webhookUrl: string;
  entities: BitrixImportEntity[];
  stageMap?: Record<string, XreStage>;
  since?: string;
}

export interface BitrixImportJob extends BitrixImportJobView {
  owner: string;
  cancelRequested: boolean;
}

const jobs = new Map<string, BitrixImportJob>();

export function createImportJob(
  owner: string,
  webhookBase: string,
  entities: BitrixImportEntity[],
): BitrixImportJob {
  const counters: BitrixImportJob["entities"] = {};
  for (const entity of entities) counters[entity] = { total: 0, imported: 0, updated: 0, failed: 0 };
  return {
    id: crypto.randomUUID(),
    owner,
    status: "running",
    startedAt: nowIso(),
    finishedAt: null,
    webhook: maskBitrixWebhook(webhookBase),
    entities: counters,
    errors: [],
    log: [],
    cancelRequested: false,
  };
}

export function publicJob(job: BitrixImportJob): BitrixImportJobView {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    webhook: job.webhook,
    entities: structuredClone(job.entities),
    errors: job.errors.slice(-20),
    log: job.log.slice(-60),
  };
}

export function getImportJob(owner: string): BitrixImportJob | undefined {
  return jobs.get(owner);
}

/** Yalnızca testler için: kayıtlı işleri temizler. */
export function resetBitrixImportJobs(): void {
  jobs.clear();
}

function logLine(job: BitrixImportJob, text: string) {
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${text}`);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
}

function pushError(job: BitrixImportJob, text: string) {
  job.errors.push(text);
  if (job.errors.length > 20) job.errors.splice(0, job.errors.length - 20);
}

function zodMessage(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "kayıt"}: ${issue.message}`)
      .join("; ");
  return (error as Error)?.message || "Bilinmeyen hata";
}

// ---------------------------------------------------------------------------
// Aktarım çalıştırıcı

type Validator = (payload: AnyRecord) => AnyRecord;

const validators: Record<string, Validator> = {
  lead: (payload) => LeadSchema.parse(payload) as AnyRecord,
  contacts: (payload) => ({ ...payload, ...ContactSchema.parse(payload) }),
  companies: (payload) => ({ ...payload, ...CompanySchema.parse(payload) }),
  activities: (payload) => ({ ...payload, ...ActivitySchema.parse(payload) }),
  call: (payload) => payload,
};

function mergeRecord(kind: string, existing: AnyRecord | undefined, mapped: AnyRecord): AnyRecord {
  if (!existing) return mapped;
  const merged: AnyRecord = { ...existing, ...mapped };
  if (Array.isArray(existing.tags) || Array.isArray(mapped.tags))
    merged.tags = [...new Set([...(existing.tags || []), ...(mapped.tags || [])].map(String))].slice(0, 100);
  if (existing.customFields || mapped.customFields)
    merged.customFields = { ...(existing.customFields || {}), ...(mapped.customFields || {}) };
  // XRE'de bağlanmış ilişkiler Bitrix'ten boş gelirse korunur.
  for (const field of ["leadId", "contactId", "companyId", "phone", "email", "owner", "assignee", "agent"])
    if (existing[field] && !mapped[field]) merged[field] = existing[field];
  if (kind === "lead" && existing.createdAt) merged.createdAt = existing.createdAt;
  return merged;
}

async function saveRecord(
  store: Store,
  owner: string,
  job: BitrixImportJob,
  entity: BitrixImportEntity,
  kind: string,
  mapped: AnyRecord,
): Promise<AnyRecord | null> {
  const counter = job.entities[entity]!;
  try {
    if (!String(mapped.id || "").startsWith("bx-"))
      throw new Error("Yalnızca bx- kimlikli kayıtlar yazılabilir.");
    const existing = await store.get<AnyRecord>(kind, mapped.id, owner);
    const payload = validators[kind](mergeRecord(kind, existing?.payload, mapped));
    await store.put(kind, mapped.id, payload, owner);
    if (existing) counter.updated += 1;
    else counter.imported += 1;
    return payload;
  } catch (error) {
    counter.failed += 1;
    pushError(job, `${mapped.id}: ${zodMessage(error)}`);
    return null;
  }
}

function sinceFilter(field: string, since?: string): AnyRecord {
  return since ? { [`>=${field}`]: since } : {};
}

const FULL_SELECT = ["*", "UF_*", "PHONE", "EMAIL"];

async function fetchByIds(
  client: BitrixClient,
  method: string,
  ids: string[],
  select: string[],
  into: Map<string, AnyRecord>,
): Promise<void> {
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    await client.listAll(method, { filter: { ID: chunk }, select }, (items) => {
      for (const row of items) into.set(String(row.ID), row);
    });
  }
}

async function buildLeadLookup(store: Store, owner: string): Promise<LeadLookup> {
  const leads = await store.list<AnyRecord>("lead", owner);
  const lookup: LeadLookup = { ids: new Set(), byPhone: new Map(), byContact: new Map() };
  // Bitrix kayıtları telefon eşleşmesinde öncelikli olsun diye sona alınır.
  const ordered = [
    ...leads.filter((row) => !row.id.startsWith("bx-")),
    ...leads.filter((row) => row.id.startsWith("bx-")),
  ];
  for (const row of ordered) {
    lookup.ids.add(row.id);
    const phone = normalizePhone(row.payload?.phone);
    if (phone) lookup.byPhone.set(phone, row.id);
    const contactId = String(row.payload?.contactId || "");
    if (contactId && !lookup.byContact.has(contactId)) lookup.byContact.set(contactId, row.id);
  }
  return lookup;
}

/**
 * Aktarımı uçtan uca çalıştırır. Rotalar arka planda çağırır; testler doğrudan
 * `await` edebilir. İş nesnesi ilerlemeyle güncellenir.
 */
export async function runBitrixImport(
  store: Store,
  owner: string,
  options: BitrixImportOptions,
  job: BitrixImportJob = createImportJob(owner, normalizeBitrixWebhook(options.webhookUrl), options.entities),
  clientOptions: BitrixClientOptions = {},
): Promise<BitrixImportJob> {
  const base = normalizeBitrixWebhook(options.webhookUrl);
  const entities = new Set(options.entities);
  for (const entity of entities)
    job.entities[entity] ??= { total: 0, imported: 0, updated: 0, failed: 0 };
  const client = new BitrixClient(base, {
    ...clientOptions,
    isCancelled: () => job.cancelRequested || Boolean(clientOptions.isCancelled?.()),
  });
  const since = options.since ? toIso(options.since) : undefined;
  const checkCancel = () => {
    if (job.cancelRequested) throw new CancelledError();
  };
  try {
    logLine(job, "Bitrix24 kullanıcıları okunuyor…");
    let users: Record<string, string> = {};
    try {
      users = await loadBitrixUsers(client);
      logLine(job, `${Object.keys(users).length} kullanıcı bulundu.`);
    } catch (error) {
      if (error instanceof CancelledError) throw error;
      pushError(job, `Kullanıcılar okunamadı; sorumlu adları boş kalacak. ${(error as Error).message}`);
    }
    let stageCtx: StageContext = { stages: [], stageMap: {}, sourceNames: {} };
    if (entities.has("leads") || entities.has("deals")) {
      logLine(job, "Aşamalar ve kaynaklar okunuyor…");
      stageCtx = await loadBitrixStages(client);
    }
    const ctx: MappingContext = {
      users,
      stageMap: { ...stageCtx.stageMap, ...(options.stageMap || {}) },
      sourceNames: stageCtx.sourceNames,
      contacts: new Map(),
      companies: new Map(),
      importedAt: nowIso(),
    };

    const importList = async (
      entity: BitrixImportEntity,
      method: string,
      params: AnyRecord,
      kind: string,
      map: (row: AnyRecord) => AnyRecord,
      remember?: (row: AnyRecord) => void,
    ) => {
      const counter = job.entities[entity]!;
      logLine(job, `${entity}: aktarım başladı.`);
      await client.listAll(method, params, async (items, total) => {
        counter.total = total;
        for (const row of items) {
          checkCancel();
          remember?.(row);
          let mapped: AnyRecord;
          try {
            mapped = map(row);
          } catch (error) {
            counter.failed += 1;
            pushError(job, `${entity} #${row?.ID}: ${zodMessage(error)}`);
            continue;
          }
          await saveRecord(store, owner, job, entity, kind, mapped);
        }
      });
      logLine(
        job,
        `${entity}: ${counter.imported} yeni, ${counter.updated} güncellendi, ${counter.failed} hatalı.`,
      );
    };

    const crmParams = (extra: AnyRecord = {}) => ({
      order: { ID: "ASC" },
      filter: sinceFilter("DATE_MODIFY", since),
      select: FULL_SELECT,
      ...extra,
    });

    if (entities.has("companies"))
      await importList("companies", "crm.company.list", crmParams(), "companies", (row) => mapBitrixCompany(row, ctx), (row) => ctx.companies.set(String(row.ID), row));
    checkCancel();
    if (entities.has("contacts"))
      await importList("contacts", "crm.contact.list", crmParams(), "contacts", (row) => mapBitrixContact(row, ctx), (row) => ctx.contacts.set(String(row.ID), row));
    checkCancel();
    if (entities.has("leads"))
      await importList("leads", "crm.lead.list", crmParams(), "lead", (row) => mapBitrixLead(row, ctx));
    checkCancel();
    if (entities.has("deals")) {
      // Anlaşmalar sayfa sayfa okunur; bağlı kişi/şirket bilgisi eksikse toplu çekilir.
      const counter = job.entities.deals!;
      logLine(job, "deals: aktarım başladı.");
      await client.listAll("crm.deal.list", crmParams({ select: ["*", "UF_*"] }), async (items, total) => {
        counter.total = total;
        checkCancel();
        const missingContacts = [
          ...new Set(
            items
              .map((row) => String(row.CONTACT_ID ?? ""))
              .filter((id) => Number(id) > 0 && !ctx.contacts.has(id)),
          ),
        ];
        const missingCompanies = [
          ...new Set(
            items
              .map((row) => String(row.COMPANY_ID ?? ""))
              .filter((id) => Number(id) > 0 && !ctx.companies.has(id)),
          ),
        ];
        try {
          if (missingContacts.length)
            await fetchByIds(client, "crm.contact.list", missingContacts, ["ID", "NAME", "SECOND_NAME", "LAST_NAME", "PHONE", "EMAIL", "ADDRESS_CITY"], ctx.contacts);
          if (missingCompanies.length)
            await fetchByIds(client, "crm.company.list", missingCompanies, ["ID", "TITLE", "PHONE", "EMAIL"], ctx.companies);
        } catch (error) {
          if (error instanceof CancelledError) throw error;
          pushError(job, `Anlaşmalara bağlı kişi/şirket okunamadı: ${(error as Error).message}`);
        }
        for (const row of items) {
          checkCancel();
          let mapped: AnyRecord;
          try {
            mapped = mapBitrixDeal(row, ctx);
          } catch (error) {
            counter.failed += 1;
            pushError(job, `deals #${row?.ID}: ${zodMessage(error)}`);
            continue;
          }
          await saveRecord(store, owner, job, "deals", "lead", mapped);
        }
      });
      logLine(job, `deals: ${counter.imported} yeni, ${counter.updated} güncellendi, ${counter.failed} hatalı.`);
    }
    checkCancel();
    if (entities.has("activities") || entities.has("calls")) {
      const lookup = await buildLeadLookup(store, owner);
      if (entities.has("activities"))
        await importList(
          "activities",
          "crm.activity.list",
          {
            order: { ID: "ASC" },
            filter: { OWNER_TYPE_ID: [1, 2, 3], ...sinceFilter("LAST_UPDATED", since) },
            select: ["*"],
          },
          "activities",
          (row) => mapBitrixActivity(row, ctx, lookup),
        );
      checkCancel();
      if (entities.has("calls"))
        await importList(
          "calls",
          "voximplant.statistic.get",
          {
            SORT: "CALL_START_DATE",
            ORDER: "ASC",
            FILTER: sinceFilter("CALL_START_DATE", since),
          },
          "call",
          (row) => mapBitrixCall(row, ctx, lookup),
        );
    }
    job.status = "completed";
    logLine(job, `Aktarım tamamlandı (${client.requests} Bitrix isteği).`);
  } catch (error) {
    if (error instanceof CancelledError || job.cancelRequested) {
      job.status = "cancelled";
      logLine(job, "Aktarım iptal edildi. Bu ana kadar yazılan kayıtlar korunur.");
    } else {
      job.status = "failed";
      pushError(job, (error as Error).message || "Aktarım başarısız.");
      logLine(job, "Aktarım hata ile durdu.");
    }
  } finally {
    job.finishedAt = nowIso();
  }
  return job;
}

// ---------------------------------------------------------------------------
// Önizleme

export async function previewBitrix(
  webhookUrl: string,
  clientOptions: BitrixClientOptions = {},
  since?: string,
): Promise<BitrixPreview> {
  const base = normalizeBitrixWebhook(webhookUrl);
  const client = new BitrixClient(base, clientOptions);
  const warnings: string[] = [];
  const sinceIso = since ? toIso(since) : undefined;
  // İlk çağrı yetkiyi doğrular; hata olursa önizleme tümden başarısız olur.
  let userCount: number | null = null;
  try {
    userCount = await client.count("user.get", {});
  } catch (error) {
    if ((error as BitrixImportError).code === "BITRIX_UNREACHABLE") throw error;
    warnings.push(`Kullanıcılar okunamadı (user kapsamı gerekli): ${(error as Error).message}`);
  }
  const counts: BitrixPreview["counts"] = {};
  const plan: [BitrixImportEntity, string, AnyRecord][] = [
    ["leads", "crm.lead.list", { filter: sinceFilter("DATE_MODIFY", sinceIso), select: ["ID"] }],
    ["deals", "crm.deal.list", { filter: sinceFilter("DATE_MODIFY", sinceIso), select: ["ID"] }],
    ["contacts", "crm.contact.list", { filter: sinceFilter("DATE_MODIFY", sinceIso), select: ["ID"] }],
    ["companies", "crm.company.list", { filter: sinceFilter("DATE_MODIFY", sinceIso), select: ["ID"] }],
    ["activities", "crm.activity.list", { filter: { OWNER_TYPE_ID: [1, 2, 3], ...sinceFilter("LAST_UPDATED", sinceIso) }, select: ["ID"] }],
    ["calls", "voximplant.statistic.get", { FILTER: sinceFilter("CALL_START_DATE", sinceIso) }],
  ];
  let crmFailures = 0;
  for (const [entity, method, params] of plan) {
    try {
      counts[entity] = await client.count(method, params);
    } catch (error) {
      counts[entity] = null;
      if (entity !== "calls") crmFailures += 1;
      warnings.push(
        `${entity === "calls" ? "Arama kayıtları (telephony kapsamı gerekli)" : entity} okunamadı: ${(error as Error).message}`,
      );
    }
  }
  if (crmFailures === plan.length - 1 && userCount === null)
    throw new BitrixImportError(
      "Bitrix24 webhook adresine erişildi ancak hiçbir veri okunamadı. Adres ve izinleri kontrol edin.",
      400,
      "BITRIX_NO_ACCESS",
    );
  let stages: BitrixDetectedStage[] = [];
  let stageMap: Record<string, XreStage> = {};
  try {
    ({ stages, stageMap } = await loadBitrixStages(client));
  } catch (error) {
    warnings.push(`Aşamalar okunamadı: ${(error as Error).message}`);
  }
  return { webhook: maskBitrixWebhook(base), counts, userCount, stages, stageMap, warnings };
}

// ---------------------------------------------------------------------------
// Rotalar

function ownerOf(req: Request): string {
  const owner = (req as any).auth?.ownerOpenId;
  if (typeof owner !== "string" || !owner.trim())
    throw new BitrixImportError("Geçerli oturum gerekli.", 401, "UNAUTHORIZED");
  return owner.trim();
}

function sendError(res: ExpressResponse, error: unknown): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: zodMessage(error) });
    return;
  }
  const err = error as BitrixImportError & { statusCode?: number };
  const status = typeof err?.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  res.status(status).json({
    error: err?.code || "BITRIX_IMPORT_ERROR",
    message: status === 500 ? "Bitrix24 aktarımı sırasında beklenmeyen hata." : err.message,
  });
}

function resolveWebhook(body: AnyRecord): string {
  const raw = typeof body.webhookUrl === "string" && body.webhookUrl.trim() ? body.webhookUrl : process.env.BITRIX_WEBHOOK;
  return normalizeBitrixWebhook(raw);
}

const isoSince = z
  .string()
  .max(64)
  .refine((value) => value === "" || !Number.isNaN(Date.parse(value)), "Geçerli bir tarih gerekli.")
  .optional();

const PreviewBody = z.object({
  webhookUrl: z.string().max(2048).optional(),
  since: isoSince,
});

const StartBody = z.object({
  webhookUrl: z.string().max(2048).optional(),
  entities: z.array(z.enum(BITRIX_IMPORT_ENTITIES)).min(1, "En az bir veri türü seçin.").max(BITRIX_IMPORT_ENTITIES.length),
  stageMap: z.record(z.string().max(300), z.enum(XRE_STAGES)).optional(),
  since: isoSince,
});

/**
 * `baseStore` verilirse geçmiş veriler canlı kurallar (randevu zorunluluğu,
 * giden webhook olayları, AI analizi) tetiklenmeden doğrudan veri katmanına yazılır.
 */
export function registerBitrixImportRoutes(app: Express, store: Store, baseStore?: Store): void {
  const writeStore = baseStore || rawStoreOf(store);

  app.post("/api/bitrix-import/preview", async (req, res) => {
    try {
      ownerOf(req);
      const body = PreviewBody.parse(req.body ?? {});
      const webhook = resolveWebhook(body);
      res.json(await previewBitrix(webhook, {}, body.since || undefined));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/bitrix-import/start", async (req, res) => {
    try {
      const owner = ownerOf(req);
      const body = StartBody.parse(req.body ?? {});
      const webhook = resolveWebhook(body);
      const current = jobs.get(owner);
      if (current?.status === "running")
        return res.status(409).json({
          error: "BITRIX_IMPORT_RUNNING",
          message: "Devam eden bir Bitrix24 aktarımı var. Bitmesini bekleyin veya iptal edin.",
          jobId: current.id,
        });
      const entities = [...new Set(body.entities)];
      const job = createImportJob(owner, webhook, entities);
      jobs.set(owner, job);
      void runBitrixImport(
        writeStore,
        owner,
        { webhookUrl: webhook, entities, stageMap: body.stageMap, since: body.since || undefined },
        job,
      ).catch((error) => {
        job.status = "failed";
        job.finishedAt = nowIso();
        pushError(job, (error as Error)?.message || "Aktarım başarısız.");
      });
      return res.status(202).json({ jobId: job.id });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/bitrix-import/status", (req, res) => {
    try {
      const job = jobs.get(ownerOf(req));
      res.json(job ? publicJob(job) : { id: null, status: "idle" });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/bitrix-import/cancel", (req, res) => {
    try {
      const job = jobs.get(ownerOf(req));
      if (!job || job.status !== "running")
        return res.status(409).json({ error: "BITRIX_IMPORT_NOT_RUNNING", message: "İptal edilecek çalışan bir aktarım yok." });
      job.cancelRequested = true;
      logLine(job, "İptal istendi…");
      return res.json({ ok: true, jobId: job.id });
    } catch (error) {
      sendError(res, error);
    }
  });
}

export type { BitrixJobStatus, BitrixEntityCounter };
