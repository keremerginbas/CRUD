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
