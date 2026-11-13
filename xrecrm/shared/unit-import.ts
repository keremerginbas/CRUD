// Daire (bağımsız bölüm) toplu içe aktarma: başlık eşleme, satır doğrulama, yineleme planı.
// Dosya okuma (CSV / Excel) müşteri içe aktarmasındaki ayrıştırıcıları kullanır;
// buradaki kod yalnız daire alanlarına özgüdür ve müşteri içe aktarmasına dokunmaz.
import { normalizeHeader } from "./crm-import";
import { UNIT_CURRENCIES, UNIT_STATUSES, unitKey, type Unit, type UnitCurrency, type UnitStatus } from "./real-estate";

export const UNIT_IMPORT_MAX_ROWS = 5_000;
/** Sunucuya tek istekte gönderilen satır sayısı. */
export const UNIT_IMPORT_CHUNK = 500;
export const UNIT_IMPORT_MAX_COLUMNS = 40;

export const unitImportFields = [
  "block", "floor", "unitNo", "type", "grossM2", "netM2", "facade", "view", "listPrice", "currency", "status", "features", "notes",
] as const;
export type UnitImportField = (typeof unitImportFields)[number];

export const unitImportLabels: Record<UnitImportField, string> = {
  block: "Blok",
  floor: "Kat",
  unitNo: "Daire No",
  type: "Tip",
  grossM2: "Brüt m²",
  netM2: "Net m²",
  facade: "Cephe",
  view: "Manzara",
  listPrice: "Fiyat",
  currency: "Para Birimi",
  status: "Durum",
  features: "Özellikler",
  notes: "Notlar",
};

const aliases: Record<UnitImportField, string[]> = {
  block: ["blok", "blok adı", "blok no", "block", "bina"],
  floor: ["kat", "kat no", "bulunduğu kat", "floor"],
  unitNo: ["no", "daire no", "daire", "bağımsız bölüm", "bağımsız bölüm no", "bb no", "bb", "kapı no", "ünite no", "ünite", "unit", "unit no", "numara"],
  type: ["tip", "daire tipi", "oda sayısı", "oda", "type", "tipi"],
  grossM2: ["brüt m2", "brüt m²", "brüt", "brüt alan", "brüt metrekare", "brut m2", "brut", "gross m2", "gross"],
  netM2: ["net m2", "net m²", "net", "net alan", "net metrekare", "net m2 alan"],
  facade: ["cephe", "yön", "cephe yön", "cephe/yön", "facade", "direction"],
  view: ["manzara", "view"],
  listPrice: ["fiyat", "liste fiyatı", "satış fiyatı", "peşin fiyat", "tutar", "bedel", "price", "list price"],
  currency: ["para birimi", "döviz", "döviz cinsi", "kur", "birim", "currency"],
  status: ["durum", "statü", "satış durumu", "status"],
  features: ["özellikler", "özellik", "features"],
  notes: ["not", "notlar", "açıklama", "notes"],
};
const aliasToField = new Map<string, UnitImportField>();
for (const field of unitImportFields) for (const alias of aliases[field]) aliasToField.set(headerKey(alias), field);

function headerKey(raw: unknown): string {
  // "Brüt m2", "BRÜT M²", "Brüt (m2)" → aynı anahtar
  return normalizeHeader(raw).replace(/²/g, "2").replace(/[()\[\]:]/g, " ").replace(/\s+/g, " ").trim();
}

/** Başlıkları daire alanlarına eşler; tanınmayan sütun null olur. Bir alan yalnız ilk eşleşen sütuna bağlanır. */
export function mapUnitHeaders(headers: string[]): (UnitImportField | null)[] {
  const used = new Set<UnitImportField>();
  return headers.map((header) => {
    const field = aliasToField.get(headerKey(header)) || null;
    if (!field || used.has(field)) return null;
    used.add(field);
    return field;
  });
}

/**
 * Türkçe yazımlı sayıyı okur: "4.250.000", "4.250.000,50", "4,250,000.50", "125,5", "₺ 3.100.000 TL".
 * Tek noktalı "125.500" belirsizdir: fiyatta binlik ayırıcı, ölçüde (m²) ondalık sayılır.
 */
export function parseTrNumber(raw: unknown, kind: "price" | "measure" = "measure"): number | null {
  // "110 m2" içindeki birim rakamı sayıya karışmasın.
  let value = String(raw ?? "").replace(/m\s*[2²]/gi, "").replace(/[^\d.,-]/g, "");
  if (!value || !/\d/.test(value)) return null;
  const negative = value.startsWith("-");
  value = value.replace(/-/g, "");
  const lastDot = value.lastIndexOf(".");
  const lastComma = value.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    value = value.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    value = /^\d{1,3}(,\d{3})+$/.test(value) && (kind === "price" || value.split(",").length > 2) ? value.split(",").join("") : value.replace(",", ".");
  } else if (lastDot >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(value) && (kind === "price" || value.split(".").length > 2)) value = value.split(".").join("");
  }
  if ((value.match(/\./g) || []).length > 1) return null;
  const number = Number(value);
  return Number.isFinite(number) ? (negative ? -number : number) : null;
}

const lower = (raw: unknown) => String(raw ?? "").trim().toLocaleLowerCase("tr-TR");

export function parseUnitCurrency(raw: unknown): UnitCurrency | null {
  const value = lower(raw);
  if (!value) return null;
  if (["try", "tl", "₺", "türk lirası", "lira"].includes(value)) return "TRY";
  if (["usd", "$", "dolar", "abd doları", "us$"].includes(value)) return "USD";
  if (["eur", "€", "euro", "avro"].includes(value)) return "EUR";
  return (UNIT_CURRENCIES as readonly string[]).includes(value.toUpperCase()) ? (value.toUpperCase() as UnitCurrency) : null;
}

export function parseUnitStatus(raw: unknown): UnitStatus | null {
  const value = lower(raw);
  if (!value) return null;
  if (["müsait", "musait", "boş", "bos", "satışta", "satılık", "uygun", "available", "stok"].includes(value)) return "müsait";
  if (["opsiyonlu", "opsiyon", "rezerve", "rezervasyon", "kaparolu", "ön satış", "reserved", "option"].includes(value)) return "opsiyonlu";
  if (["satıldı", "satildi", "satılmış", "satış", "sold"].includes(value)) return "satıldı";
  return (UNIT_STATUSES as readonly string[]).includes(value) ? (value as UnitStatus) : null;
}

/** "3", "3. kat", "Zemin", "Bodrum", "-1" → kat numarası. */
export function parseFloor(raw: unknown): number | null {
  const value = lower(raw);
  if (!value) return null;
  if (/^(zemin|giriş|giris|bahçe)( kat[ıi]?)?$/.test(value)) return 0;
  if (/^bodrum( kat)?$/.test(value)) return -1;
  const match = /^(-?\d{1,3})(?:[.,]0+)?\s*(?:\.?\s*kat)?$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** İçe aktarmada bir satırdan okunan alanlar (yalnız eşlenen ve dolu olanlar yer alır). */
export type UnitImportValues = Partial<
  Pick<Unit, "block" | "floor" | "unitNo" | "type" | "grossM2" | "netM2" | "facade" | "view" | "listPrice" | "currency" | "status" | "features" | "notes">
>;

export interface UnitImportRow {
  /** Dosyadaki satır numarası (başlık 1. satırdır). */
  rowNumber: number;
  values: UnitImportValues;
  errors: string[];
  /** Projede aynı blok + no ile kayıt varsa onun kimliği. */
  existingId: string;
}
export interface UnitImportPreview {
  rows: UnitImportRow[];
  total: number;
  valid: number;
  invalid: number;
  /** Geçerli satırlardan projede karşılığı olmayanlar. */
  fresh: number;
  /** Geçerli satırlardan projede aynı blok + no ile kayıtlı olanlar. */
  duplicates: number;
}

/** Bir satırı alanlara çevirir ve doğrular (yineleme denetimi hariç). */
export function parseUnitRow(
  cells: string[],
  mapping: (UnitImportField | null)[],
): { values: UnitImportValues; errors: string[]; filled: Set<UnitImportField> } {
  const values: UnitImportValues = {};
  const errors: string[] = [];
  /** Dosyada dolu gelen alanlar (okunamamış olsalar da): "boş" uyarısı bunlar için yinelenmez. */
  const filled = new Set<UnitImportField>();
  mapping.forEach((field, index) => {
    if (!field) return;
    const raw = String(cells[index] ?? "").trim();
    if (!raw) return;
    filled.add(field);
    const label = unitImportLabels[field];
    if (field === "floor") {
      const floor = parseFloor(raw);
      if (floor == null || floor < -20 || floor > 300) errors.push(`${label}: "${raw}" kat numarası olarak okunamadı.`);
      else values.floor = floor;
    } else if (field === "grossM2" || field === "netM2" || field === "listPrice") {
      const number = parseTrNumber(raw, field === "listPrice" ? "price" : "measure");
      if (number == null || number < 0) errors.push(`${label}: "${raw}" geçerli bir sayı değil.`);
      else values[field] = number;
    } else if (field === "currency") {
      const currency = parseUnitCurrency(raw);
      if (!currency) errors.push(`${label}: "${raw}" tanınmıyor (TRY, USD veya EUR).`);
      else values.currency = currency;
    } else if (field === "status") {
      const status = parseUnitStatus(raw);
      if (!status) errors.push(`${label}: "${raw}" tanınmıyor (müsait, opsiyonlu veya satıldı).`);
      else values.status = status;
    } else if (field === "features") {
      values.features = raw.split(/[,;|]/).map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 60);
    } else {
      const max = field === "notes" ? 10000 : field === "view" ? 120 : field === "facade" ? 80 : 40;
      if (raw.length > max) errors.push(`${label}: en çok ${max} karakter olabilir.`);
      else values[field] = raw;
    }
  });
  return { values, errors, filled };
}

/**
 * Önizleme: her satır için okunan değerler, hatalar ve projedeki karşılığı.
 * Yeni daire için Daire No, Kat ve Fiyat zorunludur; mevcut daire güncellenirken yalnız Daire No yeterlidir.
 */
export function previewUnitImport(
  table: { headers: string[]; rows: string[][] },
  mapping: (UnitImportField | null)[],
  existing: Pick<Unit, "id" | "block" | "unitNo">[],
): UnitImportPreview {
  const byKey = new Map(existing.map((unit) => [unitKey(unit.block, unit.unitNo), unit.id]));
  const seen = new Map<string, number>();
  const hasUnitNo = mapping.includes("unitNo");
  const rows: UnitImportRow[] = table.rows.map((cells, index) => {
    const rowNumber = index + 2;
    const { values, errors, filled } = parseUnitRow(cells, mapping);
    let existingId = "";
    if (!values.unitNo) errors.unshift(hasUnitNo ? "Daire No boş." : "Daire No sütunu eşlenmedi.");
    else {
      const key = unitKey(values.block, values.unitNo);
      const first = seen.get(key);
      if (first) errors.push(`Aynı blok + daire no dosyada ${first}. satırda da var.`);
      else seen.set(key, rowNumber);
      existingId = byKey.get(key) || "";
      if (!existingId) {
        if (!filled.has("floor")) errors.push("Kat boş (yeni daire için zorunlu).");
        if (!filled.has("listPrice")) errors.push("Fiyat boş (yeni daire için zorunlu).");
      }
    }
    return { rowNumber, values, errors, existingId };
  });
  const valid = rows.filter((row) => !row.errors.length);
  const duplicates = valid.filter((row) => row.existingId).length;
  return { rows, total: rows.length, valid: valid.length, invalid: rows.length - valid.length, fresh: valid.length - duplicates, duplicates };
}

export type DuplicateMode = "update" | "skip";
export interface UnitImportPlan {
  /** Sunucuya gönderilecek satırlar (yeni + güncellenecek). */
  rows: UnitImportValues[];
  create: number;
  update: number;
  skipped: number;
  invalid: number;
}

/** Kullanıcının yineleme seçimine göre gönderilecek satırları belirler; hatalı satırlar hiç gönderilmez. */
export function planUnitImport(preview: UnitImportPreview, mode: DuplicateMode): UnitImportPlan {
  const rows: UnitImportValues[] = [];
  let create = 0;
  let update = 0;
  let skipped = 0;
  for (const row of preview.rows) {
    if (row.errors.length) continue;
    if (row.existingId) {
      if (mode === "skip") {
        skipped++;
        continue;
      }
      update++;
    } else create++;
    rows.push(row.values);
  }
  return { rows, create, update, skipped, invalid: preview.invalid };
}

/** Gönderilecek satırları sunucu isteklerine böler. */
export function chunkRows<T>(rows: T[], size = UNIT_IMPORT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
