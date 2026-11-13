// Teklifler: ödeme planlı satış teklifleri, yönetici onay kuyruğu ve teklif ayrıntısı.
// Gayrimenkul satış modülünün 2. fazı. Her teklif müşteriye verilmeden önce yönetici onayından geçer.
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { activeInventory, formatPrice, type Unit } from "../../../../shared/real-estate";
import { formatDay, formatMoney, formatPct, isOwnQuote, unitLabelOf, type Quote, type QuoteStatus, type VisibleQuote } from "../../../../shared/quotes";
import { Empty, Modal, PageTitle } from "../components/ui";
import { useInventory } from "../projects";
import { goTo, useQuotes } from "../quotes";
import { withBase } from "../nav";
import { useMedia } from "../components/projects/UnitExplorer";
import QuoteEditor, { type QuoteEditorSeed } from "../components/quotes/QuoteEditor";
import QuoteDetail, { StatusChip } from "../components/quotes/QuoteDetail";
import "../suite-pages.css";
import "../projects.css";
import "../quotes.css";

type Tab = "bekleyen" | "hepsi" | QuoteStatus;
const TABS: [Tab, string][] = [
  ["bekleyen", "Onay bekleyenler"],
  ["hepsi", "Tümü"],
  ["taslak", "Taslak"],
  ["onaylandı", "Onaylandı"],
  ["reddedildi", "Reddedildi"],
  ["müşteriye gönderildi", "Gönderildi"],
  ["satışa döndü", "Satış"],
  ["iptal", "İptal"],
];
const fold = (value: string) => value.toLocaleLowerCase("tr-TR");

/** Yeni teklif için daire seçimi (Projeler sayfasına gitmeden). */
function UnitPicker({ units, projects, onPick, onClose }: { units: Unit[]; projects: { id: string; name: string }[]; onPick: (unit: Unit) => void; onClose: () => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const list = units.filter((u) => u.projectId === projectId && u.status !== "satıldı" && u.listPrice > 0).sort((a, b) => a.listPrice - b.listPrice);
  return (
    <Modal title="Yeni teklif" subtitle="Teklif hazırlanacak daireyi seçin" onClose={onClose}>
      <div className="pj-form qt-picker">
        <label className="sx-field">
          Proje
          <select className="pj-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {list.length === 0 ? (
          <p className="pj-muted">Bu projede teklif hazırlanabilecek (satılmamış ve fiyatı girilmiş) daire yok.</p>
        ) : (
          <ul className="qt-alt-list">
            {list.map((unit) => (
              <li key={unit.id}>
                <span className="qt-alt-main">
                  <strong>{[unit.block && `${unit.block} Blok`, `No ${unit.unitNo}`].filter(Boolean).join(" · ")}</strong>
                  <span className="pj-muted">{[unit.type, unit.status === "opsiyonlu" ? "opsiyonlu" : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <b className="qt-alt-price">{formatPrice(unit.listPrice, unit.currency)}</b>
                <button type="button" className="btn secondary pj-touch" onClick={() => onPick(unit)}>
                  Seç
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export default function Quotes() {
  const inventory = useInventory();
  const store = useQuotes(inventory);
  const { quotes, manager, today, actor } = store;
  const phone = useMedia("(max-width: 760px)");
  const [tab, setTab] = useState<Tab | null>(null);
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [openId, setOpenId] = useState("");
  const [editor, setEditor] = useState<{ unit: Unit; quote?: VisibleQuote; seed?: QuoteEditorSeed } | null>(null);
  const [picking, setPicking] = useState(false);

  const live = useMemo(() => activeInventory(inventory.projects, inventory.units), [inventory.projects, inventory.units]);
  const pendingCount = quotes.filter((q) => q.status === "onay bekliyor").length;
  // Yönetici onay kuyruğuyla, çalışan tüm teklifleriyle başlar.
  const activeTab: Tab = tab ?? (manager && pendingCount > 0 ? "bekleyen" : "hepsi");
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of quotes) map.set(q.status, (map.get(q.status) || 0) + 1);
    return map;
  }, [quotes]);
  const shown = useMemo(() => {
    const words = fold(search).split(/\s+/).filter(Boolean);
    return quotes.filter((q) => {
      if (activeTab === "bekleyen" ? q.status !== "onay bekliyor" : activeTab !== "hepsi" && q.status !== activeTab) return false;
      if (mineOnly && !isOwnQuote(q, actor)) return false;
      if (!words.length) return true;
      const hay = fold(`${q.quoteNo} ${q.customer.name} ${q.customer.phone} ${q.unit.projectName} ${unitLabelOf(q.unit)} ${q.employee.name}`);
      return words.every((w) => hay.includes(w));
    });
  }, [quotes, activeTab, search, mineOnly, actor]);
  const open = quotes.find((q) => q.id === openId);

  useEffect(() => {
    if (openId && !store.loading && !open) setOpenId("");
  }, [openId, open, store.loading]);

  const editorModal = editor && (
    <QuoteEditor
      store={store}
      unit={editor.unit}
      project={inventory.projects.find((p) => p.id === editor.unit.projectId)}
      quote={editor.quote}
      seed={editor.seed}
      onClose={() => setEditor(null)}
      onSaved={(saved) => {
        setEditor(null);
        setOpenId(saved.id);
        window.scrollTo(0, 0);
      }}
    />
  );
  const demoSwitch = store.demo && (
    <div className="pj-seg qt-demo-role" role="group" aria-label="Demo bakış açısı">
      <button type="button" aria-pressed={store.demoRole === "manager"} onClick={() => store.setDemoRole("manager")}>
        Yönetici
      </button>
      <button type="button" aria-pressed={store.demoRole === "employee"} onClick={() => store.setDemoRole("employee")}>
        Satış danışmanı
      </button>
    </div>
  );

  if (open) {
    const unit = inventory.units.find((u) => u.id === open.unitId);
    return (
      <div className="pj-page qt-page">
        {demoSwitch && <div className="qt-demo-bar">{demoSwitch}</div>}
        <QuoteDetail
          quote={open}
          store={store}
          units={inventory.units}
          projects={inventory.projects}
          onBack={() => setOpenId("")}
          onEdit={() => unit && setEditor({ unit, quote: open })}
          onNewForUnit={(alt) => setEditor({ unit: alt, seed: { leadId: open.leadId, downPayment: Math.min(open.inputs.downPayment, alt.listPrice), months: open.inputs.months } })}
        />
        {editorModal}
      </div>
    );
  }

  const row = (q: VisibleQuote) => {
    const full = q as Quote;
    return { q, npv: manager && full.evaluation?.npv != null ? full.evaluation : null };
  };
  return (
    <div className="pj-page qt-page">
      <PageTitle
        eyebrow="GAYRİMENKUL SATIŞ"
        title="Teklifler"
        description="Ödeme planlı satış teklifleri. Her teklif müşteriye verilmeden önce yönetici onayından geçer."
        actions={
          <>
            {demoSwitch}
            {manager && (
              <button type="button" className="btn secondary pj-touch" onClick={() => goTo("/cost-of-money", withBase)}>
                Para maliyeti
              </button>
            )}
            {store.canCreate && (
              <button type="button" className="btn primary pj-touch" onClick={() => setPicking(true)} disabled={!live.units.length}>
                <Plus size={16} /> Yeni teklif
              </button>
            )}
          </>
        }
      />
      {store.demo && <p className="pj-note">Demo modu: teklifler yalnız bu tarayıcıda saklanır, bildirim gönderilmez ve PDF üretilmez. Üstteki düğmeyle yönetici ve satış danışmanı görünümü arasında geçebilirsiniz.</p>}
      {!store.loading && !store.settings && (
        <p className="pj-note">
          Teklif hazırlanabilmesi için önce yöneticinin oranları (vade farkı, para maliyeti, prim) belirlemesi gerekir.{" "}
          {manager && (
            <button type="button" className="pj-link" onClick={() => goTo("/cost-of-money", withBase)}>
              Oranları belirle
            </button>
          )}
        </p>
      )}
      <div className="qt-toolbar">
        <div className="qt-tabs" role="tablist" aria-label="Teklif durumu">
          {TABS.filter(([key]) => key !== "bekleyen" || manager || pendingCount > 0).map(([key, label]) => {
            const count = key === "bekleyen" ? pendingCount : key === "hepsi" ? quotes.length : counts.get(key) || 0;
            return (
              <button type="button" role="tab" key={key} aria-selected={activeTab === key} className={`qt-tab ${key === "bekleyen" && count > 0 ? "qt-tab-alert" : ""}`} onClick={() => setTab(key)}>
                {label}
                <span className="qt-tab-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="qt-toolbar-right">
          {store.seeAll && (
            <div className="pj-seg" role="group" aria-label="Kapsam">
              <button type="button" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>
                Tüm teklifler
              </button>
              <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>
                Benim tekliflerim
              </button>
            </div>
          )}
          <label className="pj-search qt-search">
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Teklif no, müşteri, proje ara…" aria-label="Tekliflerde ara" />
            {search && (
              <button type="button" className="pj-clear-x" aria-label="Aramayı temizle" onClick={() => setSearch("")}>
                <X size={15} />
              </button>
            )}
          </label>
        </div>
      </div>
      {store.error && (
        <p className="pj-error" role="alert">
          {store.error}{" "}
          <button type="button" className="pj-link" onClick={() => void store.reload()}>
            Yeniden dene
          </button>
        </p>
      )}
      {store.loading && !quotes.length ? (
        <div className="pj-panel pj-loading" role="status">
          Teklifler yükleniyor…
        </div>
      ) : shown.length === 0 ? (
        <div className="pj-panel">
          <Empty
            title={activeTab === "bekleyen" ? "Onay bekleyen teklif yok" : quotes.length ? "Bu filtreye uyan teklif yok" : "Henüz teklif yok"}
            description={quotes.length ? "Başka bir sekme seçin veya aramayı temizleyin." : "Projeler sayfasında bir daireyi açıp “Teklif hazırla” ile veya buradaki “Yeni teklif” ile başlayın."}
          />
        </div>
      ) : phone ? (
        <ul className="qt-cards">
          {shown.map(row).map(({ q, npv }) => (
            <li key={q.id}>
              <button type="button" className="qt-card" onClick={() => setOpenId(q.id)}>
                <span className="qt-card-top">
                  <strong>{q.quoteNo}</strong>
                  <span className="qt-card-chips">
                    <StatusChip quote={q} today={today} />
                  </span>
                </span>
                <span className="qt-card-customer">{q.customer.name}</span>
                <span className="pj-muted">
                  {q.unit.projectName} · {unitLabelOf(q.unit)}
                </span>
                <span className="qt-card-money">
                  <span>
                    Satış <b>{formatMoney(q.plan.salePrice, q.inputs.currency)}</b>
                  </span>
                  <span>
                    Toplam <b>{formatMoney(q.plan.totalPayable, q.inputs.currency)}</b>
                  </span>
                  {npv && (
                    <span className={npv.npvVsList < 0 ? "qt-neg" : "qt-pos"}>
                      NBD / liste <b>{formatPct(npv.npvVsListPct)}</b>
                    </span>
                  )}
                </span>
                <span className="pj-muted">
                  {q.employee.name} · {formatDay(q.createdAt)} · geçerlilik {formatDay(q.validUntil)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pj-panel pj-table-wrap">
          <table className="pj-table qt-table">
            <thead>
              <tr>
                <th>Teklif no</th>
                <th>Tarih</th>
                <th>Müşteri</th>
                <th>Proje / daire</th>
                <th className="pj-num">Satış bedeli</th>
                <th className="pj-num">Toplam ödeme</th>
                {manager && <th className="pj-num">NBD / liste</th>}
                <th>Danışman</th>
                <th>Durum</th>
                <th>Geçerlilik</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row).map(({ q, npv }) => (
                <tr key={q.id} onClick={() => setOpenId(q.id)}>
                  <td>
                    <button type="button" className="pj-link" onClick={() => setOpenId(q.id)}>
                      {q.quoteNo}
                    </button>
                  </td>
                  <td>{formatDay(q.createdAt)}</td>
                  <td>{q.customer.name}</td>
                  <td>
                    {q.unit.projectName} · {unitLabelOf(q.unit)}
                  </td>
                  <td className="pj-num pj-price">{formatMoney(q.plan.salePrice, q.inputs.currency)}</td>
                  <td className="pj-num">{formatMoney(q.plan.totalPayable, q.inputs.currency)}</td>
                  {manager && <td className={`pj-num ${npv && npv.npvVsList < 0 ? "qt-neg" : "qt-pos"}`}>{npv ? formatPct(npv.npvVsListPct) : "—"}</td>}
                  <td>{q.employee.name}</td>
                  <td>
                    <span className="qt-card-chips">
                      <StatusChip quote={q} today={today} />
                    </span>
                  </td>
                  <td>{formatDay(q.validUntil)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {picking && (
        <UnitPicker
          units={live.units}
          projects={live.projects}
          onClose={() => setPicking(false)}
          onPick={(unit) => {
            setPicking(false);
            setEditor({ unit });
          }}
        />
      )}
      {editorModal}
    </div>
  );
}
