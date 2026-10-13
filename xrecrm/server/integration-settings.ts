import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import {
  SECRET_KEYS,
  SETTING_KEYS,
  type SettingStatus,
} from "../shared/integration-settings.js";

const KIND = "system-settings";
const ID = "integrations";

// Sunucu başlarken gerçek ortamdan gelen değerler; UI değeri silinince bunlara dönülür.
const envBaseline: Record<string, string | undefined> = Object.fromEntries(
  SETTING_KEYS.map((key) => [key, process.env[key]]),
);
const uiKeys = new Set<string>();

interface StoredSettings {
  id: string;
  values: Record<string, string>; // şifreli: iv.tag.ciphertext (base64url)
  updatedAt: string;
  updatedBy?: string;
}

function key(): Buffer {
  const material =
    process.env.XRE_SETTINGS_KEY?.trim() ||
    process.env.XRE_SESSION_SECRET?.trim() ||
    process.env.MANUS_JWT_SECRET?.trim();
  if (!material)
    throw Object.assign(new Error("Ayar şifreleme anahtarı yok (XRE_SESSION_SECRET)."), { statusCode: 503 });
  return crypto.createHash("sha256").update(`xre-settings:${material}`).digest();
}

export function encryptValue(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decryptValue(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function applyValues(values: Record<string, string>) {
  for (const k of uiKeys) {
    if (values[k] !== undefined) continue;
    if (envBaseline[k] === undefined) delete process.env[k];
    else process.env[k] = envBaseline[k];
    uiKeys.delete(k);
  }
  for (const [k, encrypted] of Object.entries(values)) {
    if (!SETTING_KEYS.includes(k)) continue;
    try {
      process.env[k] = decryptValue(encrypted);
      uiKeys.add(k);
    } catch {
      console.warn(`${k} ayarı çözülemedi (oturum anahtarı değişmiş olabilir); yeniden girin.`);
    }
  }
}

/** Sunucu başlangıcında kayıtlı ayarları ortam değişkenlerine uygular. */
export async function loadIntegrationSettings(store: Store): Promise<number> {
  const raw = rawStoreOf(store);
  const owner = await raw.resolveOwner().catch(() => undefined);
  if (!owner) return 0;
  const stored = (await raw.get<StoredSettings>(KIND, ID, owner))?.payload;
  applyValues(stored?.values || {});
  return Object.keys(stored?.values || {}).length;
}

function preview(k: string, value: string): string {
  if (!SECRET_KEYS.has(k)) return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  return value.length > 8 ? `••••${value.slice(-4)}` : "••••";
}

export function settingsStatus(): SettingStatus[] {
  return SETTING_KEYS.map((k) => {
    const value = process.env[k]?.trim() || "";
    return {
      key: k,
      configured: Boolean(value),
      source: !value ? null : uiKeys.has(k) ? "ui" : "env",
      preview: value ? preview(k, value) : "",
    };
  });
}

export function registerIntegrationSettingsRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  const owner = (req: Request, res: Response) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner) {
      res.status(403).json({ error: "OWNER_REQUIRED", message: "Entegrasyon anahtarlarını yalnız çalışma alanı sahibi yönetir." });
      return null;
    }
    return auth;
  };

  app.get("/api/settings/integrations", (req, res) => {
    if (!owner(req, res)) return;
    res.json({ settings: settingsStatus() });
  });

  app.put("/api/settings/integrations", async (req, res) => {
    const auth = owner(req, res);
    if (!auth) return;
    try {
      const input = req.body?.values;
      if (!input || typeof input !== "object" || Array.isArray(input))
        return res.status(400).json({ error: "INVALID", message: "values nesnesi gerekli." });
      const current = (await raw.get<StoredSettings>(KIND, ID, auth.ownerOpenId))?.payload;
      const values = { ...(current?.values || {}) };
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (!SETTING_KEYS.includes(k))
          return res.status(400).json({ error: "UNKNOWN_KEY", message: `${k} düzenlenebilir bir ayar değil.` });
        if (v === null || v === "") delete values[k];
        else if (typeof v === "string" && v.length <= 20000) values[k] = encryptValue(v.trim());
        else return res.status(400).json({ error: "INVALID_VALUE", message: `${k} değeri geçersiz.` });
      }
      await raw.put(
        KIND,
        ID,
        { id: ID, values, updatedAt: new Date().toISOString(), updatedBy: auth.user.openId },
        auth.ownerOpenId,
      );
      applyValues(values);
      res.json({ settings: settingsStatus() });
    } catch (error) {
      const status = Number((error as any)?.statusCode) || 500;
      res.status(status).json({ error: "SETTINGS_FAILED", message: status === 500 ? "Ayarlar kaydedilemedi." : (error as Error).message });
    }
  });
}
