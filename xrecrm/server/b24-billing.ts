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
import { PORTAL_KIND, SYSTEM_OWNER, b24Call, portalById, savePortal, type B24Line, type B24Portal } from "./b24-connector.js";

const PRICING_KIND = "b24-pricing";
const PAYMENT_KIND = "b24-payment";
const CODE_KIND = "b24-code";
const DAY = 86_400_000;
const env = (k: string) => process.env[k]?.trim() || "";

export type PlanId = "basic" | "pro" | "proplus";
export const PLAN_IDS: PlanId[] = ["basic", "pro", "proplus"];
export const PLAN_NAMES: Record<PlanId, string> = { basic: "Basic", pro: "Pro", proplus: "Pro+" };
const PLAN_RANK: Record<PlanId, number> = { basic: 0, pro: 1, proplus: 2 };
export const isPlan = (v: unknown): v is PlanId => PLAN_IDS.includes(v as PlanId);

/** Paket gerektiren özellikler ve açıldıkları en düşük paket. */
export type Feature = "live" | "perf" | "campaigns" | "translate" | "transcribe" | "qualify" | "agent" | "reports";
export const FEATURE_PLAN: Record<Feature, PlanId> = {
  live: "pro",
  perf: "pro",
  campaigns: "pro",
  translate: "proplus",
  transcribe: "proplus",
  qualify: "proplus",
  agent: "proplus",
  reports: "proplus",
};

export interface Pricing {
  currency: string;
  /** Numara başına aylık fiyat (eski kayıtlar; paket fiyatı yoksa Pro+ fiyatı sayılır) */
  monthly: number;
  /** Paket → numara başına aylık fiyat */
  plans: Record<PlanId, number>;
  /** Dönem (ay) → indirim yüzdesi */
  discounts: Record<string, number>;
  trialDays: number;
  bank: { holder: string; bankName: string; iban: string; note: string };
}
export const DEFAULT_PRICING: Pricing = {
  currency: "USD",
  monthly: 35,
  plans: { basic: 15, pro: 25, proplus: 35 },
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
  plan?: PlanId;
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
  plan?: PlanId;
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
  return {
    ...DEFAULT_PRICING,
    ...(saved || {}),
    plans: { ...DEFAULT_PRICING.plans, ...(saved?.plans || {}) },
    bank: { ...DEFAULT_PRICING.bank, ...(saved?.bank || {}) },
    discounts: { ...DEFAULT_PRICING.discounts, ...(saved?.discounts || {}) },
  };
}

export function priceFor(pricing: Pricing, months: number, lines = 1, plan: PlanId = "proplus") {
  const discount = Number(pricing.discounts[String(months)] || 0);
  const perLine = Math.round(pricing.plans[plan] * months * (1 - discount / 100) * 100) / 100;
  return { discount, perLine, total: Math.round(perLine * lines * 100) / 100, monthlyEquivalent: Math.round((perLine / months) * 100) / 100 };
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

export interface PlanState {
  plan: PlanId;
  /** free: ücretsiz alan adı, paid: ödenmiş lisans, trial: deneme (Pro+), none: lisans yok */
  source: "free" | "paid" | "trial" | "none";
  features: Record<Feature, boolean>;
}

/**
 * Portalın paketi. Paket portal bazındadır: geçerli ücretli lisansı olan
 * numaraların en düşük paketi sayılır (tek numaraya Pro+ alıp hepsini açmak
 * olmasın). Ücretli lisans yoksa deneme süresince her şey açıktır.
 */
export function portalPlan(portal: B24Portal, trialDays: number, now = Date.now()): PlanState {
  const make = (plan: PlanId, source: PlanState["source"]): PlanState => ({
    plan,
    source,
    features: Object.fromEntries(Object.entries(FEATURE_PLAN).map(([f, min]) => [f, PLAN_RANK[plan] >= PLAN_RANK[min]])) as Record<Feature, boolean>,
  });
  if (freeDomains().includes(portal.domain)) return make("proplus", "free");
  const states = Object.values(portal.lines || {}).map((l) => ({ l, s: licenseState(portal, l, trialDays, now) }));
  const paid = states.filter((x) => x.s.status === "active").map((x) => (isPlan(x.l.license?.plan) ? x.l.license!.plan! : "proplus"));
  if (paid.length) return make(paid.reduce((a, b) => (PLAN_RANK[b] < PLAN_RANK[a] ? b : a)), "paid");
  if (states.some((x) => x.s.status === "trial" || x.s.status === "new")) return make("proplus", "trial");
  return make("basic", "none");
}

export async function planOf(store: Store, portal: B24Portal): Promise<PlanState> {
  return portalPlan(portal, (await getPricing(store)).trialDays);
}

export async function planAllows(store: Store, portal: B24Portal, feature: Feature): Promise<boolean> {
  return (await planOf(store, portal)).features[feature];
}

/** Paket özelliği kapalıysa 402 ile durdurur. */
export async function requireFeature(store: Store, portal: B24Portal, feature: Feature) {
  if (await planAllows(store, portal, feature)) return;
  const need = PLAN_NAMES[FEATURE_PLAN[feature]];
  throw Object.assign(new Error(`Bu özellik ${need} paketinde. Ödeme sekmesinden paketinizi yükseltebilirsiniz.`), { statusCode: 402, plan: FEATURE_PLAN[feature] });
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
export function extendLines(portal: B24Portal, lines: string[], months: number, trialDays: number, plan: PlanId = "proplus"): B24Portal {
  const now = Date.now();
  const next = { ...portal, lines: { ...portal.lines } };
  for (const id of lines) {
    const line = next.lines[id];
    if (!line) continue;
    const paid = line.license?.paidUntil ? Date.parse(line.license.paidUntil) : 0;
    const trialEnd = line.license?.trialStart ? Date.parse(line.license.trialStart) + trialDays * DAY : 0;
    const base = new Date(Math.max(now, paid, trialEnd));
    base.setMonth(base.getMonth() + months);
    next.lines[id] = { ...line, license: { ...(line.license || {}), trialStart: line.license?.trialStart || new Date(now).toISOString(), paidUntil: base.toISOString(), plan } };
  }
  return next;
}

let ownerFetch: typeof fetch = (...args) => fetch(...args);
/** Testler için sahip bildirimini yönlendirir. */
export function setOwnerNotifyFetch(fn: typeof fetch) {
  ownerFetch = fn;
}

/**
 * XRE'ye (uygulama sahibine) olay bildirimi: B24_ADMIN_WEBHOOK adresine JSON
 * gönderilir (ör. n8n → Telegram). Adres yoksa sessizce geçilir.
 */
export function notifyOwner(event: "install" | "payment_request" | "uninstall", text: string, data: Record<string, unknown> = {}) {
  const url = env("B24_ADMIN_WEBHOOK");
  if (!/^https:\/\//.test(url)) return;
  void ownerFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app: "whatsapp-by-xre", event, text, at: new Date().toISOString(), ...data }) }).catch((e) =>
    console.warn("XRE bildirimi gönderilemedi:", (e as Error).message),
  );
}

const fmtMoney = (v: number, c: string) => `${Number.isInteger(v) ? v : v.toFixed(2)} ${c}`;

type Reminder = { kind: "trial" | "paid" | "expired"; line: string; name: string; key: string; daysLeft: number };

/** Hangi numaralar için hatırlatma gerekir? (her bitiş için bir kez) */
export function dueReminders(portal: B24Portal, trialDays: number, now = Date.now()): Reminder[] {
  if (freeDomains().includes(portal.domain)) return [];
  const out: Reminder[] = [];
  for (const [id, l] of Object.entries(portal.lines || {})) {
    const st = licenseState(portal, l, trialDays, now);
    const name = l.name || `WhatsApp ${id}`;
    const n = l.license?.notified || {};
    if (st.status === "trial" && st.until && Date.parse(st.until) - now <= 2 * DAY && n.trial !== l.license?.trialStart)
      out.push({ kind: "trial", line: id, name, key: String(l.license?.trialStart), daysLeft: st.daysLeft ?? 0 });
    if (st.status === "active" && st.until && Date.parse(st.until) - now <= 7 * DAY && n.paid !== st.until)
      out.push({ kind: "paid", line: id, name, key: st.until, daysLeft: st.daysLeft ?? 0 });
    // Süresi yeni dolanlar (30 günden eski bitişler için rahatsız edilmez)
    if (st.status === "expired" && st.until && now - Date.parse(st.until) < 30 * DAY && n.expired !== st.until)
      out.push({ kind: "expired", line: id, name, key: st.until, daysLeft: 0 });
  }
  return out;
}

function reminderText(r: Reminder[], lang: "tr" | "en") {
  const list = (k: Reminder["kind"]) => r.filter((x) => x.kind === k).map((x) => x.name).join(", ");
  const parts: string[] = [];
  if (lang === "en") {
    if (list("trial")) parts.push(`The free trial ends within 2 days for: ${list("trial")}.`);
    if (list("paid")) parts.push(`The license ends within 7 days for: ${list("paid")}.`);
    if (list("expired")) parts.push(`The license has expired for: ${list("expired")}. Messages on these numbers are paused.`);
    return `WhatsApp by XRE: ${parts.join(" ")} Open the app → Billing tab to renew.`;
  }
  if (list("trial")) parts.push(`Ücretsiz deneme 2 gün içinde bitiyor: ${list("trial")}.`);
  if (list("paid")) parts.push(`Lisans 7 gün içinde bitiyor: ${list("paid")}.`);
  if (list("expired")) parts.push(`Lisans süresi doldu: ${list("expired")}. Bu numaralarda mesajlar durduruldu.`);
  return `WhatsApp by XRE: ${parts.join(" ")} Uzatmak için uygulamayı açıp Ödeme sekmesine gidin.`;
}

/** Saatlik: deneme ve lisans bitişlerini portal yöneticilerine Bitrix bildirimiyle haber verir. */
export async function runBillingReminders(store: Store, now = Date.now()) {
  const { trialDays } = await getPricing(store);
  const portals = (await store.list<B24Portal>(PORTAL_KIND, SYSTEM_OWNER)).map((r) => r.payload).filter((p) => p.active);
  for (const portal of portals) {
    const due = dueReminders(portal, trialDays, now);
    if (!due.length) continue;
    // Önce işaretle: bildirim yarıda kalsa da tekrar tekrar gitmesin.
    const fresh = (await portalById(store, portal.id)) || portal;
    const next = { ...fresh, lines: { ...fresh.lines } };
    for (const r of due) {
      const l = next.lines[r.line];
      if (l) next.lines[r.line] = { ...l, license: { ...(l.license || {}), notified: { ...(l.license?.notified || {}), [r.kind]: r.key } } };
    }
    await savePortal(store, next);
    const message = reminderText(due, portal.lang === "en" ? "en" : "tr");
    for (const userId of (portal.adminIds || []).slice(0, 5))
      await b24Call(store, next, "im.notify.system.add", { USER_ID: Number(userId), MESSAGE: message }).catch((e) =>
        console.warn(`Lisans hatırlatması gönderilemedi (${portal.domain}):`, (e as Error).message),
      );
  }
}

let reminderTimer: NodeJS.Timeout | null = null;
export function startBillingReminders(store: Store) {
  if (reminderTimer) return;
  const tick = () => void runBillingReminders(store).catch((e) => console.warn("Lisans hatırlatmaları:", (e as Error).message));
  reminderTimer = setInterval(tick, 60 * 60_000);
  reminderTimer.unref?.();
  setTimeout(tick, 60_000).unref?.();
}

/** Yönetim ekranı için gelir ve dönüşüm özeti. */
export function revenueMetrics(portals: B24Portal[], payments: PaymentRequest[], pricing: Pricing, now = Date.now()) {
  const month = (iso: string) => iso.slice(0, 7);
  const thisMonth = new Date(now).toISOString().slice(0, 7);
  const approved = payments.filter((p) => p.status === "approved");
  const months: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const byMonth = months.map((m) => ({ month: m, amount: Math.round(approved.filter((p) => month(p.decidedAt || p.createdAt) === m).reduce((a, p) => a + p.amount, 0) * 100) / 100 }));
  let mrr = 0;
  let trials = 0;
  let activeLines = 0;
  let expiringSoon: { domain: string; firm: string; line: string; name: string; status: LicenseStatus; daysLeft: number }[] = [];
  const planMix: Record<PlanId, number> = { basic: 0, pro: 0, proplus: 0 };
  let tried = 0;
  let converted = 0;
  for (const p of portals.filter((x) => x.active && !freeDomains().includes(x.domain))) {
    const firm = (p as B24Portal & { billing?: BillingInfo }).billing?.title || p.domain;
    const plan = portalPlan(p, pricing.trialDays, now);
    if (plan.source === "paid") planMix[plan.plan] += 1;
    const lines = Object.entries(p.lines || {});
    if (lines.some(([, l]) => l.license?.trialStart)) tried += 1;
    if (lines.some(([, l]) => l.license?.paidUntil)) converted += 1;
    for (const [id, l] of lines) {
      const st = licenseState(p, l, pricing.trialDays, now);
      if (st.status === "active") {
        activeLines += 1;
        mrr += pricing.plans[isPlan(l.license?.plan) ? l.license!.plan! : "proplus"];
      }
      if (st.status === "trial") trials += 1;
      if ((st.status === "trial" && (st.daysLeft ?? 99) <= 3) || (st.status === "active" && (st.daysLeft ?? 99) <= 14))
        expiringSoon.push({ domain: p.domain, firm, line: id, name: l.name || `WhatsApp ${id}`, status: st.status, daysLeft: st.daysLeft ?? 0 });
    }
  }
  expiringSoon = expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 20);
  const pending = payments.filter((p) => p.status === "pending");
  return {
    currency: pricing.currency,
    mrr: Math.round(mrr * 100) / 100,
    thisMonth: byMonth.find((m) => m.month === thisMonth)?.amount || 0,
    total: Math.round(approved.reduce((a, p) => a + p.amount, 0) * 100) / 100,
    pendingCount: pending.length,
    pendingAmount: Math.round(pending.reduce((a, p) => a + p.amount, 0) * 100) / 100,
    portals: portals.filter((x) => x.active).length,
    payingPortals: converted,
    conversion: tried ? Math.round((converted / tried) * 100) : null,
    activeLines,
    trials,
    planMix,
    byMonth,
    expiringSoon,
  };
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
    plan: l.license?.paidUntil ? (isPlan(l.license.plan) ? l.license.plan : "proplus") : null,
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
        pricing: { currency: pricing.currency, plans: pricing.plans, discounts: pricing.discounts, trialDays: pricing.trialDays, bank: pricing.bank },
        plan: portalPlan(portal, pricing.trialDays),
        plans: PLAN_IDS.map((id) => ({ id, name: PLAN_NAMES[id], monthly: pricing.plans[id], periods: PERIODS.map((m) => ({ months: m, ...priceFor(pricing, m, 1, id) })) })),
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
      const plan: PlanId = isPlan(body.plan) ? body.plan : "proplus";
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
        plan,
        amount: priceFor(pricing, months, lines.length, plan).total,
        currency: pricing.currency,
        reference: reference(),
        note: String(body.note || "").slice(0, 500),
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await store.put(PAYMENT_KIND, request.id, request, SYSTEM_OWNER);
      notifyOwner("payment_request", `Havale bildirimi: ${portal.domain} · ${PLAN_NAMES[plan]} · ${lines.length} numara · ${months} ay · ${fmtMoney(request.amount, request.currency)} · ${request.reference}`, {
        domain: portal.domain,
        plan,
        months,
        lines: lines.length,
        amount: request.amount,
        currency: request.currency,
        reference: request.reference,
      });
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
      await savePortal(store, extendLines(await fresh(portal), lines, code!.months, pricing.trialDays, isPlan(code!.plan) ? code!.plan : "proplus"));
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
      metrics: revenueMetrics(portals, payments, pricing),
      portals: portals.map((p) => ({
        id: p.id,
        domain: p.domain,
        active: p.active,
        installedAt: p.installedAt,
        plan: portalPlan(p, pricing.trialDays).plan,
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
      const money = (v: unknown, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(1_000_000, Math.max(0, Math.round(n * 100) / 100)) : fallback;
      };
      const plans = Object.fromEntries(PLAN_IDS.map((id) => [id, money(b.plans?.[id], current.plans[id])])) as Record<PlanId, number>;
      const pricing: Pricing = {
        currency: ["TRY", "USD", "EUR"].includes(String(b.currency)) ? String(b.currency) : current.currency,
        monthly: plans.proplus,
        plans,
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
        await savePortal(store, extendLines(portal!, payment!.lines, payment!.months, pricing.trialDays, isPlan(payment!.plan) ? payment!.plan : "proplus"));
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
      await savePortal(store, extendLines(portal!, lines, months, pricing.trialDays, isPlan(b.plan) ? b.plan : "proplus"));
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
        const code: LicenseCode = { id: newCode(), months, plan: isPlan(b.plan) ? b.plan : "proplus", maxLines, note: String(b.note || "").slice(0, 200), createdAt: new Date().toISOString() };
        await store.put(CODE_KIND, code.id, code, SYSTEM_OWNER);
        created.push(code);
      }
      return { codes: created };
    }),
  );
}
