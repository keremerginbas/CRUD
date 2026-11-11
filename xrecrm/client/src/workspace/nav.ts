import { slugFromPath } from "../../../shared/workspaces";
// Önizleme yapısında (tek dosya, sunucusuz) adres çubuğuna yazılamayabilir;
// yol sanal olarak tutulur. Normal çalışmada doğrudan location.pathname döner.
export const PREVIEW = Boolean(import.meta.env.VITE_XRE_PREVIEW);
let virtualPath = "/";

/** Adresteki çalışma alanı kısa adı (crm.../ahmet → "ahmet"); varsayılan alanda boştur. */
export const WORKSPACE_SLUG =
  PREVIEW || typeof window === "undefined" ? "" : slugFromPath(window.location.pathname);
const BASE = WORKSPACE_SLUG ? `/${WORKSPACE_SLUG}` : "";
/** Uygulama içi yolu adres çubuğundaki yola çevirir (/kanban → /ahmet/kanban). */
export const withBase = (path: string) => (BASE && path.startsWith("/") ? (path === "/" ? BASE : BASE + path) : path);

export function currentPath(): string {
  if (PREVIEW) return virtualPath;
  const p = window.location.pathname;
  if (BASE && (p === BASE || p.startsWith(BASE + "/"))) return p.slice(BASE.length) || "/";
  return p;
}

export function installPreviewShims(): void {
  if (!PREVIEW) return;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = ((state: unknown, title: string, url?: string | URL | null) => {
      if (url) virtualPath = new URL(String(url), "https://onizleme.local").pathname;
      try {
        original(state, title, url);
      } catch {
        /* korumalı çerçevede adres değiştirilemez */
      }
    }) as History[typeof method];
  }
  try {
    localStorage.setItem("xre-probe", "1");
    localStorage.removeItem("xre-probe");
  } catch {
    const memory = new Map<string, string>();
    const shim = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, String(v)),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
      key: (i: number) => [...memory.keys()][i] ?? null,
      get length() {
        return memory.size;
      },
    };
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, { value: shim, configurable: true });
  }
}
