// Word (.docx) şablonu doldurma: {{alan}} yer tutucuları değerlerle değiştirilir.
// Tek başına bir satıra yazılan tablo alanı ({{odeme_plani}} gibi) tabloya dönüşür.
// Yalnız fflate kullanır; sunucuda ve tarayıcıda (demo) aynı kod çalışır.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export class DocxError extends Error {}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decodeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
/** XML'de geçersiz denetim karakterlerini ayıklar, satır sonlarını boşluğa çevirir. */
const clean = (value: unknown) =>
  String(value ?? "")
    .replace(/\r?\n/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)\s*\}\}/g;
const TEXT_RUN = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(\s[^>]*)?\/>/g;

function tableXml(rows: string[][]): string {
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const borders = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>`;
  const last = rows.length - 1;
  const body = rows
    .map((row, r) => {
      const bold = r === 0 || (r === last && rows.length > 2) ? "<w:rPr><w:b/></w:rPr>" : "";
      const cells = row
        .map((cell, c) => {
          const right = c === row.length - 1 && row.length > 1 ? '<w:pPr><w:jc w:val="right"/></w:pPr>' : "";
          return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p>${right}<w:r>${bold}<w:t xml:space="preserve">${escapeXml(clean(cell))}</w:t></w:r></w:p></w:tc>`;
        })
        .join("");
      return `<w:tr>${cells}</w:tr>`;
    })
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr>${body}</w:tbl><w:p/>`;
}

export interface FillResult {
  bytes: Uint8Array;
  /** Şablonda bulunup karşılığı olmayan alan adları. */
  unknown: string[];
  /** Doldurulan alan sayısı. */
  filled: number;
}

function fillXml(xml: string, fields: Record<string, string>, tables: Record<string, string[][]>, stats: { unknown: Set<string>; filled: number }): string {
  const substitute = (source: string) =>
    source.replace(PLACEHOLDER, (whole, key: string) => {
      const name = key.toLocaleLowerCase("tr-TR");
      if (Object.prototype.hasOwnProperty.call(fields, name)) {
        stats.filled++;
        return clean(fields[name]);
      }
      if (!Object.prototype.hasOwnProperty.call(tables, name)) stats.unknown.add(name);
      return whole;
    });
  return xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const texts: string[] = [];
    paragraph.replace(TEXT_RUN, (_m, _a, body) => (texts.push(decodeXml(body || "")), ""));
    const joined = texts.join("");
    if (!joined.includes("{{")) return paragraph;
    // Tablo alanı: paragraf yalnız bu alandan oluşuyorsa tablo ile değiştirilir.
    const only = /^\s*\{\{\s*([a-zA-Z0-9_ğüşıöçĞÜŞİÖÇ]+)\s*\}\}\s*$/.exec(joined);
    if (only) {
      const name = only[1].toLocaleLowerCase("tr-TR");
      if (Object.prototype.hasOwnProperty.call(tables, name)) {
        stats.filled++;
        return tableXml(tables[name]);
      }
    }
    // Her yer tutucu tek bir metin parçasının içindeyse biçim korunarak yerinde değiştirilir.
    const balanced = texts.every((t) => !/[{}]/.test(t.replace(/\{\{[^{}]*\}\}/g, "")));
    if (balanced)
      return paragraph.replace(TEXT_RUN, (whole, attrs, body) =>
        body && body.includes("{{") ? `<w:t xml:space="preserve">${escapeXml(substitute(decodeXml(body)))}</w:t>` : whole,
      );
    // Word yer tutucuyu parçalara bölmüşse metin ilk parçada birleştirilir.
    let first = true;
    const replaced = substitute(joined);
    return paragraph.replace(TEXT_RUN, () => {
      if (!first) return '<w:t xml:space="preserve"></w:t>';
      first = false;
      return `<w:t xml:space="preserve">${escapeXml(replaced)}</w:t>`;
    });
  });
}

/** Şablondaki {{alan}} yer tutucularını doldurur; gövde, üst bilgi ve alt bilgi işlenir. */
export function fillDocx(template: Uint8Array, fields: Record<string, string>, tables: Record<string, string[][]> = {}): FillResult {
  let files: Record<string, Uint8Array>;
  try {
    // Sıkıştırılmış bomba koruması: açılmış toplam boyut ve dosya sayısı sınırlıdır.
    let total = 0;
    let count = 0;
    files = unzipSync(template, {
      filter: (file) => {
        total += file.originalSize;
        count += 1;
        if (total > 40 * 1024 * 1024 || count > 2000) throw new DocxError("Şablon çok büyük.");
        return true;
      },
    });
  } catch (cause) {
    if (cause instanceof DocxError) throw cause;
    throw new DocxError("Şablon okunamadı. Word'de .docx olarak kaydedip yeniden yükleyin.");
  }
  if (!files["word/document.xml"]) throw new DocxError("Dosya bir Word (.docx) belgesi değil.");
  const stats = { unknown: new Set<string>(), filled: 0 };
  for (const name of Object.keys(files)) {
    if (!/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)) continue;
    files[name] = strToU8(fillXml(strFromU8(files[name]), fields, tables, stats));
  }
  return { bytes: zipSync(files, { level: 6 }), unknown: [...stats.unknown], filled: stats.filled };
}

/** Şablonda geçen alan adlarını listeler (yükleme sırasında denetim için). */
export function docxPlaceholders(template: Uint8Array): string[] {
  return fillDocx(template, {}, {}).unknown;
}

export interface DocxParagraph {
  text: string;
  bold?: boolean;
  align?: "center" | "right" | "both";
  /** Yazı boyutu (punto). */
  size?: number;
  spaceAfter?: number;
}

/** Yalın paragraflardan en küçük geçerli .docx dosyasını üretir (hazır şablon için). */
export function buildDocx(paragraphs: DocxParagraph[]): Uint8Array {
  const body = paragraphs
    .map((p) => {
      const pPr = `<w:pPr>${p.align ? `<w:jc w:val="${p.align}"/>` : ""}<w:spacing w:after="${p.spaceAfter ?? 120}"/></w:pPr>`;
      const rPr = `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${p.bold ? "<w:b/>" : ""}<w:sz w:val="${(p.size || 11) * 2}"/></w:rPr>`;
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(clean(p.text))}</w:t></w:r></w:p>`;
    })
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(document),
    },
    { level: 6 },
  );
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
