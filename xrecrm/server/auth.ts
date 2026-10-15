import crypto from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { Request, Response, NextFunction } from "express";
import type { Store } from "./db.js";
import type { AuthContext, UserIdentity } from "./types.js";
import {
  canAccess,
  rawStoreOf,
  resolveAuthContext,
  withPermissionContext,
} from "./access.js";
import type { AccessModule } from "../shared/access.js";

export const SESSION_COOKIE = "webdev_app_session";
const STATE_COOKIE = "xre_oauth_state";

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
  partitioned = false,
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}${secure && partitioned ? "; Partitioned" : ""}`;
}

export function publicHttps(req: Request): boolean {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return forwardedProto === "https";
}

export function clearCookie(req: Request, name: string): string {
  return cookieHeader(name, "", 0, publicHttps(req));
}

function configuredOrigins(): string[] {
  return [
    "PUBLIC_ORIGIN",
    "APP_ORIGIN",
    "WEBDEV_PUBLIC_ORIGIN",
    "MANUS_PUBLIC_ORIGIN",
  ]
    .flatMap((name) => (process.env[name] || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        const u = new URL(value);
        return u.origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function forwardedOrigin(req: Request): string {
  const proto = String(
    req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http"),
  )
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host || !["http", "https"].includes(proto)) return "";
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return "";
  }
}

export function safeBrowserOrigin(
  req: Request,
  requested?: string,
): string | null {
  const forwarded = forwardedOrigin(req);
  const known = configuredOrigins();
  let candidate = "";
  try {
    candidate = requested ? new URL(requested).origin : forwarded;
  } catch {
    return null;
  }
  if (!candidate) return null;
  const parsed = new URL(candidate);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    return null;
  if (known.length) return known.includes(candidate) ? candidate : null;
  return candidate === forwarded ? candidate : null;
}

function secretKey(): Uint8Array | null {
  const secret =
    process.env.MANUS_JWT_SECRET?.trim() || process.env.XRE_SESSION_SECRET?.trim();
  return secret ? new TextEncoder().encode(secret) : null;
}

function projectId(): string | undefined {
  // Manus yapılandırılmamışsa yerel giriş için sabit uygulama kimliği kullanılır.
  return process.env.MANUS_PROJECT_ID || process.env.MANUS_APP_ID || "xre-crm";
}

function identityFromClaims(
  claims: Record<string, unknown>,
): UserIdentity | null {
  const openId = String(
    claims.openId || claims.open_id || claims.openid || claims.sub || "",
  ).trim();
  if (!openId) return null;
  return {
    openId,
    name: claims.name ? String(claims.name) : undefined,
    email: claims.email ? String(claims.email) : undefined,
  };
}

async function verifiedSessionIdentity(
  req: Request,
): Promise<UserIdentity | null> {
  const key = secretKey();
  const appId = projectId();
  const token =
    cookieValue(req, SESSION_COOKIE) ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!key || !appId || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      String(payload.appId || payload.app_id || "") !== appId
    )
      return null;
    return identityFromClaims(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function verifySessionIdentity(
  req: Request,
): Promise<UserIdentity | null> {
  const key = secretKey();
  const appId = projectId();
  const token =
    cookieValue(req, SESSION_COOKIE) ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!key || !appId || !token) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    )
      return null;
    const claimedAppId = String(payload.appId || payload.app_id || "");
    if (claimedAppId !== appId) return null;
    const user = identityFromClaims(payload as Record<string, unknown>);
    if (!user) return null;
    return user;
  } catch {
    return null;
  }
}
export async function verifyRequestSession(
  req: Request,
  store: Store,
): Promise<AuthContext | null> {
  try {
    const user = await verifySessionIdentity(req);
    if (!user) return null;
    const raw = rawStoreOf(store);
    return resolveAuthContext(raw, user, await raw.claimOwner(user));
  } catch {
    return null;
  }
}

export async function createSessionToken(user: UserIdentity): Promise<string> {
  const key = secretKey();
  const appId = projectId();
  if (!key || !appId)
    throw new Error("Oturum anahtarı (XRE_SESSION_SECRET) yapılandırılmalı.");
  return new SignJWT({
    appId,
    openId: user.openId,
    name: user.name,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);
}

export function requireAuth(
  store: Store,
  module?: AccessModule,
  action: "read" | "write" = "read",
) {
  return async (
    req: Request & { auth?: AuthContext },
    res: Response,
    next: NextFunction,
  ) => {
    const auth = await verifyRequestSession(req, rawStoreOf(store));
    if (!auth)
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Oturum açmanız gerekli.",
      });
    if (module && !canAccess(auth, module, action))
      return res.status(403).json({
        error: "FORBIDDEN",
        message: `${module} modülünde ${action === "write" ? "yazma" : "okuma"} yetkiniz yok.`,
      });
    req.auth = auth;
    return withPermissionContext(rawStoreOf(store), auth, next);
  };
}

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const origin = safeBrowserOrigin(
    req,
    typeof req.query.origin === "string" ? req.query.origin : undefined,
  );
  if (!origin) {
    res.status(400).json({
      error: "INVALID_ORIGIN",
      message: "Güvenli tarayıcı origin bilgisi gerekli.",
    });
    return;
  }
  const portal = process.env.MANUS_OAUTH_PORTAL_URL;
  const appId = process.env.MANUS_PROJECT_ID || process.env.MANUS_APP_ID;
  if (!portal || !appId) {
    // Manus kurulu değil: kullanıcıyı yerel giriş ekranına gönder.
    res.redirect(`${origin}/?giris=1`);
    return;
  }
  const nonce = crypto.randomBytes(24).toString("base64url");
  const redirectUri = `${origin}/api/auth/callback`;
  const state = Buffer.from(JSON.stringify({ redirectUri, nonce })).toString(
    "base64url",
  );
  res.setHeader(
    "Set-Cookie",
    cookieHeader(STATE_COOKIE, nonce, 600, publicHttps(req)),
  );
  const url = new URL("/app-auth", portal);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("responseType", "code");
  res.redirect(url.toString());
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data?.message || data?.error || `OAuth HTTP ${response.status}`,
    );
  return data;
}

export async function handleCallback(
  req: Request,
  res: Response,
  store: Store,
): Promise<void> {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const rawState = typeof req.query.state === "string" ? req.query.state : "";
  const stateNonce = cookieValue(req, STATE_COOKIE);
  let state: { redirectUri?: string; nonce?: string } = {};
  try {
    state = JSON.parse(Buffer.from(rawState, "base64url").toString("utf8"));
  } catch {
    /* fail closed below */
  }
  const origin = state.redirectUri
    ? safeBrowserOrigin(
        req,
        state.redirectUri.replace(/\/api\/auth\/callback$/, ""),
      )
    : null;
  if (
    !code ||
    !stateNonce ||
    !state.nonce ||
    !state.redirectUri ||
    !origin ||
    state.nonce !== stateNonce ||
    state.redirectUri !== `${origin}/api/auth/callback`
  ) {
    res.status(400).json({
      error: "INVALID_OAUTH_STATE",
      message: "OAuth state doğrulanamadı.",
    });
    return;
  }
  const apiBase = process.env.MANUS_OAUTH_API_URL;
  const appId = projectId();
  if (!apiBase || !appId) {
    res.status(503).json({
      error: "OAUTH_NOT_CONFIGURED",
      message: "Manus OAuth API yapılandırılmamış.",
    });
    return;
  }
  try {
    const exchanged = await postJson(
      `${apiBase.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/ExchangeToken`,
      {
        clientId: appId,
        grantType: "authorization_code",
        code,
        redirectUri: state.redirectUri,
      },
    );
    if (!exchanged.accessToken)
      throw new Error("OAuth access token alınamadı.");
    const userData = await postJson(
      `${apiBase.replace(/\/$/, "")}/webdev.v1.WebDevAuthPublicService/GetUserInfo`,
      { accessToken: exchanged.accessToken },
    );
    const user: UserIdentity = {
      openId: String(userData.openId || ""),
      name: userData.name ? String(userData.name) : undefined,
      email: userData.email ? String(userData.email) : undefined,
    };
    if (!user.openId) throw new Error("OAuth kullanıcı kimliği alınamadı.");
    await store.claimOwner(user);
    const session = await createSessionToken(user);
    res.setHeader("Set-Cookie", [
      cookieHeader(SESSION_COOKIE, session, 7 * 24 * 60 * 60, publicHttps(req)),
      clearCookie(req, STATE_COOKIE),
    ]);
    res.redirect(`${origin}/`);
  } catch (error) {
    res.setHeader("Set-Cookie", clearCookie(req, STATE_COOKIE));
    res.status(502).json({
      error: "OAUTH_ERROR",
      message:
        error instanceof Error ? error.message : "OAuth bağlantısı başarısız.",
    });
  }
}

export function clearSession(req: Request, res: Response): void {
  res.setHeader("Set-Cookie", clearCookie(req, SESSION_COOKIE));
  res.status(204).end();
}
