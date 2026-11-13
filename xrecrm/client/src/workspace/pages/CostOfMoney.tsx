// Para maliyeti: yöneticinin belirlediği tek aylık oranla her teklifin/satışın net bugünkü değeri,
// para maliyeti (nominal − NBD) ve liste fiyatıyla karşılaştırması; proje ve ay toplamları, primler, oranlar.
// Yalnız yöneticiye (alan sahibi veya "Teklifler: yazma" yetkisi) açıktır.
import { useEffect, useMemo, useState } from "react";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { buildPaymentPlan } from "../../../../shared/sales-finance";
import {
  QUOTE_STATUSES,
  QuoteSettingsSchema,
  commissionSummary,
  costRows,
  costTotals,
  formatDay,
  formatMoney,
  formatMonth,
  formatPct,
  statusLabel,
  type CostFilters,
  type CostTotal,
  type Quote,
  type QuoteSettings,
  type QuoteSettingsInput,
  type QuoteStatus,
} from "../../../../shared/quotes";
import { Empty, PageTitle } from "../components/ui";
import { useInventory } from "../projects";
import { goTo, useQuotes, type QuoteStore } from "../quotes";
import { withBase } from "../nav";
import { NumberField, useMedia } from "../components/projects/UnitExplorer";
import { quoteTone } from "../components/quotes/QuoteDetail";
import "../suite-pages.css";
import "../projects.css";
import "../quotes.css";

type View = "teklifler" | "proje" | "ay" | "primler" | "oranlar";

function Pair({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={strong ? "qt-pair-strong" : undefined}>
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  );
}

function TotalsTable({ totals, first, phone }: { totals: CostTotal[]; first: string; phone: boolean }) {
  if (!totals.length) return <Empty title="Kayıt yok" description="Seçili filtrelere uyan teklif bulunmuyor." />;
  if (phone)
    return (
      <ul className="qt-cards qt-report-cards">
        {totals.map((t) => (
          <li key={`${t.key}-${t.currency}`} className="qt-report-card">
            <span className="qt-card-top">
              <strong>{first === "Ay" ? formatMonth(t.label) : t.label}</strong>
              <span className="pj-muted">
                {t.currency} · {t.count} teklif
              </span>
            </span>
            <dl className="qt-pairs">
              <Pair label="Liste fiyatı" value={formatMoney(t.listPrice, t.currency)} />
              <Pair label="Satış bedeli" value={formatMoney(t.salePrice, t.currency)} />
              <Pair label="Toplam ödeme (nominal)" value={formatMoney(t.nominal, t.currency)} />
              <Pair label="NBD" value={formatMoney(t.npv, t.currency)} />
              <Pair label="Para maliyeti" value={formatMoney(t.costOfMoney, t.currency)} strong />
              <Pair label="NBD − liste" value={formatMoney(t.npvVsList, t.currency)} tone={t.npvVsList < 0 ? "qt-neg" : "qt-pos"} />
              <Pair label="Prim" value={formatMoney(t.commission, t.currency)} />
            </dl>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="pj-table-wrap">
      <table className="pj-table qt-table qt-static qt-dense">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="pj-num">Satış bedeli</th>
            <th className="pj-num">Nominal toplam</th>
            <th className="pj-num">NBD</th>
            <th className="pj-num">Para maliyeti</th>
            <th className="pj-num">NBD − liste</th>
            <th className="pj-num">Prim</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((t) => (
            <tr key={`${t.key}-${t.currency}`}>
              <td className="qt-cell-wrap">
                <strong>{first === "Ay" ? formatMonth(t.label) : t.label}</strong>
                <span className="qt-cell-sub">
                  {t.currency} · {t.count} teklif
                </span>
              </td>
              <td className="pj-num">
                {formatMoney(t.salePrice, t.currency)}
                <span className="qt-cell-sub">liste {formatMoney(t.listPrice, t.currency)}</span>
              </td>
              <td className="pj-num">{formatMoney(t.nominal, t.currency)}</td>
              <td className="pj-num">{formatMoney(t.npv, t.currency)}</td>
              <td className="pj-num pj-price">{formatMoney(t.costOfMoney, t.currency)}</td>
              <td className={`pj-num ${t.npvVsList < 0 ? "qt-neg" : "qt-pos"}`}>
                {formatMoney(t.npvVsList, t.currency)}
                {t.listPrice > 0 && <span className="qt-cell-sub">NBD, listenin {formatPct((t.npv / t.listPrice) * 100)} kadarı</span>}
              </td>
              <td className="pj-num">{formatMoney(t.commission, t.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsForm({ store }: { store: QuoteStore }) {
  const current = store.settings as QuoteSettings | null;
  const [vade, setVade] = useState<number | null>(current?.vadeFarkiMonthlyPct ?? null);
  const [discount, setDiscount] = useState<number | null>(current?.discountMonthlyPct ?? null);
  const [commission, setCommission] = useState<number | null>(current?.commissionPct ?? null);
  const [maxMonths, setMaxMonths] = useState<number | null>(current?.maxMonths ?? 120);
  const [minDown, setMinDown] = useState<number | null>(current?.minDownPaymentPct ?? 0);
  const [validDays, setValidDays] = useState<number | null>(current?.quoteValidDays ?? 7);
  const [option, setOption] = useState(current?.optionOnApproval ?? true);
  const [company, setCompany] = useState({ name: current?.companyName || "", address: current?.companyAddress || "", phone: current?.companyPhone || "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!current) return;
    setVade(current.vadeFarkiMonthlyPct);
    setDiscount(current.discountMonthlyPct);
    setCommission(current.commissionPct);
    setMaxMonths(current.maxMonths);
    setMinDown(current.minDownPaymentPct);
    setValidDays(current.quoteValidDays);
    setOption(current.optionOnApproval);
    setCompany({ name: current.companyName, address: current.companyAddress, phone: current.companyPhone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.updatedAt]);

  const example = useMemo(() => {
    if (vade == null || !(vade >= 0) || vade > 20) return null;
    try {
      return buildPaymentPlan({ salePrice: 3_000_000, downPayment: 0, months: 60, monthlyRatePct: vade, startDate: "2026-01-01" });
    } catch {
      return null;
    }
  }, [vade]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = QuoteSettingsSchema.safeParse({
      vadeFarkiMonthlyPct: vade, discountMonthlyPct: discount, commissionPct: commission, maxMonths, minDownPaymentPct: minDown, quoteValidDays: validDays, optionOnApproval: option,
      companyName: company.name, companyAddress: company.address, companyPhone: company.phone,
    } as QuoteSettingsInput);
    if (!parsed.success) return void toast.error("Oranları ve sınırları eksiksiz girin (oranlar %0–%20, prim %0–%100, taksit en çok 240 ay).");
    setSaving(true);
    try {
      await store.saveSettings(parsed.data);
      toast.success("Oranlar kaydedildi. Mevcut teklifler kendi oranlarıyla kalır; yeni teklifler bu oranları kullanır.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="pj-panel qt-section pj-form qt-settings" onSubmit={submit}>
      <h2 className="qt-section-title">Oranlar ve sınırlar</h2>
      <p className="pj-muted">
        Bu değerleri yalnız yönetici değiştirir. Değişiklik mevcut teklifleri etkilemez; her teklif hazırlandığı andaki oranlarla saklanır.
        {current ? ` Son güncelleme: ${formatDay(current.updatedAt)} · ${current.updatedBy}` : " Henüz oran girilmedi: oranlar girilene kadar teklif hazırlanamaz."}
      </p>
      <div className="qt-settings-grid">
        <div className="sx-field">
          Aylık para maliyeti oranı (%)
          <NumberField label="Aylık para maliyeti oranı" value={discount} onChange={setDiscount} placeholder="ör. 2,5" />
          <span className="pj-muted">Net bugünkü değer bu tek oranla hesaplanır. Çalışanlar bu oranı göremez.</span>
        </div>
        <div className="sx-field">
          Aylık vade farkı oranı (%)
          <NumberField label="Aylık vade farkı oranı" value={vade} onChange={setVade} placeholder="ör. 1,1111111111" />
          <span className="pj-muted">
            Düz hesap: vadeye kalan × oran × ay.
            {example ? ` 3.000.000 TL, 60 ay → vade farkı ${formatMoney(example.vadeFarki)}, toplam ${formatMoney(example.totalPayable)}.` : ""}
          </span>
        </div>
        <div className="sx-field">
          Prim oranı (%)
          <NumberField label="Prim oranı" value={commission} onChange={setCommission} placeholder="ör. 2" />
          <span className="pj-muted">Satış bedelinin sabit yüzdesi (vade farkı prime dâhil değildir).</span>
        </div>
        <div className="sx-field">
          En çok taksit sayısı (ay)
          <NumberField label="En çok taksit sayısı" integer value={maxMonths} onChange={setMaxMonths} />
        </div>
        <div className="sx-field">
          En az peşinat (%)
          <NumberField label="En az peşinat" value={minDown} onChange={setMinDown} />
          <span className="pj-muted">Satış bedelinin yüzdesi.</span>
        </div>
        <div className="sx-field">
          Teklif geçerlilik süresi (gün)
          <NumberField label="Teklif geçerlilik süresi" integer value={validDays} onChange={setValidDays} />
          <span className="pj-muted">Onay gününden başlar; süresi dolan teklif gönderilemez.</span>
        </div>
        <label className="qt-check sx-span-2">
          <input type="checkbox" checked={option} onChange={(e) => setOption(e.target.checked)} />
          <span>Onaylanan teklifin dairesini geçerlilik süresince “opsiyonlu” yap</span>
        </label>
        <label className="sx-field">
          Firma adı (PDF başlığı)
          <input className="pj-input" value={company.name} maxLength={200} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
        </label>
        <label className="sx-field">
          Firma telefonu
          <input className="pj-input" value={company.phone} maxLength={60} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
        </label>
        <label className="sx-field sx-span-2">
          Firma adresi
          <input className="pj-input" value={company.address} maxLength={500} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
        </label>
      </div>
      <div className="qt-settings-foot">
        <button type="submit" className="btn primary pj-touch" disabled={saving}>
          <Save size={15} /> Oranları kaydet
        </button>
      </div>
    </form>
  );
}

export default function CostOfMoney() {
  const inventory = useInventory();
  const store = useQuotes(inventory);
  const phone = useMedia("(max-width: 760px)");
  const [view, setView] = useState<View>("teklifler");
  const [projectId, setProjectId] = useState("");
  const [statuses, setStatuses] = useState<QuoteStatus[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employee, setEmployee] = useState("");
  const settings = store.settings as QuoteSettings | null;
  // Yöneticide teklifler tüm alanlarıyla gelir; rapor aynı saf işlevlerle tarayıcıda hesaplanır.
  const quotes = (store.manager ? store.quotes : []) as Quote[];
  const filters: CostFilters = useMemo(() => ({ projectId: projectId || undefined, statuses, from: from || undefined, to: to || undefined, employee: employee || undefined }), [projectId, statuses, from, to, employee]);
  const rows = useMemo(() => costRows(quotes, filters), [quotes, filters]);
  const totals = useMemo(() => costTotals(rows, "all"), [rows]);
  const byProject = useMemo(() => costTotals(rows, "project"), [rows]);
  const byMonth = useMemo(() => costTotals(rows, "month"), [rows]);
  const commissions = useMemo(() => commissionSummary(quotes.filter((q) => (!projectId || q.projectId === projectId) && (!employee || q.employee.openId === employee))), [quotes, projectId, employee]);
  const employees = useMemo(() => [...new Map(quotes.map((q) => [q.employee.openId, q.employee.name])).entries()].sort((a, b) => a[1].localeCompare(b[1], "tr")), [quotes]);
  const projects = useMemo(() => [...new Map(quotes.map((q) => [q.projectId, q.unit.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1], "tr")), [quotes]);
  const filtered = Boolean(projectId || statuses.length || from || to || employee);

  useEffect(() => {
    if (!store.loading && store.manager && !settings) setView("oranlar");
  }, [store.loading, store.manager, settings]);

  if (!store.loading && !store.manager)
    return (
      <div className="pj-page qt-page">
        <PageTitle title="Para maliyeti" description="Bu ekran yalnız yöneticilere (teklif onay yetkisi olanlara) açıktır." />
        {store.demo && <p className="pj-note">Demo modunda “Teklifler” sayfasından yönetici görünümüne geçebilirsiniz.</p>}
        <button type="button" className="btn secondary" onClick={() => goTo("/quotes", withBase)}>
          Tekliflere dön
        </button>
      </div>
    );

  return (
    <div className="pj-page qt-page">
      <PageTitle
        eyebrow="GAYRİMENKUL SATIŞ"
        title="Para maliyeti"
        description="Vadeli satışın bugünkü değeri: her teklifin nominal toplamı, net bugünkü değeri (NBD), para maliyeti ve liste fiyatıyla karşılaştırması."
        actions={
          <>
            <button type="button" className="btn secondary pj-touch" onClick={() => goTo("/quotes", withBase)}>
              Teklifler
            </button>
            <button type="button" className="btn primary pj-touch" onClick={() => store.downloadCostCsv(filters)} disabled={!rows.length}>
              <Download size={16} /> CSV indir
            </button>
          </>
        }
      />
      <div className="qt-kpis">
        <div className="pj-panel qt-kpi qt-kpi-rate">
          <span className="qt-compare-label">Güncel aylık para maliyeti oranı</span>
          <strong>{settings ? formatPct(settings.discountMonthlyPct, 4) : "—"}</strong>
          <span className="pj-muted">{settings ? `Vade farkı ${formatPct(settings.vadeFarkiMonthlyPct, 4)} / ay · prim ${formatPct(settings.commissionPct)}` : "Oranlar henüz girilmedi"}</span>
        </div>
        {totals.map((t) => (
          <div className="pj-panel qt-kpi" key={t.currency}>
            <span className="qt-compare-label">
              Para maliyeti · {t.currency} · {t.count} teklif{filtered ? " (filtreli)" : " (tüm durumlar)"}
            </span>
            <strong>{formatMoney(t.costOfMoney, t.currency)}</strong>
            <span className="pj-muted">
              Nominal {formatMoney(t.nominal, t.currency)} · NBD {formatMoney(t.npv, t.currency)}
            </span>
            <span className={t.npvVsList < 0 ? "qt-neg" : "qt-pos"}>
              NBD − liste: {formatMoney(t.npvVsList, t.currency)}
              {t.listPrice > 0 ? ` (${formatPct((t.npv / t.listPrice) * 100)})` : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="qt-tabs" role="tablist" aria-label="Görünüm">
        {(
          [
            ["teklifler", `Teklifler (${rows.length})`],
            ["proje", "Proje toplamları"],
            ["ay", "Aylık toplamlar"],
            ["primler", "Primler"],
            ["oranlar", "Oranlar"],
          ] as [View, string][]
        ).map(([key, label]) => (
          <button type="button" role="tab" key={key} aria-selected={view === key} className="qt-tab" onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>

      {view !== "oranlar" && (
        <div className="pj-panel qt-filters">
          <label className="pj-filter">
            <span className="pj-filter-label">Proje</span>
            <select className="pj-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Tüm projeler</option>
              {projects.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          <label className="pj-filter">
            <span className="pj-filter-label">Çalışan</span>
            <select className="pj-input" value={employee} onChange={(e) => setEmployee(e.target.value)}>
              <option value="">Tüm çalışanlar</option>
              {employees.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </label>
          {view !== "primler" && (
            <>
              <label className="pj-filter">
                <span className="pj-filter-label">Teklif tarihi (başlangıç)</span>
                <input className="pj-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="pj-filter">
                <span className="pj-filter-label">Teklif tarihi (bitiş)</span>
                <input className="pj-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <div className="pj-chips qt-status-filter" role="group" aria-label="Durum">
                <span className="pj-filter-label">Durum</span>
                <button type="button" className="pj-chip" aria-pressed={statuses.length === 0} onClick={() => setStatuses([])}>
                  Tümü
                </button>
                {QUOTE_STATUSES.map((s) => (
                  <button type="button" key={s} className="pj-chip" aria-pressed={statuses.includes(s)} onClick={() => setStatuses((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]))}>
                    {statusLabel(s)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {store.error && <p className="pj-error" role="alert">{store.error}</p>}
      {view === "oranlar" ? (
        <SettingsForm store={store} />
      ) : store.loading && !quotes.length ? (
        <div className="pj-panel pj-loading" role="status">
          Yükleniyor…
        </div>
      ) : view === "teklifler" ? (
        <div className="pj-panel">
          {rows.length === 0 ? (
            <Empty title="Kayıt yok" description="Seçili filtrelere uyan teklif bulunmuyor." />
          ) : phone ? (
            <ul className="qt-cards qt-report-cards">
              {rows.map((r) => (
                <li key={r.id} className="qt-report-card">
                  <span className="qt-card-top">
                    <strong>{r.quoteNo}</strong>
                    <span className={`pj-status pj-tone-${quoteTone[r.status]} qt-status`}>{statusLabel(r.status)}</span>
                  </span>
                  <span className="pj-muted">
                    {formatDay(r.date)} · {r.projectName} · {r.unitLabel} · {r.customer} · {r.employee}
                  </span>
                  <dl className="qt-pairs">
                    <Pair label="Liste fiyatı" value={formatMoney(r.listPrice, r.currency)} />
                    <Pair label="Satış bedeli" value={formatMoney(r.salePrice, r.currency)} />
                    <Pair label="Toplam ödeme (nominal)" value={formatMoney(r.nominal, r.currency)} />
                    <Pair label="NBD" value={formatMoney(r.npv, r.currency)} />
                    <Pair label="Para maliyeti" value={formatMoney(r.costOfMoney, r.currency)} strong />
                    <Pair label="NBD − liste" value={`${formatMoney(r.npvVsList, r.currency)} · ${formatPct(r.npvVsListPct)}`} tone={r.npvVsList < 0 ? "qt-neg" : "qt-pos"} />
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <div className="pj-table-wrap">
              <table className="pj-table qt-table qt-static qt-dense">
                <thead>
                  <tr>
                    <th>Teklif</th>
                    <th>Durum</th>
                    <th>Proje / daire</th>
                    <th className="pj-num">Satış bedeli</th>
                    <th className="pj-num">Nominal toplam</th>
                    <th className="pj-num">NBD</th>
                    <th className="pj-num">Para maliyeti</th>
                    <th className="pj-num">NBD − liste</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.quoteNo}</strong>
                        <span className="qt-cell-sub">{formatDay(r.date)}</span>
                      </td>
                      <td>
                        <span className={`pj-status pj-tone-${quoteTone[r.status]} qt-status`}>{statusLabel(r.status)}</span>
                      </td>
                      <td className="qt-cell-wrap">
                        {r.projectName} · {r.unitLabel}
                        <span className="qt-cell-sub">
                          {r.customer} · {r.employee}
                        </span>
                      </td>
                      <td className="pj-num">
                        {formatMoney(r.salePrice, r.currency)}
                        <span className="qt-cell-sub">liste {formatMoney(r.listPrice, r.currency)}</span>
                      </td>
                      <td className="pj-num">{formatMoney(r.nominal, r.currency)}</td>
                      <td className="pj-num">{formatMoney(r.npv, r.currency)}</td>
                      <td className="pj-num pj-price">{formatMoney(r.costOfMoney, r.currency)}</td>
                      <td className={`pj-num ${r.npvVsList < 0 ? "qt-neg" : "qt-pos"}`}>
                        {formatMoney(r.npvVsList, r.currency)}
                        <span className="qt-cell-sub">NBD, listenin {formatPct(r.npvVsListPct)} kadarı</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pj-muted qt-foot-note">Her satır, teklifin hazırlandığı andaki para maliyeti oranıyla hesaplanmıştır. Dönem: teklif tarihi.</p>
        </div>
      ) : view === "proje" ? (
        <div className="pj-panel">
          <TotalsTable totals={byProject} first="Proje" phone={phone} />
        </div>
      ) : view === "ay" ? (
        <div className="pj-panel">
          <TotalsTable totals={byMonth} first="Ay" phone={phone} />
        </div>
      ) : (
        <div className="pj-panel">
          {commissions.length === 0 ? (
            <Empty title="Henüz prim yok" description="Prim, teklif “satışa döndü” olduğunda oluşur." />
          ) : (
            <div className="pj-table-wrap">
              <table className="pj-table qt-table qt-static">
                <thead>
                  <tr>
                    <th>Satış ayı</th>
                    <th>Çalışan</th>
                    <th>Para birimi</th>
                    <th className="pj-num">Satış adedi</th>
                    <th className="pj-num">Satış bedeli toplamı</th>
                    <th className="pj-num">Prim toplamı</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={`${c.employeeOpenId}-${c.month}-${c.currency}`}>
                      <td>{formatMonth(c.month)}</td>
                      <td>
                        <strong>{c.employee}</strong>
                      </td>
                      <td>{c.currency}</td>
                      <td className="pj-num">{c.count}</td>
                      <td className="pj-num">{formatMoney(c.salePrice, c.currency)}</td>
                      <td className="pj-num pj-price">{formatMoney(c.commission, c.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pj-muted qt-foot-note">Yalnız “satışa döndü” durumundaki teklifler sayılır; prim = satış bedeli × teklifin prim oranı. Ay: satışın gerçekleştiği ay.</p>
        </div>
      )}
    </div>
  );
}
