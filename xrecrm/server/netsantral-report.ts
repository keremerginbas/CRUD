// Netsantral görüşme raporu (CDR): bildirim adresi başka bir yere bağlıyken de görüşmenin süresi ve
// ses kaydı CRM'e gelsin diye birkaç dakikada bir Netgsm'in rapor servisinden çekilir.
// İsteğe bağlı olarak kayıt yazıya dökülür ve mevcut görüşme analizi çalıştırılır.
import type { Store } from "./db.js";
import { assertSafeOutboundUrl, fetchWithTimeout, normalizePhone } from "./security.js";
import {
  NETSANTRAL_PROVIDER,
  extOf,
  last10,
  netsantralCdrParties,
  netsantralConfig,
  netsantralConfigured,
  netsantralOnlyList,
  netsantralRecordingUrl,
  normalizeNetsantralId,
  type NetsantralDeps,
} from "./netsantral.js";
import { aiConfigured, transcribe } from "./b24-ai.js";

const env = (k: string) => process.env[k]?.trim() || "";
const REPORT_URL = "https://api.netgsm.com.tr/netsantral/report";
const WINDOW_MINUTES = 30;
/** Rapordaki görüşme ile CRM'deki kaydın başlangıcı arasında kabul edilen en büyük fark. */
const MATCH_WINDOW_MS = 6 * 60_000;

export interface ReportRow {
  uid: string;
  at: string | null;
  source: string;
  destination: string;
  duration: number;
  recording: string;
  line: string;
}
interface CallRecord {
  id: string;
  provider?: string;
  status?: string;
  direction?: string;
  phone?: string;
  leadId?: string | null;
  durationSeconds?: number | null;
  startedAt?: string;
  createdAt?: string;
  recording?: string | null;
  transcript?: string;
  providerCallId?: string;
  providerMeta?: Record<string, unknown>;
  [key: string]: unknown;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Netgsm'in beklediği biçim: İstanbul saatiyle ddMMyyyyHHmm. */
export function reportStamp(date: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}${p.month}${p.year}${p.hour}${p.minute}`;
}
/** "07.02.2023 13:50:33" (İstanbul) → ISO. */
export function reportDate(value: unknown): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? "").trim());
  if (!m) return null;
  const time = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || "00"}+03:00`);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Rapor yanıtını düz satırlara çevirir; beklenmeyen biçimde boş döner. */
export function parseReport(body: unknown): ReportRow[] {
  if (!Array.isArray(body)) return [];
  const rows: ReportRow[] = [];
  for (const item of body.slice(0, 2000)) {
    if (!item || typeof item !== "object") continue;
    const uid = normalizeNetsantralId((item as Record<string, unknown>).uniqueid);
    const values = (item as Record<string, unknown>).values;
    for (const raw of Array.isArray(values) ? values.slice(0, 20) : []) {
      if (!raw || typeof raw !== "object") continue;
      const v = raw as Record<string, unknown>;
      rows.push({
        uid,
        at: reportDate(v.date),
        source: String(v.source ?? "").trim().slice(0, 60),
        destination: String(v.destination ?? "").trim().slice(0, 60),
        duration: Math.max(0, Math.min(86_400, Math.round(Number(v.duration) || 0))),
        recording: netsantralRecordingUrl(v.recording),
        line: String(v.line ?? "").trim().slice(0, 40),
      });
    }
  }
  return rows;
}

let lastShapeLog = 0;
export async function fetchNetsantralReport(from: Date, to: Date): Promise<ReportRow[]> {
  const cfg = netsantralConfig();
  const response = await fetchWithTimeout(
    REPORT_URL,
    { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ usercode: cfg.usercode, password: cfg.password, startdate: reportStamp(from), stopdate: reportStamp(to) }) },
    20_000,
  );
  const text = (await response.text()).slice(0, 2_000_000);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  // "Kayıt bulunamadı" (kod 40) olağandır. Diğer hata kodları kayda yazılır (şifre içermez).
  if (!Array.isArray(body)) {
    const code = body && typeof body === "object" ? Number((body as Record<string, unknown>).code) : NaN;
    if (code !== 40 && Date.now() - lastShapeLog > 30 * 60_000) {
      lastShapeLog = Date.now();
      console.warn("Netsantral raporu alınamadı:", JSON.stringify({ http: response.status, code: Number.isFinite(code) ? code : null, tur: body === null ? "metin" : typeof body }));
    }
    return [];
  }
  return parseReport(body);
}

export const callTranscribeEnabled = () => /^(1|acik|açık|evet|on|true)$/i.test(env("XRE_CALL_TRANSCRIBE")) && aiConfigured();

/** Ses kaydını yalnız Netgsm sunucularından, sınırlı boyutta indirir (yönlendirmeler elle izlenir). */
async function downloadRecording(start: string): Promise<{ buffer: Buffer; mime: string } | null> {
  let current = start;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertSafeOutboundUrl(current);
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" || !/(^|\.)netgsm\.com\.tr$/i.test(parsed.hostname)) return null;
    const response = await fetch(parsed, { redirect: "manual", signal: AbortSignal.timeout(60_000) });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      current = new URL(next, parsed).toString();
      continue;
    }
    if (!response.ok) return null;
    const mime = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    // Giriş sayfası gibi bir HTML dönerse ses değildir.
    if (/html|json|text\//.test(mime)) return null;
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 24 * 1024 * 1024) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 24 * 1024 * 1024) return null;
    return { buffer, mime: mime || "audio/mpeg" };
  }
  return null;
}

/** Kaydı yazıya döker ve görüşme analizini sıraya alır. En çok iki kez denenir. */
export async function transcribeCall(store: Store, owner: string, callId: string, analyze: (callId: string) => Promise<unknown>): Promise<"done" | "skipped" | "failed"> {
  const record = (await store.get<CallRecord>("call", callId, owner))?.payload;
  if (!record || !record.recording || (record.transcript || "").trim()) return "skipped";
  const meta = record.providerMeta || {};
  const tries = Number(meta.transcribeTries) || 0;
  if (tries >= 2) return "skipped";
  const save = (patch: Partial<CallRecord>, extra: Record<string, unknown>) =>
    store.put("call", callId, { ...record, ...patch, providerMeta: { ...meta, transcribeTries: tries + 1, ...extra }, updatedAt: new Date().toISOString() }, owner);
  try {
    const audio = await downloadRecording(String(record.recording));
    if (!audio) {
      await save({}, { transcribeError: "kayıt indirilemedi" });
      return "failed";
    }
    const ext = /wav/.test(audio.mime) ? "wav" : /ogg/.test(audio.mime) ? "ogg" : /mp4|m4a/.test(audio.mime) ? "m4a" : "mp3";
    const textOut = await transcribe(audio.buffer, audio.mime, `gorusme.${ext}`, 20_000);
    if (!textOut) {
      await save({}, { transcribeError: "yazıya dökülemedi" });
      return "failed";
    }
    await save({ transcript: textOut }, { transcribeError: undefined, transcribedAt: new Date().toISOString() });
    await analyze(callId).catch((error) => console.warn("Görüşme analizi sıraya alınamadı:", error instanceof Error ? error.message : error));
    return "done";
  } catch (error) {
    await save({}, { transcribeError: (error instanceof Error ? error.message : "hata").slice(0, 120) }).catch(() => undefined);
    return "failed";
  }
}

export interface ReportDeps extends Pick<NetsantralDeps, "ownerScope" | "logCall"> {
  analyze(owner: string, callId: string): Promise<unknown>;
}

/** Son yarım saatin görüşmelerini çekip CRM kayıtlarına işler. */
export async function syncNetsantralReport(store: Store, deps: ReportDeps, now = new Date(), rowsIn?: ReportRow[]): Promise<{ matched: number; created: number; transcribed: number }> {
  const result = { matched: 0, created: 0, transcribed: 0 };
  if (!rowsIn && !netsantralConfigured()) return result;
  const owner = await deps.ownerScope(store);
  const rows = rowsIn || (await fetchNetsantralReport(new Date(now.getTime() - WINDOW_MINUTES * 60_000), new Date(now.getTime() + 60_000)));
  if (!rows.length) return result;
  const only = netsantralOnlyList();
  const filtered = only.exts.size > 0 || only.numbers.size > 0;
  const recent = (await store.list<CallRecord>("call", owner))
    .map((r) => r.payload)
    .filter((c) => c && typeof c.id === "string" && now.getTime() - Date.parse(String(c.startedAt || c.createdAt || "")) < 6 * 3_600_000);
  const toTranscribe: string[] = [];
  for (const row of rows) {
    const parties = netsantralCdrParties({ arayan: row.source, aranan: row.destination, santral: row.line });
    if (!parties) continue;
    const phone = normalizePhone(parties.phone);
    if (phone.length < 10) continue;
    const at = row.at ? Date.parse(row.at) : NaN;
    let record: CallRecord | null =
      (row.uid && recent.find((c) => c.providerCallId === row.uid || c.id === `pbx-${row.uid}`)) ||
      recent
        .filter((c) => !c.providerCallId && c.phone === phone && Number.isFinite(at) && Math.abs(Date.parse(String(c.startedAt || c.createdAt || "")) - at) <= MATCH_WINDOW_MS)
        .sort((a, b) => Math.abs(Date.parse(String(a.startedAt || a.createdAt)) - at) - Math.abs(Date.parse(String(b.startedAt || b.createdAt)) - at))[0] ||
      null;
    if (record) {
      const answered = row.duration > 0;
      const waiting = ["queued", "ringing", "in-progress"].includes(String(record.status || ""));
      const next: CallRecord = {
        ...record,
        // Kaydın kimliği zaten santral kimliğiyse ayrıca yazmaya gerek yok.
        providerCallId: record.providerCallId || (record.id === `pbx-${row.uid}` ? undefined : row.uid || undefined),
        recording: record.recording || row.recording || null,
        durationSeconds: row.duration > 0 ? row.duration : record.durationSeconds ?? 0,
        status: waiting ? (answered ? "ended" : "missed") : record.status,
        providerMeta: { ...(record.providerMeta || {}), report: true },
        updatedAt: new Date().toISOString(),
      };
      const changed =
        (next.recording || null) !== (record.recording || null) ||
        (next.durationSeconds ?? 0) !== (record.durationSeconds ?? 0) ||
        next.status !== record.status ||
        (next.providerCallId || "") !== (record.providerCallId || "");
      if (changed) {
        await store.put("call", record.id, next, owner);
        Object.assign(record, next);
        result.matched += 1;
      }
    } else {
      // CRM'de kaydı olmayan görüşme (ör. gelen arama): süzgeç varsa yalnız seçilen dahili/hatlar alınır.
      const passes =
        !filtered ||
        [parties.agent, row.line, extOf(row.source), extOf(row.destination)].some((value) => {
          const digits = String(value || "").replace(/\D/g, "");
          return digits ? (digits.length <= 6 ? only.exts.has(digits) : only.numbers.has(last10(digits))) : false;
        });
      if (!passes || !row.uid) continue;
      await deps.logCall(owner, {
        callId: row.uid,
        phone: parties.phone,
        direction: parties.direction,
        status: row.duration > 0 ? "answered" : "no-answer",
        durationSeconds: row.duration,
        startedAt: row.at || undefined,
        agent: parties.agent || undefined,
        line: normalizePhone(row.line).length >= 10 ? row.line : undefined,
        recordingUrl: row.recording || undefined,
        provider: NETSANTRAL_PROVIDER,
        createLead: parties.direction === "inbound",
      });
      record = (await store.get<CallRecord>("call", `pbx-${row.uid}`, owner))?.payload || null;
      if (record) {
        recent.push(record);
        result.created += 1;
      }
    }
    if (record?.recording && !(record.transcript || "").trim() && row.duration >= 5) toTranscribe.push(record.id);
  }
  if (callTranscribeEnabled())
    for (const id of [...new Set(toTranscribe)].slice(0, 5)) {
      const outcome = await transcribeCall(store, owner, id, (callId) => deps.analyze(owner, callId));
      if (outcome === "done") result.transcribed += 1;
    }
  return result;
}

let timer: NodeJS.Timeout | null = null;
let running = false;
/** Üç dakikada bir rapor çeker (Netgsm sınırı: dakikada en çok 2 sorgu). */
export function startNetsantralReportSync(store: Store, deps: ReportDeps): void {
  if (timer) return;
  const tick = async () => {
    if (running || !netsantralConfigured() || /^(kapali|kapalı|0|off)$/i.test(env("NETSANTRAL_REPORT_SYNC"))) return;
    running = true;
    try {
      const r = await syncNetsantralReport(store, deps);
      if (r.matched || r.created || r.transcribed) console.info("Netsantral raporu işlendi:", JSON.stringify(r));
    } catch (error) {
      console.warn("Netsantral raporu işlenemedi:", error instanceof Error ? error.message : "bilinmeyen hata");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 45_000).unref?.();
  timer = setInterval(() => void tick(), 3 * 60_000);
  timer.unref?.();
}
