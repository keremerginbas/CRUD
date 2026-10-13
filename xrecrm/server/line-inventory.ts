import type { Express, Request } from "express";
import type { Store } from "./db.js";
import type { AuthContext } from "./types.js";
import { rawStoreOf } from "./access.js";
import fs from "node:fs";
import path from "node:path";
import { lines, parseLineInventory, setLineInventory } from "../shared/lines.js";

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

export function registerLineInventoryRoutes(app: Express, store: Store) {
  const raw = rawStoreOf(store);
  app.put("/api/lines", async (req: Request, res) => {
    const auth = (req as Request & { auth: AuthContext }).auth;
    if (!auth?.isOwner)
      return res.status(403).json({ error: "OWNER_REQUIRED", message: "Hat envanterini yalnız sahip düzenler." });
    try {
      const next = parseLineInventory(req.body?.lines);
      if (!next.length) return res.status(400).json({ error: "EMPTY", message: "En az bir hat gerekli." });
      if (next.length > 1000) return res.status(400).json({ error: "TOO_MANY", message: "En fazla 1000 hat." });
      await raw.put(KIND, ID, { id: ID, lines: next, updatedAt: new Date().toISOString(), updatedBy: auth.user.openId }, auth.ownerOpenId);
      setLineInventory(next);
      res.json({ lines: next });
    } catch (error) {
      res.status(400).json({ error: "INVALID_LINES", message: (error as Error).message });
    }
  });
}
