import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, Check, FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import type { Lead } from "../data";
import type { Company, Contact } from "../suite";
import {
  formatImportBytes,
  formatImportCount,
  importRecordId,
  mapDelimitedRows,
  mapHeaders,
  type ParsedDelimitedFile,
  type ImportField,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDelimited,
  normalizeImportTable,
  previewImportRows,
  type CrmImportKind,
  type ImportIssue,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRawRow,
} from "../../../../shared/crm-import";
import {
  IMPORT_PREVIEW_HEAD_ROWS,
  IMPORT_TOTAL_MAX_CSV_BYTES,
  IMPORT_TOTAL_MAX_ROWS,
  IMPORT_TOTAL_MAX_XLSX_BYTES,
  IMPORT_TOTAL_MAX_XLSX_UNZIPPED,
  createCommitAccumulator,
  createPreviewAccumulator,
  planImportChunks,
  remapChunkRows,
  runImportChunks,
  type ImportChunk,
  type ImportCommitSummary,
  type ImportPlan,
  type ImportPreviewSummary,
} from "../../../../shared/crm-import-chunks";
import "../data-quality.css";
import "../import-progress.css";

export interface ImportWizardProps {
  kind: CrmImportKind;
  onClose: () => void;
  onImported?: (report: ImportCommitReport) => void;
}
export interface ImportCommitReport {
  counts: {
    total: number;
    created: number;
    recovered?: number;
    skipped: number;
    errors: number;
  };
  /** Büyük dosyalarda yalnızca hatalı satırlar (sınıra kadar) taşınır. */
  rows: ImportPreviewRow[];
}

type MappedRow = {
  rowNumber: number;
  raw: ImportRawRow;
  issues: ImportIssue[];
};
const labels: Record<CrmImportKind, string> = {
  contacts: "kişiler",
  companies: "şirketler",
  leads: "müşteriler",
};

function localPreview(
  kind: CrmImportKind,
  rows: MappedRow[],
  data: { contacts: Contact[]; companies: Company[]; leads: Lead[] },
): ImportPreview {
  const preview = previewImportRows(kind, rows, {
    contacts: data.contacts,
    companies: data.companies,
    leads: data.leads,
  });
  const visibleCompanies = data.companies;
  const visibleContacts = data.contacts;
  // Satır başına tüm şirketleri taramamak için ad dizini bir kez kurulur.
  const companiesByName = new Map<string, Company[]>();
  for (const entry of visibleCompanies) {
    const key = normalizeName(entry.name);
    const list = companiesByName.get(key);
    if (list) list.push(entry);
    else companiesByName.set(key, [entry]);
  }
  const companyIds = new Set(visibleCompanies.map((entry) => entry.id));
  const contactIds = new Set(visibleContacts.map((entry) => entry.id));
  for (const item of preview.rows) {
    const raw = item.raw;
    const issues = [...item.issues];
    if (raw.companyId) {
      if (!companyIds.has(String(raw.companyId)))
        issues.push({
          code: "REFERENCE_NOT_VISIBLE",
          message: "Şirket bağlantısı bu kapsamda bulunamadı.",
        });
    } else if (raw.companyName) {
      const matches =
        companiesByName.get(normalizeName(raw.companyName)) || [];
      if (matches.length === 1) raw.companyId = matches[0].id;
      else if (matches.length > 1)
        issues.push({
          code: "AMBIGUOUS_REFERENCE",
          message: "Şirket adı birden fazla görünür kayda karşılık geliyor.",
        });
      else if (kind !== "leads")
        issues.push({
          code: "REFERENCE_NOT_FOUND",
          message:
            "Şirket adı mevcut bir şirketle eşleşmiyor. Önce şirketleri içe aktarın veya bu sütunu atlayın.",
        });
    }
    if (
      kind === "leads" &&
      raw.contactId &&
      !contactIds.has(String(raw.contactId))
    )
      issues.push({
        code: "REFERENCE_NOT_VISIBLE",
        message: "Kişi bağlantısı bu kapsamda bulunamadı.",
      });
    item.issues = [
      ...new Map(
        issues.map((entry) => [`${entry.code}:${entry.message}`, entry]),
      ).values(),
    ];
    if (item.issues.length && item.status === "ready") item.status = "error";
  }
  preview.counts = {
    total: preview.rows.length,
    ready: preview.rows.filter((row) => row.status === "ready").length,
    duplicate: preview.rows.filter((row) => row.status === "duplicate").length,
    error: preview.rows.filter((row) => row.status === "error").length,
  };
  return preview;
}

function demoEntity(
  kind: CrmImportKind,
  raw: ImportRawRow,
  data: { contacts: Contact[]; companies: Company[]; leads: Lead[] },
  owner: string,
) {
  const stamp = new Date().toISOString();
  const id = importRecordId(kind, raw);
  const company = raw.companyId
    ? data.companies.find((entry) => entry.id === raw.companyId)
    : raw.companyName
      ? data.companies.find(
          (entry) =>
            normalizeName(entry.name) === normalizeName(raw.companyName),
        )
      : undefined;
  const companyId = company?.id || String(raw.companyId || "");
  const companyName = company?.name || String(raw.companyName || "");
  const phone = normalizePhone(raw.phone);
  const email = normalizeEmail(raw.email);
  if (kind === "contacts") {
    return {
      id,
      name: String(raw.name || "").trim(),
      phone,
      email,
      companyId,
      owner,
      tags: [],
      notes: String(raw.notes || ""),
      createdAt: stamp,
      updatedAt: stamp,
    } as Contact;
  }
  if (kind === "companies") {
    return {
      id,
      name: String(raw.name || raw.companyName || "").trim(),
      industry: "",
      phone,
      email,
      website: "",
      address: "",
      owner,
      notes: String(raw.notes || ""),
      createdAt: stamp,
      updatedAt: stamp,
    } as Company;
  }
  return {
    id,
    name: String(raw.name || "").trim(),
    phone,
    email,
    company: companyName,
    companyId: companyId || undefined,
    contactId: raw.contactId || undefined,
    city: raw.city || undefined,
    stage: "new",
    owner,
    value: 0,
    source: String(raw.source || "").trim(),
    notes: String(raw.notes || ""),
    tags: [],
    createdAt: stamp,
    lastActivity: stamp,
  } as Lead;
}

function statusLabel(row: ImportPreviewRow): string {
  if (row.status === "ready") return "Hazır";
  if (row.status === "duplicate") return "Atlandı: mükerrer";
  return "Hata";
}

type Phase =
  | "idle"
  | "reading"
  | "previewing"
  | "previewed"
  | "committing"
  | "paused"
  | "done";
type CommitRow = ImportPreviewRow & { created?: boolean; recovered?: boolean };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/**
 * Tarayıcının ilerlemeyi çizebilmesi için bir sonraki kareye kadar bekler.
 * Arka plandaki sekmede kare gelmez; zamanlayıcı yedeği döngünün takılmasını önler.
 */
const nextPaint = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 60);
    if (typeof requestAnimationFrame === "function")
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        setTimeout(resolve, 0);
      });
  });

/**
 * Demo çalışma alanı tarayıcının localStorage alanında saklanır (store.tsx) ve bu
 * alanın kotası yaklaşık 5 milyon karakterdir. Kota aşılırsa uygulama çöker; bu yüzden
 * demo aktarımı kotaya yaklaşınca parça sınırında durdurulur.
 */
const DEMO_STORAGE_KEY = "xre-demo-v2";
const DEMO_STORAGE_BUDGET = 4_200_000;
/** Her kayıtla birlikte yazılan demo olay kaydı için yaklaşık pay. */
const DEMO_RECORD_OVERHEAD = 480;
function demoStorageChars(fallback: unknown): number {
  try {
    const stored = localStorage.getItem(DEMO_STORAGE_KEY);
    if (stored) return stored.length;
  } catch {
    /* depolama kapalı */
  }
  return JSON.stringify(fallback).length;
}
const fmt = formatImportCount;

function ProgressBar({
  label,
  done,
  total,
}: {
  label: string;
  done: number;
  total: number;
}) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="dq-import-progress">
      <div className="dq-import-progress-text" aria-live="polite">
        <span>
          {label} {fmt(done)} / {fmt(total)}
        </span>
        <span>%{percent}</span>
      </div>
      <div
        className="dq-import-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function ImportWizard({
  kind,
  onClose,
  onImported,
}: ImportWizardProps) {
  const { data, demo, user, request, saveRecord, saveLead, refresh } =
    useStore();
  const [parsedFile, setParsedFile] = useState<ParsedDelimitedFile | null>(
    null,
  );
  const [mapping, setMapping] = useState<Array<ImportField | null>>([]);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [report, setReport] = useState<ImportCommitSummary | null>(null);
  const [pause, setPause] = useState<{
    reason: "stopped" | "failed";
    message?: string;
  } | null>(null);
  const [stopping, setStopping] = useState(false);

  // Her dosya/eşleme/oturum değişiminde artar; süren parça döngüsü kendini durdurur.
  const generation = useRef(0);
  const stopRequested = useRef(false);
  const running = useRef(false);
  // Önizleme ile commit aynı planı kullanır: parçalar ve operationId'ler sabit kalır,
  // böylece yarıda kalan aktarım aynı kimliklerle kaldığı yerden sürdürülebilir.
  const planRef = useRef<ImportPlan | null>(null);
  const commitAcc = useRef<ReturnType<typeof createCommitAccumulator> | null>(
    null,
  );
  const nextChunk = useRef(0);
  const demoSavedIds = useRef(new Set<string>());
  const demoChars = useRef(0);
  // Demo döngüsü birden çok render boyunca sürer; en güncel veriyi/kaydedicileri okur.
  const live = useRef({ data, saveLead, saveRecord });
  live.current = { data, saveLead, saveRecord };

  const busy =
    phase === "reading" || phase === "previewing" || phase === "committing";
  const readyCount = useMemo(() => preview?.counts.ready || 0, [preview]);

  const resetRun = () => {
    // Süren döngü nesil değişimini görüp sessizce biter; yeni çalıştırmaya izin ver.
    generation.current++;
    running.current = false;
    stopRequested.current = false;
    planRef.current = null;
    commitAcc.current = null;
    nextChunk.current = 0;
    demoSavedIds.current = new Set();
    setPreview(null);
    setReport(null);
    setPause(null);
    setStopping(false);
    setProgress({ done: 0, total: 0 });
  };

  useEffect(() => {
    resetRun();
    setParsedFile(null);
    setMappedRows([]);
    setPhase("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, user?.openId, kind]);
  useEffect(
    () => () => {
      // Pencere kapanırsa süren döngü bir sonraki parçadan önce durur.
      generation.current++;
    },
    [],
  );

  const demoRows = (chunk: ImportChunk): MappedRow[] =>
    chunk.rows.map((raw, index) => ({
      // Sunucuyla aynı sözleşme: parça-göreli numara; remapChunkRows dosya numarasına çevirir.
      rowNumber: index + 2,
      raw,
      issues: chunk.issues[index],
    }));

  const runPreview = async (rows: MappedRow[]) => {
    if (!rows.length || running.current) return;
    resetRun();
    const current = generation.current;
    setError("");
    let plan: ImportPlan;
    try {
      if (!demo && rows.some((row) => row.issues.length))
        throw new Error(
          "Sütun eşlemesini ve satırdaki fazla sütunları düzeltin.",
        );
      plan = planImportChunks(kind, rows);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Önizleme oluşturulamadı.",
      );
      return;
    }
    planRef.current = plan;
    const acc = createPreviewAccumulator();
    acc.add(plan.fileDuplicates);
    running.current = true;
    setPhase("previewing");
    setProgress({ done: plan.fileDuplicates.length, total: plan.totalRows });
    const outcome = await runImportChunks<{ rows: ImportPreviewRow[] }>({
      chunks: plan.chunks,
      send: async (chunk) => {
        if (!demo)
          return request("/api/crm-import/preview", { kind, rows: chunk.rows });
        const local = localPreview(kind, demoRows(chunk), live.current.data);
        if (chunk.index < plan.chunks.length - 1) await nextPaint();
        return local;
      },
      onChunk: (chunk, response) => {
        if (current !== generation.current) return;
        acc.add(remapChunkRows(chunk, response.rows));
        setProgress({ done: acc.summary().processed, total: plan.totalRows });
      },
      shouldStop: () =>
        stopRequested.current || current !== generation.current,
    });
    if (current !== generation.current) return;
    running.current = false;
    setStopping(false);
    stopRequested.current = false;
    if (outcome.status === "done") {
      setPreview(acc.summary());
      setPhase("previewed");
      return;
    }
    planRef.current = null;
    setPhase("idle");
    if (outcome.status === "failed")
      setError(
        outcome.error instanceof Error
          ? outcome.error.message
          : "Önizleme oluşturulamadı.",
      );
  };

  const selectFile = async (file?: File) => {
    if (!file || running.current) return;
    resetRun();
    const current = generation.current;
    setMappedRows([]);
    setParsedFile(null);
    setError("");
    setPhase("idle");
    setFileName(file.name);
    const excel = /\.xlsx$/i.test(file.name);
    if (/\.xls$/i.test(file.name)) {
      setError("Eski .xls biçimi desteklenmiyor. Excel'de \"Farklı kaydet\" ile .xlsx seçin.");
      return;
    }
    const maxBytes = excel
      ? IMPORT_TOTAL_MAX_XLSX_BYTES
      : IMPORT_TOTAL_MAX_CSV_BYTES;
    if (file.size > maxBytes) {
      setError(
        `${excel ? "Excel dosyası" : "Dosya"} ${formatImportBytes(maxBytes)} sınırını aşıyor.`,
      );
      return;
    }
    setPhase("reading");
    try {
      const parsed = normalizeImportTable(
        excel
          ? (await import("../../../../shared/xlsx-read")).parseXlsx(
              new Uint8Array(await file.arrayBuffer()),
              {
                maxBytes,
                maxRows: IMPORT_TOTAL_MAX_ROWS,
                maxUnzippedBytes: IMPORT_TOTAL_MAX_XLSX_UNZIPPED,
              },
            )
          : parseDelimited(await file.text(), {
              maxBytes,
              maxRows: IMPORT_TOTAL_MAX_ROWS,
            }),
      );
      if (current !== generation.current) return;
      const mapped = mapDelimitedRows(parsed, kind);
      if (mapped.length > IMPORT_TOTAL_MAX_ROWS)
        throw new Error(
          `Dosya ${fmt(IMPORT_TOTAL_MAX_ROWS)} veri satırından fazla içeriyor.`,
        );
      setParsedFile(parsed);
      setMapping(mapHeaders(parsed.headers, kind));
      setMappedRows(mapped);
      setPhase("idle");
      if (demo) void runPreview(mapped);
    } catch (cause) {
      if (current !== generation.current) return;
      setMappedRows([]);
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "Dosya okunamadı.");
    }
  };

  const changeMapping = (index: number, field: ImportField | null) => {
    if (!parsedFile || phase === "committing") return;
    const updated = mapping.map((old, i) => (i === index ? field : old));
    // Süren önizleme varsa iptal edilir; plan ve operationId'ler yeniden üretilecek.
    resetRun();
    setPhase("idle");
    setMapping(updated);
    setMappedRows(mapDelimitedRows(parsedFile, kind, updated));
  };

  /** Demo: bir parçayı tarayıcıdaki veriye yazar; sunucu commit yanıtıyla aynı biçimi döndürür. */
  const demoCommitChunk = async (chunk: ImportChunk) => {
    const state = live.current.data;
    const current = localPreview(kind, demoRows(chunk), state);
    const existingIds = new Set<string>(
      (state[kind] as Array<{ id: string }>).map((entry) => entry.id),
    );
    const owner = user?.name || "Demo çalışma alanı";
    const rows: CommitRow[] = [];
    const entities = new Map<number, ReturnType<typeof demoEntity>>();
    // Yazım, React çizimi bitene kadar localStorage'a yansımaz; kendi sayacımızı da tut.
    demoChars.current = Math.max(demoChars.current, demoStorageChars(state));
    let cost = 0;
    for (const row of current.rows) {
      if (row.status !== "ready") continue;
      const entity = demoEntity(kind, row.raw, state, owner);
      entities.set(row.rowNumber, entity);
      if (!existingIds.has(entity.id) && !demoSavedIds.current.has(entity.id))
        cost +=
          JSON.stringify(entity).length +
          String(entity.name).length +
          DEMO_RECORD_OVERHEAD;
    }
    // Parça sığmıyorsa hiçbir satırı yazmadan dur: parça ya tamamen işlenir ya hiç.
    if (demoChars.current + cost > DEMO_STORAGE_BUDGET)
      throw new Error(
        "Demo çalışma alanı tarayıcı belleğinde saklanır ve doldu; kalan satırlar eklenmedi. Gerçek hesapta dosyanın tamamı sunucuya aktarılır.",
      );
    demoChars.current += cost;
    for (const row of current.rows) {
      const output: CommitRow = { ...row, issues: [...row.issues] };
      if (output.status === "ready") {
        const entity = entities.get(row.rowNumber)!;
        output.candidateId = entity.id;
        if (existingIds.has(entity.id) || demoSavedIds.current.has(entity.id)) {
          // Aynı içerikli kayıt daha önce eklenmiş: yeniden yazma.
          output.recovered = true;
        } else {
          try {
            // Demo verisi değişince tüm çalışma alanı yeniden çizilir. Yazmayı geçiş
            // (transition) olarak işaretlemek, ilerleme çubuğunun her kayıtta bu ağır
            // çizimi beklemesini önler; hata yine de bu satıra döner.
            let saved: Promise<void> = Promise.resolve();
            startTransition(() => {
              saved =
                kind === "leads"
                  ? live.current.saveLead(entity as Lead)
                  : live.current.saveRecord(kind, entity as any);
              saved.catch(() => undefined);
            });
            await saved;
            demoSavedIds.current.add(entity.id);
            output.created = true;
          } catch (cause) {
            delete output.candidateId;
            output.status = "error";
            output.issues = [
              {
                code: "WRITE_FAILED",
                message:
                  cause instanceof Error ? cause.message : "Kayıt yazılamadı.",
              },
            ];
          }
        }
      }
      rows.push(output);
    }
    await nextPaint();
    return { rows };
  };

  const commit = async (resume = false) => {
    const plan = planRef.current;
    if (!plan || running.current) return;
    if (!resume || !commitAcc.current) {
      const fresh = createCommitAccumulator();
      fresh.addSkipped(plan.fileDuplicates);
      commitAcc.current = fresh;
      nextChunk.current = 0;
      demoChars.current = 0;
    }
    const acc = commitAcc.current!;
    const current = generation.current;
    const startedAt = nextChunk.current;
    running.current = true;
    stopRequested.current = false;
    setStopping(false);
    setError("");
    setPause(null);
    setPhase("committing");
    setProgress({ done: acc.summary().counts.total, total: plan.totalRows });
    // Tıklama olayının dışına çık: aksi hâlde demo yazımlarının her biri eşzamanlı
    // (olay öncelikli) ayrı bir çizim başlatır.
    if (demo) await tick();
    const outcome = await runImportChunks<{ rows: CommitRow[] }>({
      chunks: plan.chunks,
      startAt: startedAt,
      send: (chunk) =>
        demo
          ? demoCommitChunk(chunk)
          : request("/api/crm-import/commit", {
              kind,
              rows: chunk.rows,
              // Parçaya özgü sabit kimlik: yeniden denemede sunucu kayıtlı yanıtı döndürür.
              operationId: chunk.operationId,
            }),
      onChunk: (chunk, response) => {
        acc.add(remapChunkRows(chunk, response.rows));
        nextChunk.current = chunk.index + 1;
        if (current === generation.current)
          // Demo yazımları geçiş (transition) olarak sürerken olağan öncelikli güncelleme
          // çizilmez; ilerleme çubuğunu eşzamanlı güncelle (yalnızca bu bileşen çizilir).
          flushSync(() =>
            setProgress({
              done: acc.summary().counts.total,
              total: plan.totalRows,
            }),
          );
      },
      shouldStop: () =>
        stopRequested.current || current !== generation.current,
    });
    if (!demo && nextChunk.current > startedAt)
      await refresh().catch(() => undefined);
    if (current !== generation.current) return;
    running.current = false;
    const summary = acc.summary();
    setReport(summary);
    setStopping(false);
    stopRequested.current = false;
    if (outcome.status !== "done") {
      setPause({
        reason: outcome.status,
        message:
          outcome.status === "failed"
            ? outcome.error instanceof Error
              ? outcome.error.message
              : "İçe aktarma tamamlanamadı."
            : undefined,
      });
      setPhase("paused");
      return;
    }
    setPhase("done");
    onImported?.({ counts: summary.counts, rows: summary.errorRows });
    if (summary.counts.errors)
      toast.warning(
        `${fmt(summary.counts.created)} kayıt eklendi; ${fmt(summary.counts.errors)} satır düzeltme bekliyor.`,
      );
    else
      toast.success(
        `${fmt(summary.counts.created)} yeni kayıt eklendi; ${fmt(summary.counts.skipped)} mükerrer atlandı.`,
      );
  };

  const requestStop = () => {
    stopRequested.current = true;
    setStopping(true);
  };

  const finished = phase === "done" || phase === "paused";
  const hiddenPreviewRows = preview
    ? preview.counts.total - preview.rows.length
    : 0;

  return (
    <div
      className="dq-import-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crm-import-title"
    >
      <section className="dq-import-dialog panel">
        <header className="dq-import-header">
          <div>
            <span className="eyebrow">VERİ KALİTESİ</span>
            <h2 id="crm-import-title">{labels[kind]} içe aktar</h2>
            <p>
              Excel (.xlsx) veya CSV yükleyin. Mevcut kayıtlar değiştirilmez; yalnızca
              yeni kayıtlar eklenir.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={phase === "committing"}
            title={
              phase === "committing"
                ? "Aktarım sürüyor; kapatmak için önce durdurun."
                : undefined
            }
            aria-label="İçe aktarmayı kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="dq-import-body">
          <label className="dq-file-drop">
            <FileUp size={24} />
            <strong>
              {finished ? "Yeni dosya seçin" : "Excel veya CSV dosyası seçin"}
            </strong>
            <span>
              Sütunlar otomatik eşlenir · en fazla{" "}
              {fmt(IMPORT_TOTAL_MAX_ROWS)} satır · CSV{" "}
              {formatImportBytes(IMPORT_TOTAL_MAX_CSV_BYTES)}, Excel{" "}
              {formatImportBytes(IMPORT_TOTAL_MAX_XLSX_BYTES)}
            </span>
            <input
              disabled={busy}
              aria-label="CSV dosyası seç"
              type="file"
              accept=".xlsx,.csv,.tsv,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const input = event.target;
                void selectFile(input.files?.[0]).finally(() => {
                  // Aynı dosya yeniden seçilebilsin.
                  input.value = "";
                });
              }}
            />
          </label>
          {fileName && (
            <p className="dq-file-name">
              {fileName} ·{" "}
              {phase === "reading"
                ? "dosya okunuyor…"
                : `${fmt(mappedRows.length)} veri satırı`}
            </p>
          )}
          {parsedFile && !finished && phase !== "committing" && (
            <section className="dq-column-mapping">
              <h3>Sütun eşleme</h3>
              <p>
                Otomatik seçilen alanları kontrol edin; gereksiz sütunları
                atlayın.
              </p>
              <div>
                {parsedFile.headers.map((header, i) => (
                  <label key={i}>
                    <span>{header || `Sütun ${i + 1}`}</span>
                    <select
                      aria-label={`${header || i + 1} sütun eşlemesi`}
                      value={mapping[i] || ""}
                      onChange={(e) =>
                        changeMapping(
                          i,
                          (e.target.value || null) as ImportField | null,
                        )
                      }
                    >
                      <option value="">Atla</option>
                      {Object.entries({
                        name: "Ad / unvan",
                        phone: "Telefon",
                        email: "E-posta",
                        companyId: "Bağlı şirket ID",
                        companyName: "Bağlı şirket adı",
                        contactId: "Bağlı kişi ID",
                        city: "Şehir",
                        source: "Kaynak",
                        notes: "Notlar",
                      })
                        .filter(
                          ([field]) =>
                            kind !== "companies" ||
                            ["name", "phone", "email", "notes"].includes(field),
                        )
                        .map(([field, label]) => (
                          <option key={field} value={field}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>
          )}
          {phase === "previewing" && (
            <div className="dq-import-running">
              <ProgressBar
                label="Kontrol ediliyor"
                done={progress.done}
                total={progress.total}
              />
              <button
                type="button"
                className="btn secondary"
                onClick={requestStop}
                disabled={stopping}
              >
                {stopping ? "Durduruluyor…" : "Durdur"}
              </button>
            </div>
          )}
          {phase === "committing" && (
            <div className="dq-import-running">
              <ProgressBar
                label="İçe aktarılıyor"
                done={progress.done}
                total={progress.total}
              />
              <button
                type="button"
                className="btn secondary"
                onClick={requestStop}
                disabled={stopping}
              >
                {stopping ? "Durduruluyor…" : "Durdur"}
              </button>
              <p className="dq-import-note">
                {stopping
                  ? "Gönderilen parça tamamlanınca durur; eklenen kayıtlar korunur."
                  : "Pencereyi kapatmayın. Durdurursanız o ana kadar eklenen kayıtlar korunur."}
              </p>
            </div>
          )}
          {finished && report && (
            <section className="dq-import-result" role="status">
              <h3>
                {phase === "done"
                  ? "Aktarım sonucu"
                  : pause?.reason === "failed"
                    ? "Aktarım yarıda kaldı"
                    : "Aktarım durduruldu"}
              </h3>
              {phase === "paused" && (
                <p>
                  {fmt(report.counts.total)} / {fmt(progress.total)} satır
                  işlendi. Kalan satırlar eklenmedi; kaldığı yerden devam
                  ederseniz daha önce eklenenler yeniden eklenmez.
                </p>
              )}
              <p>
                {fmt(report.counts.created)} yeni kayıt ·{" "}
                {fmt(report.counts.recovered)} daha önce eklenmiş kayıt ·{" "}
                {fmt(report.counts.skipped)} mükerrer ·{" "}
                {fmt(report.counts.errors)} hatalı satır
              </p>
              {pause?.message && (
                <p className="dq-import-result-error">{pause.message}</p>
              )}
              {report.errorRows.length > 0 && (
                <div className="dq-import-error-list">
                  {report.errorRows.map((row) => (
                    <p key={row.rowNumber}>
                      Satır {row.rowNumber}:{" "}
                      {row.issues.map((i) => i.message).join(" ")}
                    </p>
                  ))}
                  {report.omittedErrors > 0 && (
                    <p>
                      … ve {fmt(report.omittedErrors)} hatalı satır daha.
                    </p>
                  )}
                </div>
              )}
              <div className="dq-import-actions">
                {phase === "paused" && (
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => void commit(true)}
                  >
                    <Check size={16} />{" "}
                    {pause?.reason === "failed"
                      ? "Kaldığı yerden yeniden dene"
                      : "Kaldığı yerden devam et"}
                  </button>
                )}
                <button
                  type="button"
                  className={phase === "done" ? "btn primary" : "btn secondary"}
                  onClick={onClose}
                >
                  Sonucu kapat
                </button>
              </div>
            </section>
          )}
          {error && (
            <div className="dq-import-error" role="alert">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          {phase === "idle" && mappedRows.length > 0 && !preview && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void runPreview(mappedRows)}
            >
              <Check size={16} /> Önizlemeyi oluştur
            </button>
          )}
          {phase === "reading" && (
            <p className="dq-import-note">
              <Loader2 className="spin" size={14} /> Dosya okunuyor…
            </p>
          )}
          {phase === "previewed" && preview && (
            <>
              <div className="dq-import-summary" aria-label="Önizleme özeti">
                <span>
                  <b>{fmt(preview.counts.total)}</b> satır
                </span>
                <span className="ready">
                  <b>{fmt(preview.counts.ready)}</b> hazır
                </span>
                <span className="duplicate">
                  <b>{fmt(preview.counts.duplicate)}</b> mükerrer
                </span>
                <span className="error">
                  <b>{fmt(preview.counts.error)}</b> hatalı
                </span>
              </div>
              {hiddenPreviewRows > 0 && (
                <p className="dq-import-note">
                  Tabloda ilk {fmt(IMPORT_PREVIEW_HEAD_ROWS)} satır ve hatalı
                  satırlar gösteriliyor; {fmt(hiddenPreviewRows)} satır daha
                  var.
                  {preview.omittedErrors > 0 &&
                    ` ${fmt(preview.omittedErrors)} hatalı satır listeye sığmadı.`}
                </p>
              )}
              <div className="dq-import-table-wrap">
                <table className="dq-import-table">
                  <thead>
                    <tr>
                      <th>Satır</th>
                      <th>Ad</th>
                      <th>Telefon</th>
                      <th>E-posta</th>
                      <th>Durum</th>
                      <th>Sorun</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>
                          {String(row.raw.name || row.raw.companyName || "—")}
                        </td>
                        <td>{String(row.raw.phone || "—")}</td>
                        <td>{String(row.raw.email || "—")}</td>
                        <td>
                          <span className={`dq-status dq-status-${row.status}`}>
                            {statusLabel(row)}
                          </span>
                        </td>
                        <td>
                          {row.issues.length
                            ? row.issues.map((item) => item.message).join(" ")
                            : row.candidateId
                              ? `Aday: ${row.candidateId}`
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="dq-import-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    resetRun();
                    setPhase("idle");
                  }}
                >
                  Dosyayı değiştir
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void commit()}
                  disabled={!readyCount}
                >
                  <Check size={16} /> {fmt(readyCount)} yeni kaydı içe aktar
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
