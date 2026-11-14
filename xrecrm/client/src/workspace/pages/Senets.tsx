// Senet takibi: tüm satışların senetleri, vadesi geçenler ve gecikme faizi; yönetici için sözleşme şablonu.
import { useMemo, useRef, useState } from "react";
import { Check, Download, RotateCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { formatDay, formatMoney, formatPct } from "../../../../shared/quotes";
import { lateInterest } from "../../../../shared/senet";
import { PageTitle } from "../components/ui";
import { useInventory } from "../projects";
import { goTo, useQuotes } from "../quotes";
import { useContractTemplate, useSenetBook } from "../sales";
import { withBase } from "../nav";
import "../suite-pages.css";
import "../projects.css";
import "../quotes.css";

type Filter = "acik" | "geciken" | "buay" | "odenen" | "hepsi";
const FILTERS: [Filter, string][] = [
  ["acik", "Bekleyen"],
  ["geciken", "Vadesi geçen"],
  ["buay", "Bu ay"],
  ["odenen", "Ödenen"],
  ["hepsi", "Tümü"],
];
const PAGE = 100;
const fold = (value: string) => value.toLocaleLowerCase("tr-TR");

export default function Senets() {
  const inventory = useInventory();
  const store = useQuotes(inventory);
  const book = useSenetBook(store);
  const tpl = useContractTemplate(store.demo);
  const [filter, setFilter] = useState<Filter>("acik");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const fileRef = useRef<HTMLInputElement>(null);
  const { today } = book;
  const month = today.slice(0, 7);

  const all = useMemo(
    () =>
      book.rows
        .flatMap((row) => row.senets.map((senet) => ({ row, senet, late: lateInterest(senet, today, row.lateInterestMonthlyPct) })))
        .sort((a, b) => a.senet.dueDate.localeCompare(b.senet.dueDate)),
    [book.rows, today],
  );
  const is = (f: Filter, x: (typeof all)[number]) => {
    const paid = x.senet.status === "ödendi";
    return f === "hepsi" ? true : f === "odenen" ? paid : f === "geciken" ? !paid && x.senet.dueDate < today : f === "buay" ? !paid && x.senet.dueDate.startsWith(month) : !paid;
  };
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([f]) => [f, all.filter((x) => is(f, x)).length])) as Record<Filter, number>, [all, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const words = fold(search).split(/\s+/).filter(Boolean);
    return all.filter((x) => {
      if (!is(filter, x)) return false;
      if (!words.length) return true;
      const hay = fold(`${x.row.quoteNo} ${x.row.customer} ${x.row.phone} ${x.row.projectName} ${x.row.unitLabel} ${x.row.employee}`);
      return words.every((w) => hay.includes(w));
    });
  }, [all, filter, search, today]); // eslint-disable-line react-hooks/exhaustive-deps
  // Para birimine göre toplamlar (farklı para birimleri toplanmaz).
  const totals = useMemo(() => {
    const map = new Map<string, { open: number; overdue: number; interest: number; month: number }>();
    for (const x of all) {
      if (x.senet.status === "ödendi") continue;
      const t = map.get(x.senet.currency) || { open: 0, overdue: 0, interest: 0, month: 0 };
      t.open += x.senet.amount;
      if (x.senet.dueDate < today) {
        t.overdue += x.senet.amount;
        t.interest += x.late.interest;
      }
      if (x.senet.dueDate.startsWith(month)) t.month += x.senet.amount;
      map.set(x.senet.currency, t);
    }
    return [...map.entries()];
  }, [all, today, month]);

  const toggle = async (quoteId: string, no: number, paid: boolean) => {
    try {
      await book.pay(quoteId, no, paid);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const info = await tpl.upload(file);
      if (info.unknown.length) toast.warning(`Şablon yüklendi; tanınmayan alanlar boş kalacak: ${info.unknown.map((k) => `{{${k}}}`).join(", ")}`);
      else toast.success("Sözleşme şablonu yüklendi.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="pj-page qt-page">
      <PageTitle
        eyebrow="GAYRİMENKUL SATIŞ"
        title="Senetler"
        description="Satışların senet dökümü: vadesi gelenler, gecikenler ve gecikme faizi. Senetler, onaylı teklifin “Sözleşme ve senetler” bölümünden oluşturulur."
        actions={
          <button type="button" className="btn secondary pj-touch" onClick={() => goTo("/quotes", withBase)}>
            Teklifler
          </button>
        }
      />
      {book.error && <p className="pj-note">{book.error}</p>}
      <div className="qt-kpis">
        {totals.length === 0 && (
          <div className="pj-panel qt-kpi">
            <span className="qt-compare-label">Bekleyen senet</span>
            <strong>—</strong>
            <span className="pj-muted">{book.loading ? "Yükleniyor…" : "Henüz senet düzenlenmedi"}</span>
          </div>
        )}
        {totals.map(([currency, t]) => (
          <div className="pj-panel qt-kpi" key={currency}>
            <span className="qt-compare-label">Bekleyen senet · {currency}</span>
            <strong>{formatMoney(t.open, currency as never)}</strong>
            <span className="pj-muted">Bu ay vadesi gelen {formatMoney(t.month, currency as never)}</span>
            <span className={t.overdue ? "qt-neg" : "pj-muted"}>
              Vadesi geçen {formatMoney(t.overdue, currency as never)}
              {t.interest ? ` · gecikme faizi ${formatMoney(t.interest, currency as never)}` : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="qt-tabs" role="tablist">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`qt-tab ${f === "geciken" && counts.geciken ? "qt-tab-alert" : ""}`} onClick={() => (setFilter(f), setLimit(PAGE))}>
            {label} <span className="qt-tab-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      <input className="pj-input sn-search" type="search" placeholder="Müşteri, teklif no, proje ara…" value={search} onChange={(e) => (setSearch(e.target.value), setLimit(PAGE))} />

      <section className="pj-panel">
        {shown.length === 0 ? (
          <p className="pj-muted sn-empty">{book.loading ? "Yükleniyor…" : "Bu görünümde senet yok."}</p>
        ) : (
          <div className="pj-table-wrap">
            <table className="pj-table qt-table qt-static">
              <thead>
                <tr>
                  <th>Vade</th>
                  <th>Müşteri</th>
                  <th>Daire</th>
                  <th>Senet</th>
                  <th className="pj-num">Tutar</th>
                  <th>Durum</th>
                  <th className="pj-num">Gecikme</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map(({ row, senet, late }) => {
                  const paid = senet.status === "ödendi";
                  const overdue = !paid && senet.dueDate < today;
                  return (
                    <tr key={`${row.quoteId}-${senet.no}`}>
                      <td>{formatDay(senet.dueDate)}</td>
                      <td>
                        <strong>{row.customer}</strong>
                        <div className="qt-cell-sub">{row.phone}</div>
                      </td>
                      <td>
                        {row.projectName}
                        <div className="qt-cell-sub">{row.unitLabel}</div>
                      </td>
                      <td>
                        {senet.no}/{senet.of}
                        <div className="qt-cell-sub">{row.quoteNo}</div>
                      </td>
                      <td className="pj-num pj-price">{formatMoney(senet.amount, senet.currency)}</td>
                      <td>
                        <span className={`pj-status pj-tone-${paid ? "ok" : overdue ? "bad" : "hold"} qt-status`}>{paid ? `Ödendi · ${formatDay(senet.paidAt || "")}` : overdue ? "Vadesi geçti" : "Bekliyor"}</span>
                      </td>
                      <td className="pj-num">
                        {late.daysLate ? (
                          <>
                            {late.daysLate} gün
                            <div className="qt-cell-sub">
                              {formatMoney(late.interest, senet.currency)} · {formatPct(row.lateInterestMonthlyPct)}/ay
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="pj-num">
                        {store.canCreate &&
                          (paid ? (
                            <button type="button" className="btn secondary small" onClick={() => void toggle(row.quoteId, senet.no, false)}>
                              <RotateCcw size={13} /> Geri al
                            </button>
                          ) : (
                            <button type="button" className="btn secondary small" onClick={() => void toggle(row.quoteId, senet.no, true)}>
                              <Check size={13} /> Ödendi
                            </button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > limit && (
          <button type="button" className="add-card column-more" onClick={() => setLimit((n) => n + PAGE * 2)}>
            {(shown.length - limit).toLocaleString("tr-TR")} senet daha · göster
          </button>
        )}
      </section>

      {store.manager && (
        <section className="pj-panel qt-section sn-template">
          <h2 className="qt-section-title">Sözleşme şablonu (Word)</h2>
          <p className="pj-muted">
            Sözleşme, aşağıdaki şablondaki <code>{"{{alan}}"}</code> yer tutucuları teklif ve alıcı bilgileriyle doldurularak üretilir. Kendi sözleşmenizi Word’de açın, değişecek yerlere alan adlarını yazın ve yükleyin.
          </p>
          <p>
            <strong>Kullanılan şablon:</strong> {tpl.template.custom ? `${tpl.template.name} · ${Math.max(1, Math.round(tpl.template.size / 1024))} KB${tpl.template.uploadedAt ? ` · ${formatDay(tpl.template.uploadedAt)}` : ""}` : "Hazır şablon"}
          </p>
          {tpl.template.unknown.length > 0 && <p className="pj-note">Şablonda tanınmayan alanlar var, bunlar doldurulmaz: {tpl.template.unknown.map((k) => `{{${k}}}`).join(", ")}</p>}
          <div className="sn-actions">
            <input ref={fileRef} type="file" accept=".docx" hidden onChange={(e) => void upload(e.target.files?.[0])} />
            <button type="button" className="btn primary pj-touch" disabled={store.demo} title={store.demo ? "Demo modunda şablon yüklenmez." : undefined} onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Kendi şablonumu yükle (.docx)
            </button>
            <button type="button" className="btn secondary pj-touch" onClick={tpl.downloadDefault}>
              <Download size={15} /> Hazır şablonu indir
            </button>
            {tpl.template.custom && tpl.currentUrl && (
              <a className="btn secondary pj-touch" href={tpl.currentUrl}>
                <Download size={15} /> Yüklü şablonu indir
              </a>
            )}
            {tpl.template.custom && (
              <button
                type="button"
                className="btn secondary pj-touch qt-danger"
                onClick={() => window.confirm("Yüklü şablon kaldırılsın mı? Sözleşmeler hazır şablonla üretilir.") && void tpl.remove().catch((e) => toast.error((e as Error).message))}
              >
                <Trash2 size={15} /> Şablonu kaldır
              </button>
            )}
          </div>
          <details className="nx-fold sn-fields">
            <summary>Kullanılabilir alanlar ({tpl.template.fields.length + tpl.template.tables.length})</summary>
            <div className="sn-field-list">
              {tpl.template.fields.map(([key, label]) => (
                <div key={key}>
                  <code>{`{{${key}}}`}</code>
                  <span>{label}</span>
                </div>
              ))}
              {tpl.template.tables.map(([key, label]) => (
                <div key={key}>
                  <code>{`{{${key}}}`}</code>
                  <span>{label} — tek başına bir satıra yazın</span>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
