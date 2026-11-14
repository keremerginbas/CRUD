import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { resetSignupAttempts } from "../server/workspaces";
import { senetText } from "../server/senet-pdf";
import { buildDocx } from "../shared/docx-fill";
import type { Sale } from "../shared/senet";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let dataDir = "";
beforeEach(async () => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "XRE_SESSION_SECRET"])
    delete process.env[key];
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xre-sales-test-"));
  process.env.XRE_DATA_DIR = dataDir;
  resetSignupAttempts();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  await fs.rm(dataDir, { recursive: true, force: true });
});

type Call = (method: string, path: string, body?: unknown) => Promise<Response>;
const today = () => new Date().toISOString().slice(0, 10);
const PARTIES = {
  buyerName: "Şükrü Müşteri",
  buyerTckn: "10000000146",
  buyerAddress: "Örnek Mah. 1. Sk. No:1 Kadıköy/İstanbul",
  buyerPhone: "",
  buyerEmail: "",
  guarantorName: "",
  guarantorTckn: "",
  guarantorAddress: "",
  issuePlace: "İstanbul",
  contractDate: today(),
  lateInterestMonthlyPct: 3,
};

async function setup() {
  process.env.MANUS_PROJECT_ID = "sales-test";
  process.env.MANUS_JWT_SECRET = "test-only-sales-secret";
  const store = createMemoryStore();
  await store.claimOwner({ openId: "o", name: "Sahip" });
  const employee = (id: string, openId: string, name: string, roleId: string) =>
    store.put("employee", id, { id, openId, name, active: true, roleId, departmentId: "d", title: "", phone: "", email: "" }, "o");
  await employee("e-m", "m", "Birinci Danışman", "sales");
  await employee("e-m2", "m2", "İkinci Danışman", "sales");
  await store.put("lead", "lead-m", { id: "lead-m", name: "Şükrü Müşteri", phone: "+90 555 000 00 00", email: "", company: "", owner: "Birinci Danışman", stage: "new", value: 0, source: "manual", notes: "", tags: [], createdAt: new Date().toISOString(), lastActivity: new Date().toISOString() }, "o");
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const session = async (openId: string, name: string): Promise<Call> => {
    const cookie = `webdev_app_session=${await createSessionToken({ openId, name })}`;
    return (method, url, body) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const owner = await session("o", "Sahip");
  const member = await session("m", "Birinci Danışman");
  const member2 = await session("m2", "İkinci Danışman");
  expect((await owner("POST", "/api/projects", { id: "p1", name: "Örnek Vadi Konutları", city: "İstanbul", district: "Kartal" })).status).toBe(201);
  expect((await owner("POST", "/api/units", { id: "u1", projectId: "p1", block: "A", floor: 3, unitNo: "1", type: "3+1", grossM2: 145, netM2: 118, listPrice: 4_200_000, currency: "TRY" })).status).toBe(201);
  expect(
    (await owner("PUT", "/api/quotes/settings", { vadeFarkiMonthlyPct: 1.1111111111, discountMonthlyPct: 2.5, commissionPct: 2, maxMonths: 120, minDownPaymentPct: 10, quoteValidDays: 7, optionOnApproval: true, companyName: "Örnek Yapı A.Ş.", companyAddress: "Kadıköy / İstanbul", companyPhone: "0216" })).status,
  ).toBe(200);
  const created = await member("POST", "/api/quotes", { unitId: "u1", leadId: "lead-m", salePrice: 4_000_000, downPayment: 1_000_000, months: 60, balloons: [], startDate: today(), note: "" });
  expect(created.status).toBe(201);
  const id = (await created.json()).quote.id as string;
  return { owner, member, member2, id };
}

describe("Satış belgeleri — sözleşme ve senet", () => {
  it("onaydan önce düzenlenmez; onaydan sonra senetler oluşur, ödeme işaretlenir, sözleşme ve PDF üretilir", async () => {
    const { owner, member, member2, id } = await setup();
    expect((await member("PUT", `/api/quotes/${id}/sale`, PARTIES)).status).toBe(409);
    expect((await member("GET", `/api/quotes/${id}/contract.docx`)).status).toBe(409);
    expect((await member("POST", `/api/quotes/${id}/submit`, {})).status).toBe(200);
    expect((await owner("POST", `/api/quotes/${id}/approve`, {})).status).toBe(200);

    expect((await member("PUT", `/api/quotes/${id}/sale`, { ...PARTIES, buyerTckn: "12345678901" })).status).toBe(400);
    const saved = await member("PUT", `/api/quotes/${id}/sale`, PARTIES);
    expect(saved.status).toBe(200);
    const sale = (await saved.json()).sale as Sale;
    expect(sale.senets).toHaveLength(60);
    expect(sale.senets[0]).toMatchObject({ no: 1, of: 60, amount: 83_333.33, status: "bekliyor" });
    expect(Math.round(sale.senets.reduce((a, s) => a + s.amount * 100, 0)) / 100).toBe(5_000_000);

    // Başka danışman bu satışı göremez.
    expect((await member2("GET", `/api/quotes/${id}/sale`)).status).toBe(404);
    expect((await member2("GET", `/api/quotes/${id}/senets.pdf`)).status).toBe(404);

    const paid = await member("POST", `/api/quotes/${id}/sale/senets/1`, { paid: true, paidAt: today() });
    expect(paid.status).toBe(200);
    expect((await paid.json()).sale.senets[0]).toMatchObject({ status: "ödendi", paidAt: today() });
    expect((await member("POST", `/api/quotes/${id}/sale/senets/999`, { paid: true })).status).toBe(404);
    // Alıcı bilgisi yeniden kaydedilince ödendi işareti korunur.
    const again = (await (await member("PUT", `/api/quotes/${id}/sale`, { ...PARTIES, issuePlace: "Ankara" })).json()).sale as Sale;
    expect(again.senets[0].status).toBe("ödendi");

    const book = await (await owner("GET", "/api/quotes/senets")).json();
    expect(book.sales).toHaveLength(1);
    expect(book.sales[0]).toMatchObject({ customer: "Şükrü Müşteri", projectName: "Örnek Vadi Konutları", lateInterestMonthlyPct: 3 });
    expect((await (await member2("GET", "/api/quotes/senets")).json()).sales).toHaveLength(0);

    const docx = await member("GET", `/api/quotes/${id}/contract.docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    const xml = strFromU8(unzipSync(new Uint8Array(await docx.arrayBuffer()))["word/document.xml"]);
    expect(xml).toContain("Şükrü Müşteri");
    expect(xml).toContain("Örnek Yapı A.Ş.");
    expect(xml).toContain("Yalnız Altı Milyon Türk Lirası");
    expect(xml).not.toContain("{{");

    const pdf = await member("GET", `/api/quotes/${id}/senets.pdf`);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const text = senetText({ quote: { quoteNo: "T-1", unit: { projectName: "P", block: "A", unitNo: "1" } as never }, sale: again, companyName: "Örnek Yapı A.Ş." }, 1);
    expect(text.body).toContain("Sayın Örnek Yapı A.Ş. veya emruhavalesine");
    expect(text.body).toContain("Yalnız Seksen Üç Bin Üç Yüz Otuz Üç Türk Lirası Otuz Üç Kuruş");
    expect(text.body).toContain("Ankara mahkemelerinin");
  });

  it("sözleşme şablonunu yalnız yönetici yükler; yüklenen şablon kullanılır, bilinmeyen alan bildirilir", async () => {
    const { owner, member, id } = await setup();
    await member("POST", `/api/quotes/${id}/submit`, {});
    await owner("POST", `/api/quotes/${id}/approve`, {});
    await member("PUT", `/api/quotes/${id}/sale`, PARTIES);
    const tpl = Buffer.from(buildDocx([{ text: "ÖZEL ŞABLON — {{alici_adi}} / {{satis_bedeli}} / {{olmayan_alan}}" }, { text: "{{senet_listesi}}" }])).toString("base64");
    expect((await member("PUT", "/api/quotes/contract-template", { name: "sozlesme.docx", dataBase64: tpl })).status).toBe(403);
    expect((await owner("PUT", "/api/quotes/contract-template", { name: "sozlesme.pdf", dataBase64: tpl })).status).toBe(400);
    expect((await owner("PUT", "/api/quotes/contract-template", { name: "sozlesme.docx", dataBase64: Buffer.from("docx değil").toString("base64") })).status).toBe(400);
    const up = await owner("PUT", "/api/quotes/contract-template", { name: "sozlesme.docx", dataBase64: tpl });
    expect(up.status).toBe(200);
    expect((await up.json()).template).toMatchObject({ custom: true, name: "sozlesme.docx", unknown: ["olmayan_alan"] });
    const xml = strFromU8(unzipSync(new Uint8Array(await (await member("GET", `/api/quotes/${id}/contract.docx`)).arrayBuffer()))["word/document.xml"]);
    expect(xml).toContain("ÖZEL ŞABLON — Şükrü Müşteri / 4.000.000,00 TL / {{olmayan_alan}}");
    expect(xml).toContain("<w:tbl>");
    expect((await owner("DELETE", "/api/quotes/contract-template", {})).status).toBe(200);
    expect((await (await member("GET", "/api/quotes/contract-template")).json()).template.custom).toBe(false);
    expect((await member("GET", "/api/quotes/contract-template/file")).status).toBe(200);
  });
});
