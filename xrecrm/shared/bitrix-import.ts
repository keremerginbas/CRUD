// Bitrix24 → XRE CRM veri aktarımı: tarayıcı ve sunucunun ortak sözleşmesi.

export const BITRIX_IMPORT_ENTITIES = [
  "leads",
  "deals",
  "contacts",
  "companies",
  "activities",
  "calls",
] as const;
export type BitrixImportEntity = (typeof BITRIX_IMPORT_ENTITIES)[number];

export const BITRIX_ENTITY_LABELS: Record<BitrixImportEntity, string> = {
  leads: "Potansiyel müşteriler (Lead)",
  deals: "Anlaşmalar (Deal)",
  contacts: "Kişiler",
  companies: "Şirketler",
  activities: "Aktiviteler",
  calls: "Arama kayıtları",
};

export const XRE_STAGES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
] as const;
export type XreStage = (typeof XRE_STAGES)[number];

export const XRE_STAGE_LABELS: Record<XreStage, string> = {
  new: "Yeni müşteri",
  contacted: "İletişime geçildi",
  qualified: "Randevu",
  proposal: "Teklif gönderildi",
  won: "Satış tamamlandı",
  lost: "Kaybedildi",
};

export type BitrixSemantics = "S" | "F" | "P";

export interface BitrixStatusInput {
  STATUS_ID: string;
  NAME?: string;
  SORT?: number | string;
  SEMANTICS?: string | null;
  EXTRA?: { SEMANTICS?: string | null } | null;
}

/** Bitrix durumunun anlamını (başarılı / başarısız / süreç) belirler. */
export function bitrixSemantics(status: BitrixStatusInput): BitrixSemantics {
  const raw = String(
    status.SEMANTICS ?? status.EXTRA?.SEMANTICS ?? "",
  ).toUpperCase();
  if (raw === "S" || raw === "SUCCESS") return "S";
  if (raw === "F" || raw === "FAILURE") return "F";
  if (raw === "P" || raw === "PROCESS") return "P";
  const id = String(status.STATUS_ID || "").toUpperCase();
  const tail = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  if (tail === "WON" || tail === "CONVERTED") return "S";
  if (tail === "LOSE" || tail === "JUNK" || tail === "APOLOGY") return "F";
  return "P";
}

/**
 * Tek bir Bitrix durum listesini (lead durumları veya bir anlaşma hunisinin
 * aşamaları) XRE aşamalarına eşler. Başarılı → won, başarısız → lost; süreç
 * aşamaları SORT sırasına göre new / contacted / qualified / proposal
 * aralığına yayılır (ilk → new, son → proposal).
 */
export function suggestStageMapping(
  statuses: BitrixStatusInput[],
): Record<string, XreStage> {
  const result: Record<string, XreStage> = {};
  const process: BitrixStatusInput[] = [];
  statuses.forEach((status) => {
    const id = String(status.STATUS_ID || "");
    if (!id) return;
    const semantic = bitrixSemantics(status);
    if (semantic === "S") result[id] = "won";
    else if (semantic === "F") result[id] = "lost";
    else process.push(status);
  });
  const ordered = process
    .map((status, index) => ({ status, index }))
    .sort(
      (a, b) =>
        (Number(a.status.SORT) || 0) - (Number(b.status.SORT) || 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.status);
  const n = ordered.length;
  const middle: XreStage[] = ["contacted", "qualified"];
  ordered.forEach((status, i) => {
    let stage: XreStage;
    if (i === 0) stage = "new";
    else if (i === n - 1) stage = "proposal";
    else {
      const m = n - 2;
      stage = middle[Math.min(middle.length - 1, Math.floor((i - 1) * middle.length / m))];
    }
    result[String(status.STATUS_ID)] = stage;
  });
  return result;
}

/** Önizlemede gösterilen tespit edilmiş Bitrix aşaması. */
export interface BitrixDetectedStage {
  /** Eşleme anahtarı: `lead:<STATUS_ID>` veya `deal:<STAGE_ID>`. */
  key: string;
  entity: "lead" | "deal";
  statusId: string;
  name: string;
  sort: number;
  semantics: BitrixSemantics;
  group: string;
  suggested: XreStage;
}

export function stageKey(entity: "lead" | "deal", statusId: string): string {
  return `${entity}:${statusId}`;
}

export interface BitrixEntityCounter {
  total: number;
  imported: number;
  updated: number;
  failed: number;
}

export type BitrixJobStatus = "running" | "completed" | "failed" | "cancelled";

export interface BitrixImportJobView {
  id: string;
  status: BitrixJobStatus;
  startedAt: string;
  finishedAt: string | null;
  webhook: string;
  entities: Partial<Record<BitrixImportEntity, BitrixEntityCounter>>;
  errors: string[];
  log: string[];
}

export interface BitrixPreview {
  webhook: string;
  counts: Partial<Record<BitrixImportEntity, number | null>>;
  userCount: number | null;
  stages: BitrixDetectedStage[];
  stageMap: Record<string, XreStage>;
  warnings: string[];
}
