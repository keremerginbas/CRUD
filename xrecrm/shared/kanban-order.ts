// Kanban sütunlarında kart sırası: elle (sürükleyip bırakılan yer), tarihe, tutara veya ada göre.
// Elle sıra müşterinin `rank` alanında tutulur (küçük olan üstte). Hiç taşınmamış müşteride
// rank, oluşturulma tarihinden türetilir: en yeni müşteri en üstte görünür.

export type KanbanSort = "manual" | "date" | "value" | "name";
export const KANBAN_SORTS: [KanbanSort, string][] = [
  ["manual", "Elle (bıraktığım yerde)"],
  ["date", "Tarih (yeni → eski)"],
  ["value", "Tutar (yüksek → düşük)"],
  ["name", "Ad soyad (A → Z)"],
];

interface Sortable {
  id: string;
  name: string;
  value: number;
  createdAt: string;
  lastActivity?: string;
  rank?: number;
}

const time = (iso: string | undefined) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : 0;
};

export const effectiveRank = (lead: Sortable) => (typeof lead.rank === "number" && Number.isFinite(lead.rank) ? lead.rank : -time(lead.createdAt));

export function sortLeads<T extends Sortable>(list: T[], mode: KanbanSort): T[] {
  const byId = (a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const copy = [...list];
  if (mode === "date") return copy.sort((a, b) => time(b.lastActivity || b.createdAt) - time(a.lastActivity || a.createdAt) || byId(a, b));
  if (mode === "value") return copy.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "tr") || byId(a, b));
  if (mode === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "tr", { sensitivity: "base" }) || byId(a, b));
  return copy.sort((a, b) => effectiveRank(a) - effectiveRank(b) || byId(a, b));
}

/**
 * Kartın bırakıldığı yerin sırası. `column`: hedef sütunun elle sıralanmış kartları (taşınan kart hariç).
 * `beforeId`: önüne bırakılan kart; yoksa sütunun sonuna eklenir.
 */
export function rankForDrop<T extends Sortable>(column: T[], beforeId: string | null): number {
  const STEP = 1000;
  if (!column.length) return 0;
  const index = beforeId ? column.findIndex((l) => l.id === beforeId) : -1;
  if (index < 0) return effectiveRank(column[column.length - 1]) + STEP;
  const next = effectiveRank(column[index]);
  if (index === 0) return next - STEP;
  const prev = effectiveRank(column[index - 1]);
  // Aynı sıradaki iki kartın arasına: öncekinin hemen sonrası.
  return prev === next ? prev : (prev + next) / 2;
}
