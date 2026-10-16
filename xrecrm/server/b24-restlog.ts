// Bitrix24 REST çağrı kayıtları. Bitrix24 Market kuralı: sunucudan REST
// çağrısı yapan uygulamalar istek ve cevap kayıtlarını en az son 3 gün
// saklamalıdır (Bitrix desteğine sorun bildirirken gerekir).
//
// Günlük dosyalar: <XRE_DATA_DIR>/b24-rest/YYYY-MM-DD.log (JSON satırları).
// Belirteçler kaydedilmez; uzun metinler kısaltılır. 7 günden eski dosyalar silinir.
import fs from "node:fs";
import path from "node:path";

const KEEP_DAYS = 7;
const MAX_STRING = 300;
const dir = () => path.resolve(process.env.XRE_DATA_DIR || "data", "b24-rest");
const SECRET_KEYS = /^(auth|access_token|refresh_token|client_secret|application_token|password)$/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) out[k] = SECRET_KEYS.test(k) ? "***" : sanitize(v, depth + 1);
    return out;
  }
  return String(value);
}

let lastCleanup = 0;
function cleanup(now: number) {
  if (now - lastCleanup < 3_600_000) return;
  lastCleanup = now;
  try {
    const limit = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(dir())) if (/^\d{4}-\d{2}-\d{2}\.log$/.test(f) && f.slice(0, 10) < limit) fs.unlinkSync(path.join(dir(), f));
  } catch {
    /* kayıt temizliği başarısız olsa da çağrıyı etkilemez */
  }
}

export interface RestLogEntry {
  domain: string;
  memberId: string;
  method: string;
  params: Record<string, unknown>;
  ms: number;
  ok: boolean;
  error?: string;
  result?: unknown;
}

/** Bir REST çağrısını kaydeder; kayıt hatası çağrıyı asla bozmaz. */
export function logRestCall(entry: RestLogEntry) {
  if (process.env.B24_REST_LOG === "0") return;
  const now = Date.now();
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const line = JSON.stringify({
      at: new Date(now).toISOString(),
      domain: entry.domain,
      member: entry.memberId,
      method: entry.method,
      ms: entry.ms,
      ok: entry.ok,
      ...(entry.error ? { error: entry.error.slice(0, 500) } : {}),
      params: sanitize(entry.params),
      ...(entry.result !== undefined ? { result: sanitize(entry.result) } : {}),
    });
    fs.appendFile(path.join(dir(), `${new Date(now).toISOString().slice(0, 10)}.log`), `${line}\n`, () => undefined);
    cleanup(now);
  } catch {
    /* yok say */
  }
}
