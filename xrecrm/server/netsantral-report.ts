// Netsantral görüşme raporu (CDR): bildirim adresi başka bir yere bağlıyken de görüşmenin süresi ve
// ses kaydı CRM'e gelsin diye birkaç dakikada bir Netgsm'in rapor servisinden çekilir.
// İsteğe bağlı olarak kayıt yazıya dökülür ve mevcut görüşme analizi çalıştırılır.
import fs from "node:fs/promises";
import path from "node:path";
import type { Express, Request } from "express";
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

const recordingDir = () => path.join(path.resolve(env("XRE_DATA_DIR") || "data"), "call-recordings");
const safeName = (callId: string) => callId.replace(/[^\w.-]/g, "_").slice(0, 150);
const EXT_MIME: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" };
const extFor = (mime: string) => (/wav/.test(mime) ? "wav" : /ogg/.test(mime) ? "ogg" : /mp4|m4a/.test(mime) ? "m4a" : "mp3");

/**
 * Netgsm kayıt bağlantıları kısa süre sonra geçersiz kalabildiği için kayıt gelir gelmez indirilir
 * ve CRM'in veri klasöründe saklanır. Dosya henüz hazır değilse sonraki turda yeniden denenir (en çok 6 kez).
 */
export async function storeRecording(store: Store, owner: string, callId: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const record = (await store.get<CallRecord>("call", callId, owner))?.payload;
  if (!record?.recording) return null;
  if (typeof record.recordingFile === "string" && record.recordingFile) {
    const file = path.join(recordingDir(), path.basename(record.recordingFile));
    const buffer = await fs.readFile(file).catch(() => null);
    if (buffer) return { buffer, mime: EXT_MIME[file.split(".").pop() || ""] || "audio/mpeg" };
  }
  const meta = record.providerMeta || {};
  const tries = Number(meta.downloadTries) || 0;
  if (tries >= 6) return null;
  const audio = await downloadRecording(String(record.recording)).catch(() => null);
  if (!audio) {
    await store.put("call", callId, { ...record, providerMeta: { ...meta, downloadTries: tries + 1 } }, owner);
    return null;
  }
  const name = `${safeName(callId)}.${extFor(audio.mime)}`;
  await fs.mkdir(recordingDir(), { recursive: true });
  await fs.writeFile(path.join(recordingDir(), name), audio.buffer, { mode: 0o600 });
  await store.put("call", callId, { ...record, recordingFile: name, providerMeta: { ...meta, downloadTries: tries + 1 }, updatedAt: new Date().toISOString() }, owner);
  return audio;
}

/** Saklanan ses kaydını yalnız o görüşmeyi görebilen kullanıcıya verir. */
export function registerRecordingRoute(app: Express, store: Store): void {
  app.get("/api/calls/:id/recording", async (req: Request, res) => {
    const auth = (req as Request & { auth: { ownerOpenId: string } }).auth;
    const record = (await store.get<CallRecord>("call", String(req.params.id), auth.ownerOpenId).catch(() => null))?.payload;
    const name = typeof record?.recordingFile === "string" ? path.basename(record.recordingFile) : "";
    if (!name) return void res.status(404).json({ error: "NOT_FOUND", message: "Bu görüşmenin saklanmış ses kaydı yok." });
    const file = path.join(recordingDir(), name);
    const buffer = await fs.readFile(file).catch(() => null);
    if (!buffer) return void res.status(404).json({ error: "NOT_FOUND", message: "Ses kaydı dosyası bulunamadı." });
    res.setHeader("content-type", EXT_MIME[name.split(".").pop() || ""] || "audio/mpeg");
    res.setHeader("cache-control", "private, max-age=3600");
    res.setHeader("content-disposition", `inline; filename="gorusme.${name.split(".").pop()}"`);
    res.setHeader("accept-ranges", "none");
    res.end(buffer);
  });
}

/** Kaydı yazıya döker ve görüşme analizini sıraya alır. En çok iki kez denenir. */
export async function transcribeCall(store: Store, owner: string, callId: string, analyze: (callId: string) => Promise<unknown>): Promise<"done" | "skipped" | "failed"> {
  const record = (await store.get<CallRecord>("call", callId, owner))?.payload;
  if (!record || !record.recording || (record.transcript || "").trim()) return "skipped";
  const meta = record.providerMeta || {};
  const tries = Number(meta.transcribeTries) || 0;
  if (tries >= 2) return "skipped";
  const save = async (patch: Partial<CallRecord>, extra: Record<string, unknown>) => {
    // Kayıt bu arada güncellenmiş olabilir (ör. saklanan dosya adı); en güncel hâlinin üzerine yazılır.
    const fresh = (await store.get<CallRecord>("call", callId, owner))?.payload || record;
    return store.put("call", callId, { ...fresh, ...patch, providerMeta: { ...(fresh.providerMeta || {}), transcribeTries: tries + 1, ...extra }, updatedAt: new Date().toISOString() }, owner);
  };
  try {
    // Önce saklanan kopya kullanılır; yoksa indirilip saklanır.
    const audio = await storeRecording(store, owner, callId);
    // Dosya henüz hazır değilse deneme hakkı harcanmaz; sonraki turda yeniden bakılır.
    if (!audio) return "skipped";
    const ext = extFor(audio.mime);
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

/**
 * Ses kaydı gelmiş ama henüz yazıya dökülmemiş son görüşmeleri işler. Kayıt rapordan da
 * bildirim adresinden de gelmiş olabilir; ikisinde de analiz buradan başlar.
 */
export async function transcribePendingCalls(store: Store, deps: ReportDeps, now = new Date()): Promise<number> {
  const owner = await deps.ownerScope(store);
  // Yazıya dökme kapalı olsa da kayıtlar saklanır (bağlantı sonradan açılmayabiliyor).
  const unsaved = (await store.list<CallRecord>("call", owner))
    .map((r) => r.payload)
    .filter((c) => c && typeof c.recording === "string" && c.recording && !c.recordingFile && (Number(c.providerMeta?.downloadTries) || 0) < 6 && now.getTime() - Date.parse(String(c.startedAt || c.createdAt || "")) < 24 * 3_600_000)
    .slice(0, 8);
  for (const call of unsaved) await storeRecording(store, owner, call.id).catch(() => null);
  if (!callTranscribeEnabled()) return 0;
  const pending = (await store.list<CallRecord>("call", owner))
    .map((r) => r.payload)
    .filter(
      (c) =>
        c &&
        typeof c.recording === "string" &&
        c.recording &&
        !(c.transcript || "").trim() &&
        (Number(c.durationSeconds) || 0) >= 5 &&
        (Number(c.providerMeta?.transcribeTries) || 0) < 2 &&
        now.getTime() - Date.parse(String(c.startedAt || c.createdAt || "")) < 24 * 3_600_000,
    )
    .slice(0, 5);
  let done = 0;
  for (const call of pending) if ((await transcribeCall(store, owner, call.id, (callId) => deps.analyze(owner, callId))) === "done") done += 1;
  return done;
}

let timer: NodeJS.Timeout | null = null;
let running = false;
/** Üç dakikada bir rapor çeker (Netgsm sınırı: dakikada en çok 2 sorgu). */
export function startNetsantralReportSync(store: Store, deps: ReportDeps): void {
  if (timer) return;
  const tick = async () => {
    if (running || !netsantralConfigured()) return;
    running = true;
    try {
      if (!/^(kapali|kapalı|0|off)$/i.test(env("NETSANTRAL_REPORT_SYNC"))) {
        const r = await syncNetsantralReport(store, deps);
        if (r.matched || r.created || r.transcribed) console.info("Netsantral raporu işlendi:", JSON.stringify(r));
      }
    } catch (error) {
      console.warn("Netsantral raporu işlenemedi:", error instanceof Error ? error.message : "bilinmeyen hata");
    }
    try {
      const done = await transcribePendingCalls(store, deps);
      if (done) console.info("Görüşme yazıya döküldü ve analiz sıraya alındı:", done);
    } catch (error) {
      console.warn("Görüşme yazıya dökülemedi:", error instanceof Error ? error.message : "bilinmeyen hata");
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 45_000).unref?.();
  timer = setInterval(() => void tick(), 3 * 60_000);
  timer.unref?.();
}
