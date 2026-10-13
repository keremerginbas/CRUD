import type { Express, Request, Response } from "express";
import {
  CRM_WORKSPACE_DEFAULT_PREFERENCES,
  CRM_WORKSPACE_PREFERENCE_KIND,
  crmWorkspacePreferencesSchema,
  type CrmWorkspacePreferences,
  safeCrmWorkspacePreferences,
} from "../shared/crm-workspace.js";
import { canAccess, currentPermissionContext, rawStoreOf } from "./access.js";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";

interface AuthedRequest extends Request {
  auth?: AuthContext;
}

function authOf(req: Request): AuthContext | undefined {
  return currentPermissionContext()?.auth || (req as AuthedRequest).auth;
}

function requireCrmRead(req: Request, res: Response): AuthContext | null {
  const auth = authOf(req);
  if (!auth) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Geçerli Manus oturumu gerekli.",
    });
    return null;
  }
  if (!canAccess(auth, "crm", "read")) {
    res.status(403).json({
      error: "FORBIDDEN",
      message: "CRM görünüm tercihleri için okuma yetkisi gerekli.",
    });
    return null;
  }
  return auth;
}

function invalidPreferences(res: Response): void {
  res.status(400).json({
    error: "INVALID_PREFERENCES",
    message: "Geçerli CRM görünüm tercihleri gerekli.",
  });
}

function serverError(res: Response, operation: "read" | "write"): void {
  res.status(500).json({
    error: "SERVER_ERROR",
    message:
      operation === "read"
        ? "CRM görünüm tercihleri okunamadı."
        : "CRM görünüm tercihleri kaydedilemedi.",
  });
}

/**
 * Personal settings only: the actor openId is obtained from verified auth and
 * is the record id. The client cannot choose an owner, actor, or CRUD target.
 */
export function registerCrmWorkspaceRoutes(
  app: Express,
  rawStore: Store,
): void {
  const raw = rawStoreOf(rawStore);

  app.get("/api/crm-workspace/preferences", async (req, res) => {
    const auth = requireCrmRead(req, res);
    if (!auth) return;
    try {
      const record = await raw.get<CrmWorkspacePreferences>(
        CRM_WORKSPACE_PREFERENCE_KIND,
        auth.user.openId,
        auth.ownerOpenId,
      );
      return res.json(
        record
          ? safeCrmWorkspacePreferences(record.payload)
          : CRM_WORKSPACE_DEFAULT_PREFERENCES,
      );
    } catch {
      serverError(res, "read");
    }
  });

  app.put("/api/crm-workspace/preferences", async (req, res) => {
    const auth = requireCrmRead(req, res);
    if (!auth) return;
    const parsed = crmWorkspacePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidPreferences(res);
      return;
    }
    try {
      const saved = await raw.put(
        CRM_WORKSPACE_PREFERENCE_KIND,
        auth.user.openId,
        parsed.data,
        auth.ownerOpenId,
      );
      return res.json(safeCrmWorkspacePreferences(saved.payload));
    } catch {
      serverError(res, "write");
    }
  });
}

export { requireCrmRead };
