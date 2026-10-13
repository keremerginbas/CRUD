import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  evaluateAutomationPolicy,
  type AutomationConditionResult,
  type AutomationPolicyEvaluation,
} from "../shared/automation-policy.js";
import { canAccess } from "./access.js";
import type { Store } from "./db.js";
import {
  LeadSchema,
  RuleSchema,
  type AuthContext,
  type Lead,
  type Rule,
} from "./types.js";

export interface AutomationPlan extends AutomationPolicyEvaluation {
  ruleId: string;
  leadId: string;
  transitionAt: string;
  active: boolean;
  /** Policy eligibility before the enabled flag is applied. */
  policyEligible: boolean;
  triggerStage?: Rule["triggerStage"];
  pipelineId?: string;
}

export interface WorkerAutomationPlan extends AutomationPlan {
  /** True only when current execution time has reached the original runAt. */
  ready: boolean;
  /** A false value means the worker must skip without invoking a provider. */
  shouldExecute: boolean;
}

export type AutomationPlanRule = Pick<Rule, "id"> &
  Partial<Pick<Rule, "policy" | "enabled" | "triggerStage" | "pipelineId">>;

function timestampValue(value: Date | string | number): number {
  const parsed =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new Error("Geçerli bir otomasyon geçiş zamanı gerekli.");
  return parsed;
}

function timestampString(value: Date | string | number): string {
  return new Date(timestampValue(value)).toISOString();
}

/** Plan a rule without reading or writing any storage and without contacting a provider. */
export function planAutomationRule(
  rule: AutomationPlanRule,
  lead: Pick<
    Lead,
    "id" | "city" | "source" | "owner" | "value" | "phone" | "email" | "tags"
  >,
  transitionAt: Date | string | number,
): AutomationPlan {
  const at = timestampString(transitionAt);
  const evaluation = evaluateAutomationPolicy(rule, lead, at);
  const active = rule.enabled !== false;
  return {
    ruleId: rule.id,
    leadId: lead.id,
    transitionAt: at,
    active,
    policyEligible: evaluation.eligible,
    eligible: evaluation.eligible && active,
    reason: !active ? "Kural pasif; çalışmayacak." : evaluation.reason,
    runAt: evaluation.eligible && active ? evaluation.runAt : null,
    conditionResults: evaluation.conditionResults,
    ...(rule.triggerStage === undefined
      ? {}
      : { triggerStage: rule.triggerStage }),
    ...(rule.pipelineId === undefined ? {} : { pipelineId: rule.pipelineId }),
  };
}

/**
 * Re-evaluate a claimed event using the current rule and current lead, while
 * retaining the original transition timestamp. This prevents a delayed rule
 * from being rescheduled from the worker's current time.
 */
export function recheckAutomationPolicyForWorker(
  rule: AutomationPlanRule,
  lead: Pick<
    Lead,
    "id" | "city" | "source" | "owner" | "value" | "phone" | "email" | "tags"
  >,
  transitionAt: Date | string | number,
  currentAt: Date | string | number = new Date(),
): WorkerAutomationPlan {
  const plan = planAutomationRule(rule, lead, transitionAt);
  const current = timestampValue(currentAt);
  const ready = Boolean(plan.runAt && Date.parse(plan.runAt) <= current);
  return {
    ...plan,
    ready,
    shouldExecute: plan.eligible && ready,
  };
}

/** Alias kept short for trigger/worker callers. */
export const evaluateAutomationEventForWorker =
  recheckAutomationPolicyForWorker;

/**
 * Return only the fields safe for a dry-run response/event payload. In
 * particular, never return the complete Rule, Lead, config, credentials, or
 * arbitrary record fields.
 */
export function publicAutomationPlan(
  plan: AutomationPlan | WorkerAutomationPlan,
) {
  return {
    ruleId: plan.ruleId,
    leadId: plan.leadId,
    transitionAt: plan.transitionAt,
    active: plan.active,
    policyEligible: plan.policyEligible,
    ...(plan.triggerStage === undefined
      ? {}
      : { triggerStage: plan.triggerStage }),
    ...(plan.pipelineId === undefined ? {} : { pipelineId: plan.pipelineId }),
    eligible: plan.eligible,
    reason: plan.reason,
    runAt: plan.runAt,
    conditionResults: plan.conditionResults.map(
      (result: AutomationConditionResult) => ({
        field: result.field,
        op: result.op,
        ...(result.value === undefined ? {} : { value: result.value }),
        actual: result.actual,
        matched: result.matched,
      }),
    ),
    ...("ready" in plan
      ? { ready: plan.ready, shouldExecute: plan.shouldExecute }
      : {}),
  };
}

const dryRunSchema = z
  .object({
    rule: z.unknown().optional(),
    ruleId: z.string().min(1).max(191).optional(),
    leadId: z.string().min(1).max(191),
    now: z
      .union([z.string().datetime({ offset: true }), z.number().finite()])
      .optional(),
  })
  .strict()
  .refine((body) => body.rule !== undefined || body.ruleId !== undefined, {
    path: ["rule"],
    message: "rule veya ruleId gerekli.",
  })
  .refine((body) => !(body.rule !== undefined && body.ruleId !== undefined), {
    path: ["rule"],
    message: "rule ve ruleId aynı anda gönderilemez.",
  });

type RequestWithAuth = Request & { auth?: AuthContext };

function sendRouteError(res: Response, error: unknown): void {
  const status =
    error instanceof z.ZodError
      ? 400
      : Number((error as any)?.statusCode) || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error:
      status === 400
        ? "INVALID_REQUEST"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : "SERVER_ERROR",
    message:
      error instanceof Error ? error.message : "Beklenmeyen sunucu hatası.",
  });
}

/**
 * Register POST /api/automations/dry-run. The route is intentionally read-only:
 * it only obtains a scoped rule/lead and evaluates pure policy code.
 * Mount after authentication and the module-permission middleware.
 */
export function registerAutomationPlanningRoutes(
  app: Express,
  store: Store,
): void {
  app.post("/api/automations/dry-run", async (req, res) => {
    try {
      const auth = (req as RequestWithAuth).auth;
      if (!auth)
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Geçerli Manus oturumu gerekli.",
        });
      if (!canAccess(auth, "automations", "read"))
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Otomasyon modülünde okuma yetkiniz yok.",
        });
      const body = dryRunSchema.parse(req.body || {});
      const leadRecord = await store.get<Lead>(
        "lead",
        body.leadId,
        auth.ownerOpenId,
      );
      // A scoped store returns null for an out-of-scope lead; exposing 404 avoids
      // leaking whether another employee's lead exists.
      if (!leadRecord)
        return res.status(404).json({
          error: "NOT_FOUND",
          message: "Müşteri bulunamadı.",
        });
      const lead = LeadSchema.parse(leadRecord.payload);
      let rule: Rule;
      if (body.ruleId !== undefined) {
        const ruleRecord = await store.get<Rule>(
          "rule",
          body.ruleId,
          auth.ownerOpenId,
        );
        if (!ruleRecord)
          return res.status(404).json({
            error: "NOT_FOUND",
            message: "Kural bulunamadı.",
          });
        rule = RuleSchema.parse(ruleRecord.payload);
      } else {
        if (
          !body.rule ||
          typeof body.rule !== "object" ||
          Array.isArray(body.rule)
        )
          return res.status(400).json({
            error: "INVALID_REQUEST",
            message: "Geçerli bir kural taslağı gerekli.",
          });
        // Drafts may omit an id because dry-run never persists them.
        rule = RuleSchema.parse({
          ...(body.rule as Record<string, unknown>),
          id: String((body.rule as Record<string, unknown>).id || "dry-run"),
        });
      }
      const plan = planAutomationRule(rule, lead, body.now ?? new Date());
      return res.json({ ...publicAutomationPlan(plan), dryRun: true });
    } catch (error) {
      sendRouteError(res, error);
    }
  });
}
