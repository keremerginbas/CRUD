// Yönetim paneli: satılan CRM kurulumlarının teknik durumunu tek yerde gösterir.
// - Panel tarafı (XRE_PANEL=1): kurulum kayıtları, durum bildirimi adresi, uyarılar.
// - Kurulum tarafı (PANEL_URL + PANEL_KEY ayarlıysa): birkaç dakikada bir panele durum bildirir.
// Bildirim yalnız sayılar ve teknik bilgi içerir; müşteri adı, mesaj ya da satış verisi gönderilmez.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { type Express, type Request } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import { storageKind } from "./db.js";
import type { AuthContext } from "./types.js";
import { listBackups } from "./backup.js";
import { ACCOUNT_KIND } from "./local-auth.js";
import { fetchWithTimeout, timingSafeEqualText } from "./security.js";
import { escapeHtml, sendTelegram } from "./telegram.js";

const env = (key: string) => (process.env[key] || "").trim();
export const panelEnabled = () => env("XRE_PANEL") === "1";
export const INSTALL_KIND = "fleet-install";
const ALERT_KIND = "fleet-alert";
const HEARTBEAT_MINUTES = 5;
/** Bu süre boyunca haber gelmezse kurulum "yanıt vermiyor" sayılır. */
export const OFFLINE_AFTER_MS = 20 * 60_000;

const count = z.number().int().min(0).max(1_000_000_000);
const bytes = z.number().min(0).max(1e15);
const stamp = z.string().max(40).nullable().optional();
export const heartbeatSchema = z
  .object({
    version: z.string().max(40).optional(),
    commitDate: stamp,
    startedAt: stamp,
    origin: z.string().max(200).optional(),
    brand: z.string().max(120).optional(),
    storage: z.string().max(20).optional(),
    users: count.optional(),
    activeUsers7d: count.optional(),
    lastLoginAt: stamp,
    leads: count.optional(),
    quotes: count.optional(),
    lastBackupAt: stamp,
    disk: z.object({ totalBytes: bytes, freeBytes: bytes }).nullable().optional(),
    memory: z.object({ totalBytes: bytes, freeBytes: bytes }).optional(),
    whatsappLines: z.object({ total: count, connected: count }).optional(),
  })
  .strict();
export type Heartbeat = z.infer<typeof heartbeatSchema>;

export interface FleetInstall {
  id: string;
  name: string;
  domain: string;
  notes: string;
  licenseStart: string | null;
  licenseEnd: string | null;
  keyHash: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  status: Heartbeat | null;
}
const hashKey = (secret: string) => crypto.createHash("sha256").update(secret).digest("hex");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const installInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    domain: z.string().trim().max(200).default(""),
    notes: z.string().trim().max(2000).default(""),
    licenseStart: day.default(null),
    licenseEnd: day.default(null),
  })
  .strict();

export type FleetProblem = "offline" | "never" | "backup" | "disk" | "license-soon" | "license-expired";
/** Bir kurulumun dikkat isteyen durumları. */
export function installProblems(install: Pick<FleetInstall, "lastSeenAt" | "status" | "licenseEnd">, now = Date.now()): FleetProblem[] {
  const problems: FleetProblem[] = [];
  if (!install.lastSeenAt) problems.push("never");
  else if (now - Date.parse(install.lastSeenAt) > OFFLINE_AFTER_MS) problems.push("offline");
  const s = install.status;
  if (s && install.lastSeenAt) {
    const backup = s.lastBackupAt ? Date.parse(s.lastBackupAt) : NaN;
    if (!Number.isFinite(backup) || now - backup > 48 * 3_600_000) problems.push("backup");
    if (s.disk && s.disk.totalBytes > 0 && s.disk.freeBytes / s.disk.totalBytes < 0.1) problems.push("disk");
  }
  if (install.licenseEnd) {
    const left = Math.ceil((Date.parse(`${install.licenseEnd}T23:59:59+03:00`) - now) / 86_400_000);
    if (left <= 0) problems.push("license-expired");
    else if (left <= 14) problems.push("license-soon");
  }
  return problems;
}
const PROBLEM_TEXT: Record<FleetProblem, string> = {
  never: "henüz hiç durum bildirmedi",
  offline: "yanıt vermiyor",
  backup: "2 gündür yedek alınmamış",
  disk: "diski dolmak üzere (boş alan %10'un altında)",
  "license-soon": "lisansı 14 gün içinde bitiyor",
  "license-expired": "lisans süresi doldu",
};
const publicInstall = (install: FleetInstall, now = Date.now()) => {
  const { keyHash: _keyHash, ...rest } = install;
  return { ...rest, problems: installProblems(install, now) };
};

async function panelOwner(store: Store): Promise<string | undefined> {
  return store.resolveOwner().catch(() => undefined);
}
const windows = new Map<string, { start: number; hits: number }>();
function tooMany(key: string, limit: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > 60_000) {
    windows.set(key, { start: now, hits: 1 });
    if (windows.size > 5000) for (const [k, v] of windows) if (now - v.start > 60_000) windows.delete(k);
    return false;
  }
  w.hits += 1;
  return w.hits > limit;
}

/** Kurulumlardan gelen durum bildirimi (oturum gerektirmez; kuruluma özel anahtarla korunur). */
export function registerFleetHeartbeat(app: Express, store: Store): void {
  app.post("/api/webhooks/fleet", express.json({ limit: "16kb" }), async (req, res) => {
    if (!panelEnabled()) return void res.status(404).json({ error: "NOT_FOUND" });
    if (tooMany(`ip:${req.ip}`, 60)) return void res.status(429).json({ error: "TOO_MANY" });
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const [id, secret] = token.split(".");
    const owner = await panelOwner(store);
    const install = owner && /^[a-z0-9-]{6,60}$/.test(id || "") ? (await store.get<FleetInstall>(INSTALL_KIND, id, owner))?.payload : null;
    // Kayıt olmasa da aynı süre harcanır; anahtar tahmini kolaylaşmaz.
    const ok = timingSafeEqualText(hashKey(secret || ""), install?.keyHash || hashKey("yok"));
    if (!owner || !install || !ok || (secret || "").length < 32) return void res.status(401).json({ error: "UNAUTHORIZED" });
    if (tooMany(`id:${id}`, 6)) return void res.status(429).json({ error: "TOO_MANY" });
    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "INVALID" });
    const now = new Date().toISOString();
    await store.put<FleetInstall>(INSTALL_KIND, id, { ...install, status: parsed.data, lastSeenAt: now }, owner);
    res.json({ ok: true, nextInMinutes: HEARTBEAT_MINUTES });
  });
}

/** Panel sahibinin kullandığı yönetim uçları. */
export function registerFleetRoutes(app: Express, store: Store): void {
  const owner = (req: Request) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!panelEnabled()) throw Object.assign(new Error("Yönetim paneli bu kurulumda açık değil."), { statusCode: 404 });
    if (!auth?.isOwner) throw Object.assign(new Error("Yönetim paneli yalnız sahibe açıktır."), { statusCode: 403 });
    return auth.ownerOpenId;
  };
  const fail = (res: any, error: unknown) =>
    res.status(Number((error as any)?.statusCode) || 500).json({ error: "FLEET_FAILED", message: (error as Error).message || "İşlem başarısız." });
  const newKey = (id: string) => {
    const secret = crypto.randomBytes(32).toString("hex");
    return { key: `${id}.${secret}`, keyHash: hashKey(secret) };
  };
  const publicOrigin = () => env("PUBLIC_ORIGIN").replace(/\/+$/, "");

  // Kenar çubuğu bu uçla panelin açık olup olmadığını öğrenir (sahip olmayanlara "kapalı" döner).
  app.get("/api/fleet", async (req, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    res.json({ enabled: panelEnabled() && Boolean(auth?.isOwner) });
  });
  app.get("/api/fleet/installs", async (req, res) => {
    try {
      const ownerId = owner(req);
      const rows = (await store.list<FleetInstall>(INSTALL_KIND, ownerId)).map((row) => publicInstall(row.payload));
      res.json({
        installs: rows.sort((a, b) => b.problems.length - a.problems.length || a.name.localeCompare(b.name, "tr")),
        panel: { version: env("XRE_COMMIT") || "", commitDate: env("XRE_COMMIT_DATE") || null, heartbeatUrl: publicOrigin(), offlineAfterMinutes: OFFLINE_AFTER_MS / 60_000 },
      });
    } catch (error) {
      fail(res, error);
    }
  });
  app.post("/api/fleet/installs", async (req, res) => {
    try {
      const ownerId = owner(req);
      const input = installInput.parse(req.body);
      if ((await store.list(INSTALL_KIND, ownerId)).length >= 500) throw Object.assign(new Error("En fazla 500 kurulum eklenebilir."), { statusCode: 400 });
      const id = `k-${crypto.randomBytes(6).toString("hex")}`;
      const { key, keyHash } = newKey(id);
      const now = new Date().toISOString();
      const install: FleetInstall = { id, ...input, keyHash, createdAt: now, updatedAt: now, lastSeenAt: null, status: null };
      await store.put(INSTALL_KIND, id, install, ownerId);
      // Anahtar yalnız bu yanıtta gösterilir; panelde özeti saklanır.
      res.status(201).json({ install: publicInstall(install), key, panelUrl: publicOrigin() });
    } catch (error) {
      fail(res, error instanceof z.ZodError ? Object.assign(new Error("Bilgiler geçersiz: ad en az 2 karakter, tarihler GG.AA.YYYY seçilmeli."), { statusCode: 400 }) : error);
    }
  });
  app.put("/api/fleet/installs/:id", async (req, res) => {
    try {
      const ownerId = owner(req);
      const current = (await store.get<FleetInstall>(INSTALL_KIND, String(req.params.id), ownerId))?.payload;
      if (!current) throw Object.assign(new Error("Kurulum bulunamadı."), { statusCode: 404 });
      const input = installInput.parse(req.body);
      const next = { ...current, ...input, updatedAt: new Date().toISOString() };
      await store.put(INSTALL_KIND, current.id, next, ownerId);
      res.json({ install: publicInstall(next) });
    } catch (error) {
      fail(res, error instanceof z.ZodError ? Object.assign(new Error("Bilgiler geçersiz."), { statusCode: 400 }) : error);
    }
  });
  app.post("/api/fleet/installs/:id/key", async (req, res) => {
    try {
      const ownerId = owner(req);
      const current = (await store.get<FleetInstall>(INSTALL_KIND, String(req.params.id), ownerId))?.payload;
      if (!current) throw Object.assign(new Error("Kurulum bulunamadı."), { statusCode: 404 });
      const { key, keyHash } = newKey(current.id);
      await store.put(INSTALL_KIND, current.id, { ...current, keyHash, updatedAt: new Date().toISOString() }, ownerId);
      res.json({ key, panelUrl: publicOrigin() });
    } catch (error) {
      fail(res, error);
    }
  });
  app.delete("/api/fleet/installs/:id", async (req, res) => {
    try {
      const ownerId = owner(req);
      await store.delete(INSTALL_KIND, String(req.params.id), ownerId);
      res.json({ ok: true });
    } catch (error) {
      fail(res, error);
    }
  });
}

/** Sorunlu kurulumlar için günde bir kez Telegram uyarısı gönderir. */
export async function runFleetAlerts(store: Store, now = new Date()): Promise<string[]> {
  if (!panelEnabled()) return [];
  const owner = await panelOwner(store);
  if (!owner) return [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
  const sent: string[] = [];
  for (const row of await store.list<FleetInstall>(INSTALL_KIND, owner)) {
    const install = row.payload;
    for (const problem of installProblems(install, now.getTime())) {
      if (problem === "never") continue;
      if (!(await store.insertIfAbsent(ALERT_KIND, `${install.id}:${problem}:${today}`, { at: now.toISOString() }, owner)).inserted) continue;
      const delivered = await sendTelegram(`⚠️ <b>${escapeHtml(install.name)}</b> ${PROBLEM_TEXT[problem]}.`).catch(() => false);
      if (delivered) sent.push(`${install.id}:${problem}`);
    }
  }
  return sent;
}

// ---- Kurulum tarafı: panele durum bildirimi -------------------------------------------------

/** Bu kurulumun panele gönderdiği teknik özet. Müşteri verisi içermez. */
export async function collectHeartbeat(store: Store, now = Date.now()): Promise<Heartbeat> {
  const owner = await store.resolveOwner().catch(() => undefined);
  const dataDir = path.resolve(env("XRE_DATA_DIR") || "data");
  const disk = await fs.statfs(dataDir).catch(() => null);
  const [backups, leads, quotes, accounts, connections] = await Promise.all([
    listBackups().catch(() => []),
    owner ? store.list("lead", owner) : [],
    owner ? store.list("re_quote", owner) : [],
    owner ? store.list<{ lastLoginAt?: string; disabled?: boolean }>(ACCOUNT_KIND, owner) : [],
    owner ? store.list<{ status?: string }>("connection", owner) : [],
  ]);
  const logins = accounts.map((row) => Date.parse(row.payload.lastLoginAt || "")).filter(Number.isFinite);
  const lastBackup = [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    version: env("XRE_COMMIT").slice(0, 40) || undefined,
    commitDate: env("XRE_COMMIT_DATE").slice(0, 40) || null,
    startedAt: new Date(now - process.uptime() * 1000).toISOString(),
    origin: env("PUBLIC_ORIGIN").slice(0, 200) || undefined,
    brand: env("XRE_BRAND_NAME").slice(0, 120) || undefined,
    storage: storageKind(),
    users: accounts.length,
    activeUsers7d: logins.filter((at) => now - at < 7 * 86_400_000).length,
    lastLoginAt: logins.length ? new Date(Math.max(...logins)).toISOString() : null,
    leads: leads.length,
    quotes: quotes.length,
    lastBackupAt: lastBackup?.createdAt || null,
    disk: disk ? { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize } : null,
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    whatsappLines: { total: connections.length, connected: connections.filter((row) => row.payload.status === "connected").length },
  };
}

export async function sendHeartbeat(store: Store): Promise<{ ok: boolean; message: string }> {
  const url = env("PANEL_URL").replace(/\/+$/, "");
  const key = env("PANEL_KEY");
  if (!url || !key) return { ok: false, message: "Yönetim paneli adresi ve anahtarı girilmemiş." };
  if (!/^https:\/\//i.test(url) && env("NODE_ENV") === "production") return { ok: false, message: "Panel adresi https:// ile başlamalı." };
  try {
    const response = await fetchWithTimeout(`${url}/api/webhooks/fleet`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(await collectHeartbeat(store)),
    });
    if (response.ok) return { ok: true, message: "Durum yönetim paneline bildirildi." };
    return { ok: false, message: response.status === 401 ? "Panel anahtarı kabul edilmedi. Panelden yeni anahtar alıp girin." : `Panel yanıtı: HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, message: `Panele ulaşılamadı: ${(error as Error).message}`.slice(0, 200) };
  }
}

let timer: NodeJS.Timeout | null = null;
/** Kurulumda bildirim, panelde uyarı döngüsünü başlatır. */
export function startFleet(store: Store): void {
  if (timer) return;
  const tick = async () => {
    if (env("PANEL_URL") && env("PANEL_KEY")) {
      const result = await sendHeartbeat(store);
      if (!result.ok) console.warn("Yönetim paneli:", result.message);
    }
    await runFleetAlerts(store).catch((error) => console.warn("Panel uyarıları:", error instanceof Error ? error.message : error));
  };
  setTimeout(() => void tick(), 20_000).unref?.();
  timer = setInterval(() => void tick(), HEARTBEAT_MINUTES * 60_000);
  timer.unref?.();
}

/** Entegrasyonlar ekranındaki "Bağlantıyı test et" düğmesi. */
export function registerFleetTest(app: Express, store: Store): void {
  app.post("/api/integrations/panel/test", async (req, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner) return void res.status(403).json({ error: "FORBIDDEN", message: "Yalnız çalışma alanı sahibi test edebilir." });
    const result = await sendHeartbeat(store);
    res.status(result.ok ? 200 : 502).json({ provider: "panel", configured: Boolean(env("PANEL_URL") && env("PANEL_KEY")), connected: result.ok, message: result.message });
  });
}
