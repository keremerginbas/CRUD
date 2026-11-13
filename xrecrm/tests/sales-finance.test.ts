import { expect, it } from "vitest";
import { addMonths, buildPaymentPlan, commission, evaluateQuote, FinanceError, netPresentValue, unitsWithinValue } from "../shared/sales-finance";

it("düz vade farkı: 3.000.000 TL vadeli tutar 60 ayda 5.000.000 TL olur", () => {
  // Müşteri örneği: aylık oran 2.000.000 / (3.000.000 × 60) = %1,1111…
  const plan = buildPaymentPlan({ salePrice: 3_000_000, downPayment: 0, months: 60, monthlyRatePct: 100 / 90, startDate: "2026-01-15" });
  expect(plan.vadeFarki).toBe(2_000_000);
  expect(plan.totalPayable).toBe(5_000_000);
  expect(plan.rows).toHaveLength(60);
  expect(plan.installment).toBe(83_333.33);
  // Kuruş farkı son taksitte kapanır; toplam tam tutar.
  expect(plan.rows.at(-1)!.amount).toBe(83_333.53);
  expect(Math.round(plan.rows.reduce((s, r) => s + r.amount, 0) * 100)).toBe(500_000_000);
  expect(plan.rows[0]).toMatchObject({ month: 1, dueDate: "2026-02-15", kind: "taksit" });
  expect(plan.rows.at(-1)!.dueDate).toBe("2031-01-15");
});

it("peşinat vade farkına girmez; ara ödeme toplamı değiştirmez, taksiti küçültür", () => {
  const base = { salePrice: 4_000_000, downPayment: 1_000_000, months: 24, monthlyRatePct: 2, startDate: "2026-03-31" };
  const plain = buildPaymentPlan(base);
  expect(plain.financed).toBe(3_000_000);
  expect(plain.vadeFarki).toBe(1_440_000); // 3.000.000 × %2 × 24
  expect(plain.totalPayable).toBe(5_440_000);
  expect(plain.installment).toBe(185_000);
  expect(plain.rows[0]).toMatchObject({ kind: "peşinat", month: 0, amount: 1_000_000, dueDate: "2026-03-31" });
  // 31 Mart + 1 ay = 30 Nisan; + 11 ay = 28 Şubat.
  expect(plain.rows[1].dueDate).toBe("2026-04-30");
  expect(plain.rows[11].dueDate).toBe("2027-02-28");

  const withBalloons = buildPaymentPlan({ ...base, balloons: [{ month: 12, amount: 600_000 }, { month: 24, amount: 600_000 }] });
  expect(withBalloons.totalPayable).toBe(5_440_000);
  expect(withBalloons.installment).toBe(135_000);
  expect(withBalloons.rows.filter((r) => r.kind === "ara ödeme").map((r) => r.month)).toEqual([12, 24]);
  expect(Math.round(withBalloons.rows.reduce((s, r) => s + r.amount, 0) * 100)).toBe(544_000_000);
});

it("peşin satış ve geçersiz girdiler", () => {
  const cash = buildPaymentPlan({ salePrice: 2_500_000, downPayment: 2_500_000, months: 0, monthlyRatePct: 1.5, startDate: "2026-05-01" });
  expect(cash).toMatchObject({ vadeFarki: 0, totalPayable: 2_500_000, installment: 0 });
  expect(cash.rows).toHaveLength(1);
  const bad = (patch: object) => () => buildPaymentPlan({ salePrice: 1_000_000, downPayment: 0, months: 12, monthlyRatePct: 1, startDate: "2026-01-01", ...patch });
  for (const patch of [{ salePrice: 0 }, { downPayment: -1 }, { downPayment: 2_000_000 }, { months: 1.5 }, { months: 300 }, { monthlyRatePct: -1 }, { monthlyRatePct: 25 }, { startDate: "01.01.2026" }, { balloons: [{ month: 13, amount: 1 }] }, { balloons: [{ month: 6, amount: 5_000_000 }] }, { months: 0 }])
    expect(bad(patch)).toThrow(FinanceError);
  expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
});

it("bugünkü değer, para maliyeti ve liste fiyatı karşılaştırması", () => {
  // Elle hesap: 100 peşin + 110 (1 ay sonra) + 121 (2 ay sonra), aylık %10 → 100 + 100 + 100 = 300.
  expect(netPresentValue([{ month: 0, amount: 100 }, { month: 1, amount: 110 }, { month: 2, amount: 121 }], 10)).toEqual({ npv: 300, nominal: 331, costOfMoney: 31 });
  // İskonto oranı 0 ise bugünkü değer nominal toplama eşittir.
  expect(netPresentValue([{ month: 0, amount: 50 }, { month: 12, amount: 50 }], 0)).toMatchObject({ npv: 100, costOfMoney: 0 });

  const plan = buildPaymentPlan({ salePrice: 3_000_000, downPayment: 0, months: 60, monthlyRatePct: 100 / 90, startDate: "2026-01-15" });
  const quote = evaluateQuote(plan, 3_200_000, 3);
  expect(quote.nominal).toBe(5_000_000);
  // Yıllık anüite çarpanı ile bağımsız kontrol: taksit × (1 − 1,03^−60) / 0,03.
  const expected = 83_333.33 * ((1 - Math.pow(1.03, -60)) / 0.03);
  expect(Math.abs(quote.npv - expected)).toBeLessThan(1);
  expect(quote.npv).toBeLessThan(quote.listPrice);
  expect(quote.npvVsList).toBeLessThan(0);
  expect(quote.discountPct).toBe(6.25);
  expect(quote.costOfMoney).toBe(Math.round((5_000_000 - quote.npv) * 100) / 100);
});

it("prim satış bedelinin sabit yüzdesidir; bugünkü değere sığan müsait bölümler sıralanır", () => {
  expect(commission(3_000_000, 2)).toBe(60_000);
  expect(commission(1_234_567.89, 1.5)).toBe(18_518.52);
  expect(() => commission(1, 150)).toThrow(FinanceError);
  const units = [
    { id: "a", listPrice: 2_000_000, status: "müsait" },
    { id: "b", listPrice: 2_400_000, status: "müsait" },
    { id: "c", listPrice: 2_450_000, status: "satıldı" },
    { id: "d", listPrice: 2_600_000, status: "müsait" },
  ];
  expect(unitsWithinValue(units, 2_500_000).map((x) => [x.unit.id, x.margin])).toEqual([["b", 100_000], ["a", 500_000]]);
});
