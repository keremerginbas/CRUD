import { expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseXlsx } from "../shared/xlsx-read";
import {
  mapDelimitedRows,
  mapHeaders,
  normalizeImportTable,
  parseDelimited,
  validateImportRow,
} from "../shared/crm-import";

const cell = (ref: string, value: string | number, shared?: number) =>
  shared !== undefined
    ? `<c r="${ref}" t="s"><v>${shared}</v></c>`
    : typeof value === "number"
      ? `<c r="${ref}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;

function workbook(rows: string[]): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      '<workbook><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/sharedStrings.xml": strToU8(
      "<sst><si><t>Topic</t></si><si><r><t>Ayşe </t></r><r><t>&amp; Ortakları</t></r></si></sst>",
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r}</row>`).join("")}</sheetData></worksheet>`,
    ),
  });
}

it("Excel dışa aktarımını okur: gizli sütunları atar, ad-soyadı birleştirir, alanları eşler", () => {
  const bytes = workbook([
    cell("A1", "(Do Not Modify) Lead") +
      cell("B1", "(Do Not Modify) Row Checksum") +
      cell("C1", "(Do Not Modify) Modified On") +
      cell("D1", "", 0) +
      cell("E1", "First Name") +
      cell("F1", "Last Name") +
      cell("G1", "Company Name") +
      cell("H1", "Business Phone") +
      cell("I1", "Mobile Phone") +
      cell("J1", "Email") +
      cell("K1", "Address 1: City") +
      cell("L1", "Lead Source"),
    cell("A2", "0a1b") +
      cell("B2", "xyz==") +
      cell("C2", 45000.5) +
      cell("D2", "Yeni ERP ihtiyacı") +
      cell("E2", "Deniz") +
      cell("F2", "Örnek") +
      cell("G2", "", 1) +
      cell("H2", 902125550000) +
      // I2 boş: seyrek hücre
      cell("J2", "deniz@example.test") +
      cell("K2", "İstanbul") +
      cell("L2", "Web"),
  ]);
  const table = normalizeImportTable(parseXlsx(bytes));
  expect(table.headers).toEqual([
    "Topic",
    "Ad Soyad",
    "Company Name",
    "Business Phone",
    "Mobile Phone",
    "Email",
    "Address 1: City",
    "Lead Source",
  ]);
  expect(mapHeaders(table.headers, "leads")).toEqual([
    "notes",
    "name",
    "companyName",
    "phone",
    null,
    "email",
    "city",
    "source",
  ]);
  const [row] = mapDelimitedRows(table, "leads");
  expect(row.issues).toHaveLength(0);
  expect(row.raw).toEqual({
    notes: "Yeni ERP ihtiyacı",
    name: "Deniz Örnek",
    companyName: "Ayşe & Ortakları",
    phone: "902125550000",
    email: "deniz@example.test",
    city: "İstanbul",
    source: "Web",
  });
  expect(validateImportRow("leads", row.raw)).toHaveLength(0);
});

it("Türkçe başlıkları ve hesap (şirket) dışa aktarımını tanır", () => {
  const table = normalizeImportTable(
    parseDelimited(
      "(Değiştirmeyin) Hesap;Hesap Adı;Ana Telefon;Adres 1: Şehir;E-posta\nabc;Örnek Lojistik A.Ş.;0212 555 00 00;Ankara;info@example.test",
    ),
  );
  expect(mapHeaders(table.headers, "companies")).toEqual(["name", "phone", "city", "email"]);
  expect(mapDelimitedRows(table, "companies")[0].raw.name).toBe("Örnek Lojistik A.Ş.");
});

it("tam ad sütunu varsa ad ve soyadı birleştirmez; bozuk ve çok büyük dosyayı reddeder", () => {
  const table = normalizeImportTable(parseDelimited("Full Name,First Name,Last Name\nA B,A,B"));
  expect(table.headers).toEqual(["Full Name", "First Name", "Last Name"]);
  expect(mapHeaders(table.headers, "contacts")).toEqual(["name", null, null]);
  expect(() => parseXlsx(strToU8("bu bir excel değil"))).toThrow();
  expect(() => parseXlsx(new Uint8Array(5_000_001))).toThrow();
});
