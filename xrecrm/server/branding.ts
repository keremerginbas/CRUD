// Firma kimliği: müşteriye özel kurulumda CRM, firmanın adı ve logosuyla görünür
// (yan menü, giriş ekranı, tarayıcı sekmesi ve teklif PDF'i). Varsayılan çalışma alanının sahibi belirler.
import crypto from "node:crypto";
import type { Express, Request } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { mailConfigured, sendMail } from "./mailer.js";

const KIND = "branding";
const ID = "branding";
/** Logo üst sınırı (dosya boyutu). */
export const LOGO_MAX_BYTES = 400_000;

interface Branding {
  name: string;
  /** PNG veya JPEG; taban64. */
  logoBase64: string;
  logoType: "image/png" | "image/jpeg" | "";
  updatedAt: string;
}

const detect = (bytes: Buffer): Branding["logoType"] =>
  bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? "image/png"
    : bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "image/jpeg"
      : "";

async function load(store: Store): Promise<Branding | null> {
  const raw = rawStoreOf(store);
  const owner = await raw.resolveOwner().catch(() => undefined);
  if (!owner) return null;
  return (await raw.get<Branding>(KIND, ID, owner))?.payload || null;
}

/** Teklif PDF'i gibi belgeler için logo (yoksa null). */
export async function brandLogo(store: Store, ownerOpenId?: string): Promise<Buffer | null> {
  // Logo kurulumun sahibine aittir; aynı sunucudaki başka firmaların belgelerine basılmaz.
  if (ownerOpenId && ownerOpenId !== (await rawStoreOf(store).resolveOwner().catch(() => undefined))) return null;
  const b = await load(store);
  return b?.logoBase64 ? Buffer.from(b.logoBase64, "base64") : null;
}

const publicInfo = (b: Branding | null) => ({
  // Kurulumda verilen ad (XRE_BRAND_NAME), arayüzden bir ad kaydedilene kadar kullanılır.
  name: b?.name || process.env.XRE_BRAND_NAME?.trim().slice(0, 80) || "",
  logoUrl: b?.logoBase64 ? `/api/branding/logo?v=${crypto.createHash("sha1").update(b.updatedAt).digest("hex").slice(0, 10)}` : null,
});

/** Giriş ekranı da kullandığı için oturum gerektirmez; yalnız ad ve logo döner. requireAuth'tan önce bağlanır. */
export function registerBrandingPublicRoutes(app: Express, store: Store): void {
  app.get("/api/branding", async (_req, res) => {
    res.setHeader("cache-control", "no-cache");
    res.json(publicInfo(await load(store).catch(() => null)));
  });
  app.get("/api/branding/logo", async (_req, res) => {
    const b = await load(store).catch(() => null);
    if (!b?.logoBase64 || !b.logoType) return void res.status(404).end();
    res.setHeader("content-type", b.logoType);
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(Buffer.from(b.logoBase64, "base64"));
  });
}

/** Değiştirme uçları: yalnız varsayılan çalışma alanının sahibi. requireAuth'tan sonra bağlanır. */
export function registerBrandingAdminRoutes(app: Express, store: Store): void {
  const raw = rawStoreOf(store);
  const Body = z.object({
    name: z.string().trim().max(80).default(""),
    /** Verilmezse mevcut logo korunur; boş dize logoyu kaldırır. */
    logoBase64: z.string().max(Math.ceil(LOGO_MAX_BYTES * 1.4)).optional(),
  });
  // Entegrasyonlar ekranındaki "Bağlantıyı test et": sahibin kendi adresine deneme e-postası gönderir.
  app.post("/api/integrations/mail/test", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner) return void res.status(403).json({ error: "FORBIDDEN", message: "Bağlantıyı yalnız çalışma alanı sahibi test edebilir." });
    if (!mailConfigured()) return void res.status(503).json({ error: "MAIL_NOT_CONFIGURED", message: "Posta sunucusu, kullanıcı adı ve şifre girilmeli." });
    const to = String(auth.user.email || "").trim();
    if (!to) return void res.status(400).json({ error: "NO_EMAIL", message: "Hesabınızda e-posta adresi yok; deneme e-postası gönderilemedi." });
    try {
      await sendMail({ to, subject: "Deneme e-postası", text: "Sistem e-postası ayarlarınız çalışıyor. Bu iletiyi siz istediniz; yanıtlamanız gerekmez." });
      res.json({ provider: "mail", configured: true, connected: true, message: `Deneme e-postası ${to} adresine gönderildi.` });
    } catch (error) {
      res.status(502).json({ error: "MAIL_FAILED", message: `E-posta gönderilemedi: ${(error as Error).message}`.slice(0, 300) });
    }
  });

  app.put("/api/branding", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    const owner = await raw.resolveOwner().catch(() => undefined);
    if (!auth?.isOwner || !owner || auth.ownerOpenId !== owner)
      return void res.status(403).json({ error: "FORBIDDEN", message: "Firma logosunu yalnız sistem sahibi değiştirebilir." });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "INVALID_REQUEST", message: "Logo çok büyük veya istek geçersiz." });
    const current = (await raw.get<Branding>(KIND, ID, owner))?.payload;
    let logoBase64 = current?.logoBase64 || "";
    let logoType: Branding["logoType"] = current?.logoType || "";
    if (parsed.data.logoBase64 !== undefined) {
      if (!parsed.data.logoBase64) {
        logoBase64 = "";
        logoType = "";
      } else {
        const bytes = Buffer.from(parsed.data.logoBase64, "base64");
        const type = detect(bytes);
        if (!type) return void res.status(400).json({ error: "INVALID_LOGO", message: "Logo PNG veya JPG dosyası olmalı." });
        if (bytes.length > LOGO_MAX_BYTES) return void res.status(400).json({ error: "LOGO_TOO_LARGE", message: `Logo en fazla ${Math.round(LOGO_MAX_BYTES / 1000)} KB olabilir.` });
        logoBase64 = bytes.toString("base64");
        logoType = type;
      }
    }
    const next: Branding = { name: parsed.data.name, logoBase64, logoType, updatedAt: new Date().toISOString() };
    await raw.put(KIND, ID, next, owner);
    res.json(publicInfo(next));
  });
}
