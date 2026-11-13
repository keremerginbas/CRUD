// Teklif hazırlama / düzenleme penceresi: müşteri, satış bedeli, peşinat, taksit ve ara ödemeler.
// Ödeme planı tarayıcıda canlı önizlenir (shared/sales-finance.ts); kayıtta tutarları sunucu yeniden hesaplar.
import { useMemo, useState } from "react";
import { Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatPrice, type Project, type Unit } from "../../../../../shared/real-estate";
import {
  QuoteError,
  assertWithinLimits,
  computeQuote,
  formatDay,
  formatMoney,
  formatPct,
  isoDay,
  type QuoteDraft,
  type QuoteRates,
  type VisibleQuote,
} from "../../../../../shared/quotes";
import { Modal } from "../ui";
import { useStore } from "../../store";
import type { QuoteStore } from "../../quotes";
import { NumberField } from "../projects/UnitExplorer";

const fold = (value: string) => value.trim().toLocaleLowerCase("tr-TR");

export interface QuoteEditorSeed {
  leadId?: string;
  downPayment?: number;
  months?: number;
}

export default function QuoteEditor({
  store, unit, project, quote, seed, onClose, onSaved,
}: {
  store: QuoteStore;
  unit: Unit;
  project?: Project;
  /** Doluysa düzenleme. */
  quote?: VisibleQuote;
  seed?: QuoteEditorSeed;
  onClose: () => void;
  onSaved: (quote: VisibleQuote) => void;
}) {
  const { data } = useStore();
  const { settings, manager } = store;
  const [leadId, setLeadId] = useState(quote?.leadId || seed?.leadId || "");
  const [leadSearch, setLeadSearch] = useState("");
  const [salePrice, setSalePrice] = useState<number | null>(quote?.inputs.salePrice ?? unit.listPrice);
  const [downPayment, setDownPayment] = useState<number | null>(quote?.inputs.downPayment ?? seed?.downPayment ?? null);
  const [months, setMonths] = useState<number | null>(quote?.inputs.months ?? seed?.months ?? 12);
  const [startDate, setStartDate] = useState(quote?.inputs.startDate || isoDay(new Date()));
  const [balloons, setBalloons] = useState<{ month: number | null; amount: number | null }[]>(quote?.inputs.balloons.map((b) => ({ ...b })) || []);
  const [note, setNote] = useState(quote?.note || "");
  const [saving, setSaving] = useState(false);

  const leads = useMemo(() => {
    const words = fold(leadSearch).split(/\s+/).filter(Boolean);
    const list = data.leads.filter((l) => l.id === leadId || words.every((w) => fold(`${l.name} ${l.phone} ${l.company}`).includes(w)));
    return list.sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, 80);
  }, [data.leads, leadSearch, leadId]);
  const lead = data.leads.find((l) => l.id === leadId);

  // Önizleme oranları: düzenlemede teklifin kendi oranları, yeni teklifte güncel ayarlar.
  // Para maliyeti oranı yalnız yöneticide bulunur; çalışanın önizlemesinde NBD hesaplanmaz.
  const rates: QuoteRates | null = settings
    ? {
        vadeFarkiMonthlyPct: quote?.rates.vadeFarkiMonthlyPct ?? settings.vadeFarkiMonthlyPct,
        discountMonthlyPct: quote?.rates.discountMonthlyPct ?? settings.discountMonthlyPct ?? 0,
        commissionPct: quote?.rates.commissionPct ?? settings.commissionPct,
      }
    : null;
  const draft: QuoteDraft | null =
    salePrice != null && salePrice > 0 && months != null
      ? {
          unitId: unit.id,
          leadId,
          salePrice,
          downPayment: downPayment ?? 0,
          months,
          balloons: balloons.filter((b) => b.month != null && b.amount != null && b.amount > 0).map((b) => ({ month: b.month as number, amount: b.amount as number })),
          startDate,
          note: note.trim(),
        }
      : null;
  const preview = useMemo(() => {
    if (!draft || !rates || !settings) return { error: !rates ? "" : "Satış bedelini ve taksit sayısını girin." };
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) throw new QuoteError("Satış tarihini seçin.");
      if (!Number.isInteger(draft.months)) throw new QuoteError("Taksit sayısı tam sayı olmalı.");
      const inputs = { ...draft, currency: unit.currency };
      assertWithinLimits(inputs, settings);
      return { ...computeQuote(inputs, rates, unit.listPrice), error: "" };
    } catch (error) {
      return { error: (error as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft), JSON.stringify(rates), settings, unit.listPrice, unit.currency]);
  const plan = "plan" in preview ? preview.plan : null;
  const money = (value: number) => formatMoney(value, unit.currency);
  const discountPct = salePrice && unit.listPrice > 0 ? ((unit.listPrice - salePrice) / unit.listPrice) * 100 : 0;
  const reapproval =
    quote?.status === "onaylandı" &&
    draft &&
    (draft.salePrice !== quote.inputs.salePrice || draft.downPayment !== quote.inputs.downPayment || draft.months !== quote.inputs.months || draft.startDate !== quote.inputs.startDate || JSON.stringify(draft.balloons) !== JSON.stringify(quote.inputs.balloons));
  const canSubmit = !quote || quote.status === "taslak" || quote.status === "reddedildi";

  const save = async (submit: boolean) => {
    if (!draft || !plan) return;
    if (!leadId) return void toast.error("Müşteri seçin.");
    setSaving(true);
    try {
      const saved = await store.save(draft, { id: quote?.id, submit });
      toast.success(saved.status === "onay bekliyor" ? `${saved.quoteNo} yönetici onayına gönderildi.` : `${saved.quoteNo} kaydedildi.`);
      onSaved(saved);
    } catch (error) {
      toast.error((error as Error).message || "Teklif kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const title = quote ? `${quote.quoteNo} · düzenle` : "Teklif hazırla";
  const subtitle = [project?.name, unit.block && `${unit.block} Blok`, `No ${unit.unitNo}`, unit.type].filter(Boolean).join(" · ");
  if (!settings)
    return (
      <Modal title={title} subtitle={subtitle} onClose={onClose}>
        <p className="pj-note">
          Teklif hazırlanabilmesi için önce yöneticinin oranları (vade farkı, para maliyeti, prim) belirlemesi gerekir.
          {manager ? " “Para maliyeti” sayfasındaki “Oranlar” sekmesinden girebilirsiniz." : " Yöneticinizden oranları girmesini isteyin."}
        </p>
      </Modal>
    );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={title} className="modal wide qt-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Kapat">
            <X size={19} />
          </button>
        </header>
      <form
        className="sx-modal-form pj-form qt-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <div className="qt-editor-grid">
          <div className="qt-editor-fields">
            <div className="sx-field">
              Müşteri
              <input className="pj-input" value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} placeholder="Ad, telefon veya şirket ara…" aria-label="Müşteri ara" disabled={quote?.status === "onaylandı"} />
              <select className="pj-input qt-lead-select" aria-label="Müşteri" value={leadId} onChange={(e) => setLeadId(e.target.value)} required disabled={quote?.status === "onaylandı"}>
                <option value="">Müşteri seçin…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.phone ? ` · ${l.phone}` : ""}
                  </option>
                ))}
              </select>
              {lead ? <span className="pj-muted">{[lead.phone, lead.company].filter(Boolean).join(" · ") || "Telefon girilmemiş"}</span> : !data.leads.length ? <span className="pj-muted">Önce CRM’de müşteri kaydı açın.</span> : null}
            </div>
            <div className="qt-field-row">
              <div className="sx-field">
                Satış bedeli ({unit.currency})
                <NumberField label="Satış bedeli" price value={salePrice} onChange={setSalePrice} />
                <span className="pj-muted">
                  Liste: {formatPrice(unit.listPrice, unit.currency)}
                  {Math.abs(discountPct) >= 0.005 ? ` · ${discountPct > 0 ? "iskonto" : "liste üstü"} ${formatPct(Math.abs(discountPct))}` : " · iskonto yok"}
                </span>
              </div>
              <div className="sx-field">
                Peşinat
                <NumberField label="Peşinat" price value={downPayment} onChange={setDownPayment} placeholder="0" />
                <span className="pj-muted">
                  {salePrice && downPayment ? `${formatPct((downPayment / salePrice) * 100, 1)} · ` : ""}
                  en az {formatPct(settings.minDownPaymentPct)}
                </span>
              </div>
            </div>
            <div className="qt-field-row">
              <div className="sx-field">
                Taksit sayısı (ay)
                <NumberField label="Taksit sayısı" integer value={months} onChange={setMonths} placeholder="0 = peşin" />
                <span className="pj-muted">en çok {settings.maxMonths} ay · 0 = peşin satış</span>
              </div>
              <label className="sx-field">
                Satış / peşinat tarihi
                <input className="pj-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
                <span className="pj-muted">İlk taksit bir ay sonra</span>
              </label>
            </div>
            <div className="sx-field">
              <span className="qt-balloon-head">
                Ara ödemeler
                <button type="button" className="pj-link" onClick={() => setBalloons((list) => [...list, { month: null, amount: null }])} disabled={balloons.length >= 60}>
                  <Plus size={14} /> Ara ödeme ekle
                </button>
              </span>
              {balloons.length === 0 && <span className="pj-muted">Yok. Ara ödeme eklenirse toplam değişmez, aylık taksit küçülür.</span>}
              {balloons.map((b, i) => (
                <div className="qt-balloon" key={i}>
                  <NumberField label={`Ara ödeme ${i + 1} ayı`} integer placeholder="Ay (ör. 12)" value={b.month} onChange={(v) => setBalloons((list) => list.map((x, j) => (j === i ? { ...x, month: v } : x)))} />
                  <NumberField label={`Ara ödeme ${i + 1} tutarı`} price placeholder="Tutar" value={b.amount} onChange={(v) => setBalloons((list) => list.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  <button type="button" className="icon-button" aria-label={`Ara ödeme ${i + 1} sil`} onClick={() => setBalloons((list) => list.filter((_, j) => j !== i))}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <label className="sx-field">
              Yöneticiye not (belgede yer almaz)
              <textarea rows={2} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div className="qt-preview" aria-live="polite">
            <h3 className="qt-preview-title">Ödeme planı önizlemesi</h3>
            {preview.error ? (
              <p className="pj-error" role="alert">{preview.error}</p>
            ) : plan ? (
              <>
                <dl className="qt-totals">
                  <div>
                    <dt>Satış bedeli</dt>
                    <dd>{money(plan.salePrice)}</dd>
                  </div>
                  <div>
                    <dt>Peşinat</dt>
                    <dd>{money(plan.downPayment)}</dd>
                  </div>
                  <div>
                    <dt>Vadeye kalan</dt>
                    <dd>{money(plan.financed)}</dd>
                  </div>
                  <div>
                    <dt>Vade farkı · aylık {formatPct(plan.monthlyRatePct, 4)}</dt>
                    <dd>{money(plan.vadeFarki)}</dd>
                  </div>
                  <div className="qt-total-strong">
                    <dt>Toplam ödeme</dt>
                    <dd>{money(plan.totalPayable)}</dd>
                  </div>
                  <div className="qt-total-strong">
                    <dt>Aylık taksit{plan.months ? ` · ${plan.months} ay` : ""}</dt>
                    <dd>{plan.months ? money(plan.installment) : "—"}</dd>
                  </div>
                </dl>
                {manager && "evaluation" in preview && preview.evaluation && (
                  <dl className="qt-totals qt-manager-totals">
                    <div>
                      <dt>Net bugünkü değer</dt>
                      <dd>{money(preview.evaluation.npv)}</dd>
                    </div>
                    <div>
                      <dt>NBD − liste fiyatı</dt>
                      <dd className={preview.evaluation.npvVsList < 0 ? "qt-neg" : "qt-pos"}>
                        {money(preview.evaluation.npvVsList)} · {formatPct(preview.evaluation.npvVsListPct)}
                      </dd>
                    </div>
                    <div>
                      <dt>Para maliyeti</dt>
                      <dd>{money(preview.evaluation.costOfMoney)}</dd>
                    </div>
                    <div>
                      <dt>Prim · {formatPct(rates!.commissionPct)}</dt>
                      <dd>{money(preview.commission)}</dd>
                    </div>
                  </dl>
                )}
                <div className="qt-plan-scroll">
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
                      {plan.rows.map((row) => (
                        <tr key={row.no} className={row.kind === "taksit" ? undefined : "qt-plan-strong"}>
                          <td>{row.no}</td>
                          <td>{formatDay(row.dueDate)}</td>
                          <td>{row.kind === "peşinat" ? "Peşinat" : row.kind === "taksit" ? "Taksit" : "Ara ödeme"}</td>
                          <td className="pj-num">{money(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
        {reapproval && <p className="pj-note">Tutarları değiştirdiniz: kaydedince teklif yeniden yönetici onayına gider ve daire opsiyonu kalkar.</p>}
        {quote && quote.rates.vadeFarkiMonthlyPct !== settings.vadeFarkiMonthlyPct && (
          <p className="pj-note">Bu teklif hazırlandığı tarihteki oranlarla ({formatPct(quote.rates.vadeFarkiMonthlyPct, 4)} / ay) hesaplanır. Güncel oran için yeni teklif hazırlayın.</p>
        )}
        <div className="sx-modal-footer">
          <span className="pj-muted">Müşteriye verilmeden önce her teklif yönetici onayından geçer.</span>
          <div className="sx-actions">
            <button type="submit" className="btn secondary pj-touch" disabled={saving || !plan}>
              {quote && !canSubmit ? "Kaydet" : "Taslak olarak kaydet"}
            </button>
            {canSubmit && (
              <button type="button" className="btn primary pj-touch" disabled={saving || !plan} onClick={() => void save(true)}>
                <Send size={15} /> Onaya gönder
              </button>
            )}
          </div>
        </div>
      </form>
      </section>
    </div>
  );
}
