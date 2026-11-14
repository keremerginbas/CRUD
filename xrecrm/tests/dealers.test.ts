import { describe, expect, it } from "vitest";
import { DealerError, addDaysIso, canSeeRegistration, phoneKey, registerCustomer, settleRegistration, type Dealer } from "../shared/dealers";

const dealer = (id: string, main = false): Dealer => ({ id, name: `${id} Bayi`, main, active: true, members: [], phone: "", note: "" });
const A = dealer("A", true);
const D = dealer("D");
const E = dealer("E");
const input = (d: Dealer, today: string, phone = "+90 (555) 111 22 33") => ({
  lead: { id: "l1", name: "Ali Veli", phone },
  project: { id: "p1", name: "Örnek Konutları" },
  dealer: d,
  byName: "Danışman",
  today,
  now: `${today}T09:00:00.000Z`,
  protectionDays: 60,
});

describe("bayi müşteri kaydı", () => {
  it("telefonu farklı yazımlarda aynı tanır", () => {
    expect(phoneKey("+90 (555) 111 22 33")).toBe("5551112233");
    expect(phoneKey("0555 111 22 33")).toBe("5551112233");
    expect(phoneKey("5551112233")).toBe("5551112233");
    expect(phoneKey("123")).toBe("");
  });
  it("D kaydeder; 60 gün boyunca E aynı müşteriyi aynı projeye kaydedemez", () => {
    const reg = registerCustomer(null, input(D, "2026-01-01"));
    expect(reg).toMatchObject({ dealerId: "D", status: "aktif", protectedUntil: "2026-03-02", id: "p1:5551112233" });
    const day30 = settleRegistration(reg, "2026-01-31", A, false, "x");
    expect(day30.status).toBe("aktif");
    expect(() => registerCustomer(day30, input(E, "2026-01-31", "0555 111 22 33"))).toThrow(/daha önce kayıtlı/);
    expect(() => registerCustomer(day30, input(D, "2026-01-31"))).toThrow(/zaten bayinizde kayıtlı/);
  });
  it("60 gün sonunda satış yoksa kayıt ana bayiye geçer; diğerleri bir daha kaydedemez", () => {
    const reg = registerCustomer(null, input(D, "2026-01-01"));
    expect(settleRegistration(reg, "2026-03-02", A, false, "x").status).toBe("aktif");
    const after = settleRegistration(reg, "2026-03-03", A, false, "2026-03-03T00:00:00Z");
    expect(after).toMatchObject({ status: "ana bayiye devredildi", dealerId: "A", originalDealerId: "D" });
    for (const d of [D, E]) expect(() => registerCustomer(after, input(d, "2026-06-01"))).toThrow(DealerError);
    expect(() => registerCustomer(after, input(E, "2026-06-01"))).toThrow(/ana bayiye devredildi/);
  });
  it("satış yapılan kayıt devredilmez ve yeniden kaydedilemez", () => {
    const reg = registerCustomer(null, input(D, "2026-01-01"));
    const sold = settleRegistration(reg, "2026-05-01", A, true, "2026-02-01T00:00:00Z");
    expect(sold).toMatchObject({ status: "satıldı", dealerId: "D" });
    expect(settleRegistration(sold, "2027-01-01", A, false, "x")).toBe(sold);
    expect(() => registerCustomer(sold, input(E, "2026-06-01"))).toThrow(/satış yapılmış/);
  });
  it("telefonsuz müşteri kaydedilmez; farklı proje ayrı kayıttır", () => {
    expect(() => registerCustomer(null, input(D, "2026-01-01", ""))).toThrow(/telefon/);
    const other = registerCustomer(null, { ...input(E, "2026-01-01"), project: { id: "p2", name: "Başka Proje" } });
    expect(other.id).toBe("p2:5551112233");
    expect(addDaysIso("2026-12-15", 60)).toBe("2027-02-13");
  });
  it("bayi yalnız kendi kaydını görür; ana bayi ve yönetici hepsini görür", () => {
    const reg = registerCustomer(null, input(D, "2026-01-01"));
    expect(canSeeRegistration(reg, { manager: false, dealerId: "E", mainDealerId: "A" })).toBe(false);
    expect(canSeeRegistration(reg, { manager: false, dealerId: "D", mainDealerId: "A" })).toBe(true);
    expect(canSeeRegistration(reg, { manager: false, dealerId: "A", mainDealerId: "A" })).toBe(true);
    expect(canSeeRegistration(reg, { manager: true, dealerId: null, mainDealerId: "A" })).toBe(true);
  });
});
