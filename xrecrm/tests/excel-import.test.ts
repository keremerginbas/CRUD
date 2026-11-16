import { expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseXlsx } from "../shared/xlsx-read";
import { buildXlsx } from "../shared/xlsx-write";
import {
  IMPORT_HARD_MAX_COLUMNS,
  IMPORT_MAX_COLUMNS,
  IMPORT_TEMPLATE_HEADERS,
  ImportParseError,
  canonicalImportRow,
  importFieldsFor,
  importTemplateRows,
  isTemplateExampleRow,
  legacyImportRow,
  projectMatchKey,
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

it("örnek şablon: başlıkların tamamı otomatik eşlenir ve örnek satır hatasız okunur", () => {
  const headers = ["Ad Soyad", "Telefon", "E-posta", "Şehir", "Ülke", "Proje", "Kaynak", "Not"];
  expect(IMPORT_TEMPLATE_HEADERS.leads).toEqual(headers);
  const table = normalizeImportTable(parseXlsx(buildXlsx(importTemplateRows("leads"))));
  expect(table.headers).toEqual(headers);
  expect(table.droppedColumns).toBeUndefined();
  expect(mapHeaders(table.headers, "leads")).toEqual([
    "name",
    "phone",
    "email",
    "city",
    "country",
    "project",
    "source",
    "notes",
  ]);
  // Örnek satır dosyada okunur ama silinmeden yüklense bile kayıt olarak aktarılmaz.
  expect(table.rows).toHaveLength(1);
  expect(table.rows[0].slice(0, 6)).toEqual([
    "Ayşe Yılmaz",
    "05550000001",
    "ornek@example.com",
    "İstanbul",
    "Türkiye",
    "Örnek Proje",
  ]);
  expect(isTemplateExampleRow(table.rows[0])).toBe(true);
  expect(mapDelimitedRows(table, "leads")).toHaveLength(0);
  // Kullanıcı örneğin altına kendi satırını yazarsa yalnızca o satır aktarılır;
  // satır numarası dosyadaki yerini (3. satır) korur.
  const filled = normalizeImportTable(
    parseXlsx(
      buildXlsx([
        ...importTemplateRows("leads"),
        ["Mehmet Örnek", "05550000002", "ornek2@example.com", "İzmir", "Türkiye", "Örnek Proje", "Fuar", "İlk görüşme"],
      ]),
    ),
  );
  const mapped = mapDelimitedRows(filled, "leads");
  expect(mapped).toHaveLength(1);
  expect(mapped[0].rowNumber).toBe(3);
  expect(mapped[0].issues).toHaveLength(0);
  expect(mapped[0].raw).toMatchObject({
    name: "Mehmet Örnek",
    phone: "05550000002",
    email: "ornek2@example.com",
    city: "İzmir",
    country: "Türkiye",
    project: "Örnek Proje",
  });
  expect(validateImportRow("leads", mapped[0].raw)).toHaveLength(0);
  // Sütun eşlemesi elle değiştirilse (Not atlansa) bile örnek satır tanınır.
  expect(mapDelimitedRows(filled, "leads", ["name", "phone", null, null, null, null, null, null])).toHaveLength(1);
  // Kişi ve şirket şablonları da kendi türlerinde eksiksiz eşlenir, örnekleri atlanır.
  for (const kind of ["contacts", "companies"] as const) {
    const other = normalizeImportTable(parseXlsx(buildXlsx(importTemplateRows(kind))));
    expect(mapHeaders(other.headers, kind).every(Boolean)).toBe(true);
    expect(mapDelimitedRows(other, kind)).toHaveLength(0);
  }
});

it("şablonda sütunlar metin biçimlidir: yeni satıra yazılan telefonun baştaki sıfırı kaybolmaz", async () => {
  const { unzipSync, strFromU8 } = await import("fflate");
  const sheet = strFromU8(unzipSync(buildXlsx(importTemplateRows("leads")))["xl/worksheets/sheet1.xml"]);
  const cols = sheet.match(/<col [^>]*>/g) || [];
  expect(cols).toHaveLength(8);
  // style="2" → styles.xml içindeki metin ("@") biçimi.
  expect(cols.every((col) => /\bstyle="2"/.test(col))).toBe(true);
});

it("proje eşleştirme anahtarı i/ı ayrımı yapmaz; eski kayıt kimliği ülke ve proje olmadan hesaplanır", () => {
  expect(projectMatchKey("SKYLINE RESIDENCE")).toBe(projectMatchKey("Skyline Residence"));
  expect(projectMatchKey("VADİ İSTANBUL")).toBe(projectMatchKey("Vadi Istanbul"));
  expect(projectMatchKey("  Işık   Vadisi ")).toBe(projectMatchKey("IŞIK VADİSİ"));
  expect(projectMatchKey("Skyline")).not.toBe(projectMatchKey("Skyland"));
  expect(legacyImportRow({ name: "A", city: "İzmir" })).toBeNull();
  const legacy = legacyImportRow({ name: "A", city: "İzmir", country: "Türkiye", project: "Örnek Proje" });
  expect(legacy).toEqual({ name: "A", city: "İzmir" });
  expect(canonicalImportRow("leads", legacy!)).toBe('{"kind":"leads","city":"İzmir","name":"A"}');
});

it("ülke ve proje başlıklarını tanır; kişi ve şirket aktarımında bu alanları sunmaz", () => {
  const headers = ["Müşteri Adı Soyadı", "Telefon Numarası", "Şehir", "Eposta", "Proje Adı", "Ülke"];
  expect(mapHeaders(headers, "leads")).toEqual(["name", "phone", "city", "email", "project", "country"]);
  expect(mapHeaders(["Name", "Country", "Project Name", "İlgilendiği Proje"], "leads")).toEqual([
    "name",
    "country",
    "project",
    null,
  ]);
  expect(mapHeaders(["Ad Soyad", "Ülke", "Proje"], "contacts")).toEqual(["name", null, null]);
  expect(importFieldsFor("leads")).toEqual(expect.arrayContaining(["country", "project"]));
  expect(importFieldsFor("contacts")).not.toEqual(expect.arrayContaining(["country"]));
  expect(importFieldsFor("companies")).toEqual(["name", "phone", "email", "notes"]);
  expect(validateImportRow("leads", { name: "A", country: "x".repeat(121) })[0].code).toBe("FIELD_TOO_LONG");
  expect(validateImportRow("leads", { name: "A", project: "x".repeat(201) })[0].code).toBe("FIELD_TOO_LONG");
  // Yeni alanlar boşken kayıt kimliği eskisiyle aynı kalır; doluyken değişir.
  const base = canonicalImportRow("leads", { name: "A", phone: "05550000001" });
  expect(base).toBe('{"kind":"leads","name":"A","phone":"05550000001"}');
  expect(canonicalImportRow("leads", { name: "A", phone: "05550000001", country: "Türkiye" })).not.toBe(base);
});

it("60 sütunlu tablo reddedilmez: tanınan sütunlar kalır, tanınmayanlar sınıra kadar alınır", () => {
  const known = ["Ad Soyad", "Telefon", "E-posta", "Şehir", "Ülke", "Proje", "Kaynak", "Not"];
  // Tanınan sütunlar tablonun sonunda: yine de hepsi korunmalı.
  const headers = [...Array.from({ length: 52 }, (_, i) => `Özel Alan ${i + 1}`), ...known];
  const values = [
    ...Array.from({ length: 52 }, (_, i) => `d${i + 1}`),
    "Ayşe Yılmaz",
    "05550000001",
    "ornek@example.com",
    "İzmir",
    "Türkiye",
    "Örnek Proje",
    "Fuar",
    "Not",
  ];
  for (const parsed of [parseXlsx(buildXlsx([headers, values])), parseDelimited([headers.join(";"), values.join(";")].join("\n"))]) {
    expect(parsed.headers).toHaveLength(60);
    const table = normalizeImportTable(parsed);
    expect(table.headers).toHaveLength(IMPORT_MAX_COLUMNS);
    expect(table.droppedColumns).toBe(28);
    expect(table.droppedHeaders).toEqual(headers.slice(24, 52));
    expect(table.headers.slice(0, 24)).toEqual(headers.slice(0, 24));
    expect(table.headers.slice(24)).toEqual(known);
    const mapping = mapHeaders(table.headers, "leads");
    expect(mapping.filter(Boolean)).toEqual(["name", "phone", "email", "city", "country", "project", "source", "notes"]);
    const [row] = mapDelimitedRows(table, "leads");
    expect(row.issues).toHaveLength(0);
    // Sunucuya yalnızca tanınan alanlar gider.
    expect(Object.keys(row.raw).sort()).toEqual(["city", "country", "email", "name", "notes", "phone", "project", "source"]);
    expect(row.raw.name).toBe("Ayşe Yılmaz");
    expect(row.raw.project).toBe("Örnek Proje");
  }
  // Sınırın altındaki tablo olduğu gibi kalır.
  const small = normalizeImportTable(parseDelimited("Ad;Telefon;Özel\nA;05550000001;x"));
  expect(small.headers).toEqual(["Ad", "Telefon", "Özel"]);
  expect(small.droppedColumns).toBeUndefined();
});

it("güvenlik sınırı: 256 sütundan fazlası açık bir mesajla reddedilir", () => {
  const wide = (count: number) => Array.from({ length: count }, (_, i) => `S${i + 1}`);
  expect(IMPORT_HARD_MAX_COLUMNS).toBe(256);
  expect(() => parseDelimited(`${wide(256).join(";")}\n${wide(256).join(";")}`)).not.toThrow();
  for (const read of [
    () => parseDelimited(`${wide(257).join(";")}\n${wide(257).join(";")}`),
    () => parseXlsx(buildXlsx([wide(257), wide(257)])),
  ]) {
    let error: unknown;
    try {
      read();
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(ImportParseError);
    expect((error as ImportParseError).code).toBe("TOO_MANY_COLUMNS");
    expect((error as ImportParseError).message).toContain("256 sütundan fazlası");
  }
});
