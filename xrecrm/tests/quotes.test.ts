import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promises as fs } from "node:fs";
import { createApp } from "../server/app";
import { createMemoryStore } from "../server/db";
import { createSessionToken } from "../server/auth";
import { resetSignupAttempts } from "../server/workspaces";
import { PDF_WATERMARK } from "../server/quote-pdf";
import { defaultRole } from "../shared/access";
import { UNIT_KIND } from "../shared/real-estate";
import {
  COST_CSV_HEADER,
  QUOTE_KIND,
  QUOTE_SETTINGS_KIND,
  QUOTE_TRANSITIONS,
  QuoteSettingsSchema,
  commissionSummary,
  costCsv,
  costRows,
  costTotals,
  createQuote,
  formatAmount,
  formatPct,
  nextQuoteSeq,
  transitionQuote,
  unitEffects,
  visibleQuote,
  type Quote,
  type QuoteActor,
  type QuoteSettings,
} from "../shared/quotes";

const savedEnv = { ...process.env };
const servers: http.Server[] = [];
let dataDir = "";

beforeEach(async () => {
  for (const key of ["MANUS_JWT_SECRET", "MANUS_PROJECT_ID", "XRE_OWNER_OPEN_ID", "MANUS_OWNER_OPEN_ID", "MANUS_OAUTH_PORTAL_URL", "XRE_SIGNUP", "XRE_SIGNUP_VERIFY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "XRE_SESSION_SECRET"])
    delete process.env[key];
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "xre-quotes-test-"));
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
async function listen(store = createMemoryStore()) {
  const server = http.createServer(createApp({ store }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const make =
    (cookie: string): Call =>
    (method, url, body) =>
      fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { store, base, make };
}
const cookieOf = (res: Response) => (res.headers.get("set-cookie") || "").split(";")[0];

const SETTINGS = {
  vadeFarkiMonthlyPct: 1.1111111111,
  discountMonthlyPct: 2.5,
  commissionPct: 2,
  maxMonths: 120,
  minDownPaymentPct: 10,
  quoteValidDays: 7,
  optionOnApproval: true,
  companyName: "Örnek Yapı Gayrimenkul A.Ş.",
  companyAddress: "Örnek Mah. Çınar Sok. No: 4, Kadıköy / İstanbul",
  companyPhone: "0 (216) 555 00 00",
};
const today = () => new Date().toISOString().slice(0, 10);
const lead = (id: string, name: string, owner: string) => ({
  id, name, phone: "+90 555 000 00 00", email: "", company: "", owner, stage: "new", value: 0, source: "manual", notes: "", tags: [],
  createdAt: new Date().toISOString(), lastActivity: new Date().toISOString(),
});
const draft = (extra: Record<string, unknown> = {}) => ({
  unitId: "u1", leadId: "lead-m", salePrice: 4_000_000, downPayment: 1_000_000, months: 60, balloons: [], startDate: today(), note: "", ...extra,
});

/** Sahip (o), yönetici rolünde çalışan (g) ve iki satış danışmanı (m, m2). */
async function team(options: { settings?: boolean } = {}) {
  process.env.MANUS_PROJECT_ID = "quotes-test";
  process.env.MANUS_JWT_SECRET = "test-only-quotes-secret";
  const store = createMemoryStore();
  await store.claimOwner({ openId: "o", name: "Sahip" });
  const employee = (id: string, openId: string, name: string, roleId: string) =>
    store.put("employee", id, { id, openId, name, active: true, roleId, departmentId: "d", title: "", phone: "", email: "" }, "o");
  await employee("e-m", "m", "Işıl Çağdaş Öğütçü", "sales");
  await employee("e-m2", "m2", "İkinci Danışman", "sales");
  await employee("e-g", "g", "Genel Müdür", "manager");
  await employee("e-x", "x", "Gözlemci", "observer");
  await store.put("lead", "lead-m", lead("lead-m", "Şükrü Müşteri", "Işıl Çağdaş Öğütçü"), "o");
  await store.put("lead", "lead-m2", lead("lead-m2", "Öteki Müşteri", "İkinci Danışman"), "o");
  const ctx = await listen(store);
  const session = async (openId: string, name: string) => ctx.make(`webdev_app_session=${await createSessionToken({ openId, name })}`);
  const owner = await session("o", "Sahip");
  const member = await session("m", "Işıl Çağdaş Öğütçü");
  const member2 = await session("m2", "İkinci Danışman");
  const manager = await session("g", "Genel Müdür");
  const observer = await session("x", "Gözlemci");
  expect((await owner("POST", "/api/projects", { id: "p1", name: "Örnek Vadi Konutları", city: "İstanbul", district: "Kartal" })).status).toBe(201);
  const unit = (id: string, unitNo: string, listPrice: number, extra: Record<string, unknown> = {}) =>
    owner("POST", "/api/units", { id, projectId: "p1", block: "A", floor: 3, unitNo, type: "3+1", grossM2: 145, netM2: 118, listPrice, currency: "TRY", ...extra });
  for (const [id, no, price] of [["u1", "1", 4_200_000], ["u2", "2", 3_000_000], ["u3", "3", 2_000_000], ["u4", "4", 3_400_000]] as const)
    expect((await unit(id, no, price)).status).toBe(201);
  expect((await unit("u-usd", "5", 100_000, { currency: "USD" })).status).toBe(201);
  expect((await unit("u-sold", "6", 1_500_000, { status: "satıldı" })).status).toBe(201);
  if (options.settings !== false) expect((await owner("PUT", "/api/quotes/settings", SETTINGS)).status).toBe(200);
  const unitStatus = async (id: string) => (await store.get<any>(UNIT_KIND, id, "o"))?.payload.status;
  const create = async (as: Call, extra: Record<string, unknown> = {}) => {
    const res = await as("POST", "/api/quotes", draft(extra));
    expect(res.status).toBe(201);
    return (await res.json()).quote as Quote;
  };
  const act = (as: Call, id: string, action: string, body: unknown = {}) => as("POST", `/api/quotes/${id}/${action}`, body);
  const stored = async (id: string) => (await store.get<Quote>(QUOTE_KIND, id, "o"))!.payload;
  return { ...ctx, owner, member, member2, manager, observer, unitStatus, create, act, stored };
}

// ---------------------------------------------------------------------------
// PDF'ten metin çıkarma (test yardımcısı): gömülü yazı tipinin ToUnicode tablosu çözülür.
// ---------------------------------------------------------------------------
function pdfText(pdf: Buffer): string {
  const source = pdf.toString("latin1");
  const objects = new Map<number, { dict: string; stream: Buffer | null }>();
  const objectPattern = /(\d+) 0 obj\s*([\s\S]*?)\s*endobj/g;
  for (let match = objectPattern.exec(source); match; match = objectPattern.exec(source)) {
    const body = match[2];
    const at = body.indexOf("stream");
    if (at < 0) {
      objects.set(Number(match[1]), { dict: body, stream: null });
      continue;
    }
    const dict = body.slice(0, at);
    const start = body.indexOf("\n", at) + 1;
    const bytes = Buffer.from(body.slice(start, body.lastIndexOf("endstream")).replace(/\r?\n$/, ""), "latin1");
    objects.set(Number(match[1]), { dict, stream: /FlateDecode/.test(dict) ? zlib.inflateSync(bytes) : bytes });
  }
  const cmaps = new Map<string, Map<string, string>>();
  for (const { dict } of objects.values()) {
    const fontRefs = /\/(F\d+) (\d+) 0 R/g;
    for (let ref = fontRefs.exec(dict); ref; ref = fontRefs.exec(dict)) {
      const toUnicode = /\/ToUnicode (\d+) 0 R/.exec(objects.get(Number(ref[2]))?.dict || "");
      const cmapSource = toUnicode ? objects.get(Number(toUnicode[1]))?.stream?.toString("latin1") || "" : "";
      const map = new Map<string, string>();
      const utf16 = (hex: string) => (hex.replace(/\s+/g, "").match(/.{4}/g) || []).map((code) => String.fromCharCode(parseInt(code, 16))).join("");
      const ranges = /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/gi;
      for (let range = ranges.exec(cmapSource); range; range = ranges.exec(cmapSource)) {
        const first = parseInt(range[1], 16);
        (range[3].match(/<([0-9a-f ]+)>/gi) || []) // "fi" bitişik harfi iki kod noktasıdır: <0066 0069>
          .forEach((item, i) => map.set((first + i).toString(16).padStart(4, "0"), utf16(item.slice(1, -1))));
      }
      const chars = /beginbfchar([\s\S]*?)endbfchar/g;
      for (let block = chars.exec(cmapSource); block; block = chars.exec(cmapSource))
        for (const pair of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) map.set(pair[1].toLowerCase().padStart(4, "0"), utf16(pair[2]));
      cmaps.set(ref[1], map);
    }
  }
  let out = "";
  for (const { stream } of objects.values()) {
    const content = stream?.toString("latin1") || "";
    if (!/ Tf\b/.test(content) || !/TJ/.test(content)) continue;
    let font = "";
    const tokens = /\/(F\d+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ/g;
    for (let token = tokens.exec(content); token; token = tokens.exec(content)) {
      if (token[1]) font = token[1];
      else {
        const map = cmaps.get(font);
        for (const piece of token[2].matchAll(/<([0-9a-f]+)>/gi))
          out += (piece[1].match(/.{4}/g) || []).map((code) => map?.get(code.toLowerCase()) ?? "?").join("");
        out += "\n";
      }
    }
  }
  return out;
}

describe("Teklifler — ayarlar ve yetki", () => {
  it("oranları yalnız yönetici belirler; çalışan para maliyeti oranını göremez, ayar yokken teklif hazırlanamaz", async () => {
    const { owner, member, manager, observer, store } = await team({ settings: false });
    expect((await member("POST", "/api/quotes", draft())).status).toBe(409);
    expect((await member("PUT", "/api/quotes/settings", SETTINGS)).status).toBe(403);
    expect((await observer("PUT", "/api/quotes/settings", SETTINGS)).status).toBe(403);
    expect(await store.get(QUOTE_SETTINGS_KIND, "settings", "o")).toBeNull();
    expect((await owner("PUT", "/api/quotes/settings", { ...SETTINGS, discountMonthlyPct: 99 })).status).toBe(400);
    expect((await owner("PUT", "/api/quotes/settings", SETTINGS)).status).toBe(200);
    // Yönetici rolündeki çalışan da değiştirebilir.
    const changed = await manager("PUT", "/api/quotes/settings", { ...SETTINGS, commissionPct: 3 });
    expect(changed.status).toBe(200);
    expect((await changed.json()).settings).toMatchObject({ commissionPct: 3, updatedBy: "Genel Müdür" });

    const forMember = await (await member("GET", "/api/quotes/settings")).json();
    expect(forMember.manager).toBe(false);
    expect(forMember.settings.vadeFarkiMonthlyPct).toBe(1.1111111111);
    expect(forMember.settings).not.toHaveProperty("discountMonthlyPct");
    const forManager = await (await manager("GET", "/api/quotes/settings")).json();
    expect(forManager.settings.discountMonthlyPct).toBe(2.5);
    // Para maliyeti ekranı yalnız yöneticiye açıktır.
    expect((await member("GET", "/api/quotes/cost-of-money")).status).toBe(403);
    expect((await member("GET", "/api/quotes/cost-of-money.csv")).status).toBe(403);
    expect((await manager("GET", "/api/quotes/cost-of-money")).status).toBe(200);
    // Gözlemci (CRM'de yazma yetkisi yok, tekliflerde yetkisi yok) modülü kullanamaz.
    expect((await observer("GET", "/api/quotes")).status).toBe(403);
    expect((await observer("POST", "/api/quotes", draft())).status).toBe(403);
    expect((await fetch(`${(await owner("GET", "/api/quotes")).url}`)).status).toBe(401);
  });

  it("\"Teklifler\" modülünden önce kaydedilmiş rol CRM yetkisinden türetilir; yönetici yetkisi kendiliğinden verilmez", async () => {
    const { owner, manager, member, store } = await team();
    const legacy = defaultRole("manager")!;
    delete (legacy.grants as any).quotes;
    await store.put("role", "manager", legacy, "o");
    const summary = await (await manager("GET", "/api/quotes/summary")).json();
    expect(summary).toMatchObject({ manager: false });
    expect((await manager("GET", "/api/quotes")).status).toBe(200);
    expect((await manager("PUT", "/api/quotes/settings", SETTINGS)).status).toBe(403);
    // Sahip rolü açıkça yetkilendirince yönetici olur.
    const roles = (await (await owner("GET", "/api/access")).json()).roles;
    const role = roles.find((r: any) => r.id === "manager");
    expect(role.grants.quotes).toEqual({ read: true, write: false, scope: "all" });
    role.grants.quotes.write = true;
    expect((await owner("PUT", "/api/access/roles/manager", role)).status).toBe(200);
    expect((await manager("PUT", "/api/quotes/settings", SETTINGS)).status).toBe(200);
    // Satış rolünde okuma kapatılırsa çalışan modülü kullanamaz.
    const sales = defaultRole("sales")!;
    sales.grants.quotes = { read: false, write: false, scope: "own" };
    await store.put("role", "sales", sales, "o");
    expect((await member("GET", "/api/quotes")).status).toBe(403);
    expect((await (await member("GET", "/api/quotes/summary")).json()).pending).toBe(0);
  });
});

describe("Teklifler — sunucu hesabı", () => {
  it("tutarları sunucu hesaplar: istemcinin gönderdiği plan, NBD, prim, oran, durum ve numara yok sayılır", async () => {
    const { member, owner, stored } = await team();
    const res = await member("POST", "/api/quotes", {
      ...draft(),
      quoteNo: "T-1999-9999",
      status: "onaylandı",
      listPrice: 1,
      commission: 999_999,
      rates: { vadeFarkiMonthlyPct: 0, discountMonthlyPct: 0, commissionPct: 50 },
      plan: { vadeFarki: 0, totalPayable: 1, installment: 1, rows: [] },
      evaluation: { npv: 9_999_999, costOfMoney: 0, npvVsList: 5_000_000 },
      employee: { openId: "g", name: "Genel Müdür" },
      decision: { status: "onaylandı", byOpenId: "o", byName: "Sahip", at: new Date().toISOString(), note: "" },
      validUntil: "2099-01-01",
    });
    expect(res.status).toBe(201);
    const quote = (await res.json()).quote;
    expect(quote.quoteNo).toBe(`T-${new Date().getUTCFullYear()}-0001`);
    expect(quote.status).toBe("taslak");
    expect(quote.decision).toBeNull();
    expect(quote.employee).toEqual({ openId: "m", name: "Işıl Çağdaş Öğütçü" });
    expect(quote.customer).toEqual({ name: "Şükrü Müşteri", phone: "+90 555 000 00 00" });
    // Onaylı kural: 3.000.000 TL × %1,1111… × 60 ay = 2.000.000 TL vade farkı; peşinat hariç.
    expect(quote.plan).toMatchObject({ salePrice: 4_000_000, downPayment: 1_000_000, financed: 3_000_000, vadeFarki: 2_000_000, totalPayable: 6_000_000, months: 60 });
    expect(quote.plan.installment).toBeCloseTo(83_333.33, 2);
    expect(quote.plan.rows).toHaveLength(61);
    expect(quote.listPrice).toBe(4_200_000);
    expect(quote.commission).toBe(80_000); // satış bedelinin %2'si (toplam ödemenin değil)
    expect(quote.validUntil > today()).toBe(true);
    expect(quote.validUntil).not.toBe("2099-01-01");
    // Çalışan NBD, para maliyeti ve para maliyeti oranını göremez.
    expect(quote.evaluation).toEqual({ listPrice: 4_200_000, discountPct: 4.76, nominal: 6_000_000 });
    expect(quote.rates).toEqual({ vadeFarkiMonthlyPct: 1.1111111111, commissionPct: 2 });
    expect(JSON.stringify(quote)).not.toContain("npv");
    // Yönetici görür; depodaki kayıt sunucu hesabıdır.
    const full = (await (await owner("GET", `/api/quotes/${quote.id}`)).json()).quote;
    expect(full.rates).toEqual({ vadeFarkiMonthlyPct: 1.1111111111, discountMonthlyPct: 2.5, commissionPct: 2 });
    expect(full.evaluation.npv).toBeGreaterThan(3_000_000);
    expect(full.evaluation.npv).toBeLessThan(4_200_000);
    expect(full.evaluation.costOfMoney).toBeCloseTo(6_000_000 - full.evaluation.npv, 2);
    expect(full.evaluation.npvVsList).toBeCloseTo(full.evaluation.npv - 4_200_000, 2);
    expect((await stored(quote.id)).evaluation.npv).toBe(full.evaluation.npv);
  });

  it("yöneticinin sınırları (en çok taksit, en az peşinat), müşteri kapsamı ve daire uygunluğu denetlenir", async () => {
    const { member, owner } = await team();
    expect((await member("POST", "/api/quotes", draft({ months: 121 }))).status).toBe(400);
    const low = await member("POST", "/api/quotes", draft({ downPayment: 399_999 }));
    expect(low.status).toBe(400);
    expect((await low.json()).message).toMatch(/Peşinat/);
    expect((await member("POST", "/api/quotes", draft({ downPayment: 400_000 }))).status).toBe(201);
    expect((await member("POST", "/api/quotes", draft({ downPayment: 5_000_000 }))).status).toBe(400);
    expect((await member("POST", "/api/quotes", draft({ balloons: [{ month: 61, amount: 1000 }] }))).status).toBe(400);
    expect((await member("POST", "/api/quotes", draft({ leadId: "" }))).status).toBe(400);
    expect((await member("POST", "/api/quotes", draft({ leadId: "yok" }))).status).toBe(400);
    // Başka danışmanın müşterisi için teklif hazırlanamaz; sahip hazırlayabilir.
    expect((await member("POST", "/api/quotes", draft({ leadId: "lead-m2" }))).status).toBe(403);
    expect((await owner("POST", "/api/quotes", draft({ leadId: "lead-m2" }))).status).toBe(201);
    expect((await member("POST", "/api/quotes", draft({ unitId: "u-sold" }))).status).toBe(409);
    expect((await member("POST", "/api/quotes", draft({ unitId: "yok" }))).status).toBe(400);
    // Para birimi daireden gelir.
    const usd = await member("POST", "/api/quotes", draft({ unitId: "u-usd", salePrice: 100_000, downPayment: 50_000, months: 10, currency: "TRY" }));
    expect((await usd.json()).quote.inputs.currency).toBe("USD");
  });

  it("oran anlık görüntüsü: ayarlar değişse de mevcut teklif kendi oranlarıyla kalır, yeni teklif yeni oranı alır", async () => {
    const { member, owner, create, stored } = await team();
    const first = await create(member);
    expect((await owner("PUT", "/api/quotes/settings", { ...SETTINGS, vadeFarkiMonthlyPct: 2, discountMonthlyPct: 4, commissionPct: 5 })).status).toBe(200);
    const untouched = await stored(first.id);
    expect(untouched.rates).toEqual({ vadeFarkiMonthlyPct: 1.1111111111, discountMonthlyPct: 2.5, commissionPct: 2 });
    expect(untouched.plan.vadeFarki).toBe(2_000_000);
    // Düzenleme de eski oranlarla hesaplanır.
    const edited = await member("PATCH", `/api/quotes/${first.id}`, draft({ downPayment: 2_000_000, months: 30 }));
    expect(edited.status).toBe(200);
    const after = await stored(first.id);
    expect(after.rates).toEqual(untouched.rates);
    expect(after.plan.vadeFarki).toBeCloseTo(2_000_000 * 0.011111111111 * 30, 2);
    expect(after.commission).toBe(80_000);
    const second = await stored((await create(member)).id);
    expect(second.rates).toEqual({ vadeFarkiMonthlyPct: 2, discountMonthlyPct: 4, commissionPct: 5 });
    expect(second.plan.vadeFarki).toBe(3_600_000);
    expect(second.commission).toBe(200_000);
    expect(second.quoteNo).not.toBe(first.quoteNo);
  });

  it("eşzamanlı oluşturmada teklif numaraları tekil ve sıralıdır", async () => {
    const { member, owner, member2 } = await team();
    const callers = [member, owner, member2];
    const responses = await Promise.all(
      Array.from({ length: 15 }, (_, i) => callers[i % 3]("POST", "/api/quotes", draft({ leadId: i % 3 === 0 ? "lead-m" : i % 3 === 2 ? "lead-m2" : "lead-m", unitId: i % 2 ? "u1" : "u2", salePrice: 3_000_000 }))),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(15).fill(201));
    const numbers = (await Promise.all(responses.map((r) => r.json()))).map((b) => b.quote.quoteNo as string);
    expect(new Set(numbers).size).toBe(15);
    const year = new Date().getUTCFullYear();
    expect(numbers.slice().sort()).toEqual(Array.from({ length: 15 }, (_, i) => `T-${year}-${String(i + 1).padStart(4, "0")}`));
    expect(nextQuoteSeq(numbers, year)).toBe(16);
    expect(nextQuoteSeq(numbers, year + 1)).toBe(1);
  });
});

describe("Teklifler — durum makinesi ve onay", () => {
  it("taslak → onay bekliyor → onaylandı → müşteriye gönderildi → satışa döndü; yasak geçişler reddedilir", async () => {
    const { member, member2, manager, owner, create, act, stored } = await team();
    const quote = await create(member);
    // Taslak onaylanamaz, gönderilemez, satılamaz.
    for (const action of ["approve", "reject", "send", "sell"]) expect((await act(owner, quote.id, action, { reason: "fiyat" })).status).toBe(409);
    // Başka danışman teklifi göremez ve yönetemez.
    expect((await member2("GET", `/api/quotes/${quote.id}`)).status).toBe(404);
    expect((await act(member2, quote.id, "submit")).status).toBe(404);
    expect((await member2("PATCH", `/api/quotes/${quote.id}`, draft({ leadId: "lead-m2" }))).status).toBe(404);
    expect((await (await member2("GET", "/api/quotes")).json()).quotes).toHaveLength(0);

    expect((await act(member, quote.id, "submit")).status).toBe(200);
    expect((await act(member, quote.id, "submit")).status).toBe(409);
    // Çalışan kendi teklifini onaylayamaz/reddedemez; onaysız teklif gönderilemez, satılamaz.
    expect((await act(member, quote.id, "approve")).status).toBe(403);
    expect((await act(member, quote.id, "reject", { reason: "fiyat" })).status).toBe(403);
    expect((await act(member, quote.id, "send")).status).toBe(409);
    expect((await act(member, quote.id, "sell")).status).toBe(409);
    expect((await stored(quote.id)).status).toBe("onay bekliyor");

    const approved = await act(manager, quote.id, "approve", { note: "Uygun." });
    expect(approved.status).toBe(200);
    const body = (await approved.json()).quote;
    expect(body.status).toBe("onaylandı");
    expect(body.decision).toMatchObject({ status: "onaylandı", byOpenId: "g", byName: "Genel Müdür", note: "Uygun." });
    for (const action of ["approve", "reject", "submit"]) expect((await act(manager, quote.id, action, { reason: "fiyat" })).status).toBe(409);

    expect((await act(member, quote.id, "send")).status).toBe(200);
    for (const action of ["send", "approve", "submit"]) expect((await act(owner, quote.id, action)).status).toBe(409);
    // Müşteriye gönderilen teklif düzenlenemez.
    expect((await member("PATCH", `/api/quotes/${quote.id}`, draft({ downPayment: 2_000_000 }))).status).toBe(409);
    expect((await act(member, quote.id, "sell")).status).toBe(200);
    // Satışa dönen teklif son durumdur.
    for (const action of ["cancel", "sell", "send", "submit", "approve", "reject"]) expect((await act(owner, quote.id, action, { reason: "fiyat" })).status).toBe(409);
    const final = await stored(quote.id);
    expect(final.status).toBe("satışa döndü");
    expect(final.soldAt).toBeTruthy();
    expect(final.trail.map((t) => t.action)).toEqual(["oluşturuldu", "onaya gönderildi", "onaylandı", "müşteriye gönderildi", "satışa döndü"]);
    expect(final.trail.map((t) => t.byName)).toEqual(["Işıl Çağdaş Öğütçü", "Işıl Çağdaş Öğütçü", "Genel Müdür", "Işıl Çağdaş Öğütçü", "Işıl Çağdaş Öğütçü"]);
    expect((await act(owner, "yok", "approve")).status).toBe(404);
  });

  it("ret gerekçe ister; reddedilen teklif düzenlenince taslağa döner, iptal edilen teklif kapanır", async () => {
    const { member, manager, create, act, stored } = await team();
    const quote = await create(member, { submit: true });
    expect(quote.status).toBe("onay bekliyor");
    expect((await act(manager, quote.id, "reject")).status).toBe(400);
    expect((await act(manager, quote.id, "reject", { reason: "diğer" })).status).toBe(400);
    expect((await act(manager, quote.id, "reject", { reason: "uydurma" })).status).toBe(400);
    const rejected = await act(manager, quote.id, "reject", { reason: "diğer", note: "Müşteri bilgisi eksik." });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).quote.decision).toMatchObject({ status: "reddedildi", reason: "diğer", note: "Müşteri bilgisi eksik.", byName: "Genel Müdür" });
    for (const action of ["approve", "send", "sell", "submit"]) expect((await act(manager, quote.id, action)).status).toBe(409);
    const edited = await member("PATCH", `/api/quotes/${quote.id}`, draft({ note: "Bilgi tamamlandı." }));
    expect((await edited.json()).quote).toMatchObject({ status: "taslak", decision: null });
    expect((await act(member, quote.id, "submit")).status).toBe(200);
    expect((await act(member, quote.id, "cancel")).status).toBe(200);
    for (const action of ["submit", "approve", "reject", "send", "sell", "cancel"]) expect((await act(manager, quote.id, action, { reason: "fiyat" })).status).toBe(409);
    expect((await member("PATCH", `/api/quotes/${quote.id}`, draft())).status).toBe(409);
    expect((await stored(quote.id)).status).toBe("iptal");
    // Durum tablosu: onay ve ret yalnız yöneticide, son durumlardan çıkış yok.
    expect(QUOTE_TRANSITIONS.approve.managerOnly && QUOTE_TRANSITIONS.reject.managerOnly).toBe(true);
    for (const rule of Object.values(QUOTE_TRANSITIONS)) expect(rule.from).not.toContain("satışa döndü");
    for (const rule of Object.values(QUOTE_TRANSITIONS)) expect(rule.from).not.toContain("iptal");
  });

  it("onaya gönderilince yöneticilere, karar verilince çalışana bildirim düşer", async () => {
    const { member, manager, owner, create, act } = await team();
    const quote = await create(member, { submit: true });
    const inbox = async (as: Call) => (await (await as("GET", "/api/inbox")).json()).notifications as { title: string; body: string }[];
    expect((await inbox(owner)).map((n) => n.title)).toEqual([`Onay bekleyen teklif: ${quote.quoteNo}`]);
    expect((await inbox(manager)).map((n) => n.title)).toEqual([`Onay bekleyen teklif: ${quote.quoteNo}`]);
    expect((await inbox(member))).toHaveLength(0);
    expect((await (await manager("GET", "/api/quotes/summary")).json())).toEqual({ pending: 1, manager: true });
    expect((await act(manager, quote.id, "reject", { reason: "fiyat", note: "Bu fiyata satamayız." })).status).toBe(200);
    const mine = await inbox(member);
    expect(mine.map((n) => n.title)).toEqual([`Teklifiniz reddedildi: ${quote.quoteNo}`]);
    expect(mine[0].body).toContain("Bu fiyata satamayız.");
    const second = await create(member, { submit: true });
    expect((await act(owner, second.id, "approve")).status).toBe(200);
    expect((await inbox(member)).map((n) => n.title)).toContain(`Teklifiniz onaylandı: ${second.quoteNo}`);
    expect((await (await manager("GET", "/api/quotes/summary")).json()).pending).toBe(0);
  });
});

describe("Teklifler — daire durumuna etkiler", () => {
  it("onay daireyi opsiyona alır; onaylı teklifin tutarı değişince yeniden onaya döner ve opsiyon kalkar", async () => {
    const { member, manager, create, act, unitStatus, stored } = await team();
    const quote = await create(member, { submit: true });
    expect(await unitStatus("u1")).toBe("müsait");
    expect((await act(manager, quote.id, "approve")).status).toBe(200);
    expect(await unitStatus("u1")).toBe("opsiyonlu");
    expect((await stored(quote.id)).optionHeld).toBe(true);
    // Not değişikliği onayı düşürmez.
    const noted = await member("PATCH", `/api/quotes/${quote.id}`, draft({ note: "Müşteri pazartesi gelecek." }));
    expect((await noted.json()).quote.status).toBe("onaylandı");
    // Onaylı teklifin müşterisi değiştirilemez.
    expect((await manager("PATCH", `/api/quotes/${quote.id}`, draft({ leadId: "lead-m2" }))).status).toBe(409);
    const edited = await member("PATCH", `/api/quotes/${quote.id}`, draft({ salePrice: 3_900_000 }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).quote).toMatchObject({ status: "onay bekliyor", decision: null });
    expect(await unitStatus("u1")).toBe("müsait");
    expect((await act(member, quote.id, "send")).status).toBe(409);
    // Yeniden onay ve iptal: opsiyon geri kalkar.
    expect((await act(manager, quote.id, "approve")).status).toBe(200);
    expect(await unitStatus("u1")).toBe("opsiyonlu");
    expect((await act(member, quote.id, "cancel")).status).toBe(200);
    expect(await unitStatus("u1")).toBe("müsait");
  });

  it("satışa dönen teklif daireyi satıldı yapar ve dairenin diğer açık tekliflerini iptal eder", async () => {
    const { member, member2, manager, create, act, unitStatus, stored } = await team();
    const winner = await create(member, { submit: true });
    const pending = await create(member2, { leadId: "lead-m2", submit: true });
    const draftQuote = await create(member2, { leadId: "lead-m2" });
    const rejected = await create(member2, { leadId: "lead-m2", submit: true });
    const approvedOther = await create(member2, { leadId: "lead-m2", submit: true });
    const otherUnit = await create(member2, { leadId: "lead-m2", unitId: "u2", salePrice: 3_000_000, submit: true });
    expect((await act(manager, rejected.id, "reject", { reason: "fiyat" })).status).toBe(200);
    expect((await act(manager, approvedOther.id, "approve")).status).toBe(200);
    expect((await act(manager, winner.id, "approve")).status).toBe(200);
    expect(await unitStatus("u1")).toBe("opsiyonlu");
    const sold = await act(member, winner.id, "sell");
    expect(sold.status).toBe(200);
    expect((await sold.json()).cancelled.sort()).toEqual([pending.id, draftQuote.id, approvedOther.id].sort());
    expect(await unitStatus("u1")).toBe("satıldı");
    expect((await stored(winner.id)).status).toBe("satışa döndü");
    for (const id of [pending.id, draftQuote.id, approvedOther.id]) {
      const cancelled = await stored(id);
      expect(cancelled.status).toBe("iptal");
      expect(cancelled.trail.at(-1)!.note).toContain(winner.quoteNo);
    }
    expect((await stored(rejected.id)).status).toBe("reddedildi");
    expect((await stored(otherUnit.id)).status).toBe("onay bekliyor");
    expect(await unitStatus("u2")).toBe("müsait");
    // Satılmış daire için yeni teklif açılamaz, bekleyen onaylanamaz.
    expect((await member("POST", "/api/quotes", draft())).status).toBe(409);
    const inbox = (await (await member2("GET", "/api/inbox")).json()).notifications.map((n: any) => n.title);
    expect(inbox).toContain(`Teklifiniz iptal edildi: ${pending.quoteNo}`);
  });

  it("geçerlilik süresi dolan teklif gönderilemez, PDF'i verilmez ve daire opsiyonu kalkar", async () => {
    const { member, manager, create, act, unitStatus, stored, store } = await team();
    const quote = await create(member, { submit: true });
    expect((await act(manager, quote.id, "approve")).status).toBe(200);
    expect((await member("GET", `/api/quotes/${quote.id}/pdf`)).status).toBe(200);
    await store.put(QUOTE_KIND, quote.id, { ...(await stored(quote.id)), validUntil: "2020-01-01" }, "o");
    expect(await unitStatus("u1")).toBe("opsiyonlu");
    expect((await act(member, quote.id, "send")).status).toBe(409);
    expect((await act(manager, quote.id, "sell")).status).toBe(409);
    const refused = await member("GET", `/api/quotes/${quote.id}/pdf`);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe("QUOTE_EXPIRED");
    expect((await member("GET", "/api/quotes")).status).toBe(200);
    expect(await unitStatus("u1")).toBe("müsait");
    expect((await stored(quote.id)).optionHeld).toBe(false);
    // Düzenleyip yeniden onaya gönderilen teklif onayla birlikte yeni geçerlilik alır.
    expect((await member("PATCH", `/api/quotes/${quote.id}`, draft({ downPayment: 1_200_000 }))).status).toBe(200);
    expect((await act(manager, quote.id, "approve")).status).toBe(200);
    expect((await stored(quote.id)).validUntil > today()).toBe(true);
    expect(await unitStatus("u1")).toBe("opsiyonlu");
  });

  it("opsiyon ayarı kapalıysa onay daire durumunu değiştirmez; elle opsiyona alınmış daire iptalde serbest kalmaz", async () => {
    const { member, owner, manager, create, act, unitStatus } = await team();
    expect((await owner("PATCH", "/api/units/u2", { status: "opsiyonlu" })).status).toBe(200);
    const manual = await create(member, { unitId: "u2", salePrice: 3_000_000, submit: true });
    expect((await act(manager, manual.id, "approve")).status).toBe(200);
    expect((await act(member, manual.id, "cancel")).status).toBe(200);
    expect(await unitStatus("u2")).toBe("opsiyonlu");
    expect((await owner("PUT", "/api/quotes/settings", { ...SETTINGS, optionOnApproval: false })).status).toBe(200);
    const quote = await create(member, { submit: true });
    expect((await act(manager, quote.id, "approve")).status).toBe(200);
    expect(await unitStatus("u1")).toBe("müsait");
  });
});

describe("Teklifler — ret sonrası alternatifler", () => {
  it("\"bu fiyata satamayız\" reddinde çalışan, teklifin bugünkü değerine sığan müsait daireleri görür", async () => {
    const { member, member2, manager, create, act, stored } = await team();
    const quote = await create(member, { submit: true });
    expect((await member("GET", `/api/quotes/${quote.id}/alternatives`)).status).toBe(409);
    expect((await act(manager, quote.id, "reject", { reason: "fiyat", note: "Bu fiyata satamayız." })).status).toBe(200);
    const npv = (await stored(quote.id)).evaluation.npv;
    expect(npv).toBeGreaterThan(3_400_000);
    expect(npv).toBeLessThan(4_200_000);
    const res = await member("GET", `/api/quotes/${quote.id}/alternatives`);
    expect(res.status).toBe(200);
    const units = (await res.json()).units as { id: string; listPrice: number; status: string; currency: string }[];
    // Bugünkü değere en yakın (en pahalı) daire başta; satılmış, başka para birimli ve teklifin kendi dairesi yok.
    expect(units.map((u) => u.id)).toEqual(["u4", "u2", "u3"]);
    expect(units.every((u) => u.listPrice <= npv && u.status === "müsait" && u.currency === "TRY")).toBe(true);
    expect((await member2("GET", `/api/quotes/${quote.id}/alternatives`)).status).toBe(404);
    // Tek tıkla o daire için yeni teklif: aynı müşteri, önerilen daire.
    const next = await member("POST", "/api/quotes", draft({ unitId: units[0].id, salePrice: units[0].listPrice }));
    expect(next.status).toBe(201);
    expect((await next.json()).quote).toMatchObject({ unitId: "u4", leadId: "lead-m", status: "taslak" });
    // Başka gerekçeyle reddedilen teklifte liste açılmaz.
    const other = await create(member, { unitId: "u2", salePrice: 3_000_000, submit: true });
    expect((await act(manager, other.id, "reject", { reason: "diğer", note: "Eksik evrak." })).status).toBe(200);
    expect((await member("GET", `/api/quotes/${other.id}/alternatives`)).status).toBe(409);
  });
});

describe("Teklifler — PDF", () => {
  it("onaydan önce müşteri PDF'i verilmez; onaydan sonra Türkçe karakterleriyle üretilir ve iç bilgiler yer almaz", async () => {
    const { member, member2, manager, create, act } = await team();
    const quote = await create(member, { balloons: [{ month: 12, amount: 250_000 }] });
    const refusedDraft = await member("GET", `/api/quotes/${quote.id}/pdf`);
    expect(refusedDraft.status).toBe(409);
    expect((await refusedDraft.json()).error).toBe("NOT_APPROVED");
    expect((await act(member, quote.id, "submit")).status).toBe(200);
    expect((await member("GET", `/api/quotes/${quote.id}/pdf`)).status).toBe(409);
    expect((await manager("GET", `/api/quotes/${quote.id}/pdf`)).status).toBe(409);
    // İç önizleme yalnız filigranla verilir.
    const preview = await member("GET", `/api/quotes/${quote.id}/pdf?preview=1`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-disposition")).toContain("-onizleme.pdf");
    const previewText = pdfText(Buffer.from(await preview.arrayBuffer()));
    expect(previewText.split(PDF_WATERMARK).length - 1).toBeGreaterThanOrEqual(2);

    expect((await act(manager, quote.id, "approve")).status).toBe(200);
    expect((await member2("GET", `/api/quotes/${quote.id}/pdf`)).status).toBe(404);
    const res = await member("GET", `/api/quotes/${quote.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`${quote.quoteNo}.pdf`);
    const pdf = Buffer.from(await res.arrayBuffer());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(15_000);
    expect(pdf.toString("latin1")).toContain("DejaVuSans");
    const text = pdfText(pdf);
    for (const expected of [
      "SATIŞ TEKLİFİ", "MÜŞTERİ", "GAYRİMENKUL", "FİYAT ÖZETİ", "ÖDEME PLANI", "Örnek Yapı Gayrimenkul A.Ş.", "Kadıköy / İstanbul",
      "Şükrü Müşteri", "Işıl Çağdaş Öğütçü", "Genel Müdür", "Örnek Vadi Konutları", "Kartal, İstanbul", "A Blok · No 1", quote.quoteNo,
      "Satış bedeli", "4.000.000,00 TL", "Vade farkı (60 ay)", "2.000.000,00 TL", "Toplam ödeme (ödeme bedeli)", "6.000.000,00 TL",
      "Peşinat", "Ara ödeme", "250.000,00 TL", "Satış danışmanı", "Yetkili onayı", "tarihine kadar geçerlidir.",
    ])
      expect(text, expected).toContain(expected);
    expect(text).not.toContain("?");
    expect(text).not.toContain(PDF_WATERMARK);
    // Müşteri belgesinde NBD, para maliyeti ve prim yoktur.
    for (const secret of ["bugünkü değer", "NBD", "Para maliyeti", "Prim", "80.000,00"]) expect(text).not.toContain(secret);
    // Gönderildi ve satışa döndü durumlarında da belge verilir; iptalde verilmez.
    expect((await act(member, quote.id, "send")).status).toBe(200);
    expect((await member("GET", `/api/quotes/${quote.id}/pdf`)).status).toBe(200);
    const cancelled = await create(member, { unitId: "u2", salePrice: 3_000_000 });
    expect((await act(member, cancelled.id, "cancel")).status).toBe(200);
    expect((await member("GET", `/api/quotes/${cancelled.id}/pdf`)).status).toBe(409);
  }, 20_000);
});

describe("Teklifler — alan yalıtımı", () => {
  it("kayıtla açılan firma modülü kullanır; A ve B birbirinin teklifini, ayarını ve PDF'ini göremez", async () => {
    process.env.XRE_SIGNUP = "1";
    process.env.XRE_SESSION_SECRET = "quotes-test-secret-0123456789abcdef";
    const ctx = await listen();
    const json = { "content-type": "application/json" };
    const setup = await fetch(`${ctx.base}/api/auth/setup`, { method: "POST", headers: json, body: JSON.stringify({ name: "Sistem Sahibi", email: "sahip@xre.test", password: "Yonetici123" }) });
    expect(setup.status).toBe(201);
    const signup = await fetch(`${ctx.base}/api/workspaces/signup`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ company: "Örnek Yapı", slug: "ornek-yapi", name: "Deniz Örnek", email: "deniz@ornek.test", password: "Deneme1234" }),
    });
    expect(signup.status).toBe(201);
    const a = ctx.make(cookieOf(setup));
    const b = ctx.make(cookieOf(signup));
    const prepare = async (as: Call, tag: string, listPrice: number) => {
      expect((await as("POST", "/api/projects", { id: "proje", name: `Proje ${tag}` })).status).toBe(201);
      expect((await as("POST", "/api/units", { id: "daire", projectId: "proje", floor: 1, unitNo: "1", listPrice })).status).toBe(201);
      const created = await as("POST", "/api/leads", { lead: lead(`musteri-${tag}`, `Müşteri ${tag}`, "") });
      expect(created.status).toBe(201);
    };
    await prepare(a, "a", 4_000_000);
    await prepare(b, "b", 2_000_000);
    expect((await a("PUT", "/api/quotes/settings", { ...SETTINGS, companyName: "A Firması" })).status).toBe(200);
    // B'nin ayarı yok: A'nın oranlarını göremez, A'nın ayarıyla teklif hazırlayamaz.
    expect((await (await b("GET", "/api/quotes/settings")).json()).settings).toBeNull();
    expect((await b("POST", "/api/quotes", draft({ unitId: "daire", leadId: "musteri-b", salePrice: 2_000_000, downPayment: 500_000 }))).status).toBe(409);
    const quoteA = (await (await a("POST", "/api/quotes", draft({ unitId: "daire", leadId: "musteri-a", submit: true }))).json()).quote;
    expect((await a("POST", `/api/quotes/${quoteA.id}/approve`, {})).status).toBe(200);
    expect((await a("GET", `/api/quotes/${quoteA.id}/pdf`)).status).toBe(200);

    expect((await (await b("GET", "/api/quotes")).json()).quotes).toHaveLength(0);
    expect((await b("GET", `/api/quotes/${quoteA.id}`)).status).toBe(404);
    expect((await b("GET", `/api/quotes/${quoteA.id}/pdf`)).status).toBe(404);
    expect((await b("GET", `/api/quotes/${quoteA.id}/pdf?preview=1`)).status).toBe(404);
    expect((await b("GET", `/api/quotes/${quoteA.id}/alternatives`)).status).toBe(404);
    for (const action of ["submit", "approve", "reject", "send", "sell", "cancel"]) expect((await b("POST", `/api/quotes/${quoteA.id}/${action}`, { reason: "fiyat" })).status).toBe(404);
    expect((await b("PATCH", `/api/quotes/${quoteA.id}`, draft({ unitId: "daire", leadId: "musteri-b" }))).status).toBe(404);
    // B kendi ayarını kurar: A'nınkini etkilemez; A'nın müşterisi/dairesi B'de yoktur.
    expect((await b("PUT", "/api/quotes/settings", { ...SETTINGS, vadeFarkiMonthlyPct: 3, companyName: "B Firması" })).status).toBe(200);
    expect((await (await a("GET", "/api/quotes/settings")).json()).settings).toMatchObject({ vadeFarkiMonthlyPct: 1.1111111111, companyName: "A Firması" });
    expect((await b("POST", "/api/quotes", draft({ unitId: "daire", leadId: "musteri-a", salePrice: 2_000_000, downPayment: 500_000 }))).status).toBe(400);
    const createdB = await b("POST", "/api/quotes", draft({ unitId: "daire", leadId: "musteri-b", salePrice: 2_000_000, downPayment: 500_000 }));
    expect(createdB.status).toBe(201);
    const quoteB = (await createdB.json()).quote;
    // Numara sırası alan başınadır.
    expect(quoteB.quoteNo).toBe(quoteA.quoteNo);
    expect(quoteB.rates.vadeFarkiMonthlyPct).toBe(3);
    expect(quoteB.listPrice).toBe(2_000_000);
    expect((await a("GET", `/api/quotes/${quoteB.id}`)).status).toBe(404);
    const reportA = await (await a("GET", "/api/quotes/cost-of-money")).json();
    const reportB = await (await b("GET", "/api/quotes/cost-of-money")).json();
    expect(reportA.rows.map((r: any) => r.id)).toEqual([quoteA.id]);
    expect(reportB.rows.map((r: any) => r.id)).toEqual([quoteB.id]);
    expect(await (await b("GET", "/api/quotes/cost-of-money.csv")).text()).not.toContain("Müşteri a");
  }, 20_000);
});

describe("Para maliyeti — rapor, primler ve CSV", () => {
  it("teklif başına nominal, NBD ve para maliyeti; proje ve ay toplamları; süzme; CSV; primler", async () => {
    const { member, member2, manager, owner, create, act, stored } = await team();
    const sold = await create(member, { submit: true });
    const pending = await create(member2, { leadId: "lead-m2", unitId: "u2", salePrice: 3_000_000, downPayment: 3_000_000, months: 0, submit: true });
    const usd = await create(member, { unitId: "u-usd", salePrice: 100_000, downPayment: 40_000, months: 12, submit: true });
    expect((await act(manager, sold.id, "approve")).status).toBe(200);
    expect((await act(member, sold.id, "sell")).status).toBe(200);
    const full = await stored(sold.id);

    const report = await (await manager("GET", "/api/quotes/cost-of-money")).json();
    expect(report.settings.discountMonthlyPct).toBe(2.5);
    expect(report.rows).toHaveLength(3);
    const row = report.rows.find((r: any) => r.id === sold.id);
    expect(row).toMatchObject({
      quoteNo: sold.quoteNo, status: "satışa döndü", projectName: "Örnek Vadi Konutları", unitLabel: "A Blok · No 1", customer: "Şükrü Müşteri", employee: "Işıl Çağdaş Öğütçü",
      currency: "TRY", listPrice: 4_200_000, salePrice: 4_000_000, nominal: 6_000_000, npv: full.evaluation.npv, commission: 80_000, discountMonthlyPct: 2.5,
    });
    expect(row.costOfMoney).toBeCloseTo(6_000_000 - full.evaluation.npv, 2);
    expect(row.npvVsList).toBeCloseTo(full.evaluation.npv - 4_200_000, 2);
    // Peşin satışta para maliyeti yoktur.
    expect(report.rows.find((r: any) => r.id === pending.id)).toMatchObject({ nominal: 3_000_000, npv: 3_000_000, costOfMoney: 0, npvVsListPct: 100 });
    // Toplamlar para birimine göre ayrılır.
    const tryTotal = report.byProject.find((t: any) => t.currency === "TRY");
    expect(tryTotal).toMatchObject({ label: "Örnek Vadi Konutları", count: 2, nominal: 9_000_000, listPrice: 7_200_000, commission: 140_000 });
    expect(tryTotal.costOfMoney).toBeCloseTo(row.costOfMoney, 2);
    expect(report.byProject.find((t: any) => t.currency === "USD")).toMatchObject({ count: 1 });
    expect(report.byMonth.map((t: any) => t.key)).toEqual([today().slice(0, 7), today().slice(0, 7)]);
    expect(report.totals).toHaveLength(2);
    // Süzgeçler: durum, çalışan, proje, tarih.
    const filtered = async (query: string) => (await (await owner("GET", `/api/quotes/cost-of-money?${query}`)).json()).rows.map((r: any) => r.id);
    expect(await filtered(`status=${encodeURIComponent("satışa döndü")}`)).toEqual([sold.id]);
    expect((await filtered(`status=${encodeURIComponent("onay bekliyor,satışa döndü")}`)).sort()).toEqual([sold.id, pending.id, usd.id].sort());
    expect(await filtered("employee=m2")).toEqual([pending.id]);
    expect(await filtered("projectId=yok")).toEqual([]);
    expect(await filtered("projectId=p1")).toHaveLength(3);
    expect(await filtered("from=2099-01-01")).toEqual([]);
    expect(await filtered(`from=${today()}&to=${today()}`)).toHaveLength(3);
    // Primler: yalnız satışa dönen teklifler, çalışan ve ay bazında.
    expect(report.commissions).toEqual([
      { employeeOpenId: "m", employee: "Işıl Çağdaş Öğütçü", month: today().slice(0, 7), currency: "TRY", count: 1, salePrice: 4_000_000, commission: 80_000 },
    ]);
    // CSV: BOM, noktalı virgül, ondalık virgül.
    const csvRes = await manager("GET", `/api/quotes/cost-of-money.csv?status=${encodeURIComponent("satışa döndü")}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toContain("text/csv");
    expect(csvRes.headers.get("content-disposition")).toContain("para-maliyeti-");
    const csv = Buffer.from(await csvRes.arrayBuffer()).toString("utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(COST_CSV_HEADER.join(";"));
    const cells = lines[1].split(";");
    expect(cells.slice(0, 8)).toEqual([sold.quoteNo, today(), "Satışa döndü", "Örnek Vadi Konutları", "A Blok · No 1", "Şükrü Müşteri", "Işıl Çağdaş Öğütçü", "TRY"]);
    expect(cells[8]).toBe("4200000,00");
    expect(cells[9]).toBe("4000000,00");
    expect(cells[11]).toBe("6000000,00");
    expect(cells[12]).toBe(full.evaluation.npv.toFixed(2).replace(".", ","));
    expect(cells[16]).toBe("80000,00");
    expect(cells[17]).toBe("2,5");
  });

  it("saf hesaplar: toplamlar kuruş hassasiyetinde, CSV formül enjeksiyonuna kapalı, görünürlük kuralları", () => {
    const settings: QuoteSettings = { ...QuoteSettingsSchema.parse(SETTINGS), updatedAt: "", updatedBy: "" };
    const unit: any = { id: "u", projectId: "p", block: "", floor: 1, unitNo: "7", type: "2+1", grossM2: 100, netM2: 80, listPrice: 1_000_000.1, currency: "TRY", status: "müsait", archived: false };
    const employee: QuoteActor = { openId: "e", name: "=HYPERLINK(\"kötü\")", manager: false };
    const boss: QuoteActor = { openId: "b", name: "Yönetici", manager: true };
    const make = (id: string, now: string, customer: string) =>
      createQuote(
        { unitId: "u", leadId: "l", salePrice: 1_000_000.1, downPayment: 1_000_000.1, months: 0, balloons: [], startDate: now.slice(0, 10), note: "" },
        { settings, unit, project: { id: "p", name: "Proje; \"A\"" }, lead: { id: "l", name: customer }, actor: employee, now },
        { id, quoteNo: `T-2026-000${id}` },
      );
    const quotes = [make("1", "2026-01-10T10:00:00.000Z", "+90 Müşteri"), make("2", "2026-01-20T10:00:00.000Z", "Ad"), make("3", "2026-02-05T10:00:00.000Z", "Ad")];
    const rows = costRows(quotes);
    expect(rows.map((r) => r.quoteNo)).toEqual(["T-2026-0003", "T-2026-0002", "T-2026-0001"]);
    const months = costTotals(rows, "month");
    expect(months.map((m) => [m.key, m.count, m.nominal])).toEqual([["2026-02", 1, 1_000_000.1], ["2026-01", 2, 2_000_000.2]]);
    expect(costTotals(rows, "all")[0]).toMatchObject({ count: 3, nominal: 3_000_000.3, costOfMoney: 0 });
    expect(costRows(quotes, { from: "2026-01-15", to: "2026-01-31" })).toHaveLength(1);
    const csv = costCsv(rows);
    expect(csv).toContain("'=HYPERLINK(\"\"kötü\"\")");
    expect(csv).toContain("'+90 Müşteri");
    expect(csv).toContain("\"Proje; \"\"A\"\"\"");
    expect(csv).toContain("1000000,10");
    // Primler satış ayına göre toplanır.
    let sold = transitionQuote(quotes[0], "submit", employee, "2026-01-10T11:00:00.000Z");
    sold = transitionQuote(sold, "approve", boss, "2026-01-11T11:00:00.000Z", { validDays: 60 });
    sold = transitionQuote(sold, "sell", employee, "2026-03-02T11:00:00.000Z");
    expect(commissionSummary([sold, quotes[1]])).toEqual([{ employeeOpenId: "e", employee: employee.name, month: "2026-03", currency: "TRY", count: 1, salePrice: 1_000_000.1, commission: 20_000 }]);
    // Görünürlük: yönetici her şeyi, teklifin sahibi primini, başka çalışan hiçbirini görür.
    expect(visibleQuote(sold, boss)).toBe(sold);
    expect(visibleQuote(sold, employee).commission).toBe(20_000);
    expect(visibleQuote(sold, employee).evaluation).not.toHaveProperty("npv");
    expect(visibleQuote(sold, { openId: "x", name: "Başka", manager: false })).toMatchObject({ commission: null, rates: { vadeFarkiMonthlyPct: settings.vadeFarkiMonthlyPct } });
    // Satış: dairenin diğer açık teklifleri iptal edilir.
    const effects = unitEffects({ ...sold, status: "onaylandı" }, sold, unit, [quotes[1], quotes[2]], settings, employee, "2026-03-02T11:00:00.000Z");
    expect(effects.unitStatus).toBe("satıldı");
    expect(effects.cancelled.map((q: Quote) => [q.id, q.status])).toEqual([["2", "iptal"], ["3", "iptal"]]);
    expect(formatAmount(1234567.5)).toBe("1.234.567,50");
    expect(formatPct(10, 0)).toBe("%10");
    expect(formatPct(4.76)).toBe("%4,76");
  });
});
