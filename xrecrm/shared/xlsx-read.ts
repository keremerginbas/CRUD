import { unzipSync, strFromU8 } from "fflate";
import {
  IMPORT_MAX_COLUMNS,
  IMPORT_MAX_ROWS,
  ImportParseError,
  formatImportBytes,
  formatImportCount,
  type ParsedDelimitedFile,
} from "./crm-import";

/** Sıkıştırılmış .xlsx dosyası için üst sınır (açılmış hâli ayrıca sınırlanır). */
export const XLSX_MAX_BYTES = 5_000_000;
const XLSX_MAX_UNZIPPED = 40_000_000;

const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/_x000D_/g, "");

/** Bir <si> veya <is> içindeki tüm <t> parçalarını (zengin metin dâhil) birleştirir. */
function textOf(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh[\s>][\s\S]*?<\/rPh>/g, "");
  let out = "";
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutPhonetic))) out += decodeXml(match[1]);
  return out;
}

function columnIndex(ref: string): number {
  let index = 0;
  for (const char of ref.toUpperCase()) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * .xlsx dosyasının ilk sayfasını başlık + satırlar olarak okur.
 * Yalnızca metin ve sayı değerleri alınır; formül sonuçları kayıtlı değerinden okunur.
 * Gizli sistem sütunları burada değil, normalizeImportTable içinde ayıklanır.
 */
export function parseXlsx(
  bytes: Uint8Array,
  options: { maxBytes?: number; maxRows?: number; maxUnzippedBytes?: number } = {},
): ParsedDelimitedFile {
  const maxBytes = options.maxBytes ?? XLSX_MAX_BYTES;
  const maxRows = options.maxRows ?? IMPORT_MAX_ROWS;
  const maxUnzipped = options.maxUnzippedBytes ?? XLSX_MAX_UNZIPPED;
  if (bytes.byteLength > maxBytes)
    throw new ImportParseError(
      "FILE_TOO_LARGE",
      `Excel dosyası ${formatImportBytes(maxBytes)} sınırını aşıyor.`,
    );
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        const wanted =
          file.name === "xl/sharedStrings.xml" ||
          file.name === "xl/workbook.xml" ||
          file.name === "xl/_rels/workbook.xml.rels" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);
        if (!wanted) return false;
        total += file.originalSize;
        if (total > maxUnzipped)
          throw new ImportParseError("FILE_TOO_LARGE", "Excel dosyası çok büyük.");
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof ImportParseError) throw cause;
    throw new ImportParseError(
      "INVALID_XLSX",
      "Dosya okunamadı. Excel'de .xlsx olarak kaydedip yeniden deneyin.",
    );
  }
  const sheetNames = Object.keys(files)
    .filter((name) => name.startsWith("xl/worksheets/"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  let sheetPath = sheetNames[0];
  // İlk sayfayı çalışma kitabındaki sıraya göre bul (dosya adı sırası her zaman aynı değildir).
  const workbook = files["xl/workbook.xml"] && strFromU8(files["xl/workbook.xml"]);
  const rels =
    files["xl/_rels/workbook.xml.rels"] && strFromU8(files["xl/_rels/workbook.xml.rels"]);
  if (workbook && rels) {
    const firstSheet = /<sheet\s[^>]*>/.exec(workbook)?.[0];
    const relId = firstSheet && (attr(firstSheet, "r:id") || attr(firstSheet, "id"));
    if (relId) {
      for (const rel of rels.match(/<Relationship\s[^>]*>/g) || []) {
        if (attr(rel, "Id") !== relId) continue;
        const target = (attr(rel, "Target") || "").replace(/^\/?(xl\/)?/, "");
        if (files[`xl/${target}`]) sheetPath = `xl/${target}`;
      }
    }
  }
  if (!sheetPath)
    throw new ImportParseError("INVALID_XLSX", "Excel dosyasında sayfa bulunamadı.");

  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    const xml = strFromU8(files["xl/sharedStrings.xml"]);
    const pattern = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml))) shared.push(match[1] ? textOf(match[1]) : "");
  }

  const sheet = strFromU8(files[sheetPath]);
  const table: string[][] = [];
  const rowPattern = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(sheet))) {
    const cells: string[] = [];
    const cellPattern = /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    let next = 0;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const tag = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const ref = attr(tag, "r");
      const index = ref ? columnIndex(ref) : next;
      next = index + 1;
      if (index < 0 || index >= 512) continue;
      const type = attr(tag, "t");
      let value = "";
      if (type === "inlineStr") value = textOf(body);
      else {
        const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "b") value = raw === "1" ? "Evet" : raw === "0" ? "Hayır" : "";
        else if (type === "e") value = "";
        else value = decodeXml(raw);
      }
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    if (cells.some((cell) => cell.trim() !== "")) table.push(cells);
    if (table.length > maxRows + 1)
      throw new ImportParseError(
        "TOO_MANY_ROWS",
        `Dosya ${formatImportCount(maxRows)} veri satırından fazla içeriyor.`,
      );
  }
  if (!table.length) throw new ImportParseError("EMPTY_FILE", "Dosyada veri bulunamadı.");
  const headers = table.shift()!.map((value) => value.trim());
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  if (!headers.length)
    throw new ImportParseError("MISSING_HEADER", "İlk satır sütun başlıklarını içermeli.");
  const rows = table.map((row) => row.slice(0, headers.length));
  // Sütun sınırı gizli sistem sütunları ayıklandıktan sonra uygulanır (normalizeImportTable).
  if (headers.length > IMPORT_MAX_COLUMNS * 4)
    throw new ImportParseError(
      "TOO_MANY_COLUMNS",
      `Dosya ${IMPORT_MAX_COLUMNS} sütundan fazla içeriyor.`,
    );
  return { delimiter: "\t", headers, rows };
}
