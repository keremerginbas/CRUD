import type { Request, Response, NextFunction } from "express";
import type { AuthContext } from "./types.js";
import {
  canAccess,
  currentPermissionContext,
  withPermissionContext,
} from "./access.js";
import type { AccessModule } from "../shared/access.js";
export function requireModulePermissions(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const auth = (req as Request & { auth: AuthContext }).auth;
  if (auth.isOwner) return next();
  const path = req.originalUrl.split("?")[0].replace(/^\/api/, "");
  const writing = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (
    [
      "/state",
      "/settings",
      "/profile",
      "/notifications",
      "/preferences",
    ].includes(path) ||
    /^\/notifications\/[^/]+\/read$/.test(path) ||
    // Hesap/şifre/QR uçları kendi sahiplik kontrollerini yapar.
    /^\/auth\/(accounts|password|qr\/approve)(?:\/|$)/.test(path) ||
    path === "/settings/integrations" ||
    path === "/pbx/me" ||
    path === "/pbx/test"
  )
    return next();
  if (path === "/access" && req.method === "GET") {
    if (
      canAccess(auth, "users", "read") &&
      auth.permissions?.users.scope === "all"
    )
      return next();
    return res.status(403).json({
      error: "FORBIDDEN",
      message: "Çalışan dizini için tüm kayıtları okuma yetkisi gerekir.",
    });
  }
  let module: AccessModule | undefined;
  let action: "read" | "write" = writing ? "write" : "read";
  if (path === "/data-quality") {
    if (
      ["crm", "contacts", "companies"].some((m) =>
        canAccess(auth, m as AccessModule, "read"),
      )
    )
      return next();
    return forbidden(res, "CRM veri kalitesi");
  }
  if (path === "/crm-import/preview" || path === "/crm-import/commit") {
    const kind = req.body?.kind;
    module =
      kind === "leads"
        ? "crm"
        : kind === "contacts"
          ? "contacts"
          : kind === "companies"
            ? "companies"
            : undefined;
    action = path.endsWith("/preview") ? "read" : "write";
  } else if (path === "/crm-workspace/preferences") {
    module = "crm";
    action = "read";
  } else if (path === "/automations/dry-run") {
    module = "automations";
    action = "read";
  } else if (/^\/google-calendar(?:\/|$)/.test(path)) {
    module = "calendar";
    if (path === "/google-calendar/callback") action = "write";
  } else if (/^\/meetings(?:\/|$)/.test(path)) {
    module = "calendar";
    action = "write";
  } else if (/^\/leads\/[^/]+\/analyze$/.test(path)) module = "ai";
  else if (/^\/leads(?:\/|$)/.test(path)) module = "crm";
  else if (/^\/contacts(?:\/|$)/.test(path)) module = "contacts";
  else if (/^\/companies(?:\/|$)/.test(path)) module = "companies";
  else if (/^\/tasks(?:\/|$)/.test(path)) module = "tasks";
  else if (/^\/activities(?:\/|$)/.test(path)) module = "calendar";
  else if (/^\/pipelines(?:\/|$)/.test(path))
    module = writing ? "automations" : "crm";
  else if (/^\/feed(?:\/|$)/.test(path)) module = "feed";
  else if (/^\/members(?:\/|$)/.test(path)) module = "users";
  else if (/^\/messages(?:\/|$)/.test(path)) module = "whatsapp";
  else if (/^\/calls(?:\/|$)/.test(path)) module = "calls";
  else if (path === "/pbx/stream") {
    module = "calls";
    action = "read";
  } else if (/^\/pbx(?:\/|$)/.test(path)) module = "calls";
  else if (/^\/assistant(?:\/|$)/.test(path)) {
    module = "ai";
    if (
      path === "/assistant/report" ||
      (path === "/assistant/chat" && req.body?.dateRange)
    ) {
      action = "read";
      if (!canAccess(auth, "reports", "read")) return forbidden(res, "reports");
    }
  } else if (/^\/conversation-analysis(?:\/|$)/.test(path)) module = "ai";
  else if (/^\/worktime(?:\/|$)/.test(path)) module = "worktime";
  else if (/^\/rules(?:\/|$)/.test(path)) module = "automations";
  else if (/^\/(integrations|connections|n8n|events|bitrix|bitrix-import|webhook-hub)(?:\/|$)/.test(path))
    module = "integrations";
  else if (/^\/access\/departments/.test(path)) module = "departments";
  else if (/^\/access\/employees/.test(path)) module = "users";
  else if (/^\/access/.test(path)) module = "access";
  if (!module || !canAccess(auth, module, action))
    return forbidden(res, module || "bu");
  const context = currentPermissionContext();
  const limited =
    path.startsWith("/assistant") &&
    (auth.permissions?.ai.scope === "own" ||
      auth.permissions?.reports.scope === "own");
  if (context && limited) {
    const permissions = { ...auth.permissions! };
    for (const m of [
      "crm",
      "contacts",
      "companies",
      "calls",
      "whatsapp",
      "tasks",
      "calendar",
      "feed",
    ] as const)
      if (permissions[m]) permissions[m] = { ...permissions[m], scope: "own" };
    return withPermissionContext(
      context.rawStore,
      { ...auth, permissions },
      next,
    );
  }
  return next();
}
function forbidden(res: Response, module: string) {
  return res.status(403).json({
    error: "FORBIDDEN",
    message: `${module} modülünde bu işlem için yetkiniz yok.`,
  });
}
