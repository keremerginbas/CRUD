// Otomatik ve elle yedekleme / geri yükleme.
// Yedekler data/backups altında sıkıştırılmış JSON (.json.gz) olarak tutulur.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import type { Express, Request } from "express";
import type { Store, StoreDump } from "./db.js";
import { assertDump, storageKind } from "./db.js";
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
        storage: storageKind(),
      });
    } catch (error) {
      fail(res, error);
    }
  });

  // Sunucunun durumu: çalışma süresi, bellek, disk, kayıt sayıları ve son yedek.
  app.get("/api/system/status", async (req, res) => {
    try {
      const auth = ownerOnly(req);
      const dataDir = path.resolve(process.env.XRE_DATA_DIR?.trim() || "data");
      const disk = await fs.statfs(dataDir).catch(() => null);
      const [backups, leads, employees, quotes, units] = await Promise.all([
        listBackups().catch(() => []),
        baseStore.list("lead", auth.ownerOpenId),
        baseStore.list("employee", auth.ownerOpenId),
        baseStore.list("re_quote", auth.ownerOpenId),
        baseStore.list("re_unit", auth.ownerOpenId),
      ]);
      const last = [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      res.json({
        checkedAt: new Date().toISOString(),
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        memory: { appBytes: process.memoryUsage().rss, totalBytes: os.totalmem(), freeBytes: os.freemem() },
        cpu: { cores: os.cpus().length, load1: Math.round(os.loadavg()[0] * 100) / 100 },
        disk: disk ? { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize } : null,
        records: { leads: leads.length, employees: employees.length, quotes: quotes.length, units: units.length },
        lastBackup: last ? { name: last.name, createdAt: last.createdAt, size: last.size } : null,
        storage: storageKind(),
        node: process.version,
      });
    } catch (error) {
      fail(res, error);
    }
  });

  // Deneme verisi: kanbanı ve raporları dolu görmek için örnek müşteri üretir. Kayıtların kimliği
  // "testveri-" ile başlar ve "test-veri" etiketi taşır; tek tuşla tamamı silinir. Otomasyon tetiklemez.
  app.post("/api/system/test-data", async (req, res) => {
    try {
      const auth = ownerOnly(req);
      const count = Math.floor(Number(req.body?.count));
      if (!Number.isFinite(count) || count < 1 || count > 20000)
        throw Object.assign(new Error("Sayı 1 ile 20.000 arasında olmalı."), { statusCode: 400 });
      const owner = auth.ownerOpenId;
      const employees = (await baseStore.list<{ name?: string; active?: boolean }>("employee", owner)).map((r) => r.payload).filter((e) => e.active !== false && e.name);
      const owners = [auth.displayName || auth.user.name || "Yönetici", ...employees.map((e) => String(e.name))];
      const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
      const FIRST = ["Ahmet", "Mehmet", "Ayşe", "Fatma", "Mustafa", "Zeynep", "Emre", "Elif", "Burak", "Selin", "Can", "Deniz", "Hakan", "Merve", "Oğuz", "Ebru", "Serkan", "Gizem", "Tolga", "Derya", "Kerem", "Esra", "Volkan", "Pınar", "Onur", "Seda", "Murat", "Büşra", "Cem", "Nur"];
      const LAST = ["Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Yıldız", "Öztürk", "Aydın", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin", "Kara", "Koç", "Kurt", "Özdemir", "Şimşek", "Polat", "Erdoğan", "Güneş", "Aksoy", "Bulut", "Tekin", "Korkmaz"];
      const CITIES = ["İstanbul", "Ankara", "İzmir", "Antalya", "Bursa", "Eskişehir", "Kocaeli", "Muğla", "Adana", "Konya"];
      const SOURCES = ["Telefon", "WhatsApp", "Web sitesi", "Instagram", "Referans", "Sahibinden", "Fuar"];
      // Aşama dağılımı gerçek bir satış hunisine benzer: başta çok, sonda az.
      const STAGES = ["new", "new", "new", "new", "contacted", "contacted", "contacted", "qualified", "qualified", "proposal", "proposal", "won", "lost"] as const;
      const batch = Date.now().toString(36);
      const now = Date.now();
      for (let i = 0; i < count; i++) {
        const id = `testveri-${batch}-${i}`;
        const created = new Date(now - Math.floor(Math.random() * 90 * 86_400_000)).toISOString();
        const last = new Date(Math.min(now, Date.parse(created) + Math.floor(Math.random() * 20 * 86_400_000))).toISOString();
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        const leadOwner = pick(owners);
        await baseStore.put(
          "lead",
          id,
          {
            id,
            name,
            phone: `+90 5${30 + Math.floor(Math.random() * 30)} ${String(100 + Math.floor(Math.random() * 900))} ${String(10 + Math.floor(Math.random() * 90))} ${String(10 + Math.floor(Math.random() * 90))}`,
            email: "",
            company: "",
            stage: pick(STAGES),
            owner: leadOwner,
            value: (15 + Math.floor(Math.random() * 105)) * 100_000,
            source: pick(SOURCES),
            city: pick(CITIES),
            notes: "Deneme verisi",
            tags: ["test-veri"],
            pipelineId: "sales",
            createdAt: created,
            lastActivity: last,
          },
          owner,
        );
        // Her üç müşteriden birine planlı bir görüşme, her beşte birine bir görev.
        if (i % 3 === 0) {
          const start = new Date(now + Math.floor((Math.random() * 14 - 3) * 86_400_000)).toISOString();
          await baseStore.put(
            "activities",
            `${id}-a`,
            { id: `${id}-a`, leadId: id, type: "call", title: "Müşteriyle görüşün", description: "", assignee: leadOwner, startAt: start, endAt: new Date(Date.parse(start) + 1_800_000).toISOString(), completed: false, createdAt: created, updatedAt: created },
            owner,
          );
        }
        if (i % 5 === 0)
          await baseStore.put(
            "tasks",
            `${id}-t`,
            { id: `${id}-t`, leadId: id, title: `${name} için teklif hazırla`, description: "", assignee: leadOwner, priority: pick(["low", "medium", "high"] as const), status: "todo", dueAt: new Date(now + Math.floor((Math.random() * 10 - 2) * 86_400_000)).toISOString(), checklist: [], createdAt: created, updatedAt: created },
            owner,
          );
      }
      res.status(201).json({ created: count });
    } catch (error) {
      fail(res, error);
    }
  });

  app.delete("/api/system/test-data", async (req, res) => {
    try {
      const auth = ownerOnly(req);
      const owner = auth.ownerOpenId;
      let removed = 0;
      for (const kind of ["lead", "activities", "tasks"] as const)
        for (const row of await baseStore.list(kind, owner))
          if (row.id.startsWith("testveri-")) {
            await baseStore.delete(kind, row.id, owner);
            if (kind === "lead") removed++;
          }
      res.json({ removed });
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
