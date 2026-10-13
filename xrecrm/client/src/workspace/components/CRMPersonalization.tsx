import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Columns3,
  Filter,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "../store";
import {
  CRM_WORKSPACE_DEFAULT_APPEARANCE,
  CRM_WORKSPACE_DEFAULT_PREFERENCES,
  CRM_WORKSPACE_OPTIONAL_COLUMNS,
  crmWorkspaceFiltersSchema,
  parseCrmWorkspacePreferences,
  safeCrmWorkspaceFilters,
  type CrmCardProfile,
  type CrmListColumn,
  type CrmWorkspaceAppearance,
  type CrmWorkspaceFilters,
  type CrmWorkspacePreferences,
  type CrmWorkspaceState,
  type SavedCrmView,
} from "../../../../shared/crm-workspace";
import "../crm-personalization.css";

export interface CrmWorkspaceData {
  leads?: readonly Record<string, unknown>[];
  members?: readonly { name?: string }[];
  pipelines?: readonly {
    id: string;
    name: string;
    stages?: readonly { id: string; label: string }[];
  }[];
}

type BaseProps = {
  appearance?: CrmWorkspaceAppearance;
  onSettings?: (appearance: CrmWorkspaceAppearance) => void;
  onAppearanceChange?: (appearance: CrmWorkspaceAppearance) => void;
  data?: CrmWorkspaceData;
  className?: string;
};

type FilterControlledProps = BaseProps & {
  filters?: CrmWorkspaceFilters;
  value?: CrmWorkspaceFilters;
  onApply?: (filters: CrmWorkspaceFilters) => void;
};

type StateControlledProps = BaseProps & {
  filters?: never;
  value: CrmWorkspaceState;
  onApply?: (state: CrmWorkspaceState) => void;
};

/**
 * Controlled by the CRM page. The `value` form is also supported for callers
 * that want one exported state object; the preferred page contract is
 * `filters` + `appearance` + `onApply` + `onAppearanceChange`.
 */
export type CRMPersonalizationProps =
  | FilterControlledProps
  | StateControlledProps;

const FILTER_DEFAULTS: CrmWorkspaceFilters = {
  query: "",
  owner: "all",
  source: "all",
  activity: "all",
  pipeline: "sales",
  stage: "all",
  city: "",
  createdFrom: "",
  createdTo: "",
  minValue: "",
  maxValue: "",
  contact: "any",
  company: "any",
};

const columnLabels: Record<CrmListColumn, string> = {
  name: "Müşteri adı",
  stage: "Aşama",
  value: "Değer",
  next: "Sonraki adım",
  owner: "Sorumlu",
  source: "Kaynak",
  communication: "İletişim",
};

function localKey(demo: boolean, openId?: string): string {
  return `xre-crm-workspace-preferences:${demo ? `demo:${openId || "local"}` : `user:${openId || "anonymous"}`}`;
}

function readLocal(key: string): CrmWorkspacePreferences {
  try {
    const raw = localStorage.getItem(key);
    return raw
      ? parseCrmWorkspacePreferences(JSON.parse(raw))
      : {
          ...CRM_WORKSPACE_DEFAULT_PREFERENCES,
          listColumns: [...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns],
        };
  } catch {
    return {
      ...CRM_WORKSPACE_DEFAULT_PREFERENCES,
      listColumns: [...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns],
    };
  }
}

function makeViewId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Kişisel CRM tercihleri kaydedilemedi.";
}

export default function CRMPersonalization(props: CRMPersonalizationProps) {
  const store = useStore();
  const stateValue =
    "value" in props && props.value && "filters" in props.value
      ? props.value
      : undefined;
  const controlledFilters =
    stateValue?.filters ||
    ("value" in props && props.value && !("filters" in props.value)
      ? props.value
      : undefined) ||
    ("filters" in props ? props.filters : undefined) ||
    FILTER_DEFAULTS;
  const controlledAppearance = props.appearance || stateValue?.appearance;
  const demo = store?.demo ?? true;
  const openId = store?.user?.openId as string | undefined;
  const storageKey = localKey(demo, openId);
  const [preferences, setPreferences] = useState<CrmWorkspacePreferences>(() =>
    readLocal(storageKey),
  );
  const [filtersDraft, setFiltersDraft] = useState<CrmWorkspaceFilters>(() =>
    safeCrmWorkspaceFilters(controlledFilters),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [selectedView, setSelectedView] = useState("");
  const [removedView, setRemovedView] = useState<SavedCrmView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [appearanceDraft, setAppearanceDraft] =
    useState<CrmWorkspaceAppearance>(controlledAppearance || preferences);
  const appearanceCallback = props.onSettings || props.onAppearanceChange;
  const appearanceCallbackRef =
    useRef<typeof appearanceCallback>(appearanceCallback);
  const persistVersion = useRef(0);

  useEffect(() => {
    appearanceCallbackRef.current = appearanceCallback;
  }, [appearanceCallback]);

  const storeData = store?.data as unknown as
    | {
        leads?: readonly Record<string, unknown>[];
        members?: readonly { name?: string }[];
        pipelines?: readonly {
          id: string;
          name: string;
          stages?: readonly { id: string; label: string }[];
        }[];
      }
    | undefined;
  const leads = props.data?.leads || storeData?.leads || [];
  const members = props.data?.members || storeData?.members || [];
  const owners = useMemo(
    () =>
      [
        ...new Set(
          [
            ...members.map((member) => member.name || ""),
            ...leads.map((lead) =>
              typeof lead.owner === "string" ? lead.owner : "",
            ),
          ].filter(Boolean),
        ),
      ].sort(),
    [leads, members],
  );
  const sources = useMemo(
    () =>
      [
        ...new Set(
          leads
            .map((lead) => (typeof lead.source === "string" ? lead.source : ""))
            .filter(Boolean),
        ),
      ].sort(),
    [leads],
  );
  const pipelines = props.data?.pipelines ||
    storeData?.pipelines || [
      { id: "sales", name: "Gayrimenkul Satış", stages: [] },
    ];
  const currentPipeline =
    pipelines.find((pipeline) => pipeline.id === filtersDraft.pipeline) ||
    pipelines.find((pipeline) => pipeline.id === "sales") ||
    pipelines[0];
  const stages = useMemo(() => {
    const fromPipeline = currentPipeline?.stages || [];
    if (fromPipeline.length)
      return fromPipeline.map((stage) => ({
        id: stage.id,
        label: stage.label,
      }));
    return [
      ...new Set(
        leads
          .map((lead) => (typeof lead.stage === "string" ? lead.stage : ""))
          .filter(Boolean),
      ),
    ]
      .sort()
      .map((stage) => ({ id: stage, label: stage }));
  }, [currentPipeline, leads]);
  const activeAppearance =
    controlledAppearance || appearanceDraft || preferences;

  useEffect(() => {
    setFiltersDraft(safeCrmWorkspaceFilters(controlledFilters));
  }, [controlledFilters]);

  useEffect(() => {
    setAppearanceDraft(controlledAppearance || preferences);
  }, [controlledAppearance, preferences]);

  useEffect(() => {
    let cancelled = false;
    persistVersion.current += 1;
    const cached = readLocal(storageKey);
    setPreferences({
      views: [],
      ...CRM_WORKSPACE_DEFAULT_APPEARANCE,
      listColumns: [...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns],
    });
    setMessage("");
    setSelectedView("");
    setRemovedView(null);
    if (demo || !openId || !store?.request) {
      setPreferences(cached);
      appearanceCallbackRef.current?.(cached);
      return () => {
        cancelled = true;
      };
    }
    setPreferences(cached);
    appearanceCallbackRef.current?.(cached);
    store
      .request("/api/crm-workspace/preferences")
      .then((payload) => {
        if (!cancelled) {
          const parsed = parseCrmWorkspacePreferences(payload);
          setPreferences(parsed);
          appearanceCallbackRef.current?.(parsed);
          try {
            localStorage.setItem(storageKey, JSON.stringify(parsed));
          } catch {
            /* private browsing */
          }
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("Kişisel CRM tercihleri yüklenemedi.");
      });
    return () => {
      cancelled = true;
    };
  }, [demo, openId, storageKey, store?.request]);

  const persist = async (next: CrmWorkspacePreferences) => {
    const version = ++persistVersion.current;
    if (demo || !openId || !store?.request) {
      setPreferences(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* in-memory still works */
      }
      return;
    }
    setBusy(true);
    try {
      const saved = await store.request(
        "/api/crm-workspace/preferences",
        next,
        "PUT",
      );
      if (version !== persistVersion.current) return;
      const parsed = parseCrmWorkspacePreferences(saved);
      setPreferences(parsed);
      try {
        localStorage.setItem(storageKey, JSON.stringify(parsed));
      } catch {
        /* in-memory still works */
      }
      setMessage("");
    } catch (error) {
      if (version === persistVersion.current) setMessage(errorText(error));
    } finally {
      if (version === persistVersion.current) setBusy(false);
    }
  };

  const applyFilters = (next: CrmWorkspaceFilters): boolean => {
    const result = crmWorkspaceFiltersSchema.safeParse(next);
    if (!result.success) {
      setMessage("Filtre tarih veya tutar aralığı geçersiz.");
      return false;
    }
    const parsed = result.data as CrmWorkspaceFilters;
    setFiltersDraft(parsed);
    if (stateValue)
      (props.onApply as ((state: CrmWorkspaceState) => void) | undefined)?.({
        filters: parsed,
        appearance: activeAppearance,
      });
    else
      (props.onApply as ((filters: CrmWorkspaceFilters) => void) | undefined)?.(
        parsed,
      );
    setMessage("");
    return true;
  };

  const applyAppearance = (next: CrmWorkspaceAppearance) => {
    const normalized: CrmWorkspaceAppearance = {
      cardProfile: next.cardProfile,
      listColumns: [
        "name",
        ...next.listColumns.filter(
          (column) => column !== "name" && column !== "communication",
        ),
        "communication",
      ],
    };
    setAppearanceDraft(normalized);
    (props.onSettings || props.onAppearanceChange)?.(normalized);
    void persist({ ...preferences, ...normalized });
    setSettingsOpen(false);
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const view: SavedCrmView = {
      id: makeViewId(),
      name: name.slice(0, 80),
      filters: safeCrmWorkspaceFilters(controlledFilters),
      createdAt: new Date().toISOString(),
    };
    const next = {
      ...preferences,
      views: [view, ...preferences.views].slice(0, 20),
    };
    setSelectedView(view.id);
    setViewName("");
    void persist(next);
  };

  const chooseView = (id: string) => {
    setSelectedView(id);
    const view = preferences.views.find((item) => item.id === id);
    if (view) applyFilters(view.filters);
  };

  const removeView = () => {
    const view = preferences.views.find((item) => item.id === selectedView);
    if (!view) return;
    setRemovedView(view);
    setSelectedView("");
    void persist({
      ...preferences,
      views: preferences.views.filter((item) => item.id !== selectedView),
    });
  };

  const undoRemove = () => {
    if (!removedView) return;
    void persist({
      ...preferences,
      views: [removedView, ...preferences.views].slice(0, 20),
    });
    setSelectedView(removedView.id);
    setRemovedView(null);
  };

  const toggleColumn = (
    column: Exclude<CrmListColumn, "name" | "communication">,
  ) => {
    const has = appearanceDraft.listColumns.includes(column);
    setAppearanceDraft({
      ...appearanceDraft,
      listColumns: has
        ? appearanceDraft.listColumns.filter((item) => item !== column)
        : [...appearanceDraft.listColumns, column],
    });
  };

  const setDraft = <K extends keyof CrmWorkspaceFilters>(
    key: K,
    value: CrmWorkspaceFilters[K],
  ) => setFiltersDraft((current) => ({ ...current, [key]: value }));

  return (
    <section
      className={`crm-personalization ${props.className || ""}`}
      aria-label="CRM kişiselleştirme"
    >
      <div className="crm-personalization-toolbar">
        <div className="crm-personalization-heading">
          <Bookmark size={17} />
          <div>
            <strong>Kişisel görünümler</strong>
            <small>Filtreleri ve kart düzenini kaydedin</small>
          </div>
        </div>
        <div className="crm-personalization-actions">
          <select
            aria-label="Kayıtlı CRM görünümü"
            value={selectedView}
            onChange={(event) => chooseView(event.target.value)}
          >
            <option value="">Görünüm seçin</option>
            {preferences.views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setAdvancedOpen(true)}
          >
            <Filter size={14} /> Gelişmiş filtre
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => {
              setAppearanceDraft(activeAppearance);
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={14} /> Düzen
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Seçili kişisel görünümü sil"
            disabled={!selectedView || busy}
            onClick={removeView}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="crm-personalization-save">
        <input
          aria-label="Yeni görünüm adı"
          value={viewName}
          onChange={(event) => setViewName(event.target.value)}
          placeholder="Yeni görünüm adı"
          maxLength={80}
        />
        <button
          type="button"
          className="btn primary small"
          disabled={!viewName.trim() || busy}
          onClick={saveView}
        >
          Görünümü kaydet
        </button>
        {removedView && (
          <button type="button" className="text-button" onClick={undoRemove}>
            <RotateCcw size={13} /> “{removedView.name}” görünümünü geri al
          </button>
        )}
      </div>
      {message && (
        <p className="crm-personalization-message" role="status">
          {message}
        </p>
      )}

      {advancedOpen && (
        <div
          className="crm-personalization-backdrop"
          role="presentation"
          onMouseDown={() => setAdvancedOpen(false)}
        >
          <section
            className="crm-personalization-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Gelişmiş CRM filtreleri"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>Gelişmiş filtreler</h2>
                <p>Şehir, tarih, tutar ve bağlı kayıtlarla daraltın.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Gelişmiş filtreleri kapat"
                onClick={() => setAdvancedOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="crm-personalization-grid">
              <label>
                Arama
                <input
                  value={filtersDraft.query}
                  onChange={(event) => setDraft("query", event.target.value)}
                  placeholder="Müşteri, telefon…"
                />
              </label>
              <label>
                Sorumlu
                <select
                  value={filtersDraft.owner}
                  onChange={(event) => setDraft("owner", event.target.value)}
                >
                  <option value="all">Tümü</option>
                  {owners.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kaynak
                <select
                  value={filtersDraft.source}
                  onChange={(event) => setDraft("source", event.target.value)}
                >
                  <option value="all">Tümü</option>
                  {sources.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Satış hunisi
                <select
                  value={filtersDraft.pipeline}
                  onChange={(event) => setDraft("pipeline", event.target.value)}
                >
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Aşama
                <select
                  value={filtersDraft.stage}
                  onChange={(event) => setDraft("stage", event.target.value)}
                >
                  <option value="all">Tümü</option>
                  {stages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Etkinlik
                <select
                  value={filtersDraft.activity}
                  onChange={(event) => setDraft("activity", event.target.value)}
                >
                  <option value="all">Tümü</option>
                  <option value="overdue">Gecikmiş</option>
                  <option value="none">Etkinliksiz</option>
                  <option value="planned">Planlanmış</option>
                </select>
              </label>
              <label>
                Şehir
                <input
                  value={filtersDraft.city}
                  onChange={(event) => setDraft("city", event.target.value)}
                />
              </label>
              <label>
                Oluşturulma başlangıcı
                <input
                  type="date"
                  value={filtersDraft.createdFrom}
                  onChange={(event) =>
                    setDraft("createdFrom", event.target.value)
                  }
                />
              </label>
              <label>
                Oluşturulma bitişi
                <input
                  type="date"
                  value={filtersDraft.createdTo}
                  onChange={(event) =>
                    setDraft("createdTo", event.target.value)
                  }
                />
              </label>
              <label>
                Minimum tutar
                <input
                  type="number"
                  min="0"
                  value={filtersDraft.minValue}
                  onChange={(event) => setDraft("minValue", event.target.value)}
                />
              </label>
              <label>
                Maksimum tutar
                <input
                  type="number"
                  min="0"
                  value={filtersDraft.maxValue}
                  onChange={(event) => setDraft("maxValue", event.target.value)}
                />
              </label>
              <label>
                Bağlı kişi
                <select
                  value={filtersDraft.contact}
                  onChange={(event) =>
                    setDraft(
                      "contact",
                      event.target.value as CrmWorkspaceFilters["contact"],
                    )
                  }
                >
                  <option value="any">Farketmez</option>
                  <option value="yes">Bağlı</option>
                  <option value="no">Bağlı değil</option>
                </select>
              </label>
              <label>
                Bağlı şirket
                <select
                  value={filtersDraft.company}
                  onChange={(event) =>
                    setDraft(
                      "company",
                      event.target.value as CrmWorkspaceFilters["company"],
                    )
                  }
                >
                  <option value="any">Farketmez</option>
                  <option value="yes">Bağlı</option>
                  <option value="no">Bağlı değil</option>
                </select>
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setFiltersDraft({ ...FILTER_DEFAULTS })}
              >
                Temizle
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  if (applyFilters(filtersDraft)) setAdvancedOpen(false);
                }}
              >
                <Check size={15} /> Filtreleri uygula
              </button>
            </footer>
          </section>
        </div>
      )}

      {settingsOpen && (
        <div
          className="crm-personalization-backdrop"
          role="presentation"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <section
            className="crm-personalization-modal"
            role="dialog"
            aria-modal="true"
            aria-label="CRM kart ve liste ayarları"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>Kart ve liste düzeni</h2>
                <p>Bu ayar yalnızca kişisel görünümünüze uygulanır.</p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Düzen ayarlarını kapat"
                onClick={() => setSettingsOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <fieldset>
              <legend>Kart profili</legend>
              <div className="crm-profile-options">
                {(["compact", "standard", "detailed"] as CrmCardProfile[]).map(
                  (profile) => (
                    <label
                      key={profile}
                      className={
                        appearanceDraft.cardProfile === profile
                          ? "selected"
                          : ""
                      }
                    >
                      <input
                        type="radio"
                        name="crm-card-profile"
                        checked={appearanceDraft.cardProfile === profile}
                        onChange={() =>
                          setAppearanceDraft({
                            ...appearanceDraft,
                            cardProfile: profile,
                          })
                        }
                      />
                      {profile === "compact"
                        ? "Sıkı"
                        : profile === "standard"
                          ? "Standart"
                          : "Detaylı"}
                    </label>
                  ),
                )}
              </div>
            </fieldset>
            <fieldset>
              <legend>
                <Columns3 size={14} /> Liste sütunları
              </legend>
              <div className="crm-column-options">
                <label className="locked">
                  <input type="checkbox" checked readOnly />
                  {columnLabels.name}
                  <small>Gerekli</small>
                </label>
                {CRM_WORKSPACE_OPTIONAL_COLUMNS.map((column) => (
                  <label key={column}>
                    <input
                      type="checkbox"
                      checked={appearanceDraft.listColumns.includes(column)}
                      onChange={() => toggleColumn(column)}
                    />
                    {columnLabels[column]}
                  </label>
                ))}
                <label className="locked">
                  <input type="checkbox" checked readOnly />
                  {columnLabels.communication}
                  <small>Sabit</small>
                </label>
              </div>
            </fieldset>
            <footer>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setAppearanceDraft(activeAppearance);
                  setSettingsOpen(false);
                }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => applyAppearance(appearanceDraft)}
              >
                <Check size={15} /> Ayarları uygula
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

export { CRM_WORKSPACE_DEFAULT_APPEARANCE };
