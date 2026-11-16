// PostgreSQL deposu testleri: PG_TEST_URL verilmezse atlanır (normal test çalıştırmasını etkilemez).
// Örnek: PG_TEST_URL=postgres://xre:xre@pg-test:5432/xretest npx vitest run tests/pg-store.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { PgStore } from "../server/pg-store";
import { createApp } from "../server/app";
import { createSessionToken } from "../server/auth";

const url = process.env.PG_TEST_URL;
const suite = url ? describe : describe.skip;

async function reset() {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP TABLE IF EXISTS xre_records, xre_events, xre_meta");
  await c.end();
}

suite("PostgreSQL deposu", () => {
  let store: PgStore;
  beforeEach(async () => {
    await reset();
    delete process.env.XRE_IMPORT_FROM_FILE;
    delete process.env.XRE_OWNER_OPEN_ID;
    store = new PgStore(url);
    await store.init();
  });
  afterAll(async () => {
    await store?.close();
  });

  it("kayıt yazar, okur, günceller; listeler en yeniden eskiye", async () => {
    await store.put("lead", "a", { name: "A", n: 1 }, "o1");
    await new Promise((r) => setTimeout(r, 5));
    await store.put("lead", "b", { name: "B" }, "o1");
    await store.put("lead", "x", { name: "başka sahip" }, "o2");
    const first = await store.get<any>("lead", "a", "o1");
    expect(first?.payload).toEqual({ name: "A", n: 1 });
    const updated = await store.put("lead", "a", { name: "A2" }, "o1");
    expect(updated.payload).toEqual({ name: "A2" });
    expect(updated.createdAt).toBe(first?.createdAt); // oluşturma zamanı korunur
    expect((await store.list("lead", "o1")).map((r) => r.id)).toEqual(["b", "a"]);
    expect(await store.get("lead", "x", "o1")).toBeNull();
  });

  it("insertIfAbsent ve delete", async () => {
    expect((await store.insertIfAbsent("contacts", "c1", { name: "K" }, "o1")).inserted).toBe(true);
    const again = await store.insertIfAbsent("contacts", "c1", { name: "değişmemeli" }, "o1");
    expect(again).toEqual({ inserted: false, record: null });
    expect((await store.get<any>("contacts", "c1", "o1"))?.payload.name).toBe("K");
    await store.delete("contacts", "c1", "o1");
    expect(await store.get("contacts", "c1", "o1")).toBeNull();
  });

  it("Türkçe karakter, iç içe veri ve \\u0000 içeren metin güvenle saklanır", async () => {
    const payload = { ad: "Şükrü Çağlayan İğdır", nested: { list: [1, "ğ", null], ok: true }, bozuk: "a\u0000b" };
    await store.put("lead", "t", payload, "o1");
    const back = await store.get<any>("lead", "t", "o1");
    expect(back?.payload.ad).toBe("Şükrü Çağlayan İğdır");
    expect(back?.payload.nested).toEqual({ list: [1, "ğ", null], ok: true });
    expect(back?.payload.bozuk).toBe("ab");
  });

  it("ilk kullanıcı sahip olur, ikincisi olmaz", async () => {
    const a = await store.claimOwner({ openId: "u1", name: "Bir" } as any);
    const b = await store.claimOwner({ openId: "u2", name: "İki" } as any);
    expect(a).toEqual({ ownerOpenId: "u1", isOwner: true });
    expect(b).toEqual({ ownerOpenId: "u1", isOwner: false });
    expect(await store.resolveOwner()).toBe("u1");
  });

  it("olay kuyruğu: tekrar anahtarı, güncelleme, sırayla ve bir kez iş alma", async () => {
    const e1 = await store.appendEvent("o1", "k1", { a: 1 });
    const dup = await store.appendEvent("o1", "k1", { a: 2 });
    expect(e1.inserted).toBe(true);
    expect(dup.inserted).toBe(false);
    expect(dup.event.id).toBe(e1.event.id);
    await store.appendEvent("o1", "k2", { a: 3 });
    await store.appendEvent("o1", "k3", { a: 4 }, "completed");
    await store.appendEvent("o1", "k4", { a: 5 }, "pending", new Date(Date.now() + 3600_000).toISOString());
    // İki eşzamanlı çalışan aynı olayı iki kez alamaz.
    const [x, y] = await Promise.all([store.claimDueEvents(10), store.claimDueEvents(10)]);
    const claimed = [...x, ...y].map((e) => e.eventKey).sort();
    expect(claimed).toEqual(["k1", "k2"]);
    expect([...x, ...y].every((e) => e.status === "processing" && e.attempts === 1)).toBe(true);
    const done = await store.updateEvent(e1.event.id, "o1", { status: "completed", lastError: null, payload: { a: 9 } });
    expect(done?.status).toBe("completed");
    expect(done?.payload).toEqual({ a: 9 });
    expect(await store.getEvent(e1.event.id, "başka")).toBeNull();
    expect(await store.getEvent("olmayan", "o1")).toBeNull();
    expect((await store.listEvents("o1")).length).toBe(4);
  });

  it("yedek alıp geri yükleme birebir aynı veriyi verir; olay sayacı devam eder", async () => {
    await store.put("lead", "a", { name: "A" }, "o1");
    await store.put("tasks", "t", { title: "T" }, "o1");
    const ev = await store.appendEvent("o1", "k1", { a: 1 });
    const dump = await store.dumpAll();
    await store.put("lead", "z", { name: "silinecek" }, "o1");
    await store.restoreAll(dump);
    expect((await store.list("lead", "o1")).map((r) => r.id)).toEqual(["a"]);
    expect((await store.get<any>("tasks", "t", "o1"))?.payload.title).toBe("T");
    const next = await store.appendEvent("o1", "k2", {});
    expect(Number(next.event.id)).toBeGreaterThan(Number(ev.event.id));
  });

  it("boş veritabanında eski JSON dosyasını aktarır, doluyken dokunmaz", async () => {
    await store.close();
    await reset();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xre-pg-"));
    const file = path.join(dir, "xrecrm-data.json");
    await fs.writeFile(
      file,
      JSON.stringify({
        version: 1,
        nextEventId: 8,
        records: [
          { kind: "user", id: "sahip", payload: { openId: "sahip" }, ownerOpenId: "sahip", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
          { kind: "lead", id: "l1", payload: { name: "Eski" }, ownerOpenId: "sahip", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" },
        ],
        events: [{ id: "7", eventKey: "e7", ownerOpenId: "sahip", status: "completed", attempts: 1, nextAttemptAt: null, lastError: null, payload: { x: 1 }, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" }],
      }),
    );
    process.env.XRE_IMPORT_FROM_FILE = file;
    store = new PgStore(url);
    await store.init();
    expect(await store.resolveOwner()).toBe("sahip");
    const lead = await store.get<any>("lead", "l1", "sahip");
    expect(lead?.payload.name).toBe("Eski");
    expect(lead?.createdAt).toBe("2026-10-02T00:00:00.000Z");
    expect((await store.getEvent("7", "sahip"))?.eventKey).toBe("e7");
    expect(Number((await store.appendEvent("sahip", "yeni", {})).event.id)).toBe(8);
    // İkinci açılışta (veri varken) dosya yeniden aktarılmaz.
    await store.put("lead", "l2", { name: "Yeni" }, "sahip");
    await store.close();
    store = new PgStore(url);
    await store.init();
    expect((await store.list("lead", "sahip")).length).toBe(2);
    expect(await fs.readFile(file, "utf8")).toContain("Eski"); // dosya yerinde
  });

  it("CRM uç noktaları PostgreSQL üzerinde çalışır (müşteri, düzenleme, silme)", async () => {
    process.env.MANUS_PROJECT_ID = "pg-test";
    process.env.MANUS_JWT_SECRET = "pg-secret";
    process.env.XRE_OWNER_OPEN_ID = "pg-owner";
    const server = http.createServer(createApp({ store }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    const token = await createSessionToken({ openId: "pg-owner", name: "PG Sahip" });
    const headers = { cookie: `webdev_app_session=${token}`, "content-type": "application/json" };
    const call = async (p: string, method = "GET", body?: unknown) => {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    try {
      const now = new Date().toISOString();
      const lead = { id: "pg1", name: "PG Müşteri", phone: "+90 555 111 22 33", email: "pg@example.com", company: "", stage: "new", owner: "PG Sahip", value: 10, source: "Manuel", notes: "", createdAt: now, lastActivity: now, tags: ["pg"], pipelineId: "sales" };
      expect((await call("/api/leads", "POST", { lead })).status).toBe(201);
      expect((await call("/api/leads/pg1", "PATCH", { stage: "contacted" })).status).toBe(200);
      let state = (await call("/api/state")).body;
      expect(state.leads.find((l: any) => l.id === "pg1").stage).toBe("contacted");
      expect(state.stageHistory.length).toBeGreaterThan(0);
      expect((await call("/api/leads/pg1", "DELETE")).status).toBe(200);
      state = (await call("/api/state")).body;
      expect(state.leads.some((l: any) => l.id === "pg1")).toBe(false);
      expect((await call("/health")).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
