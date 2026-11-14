// Gayrimenkul satış modülü — FAZ 3: satış belgeleri. Senet (bono) dökümü, gecikme faizi ve
// sözleşme şablonunu dolduran alanlar. Sunucu ve arayüz aynı işlevleri kullanır.
import { z } from "zod";
import { formatDay, formatMoneyCode, formatPct, type Quote, type QuoteSettings } from "./quotes.js";
import type { UnitCurrency } from "./real-estate.js";

export const SALE_KIND = "re_sale";
export const CONTRACT_TEMPLATE_KIND = "re_contract_template";
export const CONTRACT_TEMPLATE_ID = "template";
/** Yüklenebilecek Word şablonunun üst sınırı. */
export const CONTRACT_TEMPLATE_MAX_BYTES = 700_000;

const text = (max: number) => z.string().trim().max(max).default("");

export const SalePartiesSchema = z.object({
  buyerName: z.string().trim().min(2, "Alıcının adı soyadı gerekli.").max(200),
  buyerTckn: text(20),
  buyerAddress: text(500),
  buyerPhone: text(60),
  buyerEmail: text(200),
  guarantorName: text(200),
  guarantorTckn: text(20),
  guarantorAddress: text(500),
  /** Sözleşme ve senetlerin düzenlendiği yer (ör. İstanbul). */
  issuePlace: text(120),
  /** Sözleşme / senet düzenleme tarihi (YYYY-AA-GG). */
  contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı."),
  /** Aylık gecikme faizi oranı, yüzde. */
  lateInterestMonthlyPct: z.number().finite().min(0).max(20).default(0),
});
export type SaleParties = z.infer<typeof SalePartiesSchema>;

export type SenetStatus = "bekliyor" | "ödendi";
export interface Senet {
  /** Sıra numarası (1'den başlar). */
  no: number;
  /** Toplam senet sayısı. */
  of: number;
  amount: number;
  currency: UnitCurrency;
  dueDate: string;
  kind: "taksit" | "ara ödeme";
  status: SenetStatus;
  paidAt: string | null;
}

export interface Sale {
  quoteId: string;
  quoteNo: string;
  parties: SaleParties;
  senets: Senet[];
  updatedAt: string;
  updatedBy: string;
}

/** TC kimlik numarası denetimi (11 hane, sağlama basamakları). Boş değer geçerli sayılır. */
export function validTckn(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return true;
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = v.split("").map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = (d.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;
  return d[9] === d10 && d[10] === d11;
}

/**
 * Ödeme planındaki her vadeli ödeme için bir senet. Peşinat senede bağlanmaz.
 * Daha önce "ödendi" işaretlenen senetler (aynı sıra, vade ve tutar) işaretini korur.
 */
export function buildSenets(quote: Pick<Quote, "plan" | "inputs">, previous: Senet[] = []): Senet[] {
  const rows = quote.plan.rows.filter((row) => row.month > 0 && row.amount > 0);
  return rows.map((row, index) => {
    const no = index + 1;
    const old = previous.find((s) => s.no === no && s.dueDate === row.dueDate && Math.abs(s.amount - row.amount) < 0.005);
    return {
      no,
      of: rows.length,
      amount: row.amount,
      currency: quote.inputs.currency,
      dueDate: row.dueDate,
      kind: row.kind === "ara ödeme" ? "ara ödeme" : "taksit",
      status: old?.status === "ödendi" ? "ödendi" : "bekliyor",
      paidAt: old?.status === "ödendi" ? old.paidAt : null,
    };
  });
}

const dayNumber = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : NaN;
};

export interface LateInterest {
  daysLate: number;
  interest: number;
  /** Senet tutarı + gecikme faizi. */
  total: number;
}

/**
 * Basit gecikme faizi: tutar × aylık oran × gecikilen gün / 30.
 * Ödenmiş senette ödeme tarihine, ödenmemişte verilen güne kadar hesaplanır.
 */
export function lateInterest(senet: Pick<Senet, "amount" | "dueDate" | "status" | "paidAt">, asOf: string, monthlyPct: number): LateInterest {
  const until = senet.status === "ödendi" && senet.paidAt ? senet.paidAt : asOf;
  const days = dayNumber(until) - dayNumber(senet.dueDate);
  const daysLate = Number.isFinite(days) && days > 0 ? days : 0;
  const interest = Math.round(senet.amount * (Math.max(0, monthlyPct) / 100) * (daysLate / 30) * 100) / 100;
  return { daysLate, interest, total: Math.round((senet.amount + interest) * 100) / 100 };
}

export interface SenetSummary {
  count: number;
  total: number;
  paidCount: number;
  paidTotal: number;
  overdueCount: number;
  overdueTotal: number;
  /** Vadesi geçmiş senetlerin bugüne kadarki gecikme faizi. */
  overdueInterest: number;
  /** Sıradaki ödenmemiş senet. */
  next: Senet | null;
}

export function summarizeSenets(senets: Senet[], today: string, monthlyPct: number): SenetSummary {
  const round = (v: number) => Math.round(v * 100) / 100;
  const open = senets.filter((s) => s.status !== "ödendi");
  const overdue = open.filter((s) => s.dueDate < today);
  const paid = senets.filter((s) => s.status === "ödendi");
  return {
    count: senets.length,
    total: round(senets.reduce((a, s) => a + s.amount, 0)),
    paidCount: paid.length,
    paidTotal: round(paid.reduce((a, s) => a + s.amount, 0)),
    overdueCount: overdue.length,
    overdueTotal: round(overdue.reduce((a, s) => a + s.amount, 0)),
    overdueInterest: round(overdue.reduce((a, s) => a + lateInterest(s, today, monthlyPct).interest, 0)),
    next: [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null,
  };
}

// ---- Tutarın yazıyla gösterimi -------------------------------------------------------

const ONES = ["", "Bir", "İki", "Üç", "Dört", "Beş", "Altı", "Yedi", "Sekiz", "Dokuz"];
const TENS = ["", "On", "Yirmi", "Otuz", "Kırk", "Elli", "Altmış", "Yetmiş", "Seksen", "Doksan"];
const GROUPS = ["", "Bin", "Milyon", "Milyar", "Trilyon"];

function threeDigits(n: number): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  if (h > 0) {
    if (h > 1) out.push(ONES[h]);
    out.push("Yüz");
  }
  const t = Math.floor((n % 100) / 10);
  if (t) out.push(TENS[t]);
  if (n % 10) out.push(ONES[n % 10]);
  return out;
}

/** Tam sayıyı Türkçe yazıya çevirir (1000 → "Bin", 2001 → "İki Bin Bir"). */
export function numberInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Sıfır";
  const parts: string[] = [];
  for (let group = 0; n > 0 && group < GROUPS.length; group++) {
    const chunk = n % 1000;
    n = Math.floor(n / 1000);
    if (!chunk) continue;
    const words = group === 1 && chunk === 1 ? [] : threeDigits(chunk);
    if (GROUPS[group]) words.push(GROUPS[group]);
    parts.unshift(words.join(" "));
  }
  return parts.join(" ");
}

const CURRENCY_WORDS: Record<UnitCurrency, [string, string]> = {
  TRY: ["Türk Lirası", "Kuruş"],
  USD: ["Amerikan Doları", "Sent"],
  EUR: ["Avro", "Sent"],
};

/** Senet ve sözleşmede kullanılan yazıyla tutar: "Yalnız Bir Milyon İki Yüz Bin Türk Lirası Elli Kuruş". */
export function amountInWords(amount: number, currency: UnitCurrency = "TRY"): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const [major, minor] = CURRENCY_WORDS[currency] || CURRENCY_WORDS.TRY;
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return `Yalnız ${numberInWords(whole)} ${major}${rest ? ` ${numberInWords(rest)} ${minor}` : ""}`;
}

// ---- Sözleşme şablonu alanları ----------------------------------------------------

/** Word şablonunda {{alan}} biçiminde kullanılabilen alanlar ve açıklamaları. */
export const CONTRACT_FIELDS: [string, string][] = [
  ["sirket_adi", "Satıcı firma adı"],
  ["sirket_adresi", "Satıcı firma adresi"],
  ["sirket_telefon", "Satıcı firma telefonu"],
  ["alici_adi", "Alıcının adı soyadı"],
  ["alici_tckn", "Alıcının TC kimlik numarası"],
  ["alici_adres", "Alıcının adresi"],
  ["alici_telefon", "Alıcının telefonu"],
  ["alici_eposta", "Alıcının e-postası"],
  ["kefil_adi", "Kefilin adı soyadı"],
  ["kefil_tckn", "Kefilin TC kimlik numarası"],
  ["kefil_adres", "Kefilin adresi"],
  ["proje_adi", "Proje adı"],
  ["blok", "Blok"],
  ["kat", "Kat"],
  ["daire_no", "Bağımsız bölüm numarası"],
  ["daire_tipi", "Daire tipi (ör. 2+1)"],
  ["brut_m2", "Brüt m²"],
  ["net_m2", "Net m²"],
  ["liste_fiyati", "Liste fiyatı"],
  ["satis_bedeli", "Satış bedeli"],
  ["satis_bedeli_yaziyla", "Satış bedeli (yazıyla)"],
  ["pesinat", "Peşinat"],
  ["pesinat_yaziyla", "Peşinat (yazıyla)"],
  ["vadeli_tutar", "Vadeye kalan tutar"],
  ["vade_farki", "Vade farkı tutarı"],
  ["toplam_odeme", "Toplam ödeme (peşinat dahil)"],
  ["toplam_odeme_yaziyla", "Toplam ödeme (yazıyla)"],
  ["taksit_sayisi", "Taksit sayısı (ay)"],
  ["taksit_tutari", "Aylık taksit tutarı"],
  ["aylik_oran", "Aylık vade farkı oranı"],
  ["gecikme_faizi", "Aylık gecikme faizi oranı"],
  ["senet_sayisi", "Senet sayısı"],
  ["senet_toplami", "Senetlerin toplam tutarı"],
  ["sozlesme_tarihi", "Sözleşme tarihi"],
  ["sozlesme_yeri", "Sözleşmenin düzenlendiği yer"],
  ["teklif_no", "Teklif numarası"],
  ["satis_danismani", "Satış danışmanı"],
];
/** Tek başına bir satıra yazıldığında tabloya dönüşen alanlar. */
export const CONTRACT_TABLES: [string, string][] = [
  ["odeme_plani", "Ödeme planı tablosu (sıra, vade, açıklama, tutar)"],
  ["senet_listesi", "Senet listesi tablosu (senet no, vade, tutar)"],
];

const floorText = (floor: number) => (floor === 0 ? "Zemin" : floor < 0 ? `${-floor}. bodrum` : String(floor));
const m2 = (value: number) => (value > 0 ? String(Math.round(value * 10) / 10).replace(".", ",") : "");
const KIND_LABEL: Record<string, string> = { peşinat: "Peşinat", taksit: "Taksit", "ara ödeme": "Ara ödeme" };

export interface ContractData {
  fields: Record<string, string>;
  tables: Record<string, string[][]>;
}

export function contractData(
  quote: Quote,
  sale: Pick<Sale, "parties" | "senets">,
  settings: Pick<QuoteSettings, "companyName" | "companyAddress" | "companyPhone"> | null,
): ContractData {
  const { plan, inputs, unit } = quote;
  const p = sale.parties;
  const money = (value: number) => formatMoneyCode(value, inputs.currency);
  const senetTotal = Math.round(sale.senets.reduce((a, s) => a + s.amount, 0) * 100) / 100;
  const fields: Record<string, string> = {
    sirket_adi: settings?.companyName || "",
    sirket_adresi: settings?.companyAddress || "",
    sirket_telefon: settings?.companyPhone || "",
    alici_adi: p.buyerName,
    alici_tckn: p.buyerTckn,
    alici_adres: p.buyerAddress,
    alici_telefon: p.buyerPhone || quote.customer.phone || "",
    alici_eposta: p.buyerEmail,
    kefil_adi: p.guarantorName,
    kefil_tckn: p.guarantorTckn,
    kefil_adres: p.guarantorAddress,
    proje_adi: unit.projectName,
    blok: unit.block,
    kat: floorText(unit.floor),
    daire_no: unit.unitNo,
    daire_tipi: unit.type,
    brut_m2: m2(unit.grossM2),
    net_m2: m2(unit.netM2),
    liste_fiyati: money(quote.listPrice),
    satis_bedeli: money(plan.salePrice),
    satis_bedeli_yaziyla: amountInWords(plan.salePrice, inputs.currency),
    pesinat: money(plan.downPayment),
    pesinat_yaziyla: amountInWords(plan.downPayment, inputs.currency),
    vadeli_tutar: money(plan.financed),
    vade_farki: money(plan.vadeFarki),
    toplam_odeme: money(plan.totalPayable),
    toplam_odeme_yaziyla: amountInWords(plan.totalPayable, inputs.currency),
    taksit_sayisi: String(plan.months),
    taksit_tutari: money(plan.installment),
    aylik_oran: formatPct(plan.monthlyRatePct),
    gecikme_faizi: formatPct(p.lateInterestMonthlyPct),
    senet_sayisi: String(sale.senets.length),
    senet_toplami: money(senetTotal),
    sozlesme_tarihi: formatDay(p.contractDate),
    sozlesme_yeri: p.issuePlace,
    teklif_no: quote.quoteNo,
    satis_danismani: quote.employee.name,
  };
  const tables: Record<string, string[][]> = {
    odeme_plani: [
      ["Sıra", "Vade", "Açıklama", "Tutar"],
      ...plan.rows.map((row) => [String(row.no), formatDay(row.dueDate), KIND_LABEL[row.kind] || row.kind, money(row.amount)]),
      ["", "", "Toplam", money(plan.totalPayable)],
    ],
    senet_listesi: [
      ["Senet no", "Vade", "Tutar"],
      ...sale.senets.map((s) => [`${s.no}/${s.of}`, formatDay(s.dueDate), money(s.amount)]),
      ["", "Toplam", money(senetTotal)],
    ],
  };
  return { fields, tables };
}
