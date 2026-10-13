import crypto from "node:crypto";
import { z } from "zod";
import type { Express, Request, Response } from "express";
import type { Store } from "./db.js";
import { canAccess, rawStoreOf } from "./access.js";
import type { AuthContext, StoredRecord } from "./types.js";
import { ContactSchema, CompanySchema } from "./suite.js";
import { LeadSchema, type Lead } from "./types.js";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  canonicalImportRow,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  previewImportRows,
  validateImportRow,
  type CrmImportKind,
  type ImportIssue,
  type ImportRawRow,
  type ImportPreviewRow,
} from "../shared/crm-import.js";

type StoreKind = "contacts" | "companies" | "lead";
type AuthedRequest = Request & { auth?: AuthContext };
const allowedFields = new Set([
  "name",
  "phone",
  "email",
  "companyId",
  "companyName",
  "contactId",
  "city",
  "source",
  "notes",
]);
const kinds = z.enum(["contacts", "companies", "leads"]);
const previewEnvelope = z
  .object({
    kind: kinds,
    rows: z.array(z.record(z.string(), z.unknown())).max(IMPORT_MAX_ROWS),
  })
  .strict();
const commitEnvelope = previewEnvelope
  .extend({ operationId: z.string().uuid() })
  .strict();
const localLocks = new Map<string, Promise<void>>();

function statusError(
  statusCode: number,
  message: string,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
function authOf(req: Request): AuthContext {
  const auth = (req as AuthedRequest).auth;
  if (!auth) throw statusError(401, "Oturum gerekli.");
  return auth;
}
function ownerOf(req: Request): string {
  return authOf(req).ownerOpenId;
}
function storeKind(kind: CrmImportKind): StoreKind {
  return kind === "leads" ? "lead" : kind;
}
function now(): string {
  return new Date().toISOString();
}
function byteLength(value: string): number {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(value).length
    : Buffer.byteLength(value, "utf8");
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function requestHash(body: unknown): string {
  return crypto.createHash("sha256").update(stableJson(body)).digest("hex");
}
function operationKey(
  owner: string,
  actor: string,
  operationId: string,
): string {
  return `op_${crypto
    .createHash("sha256")
    .update(`${owner}\0${actor}\0${operationId}`)
    .digest("hex")}`;
}
function importId(kind: CrmImportKind, raw: ImportRawRow): string {
  return `import_${kind}_${crypto
    .createHash("sha256")
    .update(canonicalImportRow(kind, raw))
    .digest("hex")}`;
}
function issue(code: string, message: string): ImportIssue {
  return { code, message };
}
function errorResponse(res: Response, error: unknown): void {
  const status = Math.max(
    400,
    Math.min(599, Number((error as any)?.statusCode) || 500),
  );
  const message =
    status >= 500
      ? "İçe aktarma şu anda tamamlanamadı; lütfen tekrar deneyin."
      : error instanceof Error
        ? error.message
        : "Geçersiz içe aktarma isteği.";
  res.status(status).json({
    error:
      status === 400
        ? "INVALID_REQUEST"
        : status === 409
          ? "CONFLICT"
          : "SERVER_ERROR",
    message,
  });
}
function cleanRows(
  rows: Array<Record<string, unknown>>,
): Array<{ raw: ImportRawRow; issues: ImportIssue[] }> {
  return rows.map((input) => {
    const raw: ImportRawRow = {};
    const issues: ImportIssue[] = [];
    if (Object.keys(input).length > 32)
      issues.push(
        issue("TOO_MANY_COLUMNS", "Satır 32 sütundan fazla içeriyor."),
      );
    for (const [key, value] of Object.entries(input)) {
      if (!allowedFields.has(key)) {
        issues.push(issue("UNKNOWN_FIELD", `Desteklenmeyen alan: ${key}.`));
        continue;
      }
      if (typeof value !== "string") {
        issues.push(issue("INVALID_VALUE", `${key} alanı metin olmalı.`));
        continue;
      }
      if (value.length > 10_000)
        issues.push(issue("FIELD_TOO_LARGE", `${key} alanı çok uzun.`));
      raw[key] = value.trim();
    }
    return { raw, issues };
  });
}
function visiblePayloads<T>(records: StoredRecord<T>[]): T[] {
  return records.map((record) => record.payload);
}
function visibleState(
  contacts: StoredRecord[],
  companies: StoredRecord[],
  leads: StoredRecord[],
) {
  return {
    contacts: visiblePayloads(contacts) as any,
    companies: visiblePayloads(companies) as any,
    leads: visiblePayloads(leads) as any,
  };
}
function duplicateKeys(kind: CrmImportKind, row: ImportRawRow): string[] {
  if (kind === "companies") {
    const name = normalizeName(row.name || row.companyName);
    return name ? [`name:${name}`] : [];
  }
  return [
    ...(normalizePhone(row.phone)
      ? [`phone:${normalizePhone(row.phone)}`]
      : []),
    ...(normalizeEmail(row.email)
      ? [`email:${normalizeEmail(row.email)}`]
      : []),
  ];
}
function payloadKeys(kind: CrmImportKind, payload: any): string[] {
  if (kind === "companies") {
    const name = normalizeName(payload.name);
    return name ? [`name:${name}`] : [];
  }
  return [
    ...(normalizePhone(payload.phone)
      ? [`phone:${normalizePhone(payload.phone)}`]
      : []),
    ...(normalizeEmail(payload.email)
      ? [`email:${normalizeEmail(payload.email)}`]
      : []),
  ];
}
function visibleCandidateIds(
  kind: CrmImportKind,
  row: ImportRawRow,
  records: StoredRecord[],
): string[] {
  const keys = new Set(duplicateKeys(kind, row));
  return records
    .filter((record) =>
      payloadKeys(kind, record.payload).some((key) => keys.has(key)),
    )
    .map((record) => record.id);
}
function hiddenDuplicate(
  kind: CrmImportKind,
  row: ImportRawRow,
  records: StoredRecord[],
  visibleIds: Set<string>,
): boolean {
  const keys = new Set(duplicateKeys(kind, row));
  return records.some(
    (record) =>
      !visibleIds.has(record.id) &&
      payloadKeys(kind, record.payload).some((key) => keys.has(key)),
  );
}

async function referenceIssues(
  kind: CrmImportKind,
  raw: ImportRawRow,
  scopedStore: Store,
  owner: string,
  visibleCompanies: StoredRecord[],
  visibleContacts: StoredRecord[],
): Promise<{
  issues: ImportIssue[];
  companyId: string;
  companyName: string;
  contactId: string;
}> {
  const issues: ImportIssue[] = [];
  let companyId = String(raw.companyId || "").trim();
  let companyName = String(raw.companyName || "").trim();
  let contactId = String(raw.contactId || "").trim();
  const companies = visibleCompanies.map((record) => record.payload as any);
  const contacts = visibleContacts.map((record) => record.payload as any);
  if (companyId) {
    const exact = await scopedStore.get("companies", companyId, owner);
    if (!exact) {
      issues.push(
        issue(
          "REFERENCE_NOT_VISIBLE",
          "Şirket bağlantısı bu kapsamda bulunamadı.",
        ),
      );
      companyId = "";
    } else {
      companyName = String((exact.payload as any).name || companyName);
    }
  } else if (companyName) {
    const matches = companies.filter(
      (company) => normalizeName(company.name) === normalizeName(companyName),
    );
    if (matches.length === 1) {
      companyId = String(matches[0].id);
      companyName = String(matches[0].name);
    } else if (matches.length > 1) {
      issues.push(
        issue(
          "AMBIGUOUS_REFERENCE",
          "Şirket adı birden fazla görünür kayda karşılık geliyor.",
        ),
      );
    } else {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          "Şirket adı görünür mevcut bir şirketle eşleşmiyor.",
        ),
      );
    }
  }
  if (kind === "leads" && contactId) {
    const exact = await scopedStore.get("contacts", contactId, owner);
    if (!exact || !contacts.some((contact) => contact.id === contactId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_VISIBLE",
          "Kişi bağlantısı bu kapsamda bulunamadı.",
        ),
      );
      contactId = "";
    }
  }
  return { issues, companyId, companyName, contactId };
}

async function loadRecords(
  scopedStore: Store,
  rawStore: Store,
  owner: string,
  kind: CrmImportKind,
) {
  const sk = storeKind(kind);
  const [visible, all, visibleCompanies, visibleContacts] = await Promise.all([
    scopedStore.list(sk, owner),
    rawStore.list(sk, owner),
    scopedStore.list("companies", owner),
    scopedStore.list("contacts", owner),
  ]);
  return { visible, all, visibleCompanies, visibleContacts };
}

async function makePreview(
  kind: CrmImportKind,
  rows: Array<{ raw: ImportRawRow; issues: ImportIssue[] }>,
  scopedStore: Store,
  rawStore: Store,
  owner: string,
) {
  const records = await loadRecords(scopedStore, rawStore, owner, kind);
  const base = previewImportRows(
    kind,
    rows.map((row, index) => ({
      rowNumber: index + 2,
      raw: row.raw,
      issues: row.issues,
    })),
    visibleState(
      kind === "contacts" ? records.visible : records.visibleContacts,
      kind === "companies" ? records.visible : records.visibleCompanies,
      kind === "leads" ? records.visible : [],
    ),
  );
  const visibleIds = new Set(records.visible.map((record) => record.id));
  for (const row of base.rows) {
    const source = rows[row.rowNumber - 2];
    const references = await referenceIssues(
      kind,
      source.raw,
      scopedStore,
      owner,
      records.visibleCompanies,
      records.visibleContacts,
    );
    row.issues.push(...references.issues);
    const isHidden = hiddenDuplicate(kind, source.raw, records.all, visibleIds);
    if (isHidden) {
      row.unavailable = true;
      delete row.candidateId;
      delete row.candidateIds;
      row.issues.push(
        issue(
          "DUPLICATE_UNAVAILABLE",
          "Bu iletişim için yeni kayıt oluşturulmadı.",
        ),
      );
    } else {
      const candidates = visibleCandidateIds(kind, source.raw, records.visible);
      if (candidates.length) {
        row.candidateId = candidates[0];
        if (candidates.length > 1) row.candidateIds = candidates;
      }
    }
    if (row.issues.length) {
      const hasDuplicate = row.issues.some((item) =>
        [
          "EXISTING_DUPLICATE",
          "FILE_DUPLICATE",
          "DUPLICATE_UNAVAILABLE",
        ].includes(item.code),
      );
      row.status = hasDuplicate ? "duplicate" : "error";
    }
    row.issues = [
      ...new Map(
        row.issues.map((item) => [`${item.code}:${item.message}`, item]),
      ).values(),
    ];
  }
  base.counts = {
    total: base.rows.length,
    ready: base.rows.filter((row) => row.status === "ready").length,
    duplicate: base.rows.filter((row) => row.status === "duplicate").length,
    error: base.rows.filter((row) => row.status === "error").length,
  };
  return base;
}

function sameImportPayload(
  kind: CrmImportKind,
  existing: any,
  expected: any,
): boolean {
  const fields =
    kind === "contacts"
      ? ["name", "phone", "email", "companyId", "notes"]
      : kind === "companies"
        ? ["name", "phone", "email", "notes"]
        : [
            "name",
            "phone",
            "email",
            "company",
            "companyId",
            "contactId",
            "city",
            "source",
            "notes",
            "stage",
          ];
  return fields.every((field) => {
    if (field === "phone")
      return (
        normalizePhone(existing[field]) === normalizePhone(expected[field])
      );
    if (field === "email")
      return (
        normalizeEmail(existing[field]) === normalizeEmail(expected[field])
      );
    return String(existing[field] ?? "") === String(expected[field] ?? "");
  });
}

async function buildEntity(
  kind: CrmImportKind,
  raw: ImportRawRow,
  tenantOwner: string,
  assigneeName: string,
  scopedStore: Store,
  visibleCompanies: StoredRecord[],
  visibleContacts: StoredRecord[],
): Promise<{ entity?: any; issues: ImportIssue[] }> {
  const issues = validateImportRow(kind, raw);
  const refs = await referenceIssues(
    kind,
    raw,
    scopedStore,
    tenantOwner,
    visibleCompanies,
    visibleContacts,
  );
  issues.push(...refs.issues);
  if (issues.length)
    return {
      issues: [
        ...new Map(
          issues.map((item) => [`${item.code}:${item.message}`, item]),
        ).values(),
      ],
    };
  const stamp = now();
  const id = importId(kind, raw);
  const name = String(raw.name || raw.companyName || "").trim();
  const phone = normalizePhone(raw.phone);
  const email = normalizeEmail(raw.email);
  if (kind === "contacts") {
    const parsed = ContactSchema.safeParse({
      id,
      name,
      phone,
      email,
      companyId: refs.companyId,
      owner: assigneeName,
      tags: [],
      notes: String(raw.notes || ""),
      createdAt: stamp,
      updatedAt: stamp,
    });
    return parsed.success
      ? { entity: parsed.data, issues: [] }
      : {
          issues: parsed.error.issues.map((item) =>
            issue("INVALID_FIELD", item.message),
          ),
        };
  }
  if (kind === "companies") {
    const parsed = CompanySchema.safeParse({
      id,
      name,
      industry: "",
      phone,
      email,
      website: "",
      address: "",
      owner: assigneeName,
      notes: String(raw.notes || ""),
      createdAt: stamp,
      updatedAt: stamp,
    });
    return parsed.success
      ? { entity: parsed.data, issues: [] }
      : {
          issues: parsed.error.issues.map((item) =>
            issue("INVALID_FIELD", item.message),
          ),
        };
  }
  const parsed = LeadSchema.safeParse({
    id,
    name,
    phone,
    email,
    company: refs.companyName,
    companyId: refs.companyId || undefined,
    contactId: refs.contactId || undefined,
    city: raw.city ? String(raw.city).trim() : undefined,
    stage: "new",
    owner: assigneeName,
    value: 0,
    source: String(raw.source || "").trim(),
    notes: String(raw.notes || ""),
    tags: [],
    createdAt: stamp,
    lastActivity: stamp,
  });
  return parsed.success
    ? { entity: parsed.data, issues: [] }
    : {
        issues: parsed.error.issues.map((item) =>
          issue("INVALID_FIELD", item.message),
        ),
      };
}

async function withImportLock<T>(
  key: string,
  persistence: Store,
  work: () => Promise<T>,
): Promise<T> {
  const previous = localLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => (release = resolve));
  const queued = previous.catch(() => undefined).then(() => turn);
  localLocks.set(key, queued);
  await previous.catch(() => undefined);
  let connection: any;
  let acquired = false;
  const lockName = `xrecrm-import-${crypto.createHash("sha256").update(key).digest("hex").slice(0, 48)}`;
  try {
    const nativeStore = persistence as any;
    if (
      nativeStore?.constructor?.name === "MysqlStore" &&
      typeof nativeStore.getPool === "function"
    ) {
      const pool = nativeStore.getPool();
      connection = await pool.getConnection();
      const [rows] = await connection.query(
        "SELECT GET_LOCK(?, 30) AS locked",
        [lockName],
      );
      acquired = Number(rows?.[0]?.locked) === 1;
      if (!acquired)
        throw statusError(503, "İçe aktarma kilidi alınamadı; tekrar deneyin.");
    }
    return await work();
  } finally {
    if (connection) {
      if (acquired) {
        try {
          await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
        } catch {
          /* connection close also releases the lock */
        }
      }
      connection.release();
    }
    release();
    if (localLocks.get(key) === queued) localLocks.delete(key);
  }
}

function operationActor(auth: AuthContext): string {
  return auth.employeeId || auth.user.openId;
}
function responseForRows(
  rows: ImportPreviewRow[],
  created: number,
  recovered: number,
) {
  const errors = rows.filter((row) => row.status === "error").length;
  const skipped = rows.filter((row) => row.status === "duplicate").length;
  return {
    counts: { total: rows.length, created, recovered, skipped, errors },
    rows,
  };
}

async function commitImport(
  body: z.infer<typeof commitEnvelope>,
  scopedStore: Store,
  rawStore: Store,
  auth: AuthContext,
) {
  const owner = auth.ownerOpenId;
  const actor = operationActor(auth);
  const opKey = operationKey(owner, actor, body.operationId);
  const hash = requestHash(body);
  const saved = await rawStore.get<any>("crm_import_operation", opKey, owner);
  if (saved) {
    if (saved.payload.requestHash !== hash)
      throw statusError(
        409,
        "Bu operationId farklı bir istek için kullanılmış.",
      );
    return saved.payload.response;
  }
  const preview = await makePreview(
    body.kind,
    cleanRows(body.rows),
    scopedStore,
    rawStore,
    owner,
  );
  const records = await loadRecords(scopedStore, rawStore, owner, body.kind);
  const visibleIds = new Set(records.visible.map((record) => record.id));
  let created = 0;
  let recovered = 0;
  const responseRows: ImportPreviewRow[] = [];
  for (const row of preview.rows) {
    const rowCopy: ImportPreviewRow = { ...row, issues: [...row.issues] };
    const raw = row.raw;
    const built = await buildEntity(
      body.kind,
      raw,
      owner,
      auth.displayName || auth.user.name || actor,
      scopedStore,
      records.visibleCompanies,
      records.visibleContacts,
    );
    const id = importId(body.kind, raw);
    const anyExisting = await rawStore.get<any>(
      storeKind(body.kind),
      id,
      owner,
    );
    if (anyExisting && !visibleIds.has(id)) {
      rowCopy.status = "duplicate";
      rowCopy.unavailable = true;
      rowCopy.issues = [
        issue(
          "DUPLICATE_UNAVAILABLE",
          "Bu iletişim için yeni kayıt oluşturulmadı.",
        ),
      ];
      delete rowCopy.candidateId;
      delete rowCopy.candidateIds;
      responseRows.push(rowCopy);
      continue;
    }
    const existingById = visibleIds.has(id)
      ? await scopedStore.get<any>(storeKind(body.kind), id, owner)
      : null;
    if (
      existingById &&
      built.entity &&
      sameImportPayload(body.kind, existingById.payload, built.entity)
    ) {
      rowCopy.status = "ready";
      rowCopy.candidateId = id;
      rowCopy.issues = [];
      (rowCopy as any).recovered = true;
      recovered++;
      responseRows.push(rowCopy);
      continue;
    }
    if (rowCopy.status !== "ready" || built.issues.length) {
      rowCopy.status = rowCopy.status === "duplicate" ? "duplicate" : "error";
      rowCopy.issues = [
        ...new Map(
          [...rowCopy.issues, ...built.issues].map((item) => [
            `${item.code}:${item.message}`,
            item,
          ]),
        ).values(),
      ];
      if (rowCopy.unavailable) {
        delete rowCopy.candidateId;
        delete rowCopy.candidateIds;
      }
      responseRows.push(rowCopy);
      continue;
    }
    if (!built.entity) {
      rowCopy.status = "error";
      rowCopy.issues = [issue("INVALID_FIELD", "Kayıt doğrulanamadı.")];
      responseRows.push(rowCopy);
      continue;
    }
    const existingVisibleId = visibleIds.has(id)
      ? await scopedStore.get<any>(storeKind(body.kind), id, owner)
      : null;
    if (existingVisibleId) {
      rowCopy.status = "error";
      rowCopy.issues = [
        issue(
          "ID_CONFLICT",
          "Oluşturulacak kimlik mevcut bir kayıtla çakışıyor.",
        ),
      ];
      responseRows.push(rowCopy);
      continue;
    }
    try {
      const inserted = await scopedStore.insertIfAbsent(
        storeKind(body.kind),
        id,
        built.entity,
        owner,
      );
      if (!inserted.inserted) {
        rowCopy.status = "duplicate";
        rowCopy.issues = [
          issue(
            "INSERT_CONFLICT",
            "Yeni kayıt oluşturulmadı; kayıt kimliği kullanımda.",
          ),
        ];
        delete rowCopy.candidateId;
        delete rowCopy.candidateIds;
        responseRows.push(rowCopy);
        continue;
      }
      rowCopy.status = "ready";
      rowCopy.candidateId = id;
      rowCopy.issues = [];
      (rowCopy as any).created = true;
      created++;
      visibleIds.add(id);
    } catch (error) {
      rowCopy.status = "error";
      rowCopy.issues = [
        issue("WRITE_FAILED", "Kayıt yazılamadı; tekrar deneyin."),
      ];
    }
    responseRows.push(rowCopy);
  }
  const response = responseForRows(responseRows, created, recovered);
  await rawStore.put(
    "crm_import_operation",
    opKey,
    {
      ownerOpenId: owner,
      actorOpenId: actor,
      operationId: body.operationId,
      requestHash: hash,
      response,
      createdAt: now(),
    },
    owner,
  );
  return response;
}

function qualityGroups(kind: CrmImportKind, records: StoredRecord[]) {
  const groups = new Map<string, string[]>();
  for (const record of records) {
    for (const key of payloadKeys(kind, record.payload)) {
      const ids = groups.get(key) || [];
      ids.push(record.id);
      groups.set(key, ids);
    }
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({
      kind,
      field: key.split(":", 1)[0],
      candidateIds: ids,
    }));
}
async function dataQuality(
  scopedStore: Store,
  owner: string,
  auth: AuthContext,
) {
  const allowed = (kind: CrmImportKind) =>
    auth.isOwner || canAccess(auth, importModule(kind), "read");
  const [contacts, companies, leads] = await Promise.all([
    allowed("contacts")
      ? scopedStore.list("contacts", owner)
      : Promise.resolve([]),
    allowed("companies")
      ? scopedStore.list("companies", owner)
      : Promise.resolve([]),
    allowed("leads") ? scopedStore.list("lead", owner) : Promise.resolve([]),
  ]);
  return {
    totals: {
      contacts: contacts.length,
      companies: companies.length,
      leads: leads.length,
    },
    missing: {
      contacts: {
        phone: contacts
          .filter((row: any) => !normalizePhone(row.payload.phone))
          .map((row) => row.id),
        email: contacts
          .filter((row: any) => !normalizeEmail(row.payload.email))
          .map((row) => row.id),
      },
      companies: {
        phone: companies
          .filter((row: any) => !normalizePhone(row.payload.phone))
          .map((row) => row.id),
        email: companies
          .filter((row: any) => !normalizeEmail(row.payload.email))
          .map((row) => row.id),
      },
      leads: {
        phone: leads
          .filter((row: any) => !normalizePhone(row.payload.phone))
          .map((row) => row.id),
        email: leads
          .filter((row: any) => !normalizeEmail(row.payload.email))
          .map((row) => row.id),
      },
    },
    duplicateCandidates: [
      ...qualityGroups("contacts", contacts),
      ...qualityGroups("companies", companies),
      ...qualityGroups("leads", leads),
    ],
  };
}

function importModule(kind: CrmImportKind): "contacts" | "companies" | "crm" {
  return kind === "contacts"
    ? "contacts"
    : kind === "companies"
      ? "companies"
      : "crm";
}
function assertImportAccess(
  auth: AuthContext,
  kind: CrmImportKind,
  action: "read" | "write",
): void {
  if (!auth.isOwner && !canAccess(auth, importModule(kind), action))
    throw statusError(403, "Bu CRM kayıt türünde bu işlem için yetkiniz yok.");
}

export function registerCrmImportRoutes(
  app: Express,
  scopedStore: Store,
  rawStore: Store,
): void {
  const raw = rawStoreOf(rawStore);
  app.post("/api/crm-import/preview", async (req, res) => {
    try {
      const serialized = JSON.stringify(req.body ?? null);
      if (byteLength(serialized) > IMPORT_MAX_BYTES)
        throw statusError(400, "İstek 1 MB sınırını aşıyor.");
      const parsed = previewEnvelope.safeParse(req.body);
      if (!parsed.success) throw statusError(400, "Geçersiz önizleme isteği.");
      const auth = authOf(req);
      assertImportAccess(auth, parsed.data.kind, "read");
      const response = await makePreview(
        parsed.data.kind,
        cleanRows(parsed.data.rows),
        scopedStore,
        raw,
        auth.ownerOpenId,
      );
      return res.json(response);
    } catch (error) {
      return errorResponse(res, error);
    }
  });
  app.post("/api/crm-import/commit", async (req, res) => {
    try {
      const serialized = JSON.stringify(req.body ?? null);
      if (byteLength(serialized) > IMPORT_MAX_BYTES)
        throw statusError(400, "İstek 1 MB sınırını aşıyor.");
      const parsed = commitEnvelope.safeParse(req.body);
      if (!parsed.success) throw statusError(400, "Geçersiz commit isteği.");
      const auth = authOf(req);
      assertImportAccess(auth, parsed.data.kind, "write");
      const lockKey = `${auth.ownerOpenId}:crm-import:${parsed.data.kind}`;
      const response = await withImportLock(lockKey, raw, () =>
        commitImport(parsed.data, scopedStore, raw, auth),
      );
      return res.json(response);
    } catch (error) {
      return errorResponse(res, error);
    }
  });
  app.get("/api/data-quality", async (req, res) => {
    try {
      const auth = authOf(req);
      if (
        !auth.isOwner &&
        !["contacts", "companies", "crm"].some((module) =>
          canAccess(auth, module as "contacts" | "companies" | "crm", "read"),
        )
      )
        throw statusError(
          403,
          "Veri kalitesi ekranı için CRM okuma yetkisi gerekli.",
        );
      return res.json(await dataQuality(scopedStore, auth.ownerOpenId, auth));
    } catch (error) {
      return errorResponse(res, error);
    }
  });
}

export const registerCRMImportRoutes = registerCrmImportRoutes;
