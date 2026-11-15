// Firma kimliği (ad + logo): müşteriye özel kurulumda XRE CRM logosu yerine firmanın logosu görünür.
// Giriş ekranında da kullanıldığı için oturum gerektirmeyen /api/branding ucundan okunur.
import { useEffect, useState } from "react";

export interface Branding {
  name: string;
  logoUrl: string | null;
}
const DEFAULT: Branding = { name: "", logoUrl: null };
const CACHE_KEY = "xre-branding";
const CHANGED = "xre:branding-changed";

function cached(): Branding {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (raw && typeof raw === "object") return { name: String(raw.name || ""), logoUrl: typeof raw.logoUrl === "string" ? raw.logoUrl : null };
  } catch {
    /* depolama kapalı */
  }
  return DEFAULT;
}
/** Sekme başlığı ve sekme simgesi firmanın kimliğini taşır. */
function applyToDocument(b: Branding) {
  if (typeof document === "undefined") return;
  if (b.name) document.title = `${b.name} · CRM`;
  if (b.logoUrl) {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = b.logoUrl;
  }
}
let current: Branding = typeof localStorage === "undefined" ? DEFAULT : cached();
let requested = false;
applyToDocument(current);

export function setBranding(next: Branding) {
  current = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    /* depolama kapalı */
  }
  applyToDocument(next);
  window.dispatchEvent(new Event(CHANGED));
}

/** Son bilinen kimlik hemen döner (açılışta logo titremez); sunucudan gelen güncel değer arkadan uygulanır. */
export function useBranding(): Branding {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const sync = () => setValue(current);
    window.addEventListener(CHANGED, sync);
    if (!requested && typeof fetch !== "undefined") {
      requested = true;
      fetch("/api/branding")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && typeof d === "object" && setBranding({ name: String(d.name || ""), logoUrl: typeof d.logoUrl === "string" ? d.logoUrl : null }))
        .catch(() => undefined);
    }
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  return value;
}
