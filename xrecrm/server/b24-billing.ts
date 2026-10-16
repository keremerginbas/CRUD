// XRE WhatsApp lisanslama: numara başına lisans, ilk bağlantıda başlayan deneme
// süresi, havale bildirimi ve lisans kodu ile ödeme. Kart ödemesi (iyzico vb.)
// sonradan bu kayıtların üzerine eklenir.
//
// Süresi dolan numaranın mesajları Bitrix'e aktarılmaz ve Bitrix'ten gönderilmez;
// WhatsApp oturumu açık kalır, lisans uzatılınca kaldığı yerden devam eder.
import crypto from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { PORTAL_KIND, SYSTEM_OWNER, portalById, savePortal, type B24Line, type B24Portal } from "./b24-connector.js";

const PRICING_KIND = "b24-pricing";
const PAYMENT_KIND = "b24-payment";
const CODE_KIND = "b24-code";
const DAY = 86_400_000;
const env = (k: string) => process.env[k]?.trim() || "";

export interface Pricing {
  currency: string;
  /** Numara başına aylık fiyat */
  monthly: number;
  /** Dönem (ay) → indirim yüzdesi */
  discounts: Record<string, number>;
  trialDays: number;
  bank: { holder: string; bankName: string; iban: string; note: string };
}
export const DEFAULT_PRICING: Pricing = {
  currency: "TRY",
  monthly: 750,
  discounts: { "1": 0, "3": 10, "6": 20, "12": 35 },
  trialDays: 7,
  bank: { holder: "", bankName: "", iban: "", note: "Açıklamaya ödeme referans kodunu yazın." },
};
export const PERIODS = [1, 3, 6, 12] as const;

export interface PaymentRequest {
  id: string;
  memberId: string;
  domain: string;
  lines: string[];
  months: number;
  amount: number;
  currency: string;
  reference: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
}
export interface LicenseCode {
  id: string;
  months: number;
  maxLines: number;
  note: string;
  createdAt: string;
  usedBy?: string;
  usedDomain?: string;
  usedLines?: string[];
  usedAt?: string;
}
export interface BillingInfo {
  type: "kurumsal" | "bireysel";
  title: string;
  taxOffice: string;
  taxNumber: string;
  address: string;
  city: string;
  phone: string;
  email: string;
}

export async function getPricing(store: Store): Promise<Pricing> {
  const saved = (await store.get<Partial<Pricing>>(PRICING_KIND, "default", SYSTEM_OWNER))?.payload;
  return { ...DEFAULT_PRICING, ...(saved || {}), bank: { ...DEFAULT_PRICING.bank, ...(saved?.bank || {}) }, discounts: { ...DEFAULT_PRICING.discounts, ...(saved?.discounts || {}) } };
}

export function priceFor(pricing: Pricing, months: number, lines = 1) {
  const discount = Number(pricing.discounts[String(months)] || 0);
  const perLine = Math.round(pricing.monthly * months * (1 - discount / 100));
  return { discount, perLine, total: perLine * lines, monthlyEquivalent: Math.round(perLine / months) };
}

const freeDomains = () =>
  env("B24_FREE_DOMAINS")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

export type LicenseStatus = "free" | "active" | "trial" | "expired" | "new";
export interface LicenseState {
  status: LicenseStatus;
  until: string | null;
  daysLeft: number | null;
}

export function licenseState(portal: B24Portal, line: B24Line | undefined, trialDays: number, now = Date.now()): LicenseState {
  if (freeDomains().includes(portal.domain)) return { status: "free", until: null, daysLeft: null };
  const paid = line?.license?.paidUntil ? Date.parse(line.license.paidUntil) : 0;
  const trialEnd = line?.license?.trialStart ? Date.parse(line.license.trialStart) + trialDays * DAY : 0;
  const days = (t: number) => Math.max(0, Math.ceil((t - now) / DAY));
  if (paid > now) return { status: "active", until: new Date(paid).toISOString(), daysLeft: days(paid) };
  if (trialEnd > now) return { status: "trial", until: new Date(trialEnd).toISOString(), daysLeft: days(trialEnd) };
  if (paid || trialEnd) return { status: "expired", until: new Date(Math.max(paid, trialEnd)).toISOString(), daysLeft: 0 };
  return { status: "new", until: null, daysLeft: null };
}

/** Numara mesaj aktarabilir mi? (henüz bağlanmamış numara için deneme bağlanınca başlar) */
export async function lineUsable(store: Store, portal: B24Portal, line: string): Promise<boolean> {
  const pricing = await getPricing(store);
  const state = licenseState(portal, portal.lines[line], pricing.trialDays);
  return state.status !== "expired";
}

/** Bağlantı ilk kez kurulduğunda denemeyi başlatır. */
export function withTrialStarted(line: B24Line | undefined): B24Line["license"] {
  if (line?.license?.trialStart) return line.license;
  return { ...(line?.license || {}), trialStart: new Date().toISOString() };
}

/** Seçilen numaralara ay ekler: mevcut lisans, deneme bitişi veya bugünden hangisi ileriyse oradan. */
export function extendLines(portal: B24Portal, lines: string[], months: number, trialDays: number): B24Portal {
  const now = Date.now();
  const next = { ...portal, lines: { ...portal.lines } };
  for (const id of lines) {
    const line = next.lines[id];
    if (!line) continue;
    const paid = line.license?.paidUntil ? Date.parse(line.license.paidUntil) : 0;
    const trialEnd = line.license?.trialStart ? Date.parse(line.license.trialStart) + trialDays * DAY : 0;
    const base = new Date(Math.max(now, paid, trialEnd));
    base.setMonth(base.getMonth() + months);
    next.lines[id] = { ...line, license: { ...(line.license || {}), trialStart: line.license?.trialStart || new Date(now).toISOString(), paidUntil: base.toISOString() } };
  }
  return next;
}

const reference = () => `XRE-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const newCode = () =>
  Array.from({ length: 3 }, () => crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 4)).join("-");
const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { statusCode: status });
};

function licenses(portal: B24Portal, pricing: Pricing) {
  return Object.entries(portal.lines).map(([line, l]) => ({
    line,
    name: l.name || `WhatsApp ${line}`,
    phone: l.phone || "",
    ...licenseState(portal, l, pricing.trialDays),
  }));
}

type PanelFactory = (fn: (portal: B24Portal, body: any) => Promise<unknown>) => (req: Request, res: Response) => Promise<unknown>;

/** Bitrix panelindeki "Ödeme" sekmesinin uçları. */
export function registerBillingPanelRoutes(app: Express, store: Store, panel: PanelFactory, json: RequestHandler) {
  const fresh = async (p: B24Portal) => (await portalById(store, p.id)) || p;

  app.post(
    "/b24/panel/billing/state",
    json,
    panel(async (portal) => {
      const pricing = await getPricing(store);
      const payments = (await store.list<PaymentRequest>(PAYMENT_KIND, SYSTEM_OWNER))
        .map((r) => r.payload)
        .filter((p) => p.memberId === portal.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const codes = (await store.list<LicenseCode>(CODE_KIND, SYSTEM_OWNER))
        .map((r) => r.payload)
        .filter((c) => c.usedBy === portal.id)
        .map((c) => ({ code: c.id, months: c.months, usedAt: c.usedAt, lines: c.usedLines || [] }));
      return {
        pricing: { currency: pricing.currency, monthly: pricing.monthly, discounts: pricing.discounts, trialDays: pricing.trialDays, bank: pricing.bank },
        periods: PERIODS.map((m) => ({ months: m, ...priceFor(pricing, m) })),
        licenses: licenses(portal, pricing),
        payments,
        codes,
        billing: (portal as B24Portal & { billing?: BillingInfo }).billing || null,
      };
    }),
  );

  app.post(
    "/b24/panel/billing/request",
    json,
    panel(async (portal, body) => {
      const pricing = await getPricing(store);
      const months = Number(body.months);
      if (!PERIODS.includes(months as (typeof PERIODS)[number])) fail(400, "Geçerli bir dönem seçin.");
      const lines = (Array.isArray(body.lines) ? body.lines : []).map(String).filter((l: string) => portal.lines[l]);
      if (!lines.length) fail(400, "En az bir numara seçin.");
      const open = (await store.list<PaymentRequest>(PAYMENT_KIND, SYSTEM_OWNER)).filter((r) => r.payload.memberId === portal.id && r.payload.status === "pending");
      if (open.length >= 5) fail(429, "Onay bekleyen çok fazla ödeme bildirimi var. Önce mevcutların onaylanmasını bekleyin.");
      const request: PaymentRequest = {
        id: `pay_${crypto.randomBytes(8).toString("hex")}`,
        memberId: portal.id,
        domain: portal.domain,
        lines,
        months,
        amount: priceFor(pricing, months, lines.length).total,
        currency: pricing.currency,
        reference: reference(),
        note: String(body.note || "").slice(0, 500),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await store.put(PAYMENT_KIND, request.id, request, SYSTEM_OWNER);
      return { request, bank: pricing.bank };
    }),
  );

  app.post(
    "/b24/panel/billing/redeem",
    json,
    panel(async (portal, body) => {
      const id = String(body.code || "").trim().toUpperCase();
      const code = id ? (await store.get<LicenseCode>(CODE_KIND, id, SYSTEM_OWNER))?.payload : null;
      if (!code) fail(404, "Lisans kodu bulunamadı.");
      if (code!.usedBy) fail(409, "Bu lisans kodu daha önce kullanılmış.");
      const lines = (Array.isArray(body.lines) ? body.lines : []).map(String).filter((l: string) => portal.lines[l]);
      if (!lines.length) fail(400, "Kodun uygulanacağı numarayı seçin.");
      if (lines.length > code!.maxLines) fail(400, `Bu kod en fazla ${code!.maxLines} numara için geçerli.`);
      const pricing = await getPricing(store);
      await savePortal(store, extendLines(await fresh(portal), lines, code!.months, pricing.trialDays));
      await store.put(CODE_KIND, code!.id, { ...code!, usedBy: portal.id, usedDomain: portal.domain, usedLines: lines, usedAt: new Date().toISOString() }, SYSTEM_OWNER);
      return { ok: true, licenses: licenses(await fresh(portal), pricing) };
    }),
  );

  app.post(
    "/b24/panel/billing/info",
    json,
    panel(async (portal, body) => {
      const str = (v: unknown, max = 200) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
      const billing: BillingInfo = {
        type: body.type === "bireysel" ? "bireysel" : "kurumsal",
        title: str(body.title),
        taxOffice: str(body.taxOffice, 100),
        taxNumber: str(body.taxNumber, 20).replace(/\D/g, ""),
        address: str(body.address, 500),
        city: str(body.city, 60),
        phone: str(body.phone, 30),
        email: str(body.email, 120),
      };
      if (billing.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billing.email)) fail(400, "Geçerli bir fatura e-postası girin.");
      await savePortal(store, { ...(await fresh(portal)), billing } as B24Portal);
      return { billing };
    }),
  );
}

/** XRE yönetimi (CRM sahibi): fiyatlar, portallar, ödeme onayı, lisans kodları. */
export function registerBillingAdminRoutes(app: Express, store: Store) {
  const owner = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (!auth?.isOwner) return res.status(403).json({ error: "OWNER_REQUIRED", message: "Bu ekran yalnız XRE yönetimine açıktır." });
    try {
      res.json(await fn(req));
    } catch (error) {
      const e = error as Error & { statusCode?: number };
      res.status(e.statusCode && e.statusCode < 600 ? e.statusCode : 500).json({ error: "FAILED", message: e.message });
    }
  };

  const state = async () => {
    const pricing = await getPricing(store);
    const portals = (await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)).map((r) => r.payload);
    const payments = (await store.list<PaymentRequest>(PAYMENT_KIND, SYSTEM_OWNER))
      .map((r) => r.payload)
      .sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || b.createdAt.localeCompare(a.createdAt));
    const codes = (await store.list<LicenseCode>(CODE_KIND, SYSTEM_OWNER)).map((r) => r.payload).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      pricing,
      portals: portals.map((p) => ({
        id: p.id,
        domain: p.domain,
        active: p.active,
        installedAt: p.installedAt,
        billing: (p as B24Portal & { billing?: BillingInfo }).billing || null,
        lines: licenses(p, pricing).map((l) => ({ ...l, connected: p.lines[l.line]?.status === "connected" })),
      })),
      payments,
      codes,
    };
  };

  app.get("/api/b24-admin/state", owner(state));

  app.post(
    "/api/b24-admin/pricing",
    owner(async (req) => {
      const b = req.body || {};
      const current = await getPricing(store);
      const num = (v: unknown, min: number, max: number, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
      };
      const pricing: Pricing = {
        currency: ["TRY", "USD", "EUR"].includes(String(b.currency)) ? String(b.currency) : current.currency,
        monthly: num(b.monthly, 0, 1_000_000, current.monthly),
        trialDays: num(b.trialDays, 0, 90, current.trialDays),
        discounts: Object.fromEntries(PERIODS.map((m) => [String(m), num(b.discounts?.[String(m)], 0, 90, current.discounts[String(m)] || 0)])),
        bank: {
          holder: String(b.bank?.holder ?? current.bank.holder).slice(0, 120),
          bankName: String(b.bank?.bankName ?? current.bank.bankName).slice(0, 80),
          iban: String(b.bank?.iban ?? current.bank.iban).replace(/\s+/g, " ").toUpperCase().slice(0, 40),
          note: String(b.bank?.note ?? current.bank.note).slice(0, 300),
        },
      };
      await store.put(PRICING_KIND, "default", pricing, SYSTEM_OWNER);
      return { pricing };
    }),
  );

  app.post(
    "/api/b24-admin/payments/:id/:decision",
    owner(async (req) => {
      const decision = String(req.params.decision);
      if (!["approve", "reject"].includes(decision)) fail(400, "Geçersiz işlem.");
      const payment = (await store.get<PaymentRequest>(PAYMENT_KIND, String(req.params.id), SYSTEM_OWNER))?.payload;
      if (!payment) fail(404, "Ödeme bildirimi bulunamadı.");
      if (payment!.status !== "pending") fail(409, "Bu bildirim zaten sonuçlandı.");
      if (decision === "approve") {
        const portal = await portalById(store, payment!.memberId);
        if (!portal) fail(404, "Portal bulunamadı.");
        const pricing = await getPricing(store);
        await savePortal(store, extendLines(portal!, payment!.lines, payment!.months, pricing.trialDays));
      }
      const updated = { ...payment!, status: decision === "approve" ? "approved" : "rejected", decidedAt: new Date().toISOString() } as PaymentRequest;
      await store.put(PAYMENT_KIND, updated.id, updated, SYSTEM_OWNER);
      return { payment: updated };
    }),
  );

  app.post(
    "/api/b24-admin/extend",
    owner(async (req) => {
      const b = req.body || {};
      const portal = await portalById(store, String(b.memberId || ""));
      if (!portal) fail(404, "Portal bulunamadı.");
      const months = Number(b.months);
      if (!Number.isInteger(months) || months < 1 || months > 36) fail(400, "Ay 1-36 arasında olmalı.");
      const lines = b.lines === "all" ? Object.keys(portal!.lines) : (Array.isArray(b.lines) ? b.lines : []).map(String);
      const pricing = await getPricing(store);
      await savePortal(store, extendLines(portal!, lines, months, pricing.trialDays));
      return { ok: true };
    }),
  );

  app.post(
    "/api/b24-admin/codes",
    owner(async (req) => {
      const b = req.body || {};
      const months = Number(b.months);
      const maxLines = Number(b.maxLines || 1);
      const count = Math.min(50, Math.max(1, Number(b.count || 1)));
      if (!Number.isInteger(months) || months < 1 || months > 36) fail(400, "Ay 1-36 arasında olmalı.");
      if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 100) fail(400, "Numara sayısı 1-100 arasında olmalı.");
      const created: LicenseCode[] = [];
      for (let i = 0; i < count; i += 1) {
        const code: LicenseCode = { id: newCode(), months, maxLines, note: String(b.note || "").slice(0, 200), createdAt: new Date().toISOString() };
        await store.put(CODE_KIND, code.id, code, SYSTEM_OWNER);
        created.push(code);
      }
      return { codes: created };
    }),
  );
}
