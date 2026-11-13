import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  activeInventory,
  defaultUnitFilters,
  filterUnits,
  findByBudget,
  formatM2,
  formatPrice,
  formatPriceShort,
  inventoryFacets,
  isStoredImageUrl,
  pricePerM2,
  projectStatsMap,
  sortUnits,
  unitKey,
  type Project,
  type Unit,
  type UnitFilters,
} from "../shared/real-estate";
import {
  chunkRows,
  mapUnitHeaders,
  parseFloor,
  parseTrNumber,
  parseUnitCurrency,
  parseUnitStatus,
  planUnitImport,
  previewUnitImport,
} from "../shared/unit-import";
import { parseDelimited } from "../shared/crm-import";

const stamp = "2026-11-01T08:00:00.000Z";
const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, name: `Proje ${id}`, city: "İstanbul", district: "Kartal", address: "", description: "", status: "satışta", deliveryDate: "",
  developer: "", amenities: [], images: [], archived: false, createdAt: stamp, updatedAt: stamp, ...extra,
});
const unit = (id: string, extra: Partial<Unit> = {}): Unit => ({
  id, projectId: "p1", block: "A", floor: 1, unitNo: id, type: "2+1", grossM2: 100, netM2: 85, facade: "Güney", view: "", listPrice: 4_000_000,
  currency: "TRY", status: "müsait", features: [], notes: "", floorPlanImageUrl: "", archived: false, createdAt: stamp, updatedAt: stamp, ...extra,
});
const projects = [project("p1"), project("p2", { name: "Deneme Kule", city: "İzmir", district: "Bayraklı" })];
const units = [
  unit("1", { type: "1+1", floor: 1, grossM2: 65, netM2: 52, listPrice: 3_000_000, facade: "Kuzey" }),
  unit("2", { floor: 3, listPrice: 4_500_000, features: ["Balkon", "Ebeveyn banyosu"] }),
  unit("3", { floor: 5, listPrice: 5_200_000, status: "opsiyonlu" }),
  unit("4", { type: "3+1", floor: 8, grossM2: 150, netM2: 125, listPrice: 7_500_000, view: "Deniz" }),
  unit("5", { type: "3+1", floor: 9, grossM2: 155, netM2: 128, listPrice: 8_000_000, status: "satıldı" }),
  unit("6", { projectId: "p2", block: "", type: "2+1", floor: 12, grossM2: 120, netM2: 98, listPrice: 300_000, currency: "USD", facade: "Batı" }),
  unit("7", { projectId: "p2", block: "", type: "1+1", floor: 2, grossM2: 70, netM2: 0, listPrice: 0, facade: "" }),
];
const f = (patch: Partial<UnitFilters>) => ({ ...defaultUnitFilters, ...patch });
const ids = (list: Unit[]) => list.map((u) => u.id);

describe("daire süzme", () => {
  it("varsayılan süzgeç yalnız müsait daireleri getirir; boş durum listesi tümünü getirir", () => {
    expect(ids(filterUnits(units, projects, defaultUnitFilters))).toEqual(["1", "2", "4", "6", "7"]);
    expect(filterUnits(units, projects, f({ statuses: [] }))).toHaveLength(7);
    expect(ids(filterUnits(units, projects, f({ statuses: ["opsiyonlu", "satıldı"] })))).toEqual(["3", "5"]);
    expect(activeFilterCount(defaultUnitFilters)).toBe(0);
    expect(activeFilterCount(f({ statuses: [], priceMax: 5, search: "x" }))).toBe(3);
  });

  it("bütçe yalnız seçilen para birimindeki fiyatlı dairelere uygulanır", () => {
    expect(ids(filterUnits(units, projects, f({ priceMin: 3_500_000, priceMax: 7_500_000 })))).toEqual(["2", "4"]);
    expect(ids(filterUnits(units, projects, f({ priceMax: 3_000_000 })))).toEqual(["1"]);
    // USD bütçe: TL daireler ve fiyatı girilmemiş daire dışarıda kalır.
    expect(ids(filterUnits(units, projects, f({ priceMax: 400_000, currency: "USD" })))).toEqual(["6"]);
    expect(filterUnits(units, projects, f({ priceMin: 1, currency: "EUR" }))).toEqual([]);
  });

  it("proje, il/ilçe, tip (çoklu), kat, m², cephe ve metin birlikte çalışır", () => {
    expect(ids(filterUnits(units, projects, f({ projectId: "p2" })))).toEqual(["6", "7"]);
    expect(ids(filterUnits(units, projects, f({ city: "izmir" })))).toEqual(["6", "7"]);
    expect(ids(filterUnits(units, projects, f({ city: "İstanbul", district: "Kartal", types: ["1+1", "3+1"] })))).toEqual(["1", "4"]);
    expect(ids(filterUnits(units, projects, f({ types: ["2+1"], statuses: [] })))).toEqual(["2", "3", "6"]);
    expect(ids(filterUnits(units, projects, f({ floorMin: 3, floorMax: 8 })))).toEqual(["2", "4"]);
    expect(ids(filterUnits(units, projects, f({ grossMin: 110 })))).toEqual(["4", "6"]);
    expect(ids(filterUnits(units, projects, f({ netMin: 90, netMax: 100 })))).toEqual(["6"]);
    expect(ids(filterUnits(units, projects, f({ facade: "güney" })))).toEqual(["2", "4"]);
    expect(ids(filterUnits(units, projects, f({ search: "DENİZ" })))).toEqual(["4"]);
    expect(ids(filterUnits(units, projects, f({ search: "balkon ebeveyn" })))).toEqual(["2"]);
    // Proje adı ve konumu da aranır; tüm sözcükler eşleşmelidir.
    expect(ids(filterUnits(units, projects, f({ search: "kule 1+1" })))).toEqual(["7"]);
    expect(ids(filterUnits(units, projects, f({ search: "bayraklı" })))).toEqual(["6", "7"]);
    expect(filterUnits(units, projects, f({ search: "yok-böyle" }))).toEqual([]);
    expect(ids(filterUnits(units, projects, f({ priceMax: 5_000_000, types: ["2+1"], floorMin: 2 })))).toEqual(["2"]);
  });

  it("5.000 dairede süzme ve sıralama hızlıdır", () => {
    const many: Unit[] = Array.from({ length: 5000 }, (_, i) =>
      unit(String(i), { projectId: i % 2 ? "p1" : "p2", floor: i % 30, type: ["1+1", "2+1", "3+1"][i % 3], listPrice: 2_000_000 + i * 1000, grossM2: 60 + (i % 120) }),
    );
    const started = performance.now();
    for (let i = 0; i < 10; i++) sortUnits(filterUnits(many, projects, f({ priceMax: 5_000_000, types: ["2+1"], floorMin: 3, floorMax: 20, search: "proje" })), "pricePerM2", "desc");
    const perRun = (performance.now() - started) / 10;
    expect(filterUnits(many, projects, f({ types: ["2+1"] })).length).toBeGreaterThan(1500);
    expect(perRun).toBeLessThan(100);
  });
});

describe("sıralama, bütçe ve özetler", () => {
  it("fiyat, m², kat ve m² fiyatına göre sıralar; değeri olmayanlar sona düşer", () => {
    const tl = units.filter((u) => u.projectId === "p1");
    expect(ids(sortUnits(tl, "price", "desc"))).toEqual(["5", "4", "3", "2", "1"]);
    expect(ids(sortUnits(tl, "grossM2", "asc")).slice(0, 2)).toEqual(["1", "2"]);
    expect(ids(sortUnits(tl, "floor", "desc"))[0]).toBe("5");
    expect(pricePerM2(units[0])).toBeCloseTo(3_000_000 / 65);
    expect(pricePerM2(units[6])).toBeNull();
    expect(ids(sortUnits(tl, "pricePerM2", "asc"))[0]).toBe("2");
    // Karışık para birimi: önce TL grubu, sonra USD; fiyatsız daire en sonda (her iki yönde).
    expect(ids(sortUnits(units, "price", "asc"))).toEqual(["1", "2", "3", "4", "5", "7", "6"]);
    const tlWithEmpty = [units[6], units[0], units[1]];
    expect(ids(sortUnits(tlWithEmpty, "price", "asc"))).toEqual(["1", "2", "7"]);
    expect(ids(sortUnits(tlWithEmpty, "price", "desc"))).toEqual(["2", "1", "7"]);
    expect(ids(sortUnits([unit("10"), unit("9"), unit("2")], "unitNo", "asc"))).toEqual(["2", "9", "10"]);
    // Girdi dizisi değişmez.
    expect(ids(units)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("bütçeye göre bul: bütçeye en yakın başta, üstündeki en yakın üç daire ayrı", () => {
    const pool = [3.0, 4.5, 4.9, 5.0, 5.1, 5.4, 6.0, 9.0].map((m, i) => unit(`b${i}`, { listPrice: m * 1_000_000 }));
    pool.push(unit("ops", { listPrice: 4_800_000, status: "opsiyonlu" }), unit("usd", { listPrice: 4_000_000, currency: "USD" }), unit("yok", { listPrice: 0 }), unit("arsiv", { listPrice: 4_700_000, archived: true }));
    const match = findByBudget(pool, 5_000_000, "TRY");
    expect(ids(match.within)).toEqual(["b3", "b2", "b1", "b0"]);
    expect(ids(match.above)).toEqual(["b4", "b5", "b6"]);
    expect(ids(findByBudget(pool, 5_000_000, "TRY", 1).above)).toEqual(["b4"]);
    expect(ids(findByBudget(pool, 4_500_000, "USD").within)).toEqual(["usd"]);
    expect(findByBudget(pool, 1_000_000, "TRY")).toMatchObject({ within: [] });
    expect(ids(findByBudget(pool, 1_000_000, "TRY").above)).toEqual(["b0", "b1", "b2"]);
    expect(findByBudget(pool, 0, "TRY")).toEqual({ within: [], above: [] });
    expect(findByBudget(pool, Number.NaN, "TRY")).toEqual({ within: [], above: [] });
  });

  it("proje özeti müsait daire sayısını ve fiyat aralığını para birimine göre verir", () => {
    const stats = projectStatsMap([...units, unit("a", { archived: true, listPrice: 1 })]);
    expect(stats.get("p1")).toEqual({ total: 5, available: 3, optioned: 1, sold: 1, ranges: [{ currency: "TRY", min: 3_000_000, max: 7_500_000, count: 3 }] });
    expect(stats.get("p2")).toMatchObject({ total: 2, available: 2, ranges: [{ currency: "USD", min: 300_000, max: 300_000, count: 1 }] });
    const facets = inventoryFacets(projects, units);
    expect(facets.types).toEqual(["1+1", "2+1", "3+1"]);
    expect(facets.cities).toEqual(["İstanbul", "İzmir"]);
    expect(facets.districts["İzmir"]).toEqual(["Bayraklı"]);
    expect(facets.facades).toEqual(["Batı", "Güney", "Kuzey"]);
    const live = activeInventory([projects[0], { ...projects[1], archived: true }], [...units, unit("a", { archived: true })]);
    expect(live.projects).toHaveLength(1);
    expect(ids(live.units)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("anahtar, biçimlendirme ve görsel adresi yardımcıları", () => {
    expect(unitKey(" a ", "12")).toBe(unitKey("A", " 12"));
    expect(unitKey("A", "I1")).toBe(unitKey("a", "ı1"));
    expect(unitKey("A", "12")).not.toBe(unitKey("B", "12"));
    expect(unitKey("", "A12")).not.toBe(unitKey("A", "12"));
    expect(formatPrice(4_250_000, "TRY")).toBe("₺4.250.000");
    expect(formatPrice(0, "USD")).toBe("—");
    expect(formatPriceShort(4_250_000, "TRY")).toBe("₺4,25 Mn");
    expect(formatPriceShort(185_000, "USD")).toBe("$185 B");
    expect(formatM2(92.5)).toBe("92,5 m²");
    expect(isStoredImageUrl(`/api/project-images/${"a".repeat(32)}.webp`)).toBe(true);
    expect(isStoredImageUrl("https://ornek.example/a.jpg")).toBe(true);
    for (const bad of ["http://ornek.example/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", `/api/project-images/../${"a".repeat(32)}.png`, `/api/project-images/${"a".repeat(32)}.svg`, "blob:https://x/1", ""])
      expect([bad, isStoredImageUrl(bad)]).toEqual([bad, false]);
  });
});

describe("daire içe aktarma", () => {
  it("Türkçe başlıkları kendiliğinden eşler", () => {
    expect(mapUnitHeaders(["Blok", "Kat", "No", "Tip", "Brüt m2", "Net m2", "Cephe", "Fiyat", "Para Birimi", "Durum"])).toEqual([
      "block", "floor", "unitNo", "type", "grossM2", "netM2", "facade", "listPrice", "currency", "status",
    ]);
    expect(mapUnitHeaders(["BLOK", " Daire No ", "BRÜT M²", "Net (m2)", "Liste Fiyatı", "Döviz", "Manzara", "Sıra", "Notlar"])).toEqual([
      "block", "unitNo", "grossM2", "netM2", "listPrice", "currency", "view", null, "notes",
    ]);
    // Aynı alana giden ikinci sütun eşlenmez.
    expect(mapUnitHeaders(["No", "Daire No", "Fiyat", "Satış Fiyatı"])).toEqual(["unitNo", null, "listPrice", null]);
  });

  it("sayı, kat, para birimi ve durum değerlerini okur", () => {
    expect(parseTrNumber("4.250.000", "price")).toBe(4_250_000);
    expect(parseTrNumber("4.250.000,50 TL", "price")).toBe(4_250_000.5);
    expect(parseTrNumber("4,250,000.50", "price")).toBe(4_250_000.5);
    expect(parseTrNumber("₺ 3 100 000", "price")).toBe(3_100_000);
    expect(parseTrNumber("850.000", "price")).toBe(850_000);
    expect(parseTrNumber("4250000.5", "price")).toBe(4_250_000.5);
    expect(parseTrNumber("125,5")).toBe(125.5);
    expect(parseTrNumber("125.5")).toBe(125.5);
    expect(parseTrNumber("92.500")).toBe(92.5);
    expect(parseTrNumber("1.250.000")).toBe(1_250_000);
    expect(parseTrNumber("110 m²")).toBe(110);
    expect(parseTrNumber("110,5 m2")).toBe(110.5);
    expect(parseTrNumber("abc")).toBeNull();
    expect(parseTrNumber("")).toBeNull();
    expect(parseTrNumber("1.2.3,4,5")).toBeNull();
    expect([parseFloor("3"), parseFloor("3. Kat"), parseFloor("Zemin"), parseFloor("Bodrum"), parseFloor("-2"), parseFloor("12.0"), parseFloor("çatı"), parseFloor("2,5")]).toEqual([3, 3, 0, -1, -2, 12, null, null]);
    expect([parseUnitCurrency("TL"), parseUnitCurrency("₺"), parseUnitCurrency("usd"), parseUnitCurrency("Euro"), parseUnitCurrency("GBP")]).toEqual(["TRY", "TRY", "USD", "EUR", null]);
    expect([parseUnitStatus("Müsait"), parseUnitStatus("SATILDI"), parseUnitStatus("Opsiyon"), parseUnitStatus("rezerve"), parseUnitStatus("kiralık")]).toEqual(["müsait", "satıldı", "opsiyonlu", "opsiyonlu", null]);
  });

  it("önizleme satır hatalarını ve projedeki yinelemeleri gösterir; plan seçime göre değişir", () => {
    const csv = [
      "Blok;Kat;No;Tip;Brüt m2;Net m2;Cephe;Fiyat;Para Birimi;Durum",
      "A;1;1;1+1;68;55;Kuzey;3.150.000;TL;Müsait",
      "A;2;5;2+1;105,5;88;Güney;4.650.000;TL;Opsiyonlu",
      "a;;12;;;;;5.000.000;;",
      "B;Zemin;3;2+1;112;93;Doğu;;TL;Müsait",
      "B;x;4;2+1;112;93;Doğu;abc;GBP;kiralık",
      "B;3;;3+1;140;118;Batı;6.600.000;TL;Satıldı",
      "A;2;5;2+1;105;88;Güney;4.700.000;TL;Müsait",
      "C;4;9;3+1;150;120;Batı;185.000;USD;",
    ].join("\n");
    const table = parseDelimited(csv);
    const mapping = mapUnitHeaders(table.headers);
    const existing = [{ id: "u-eski", block: "A", unitNo: "12" }];
    const preview = previewUnitImport(table, mapping, existing);
    expect(preview).toMatchObject({ total: 8, valid: 4, invalid: 4, fresh: 3, duplicates: 1 });
    expect(preview.rows[0]).toMatchObject({ rowNumber: 2, errors: [], existingId: "", values: { block: "A", floor: 1, unitNo: "1", type: "1+1", grossM2: 68, netM2: 55, facade: "Kuzey", listPrice: 3_150_000, currency: "TRY", status: "müsait" } });
    expect(preview.rows[1].values).toMatchObject({ grossM2: 105.5, status: "opsiyonlu" });
    // Projede olan daire: kat ve tip boş olsa da geçerlidir (yalnız dolu alanlar gider).
    expect(preview.rows[2]).toMatchObject({ existingId: "u-eski", errors: [], values: { block: "a", unitNo: "12", listPrice: 5_000_000 } });
    expect(Object.keys(preview.rows[2].values).sort()).toEqual(["block", "listPrice", "unitNo"]);
    expect(preview.rows[3].errors).toEqual(["Fiyat boş (yeni daire için zorunlu)."]);
    expect(preview.rows[4].errors).toHaveLength(4);
    expect(preview.rows[5].errors[0]).toBe("Daire No boş.");
    expect(preview.rows[6].errors).toEqual(["Aynı blok + daire no dosyada 3. satırda da var."]);
    expect(preview.rows[7]).toMatchObject({ errors: [], values: { currency: "USD", listPrice: 185_000 } });
    expect(preview.rows[7].values.status).toBeUndefined();

    const update = planUnitImport(preview, "update");
    expect(update).toMatchObject({ create: 3, update: 1, skipped: 0, invalid: 4 });
    expect(update.rows.map((r) => r.unitNo)).toEqual(["1", "5", "12", "9"]);
    const skip = planUnitImport(preview, "skip");
    expect(skip).toMatchObject({ create: 3, update: 0, skipped: 1, invalid: 4 });
    expect(skip.rows.map((r) => r.unitNo)).toEqual(["1", "5", "9"]);

    // Daire No sütunu hiç eşlenmediyse her satır aynı açık hatayı alır.
    const unmapped = previewUnitImport(table, mapping.map((m) => (m === "unitNo" ? null : m)), []);
    expect(unmapped.valid).toBe(0);
    expect(unmapped.rows[0].errors[0]).toBe("Daire No sütunu eşlenmedi.");
  });

  it("5.000 satır 500'lük isteklere bölünür", () => {
    const chunks = chunkRows(Array.from({ length: 5000 }, (_, i) => i));
    expect(chunks).toHaveLength(10);
    expect(chunks.every((c) => c.length === 500)).toBe(true);
    expect(chunkRows([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });
});
