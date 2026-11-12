// Turkcell Mesajüssü üzerinden SMS gönderimi.
// Sözleşme (giriş → token, kampanya oluşturma) herkese açık örnek kodlardan alınmıştır;
// resmî doküman bu ortamdan okunamadığı için canlı hesapla doğrulanması gerekir.
// Uç adresi ve numara biçimi bu yüzden ayarlardan değiştirilebilir.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { canAccess, rawStoreOf } from "./access.js";
import { envConfigured, fetchWithTimeout, normalizePhone } from "./security.js";
import { communicationAllowed } from "./workspaces.js";

const DEFAULT_BASE = "https://mesajussu.turkcell.com.tr/api/api/integration/v1";
const MAX_TEXT = 918; // 6 birleşik SMS (GSM-7) üst sınırı
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export class SmsError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "SMS_FAILED",
  ) {
    super(message);
  }
}

export const smsConfigured = () =>
  envConfigured("TURKCELL_SMS_USERNAME", "TURKCELL_SMS_PASSWORD", "TURKCELL_SMS_SENDER");

const env = (key: string) => process.env[key]?.trim() || "";
function baseUrl(): string {
  const raw = env("TURKCELL_SMS_BASE_URL") || DEFAULT_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SmsError("SMS servis adresi geçerli değil.", 503, "SMS_NOT_CONFIGURED");
  }
  if (url.protocol !== "https:") throw new SmsError("SMS servis adresi https ile başlamalı.", 503, "SMS_NOT_CONFIGURED");
  return raw.replace(/\/+$/, "");
}

/** Sağlayıcıya gönderilecek numara: varsayılan 10 haneli yerel (5xxxxxxxxx); ayarla 90'lı biçim seçilebilir. */
export function smsReceiver(phone: string): string {
  const digits = normalizePhone(phone);
  if (!/^\d{10,15}$/.test(digits)) throw new SmsError("Müşterinin telefon numarası SMS için geçerli değil.", 400, "INVALID_PHONE");
  if (env("TURKCELL_SMS_NUMBER_FORMAT") === "90") return digits;
  return digits.startsWith("90") && digits.length === 12 ? digits.slice(2) : digits;
}

/** Sağlayıcı çağrıları; testlerde sahte taşıyıcıyla değiştirilir. */
export interface SmsTransport {
  login(base: string, username: string, password: string): Promise<string>;
  send(base: string, token: string, body: Record<string, unknown>): Promise<{ ok: boolean; code: string; detail: string }>;
}
const httpTransport: SmsTransport = {
  async login(base, username, password) {
    const response = await fetchWithTimeout(`${base}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data: any = await response.json().catch(() => null);
    const token = typeof data?.token === "string" ? data.token : "";
    if (!response.ok || !token)
      throw new SmsError("Turkcell SMS girişi başarısız. Kullanıcı adı ve şifreyi kontrol edin.", 502, "SMS_LOGIN_FAILED");
    return token;
  },
  async send(base, token, body) {
    const response = await fetchWithTimeout(`${base}/sms/campaign/create/json`, {
      method: "POST",
      headers: { "content-type": "application/json", token },
      body: JSON.stringify(body),
    });
    const data: any = await response.json().catch(() => null);
    const code = String(data?.responseCode ?? response.status);
    const detail = String(data?.responseMessage || data?.message || data?.description || "").slice(0, 300);
    return { ok: response.ok && code === "200", code, detail };
  },
};
let transport: SmsTransport = httpTransport;
export const setSmsTransport = (value: SmsTransport | null) => {
  transport = value || httpTransport;
  cached = null;
};

let cached: { token: string; key: string; at: number } | null = null;
async function tokenFor(base: string, force = false): Promise<string> {
  const username = env("TURKCELL_SMS_USERNAME");
  const password = env("TURKCELL_SMS_PASSWORD");
  const key = crypto.createHash("sha256").update(`${base}|${username}|${password}`).digest("hex");
  if (!force && cached && cached.key === key && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const token = await transport.login(base, username, password);
  cached = { token, key, at: Date.now() };
  return token;
}

// Kullanıcı ve çalışma alanı başına gönderim sınırı (bellek içi).
const hits = new Map<string, { count: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const t = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < t) {
    hits.set(key, { count: 1, reset: t + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}
export const resetSmsLimits = () => hits.clear();

export function cleanSmsText(input: unknown): string {
  const text = String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .trim();
  if (!text) throw new SmsError("SMS metni gerekli.", 400, "INVALID");
  if (text.length > MAX_TEXT) throw new SmsError(`SMS metni en fazla ${MAX_TEXT} karakter olabilir.`, 400, "INVALID");
  return text;
}

/** Tek bir numaraya SMS gönderir; token süresi dolmuşsa bir kez yeniden giriş yapar. */
export async function sendSms(phone: string, textInput: unknown, campaign = "XRE CRM"): Promise<{ receiver: string; code: string }> {
  if (!smsConfigured()) throw new SmsError("Turkcell SMS bağlantısı yapılandırılmamış.", 503, "SMS_NOT_CONFIGURED");
  const base = baseUrl();
  const text = cleanSmsText(textInput);
  const receiver = smsReceiver(phone);
  const body = {
    messageText: text,
    sender: env("TURKCELL_SMS_SENDER"),
    campaignName: campaign.slice(0, 60),
    // Ticari ileti (reklam/kampanya) ise İYS izni aranır; bilgilendirme iletisi için kapalı tutulur.
    etkFlag: env("TURKCELL_SMS_COMMERCIAL") === "1",
    receivers: [Number(receiver)],
  };
  let result = await transport.send(base, await tokenFor(base), body);
  if (!result.ok && ["401", "403"].includes(result.code)) result = await transport.send(base, await tokenFor(base, true), body);
  if (!result.ok)
    throw new SmsError(
      `Turkcell SMS gönderimi reddetti (kod ${result.code})${result.detail ? `: ${result.detail}` : "."}`,
      502,
      "SMS_REJECTED",
    );
  return { receiver, code: result.code };
}

/** Müşteriye SMS gönderir ve müşteri kartının akışına kayıt düşer. */
export async function sendLeadSms(
  store: Store,
  owner: string,
  lead: Lead,
  text: unknown,
  author: string,
  recordId: string,
): Promise<{ receiver: string }> {
  const raw = rawStoreOf(store);
  if ((await raw.get("feed", recordId, owner))?.payload) return { receiver: "" }; // aynı olay ikinci kez gönderilmez
  if (!lead.phone) throw new SmsError("Müşterinin telefon numarası yok.", 400, "INVALID_PHONE");
  const clean = cleanSmsText(text);
  if (limited(`ws:${owner}`, 600, 3_600_000)) throw new SmsError("Saatlik SMS sınırına ulaşıldı.", 429, "RATE_LIMITED");
  const sent = await sendSms(lead.phone, clean);
  const stamp = new Date().toISOString();
  await raw.put(
    "feed",
    recordId,
    { id: recordId, author: author.slice(0, 191) || "SMS", text: `SMS gönderildi: ${clean}`.slice(0, 10000), leadId: lead.id, likes: [], comments: [], createdAt: stamp, updatedAt: stamp },
    owner,
  );
  return { receiver: sent.receiver };
}

export function registerSmsRoutes(app: Express, store: Store) {
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
  const fail = (res: Response, error: unknown) => {
    if (error instanceof SmsError) return res.status(error.statusCode).json({ error: error.code, message: error.message });
    return res.status(500).json({ error: "SERVER_ERROR", message: "Beklenmeyen sunucu hatası." });
  };

  app.get("/api/sms/status", async (req, res) => {
    const auth = authOf(req);
    res.json({ configured: smsConfigured() && (await communicationAllowed(store, auth.ownerOpenId)), sender: smsConfigured() ? env("TURKCELL_SMS_SENDER") : "" });
  });

  // Entegrasyonlar ekranındaki "Bağlantıyı test et": yalnızca giriş yapılır, SMS gönderilmez.
  app.post("/api/integrations/sms/test", async (req, res) => {
    const auth = authOf(req);
    try {
      if (!auth.isOwner) throw new SmsError("Bağlantıyı yalnız çalışma alanı sahibi test edebilir.", 403, "FORBIDDEN");
      if (!smsConfigured()) throw new SmsError("Turkcell SMS bağlantısı yapılandırılmamış.", 503, "SMS_NOT_CONFIGURED");
      await tokenFor(baseUrl(), true);
      res.json({ provider: "sms", configured: true, connected: true, message: "Turkcell SMS girişi başarılı." });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/sms/send", async (req, res) => {
    const auth = authOf(req);
    try {
      if (!canAccess(auth, "crm", "write")) throw new SmsError("SMS göndermek için müşteri kayıtlarında yazma yetkisi gerekir.", 403, "FORBIDDEN");
      if (!(await communicationAllowed(store, auth.ownerOpenId)))
        throw new SmsError("Bu çalışma alanında SMS gönderimi açık değil.", 403, "FEATURE_UNAVAILABLE");
      // Müşteri, kullanıcının görebildiği kayıtlar arasından okunur (yetki kapsamı depo katmanında uygulanır).
      const lead = (await store.get<Lead>("lead", String(req.body?.leadId || "").slice(0, 191), auth.ownerOpenId))?.payload;
      if (!lead) throw new SmsError("Müşteri bulunamadı.", 404, "NOT_FOUND");
      if (limited(`user:${auth.ownerOpenId}:${auth.user.openId}`, 20, 60_000))
        throw new SmsError("Çok hızlı gönderim. Biraz bekleyip tekrar deneyin.", 429, "RATE_LIMITED");
      const sent = await sendLeadSms(store, auth.ownerOpenId, lead, req.body?.text, auth.displayName || auth.user.name || "SMS", `sms-${crypto.randomUUID()}`);
      res.status(201).json({ ok: true, receiver: sent.receiver });
    } catch (error) {
      fail(res, error);
    }
  });
}
