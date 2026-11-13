// Gayrimenkul satış modülü — FAZ 1: proje ve bağımsız bölüm (daire) envanteri.
//
// - Kayıtlar çalışma alanı sahibinin kimliğiyle saklanır (re_project / re_unit); başka bir
//   alanın kullanıcısı bu kayıtları ne okuyabilir ne değiştirebilir.
// - Yetki: "crm" modülü. Okuma yetkisi olan envanterin tamamını görür (envanter kişiye değil
//   firmaya aittir; "yalnız kendi kayıtları" kapsamı burada uygulanmaz), yazma yetkisi olan düzenler.
// - Silme yoktur (diğer kayıt türlerindeki gibi); proje ve daire "arşivlenir".
// - Görseller veri klasöründe, alan başına ayrı klasörde tutulur ve yalnız aynı alanın
//   oturum açmış kullanıcılarına sunulur.
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { canAccess, rawStoreOf } from "./access.js";
import {
  PROJECT_IMAGE_MAX_BYTES,
  PROJECT_IMAGE_TYPES,
  PROJECT_KIND,
  ProjectSchema,
  UNIT_KIND,
  UnitSchema,
  unitKey,
  type Inventory,
  type Project,
  type Unit,
} from "../shared/real-estate.js";

/** Tek içe aktarma isteğinde kabul edilen satır sayısı (arayüz 500'lük parçalar gönderir). */
export const UNIT_IMPORT_REQUEST_ROWS = 1_000;
const IMAGE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const IMAGE_MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (message: string) => new HttpError(400, "INVALID_REQUEST", message);
const conflict = (message: string) => new HttpError(409, "CONFLICT", message);
const notFound = (message = "Kayıt bulunamadı.") => new HttpError(404, "NOT_FOUND", message);

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return res.status(400).json({ error: "INVALID_REQUEST", message: `${where}${issue?.message || "Geçersiz istek."}` });
  }
  if (error instanceof HttpError) return res.status(error.statusCode).json({ error: error.code, message: error.message });
  console.warn("Proje envanteri hatası:", (error as Error)?.message);
  return res.status(500).json({ error: "SERVER_ERROR", message: "Beklenmeyen sunucu hatası." });
}

const authOf = (req: Request) => (req as Request & { auth: AuthContext }).auth;
function bodyOf(req: Request): Record<string, unknown> {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.isBuffer(body)) throw invalid("İstek gövdesi nesne olmalı.");
  return body as Record<string, unknown>;
}

// Aynı alanda eşzamanlı yazmalar sıraya alınır: (blok, daire no) tekilliği "oku-sonra-yaz"
// ile denetlendiği için iki istek aynı anda aynı daireyi oluşturamamalı.
const queues = new Map<string, Promise<unknown>>();
// Teklif modülü (server/quotes.ts) daire durumunu değiştirirken aynı sırayı kullanır.
export function serial<T>(owner: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(owner) || Promise.resolve()).then(task, task);
  const settled = next.catch(() => undefined);
  queues.set(owner, settled);
  void settled.then(() => {
    if (queues.get(owner) === settled) queues.delete(owner);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Görsel deposu
// ---------------------------------------------------------------------------

const imageRoot = () => path.resolve(process.env.XRE_DATA_DIR?.trim() || "data", "project-images");
/** Alan klasörü: sahip kimliğinin özeti (kimlikte dosya adına uygun olmayan karakterler bulunabilir). */
const ownerFolder = (ownerOpenId: string) => crypto.createHash("sha256").update(ownerOpenId).digest("hex").slice(0, 40);
export const projectImageDir = (ownerOpenId: string) => path.join(imageRoot(), ownerFolder(ownerOpenId));
const quotaBytes = () => Math.max(1, Number(process.env.XRE_PROJECT_IMAGE_QUOTA_MB) || 2048) * 1024 * 1024;

/** Dosyanın ilk baytlarından türünü bulur; bildirilen türe güvenilmez. */
export function sniffImage(bytes: Uint8Array): "jpg" | "png" | "webp" | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (
    bytes.length >= 12 &&
    [0x52, 0x49, 0x46, 0x46].every((b, i) => bytes[i] === b) &&
    [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b)
  )
    return "webp";
  return null;
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) total += (await fs.stat(path.join(dir, name)).catch(() => null))?.size || 0;
  return total;
}

/** Ham gövdeyi (en çok 8 MB) okur; aşımda ve bozuk gövdede JSON hata döner. */
function rawImageBody(req: Request, res: Response, next: NextFunction) {
  express.raw({ type: () => true, limit: PROJECT_IMAGE_MAX_BYTES })(req, res, (error?: any) => {
    if (!error) return next();
    if (error?.type === "entity.too.large" || error?.status === 413)
      return res.status(413).json({ error: "FILE_TOO_LARGE", message: "Görsel 8 MB sınırını aşıyor." });
    return res.status(400).json({ error: "INVALID_REQUEST", message: "Görsel okunamadı." });
  });
}

// ---------------------------------------------------------------------------
// Kayıt yardımcıları
// ---------------------------------------------------------------------------

export async function getInventory(store: Store, ownerOpenId: string): Promise<Inventory> {
  const raw = rawStoreOf(store);
  const [projects, units] = await Promise.all([raw.list<Project>(PROJECT_KIND, ownerOpenId), raw.list<Unit>(UNIT_KIND, ownerOpenId)]);
  return {
    projects: projects.map((r) => r.payload).sort((a, b) => a.name.localeCompare(b.name, "tr")),
    units: units.map((r) => r.payload),
  };
}

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const givenId = (input: Record<string, unknown>, prefix: string) => {
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (id && !/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw invalid("Kimlik yalnız harf, rakam, tire ve alt çizgi içerebilir.");
  return id || makeId(prefix);
};
function withoutSystemFields(input: Record<string, unknown>) {
  const patch = { ...input };
  delete patch.id;
  delete patch.createdAt;
  delete patch.updatedAt;
  return patch;
}

const ImportRowSchema = UnitSchema.pick({
  block: true, floor: true, unitNo: true, type: true, grossM2: true, netM2: true, facade: true, view: true,
  listPrice: true, currency: true, status: true, features: true, notes: true,
})
  .partial()
  .required({ unitNo: true })
  .strict();

export function registerProjectRoutes(app: Express, store: Store): void {
  const raw = rawStoreOf(store);

  // Genel yetki katmanı (/api/projects, /api/units, /api/project-images → crm) bu uçlardan
  // önce çalışır; burada aynı kural ikinci kez denetlenir.
  const guard = (action: "read" | "write") => (req: Request, res: Response, next: NextFunction) => {
    const auth = authOf(req);
    if (!auth?.ownerOpenId) return res.status(401).json({ error: "UNAUTHORIZED", message: "Oturum gerekli." });
    if (!canAccess(auth, "crm", action))
      return res.status(403).json({ error: "FORBIDDEN", message: "crm modülünde bu işlem için yetkiniz yok." });
    next();
  };
  const read = guard("read");
  const write = guard("write");

  const audit = (owner: string, kind: "projects" | "units", id: string, title: string, detail: string) =>
    raw
      .appendEvent(owner, `suite:${kind}:${id}:${crypto.randomUUID()}`, { type: "suite-change", kind, entityId: id, title, detail, createdAt: new Date().toISOString() }, "completed")
      .catch(() => undefined);

  const requireProject = async (owner: string, projectId: string) => {
    const project = (await raw.get<Project>(PROJECT_KIND, projectId, owner))?.payload;
    if (!project) throw invalid("Proje bağlantısı bu çalışma alanına ait değil.");
    return project;
  };
  const projectUnits = async (owner: string, projectId: string) =>
    (await raw.list<Unit>(UNIT_KIND, owner)).map((r) => r.payload).filter((u) => u.projectId === projectId);
  const assertUnique = (units: Unit[], unit: Unit) => {
    const key = unitKey(unit.block, unit.unitNo);
    if (units.some((other) => other.id !== unit.id && unitKey(other.block, other.unitNo) === key))
      throw conflict(`Bu projede ${unit.block ? `${unit.block} blok ` : ""}${unit.unitNo} numaralı daire zaten var.`);
  };

  app.get("/api/projects", read, async (req, res) => {
    try {
      res.json(await getInventory(store, authOf(req).ownerOpenId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/projects", write, async (req, res) => {
    try {
      const owner = authOf(req).ownerOpenId;
      const input = bodyOf(req);
      const stamp = new Date().toISOString();
      const project = ProjectSchema.parse({ ...input, id: givenId(input, "project"), createdAt: stamp, updatedAt: stamp });
      const inserted = await raw.insertIfAbsent(PROJECT_KIND, project.id, project, owner);
      if (!inserted.inserted) throw conflict("Bu kimlikte proje zaten var.");
      void audit(owner, "projects", project.id, "Proje oluşturuldu", `Proje: ${project.name}`);
      res.status(201).json(project);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/projects/:id", write, async (req, res) => {
    try {
      const owner = authOf(req).ownerOpenId;
      const input = bodyOf(req);
      const project = await serial(owner, async () => {
        const old = (await raw.get<Project>(PROJECT_KIND, req.params.id, owner))?.payload;
        if (!old) throw notFound("Proje bulunamadı.");
        const next = ProjectSchema.parse({ ...old, ...withoutSystemFields(input), id: old.id, createdAt: old.createdAt, updatedAt: new Date().toISOString() });
        await raw.put(PROJECT_KIND, old.id, next, owner);
        return next;
      });
      void audit(owner, "projects", project.id, project.archived ? "Proje arşivlendi" : "Proje güncellendi", `Proje: ${project.name}`);
      res.json(project);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/units", write, async (req, res) => {
    try {
      const owner = authOf(req).ownerOpenId;
      const input = bodyOf(req);
      const stamp = new Date().toISOString();
      const unit = UnitSchema.parse({ ...input, id: givenId(input, "unit"), createdAt: stamp, updatedAt: stamp });
      const project = await serial(owner, async () => {
        const found = await requireProject(owner, unit.projectId);
        assertUnique(await projectUnits(owner, unit.projectId), unit);
        const inserted = await raw.insertIfAbsent(UNIT_KIND, unit.id, unit, owner);
        if (!inserted.inserted) throw conflict("Bu kimlikte daire zaten var.");
        return found;
      });
      void audit(owner, "units", unit.id, "Daire oluşturuldu", `${project.name} · ${[unit.block, unit.unitNo].filter(Boolean).join(" / ")}`);
      res.status(201).json(unit);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch("/api/units/:id", write, async (req, res) => {
    try {
      const owner = authOf(req).ownerOpenId;
      const input = bodyOf(req);
      const { unit, project, old } = await serial(owner, async () => {
        const old = (await raw.get<Unit>(UNIT_KIND, req.params.id, owner))?.payload;
        if (!old) throw notFound("Daire bulunamadı.");
        const unit = UnitSchema.parse({ ...old, ...withoutSystemFields(input), id: old.id, createdAt: old.createdAt, updatedAt: new Date().toISOString() });
        const project = await requireProject(owner, unit.projectId);
        assertUnique(await projectUnits(owner, unit.projectId), unit);
        await raw.put(UNIT_KIND, old.id, unit, owner);
        return { unit, project, old };
      });
      const label = `${project.name} · ${[unit.block, unit.unitNo].filter(Boolean).join(" / ")}`;
      void audit(
        owner,
        "units",
        unit.id,
        unit.archived && !old.archived ? "Daire arşivlendi" : old.status !== unit.status ? "Daire durumu değişti" : "Daire güncellendi",
        old.status !== unit.status ? `${label}: ${old.status} → ${unit.status}` : label,
      );
      res.json(unit);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Toplu içe aktarma: satırlar arayüzde ayrıştırılıp doğrulanır, burada yeniden doğrulanır.
  // Aynı blok + no ile daire varsa kullanıcının seçimine göre güncellenir veya atlanır.
  app.post("/api/units/import", write, async (req, res) => {
    try {
      const owner = authOf(req).ownerOpenId;
      const input = z
        .object({
          projectId: z.string().min(1).max(191),
          duplicates: z.enum(["update", "skip"]),
          rows: z.array(z.unknown()).min(1).max(UNIT_IMPORT_REQUEST_ROWS),
        })
        .parse(bodyOf(req));
      const result = await serial(owner, async () => {
        const project = await requireProject(owner, input.projectId);
        const byKey = new Map((await projectUnits(owner, project.id)).map((u) => [unitKey(u.block, u.unitNo), u]));
        const out = { created: 0, updated: 0, skipped: 0, errors: [] as { index: number; message: string }[] };
        for (const [index, candidate] of input.rows.entries()) {
          const parsed = ImportRowSchema.safeParse(candidate);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            out.errors.push({ index, message: `${issue?.path.join(".") || "satır"}: ${issue?.message || "geçersiz"}` });
            continue;
          }
          // Şema varsayılanları yalnız yeni dairede geçerlidir: güncellemede dosyada olmayan alan eski değerini korur.
          const given = new Set(Object.keys(candidate as object));
          const row = Object.fromEntries(Object.entries(parsed.data).filter(([field]) => given.has(field))) as typeof parsed.data;
          const key = unitKey(row.block, row.unitNo);
          const old = byKey.get(key);
          const stamp = new Date().toISOString();
          if (old) {
            if (input.duplicates === "skip") {
              out.skipped++;
              continue;
            }
            // Yeniden içe aktarılan arşivli daire tekrar etkinleşir.
            const next = UnitSchema.parse({ ...old, ...row, block: old.block, unitNo: old.unitNo, archived: false, updatedAt: stamp });
            await raw.put(UNIT_KIND, old.id, next, owner);
            byKey.set(key, next);
            out.updated++;
            continue;
          }
          if (row.floor == null || row.listPrice == null) {
            out.errors.push({ index, message: "Yeni daire için kat ve fiyat zorunlu." });
            continue;
          }
          const unit = UnitSchema.parse({ ...row, id: makeId("unit"), projectId: project.id, createdAt: stamp, updatedAt: stamp });
          await raw.put(UNIT_KIND, unit.id, unit, owner);
          byKey.set(key, unit);
          out.created++;
        }
        if (out.created || out.updated)
          void audit(owner, "units", project.id, "Daireler içe aktarıldı", `${project.name}: ${out.created} yeni, ${out.updated} güncellendi, ${out.skipped} atlandı`);
        return out;
      });
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // Görsel yükleme: gövde dosyanın kendisidir (Content-Type: image/jpeg | image/png | image/webp).
  app.post("/api/project-images", write, rawImageBody, async (req, res) => {
    try {
      const owner = authOf(req).ownerOpenId;
      const declared = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!(PROJECT_IMAGE_TYPES as readonly string[]).includes(declared))
        throw new HttpError(415, "UNSUPPORTED_IMAGE", "Yalnız JPEG, PNG veya WebP görsel yüklenebilir.");
      const body = req.body;
      if (!Buffer.isBuffer(body) || !body.length) throw invalid("Görsel dosyası boş.");
      if (body.length > PROJECT_IMAGE_MAX_BYTES) throw new HttpError(413, "FILE_TOO_LARGE", "Görsel 8 MB sınırını aşıyor.");
      const ext = sniffImage(body);
      if (!ext) throw new HttpError(415, "UNSUPPORTED_IMAGE", "Dosya içeriği JPEG, PNG veya WebP değil.");
      const dir = projectImageDir(owner);
      await fs.mkdir(dir, { recursive: true });
      if ((await folderSize(dir)) + body.length > quotaBytes())
        throw new HttpError(413, "QUOTA_EXCEEDED", "Çalışma alanının görsel kotası doldu.");
      const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
      await fs.writeFile(path.join(dir, name), body, { flag: "wx", mode: 0o600 });
      res.status(201).json({ id: name.slice(0, 32), url: `/api/project-images/${name}`, contentType: IMAGE_MIME[ext], size: body.length });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Görsel yalnız isteği yapanın kendi alan klasöründe aranır: başka alanın dosya adı bilinse de bulunmaz.
  app.get("/api/project-images/:name", read, async (req, res) => {
    try {
      const name = String(req.params.name || "");
      const match = IMAGE_NAME.exec(name);
      if (!match) throw notFound("Görsel bulunamadı.");
      const dir = projectImageDir(authOf(req).ownerOpenId);
      const file = path.join(dir, name);
      if (path.dirname(file) !== dir) throw notFound("Görsel bulunamadı.");
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) throw notFound("Görsel bulunamadı.");
      res.setHeader("Content-Type", IMAGE_MIME[match[1]]);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, max-age=86400, immutable");
      res.end(bytes);
    } catch (error) {
      sendError(res, error);
    }
  });
}
