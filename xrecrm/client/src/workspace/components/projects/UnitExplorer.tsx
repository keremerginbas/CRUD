// Daire gezgini: tüm projelerde veya tek projede süzme, sıralama ve sonuç listesi.
// 5.000 dairede akıcı kalması için süzme/sıralama memolanır, yazarken ertelenmiş değer
// kullanılır ve aynı anda en çok PAGE kadar satır çizilir (sayfalama).
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Pencil, Search, SlidersHorizontal, X } from "lucide-react";
import {
  UNIT_CURRENCIES,
  UNIT_STATUSES,
  activeFilterCount,
  defaultUnitFilters,
  filterUnits,
  formatFloor,
  formatM2,
  formatPrice,
  inventoryFacets,
  pricePerM2,
  sortUnits,
  type Project,
  type SortDir,
  type Unit,
  type UnitCurrency,
  type UnitFilters,
  type UnitSortKey,
  type UnitStatus,
} from "../../../../../shared/real-estate";
import { parseTrNumber } from "../../../../../shared/unit-import";
import { Empty } from "../ui";

export const PAGE = 100;
export const statusTone: Record<UnitStatus, string> = { müsait: "ok", opsiyonlu: "hold", satıldı: "sold" };
export const statusLabel: Record<UnitStatus, string> = { müsait: "Müsait", opsiyonlu: "Opsiyonlu", satıldı: "Satıldı" };

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const group = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Sayı alanı: Türkçe yazımı kabul eder ("4.250.000", "125,5"); boş = sınır yok. */
export function NumberField({
  value, onChange, label, placeholder, price = false, integer = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  placeholder?: string;
  price?: boolean;
  integer?: boolean;
}) {
  const show = (v: number | null) => (v == null ? "" : price ? group(v) : String(v).replace(".", ","));
  const [text, setText] = useState(show(value));
  const read = (raw: string) => {
    const number = parseTrNumber(raw, price ? "price" : "measure");
    return number == null ? null : integer ? Math.trunc(number) : number;
  };
  useEffect(() => {
    setText((current) => (read(current) === value ? current : show(value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      className="pj-input"
      aria-label={label}
      placeholder={placeholder}
      inputMode={integer || price ? "numeric" : "decimal"}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(read(e.target.value));
      }}
      onBlur={() => setText(show(read(text)))}
    />
  );
}

function Range({ label, min, max, onMin, onMax, integer }: { label: string; min: number | null; max: number | null; onMin: (v: number | null) => void; onMax: (v: number | null) => void; integer?: boolean }) {
  return (
    <div className="pj-filter">
      <span className="pj-filter-label">{label}</span>
      <div className="pj-range">
        <NumberField label={`${label} en az`} placeholder="En az" value={min} onChange={onMin} integer={integer} />
        <span aria-hidden="true">–</span>
        <NumberField label={`${label} en çok`} placeholder="En çok" value={max} onChange={onMax} integer={integer} />
      </div>
    </div>
  );
}

const sortLabels: Record<UnitSortKey, string> = { price: "Fiyat", grossM2: "Brüt m²", netM2: "Net m²", floor: "Kat", pricePerM2: "m² fiyatı", unitNo: "Daire no" };

export default function UnitExplorer({
  projects, units, lockedProjectId = "", canWrite, onOpen, onEdit, onStatus, onProject,
}: {
  projects: Project[];
  units: Unit[];
  /** Doluysa yalnız bu projenin daireleri listelenir; proje/il/ilçe süzgeçleri gizlenir. */
  lockedProjectId?: string;
  canWrite: boolean;
  onOpen: (unit: Unit) => void;
  onEdit: (unit: Unit) => void;
  onStatus: (unit: Unit, status: UnitStatus) => void;
  onProject?: (projectId: string) => void;
}) {
  const [filters, setFilters] = useState<UnitFilters>({ ...defaultUnitFilters, projectId: lockedProjectId });
  const [sort, setSort] = useState<{ key: UnitSortKey; dir: SortDir }>({ key: "price", dir: "asc" });
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const phone = useMedia("(max-width: 760px)");
  const set = (patch: Partial<UnitFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };
  useEffect(() => {
    setFilters({ ...defaultUnitFilters, projectId: lockedProjectId });
    setPage(0);
  }, [lockedProjectId]);

  const scopeUnits = useMemo(() => (lockedProjectId ? units.filter((u) => u.projectId === lockedProjectId) : units), [units, lockedProjectId]);
  const facets = useMemo(() => inventoryFacets(projects, scopeUnits), [projects, scopeUnits]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const deferred = useDeferredValue(filters);
  const filtered = useMemo(() => filterUnits(scopeUnits, projects, deferred), [scopeUnits, projects, deferred]);
  const sorted = useMemo(() => sortUnits(filtered, sort.key, sort.dir), [filtered, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = useMemo(() => sorted.slice(current * PAGE, (current + 1) * PAGE), [sorted, current]);
  const count = activeFilterCount(filters) - (lockedProjectId ? 1 : 0);
  const budgetOn = filters.priceMin != null || filters.priceMax != null;
  const clear = () => {
    setFilters({ ...defaultUnitFilters, projectId: lockedProjectId });
    setPage(0);
  };
  const toggleSort = (key: UnitSortKey) => {
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(0);
  };
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  const head = (key: UnitSortKey, label: string, numeric = true) => (
    <th className={numeric ? "pj-num" : undefined} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="pj-sort" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key ? sort.dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ChevronsUpDown size={13} className="pj-sort-idle" />}
      </button>
    </th>
  );
  const statusCell = (unit: Unit) =>
    canWrite ? (
      <select
        className={`pj-status-select pj-tone-${statusTone[unit.status]}`}
        aria-label={`${unit.unitNo} durumu`}
        value={unit.status}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onStatus(unit, e.target.value as UnitStatus)}
      >
        {UNIT_STATUSES.map((s) => (
          <option key={s} value={s}>{statusLabel[s]}</option>
        ))}
      </select>
    ) : (
      <span className={`pj-status pj-tone-${statusTone[unit.status]}`}>{statusLabel[unit.status]}</span>
    );
  const perM2 = (unit: Unit) => {
    const value = pricePerM2(unit);
    return value == null ? "—" : formatPrice(value, unit.currency);
  };
  const unitName = (unit: Unit) => [unit.block && `${unit.block} Blok`, `No ${unit.unitNo}`].filter(Boolean).join(" · ");

  return (
    <section className="pj-explorer" aria-label="Daire gezgini">
      <div className="pj-filterbar">
        <div className="pj-filter-main">
          <label className="pj-search">
            <Search size={16} aria-hidden="true" />
            <input value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="Daire no, tip, manzara, özellik ara…" aria-label="Dairelerde ara" />
            {filters.search && (
              <button type="button" className="pj-clear-x" aria-label="Aramayı temizle" onClick={() => set({ search: "" })}>
                <X size={15} />
              </button>
            )}
          </label>
          <div className="pj-filter pj-budget">
            <span className="pj-filter-label">Bütçe</span>
            <div className="pj-range">
              <NumberField label="Bütçe en az" placeholder="En az" price value={filters.priceMin} onChange={(v) => set({ priceMin: v })} />
              <span aria-hidden="true">–</span>
              <NumberField label="Bütçe en çok" placeholder="En çok" price value={filters.priceMax} onChange={(v) => set({ priceMax: v })} />
              <select className="pj-input pj-currency" aria-label="Bütçe para birimi" value={filters.currency} onChange={(e) => set({ currency: e.target.value as UnitCurrency })}>
                {UNIT_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" className={`btn secondary pj-more-toggle ${more ? "selected" : ""}`} aria-expanded={more} onClick={() => setMore((v) => !v)}>
            <SlidersHorizontal size={15} />
            Filtreler{count > 0 ? ` (${count})` : ""}
          </button>
        </div>
        <div className="pj-chips" role="group" aria-label="Durum">
          <span className="pj-filter-label">Durum</span>
          {UNIT_STATUSES.map((s) => (
            <button type="button" key={s} className="pj-chip" aria-pressed={filters.statuses.includes(s)} onClick={() => set({ statuses: toggle(filters.statuses, s) })}>
              {statusLabel[s]}
            </button>
          ))}
          <button type="button" className="pj-chip" aria-pressed={filters.statuses.length === 0} onClick={() => set({ statuses: [] })}>
            Tümü
          </button>
        </div>
        {more && (
          <div className="pj-filter-more">
            {!lockedProjectId && (
              <>
                <label className="pj-filter">
                  <span className="pj-filter-label">Proje</span>
                  <select className="pj-input" value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}>
                    <option value="">Tüm projeler</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="pj-filter">
                  <span className="pj-filter-label">İl</span>
                  <select className="pj-input" value={filters.city} onChange={(e) => set({ city: e.target.value, district: "" })}>
                    <option value="">Tüm iller</option>
                    {facets.cities.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className="pj-filter">
                  <span className="pj-filter-label">İlçe</span>
                  <select className="pj-input" value={filters.district} onChange={(e) => set({ district: e.target.value })}>
                    <option value="">Tüm ilçeler</option>
                    {(facets.districts[filters.city] || facets.districts[""] || []).map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <Range label="Kat" integer min={filters.floorMin} max={filters.floorMax} onMin={(v) => set({ floorMin: v })} onMax={(v) => set({ floorMax: v })} />
            <Range label="Brüt m²" min={filters.grossMin} max={filters.grossMax} onMin={(v) => set({ grossMin: v })} onMax={(v) => set({ grossMax: v })} />
            <Range label="Net m²" min={filters.netMin} max={filters.netMax} onMin={(v) => set({ netMin: v })} onMax={(v) => set({ netMax: v })} />
            <label className="pj-filter">
              <span className="pj-filter-label">Cephe</span>
              <select className="pj-input" value={filters.facade} onChange={(e) => set({ facade: e.target.value })}>
                <option value="">Tüm cepheler</option>
                {facets.facades.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            {facets.types.length > 0 && (
              <div className="pj-chips pj-types" role="group" aria-label="Daire tipi">
                <span className="pj-filter-label">Daire tipi</span>
                {facets.types.map((type) => (
                  <button type="button" key={type} className="pj-chip" aria-pressed={filters.types.includes(type)} onClick={() => set({ types: toggle(filters.types, type) })}>
                    {type}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pj-resultbar">
        <strong aria-live="polite">{group(sorted.length)} daire</strong>
        <span className="pj-muted">
          {scopeUnits.length !== sorted.length ? `/ ${group(scopeUnits.length)} içinden` : ""}
          {budgetOn ? ` · yalnız ${filters.currency} fiyatlı daireler` : ""}
        </span>
        {count > 0 && (
          <button type="button" className="pj-link" onClick={clear}>
            <X size={14} /> Filtreleri temizle
          </button>
        )}
        {phone && (
          <label className="pj-sort-phone">
            <span className="pj-filter-label">Sırala</span>
            <select
              className="pj-input"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":") as [UnitSortKey, SortDir];
                setSort({ key, dir });
                setPage(0);
              }}
            >
              {(Object.keys(sortLabels) as UnitSortKey[]).flatMap((key) => [
                <option key={`${key}:asc`} value={`${key}:asc`}>{sortLabels[key]} ↑</option>,
                <option key={`${key}:desc`} value={`${key}:desc`}>{sortLabels[key]} ↓</option>,
              ])}
            </select>
          </label>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="pj-panel">
          <Empty
            title={scopeUnits.length ? "Bu filtrelere uyan daire yok" : "Henüz daire yok"}
            description={scopeUnits.length ? "Bütçeyi genişletmeyi veya filtreleri temizlemeyi deneyin." : "Daire ekleyin veya Excel/CSV dosyasından toplu içe aktarın."}
          />
        </div>
      ) : phone ? (
        <ul className="pj-unit-cards">
          {visible.map((unit) => (
            <li key={unit.id} className="pj-unit-card">
              <button type="button" className="pj-unit-card-main" onClick={() => onOpen(unit)}>
                <span className="pj-unit-card-top">
                  <strong>{unitName(unit)}</strong>
                  <b>{formatPrice(unit.listPrice, unit.currency)}</b>
                </span>
                {!lockedProjectId && <span className="pj-muted">{projectById.get(unit.projectId)?.name}</span>}
                <span className="pj-unit-card-facts">
                  <span>{unit.type || "—"}</span>
                  <span>{formatFloor(unit.floor)}</span>
                  <span>{formatM2(unit.grossM2)} brüt</span>
                  {unit.netM2 > 0 && <span>{formatM2(unit.netM2)} net</span>}
                  {unit.facade && <span>{unit.facade}</span>}
                  <span>{perM2(unit)}/m²</span>
                </span>
              </button>
              <div className="pj-unit-card-foot">
                {statusCell(unit)}
                {canWrite && (
                  <button type="button" className="btn secondary pj-touch" onClick={() => onEdit(unit)}>
                    <Pencil size={15} /> Düzenle
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="pj-panel pj-table-wrap">
          <table className="pj-table">
            <thead>
              <tr>
                {!lockedProjectId && <th>Proje</th>}
                {head("unitNo", "Blok / No", false)}
                <th>Tip</th>
                {head("floor", "Kat")}
                {head("grossM2", "Brüt m²")}
                {head("netM2", "Net m²")}
                <th>Cephe</th>
                {head("price", "Fiyat")}
                {head("pricePerM2", "m² fiyatı")}
                <th>Durum</th>
                {canWrite && <th aria-label="İşlemler" />}
              </tr>
            </thead>
            <tbody>
              {visible.map((unit) => (
                <tr key={unit.id} onClick={() => onOpen(unit)}>
                  {!lockedProjectId && (
                    <td>
                      <button
                        type="button"
                        className="pj-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onProject?.(unit.projectId);
                        }}
                      >
                        {projectById.get(unit.projectId)?.name || "—"}
                      </button>
                    </td>
                  )}
                  <td>
                    <strong>{unitName(unit)}</strong>
                  </td>
                  <td>{unit.type || "—"}</td>
                  <td className="pj-num">{unit.floor}</td>
                  <td className="pj-num">{formatM2(unit.grossM2)}</td>
                  <td className="pj-num">{formatM2(unit.netM2)}</td>
                  <td>{unit.facade || "—"}</td>
                  <td className="pj-num pj-price">{formatPrice(unit.listPrice, unit.currency)}</td>
                  <td className="pj-num">{perM2(unit)}</td>
                  <td>{statusCell(unit)}</td>
                  {canWrite && (
                    <td className="pj-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`${unitName(unit)} düzenle`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(unit);
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="pj-more" aria-label="Sayfalar">
          <button type="button" className="btn secondary pj-touch" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Önceki
          </button>
          <span className="pj-muted">
            {group(current * PAGE + 1)}–{group(current * PAGE + visible.length)} / {group(sorted.length)} · Sayfa {current + 1} / {pages}
          </span>
          <button type="button" className="btn secondary pj-touch" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Sonraki
          </button>
        </nav>
      )}
    </section>
  );
}
