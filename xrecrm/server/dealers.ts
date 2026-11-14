// Bayi sistemi: ana bayi + alt bayiler, müşteri kaydı koruması (varsayılan 60 gün) ve ana bayiye devir.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext, Lead } from "./types.js";
import { canAccess, ownsLead, permissionFor, rawStoreOf } from "./access.js";
import { serial } from "./projects.js";
import { quoteAccess } from "./quotes.js";
import { PROJECT_KIND, type Project } from "../shared/real-estate.js";
import { QUOTE_KIND, isoDay, type Quote } from "../shared/quotes.js";
import {
  DEALER_KIND,
  DEALER_REG_KIND,
  DEALER_SETTINGS_ID,
  DEALER_SETTINGS_KIND,
  DEFAULT_PROTECTION_DAYS,
  DealerError,
  DealerSchema,
  canSeeRegistration,
  dealerOfUser,
  mainDealerOf,
  phoneKey,
  registerCustomer,
  registrationId,
  settleRegistration,
  type Dealer,
  type DealerRegistration,
} from "../shared/dealers.js";

interface DealerSettings {
  protectionDays: number;
}
interface EmployeeRow {
  openId?: string;
  name?: string;
  active?: boolean;
}

const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "INVALID_REQUEST", message: error.issues[0]?.message || "Geçersiz istek." });
  if (error instanceof DealerError) return res.status(error.statusCode).json({ error: error.code, message: error.message });
  console.warn("Bayi modülü hatası:", (error as Error)?.message);
  return res.status(500).json({ error: "SERVER_ERROR", message: "Beklenmeyen sunucu hatası." });
}

export function registerDealerRoutes(app: Express, store: Store): void {
  const raw = rawStoreOf(store);

  const access = (req: Request) => {
    const auth = authOf(req);
    if (!auth?.ownerOpenId) throw new DealerError("Oturum gerekli.", 401, "UNAUTHORIZED");
    if (!auth.isOwner && !canAccess(auth, "crm", "read")) throw new DealerError("Bu bölümde yetkiniz yok.", 403, "FORBIDDEN");
    const manager = quoteAccess(auth).manager;
    return { auth, owner: auth.ownerOpenId, manager, openId: auth.user.openId, name: auth.displayName || auth.user.name || "Kullanıcı" };
  };
  const managerOnly = (req: Request) => {
    const ctx = access(req);
    if (!ctx.manager) throw new DealerError("Bayileri yalnız yönetici düzenleyebilir.", 403, "FORBIDDEN");
    return ctx;
  };
  const listDealers = async (owner: string) => (await raw.list<Dealer>(DEALER_KIND, owner)).map((r) => r.payload).sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name, "tr"));
  const protectionDays = async (owner: string) => {
    const days = (await raw.get<DealerSettings>(DEALER_SETTINGS_KIND, DEALER_SETTINGS_ID, owner))?.payload?.protectionDays;
    return Number.isInteger(days) && days! > 0 ? days! : DEFAULT_PROTECTION_DAYS;
  };

  /**
   * Kayıtları günceller: satışa dönenler "satıldı", koruması dolanlar ana bayiye devredilir.
   * Devirde müşteri kartının sorumlusu da ana bayinin ilk çalışanına geçer.
   */
  const settleAll = async (owner: string, dealers: Dealer[]) => {
    const regs = (await raw.list<DealerRegistration>(DEALER_REG_KIND, owner)).map((r) => r.payload);
    if (!regs.some((r) => r.status === "aktif")) return regs;
    const today = isoDay(new Date());
    const now = new Date().toISOString();
    const main = mainDealerOf(dealers);
    const quotes = (await raw.list<Quote>(QUOTE_KIND, owner)).map((r) => r.payload).filter((q) => q.status === "satışa döndü");
    const soldKeys = new Set(quotes.flatMap((q) => [`${q.projectId}:lead:${q.leadId}`, `${q.projectId}:tel:${phoneKey(q.customer.phone)}`]));
    let heir: string | null | undefined;
    const out: DealerRegistration[] = [];
    for (const reg of regs) {
      const sold = soldKeys.has(`${reg.projectId}:lead:${reg.leadId}`) || soldKeys.has(`${reg.projectId}:tel:${reg.phoneKey}`);
      const next = settleRegistration(reg, today, main, sold, now);
      if (next !== reg) {
        await raw.put(DEALER_REG_KIND, next.id, next, owner);
        if (next.status === "ana bayiye devredildi" && main && reg.dealerId !== main.id) {
          if (heir === undefined) {
            const employees = (await raw.list<EmployeeRow>("employee", owner)).map((r) => r.payload);
            heir = employees.find((e) => e.active !== false && e.openId && main.members.includes(e.openId))?.name || null;
          }
          const lead = heir ? (await raw.get<Lead>("lead", reg.leadId, owner))?.payload : null;
          if (lead && heir && lead.owner !== heir) await raw.put("lead", lead.id, { ...lead, owner: heir }, owner);
        }
      }
      out.push(next);
    }
    return out;
  };

  app.get("/api/dealers", async (req, res) => {
    try {
      const ctx = access(req);
      const { dealers, regs } = await serial(`dealers:${ctx.owner}`, async () => {
        const dealers = await listDealers(ctx.owner);
        return { dealers, regs: await settleAll(ctx.owner, dealers) };
      });
      const mine = dealerOfUser(dealers, ctx.openId);
      const main = mainDealerOf(dealers);
      const viewer = { manager: ctx.manager, dealerId: mine?.id || null, mainDealerId: main?.id || null };
      const employees = ctx.manager
        ? (await raw.list<EmployeeRow>("employee", ctx.owner)).map((r) => r.payload).filter((e) => e.openId && e.active !== false).map((e) => ({ openId: e.openId!, name: e.name || "Çalışan" }))
        : [];
      res.json({
        dealers: ctx.manager ? dealers : dealers.map((d) => ({ ...d, members: d.id === mine?.id ? d.members : [], phone: "", note: "" })),
        registrations: regs.filter((r) => canSeeRegistration(r, viewer)).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt)),
        myDealerId: mine?.id || null,
        manager: ctx.manager,
        protectionDays: await protectionDays(ctx.owner),
        employees,
        today: isoDay(new Date()),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/dealers", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      const dealer = DealerSchema.parse(req.body);
      await serial(`dealers:${ctx.owner}`, async () => {
        const others = (await listDealers(ctx.owner)).filter((d) => d.id !== dealer.id);
        if (others.some((d) => d.name.toLocaleLowerCase("tr-TR") === dealer.name.toLocaleLowerCase("tr-TR"))) throw new DealerError("Bu adda bir bayi zaten var.", 409, "DUPLICATE");
        if (!dealer.main && !others.some((d) => d.main)) dealer.main = true; // ilk bayi ana bayidir
        for (const other of others) {
          // Tek ana bayi olur; bir çalışan yalnız bir bayide yer alır.
          const members = other.members.filter((m) => !dealer.members.includes(m));
          const main = dealer.main ? false : other.main;
          if (members.length !== other.members.length || main !== other.main) await raw.put(DEALER_KIND, other.id, { ...other, members, main }, ctx.owner);
        }
        await raw.put(DEALER_KIND, dealer.id, dealer, ctx.owner);
      });
      res.status(201).json({ dealer });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/dealers/:id", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      const id = String(req.params.id).slice(0, 191);
      await serial(`dealers:${ctx.owner}`, async () => {
        const dealer = (await raw.get<Dealer>(DEALER_KIND, id, ctx.owner))?.payload;
        if (!dealer) return;
        if (dealer.main) throw new DealerError("Ana bayi silinemez. Önce başka bir bayiyi ana bayi yapın.", 409, "MAIN_DEALER");
        const regs = await raw.list<DealerRegistration>(DEALER_REG_KIND, ctx.owner);
        if (regs.some((r) => r.payload.dealerId === id || r.payload.originalDealerId === id))
          throw new DealerError("Bu bayinin müşteri kayıtları var; silmek yerine pasife alın.", 409, "HAS_REGISTRATIONS");
        await raw.delete(DEALER_KIND, id, ctx.owner);
      });
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put("/api/dealers/settings", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      const body = z.object({ protectionDays: z.number().int().min(1).max(730) }).parse(req.body);
      await raw.put(DEALER_SETTINGS_KIND, DEALER_SETTINGS_ID, body, ctx.owner);
      res.json(body);
    } catch (error) {
      sendError(res, error);
    }
  });

  const RegisterBody = z.object({ leadId: z.string().trim().min(1, "Müşteri seçin.").max(191), projectId: z.string().trim().min(1, "Proje seçin.").max(191), dealerId: z.string().trim().max(191).optional() });
  app.post("/api/dealers/registrations", async (req, res) => {
    try {
      const ctx = access(req);
      if (!ctx.auth.isOwner && !canAccess(ctx.auth, "crm", "write")) throw new DealerError("Müşteri kaydı için CRM'de yazma yetkisi gerekir.", 403, "FORBIDDEN");
      const body = RegisterBody.parse(req.body);
      const registration = await serial(`dealers:${ctx.owner}`, async () => {
        const dealers = await listDealers(ctx.owner);
        const dealer = ctx.manager && body.dealerId ? dealers.find((d) => d.id === body.dealerId) : dealerOfUser(dealers, ctx.openId);
        if (!dealer) throw new DealerError(ctx.manager ? "Kaydın yapılacağı bayiyi seçin." : "Bir bayiye bağlı değilsiniz. Yöneticinizden sizi bir bayiye eklemesini isteyin.", 409, "NO_DEALER");
        const lead = (await raw.get<Lead>("lead", body.leadId, ctx.owner))?.payload;
        const scopeAll = ctx.auth.isOwner || permissionFor(ctx.auth, "crm").scope === "all";
        if (!lead || (!scopeAll && !(await ownsLead(store, ctx.auth, body.leadId)))) throw new DealerError("Müşteri bulunamadı.", 404, "NOT_FOUND");
        const project = (await raw.get<Project>(PROJECT_KIND, body.projectId, ctx.owner))?.payload;
        if (!project) throw new DealerError("Proje bulunamadı.", 404, "NOT_FOUND");
        const regs = await settleAll(ctx.owner, dealers);
        const key = phoneKey(lead.phone || "");
        const existing = key ? regs.find((r) => r.id === registrationId(key, project.id)) || null : null;
        const next = registerCustomer(existing, {
          lead: { id: lead.id, name: lead.name, phone: lead.phone },
          project: { id: project.id, name: project.name },
          dealer,
          byName: ctx.name,
          today: isoDay(new Date()),
          now: new Date().toISOString(),
          protectionDays: await protectionDays(ctx.owner),
        });
        await raw.put(DEALER_REG_KIND, next.id, next, ctx.owner);
        return next;
      });
      res.status(201).json({ registration });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete("/api/dealers/registrations/:id", async (req, res) => {
    try {
      const ctx = managerOnly(req);
      await raw.delete(DEALER_REG_KIND, String(req.params.id).slice(0, 191), ctx.owner);
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });
}
