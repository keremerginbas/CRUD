import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FileUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import type { Lead } from "../data";
import type { Company, Contact } from "../suite";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  importRecordId,
  mapDelimitedRows,
  mapHeaders,
  type ParsedDelimitedFile,
  type ImportField,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDelimited,
  previewImportRows,
  type CrmImportKind,
  type ImportIssue,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportRawRow,
} from "../../../../shared/crm-import";
import "../data-quality.css";

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
  for (const item of preview.rows) {
    const raw = item.raw;
    const issues = [...item.issues];
    if (raw.companyId) {
      const company = visibleCompanies.find(
        (entry) => entry.id === raw.companyId,
      );
      if (!company)
        issues.push({
          code: "REFERENCE_NOT_VISIBLE",
          message: "Şirket bağlantısı bu kapsamda bulunamadı.",
        });
    } else if (raw.companyName) {
      const matches = visibleCompanies.filter(
        (entry) => normalizeName(entry.name) === normalizeName(raw.companyName),
      );
      if (matches.length === 1) raw.companyId = matches[0].id;
      else if (matches.length > 1)
        issues.push({
          code: "AMBIGUOUS_REFERENCE",
          message: "Şirket adı birden fazla görünür kayda karşılık geliyor.",
        });
      else
        issues.push({
          code: "REFERENCE_NOT_FOUND",
          message: "Şirket adı görünür mevcut bir şirketle eşleşmiyor.",
        });
    }
    if (
      kind === "leads" &&
      raw.contactId &&
      !visibleContacts.some((entry) => entry.id === raw.contactId)
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
  const [result, setResult] = useState<ImportCommitReport | null>(null);
  const fileGeneration = useRef(0);
  const sending = useRef(false);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operationRef = useRef<string | null>(null);
  const readyCount = useMemo(() => preview?.counts.ready || 0, [preview]);

  useEffect(() => {
    operationRef.current = null;
    setParsedFile(null);
    setMappedRows([]);
    setPreview(null);
    setResult(null);
    fileGeneration.current++;
  }, [demo, user?.openId, kind]);
  const selectFile = async (file?: File) => {
    if (!file) return;
    const generation = ++fileGeneration.current;
    operationRef.current = null;
    setResult(null);
    setMappedRows([]);
    setParsedFile(null);
    setError("");
    setPreview(null);
    setFileName(file.name);
    if (file.size > IMPORT_MAX_BYTES) {
      setError("Dosya 1 MB sınırını aşıyor.");
      return;
    }
    try {
      const parsed = parseDelimited(await file.text());
      if (generation !== fileGeneration.current) return;
      setParsedFile(parsed);
      setMapping(mapHeaders(parsed.headers, kind));
      const mapped = mapDelimitedRows(parsed, kind);
      if (mapped.length > IMPORT_MAX_ROWS)
        throw new Error("Dosya 1.000 veri satırından fazla içeriyor.");
      setMappedRows(mapped);
      if (demo) setPreview(localPreview(kind, mapped, data));
    } catch (cause) {
      setMappedRows([]);
      setError(cause instanceof Error ? cause.message : "Dosya okunamadı.");
    }
  };

  const changeMapping = (index: number, field: ImportField | null) => {
    if (!parsedFile) return;
    const updated = mapping.map((old, i) => (i === index ? field : old));
    setMapping(updated);
    setMappedRows(mapDelimitedRows(parsedFile, kind, updated));
    setPreview(null);
    setResult(null);
    operationRef.current = null;
  };
  const createPreview = async () => {
    if (!mappedRows.length) return;
    setBusy(true);
    setError("");
    try {
      if (demo) setPreview(localPreview(kind, mappedRows, data));
      else {
        if (mappedRows.some((r) => r.issues.length))
          throw new Error(
            "Sütun eşlemesini ve satırdaki fazla sütunları düzeltin.",
          );
        setPreview(
          await request("/api/crm-import/preview", {
            kind,
            rows: mappedRows.map((row) => row.raw),
          }),
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Önizleme oluşturulamadı.",
      );
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!mappedRows.length || busy || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const operationId =
      operationRef.current ||
      (crypto.randomUUID ? crypto.randomUUID() : `import-${Date.now()}`);
    operationRef.current = operationId;
    try {
      let report: ImportCommitReport;
      if (demo) {
        const current = localPreview(kind, mappedRows, data);
        let created = 0;
        const rows: ImportPreviewRow[] = [];
        const owner = user?.name || "Demo çalışma alanı";
        for (const row of current.rows) {
          const output = { ...row, issues: [...row.issues] };
          if (output.status === "ready") {
            const entity = demoEntity(kind, output.raw, data, owner);
            try {
              if (kind === "leads") await saveLead(entity as Lead);
              else await saveRecord(kind, entity as any);
              output.candidateId = entity.id;
              (output as ImportPreviewRow & { created?: boolean }).created =
                true;
              created++;
            } catch (cause) {
              output.status = "error";
              output.issues = [
                {
                  code: "WRITE_FAILED",
                  message:
                    cause instanceof Error
                      ? cause.message
                      : "Kayıt yazılamadı.",
                },
              ];
            }
          }
          rows.push(output);
        }
        report = {
          counts: {
            total: rows.length,
            created,
            skipped: rows.filter((row) => row.status === "duplicate").length,
            errors: rows.filter((row) => row.status === "error").length,
          },
          rows,
        };
      } else {
        report = await request("/api/crm-import/commit", {
          kind,
          rows: mappedRows.map((row) => row.raw),
          operationId,
        });
        await refresh();
      }
      onImported?.(report);
      setResult(report);
      if (report.counts.errors)
        toast.warning(
          `${report.counts.created} kayıt eklendi; ${report.counts.errors} satır düzeltme bekliyor.`,
        );
      else
        toast.success(
          `${report.counts.created} yeni kayıt eklendi; ${report.counts.skipped} mükerrer atlandı.`,
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "İçe aktarma tamamlanamadı.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

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
              CSV veya TSV yükleyin. Mevcut kayıtlar değiştirilmez; yalnızca
              yeni kayıtlar eklenir.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="İçe aktarmayı kapat"
          >
            <X size={18} />
          </button>
        </header>
        <div className="dq-import-body">
          <label className="dq-file-drop">
            <FileUp size={24} />
            <strong>
              {result ? "Yeni dosya seçin" : "CSV / TSV dosyası seçin"}
            </strong>
            <span>En fazla 1 MB ve 1.000 veri satırı</span>
            <input
              disabled={busy}
              aria-label="CSV dosyası seç"
              type="file"
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={(event) => void selectFile(event.target.files?.[0])}
            />
          </label>
          {fileName && (
            <p className="dq-file-name">
              {fileName} · {mappedRows.length} veri satırı
            </p>
          )}
          {parsedFile && !result && (
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
                      disabled={busy}
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
          {result && (
            <section className="dq-import-result" role="status">
              <h3>Aktarım sonucu</h3>
              <p>
                {result.counts.created} yeni kayıt ·{" "}
                {result.counts.recovered || 0} daha önce eklenmiş kayıt ·{" "}
                {result.counts.skipped} mükerrer · {result.counts.errors} hatalı
                satır
              </p>
              {result.rows
                .filter((row) => row.status === "error")
                .map((row) => (
                  <p key={row.rowNumber}>
                    Satır {row.rowNumber}:{" "}
                    {row.issues.map((i) => i.message).join(" ")}
                  </p>
                ))}
              <button className="btn primary" onClick={onClose}>
                Sonucu kapat
              </button>
            </section>
          )}
          {error && (
            <div className="dq-import-error" role="alert">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          {!result && mappedRows.length > 0 && !preview && (
            <button
              type="button"
              className="btn primary"
              onClick={() => void createPreview()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}{" "}
              Önizlemeyi oluştur
            </button>
          )}
          {!result && preview && (
            <>
              <div className="dq-import-summary" aria-label="Önizleme özeti">
                <span>
                  <b>{preview.counts.total}</b> satır
                </span>
                <span className="ready">
                  <b>{preview.counts.ready}</b> hazır
                </span>
                <span className="duplicate">
                  <b>{preview.counts.duplicate}</b> mükerrer
                </span>
                <span className="error">
                  <b>{preview.counts.error}</b> hatalı
                </span>
              </div>
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
                    {preview.rows.slice(0, 1000).map((row) => (
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
                    setPreview(null);
                    operationRef.current = null;
                  }}
                  disabled={busy}
                >
                  Dosyayı değiştir
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void commit()}
                  disabled={busy || !readyCount}
                >
                  {busy ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}{" "}
                  {readyCount} yeni kaydı içe aktar
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
