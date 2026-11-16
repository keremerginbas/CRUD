// En küçük geçerli .xlsx dosyasını üretir (tek sayfa, yalnızca metin hücreleri).
// Yalnız fflate kullanır; içe aktarma şablonu tarayıcıda bu kodla hazırlanır.
import { strToU8, zipSync } from "fflate";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const escapeXml = (value: string) =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 0 → A, 25 → Z, 26 → AA */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * Satırlardan tek sayfalı bir Excel dosyası üretir. Tüm hücreler metin olarak yazılır ve
 * sütunların kendisi de metin biçimlidir; böylece sonradan yazılan satırlarda da baştaki
 * sıfırı olan telefon numaraları bozulmaz. İlk satır kalın yazılır.
 */
export function buildXlsx(rows: string[][], sheetName = "Sayfa1"): Uint8Array {
  const widest = Math.max(1, ...rows.map((row) => row.length));
  const cols = Array.from({ length: widest }, (_, i) => {
    const longest = Math.max(...rows.map((row) => (row[i] || "").length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(50, Math.max(12, longest + 4))}" style="2" customWidth="1"/>`;
  }).join("");
  const sheetRows = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map(
            (value, c) =>
              `<c r="${columnName(c)}${r + 1}" s="${r === 0 ? 1 : 2}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value ?? ""))}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006";
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        `${head}<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `${head}<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      "xl/workbook.xml": strToU8(
        `${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `${head}<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
      ),
      // Biçimler: 0 = varsayılan, 1 = kalın metin (başlık), 2 = metin ("@": sayıya çevrilmez).
      "xl/styles.xml": strToU8(
        `${head}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `${head}<worksheet xmlns="${main}"><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
      ),
    },
    { level: 6 },
  );
}
