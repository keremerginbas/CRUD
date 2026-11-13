// Gayrimenkul satış hesapları: ödeme planı (vade farkı), net bugünkü değer (NBD), para maliyeti ve prim.
// Sunucu ve arayüz aynı işlevleri kullanır; teklif onayında sunucu sonucu yeniden hesaplar.
// Tutarlar kuruş hassasiyetinde yuvarlanır; yuvarlama farkı son taksite eklenir.

export type VadeFarkiMethod = "flat";

export interface PlanInput {
  /** Satış bedeli (iskonto sonrası, vade farkı hariç). */
  salePrice: number;
  /** Peşinat. */
  downPayment: number;
  /** Taksit sayısı (ay). 0 ise peşin satış. */
  months: number;
  /** Aylık vade farkı oranı, yüzde (ör. 1.11). */
  monthlyRatePct: number;
  /** Ara ödemeler: belirtilen ayda taksite ek olarak ödenen sabit tutarlar. */
  balloons?: { month: number; amount: number }[];
  /** İlk taksitin vade tarihinin hesaplandığı satış tarihi (YYYY-MM-DD). */
  startDate: string;
  method?: VadeFarkiMethod;
}

export interface PlanRow {
  no: number;
  /** Satış tarihinden itibaren kaçıncı ay (peşinat için 0). */
  month: number;
  dueDate: string;
  amount: number;
  kind: "peşinat" | "taksit" | "ara ödeme";
}

export interface PaymentPlan {
  salePrice: number;
  downPayment: number;
  /** Vadeye kalan tutar (satış bedeli − peşinat). */
  financed: number;
  /** Vade farkı tutarı. */
  vadeFarki: number;
  /** Müşterinin ödeyeceği toplam (peşinat dahil). */
  totalPayable: number;
  /** Düzenli aylık taksit. */
  installment: number;
  months: number;
  monthlyRatePct: number;
  rows: PlanRow[];
}

export class FinanceError extends Error {}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const kurus = (value: number) => Math.round(value * 100);

/** Tarihe ay ekler; ayın günü sığmıyorsa o ayın son gününe çekilir (31 Ocak + 1 ay = 28/29 Şubat). */
export function addMonths(isoDate: string, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new FinanceError("Tarih YYYY-AA-GG biçiminde olmalı.");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(day, last);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Düz (sabit) vade farkı: vadeye kalan tutar × aylık oran × ay sayısı.
 * Örnek: 3.000.000 TL, aylık %1,111…, 60 ay → 2.000.000 TL vade farkı, toplam 5.000.000 TL.
 * Ara ödeme varsa toplam değişmez; düzenli taksit buna göre küçülür.
 */
export function buildPaymentPlan(input: PlanInput): PaymentPlan {
  const { salePrice, downPayment, months, monthlyRatePct, startDate } = input;
  const balloons = (input.balloons || []).filter((b) => b.amount > 0);
  if (!(salePrice > 0) || !Number.isFinite(salePrice)) throw new FinanceError("Satış bedeli sıfırdan büyük olmalı.");
  if (!(downPayment >= 0) || downPayment > salePrice) throw new FinanceError("Peşinat 0 ile satış bedeli arasında olmalı.");
  if (!Number.isInteger(months) || months < 0 || months > 240) throw new FinanceError("Taksit sayısı 0–240 ay arasında olmalı.");
  if (!(monthlyRatePct >= 0) || monthlyRatePct > 20) throw new FinanceError("Aylık oran %0–%20 arasında olmalı.");
  for (const b of balloons)
    if (!Number.isInteger(b.month) || b.month < 1 || b.month > months) throw new FinanceError("Ara ödeme ayı taksit süresi içinde olmalı.");

  const financedK = kurus(salePrice) - kurus(downPayment);
  if (months === 0 && financedK !== 0) throw new FinanceError("Peşin satışta peşinat satış bedeline eşit olmalı.");
  const vadeFarkiK = Math.round(financedK * (monthlyRatePct / 100) * months);
  const dueK = financedK + vadeFarkiK;
  const balloonK = balloons.reduce((sum, b) => sum + kurus(b.amount), 0);
  if (balloonK > dueK) throw new FinanceError("Ara ödemeler vadeli tutarı aşıyor.");
  const regularK = months > 0 ? Math.floor((dueK - balloonK) / months) : 0;
  const remainderK = months > 0 ? dueK - balloonK - regularK * months : 0;

  const rows: PlanRow[] = [];
  let no = 0;
  if (kurus(downPayment) > 0) rows.push({ no: ++no, month: 0, dueDate: startDate, amount: round2(downPayment), kind: "peşinat" });
  for (let month = 1; month <= months; month++) {
    const dueDate = addMonths(startDate, month);
    const amountK = regularK + (month === months ? remainderK : 0);
    if (amountK > 0) rows.push({ no: ++no, month, dueDate, amount: amountK / 100, kind: "taksit" });
    for (const b of balloons.filter((x) => x.month === month))
      rows.push({ no: ++no, month, dueDate, amount: round2(b.amount), kind: "ara ödeme" });
  }
  return {
    salePrice: round2(salePrice),
    downPayment: round2(downPayment),
    financed: financedK / 100,
    vadeFarki: vadeFarkiK / 100,
    totalPayable: (kurus(downPayment) + dueK) / 100,
    installment: regularK / 100,
    months,
    monthlyRatePct,
    rows,
  };
}

export interface NpvResult {
  /** Ödemelerin satış tarihindeki (valör) bugünkü değeri. */
  npv: number;
  /** Müşterinin ödeyeceği toplam (nominal). */
  nominal: number;
  /** Para maliyeti: nominal toplam − bugünkü değer. */
  costOfMoney: number;
}

/**
 * Net bugünkü değer: her ödeme, satış tarihinden uzaklığı kadar ay için aylık iskonto oranıyla bugüne çekilir.
 * NBD = Σ tutar / (1 + oran)^ay. Peşinat (ay 0) olduğu gibi sayılır.
 */
export function netPresentValue(rows: Pick<PlanRow, "month" | "amount">[], discountMonthlyPct: number): NpvResult {
  if (!(discountMonthlyPct >= 0) || discountMonthlyPct > 20) throw new FinanceError("İskonto oranı %0–%20 arasında olmalı.");
  const rate = discountMonthlyPct / 100;
  let npv = 0;
  let nominal = 0;
  for (const row of rows) {
    nominal += row.amount;
    npv += row.amount / Math.pow(1 + rate, row.month);
  }
  return { npv: round2(npv), nominal: round2(nominal), costOfMoney: round2(nominal - npv) };
}

export interface QuoteEvaluation extends NpvResult {
  listPrice: number;
  /** Bugünkü değer − liste fiyatı (eksi ise liste fiyatının altında). */
  npvVsList: number;
  /** Bugünkü değerin liste fiyatına oranı, yüzde. */
  npvVsListPct: number;
  /** Satış bedelinin liste fiyatına göre iskontosu, yüzde. */
  discountPct: number;
}

/** Yöneticinin onay ekranında gördüğü karşılaştırma: teklifin bugünkü değeri ile liste fiyatı. */
export function evaluateQuote(plan: PaymentPlan, listPrice: number, discountMonthlyPct: number): QuoteEvaluation {
  if (!(listPrice > 0)) throw new FinanceError("Liste fiyatı sıfırdan büyük olmalı.");
  const result = netPresentValue(plan.rows, discountMonthlyPct);
  return {
    ...result,
    listPrice: round2(listPrice),
    npvVsList: round2(result.npv - listPrice),
    npvVsListPct: round2((result.npv / listPrice) * 100),
    discountPct: round2(((listPrice - plan.salePrice) / listPrice) * 100),
  };
}

/** Prim: satış bedelinin sabit yüzdesi (vade farkı prime dahil değildir). */
export function commission(salePrice: number, ratePct: number): number {
  if (!(ratePct >= 0) || ratePct > 100) throw new FinanceError("Prim oranı %0–%100 arasında olmalı.");
  return round2(salePrice * (ratePct / 100));
}

export interface AffordableUnit<T> {
  unit: T;
  /** Bugünkü değer − liste fiyatı. */
  margin: number;
}

/**
 * "Bu paraya ne verilebilir": teklifin bugünkü değeri liste fiyatını karşılayan müsait bölümler,
 * bugünkü değere en yakın (en pahalı) olandan başlayarak.
 */
export function unitsWithinValue<T extends { listPrice: number; status?: string }>(units: T[], npv: number, limit = 20): AffordableUnit<T>[] {
  return units
    .filter((unit) => (unit.status === undefined || unit.status === "müsait") && unit.listPrice > 0 && unit.listPrice <= npv)
    .map((unit) => ({ unit, margin: round2(npv - unit.listPrice) }))
    .sort((a, b) => a.margin - b.margin)
    .slice(0, limit);
}
