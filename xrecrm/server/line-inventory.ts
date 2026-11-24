import type { Express, Request } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import fs from "node:fs";
import path from "node:path";
import { lines, parseLineInventory, placeholderLines, setLineInventory, type Line } from "../shared/lines.js";

/**
 * Gerçek hat envanterini Git dışındaki kaynaktan yükler:
 * 1) LINES_INVENTORY_JSON ortam değişkeni (JSON dizi)
 * 2) LINES_INVENTORY_FILE veya <proje>/config/lines.json
 * Bulunamazsa yer tutucu (sahte) envanter kalır ve uyarı yazılır.
 */
export function loadLineInventory(projectRoot: string): {
  source: string;
  count: number;
} {
  try {
    const inline = process.env.LINES_INVENTORY_JSON?.trim();
    if (inline) {
      setLineInventory(parseLineInventory(JSON.parse(inline)));
      return { source: "env", count: lines.length };
    }
    const file = path.resolve(
      projectRoot,
      process.env.LINES_INVENTORY_FILE?.trim() || "config/lines.json",
    );
    if (fs.existsSync(file)) {
      setLineInventory(
        parseLineInventory(JSON.parse(fs.readFileSync(file, "utf8"))),
      );
      return { source: file, count: lines.length };
    }
  } catch (error) {
    console.warn(
      "Hat envanteri okunamadı; yer tutucu envanter kullanılıyor:",
      error instanceof Error ? error.message : error,
    );
    return { source: "placeholder", count: lines.length };
  }
  console.warn(
    "config/lines.json bulunamadı; yer tutucu hat envanteri kullanılıyor. Örnek: config/lines.example.json",
  );
  return { source: "placeholder", count: lines.length };
}

// ---------------------------------------------------------------------------
// Veritabanında saklanan envanter (Hat yönetimi ekranından düzenlenir)
// ---------------------------------------------------------------------------

const KIND = "line-inventory";
const ID = "current";

export async function loadLineInventoryFromStore(store: Store): Promise<number> {
  const raw = rawStoreOf(store);
  const owner = await raw.resolveOwner().catch(() => undefined);
  if (!owner) return 0;
  const saved = (await raw.get<{ lines: unknown }>(KIND, ID, owner))?.payload;
  if (!saved) return 0;
  setLineInventory(parseLineInventory(saved.lines));
  return lines.length;
}

/**
 * Envanteri kaydeder. Hatta seçilmiş yetkili personel listesi hat kimliğinde kalır:
 * bağlı WhatsApp hesabı, bağlantı kaydı ve mesajlar da aynı kimlikle tutulur. Toplu düzenlemede
 * numaraların sırası değişse ya da hat listeden çıkarılsa bile liste, koruduğu sohbetlerle birlikte durur.
 */
export async function saveLineInventory(store: Store, owner: string, next: Line[], updatedBy: string): Promise<void> {
  await rawStoreOf(store).put(KIND, ID, { id: ID, lines: next, updatedAt: new Date().toISOString(), updatedBy }, owner);
  setLineInventory(next);
}

/**
 * Örnek (sahte numaralı) hatları listeden ayıklar: gerçek numarası, verilmiş adı ya da bağlı
 * WhatsApp hesabı olan hatlar kalır; toplam üçten azsa örnek hatlarla üçe tamamlanır.
 * Kayıt değişmez; sahip Hat yönetimi'nden kendi listesini kaydedince o geçerli olur.
 */
export async function useStarterLines(store: Store): Promise<number> {
  const raw = rawStoreOf(store);
  const owner = await raw.resolveOwner().catch(() => undefined);
  const connected = new Set<string>();
  if (owner)
    for (const r of await raw.list<{ status?: string }>("connection", owner).catch(() => []))
      if (r.payload?.status === "connected") connected.add(r.id);
  const sample = new Map(placeholderLines.map((l) => [l.id, l.phone]));
  const inUse = (l: Line) => sample.get(l.id) !== l.phone || Boolean(l.label?.trim()) || connected.has(l.id);
  const keep = new Set(lines.filter(inUse).map((l) => l.id));
  for (const l of lines) if (keep.size < 3) keep.add(l.id);
  const starter = lines.filter((l) => keep.has(l.id)).map((l, i) => (l.label?.trim() ? l : { ...l, label: `WhatsApp ${i + 1}` }));
  setLineInventory(starter);
  return starter.length;
}

export function registerLineInventoryRoutes(app: Express, store: Store) {
  app.put("/api/lines", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner)
      return res.status(403).json({ error: "OWNER_REQUIRED", message: "Hat envanterini yalnız sahip düzenler." });
    try {
      const next = parseLineInventory(req.body?.lines);
      if (!next.length) return res.status(400).json({ error: "EMPTY", message: "En az bir hat gerekli." });
      if (next.length > 1000) return res.status(400).json({ error: "TOO_MANY", message: "En fazla 1000 hat." });
      await saveLineInventory(store, auth.ownerOpenId, next, auth.user.openId);
      res.json({ lines: next });
    } catch (error) {
      res.status(400).json({ error: "INVALID_LINES", message: (error as Error).message });
    }
  });
}
