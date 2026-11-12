/**
 * Büyük dosyaların parçalı içe aktarımı için saf (tarayıcı + sunucu testlerinde
 * çalışan) yardımcılar. Sunucunun istek başına sınırları (1 MB / 1.000 satır)
 * değişmez; tarayıcı dosyanın tamamını bir kez okur ve satırları bu sınırların
 * altında kalan sıralı parçalara böler.
 */
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  importMatchKeys,
  validateImportRow,
  type CrmImportKind,
  type ImportIssue,
  type ImportPreviewRow,
  type ImportRawRow,
} from "./crm-import";

/** Tarayıcıda okunan tek dosya için toplam üst sınırlar (sunucu sınırlarından ayrı). */
export const IMPORT_TOTAL_MAX_ROWS = 50_000;
export const IMPORT_TOTAL_MAX_CSV_BYTES = 20_000_000;
export const IMPORT_TOTAL_MAX_XLSX_BYTES = 15_000_000;
/** Açılmış .xlsx içeriği için üst sınır (zip bombasına karşı). */
export const IMPORT_TOTAL_MAX_XLSX_UNZIPPED = 250_000_000;

/** Bir istekte gönderilen satır sayısı ve gövde bütçesi (sunucu sınırının altında pay bırakır). */
export const IMPORT_CHUNK_ROWS = 500;
export const IMPORT_CHUNK_BYTES = 800_000;
/** kind + operationId + köşeli/süslü parantezler için ayrılan sabit pay. */
const ENVELOPE_BYTES = 256;

/** Önizleme tablosunda gösterilen satır sayısı sınırları. */
export const IMPORT_PREVIEW_HEAD_ROWS = 200;
export const IMPORT_PREVIEW_ISSUE_ROWS = 300;

export interface ImportSourceRow {
  /** Dosyadaki satır numarası (başlık 1. satır). */
  rowNumber: number;
  raw: ImportRawRow;
  issues?: ImportIssue[];
}

export interface ImportChunk {
  index: number;
  /** Bu parçadaki her satırın dosyadaki satır numarası. */
  rowNumbers: number[];
  rows: ImportRawRow[];
  /** Tarayıcıda bulunan satır sorunları (yalnızca demo önizlemesinde kullanılır). */
  issues: ImportIssue[][];
  /** Parçanın commit isteği için sabit kimlik: yeniden denemede aynı kimlik gönderilir. */
  operationId: string;
  bytes: number;
}

export interface ImportPlan {
  kind: CrmImportKind;
  totalRows: number;
  chunks: ImportChunk[];
  /** Dosya içinde daha önceki bir satırla aynı olan, sunucuya hiç gönderilmeyen satırlar. */
  fileDuplicates: ImportPreviewRow[];
}

function utf8Length(value: string): number {
  if (typeof TextEncoder !== "undefined")
    return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function uniqueIssues(issues: ImportIssue[]): ImportIssue[] {
  return [
    ...new Map(
      issues.map((issue) => [`${issue.code}:${issue.message}`, issue]),
    ).values(),
  ];
}

/** RFC 4122 v4; crypto.randomUUID olmayan (güvensiz bağlam) tarayıcılar için de çalışır. */
export function newOperationId(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Dosyanın TAMAMI üzerinde dosya-içi mükerrerleri ayırır. Kural, tek istekteki
 * previewImportRows ile aynıdır: bir satırın telefon/e-posta (şirketlerde ad)
 * anahtarı daha önceki bir satırda görüldüyse o satır atlanır. Parçalar arası
 * mükerrerler böylece hangi parçaya düştüklerinden bağımsız yakalanır.
 */
export function splitFileDuplicates(
  kind: CrmImportKind,
  rows: ImportSourceRow[],
): { unique: ImportSourceRow[]; duplicates: ImportPreviewRow[] } {
  const seen = new Map<string, number>();
  const unique: ImportSourceRow[] = [];
  const duplicates: ImportPreviewRow[] = [];
  for (const row of rows) {
    let prior: number | undefined;
    for (const key of importMatchKeys(kind, row.raw)) {
      const hit = seen.get(key);
      if (hit !== undefined) {
        prior = hit;
        break;
      }
      seen.set(key, row.rowNumber);
    }
    if (prior === undefined) {
      unique.push(row);
      continue;
    }
    duplicates.push({
      rowNumber: row.rowNumber,
      raw: { ...row.raw },
      status: "duplicate",
      issues: uniqueIssues([
        ...(row.issues || []),
        ...validateImportRow(kind, row.raw),
        {
          code: "FILE_DUPLICATE",
          message: `Dosya içinde ${prior}. satırla aynı kayıt; atlandı.`,
        },
      ]),
    });
  }
  return { unique, duplicates };
}

/**
 * Satırları sıralı parçalara böler. Her parça hem satır sayısı hem de JSON gövde
 * boyutu bakımından sunucunun istek sınırının altında kalır.
 */
export function planImportChunks(
  kind: CrmImportKind,
  rows: ImportSourceRow[],
  options: {
    chunkRows?: number;
    chunkBytes?: number;
    operationId?: () => string;
  } = {},
): ImportPlan {
  const chunkRows = Math.max(
    1,
    Math.min(options.chunkRows ?? IMPORT_CHUNK_ROWS, IMPORT_MAX_ROWS),
  );
  const chunkBytes = Math.max(
    1,
    Math.min(
      options.chunkBytes ?? IMPORT_CHUNK_BYTES,
      IMPORT_MAX_BYTES - ENVELOPE_BYTES,
    ),
  );
  const makeId = options.operationId ?? newOperationId;
  const { unique, duplicates } = splitFileDuplicates(kind, rows);
  const chunks: ImportChunk[] = [];
  let current: ImportChunk | null = null;
  for (const row of unique) {
    // +1: satırlar arasındaki virgül.
    const size = utf8Length(JSON.stringify(row.raw)) + 1;
    if (size + ENVELOPE_BYTES > IMPORT_MAX_BYTES)
      throw new Error(
        `Satır ${row.rowNumber} tek başına istek sınırını aşıyor; hücreleri kısaltın.`,
      );
    if (
      !current ||
      current.rows.length >= chunkRows ||
      current.bytes + size > chunkBytes
    ) {
      current = {
        index: chunks.length,
        rowNumbers: [],
        rows: [],
        issues: [],
        operationId: makeId(),
        bytes: ENVELOPE_BYTES,
      };
      chunks.push(current);
    }
    current.rowNumbers.push(row.rowNumber);
    current.rows.push(row.raw);
    current.issues.push(row.issues || []);
    current.bytes += size;
  }
  return { kind, totalRows: rows.length, chunks, fileDuplicates: duplicates };
}

/**
 * Sunucu yanıtındaki parça-göreli satır numaralarını (2, 3, …) dosyadaki gerçek
 * satır numaralarına çevirir. Yanıt beklenen satırlarla birebir eşleşmezse hata verir.
 */
export function remapChunkRows<T extends ImportPreviewRow>(
  chunk: ImportChunk,
  rows: T[] | undefined,
): T[] {
  if (!Array.isArray(rows) || rows.length !== chunk.rows.length)
    throw new Error("Sunucu yanıtı gönderilen satırlarla eşleşmiyor.");
  const seen = new Set<number>();
  return rows.map((row) => {
    const position = Number(row.rowNumber) - 2;
    if (
      !Number.isInteger(position) ||
      position < 0 ||
      position >= chunk.rowNumbers.length ||
      seen.has(position)
    )
      throw new Error("Sunucu yanıtı gönderilen satırlarla eşleşmiyor.");
    seen.add(position);
    return {
      ...row,
      rowNumber: chunk.rowNumbers[position],
      // Dosya-içi mükerrerler gönderilmeden ayıklanır; yine de gelirse parça-göreli
      // satır numarası taşıyan iletiyi yanıltıcı olmayan bir iletiyle değiştir.
      issues: (row.issues || []).map((issue) =>
        issue.code === "FILE_DUPLICATE"
          ? {
              code: issue.code,
              message: "Dosya içinde daha önceki bir satırla aynı kayıt; atlandı.",
            }
          : issue,
      ),
    };
  });
}

export interface ChunkRunResult {
  status: "done" | "stopped" | "failed";
  /** Bir sonraki çalıştırmada başlanacak parça (başarısız olan parça dahil). */
  nextIndex: number;
  error?: unknown;
}

/**
 * Parçaları SIRAYLA gönderir; bir parça bitmeden sonraki başlamaz. Durdurma isteği
 * yalnızca parçalar arasında dikkate alınır. Hata olursa başarısız parçanın dizini
 * döner; aynı plan (aynı operationId'ler) ile kaldığı yerden devam edilebilir.
 */
export async function runImportChunks<T>(options: {
  chunks: ImportChunk[];
  startAt?: number;
  send: (chunk: ImportChunk) => Promise<T>;
  onChunk: (chunk: ImportChunk, response: T) => void | Promise<void>;
  shouldStop?: () => boolean;
}): Promise<ChunkRunResult> {
  const { chunks, send, onChunk, shouldStop } = options;
  let index = Math.max(0, options.startAt ?? 0);
  for (; index < chunks.length; index++) {
    if (shouldStop?.()) return { status: "stopped", nextIndex: index };
    try {
      await onChunk(chunks[index], await send(chunks[index]));
    } catch (error) {
      return { status: "failed", nextIndex: index, error };
    }
  }
  return { status: "done", nextIndex: index };
}

export interface ImportPreviewSummary {
  counts: { total: number; ready: number; duplicate: number; error: number };
  /** Tabloda gösterilecek satırlar: dosyanın başı + (sınıra kadar) hatalı satırlar. */
  rows: ImportPreviewRow[];
  /** Tabloya sığmadığı için gösterilmeyen hatalı satır sayısı. */
  omittedErrors: number;
  /** Şimdiye kadar işlenen satır (ilerleme göstergesi için). */
  processed: number;
}

/** Tüm parçaların önizleme yanıtlarını toplar; belleği ve DOM'u sınırlı tutar. */
export function createPreviewAccumulator(
  limits: { headRows?: number; issueRows?: number } = {},
) {
  const headRows = limits.headRows ?? IMPORT_PREVIEW_HEAD_ROWS;
  const issueRows = limits.issueRows ?? IMPORT_PREVIEW_ISSUE_ROWS;
  const counts = { total: 0, ready: 0, duplicate: 0, error: 0 };
  const head: ImportPreviewRow[] = [];
  const errors: ImportPreviewRow[] = [];
  let omittedErrors = 0;
  return {
    add(rows: ImportPreviewRow[]) {
      for (const row of rows) {
        counts.total++;
        counts[row.status]++;
        // Başlık 1. satır olduğundan ilk N veri satırı 2 … N+1 numaralıdır.
        if (row.rowNumber <= headRows + 1) head.push(row);
        else if (row.status === "error") {
          if (errors.length < issueRows) errors.push(row);
          else omittedErrors++;
        }
      }
    },
    summary(): ImportPreviewSummary {
      return {
        counts: { ...counts },
        rows: [...head, ...errors].sort((a, b) => a.rowNumber - b.rowNumber),
        omittedErrors,
        processed: counts.total,
      };
    },
  };
}

export interface ImportCommitCounts {
  total: number;
  created: number;
  recovered: number;
  skipped: number;
  errors: number;
}
export interface ImportCommitSummary {
  counts: ImportCommitCounts;
  /** Hatalı satırlar (sınıra kadar), dosya satır numaralarıyla. */
  errorRows: ImportPreviewRow[];
  omittedErrors: number;
}

/** Tüm parçaların commit yanıtlarını tek rapora toplar. */
export function createCommitAccumulator(
  limits: { issueRows?: number } = {},
) {
  const issueRows = limits.issueRows ?? IMPORT_PREVIEW_ISSUE_ROWS;
  const counts: ImportCommitCounts = {
    total: 0,
    created: 0,
    recovered: 0,
    skipped: 0,
    errors: 0,
  };
  const errorRows: ImportPreviewRow[] = [];
  let omittedErrors = 0;
  return {
    /** Sunucuya gönderilmeyen dosya-içi mükerrerler: atlanmış sayılır. */
    addSkipped(rows: ImportPreviewRow[]) {
      counts.total += rows.length;
      counts.skipped += rows.length;
    },
    add(rows: Array<ImportPreviewRow & { created?: boolean; recovered?: boolean }>) {
      for (const row of rows) {
        counts.total++;
        if (row.status === "error") {
          counts.errors++;
          if (errorRows.length < issueRows) errorRows.push(row);
          else omittedErrors++;
        } else if (row.status === "duplicate") counts.skipped++;
        else if (row.recovered) counts.recovered++;
        else if (row.created) counts.created++;
        // "ready" ama ne created ne recovered: sunucu sözleşmesinde yoktur; sayılmaz.
      }
    },
    summary(): ImportCommitSummary {
      return {
        counts: { ...counts },
        errorRows: [...errorRows].sort((a, b) => a.rowNumber - b.rowNumber),
        omittedErrors,
      };
    },
  };
}
