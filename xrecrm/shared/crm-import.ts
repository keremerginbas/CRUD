export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 1_000;
export const IMPORT_MAX_COLUMNS = 32;

export const importKinds = ["contacts", "companies", "leads"] as const;
export type CrmImportKind = (typeof importKinds)[number];
export type ImportField =
  | "name"
  | "phone"
  | "email"
  | "companyId"
  | "companyName"
  | "contactId"
  | "city"
  | "source"
  | "notes";

export type ImportRawRow = Partial<Record<ImportField, string>> &
  Record<string, unknown>;

export interface ParsedDelimitedFile {
  delimiter: "," | ";" | "\t";
  headers: string[];
  rows: string[][];
}

export interface ImportIssue {
  code: string;
  message: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  raw: ImportRawRow;
  status: "ready" | "duplicate" | "error";
  issues: ImportIssue[];
  candidateId?: string;
  candidateIds?: string[];
  /** True when a duplicate was found outside the actor's permitted records. */
  unavailable?: boolean;
}

export interface ImportPreview {
  kind: CrmImportKind;
  rows: ImportPreviewRow[];
  counts: { total: number; ready: number; duplicate: number; error: number };
}

export interface ExistingImportRecord {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  companyId?: string;
}

export interface ImportVisibleState {
  contacts?: ExistingImportRecord[];
  companies?: ExistingImportRecord[];
  leads?: ExistingImportRecord[];
}

export class ImportParseError extends Error {
  readonly code: string;
  readonly rowNumber?: number;
  constructor(code: string, message: string, rowNumber?: number) {
    super(message);
    this.name = "ImportParseError";
    this.code = code;
    this.rowNumber = rowNumber;
  }
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== "undefined")
    return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

/** The same phone key as server/security.ts, kept dependency-free for the browser. */
export function normalizePhone(raw: unknown): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11)
    digits = `90${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("5")) digits = `90${digits}`;
  return digits;
}

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLocaleLowerCase("en-US");
}

export function normalizeName(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");
}

export function normalizeHeader(raw: unknown): string {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

const aliases: Record<ImportField, string[]> = {
  name: [
    "name",
    "müşteri",
    "musteri",
    "full name",
    "ad",
    "ad soyad",
    "isim",
    "kişi",
    "kişi adı",
    "contact name",
    "company name",
    "şirket adı",
    "şirket",
  ],
  phone: ["phone", "telefon", "tel", "telephone", "gsm", "mobile", "cep"],
  email: ["email", "e mail", "e posta", "e-posta", "mail", "eposta"],
  companyId: [
    "companyid",
    "company id",
    "şirket id",
    "sirket id",
    "company_id",
  ],
  companyName: [
    "companyname",
    "company name",
    "company",
    "şirket adı",
    "şirket",
    "sirket adi",
    "sirket",
  ],
  contactId: ["contactid", "contact id", "kişi id", "kisi id", "contact_id"],
  city: ["city", "şehir", "sehir", "il", "location"],
  source: ["source", "kaynak", "lead source", "channel", "kanal"],
  notes: [
    "notes",
    "note",
    "not",
    "notlar",
    "açıklama",
    "aciklama",
    "description",
  ],
};
const aliasToField = new Map<string, ImportField>();
for (const [field, names] of Object.entries(aliases) as [
  ImportField,
  string[],
][]) {
  for (const name of names) aliasToField.set(normalizeHeader(name), field);
}

function delimiterCounts(text: string): Record<"," | ";" | "\t", number> {
  const counts = { ",": 0, ";": 0, "\t": 0 } as Record<
    "," | ";" | "\t",
    number
  >;
  let quoted = false;
  for (let i = 0; i < Math.min(text.length, 64_000); i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === ";" || char === "\t")) {
      counts[char]++;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      break;
    }
  }
  return counts;
}

export function detectDelimiter(
  text: string,
): ParsedDelimitedFile["delimiter"] {
  const counts = delimiterCounts(text.replace(/^\uFEFF/, ""));
  if (
    counts["\t"] >= counts[","] &&
    counts["\t"] >= counts[";"] &&
    counts["\t"] > 0
  )
    return "\t";
  if (counts[";"] > counts[","] && counts[";"] > 0) return ";";
  return ",";
}

/**
 * RFC-4180-ish parser: quotes may contain newlines, and escaped quotes are "".
 * It deliberately rejects unterminated/malformed quoted fields instead of
 * silently shifting every following column.
 */
export function parseDelimited(
  input: string,
  options: {
    delimiter?: ParsedDelimitedFile["delimiter"];
    maxBytes?: number;
    maxRows?: number;
  } = {},
): ParsedDelimitedFile {
  const text = input.replace(/^\uFEFF/, "");
  const maxBytes = options.maxBytes ?? IMPORT_MAX_BYTES;
  const maxRows = options.maxRows ?? IMPORT_MAX_ROWS;
  if (byteLength(input) > maxBytes)
    throw new ImportParseError("FILE_TOO_LARGE", "Dosya 1 MB sınırını aşıyor.");
  if (!text.trim()) throw new ImportParseError("EMPTY_FILE", "Dosya boş.");
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let quoteClosed = false;
  let physicalRow = 1;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    quoteClosed = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some((item) => item.trim() !== "")) records.push(row);
    row = [];
    if (records.length > maxRows + 1)
      throw new ImportParseError(
        "TOO_MANY_ROWS",
        `Dosya ${maxRows} veri satırından fazla içeriyor.`,
        physicalRow,
      );
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        cell += char;
        if (char === "\n") physicalRow++;
      }
      continue;
    }
    if (quoteClosed) {
      if (char === delimiter) {
        pushCell();
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        pushRow();
        physicalRow++;
      } else if (char.trim() !== "") {
        throw new ImportParseError(
          "MALFORMED_QUOTE",
          "Kapalı tırnaktan sonra beklenmeyen karakter var.",
          physicalRow,
        );
      }
      continue;
    }
    if (char === '"') {
      if (cell.trim() !== "")
        throw new ImportParseError(
          "MALFORMED_QUOTE",
          "Tırnak yalnızca alanın başında kullanılabilir.",
          physicalRow,
        );
      quoted = true;
    } else if (char === delimiter) {
      pushCell();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushRow();
      physicalRow++;
    } else {
      cell += char;
    }
  }
  if (quoted)
    throw new ImportParseError(
      "UNTERMINATED_QUOTE",
      "Kapatılmamış tırnaklı alan var.",
      physicalRow,
    );
  if (row.length || cell) pushRow();
  if (!records.length)
    throw new ImportParseError("EMPTY_FILE", "Dosyada veri bulunamadı.");
  const headers = records
    .shift()!
    .map((value) => value.replace(/^\uFEFF/, "").trim());
  if (!headers.length || headers.every((header) => !header))
    throw new ImportParseError(
      "MISSING_HEADER",
      "İlk satır sütun başlıklarını içermeli.",
    );
  if (headers.length > IMPORT_MAX_COLUMNS)
    throw new ImportParseError(
      "TOO_MANY_COLUMNS",
      `Dosya ${IMPORT_MAX_COLUMNS} sütundan fazla içeriyor.`,
    );
  if (records.length > maxRows)
    throw new ImportParseError(
      "TOO_MANY_ROWS",
      `Dosya ${maxRows} veri satırından fazla içeriyor.`,
    );
  return { delimiter, headers, rows: records };
}

export const parseCsv = parseDelimited;
export const parseTsv = (input: string) =>
  parseDelimited(input, { delimiter: "\t" });

export function mapHeaders(
  headers: string[],
  kind: CrmImportKind,
): Array<ImportField | null> {
  return headers.map((header) => {
    const mapped = aliasToField.get(normalizeHeader(header)) || null;
    if (kind === "companies" && mapped === "companyName") return "name";
    return mapped;
  });
}

export function mapDelimitedRows(
  parsed: ParsedDelimitedFile,
  kind: CrmImportKind,
  mapping?: Array<ImportField | null>,
): Array<{ rowNumber: number; raw: ImportRawRow; issues: ImportIssue[] }> {
  const fields = mapping || mapHeaders(parsed.headers, kind);
  return parsed.rows.map((values, index) => {
    const raw: ImportRawRow = {};
    const issues: ImportIssue[] = [];
    const chosen = fields.filter(Boolean);
    if (new Set(chosen).size !== chosen.length)
      issues.push({
        code: "DUPLICATE_MAPPING",
        message: "Aynı CRM alanı iki sütuna eşlenemez.",
      });
    if (values.length > parsed.headers.length)
      issues.push({
        code: "TOO_MANY_COLUMNS",
        message: "Satırda başlıktan fazla sütun var.",
      });
    for (let i = 0; i < Math.min(values.length, fields.length); i++) {
      const field = fields[i];
      if (field) raw[field] = values[i].trim();
    }
    return { rowNumber: index + 2, raw, issues };
  });
}

export function validateImportRow(
  kind: CrmImportKind,
  input: unknown,
): ImportIssue[] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return [{ code: "INVALID_ROW", message: "Satır nesne olmalı." }];
  const row = input as Record<string, unknown>;
  const issues: ImportIssue[] = [];
  const name = String(row.name ?? row.companyName ?? "").trim();
  if (!name)
    issues.push({ code: "NAME_REQUIRED", message: "Ad alanı zorunlu." });
  if (name.length > 200)
    issues.push({ code: "NAME_TOO_LONG", message: "Ad alanı çok uzun." });
  const email = normalizeEmail(row.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    issues.push({
      code: "INVALID_EMAIL",
      message: "Geçerli bir e-posta adresi gerekli.",
    });
  const phone = String(row.phone ?? "")
    .trim()
    .replace(/^'(?=\+?\d)/, "");
  if (
    phone &&
    (!/^\+?[\d\s()\-]+$/.test(phone) ||
      normalizePhone(phone).length < 7 ||
      normalizePhone(phone).length > 15)
  )
    issues.push({
      code: "INVALID_PHONE",
      message:
        "Telefon yalnızca geçerli numara karakterleri ve 7–15 rakam içermeli.",
    });
  if (phone.length > 80)
    issues.push({ code: "PHONE_TOO_LONG", message: "Telefon alanı çok uzun." });
  if (kind === "companies" && !name)
    issues.push({
      code: "COMPANY_NAME_REQUIRED",
      message: "Şirket adı zorunlu.",
    });
  for (const key of Object.keys(row)) {
    if (
      !Object.prototype.hasOwnProperty.call(aliases, key) &&
      ![
        "name",
        "phone",
        "email",
        "companyId",
        "companyName",
        "contactId",
        "city",
        "source",
        "notes",
      ].includes(key)
    )
      issues.push({
        code: "UNKNOWN_FIELD",
        message: `Desteklenmeyen alan: ${key}.`,
      });
  }
  if (String(row.notes || "").length > 10000)
    issues.push({
      code: "NOTES_TOO_LONG",
      message: "Notlar 10.000 karakteri aşamaz.",
    });
  for (const field of ["companyId", "contactId"]) {
    if (String(row[field] || "").length > 191)
      issues.push({
        code: "REFERENCE_TOO_LONG",
        message: "Bağlı kayıt kimliği çok uzun.",
      });
  }
  for (const field of ["city", "source"]) {
    if (String(row[field] || "").length > 120)
      issues.push({
        code: "FIELD_TOO_LONG",
        message: `${field} alanı 120 karakteri aşamaz.`,
      });
  }
  return issues;
}

function matchKeys(kind: CrmImportKind, row: ImportRawRow): string[] {
  const phone = normalizePhone(row.phone);
  const email = normalizeEmail(row.email);
  const company = normalizeName(row.name ?? row.companyName);
  if (kind === "companies") return company ? [`name:${company}`] : [];
  return [
    ...(phone ? [`phone:${phone}`] : []),
    ...(email ? [`email:${email}`] : []),
  ];
}

function existingMatchKeys(
  kind: CrmImportKind,
  row: ExistingImportRecord,
): string[] {
  const phone = normalizePhone(row.phone);
  const email = normalizeEmail(row.email);
  const company = normalizeName(
    kind === "companies" ? row.name : (row.company ?? row.name),
  );
  if (kind === "companies") return company ? [`name:${company}`] : [];
  return [
    ...(phone ? [`phone:${phone}`] : []),
    ...(email ? [`email:${email}`] : []),
  ];
}

/** Pure preview over already-authorized visible records. */
export function previewImportRows(
  kind: CrmImportKind,
  rows: Array<{
    rowNumber?: number;
    raw: ImportRawRow;
    issues?: ImportIssue[];
  }>,
  visible: ImportVisibleState,
): ImportPreview {
  const existing = visible[kind] || [];
  const byKey = new Map<string, ExistingImportRecord[]>();
  for (const record of existing) {
    for (const key of existingMatchKeys(kind, record)) {
      const list = byKey.get(key) || [];
      list.push(record);
      byKey.set(key, list);
    }
  }
  const fileKeys = new Map<string, number>();
  const result: ImportPreviewRow[] = [];
  for (let index = 0; index < rows.length; index++) {
    const item = rows[index];
    const raw = { ...item.raw };
    const issues = [...(item.issues || []), ...validateImportRow(kind, raw)];
    for (const key of matchKeys(kind, raw)) {
      const prior = fileKeys.get(key);
      if (prior !== undefined) {
        issues.push({
          code: "FILE_DUPLICATE",
          message: `Dosya içinde ${prior}. satırla aynı kayıt; atlandı.`,
        });
        break;
      }
      fileKeys.set(key, item.rowNumber ?? index + 2);
    }
    const candidates = new Map<string, ExistingImportRecord>();
    for (const key of matchKeys(kind, raw)) {
      for (const candidate of byKey.get(key) || [])
        candidates.set(candidate.id, candidate);
    }
    const candidateIds = [...candidates.keys()];
    const duplicate = candidateIds.length > 0;
    if (duplicate)
      issues.push({
        code: "EXISTING_DUPLICATE",
        message: "Aynı iletişim bilgileriyle kayıt zaten var; atlandı.",
      });
    const status: ImportPreviewRow["status"] = issues.length
      ? duplicate || issues.some((x) => x.code === "FILE_DUPLICATE")
        ? "duplicate"
        : "error"
      : "ready";
    result.push({
      rowNumber: item.rowNumber ?? index + 2,
      raw,
      status,
      issues: [
        ...new Map(
          issues.map((issue) => [`${issue.code}:${issue.message}`, issue]),
        ).values(),
      ],
      ...(candidateIds[0] ? { candidateId: candidateIds[0] } : {}),
      ...(candidateIds.length > 1 ? { candidateIds } : {}),
    });
  }
  return {
    kind,
    rows: result,
    counts: {
      total: result.length,
      ready: result.filter((row) => row.status === "ready").length,
      duplicate: result.filter((row) => row.status === "duplicate").length,
      error: result.filter((row) => row.status === "error").length,
    },
  };
}

export const previewRows = previewImportRows;

export function canonicalImportRow(
  kind: CrmImportKind,
  row: ImportRawRow,
): string {
  const allowed: ImportField[] = [
    "name",
    "phone",
    "email",
    "companyId",
    "companyName",
    "contactId",
    "city",
    "source",
    "notes",
  ];
  return JSON.stringify({
    kind,
    ...Object.fromEntries(
      allowed
        .filter((key) => row[key] !== undefined)
        .sort()
        .map((key) => [key, String(row[key] ?? "").trim()]),
    ),
  });
}

/** Portable deterministic fallback used by the demo; the server additionally hashes with SHA-256. */
export function stableImportHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 ^ (code + i), 16777619);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

export function importRecordId(kind: CrmImportKind, row: ImportRawRow): string {
  return `import_${kind}_${stableImportHash(canonicalImportRow(kind, row))}`;
}
