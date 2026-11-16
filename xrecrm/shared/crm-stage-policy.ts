import { z } from "zod";
import { BUILT_IN_STAGES, STAGE_ID_PATTERN } from "./stages.js";
export const requiredCrmFields = [
  "phone",
  "email",
  "city",
  "source",
  "owner",
  "contactId",
  "companyId",
] as const;
export type RequiredCrmField = (typeof requiredCrmFields)[number];
export const requiredCrmFieldLabels: Record<RequiredCrmField, string> = {
  phone: "Telefon",
  email: "E-posta",
  city: "Şehir",
  source: "Kaynak",
  owner: "Sorumlu",
  contactId: "Bağlı kişi",
  companyId: "Bağlı şirket",
};
export const StagePolicySchema = z.record(
  z.string().regex(STAGE_ID_PATTERN),
  z
    .array(z.enum(requiredCrmFields))
    .max(7)
    .refine(
      (v) => new Set(v).size === v.length,
      "Zorunlu alan bir kez seçilebilir.",
    ),
);
export type StagePolicy = Partial<Record<string, RequiredCrmField[]>>;
export interface PipelineWithPolicy {
  id: string;
  name?: string;
  stages?: { id: string; label: string }[];
  requiredFieldsByStage?: StagePolicy;
}
export function missingStageFields(
  lead: Record<string, unknown>,
  pipelines: PipelineWithPolicy[],
): RequiredCrmField[] {
  const pipeline = pipelines.find((p) => p.id === (lead.pipelineId || "sales"));
  const fields =
    pipeline?.requiredFieldsByStage?.[
      String(lead.stage) as keyof StagePolicy
    ] || [];
  return fields.filter(
    (field) => typeof lead[field] !== "string" || !String(lead[field]).trim(),
  );
}
export function validateStagePolicy(
  lead: Record<string, unknown>,
  pipelines: PipelineWithPolicy[],
): void {
  // Aşama, müşterinin hunisinde tanımlı olmalı: özel aşama başka huniye ya da silinmiş aşamaya taşınamaz.
  const own = pipelines.find((p) => p.id === (lead.pipelineId || "sales"));
  const known = own?.stages?.length ? own.stages.map((s) => s.id) : [...BUILT_IN_STAGES];
  if (!known.includes(String(lead.stage)))
    throw Object.assign(new Error("Bu aşama müşterinin satış hunisinde yok."), { statusCode: 400 });
  const missing = missingStageFields(lead, pipelines);
  if (!missing.length) return;
  const p = pipelines.find((p) => p.id === (lead.pipelineId || "sales"));
  const stage =
    p?.stages?.find((s) => s.id === lead.stage)?.label || String(lead.stage);
  throw Object.assign(
    new Error(
      `“${stage}” aşaması için zorunlu alanları tamamlayın: ${missing.map((f) => requiredCrmFieldLabels[f]).join(", ")}. Müşteri kartından alanları doldurduktan sonra yeniden taşıyın.`,
    ),
    { statusCode: 422, missingFields: missing },
  );
}
