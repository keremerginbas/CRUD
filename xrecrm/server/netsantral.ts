// Netgsm Netsantral (bulut santral) sürücüsü: tıkla-ara, arama olayları ve
// görüşme sonu kaydı (cdr).
//
// ÖNEMLİ: Buradaki adresler ve alan adları Netgsm'in 2023 tarihli resmî PHP
// paketinden (netgsm/netsantral) alınmıştır; canlı hesapla HENÜZ DOĞRULANMADI.
// İlk gerçek aramada kontrol edilecekler docs/netsantral.md içinde listelidir.
// Sağlayıcıya özgü her varsayım bu dosyada toplanmıştır; düzeltme gerekirse
// yalnız burası değişir.
import crypto from "node:crypto";
import express, { type Express } from "express";
import type { Store } from "./db.js";
import { fetchWithTimeout, normalizePhone, OutboundSecurityError, timingSafeEqualText } from "./security.js";

const env = (k: string) => process.env[k]?.trim() || "";

/** Sağlayıcının belgelediği tek adres düz HTTP'dir; yalnız bu sunucu için HTTP'ye izin verilir. */
const VENDOR_HTTP_HOST = "crmsntrl.netgsm.com.tr";
export const NETSANTRAL_DEFAULT_API_URL = `http://${VENDOR_HTTP_HOST}:9111`;
/** Görüşme kayıtlarının indirildiği tek kabul edilen sunucu. */
const RECORDING_HOST = "dosyaindir.netgsm.com.tr";
export const NETSANTRAL_PROVIDER = "netsantral";
export const NETSANTRAL_PORTAL_PATH = "Ayarlar → Genel Ayarlar → API Talep Ayarları";
const MIN_SECRET_LENGTH = 16;

export interface NetsantralConfig {
  usercode: string;
  password: string;
  pbxnum: string;
  trunk: string;
  ringTimeout: number;
  originateOrder: "if" | "of";
  apiUrl: string;
  webhookSecret: string;
}

export function netsantralConfig(): NetsantralConfig {
  const timeout = Math.round(Number(env("NETSANTRAL_RING_TIMEOUT")));
  const pbxnum = env("NETSANTRAL_PBX_NUMBER").replace(/\D/g, "");
  return {
    usercode: env("NETSANTRAL_USERCODE"),
    password: env("NETSANTRAL_PASSWORD"),
    pbxnum,
    // Paket "trunk" alanını zorunlu sayar; boşsa santral numarası gönderilir (doğrulanmalı).
    trunk: env("NETSANTRAL_TRUNK").replace(/\D/g, "") || pbxnum,
    ringTimeout: Number.isFinite(timeout) && timeout > 0 ? Math.min(120, Math.max(5, timeout)) : 20,
    // if: önce dahili çalar (varsayılan). of: önce müşteri aranır.
    originateOrder: env("NETSANTRAL_ORIGINATE_ORDER").toLowerCase() === "of" ? "of" : "if",
    apiUrl: env("NETSANTRAL_API_URL") || NETSANTRAL_DEFAULT_API_URL,
    webhookSecret: env("NETSANTRAL_WEBHOOK_SECRET"),
  };
}

/** Tıkla-ara için eksik zorunlu ayarların (kullanıcının gördüğü adlarıyla) listesi. */
export function netsantralMissing(cfg = netsantralConfig()): string[] {
  const missing: string[] = [];
  if (!cfg.usercode) missing.push("API kullanıcı adı");
  if (!cfg.password) missing.push("API şifresi");
  if (!cfg.pbxnum) missing.push("Santral numarası");
  return missing;
}

export function netsantralConfigured(): boolean {
  return netsantralMissing().length === 0;
}

export function netsantralWebhookUrl(origin: string, secret: string): string {
  return `${origin.replace(/\/$/, "")}/api/webhooks/netsantral/${encodeURIComponent(secret)}`;
}

/**
 * Arama kimliğini tek biçime indirir. Canlı olaylarda kimlik "1428481945.3543",
 * görüşme sonu kaydında "sip8-1611752738.106785" biçimindedir; ikisi de aynı
 * kayda gitsin diye sunucu ön eki atılır. (Ön ekin yalnız sunucu adı olduğu
 * varsayımdır; doğrulanmalı.)
 */
export function normalizeNetsantralId(raw: unknown): string {
  const text = String(raw ?? "").trim();
  const core = text.match(/(\d{5,}\.\d+)$/)?.[1];
  return (core || text.replace(/[^\w.:-]/g, "")).slice(0, 80);
}

function scrub(text: string, cfg: NetsantralConfig): string {
  let out = text;
  for (const secret of [cfg.password, encodeURIComponent(cfg.password)])
    if (secret) out = out.split(secret).join("***");
  return out.replace(/https?:\/\/\S+/gi, "[adres]").replace(/\s+/g, " ").trim();
}

/**
 * Tıkla-ara adresi. Şifre adresin içindedir: bu değer ASLA günlüğe, hata
 * iletisine veya kayda yazılmamalıdır.
 */
export function netsantralOriginateUrl(
  cfg: NetsantralConfig,
  input: { ext: string; number: string; callId: string },
): string {
  const base = new URL(cfg.apiUrl);
  // Servis adresine yol yazıldıysa (ör. …:9111/8500000000) olduğu gibi kullanılır;
  // yazılmadıysa paketteki gibi yol olarak API kullanıcı adı eklenir.
  const prefix = base.pathname.replace(/\/+$/, "") || `/${encodeURIComponent(cfg.usercode)}`;
  const url = new URL(`${prefix}/originate`, base.origin);
  const params: Record<string, string> = {
    username: cfg.usercode,
    password: cfg.password,
    customer_num: input.number,
    pbxnum: cfg.pbxnum,
    internal_num: input.ext,
    ring_timeout: String(cfg.ringTimeout),
    crm_id: input.callId,
    // 0: istek aramanın sonucunu beklemeden hemen döner (paketin varsayılanı).
    wait_response: "0",
    originate_order: cfg.originateOrder,
    trunk: cfg.trunk,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Sağlayıcı hatasını çalışanın anlayacağı Türkçe iletiye çevirir. */
export function netsantralErrorMessage(body: unknown, httpStatus: number, cfg = netsantralConfig()): string {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = Number(data.code);
  const vendor = scrub(String(data.message ?? ""), cfg).slice(0, 160);
  if (/parametre/i.test(vendor))
    return "Netsantral aramayı başlatmadı: dahili numaranız ya da dış hat numarası santralde tanımlı görünmüyor. Arama penceresindeki dahili numaranızı ve Entegrasyonlar → Netsantral bölümündeki santral / dış hat numarasını kontrol edin.";
  if (/channel not specified/i.test(vendor))
    return "Netsantral aramayı başlatmadı: arama sırası ayarı geçersiz. Entegrasyonlar → Netsantral bölümünde \"Arama sırası\" alanına if ya da of yazın.";
  if (/no registration/i.test(vendor))
    return "Dahili telefonunuz santrale bağlı görünmüyor. Telefonunuzun (ya da telefon uygulamanızın) açık ve bağlı olduğunu kontrol edin.";
  if (code === 30 || /do[gğ]rulanamad/i.test(vendor))
    return "Netsantral girişi kabul etmedi. API kullanıcı adı ya da şifresi yanlış, bu kullanıcıya API yetkisi verilmemiş ya da Netgsm panelindeki IP kısıtlaması bu sunucunun adresine izin vermiyor olabilir.";
  if (code === 40) return "Netsantral santral numarasını tanımadı. Entegrasyonlar → Netsantral bölümündeki santral numarasını kontrol edin.";
  if (code === 70) return "Netsantral isteği eksik buldu. Entegrasyonlar → Netsantral bölümündeki alanları kontrol edin.";
  if (code === 80) return "Netsantral çok sık istek geldiğini bildirdi (sınır aşıldı). Bir dakika bekleyip yeniden deneyin.";
  if (code === 100) return "Netsantral tarafında geçici bir sorun oluştu. Biraz sonra yeniden deneyin.";
  return vendor
    ? `Netsantral aramayı başlatmadı: ${vendor}`
    : `Netsantral aramayı başlatmadı (yanıt kodu ${httpStatus}).`;
}

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

/**
 * Dahiliyi çaldırıp müşteriyi arar. HTTP 200 yalnız isteğin alındığını gösterir;
 * görüşmenin açıldığı anlamına gelmez (sonuç olaylarla ve cdr ile gelir).
 */
export async function netsantralOriginate(input: { ext: string; number: string; callId: string }): Promise<{ message: string; providerCallId: string }> {
  const cfg = netsantralConfig();
  const missing = netsantralMissing(cfg);
  if (missing.length)
    throw fail(`Netsantral ayarları eksik: ${missing.join(", ")}. Entegrasyonlar → Netsantral bölümünü doldurun.`, 503);
  let response: Response;
  let text = "";
  try {
    response = await fetchWithTimeout(
      netsantralOriginateUrl(cfg, input),
      { method: "GET", headers: { accept: "application/json" } },
      15000,
      { allowHttpHost: VENDOR_HTTP_HOST },
    );
    text = (await response.text()).slice(0, 4000);
  } catch (error) {
    // Asıl hata adresi (dolayısıyla şifreyi) içerebilir; bilerek aktarılmaz.
    if (error instanceof OutboundSecurityError)
      throw fail(`Netsantral servis adresi kabul edilmedi: ${error.message}`, 400);
    throw fail(
      (error as { name?: string })?.name === "AbortError"
        ? "Netsantral zamanında yanıt vermedi. Biraz sonra yeniden deneyin."
        : "Netsantral sunucusuna ulaşılamadı. İnternet bağlantısını ve servis adresini kontrol edin.",
      502,
    );
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
  } catch {
    body = null;
  }
  if (!response.ok) throw fail(netsantralErrorMessage(body, response.status, cfg), 502);
  // DOĞRULANMALI: Belgelenen tek başarılı yanıt JSON'dur ve "status" alanı
  // "Success"tir. Bunun dışındaki her yanıt (düz metin, "status" alanı farklı
  // ya da hata kodu içeren JSON) başarısız sayılır; böylece başlamamış bir arama
  // için "telefonunuz çalıyor" denmez. Gerçek hesapta başarılı yanıt farklı
  // çıkarsa yalnız netsantralAccepted düzeltilir.
  if (!body)
    throw fail("Netsantral beklenmeyen bir yanıt verdi; aramanın başlayıp başlamadığı anlaşılamadı. Telefonunuz çalmadıysa biraz sonra yeniden deneyin.", 502);
  if (!netsantralAccepted(body)) throw fail(netsantralErrorMessage(body, response.status, cfg), 502);
  // Kimlik yoksa kayıt sonradan gelen olaylarla telefon numarasından eşleştirilir.
  return { message: "Netsantral aramayı kabul etti.", providerCallId: normalizeNetsantralId(body.unique_id) };
}

/** Tıkla-ara yanıtı aramanın kabul edildiğini gösteriyor mu? (Doğrulanmalı.) */
export function netsantralAccepted(body: Record<string, unknown>): boolean {
  const status = String(body.status ?? "").trim().toLowerCase();
  if (body.code !== undefined && body.code !== null && status !== "success") return false;
  if (status) return status === "success";
  // "status" hiç yoksa yalnız arama kimliği dönmüşse kabul edilmiş sayılır.
  return Boolean(normalizeNetsantralId(body.unique_id));
}

// ---------------------------------------------------------------------------
// Olaylar (webhook)
// ---------------------------------------------------------------------------

/** Yalnız Netgsm'in kayıt indirme sunucusundaki https bağlantıları saklanır. */
export function netsantralRecordingUrl(raw: unknown): string {
  try {
    const url = new URL(String(raw ?? "").trim());
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== RECORDING_HOST) return "";
    if (url.username || url.password || (url.port && url.port !== "443")) return "";
    return url.toString().slice(0, 2048);
  } catch {
    return "";
  }
}

/**
 * Görüşme sonu kaydından "cevaplandı mı" sonucunu çıkarır.
 *
 * DİKKAT — İLK GERÇEK ARAMADA DOĞRULANMALI: "sondurum" ve "yon" alanlarının
 * değerlerinin anlamı belgelenmemiştir; bu yüzden karar bilerek onlara
 * dayanmaz. Sıra şöyledir:
 *  1. Süre ("sure") sıfırdan büyükse ya da kapanış olayı (Hangup) sıfırdan
 *     büyük konuşma süresi ("talktime") bildirdiyse görüşme cevaplanmıştır.
 *  2. "sure" alanı hiç gelmediyse (null) cevap olayına (Answer) bakılır.
 *  3. "sure" 0 geldiyse ve konuşma süresi yoksa cevapsızdır. Cevap olayı tek
 *     başına yetmez: tıkla-arada çalışanın kendi dahilisini açması da cevap
 *     olayı üretebilir (belgelenmemiş), müşteri açmamış olabilir.
 * "sure" çalma süresini de içeriyorsa cevapsız aramalar cevaplanmış görünür;
 * o durumda yalnız bu işlev düzeltilir. Ham değerler kayıtta (providerMeta)
 * saklanır, sonradan incelenebilir.
 */
export function netsantralCdrOutcome(input: {
  sure: number | null;
  sondurum: string;
  yon: string;
  sawAnswer?: boolean;
  talktime?: number;
}): { answered: boolean } {
  if ((input.sure ?? 0) > 0 || (input.talktime ?? 0) > 0) return { answered: true };
  if (input.sure === null) return { answered: input.sawAnswer === true };
  return { answered: false };
}

type Body = Record<string, unknown>;

/** Alan adlarının büyük/küçük harfi belgede tutarsız olduğundan harf duyarsız okunur. */
function field(body: Body, ...names: string[]): string {
  for (const name of names) {
    const wanted = name.toLowerCase();
    for (const [k, v] of Object.entries(body))
      if (k.toLowerCase() === wanted && v !== null && v !== undefined && typeof v !== "object") {
        const text = String(v).trim();
        if (text) return text;
      }
  }
  return "";
}

const extOf = (value: string) => (/^\d{2,6}$/.test(value) ? value : "");
const short = (value: string, max = 60) => value.replace(/[^\p{L}\p{N} .:+@_-]/gu, "").slice(0, max);
const seconds = (value: string) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(86_400, n) : 0;
};

function eventTime(body: Body): string | undefined {
  const ms = Number(field(body, "timestamp"));
  // 2015–2100 arası milisaniye değeri değilse yok sayılır.
  return Number.isFinite(ms) && ms > 1.4e12 && ms < 4.1e12 ? new Date(ms).toISOString() : undefined;
}

/** "2021-01-27 16:05:38" (Türkiye saati) → ISO. */
function localTime(value: string): string | undefined {
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m) return undefined;
  const iso = `${m[1]}T${m[2]}+03:00`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

const last10 = (value: string) => value.replace(/\D/g, "").slice(-10);

/**
 * Netgsm numarayı baştaki 0 olmadan gönderirse (ör. 2125550000) CRM'deki
 * "0212 555 00 00" kaydıyla eşleşsin diye başına 0 eklenir. Yalnız 10 haneli
 * yurt içi numaralar (alan kodu 2, 3, 4, 5 ya da 8 ile başlayan) etkilenir.
 * (Arayan numaranın hangi biçimde geldiği doğrulanmalı.)
 */
export function netsantralPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 && /^[23458]/.test(digits) ? `0${digits}` : value;
}

/**
 * Görüşme sonu kaydında arayan/aranan taraflardan müşteriyi ve yönü bulur.
 * "yon" değerinin anlamı belgelenmediği için kullanılmaz (doğrulanmalı).
 */
export function netsantralCdrParties(
  body: Body,
  cfg = netsantralConfig(),
): { direction: "inbound" | "outbound"; phone: string; agent: string } | null {
  const arayan = field(body, "arayan");
  const aranan = field(body, "aranan");
  // Kendi hatlarımız: santral, dış hat ve "yalnız şu hatlar" ayarındaki numaralar müşteri sayılmaz.
  const own = new Set([field(body, "santral"), cfg.pbxnum, cfg.trunk, ...netsantralOnlyList().numbers].map(last10).filter((v) => v.length === 10));
  const isOwn = (value: string) => /-queue-/i.test(value) || own.has(last10(value.match(/^\+?\d+/)?.[0] || ""));
  const valid = (value: string) => normalizePhone(value).length >= 10 && !isOwn(value);
  const callerExt = extOf(arayan);
  const calleeExt = extOf(aranan);
  // Dahiliden dahiliye aramalar CRM'e yazılmaz.
  if (callerExt && calleeExt) return null;
  const inbound = (agent: string) => ({ direction: "inbound" as const, phone: netsantralPhone(arayan), agent });
  const outbound = (agent: string) => ({ direction: "outbound" as const, phone: netsantralPhone(aranan), agent });
  if (callerExt) return valid(aranan) ? outbound(callerExt) : null;
  if (calleeExt) return valid(arayan) ? inbound(calleeExt) : null;
  if (isOwn(aranan) && valid(arayan)) return inbound("");
  if (isOwn(arayan) && valid(aranan)) return outbound("");
  if (valid(arayan)) return inbound("");
  if (valid(aranan)) return outbound("");
  return null;
}

/** JSON ya da form (urlencoded) gövdeyi olay listesine çevirir. */
export function parseNetsantralBody(raw: unknown): Body[] {
  if (raw && typeof raw === "object" && !Buffer.isBuffer(raw))
    return (Array.isArray(raw) ? raw : [raw]).filter((v) => v && typeof v === "object" && !Array.isArray(v)).slice(0, 20) as Body[];
  const text = (Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "")).trim();
  if (!text) return [];
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return parseNetsantralBody(JSON.parse(text));
    } catch {
      return [];
    }
  }
  const form: Body = {};
  for (const [k, v] of new URLSearchParams(text)) if (Object.keys(form).length < 60) form[k] = v;
  if (!field(form, "scenario"))
    for (const value of Object.values(form)) {
      const inner = String(value).trim();
      if (inner.startsWith("{")) {
        const parsed = parseNetsantralBody(inner);
        if (parsed.length) return parsed;
      }
    }
  return Object.keys(form).length ? [form] : [];
}

export interface NetsantralDeps {
  ownerScope(store: Store): Promise<string>;
  /** Genel arama kaydı girişi (call.log). */
  logCall(owner: string, input: Record<string, unknown>): Promise<unknown>;
  /** "Arama geliyor" bildirimi (call.ringing). */
  ring(owner: string, input: Record<string, unknown>): Promise<unknown>;
}

interface CallRecord {
  id: string;
  provider?: string;
  status?: string;
  direction?: string;
  phone?: string;
  agent?: string | null;
  durationSeconds?: number | null;
  startedAt?: string;
  createdAt?: string;
  providerCallId?: string;
  providerMeta?: Record<string, unknown>;
  [key: string]: unknown;
}

const FINAL = new Set(["ended", "missed"]);
const RANK: Record<string, number> = { queued: 0, ringing: 1, "in-progress": 2 };
const ADOPT_WINDOW_MS = 10 * 60_000;
const MAX_ALT_IDS = 8;

const altIdsOf = (c: CallRecord): string[] =>
  Array.isArray(c.providerMeta?.altIds) ? (c.providerMeta.altIds as unknown[]).map(String) : [];

/**
 * Olayın yazılacağı kaydı bulur; amaç tek aramanın tek kayıt olmasıdır. Sıra:
 *  1. Santral kimliğiyle açılmış kayıt.
 *  2. CRM'in tıkla-arada gönderdiği kendi kimliği ("crm_id"); santral olayda
 *     geri gönderirse en güvenilir eşleşme budur (gönderip göndermediği doğrulanmalı).
 *  3. Kayıtta saklanan santral kimliği ya da aynı aramanın başka bacağından
 *     daha önce görülmüş kimlik (altIds).
 *  4. Görüşme sonu kayıtlarındaki ortak kimlik ("ortakkimlik").
 *  5. Az önce CRM'den başlatılmış, aynı numaraya giden ve henüz bitmemiş arama.
 *     Santral, tıkla-ara yanıtındaki kimlikten FARKLI bir kimlikle olay
 *     gönderirse (ör. müşteri bacağı; doğrulanmalı) eşleşme buradan olur.
 */
async function findCall(
  store: Store,
  owner: string,
  uid: string,
  hint: { phone?: string; direction?: string; crmId?: string; commonId?: string; cdr?: boolean },
): Promise<{ key: string; record: CallRecord | null }> {
  if (uid) {
    const direct = (await store.get<CallRecord>("call", `pbx-${uid}`, owner))?.payload;
    if (direct) return { key: uid, record: direct };
  }
  const crmId = String(hint.crmId || "");
  if (/^pbx-orig-[\w-]{1,80}$/.test(crmId)) {
    const own = (await store.get<CallRecord>("call", crmId, owner))?.payload;
    if (own?.provider === NETSANTRAL_PROVIDER) return { key: crmId.slice(4), record: own };
  }
  const calls = (await store.list<CallRecord>("call", owner))
    .map((r) => r.payload)
    .filter((c) => c?.provider === NETSANTRAL_PROVIDER && typeof c.id === "string" && c.id.startsWith("pbx-"));
  const keyOf = (c: CallRecord) => c.id.slice(4);
  if (uid) {
    const linked = calls.find((c) => c.providerCallId === uid || altIdsOf(c).includes(uid));
    if (linked) return { key: keyOf(linked), record: linked };
  }
  if (hint.commonId) {
    const sibling = calls.find((c) => c.providerMeta?.ortakkimlik === hint.commonId);
    if (sibling) return { key: keyOf(sibling), record: sibling };
  }
  const phone = normalizePhone(hint.phone);
  if (phone && hint.direction !== "inbound") {
    const open = (c: CallRecord) =>
      c.status === "queued" || c.status === "ringing" || c.status === "in-progress" ||
      // Görüşme sonu kaydı, kapanış olayıyla bitmiş ama kaydı henüz gelmemiş aramaya da yazılır.
      (hint.cdr === true && c.providerMeta?.cdr !== true);
    const pending = calls
      .filter(
        (c) =>
          c.id.startsWith("pbx-orig-") &&
          c.direction === "outbound" &&
          open(c) &&
          c.phone === phone &&
          Date.now() - Date.parse(String(c.createdAt || "")) < ADOPT_WINDOW_MS,
      )
      // Önce santral kimliği henüz bilinmeyen kayıt, sonra en yenisi.
      .sort(
        (a, b) =>
          Number(Boolean(a.providerCallId)) - Number(Boolean(b.providerCallId)) ||
          String(b.createdAt).localeCompare(String(a.createdAt)),
      )[0];
    if (pending) return { key: keyOf(pending), record: pending };
  }
  return { key: uid, record: null };
}

async function annotate(store: Store, owner: string, key: string, uid: string, meta: Record<string, unknown>) {
  const record = (await store.get<CallRecord>("call", `pbx-${key}`, owner))?.payload;
  if (!record) return;
  const clean = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== "" && v !== undefined && v !== null));
  const providerMeta: Record<string, unknown> = { ...(record.providerMeta || {}), ...clean };
  // İlk öğrenilen santral kimliği korunur; aynı aramanın başka kimlikleri ayrıca tutulur.
  if (uid && record.providerCallId && record.providerCallId !== uid && uid !== key) {
    const alt = altIdsOf(record);
    if (!alt.includes(uid)) providerMeta.altIds = [...alt, uid].slice(-MAX_ALT_IDS);
  }
  await store.put("call", record.id, { ...record, providerCallId: record.providerCallId || uid || undefined, providerMeta }, owner);
}

/** Canlı olay kaydı geriye götürmez: bitmiş arama yeniden "çalıyor" olmaz. */
function advance(record: CallRecord | null, next: "ringing" | "in-progress"): string {
  const current = String(record?.status || "");
  if (!record || !current) return next;
  if (FINAL.has(current)) return next === "in-progress" && current === "missed" && !record.providerMeta?.cdr ? next : current;
  return (RANK[current] ?? 0) >= RANK[next] ? current : next;
}

/** Tek bir Netsantral olayını işler. Tanınmayan senaryolar sessizce yok sayılır. */
export async function processNetsantralEvent(store: Store, owner: string, body: Body, deps: NetsantralDeps): Promise<string> {
  const scenario = field(body, "scenario").toLowerCase();
  const fallbackKey = () => `ns-${crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 20)}`;

  if (scenario === "inbound_call" || scenario === "outbound_call") {
    const outbound = scenario === "outbound_call";
    const customer = netsantralPhone(field(body, "customer_num"));
    if (normalizePhone(customer).length < 10) return "ignored";
    const pbxNum = field(body, "pbx_num");
    // Gelen arama örneğinde dahili "pbx_num" alanında geliyor; ikisine de bakılır.
    const ext = extOf(field(body, "internal_num")) || extOf(pbxNum);
    const uid = normalizeNetsantralId(field(body, "unique_id"));
    const direction = outbound ? "outbound" : "inbound";
    const found = await findCall(store, owner, uid, { phone: customer, direction, crmId: field(body, "crm_id") });
    const key = found.key || fallbackKey();
    const before = found.record?.status || "";
    await deps.logCall(owner, {
      callId: key,
      phone: customer,
      direction,
      status: advance(found.record, "ringing"),
      agent: found.record?.agent ? undefined : ext || undefined,
      line: normalizePhone(pbxNum).length >= 10 ? pbxNum : undefined,
      startedAt: found.record?.startedAt || eventTime(body),
      provider: NETSANTRAL_PROVIDER,
      // Giden aramada müşteri kartı açılmaz; gelen aramada yoksa açılır.
      createLead: !outbound,
    });
    await annotate(store, owner, key, uid, {});
    if (!outbound && !FINAL.has(before) && before !== "in-progress")
      await deps.ring(owner, { phone: customer, ext: ext || undefined, direction, callId: `pbx-${key}` });
    return scenario;
  }

  if (scenario === "answer" || scenario === "hangup") {
    const uid = normalizeNetsantralId(field(body, "unique_id"));
    if (!uid) return "ignored";
    const customer = netsantralPhone(field(body, "customer_num"));
    const found = await findCall(store, owner, uid, { phone: customer, crmId: field(body, "crm_id") });
    const phone = found.record?.phone || (normalizePhone(customer).length >= 10 ? customer : "");
    // Hangi müşteriye ait olduğu bilinmeyen olay kayda dönüştürülemez.
    if (!phone) return "ignored";
    const ext = extOf(field(body, "internal_num"));
    const base = {
      callId: found.key,
      phone,
      direction: found.record?.direction || "inbound",
      provider: NETSANTRAL_PROVIDER,
      createLead: false,
    };
    if (scenario === "answer") {
      await deps.logCall(owner, { ...base, status: advance(found.record, "in-progress"), agent: ext || undefined });
      await annotate(store, owner, found.key, uid, { answered: true, holdtime: seconds(field(body, "holdtime")) || undefined });
      return scenario;
    }
    const talk = seconds(field(body, "talktime"));
    const answered = talk > 0 || found.record?.providerMeta?.answered === true || found.record?.status === "in-progress";
    // Görüşme sonu kaydı (cdr) geldiyse son söz ondadır.
    const status = found.record?.providerMeta?.cdr ? found.record.status : answered ? "ended" : "missed";
    await deps.logCall(owner, {
      ...base,
      status,
      agent: ext || undefined,
      durationSeconds: talk || undefined,
      endedAt: eventTime(body) || new Date().toISOString(),
    });
    await annotate(store, owner, found.key, uid, { answered, talktime: talk || undefined });
    return scenario;
  }

  if (scenario === "cdr") {
    const uid = normalizeNetsantralId(field(body, "asteriskId", "unique_id", "uniqueid"));
    const parties = netsantralCdrParties(body);
    // Aynı görüşmenin birden çok satırı (kuyruk + dahili, aktarma) ortak kimlik taşır.
    const ortakkimlik = short(field(body, "ortakkimlik", "commonid", "common_id"), 40).replace(/[^\w.:-]/g, "");
    const found = await findCall(store, owner, uid, { ...(parties || {}), crmId: field(body, "crm_id"), commonId: ortakkimlik, cdr: true });
    const phone = found.record?.phone || parties?.phone || "";
    if (normalizePhone(phone).length < 10) return "ignored";
    const direction = found.record?.direction || parties?.direction || "inbound";
    const rawSure = field(body, "sure");
    // "sure" alanı hiç gelmediyse ya da sayı değilse null: bilinen süre ve sonuç korunur.
    const sure = rawSure && Number.isFinite(Number(rawSure)) ? seconds(rawSure) : null;
    const sondurum = short(field(body, "sondurum"), 20);
    const yon = short(field(body, "yon"), 20);
    const previous = found.record?.providerMeta || {};
    const known = Math.max(0, Number(found.record?.durationSeconds) || 0);
    const talktime = Math.max(Number(previous.talktime) || 0, previous.cdr === true ? 0 : known);
    const outcome = netsantralCdrOutcome({ sure, sondurum, yon, sawAnswer: previous.answered === true, talktime });
    // Aynı görüşme için birden çok kayıt (ör. aktarma) gelirse cevaplanmış olan korunur.
    const answered = outcome.answered || (previous.cdr === true && found.record?.status === "ended");
    // Kayıt süre bildirdiyse o geçerlidir; bildirmediyse kapanış olayından bilinen süre silinmez.
    const duration = sure && sure > 0 ? Math.max(sure, previous.cdr === true ? known : 0) : answered ? known : 0;
    const key = found.key || (field(body, "kimlik") ? `ns-k${short(field(body, "kimlik"), 30).replace(/[^\w]/g, "")}` : fallbackKey());
    const santral = field(body, "santral");
    await deps.logCall(owner, {
      callId: key,
      phone,
      direction,
      status: answered ? "answered" : "no-answer",
      durationSeconds: duration,
      startedAt: localTime(field(body, "bas")) || found.record?.startedAt,
      endedAt: eventTime(body) || new Date().toISOString(),
      agent: parties?.agent || undefined,
      line: normalizePhone(santral).length >= 10 ? santral : undefined,
      recordingUrl: netsantralRecordingUrl(field(body, "seskaydi")) || undefined,
      provider: NETSANTRAL_PROVIDER,
      createLead: direction === "inbound",
    });
    await annotate(store, owner, key, uid, {
      cdr: true,
      sondurum,
      yon,
      sure: sure ?? undefined,
      kimlik: short(field(body, "kimlik"), 30),
      ortakkimlik,
      aranan: short(field(body, "aranan")),
      trunk: short(field(body, "trunk"), 30),
    });
    return scenario;
  }

  // Queue, DTMF, Context, InboundtoPBX ve bilinmeyen senaryolar.
  return "ignored";
}

/** "Yalnız şu dahili/hatlar" ayarı: virgülle ayrılmış dahili (125) ve hat numaraları (5330000000). */
export function netsantralOnlyList(): { exts: Set<string>; numbers: Set<string> } {
  const items = env("NETSANTRAL_ONLY").split(/[,;\s]+/).map((v) => v.replace(/\D/g, "")).filter(Boolean);
  return { exts: new Set(items.filter((v) => v.length <= 6)), numbers: new Set(items.filter((v) => v.length >= 7).map(last10)) };
}
/**
 * Santral başka işler için de kullanılıyorsa (ör. ortak santralde tek dahiliyle deneme) yalnız seçilen
 * dahili ya da hatların aramaları alınır. CRM'den başlatılmış (kaydı bulunan) aramalar her zaman alınır.
 * Süzülen bildirim hiç saklanmaz; başka kişilerin numaraları bu CRM'e yazılmaz.
 */
export async function netsantralFilteredOut(store: Store, owner: string, body: Body): Promise<boolean> {
  const only = netsantralOnlyList();
  if (!only.exts.size && !only.numbers.size) return false;
  const scenario = field(body, "scenario").toLowerCase();
  if (!["inbound_call", "outbound_call", "answer", "hangup", "cdr"].includes(scenario)) return true;
  const cdr = scenario === "cdr";
  const parties = cdr ? netsantralCdrParties(body) : null;
  const uid = normalizeNetsantralId(cdr ? field(body, "asteriskId", "unique_id", "uniqueid") : field(body, "unique_id"));
  const customer = cdr ? parties?.phone || "" : netsantralPhone(field(body, "customer_num"));
  const found = await findCall(store, owner, uid, {
    phone: customer,
    direction: cdr ? parties?.direction : scenario === "outbound_call" ? "outbound" : scenario === "inbound_call" ? "inbound" : undefined,
    crmId: field(body, "crm_id"),
    ...(cdr ? { commonId: short(field(body, "ortakkimlik", "commonid", "common_id"), 40).replace(/[^\w.:-]/g, ""), cdr: true } : {}),
  });
  if (found.record) return false;
  // Müşteri numarası dışındaki alanlar: dahili, santral/hat numarası, dış hat.
  const values = cdr
    ? [parties?.agent || "", field(body, "trunk"), field(body, "dahili"), parties?.direction === "outbound" ? field(body, "arayan") : field(body, "aranan")]
    : [field(body, "internal_num"), field(body, "pbx_num"), field(body, "trunk")];
  return !values.some((value) => {
    const digits = (value.match(/^\+?\d+/)?.[0] || "").replace(/\D/g, "");
    if (!digits) return false;
    return digits.length <= 6 ? only.exts.has(digits) : only.numbers.has(last10(digits));
  });
}

/**
 * Olayın saklanan ve işlenen biçimi: yalnız düz alanlar, sınırlı uzunlukta.
 * İşleme de bu biçim üzerinden yapılır; böylece yarıda kalan bir olay saklanan
 * kopyadan birebir aynı sonuçla yeniden işlenebilir.
 */
function storedPayload(body: Body): Body {
  return Object.fromEntries(
    Object.entries(body)
      .slice(0, 60)
      .map(([k, v]) => [k.slice(0, 60), typeof v === "object" && v !== null ? "[nesne]" : String(v ?? "").slice(0, 2100)]),
  );
}

let registered: { deps: NetsantralDeps } | null = null;
let lastEventAt = 0;
const EVENTS_FRESH_MS = 24 * 60 * 60_000;

/**
 * Netsantral yakın zamanda olay gönderdi mi? Gönderdiyse görüşmeler bildirim
 * adresinden kaydediliyordur; tarayıcı telefonu aynı görüşmeyi ikinci kez yazmaz.
 */
export function netsantralEventsActive(): boolean {
  return lastEventAt > 0 && Date.now() - lastEventAt < EVENTS_FRESH_MS;
}

/**
 * İşlenemeyen ya da yarıda kalan olayın arka plan işçisi tarafından saklanan
 * kopyadan yeniden işlenmesi. Hata fırlatırsa işçi aralığı artırarak yeniden dener.
 */
export async function replayNetsantralEvent(store: Store, owner: string, body: unknown): Promise<string> {
  if (!registered) throw new Error("Netsantral bildirim işleyicisi hazır değil.");
  if (!body || typeof body !== "object" || Array.isArray(body)) return "ignored";
  return processNetsantralEvent(store, owner, body as Body, registered.deps);
}

/** Dakikada kabul edilen en çok olay sayısı (adres sızarsa kayıt yağmuruna karşı). */
export const NETSANTRAL_EVENTS_PER_MINUTE = 300;
const RETRY_DELAY_MS = 30_000;
let rateWindow = { start: 0, count: 0 };
function overLimit(cost: number): boolean {
  const current = Date.now();
  if (current - rateWindow.start > 60_000) rateWindow = { start: current, count: 0 };
  rateWindow.count += cost;
  return rateWindow.count > NETSANTRAL_EVENTS_PER_MINUTE;
}
/** Yalnız testler için: sayaçları sıfırlar. */
export function resetNetsantralState() {
  rateWindow = { start: 0, count: 0 };
  lastEventAt = 0;
}

/**
 * Netsantral'ın olay gönderdiği genel adres. Netgsm tarafında imza ya da kimlik
 * doğrulama belgelenmediği için adresin içindeki sır tek korumadır.
 */
export function registerNetsantralWebhook(app: Express, store: Store, deps: NetsantralDeps) {
  registered = { deps };
  app.post(
    "/api/webhooks/netsantral/:secret",
    (req, res, next) => {
      const expected = netsantralConfig().webhookSecret;
      if (expected.length < MIN_SECRET_LENGTH || !timingSafeEqualText(String(req.params.secret || ""), expected))
        return res.status(404).json({ error: "NOT_FOUND" });
      next();
    },
    express.raw({ type: () => true, limit: "64kb" }),
    async (req, res) => {
      let events: Body[] = [];
      try {
        events = parseNetsantralBody(req.body);
      } catch {
        events = [];
      }
      // Sınır aşılırsa olay işlenmez; 429 ile santralin sonra yeniden denemesi istenir.
      if (overLimit(Math.max(1, events.length)))
        return res.status(429).json({ error: "RATE_LIMITED", message: `Dakikada en fazla ${NETSANTRAL_EVENTS_PER_MINUTE} bildirim kabul edilir.` });
      try {
        if (events.length) {
          const owner = await deps.ownerScope(store);
          for (const raw of events) {
            const body = storedPayload(raw);
            if (await netsantralFilteredOut(store, owner, body).catch(() => false)) continue;
            const key = `netsantral:${crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex")}`;
            const saved = await store.appendEvent(owner, key, { type: "webhook", provider: NETSANTRAL_PROVIDER, payload: body }, "received");
            // Aynı bildirim yeniden gelirse işlenmez; önceki deneme başarısızsa yeniden denenir.
            if (!saved.inserted && saved.event.status !== "failed") continue;
            try {
              const outcome = await processNetsantralEvent(store, owner, body, deps);
              if (outcome !== "ignored") lastEventAt = Date.now();
              await store.updateEvent(saved.event.id, owner, { status: "completed", nextAttemptAt: null, lastError: null });
            } catch (error) {
              const message = error instanceof Error ? error.message : "bilinmeyen hata";
              // Arka plan işçisi olayı saklanan kopyadan yeniden işler (bkz. replayNetsantralEvent).
              await store
                .updateEvent(saved.event.id, owner, {
                  status: "failed",
                  nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
                  lastError: message.slice(0, 500),
                })
                .catch(() => undefined);
              console.warn("Netsantral bildirimi işlenemedi:", message);
            }
          }
        }
      } catch (error) {
        console.warn("Netsantral bildirimi alınamadı:", error instanceof Error ? error.message : "bilinmeyen hata");
      }
      // Geçerli adrese gelen her bildirime hemen 200 dönülür; Netsantral yeniden denemesin.
      res.status(200).json({ received: true });
    },
  );
}
