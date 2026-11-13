// Teklif ayrıntısı: özet, yönetici değerlendirmesi (NBD ↔ liste fiyatı), onay/ret, ödeme planı,
// durum geçmişi ve ret sonrası "bu paraya ne verilebilir" listesi.
import { useEffect, useState } from "react";
import { ArrowLeft, Ban, Check, FileText, Handshake, Pencil, Send, X } from "lucide-react";
import { toast } from "sonner";
import { formatFloor, formatM2, formatPrice, type Project, type Unit } from "../../../../../shared/real-estate";
import {
  APPROVED_STATUSES,
  REJECT_REASONS,
  REJECT_REASON_LABELS,
  canAct,
  canEdit,
  formatDay,
  formatMoney,
  formatPct,
  isExpired,
  isOwnQuote,
  statusLabel,
  unitLabelOf,
  type Quote,
  type QuoteAction,
  type QuoteStatus,
  type RejectReason,
  type VisibleQuote,
} from "../../../../../shared/quotes";
import type { QuoteStore } from "../../quotes";

export const quoteTone: Record<QuoteStatus, string> = {
  taslak: "sold",
  "onay bekliyor": "hold",
  onaylandı: "ok",
  reddedildi: "bad",
  "müşteriye gönderildi": "info",
  "satışa döndü": "ok",
  iptal: "sold",
};
export function StatusChip({ quote, today }: { quote: Pick<VisibleQuote, "status" | "validUntil">; today: string }) {
  const expired = quote.status === "onaylandı" && isExpired(quote, today);
  return (
    <>
      <span className={`pj-status pj-tone-${quoteTone[quote.status]} qt-status`}>{statusLabel(quote.status)}</span>
      {expired && <span className="pj-status pj-tone-bad qt-status">Süresi doldu</span>}
    </>
  );
}

const trailTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${formatDay(iso)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const trailLabel: Record<string, string> = {
  oluşturuldu: "Teklif hazırlandı",
  düzenlendi: "Düzenlendi",
  "onaya gönderildi": "Onaya gönderildi",
  onaylandı: "Onaylandı",
  reddedildi: "Reddedildi",
  "müşteriye gönderildi": "Müşteriye gönderildi",
  "satışa döndü": "Satışa döndü",
  iptal: "İptal edildi",
};

export default function QuoteDetail({
  quote, store, units, projects, onBack, onEdit, onNewForUnit,
}: {
  quote: VisibleQuote;
  store: QuoteStore;
  units: Unit[];
  projects: Project[];
  onBack: () => void;
  onEdit: () => void;
  /** Ret sonrası: önerilen daire için aynı müşteriyle yeni teklif. */
  onNewForUnit: (unit: Unit) => void;
}) {
  const { manager, actor, today, settings } = store;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>("fiyat");
  const [alternatives, setAlternatives] = useState<Unit[] | null>(null);
  const money = (value: number) => formatMoney(value, quote.inputs.currency);
  const full = quote as Quote; // yöneticide tüm alanlar dolu gelir
  const own = isOwnQuote(quote, actor);
  const unit = units.find((u) => u.id === quote.unitId);
  const allowed = (action: QuoteAction) => store.canCreate && canAct(full, action, actor, today);
  const expired = quote.status === "onaylandı" && isExpired(quote, today);
  const priceRejected = quote.status === "reddedildi" && quote.decision?.reason === "fiyat";
  const pdf = store.pdfUrl(quote.id, false);
  const pdfReady = APPROVED_STATUSES.includes(quote.status) && !expired;

  useEffect(() => {
    setAlternatives(null);
    setRejecting(false);
    setNote("");
    if (!priceRejected) return;
    let stopped = false;
    store
      .alternatives(quote.id)
      .then((list) => !stopped && setAlternatives(list))
      .catch(() => !stopped && setAlternatives([]));
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.id, quote.status, priceRejected]);

  const run = async (action: QuoteAction, extra: { note?: string; reason?: RejectReason } = {}, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const next = await store.act(quote.id, action, extra);
      toast.success(`${next.quoteNo}: ${statusLabel(next.status)}`);
      setRejecting(false);
      setNote("");
    } catch (error) {
      toast.error((error as Error).message || "İşlem tamamlanamadı.");
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string][] = [
    ["Müşteri", [quote.customer.name, quote.customer.phone].filter(Boolean).join(" · ") || "—"],
    ["Proje", quote.unit.projectName || "—"],
    ["Daire", [unitLabelOf(quote.unit), quote.unit.type, formatFloor(quote.unit.floor), quote.unit.grossM2 > 0 ? `${formatM2(quote.unit.grossM2)} brüt` : ""].filter(Boolean).join(" · ")],
    ["Satış danışmanı", quote.employee.name],
    ["Teklif tarihi", formatDay(quote.createdAt)],
    ["Geçerlilik", `${formatDay(quote.validUntil)}${expired ? " (doldu)" : ""}`],
  ];
  const listChanged = unit && unit.listPrice !== quote.listPrice && quote.status === "onay bekliyor";
  const ratesChanged = manager && settings && (settings.discountMonthlyPct !== full.rates.discountMonthlyPct || settings.vadeFarkiMonthlyPct !== full.rates.vadeFarkiMonthlyPct || settings.commissionPct !== full.rates.commissionPct);

  return (
    <div className="qt-detail">
      <button type="button" className="pj-back" onClick={onBack}>
        <ArrowLeft size={16} /> Tüm teklifler
      </button>
      <header className="qt-detail-head">
        <div>
          <div className="eyebrow">TEKLİF</div>
          <h1 className="qt-detail-title">
            {quote.quoteNo} <StatusChip quote={quote} today={today} />
          </h1>
          <p className="pj-muted">
            {quote.unit.projectName} · {unitLabelOf(quote.unit)} · {quote.customer.name}
          </p>
        </div>
        <div className="qt-detail-actions">
          {store.canCreate && canEdit(full, actor) && (
            <button type="button" className="btn secondary pj-touch" disabled={busy} onClick={onEdit}>
              <Pencil size={15} /> Düzenle
            </button>
          )}
          {allowed("submit") && (
            <button type="button" className="btn primary pj-touch" disabled={busy} onClick={() => void run("submit")}>
              <Send size={15} /> Onaya gönder
            </button>
          )}
          {pdfReady &&
            (pdf ? (
              <a className="btn secondary pj-touch" href={pdf} target="_blank" rel="noopener">
                <FileText size={15} /> Teklif PDF
              </a>
            ) : (
              <button type="button" className="btn secondary pj-touch" disabled title="Demo modunda PDF üretilmez.">
                <FileText size={15} /> Teklif PDF (demoda kapalı)
              </button>
            ))}
          {!pdfReady && store.pdfUrl(quote.id, true) && quote.status !== "iptal" && (
            <a className="btn secondary pj-touch" href={store.pdfUrl(quote.id, true)!} target="_blank" rel="noopener" title="Filigranlı iç önizleme; müşteriye verilemez.">
              <FileText size={15} /> Filigranlı önizleme
            </a>
          )}
          {allowed("send") && (
            <button type="button" className="btn primary pj-touch" disabled={busy} onClick={() => void run("send", {}, "Teklif müşteriye gönderildi olarak işaretlensin mi? Bu işlemden sonra teklif düzenlenemez.")}>
              <Send size={15} /> Müşteriye gönderildi
            </button>
          )}
          {allowed("sell") && (
            <button
              type="button"
              className="btn primary pj-touch"
              disabled={busy}
              onClick={() => void run("sell", {}, "Teklif satışa dönsün mü? Daire “satıldı” olur ve bu dairenin diğer açık teklifleri iptal edilir.")}
            >
              <Handshake size={15} /> Satışa döndü
            </button>
          )}
          {allowed("cancel") && (
            <button type="button" className="btn secondary pj-touch qt-danger" disabled={busy} onClick={() => void run("cancel", {}, `${quote.quoteNo} iptal edilsin mi? Bu işlem geri alınamaz.`)}>
              <Ban size={15} /> İptal et
            </button>
          )}
        </div>
      </header>

      {!pdfReady && quote.status !== "iptal" && quote.status !== "reddedildi" && (
        <p className="pj-note">
          {expired
            ? "Geçerlilik süresi doldu: teklif müşteriye gönderilemez ve PDF verilmez. Düzenleyip yeniden onaya gönderebilir veya yeni teklif hazırlayabilirsiniz."
            : "Bu teklif henüz yönetici tarafından onaylanmadı: müşteriye verilemez, müşteri PDF’i üretilmez."}
          {store.demo ? " (Demo modunda PDF üretilmez.)" : ""}
        </p>
      )}

      {quote.status === "reddedildi" && quote.decision && (
        <section className="pj-panel qt-section qt-rejected">
          <h2 className="qt-section-title">Reddedildi · {REJECT_REASON_LABELS[quote.decision.reason || "diğer"]}</h2>
          <p className="pj-text">
            {quote.decision.byName} · {trailTime(quote.decision.at)}
            {quote.decision.note ? ` — ${quote.decision.note}` : ""}
          </p>
          {priceRejected && (
            <div className="qt-alternatives">
              <h3 className="qt-sub">Bu paraya ne verilebilir</h3>
              <p className="pj-muted">Teklifinizdeki ödeme planının bugünkü değeri, aşağıdaki müsait dairelerin liste fiyatını karşılıyor.</p>
              {alternatives == null ? (
                <p className="pj-muted">Daireler aranıyor…</p>
              ) : alternatives.length === 0 ? (
                <p className="pj-muted">Bu ödeme planının değeriyle karşılanan müsait daire bulunamadı. Peşinatı artırmayı veya vadeyi kısaltmayı deneyin.</p>
              ) : (
                <ul className="qt-alt-list">
                  {alternatives.map((alt) => {
                    const project = projects.find((p) => p.id === alt.projectId);
                    return (
                      <li key={alt.id}>
                        <span className="qt-alt-main">
                          <strong>
                            {project?.name} · {[alt.block && `${alt.block} Blok`, `No ${alt.unitNo}`].filter(Boolean).join(" · ")}
                          </strong>
                          <span className="pj-muted">{[alt.type, formatFloor(alt.floor), alt.grossM2 > 0 ? `${formatM2(alt.grossM2)} brüt` : "", alt.view].filter(Boolean).join(" · ")}</span>
                        </span>
                        <b className="qt-alt-price">{formatPrice(alt.listPrice, alt.currency)}</b>
                        {store.canCreate && (own || manager) && (
                          <button type="button" className="btn primary pj-touch" onClick={() => onNewForUnit(alt)}>
                            Bu daire için yeni teklif hazırla
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {manager && full.evaluation?.npv != null && (
        <section className="pj-panel qt-section qt-approval">
          <h2 className="qt-section-title">Yönetici değerlendirmesi</h2>
          <div className="qt-compare">
            <div>
              <span className="qt-compare-label">Net bugünkü değer (NBD)</span>
              <strong>{money(full.evaluation.npv)}</strong>
              <span className="pj-muted">aylık {formatPct(full.rates.discountMonthlyPct, 4)} para maliyetiyle</span>
            </div>
            <div>
              <span className="qt-compare-label">Liste fiyatı</span>
              <strong>{money(full.evaluation.listPrice)}</strong>
              <span className="pj-muted">daire kaydından</span>
            </div>
            <div className={full.evaluation.npvVsList < 0 ? "qt-compare-diff qt-neg" : "qt-compare-diff qt-pos"}>
              <span className="qt-compare-label">Fark (NBD − liste)</span>
              <strong>{money(full.evaluation.npvVsList)}</strong>
              <span>NBD, liste fiyatının {formatPct(full.evaluation.npvVsListPct)} kadarı</span>
            </div>
          </div>
          <dl className="qt-totals">
            <div>
              <dt>İskonto</dt>
              <dd>{formatPct(full.evaluation.discountPct)}</dd>
            </div>
            <div>
              <dt>Toplam ödeme (nominal)</dt>
              <dd>{money(full.evaluation.nominal)}</dd>
            </div>
            <div>
              <dt>Para maliyeti (nominal − NBD)</dt>
              <dd>{money(full.evaluation.costOfMoney)}</dd>
            </div>
            <div>
              <dt>Prim · satış bedelinin {formatPct(full.rates.commissionPct)}</dt>
              <dd>{money(full.commission)}</dd>
            </div>
          </dl>
          {quote.note && <p className="pj-text">Danışman notu: {quote.note}</p>}
          {listChanged && <p className="pj-note">Dairenin güncel liste fiyatı {formatPrice(unit!.listPrice, unit!.currency)}; bu teklif {money(quote.listPrice)} üzerinden değerlendirildi. Güncel fiyatla değerlendirmek için teklifi düzenleyin.</p>}
          {ratesChanged && <p className="pj-note">Bu teklif hazırlandığı tarihteki oranlarla hesaplandı; güncel oranlar farklı.</p>}
          {quote.status === "onay bekliyor" && (
            <div className="qt-decide">
              {rejecting ? (
                <>
                  <div className="pj-chips" role="group" aria-label="Ret gerekçesi">
                    {REJECT_REASONS.map((r) => (
                      <button type="button" key={r} className="pj-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                        {REJECT_REASON_LABELS[r]}
                      </button>
                    ))}
                  </div>
                  <textarea className="qt-note-input" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={reason === "fiyat" ? "Açıklama (isteğe bağlı)" : "Ret nedeni (zorunlu)"} aria-label="Ret açıklaması" />
                  {reason === "fiyat" && <p className="pj-muted">Danışman, bu ödeme planının bugünkü değeriyle karşılanan müsait daireleri görecek.</p>}
                  <div className="qt-decide-buttons">
                    <button type="button" className="btn secondary pj-touch" disabled={busy} onClick={() => setRejecting(false)}>
                      Vazgeç
                    </button>
                    <button type="button" className="btn primary pj-touch qt-reject-btn" disabled={busy || (reason === "diğer" && !note.trim())} onClick={() => void run("reject", { reason, note })}>
                      <X size={15} /> Reddet
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <textarea className="qt-note-input" rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Onay notu (isteğe bağlı)" aria-label="Onay notu" />
                  <div className="qt-decide-buttons">
                    <button type="button" className="btn secondary pj-touch qt-danger" disabled={busy} onClick={() => setRejecting(true)}>
                      <X size={15} /> Reddet…
                    </button>
                    <button type="button" className="btn primary pj-touch" disabled={busy} onClick={() => void run("approve", { note })}>
                      <Check size={15} /> Onayla
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      <section className="pj-panel qt-section">
        <h2 className="qt-section-title">Teklif özeti</h2>
        <dl className="pj-facts qt-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="qt-totals">
          <div>
            <dt>Liste fiyatı</dt>
            <dd>{money(quote.listPrice)}</dd>
          </div>
          <div className="qt-total-strong">
            <dt>Satış bedeli{Math.abs(quote.evaluation.discountPct) >= 0.005 ? ` · iskonto ${formatPct(quote.evaluation.discountPct)}` : ""}</dt>
            <dd>{money(quote.plan.salePrice)}</dd>
          </div>
          <div>
            <dt>Peşinat</dt>
            <dd>{money(quote.plan.downPayment)}</dd>
          </div>
          <div>
            <dt>Vade farkı · aylık {formatPct(quote.plan.monthlyRatePct, 4)}</dt>
            <dd>{money(quote.plan.vadeFarki)}</dd>
          </div>
          <div className="qt-total-strong">
            <dt>Toplam ödeme (ödeme bedeli)</dt>
            <dd>{money(quote.plan.totalPayable)}</dd>
          </div>
          <div>
            <dt>Aylık taksit{quote.plan.months ? ` · ${quote.plan.months} ay` : ""}</dt>
            <dd>{quote.plan.months ? money(quote.plan.installment) : "Peşin"}</dd>
          </div>
          {!manager && quote.commission != null && (
            <div>
              <dt>Priminiz{quote.rates.commissionPct != null ? ` · satış bedelinin ${formatPct(quote.rates.commissionPct)}` : ""}</dt>
              <dd>{money(quote.commission)}</dd>
            </div>
          )}
        </dl>
        {!manager && quote.commission != null && quote.status !== "satışa döndü" && <p className="pj-muted">Prim, teklif satışa döndüğünde hak edilir.</p>}
        {!manager && quote.note && <p className="pj-text">Yöneticiye not: {quote.note}</p>}
      </section>

      <div className="qt-detail-cols">
        <section className="pj-panel qt-section">
          <h2 className="qt-section-title">Ödeme planı</h2>
          <div className="qt-plan-scroll qt-plan-tall">
            <table className="pj-table qt-plan">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Vade</th>
                  <th>Açıklama</th>
                  <th className="pj-num">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {quote.plan.rows.map((row) => (
                  <tr key={row.no} className={row.kind === "taksit" ? undefined : "qt-plan-strong"}>
                    <td>{row.no}</td>
                    <td>{formatDay(row.dueDate)}</td>
                    <td>{row.kind === "peşinat" ? "Peşinat" : row.kind === "taksit" ? "Taksit" : "Ara ödeme"}</td>
                    <td className="pj-num">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Toplam ödeme</td>
                  <td className="pj-num">{money(quote.plan.totalPayable)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
        <section className="pj-panel qt-section">
          <h2 className="qt-section-title">Durum geçmişi</h2>
          <ol className="qt-trail">
            {quote.trail.map((entry, i) => (
              <li key={i} className={`qt-trail-${entry.action === "reddedildi" || entry.action === "iptal" ? "bad" : entry.action === "onaylandı" || entry.action === "satışa döndü" ? "ok" : "plain"}`}>
                <strong>{trailLabel[entry.action] || entry.action}</strong>
                <span className="pj-muted">
                  {entry.byName} · {trailTime(entry.at)}
                </span>
                {(entry.reason || entry.note) && <span className="qt-trail-note">{[entry.reason && REJECT_REASON_LABELS[entry.reason], entry.note].filter(Boolean).join(" — ")}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
