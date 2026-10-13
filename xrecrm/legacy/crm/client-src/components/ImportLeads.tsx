import { useState, useRef } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Upload, X, FileSpreadsheet, Check, AlertCircle, Download } from "lucide-react";

/* ----------------------------------------------------------------
   CSV / Excel (XLSX) import modalı
   CSV: native parse | XLSX: SheetJS (pnpm add xlsx gerekli)
-----------------------------------------------------------------*/

const REQUIRED = ["Ad"];
const COL_MAP: Record<string, string> = {
  "Ad": "firstName", "Soyad": "lastName", "E-posta": "email",
  "Telefon": "phone", "Proje": "projectName", "Şehir": "city",
  "Kaynak": "source", "Notlar": "notes",
};
const TEMPLATE_HEADERS = "Ad,Soyad,E-posta,Telefon,Proje,Şehir,Kaynak,Notlar";
const TEMPLATE_EXAMPLE = "Ahmet,Yılmaz,ahmet@mail.com,05xxxxxxxxx,3+1 Daire,Ankara,Sahibinden,";

type Row = Record<string, string>;

function parseCSV(text: string): Row[] {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(",");
    const row: Row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

async function parseXLSX(file: File): Promise<Row[]> {
  try {
    // xlsx paketi kuruluysa kullan; yoksa hata ver (pnpm add xlsx)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const XLSX = await (Function('return import("xlsx")')() as Promise<any>);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: "" }) as Row[];
  } catch {
    throw new Error("XLSX desteği için terminale şunu yaz: pnpm add xlsx");
  }
}

function rowToLead(row: Row): Record<string, string> {
  const lead: Record<string, string> = {};
  for (const [displayKey, fieldKey] of Object.entries(COL_MAP)) {
    if (row[displayKey] !== undefined) lead[fieldKey] = row[displayKey];
  }
  return lead;
}

export default function ImportLeads({ onClose, defaultStatusId }: { onClose: () => void; defaultStatusId?: number }) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const bulkCreate = trpc.leads.bulkCreate.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.count} müşteri adayı içe aktarıldı`);
      utils.leads.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message || "İçe aktarma başarısız"),
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setErrors([]);
    try {
      let parsed: Row[];
      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const text = await file.text();
        parsed = parseCSV(text);
      } else {
        parsed = await parseXLSX(file);
      }
      if (!parsed.length) { toast.error("Dosya boş veya tanınamadı"); return; }
      const errs: string[] = [];
      parsed.forEach((r, i) => {
        if (!r["Ad"] && !r["firstName"]) errs.push(`Satır ${i + 2}: Ad alanı boş`);
      });
      setErrors(errs);
      setRows(parsed);
    } catch (err: any) {
      toast.error(err.message || "Dosya okunamadı");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function doImport() {
    if (!rows?.length) return;
    const leads = rows.map(r => {
      const l = rowToLead(r);
      return {
        firstName: l.firstName || r["firstName"] || "İsimsiz",
        lastName: l.lastName || r["lastName"] || "",
        email: l.email || r["email"] || undefined,
        phone: l.phone || r["phone"] || undefined,
        projectName: l.projectName || undefined,
        city: l.city || undefined,
        source: l.source || undefined,
        notes: l.notes || undefined,
        statusId: defaultStatusId,
        priority: "medium" as const,
      };
    });
    bulkCreate.mutate(leads);
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_HEADERS + "\n" + TEMPLATE_EXAMPLE], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "crm-sablon.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="imp-overlay" onClick={() => !bulkCreate.isPending && onClose()}>
      <div className="imp-modal" onClick={e => e.stopPropagation()}>
        <div className="imp-head">
          <div>
            <h3>Müşteri Adayı İçe Aktar</h3>
            <p>CSV, XLSX veya Excel dosyasından toplu ekle</p>
          </div>
          <button className="imp-x" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="imp-body">
          <div className="imp-dl">
            <FileSpreadsheet size={18} />
            <span>Şablonu indirip doldurabilirsin</span>
            <button onClick={downloadTemplate}><Download size={14} /> Şablon İndir (.csv)</button>
          </div>

          <div
            className={"imp-drop" + (rows ? " has-file" : "")}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { const inp = fileRef.current; if (inp) { const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; onFile({ target: inp } as any); } } }}
          >
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.txt" hidden onChange={onFile} />
            {rows ? (
              <>
                <Check size={28} className="ok" />
                <b>{fileName}</b>
                <span>{rows.length} satır bulundu</span>
              </>
            ) : (
              <>
                <Upload size={28} />
                <b>Dosyayı sürükle veya tıkla</b>
                <span>CSV, XLSX, XLS desteklenir</span>
              </>
            )}
          </div>

          {errors.length > 0 && (
            <div className="imp-errs">
              <AlertCircle size={15} /><b>{errors.length} uyarı</b>
              <ul>{errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
              {errors.length > 5 && <span>…ve {errors.length - 5} tane daha</span>}
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="imp-preview">
              <div className="prv-title">Önizleme (ilk 3 satır)</div>
              <table>
                <thead><tr>{Object.keys(rows[0]).slice(0, 6).map(k => <th key={k}>{k}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 3).map((r, i) => <tr key={i}>{Object.keys(rows[0]).slice(0, 6).map(k => <td key={k}>{r[k] || "—"}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="imp-foot">
          <button className="ghost" onClick={onClose} disabled={bulkCreate.isPending}>İptal</button>
          <button className="primary" onClick={doImport} disabled={!rows?.length || bulkCreate.isPending}>
            <Upload size={16} />
            {bulkCreate.isPending ? "İçe aktarılıyor…" : `${rows?.length || 0} Kaydı Aktar`}
          </button>
        </div>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

const CSS = `
.imp-overlay{position:fixed;inset:0;background:rgba(15,23,41,.55);backdrop-filter:blur(5px);z-index:200;display:grid;place-items:center;padding:20px}
.imp-modal{background:#fff;border-radius:20px;width:100%;max-width:620px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 40px 100px -24px rgba(16,24,40,.5);font-family:"Hanken Grotesk",system-ui,sans-serif;overflow:hidden}
.imp-head{padding:20px 24px;border-bottom:1px solid #e7ebf2;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-shrink:0}
.imp-head h3{font-size:18px;font-weight:700;margin:0}.imp-head p{font-size:13.5px;color:#8a93a8;margin:3px 0 0}
.imp-x{width:34px;height:34px;border-radius:10px;border:none;background:#f7f9fc;color:#475069;cursor:pointer;display:grid;place-items:center}
.imp-body{padding:20px 24px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;flex:1}
.imp-dl{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f7f9fc;border-radius:12px;font-size:13.5px;color:#475069}
.imp-dl svg{color:#2f6bff;flex-shrink:0}.imp-dl span{flex:1}
.imp-dl button{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:#2f6bff;background:none;border:1px solid #cdd8ec;border-radius:8px;padding:5px 11px;cursor:pointer;font-family:inherit;white-space:nowrap}
.imp-dl button:hover{background:#eef3ff}
.imp-drop{border:2px dashed #cdd8ec;border-radius:14px;padding:36px 20px;text-align:center;cursor:pointer;transition:.16s;display:flex;flex-direction:column;align-items:center;gap:8px;color:#8a93a8}
.imp-drop svg{color:#cdd8ec}.imp-drop b{font-size:15px;font-weight:600;color:#0f1729}.imp-drop span{font-size:13px}
.imp-drop:hover{border-color:#2f6bff;background:#eef3ff}.imp-drop.has-file{border-color:#10b981;background:#e7f9f1}
.imp-drop.has-file svg.ok{color:#10b981}.imp-drop.has-file b{color:#10b981}
.imp-errs{background:#fff5f5;border:1px solid #ffd9d9;border-radius:12px;padding:12px 14px;font-size:13px;color:#b91c1c;display:flex;flex-direction:column;gap:4px}
.imp-errs ul{margin:4px 0 0 16px;padding:0}.imp-errs li{margin-bottom:2px}
.imp-preview .prv-title{font-size:12px;font-weight:700;color:#8a93a8;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px}
.imp-preview table{width:100%;border-collapse:collapse;font-size:13px}
.imp-preview th{background:#f7f9fc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#8a93a8;padding:7px 10px;border:1px solid #e7ebf2}
.imp-preview td{padding:7px 10px;border:1px solid #e7ebf2;color:#475069;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imp-foot{padding:16px 24px;border-top:1px solid #e7ebf2;display:flex;justify-content:flex-end;gap:10px;flex-shrink:0}
.imp-foot button{height:42px;padding:0 20px;border-radius:11px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;border:none;display:flex;align-items:center;gap:7px}
.imp-foot .ghost{background:#f7f9fc;color:#475069}.imp-foot .primary{background:#2f6bff;color:#fff}
.imp-foot .primary:hover{background:#1f55e0}.imp-foot button:disabled{opacity:.6;cursor:not-allowed}
`;