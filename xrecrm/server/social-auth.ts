// Google, Facebook ve Apple (iCloud) ile giriş + QR ile giriş.
// Güvenlik kuralı: sosyal hesap yeni kullanıcı OLUŞTURMAZ. Yalnız sahibin açtığı
// bir yerel hesabın e-postasıyla (doğrulanmış) eşleşirse veya daha önce o hesaba
// bağlanmışsa giriş yapılır.
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from "jose";
import QRCode from "qrcode";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import { clearCookie, cookieHeader, forwardedOrigin, publicHttps } from "./auth.js";
import { ACCOUNT_KIND, manusConfigured, publicAccount, setSession, type LocalAccount } from "./local-auth.js";

export type SocialProvider = "google" | "facebook" | "apple";
const IDENTITY_KIND = "social-identity";
const STATE_COOKIE = "xre_social_state";

const env = (name: string) => process.env[name]?.trim() || "";

export function socialProvidersStatus(): Record<SocialProvider, boolean> {
  return {
    google: Boolean(env("GOOGLE_OAUTH_CLIENT_ID") && env("GOOGLE_OAUTH_CLIENT_SECRET")),
    facebook: Boolean(env("FACEBOOK_APP_ID") && env("FACEBOOK_APP_SECRET")),
    apple: Boolean(
      env("APPLE_CLIENT_ID") && env("APPLE_TEAM_ID") && env("APPLE_KEY_ID") && env("APPLE_PRIVATE_KEY"),
    ),
  };
}

function origin(req: Request): string {
  return env("PUBLIC_ORIGIN").replace(/\/$/, "") || forwardedOrigin(req);
}
const redirectUri = (req: Request, provider: SocialProvider) =>
  `${origin(req)}/api/auth/social/${provider}/callback`;

async function appleClientSecret(): Promise<string> {
  const key = await importPKCS8(env("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n"), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env("APPLE_KEY_ID") })
    .setIssuer(env("APPLE_TEAM_ID"))
    .setIssuedAt()
    .setExpirationTime("10m")
    .setAudience("https://appleid.apple.com")
    .setSubject(env("APPLE_CLIENT_ID"))
    .sign(key);
}

export function authorizationUrl(provider: SocialProvider, redirect: string, state: string): string {
  if (provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
      redirect_uri: redirect,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    }).toString();
    return url.toString();
  }
  if (provider === "facebook") {
    const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
    url.search = new URLSearchParams({
      client_id: env("FACEBOOK_APP_ID"),
      redirect_uri: redirect,
      response_type: "code",
      scope: "email,public_profile",
      state,
    }).toString();
    return url.toString();
  }
  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.search = new URLSearchParams({
    client_id: env("APPLE_CLIENT_ID"),
    redirect_uri: redirect,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
  }).toString();
  return url.toString();
}

export interface SocialProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

type Fetcher = typeof fetch;
let socialFetch: Fetcher = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
let appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
/** Testler için sağlayıcı HTTP çağrılarını değiştirir. */
export function setSocialFetch(fetcher: Fetcher | null) {
  socialFetch = fetcher || ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }));
}

async function postForm(url: string, body: Record<string, string>) {
  const response = await socialFetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error_description || data?.error?.message || data?.error || `HTTP ${response.status}`);
  return data;
}

export async function exchangeCode(
  provider: SocialProvider,
  code: string,
  redirect: string,
  appleUser?: string,
): Promise<SocialProfile> {
  if (provider === "google") {
    const token = await postForm("https://oauth2.googleapis.com/token", {
      code,
      client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri: redirect,
      grant_type: "authorization_code",
    });
    const response = await socialFetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    const info: any = await response.json();
    if (!response.ok || !info.sub) throw new Error("Google kullanıcı bilgisi alınamadı.");
    return { subject: String(info.sub), email: String(info.email || "").toLowerCase(), emailVerified: info.email_verified === true, name: info.name };
  }
  if (provider === "facebook") {
    const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    tokenUrl.search = new URLSearchParams({
      client_id: env("FACEBOOK_APP_ID"),
      client_secret: env("FACEBOOK_APP_SECRET"),
      redirect_uri: redirect,
      code,
    }).toString();
    const tokenResponse = await socialFetch(tokenUrl.toString());
    const token: any = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error("Facebook erişim anahtarı alınamadı.");
    const proof = crypto.createHmac("sha256", env("FACEBOOK_APP_SECRET")).update(token.access_token).digest("hex");
    const me = await socialFetch(
      `https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=${encodeURIComponent(token.access_token)}&appsecret_proof=${proof}`,
    );
    const info: any = await me.json();
    if (!me.ok || !info.id) throw new Error("Facebook kullanıcı bilgisi alınamadı.");
    // Facebook yalnız doğrulanmış e-postayı döndürür.
    return { subject: String(info.id), email: String(info.email || "").toLowerCase(), emailVerified: Boolean(info.email), name: info.name };
  }
  const token = await postForm("https://appleid.apple.com/auth/token", {
    code,
    client_id: env("APPLE_CLIENT_ID"),
    client_secret: await appleClientSecret(),
    redirect_uri: redirect,
    grant_type: "authorization_code",
  });
  appleJwks ||= createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  const { payload } = await jwtVerify(String(token.id_token || ""), appleJwks, {
    issuer: "https://appleid.apple.com",
    audience: env("APPLE_CLIENT_ID"),
  });
  let name: string | undefined;
  try {
    const parsed = appleUser ? JSON.parse(appleUser) : null;
    name = [parsed?.name?.firstName, parsed?.name?.lastName].filter(Boolean).join(" ") || undefined;
  } catch {
    /* Apple ad bilgisini yalnız ilk girişte gönderir */
  }
  return {
    subject: String(payload.sub),
    email: String(payload.email || "").toLowerCase(),
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name,
  };
}

/** Sosyal profili var olan yerel hesaba eşler; yeni hesap açmaz. */
export async function matchAccount(
  store: Store,
  owner: string,
  provider: SocialProvider,
  profile: SocialProfile,
): Promise<LocalAccount | null> {
  const raw = rawStoreOf(store);
  const identityId = `${provider}:${profile.subject}`;
  const linked = (await raw.get<{ accountId: string }>(IDENTITY_KIND, identityId, owner))?.payload;
  const accounts = (await raw.list<LocalAccount>(ACCOUNT_KIND, owner)).map((r) => r.payload);
  let account = linked ? accounts.find((a) => a.id === linked.accountId) : undefined;
  if (!account && profile.email && profile.emailVerified)
    account = accounts.find((a) => a.email === profile.email);
  if (!account) return null;
  if (!linked)
    await raw.put(
      IDENTITY_KIND,
      identityId,
      { id: identityId, provider, subject: profile.subject, accountId: account.id, email: profile.email, linkedAt: new Date().toISOString() },
      owner,
    );
  return account;
}

const loginError = (res: Response, message: string) =>
  res.redirect(`/?login_error=${encodeURIComponent(message)}`);

// --- QR ile giriş -----------------------------------------------------------

interface QrSession {
  id: string;
  pollSecretHash: string;
  code: string;
  createdAt: number;
  approvedAccountId?: string;
  approvedBy?: string;
  consumed?: boolean;
}
const qrSessions = new Map<string, QrSession>();
const QR_TTL_MS = 2 * 60_000;
const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
function sweepQr() {
  for (const [id, s] of qrSessions) if (Date.now() - s.createdAt > QR_TTL_MS || s.consumed) qrSessions.delete(id);
}

export function registerSocialAuthRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);

  app.get("/api/auth/status", async (_req, res) => {
    const providers = { local: true, qr: true, manus: manusConfigured(), ...socialProvidersStatus() };
    try {
      res.json({ needsSetup: !(await raw.resolveOwner()), providers });
    } catch {
      res.json({ needsSetup: false, database: false, providers });
    }
  });

  app.get("/api/auth/social/:provider/start", (req, res) => {
    const provider = String(req.params.provider) as SocialProvider;
    if (!["google", "facebook", "apple"].includes(provider))
      return res.status(404).json({ error: "UNKNOWN_PROVIDER" });
    if (!socialProvidersStatus()[provider])
      return loginError(res, `${provider} girişi henüz yapılandırılmadı. Yönetici Entegrasyonlar sayfasından anahtarları girmeli.`);
    const nonce = crypto.randomBytes(24).toString("base64url");
    const state = `${provider}.${nonce}`;
    // Apple form_post (çapraz site POST) kullandığı için SameSite=None gerekir.
    const secure = publicHttps(req) || provider === "apple";
    res.setHeader("Set-Cookie", cookieHeader(STATE_COOKIE, state, 600, secure));
    res.redirect(authorizationUrl(provider, redirectUri(req, provider), state));
  });

  const callback = async (req: Request, res: Response) => {
    const provider = String(req.params.provider) as SocialProvider;
    const params = { ...(req.query as Record<string, string>), ...(req.body || {}) };
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${STATE_COOKIE}=`))
      ?.slice(STATE_COOKIE.length + 1);
    res.setHeader("Set-Cookie", clearCookie(req, STATE_COOKIE));
    if (params.error) return loginError(res, "Giriş sağlayıcıda iptal edildi.");
    if (!params.code || !params.state || !cookie || decodeURIComponent(cookie) !== params.state || !params.state.startsWith(`${provider}.`))
      return loginError(res, "Giriş isteği doğrulanamadı; lütfen tekrar deneyin.");
    try {
      const owner = await raw.resolveOwner();
      if (!owner) return loginError(res, "Önce yönetici hesabı oluşturulmalı.");
      const profile = await exchangeCode(provider, String(params.code), redirectUri(req, provider), params.user);
      const account = await matchAccount(store, owner, provider, profile);
      if (!account)
        return loginError(
          res,
          `${profile.email || "Bu hesap"} CRM'de kayıtlı değil. Yöneticiniz aynı e-postayla hesap açmalı.`,
        );
      if (!account.active) return loginError(res, "Hesabınız pasif.");
      await raw.put(ACCOUNT_KIND, account.id, { ...account, lastLoginAt: new Date().toISOString() }, owner);
      await setSession(req, res, account);
      res.redirect("/");
    } catch (error) {
      console.warn(`${provider} girişi başarısız:`, error instanceof Error ? error.message : error);
      loginError(res, "Giriş sağlayıcısıyla bağlantı kurulamadı.");
    }
  };
  app.get("/api/auth/social/:provider/callback", callback);
  app.post("/api/auth/social/:provider/callback", express.urlencoded({ extended: false, limit: "16kb" }), callback);

  // Masaüstü: QR oturumu başlat
  app.post("/api/auth/qr/start", async (req, res) => {
    sweepQr();
    if (qrSessions.size > 500) return res.status(429).json({ error: "BUSY", message: "Çok fazla bekleyen QR isteği." });
    const id = crypto.randomBytes(12).toString("base64url");
    const pollSecret = crypto.randomBytes(24).toString("base64url");
    const code = crypto.randomBytes(18).toString("base64url");
    qrSessions.set(id, { id, pollSecretHash: sha(pollSecret), code, createdAt: Date.now() });
    const approveUrl = `${origin(req)}/qr-onay?c=${code}`;
    const qr = await QRCode.toDataURL(approveUrl, { margin: 1, width: 240 });
    res.json({ id, pollSecret, qr, expiresInSeconds: QR_TTL_MS / 1000 });
  });

  // Masaüstü: onay bekle
  app.post("/api/auth/qr/poll", express.json({ limit: "4kb" }), async (req, res) => {
    const session = qrSessions.get(String(req.body?.id || ""));
    if (!session || Date.now() - session.createdAt > QR_TTL_MS)
      return res.json({ status: "expired" });
    if (sha(String(req.body?.pollSecret || "")) !== session.pollSecretHash)
      return res.status(401).json({ error: "UNAUTHORIZED" });
    if (!session.approvedAccountId) return res.json({ status: "pending" });
    const owner = await raw.resolveOwner();
    const account = owner
      ? (await raw.get<LocalAccount>(ACCOUNT_KIND, session.approvedAccountId, owner))?.payload
      : undefined;
    session.consumed = true;
    qrSessions.delete(session.id);
    if (!account || !account.active) return res.json({ status: "expired" });
    await setSession(req, res, account);
    res.json({ status: "approved", user: publicAccount(account) });
  });
}

/** Telefon (oturumu açık): QR kodundaki girişi onayla. requireAuth sonrasında. */
export function registerQrApproveRoute(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  app.post("/api/auth/qr/approve", async (req, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    const code = String(req.body?.code || "");
    const session = [...qrSessions.values()].find((s) => s.code === code);
    if (!session || Date.now() - session.createdAt > QR_TTL_MS || session.approvedAccountId)
      return res.status(410).json({ error: "EXPIRED", message: "QR kodunun süresi doldu. Bilgisayarda yeni kod oluşturun." });
    const account = (await raw.list<LocalAccount>(ACCOUNT_KIND, auth.ownerOpenId))
      .map((r) => r.payload)
      .find((a) => a.openId === auth.user.openId);
    if (!account)
      return res.status(400).json({ error: "NOT_LOCAL", message: "QR onayı için yerel CRM hesabıyla giriş yapmış olmalısınız." });
    session.approvedAccountId = account.id;
    session.approvedBy = auth.user.openId;
    res.json({ ok: true });
  });
}

/** Test yardımcı: bekleyen QR oturumlarını temizler. */
export function resetQrSessions() {
  qrSessions.clear();
}

/** Test yardımcı: QR oturumunun onay kodunu döndürür (QR görselini çözmeden). */
export function peekQrCode(id: string): string | undefined {
  return qrSessions.get(id)?.code;
}
