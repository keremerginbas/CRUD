// Satış aşamaları. Altı yerleşik aşama her hunide bulunur; "won" ve "lost" kapanış aşamalarıdır.
// Bunlara ek olarak huniye özel aşamalar eklenebilir (kimlikleri "s_" ile başlar).
export const BUILT_IN_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type BuiltInStage = (typeof BUILT_IN_STAGES)[number];
export const STAGE_ID_PATTERN = /^(?:new|contacted|qualified|proposal|won|lost|s_[a-z0-9]{4,24})$/;
export const MAX_PIPELINE_STAGES = 24;

export const isStageId = (value: unknown): value is string => typeof value === "string" && STAGE_ID_PATTERN.test(value);
export const isBuiltInStage = (value: unknown): value is BuiltInStage => (BUILT_IN_STAGES as readonly string[]).includes(String(value));
export const isClosedStage = (value: unknown) => value === "won" || value === "lost";

/** Yeni özel aşama kimliği. */
export function newStageId(random: () => number = Math.random): string {
  let out = "s_";
  for (let i = 0; i < 10; i++) out += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)];
  return out;
}

/** Aşama listesi kuralları: kimlikler geçerli ve tekil, altı yerleşik aşama eksiksiz, üst sınır aşılmamış. */
export function stageListProblem(stages: { id: string }[]): string | null {
  if (stages.length > MAX_PIPELINE_STAGES) return `Bir hunide en fazla ${MAX_PIPELINE_STAGES} aşama olabilir.`;
  const ids = stages.map((s) => s.id);
  if (ids.some((id) => !isStageId(id))) return "Aşama kimliği geçersiz.";
  if (new Set(ids).size !== ids.length) return "Aynı aşama iki kez eklenemez.";
  if (!BUILT_IN_STAGES.every((id) => ids.includes(id))) return "Yerleşik altı aşama (ilk aşama, kazanıldı, kaybedildi dahil) silinemez.";
  return null;
}
