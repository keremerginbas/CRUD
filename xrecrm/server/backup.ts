// Otomatik ve elle yedekleme / geri yükleme.
// Yedekler data/backups altında sıkıştırılmış JSON (.json.gz) olarak tutulur.
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import type { Express, Request } from "express";
import type { Store, StoreDump } from "./db.js";
import { assertDump } from "./db.js";
import type { AuthContext } from "./types.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const NAME = /^xrecrm-\d{8}-\d{6}(-[a-z]+)?\.json\.gz$/;

export const backupDir = () =>
  path.resolve(process.env.XRE_DATA_DIR || "data", "backups");
const keepCount = () => Math.max(3, Number(process.env.BACKUP_KEEP) || 14);

function stamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
  reason: string;
}

export async function listBackups(): Promise<BackupInfo[]> {
  const dir = backupDir();
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const items = await Promise.all(
    names
      .filter((n) => NAME.test(n))
      .map(async (name) => {
        const stat = await fs.stat(path.join(dir, name));
        return {
          name,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
          reason: name.match(/-([a-z]+)\.json\.gz$/)?.[1] || "elle",
        };
      }),
  );
  return items.sort((a, b) => b.name.localeCompare(a.name));
}

export async function createBackup(store: Store, reason: "otomatik" | "elle" | "geriyuklemeoncesi" = "elle"): Promise<BackupInfo> {
  if (!store.dumpAll) throw Object.assign(new Error("Bu veritabanı yedeklemeyi desteklemiyor."), { statusCode: 501 });
  const dump = await store.dumpAll();
  const suffix = reason === "otomatik" ? "-otomatik" : reason === "geriyuklemeoncesi" ? "-oncesi" : "";
  const name = `xrecrm-${stamp()}${suffix}.json.gz`;
  await fs.mkdir(backupDir(), { recursive: true });
  const target = path.join(backupDir(), name);
  await fs.writeFile(`${target}.tmp`, await gzip(Buffer.from(JSON.stringify(dump))), { mode: 0o600 });
  await fs.rename(`${target}.tmp`, target);
  // Eski otomatik yedekleri temizle (elle alınanlar silinmez).
  const automatic = (await listBackups()).filter((b) => b.reason === "otomatik");
  for (const old of automatic.slice(keepCount())) await fs.rm(path.join(backupDir(), old.name), { force: true });
  const stat = await fs.stat(target);
  return { name, size: stat.size, createdAt: stat.mtime.toISOString(), reason };
}

export async function readBackup(name: string): Promise<StoreDump> {
  if (!NAME.test(name)) throw Object.assign(new Error("Geçersiz yedek adı."), { statusCode: 400 });
  const raw = await fs.readFile(path.join(backupDir(), name)).catch(() => {
    throw Object.assign(new Error("Yedek bulunamadı."), { statusCode: 404 });
  });
  return assertDump(JSON.parse((await gunzip(raw)).toString("utf8")));
}

export async function restoreBackup(store: Store, dump: StoreDump, afterRestore?: () => Promise<void>) {
  if (!store.restoreAll) throw Object.assign(new Error("Bu veritabanı geri yüklemeyi desteklemiyor."), { statusCode: 501 });
  await createBackup(store, "geriyuklemeoncesi");
  await store.restoreAll(dump);
  await afterRestore?.();
}

let timer: NodeJS.Timeout | null = null;
/** Her saat kontrol eder; son otomatik yedek 24 saatten eskiyse yenisini alır. */
export function startBackupScheduler(store: Store) {
  if (timer || process.env.BACKUP_DISABLED === "1") return;
  const tick = async () => {
    try {
      const last = (await listBackups()).find((b) => b.reason === "otomatik" || b.reason === "elle");
      if (last && Date.now() - Date.parse(last.createdAt) < 23.5 * 3600_000) return;
      const owner = await store.resolveOwner().catch(() => undefined);
      if (!owner) return;
      const info = await createBackup(store, "otomatik");
      console.log(`Otomatik yedek alındı: ${info.name}`);
    } catch (error) {
      console.warn("Otomatik yedek alınamadı:", error instanceof Error ? error.message : error);
    }
  };
  setTimeout(() => void tick(), 30_000).unref?.();
  timer = setInterval(() => void tick(), 3600_000);
  timer.unref?.();
}

export function registerBackupRoutes(app: Express, baseStore: Store, afterRestore: () => Promise<void>) {
  const ownerOnly = (req: Request) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner)
      throw Object.assign(new Error("Yedekleme yalnız çalışma alanı sahibine açıktır."), { statusCode: 403 });
    return auth;
  };
  const fail = (res: any, error: unknown) => {
    const status = Number((error as any)?.statusCode) || 500;
    res.status(status).json({ error: "BACKUP_FAILED", message: (error as Error).message || "Yedek işlemi başarısız." });
  };

  app.get("/api/system/backups", async (req, res) => {
    try {
      ownerOnly(req);
      res.json({
        backups: await listBackups(),
        directory: backupDir(),
        keep: keepCount(),
        storage: process.env.DATABASE_URL?.trim() ? "mysql" : "dosya",
      });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/system/backups", async (req, res) => {
    try {
      ownerOnly(req);
      res.status(201).json({ backup: await createBackup(baseStore, "elle") });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/system/backups/:name/download", async (req, res) => {
    try {
      ownerOnly(req);
      const name = String(req.params.name);
      if (!NAME.test(name)) throw Object.assign(new Error("Geçersiz yedek adı."), { statusCode: 400 });
      const file = await fs.readFile(path.join(backupDir(), name));
      res.setHeader("content-type", "application/gzip");
      res.setHeader("content-disposition", `attachment; filename="${name}"`);
      res.end(file);
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/system/backups/:name/restore", async (req, res) => {
    try {
      ownerOnly(req);
      if (req.body?.confirm !== "GERİ YÜKLE")
        return res.status(400).json({ error: "CONFIRM", message: 'Onay için "GERİ YÜKLE" yazın.' });
      const dump = await readBackup(String(req.params.name));
      await restoreBackup(baseStore, dump, afterRestore);
      res.json({ ok: true, records: dump.records.length, events: dump.events.length });
    } catch (error) {
      fail(res, error);
    }
  });
}
