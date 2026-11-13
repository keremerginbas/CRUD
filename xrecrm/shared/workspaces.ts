// Çalışma alanı kısa adları: adreste crm.../<kısa-ad> olarak kullanılır.
// Uygulama sayfaları ve teknik yollarla çakışan adlar ayrılmıştır.
export const RESERVED_SLUGS = new Set(
  `api assets b24 bitrix health static public admin www app login logout signup kayit giris kurulum qr-onay davet
   feed kanban leads activities contacts companies tasks calendar team employees structure worktime access audit system
   profile reports data-quality ai whatsapp calls lines automations n8n webhooks integrations apps settings workspaces
   projects projeler units project-images
   firmalar demo test destek support yardim help xre-system favicon robots`.split(/\s+/),
);
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;

/** Adresin ilk bölümü bir çalışma alanı kısa adıysa onu döndürür (ör. /ahmet/kanban → ahmet). */
export function slugFromPath(pathname: string): string {
  const first = pathname.split("/")[1] || "";
  return SLUG_PATTERN.test(first) && !RESERVED_SLUGS.has(first) && !first.includes(".") ? first : "";
}

/** Firma adından kısa ad önerisi: "Ahmet İnşaat A.Ş." → "ahmet-insaat-as". */
export function suggestSlug(company: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", I: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u" };
  return company
    .replace(/[çğıİIöşüÇĞÖŞÜ]/g, (c) => map[c] || c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
}

export interface WorkspaceInfo {
  slug: string;
  name: string;
  isDefault: boolean;
  state: "active" | "trial" | "expired" | "suspended";
  daysLeft: number | null;
  trialEndsAt: string | null;
  /** WhatsApp, santral, n8n gibi iletişim modülleri bu alanda açık mı? */
  communication: boolean;
}
