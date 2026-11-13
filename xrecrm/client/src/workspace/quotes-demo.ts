// Demo modu için örnek teklifler ve oranlar. Adlar kurgusaldır; gerçek firma veya kişi içermez.
// Kayıtlar gerçek akışla aynı saf işlevlerle (shared/quotes.ts) üretilir.
import type { Inventory, Unit } from "../../../shared/real-estate";
import { QuoteSettingsSchema, createQuote, transitionQuote, type Quote, type QuoteActor, type QuoteDraft, type QuoteSettings } from "../../../shared/quotes";

export const DEMO_MANAGER: QuoteActor = { openId: "demo-manager", name: "Demo Yönetici", manager: true };
export const DEMO_EMPLOYEE: QuoteActor = { openId: "demo-employee", name: "Demo Danışman", manager: false };
const DEMO_COLLEAGUE: QuoteActor = { openId: "demo-employee-2", name: "Zeynep Örnek", manager: false };

export function demoQuoteSettings(): QuoteSettings {
  return {
    ...QuoteSettingsSchema.parse({
      // 3.000.000 TL × %1,1111… × 60 ay = 2.000.000 TL vade farkı (müşteriyle teyit edilen örnek).
      vadeFarkiMonthlyPct: 1.1111111111,
      discountMonthlyPct: 2.5,
      commissionPct: 2,
      maxMonths: 120,
      minDownPaymentPct: 10,
      quoteValidDays: 7,
      optionOnApproval: true,
      companyName: "Örnek Yapı Gayrimenkul A.Ş.",
      companyAddress: "Örnek Mah. Vadi Cad. No: 10, Kartal / İstanbul",
      companyPhone: "0 (216) 555 00 00",
    }),
    updatedAt: new Date().toISOString(),
    updatedBy: DEMO_MANAGER.name,
  };
}

export function makeQuotesDemo(inventory: Inventory, leads: { id: string; name: string; phone?: string }[]): Quote[] {
  const settings = demoQuoteSettings();
  const day = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number, hour = 10) => {
    const date = new Date(Date.now() - daysAgo * day);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const lead = (index: number) => leads[index % Math.max(1, leads.length)] || { id: "demo-lead", name: "Örnek Müşteri", phone: "" };
  const quotes: Quote[] = [];
  const make = (unitId: string, leadIndex: number, actor: QuoteActor, daysAgo: number, input: Omit<QuoteDraft, "unitId" | "leadId" | "startDate" | "balloons" | "note"> & { balloons?: QuoteDraft["balloons"]; note?: string }) => {
    const found = inventory.units.find((u) => u.id === unitId);
    if (!found) return null;
    // Örnek kayıt üretimi dairenin bugünkü durumuna takılmasın (satılmış dairenin geçmiş teklifi gibi).
    const unit: Unit = { ...found, status: "müsait" };
    const now = at(daysAgo);
    const quote = createQuote(
      { unitId, leadId: lead(leadIndex).id, startDate: now.slice(0, 10), balloons: [], note: "", ...input },
      { settings, unit, project: inventory.projects.find((p) => p.id === unit.projectId), lead: lead(leadIndex), actor, now },
      { id: `demo-quote-${quotes.length + 1}`, quoteNo: `T-${now.slice(0, 4)}-${String(quotes.length + 1).padStart(4, "0")}` },
    );
    quotes.push(quote);
    return quotes.length - 1;
  };
  const move = (index: number | null, ...steps: [Parameters<typeof transitionQuote>[1], QuoteActor, number, Parameters<typeof transitionQuote>[4]?][]) => {
    if (index == null) return;
    for (const [action, actor, daysAgo, extra] of steps) quotes[index] = transitionQuote(quotes[index], action, actor, at(daysAgo, 12), { validDays: 60, ...extra });
  };
  // Satışa dönmüş (geçen ay), onaylı, onay bekleyen ve fiyat nedeniyle reddedilmiş birer örnek.
  move(make("demo-unit-6", 2, DEMO_COLLEAGUE, 40, { salePrice: 6_450_000, downPayment: 2_000_000, months: 36 }), ["submit", DEMO_COLLEAGUE, 40], ["approve", DEMO_MANAGER, 39], ["send", DEMO_COLLEAGUE, 38], ["sell", DEMO_COLLEAGUE, 33]);
  move(make("demo-unit-3", 1, DEMO_EMPLOYEE, 3, { salePrice: 4_950_000, downPayment: 1_500_000, months: 24, balloons: [{ month: 12, amount: 500_000 }] }), ["submit", DEMO_EMPLOYEE, 3], ["approve", DEMO_MANAGER, 2, { note: "Liste fiyatından; uygundur.", validDays: 9 }]);
  move(make("demo-unit-2", 0, DEMO_EMPLOYEE, 1, { salePrice: 4_500_000, downPayment: 1_500_000, months: 36, note: "Müşteri hızlı karar verecek; %3 iskonto talep etti." }), ["submit", DEMO_EMPLOYEE, 1]);
  move(make("demo-unit-4", 3, DEMO_EMPLOYEE, 5, { salePrice: 6_200_000, downPayment: 1_000_000, months: 60 }), ["submit", DEMO_EMPLOYEE, 5], ["reject", DEMO_MANAGER, 4, { reason: "fiyat", note: "Bu fiyata ve bu vadeyle satamayız." }]);
  move(make("demo-unit-9", 4, DEMO_COLLEAGUE, 12, { salePrice: 290_000, downPayment: 120_000, months: 18 }), ["submit", DEMO_COLLEAGUE, 12]);
  return quotes;
}
