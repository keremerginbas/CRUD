import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import { amountInWords, buildSenets, lateInterest, numberInWords, summarizeSenets, validTckn } from "../shared/senet";
import { buildDocx, fillDocx } from "../shared/docx-fill";
import { buildDefaultContractTemplate } from "../shared/contract-template";
import { buildPaymentPlan } from "../shared/sales-finance";

const plan = buildPaymentPlan({ salePrice: 4_000_000, downPayment: 1_000_000, months: 60, monthlyRatePct: 10 / 9, balloons: [{ month: 12, amount: 200_000 }], startDate: "2026-01-31" });
const quote = { plan, inputs: { currency: "TRY" } } as any;

describe("yazıyla tutar", () => {
  it("Türkçe kurallara göre yazar", () => {
    expect(numberInWords(0)).toBe("Sıfır");
    expect(numberInWords(1000)).toBe("Bin");
    expect(numberInWords(2001)).toBe("İki Bin Bir");
    expect(numberInWords(100)).toBe("Yüz");
    expect(numberInWords(1_250_315)).toBe("Bir Milyon İki Yüz Elli Bin Üç Yüz On Beş");
    expect(amountInWords(83_333.33)).toBe("Yalnız Seksen Üç Bin Üç Yüz Otuz Üç Türk Lirası Otuz Üç Kuruş");
    expect(amountInWords(5_000_000, "USD")).toBe("Yalnız Beş Milyon Amerikan Doları");
  });
});

describe("senetler", () => {
  it("her vadeli ödeme için bir senet üretir, peşinatı atlar", () => {
    const senets = buildSenets(quote);
    expect(senets).toHaveLength(61);
    expect(senets[0]).toMatchObject({ no: 1, of: 61, dueDate: "2026-02-28", kind: "taksit", status: "bekliyor" });
    expect(senets.filter((s) => s.kind === "ara ödeme")).toHaveLength(1);
    const total = senets.reduce((a, s) => a + Math.round(s.amount * 100), 0) / 100;
    expect(total).toBe(plan.totalPayable - plan.downPayment);
  });
  it("yeniden üretimde ödenmiş işaretini korur", () => {
    const first = buildSenets(quote);
    first[2] = { ...first[2], status: "ödendi", paidAt: "2026-04-30" };
    const again = buildSenets(quote, first);
    expect(again[2]).toMatchObject({ status: "ödendi", paidAt: "2026-04-30" });
    expect(again[3].status).toBe("bekliyor");
  });
  it("gecikme faizini gün üzerinden hesaplar", () => {
    const s = { amount: 100_000, dueDate: "2026-03-01", status: "bekliyor" as const, paidAt: null };
    expect(lateInterest(s, "2026-03-01", 3)).toMatchObject({ daysLate: 0, interest: 0 });
    expect(lateInterest(s, "2026-03-31", 3)).toEqual({ daysLate: 30, interest: 3000, total: 103_000 });
    expect(lateInterest({ ...s, status: "ödendi", paidAt: "2026-03-16" }, "2026-12-31", 3)).toMatchObject({ daysLate: 15, interest: 1500 });
  });
  it("özet vadesi geçenleri ve sıradaki seneti verir", () => {
    const senets = buildSenets(quote);
    senets[0] = { ...senets[0], status: "ödendi", paidAt: "2026-02-28" };
    const sum = summarizeSenets(senets, "2026-04-15", 2);
    expect(sum).toMatchObject({ count: 61, paidCount: 1, overdueCount: 1 });
    expect(sum.next?.no).toBe(2);
    expect(sum.overdueInterest).toBeGreaterThan(0);
  });
  it("TC kimlik numarasını denetler", () => {
    expect(validTckn("")).toBe(true);
    expect(validTckn("10000000146")).toBe(true);
    expect(validTckn("10000000147")).toBe(false);
    expect(validTckn("123")).toBe(false);
  });
});

describe("Word şablonu doldurma", () => {
  const xmlOf = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["word/document.xml"]);
  it("alanları doldurur, bilinmeyeni bildirir, XML'i bozmaz", () => {
    const tpl = buildDocx([{ text: "Alıcı: {{alici_adi}} / {{ Bilinmeyen }}" }, { text: "{{odeme_plani}}" }]);
    const out = fillDocx(tpl, { alici_adi: "Ayşe <Yılmaz> & Oğlu" }, { odeme_plani: [["Sıra", "Tutar"], ["1", "100,00 TL"]] });
    const xml = xmlOf(out.bytes);
    expect(xml).toContain("Alıcı: Ayşe &lt;Yılmaz&gt; &amp; Oğlu / {{ Bilinmeyen }}");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("100,00 TL");
    expect(out.unknown).toEqual(["bilinmeyen"]);
  });
  it("Word'ün parçalara böldüğü yer tutucuyu da doldurur", () => {
    const base = unzipSync(buildDocx([{ text: "x" }]));
    const doc = strFromU8(base["word/document.xml"]).replace(
      /<w:p>[\s\S]*?<\/w:p>/,
      '<w:p><w:r><w:t>Bedel: {{satis_</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bedeli}} tutarındadır</w:t></w:r></w:p>',
    );
    const out = fillDocx(zipSync({ ...base, "word/document.xml": strToU8(doc) }), { satis_bedeli: "3.000.000,00 TL" });
    expect(xmlOf(out.bytes)).toContain("Bedel: 3.000.000,00 TL tutarındadır");
    expect(out.unknown).toEqual([]);
  });
  it("hazır şablondaki bütün alanlar tanımlıdır", async () => {
    const { CONTRACT_FIELDS, CONTRACT_TABLES } = await import("../shared/senet");
    const fields = Object.fromEntries(CONTRACT_FIELDS.map(([k]) => [k, "x"]));
    const tables = Object.fromEntries(CONTRACT_TABLES.map(([k]) => [k, [["a"]]]));
    const out = fillDocx(buildDefaultContractTemplate(), fields, tables);
    expect(out.unknown).toEqual([]);
    expect(xmlOf(out.bytes)).not.toContain("{{");
  });
  it("docx olmayan dosyayı reddeder", () => {
    expect(() => fillDocx(new Uint8Array([1, 2, 3]), {})).toThrow();
  });
});
