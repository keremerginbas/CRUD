// Gayrimenkul satış modülü — FAZ 1: proje ve bağımsız bölüm (daire) envanteri.
// Veri modeli, doğrulama şemaları ve süzme/bütçe hesapları burada durur; hem sunucu
// hem arayüz (demo modu dâhil) aynı kodu kullanır. Sonraki fazlar (ödeme planı, teklif,
// senet, prim) bu alan adlarına bağlanacağı için adlar değiştirilmemelidir.
import { z } from "zod";

export const PROJECT_STATUSES = ["satışta", "yakında", "tamamlandı"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const UNIT_STATUSES = ["müsait", "opsiyonlu", "satıldı"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export const UNIT_CURRENCIES = ["TRY", "USD", "EUR"] as const;
export type UnitCurrency = (typeof UNIT_CURRENCIES)[number];
export const PROJECT_IMAGE_KINDS = ["render", "gerçek"] as const;
export type ProjectImageKind = (typeof PROJECT_IMAGE_KINDS)[number];

/** Depodaki kayıt türleri (sahip kapsamlı). */
export const PROJECT_KIND = "re_project";
export const UNIT_KIND = "re_unit";

/** Sunucuya yüklenen görselin adresi: /api/project-images/<32 hex>.<uzantı> */
export const PROJECT_IMAGE_PATH = /^\/api\/project-images\/[a-f0-9]{32}\.(?:jpg|png|webp)$/;
export const PROJECT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const PROJECT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Kayıtta kabul edilen görsel adresi: kendi yükleme ucumuz veya https bağlantısı. */
export function isStoredImageUrl(url: string): boolean {
  if (PROJECT_IMAGE_PATH.test(url)) return true;
  if (!/^https:\/\//i.test(url) || url.length > 2048) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().datetime({ offset: true });
const idString = required(191);
const imageUrl = z.string().max(2048).refine(isStoredImageUrl, "Görsel adresi geçerli değil (yüklenen görsel veya https bağlantısı olmalı).");
const tagList = z.array(required(80)).max(60);

export const ProjectImageSchema = z.object({
  id: idString,
  url: imageUrl,
  kind: z.enum(PROJECT_IMAGE_KINDS),
  caption: text(200).default(""),
});
export type ProjectImage = z.infer<typeof ProjectImageSchema>;

export const ProjectSchema = z.object({
  id: idString,
  name: required(200),
  city: text(80).default(""),
  district: text(80).default(""),
  address: text(500).default(""),
  description: text(10000).default(""),
  status: z.enum(PROJECT_STATUSES).default("satışta"),
  /** Teslim tarihi: YYYY-AA-GG veya boş. */
  deliveryDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Teslim tarihi YYYY-AA-GG biçiminde olmalı."), z.literal("")]).default(""),
  /** Geliştirici / mal sahibi firma adı. */
  developer: text(200).default(""),
  amenities: tagList.default([]),
  images: z.array(ProjectImageSchema).max(60).default([]),
  /** Arşivlenen proje listelerde ve süzmede görünmez; kayıt ve bağlantılar korunur. */
  archived: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Project = z.infer<typeof ProjectSchema>;

const m2 = z.number().finite().min(0).max(1_000_000);
export const UnitSchema = z.object({
  id: idString,
  projectId: idString,
  block: text(40).default(""),
  floor: z.number().int().min(-20).max(300),
  unitNo: required(40),
  /** Serbest metin: "2+1", "3+1 dubleks", "dükkan"… */
  type: text(40).default(""),
  grossM2: m2.default(0),
  netM2: m2.default(0),
  facade: text(80).default(""),
  view: text(120).default(""),
  /** Liste fiyatı; 0 = fiyat henüz girilmedi. */
  listPrice: z.number().finite().min(0).max(1e13),
  currency: z.enum(UNIT_CURRENCIES).default("TRY"),
  status: z.enum(UNIT_STATUSES).default("müsait"),
  features: tagList.default([]),
  notes: text(10000).default(""),
  floorPlanImageUrl: z.union([imageUrl, z.literal("")]).default(""),
  archived: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Unit = z.infer<typeof UnitSchema>;

export interface Inventory {
  projects: Project[];
  units: Unit[];
}

// ---------------------------------------------------------------------------
// Saf yardımcılar
// ---------------------------------------------------------------------------

const fold = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");

/** Proje içinde tekillik anahtarı: (blok, daire no) — büyük/küçük harf ve boşluk farkı sayılmaz. */
export function unitKey(block: unknown, unitNo: unknown): string {
  return `${fold(block)}\u0001${fold(unitNo)}`;
}

/** m² birim fiyatı brüt m² üzerinden hesaplanır; fiyat veya m² yoksa null. */
export function pricePerM2(unit: Pick<Unit, "listPrice" | "grossM2">): number | null {
  return unit.listPrice > 0 && unit.grossM2 > 0 ? unit.listPrice / unit.grossM2 : null;
}

/** Arşivdeki projeleri, arşivdeki daireleri ve arşivdeki projelerin dairelerini ayıklar. */
export function activeInventory(projects: Project[], units: Unit[]): Inventory {
  const live = projects.filter((p) => !p.archived);
  const ids = new Set(live.map((p) => p.id));
  return { projects: live, units: units.filter((u) => !u.archived && ids.has(u.projectId)) };
}

export interface UnitFilters {
  search: string;
  /** Boş = tüm projeler. */
  projectId: string;
  city: string;
  district: string;
  /** Boş = tüm tipler. */
  types: string[];
  /** Boş = tüm durumlar. */
  statuses: UnitStatus[];
  facade: string;
  /** Bütçe alt/üst sınırı; biri doluysa yalnız `currency` ile fiyatlanmış daireler kalır. */
  priceMin: number | null;
  priceMax: number | null;
  currency: UnitCurrency;
  floorMin: number | null;
  floorMax: number | null;
  grossMin: number | null;
  grossMax: number | null;
  netMin: number | null;
  netMax: number | null;
}

export const defaultUnitFilters: UnitFilters = {
  search: "",
  projectId: "",
  city: "",
  district: "",
  types: [],
  statuses: ["müsait"],
  facade: "",
  priceMin: null,
  priceMax: null,
  currency: "TRY",
  floorMin: null,
  floorMax: null,
  grossMin: null,
  grossMax: null,
  netMin: null,
  netMax: null,
};

/** Varsayılandan farklı kaç süzgeç var? (durum: yalnız "müsait" varsayılandır) */
export function activeFilterCount(f: UnitFilters): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.projectId) n++;
  if (f.city) n++;
  if (f.district) n++;
  if (f.types.length) n++;
  if (f.facade) n++;
  if (f.priceMin != null || f.priceMax != null) n++;
  if (f.floorMin != null || f.floorMax != null) n++;
  if (f.grossMin != null || f.grossMax != null) n++;
  if (f.netMin != null || f.netMax != null) n++;
  if (!(f.statuses.length === 1 && f.statuses[0] === "müsait")) n++;
  return n;
}

// Daire nesneleri değişmez kabul edilir (her kayıtta yeni nesne oluşur); arama metni bir kez üretilir.
const haystacks = new WeakMap<Unit, string>();
function haystack(unit: Unit): string {
  let value = haystacks.get(unit);
  if (value === undefined) {
    value = fold([unit.block, unit.unitNo, unit.type, unit.facade, unit.view, unit.notes, unit.features.join(" ")].join(" "));
    haystacks.set(unit, value);
  }
  return value;
}

const inRange = (value: number, min: number | null, max: number | null) =>
  (min == null || value >= min) && (max == null || value <= max);

/**
 * Daireleri süzer. `projects` yalnız il/ilçe ve metin araması için kullanılır.
 * Tek geçişte çalışır; 5.000 dairede birkaç milisaniye sürer.
 */
export function filterUnits(units: Unit[], projects: Project[], filters: UnitFilters): Unit[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const words = fold(filters.search).split(" ").filter(Boolean);
  const types = filters.types.length ? new Set(filters.types.map(fold)) : null;
  const statuses = filters.statuses.length ? new Set<string>(filters.statuses) : null;
  const city = fold(filters.city);
  const district = fold(filters.district);
  const facade = fold(filters.facade);
  const budget = filters.priceMin != null || filters.priceMax != null;
  const projectText = new Map(words.length ? projects.map((p) => [p.id, fold(`${p.name} ${p.city} ${p.district}`)]) : []);
  return units.filter((unit) => {
    if (filters.projectId && unit.projectId !== filters.projectId) return false;
    if (statuses && !statuses.has(unit.status)) return false;
    if (types && !types.has(fold(unit.type))) return false;
    if (facade && fold(unit.facade) !== facade) return false;
    if (budget) {
      if (unit.currency !== filters.currency || unit.listPrice <= 0) return false;
      if (!inRange(unit.listPrice, filters.priceMin, filters.priceMax)) return false;
    }
    if (!inRange(unit.floor, filters.floorMin, filters.floorMax)) return false;
    if (!inRange(unit.grossM2, filters.grossMin, filters.grossMax)) return false;
    if (!inRange(unit.netM2, filters.netMin, filters.netMax)) return false;
    const project = byId.get(unit.projectId);
    if (city && fold(project?.city) !== city) return false;
    if (district && fold(project?.district) !== district) return false;
    if (words.length) {
      const hay = haystack(unit);
      const projectHay = projectText.get(unit.projectId) || "";
      for (const word of words) if (!hay.includes(word) && !projectHay.includes(word)) return false;
    }
    return true;
  });
}

export type UnitSortKey = "price" | "grossM2" | "netM2" | "floor" | "pricePerM2" | "unitNo";
export type SortDir = "asc" | "desc";

const collator = new Intl.Collator("tr", { numeric: true, sensitivity: "base" });
const currencyOrder: Record<UnitCurrency, number> = { TRY: 0, USD: 1, EUR: 2 };

/**
 * Sıralar (yeni dizi döner). Fiyat sıralamasında farklı para birimleri karıştırılmaz:
 * önce para birimine göre gruplanır. Fiyatı/m² değeri olmayanlar her yönde sona düşer.
 */
export function sortUnits(units: Unit[], key: UnitSortKey, dir: SortDir = "asc"): Unit[] {
  const sign = dir === "asc" ? 1 : -1;
  const num = (unit: Unit): number | null =>
    key === "price" ? (unit.listPrice > 0 ? unit.listPrice : null)
    : key === "pricePerM2" ? pricePerM2(unit)
    : key === "grossM2" ? unit.grossM2
    : key === "netM2" ? unit.netM2
    : unit.floor;
  const tie = (a: Unit, b: Unit) => collator.compare(a.block, b.block) || collator.compare(a.unitNo, b.unitNo);
  return units.slice().sort((a, b) => {
    if (key === "unitNo") return sign * tie(a, b);
    if ((key === "price" || key === "pricePerM2") && a.currency !== b.currency)
      return currencyOrder[a.currency] - currencyOrder[b.currency];
    const x = num(a);
    const y = num(b);
    if (x == null || y == null) return x == null && y == null ? tie(a, b) : x == null ? 1 : -1;
    return sign * (x - y) || tie(a, b);
  });
}

export interface BudgetMatch {
  /** Bütçeye eşit veya altında; bütçeye en yakın olan başta. */
  within: Unit[];
  /** Bütçenin biraz üstündeki en yakın daireler (varsayılan 3). */
  above: Unit[];
}

/** "Bütçeye göre bul": yalnız müsait ve aynı para birimiyle fiyatlanmış daireler değerlendirilir. */
export function findByBudget(units: Unit[], budget: number, currency: UnitCurrency, aboveCount = 3): BudgetMatch {
  if (!Number.isFinite(budget) || budget <= 0) return { within: [], above: [] };
  const pool = units.filter((u) => u.status === "müsait" && !u.archived && u.currency === currency && u.listPrice > 0);
  const within = pool.filter((u) => u.listPrice <= budget).sort((a, b) => b.listPrice - a.listPrice || collator.compare(a.unitNo, b.unitNo));
  const above = pool
    .filter((u) => u.listPrice > budget)
    .sort((a, b) => a.listPrice - b.listPrice || collator.compare(a.unitNo, b.unitNo))
    .slice(0, Math.max(0, aboveCount));
  return { within, above };
}

export interface PriceRange {
  currency: UnitCurrency;
  min: number;
  max: number;
  count: number;
}
export interface ProjectStats {
  total: number;
  available: number;
  optioned: number;
  sold: number;
  /** Müsait dairelerin fiyat aralığı; en çok dairesi olan para birimi başta. */
  ranges: PriceRange[];
}

/** Tüm projelerin özetini tek geçişte çıkarır (arşivdeki daireler sayılmaz). */
export function projectStatsMap(units: Unit[]): Map<string, ProjectStats> {
  const map = new Map<string, ProjectStats>();
  for (const unit of units) {
    if (unit.archived) continue;
    let stats = map.get(unit.projectId);
    if (!stats) map.set(unit.projectId, (stats = { total: 0, available: 0, optioned: 0, sold: 0, ranges: [] }));
    stats.total++;
    if (unit.status === "opsiyonlu") stats.optioned++;
    else if (unit.status === "satıldı") stats.sold++;
    else {
      stats.available++;
      if (unit.listPrice > 0) {
        let range = stats.ranges.find((r) => r.currency === unit.currency);
        if (!range) stats.ranges.push((range = { currency: unit.currency, min: unit.listPrice, max: unit.listPrice, count: 0 }));
        range.min = Math.min(range.min, unit.listPrice);
        range.max = Math.max(range.max, unit.listPrice);
        range.count++;
      }
    }
  }
  for (const stats of map.values()) stats.ranges.sort((a, b) => b.count - a.count || currencyOrder[a.currency] - currencyOrder[b.currency]);
  return map;
}
export const emptyProjectStats: ProjectStats = { total: 0, available: 0, optioned: 0, sold: 0, ranges: [] };

export interface InventoryFacets {
  types: string[];
  facades: string[];
  cities: string[];
  /** İl → ilçeler; "" anahtarı tüm ilçeleri verir. */
  districts: Record<string, string[]>;
}

/** Süzgeç seçenekleri: mevcut kayıtlardaki değerlerden üretilir. */
export function inventoryFacets(projects: Project[], units: Unit[]): InventoryFacets {
  const unique = (values: string[]) => {
    const seen = new Map<string, string>();
    for (const value of values) {
      const clean = value.trim();
      if (clean && !seen.has(fold(clean))) seen.set(fold(clean), clean);
    }
    return [...seen.values()].sort(collator.compare);
  };
  const districts: Record<string, string[]> = { "": unique(projects.map((p) => p.district)) };
  const cities = unique(projects.map((p) => p.city));
  for (const city of cities) districts[city] = unique(projects.filter((p) => fold(p.city) === fold(city)).map((p) => p.district));
  return { types: unique(units.map((u) => u.type)), facades: unique(units.map((u) => u.facade)), cities, districts };
}

const symbols: Record<UnitCurrency, string> = { TRY: "₺", USD: "$", EUR: "€" };
const group = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** 4250000, "TRY" → "₺4.250.000" (ICU'ya bağlı değildir). */
export function formatPrice(value: number, currency: UnitCurrency): string {
  return value > 0 ? `${symbols[currency]}${group(value)}` : "—";
}
/** Kart için kısa gösterim: ₺4,25 Mn · ₺850 B */
export function formatPriceShort(value: number, currency: UnitCurrency): string {
  if (value <= 0) return "—";
  const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  if (value >= 1_000_000) return `${symbols[currency]}${trim(value / 1_000_000)} Mn`;
  if (value >= 10_000) return `${symbols[currency]}${trim(value / 1_000)} B`;
  return `${symbols[currency]}${group(value)}`;
}
export function formatM2(value: number): string {
  return value > 0 ? `${String(Math.round(value * 10) / 10).replace(".", ",")} m²` : "—";
}
/** 3 → "3. kat", 0 → "Zemin kat", -1 → "1. bodrum". */
export function formatFloor(floor: number): string {
  return floor === 0 ? "Zemin kat" : floor < 0 ? `${-floor}. bodrum` : `${floor}. kat`;
}
