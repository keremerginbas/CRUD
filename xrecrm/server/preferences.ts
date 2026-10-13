import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  DEFAULT_PREFERENCES,
  PreferencesSchema,
  USER_PREFERENCE_KIND,
  type Preferences,
} from "../shared/preferences.js";
import type { Store } from "./db.js";
import { rawStoreOf } from "./access.js";
import type { AuthContext } from "./types.js";

const authOf = (req: Request): AuthContext | undefined =>
  (req as Request & { auth?: AuthContext }).auth;

/**
 * The openId is never used as a record id directly. Hashing keeps the row
 * address stable while avoiding the accidental disclosure of an identity in
 * storage or logs.
 */
export function preferenceRecordKey(openId: string): string {
  return createHash("sha256").update(openId, "utf8").digest("hex");
}

function requireAuth(req: Request, res: Response): AuthContext | null {
  const auth = authOf(req);
  if (!auth) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Geçerli Manus oturumu gerekli.",
    });
    return null;
  }
  return auth;
}

function invalidPreferences(res: Response, error: unknown) {
  return res.status(400).json({
    error: "INVALID_PREFERENCES",
    message: "Geçerli görünüm tercihleri gerekli.",
    issues: error instanceof Error ? error.message : undefined,
  });
}

/**
 * Register only /api/preferences GET and PUT. There is intentionally no user
 * id in the URL or body: existing auth middleware supplies the signed actor,
 * and both the owner scope and hashed actor key are derived server-side.
 */
export function registerPreferenceRoutes(app: Express, rawStore: Store): void {
  const raw = rawStoreOf(rawStore);

  app.get("/api/preferences", async (req, res) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const key = preferenceRecordKey(auth.user.openId);
    try {
      const record = await raw.get<Preferences>(
        USER_PREFERENCE_KIND,
        key,
        auth.ownerOpenId,
      );
      const parsed = PreferencesSchema.safeParse(record?.payload);
      return res.json(parsed.success ? parsed.data : DEFAULT_PREFERENCES);
    } catch (error) {
      return res.status(500).json({
        error: "SERVER_ERROR",
        message: "Görünüm tercihleri okunamadı.",
      });
    }
  });

  const save = async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const parsed = PreferencesSchema.safeParse(req.body);
    if (!parsed.success) return invalidPreferences(res, parsed.error);
    const key = preferenceRecordKey(auth.user.openId);
    try {
      const saved = await raw.put(
        USER_PREFERENCE_KIND,
        key,
        parsed.data,
        auth.ownerOpenId,
      );
      return res.json(PreferencesSchema.parse(saved.payload));
    } catch (error) {
      return res.status(500).json({
        error: "SERVER_ERROR",
        message: "Görünüm tercihleri kaydedilemedi.",
      });
    }
  };

  app.put("/api/preferences", save);
}
