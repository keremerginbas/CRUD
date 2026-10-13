import { z } from "zod";
import type { PermissionMap } from "../shared/access.js";
import { AutomationPolicySchema } from "../shared/automation-policy.js";
import type { AutomationPolicy } from "../shared/automation-policy.js";

export const LeadStage = z.enum([
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
]);
export type LeadStage = z.infer<typeof LeadStage>;

export const LeadSchema = z
  .object({
    id: z.string().min(1).max(191),
    name: z.string().max(200),
    phone: z.string().max(80),
    email: z.string().max(320),
    company: z.string().max(200),
    stage: LeadStage,
    owner: z.string().max(191),
    value: z.number().finite(),
    source: z.string().max(120),
    notes: z.string().max(10000),
    createdAt: z.string().datetime({ offset: true }),
    lastActivity: z.string().datetime({ offset: true }),
    tags: z.array(z.string().max(80)).max(100),
    city: z.string().max(120).optional(),
    appointmentAt: z
      .string()
      .datetime({ offset: true })
      .or(z.literal(""))
      .optional(),
    pipelineId: z.string().max(191).optional(),
    stageTransitionToken: z.string().max(80).optional(),
    contactId: z.string().max(191).optional(),
    companyId: z.string().max(191).optional(),
    dealTitle: z.string().max(300).optional(),
    expectedCloseDate: z
      .string()
      .max(64)
      .refine(
        (value) => value === "" || !Number.isNaN(Date.parse(value)),
        "Geçerli kapanış tarihi gerekli.",
      )
      .optional(),
    probability: z.number().finite().min(0).max(100).optional(),
    customFields: z.record(z.string(), z.string().max(2000)).optional(),
    lostReason: z.string().max(10000).optional(),
    lostReasonDetail: z.string().max(10000).optional(),
  })
  .passthrough();
export type Lead = z.infer<typeof LeadSchema>;

export const RuleSchema = z
  .object({
    id: z.string().min(1).max(191),
    name: z.string().min(1).max(200),
    triggerStage: LeadStage,
    pipelineId: z.string().max(191).optional(),
    action: z.enum(["task", "whatsapp", "vapi", "webhook"]),
    enabled: z.boolean(),
    config: z
      .object({
        template: z.string().max(10000).optional(),
        url: z.string().max(2048).optional(),
        lineId: z.string().max(191).optional(),
        assistantId: z.string().max(191).optional(),
      })
      .passthrough(),
    policy: AutomationPolicySchema.optional(),
  })
  .passthrough();
export type Rule = z.infer<typeof RuleSchema> & { policy?: AutomationPolicy };

export interface UserIdentity {
  openId: string;
  name?: string;
  email?: string;
}

export interface AuthContext {
  user: UserIdentity;
  ownerOpenId: string;
  isOwner: boolean;
  employeeId?: string;
  permissions?: PermissionMap;
  displayName?: string;
}

export interface StoredRecord<T = unknown> {
  kind: string;
  id: string;
  payload: T;
  ownerOpenId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoredEvent {
  id: string;
  eventKey: string;
  ownerOpenId: string;
  status:
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "received"
    | "needs_review";
  attempts: number;
  nextAttemptAt?: string | null;
  lastError?: string | null;
  payload: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export type Provider =
  | "meta"
  | "evolution"
  | "vapi"
  | "netgsm"
  | "bitrix"
  | "webhook";
