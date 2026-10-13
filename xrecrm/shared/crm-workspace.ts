import { z } from "zod";

export const CRM_WORKSPACE_FILTER_DEFAULTS = {
  query: "",
  owner: "all",
  source: "all",
  activity: "all",
  pipeline: "sales",
  stage: "all",
  city: "",
  createdFrom: "",
  createdTo: "",
  minValue: "",
  maxValue: "",
  contact: "any",
  company: "any",
} as const;

export type CrmLinkFilter = "any" | "yes" | "no";
export type CrmCardProfile = "compact" | "standard" | "detailed";
export type CrmListColumn =
  | "name"
  | "stage"
  | "value"
  | "next"
  | "owner"
  | "source"
  | "communication";

/** The complete, serializable filter state shared by CRM views and the page. */
export interface CrmWorkspaceFilters {
  query: string;
  owner: string;
  source: string;
  activity: string;
  pipeline: string;
  stage: string;
  city: string;
  createdFrom: string;
  createdTo: string;
  minValue: string;
  maxValue: string;
  contact: CrmLinkFilter;
  company: CrmLinkFilter;
}

/** Alias used by consumers that call a saved CRM view a view state. */
export type CrmViewState = CrmWorkspaceFilters;

export interface CrmWorkspaceAppearance {
  cardProfile: CrmCardProfile;
  listColumns: CrmListColumn[];
}

export interface CrmWorkspaceState {
  filters: CrmWorkspaceFilters;
  appearance: CrmWorkspaceAppearance;
}

export interface SavedCrmView {
  id: string;
  name: string;
  filters: CrmWorkspaceFilters;
  createdAt: string;
}

export interface CrmWorkspacePreferences extends CrmWorkspaceAppearance {
  views: SavedCrmView[];
}

export const CRM_WORKSPACE_LIST_COLUMNS: readonly CrmListColumn[] = [
  "name",
  "stage",
  "value",
  "next",
  "owner",
  "source",
  "communication",
] as const;

export const CRM_WORKSPACE_OPTIONAL_COLUMNS: readonly Exclude<
  CrmListColumn,
  "name" | "communication"
>[] = ["stage", "value", "next", "owner", "source"] as const;

export const CRM_WORKSPACE_DEFAULT_APPEARANCE: CrmWorkspaceAppearance = {
  cardProfile: "standard",
  listColumns: [
    "name",
    "stage",
    "value",
    "next",
    "owner",
    "source",
    "communication",
  ],
};

export const CRM_WORKSPACE_DEFAULT_PREFERENCES: CrmWorkspacePreferences = {
  views: [],
  ...CRM_WORKSPACE_DEFAULT_APPEARANCE,
};

export const CRM_WORKSPACE_PREFERENCE_KIND =
  "crm_workspace_preferences" as const;
export const CRM_WORKSPACE_MAX_VIEWS = 20;

const dateValue = z
  .preprocess(
    (value) => (value == null ? "" : value),
    z
      .string()
      .trim()
      .max(64)
      .refine(
        (value) => value === "" || Number.isFinite(Date.parse(value)),
        "Geçerli bir tarih gerekli.",
      ),
  )
  .default("");

const timestampValue = z.preprocess(
  (value) => (value == null ? new Date().toISOString() : value),
  z
    .string()
    .trim()
    .max(64)
    .refine(
      (value) => Number.isFinite(Date.parse(value)),
      "Geçerli tarih gerekli.",
    ),
);

const amountValue = z
  .preprocess(
    (value) => {
      if (value == null) return "";
      if (typeof value === "number")
        return Number.isFinite(value) ? String(value) : "__invalid__";
      return value;
    },
    z
      .string()
      .trim()
      .max(40)
      .refine(
        (value) =>
          value === "" ||
          (Number.isFinite(Number(value)) && Number(value) >= 0),
        "Geçerli, negatif olmayan bir tutar gerekli.",
      ),
  )
  .default("");

const linkFilter = z.enum(["any", "yes", "no"]).default("any");

/** Strict schema for the complete filter contract. */
export const crmWorkspaceFiltersSchema = z
  .object({
    query: z.string().trim().max(200).default(""),
    owner: z.string().trim().max(191).default("all"),
    source: z.string().trim().max(120).default("all"),
    activity: z.string().trim().max(80).default("all"),
    pipeline: z.string().trim().max(191).default("sales"),
    stage: z.string().trim().max(80).default("all"),
    city: z.string().trim().max(120).default(""),
    createdFrom: dateValue,
    createdTo: dateValue,
    minValue: amountValue,
    maxValue: amountValue,
    contact: linkFilter,
    company: linkFilter,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.createdFrom &&
      value.createdTo &&
      Date.parse(value.createdFrom) > Date.parse(value.createdTo)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["createdTo"],
        message: "Bitiş tarihi başlangıçtan önce olamaz.",
      });
    }
    if (
      value.minValue &&
      value.maxValue &&
      Number(value.minValue) > Number(value.maxValue)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["maxValue"],
        message: "Üst tutar alt tutardan küçük olamaz.",
      });
    }
  });

const listColumnSchema = z.enum([
  "name",
  "stage",
  "value",
  "next",
  "owner",
  "source",
  "communication",
]);

function normalizeListColumns(
  value: readonly CrmListColumn[],
): CrmListColumn[] {
  const unique = [...new Set(value)];
  return [
    "name",
    ...unique.filter(
      (column) => column !== "name" && column !== "communication",
    ),
    "communication",
  ];
}

export const crmWorkspaceAppearanceSchema = z
  .object({
    cardProfile: z
      .enum(["compact", "standard", "detailed"])
      .default("standard"),
    listColumns: z
      .array(listColumnSchema)
      .max(CRM_WORKSPACE_LIST_COLUMNS.length)
      .default([...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns])
      .transform((columns) => normalizeListColumns(columns)),
  })
  .strict();

const savedCrmViewSchema = z
  .object({
    id: z.string().trim().min(1).max(191),
    name: z.string().trim().min(1).max(80),
    filters: z.preprocess(
      (value) => canonicalFilterInput(value),
      crmWorkspaceFiltersSchema,
    ),
    createdAt: timestampValue,
  })
  .strict();

export const crmWorkspacePreferencesSchema = z
  .object({
    views: z.array(savedCrmViewSchema).max(CRM_WORKSPACE_MAX_VIEWS).default([]),
    cardProfile: z
      .enum(["compact", "standard", "detailed"])
      .default("standard"),
    listColumns: z
      .array(listColumnSchema)
      .max(CRM_WORKSPACE_LIST_COLUMNS.length)
      .default([...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns])
      .transform((columns) => normalizeListColumns(columns)),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Accept names used by the earlier CRM filter draft, but store only the
 * canonical contract. Unknown keys otherwise remain rejected by the strict
 * zod object.
 */
function canonicalFilterInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = { ...value };
  const aliases: Record<string, string> = {
    createdAfter: "createdFrom",
    createdBefore: "createdTo",
    amountMin: "minValue",
    amountMax: "maxValue",
    linkedContact: "contact",
    linkedCompany: "company",
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(canonical in copy) && alias in copy) copy[canonical] = copy[alias];
    delete copy[alias];
  }
  return copy;
}

/** Parse a filter state and fill only documented defaults. Throws on unknown keys. */
export function parseCrmWorkspaceFilters(value: unknown): CrmWorkspaceFilters {
  return crmWorkspaceFiltersSchema.parse(
    canonicalFilterInput(value),
  ) as CrmWorkspaceFilters;
}

export function safeCrmWorkspaceFilters(value: unknown): CrmWorkspaceFilters {
  const parsed = crmWorkspaceFiltersSchema.safeParse(
    canonicalFilterInput(value),
  );
  return parsed.success
    ? (parsed.data as CrmWorkspaceFilters)
    : { ...CRM_WORKSPACE_FILTER_DEFAULTS };
}

/** Parse persisted settings; the strict schema prevents arbitrary client metadata. */
export function parseCrmWorkspacePreferences(
  value: unknown,
): CrmWorkspacePreferences {
  return crmWorkspacePreferencesSchema.parse(value) as CrmWorkspacePreferences;
}

export function safeCrmWorkspacePreferences(
  value: unknown,
): CrmWorkspacePreferences {
  const parsed = crmWorkspacePreferencesSchema.safeParse(value);
  return parsed.success
    ? (parsed.data as CrmWorkspacePreferences)
    : {
        views: [],
        ...CRM_WORKSPACE_DEFAULT_APPEARANCE,
        listColumns: [...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns],
      };
}

export const CrmWorkspaceFiltersSchema = crmWorkspaceFiltersSchema;
export const CrmWorkspacePreferencesSchema = crmWorkspacePreferencesSchema;
export const parseCrmViewState = parseCrmWorkspaceFilters;

function text(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("tr-TR")
    : "";
}

function nonEmpty(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string")
    return (
      value.trim() !== "" &&
      !["none", "null", "undefined"].includes(text(value))
    );
  if (isRecord(value))
    return nonEmpty(value.id ?? value.openId ?? value.value ?? value.name);
  return false;
}

function linked(record: unknown, kind: "contact" | "company"): boolean {
  if (!isRecord(record)) return false;
  const idKeys =
    kind === "contact"
      ? ["contactId", "contact_id"]
      : ["companyId", "company_id"];
  if (idKeys.some((key) => key in record && nonEmpty(record[key]))) return true;
  const explicit =
    record[kind === "contact" ? "linkedContact" : "linkedCompany"];
  return isRecord(explicit) && nonEmpty(explicit);
}

function recordDate(record: Record<string, unknown>): string {
  const value = record.createdAt ?? record.created_at ?? record.created;
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function dateBoundary(value: string, end: boolean): number | undefined {
  if (!value) return undefined;
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = Date.parse(
    isoDateOnly
      ? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}+03:00`
      : value,
  );
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nextActivityDate(record: Record<string, unknown>): number | undefined {
  const candidates: unknown[] = [
    record.nextActivityAt,
    record.nextActivityDate,
    record.nextActivity,
    record.next,
    record.nextRecord,
  ];
  for (const candidate of candidates) {
    const value = isRecord(candidate)
      ? (candidate.date ?? candidate.startAt ?? candidate.dueAt ?? candidate.at)
      : candidate;
    if (typeof value === "string" || typeof value === "number") {
      const parsed = Date.parse(String(value));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function activityMatches(
  record: Record<string, unknown>,
  filter: string,
  now: number,
): boolean {
  if (!filter || filter === "all") return true;
  const date = nextActivityDate(record);
  const hasActivity =
    typeof record.hasActivity === "boolean"
      ? record.hasActivity
      : Array.isArray(record.activities)
        ? record.activities.length > 0
        : date !== undefined || nonEmpty(record.nextActivity);
  if (filter === "none") return !hasActivity;
  if (filter === "overdue")
    return Boolean(record.activityOverdue) || Boolean(date && date < now);
  if (["planned", "upcoming"].includes(filter))
    return hasActivity && Boolean(date && date >= now);
  return text(record.activity) === text(filter);
}

/** Pure predicate used by the CRM page and by tests; it never reads storage. */
export function matchesCrmWorkspaceFilters(
  record: unknown,
  input: CrmWorkspaceFilters | Partial<CrmWorkspaceFilters>,
  options: { now?: Date } = {},
): boolean {
  if (!isRecord(record)) return false;
  const filters = safeCrmWorkspaceFilters(input);
  const lowered = [
    record.name,
    record.dealTitle,
    record.company,
    record.phone,
    record.email,
    record.city,
    record.notes,
    record.source,
    record.owner,
    record.stage,
  ]
    .map(text)
    .join(" ");
  if (filters.query && !lowered.includes(text(filters.query))) return false;
  const equalsFilter = (filter: string, value: unknown) =>
    !filter || filter === "all" || text(filter) === text(value);
  if (!equalsFilter(filters.owner, record.owner)) return false;
  if (!equalsFilter(filters.source, record.source)) return false;
  if (
    !equalsFilter(
      filters.pipeline,
      record.pipelineId ?? record.pipeline ?? "sales",
    )
  )
    return false;
  if (!equalsFilter(filters.stage, record.stage)) return false;
  if (filters.city && !text(record.city).includes(text(filters.city)))
    return false;
  if (
    !activityMatches(
      record,
      filters.activity,
      options.now?.getTime() ?? Date.now(),
    )
  )
    return false;
  const created = Date.parse(recordDate(record));
  if (filters.createdFrom) {
    const from = dateBoundary(filters.createdFrom, false);
    if (!Number.isFinite(created) || from === undefined || created < from)
      return false;
  }
  if (filters.createdTo) {
    const to = dateBoundary(filters.createdTo, true);
    if (!Number.isFinite(created) || to === undefined || created > to)
      return false;
  }
  const amount = Number(record.value ?? record.amount ?? 0);
  if (
    filters.minValue &&
    (!Number.isFinite(amount) || amount < Number(filters.minValue))
  )
    return false;
  if (
    filters.maxValue &&
    (!Number.isFinite(amount) || amount > Number(filters.maxValue))
  )
    return false;
  const contactLinked = linked(record, "contact");
  const companyLinked = linked(record, "company");
  if (filters.contact === "yes" && !contactLinked) return false;
  if (filters.contact === "no" && contactLinked) return false;
  if (filters.company === "yes" && !companyLinked) return false;
  if (filters.company === "no" && companyLinked) return false;
  return true;
}

/** Filter a source array after an optional authorization predicate has run. */
export function filterCrmWorkspaceRecords<T>(
  records: readonly T[],
  filters: CrmWorkspaceFilters | Partial<CrmWorkspaceFilters>,
  isAuthorized?: (record: T) => boolean,
  options?: { now?: Date },
): T[] {
  return records.filter(
    (record) =>
      (isAuthorized ? isAuthorized(record) : true) &&
      matchesCrmWorkspaceFilters(record, filters, options),
  );
}

export const matchesCrmViewFilters = matchesCrmWorkspaceFilters;
