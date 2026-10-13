import { z } from "zod";
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
export const StagePolicySchema = z.partialRecord(
  z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]),
  z
    .array(z.enum(requiredCrmFields))
    .max(7)
    .refine(
      (v) => new Set(v).size === v.length,
      "Zorunlu alan bir kez seçilebilir.",
    ),
);
export type StagePolicy = Partial<
  Record<
    "new" | "contacted" | "qualified" | "proposal" | "won" | "lost",
    RequiredCrmField[]
  >
>;
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
