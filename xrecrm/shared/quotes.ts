// Gayrimenkul satış modülü — FAZ 2: ödeme planlı teklif, yönetici onayı, para maliyeti ve prim.
// Veri modeli, durum makinesi ve rapor hesapları burada durur; sunucu ve arayüz (demo modu
// dâhil) aynı kodu kullanır. Para hesapları shared/sales-finance.ts içindedir ve değiştirilmez.
import { z } from "zod";
import {
  FinanceError,
  buildPaymentPlan,
  commission as commissionOf,
  evaluateQuote,
  unitsWithinValue,
  type PaymentPlan,
  type QuoteEvaluation,
} from "./sales-finance";
import type { Project, Unit, UnitCurrency, UnitStatus } from "./real-estate";

/** Depodaki kayıt türleri (sahip kapsamlı). */
export const QUOTE_KIND = "re_quote";
export const QUOTE_SETTINGS_KIND = "re_quote_settings";
/** Teklif numarası ayırma kaydı: aynı numara iki teklife verilemez. */
export const QUOTE_NO_KIND = "re_quote_no";
export const QUOTE_SETTINGS_ID = "settings";

export const QUOTE_STATUSES = ["taslak", "onay bekliyor", "onaylandı", "reddedildi", "müşteriye gönderildi", "satışa döndü", "iptal"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_ACTIONS = ["submit", "approve", "reject", "send", "sell", "cancel"] as const;
export type QuoteAction = (typeof QUOTE_ACTIONS)[number];
/** Ret gerekçesi: "fiyat" = bu fiyata satamayız (çalışana "bu paraya ne verilebilir" listesi açılır). */
export const REJECT_REASONS = ["fiyat", "diğer"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export class QuoteError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "INVALID_QUOTE",
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Ayarlar (yalnız yönetici değiştirir)
// ---------------------------------------------------------------------------

const pct = (max: number) => z.number().finite().min(0).max(max);
export const QuoteSettingsSchema = z.object({
  /** Varsayılan aylık vade farkı oranı, yüzde. */
  vadeFarkiMonthlyPct: pct(20),
  /** Para maliyeti oranı: NBD hesabında kullanılan tek aylık iskonto oranı, yüzde. */
  discountMonthlyPct: pct(20),
  /** Prim oranı: satış bedelinin yüzdesi. */
  commissionPct: pct(100),
  maxMonths: z.number().int().min(0).max(240).default(240),
  /** En az peşinat: satış bedelinin yüzdesi. */
  minDownPaymentPct: pct(100).default(0),
  quoteValidDays: z.number().int().min(1).max(365).default(7),
  /** Onaylanan teklifin dairesi, geçerlilik süresince "opsiyonlu" yapılsın mı? */
  optionOnApproval: z.boolean().default(true),
  companyName: z.string().trim().max(200).default(""),
  companyAddress: z.string().trim().max(500).default(""),
  companyPhone: z.string().trim().max(60).default(""),
});
export type QuoteSettingsInput = z.infer<typeof QuoteSettingsSchema>;
export interface QuoteSettings extends QuoteSettingsInput {
  updatedAt: string;
  updatedBy: string;
}
/** Yönetici olmayan kullanıcıya giden ayar özeti: para maliyeti oranı yer almaz. */
export type QuoteSettingsPublic = Omit<QuoteSettings, "discountMonthlyPct" | "updatedBy"> & { discountMonthlyPct?: number; updatedBy?: string };

export function publicSettings(settings: QuoteSettings, manager: boolean): QuoteSettingsPublic {
  if (manager) return settings;
  const { discountMonthlyPct: _rate, updatedBy: _by, ...rest } = settings;
  return rest;
}

// ---------------------------------------------------------------------------
// Teklif kaydı
// ---------------------------------------------------------------------------

export interface QuoteBalloon {
  month: number;
  amount: number;
}
export interface QuoteInputs {
  /** Satış bedeli (iskonto sonrası, vade farkı hariç). */
  salePrice: number;
  downPayment: number;
  months: number;
  balloons: QuoteBalloon[];
  /** Satış / ilk ödeme tarihi (YYYY-AA-GG). */
  startDate: string;
  /** Dairenin para birimi. */
  currency: UnitCurrency;
}
/** Teklif oluşturulurken geçerli oranlar; ayarlar sonradan değişse de teklif bu oranlarla kalır. */
export interface QuoteRates {
  vadeFarkiMonthlyPct: number;
  discountMonthlyPct: number;
  commissionPct: number;
}
export interface QuoteTrailEntry {
  at: string;
  action: "oluşturuldu" | "düzenlendi" | "onaya gönderildi" | "onaylandı" | "reddedildi" | "müşteriye gönderildi" | "satışa döndü" | "iptal";
  byOpenId: string;
  byName: string;
  note: string;
  /** Yalnız retlerde. */
  reason?: RejectReason;
}
export interface Quote {
  id: string;
  /** İnsan tarafından okunur sıra numarası: T-2026-0001. */
  quoteNo: string;
  unitId: string;
  projectId: string;
  leadId: string;
  customer: { name: string; phone: string };
  /** Dairenin teklif anındaki tanımı (PDF ve raporlar daire sonradan değişse de bunu kullanır). */
  unit: { projectName: string; block: string; unitNo: string; type: string; floor: number; grossM2: number; netM2: number };
  employee: { openId: string; name: string };
  inputs: QuoteInputs;
  rates: QuoteRates;
  /** Hesapta kullanılan liste fiyatı (daire kaydından; istemciden alınmaz). */
  listPrice: number;
  plan: PaymentPlan;
  evaluation: QuoteEvaluation;
  /** Prim tutarı: satış bedeli × prim oranı. */
  commission: number;
  status: QuoteStatus;
  /** Son onay / ret kararı. */
  decision: { status: "onaylandı" | "reddedildi"; byOpenId: string; byName: string; at: string; note: string; reason?: RejectReason } | null;
  trail: QuoteTrailEntry[];
  /** Geçerlilik tarihi (YYYY-AA-GG, dâhil). */
  validUntil: string;
  /** Bu teklifin onayı daireyi opsiyona aldıysa true; süre dolunca veya iptalde opsiyon kaldırılır. */
  optionHeld: boolean;
  note: string;
  createdAt: string;
  updatedAt: string;
  soldAt: string | null;
}

/** İstemciden kabul edilen alanlar. Tutar/oran/durum gibi diğer her şey sunucuda hesaplanır. */
export const QuoteDraftSchema = z.object({
  unitId: z.string().trim().min(1).max(191),
  leadId: z.string().trim().min(1, "Müşteri seçin.").max(191),
  salePrice: z.number().finite().positive().max(1e13),
  downPayment: z.number().finite().min(0).max(1e13),
  months: z.number().int().min(0).max(240),
  balloons: z
    .array(z.object({ month: z.number().int().min(1).max(240), amount: z.number().finite().positive().max(1e13) }))
    .max(60)
    .default([]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı."),
  note: z.string().trim().max(2000).default(""),
});
export type QuoteDraft = z.infer<typeof QuoteDraftSchema>;

export interface QuoteActor {
  openId: string;
  name: string;
  /** Yönetici: çalışma alanı sahibi veya "Teklifler" modülünde yazma yetkisi olan çalışan. */
  manager: boolean;
}

// ---------------------------------------------------------------------------
// Hesap
// ---------------------------------------------------------------------------

export const isoDay = (date: Date | string) => (typeof date === "string" ? date : date.toISOString()).slice(0, 10);
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Ödeme planı + NBD değerlendirmesi + prim. Tek doğru kaynak: sunucu ve önizleme bunu çağırır. */
export function computeQuote(inputs: QuoteInputs, rates: QuoteRates, listPrice: number): { plan: PaymentPlan; evaluation: QuoteEvaluation; commission: number } {
  try {
    const plan = buildPaymentPlan({
      salePrice: inputs.salePrice,
      downPayment: inputs.downPayment,
      months: inputs.months,
      monthlyRatePct: rates.vadeFarkiMonthlyPct,
      balloons: inputs.balloons,
      startDate: inputs.startDate,
    });
    return { plan, evaluation: evaluateQuote(plan, listPrice, rates.discountMonthlyPct), commission: commissionOf(plan.salePrice, rates.commissionPct) };
  } catch (error) {
    if (error instanceof FinanceError) throw new QuoteError(error.message);
    throw error;
  }
}

/** Yöneticinin koyduğu sınırlar: en çok taksit sayısı ve en az peşinat. */
export function assertWithinLimits(inputs: Pick<QuoteInputs, "salePrice" | "downPayment" | "months">, settings: Pick<QuoteSettings, "maxMonths" | "minDownPaymentPct">): void {
  if (inputs.months > settings.maxMonths) throw new QuoteError(`Taksit sayısı en çok ${settings.maxMonths} ay olabilir.`);
  const minDown = Math.round(inputs.salePrice * settings.minDownPaymentPct) / 100;
  if (inputs.downPayment + 0.005 < minDown)
    throw new QuoteError(`Peşinat satış bedelinin en az %${String(settings.minDownPaymentPct).replace(".", ",")} kadarı olmalı (${formatMoney(minDown)}).`);
}

/** T-2026-0001 */
export const formatQuoteNo = (year: number, seq: number) => `T-${year}-${String(seq).padStart(4, "0")}`;
/** Aynı yılın mevcut numaralarından sonraki sırayı bulur. */
export function nextQuoteSeq(existing: string[], year: number): number {
  let max = 0;
  for (const no of existing) {
    const match = /^T-(\d{4})-(\d+)$/.exec(no);
    if (match && Number(match[1]) === year) max = Math.max(max, Number(match[2]));
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Durum makinesi
// ---------------------------------------------------------------------------

export const QUOTE_TRANSITIONS: Record<QuoteAction, { from: readonly QuoteStatus[]; to: QuoteStatus; managerOnly: boolean; trail: QuoteTrailEntry["action"] }> = {
  submit: { from: ["taslak"], to: "onay bekliyor", managerOnly: false, trail: "onaya gönderildi" },
  approve: { from: ["onay bekliyor"], to: "onaylandı", managerOnly: true, trail: "onaylandı" },
  reject: { from: ["onay bekliyor"], to: "reddedildi", managerOnly: true, trail: "reddedildi" },
  send: { from: ["onaylandı"], to: "müşteriye gönderildi", managerOnly: false, trail: "müşteriye gönderildi" },
  sell: { from: ["onaylandı", "müşteriye gönderildi"], to: "satışa döndü", managerOnly: false, trail: "satışa döndü" },
  cancel: { from: ["taslak", "onay bekliyor", "onaylandı", "reddedildi", "müşteriye gönderildi"], to: "iptal", managerOnly: false, trail: "iptal" },
};
/** Daire için "açık" sayılan teklifler: satışta iptal edilenler. */
export const OPEN_STATUSES: readonly QuoteStatus[] = ["taslak", "onay bekliyor", "onaylandı", "müşteriye gönderildi"];
/** Müşteriye verilebilir (PDF üretilebilir) durumlar. */
export const APPROVED_STATUSES: readonly QuoteStatus[] = ["onaylandı", "müşteriye gönderildi", "satışa döndü"];
export const EDITABLE_STATUSES: readonly QuoteStatus[] = ["taslak", "onay bekliyor", "onaylandı", "reddedildi"];

export const isOwnQuote = (quote: Pick<Quote, "employee">, actor: Pick<QuoteActor, "openId">) => quote.employee.openId === actor.openId;
/** Geçerlilik tarihi geçmiş mi? (validUntil günü dâhil geçerlidir) */
export const isExpired = (quote: Pick<Quote, "validUntil">, today: string) => quote.validUntil < today;
/** Opsiyonu hâlâ tutan teklif: onaylı/gönderilmiş, süresi dolmamış. */
const holdsOption = (quote: Quote, today: string) =>
  quote.optionHeld && (quote.status === "onaylandı" || quote.status === "müşteriye gönderildi") && !isExpired(quote, today);

/** İşlem yapılabiliyorsa boş metin, yapılamıyorsa nedeni döner. */
export function actionBlocker(quote: Quote, action: QuoteAction, actor: QuoteActor, today: string): { message: string; statusCode: number } | null {
  const rule = QUOTE_TRANSITIONS[action];
  if (rule.managerOnly ? !actor.manager : !actor.manager && !isOwnQuote(quote, actor))
    return { statusCode: 403, message: rule.managerOnly ? "Teklifi yalnız yönetici onaylayabilir veya reddedebilir." : "Bu teklif başka bir çalışana ait." };
  if (!rule.from.includes(quote.status)) return { statusCode: 409, message: `"${statusLabel(quote.status)}" durumundaki teklif için bu işlem yapılamaz.` };
  if ((action === "send" || action === "sell") && isExpired(quote, today))
    return { statusCode: 409, message: "Teklifin geçerlilik süresi dolmuş. Yeni teklif hazırlayın veya teklifi düzenleyip yeniden onaya gönderin." };
  return null;
}
export const canAct = (quote: Quote, action: QuoteAction, actor: QuoteActor, today: string) => !actionBlocker(quote, action, actor, today);
export function canEdit(quote: Quote, actor: QuoteActor): boolean {
  return (actor.manager || isOwnQuote(quote, actor)) && EDITABLE_STATUSES.includes(quote.status);
}

const trailEntry = (action: QuoteTrailEntry["action"], actor: QuoteActor, at: string, note = "", reason?: RejectReason): QuoteTrailEntry => ({
  at,
  action,
  byOpenId: actor.openId,
  byName: actor.name,
  note,
  ...(reason ? { reason } : {}),
});

export interface QuoteContext {
  settings: QuoteSettings;
  unit: Unit;
  project: Pick<Project, "id" | "name"> | undefined;
  lead: { id: string; name: string; phone?: string };
  actor: QuoteActor;
  /** ISO zaman damgası. */
  now: string;
}

function unitSnapshot(unit: Unit, project: QuoteContext["project"]): Quote["unit"] {
  return { projectName: project?.name || "", block: unit.block, unitNo: unit.unitNo, type: unit.type, floor: unit.floor, grossM2: unit.grossM2, netM2: unit.netM2 };
}
function assertQuotableUnit(unit: Unit): void {
  if (unit.archived) throw new QuoteError("Arşivdeki daire için teklif hazırlanamaz.", 409, "UNIT_UNAVAILABLE");
  if (unit.status === "satıldı") throw new QuoteError("Bu daire satılmış; teklif hazırlanamaz.", 409, "UNIT_UNAVAILABLE");
  if (!(unit.listPrice > 0)) throw new QuoteError("Dairenin liste fiyatı girilmemiş; önce fiyat girin.", 409, "UNIT_UNAVAILABLE");
}
const inputsOf = (draft: QuoteDraft, unit: Unit): QuoteInputs => ({
  salePrice: draft.salePrice,
  downPayment: draft.downPayment,
  months: draft.months,
  balloons: draft.balloons.map((b) => ({ month: b.month, amount: b.amount })),
  startDate: draft.startDate,
  currency: unit.currency,
});
const sameInputs = (a: QuoteInputs, b: QuoteInputs) =>
  a.salePrice === b.salePrice &&
  a.downPayment === b.downPayment &&
  a.months === b.months &&
  a.startDate === b.startDate &&
  JSON.stringify(a.balloons) === JSON.stringify(b.balloons);

/** Yeni teklif (taslak). Oranlar o anki ayarlardan, liste fiyatı daire kaydından alınır. */
export function createQuote(draft: QuoteDraft, ctx: QuoteContext, identity: { id: string; quoteNo: string }): Quote {
  assertQuotableUnit(ctx.unit);
  const inputs = inputsOf(draft, ctx.unit);
  assertWithinLimits(inputs, ctx.settings);
  const rates: QuoteRates = {
    vadeFarkiMonthlyPct: ctx.settings.vadeFarkiMonthlyPct,
    discountMonthlyPct: ctx.settings.discountMonthlyPct,
    commissionPct: ctx.settings.commissionPct,
  };
  return {
    id: identity.id,
    quoteNo: identity.quoteNo,
    unitId: ctx.unit.id,
    projectId: ctx.unit.projectId,
    leadId: ctx.lead.id,
    customer: { name: ctx.lead.name, phone: ctx.lead.phone || "" },
    unit: unitSnapshot(ctx.unit, ctx.project),
    employee: { openId: ctx.actor.openId, name: ctx.actor.name },
    inputs,
    rates,
    listPrice: ctx.unit.listPrice,
    ...computeQuote(inputs, rates, ctx.unit.listPrice),
    status: "taslak",
    decision: null,
    trail: [trailEntry("oluşturuldu", ctx.actor, ctx.now)],
    validUntil: addDays(isoDay(ctx.now), ctx.settings.quoteValidDays),
    optionHeld: false,
    note: draft.note,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    soldAt: null,
  };
}

/**
 * Teklifi düzenler. Oran anlık görüntüsü korunur; liste fiyatı daire kaydından yenilenir.
 * Onaylı teklifin tutarları değişirse teklif yeniden "onay bekliyor" olur; reddedilen teklif taslağa döner.
 */
export function editQuote(quote: Quote, draft: QuoteDraft, ctx: QuoteContext): Quote {
  if (!ctx.actor.manager && !isOwnQuote(quote, ctx.actor)) throw new QuoteError("Bu teklif başka bir çalışana ait.", 403, "FORBIDDEN");
  if (!EDITABLE_STATUSES.includes(quote.status))
    throw new QuoteError(`"${statusLabel(quote.status)}" durumundaki teklif düzenlenemez.`, 409, "INVALID_STATE");
  if (draft.unitId !== quote.unitId) throw new QuoteError("Teklifin dairesi değiştirilemez; o daire için yeni teklif hazırlayın.");
  const inputs = inputsOf(draft, ctx.unit);
  const moneyChanged = !sameInputs(inputs, quote.inputs);
  const leadChanged = ctx.lead.id !== quote.leadId;
  if (quote.status === "onaylandı" && leadChanged) throw new QuoteError("Onaylı teklifin müşterisi değiştirilemez; yeni teklif hazırlayın.", 409, "INVALID_STATE");
  if (moneyChanged || quote.status !== "onaylandı") assertQuotableUnit(ctx.unit);
  if (moneyChanged) assertWithinLimits(inputs, ctx.settings);
  const listPrice = moneyChanged || quote.status !== "onaylandı" ? ctx.unit.listPrice : quote.listPrice;
  const status: QuoteStatus = quote.status === "reddedildi" ? "taslak" : quote.status === "onaylandı" && moneyChanged ? "onay bekliyor" : quote.status;
  const reapproval = quote.status === "onaylandı" && status === "onay bekliyor";
  return {
    ...quote,
    leadId: ctx.lead.id,
    customer: { name: ctx.lead.name, phone: ctx.lead.phone || "" },
    unit: unitSnapshot(ctx.unit, ctx.project),
    inputs,
    listPrice,
    ...computeQuote(inputs, quote.rates, listPrice),
    status,
    decision: status === quote.status ? quote.decision : null,
    trail: [...quote.trail, trailEntry("düzenlendi", ctx.actor, ctx.now, reapproval ? "Tutarlar değişti; teklif yeniden onaya gönderildi." : "")],
    note: draft.note,
    updatedAt: ctx.now,
  };
}

/** Durum geçişi. Yetki, durum ve geçerlilik denetlenir; uygun değilse QuoteError fırlatır. */
export function transitionQuote(
  quote: Quote,
  action: QuoteAction,
  actor: QuoteActor,
  now: string,
  extra: { note?: string; reason?: RejectReason; validDays?: number } = {},
): Quote {
  const blocker = actionBlocker(quote, action, actor, isoDay(now));
  if (blocker) throw new QuoteError(blocker.message, blocker.statusCode, blocker.statusCode === 403 ? "FORBIDDEN" : "INVALID_STATE");
  const rule = QUOTE_TRANSITIONS[action];
  const note = (extra.note || "").trim().slice(0, 1000);
  const next: Quote = { ...quote, status: rule.to, updatedAt: now };
  if (action === "reject") {
    const reason = extra.reason && (REJECT_REASONS as readonly string[]).includes(extra.reason) ? extra.reason : undefined;
    if (!reason) throw new QuoteError("Ret gerekçesi seçin.");
    if (reason === "diğer" && !note) throw new QuoteError("Ret nedenini yazın.");
    next.decision = { status: "reddedildi", byOpenId: actor.openId, byName: actor.name, at: now, note, reason };
    next.trail = [...quote.trail, trailEntry(rule.trail, actor, now, note, reason)];
    return next;
  }
  if (action === "approve") {
    next.decision = { status: "onaylandı", byOpenId: actor.openId, byName: actor.name, at: now, note };
    // Geçerlilik onay gününden başlar: onay bekleme süresi müşterinin süresinden düşmez.
    if (extra.validDays) next.validUntil = addDays(isoDay(now), extra.validDays);
  }
  if (action === "sell") next.soldAt = now;
  next.trail = [...quote.trail, trailEntry(rule.trail, actor, now, note)];
  return next;
}

export interface UnitEffects {
  /** Daire bu duruma alınmalı (değişmeyecekse yok). */
  unitStatus?: UnitStatus;
  /** Güncellenmiş teklif (optionHeld işaretiyle). */
  quote: Quote;
  /** Daire satıldığı için iptal edilecek diğer açık teklifler (güncellenmiş hâlleriyle). */
  cancelled: Quote[];
}

/**
 * Bir teklif değişikliğinin daireye ve aynı dairenin diğer tekliflerine etkisi.
 * - Onay: daire müsaitse (ve ayar açıksa) opsiyona alınır.
 * - Satış: daire satıldı olur, dairenin diğer açık teklifleri iptal edilir.
 * - Onayın düşmesi (iptal, ret, yeniden onaya dönme, sürenin dolması): opsiyonu tutan başka teklif yoksa daire müsait olur.
 */
export function unitEffects(before: Quote | null, after: Quote, unit: Unit, others: Quote[], settings: Pick<QuoteSettings, "optionOnApproval">, actor: QuoteActor, now: string): UnitEffects {
  const today = isoDay(now);
  const siblings = others.filter((q) => q.unitId === after.unitId && q.id !== after.id);
  const otherHolder = siblings.some((q) => holdsOption(q, today));
  if (after.status === "satışa döndü" && before?.status !== "satışa döndü") {
    const system: QuoteActor = { ...actor };
    const cancelled = siblings
      .filter((q) => OPEN_STATUSES.includes(q.status))
      .map((q) => ({
        ...q,
        status: "iptal" as const,
        optionHeld: false,
        updatedAt: now,
        trail: [...q.trail, trailEntry("iptal", system, now, `Daire ${after.quoteNo} numaralı teklifle satıldı.`)],
      }));
    return { unitStatus: unit.status === "satıldı" ? undefined : "satıldı", quote: { ...after, optionHeld: false }, cancelled };
  }
  if (after.status === "onaylandı" && before?.status === "onay bekliyor") {
    if (!settings.optionOnApproval) return { quote: after, cancelled: [] };
    if (unit.status === "müsait") return { unitStatus: "opsiyonlu", quote: { ...after, optionHeld: true }, cancelled: [] };
    return { quote: { ...after, optionHeld: unit.status === "opsiyonlu" && otherHolder }, cancelled: [] };
  }
  const stillHolds = holdsOption(after, today);
  if (before?.optionHeld && !stillHolds) {
    const release = unit.status === "opsiyonlu" && !otherHolder;
    return { unitStatus: release ? "müsait" : undefined, quote: { ...after, optionHeld: false }, cancelled: [] };
  }
  return { quote: after, cancelled: [] };
}

// ---------------------------------------------------------------------------
// Görünürlük
// ---------------------------------------------------------------------------

/**
 * Yönetici olmayan kullanıcıya giden teklif: NBD, para maliyeti ve para maliyeti oranı çıkarılır.
 * Prim yalnız teklifin kendi çalışanına (ve yöneticiye) gösterilir.
 */
export type VisibleQuote = Omit<Quote, "evaluation" | "rates" | "commission"> & {
  evaluation: Partial<QuoteEvaluation> & Pick<QuoteEvaluation, "listPrice" | "discountPct" | "nominal">;
  rates: Partial<QuoteRates> & Pick<QuoteRates, "vadeFarkiMonthlyPct">;
  commission: number | null;
};
export function visibleQuote(quote: Quote, actor: QuoteActor): VisibleQuote {
  if (actor.manager) return quote;
  const own = isOwnQuote(quote, actor);
  return {
    ...quote,
    evaluation: { listPrice: quote.evaluation.listPrice, discountPct: quote.evaluation.discountPct, nominal: quote.evaluation.nominal },
    rates: { vadeFarkiMonthlyPct: quote.rates.vadeFarkiMonthlyPct, ...(own ? { commissionPct: quote.rates.commissionPct } : {}) },
    commission: own ? quote.commission : null,
  };
}

/** "Bu paraya ne verilebilir": reddedilen teklifin NBD'si liste fiyatını karşılayan, aynı para birimindeki müsait daireler. */
export function alternativesFor(quote: Quote, units: Unit[], projects: Pick<Project, "id" | "archived">[], limit = 20): Unit[] {
  const liveProjects = new Set(projects.filter((p) => !p.archived).map((p) => p.id));
  const pool = units.filter((u) => !u.archived && liveProjects.has(u.projectId) && u.currency === quote.inputs.currency && u.id !== quote.unitId);
  return unitsWithinValue(pool, quote.evaluation.npv, limit).map((item) => item.unit);
}

// ---------------------------------------------------------------------------
// Para maliyeti raporu ve primler
// ---------------------------------------------------------------------------

export interface CostFilters {
  projectId?: string;
  /** Boş = tüm durumlar. */
  statuses?: QuoteStatus[];
  /** Teklif tarihi alt/üst sınırı (YYYY-AA-GG, dâhil). */
  from?: string;
  to?: string;
  /** Çalışan openId. */
  employee?: string;
}
export interface CostRow {
  id: string;
  quoteNo: string;
  /** Teklif tarihi (oluşturma günü). */
  date: string;
  status: QuoteStatus;
  projectId: string;
  projectName: string;
  unitLabel: string;
  customer: string;
  employee: string;
  employeeOpenId: string;
  currency: UnitCurrency;
  listPrice: number;
  salePrice: number;
  discountPct: number;
  /** Müşterinin ödeyeceği nominal toplam. */
  nominal: number;
  npv: number;
  /** Para maliyeti = nominal − NBD. */
  costOfMoney: number;
  npvVsList: number;
  npvVsListPct: number;
  commission: number;
  discountMonthlyPct: number;
}
export interface CostTotal {
  key: string;
  label: string;
  currency: UnitCurrency;
  count: number;
  listPrice: number;
  salePrice: number;
  nominal: number;
  npv: number;
  costOfMoney: number;
  npvVsList: number;
  commission: number;
}

export const unitLabelOf = (unit: Quote["unit"]) => [unit.block && `${unit.block} Blok`, `No ${unit.unitNo}`].filter(Boolean).join(" · ");

export function costRows(quotes: Quote[], filters: CostFilters = {}): CostRow[] {
  const statuses = filters.statuses?.length ? new Set<string>(filters.statuses) : null;
  return quotes
    .filter((q) => {
      const date = isoDay(q.createdAt);
      if (filters.projectId && q.projectId !== filters.projectId) return false;
      if (statuses && !statuses.has(q.status)) return false;
      if (filters.from && date < filters.from) return false;
      if (filters.to && date > filters.to) return false;
      if (filters.employee && q.employee.openId !== filters.employee) return false;
      return true;
    })
    .map((q) => ({
      id: q.id,
      quoteNo: q.quoteNo,
      date: isoDay(q.createdAt),
      status: q.status,
      projectId: q.projectId,
      projectName: q.unit.projectName,
      unitLabel: unitLabelOf(q.unit),
      customer: q.customer.name,
      employee: q.employee.name,
      employeeOpenId: q.employee.openId,
      currency: q.inputs.currency,
      listPrice: q.listPrice,
      salePrice: q.plan.salePrice,
      discountPct: q.evaluation.discountPct,
      nominal: q.evaluation.nominal,
      npv: q.evaluation.npv,
      costOfMoney: q.evaluation.costOfMoney,
      npvVsList: q.evaluation.npvVsList,
      npvVsListPct: q.evaluation.npvVsListPct,
      commission: q.commission,
      discountMonthlyPct: q.rates.discountMonthlyPct,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.quoteNo.localeCompare(a.quoteNo));
}

const cents = (value: number) => Math.round(value * 100);
/** Satırları anahtara ve para birimine göre toplar (farklı para birimleri birbirine eklenmez). */
export function costTotals(rows: CostRow[], by: "project" | "month" | "all"): CostTotal[] {
  const map = new Map<string, { total: CostTotal; sums: Record<string, number> }>();
  const fields = ["listPrice", "salePrice", "nominal", "npv", "costOfMoney", "npvVsList", "commission"] as const;
  for (const row of rows) {
    const key = by === "project" ? row.projectId : by === "month" ? row.date.slice(0, 7) : "all";
    const label = by === "project" ? row.projectName || "—" : by === "month" ? row.date.slice(0, 7) : "Toplam";
    const id = `${key}\u0001${row.currency}`;
    let entry = map.get(id);
    if (!entry) {
      entry = {
        total: { key, label, currency: row.currency, count: 0, listPrice: 0, salePrice: 0, nominal: 0, npv: 0, costOfMoney: 0, npvVsList: 0, commission: 0 },
        sums: Object.fromEntries(fields.map((f) => [f, 0])),
      };
      map.set(id, entry);
    }
    entry.total.count++;
    for (const field of fields) entry.sums[field] += cents(row[field]);
  }
  return [...map.values()]
    .map(({ total, sums }) => ({ ...total, ...Object.fromEntries(fields.map((f) => [f, sums[f] / 100])) }) as CostTotal)
    .sort((a, b) => (by === "month" ? b.key.localeCompare(a.key) : a.label.localeCompare(b.label, "tr")) || a.currency.localeCompare(b.currency));
}

export interface CommissionRow {
  employeeOpenId: string;
  employee: string;
  /** Satış ayı (YYYY-AA). */
  month: string;
  currency: UnitCurrency;
  count: number;
  salePrice: number;
  commission: number;
}
/** Primler: satışa dönen tekliflerin, çalışan ve satış ayına göre adedi ve prim toplamı. */
export function commissionSummary(quotes: Quote[]): CommissionRow[] {
  const map = new Map<string, CommissionRow & { saleC: number; commC: number }>();
  for (const q of quotes) {
    if (q.status !== "satışa döndü") continue;
    const month = isoDay(q.soldAt || q.updatedAt).slice(0, 7);
    const id = `${q.employee.openId}\u0001${month}\u0001${q.inputs.currency}`;
    let row = map.get(id);
    if (!row) map.set(id, (row = { employeeOpenId: q.employee.openId, employee: q.employee.name, month, currency: q.inputs.currency, count: 0, salePrice: 0, commission: 0, saleC: 0, commC: 0 }));
    row.count++;
    row.saleC += cents(q.plan.salePrice);
    row.commC += cents(q.commission);
  }
  return [...map.values()]
    .map(({ saleC, commC, ...row }) => ({ ...row, salePrice: saleC / 100, commission: commC / 100 }))
    .sort((a, b) => b.month.localeCompare(a.month) || a.employee.localeCompare(b.employee, "tr") || a.currency.localeCompare(b.currency));
}

/** CSV hücresi: ayırıcı/tırnak kaçışı ve formül enjeksiyonuna karşı önlem (= + - @ ile başlayan metin). */
function csvCell(value: string | number): string {
  if (typeof value === "number") return value.toFixed(2).replace(".", ",");
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export const COST_CSV_HEADER = [
  "Teklif no", "Tarih", "Durum", "Proje", "Daire", "Müşteri", "Çalışan", "Para birimi", "Liste fiyatı", "Satış bedeli", "İskonto %",
  "Toplam ödeme (nominal)", "Net bugünkü değer", "Para maliyeti", "NBD − liste fiyatı", "NBD / liste %", "Prim", "Aylık para maliyeti oranı %",
];
/** Excel'in Türkçe ayarlarıyla açılır: noktalı virgül ayırıcı, ondalık virgül, UTF-8 BOM. */
export function costCsv(rows: CostRow[]): string {
  const rate = (value: number) => String(value).replace(".", ",");
  const lines = rows.map((r) =>
    [
      csvCell(r.quoteNo), csvCell(r.date), csvCell(statusLabel(r.status)), csvCell(r.projectName), csvCell(r.unitLabel), csvCell(r.customer), csvCell(r.employee), r.currency,
      csvCell(r.listPrice), csvCell(r.salePrice), csvCell(r.discountPct), csvCell(r.nominal), csvCell(r.npv), csvCell(r.costOfMoney), csvCell(r.npvVsList), csvCell(r.npvVsListPct),
      csvCell(r.commission), rate(r.discountMonthlyPct),
    ].join(";"),
  );
  return `﻿${[COST_CSV_HEADER.join(";"), ...lines].join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Biçimlendirme
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<QuoteStatus, string> = {
  taslak: "Taslak",
  "onay bekliyor": "Onay bekliyor",
  onaylandı: "Onaylandı",
  reddedildi: "Reddedildi",
  "müşteriye gönderildi": "Müşteriye gönderildi",
  "satışa döndü": "Satışa döndü",
  iptal: "İptal",
};
export const statusLabel = (status: QuoteStatus) => STATUS_LABELS[status] || status;
export const REJECT_REASON_LABELS: Record<RejectReason, string> = { fiyat: "Bu fiyata satamayız", diğer: "Diğer" };

const SYMBOLS: Record<UnitCurrency, string> = { TRY: "₺", USD: "$", EUR: "€" };
const CODES: Record<UnitCurrency, string> = { TRY: "TL", USD: "USD", EUR: "EUR" };
const groupDigits = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** 1234567.5 → "1.234.567,50" (ICU'ya bağlı değildir). */
export function formatAmount(value: number): string {
  const sign = value < 0 ? "−" : "";
  const [whole, fraction] = Math.abs(value).toFixed(2).split(".");
  return `${sign}${groupDigits(whole)},${fraction}`;
}
/** Ekran için: ₺1.234.567,50 */
export const formatMoney = (value: number, currency: UnitCurrency = "TRY") => `${value < 0 ? "−" : ""}${SYMBOLS[currency]}${formatAmount(Math.abs(value))}`;
/** Belge (PDF) için: 1.234.567,50 TL */
export const formatMoneyCode = (value: number, currency: UnitCurrency = "TRY") => `${formatAmount(value)} ${CODES[currency]}`;
/** 12.5 → "%12,5" */
export const formatPct = (value: number, digits = 2) => {
  const fixed = value.toFixed(digits);
  return `%${(fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed).replace(".", ",").replace("-", "−")}`;
};
/** 2026-11-13 → 13.11.2026 */
export const formatDay = (day: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day || "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "—";
};
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
/** 2026-11 → "Kasım 2026" */
export const formatMonth = (month: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? `${MONTHS[Number(match[2]) - 1] || ""} ${match[1]}`.trim() : month;
};
