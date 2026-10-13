// Bağımsız (Manus'suz) e-posta + şifre girişi.
// Hesaplar sahibin kapsamındaki "local-account" kayıtlarında, şifreler scrypt
// özetiyle saklanır. Oturum mevcut JWT çerezini kullanır; çalışan yetkileri
// erişim modülündeki "employee" kaydı (openId = local:<id>) üzerinden gelir.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import type { AccessEmployee } from "../shared/access.js";
import { allRoles, rawStoreOf } from "./access.js";
import {
  SESSION_COOKIE,
  cookieHeader,
  createSessionToken,
  publicHttps,
} from "./auth.js";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const ACCOUNT_KIND = "local-account";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export interface LocalAccount {
  id: string;
  openId: string;
  name: string;
  email: string;
  passwordHash: string;
  active: boolean;
  employeeId?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

const now = () => new Date().toISOString();

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * Oturum imza anahtarı yoksa bir kez üretir ve data/ altına kaydeder;
 * böylece kurulum için .env düzenlemek gerekmez.
 */
export function ensureSessionSecret(projectRoot: string): string {
  if (process.env.MANUS_JWT_SECRET?.trim() || process.env.XRE_SESSION_SECRET?.trim())
    return "env";
  const dir = path.resolve(projectRoot, process.env.XRE_DATA_DIR || "data");
  const file = path.join(dir, "session-secret");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) {
      process.env.XRE_SESSION_SECRET = existing;
      return file;
    }
  } catch {
    /* ilk çalıştırma */
  }
  fs.mkdirSync(dir, { recursive: true });
  const secret = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  process.env.XRE_SESSION_SECRET = secret;
  return file;
}

const passwordSchema = z
  .string()
  .min(8, "Şifre en az 8 karakter olmalı.")
  .max(200)
  .refine((v) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(v) && /\d/.test(v), "Şifre harf ve rakam içermeli.");
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Geçerli bir e-posta girin.")
  .max(320);
const nameSchema = z.string().trim().min(2, "Ad soyad gerekli.").max(200);

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new Error(result.error.issues[0]?.message || "Geçersiz istek.");
    throw Object.assign(error, { statusCode: 400 });
  }
  return result.data;
}

function fail(res: Response, error: unknown) {
  const status = Number((error as any)?.statusCode) || 500;
  res.status(status).json({
    error: status === 500 ? "SERVER_ERROR" : "REQUEST_FAILED",
    message: status === 500 ? "Beklenmeyen sunucu hatası." : (error as Error).message,
  });
}

export function publicAccount(account: LocalAccount) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    active: account.active,
    employeeId: account.employeeId,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
  };
}

// Basit kaba kuvvet koruması: IP + e-posta için 15 dakikada 10 deneme.
const attempts = new Map<string, { count: number; first: number }>();
function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > 15 * 60_000) return false;
  return entry.count >= 10;
}
function recordFailure(key: string) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > 15 * 60_000)
    attempts.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}

export async function setSession(req: Request, res: Response, account: LocalAccount) {
  const token = await createSessionToken({
    openId: account.openId,
    name: account.name,
    email: account.email,
  });
  res.setHeader(
    "Set-Cookie",
    cookieHeader(SESSION_COOKIE, token, SESSION_SECONDS, publicHttps(req)),
  );
}

export function manusConfigured(): boolean {
  return Boolean(
    process.env.MANUS_OAUTH_PORTAL_URL?.trim() &&
      (process.env.MANUS_PROJECT_ID?.trim() || process.env.MANUS_APP_ID?.trim()),
  );
}

/** Kimlik doğrulaması gerektirmeyen giriş/kurulum uçları. */
export function registerLocalAuthRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const json = express.json({ limit: "32kb" });

  const findByEmail = async (owner: string, email: string) =>
    (await raw.list<LocalAccount>(ACCOUNT_KIND, owner))
      .map((r) => r.payload)
      .find((a) => a.email === email);

  app.post("/api/auth/setup", json, async (req, res) => {
    try {
      const input = parse(
        z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }),
        req.body,
      );
      if (await raw.resolveOwner())
        return res.status(409).json({
          error: "ALREADY_SET_UP",
          message: "Yönetici hesabı zaten oluşturulmuş. Giriş yapın.",
        });
      const id = `acc_${crypto.randomBytes(8).toString("hex")}`;
      const account: LocalAccount = {
        id,
        openId: `local:${id}`,
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        active: true,
        createdAt: now(),
        updatedAt: now(),
        lastLoginAt: now(),
      };
      const claim = await raw.claimOwner({
        openId: account.openId,
        name: account.name,
        email: account.email,
      });
      if (!claim.isOwner)
        return res.status(409).json({
          error: "ALREADY_SET_UP",
          message: "Başka bir yönetici aynı anda kurulumu tamamladı.",
        });
      await raw.put(ACCOUNT_KIND, id, account, claim.ownerOpenId);
      await setSession(req, res, account);
      res.status(201).json({ ok: true, user: publicAccount(account) });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/auth/local-login", json, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const key = `${req.ip}|${email}`;
    try {
      if (tooManyAttempts(key))
        return res.status(429).json({
          error: "TOO_MANY_ATTEMPTS",
          message: "Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.",
        });
      const owner = await raw.resolveOwner();
      if (!owner)
        return res.status(409).json({ error: "SETUP_REQUIRED", message: "Önce yönetici hesabını oluşturun." });
      const account = email ? await findByEmail(owner, email) : undefined;
      // Hesap yoksa da şifre özeti hesaplanır; yanıt süresi e-postayı ele vermez.
      const valid = account
        ? await verifyPassword(password, account.passwordHash)
        : (await hashPassword(password), false);
      if (!account || !valid) {
        recordFailure(key);
        return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-posta veya şifre hatalı." });
      }
      if (!account.active)
        return res.status(403).json({ error: "ACCOUNT_DISABLED", message: "Hesabınız pasif. Yöneticinize başvurun." });
      attempts.delete(key);
      const updated = { ...account, lastLoginAt: now() };
      await raw.put(ACCOUNT_KIND, account.id, updated, owner);
      await setSession(req, res, updated);
      res.json({ ok: true, user: publicAccount(updated) });
    } catch (error) {
      fail(res, error);
    }
  });
}

/** Oturum gerektiren hesap yönetimi uçları (requireAuth sonrasında bağlanır). */
export function registerLocalAccountRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
  const ownerOnly = (req: Request, res: Response) => {
    const auth = authOf(req);
    if (!auth?.isOwner) {
      res.status(403).json({ error: "OWNER_REQUIRED", message: "Bu işlem yalnız çalışma alanı sahibine açıktır." });
      return null;
    }
    return auth;
  };
  const accounts = async (owner: string) =>
    (await raw.list<LocalAccount>(ACCOUNT_KIND, owner)).map((r) => r.payload);

  app.get("/api/auth/accounts", async (req, res) => {
    const auth = ownerOnly(req, res);
    if (!auth) return;
    res.json({ accounts: (await accounts(auth.ownerOpenId)).map(publicAccount) });
  });

  app.post("/api/auth/accounts", async (req, res) => {
    const auth = ownerOnly(req, res);
    if (!auth) return;
    try {
      const input = parse(
        z.object({
          name: nameSchema,
          email: emailSchema,
          password: passwordSchema,
          roleId: z.string().trim().min(1, "Rol seçin.").max(191),
          departmentId: z.string().max(191).optional(),
          title: z.string().max(200).optional(),
          phone: z.string().max(80).optional(),
        }),
        req.body,
      );
      const owner = auth.ownerOpenId;
      if ((await accounts(owner)).some((a) => a.email === input.email))
        return res.status(409).json({ error: "EMAIL_EXISTS", message: "Bu e-posta ile bir hesap zaten var." });
      const role = (await allRoles(raw, owner)).find((r) => r.id === input.roleId);
      if (!role || role.id === "owner")
        return res.status(400).json({ error: "INVALID_ROLE", message: "Geçerli ve sahibi olmayan bir rol seçin." });
      const id = `acc_${crypto.randomBytes(8).toString("hex")}`;
      const openId = `local:${id}`;
      const employee: AccessEmployee = {
        id: `employee_${crypto.randomBytes(6).toString("hex")}`,
        name: input.name,
        email: input.email,
        openId,
        departmentId: input.departmentId || "",
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
        email: input.email,
        passwordHash: await hashPassword(input.password),
        active: true,
        employeeId: employee.id,
        createdAt: now(),
        updatedAt: now(),
      };
      await raw.put("employee", employee.id, employee, owner);
      await raw.put(ACCOUNT_KIND, id, account, owner);
      res.status(201).json({ account: publicAccount(account), employee });
    } catch (error) {
      fail(res, error);
    }
  });

  app.patch("/api/auth/accounts/:id", async (req, res) => {
    const auth = ownerOnly(req, res);
    if (!auth) return;
    try {
      const owner = auth.ownerOpenId;
      const account = (await raw.get<LocalAccount>(ACCOUNT_KIND, String(req.params.id), owner))?.payload;
      if (!account) return res.status(404).json({ error: "NOT_FOUND", message: "Hesap bulunamadı." });
      const input = parse(
        z.object({ password: passwordSchema.optional(), active: z.boolean().optional(), name: nameSchema.optional() }),
        req.body,
      );
      if (account.openId === auth.user.openId && input.active === false)
        return res.status(400).json({ error: "SELF_DISABLE", message: "Kendi hesabınızı pasifleştiremezsiniz." });
      const next: LocalAccount = {
        ...account,
        ...(input.name ? { name: input.name } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
        updatedAt: now(),
      };
      await raw.put(ACCOUNT_KIND, account.id, next, owner);
      if (account.employeeId && (input.active !== undefined || input.name)) {
        const employee = (await raw.get<AccessEmployee>("employee", account.employeeId, owner))?.payload;
        if (employee)
          await raw.put(
            "employee",
            employee.id,
            {
              ...employee,
              ...(input.active !== undefined ? { active: input.active } : {}),
              ...(input.name ? { name: input.name } : {}),
              updatedAt: now(),
            },
            owner,
          );
      }
      res.json({ account: publicAccount(next) });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/auth/password", async (req, res) => {
    const auth = authOf(req);
    try {
      const input = parse(
        z.object({ current: z.string().min(1, "Mevcut şifre gerekli."), next: passwordSchema }),
        req.body,
      );
      const account = (await accounts(auth.ownerOpenId)).find((a) => a.openId === auth.user.openId);
      if (!account)
        return res.status(400).json({ error: "NOT_LOCAL", message: "Bu oturum yerel bir hesaba ait değil." });
      if (!(await verifyPassword(input.current, account.passwordHash)))
        return res.status(400).json({ error: "WRONG_PASSWORD", message: "Mevcut şifre hatalı." });
      await raw.put(
        ACCOUNT_KIND,
        account.id,
        { ...account, passwordHash: await hashPassword(input.next), updatedAt: now() },
        auth.ownerOpenId,
      );
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });
}

