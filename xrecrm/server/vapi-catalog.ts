import { groupNames, lines, type Line } from "../shared/lines.js";
import type {
  VapiAssistant,
  VapiCatalog,
  VapiCatalogLine,
} from "../shared/vapi.js";
import {
  fetchWithTimeout,
  normalizePhone,
  readJsonResponse,
} from "./security.js";

const DEFAULT_VAPI_BASE = "https://api.vapi.ai";
const VAPI_TIMEOUT_MS = 8_000;

interface JsonRecord {
  [key: string]: unknown;
}

interface RemotePhoneNumber {
  id: string;
  number: string;
  normalizedPhone: string;
  name?: string;
  inboundAssistantId?: string;
  credentialConfigured: boolean;
  provider?: string;
  status?: string;
}

export class VapiCatalogError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "VapiCatalogError";
    this.statusCode = statusCode;
  }
}

function vapiBase(): string {
  return (process.env.VAPI_API_URL || DEFAULT_VAPI_BASE).replace(/\/$/, "");
}

function configuredKey(): string {
  const key = process.env.VAPI_API_KEY?.trim();
  if (!key)
    throw new VapiCatalogError("Vapi API anahtarı yapılandırılmamış.", 503);
  return key;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function collection(value: unknown, names: string[]): JsonRecord[] {
  if (Array.isArray(value))
    return value.filter((entry): entry is JsonRecord => Boolean(asRecord(entry)));
  const record = asRecord(value);
  if (!record) return [];
  for (const name of names) {
    const candidate = record[name];
    if (Array.isArray(candidate))
      return candidate.filter((entry): entry is JsonRecord =>
        Boolean(asRecord(entry)),
      );
  }
  return [];
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function genericFetchError(): VapiCatalogError {
  // Provider bodies are deliberately not retained in the public error. They can
  // contain prompts, server URLs, credentials, or other account metadata.
  return new VapiCatalogError("Vapi kataloğu alınamadı.", 502);
}

async function fetchCollection(
  path: string,
  names: string[],
  key: string,
): Promise<JsonRecord[]> {
  try {
    const response = await fetchWithTimeout(
      `${vapiBase()}${path}`,
      {
        headers: { authorization: `Bearer ${key}` },
      },
      VAPI_TIMEOUT_MS,
    );
    return collection(await readJsonResponse(response), names);
  } catch {
    // Never expose readJsonResponse's provider JSON or provider error message.
    throw genericFetchError();
  }
}

function readLineMap(): Record<string, string> {
  const raw = process.env.VAPI_LINE_MAP_JSON?.trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VapiCatalogError("Vapi hat eşlemesi geçersiz.", 503);
  }
  const record = asRecord(parsed);
  if (!record)
    throw new VapiCatalogError("Vapi hat eşlemesi geçersiz.", 503);
  const result: Record<string, string> = {};
  for (const [lineId, remoteId] of Object.entries(record)) {
    if (!lineId || typeof remoteId !== "string" || !remoteId.trim())
      throw new VapiCatalogError("Vapi hat eşlemesi geçersiz.", 503);
    result[lineId] = remoteId.trim();
  }
  return result;
}

function remoteAssistantId(record: JsonRecord): string | undefined {
  return (
    text(record.assistantId) ||
    text(record.inboundAssistantId) ||
    text(asRecord(record.assistant)?.id)
  );
}

function parseAssistants(items: JsonRecord[]): VapiAssistant[] {
  const seen = new Set<string>();
  const assistants: VapiAssistant[] = [];
  for (const item of items) {
    const id = text(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    assistants.push({ id, name: text(item.name) || id });
  }
  return assistants;
}

function parsePhoneNumbers(items: JsonRecord[]): RemotePhoneNumber[] {
  const numbers: RemotePhoneNumber[] = [];
  for (const item of items) {
    const id = text(item.id);
    const number =
      text(item.number) ||
      text(item.phoneNumber) ||
      text(asRecord(item.phoneNumber)?.number);
    if (!id || !number) continue;
    const normalizedPhone = normalizePhone(number);
    if (!normalizedPhone) continue;
    const credentialId =
      text(item.credentialId) || text(asRecord(item.credential)?.id);
    const provider =
      text(item.provider) ||
      text(item.phoneNumberProvider) ||
      text(item.telephonyProvider);
    numbers.push({
      id,
      number,
      normalizedPhone,
      name: text(item.name),
      inboundAssistantId: remoteAssistantId(item),
      credentialConfigured: Boolean(credentialId),
      ...(provider ? { provider } : {}),
      status: text(item.status),
    });
  }
  return numbers;
}

function inventoryLine(lineId: string): Line | undefined {
  return lines.find((line) => line.id === lineId);
}

function validateExplicitMap(
  map: Record<string, string>,
  remoteById: Map<string, RemotePhoneNumber>,
): void {
  const usedRemoteIds = new Set<string>();
  for (const [lineId, remoteId] of Object.entries(map)) {
    const line = inventoryLine(lineId);
    const remote = remoteById.get(remoteId);
    if (
      !line ||
      !remote ||
      remote.normalizedPhone !== normalizePhone(line.phone) ||
      usedRemoteIds.has(remoteId)
    )
      throw new VapiCatalogError("Vapi hat eşlemesi geçersiz.", 503);
    usedRemoteIds.add(remoteId);
  }
}

function lineName(line: Line, remote: RemotePhoneNumber): string {
  return remote.name || `${groupNames[line.group]} · ${line.id}`;
}

function knownActive(status: string | undefined): boolean {
  return (
    !status ||
    ["active", "connected", "enabled", "online", "ready"].includes(
      status.toLowerCase(),
    )
  );
}

function isByoProvider(provider: string | undefined): boolean {
  if (!provider) return false;
  const value = provider.toLowerCase();
  return !/vapi|native|managed/.test(value);
}

function remoteIsCallable(line: Line, remote: RemotePhoneNumber): boolean {
  // A missing status is intentionally accepted: Vapi does not return a
  // status for every phone-number provider. Known non-active statuses fail
  // closed. BYO providers additionally require a credential id; this is not
  // a claim about SIP/RTP readiness.
  if (!knownActive(remote.status)) return false;
  if (isByoProvider(remote.provider) && !remote.credentialConfigured)
    return false;
  // The CRM cloud group is the legacy BYO inventory group. Keep the same
  // safety rule when an older provider response omits its provider label.
  if (line.group === "cloud" && !remote.credentialConfigured) return false;
  return true;
}

export async function getVapiCatalog(): Promise<VapiCatalog> {
  const key = configuredKey();
  const [assistantItems, phoneItems] = await Promise.all([
    fetchCollection("/assistant?limit=1000", ["data", "assistants", "items"], key),
    fetchCollection(
      "/phone-number?limit=1000",
      ["data", "phoneNumbers", "phone_numbers", "items"],
      key,
    ),
  ]);
  const assistants = parseAssistants(assistantItems);
  const remoteNumbers = parsePhoneNumbers(phoneItems);
  const remoteById = new Map<string, RemotePhoneNumber>();
  for (const remote of remoteNumbers) {
    if (remoteById.has(remote.id))
      throw new VapiCatalogError("Vapi kataloğu doğrulanamadı.", 502);
    remoteById.set(remote.id, remote);
  }

  const remoteByPhone = new Map<string, RemotePhoneNumber[]>();
  for (const remote of remoteNumbers) {
    const existing = remoteByPhone.get(remote.normalizedPhone) || [];
    existing.push(remote);
    remoteByPhone.set(remote.normalizedPhone, existing);
  }

  const explicitMap = readLineMap();
  validateExplicitMap(explicitMap, remoteById);

  const matchedRemoteIds = new Set<string>();
  const unavailableLineIds: string[] = [];
  const matchedLines: VapiCatalogLine[] = [];
  for (const line of lines) {
    const candidates = remoteByPhone.get(normalizePhone(line.phone)) || [];
    if (candidates.length !== 1) {
      unavailableLineIds.push(line.id);
      continue;
    }
    const remote = candidates[0];
    if (explicitMap[line.id] && explicitMap[line.id] !== remote.id) {
      unavailableLineIds.push(line.id);
      continue;
    }
    matchedRemoteIds.add(remote.id);
    matchedLines.push({
      lineId: line.id,
      phone: line.phone,
      group: line.group,
      name: lineName(line, remote),
      phoneNumberId: remote.id,
      ...(remote.inboundAssistantId
        ? { inboundAssistantId: remote.inboundAssistantId }
        : {}),
      credentialConfigured: remote.credentialConfigured,
      ...(remote.status ? { status: remote.status } : {}),
      callable: remoteIsCallable(line, remote),
    });
  }

  const unmatchedNumbers = remoteNumbers.filter(
    (remote) => !matchedRemoteIds.has(remote.id),
  ).length;
  const defaultAssistantId = text(process.env.VAPI_ASSISTANT_ID);
  return {
    keyConfigured: true,
    assistants,
    lines: matchedLines,
    unmatchedNumbers,
    unavailableLineIds,
    webhookConfigured: Boolean(process.env.VAPI_WEBHOOK_SECRET?.trim()),
    ...(defaultAssistantId ? { defaultAssistantId } : {}),
    checkedAt: new Date().toISOString(),
  };
}

export function vapiLineIsCallable(line: VapiCatalogLine): boolean {
  if (line.callable === false) return false;
  const status = line.status?.trim().toLowerCase();
  if (
    status &&
    !["active", "connected", "enabled", "online", "ready"].some((value) =>
      status === value,
    )
  )
    return false;
  // Cloud inventory entries represent BYO telephony. A Vapi credential is
  // required for those entries, but this check does not claim SIP readiness.
  if (line.group === "cloud" && !line.credentialConfigured) return false;
  return true;
}
