// Çalışan daveti: sahip bir e-posta adresine davet gönderir; çalışan bağlantıya
// tıklayıp adını ve şifresini kendisi belirleyerek hesabını açar.
// Davet kaydı sistem kapsamındadır; bağlantıdaki kod yalnızca özet (sha256) olarak saklanır.
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import type { AccessEmployee } from "../shared/access.js";
import { allRoles, rawStoreOf } from "./access.js";
import { forwardedOrigin } from "./auth.js";
import { ACCOUNT_KIND, hashPassword, publicAccount, setSession, type LocalAccount } from "./local-auth.js";
import { mailConfigured, sendMail } from "./mailer.js";
import { WORKSPACE_SYSTEM_OWNER, workspaceByOwner } from "./workspaces.js";

export const INVITE_KIND = "employee-invite";
const INVITE_DAYS = 7;
const MAX_PENDING = 200;

export interface EmployeeInvite {
  id: string;
  tokenHash: string;
  ownerOpenId: string;
  email: string;
  name: string;
  roleId: string;
  departmentId: string;
  invitedBy: string;
  company: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

const now = () => new Date().toISOString();
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const escapeHtml = (v: string) =>
  v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const emailSchema = z.string().trim().toLowerCase().email("Geçerli bir e-posta girin.").max(320);
const nameSchema = z.string().trim().min(2, "Ad soyad gerekli.").max(200);
const passwordSchema = z
  .string()
  .min(8, "Şifre en az 8 karakter olmalı.")
  .max(200)
  .refine((v) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) && /\d/.test(v), "Şifre harf ve rakam içermeli.");

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function fail(res: Response, error: unknown) {
  if (error instanceof HttpError)
    return res.status(error.statusCode).json({ error: error.code, message: error.message });
  if (error instanceof z.ZodError)
    return res.status(400).json({ error: "REQUEST_FAILED", message: error.issues[0]?.message || "Geçersiz istek." });
  res.status(500).json({ error: "SERVER_ERROR", message: "Beklenmeyen sunucu hatası." });
}

// Davet kodu denemelerini ve davet gönderimini sınırlar (bellek içi, süreç başına).
const hits = new Map<string, { count: number; reset: number }>();
function limited(key: string, max: number, windowMs: number): boolean {
  const entry = hits.get(key);
  const t = Date.now();
  if (!entry || entry.reset < t) {
    hits.set(key, { count: 1, reset: t + windowMs });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
    return false;
  }
  entry.count++;
  return entry.count > max;
}
export const resetInviteLimits = () => hits.clear();

const publicInvite = (invite: EmployeeInvite) => ({
  id: invite.id,
  email: invite.email,
  name: invite.name,
  roleId: invite.roleId,
  departmentId: invite.departmentId,
  createdAt: invite.createdAt,
  expiresAt: invite.expiresAt,
});

async function companyName(store: Store, owner: string): Promise<string> {
  const ws = await workspaceByOwner(store, owner);
  return ws?.name || "XRE CRM";
}

function inviteMail(invite: EmployeeInvite, link: string, inviter: string) {
  const who = inviter ? `${inviter} sizi` : "Sizi";
  return sendMail({
    to: invite.email,
    subject: `${invite.company} sizi XRE CRM'e davet etti`,
    text: `Merhaba${invite.name ? ` ${invite.name}` : ""},\n\n${who} ${invite.company} ekibine XRE CRM üzerinden davet etti.\n\nHesabınızı oluşturmak için bağlantıyı açın, adınızı ve şifrenizi belirleyin:\n${link}\n\nBağlantı ${INVITE_DAYS} gün geçerlidir. Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.\n\nXRE CRM`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#152332;line-height:1.5;max-width:480px">
<p>Merhaba${invite.name ? ` ${escapeHtml(invite.name)}` : ""},</p>
<p>${escapeHtml(who)} <b>${escapeHtml(invite.company)}</b> ekibine XRE CRM üzerinden davet etti.</p>
<p>Hesabınızı oluşturmak için aşağıdaki düğmeye tıklayın; adınızı ve şifrenizi kendiniz belirleyeceksiniz.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0e7490;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">Daveti kabul et</a></p>
<p style="font-size:13px;color:#64748b">Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>${escapeHtml(link)}</p>
<p style="font-size:13px;color:#64748b">Bağlantı ${INVITE_DAYS} gün geçerlidir. Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz.</p>
<p style="color:#64748b">XRE CRM</p></div>`,
  });
}

async function findValid(store: Store, token: string): Promise<EmployeeInvite> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token))
    throw new HttpError(404, "INVITE_NOT_FOUND", "Davet bağlantısı geçersiz.");
  const invite = (await rawStoreOf(store).get<EmployeeInvite>(INVITE_KIND, sha(token), WORKSPACE_SYSTEM_OWNER))?.payload;
  if (!invite) throw new HttpError(404, "INVITE_NOT_FOUND", "Davet bağlantısı geçersiz veya iptal edilmiş.");
  if (invite.usedAt) throw new HttpError(410, "INVITE_USED", "Bu davet daha önce kullanılmış. Giriş ekranından oturum açın.");
  if (Date.parse(invite.expiresAt) < Date.now())
    throw new HttpError(410, "INVITE_EXPIRED", "Davetin süresi dolmuş. Yöneticinizden yeni davet isteyin.");
  return invite;
}

/** Oturum gerektirmeyen uçlar: daveti görüntüleme ve kabul etme. */
export function registerInvitePublicRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const json = express.json({ limit: "16kb" });

  app.get("/api/auth/invite/:token", async (req, res) => {
    try {
      if (limited(`view|${req.ip}`, 60, 15 * 60_000))
        throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Çok fazla deneme. Biraz sonra tekrar deneyin.");
      const invite = await findValid(store, String(req.params.token));
      const role = (await allRoles(raw, invite.ownerOpenId)).find((r) => r.id === invite.roleId);
      res.json({ email: invite.email, name: invite.name, company: invite.company, role: role?.name || "" });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/auth/invite/:token", json, async (req, res) => {
    try {
      if (limited(`accept|${req.ip}`, 20, 15 * 60_000))
        throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Çok fazla deneme. Biraz sonra tekrar deneyin.");
      const invite = await findValid(store, String(req.params.token));
      const input = z
        .object({
          name: nameSchema,
          password: passwordSchema,
          phone: z.string().trim().max(80).optional(),
          title: z.string().trim().max(200).optional(),
        })
        .parse(req.body);
      const owner = invite.ownerOpenId;
      const existing = (await raw.list<LocalAccount>(ACCOUNT_KIND, owner)).map((r) => r.payload);
      if (existing.some((a) => a.email === invite.email))
        throw new HttpError(409, "EMAIL_EXISTS", "Bu e-posta ile bir hesap zaten var. Giriş ekranından oturum açın.");
      const role = (await allRoles(raw, owner)).find((r) => r.id === invite.roleId);
      if (!role || role.id === "owner")
        throw new HttpError(409, "INVALID_ROLE", "Davetteki rol artık geçerli değil. Yöneticinizden yeni davet isteyin.");
      // Daveti önce "kullanıldı" olarak işaretle: aynı bağlantı iki kez hesap açamaz.
      const claim = await raw.insertIfAbsent(`${INVITE_KIND}-claim`, invite.id, { at: now() }, WORKSPACE_SYSTEM_OWNER);
      if (!claim.inserted)
        throw new HttpError(410, "INVITE_USED", "Bu davet daha önce kullanılmış. Giriş ekranından oturum açın.");
      const claimed: EmployeeInvite = { ...invite, usedAt: now() };
      await raw.put(INVITE_KIND, invite.id, claimed, WORKSPACE_SYSTEM_OWNER);
      const id = `acc_${crypto.randomBytes(8).toString("hex")}`;
      const openId = `local:${id}`;
      const employee: AccessEmployee = {
        id: `employee_${crypto.randomBytes(6).toString("hex")}`,
        name: input.name,
        email: invite.email,
        openId,
        departmentId: invite.departmentId || "",
        roleId: role.id,
        active: true,
        title: input.title || "",
        phone: input.phone || "",
        createdAt: now(),
        updatedAt: now(),
      };
      const account: LocalAccount = {
        id,
        openId,
        name: input.name,
        email: invite.email,
        passwordHash: await hashPassword(input.password),
        active: true,
        employeeId: employee.id,
        createdAt: now(),
        updatedAt: now(),
        lastLoginAt: now(),
      };
      await raw.put("employee", employee.id, employee, owner);
      await raw.put(ACCOUNT_KIND, id, account, owner);
      const defaultOwner = await raw.resolveOwner();
      const ws = owner === defaultOwner ? null : await workspaceByOwner(store, owner);
      await setSession(req, res, account, { workspace: ws ? owner : undefined });
      res.status(201).json({ ok: true, user: publicAccount(account), workspace: ws?.slug || "" });
    } catch (error) {
      fail(res, error);
    }
  });
}

/** Oturum gerektiren uçlar (yalnız sahip): davet gönderme, listeleme, iptal. */
export function registerInviteAdminRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const ownerOnly = (req: Request, res: Response) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner) {
      res.status(403).json({ error: "OWNER_REQUIRED", message: "Bu işlem yalnız çalışma alanı sahibine açıktır." });
      return null;
    }
    return auth;
  };
  const pendingOf = async (owner: string) =>
    (await raw.list<EmployeeInvite>(INVITE_KIND, WORKSPACE_SYSTEM_OWNER))
      .map((r) => r.payload)
      .filter((i) => i.ownerOpenId === owner && !i.usedAt && Date.parse(i.expiresAt) > Date.now())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  app.get("/api/auth/invites", async (req, res) => {
    const auth = ownerOnly(req, res);
    if (!auth) return;
    res.json({ invites: (await pendingOf(auth.ownerOpenId)).map(publicInvite), mail: mailConfigured() });
  });

  app.post("/api/auth/invites", async (req, res) => {
    const auth = ownerOnly(req, res);
    if (!auth) return;
    try {
      const input = z
        .object({
          email: emailSchema,
          name: z.string().trim().max(200).optional(),
          roleId: z.string().trim().min(1, "Rol seçin.").max(191),
          departmentId: z.string().max(191).optional(),
        })
        .parse(req.body);
      const owner = auth.ownerOpenId;
      if (limited(`send|${owner}`, 60, 60 * 60_000))
        throw new HttpError(429, "TOO_MANY_INVITES", "Bir saatte en fazla 60 davet gönderilebilir.");
      const accounts = (await raw.list<LocalAccount>(ACCOUNT_KIND, owner)).map((r) => r.payload);
      if (accounts.some((a) => a.email === input.email))
        throw new HttpError(409, "EMAIL_EXISTS", "Bu e-posta ile bir hesap zaten var.");
      const role = (await allRoles(raw, owner)).find((r) => r.id === input.roleId);
      if (!role || role.id === "owner")
        throw new HttpError(400, "INVALID_ROLE", "Geçerli ve sahibi olmayan bir rol seçin.");
      const pending = await pendingOf(owner);
      if (pending.length >= MAX_PENDING)
        throw new HttpError(400, "TOO_MANY_PENDING", "Bekleyen davet sayısı çok fazla; eskilerini iptal edin.");
      // Aynı adrese yeni davet, eskisini geçersiz kılar.
      for (const old of pending.filter((i) => i.email === input.email))
        await raw.delete(INVITE_KIND, old.id, WORKSPACE_SYSTEM_OWNER);
      const token = crypto.randomBytes(32).toString("base64url");
      const invite: EmployeeInvite = {
        id: sha(token),
        tokenHash: sha(token),
        ownerOpenId: owner,
        email: input.email,
        name: input.name || "",
        roleId: role.id,
        departmentId: input.departmentId || "",
        invitedBy: auth.user.name || "",
        company: await companyName(store, owner),
        createdAt: now(),
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
      };
      await raw.put(INVITE_KIND, invite.id, invite, WORKSPACE_SYSTEM_OWNER);
      const origin = process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, "") || forwardedOrigin(req);
      const link = `${origin}/davet/${token}`;
      let sent = false;
      let mailError = "";
      if (mailConfigured()) {
        try {
          await inviteMail(invite, link, invite.invitedBy);
          sent = true;
        } catch {
          mailError = "Davet e-postası gönderilemedi; bağlantıyı kopyalayıp kendiniz iletebilirsiniz.";
        }
      }
      // Bağlantı yalnızca bu yanıtta döner; sonradan yeniden görüntülenemez.
      res.status(201).json({ invite: publicInvite(invite), link, sent, mailError });
    } catch (error) {
      fail(res, error);
    }
  });

  app.delete("/api/auth/invites/:id", async (req, res) => {
    const auth = ownerOnly(req, res);
    if (!auth) return;
    const id = String(req.params.id);
    const invite = (await raw.get<EmployeeInvite>(INVITE_KIND, id, WORKSPACE_SYSTEM_OWNER))?.payload;
    if (!invite || invite.ownerOpenId !== auth.ownerOpenId)
      return res.status(404).json({ error: "NOT_FOUND", message: "Davet bulunamadı." });
    await raw.delete(INVITE_KIND, id, WORKSPACE_SYSTEM_OWNER);
    res.json({ ok: true });
  });
}
