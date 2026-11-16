import { it, expect, afterEach } from "vitest";
import http from "node:http";
import {
  parseDelimited,
  mapDelimitedRows,
  previewImportRows,
} from "../shared/crm-import";
import { createMemoryStore } from "../server/db";
import { createApp } from "../server/app";
import { createSessionToken } from "../server/auth";
const savedEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});
it("BOM, noktalı virgül, tırnak ve çok satırlı notları çözer; elle eşleme ve bozuk dosyayı doğrular", () => {
  const parsed = parseDelimited(
    '\uFEFFAd;Telefon;Notlar\r\n"Test, Kişi";05551000001;"İlk satır\nİkinci ""alıntı"""',
  );
  expect(parsed.rows[0][2]).toContain('İkinci "alıntı"');
  expect(mapDelimitedRows(parsed, "contacts")[0].raw.phone).toBe("05551000001");
  expect(
    mapDelimitedRows(parsed, "contacts", ["name", "phone", "notes"])[0].issues,
  ).toHaveLength(0);
  expect(
    mapDelimitedRows(parsed, "contacts", ["name", "name", "notes"])[0].issues[0]
      .code,
  ).toBe("DUPLICATE_MAPPING");
  expect(() => parseDelimited('Ad,Not\nTest,"eksik')).toThrow();
  expect(() => parseDelimited("Ad\n1\n2", { maxRows: 1 })).toThrow();
});
it("yanlış telefon/e-posta ve dosya mükerrerini güvenli önizler", () => {
  const p = previewImportRows(
    "contacts",
    [
      { raw: { name: "A", phone: "05551000001" } },
      { raw: { name: "B", phone: "+905551000001" } },
      { raw: { name: "C", phone: "xxxx", email: "kötü" } },
    ],
    {},
  );
  expect(p.counts).toEqual({ total: 3, ready: 1, duplicate: 1, error: 1 });
});
it("önizleme yazmaz; commit ekler, aynı istek yinelenmez ve mevcut kayıt üzerine yazılmaz", async () => {
  process.env.MANUS_PROJECT_ID = "import-test";
  process.env.MANUS_JWT_SECRET = "local-import-secret";
  process.env.XRE_OWNER_OPEN_ID = "import-owner";
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "import-owner" });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  const rows = [
    { name: "İlk kişi", phone: "05551000001" },
    { name: "İkinci kişi", phone: "+905551000001" },
    { name: "Hatalı", email: "yanlış" },
  ];
  const send = (path: string, body: any) =>
    fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
  try {
    expect(
      (await send("/api/crm-import/preview", { kind: "contacts", rows }))
        .status,
    ).toBe(200);
    expect(await store.list("contacts", "import-owner")).toHaveLength(0);
    const operationId = crypto.randomUUID();
    const first = await send("/api/crm-import/commit", {
      kind: "contacts",
      rows,
      operationId,
    });
    expect(first.status).toBe(200);
    const report = await first.json();
    expect(report.counts).toMatchObject({ created: 1, skipped: 1, errors: 1 });
    const same = await (
      await send("/api/crm-import/commit", {
        kind: "contacts",
        rows,
        operationId,
      })
    ).json();
    expect(same).toEqual(report);
    expect(await store.list("contacts", "import-owner")).toHaveLength(1);
    expect(
      (
        await send("/api/crm-import/commit", {
          kind: "contacts",
          rows: [{ name: "Başka kişi" }],
          operationId,
        })
      ).status,
    ).toBe(409);
    const old = (await store.list<any>("contacts", "import-owner"))[0];
    await send("/api/crm-import/commit", {
      kind: "contacts",
      rows: [{ name: "Üzerine yazma", phone: "+905551000001" }],
      operationId: crypto.randomUUID(),
    });
    expect(
      (await store.get<any>("contacts", old.id, "import-owner"))?.payload.name,
    ).toBe("İlk kişi");
    const concurrent = { kind: "contacts", rows: [{ name: "Aynı yeni kişi" }] };
    await Promise.all([
      send("/api/crm-import/commit", {
        ...concurrent,
        operationId: crypto.randomUUID(),
      }),
      send("/api/crm-import/commit", {
        ...concurrent,
        operationId: crypto.randomUUID(),
      }),
    ]);
    expect(await store.list("contacts", "import-owner")).toHaveLength(2);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
it("müşteri aktarımı: ülke kaydedilir; proje adı mevcut projeye bağlanır, eşleşmezse metin olarak kalır", async () => {
  process.env.MANUS_PROJECT_ID = "import-test";
  process.env.MANUS_JWT_SECRET = "local-import-secret";
  process.env.XRE_OWNER_OPEN_ID = "import-owner";
  const store = createMemoryStore();
  const stamp = new Date().toISOString();
  const project = (id: string, name: string, archived = false) =>
    store.put("re_project", id, { id, name, archived, createdAt: stamp, updatedAt: stamp }, "import-owner");
  await project("prj-1", "Işık Vadisi");
  await project("prj-2", "Eski Proje", true);
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "import-owner" });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  const send = (path: string, body: any) =>
    fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
  const rows = [
    // Büyük/küçük harf farkı Türkçe kurallarıyla giderilir (I → ı, İ → i).
    { name: "Ayşe Yılmaz", phone: "05550000001", city: "İzmir", country: "Türkiye", project: "IŞIK VADİSİ" },
    { name: "Mehmet Örnek", phone: "05550000002", country: "Almanya", project: "Henüz Açılmamış Proje" },
    { name: "Zeynep Deneme", phone: "05550000003", project: "Eski Proje" },
    { name: "Ali Test", phone: "05550000004" },
    { name: "Uzun Ülke", phone: "05550000005", country: "x".repeat(121) },
  ];
  try {
    const preview = await (await send("/api/crm-import/preview", { kind: "leads", rows })).json();
    expect(preview.counts).toEqual({ total: 5, ready: 4, duplicate: 0, error: 1 });
    const report = await (
      await send("/api/crm-import/commit", { kind: "leads", rows, operationId: crypto.randomUUID() })
    ).json();
    expect(report.counts).toMatchObject({ created: 4, skipped: 0, errors: 1 });
    const leads = (await store.list<any>("lead", "import-owner")).map((r) => r.payload);
    const byName = (name: string) => leads.find((lead) => lead.name === name);
    expect(byName("Ayşe Yılmaz")).toMatchObject({
      city: "İzmir",
      country: "Türkiye",
      dealTitle: "Işık Vadisi",
      projectId: "prj-1",
      projectName: "Işık Vadisi",
    });
    const unmatched = byName("Mehmet Örnek");
    expect(unmatched).toMatchObject({ country: "Almanya", dealTitle: "Henüz Açılmamış Proje" });
    expect(unmatched.projectId).toBeUndefined();
    // Arşivlenmiş proje eşleşmez; metin yine de kartta kalır.
    expect(byName("Zeynep Deneme")).toMatchObject({ dealTitle: "Eski Proje" });
    expect(byName("Zeynep Deneme").projectId).toBeUndefined();
    expect(byName("Ali Test").dealTitle).toBeUndefined();
    expect(byName("Ali Test").country).toBeUndefined();
    // Eşleşmeyen ad için proje kaydı uydurulmaz.
    expect(await store.list("re_project", "import-owner")).toHaveLength(2);
    // Aynı dosya yeniden yüklenirse mükerrer denetimi eskisi gibi çalışır.
    const again = await (
      await send("/api/crm-import/commit", { kind: "leads", rows, operationId: crypto.randomUUID() })
    ).json();
    expect(again.counts).toMatchObject({ created: 0 });
    expect(await store.list("lead", "import-owner")).toHaveLength(4);
    // Listede olmayan alanlar eskisi gibi reddedilir.
    const unknown = await (
      await send("/api/crm-import/preview", { kind: "leads", rows: [{ name: "X", bilinmeyen: "1" }] })
    ).json();
    expect(unknown.rows[0].issues[0].code).toBe("UNKNOWN_FIELD");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

async function importServer() {
  process.env.MANUS_PROJECT_ID = "import-test";
  process.env.MANUS_JWT_SECRET = "local-import-secret";
  process.env.XRE_OWNER_OPEN_ID = "import-owner";
  const store = createMemoryStore();
  const stamp = new Date().toISOString();
  const project = (id: string, name: string, archived = false) =>
    store.put("re_project", id, { id, name, archived, createdAt: stamp, updatedAt: stamp }, "import-owner");
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "import-owner" });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  const send = async (path: string, body: any) =>
    (await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) })).json();
  const leads = async () => (await store.list<any>("lead", "import-owner")).map((r) => r.payload);
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { store, project, send, leads, close };
}
it("proje adı Türkçe klavye kullanılmadan büyük/küçük yazılsa da eşleşir; aynı adlı iki proje varsa satır bağlanmaz ve uyarır", async () => {
  const { project, send, leads, close } = await importServer();
  await project("prj-sky", "Skyline Residence");
  await project("prj-city", "CITY TOWERS");
  await project("prj-isik", "Işık Evleri");
  await project("prj-isik-2", "İşik Evleri");
  await project("prj-vadi-1", "Vadi Evleri");
  await project("prj-vadi-2", "VADİ EVLERİ");
  const rows = [
    // Excel BÜYÜKHARF() ya da İngilizce klavye: "I" Türkçe kuralla "ı" olur, yine de eşleşmeli.
    { name: "Ayşe Yılmaz", phone: "05550000001", project: "SKYLINE RESIDENCE" },
    // Tersi: proje büyük harfle kayıtlı, dosyada küçük harfli.
    { name: "Mehmet Örnek", phone: "05550000002", project: "City Towers" },
    // Birebir (Türkçe duyarlı) eşleşme varsa o seçilir; benzer adlı diğer proje karıştırılmaz.
    { name: "Zeynep Deneme", phone: "05550000003", project: "işik evleri" },
    // Aynı adı taşıyan iki proje: hangisi olduğu bilinemez.
    { name: "Ali Test", phone: "05550000004", project: "Vadi Evleri" },
  ];
  try {
    const preview = await send("/api/crm-import/preview", { kind: "leads", rows });
    expect(preview.counts).toEqual({ total: 4, ready: 3, duplicate: 0, error: 1 });
    expect(preview.rows[3].issues[0].code).toBe("AMBIGUOUS_REFERENCE");
    expect(preview.rows[3].issues[0].message).toContain("birden fazla proje");
    const report = await send("/api/crm-import/commit", { kind: "leads", rows, operationId: crypto.randomUUID() });
    expect(report.counts).toMatchObject({ created: 3, errors: 1 });
    const byName = async (name: string) => (await leads()).find((lead) => lead.name === name);
    expect(await byName("Ayşe Yılmaz")).toMatchObject({
      dealTitle: "Skyline Residence",
      projectId: "prj-sky",
      projectName: "Skyline Residence",
    });
    expect(await byName("Mehmet Örnek")).toMatchObject({ projectId: "prj-city", projectName: "CITY TOWERS" });
    expect(await byName("Zeynep Deneme")).toMatchObject({ projectId: "prj-isik-2" });
    expect(await byName("Ali Test")).toBeUndefined();
  } finally {
    close();
  }
});
it("ülke/proje sütunu tanınmadan önce aktarılmış telefonsuz satır, aynı dosya yeniden yüklenince ikinci kez eklenmez", async () => {
  const { send, leads, close } = await importServer();
  try {
    // Eski sürüm: "Ülke" ve "Proje" sütunları atlanıyordu; kimlik bu alanlar olmadan hesaplandı.
    const before = await send("/api/crm-import/commit", {
      kind: "leads",
      rows: [{ name: "Ayşe Yılmaz", city: "İzmir" }],
      operationId: crypto.randomUUID(),
    });
    expect(before.counts).toMatchObject({ created: 1 });
    // Aynı dosya şimdi: iki sütun otomatik eşleniyor.
    const rows = [{ name: "Ayşe Yılmaz", city: "İzmir", country: "Türkiye", project: "Örnek Proje" }];
    const again = await send("/api/crm-import/commit", { kind: "leads", rows, operationId: crypto.randomUUID() });
    expect(again.counts).toMatchObject({ created: 0, recovered: 1, errors: 0 });
    expect(await leads()).toHaveLength(1);
    // Eski kaydı olmayan satır yeni alanlarıyla eklenir; ülkesi farklı adaşlar ayrı kayıt olur.
    const fresh = await send("/api/crm-import/commit", {
      kind: "leads",
      rows: [
        { name: "Mehmet Örnek", country: "Türkiye" },
        { name: "Mehmet Örnek", country: "Almanya" },
      ],
      operationId: crypto.randomUUID(),
    });
    expect(fresh.counts).toMatchObject({ created: 2 });
    expect(await leads()).toHaveLength(3);
    // Yeni alanlarla eklenen kayıt yeniden yüklenince de tekrar eklenmez.
    const repeat = await send("/api/crm-import/commit", {
      kind: "leads",
      rows: [{ name: "Mehmet Örnek", country: "Almanya" }],
      operationId: crypto.randomUUID(),
    });
    expect(repeat.counts).toMatchObject({ created: 0, recovered: 1 });
    expect(await leads()).toHaveLength(3);
  } finally {
    close();
  }
});
