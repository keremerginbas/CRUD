import { z } from "zod";

/** Fields intentionally exposed to policy matching. No arbitrary property access or code evaluation is used. */
export const AutomationConditionFieldSchema = z.enum([
  "city",
  "source",
  "owner",
  "value",
  "phone",
  "email",
  "tags",
]);
export type AutomationConditionField = z.infer<
  typeof AutomationConditionFieldSchema
>;

export const AutomationConditionOperatorSchema = z.enum([
  "eq",
  "neq",
  "contains",
  "gte",
  "lte",
  "isEmpty",
  "isNotEmpty",
]);
export type AutomationConditionOperator = z.infer<
  typeof AutomationConditionOperatorSchema
>;

const conditionValueSchema = z.union([
  z.string().max(320),
  z.number().finite(),
  z.boolean(),
]);

/**
 * A condition is strict so a typo cannot silently become executable policy.
 * Empty/not-empty operators may omit value; the UI sends an empty string for
 * them, which is also accepted for a simple round trip.
 */
export const AutomationConditionSchema = z
  .object({
    field: AutomationConditionFieldSchema,
    op: AutomationConditionOperatorSchema,
    value: conditionValueSchema.optional(),
  })
  .strict()
  .superRefine((condition, ctx) => {
    const emptyOperator =
      condition.op === "isEmpty" || condition.op === "isNotEmpty";
    const textField = [
      "city",
      "source",
      "owner",
      "phone",
      "email",
      "tags",
    ].includes(condition.field);

    if (emptyOperator) {
      if (condition.value !== undefined && condition.value !== "")
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Boş/dolu koşulunda value boş bırakılmalıdır.",
        });
      return;
    }

    if (condition.field === "value") {
      if (
        !["eq", "neq", "gte", "lte", "isEmpty", "isNotEmpty"].includes(
          condition.op,
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["op"],
          message: "value alanı contains karşılaştırmasını desteklemez.",
        });
      if (typeof condition.value !== "number")
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "value koşulları sonlu bir sayı bekler.",
        });
      return;
    }

    if (
      !["eq", "neq", "contains", "isEmpty", "isNotEmpty"].includes(condition.op)
    )
      ctx.addIssue({
        code: "custom",
        path: ["op"],
        message: `${condition.field} koşulu bu karşılaştırmayı desteklemez.`,
      });
    if (typeof condition.value !== "string" || !textField)
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Metin ve etiket koşulları metin değer bekler.",
      });
  });
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;

export const AutomationPolicySchema = z
  .object({
    mode: z.enum(["all", "any"]),
    conditions: z.array(AutomationConditionSchema).max(50),
    delayMinutes: z
      .number()
      .int()
      .min(0)
      .max(10080)
      .refine((value) => value === 0 || value >= 10, {
        message: "Gecikme 0 veya en az 10 dakika olmalıdır.",
      }),
    businessHours: z.boolean(),
  })
  .strict();
export type AutomationPolicy = z.infer<typeof AutomationPolicySchema>;

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  mode: "all",
  conditions: [],
  delayMinutes: 0,
  businessHours: false,
};

/** Legacy rules have no policy and therefore run immediately without filtering. */
export function normalizeAutomationPolicy(
  policy: AutomationPolicy | null | undefined,
): AutomationPolicy {
  if (policy === undefined || policy === null)
    return { ...DEFAULT_AUTOMATION_POLICY, conditions: [] };
  return AutomationPolicySchema.parse(policy);
}

export interface AutomationPolicyLead {
  city?: string;
  source?: string;
  owner?: string;
  value?: number;
  phone?: string;
  email?: string;
  tags?: string[];
}

export interface AutomationPolicyRule {
  policy?: AutomationPolicy | null;
}

export interface AutomationConditionResult {
  field: AutomationConditionField;
  op: AutomationConditionOperator;
  value?: string | number | boolean;
  actual: string | number | string[] | undefined;
  matched: boolean;
}

export interface AutomationPolicyEvaluation {
  eligible: boolean;
  reason: string;
  /** The scheduled execution time, or null when conditions do not match. */
  runAt: string | null;
  conditionResults: AutomationConditionResult[];
}

function comparableText(value: unknown): string {
  // Normalize dotted/ASCII I before Turkish casing so values such as "VIP"
  // match "vip" while names such as "Kadıköy" retain their dotless ı.
  return String(value ?? "")
    .trim()
    .replace(/[İI]/g, "i")
    .toLocaleLowerCase("tr-TR");
}

function isBlank(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function fieldValue(
  lead: AutomationPolicyLead,
  field: AutomationConditionField,
): string | number | string[] | undefined {
  // Explicit field mapping is deliberate: policy cannot read arbitrary lead keys.
  switch (field) {
    case "city":
      return lead.city;
    case "source":
      return lead.source;
    case "owner":
      return lead.owner;
    case "value":
      return lead.value;
    case "phone":
      return lead.phone;
    case "email":
      return lead.email;
    case "tags":
      return lead.tags;
  }
}

function matches(
  actual: string | number | string[] | undefined,
  op: AutomationConditionOperator,
  expected: string | number | boolean | undefined,
): boolean {
  if (op === "isEmpty") return isBlank(actual);
  if (op === "isNotEmpty") return !isBlank(actual);
  if (Array.isArray(actual)) {
    const target = comparableText(expected);
    if (op === "contains")
      return actual.some((item) => comparableText(item).includes(target));
    if (op === "eq")
      return actual.some((item) => comparableText(item) === target);
    if (op === "neq")
      return actual.every((item) => comparableText(item) !== target);
    return false;
  }
  if (typeof actual === "number") {
    if (typeof expected !== "number" || !Number.isFinite(expected))
      return false;
    if (op === "eq") return actual === expected;
    if (op === "neq") return actual !== expected;
    if (op === "gte") return actual >= expected;
    if (op === "lte") return actual <= expected;
    return false;
  }
  const left = comparableText(actual);
  const right = comparableText(expected);
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  if (op === "contains") return left.includes(right);
  return false;
}

function formatActual(value: unknown): string | number | string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "number" || typeof value === "string") return value;
  return undefined;
}

/**
 * Turkey's civil time has a fixed UTC+03 offset. Keeping the offset explicit
 * avoids guessing the host's timezone or applying an environment-dependent DST rule.
 */
const TURKEY_OFFSET_MINUTES = 180;
const BUSINESS_START_MINUTES = 9 * 60;
const BUSINESS_END_MINUTES = 18 * 60;

function turkeyParts(timestamp: number): {
  weekday: number;
  minutes: number;
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(timestamp + TURKEY_OFFSET_MINUTES * 60_000);
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function nextTurkeyBusinessSlot(timestamp: number): number {
  let candidate = timestamp;
  for (let guard = 0; guard < 370; guard += 1) {
    const parts = turkeyParts(candidate);
    const weekday = parts.weekday >= 1 && parts.weekday <= 5;
    if (
      weekday &&
      parts.minutes >= BUSINESS_START_MINUTES &&
      parts.minutes < BUSINESS_END_MINUTES
    )
      return candidate;

    const localDate = new Date(Date.UTC(parts.year, parts.month, parts.day));
    if (!weekday || parts.minutes >= BUSINESS_END_MINUTES) {
      localDate.setUTCDate(localDate.getUTCDate() + 1);
    }
    // For an early weekday, stay on the same local date; for a weekend/end of
    // day, advance until a weekday is reached.
    while (localDate.getUTCDay() === 0 || localDate.getUTCDay() === 6)
      localDate.setUTCDate(localDate.getUTCDate() + 1);
    const nextLocal = Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      9,
      0,
      0,
      0,
    );
    candidate = nextLocal - TURKEY_OFFSET_MINUTES * 60_000;
  }
  throw new Error("İş saati planı hesaplanamadı.");
}

function parseTimestamp(now: Date | string | number): number {
  if (typeof now === "string" && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(now.trim()))
    throw new Error("Tarih metni açık timezone offseti taşımalıdır.");
  const timestamp =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : Date.parse(now);
  if (!Number.isFinite(timestamp))
    throw new Error("Geçerli bir geçiş zamanı gerekli.");
  return timestamp;
}

/**
 * Pure, deterministic policy evaluation. `now` represents the stage transition
 * timestamp; delay is always measured from that timestamp, not from evaluation time.
 */
export function evaluateAutomationPolicy(
  rule: AutomationPolicyRule,
  lead: AutomationPolicyLead,
  now: Date | string | number,
): AutomationPolicyEvaluation {
  const policy = normalizeAutomationPolicy(rule.policy);
  const conditionResults = policy.conditions.map((condition) => {
    const actual = fieldValue(lead, condition.field);
    return {
      field: condition.field,
      op: condition.op,
      ...(condition.value === undefined ? {} : { value: condition.value }),
      actual: formatActual(actual),
      matched: matches(actual, condition.op, condition.value),
    };
  });
  const eligible =
    conditionResults.length === 0 ||
    (policy.mode === "all"
      ? conditionResults.every((result) => result.matched)
      : conditionResults.some((result) => result.matched));
  const reason = !eligible
    ? policy.mode === "all"
      ? "Tüm koşullar sağlanmadı."
      : "Hiçbir koşul sağlanmadı."
    : conditionResults.length === 0
      ? "Koşul yok; zamanlama uygulanır."
      : "Koşullar sağlandı.";
  if (!eligible) return { eligible, reason, runAt: null, conditionResults };

  const transitionAt = parseTimestamp(now);
  let runAt = transitionAt + policy.delayMinutes * 60_000;
  if (policy.businessHours) runAt = nextTurkeyBusinessSlot(runAt);
  return {
    eligible,
    reason,
    runAt: new Date(runAt).toISOString(),
    conditionResults,
  };
}

/** Explicit name for callers that want the scheduling primitive in tests/docs. */
export function nextTurkeyBusinessHoursSlot(
  now: Date | string | number,
): string {
  return new Date(nextTurkeyBusinessSlot(parseTimestamp(now))).toISOString();
}
