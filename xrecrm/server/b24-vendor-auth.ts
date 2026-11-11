// WhatsApp by XRE yönetim ekranı girişi (CRM'den bağımsız çalışırken).
// Şifre sunucunun .env dosyasındaki B24_ADMIN_PASSWORD değeridir; giriş başarılı
// olunca 7 gün geçerli, imzalı ve yalnız HTTP ile okunabilen bir çerez verilir.
import crypto from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { timingSafeEqualText } from "./security.js";

const COOKIE = "xre_wa_admin";
const TTL_MS = 7 * 24 * 60 * 60_000;

const secret = () => process.env.XRE_SESSION_SECRET?.trim() || "";
const sign = (exp: number) => crypto.createHmac("sha256", secret()).update(`wa-admin:${exp}`).digest("base64url");

export function adminPasswordConfigured() {
  return (process.env.B24_ADMIN_PASSWORD?.trim() || "").length >= 8 && Boolean(secret());
}

function cookieOf(req: Request): string {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === COOKIE) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

export function vendorAdminValid(req: Request, now = Date.now()): boolean {
  if (!adminPasswordConfigured()) return false;
  const [expText, sig] = cookieOf(req).split(".");
  const exp = Number(expText);
  return Boolean(exp && exp > now && sig && timingSafeEqualText(sig, sign(exp)));
}

const attempts = new Map<string, { count: number; at: number }>();

/**
 * /api/b24-admin altında: giriş / çıkış uçları ve geçerli çerezi olan isteğe
 * yönetici kimliği ekleyen ara katman. Çerez yoksa 401 LOGIN_REQUIRED döner.
 */
export function registerVendorAdminAuth(app: Express) {
  const json = express.json({ limit: "4kb" });
  app.post("/api/b24-admin/login", json, (req: Request, res: Response) => {
    if (!adminPasswordConfigured())
      return res.status(503).json({ error: "NOT_CONFIGURED", message: "Yönetim şifresi tanımlı değil. Sunucudaki .env dosyasına B24_ADMIN_PASSWORD ekleyin." });
    const ip = String(req.ip || req.socket.remoteAddress || "");
    const a = attempts.get(ip);
    if (a && a.count >= 5 && Date.now() - a.at < 10 * 60_000)
      return res.status(429).json({ error: "TOO_MANY", message: "Çok fazla hatalı deneme. 10 dakika sonra tekrar deneyin." });
    const ok = timingSafeEqualText(String(req.body?.password || ""), process.env.B24_ADMIN_PASSWORD!.trim());
    if (!ok) {
      attempts.set(ip, { count: (a && Date.now() - a.at < 10 * 60_000 ? a.count : 0) + 1, at: Date.now() });
      return res.status(401).json({ error: "BAD_PASSWORD", message: "Şifre hatalı." });
    }
    attempts.delete(ip);
    const exp = Date.now() + TTL_MS;
    const secure = req.secure || String(req.headers["x-forwarded-proto"] || "").startsWith("https");
    res.setHeader("set-cookie", `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_MS / 1000}${secure ? "; Secure" : ""}`);
    res.json({ ok: true });
  });
  app.post("/api/b24-admin/logout", (_req: Request, res: Response) => {
    res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });
  app.use("/api/b24-admin", (req: Request, res: Response, next: NextFunction) => {
    if (!vendorAdminValid(req)) return res.status(401).json({ error: "LOGIN_REQUIRED", message: "Yönetim ekranı için giriş yapın." });
    (req as Request & { auth?: unknown }).auth = { isOwner: true, user: { openId: "wa-admin", name: "XRE" } };
    next();
  });
}
