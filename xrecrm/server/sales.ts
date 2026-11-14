// Gayrimenkul satış modülü — FAZ 3: satış belgeleri.
// Onaylı teklif için alıcı bilgileri, senet dökümü, senet PDF'i ve Word sözleşmesi.
// Yollar /api/quotes altındadır; "/api/quotes/:id" ile çakışmaması için teklif yollarından ÖNCE kaydedilir.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { serial } from "./projects.js";
import { getQuoteSettings, quoteAccess } from "./quotes.js";
import { buildSenetPdf } from "./senet-pdf.js";
import { APPROVED_STATUSES, QUOTE_KIND, QuoteError, isOwnQuote, isoDay, unitLabelOf, type Quote } from "../shared/quotes.js";
import {
  CONTRACT_FIELDS,
  CONTRACT_TABLES,
  CONTRACT_TEMPLATE_ID,
  CONTRACT_TEMPLATE_KIND,
  CONTRACT_TEMPLATE_MAX_BYTES,
  SALE_KIND,
  SalePartiesSchema,
  buildSenets,
  contractData,
  validTckn,
  type Sale,
} from "../shared/senet.js";
import { DOCX_MIME, DocxError, fillDocx } from "../shared/docx-fill.js";
import { buildDefaultContractTemplate } from "../shared/contract-template.js";

interface StoredTemplate {
  name: string;
  dataBase64: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
  unknown: string[];
}

const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "INVALID_REQUEST", message: error.issues[0]?.message || "Geçersiz istek." });
  if (error instanceof QuoteError) return res.status(error.statusCode).json({ error: error.code, message: error.message });
  if (error instanceof DocxError) return res.status(400).json({ error: "INVALID_TEMPLATE", message: error.message });
  console.warn("Satış belgeleri hatası:", (error as Error)?.message);
  return res.status(500).json({ error: "SERVER_ERROR", message: "Beklenmeyen sunucu hatası." });
}

const safeName = (value: string) => value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "belge";

export function registerSaleRoutes(app: Express, store: Store): void {
  const raw = rawStoreOf(store);

  const access = (req: Request) => {
    const auth = authOf(req);
    if (!auth?.ownerOpenId) throw new QuoteError("Oturum gerekli.", 401, "UNAUTHORIZED");
    const grant = quoteAccess(auth);
    if (!grant.use) throw new QuoteError("Teklifler modülünde yetkiniz yok.", 403, "FORBIDDEN");
    return { owner: auth.ownerOpenId, ...grant };
  };
  type Ctx = ReturnType<typeof access>;
  const loadQuote = async (ctx: Ctx, id: string) => {
    const quote = (await raw.get<Quote>(QUOTE_KIND, String(id || "").slice(0, 191), ctx.owner))?.payload;
    if (!quote || (!ctx.seeAll && !isOwnQuote(quote, ctx.actor))) throw new QuoteError("Teklif bulunamadı.", 404, "NOT_FOUND");
    return quote;
  };
  const loadSale = async (owner: string, quoteId: string) => (await raw.get<Sale>(SALE_KIND, quoteId, owner))?.payload || null;
  const requireSale = async (ctx: Ctx, id: string) => {
    const quote = await loadQuote(ctx, id);
    const sale = await loadSale(ctx.owner, quote.id);
    if (!sale) throw new QuoteError("Önce alıcı bilgilerini kaydedin.", 409, "SALE_REQUIRED");
    return { quote, sale };
  };
  const loadTemplate = async (owner: string) => (await raw.get<StoredTemplate>(CONTRACT_TEMPLATE_KIND, CONTRACT_TEMPLATE_ID, owner))?.payload || null;
  const templateInfo = (template: StoredTemplate | null) => ({
    custom: Boolean(template),
    name: template?.name || "Hazır şablon",
    size: template?.size || 0,
    uploadedAt: template?.uploadedAt || null,
    unknown: template?.unknown || [],
    fields: CONTRACT_FIELDS,
    tables: CONTRACT_TABLES,
  });
  const sendDocx = (res: Response, bytes: Uint8Array, filename: string) => {
    res.setHeader("Content-Type", DOCX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName(filename)}.docx"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(Buffer.from(bytes));
  };

  // ---- Sözleşme şablonu -------------------------------------------------------------

  app.get("/api/quotes/contract-template", async (req, res) => {
    try {
      const ctx = access(req);
      res.json({ template: templateInfo(await loadTemplate(ctx.owner)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/quotes/contract-template/file", async (req, res) => {
    try {
      const ctx = access(req);
      const template = req.query.default === "1" ? null : await loadTemplate(ctx.owner);
      sendDocx(res, template ? Buffer.from(template.dataBase64, "base64") : buildDefaultContractTemplate(), template ? template.name.replace(/\.docx$/i, "") : "sozlesme-sablonu");
    } catch (error) {
      sendError(res, error);
    }
  });

  const TemplateBody = z.object({ name: z.string().trim().min(1).max(200), dataBase64: z.string().min(1).max(Math.ceil(CONTRACT_TEMPLATE_MAX_BYTES * 1.4)) });
  app.put("/api/quotes/contract-template", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.manager) throw new QuoteError("Sözleşme şablonunu yalnız yönetici değiştirebilir.", 403, "FORBIDDEN");
      const body = TemplateBody.parse(req.body);
      if (!/\.docx$/i.test(body.name)) throw new DocxError("Şablon Word (.docx) dosyası olmalı.");
      const bytes = Buffer.from(body.dataBase64, "base64");
      if (!bytes.length || bytes.length > CONTRACT_TEMPLATE_MAX_BYTES)
        throw new DocxError(`Şablon en fazla ${Math.round(CONTRACT_TEMPLATE_MAX_BYTES / 1000)} KB olabilir.`);
      // Dosya gerçekten doldurulabilir bir Word belgesi mi; bilinmeyen alan var mı?
      const known = new Set([...CONTRACT_FIELDS, ...CONTRACT_TABLES].map(([key]) => key));
      const unknown = fillDocx(bytes, {}, {}).unknown.filter((key) => !known.has(key));
      const template: StoredTemplate = { name: body.name, dataBase64: bytes.toString("base64"), size: bytes.length, uploadedAt: new Date().toISOString(), uploadedBy: ctx.actor.name, unknown };
      await raw.put(CONTRACT_TEMPLATE_KIND, CONTRACT_TEMPLATE_ID, template, ctx.owner);
      res.json({ template: templateInfo(template) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/quotes/contract-template", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.manager) throw new QuoteError("Sözleşme şablonunu yalnız yönetici değiştirebilir.", 403, "FORBIDDEN");
      await raw.delete(CONTRACT_TEMPLATE_KIND, CONTRACT_TEMPLATE_ID, ctx.owner);
      res.json({ template: templateInfo(null) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- Senet takibi (tüm satışlar) -----------------------------------------------------

  app.get("/api/quotes/senets", async (req, res) => {
    try {
      const ctx = access(req);
      const [sales, quotes] = await Promise.all([raw.list<Sale>(SALE_KIND, ctx.owner), raw.list<Quote>(QUOTE_KIND, ctx.owner)]);
      const byId = new Map(quotes.map((row) => [row.payload.id, row.payload]));
      const rows = sales
        .map((row) => ({ sale: row.payload, quote: byId.get(row.payload.quoteId) }))
        .filter((x): x is { sale: Sale; quote: Quote } => Boolean(x.quote) && x.quote!.status !== "iptal" && (ctx.seeAll || isOwnQuote(x.quote!, ctx.actor)))
        .map(({ sale, quote }) => ({
          quoteId: quote.id,
          quoteNo: quote.quoteNo,
          status: quote.status,
          customer: sale.parties.buyerName || quote.customer.name,
          phone: sale.parties.buyerPhone || quote.customer.phone,
          projectName: quote.unit.projectName,
          unitLabel: unitLabelOf(quote.unit),
          employee: quote.employee.name,
          lateInterestMonthlyPct: sale.parties.lateInterestMonthlyPct,
          senets: sale.senets,
        }));
      res.json({ sales: rows, today: isoDay(new Date()) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- Bir teklifin satış belgeleri ---------------------------------------------------

  app.get("/api/quotes/:id/sale", async (req, res) => {
    try {
      const ctx = access(req);
      const quote = await loadQuote(ctx, req.params.id);
      res.json({ sale: await loadSale(ctx.owner, quote.id), today: isoDay(new Date()) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/quotes/:id/sale", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.create) throw new QuoteError("Bu işlem için CRM'de yazma yetkisi gerekir.", 403, "FORBIDDEN");
      const parties = SalePartiesSchema.parse(req.body);
      if (!validTckn(parties.buyerTckn)) throw new QuoteError("Alıcının TC kimlik numarası geçersiz.", 400, "INVALID_REQUEST");
      if (!validTckn(parties.guarantorTckn)) throw new QuoteError("Kefilin TC kimlik numarası geçersiz.", 400, "INVALID_REQUEST");
      const sale = await serial(ctx.owner, async () => {
        const quote = await loadQuote(ctx, req.params.id);
        // Onaylanmamış teklif için sözleşme ve senet düzenlenemez.
        if (!APPROVED_STATUSES.includes(quote.status))
          throw new QuoteError("Sözleşme ve senet yalnız yöneticinin onayladığı teklif için düzenlenir.", 409, "NOT_APPROVED");
        const previous = await loadSale(ctx.owner, quote.id);
        const next: Sale = {
          quoteId: quote.id,
          quoteNo: quote.quoteNo,
          parties,
          senets: buildSenets(quote, previous?.senets),
          updatedAt: new Date().toISOString(),
          updatedBy: ctx.actor.name,
        };
        await raw.put(SALE_KIND, quote.id, next, ctx.owner);
        return next;
      });
      res.json({ sale, today: isoDay(new Date()) });
    } catch (error) {
      sendError(res, error);
    }
  });

  const PayBody = z.object({ paid: z.boolean(), paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
  app.post("/api/quotes/:id/sale/senets/:no", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.create) throw new QuoteError("Bu işlem için CRM'de yazma yetkisi gerekir.", 403, "FORBIDDEN");
      const body = PayBody.parse(req.body);
      const no = Number(req.params.no);
      const sale = await serial(ctx.owner, async () => {
        const { sale: current } = await requireSale(ctx, req.params.id);
        if (!current.senets.some((s) => s.no === no)) throw new QuoteError("Senet bulunamadı.", 404, "NOT_FOUND");
        const next: Sale = {
          ...current,
          senets: current.senets.map((s) =>
            s.no === no ? { ...s, status: body.paid ? ("ödendi" as const) : ("bekliyor" as const), paidAt: body.paid ? body.paidAt || isoDay(new Date()) : null } : s,
          ),
          updatedAt: new Date().toISOString(),
          updatedBy: ctx.actor.name,
        };
        await raw.put(SALE_KIND, current.quoteId, next, ctx.owner);
        return next;
      });
      res.json({ sale, today: isoDay(new Date()) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/quotes/:id/contract.docx", async (req, res) => {
    try {
      const ctx = access(req);
      const { quote, sale } = await requireSale(ctx, req.params.id);
      if (!APPROVED_STATUSES.includes(quote.status)) throw new QuoteError("Yönetici onayı olmayan teklif için sözleşme verilemez.", 409, "NOT_APPROVED");
      const template = await loadTemplate(ctx.owner);
      const data = contractData(quote, sale, await getQuoteSettings(store, ctx.owner));
      const filled = fillDocx(template ? Buffer.from(template.dataBase64, "base64") : buildDefaultContractTemplate(), data.fields, data.tables);
      sendDocx(res, filled.bytes, `Sozlesme-${quote.quoteNo}`);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/quotes/:id/senets.pdf", async (req, res) => {
    try {
      const ctx = access(req);
      const { quote, sale } = await requireSale(ctx, req.params.id);
      if (!APPROVED_STATUSES.includes(quote.status)) throw new QuoteError("Yönetici onayı olmayan teklif için senet verilemez.", 409, "NOT_APPROVED");
      if (!sale.senets.length) throw new QuoteError("Bu satışta vadeli ödeme yok; senet düzenlenmez.", 409, "NO_SENETS");
      const settings = await getQuoteSettings(store, ctx.owner);
      const pdf = await buildSenetPdf({ quote, sale, companyName: settings?.companyName || "" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Senetler-${safeName(quote.quoteNo)}.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(pdf);
    } catch (error) {
      sendError(res, error);
    }
  });
}
