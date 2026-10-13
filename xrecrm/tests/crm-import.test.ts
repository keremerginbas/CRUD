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
