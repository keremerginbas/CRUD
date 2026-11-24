// "Şifremi unuttum": kullanıcıya e-postayla tek kullanımlık, 30 dakika geçerli bir bağlantı gönderilir.
// Bağlantıdaki kod veritabanında yalnız özet (sha256) olarak tutulur. Hesap var/yok bilgisi sızdırılmaz.
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import { rawStoreOf } from "./access.js";
import { revokeSessions } from "./auth.js";
import { ACCOUNT_KIND, hashPassword, type LocalAccount } from "./local-auth.js";
import { mailConfigured, sendMail } from "./mailer.js";
import { WORKSPACE_SYSTEM_OWNER, defaultSlug, workspaceBySlug } from "./workspaces.js";
import { passwordProblem } from "../shared/password.js";

export const RESET_KIND = "password-reset";
const RESET_MINUTES = 30;

interface ResetRecord {
  id: string;
  ownerOpenId: string;
  accountId: string;
  email: string;
  workspaceSlug: string;
  createdAt: string;
  expiresAt: string;
}

const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const brand = () => process.env.XRE_BRAND_NAME?.trim() || "XRE CRM";

// İstek sınırı (bellek içi): adres başına ve e-posta başına.
const hits = new Map<string, { count: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > max;
}
export const resetPasswordResetLimits = () => hits.clear();

function originOf(req: Request): string {
  const fixed = process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, "");
  if (fixed) return fixed;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${String(req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim()}`;
}

export function registerPasswordResetRoutes(app: Express, store: Store): void {
  const raw = rawStoreOf(store);
  const json = express.json({ limit: "8kb" });
  const send = (res: Response, status: number, error: string, message: string) => res.status(status).json({ error, message });

  const findValid = async (token: string): Promise<ResetRecord | null> => {
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
    const record = (await raw.get<ResetRecord>(RESET_KIND, sha(token), WORKSPACE_SYSTEM_OWNER))?.payload;
    if (!record || Date.parse(record.expiresAt) < Date.now()) return null;
    return record;
  };

  // Bağlantı isteme. Yanıt, hesabın var olup olmadığını belli etmez.
  app.post("/api/auth/forgot", json, async (req, res) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(320), workspace: z.string().trim().toLowerCase().max(40).optional() }).safeParse(req.body);
    if (!parsed.success) return void send(res, 400, "INVALID_EMAIL", "Geçerli bir e-posta girin.");
    if (!mailConfigured())
      return void send(res, 503, "MAIL_NOT_CONFIGURED", "Bu sistemde e-posta gönderimi ayarlı değil. Şifrenizi yöneticiniz sıfırlayabilir.");
    const { email } = parsed.data;
    if (limited(`ip|${req.ip}`, 10, 15 * 60_000) || limited(`mail|${email}`, 3, 15 * 60_000))
      return void send(res, 429, "TOO_MANY_ATTEMPTS", "Çok fazla istek. 15 dakika sonra tekrar deneyin.");
    const generic = { ok: true, message: "Bu e-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu ve gereksiz klasörünü kontrol edin." };
    try {
      const slug = parsed.data.workspace && parsed.data.workspace !== defaultSlug() ? parsed.data.workspace : "";
      const owner = slug ? (await workspaceBySlug(store, slug))?.ownerOpenId : await raw.resolveOwner();
      const account = owner ? (await raw.list<LocalAccount>(ACCOUNT_KIND, owner)).map((r) => r.payload).find((a) => a.email === email) : undefined;
      if (!owner || !account || !account.active) return void res.json(generic);
      const token = crypto.randomBytes(32).toString("base64url");
      const record: ResetRecord = {
        id: sha(token),
        ownerOpenId: owner,
        accountId: account.id,
        email,
        workspaceSlug: slug,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString(),
      };
      // Aynı hesabın önceki bağlantıları geçersiz olur.
      for (const row of await raw.list<ResetRecord>(RESET_KIND, WORKSPACE_SYSTEM_OWNER))
        if (row.payload.accountId === account.id || Date.parse(row.payload.expiresAt) < Date.now()) await raw.delete(RESET_KIND, row.id, WORKSPACE_SYSTEM_OWNER);
      await raw.put(RESET_KIND, record.id, record, WORKSPACE_SYSTEM_OWNER);
      // Canlı kurulumda bağlantı yalnız ayarlı site adresinden üretilir; istekteki Host başlığına
      // güvenilmez (sahte Host ile sıfırlama bağlantısı başka siteye yönlendirilemez).
      if (process.env.NODE_ENV === "production" && !process.env.PUBLIC_ORIGIN?.trim()) {
        console.warn("PUBLIC_ORIGIN ayarlı değil; şifre sıfırlama e-postası gönderilmedi.");
        return void res.json(generic);
      }
      const link = `${originOf(req)}/sifre-sifirla/${token}`;
      await sendMail({
        to: email,
        subject: `${brand()}: şifre sıfırlama`,
        text: `Merhaba ${account.name},\n\nŞifrenizi sıfırlamak için bağlantıyı açın ve yeni şifrenizi belirleyin:\n${link}\n\nBağlantı ${RESET_MINUTES} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.\n\n${brand()}`,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#152332;line-height:1.5;max-width:480px">
<p>Merhaba ${escapeHtml(account.name)},</p>
<p>Şifrenizi sıfırlamak için aşağıdaki düğmeye tıklayın ve yeni şifrenizi belirleyin.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0e7490;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">Yeni şifre belirle</a></p>
<p style="font-size:13px;color:#64748b">Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>${escapeHtml(link)}</p>
<p style="font-size:13px;color:#64748b">Bağlantı ${RESET_MINUTES} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı yok sayın; şifreniz değişmez.</p>
<p style="color:#64748b">${escapeHtml(brand())}</p></div>`,
      });
    } catch (error) {
      console.warn("Şifre sıfırlama e-postası gönderilemedi:", error instanceof Error ? error.message : error);
    }
    res.json(generic);
  });

  // Bağlantının geçerliliği (sayfa açılırken).
  app.get("/api/auth/reset/:token", async (req, res) => {
    if (limited(`view|${req.ip}`, 60, 15 * 60_000)) return void send(res, 429, "TOO_MANY_ATTEMPTS", "Çok fazla deneme. Biraz sonra tekrar deneyin.");
    const record = await findValid(String(req.params.token));
    if (!record) return void send(res, 410, "RESET_INVALID", "Bağlantı geçersiz veya süresi dolmuş. Giriş ekranından yeniden isteyin.");
    const [user, domain] = record.email.split("@");
    res.json({ email: `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`, workspace: record.workspaceSlug });
  });

  // Yeni şifreyi belirleme: bağlantı tek kullanımlıktır, açık oturumlar kapanır.
  app.post("/api/auth/reset/:token", json, async (req, res) => {
    if (limited(`set|${req.ip}`, 20, 15 * 60_000)) return void send(res, 429, "TOO_MANY_ATTEMPTS", "Çok fazla deneme. Biraz sonra tekrar deneyin.");
    const record = await findValid(String(req.params.token));
    if (!record) return void send(res, 410, "RESET_INVALID", "Bağlantı geçersiz veya süresi dolmuş. Giriş ekranından yeniden isteyin.");
    const password = String(req.body?.password ?? "");
    const problem = passwordProblem(password);
    if (problem) return void send(res, 400, "WEAK_PASSWORD", problem);
    // Önce bağlantıyı tüket: aynı bağlantı ikinci kez kullanılamaz.
    const claim = await raw.insertIfAbsent(`${RESET_KIND}-claim`, record.id, { at: new Date().toISOString() }, WORKSPACE_SYSTEM_OWNER);
    if (!claim.inserted) return void send(res, 410, "RESET_USED", "Bu bağlantı daha önce kullanılmış. Giriş ekranından yeniden isteyin.");
    await raw.delete(RESET_KIND, record.id, WORKSPACE_SYSTEM_OWNER);
    const account = (await raw.get<LocalAccount>(ACCOUNT_KIND, record.accountId, record.ownerOpenId))?.payload;
    if (!account || !account.active) return void send(res, 410, "RESET_INVALID", "Hesap bulunamadı veya pasif. Yöneticinize başvurun.");
    await raw.put(ACCOUNT_KIND, account.id, { ...account, passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() }, record.ownerOpenId);
    await revokeSessions(store, account.openId);
    res.json({ ok: true, workspace: record.workspaceSlug });
  });
}
