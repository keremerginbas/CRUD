// Daireleri Excel/CSV dosyasından seçilen projeye toplu içe aktarma.
// Dosya tarayıcıda okunur (müşteri içe aktarmasının ayrıştırıcılarıyla); sütunlar Türkçe
// başlıklara göre kendiliğinden eşlenir, satır hataları önizlemede gösterilir.
import { useMemo, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { parseDelimited } from "../../../../../shared/crm-import";
import { formatPrice, type Project, type Unit } from "../../../../../shared/real-estate";
import {
  UNIT_IMPORT_MAX_COLUMNS,
  UNIT_IMPORT_MAX_ROWS,
  mapUnitHeaders,
  planUnitImport,
  previewUnitImport,
  unitImportFields,
  unitImportLabels,
  type DuplicateMode,
  type UnitImportField,
} from "../../../../../shared/unit-import";
import { Modal } from "../ui";
import type { ImportResult, InventoryStore } from "../../projects";
import { statusLabel } from "./UnitExplorer";

const CSV_MAX_BYTES = 5_000_000;
const XLSX_MAX_BYTES = 10_000_000;
const PREVIEW_ROWS = 50;
const ERROR_ROWS = 100;

/** CSV metnini çözer: UTF-8 değilse Türkçe Windows kodlaması (1254) denenir. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1254").decode(bytes);
  }
}

async function readTable(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const excel = /\.xlsx$/i.test(file.name);
  if (!excel && !/\.(csv|tsv|txt)$/i.test(file.name)) throw new Error("Yalnız .xlsx, .csv veya .tsv dosyası yüklenebilir.");
  if (file.size > (excel ? XLSX_MAX_BYTES : CSV_MAX_BYTES)) throw new Error(`Dosya çok büyük (en çok ${excel ? "10" : "5"} MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = excel
    ? (await import("../../../../../shared/xlsx-read")).parseXlsx(bytes, { maxBytes: XLSX_MAX_BYTES, maxRows: UNIT_IMPORT_MAX_ROWS, maxUnzippedBytes: 120_000_000 })
    : parseDelimited(decodeText(bytes), { maxBytes: CSV_MAX_BYTES, maxRows: UNIT_IMPORT_MAX_ROWS });
  // Başlıksız sütunlar atılır.
  const keep = parsed.headers.map((header, index) => ({ header: header.trim(), index })).filter((c) => c.header);
  if (!keep.length) throw new Error("İlk satır sütun başlıklarını içermeli.");
  if (keep.length > UNIT_IMPORT_MAX_COLUMNS) throw new Error(`Dosya ${UNIT_IMPORT_MAX_COLUMNS} sütundan fazla içeriyor.`);
  if (!parsed.rows.length) throw new Error("Dosyada veri satırı yok.");
  return { headers: keep.map((c) => c.header), rows: parsed.rows.map((row) => keep.map((c) => String(row[c.index] ?? ""))) };
}

export default function UnitImport({
  projects, units, initialProjectId, store, onClose,
}: {
  projects: Project[];
  units: Unit[];
  initialProjectId: string;
  store: InventoryStore;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(initialProjectId || projects[0]?.id || "");
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<(UnitImportField | null)[]>([]);
  const [mode, setMode] = useState<DuplicateMode>("update");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<(ImportResult & { invalid: number }) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const existing = useMemo(() => units.filter((u) => u.projectId === projectId), [units, projectId]);
  const preview = useMemo(() => (table ? previewUnitImport(table, mapping, existing) : null), [table, mapping, existing]);
  const plan = useMemo(() => (preview ? planUnitImport(preview, mode) : null), [preview, mode]);
  const errorRows = useMemo(() => (preview ? preview.rows.filter((row) => row.errors.length).slice(0, ERROR_ROWS) : []), [preview]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setResult(null);
    setReading(true);
    try {
      const next = await readTable(file);
      setTable(next);
      setMapping(mapUnitHeaders(next.headers));
      setFileName(file.name);
    } catch (cause) {
      setTable(null);
      setFileName("");
      setError(cause instanceof Error ? cause.message : "Dosya okunamadı.");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const remap = (index: number, field: UnitImportField | "") =>
    setMapping((current) => current.map((old, i) => (i === index ? field || null : field && old === field ? null : old)));

  const run = async () => {
    if (!plan || !plan.rows.length || !projectId) return;
    setProgress({ done: 0, total: plan.rows.length });
    try {
      const outcome = await store.importUnits(projectId, plan.rows, mode, (done, total) => setProgress({ done, total }));
      setResult({ ...outcome, skipped: outcome.skipped + plan.skipped, invalid: plan.invalid });
      toast.success(`${outcome.created} daire eklendi, ${outcome.updated} daire güncellendi.`);
    } catch (cause) {
      setError(`${(cause as Error).message} İçe aktarma yarıda kaldı; aktarılan satırlar kaydedildi, dosyayı yeniden yükleyip devam edebilirsiniz.`);
    } finally {
      setProgress(null);
    }
  };

  const projectName = projects.find((p) => p.id === projectId)?.name || "";
  const busy = Boolean(progress);

  return (
    <Modal wide title="Daireleri içe aktar" subtitle="Excel (.xlsx) veya CSV dosyasından seçilen projeye toplu daire ekleyin veya güncelleyin." onClose={busy ? () => undefined : onClose}>
      <div className="pj-import">
        {result ? (
          <div className="pj-import-result" role="status">
            <FileSpreadsheet size={28} aria-hidden="true" />
            <h3>İçe aktarma tamamlandı</h3>
            <p>
              <b>{projectName}</b>: {result.created} yeni daire, {result.updated} güncellendi, {result.skipped} atlandı
              {result.invalid ? `, ${result.invalid} hatalı satır alınmadı` : ""}.
            </p>
            {result.errors.length > 0 && <p className="pj-over">{result.errors.length} satır sunucuda reddedildi: {result.errors[0].message}</p>}
            <button type="button" className="btn primary pj-touch" onClick={onClose}>Kapat</button>
          </div>
        ) : (
          <>
            <div className="pj-import-top">
              <label className="pj-filter">
                <span className="pj-filter-label">Proje</span>
                <select className="pj-input" value={projectId} disabled={busy} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <div className="pj-filter">
                <span className="pj-filter-label">Dosya</span>
                <input ref={fileInput} type="file" hidden accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void choose(e.target.files?.[0])} />
                <button type="button" className="btn secondary pj-touch" disabled={reading || busy} onClick={() => fileInput.current?.click()}>
                  <Upload size={16} /> {reading ? "Okunuyor…" : fileName || "Dosya seç"}
                </button>
              </div>
            </div>
            {!table && !error && (
              <p className="pj-note">
                Beklenen başlıklar: Blok, Kat, No (Daire No), Tip, Brüt m2, Net m2, Cephe, Fiyat, Para Birimi, Durum. En çok {UNIT_IMPORT_MAX_ROWS.toLocaleString("tr-TR")} satır. Yeni daire için Daire No, Kat ve Fiyat zorunludur.
              </p>
            )}
            {error && <p className="pj-error" role="alert">{error}</p>}
            {table && preview && plan && (
              <>
                <h3 className="pj-subhead">Sütun eşleme</h3>
                <div className="pj-mapping">
                  {table.headers.map((header, index) => (
                    <label key={`${header}-${index}`} className="pj-filter">
                      <span className="pj-filter-label" title={header}>{header}</span>
                      <select className="pj-input" value={mapping[index] || ""} disabled={busy} onChange={(e) => remap(index, e.target.value as UnitImportField | "")}>
                        <option value="">Alma</option>
                        {unitImportFields.map((field) => (
                          <option key={field} value={field}>{unitImportLabels[field]}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                <div className="pj-import-summary" aria-live="polite">
                  <span><b>{preview.total}</b> satır</span>
                  <span className="pj-tone-ok"><b>{preview.fresh}</b> yeni</span>
                  <span className="pj-tone-hold"><b>{preview.duplicates}</b> projede var</span>
                  <span className={preview.invalid ? "pj-tone-bad" : ""}><b>{preview.invalid}</b> hatalı</span>
                </div>

                {preview.duplicates > 0 && (
                  <fieldset className="pj-dup">
                    <legend>Aynı blok + daire no projede varsa</legend>
                    <label>
                      <input type="radio" name="pj-dup" checked={mode === "update"} disabled={busy} onChange={() => setMode("update")} />
                      Güncelle <span className="pj-muted">(dosyadaki dolu alanlar yazılır, diğerleri korunur)</span>
                    </label>
                    <label>
                      <input type="radio" name="pj-dup" checked={mode === "skip"} disabled={busy} onChange={() => setMode("skip")} />
                      Atla <span className="pj-muted">(mevcut daireler değişmez)</span>
                    </label>
                  </fieldset>
                )}

                {errorRows.length > 0 && (
                  <details className="pj-import-errors" open>
                    <summary>
                      Hatalı satırlar ({preview.invalid}) — içe aktarılmayacak
                    </summary>
                    <ul>
                      {errorRows.map((row) => (
                        <li key={row.rowNumber}>
                          <b>{row.rowNumber}. satır:</b> {row.errors.join(" ")}
                        </li>
                      ))}
                    </ul>
                    {preview.invalid > errorRows.length && <p className="pj-muted">İlk {errorRows.length} hata gösteriliyor.</p>}
                  </details>
                )}

                <h3 className="pj-subhead">Önizleme <span className="pj-muted">(ilk {Math.min(PREVIEW_ROWS, preview.total)} satır)</span></h3>
                <div className="pj-table-wrap pj-preview">
                  <table className="pj-table">
                    <thead>
                      <tr>
                        <th>Satır</th>
                        <th>Blok / No</th>
                        <th>Tip</th>
                        <th className="pj-num">Kat</th>
                        <th className="pj-num">Brüt</th>
                        <th className="pj-num">Net</th>
                        <th className="pj-num">Fiyat</th>
                        <th>Durum</th>
                        <th>Sonuç</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, PREVIEW_ROWS).map((row) => {
                        const v = row.values;
                        return (
                          <tr key={row.rowNumber} className={row.errors.length ? "pj-row-bad" : undefined}>
                            <td>{row.rowNumber}</td>
                            <td>{[v.block, v.unitNo].filter(Boolean).join(" / ") || "—"}</td>
                            <td>{v.type || "—"}</td>
                            <td className="pj-num">{v.floor ?? "—"}</td>
                            <td className="pj-num">{v.grossM2 ?? "—"}</td>
                            <td className="pj-num">{v.netM2 ?? "—"}</td>
                            <td className="pj-num">{v.listPrice == null ? "—" : formatPrice(v.listPrice, v.currency || "TRY")}</td>
                            <td>{v.status ? statusLabel[v.status] : "—"}</td>
                            <td>
                              {row.errors.length ? (
                                <span className="pj-tone-bad" title={row.errors.join(" ")}>Hatalı</span>
                              ) : row.existingId ? (
                                <span className="pj-tone-hold">{mode === "update" ? "Güncellenecek" : "Atlanacak"}</span>
                              ) : (
                                <span className="pj-tone-ok">Yeni</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="sx-modal-footer pj-import-foot">
              <span className="sx-muted">
                {progress
                  ? `Aktarılıyor… ${progress.done} / ${progress.total}`
                  : plan
                    ? `${plan.create} yeni, ${plan.update} güncellenecek, ${plan.skipped} atlanacak, ${plan.invalid} hatalı`
                    : store.demo
                      ? "Demo: veriler yalnız bu tarayıcıda tutulur."
                      : ""}
              </span>
              <div className="sx-actions">
                <button type="button" className="btn secondary pj-touch" disabled={busy} onClick={onClose}>Vazgeç</button>
                <button type="button" className="btn primary pj-touch" disabled={busy || !plan?.rows.length || !projectId} onClick={() => void run()}>
                  {busy ? "Aktarılıyor…" : plan?.rows.length ? `${plan.rows.length} daireyi içe aktar` : "İçe aktar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
