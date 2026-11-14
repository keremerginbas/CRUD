// Satış belgeleri: alıcı bilgileri, senet dökümü (ödendi işareti, gecikme faizi), Word sözleşme ve senet PDF'i.
// Yalnız yöneticinin onayladığı tekliflerde görünür.
import { useEffect, useState, type FormEvent } from "react";
import { Check, FileDown, Printer, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { formatDay, formatMoney, formatPct, type VisibleQuote } from "../../../../../shared/quotes";
import { lateInterest, summarizeSenets, type SaleParties } from "../../../../../shared/senet";
import type { QuoteStore } from "../../quotes";
import { useSale } from "../../sales";

const emptyParties = (quote: VisibleQuote, today: string): SaleParties => ({
  buyerName: quote.customer.name || "",
  buyerTckn: "",
  buyerAddress: "",
  buyerPhone: quote.customer.phone || "",
  buyerEmail: "",
  guarantorName: "",
  guarantorTckn: "",
  guarantorAddress: "",
  issuePlace: "",
  contractDate: today,
  lateInterestMonthlyPct: 0,
});

export function SaleDocuments({ quote, store }: { quote: VisibleQuote; store: QuoteStore }) {
  const sales = useSale(quote, store);
  const { sale, today } = sales;
  const [form, setForm] = useState<SaleParties>(() => emptyParties(quote, today));
  const [rate, setRate] = useState("0");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const money = (value: number) => formatMoney(value, quote.inputs.currency);

  useEffect(() => {
    const next = sale?.parties || emptyParties(quote, today);
    setForm(next);
    setRate(String(next.lateInterestMonthlyPct).replace(".", ","));
    setEditing(!sale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.updatedAt, quote.id, sales.loading]);

  if (sales.loading) return null;
  const set = (key: keyof SaleParties) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const pct = Number(rate.replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0 || pct > 20) return void toast.error("Gecikme faizi %0–%20 arasında olmalı.");
    setBusy(true);
    try {
      await sales.save({ ...form, lateInterestMonthlyPct: pct });
      toast.success("Alıcı bilgileri kaydedildi, senetler hazırlandı.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (no: number, paid: boolean) => {
    try {
      await sales.pay(no, paid);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  const summary = sale ? summarizeSenets(sale.senets, today, sale.parties.lateInterestMonthlyPct) : null;

  return (
    <section className="pj-panel qt-section sn-docs">
      <div className="sn-head">
        <h2 className="qt-section-title">Sözleşme ve senetler</h2>
        {sale && !editing && (
          <div className="sn-actions">
            {sales.contractUrl ? (
              <a className="btn primary pj-touch" href={sales.contractUrl}>
                <FileDown size={15} /> Sözleşmeyi indir (Word)
              </a>
            ) : (
              <button type="button" className="btn primary pj-touch" onClick={sales.downloadContract}>
                <FileDown size={15} /> Sözleşmeyi indir (Word)
              </button>
            )}
            {sale.senets.length > 0 &&
              (sales.senetPdfUrl ? (
                <a className="btn secondary pj-touch" href={sales.senetPdfUrl} target="_blank" rel="noopener">
                  <Printer size={15} /> Senetleri yazdır (PDF)
                </a>
              ) : (
                <button type="button" className="btn secondary pj-touch" disabled title="Demo modunda PDF üretilmez.">
                  <Printer size={15} /> Senetler (demoda kapalı)
                </button>
              ))}
            <button type="button" className="btn secondary pj-touch" onClick={() => setEditing(true)}>
              Alıcı bilgilerini düzenle
            </button>
          </div>
        )}
      </div>

      {editing && (
        <form className="pj-form sn-form" onSubmit={submit}>
          {!sale && <p className="pj-note">Sözleşme ve senetleri hazırlamak için alıcının bilgilerini girin. Senetler ödeme planındaki her taksit için otomatik oluşur.</p>}
          <div className="sn-grid">
            <label className="sx-field">
              <span>Alıcı adı soyadı *</span>
              <input className="pj-input" required minLength={2} maxLength={200} value={form.buyerName} onChange={set("buyerName")} />
            </label>
            <label className="sx-field">
              <span>T.C. kimlik no</span>
              <input className="pj-input" inputMode="numeric" maxLength={11} value={form.buyerTckn} onChange={set("buyerTckn")} />
            </label>
            <label className="sx-field">
              <span>Telefon</span>
              <input className="pj-input" maxLength={60} value={form.buyerPhone} onChange={set("buyerPhone")} />
            </label>
            <label className="sx-field">
              <span>E-posta</span>
              <input className="pj-input" type="email" maxLength={200} value={form.buyerEmail} onChange={set("buyerEmail")} />
            </label>
            <label className="sx-field sn-wide">
              <span>Adres</span>
              <input className="pj-input" maxLength={500} value={form.buyerAddress} onChange={set("buyerAddress")} />
            </label>
            <label className="sx-field">
              <span>Kefil adı soyadı (varsa)</span>
              <input className="pj-input" maxLength={200} value={form.guarantorName} onChange={set("guarantorName")} />
            </label>
            <label className="sx-field">
              <span>Kefil T.C. kimlik no</span>
              <input className="pj-input" inputMode="numeric" maxLength={11} value={form.guarantorTckn} onChange={set("guarantorTckn")} />
            </label>
            <label className="sx-field sn-wide">
              <span>Kefil adresi</span>
              <input className="pj-input" maxLength={500} value={form.guarantorAddress} onChange={set("guarantorAddress")} />
            </label>
            <label className="sx-field">
              <span>Düzenleme yeri</span>
              <input className="pj-input" maxLength={120} placeholder="ör. İstanbul" value={form.issuePlace} onChange={set("issuePlace")} />
            </label>
            <label className="sx-field">
              <span>Sözleşme tarihi *</span>
              <input className="pj-input" type="date" required value={form.contractDate} onChange={set("contractDate")} />
            </label>
            <label className="sx-field">
              <span>Aylık gecikme faizi (%)</span>
              <input className="pj-input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
          </div>
          <div className="sn-actions">
            <button type="submit" className="btn primary pj-touch" disabled={busy}>
              <Save size={15} /> {sale ? "Kaydet" : "Kaydet ve senetleri oluştur"}
            </button>
            {sale && (
              <button type="button" className="btn secondary pj-touch" onClick={() => setEditing(false)}>
                Vazgeç
              </button>
            )}
          </div>
        </form>
      )}

      {sale && summary && !editing && (
        <>
          <dl className="pj-facts qt-facts">
            <div>
              <dt>Alıcı</dt>
              <dd>{sale.parties.buyerName}</dd>
            </div>
            <div>
              <dt>Senet</dt>
              <dd>
                {summary.count} adet · {money(summary.total)}
              </dd>
            </div>
            <div>
              <dt>Ödenen</dt>
              <dd>
                {summary.paidCount} adet · {money(summary.paidTotal)}
              </dd>
            </div>
            <div>
              <dt>Vadesi geçen</dt>
              <dd className={summary.overdueCount ? "sn-bad" : undefined}>
                {summary.overdueCount} adet · {money(summary.overdueTotal)}
              </dd>
            </div>
            <div>
              <dt>Gecikme faizi · aylık {formatPct(sale.parties.lateInterestMonthlyPct)}</dt>
              <dd className={summary.overdueInterest ? "sn-bad" : undefined}>{money(summary.overdueInterest)}</dd>
            </div>
          </dl>
          {sale.senets.length === 0 ? (
            <p className="pj-muted">Peşin satış: vadeli ödeme olmadığı için senet düzenlenmez.</p>
          ) : (
            <div className="qt-plan-scroll qt-plan-tall">
              <table className="pj-table qt-plan">
                <thead>
                  <tr>
                    <th>Senet</th>
                    <th>Vade</th>
                    <th className="pj-num">Tutar</th>
                    <th>Durum</th>
                    <th className="pj-num">Gecikme</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sale.senets.map((s) => {
                    const late = lateInterest(s, today, sale.parties.lateInterestMonthlyPct);
                    const paid = s.status === "ödendi";
                    const overdue = !paid && s.dueDate < today;
                    return (
                      <tr key={s.no} className={s.kind === "ara ödeme" ? "qt-plan-strong" : undefined}>
                        <td>
                          {s.no}/{s.of}
                          {s.kind === "ara ödeme" ? " · ara ödeme" : ""}
                        </td>
                        <td>{formatDay(s.dueDate)}</td>
                        <td className="pj-num">{money(s.amount)}</td>
                        <td>
                          <span className={`pj-status pj-tone-${paid ? "ok" : overdue ? "bad" : "hold"} qt-status`}>{paid ? `Ödendi · ${formatDay(s.paidAt || "")}` : overdue ? "Vadesi geçti" : "Bekliyor"}</span>
                        </td>
                        <td className="pj-num">{late.daysLate ? `${late.daysLate} gün · ${money(late.interest)}` : "—"}</td>
                        <td className="pj-num">
                          {store.canCreate &&
                            (paid ? (
                              <button type="button" className="btn secondary small" onClick={() => void toggle(s.no, false)} title="Ödendi işaretini kaldır">
                                <RotateCcw size={13} /> Geri al
                              </button>
                            ) : (
                              <button type="button" className="btn secondary small" onClick={() => void toggle(s.no, true)}>
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
        </>
      )}
    </section>
  );
}
