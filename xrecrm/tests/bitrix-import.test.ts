import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createMemoryStore } from "../server/db";
import {
  createImportJob,
  maskBitrixWebhook,
  normalizeBitrixWebhook,
  previewBitrix,
  registerBitrixImportRoutes,
  resetBitrixImportJobs,
  runBitrixImport,
  setBitrixFetch,
  setBitrixSleepMs,
  stripHtml,
  type BitrixFetch,
} from "../server/bitrix-import";
import { suggestStageMapping } from "../shared/bitrix-import";

const WEBHOOK = "https://demo.bitrix24.com.tr/rest/1/secretkey123/";
const OWNER = "owner-1";

type Row = Record<string, any>;

function fakeBitrix(data: Record<string, Row[]>, opts: { rateLimitOnce?: string } = {}) {
  const calls: { method: string; params: Row }[] = [];
  let limited = false;
  const fetch: BitrixFetch = async (url, init) => {
    expect(url.startsWith(WEBHOOK)).toBe(true);
    const method = url.slice(WEBHOOK.length).replace(/\.json$/, "");
    const params = JSON.parse(String(init.body || "{}"));
    calls.push({ method, params });
    if (opts.rateLimitOnce === method && !limited) {
      limited = true;
      return new Response(JSON.stringify({ error: "QUERY_LIMIT_EXCEEDED", error_description: "Too many requests" }), { status: 503 });
    }
    let rows = data[method];
    if (!rows) return new Response(JSON.stringify({ error: "ERROR_METHOD_NOT_FOUND", error_description: "Method not found" }), { status: 404 });
    const idFilter = params.filter?.ID;
    if (Array.isArray(idFilter)) rows = rows.filter((row) => idFilter.map(String).includes(String(row.ID)));
    const start = Number(params.start || 0);
    const page = rows.slice(start, start + 50);
    const body: Row = { result: page, total: rows.length };
    if (start + 50 < rows.length) body.next = start + 50;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fetch, calls };
}

function sampleData(): Record<string, Row[]> {
  const leads: Row[] = Array.from({ length: 60 }, (_, i) => ({
    ID: String(i + 1),
    TITLE: `Lead ${i + 1}`,
    NAME: `Ad${i + 1}`,
    LAST_NAME: "Soyad",
    STATUS_ID: i % 3 === 0 ? "NEW" : i % 3 === 1 ? "IN_PROCESS" : "CONVERTED",
    SOURCE_ID: i === 0 ? "CALL" : "WEB",
    ASSIGNED_BY_ID: "7",
    OPPORTUNITY: "1500.00",
    COMMENTS: i === 0 ? "<p>Merhaba <b>dünya</b></p>" : "",
    ADDRESS_CITY: "İstanbul",
    DATE_CREATE: "2025-01-10T10:00:00+03:00",
    DATE_MODIFY: "2025-02-10T10:00:00+03:00",
    PHONE: [{ VALUE: `0532 111 ${String(1000 + i)}`, VALUE_TYPE: "WORK" }],
    EMAIL: [{ VALUE: `lead${i + 1}@example.com`, VALUE_TYPE: "WORK" }],
    UF_CRM_BUDGET: i === 0 ? "3+1" : "",
    UF_CRM_EMPTY: null,
  }));
  return {
    "user.get": [
      { ID: "7", NAME: "Ayşe", LAST_NAME: "Yılmaz" },
      { ID: "8", NAME: "Mehmet", LAST_NAME: "Kaya" },
    ],
    "crm.status.list": [
      { ENTITY_ID: "STATUS", STATUS_ID: "NEW", NAME: "Yeni", SORT: 10 },
      { ENTITY_ID: "STATUS", STATUS_ID: "IN_PROCESS", NAME: "İşlemde", SORT: 20 },
      { ENTITY_ID: "STATUS", STATUS_ID: "CONVERTED", NAME: "Dönüştü", SORT: 30, SEMANTICS: "S" },
      { ENTITY_ID: "STATUS", STATUS_ID: "JUNK", NAME: "Çöp", SORT: 40, SEMANTICS: "F" },
      { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "NEW", NAME: "Yeni", SORT: 10 },
      { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "PREPARATION", NAME: "Hazırlık", SORT: 20 },
      { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "EXECUTING", NAME: "Yürütme", SORT: 30 },
      { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "FINAL_INVOICE", NAME: "Fatura", SORT: 40 },
      { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "WON", NAME: "Kazanıldı", SORT: 50, SEMANTICS: "S" },
      { ENTITY_ID: "DEAL_STAGE", STATUS_ID: "LOSE", NAME: "Kaybedildi", SORT: 60, SEMANTICS: "F" },
      { ENTITY_ID: "SOURCE", STATUS_ID: "FB", NAME: "Facebook" },
    ],
    "crm.dealcategory.list": [],
    "crm.lead.list": leads,
    "crm.contact.list": [
      {
        ID: "5",
        NAME: "Zeynep",
        LAST_NAME: "Demir",
        PHONE: [{ VALUE: "+90 (555) 222 33 44", VALUE_TYPE: "MOBILE" }],
        EMAIL: [{ VALUE: "zeynep@example.com", VALUE_TYPE: "WORK" }],
        COMPANY_ID: "3",
        ASSIGNED_BY_ID: "8",
        DATE_CREATE: "2025-01-01T09:00:00+03:00",
        DATE_MODIFY: "2025-01-02T09:00:00+03:00",
      },
    ],
    "crm.company.list": [
      { ID: "3", TITLE: "Demir İnşaat", INDUSTRY: "CONSTRUCTION", PHONE: [], EMAIL: [{ VALUE: "not-an-email" }], DATE_CREATE: "2025-01-01T09:00:00+03:00" },
    ],
    "crm.deal.list": [
      {
        ID: "11",
        TITLE: "Daire satışı",
        STAGE_ID: "EXECUTING",
        CATEGORY_ID: "0",
        OPPORTUNITY: "2500000",
        CONTACT_ID: "5",
        COMPANY_ID: "3",
        ASSIGNED_BY_ID: "8",
        SOURCE_ID: "FB",
        DATE_CREATE: "2025-03-01T09:00:00+03:00",
        DATE_MODIFY: "2025-03-05T09:00:00+03:00",
        UF_CRM_PROJECT: ["A Blok", "B Blok"],
      },
    ],
    "crm.activity.list": [
      {
        ID: "900",
        OWNER_TYPE_ID: "2",
        OWNER_ID: "11",
        TYPE_ID: "1",
        SUBJECT: "Ofis görüşmesi",
        DESCRIPTION: "Saat <b>14:00</b>",
        START_TIME: "2025-03-03T14:00:00+03:00",
        END_TIME: "",
        COMPLETED: "Y",
        RESPONSIBLE_ID: "8",
        CREATED: "2025-03-02T10:00:00+03:00",
      },
      { ID: "901", OWNER_TYPE_ID: "1", OWNER_ID: "2", TYPE_ID: "6", SUBJECT: "", COMPLETED: "N", CREATED: "2025-03-02T10:00:00+03:00" },
    ],
    "voximplant.statistic.get": [
      {
        ID: "1",
        CALL_ID: "externalCall.abc/1",
        CALL_TYPE: "2",
        PHONE_NUMBER: "+905321111001",
        CALL_DURATION: "95",
        CALL_FAILED_CODE: "200",
        CALL_START_DATE: "2025-03-04T11:00:00+03:00",
        PORTAL_USER_ID: "7",
        CALL_RECORD_URL: "https://demo.bitrix24.com.tr/rec/1.mp3",
      },
      {
        ID: "2",
        CALL_ID: "c2",
        CALL_TYPE: "1",
        PHONE_NUMBER: "05552223344",
        CALL_DURATION: "0",
        CALL_FAILED_CODE: "304",
        CALL_START_DATE: "2025-03-04T12:00:00+03:00",
        PORTAL_USER_ID: "8",
        CRM_ENTITY_TYPE: "DEAL",
        CRM_ENTITY_ID: "11",
      },
    ],
  };
}

afterEach(() => {
  setBitrixFetch(null);
  setBitrixSleepMs(null);
  resetBitrixImportJobs();
});

describe("suggestStageMapping", () => {
  it("maps semantics and distributes process stages by SORT", () => {
    const map = suggestStageMapping([
      { STATUS_ID: "LOSE", SORT: 70, SEMANTICS: "F" },
      { STATUS_ID: "D", SORT: 40 },
      { STATUS_ID: "A", SORT: 10 },
      { STATUS_ID: "C", SORT: 30 },
      { STATUS_ID: "B", SORT: 20 },
      { STATUS_ID: "E", SORT: 50 },
      { STATUS_ID: "WON", SORT: 60, SEMANTICS: "S" },
    ]);
    expect(map).toEqual({
      A: "new",
      B: "contacted",
      C: "contacted",
      D: "qualified",
      E: "proposal",
      WON: "won",
      LOSE: "lost",
    });
  });

  it("handles small lists and id-based semantics fallback", () => {
    expect(suggestStageMapping([{ STATUS_ID: "X", SORT: 1 }])).toEqual({ X: "new" });
    expect(suggestStageMapping([{ STATUS_ID: "X" }, { STATUS_ID: "Y", SORT: 5 }])).toEqual({ X: "new", Y: "proposal" });
    expect(
      suggestStageMapping([
        { STATUS_ID: "A", SORT: 1 },
        { STATUS_ID: "B", SORT: 2 },
        { STATUS_ID: "C", SORT: 3 },
        { STATUS_ID: "C1:WON", SORT: 4 },
        { STATUS_ID: "JUNK", SORT: 5 },
      ]),
    ).toEqual({ A: "new", B: "contacted", C: "proposal", "C1:WON": "won", JUNK: "lost" });
  });
});

describe("webhook helpers", () => {
  it("validates and masks the webhook", () => {
    expect(normalizeBitrixWebhook("https://demo.bitrix24.com.tr/rest/1/secretkey123")).toBe(WEBHOOK);
    expect(normalizeBitrixWebhook("https://demo.bitrix24.com.tr/rest/1/secretkey123/profile.json")).toBe(WEBHOOK);
    expect(() => normalizeBitrixWebhook("http://demo.bitrix24.com.tr/rest/1/abc/")).toThrow(/HTTPS/);
    expect(() => normalizeBitrixWebhook("https://demo.bitrix24.com.tr/foo/")).toThrow();
    expect(maskBitrixWebhook(WEBHOOK)).not.toContain("secretkey123");
    expect(stripHtml("<p>Merhaba&nbsp;<b>dünya</b></p>")).toBe("Merhaba dünya");
  });
});

describe("runBitrixImport", () => {
  it("imports all entities, is idempotent and leaves non-bx records alone", async () => {
    const store = createMemoryStore();
    const untouched = {
      id: "lead-local",
      name: "Yerel müşteri",
      phone: "905559999999",
      email: "",
      company: "",
      stage: "new",
      owner: "",
      value: 0,
      source: "Web",
      notes: "dokunma",
      createdAt: "2024-01-01T00:00:00.000Z",
      lastActivity: "2024-01-01T00:00:00.000Z",
      tags: [],
    };
    await store.put("lead", "lead-local", untouched, OWNER);
    const fake = fakeBitrix(sampleData(), { rateLimitOnce: "crm.deal.list" });
    const options = {
      webhookUrl: WEBHOOK,
      entities: ["companies", "contacts", "leads", "deals", "activities", "calls"] as const,
      stageMap: { "lead:IN_PROCESS": "qualified" as const },
    };
    const job = await runBitrixImport(store, OWNER, { ...options, entities: [...options.entities] }, undefined, {
      fetch: fake.fetch,
      sleepMs: 0,
    });
    expect(job.errors).toEqual([]);
    expect(job.status).toBe("completed");
    expect(job.entities.leads).toEqual({ total: 60, imported: 60, updated: 0, failed: 0 });
    expect(job.entities.deals).toMatchObject({ total: 1, imported: 1 });
    expect(job.entities.calls).toMatchObject({ total: 2, imported: 2 });
    // İki sayfa okundu.
    expect(fake.calls.filter((c) => c.method === "crm.lead.list").map((c) => c.params.start)).toEqual([0, 50]);

    const leads = await store.list<any>("lead", OWNER);
    expect(leads).toHaveLength(62);
    const lead1 = (await store.get<any>("lead", "bx-lead-1", OWNER))!.payload;
    expect(lead1).toMatchObject({
      name: "Ad1 Soyad",
      phone: "905321111000",
      email: "lead1@example.com",
      stage: "new",
      owner: "Ayşe Yılmaz",
      value: 1500,
      source: "Telefon",
      city: "İstanbul",
      notes: "Merhaba dünya",
      bitrixId: "1",
      bitrixType: "lead",
      customFields: { UF_CRM_BUDGET: "3+1" },
    });
    expect(lead1.createdAt).toBe("2025-01-10T07:00:00.000Z");
    expect((await store.get<any>("lead", "bx-lead-2", OWNER))!.payload.stage).toBe("qualified");
    expect((await store.get<any>("lead", "bx-lead-3", OWNER))!.payload.stage).toBe("won");

    const deal = (await store.get<any>("lead", "bx-deal-11", OWNER))!.payload;
    expect(deal).toMatchObject({
      name: "Zeynep Demir",
      phone: "905552223344",
      email: "zeynep@example.com",
      company: "Demir İnşaat",
      dealTitle: "Daire satışı",
      value: 2500000,
      stage: "qualified",
      owner: "Mehmet Kaya",
      source: "Facebook",
      contactId: "bx-contact-5",
      companyId: "bx-company-3",
      bitrixType: "deal",
      customFields: { UF_CRM_PROJECT: "A Blok, B Blok" },
    });

    const contact = (await store.get<any>("contacts", "bx-contact-5", OWNER))!.payload;
    expect(contact).toMatchObject({ name: "Zeynep Demir", phone: "905552223344", companyId: "bx-company-3" });
    const company = (await store.get<any>("companies", "bx-company-3", OWNER))!.payload;
    expect(company).toMatchObject({ name: "Demir İnşaat", email: "" });

    const meeting = (await store.get<any>("activities", "bx-activity-900", OWNER))!.payload;
    expect(meeting).toMatchObject({ type: "meeting", leadId: "bx-deal-11", completed: true, description: "Saat 14:00", assignee: "Mehmet Kaya" });
    expect(Date.parse(meeting.endAt) - Date.parse(meeting.startAt)).toBe(30 * 60_000);
    const task = (await store.get<any>("activities", "bx-activity-901", OWNER))!.payload;
    expect(task).toMatchObject({ type: "task", leadId: "bx-lead-2", completed: false, title: "Bitrix görevi" });

    const calls = await store.list<any>("call", OWNER);
    expect(calls).toHaveLength(2);
    const inbound = calls.find((c) => c.payload.bitrixId === "1")!.payload;
    expect(inbound).toMatchObject({
      direction: "inbound",
      status: "ended",
      durationSeconds: 95,
      leadId: "bx-lead-2", // telefon eşleşmesi: 0532 111 1001
      agent: "Ayşe Yılmaz",
      recording: "https://demo.bitrix24.com.tr/rec/1.mp3",
      phone: "905321111001",
    });
    expect(inbound.id).toBe("bx-call-externalCall.abc_1");
    const outbound = calls.find((c) => c.payload.bitrixId === "2")!.payload;
    expect(outbound).toMatchObject({ direction: "outbound", status: "missed", leadId: "bx-deal-11" });

    // XRE tarafında eklenen alanlar korunur.
    await store.put("lead", "bx-lead-1", { ...lead1, appointmentAt: "2025-05-01T10:00:00.000Z", tags: ["VIP"] }, OWNER);

    const second = await runBitrixImport(store, OWNER, { ...options, entities: [...options.entities] }, undefined, {
      fetch: fake.fetch,
      sleepMs: 0,
    });
    expect(second.status).toBe("completed");
    expect(second.entities.leads).toEqual({ total: 60, imported: 0, updated: 60, failed: 0 });
    expect(second.entities.calls).toMatchObject({ imported: 0, updated: 2 });
    expect(await store.list("lead", OWNER)).toHaveLength(62);
    expect(await store.list("call", OWNER)).toHaveLength(2);
    expect(await store.list("activities", OWNER)).toHaveLength(2);
    const lead1Again = (await store.get<any>("lead", "bx-lead-1", OWNER))!.payload;
    expect(lead1Again.appointmentAt).toBe("2025-05-01T10:00:00.000Z");
    expect(lead1Again.tags).toContain("VIP");
    expect((await store.get<any>("lead", "lead-local", OWNER))!.payload).toEqual(untouched);
  });

  it("supports cancellation and records failures", async () => {
    const store = createMemoryStore();
    const fake = fakeBitrix(sampleData());
    const job = createImportJob(OWNER, WEBHOOK, ["leads"]);
    job.cancelRequested = true;
    const result = await runBitrixImport(store, OWNER, { webhookUrl: WEBHOOK, entities: ["leads"] }, job, {
      fetch: fake.fetch,
      sleepMs: 0,
    });
    expect(result.status).toBe("cancelled");
    expect(await store.list("lead", OWNER)).toHaveLength(0);

    const broken = fakeBitrix({ "user.get": [] });
    const failed = await runBitrixImport(store, OWNER, { webhookUrl: WEBHOOK, entities: ["leads"] }, undefined, {
      fetch: broken.fetch,
      sleepMs: 0,
    });
    expect(failed.status).toBe("failed");
    expect(failed.errors.join(" ")).toMatch(/Bitrix24 hatası/);
    expect(failed.errors.join(" ")).not.toContain("secretkey123");
  });
});

describe("preview + routes", () => {
  it("returns counts and stage suggestions without leaking the secret", async () => {
    const fake = fakeBitrix(sampleData());
    const preview = await previewBitrix(WEBHOOK, { fetch: fake.fetch, sleepMs: 0 });
    expect(preview.counts).toMatchObject({ leads: 60, deals: 1, contacts: 1, companies: 1, activities: 2, calls: 2 });
    expect(preview.userCount).toBe(2);
    expect(preview.stageMap).toMatchObject({
      "lead:NEW": "new",
      "lead:IN_PROCESS": "proposal",
      "lead:CONVERTED": "won",
      "lead:JUNK": "lost",
      "deal:NEW": "new",
      "deal:PREPARATION": "contacted",
      "deal:EXECUTING": "qualified",
      "deal:FINAL_INVOICE": "proposal",
      "deal:WON": "won",
      "deal:LOSE": "lost",
    });
    expect(JSON.stringify(preview)).not.toContain("secretkey123");
  });

  it("runs a background job through the HTTP routes", async () => {
    const fake = fakeBitrix(sampleData());
    setBitrixFetch(fake.fetch);
    setBitrixSleepMs(0);
    const store = createMemoryStore();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).auth = { ownerOpenId: OWNER, user: { openId: OWNER }, isOwner: true };
      next();
    });
    registerBitrixImportRoutes(app, store);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
      const bad = await post("/api/bitrix-import/preview", { webhookUrl: "https://example.com/nope" });
      expect(bad.status).toBe(400);
      const preview = await post("/api/bitrix-import/preview", { webhookUrl: WEBHOOK });
      expect(preview.status).toBe(200);
      expect(await preview.text()).not.toContain("secretkey123");

      const start = await post("/api/bitrix-import/start", { webhookUrl: WEBHOOK, entities: ["leads", "calls"] });
      expect(start.status).toBe(202);
      const { jobId } = await start.json();
      expect(jobId).toBeTruthy();
      let status: any;
      for (let i = 0; i < 200; i++) {
        status = await (await fetch(`${base}/api/bitrix-import/status`)).json();
        if (status.status !== "running") break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(status).toMatchObject({ id: jobId, status: "completed" });
      expect(status.entities.leads.imported).toBe(60);
      expect(JSON.stringify(status)).not.toContain("secretkey123");
      expect(await store.list("lead", OWNER)).toHaveLength(60);
      const cancel = await post("/api/bitrix-import/cancel", {});
      expect(cancel.status).toBe(409);
    } finally {
      server.close();
    }
  });
});
