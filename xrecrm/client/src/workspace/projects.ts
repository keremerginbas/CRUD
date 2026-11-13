// Proje ve daire envanterinin arayüz durumu.
// Canlı modda /api/projects üzerinden çalışır (5.000 daire her 15 saniyelik genel
// yenilemeye yük olmasın diye /api/state içine konmadı; sayfa açılınca yüklenir).
// Demo modunda hiçbir sunucu çağrısı yapılmaz: kayıtlar localStorage'da, yüklenen
// görseller yalnız bu oturumun belleğinde (object URL) tutulur.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_IMAGE_MAX_BYTES,
  PROJECT_IMAGE_TYPES,
  unitKey,
  type Inventory,
  type Project,
  type Unit,
} from "../../../shared/real-estate";
import { chunkRows, type DuplicateMode, type UnitImportValues } from "../../../shared/unit-import";
import { api, useStore } from "./store";
import { makeProjectsDemo } from "./projects-demo";

const DEMO_KEY = "xre-demo-projects-v1";
const empty: Inventory = { projects: [], units: [] };

function loadDemo(): Inventory {
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (raw && Array.isArray(raw.projects) && Array.isArray(raw.units)) return raw as Inventory;
  } catch {
    /* depolama kapalı veya bozuk */
  }
  return makeProjectsDemo();
}
/** Oturuma özgü (blob:) görseller kalıcı kayda yazılmaz; sayfa yenilenince zaten geçersiz olurlar. */
function persistable(inventory: Inventory): Inventory {
  return {
    projects: inventory.projects.map((p) => ({ ...p, images: p.images.filter((i) => !i.url.startsWith("blob:")) })),
    units: inventory.units.map((u) => (u.floorPlanImageUrl.startsWith("blob:") ? { ...u, floorPlanImageUrl: "" } : u)),
  };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { index: number; message: string }[];
}

export interface InventoryStore extends Inventory {
  loading: boolean;
  error: string;
  demo: boolean;
  canWrite: boolean;
  reload: () => Promise<void>;
  saveProject: (project: Project) => Promise<Project>;
  saveUnit: (unit: Unit) => Promise<Unit>;
  uploadImage: (file: File) => Promise<string>;
  importUnits: (projectId: string, rows: UnitImportValues[], mode: DuplicateMode, onProgress?: (done: number, total: number) => void) => Promise<ImportResult>;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function useInventory(): InventoryStore {
  const { demo, user, loading: sessionLoading } = useStore();
  const [stored, setData] = useState<Inventory>(() => (demo ? loadDemo() : empty));
  // Elimizdeki verinin hangi moda ait olduğu: mod değişirken canlı veri demo kaydına (veya tersi) karışmasın.
  const [source, setSource] = useState<"demo" | "live">(demo ? "demo" : "live");
  const data = source === (demo ? "demo" : "live") ? stored : empty;
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const latest = useRef(data);
  latest.current = data;
  const canWrite = Boolean(demo || user?.isOwner || user?.permissions?.crm?.write);

  const reload = useCallback(async () => {
    if (demo) {
      setData(loadDemo());
      setSource("demo");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await api("/api/projects");
      setData({ projects: next.projects || [], units: next.units || [] });
      setSource("live");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demo]);

  useEffect(() => {
    if (sessionLoading) return;
    void reload();
  }, [reload, sessionLoading]);

  useEffect(() => {
    if (!demo || source !== "demo") return;
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify(persistable(data)));
    } catch {
      /* kota doldu: demo verisi yalnız bellekte kalır */
    }
  }, [data, demo, source]);

  const upsert = <T extends { id: string }>(list: T[], item: T) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]);

  const saveProject = useCallback(
    async (project: Project) => {
      const exists = latest.current.projects.some((p) => p.id === project.id);
      let saved: Project;
      if (demo) {
        if (!project.name.trim()) throw new Error("Proje adı gerekli.");
        saved = { ...project, updatedAt: new Date().toISOString() };
      } else saved = await api(exists ? `/api/projects/${project.id}` : "/api/projects", project, exists ? "PATCH" : "POST");
      setData((d) => ({ ...d, projects: upsert(d.projects, saved) }));
      return saved;
    },
    [demo],
  );

  const saveUnit = useCallback(
    async (unit: Unit) => {
      const exists = latest.current.units.some((u) => u.id === unit.id);
      let saved: Unit;
      if (demo) {
        if (!unit.unitNo.trim()) throw new Error("Daire no gerekli.");
        if (!latest.current.projects.some((p) => p.id === unit.projectId)) throw new Error("Proje seçin.");
        const key = unitKey(unit.block, unit.unitNo);
        if (latest.current.units.some((u) => u.id !== unit.id && u.projectId === unit.projectId && unitKey(u.block, u.unitNo) === key))
          throw new Error(`Bu projede ${unit.block ? `${unit.block} blok ` : ""}${unit.unitNo} numaralı daire zaten var.`);
        saved = { ...unit, updatedAt: new Date().toISOString() };
      } else saved = await api(exists ? `/api/units/${unit.id}` : "/api/units", unit, exists ? "PATCH" : "POST");
      setData((d) => ({ ...d, units: upsert(d.units, saved) }));
      return saved;
    },
    [demo],
  );

  const uploadImage = useCallback(
    async (file: File) => {
      if (!(PROJECT_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error("Yalnız JPEG, PNG veya WebP görsel yüklenebilir.");
      if (file.size > PROJECT_IMAGE_MAX_BYTES) throw new Error("Görsel 8 MB sınırını aşıyor.");
      if (demo) return URL.createObjectURL(file);
      const response = await fetch("/api/project-images", { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Görsel yüklenemedi.");
      return String(body.url);
    },
    [demo],
  );

  const importUnits = useCallback<InventoryStore["importUnits"]>(
    async (projectId, rows, mode, onProgress) => {
      const total: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
      if (demo) {
        const stamp = new Date().toISOString();
        const units = latest.current.units.slice();
        const byKey = new Map(units.map((u, i) => [u.projectId === projectId ? unitKey(u.block, u.unitNo) : `-${i}`, i]));
        rows.forEach((row, index) => {
          const key = unitKey(row.block, row.unitNo);
          const at = byKey.get(key);
          if (at !== undefined) {
            if (mode === "skip") return void total.skipped++;
            units[at] = { ...units[at], ...row, archived: false, updatedAt: stamp } as Unit;
            total.updated++;
          } else if (row.floor == null || row.listPrice == null) total.errors.push({ index, message: "Yeni daire için kat ve fiyat zorunlu." });
          else {
            byKey.set(key, units.length);
            units.push({
              block: "", type: "", grossM2: 0, netM2: 0, facade: "", view: "", currency: "TRY", status: "müsait", features: [], notes: "",
              ...row,
              id: newId("unit"), projectId, floorPlanImageUrl: "", archived: false, createdAt: stamp, updatedAt: stamp,
            } as Unit);
            total.created++;
          }
        });
        setData((d) => ({ ...d, units }));
        onProgress?.(rows.length, rows.length);
        return total;
      }
      let done = 0;
      try {
        for (const chunk of chunkRows(rows)) {
          const result: ImportResult = await api("/api/units/import", { projectId, duplicates: mode, rows: chunk });
          total.created += result.created;
          total.updated += result.updated;
          total.skipped += result.skipped;
          total.errors.push(...result.errors.map((e) => ({ ...e, index: e.index + done })));
          done += chunk.length;
          onProgress?.(done, rows.length);
        }
      } finally {
        // Yarıda kesilse bile ekrandaki liste sunucudaki son durumu göstersin.
        await reload();
      }
      return total;
    },
    [demo, reload],
  );

  return useMemo(
    () => ({ ...data, loading, error, demo, canWrite, reload, saveProject, saveUnit, uploadImage, importUnits }),
    [data, loading, error, demo, canWrite, reload, saveProject, saveUnit, uploadImage, importUnits],
  );
}
