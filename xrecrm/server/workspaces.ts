// Çalışma alanları: her firma kendi verisiyle ayrı bir alanda çalışır.
//
// - Kurulumu yapan ilk hesap "varsayılan alan"dır (XRE'nin kendi alanı); onun için
//   hiçbir şey değişmez ve iletişim entegrasyonları (WhatsApp, santral, n8n, AI) ona aittir.
// - Yeni firmalar /api/workspaces/signup ile kaydolur (XRE_SIGNUP=1 ise), süreli deneme
//   alır ve crm.../<kısa-ad> adresinden girer. Oturum belirteci alanın sahibini taşır.
// - Yeni alanlarda yalnız çekirdek CRM uçları açıktır; ortak ayara bağlı iletişim
//   modülleri kapalıdır (başka firmanın WhatsApp sunucusunu / anahtarını kullanamaz).
import crypto from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { ACCOUNT_KIND, hashPassword, setSession, type LocalAccount } from "./local-auth.js";
import { suiteKinds } from "./suite.js";
import { mailConfigured, sendMail } from "./mailer.js";
import { RESERVED_SLUGS, SLUG_PATTERN, type WorkspaceInfo } from "../shared/workspaces.js";

export const WORKSPACE_KIND = "workspace";
/** Alan kayıtlarının sahibi: hiçbir kullanıcıya ait olmayan sistem kapsamı. */
export const WORKSPACE_SYSTEM_OWNER = "xre-system";
const DAY = 86_400_000;

export interface Workspace {
  slug: string;
  name: string;
  /** Alanın sahibi (ilk hesabın openId'si); alanın tüm kayıtları bu kimlikle saklanır. */
  ownerOpenId: string;
  contactName: string;
  contactEmail: string;
  createdAt: string;
  trialEndsAt: string;
  status: "trial" | "active" | "suspended";
  /** Kayıtta e-posta kodu doğrulandı mı? */
  emailVerified?: boolean;
  note?: string;
}

const PENDING_KIND = "workspace-pending";
const PENDING_TTL_MS = 30 * 60_000;
const RESEND_WAIT_MS = 60_000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_SENDS = 4;
interface SignupDraft {
  company: string;
  slug: string;
  name: string;
  email: string;
  passwordHash: string;
}
interface PendingSignup extends SignupDraft {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  sends: number;
}
const hashCode = (pendingId: string, code: string) => crypto.createHash("sha256").update(`${pendingId}:${code}`).digest("hex");
/** SMTP ayarlıysa kayıtta e-posta doğrulanır; XRE_SIGNUP_VERIFY=0 ile kapatılabilir. */
export const verificationRequired = () => mailConfigured() && process.env.XRE_SIGNUP_VERIFY?.trim() !== "0";

const escapeHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function sendVerification(draft: SignupDraft, code: string) {
  return sendMail({
    to: draft.email,
    subject: `XRE CRM doğrulama kodunuz: ${code}`,
    text: `Merhaba ${draft.name},\n\n${draft.company} için XRE CRM çalışma alanını açmak üzeresiniz.\n\nDoğrulama kodunuz: ${code}\n\nKod 30 dakika geçerlidir. Bu kaydı siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.\n\nXRE CRM`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#152332;line-height:1.5;max-width:480px">
<p>Merhaba ${escapeHtml(draft.name)},</p>
<p><b>${escapeHtml(draft.company)}</b> için XRE CRM çalışma alanını açmak üzeresiniz.</p>
<p style="font-size:30px;font-weight:700;letter-spacing:6px;background:#f1f5f9;border-radius:10px;padding:14px 18px;text-align:center;margin:20px 0">${code}</p>
<p>Kod 30 dakika geçerlidir. Bu kaydı siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.</p>
<p style="color:#64748b">XRE CRM</p></div>`,
  });
}

export const signupEnabled = () => process.env.XRE_SIGNUP?.trim() === "1";
export const trialDays = () => Math.max(1, Math.min(90, Number(process.env.XRE_TRIAL_DAYS) || 5));
/** Varsayılan (ilk) alanın adresteki kısa adı. */
export const defaultSlug = () => (process.env.XRE_DEFAULT_SLUG?.trim().toLowerCase() || "xre").replace(/[^a-z0-9-]/g, "") || "xre";

export function slugProblem(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) return "Kısa ad 3-30 karakter olmalı; yalnız küçük harf, rakam ve tire içerebilir.";
  if (RESERVED_SLUGS.has(slug) || slug === defaultSlug()) return "Bu kısa ad kullanılamıyor; başka bir ad seçin.";
  return null;
}

export async function listWorkspaces(store: Store): Promise<Workspace[]> {
  return (await rawStoreOf(store).list<Workspace>(WORKSPACE_KIND, WORKSPACE_SYSTEM_OWNER)).map((r) => r.payload);
}
export async function workspaceBySlug(store: Store, slug: string): Promise<Workspace | null> {
  return (await rawStoreOf(store).get<Workspace>(WORKSPACE_KIND, slug, WORKSPACE_SYSTEM_OWNER))?.payload || null;
}
export async function workspaceByOwner(store: Store, ownerOpenId: string): Promise<Workspace | null> {
  if (!ownerOpenId) return null;
  return (await listWorkspaces(store)).find((w) => w.ownerOpenId === ownerOpenId) || null;
}

export type WorkspaceState = "active" | "trial" | "expired" | "suspended";
export function workspaceState(ws: Workspace, now = Date.now()): { state: WorkspaceState; daysLeft: number | null } {
  if (ws.status === "suspended") return { state: "suspended", daysLeft: null };
  if (ws.status === "active") return { state: "active", daysLeft: null };
  const left = Date.parse(ws.trialEndsAt) - now;
  return left > 0 ? { state: "trial", daysLeft: Math.ceil(left / DAY) } : { state: "expired", daysLeft: 0 };
}

/** /api/me için: kullanıcının alanı ve bu alanda açık özellikler. */
export async function workspaceInfo(store: Store, auth: AuthContext): Promise<WorkspaceInfo> {
  const ws = await workspaceByOwner(store, auth.ownerOpenId);
  if (!ws) return { slug: defaultSlug(), name: "", isDefault: true, state: "active", daysLeft: null, trialEndsAt: null, communication: true };
  return { slug: ws.slug, name: ws.name, isDefault: false, ...workspaceState(ws), trialEndsAt: ws.trialEndsAt, communication: false };
}

// Yeni alanlarda açık olan API yolları (/api altındaki ilk bölüm). Diğerleri ortak ayara
// (WhatsApp sunucusu, santral, n8n, AI anahtarı, tüm sistemin yedeği) bağlı olduğu için kapalıdır.
const TENANT_API = new Set<string>([
  "auth", "me", "identity", "state", "leads", "rules", "events", "notifications", "access", "profile", "preferences",
  "crm-workspace", "crm-import", "data-quality", "audit", "automations", "worktime", "workspaces",
  // Kullanıcının kendi posta kutusu: ortak sunucu ayarına bağlı değildir, bu yüzden yeni alanlarda da açıktır.
  "email", "triggers", "inbox",
  // Proje ve daire envanteri: kayıtlar ve görseller alanın kendi kapsamında tutulur.
  "projects", "units", "project-images",
  ...suiteKinds,
]);
const TENANT_BLOCKED_PATHS = [/^\/leads\/[^/]+\/analyze$/];

/** requireAuth'tan sonra: alan durumu (süre, askı) ve yeni alanlar için API kısıtı. */
export function workspaceGuard(store: Store) {
  return async (req: Request & { auth?: AuthContext }, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) return next();
    const ws = await workspaceByOwner(store, auth.ownerOpenId);
    if (!ws) return next(); // varsayılan alan: kısıt yok
    const { state } = workspaceState(ws);
    if (state === "suspended")
      return res.status(403).json({ error: "WORKSPACE_SUSPENDED", message: "Bu çalışma alanı askıya alınmış. Lütfen bizimle iletişime geçin." });
    if (state === "expired")
      return res.status(402).json({ error: "TRIAL_EXPIRED", message: "Deneme süreniz doldu. Verileriniz saklanıyor; devam etmek için bizimle iletişime geçin." });
    const first = req.path.split("/")[1] || "";
    if (!TENANT_API.has(first) || TENANT_BLOCKED_PATHS.some((re) => re.test(req.path)))
      return res.status(403).json({ error: "FEATURE_UNAVAILABLE", message: "Bu özellik çalışma alanınızda henüz açık değil." });
    next();
  };
}

/** Kural eylemleri gibi arka plan işlerinde: bu sahip iletişim entegrasyonlarını kullanabilir mi? */
export async function communicationAllowed(store: Store, ownerOpenId: string): Promise<boolean> {
  return !(await workspaceByOwner(store, ownerOpenId));
}

const signupAttempts = new Map<string, { count: number; first: number }>();
/** Testler için: kayıt deneme sayacını sıfırlar. */
export const resetSignupAttempts = () => signupAttempts.clear();

/** Giriş gerektirmeyen uçlar: alan bilgisi ve ücretsiz kayıt. requireAuth'tan önce bağlanır. */
export function registerWorkspacePublicRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const json = express.json({ limit: "16kb" });

  app.get("/api/workspaces/config", (_req, res) => {
    res.json({ signup: signupEnabled(), trialDays: trialDays(), defaultSlug: defaultSlug(), verifyEmail: verificationRequired() });
  });

  app.get("/api/workspaces/public/:slug", async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    if (slug === defaultSlug()) return res.json({ slug, name: "", isDefault: true });
    const ws = await workspaceBySlug(store, slug);
    if (!ws) return res.status(404).json({ error: "WORKSPACE_NOT_FOUND", message: "Bu adreste bir çalışma alanı yok." });
    res.json({ slug: ws.slug, name: ws.name, isDefault: false });
  });

  app.post("/api/workspaces/signup", json, async (req, res) => {
    if (!signupEnabled()) return res.status(404).json({ error: "SIGNUP_DISABLED", message: "Yeni kayıt şu an kapalı." });
    const ip = String(req.ip || "");
    const a = signupAttempts.get(ip);
    if (a && a.count >= 5 && Date.now() - a.first < 60 * 60_000)
      return res.status(429).json({ error: "TOO_MANY", message: "Çok fazla kayıt denemesi. Bir saat sonra tekrar deneyin." });
    signupAttempts.set(ip, a && Date.now() - a.first < 60 * 60_000 ? { count: a.count + 1, first: a.first } : { count: 1, first: Date.now() });

    const parsed = z
      .object({
        company: z.string().trim().min(2, "Firma adı gerekli.").max(120),
        slug: z.string().trim().toLowerCase().max(40),
        name: z.string().trim().min(2, "Ad soyad gerekli.").max(200),
        email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin.").max(320),
        password: z
          .string()
          .min(8, "Şifre en az 8 karakter olmalı.")
          .max(200)
          .refine((v) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) && /\d/.test(v), "Şifre harf ve rakam içermeli."),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "INVALID", message: parsed.error.issues[0]?.message || "Geçersiz istek." });
    const input = parsed.data;
    const problem = slugProblem(input.slug);
    if (problem) return res.status(400).json({ error: "INVALID_SLUG", message: problem });
    if (!(await raw.resolveOwner()))
      return res.status(409).json({ error: "SETUP_REQUIRED", message: "Sistem kurulumu tamamlanmamış." });
    if (await workspaceBySlug(store, input.slug))
      return res.status(409).json({ error: "SLUG_TAKEN", message: "Bu kısa ad alınmış; başka bir ad seçin." });

    const passwordHash = await hashPassword(input.password);
    const draft: SignupDraft = { company: input.company, slug: input.slug, name: input.name, email: input.email, passwordHash };
    if (!verificationRequired()) return finish(req, res, draft);

    // E-posta doğrulaması: alan, kod girilince açılır. Kod yalnız özet olarak saklanır.
    for (const r of await raw.list<PendingSignup>(PENDING_KIND, WORKSPACE_SYSTEM_OWNER))
      if (r.payload.expiresAt < Date.now()) await raw.delete(PENDING_KIND, r.id, WORKSPACE_SYSTEM_OWNER);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const pendingId = crypto.randomBytes(18).toString("hex");
    const pending: PendingSignup = { ...draft, codeHash: hashCode(pendingId, code), expiresAt: Date.now() + PENDING_TTL_MS, attempts: 0, sentAt: Date.now(), sends: 1 };
    await raw.put(PENDING_KIND, pendingId, pending, WORKSPACE_SYSTEM_OWNER);
    try {
      await sendVerification(pending, code);
    } catch (error) {
      await raw.delete(PENDING_KIND, pendingId, WORKSPACE_SYSTEM_OWNER);
      console.warn("Doğrulama e-postası gönderilemedi:", (error as Error).message);
      return res.status(502).json({ error: "MAIL_FAILED", message: "Doğrulama e-postası gönderilemedi. Adresi kontrol edip tekrar deneyin." });
    }
    res.status(202).json({ ok: true, verify: true, pendingId, email: input.email });
  });

  const loadPending = async (id: unknown) => {
    const pendingId = String(id || "");
    if (!/^[0-9a-f]{36}$/.test(pendingId)) return null;
    const record = (await raw.get<PendingSignup>(PENDING_KIND, pendingId, WORKSPACE_SYSTEM_OWNER))?.payload;
    if (!record) return null;
    if (record.expiresAt < Date.now()) {
      await raw.delete(PENDING_KIND, pendingId, WORKSPACE_SYSTEM_OWNER);
      return null;
    }
    return { pendingId, record };
  };
  const expired = (res: Response) =>
    res.status(410).json({ error: "CODE_EXPIRED", message: "Kodun süresi doldu. Kayıt formunu yeniden doldurun." });

  app.post("/api/workspaces/signup/verify", json, async (req, res) => {
    if (!signupEnabled()) return res.status(404).json({ error: "SIGNUP_DISABLED", message: "Yeni kayıt şu an kapalı." });
    const found = await loadPending(req.body?.pendingId);
    if (!found) return expired(res);
    const { pendingId, record } = found;
    const code = String(req.body?.code || "").replace(/\D/g, "");
    const given = Buffer.from(hashCode(pendingId, code));
    const wanted = Buffer.from(record.codeHash);
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
      const attempts = record.attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await raw.delete(PENDING_KIND, pendingId, WORKSPACE_SYSTEM_OWNER);
        return res.status(410).json({ error: "CODE_EXPIRED", message: "Çok fazla hatalı deneme. Kayıt formunu yeniden doldurun." });
      }
      await raw.put(PENDING_KIND, pendingId, { ...record, attempts }, WORKSPACE_SYSTEM_OWNER);
      return res.status(400).json({ error: "CODE_INVALID", message: `Kod hatalı. ${MAX_CODE_ATTEMPTS - attempts} deneme hakkınız kaldı.` });
    }
    await raw.delete(PENDING_KIND, pendingId, WORKSPACE_SYSTEM_OWNER);
    return finish(req, res, record, true);
  });

  app.post("/api/workspaces/signup/resend", json, async (req, res) => {
    if (!signupEnabled()) return res.status(404).json({ error: "SIGNUP_DISABLED", message: "Yeni kayıt şu an kapalı." });
    const found = await loadPending(req.body?.pendingId);
    if (!found) return expired(res);
    const { pendingId, record } = found;
    if (Date.now() - record.sentAt < RESEND_WAIT_MS)
      return res.status(429).json({ error: "TOO_SOON", message: "Yeni kod için bir dakika bekleyin." });
    if (record.sends >= MAX_SENDS)
      return res.status(429).json({ error: "TOO_MANY", message: "Çok fazla kod istendi. Kayıt formunu yeniden doldurun." });
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await raw.put(PENDING_KIND, pendingId, { ...record, codeHash: hashCode(pendingId, code), attempts: 0, sentAt: Date.now(), sends: record.sends + 1 }, WORKSPACE_SYSTEM_OWNER);
    try {
      await sendVerification(record, code);
    } catch (error) {
      console.warn("Doğrulama e-postası gönderilemedi:", (error as Error).message);
      return res.status(502).json({ error: "MAIL_FAILED", message: "E-posta gönderilemedi. Biraz sonra tekrar deneyin." });
    }
    res.json({ ok: true });
  });

  /** Alanı ve sahibinin hesabını oluşturur, oturumu açar. */
  async function finish(req: Request, res: Response, draft: SignupDraft, emailVerified = false) {
    const id = `acc_${crypto.randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    const account: LocalAccount = {
      id,
      openId: `local:${id}`,
      name: draft.name,
      email: draft.email,
      passwordHash: draft.passwordHash,
      active: true,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    const ws: Workspace = {
      slug: draft.slug,
      name: draft.company,
      ownerOpenId: account.openId,
      contactName: draft.name,
      contactEmail: draft.email,
      createdAt: now,
      trialEndsAt: new Date(Date.now() + trialDays() * DAY).toISOString(),
      status: "trial",
      emailVerified,
    };
    // Aynı anda iki kayıt aynı adı almasın.
    const claimed = await raw.insertIfAbsent(WORKSPACE_KIND, ws.slug, ws, WORKSPACE_SYSTEM_OWNER);
    if (!claimed.inserted) return res.status(409).json({ error: "SLUG_TAKEN", message: "Bu kısa ad alınmış; başka bir ad seçin." });
    await raw.put(ACCOUNT_KIND, id, account, ws.ownerOpenId);
    await raw.put("user", account.openId, { openId: account.openId, name: account.name, email: account.email, isOwner: true }, ws.ownerOpenId);
    await setSession(req, res, account, { workspace: ws.ownerOpenId });
    console.info(`Yeni çalışma alanı: ${ws.slug} (${ws.name}) · ${ws.contactEmail}`);
    res.status(201).json({ ok: true, workspace: { slug: ws.slug, name: ws.name, trialEndsAt: ws.trialEndsAt } });
  }
}

/** Oturum gerektiren uçlar: yalnız varsayılan alanın sahibi tüm firmaları yönetir. */
export function registerWorkspaceAdminRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const admin = async (req: Request, res: Response): Promise<boolean> => {
    const auth = (req as Request & { auth?: AuthContext }).auth;
    if (!auth?.isOwner || (await workspaceByOwner(store, auth.ownerOpenId))) {
      res.status(403).json({ error: "OWNER_REQUIRED", message: "Bu ekran yalnız sistem yöneticisine açıktır." });
      return false;
    }
    return true;
  };

  app.get("/api/workspaces", async (req, res) => {
    if (!(await admin(req, res))) return;
    const out = [];
    for (const ws of await listWorkspaces(store)) {
      const [accounts, leads] = await Promise.all([raw.list(ACCOUNT_KIND, ws.ownerOpenId), raw.list("lead", ws.ownerOpenId)]);
      const lastLogin = accounts.map((r) => String((r.payload as LocalAccount).lastLoginAt || "")).sort().at(-1) || "";
      out.push({ ...ws, ownerOpenId: undefined, ...workspaceState(ws), users: accounts.length, leads: leads.length, lastLoginAt: lastLogin });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ workspaces: out, signup: signupEnabled(), trialDays: trialDays(), verifyEmail: verificationRequired() });
  });

  app.post("/api/workspaces/:slug", async (req, res) => {
    if (!(await admin(req, res))) return;
    const ws = await workspaceBySlug(store, String(req.params.slug || "").toLowerCase());
    if (!ws) return res.status(404).json({ error: "WORKSPACE_NOT_FOUND", message: "Çalışma alanı bulunamadı." });
    const body = req.body || {};
    const next: Workspace = { ...ws };
    if (["trial", "active", "suspended"].includes(String(body.status))) next.status = body.status;
    const extend = Number(body.extendDays);
    if (Number.isFinite(extend) && extend !== 0) {
      const base = Math.max(Date.now(), Date.parse(ws.trialEndsAt) || 0);
      next.trialEndsAt = new Date(base + Math.max(-365, Math.min(365, Math.round(extend))) * DAY).toISOString();
      if (next.status !== "active") next.status = "trial";
    }
    if (typeof body.note === "string") next.note = body.note.trim().slice(0, 500);
    await raw.put(WORKSPACE_KIND, ws.slug, next, WORKSPACE_SYSTEM_OWNER);
    res.json({ workspace: { ...next, ownerOpenId: undefined, ...workspaceState(next) } });
  });
}
