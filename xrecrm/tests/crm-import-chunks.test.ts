import { it, expect, afterEach } from "vitest";
import http from "node:http";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  parseDelimited,
  mapDelimitedRows,
  previewImportRows,
  type ImportPreviewRow,
} from "../shared/crm-import";
import {
  IMPORT_CHUNK_ROWS,
  IMPORT_TOTAL_MAX_ROWS,
  IMPORT_TOTAL_MAX_XLSX_BYTES,
  createCommitAccumulator,
  createPreviewAccumulator,
  planImportChunks,
  remapChunkRows,
  runImportChunks,
  splitFileDuplicates,
  type ImportSourceRow,
} from "../shared/crm-import-chunks";
import { strToU8, zipSync } from "fflate";
import { parseXlsx } from "../shared/xlsx-read";
import { createMemoryStore } from "../server/db";
import { createApp } from "../server/app";
import { createSessionToken } from "../server/auth";

const savedEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env))
    if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

/** 0555 000 xx xx aralığını aşmamak için sıra numarası e-postaya yazılır. */
function sourceRows(count: number, extra: Partial<Record<string, string>> = {}): ImportSourceRow[] {
  return Array.from({ length: count }, (_, i) => ({
    rowNumber: i + 2,
    raw: { name: `Kişi ${i + 1}`, email: `kisi${i + 1}@example.test`, ...extra },
    issues: [],
  }));
}
const bodyBytes = (body: unknown) =>
  new TextEncoder().encode(JSON.stringify(body)).length;

it("büyük dosyayı sunucu sınırlarının altında, dosya satır numaralarını koruyan parçalara böler", () => {
  const rows = sourceRows(12_345);
  const plan = planImportChunks("contacts", rows);
  expect(plan.totalRows).toBe(12_345);
  expect(plan.fileDuplicates).toHaveLength(0);
  expect(plan.chunks).toHaveLength(Math.ceil(12_345 / IMPORT_CHUNK_ROWS));
  expect(plan.chunks.flatMap((c) => c.rowNumbers)).toEqual(
    rows.map((r) => r.rowNumber),
  );
  expect(new Set(plan.chunks.map((c) => c.operationId)).size).toBe(
    plan.chunks.length,
  );
  for (const chunk of plan.chunks) {
    expect(chunk.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(chunk.rows.length).toBeLessThanOrEqual(IMPORT_MAX_ROWS);
    expect(chunk.rows.length).toBe(chunk.rowNumbers.length);
    expect(
      bodyBytes({ kind: "contacts", rows: chunk.rows, operationId: chunk.operationId }),
    ).toBeLessThan(IMPORT_MAX_BYTES);
  }
  expect(plan.chunks[2].rowNumbers[0]).toBe(2 * IMPORT_CHUNK_ROWS + 2);
});

it("uzun hücreli satırlarda parçayı satır sayısından önce bayt bütçesine göre keser", () => {
  // Türkçe karakterler UTF-8'de 2 bayt: 10.000 karakterlik not ≈ 20 KB.
  const rows = sourceRows(400, { notes: "ş".repeat(10_000) });
  const plan = planImportChunks("contacts", rows);
  expect(plan.chunks.length).toBeGreaterThan(1);
  expect(plan.chunks.reduce((n, c) => n + c.rows.length, 0)).toBe(400);
  for (const chunk of plan.chunks) {
    expect(chunk.rows.length).toBeLessThan(IMPORT_CHUNK_ROWS);
    const actual = bodyBytes({
      kind: "contacts",
      rows: chunk.rows,
      operationId: chunk.operationId,
    });
    expect(actual).toBeLessThan(IMPORT_MAX_BYTES);
    expect(chunk.bytes).toBeGreaterThanOrEqual(actual);
  }
  expect(IMPORT_TOTAL_MAX_ROWS).toBeGreaterThan(IMPORT_MAX_ROWS);
});

it("farklı parçalara düşen dosya-içi mükerrerleri tek istekteki kuralla aynı şekilde ayıklar", () => {
  const rows = sourceRows(1_300);
  // 900. satır ile 2. satır aynı e-posta; 1.250. satır ile 700. satır aynı telefon (farklı yazım).
  rows[898].raw = { name: "Tekrar A", email: "KISI1@example.test" };
  rows[698].raw = { name: "Telefonlu", phone: "0555 000 12 34" };
  rows[1248].raw = { name: "Tekrar B", phone: "+90 555 000 12 34" };
  const { unique, duplicates } = splitFileDuplicates("contacts", rows);
  expect(unique).toHaveLength(1_298);
  expect(duplicates.map((d) => d.rowNumber)).toEqual([900, 1250]);
  expect(duplicates[0].status).toBe("duplicate");
  expect(duplicates[0].issues.at(-1)).toEqual({
    code: "FILE_DUPLICATE",
    message: "Dosya içinde 2. satırla aynı kayıt; atlandı.",
  });
  expect(duplicates[1].issues.at(-1)?.message).toContain("700. satırla");
  // Dosyanın tamamı tek seferde önizlenseydi çıkacak sonuçla birebir aynı.
  const whole = previewImportRows("contacts", rows, {});
  expect(
    whole.rows.filter((r) => r.status === "duplicate").map((r) => r.rowNumber),
  ).toEqual([900, 1250]);
  const plan = planImportChunks("contacts", rows);
  expect(plan.fileDuplicates.map((d) => d.rowNumber)).toEqual([900, 1250]);
  const sent = plan.chunks.flatMap((c) => c.rowNumbers);
  expect(sent).not.toContain(900);
  expect(sent).not.toContain(1250);
  expect(sent).toHaveLength(1_298);
  // Şirketlerde anahtar addır.
  const companies = splitFileDuplicates("companies", [
    { rowNumber: 2, raw: { name: "Örnek  Yapı" } },
    { rowNumber: 3, raw: { name: "örnek yapı" } },
  ]);
  expect(companies.duplicates.map((d) => d.rowNumber)).toEqual([3]);
});

it("parça yanıtlarını dosya satır numaralarına çevirir ve bozuk yanıtı reddeder", () => {
  const plan = planImportChunks("contacts", sourceRows(1_100));
  const chunk = plan.chunks[2];
  const response: ImportPreviewRow[] = chunk.rows.map((raw, i) => ({
    rowNumber: i + 2,
    raw,
    status: i === 5 ? "error" : "ready",
    issues: i === 5 ? [{ code: "INVALID_EMAIL", message: "x" }] : [],
  }));
  const mapped = remapChunkRows(chunk, response);
  expect(mapped[0].rowNumber).toBe(1_002);
  expect(mapped[5]).toMatchObject({ rowNumber: 1_007, status: "error" });
  expect(() => remapChunkRows(chunk, response.slice(1))).toThrow();
  expect(() => remapChunkRows(chunk, undefined)).toThrow();
  expect(() =>
    remapChunkRows(chunk, response.map((r) => ({ ...r, rowNumber: 2 }))),
  ).toThrow();
});

it("önizleme toplamı tüm parçaları sayar ama tabloya yalnızca baş kısmı ve sınırlı hatayı alır", () => {
  const acc = createPreviewAccumulator({ headRows: 200, issueRows: 300 });
  const row = (rowNumber: number, status: ImportPreviewRow["status"]) => ({
    rowNumber,
    raw: {},
    status,
    issues: [],
  });
  for (let start = 2; start < 50_002; start += 500)
    acc.add(
      Array.from({ length: 500 }, (_, i) =>
        row(start + i, (start + i) % 100 === 0 ? "error" : (start + i) % 7 === 0 ? "duplicate" : "ready"),
      ),
    );
  const summary = acc.summary();
  expect(summary.counts.total).toBe(50_000);
  expect(summary.counts.error).toBe(500);
  expect(summary.counts.ready + summary.counts.duplicate + summary.counts.error).toBe(50_000);
  // 200 baş satır (içinde 2 hata) + 300 hata; kalan 198 hata yalnızca sayılır.
  expect(summary.rows).toHaveLength(500);
  expect(summary.omittedErrors).toBe(500 - 2 - 300);
  expect(summary.rows[0].rowNumber).toBe(2);
  expect(summary.rows[199].rowNumber).toBe(201);
  expect(summary.rows.slice(200).every((r) => r.status === "error")).toBe(true);
  expect(summary.rows.map((r) => r.rowNumber)).toEqual(
    [...summary.rows.map((r) => r.rowNumber)].sort((a, b) => a - b),
  );
});

it("parçaları sırayla gönderir; durdurma ve hata sonrası kaldığı parçadan aynı kimlikle sürer", async () => {
  const plan = planImportChunks("contacts", sourceRows(2_300));
  expect(plan.chunks).toHaveLength(5);
  const sentOps: string[] = [];
  let inFlight = 0;
  let failOnce = true;
  let stop = false;
  const acc = createCommitAccumulator();
  const run = (startAt: number) =>
    runImportChunks({
      chunks: plan.chunks,
      startAt,
      shouldStop: () => stop,
      send: async (chunk) => {
        expect(++inFlight).toBe(1);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        sentOps.push(chunk.operationId);
        if (chunk.index === 3 && failOnce) {
          failOnce = false;
          throw new Error("ağ koptu");
        }
        return chunk.rows.map((raw, i) => ({
          rowNumber: i + 2,
          raw,
          status: "ready" as const,
          issues: [],
          created: true,
        }));
      },
      onChunk: (chunk, rows) => {
        acc.add(remapChunkRows(chunk, rows));
        if (chunk.index === 1) stop = true;
      },
    });
  const first = await run(0);
  expect(first).toEqual({ status: "stopped", nextIndex: 2 });
  expect(acc.summary().counts.created).toBe(1_000);
  stop = false;
  const second = await run(first.nextIndex);
  expect(second.status).toBe("failed");
  expect(second.nextIndex).toBe(3);
  expect((second.error as Error).message).toBe("ağ koptu");
  expect(acc.summary().counts.created).toBe(1_500);
  const third = await run(second.nextIndex);
  expect(third).toEqual({ status: "done", nextIndex: 5 });
  expect(acc.summary().counts).toMatchObject({ total: 2_300, created: 2_300 });
  // Başarısız parça aynı operationId ile yeniden gönderildi; hiçbir parça atlanmadı/çiftlenmedi.
  expect(sentOps).toEqual([0, 1, 2, 3, 3, 4].map((i) => plan.chunks[i].operationId));
});

it("commit raporu parçaları toplar: oluşturulan, kurtarılan, atlanan, hatalı", () => {
  const acc = createCommitAccumulator({ issueRows: 1 });
  const base = { raw: {}, issues: [] };
  acc.addSkipped([{ ...base, rowNumber: 9, status: "duplicate" }]);
  acc.add([
    { ...base, rowNumber: 2, status: "ready", created: true },
    { ...base, rowNumber: 3, status: "ready", recovered: true },
    { ...base, rowNumber: 4, status: "duplicate" },
  ]);
  acc.add([
    { ...base, rowNumber: 502, status: "error" },
    { ...base, rowNumber: 503, status: "error" },
  ]);
  expect(acc.summary()).toMatchObject({
    counts: { total: 6, created: 1, recovered: 1, skipped: 2, errors: 2 },
    omittedErrors: 1,
  });
  expect(acc.summary().errorRows.map((r) => r.rowNumber)).toEqual([502]);
});

it("CSV → plan: 12.000 satırlık dosya tek seferde okunur, satır numaraları dosyaya göredir", () => {
  const lines = ["Ad;E-posta;Telefon"];
  for (let i = 1; i <= 12_000; i++) lines.push(`Kişi ${i};kisi${i}@example.test;`);
  lines[7_001] = "Hatalı;bozuk-eposta;"; // dosyada 7.002. satır
  const text = lines.join("\n");
  expect(() => parseDelimited(text)).toThrow(/1\.000 veri satırından/);
  const parsed = parseDelimited(text, { maxBytes: 20_000_000, maxRows: IMPORT_TOTAL_MAX_ROWS });
  const plan = planImportChunks("contacts", mapDelimitedRows(parsed, "contacts"));
  expect(plan.totalRows).toBe(12_000);
  expect(plan.chunks).toHaveLength(24);
  const chunk = plan.chunks[14];
  const at = chunk.rowNumbers.indexOf(7_002);
  expect(chunk.rows[at].email).toBe("bozuk-eposta");
  expect(() => parseDelimited("Ad\n1\n2\n3", { maxRows: 2 })).toThrow(/2 veri satırından/);
  expect(() => parseDelimited("Ad\nabcdef", { maxBytes: 5 })).toThrow(/sınırını aşıyor/);
});

it("Excel okuyucu: varsayılan sınır korunur, büyük dosya sınırı yalnızca açıkça istenince uygulanır", () => {
  const sheet = (count: number) =>
    zipSync({
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Ad</t></is></c><c r="B1" t="inlineStr"><is><t>E-posta</t></is></c></row>${Array.from(
          { length: count },
          (_, i) =>
            `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>Kişi ${i + 1}</t></is></c><c r="B${i + 2}" t="inlineStr"><is><t>kisi${i + 1}@example.test</t></is></c></row>`,
        ).join("")}</sheetData></worksheet>`,
      ),
    });
  const bytes = sheet(2_500);
  expect(() => parseXlsx(bytes)).toThrow(/1\.000 veri satırından/);
  const parsed = parseXlsx(bytes, {
    maxBytes: IMPORT_TOTAL_MAX_XLSX_BYTES,
    maxRows: IMPORT_TOTAL_MAX_ROWS,
  });
  expect(parsed.rows).toHaveLength(2_500);
  const plan = planImportChunks("contacts", mapDelimitedRows(parsed, "contacts"));
  expect(plan.chunks.map((c) => c.rows.length)).toEqual([500, 500, 500, 500, 500]);
  expect(plan.chunks[4].rowNumbers.at(-1)).toBe(2_501);
  expect(() => parseXlsx(bytes, { maxRows: 2_499 })).toThrow(/2\.499 veri satırından/);
  expect(() => parseXlsx(bytes, { maxBytes: 100 })).toThrow(/sınırını aşıyor/);
  expect(() => parseXlsx(bytes, { maxUnzippedBytes: 1_000 })).toThrow(/çok büyük/);
});

it("gerçek uç noktalar: parçalı commit yinelenmez, parçalar arası mükerrer depoda yakalanır", async () => {
  process.env.MANUS_PROJECT_ID = "import-chunk-test";
  process.env.MANUS_JWT_SECRET = "local-import-secret";
  process.env.XRE_OWNER_OPEN_ID = "chunk-owner";
  const store = createMemoryStore();
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "chunk-owner" });
  const headers = {
    cookie: `webdev_app_session=${token}`,
    "content-type": "application/json",
  };
  const post = async (path: string, body: any) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return r.json();
  };
  const count = async () => (await store.list("contacts", "chunk-owner")).length;
  try {
    const rows = sourceRows(1_750);
    rows[1_300].raw = { name: "Hatalı", email: "bozuk" }; // dosyada 1.302. satır, 3. parça
    rows[1_600].raw = { name: "Tekrar", email: "kisi3@example.test" }; // 1.602. satır = 4. satır
    const plan = planImportChunks("contacts", rows);
    expect(plan.chunks.map((c) => c.rows.length)).toEqual([500, 500, 500, 249]);
    expect(plan.fileDuplicates.map((d) => d.rowNumber)).toEqual([1_602]);

    // 1) Önizleme: hiçbir parça yazmaz; toplamlar tüm dosyayı kapsar.
    const previewAcc = createPreviewAccumulator();
    previewAcc.add(plan.fileDuplicates);
    const previewed = await runImportChunks({
      chunks: plan.chunks,
      send: (chunk) => post("/api/crm-import/preview", { kind: "contacts", rows: chunk.rows }),
      onChunk: (chunk, res: any) => previewAcc.add(remapChunkRows(chunk, res.rows)),
    });
    expect(previewed.status).toBe("done");
    expect(previewAcc.summary().counts).toEqual({
      total: 1_750,
      ready: 1_748,
      duplicate: 1,
      error: 1,
    });
    expect(
      previewAcc.summary().rows.find((r) => r.status === "error")?.rowNumber,
    ).toBe(1_302);
    expect(await count()).toBe(0);

    // 2) Commit: 3. parçanın yanıtı "kaybolur" (sunucu işledi, istemci görmedi).
    const commitAcc = createCommitAccumulator();
    commitAcc.addSkipped(plan.fileDuplicates);
    let dropResponse = true;
    const commitRun = (startAt: number) =>
      runImportChunks({
        chunks: plan.chunks,
        startAt,
        send: async (chunk) => {
          const res = await post("/api/crm-import/commit", {
            kind: "contacts",
            rows: chunk.rows,
            operationId: chunk.operationId,
          });
          if (chunk.index === 2 && dropResponse) {
            dropResponse = false;
            throw new Error("bağlantı koptu");
          }
          return res;
        },
        onChunk: (chunk, res: any) => commitAcc.add(remapChunkRows(chunk, res.rows)),
      });
    const interrupted = await commitRun(0);
    expect(interrupted).toMatchObject({ status: "failed", nextIndex: 2 });
    expect(commitAcc.summary().counts.created).toBe(1_000);
    expect(await count()).toBe(1_499); // 3. parça sunucuda işlendi (499 geçerli satır)

    // 3) Kaldığı yerden: aynı operationId → kayıtlı yanıt döner, kayıt çiftlenmez.
    const resumed = await commitRun(interrupted.nextIndex);
    expect(resumed).toEqual({ status: "done", nextIndex: 4 });
    const report = commitAcc.summary();
    expect(report.counts).toEqual({
      total: 1_750,
      created: 1_748,
      recovered: 0,
      skipped: 1,
      errors: 1,
    });
    expect(report.errorRows.map((r) => r.rowNumber)).toEqual([1_302]);
    expect(await count()).toBe(1_748);

    // 4) İstemci ayıklaması atlansa bile: önceki parçada eklenen kayıtla aynı e-posta/telefon
    //    sonraki istekte depodaki kayıt üzerinden mükerrer olarak yakalanır.
    const bypassPreview = await post("/api/crm-import/preview", {
      kind: "contacts",
      rows: [{ name: "Başka ad", email: "KISI3@example.test" }],
    });
    expect(bypassPreview.rows[0].status).toBe("duplicate");
    expect(bypassPreview.rows[0].issues[0].code).toBe("EXISTING_DUPLICATE");
    const bypassCommit = await post("/api/crm-import/commit", {
      kind: "contacts",
      rows: [
        { name: "Başka ad", email: "KISI3@example.test" },
        { name: "Yeni kişi", phone: "0555 000 00 01" },
      ],
      operationId: crypto.randomUUID(),
    });
    expect(bypassCommit.counts).toMatchObject({ created: 1, skipped: 1 });
    const later = await post("/api/crm-import/commit", {
      kind: "contacts",
      rows: [{ name: "Sonraki parça", phone: "+90 555 000 00 01" }],
      operationId: crypto.randomUUID(),
    });
    expect(later.counts).toMatchObject({ created: 0, skipped: 1 });
    expect(await count()).toBe(1_749);

    // 5) Operasyon kaydı hiç yazılmamış gibi (yeni kimlikle) aynı parça yeniden gönderilirse
    //    satırlar "daha önce eklenmiş" sayılır; yine çiftlenmez.
    const replay = await post("/api/crm-import/commit", {
      kind: "contacts",
      rows: plan.chunks[0].rows,
      operationId: crypto.randomUUID(),
    });
    expect(replay.counts).toMatchObject({ created: 0, recovered: 500, errors: 0 });
    expect(await count()).toBe(1_749);

    // 6) Sunucunun istek başına sınırları değişmedi.
    await expect(
      post("/api/crm-import/preview", {
        kind: "contacts",
        rows: sourceRows(IMPORT_MAX_ROWS + 1).map((r) => r.raw),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      post("/api/crm-import/commit", {
        kind: "contacts",
        rows: [{ name: "Büyük", notes: "x".repeat(IMPORT_MAX_BYTES) }],
        operationId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(
      post("/api/crm-import/commit", {
        kind: "contacts",
        rows: [{ name: "Farklı gövde" }],
        operationId: plan.chunks[0].operationId,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await count()).toBe(1_749);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}, 60_000);

it("kapsam dışı kayıtla mükerrer satır parçalı aktarımda da sızdırılmadan atlanır", async () => {
  process.env.MANUS_PROJECT_ID = "import-scope-test";
  process.env.MANUS_JWT_SECRET = "local-import-secret";
  delete process.env.XRE_OWNER_OPEN_ID;
  delete process.env.MANUS_OWNER_OPEN_ID;
  const store = createMemoryStore();
  await store.claimOwner({ openId: "o", name: "Sahip" });
  await store.put(
    "employee",
    "e",
    { id: "e", openId: "m", name: "Satış", active: true, roleId: "sales", departmentId: "d", title: "", phone: "", email: "" },
    "o",
  );
  const stamp = new Date().toISOString();
  for (const [id, owner] of [["mine", "Satış"], ["other", "Başkası"]])
    await store.put(
      "lead",
      id,
      { id, name: id, phone: "", email: `${id}@example.test`, company: "", owner, stage: "new", value: 0, source: "manual", notes: "", tags: [], createdAt: stamp, lastActivity: stamp },
      "o",
    );
  const server = http.createServer(createApp({ store }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const token = await createSessionToken({ openId: "m", name: "Satış" });
  const post = async (path: string, body: any) =>
    (
      await fetch(base + path, {
        method: "POST",
        headers: { cookie: `webdev_app_session=${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json();
  try {
    const rows = [
      { name: "Gizli mükerrer", email: "OTHER@example.test" },
      { name: "Görünür mükerrer", email: "mine@example.test" },
      { name: "Yeni müşteri", email: "yeni@example.test" },
    ];
    const preview = await post("/api/crm-import/preview", { kind: "leads", rows });
    expect(preview.rows.map((r: any) => r.status)).toEqual(["duplicate", "duplicate", "ready"]);
    expect(preview.rows[0].unavailable).toBe(true);
    expect(preview.rows[0].candidateId).toBeUndefined();
    expect(preview.rows[0].issues.map((i: any) => i.code)).toContain("DUPLICATE_UNAVAILABLE");
    expect(JSON.stringify(preview.rows[0])).not.toContain('"other"');
    expect(preview.rows[1].candidateId).toBe("mine");
    const first = await post("/api/crm-import/commit", { kind: "leads", rows, operationId: crypto.randomUUID() });
    expect(first.counts).toMatchObject({ created: 1, skipped: 2, errors: 0 });
    // Sonraki parça: önceki parçada eklenen kayıt ve kapsam dışı kayıt yine atlanır.
    const second = await post("/api/crm-import/commit", {
      kind: "leads",
      rows: [
        { name: "Aynı e-posta", email: "Yeni@example.test" },
        { name: "Gizli yine", email: "other@example.test" },
      ],
      operationId: crypto.randomUUID(),
    });
    expect(second.counts).toMatchObject({ created: 0, skipped: 2 });
    expect(second.rows[1].candidateId).toBeUndefined();
    expect(await store.list("lead", "o")).toHaveLength(3);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}, 30_000);
