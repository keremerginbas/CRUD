// Gayrimenkul satış modülü — FAZ 2: ödeme planlı teklif, yönetici onayı, PDF, para maliyeti ve prim.
//
// - Kayıtlar çalışma alanı sahibinin kimliğiyle saklanır (re_quote / re_quote_settings); başka bir
//   alanın kullanıcısı bu kayıtları ne okuyabilir ne değiştirebilir.
// - Yetki: "quotes" modülü. Okuma = teklif modülünü kullanır (hazırlamak için ayrıca CRM yazma
//   yetkisi gerekir; kapsam "kendi" ise yalnız kendi tekliflerini görür). Yazma = YÖNETİCİ:
//   onaylar/reddeder, oranları belirler, para maliyeti ekranını görür. Alan sahibi her zaman yöneticidir.
// - Para tutarları istemciden alınmaz: plan, NBD ve prim her kayıtta kayıtlı oranlardan ve dairenin
//   liste fiyatından yeniden hesaplanır (shared/sales-finance.ts).
// - Onaylanmamış teklifin müşteri PDF'i üretilmez; yalnız filigranlı iç önizleme verilir.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { allRoles, canAccess, ownsLead, permissionFor, rawStoreOf } from "./access.js";
import { serial } from "./projects.js";
import { addInboxNotification } from "./triggers.js";
import { buildQuotePdf } from "./quote-pdf.js";
import type { AccessEmployee } from "../shared/access.js";
import { PROJECT_KIND, UNIT_KIND, type Project, type Unit, type UnitStatus } from "../shared/real-estate.js";
import {
  APPROVED_STATUSES,
  QUOTE_KIND,
  QUOTE_NO_KIND,
  QUOTE_SETTINGS_ID,
  QUOTE_SETTINGS_KIND,
  QUOTE_STATUSES,
  QuoteDraftSchema,
  QuoteError,
  QuoteSettingsSchema,
  REJECT_REASONS,
  alternativesFor,
  commissionSummary,
  costCsv,
  costRows,
  costTotals,
  createQuote,
  editQuote,
  formatQuoteNo,
  isExpired,
  isOwnQuote,
  isoDay,
  nextQuoteSeq,
  publicSettings,
  transitionQuote,
  unitEffects,
  unitLabelOf,
  visibleQuote,
  type CostFilters,
  type Quote,
  type QuoteAction,
  type QuoteActor,
  type QuoteSettings,
  type QuoteStatus,
} from "../shared/quotes.js";

/** Alan sahibinin görünen adı (bildirim alıcısı); sahip teklif ekranını açtıkça güncellenir. */
const QUOTE_META_KIND = "re_quote_meta";

const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
const fold = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("tr-TR");

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return res.status(400).json({ error: "INVALID_REQUEST", message: `${where}${issue?.message || "Geçersiz istek."}` });
  }
  if (error instanceof QuoteError) return res.status(error.statusCode).json({ error: error.code, message: error.message });
  console.warn("Teklif modülü hatası:", (error as Error)?.message);
  return res.status(500).json({ error: "SERVER_ERROR", message: "Beklenmeyen sunucu hatası." });
}
const forbidden = (message: string) => new QuoteError(message, 403, "FORBIDDEN");
const notFound = (message = "Teklif bulunamadı.") => new QuoteError(message, 404, "NOT_FOUND");

/** İsteği yapanın teklif modülündeki yetkileri. */
export function quoteAccess(auth: AuthContext) {
  const manager = Boolean(auth.isOwner || canAccess(auth, "quotes", "write"));
  const use = manager || canAccess(auth, "quotes", "read");
  return {
    manager,
    use,
    /** Teklif hazırlamak CRM'de yazma yetkisi de ister (gözlemci rolü hazırlayamaz). */
    create: manager || (use && canAccess(auth, "crm", "write")),
    seeAll: manager || (use && permissionFor(auth, "quotes").scope === "all"),
    actor: { openId: auth.user.openId, name: auth.displayName || auth.user.name || "Kullanıcı", manager } satisfies QuoteActor,
  };
}

export async function getQuoteSettings(store: Store, ownerOpenId: string): Promise<QuoteSettings | null> {
  return (await rawStoreOf(store).get<QuoteSettings>(QUOTE_SETTINGS_KIND, QUOTE_SETTINGS_ID, ownerOpenId))?.payload || null;
}

export function registerQuoteRoutes(app: Express, store: Store): void {
  const raw = rawStoreOf(store);

  const access = (req: Request) => {
    const auth = authOf(req);
    if (!auth?.ownerOpenId) throw new QuoteError("Oturum gerekli.", 401, "UNAUTHORIZED");
    const grant = quoteAccess(auth);
    if (!grant.use) throw forbidden("Teklifler modülünde yetkiniz yok.");
    void rememberOwner(auth);
    return { auth, owner: auth.ownerOpenId, ...grant };
  };
  const managerOnly = (req: Request) => {
    const ctx = access(req);
    if (!ctx.manager) throw forbidden("Bu işlem yalnız yöneticiye açıktır.");
    return ctx;
  };

  const allQuotes = async (owner: string) => (await raw.list<Quote>(QUOTE_KIND, owner)).map((r) => r.payload);
  const loadQuote = async (owner: string, id: string) => {
    const quote = (await raw.get<Quote>(QUOTE_KIND, String(id || "").slice(0, 191), owner))?.payload;
    if (!quote) throw notFound();
    return quote;
  };
  /** Başkasının teklifi, tümünü görme yetkisi olmayana "yok" olarak görünür. */
  const assertVisible = (quote: Quote, ctx: { seeAll: boolean; actor: QuoteActor }) => {
    if (!ctx.seeAll && !isOwnQuote(quote, ctx.actor)) throw notFound();
  };
  const requireSettings = async (owner: string) => {
    const settings = await getQuoteSettings(store, owner);
    if (!settings) throw new QuoteError("Teklif hazırlanabilmesi için önce yöneticinin oranları (vade farkı, para maliyeti, prim) belirlemesi gerekir.", 409, "SETTINGS_REQUIRED");
    return settings;
  };
  const loadUnit = async (owner: string, unitId: string) => {
    const unit = (await raw.get<Unit>(UNIT_KIND, unitId, owner))?.payload;
    if (!unit) throw new QuoteError("Daire bu çalışma alanında bulunamadı.", 400, "INVALID_REQUEST");
    const project = (await raw.get<Project>(PROJECT_KIND, unit.projectId, owner))?.payload;
    if (project?.archived) throw new QuoteError("Arşivdeki projenin dairesi için teklif hazırlanamaz.", 409, "UNIT_UNAVAILABLE");
    return { unit, project };
  };
  /** Müşteri bu alanda olmalı ve isteği yapan onu görebilmeli. */
  const loadLead = async (auth: AuthContext, leadId: string, check: boolean) => {
    const lead = (await raw.get<Lead>("lead", leadId, auth.ownerOpenId))?.payload;
    if (!lead) throw new QuoteError("Müşteri bu çalışma alanında bulunamadı.", 400, "INVALID_REQUEST");
    if (check && !auth.isOwner) {
      const crm = permissionFor(auth, "crm");
      if (!crm.read || (crm.scope !== "all" && !(await ownsLead(store, auth, leadId)))) throw forbidden("Bu müşteri sizin kapsamınızda değil.");
    }
    return { id: lead.id, name: lead.name, phone: lead.phone };
  };

  const audit = (owner: string, quote: Quote, title: string) =>
    raw
      .appendEvent(
        owner,
        `suite:quotes:${quote.id}:${crypto.randomUUID()}`,
        { type: "suite-change", kind: "quotes", entityId: quote.id, leadId: quote.leadId, title, detail: `${quote.quoteNo} · ${quote.unit.projectName} · ${unitLabelOf(quote.unit)}`, createdAt: new Date().toISOString() },
        "completed",
      )
      .catch(() => undefined);

  /** Yöneticilerin görünen adları: alan sahibi + rolü "Teklifler: yazma" veren etkin çalışanlar. */
  const managerNames = async (owner: string): Promise<string[]> => {
    const names = new Map<string, string>();
    const add = (name: unknown) => {
      const clean = String(name ?? "").trim();
      if (clean) names.set(fold(clean), clean);
    };
    const account = (await raw.list<{ openId?: string; name?: string }>("local-account", owner)).find((r) => r.payload?.openId === owner);
    add(account?.payload?.name);
    add((await raw.get<{ name?: string }>(QUOTE_META_KIND, "owner", owner))?.payload?.name);
    if (!names.size) add((await raw.get<{ name?: string }>("profile", owner, owner))?.payload?.name);
    const roles = new Map((await allRoles(raw, owner)).map((role) => [role.id, role]));
    for (const row of await raw.list<AccessEmployee>("employee", owner))
      if (row.payload.active && roles.get(row.payload.roleId)?.grants?.quotes?.write) add(row.payload.name);
    return [...names.values()];
  };
  const notify = async (owner: string, recipients: string[], actor: QuoteActor, quote: Quote, title: string, body: string) => {
    for (const recipient of recipients) {
      if (fold(recipient) === fold(actor.name)) continue;
      await addInboxNotification(store, owner, { recipient, title, body, leadId: quote.leadId }).catch(() => null);
    }
  };
  const rememberOwner = async (auth: AuthContext) => {
    if (!auth.isOwner) return;
    const name = (auth.displayName || auth.user.name || "").trim();
    if (!name) return;
    try {
      const saved = (await raw.get<{ name?: string }>(QUOTE_META_KIND, "owner", auth.ownerOpenId))?.payload?.name;
      if (saved !== name) await raw.put(QUOTE_META_KIND, "owner", { name }, auth.ownerOpenId);
    } catch {
      /* yalnız bildirim alıcısı adı; kritik değil */
    }
  };

  const setUnitStatus = async (owner: string, unit: Unit, status: UnitStatus | undefined) => {
    if (!status || unit.status === status) return;
    await raw.put(UNIT_KIND, unit.id, { ...unit, status, updatedAt: new Date().toISOString() }, owner);
  };

  /** Süresi dolan onaylı tekliflerin daire opsiyonunu kaldırır (arka plan işi yok; liste okunurken çalışır). */
  const sweepExpired = async (owner: string) => {
    const today = isoDay(new Date());
    if (!(await allQuotes(owner)).some((q) => q.optionHeld && isExpired(q, today))) return;
    await serial(owner, async () => {
      const now = new Date().toISOString();
      let quotes = await allQuotes(owner);
      for (const quote of quotes.filter((q) => q.optionHeld && isExpired(q, isoDay(now)))) {
        const unit = (await raw.get<Unit>(UNIT_KIND, quote.unitId, owner))?.payload;
        if (!unit) continue;
        const effects = unitEffects(quote, quote, unit, quotes, { optionOnApproval: true }, { openId: "system", name: "Sistem", manager: true }, now);
        await raw.put(QUOTE_KIND, quote.id, effects.quote, owner);
        await setUnitStatus(owner, unit, effects.unitStatus);
        quotes = quotes.map((q) => (q.id === quote.id ? effects.quote : q));
      }
    });
  };

  /** Sıradaki teklif numarasını ayırır; ayırma kaydı sayesinde aynı numara iki kez verilemez. */
  const reserveQuoteNo = async (owner: string, now: string): Promise<string> => {
    const year = Number(now.slice(0, 4));
    const taken = (await raw.list(QUOTE_NO_KIND, owner)).map((r) => r.id);
    let seq = nextQuoteSeq(taken, year);
    for (let attempt = 0; attempt < 50; attempt++, seq++) {
      const quoteNo = formatQuoteNo(year, seq);
      if ((await raw.insertIfAbsent(QUOTE_NO_KIND, quoteNo, { quoteNo, createdAt: now }, owner)).inserted) return quoteNo;
    }
    throw new QuoteError("Teklif numarası alınamadı; yeniden deneyin.", 503, "QUOTE_NO_BUSY");
  };

  /** Durum geçişini, daire etkileriyle birlikte uygular. Sıra içinde çağrılır. */
  const applyTransition = async (owner: string, id: string, action: QuoteAction, ctx: { actor: QuoteActor; seeAll: boolean }, extra: { note?: string; reason?: any } = {}) => {
    const now = new Date().toISOString();
    const before = await loadQuote(owner, id);
    assertVisible(before, ctx);
    const settings = await getQuoteSettings(store, owner);
    const unit = (await raw.get<Unit>(UNIT_KIND, before.unitId, owner))?.payload;
    if (!unit) throw new QuoteError("Teklifin dairesi bulunamadı.", 409, "UNIT_UNAVAILABLE");
    const moved = transitionQuote(before, action, ctx.actor, now, { ...extra, validDays: settings?.quoteValidDays });
    if ((action === "approve" || action === "sell") && unit.status === "satıldı")
      throw new QuoteError("Bu daire satılmış; teklif onaylanamaz veya satışa çevrilemez.", 409, "UNIT_UNAVAILABLE");
    if (action === "approve" && unit.archived) throw new QuoteError("Arşivdeki daire için teklif onaylanamaz.", 409, "UNIT_UNAVAILABLE");
    const others = await allQuotes(owner);
    const effects = unitEffects(before, moved, unit, others, { optionOnApproval: settings?.optionOnApproval ?? true }, ctx.actor, now);
    await raw.put(QUOTE_KIND, effects.quote.id, effects.quote, owner);
    for (const cancelled of effects.cancelled) await raw.put(QUOTE_KIND, cancelled.id, cancelled, owner);
    await setUnitStatus(owner, unit, effects.unitStatus);
    return effects;
  };

  const afterTransition = async (owner: string, action: QuoteAction, actor: QuoteActor, effects: { quote: Quote; cancelled: Quote[] }) => {
    const { quote } = effects;
    const where = `${quote.unit.projectName} · ${unitLabelOf(quote.unit)} · ${quote.customer.name}`;
    const titles: Record<QuoteAction, string> = {
      submit: "Teklif onaya gönderildi",
      approve: "Teklif onaylandı",
      reject: "Teklif reddedildi",
      send: "Teklif müşteriye gönderildi",
      sell: "Teklif satışa döndü",
      cancel: "Teklif iptal edildi",
    };
    void audit(owner, quote, titles[action]);
    if (action === "submit") await notify(owner, await managerNames(owner), actor, quote, `Onay bekleyen teklif: ${quote.quoteNo}`, `${quote.employee.name} · ${where}`);
    if (action === "approve") await notify(owner, [quote.employee.name], actor, quote, `Teklifiniz onaylandı: ${quote.quoteNo}`, where);
    if (action === "reject")
      await notify(owner, [quote.employee.name], actor, quote, `Teklifiniz reddedildi: ${quote.quoteNo}`, [where, quote.decision?.note].filter(Boolean).join(" — "));
    for (const cancelled of effects.cancelled) {
      void audit(owner, cancelled, "Teklif iptal edildi (daire satıldı)");
      await notify(owner, [cancelled.employee.name], actor, cancelled, `Teklifiniz iptal edildi: ${cancelled.quoteNo}`, `Daire başka bir teklifle satıldı · ${where}`);
    }
  };

  // ---- Liste, özet, ayarlar ---------------------------------------------------

  app.get("/api/quotes", async (req, res) => {
    try {
      const ctx = access(req);
      await sweepExpired(ctx.owner);
      const settings = await getQuoteSettings(store, ctx.owner);
      const quotes = (await allQuotes(ctx.owner))
        .filter((q) => ctx.seeAll || isOwnQuote(q, ctx.actor))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((q) => visibleQuote(q, ctx.actor));
      res.json({ quotes, manager: ctx.manager, canCreate: ctx.create, seeAll: ctx.seeAll, settings: settings ? publicSettings(settings, ctx.manager) : null, today: isoDay(new Date()) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Menüdeki "onay bekleyen" sayacı.
  app.get("/api/quotes/summary", async (req, res) => {
    try {
      const auth = authOf(req);
      const grant = quoteAccess(auth);
      if (!grant.use) return res.json({ pending: 0, manager: false });
      await sweepExpired(auth.ownerOpenId);
      void rememberOwner(auth);
      const quotes = await allQuotes(auth.ownerOpenId);
      const pending = quotes.filter((q) => q.status === "onay bekliyor" && (grant.manager || isOwnQuote(q, grant.actor))).length;
      res.json({ pending, manager: grant.manager });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/quotes/settings", async (req, res) => {
    try {
      const ctx = access(req);
      const settings = await getQuoteSettings(store, ctx.owner);
      res.json({ settings: settings ? publicSettings(settings, ctx.manager) : null, manager: ctx.manager });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/quotes/settings", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      const input = QuoteSettingsSchema.parse(req.body);
      const settings: QuoteSettings = { ...input, updatedAt: new Date().toISOString(), updatedBy: ctx.actor.name };
      await raw.put(QUOTE_SETTINGS_KIND, QUOTE_SETTINGS_ID, settings, ctx.owner);
      void raw
        .appendEvent(
          ctx.owner,
          `suite:quotes:settings:${crypto.randomUUID()}`,
          { type: "suite-change", kind: "quotes", entityId: QUOTE_SETTINGS_ID, title: "Teklif oranları güncellendi", detail: `Vade farkı %${input.vadeFarkiMonthlyPct} · para maliyeti %${input.discountMonthlyPct} · prim %${input.commissionPct}`, createdAt: settings.updatedAt },
          "completed",
        )
        .catch(() => undefined);
      res.json({ settings });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- Para maliyeti raporu (yalnız yönetici) ------------------------------------

  const costFilters = (req: Request): CostFilters => {
    const one = (key: string) => (typeof req.query[key] === "string" ? String(req.query[key]).trim().slice(0, 191) : "");
    const day = (key: string) => (/^\d{4}-\d{2}-\d{2}$/.test(one(key)) ? one(key) : undefined);
    const statuses = one("status")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is QuoteStatus => (QUOTE_STATUSES as readonly string[]).includes(s));
    return { projectId: one("projectId") || undefined, statuses, from: day("from"), to: day("to"), employee: one("employee") || undefined };
  };

  app.get("/api/quotes/cost-of-money", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      const quotes = await allQuotes(ctx.owner);
      const rows = costRows(quotes, costFilters(req));
      res.json({
        settings: await getQuoteSettings(store, ctx.owner),
        rows,
        totals: costTotals(rows, "all"),
        byProject: costTotals(rows, "project"),
        byMonth: costTotals(rows, "month"),
        commissions: commissionSummary(quotes),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/quotes/cost-of-money.csv", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      const csv = costCsv(costRows(await allQuotes(ctx.owner), costFilters(req)));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="para-maliyeti-${isoDay(new Date())}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- Teklif oluşturma ve düzenleme -------------------------------------------

  app.post("/api/quotes", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.create) throw forbidden("Teklif hazırlamak için CRM'de yazma yetkisi gerekir.");
      // Şema bilinmeyen alanları atar: istemcinin gönderdiği tutar, oran, durum veya numara dikkate alınmaz.
      const draft = QuoteDraftSchema.parse(req.body);
      const submit = req.body?.submit === true;
      const lead = await loadLead(ctx.auth, draft.leadId, true);
      const effects = await serial(ctx.owner, async () => {
        const settings = await requireSettings(ctx.owner);
        const { unit, project } = await loadUnit(ctx.owner, draft.unitId);
        const now = new Date().toISOString();
        // Önce doğrula (numara boşa harcanmasın), sonra numarayı ayır.
        createQuote(draft, { settings, unit, project, lead, actor: ctx.actor, now }, { id: "check", quoteNo: "check" });
        const quote = createQuote(draft, { settings, unit, project, lead, actor: ctx.actor, now }, { id: `quote_${crypto.randomUUID()}`, quoteNo: await reserveQuoteNo(ctx.owner, now) });
        await raw.put(QUOTE_KIND, quote.id, quote, ctx.owner);
        void audit(ctx.owner, quote, "Teklif hazırlandı");
        return submit ? applyTransition(ctx.owner, quote.id, "submit", ctx) : { quote, cancelled: [] as Quote[] };
      });
      if (submit) await afterTransition(ctx.owner, "submit", ctx.actor, effects);
      res.status(201).json({ quote: visibleQuote(effects.quote, ctx.actor) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/quotes/:id", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.create) throw forbidden("Teklif düzenlemek için CRM'de yazma yetkisi gerekir.");
      const draft = QuoteDraftSchema.parse(req.body);
      const current = await loadQuote(ctx.owner, req.params.id);
      assertVisible(current, ctx);
      const lead = await loadLead(ctx.auth, draft.leadId, draft.leadId !== current.leadId);
      const result = await serial(ctx.owner, async () => {
        const before = await loadQuote(ctx.owner, req.params.id);
        const settings = await requireSettings(ctx.owner);
        const { unit, project } = await loadUnit(ctx.owner, before.unitId);
        const now = new Date().toISOString();
        const edited = editQuote(before, draft, { settings, unit, project, lead, actor: ctx.actor, now });
        const effects = unitEffects(before, edited, unit, await allQuotes(ctx.owner), settings, ctx.actor, now);
        await raw.put(QUOTE_KIND, effects.quote.id, effects.quote, ctx.owner);
        await setUnitStatus(ctx.owner, unit, effects.unitStatus);
        return { before, quote: effects.quote };
      });
      void audit(ctx.owner, result.quote, "Teklif düzenlendi");
      if (result.before.status === "onaylandı" && result.quote.status === "onay bekliyor")
        await afterTransition(ctx.owner, "submit", ctx.actor, { quote: result.quote, cancelled: [] });
      res.json({ quote: visibleQuote(result.quote, ctx.actor) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- Durum geçişleri ---------------------------------------------------------

  const ActionBody = z.object({ note: z.string().max(1000).optional(), reason: z.enum(REJECT_REASONS).optional() });
  for (const action of ["submit", "approve", "reject", "send", "sell", "cancel"] as const) {
    app.post(`/api/quotes/:id/${action}`, async (req, res) => {
      try {
        const ctx = access(req);
        const body = ActionBody.parse(req.body && typeof req.body === "object" ? req.body : {});
        // Kendi teklifini yöneten çalışanın CRM yazma yetkisi olmalı (onay/ret zaten yalnız yöneticide).
        if (!ctx.create) throw forbidden("Bu işlem için CRM'de yazma yetkisi gerekir.");
        const effects = await serial(ctx.owner, () => applyTransition(ctx.owner, req.params.id, action, ctx, body));
        await afterTransition(ctx.owner, action, ctx.actor, effects);
        res.json({ quote: visibleQuote(effects.quote, ctx.actor), cancelled: effects.cancelled.map((q) => q.id) });
      } catch (error) {
        sendError(res, error);
      }
    });
  }

  // ---- Tek teklif, alternatifler, PDF ----------------------------------------------

  app.get("/api/quotes/:id", async (req, res) => {
    try {
      const ctx = access(req);
      const quote = await loadQuote(ctx.owner, req.params.id);
      assertVisible(quote, ctx);
      res.json({ quote: visibleQuote(quote, ctx.actor) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // "Bu paraya ne verilebilir": yalnız "bu fiyata satamayız" gerekçesiyle reddedilen teklifte.
  app.get("/api/quotes/:id/alternatives", async (req, res) => {
    try {
      const ctx = access(req);
      const quote = await loadQuote(ctx.owner, req.params.id);
      assertVisible(quote, ctx);
      if (!ctx.manager && !(quote.status === "reddedildi" && quote.decision?.reason === "fiyat"))
        throw new QuoteError("Alternatif daire listesi yalnız fiyat nedeniyle reddedilen teklifte açılır.", 409, "INVALID_STATE");
      const [units, projects] = await Promise.all([raw.list<Unit>(UNIT_KIND, ctx.owner), raw.list<Project>(PROJECT_KIND, ctx.owner)]);
      res.json({ units: alternativesFor(quote, units.map((r) => r.payload), projects.map((r) => r.payload)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/quotes/:id/pdf", async (req, res) => {
    try {
      const ctx = access(req);
      const quote = await loadQuote(ctx.owner, req.params.id);
      assertVisible(quote, ctx);
      const preview = req.query.preview === "1";
      const expired = quote.status === "onaylandı" && isExpired(quote, isoDay(new Date()));
      // Müşteriye verilebilir belge: yalnız onaylı (veya sonrası) ve süresi dolmamış teklif.
      const deliverable = APPROVED_STATUSES.includes(quote.status) && !expired;
      if (!preview && !deliverable)
        throw expired
          ? new QuoteError("Teklifin geçerlilik süresi dolmuş; PDF verilemez.", 409, "QUOTE_EXPIRED")
          : new QuoteError("Yönetici onayı olmayan teklifin PDF'i müşteriye verilemez.", 409, "NOT_APPROVED");
      const settings = (await getQuoteSettings(store, ctx.owner)) || { companyName: "", companyAddress: "", companyPhone: "" };
      const project = (await raw.get<Project>(PROJECT_KIND, quote.projectId, ctx.owner))?.payload;
      // Müşteriye verilemeyecek her belge (iç önizleme) filigranlıdır.
      const pdf = await buildQuotePdf({ quote, settings, project, watermark: !deliverable });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${quote.quoteNo}${deliverable ? "" : "-onizleme"}.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(pdf);
    } catch (error) {
      sendError(res, error);
    }
  });
}
