// "Bütçeye göre bul": bütçeye uyan müsait daireler (bütçeye en yakın olan başta) ve
// bütçenin biraz üstündeki en yakın üç daire.
import { useMemo, useState } from "react";
import { UNIT_CURRENCIES, findByBudget, formatFloor, formatM2, formatPrice, type Project, type Unit, type UnitCurrency } from "../../../../../shared/real-estate";
import { Modal } from "../ui";
import { NumberField } from "./UnitExplorer";

const SHOWN = 50;
const MAX_SHOWN = 200;

export default function BudgetFinder({
  projects, units, initialProjectId = "", onOpen, onClose,
}: {
  projects: Project[];
  units: Unit[];
  initialProjectId?: string;
  onOpen: (unit: Unit) => void;
  onClose: () => void;
}) {
  const [budget, setBudget] = useState<number | null>(null);
  const [currency, setCurrency] = useState<UnitCurrency>("TRY");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [shown, setShown] = useState(SHOWN);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const pool = useMemo(() => (projectId ? units.filter((u) => u.projectId === projectId) : units), [units, projectId]);
  const match = useMemo(() => findByBudget(pool, budget ?? 0, currency), [pool, budget, currency]);

  const row = (unit: Unit, above: boolean) => {
    const diff = Math.abs(unit.listPrice - (budget ?? 0));
    return (
      <li key={unit.id}>
        <button type="button" className={`pj-budget-row ${above ? "above" : ""}`} onClick={() => onOpen(unit)}>
          <span className="pj-budget-row-main">
            <strong>
              {unit.block ? `${unit.block} Blok · ` : ""}No {unit.unitNo}
              {unit.type ? ` · ${unit.type}` : ""}
            </strong>
            <span className="pj-muted">
              {projectById.get(unit.projectId)?.name} · {formatFloor(unit.floor)} · {formatM2(unit.grossM2)}
            </span>
          </span>
          <span className="pj-budget-row-price">
            <b>{formatPrice(unit.listPrice, unit.currency)}</b>
            <span className={above ? "pj-over" : "pj-muted"}>
              {above ? `bütçenin biraz üstünde · +${formatPrice(diff, unit.currency)}` : diff === 0 ? "tam bütçede" : `${formatPrice(diff, unit.currency)} altında`}
            </span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <Modal wide title="Bütçeye göre bul" subtitle="Müşterinin bütçesine uyan müsait daireler; bütçeye en yakın olan en üstte." onClose={onClose}>
      <div className="pj-budget-body">
        <div className="pj-budget-form">
          <div className="pj-filter">
            <span className="pj-filter-label">Bütçe</span>
            <div className="pj-range">
              <NumberField
                label="Bütçe"
                placeholder="Örn. 5.000.000"
                price
                value={budget}
                onChange={(v) => {
                  setBudget(v);
                  setShown(SHOWN);
                }}
              />
              <select className="pj-input pj-currency" aria-label="Para birimi" value={currency} onChange={(e) => setCurrency(e.target.value as UnitCurrency)}>
                {UNIT_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="pj-filter">
            <span className="pj-filter-label">Proje</span>
            <select className="pj-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Tüm projeler</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
        {!budget ? (
          <p className="pj-note">Bir bütçe girin; yalnız seçtiğiniz para birimiyle fiyatlanmış müsait daireler değerlendirilir (kur çevrimi yapılmaz).</p>
        ) : (
          <>
            <h3 className="pj-subhead">
              Bütçeye uyan daireler <span className="pj-count">{match.within.length}</span>
            </h3>
            {match.within.length === 0 ? (
              <p className="pj-note">Bu bütçeye uyan müsait daire yok.</p>
            ) : (
              <ul className="pj-budget-list">{match.within.slice(0, shown).map((unit) => row(unit, false))}</ul>
            )}
            {match.within.length > shown && shown < MAX_SHOWN && (
              <button type="button" className="btn secondary pj-touch" onClick={() => setShown((n) => Math.min(MAX_SHOWN, n + SHOWN))}>
                Daha fazla göster ({match.within.length - shown})
              </button>
            )}
            {match.above.length > 0 && (
              <>
                <h3 className="pj-subhead">Bütçenin biraz üstünde</h3>
                <ul className="pj-budget-list">{match.above.map((unit) => row(unit, true))}</ul>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
