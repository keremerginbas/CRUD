import CRMPersonalization from "../components/CRMPersonalization";
import ImportWizard from "../components/ImportWizard";
import {
  CRM_WORKSPACE_FILTER_DEFAULTS,
  CRM_WORKSPACE_DEFAULT_APPEARANCE,
  matchesCrmWorkspaceFilters,
  safeCrmWorkspaceFilters,
  type CrmWorkspaceFilters,
  type CrmWorkspaceAppearance,
} from "../../../../shared/crm-workspace";
import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  SlidersHorizontal,
  MessageCircle,
  Phone,
  MoreHorizontal,
  Building2,
  ChevronDown,
  Download,
  Workflow,
  Settings2,
  CalendarClock,
  CheckSquare,
  ArrowUpRight,
  Columns3,
  ArrowRight,
  Check,
  Bookmark,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Lead, Stage, money } from "../data";
import {
  availablePipelines,
  getPipelineStages,
  isOverdue,
  Pipeline,
} from "../suite";
import { Avatar, Badge, Empty } from "../components/ui";
import PipelineEditor from "../components/PipelineEditor";
import { ActivityEditor, TaskEditor } from "./Work";
import CRMActivities from "./CRMActivities";
import CRMCalendar from "./CRMCalendar";
import {
  CRMContactCard,
  CRMLeadActions,
  CRMViews,
  type CRMView,
} from "../components/CRMViews";
import {
  next as nextOpenRecord,
  openCount,
} from "../../../../shared/crm-activities";
import type { Activity, Task } from "../suite";
export default function CRM({
  kanban,
  view: pageView,
  onLead,
  onNew,
  onNewAt,
  navigate,
  onMessage,
}: {
  kanban: boolean;
  view?: CRMView;
  onLead: (l: Lead) => void;
  onNew: () => void;
  onNewAt?: (stage: Stage, pipeline: string) => void;
  navigate?: (p: string) => void;
  onMessage?: (id: string) => void;
}) {
  const { data, moveLead, saveLead, demo, user, saveRecord } = useStore();
  const [localView, setLocalView] = useState<CRMView>(
    kanban ? "kanban" : "list",
  );
  const activeView = pageView || localView;
  const [pipeline, setPipeline] = useState("sales");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [source, setSource] = useState("all");
  const [filters, setFilters] = useState(false);
  const [activity, setActivity] = useState("all");
  const [advanced, setAdvanced] = useState<CrmWorkspaceFilters>({
    ...CRM_WORKSPACE_FILTER_DEFAULTS,
  });
  const [appearance, setAppearance] = useState<CrmWorkspaceAppearance>({
    ...CRM_WORKSPACE_DEFAULT_APPEARANCE,
    listColumns: [...CRM_WORKSPACE_DEFAULT_APPEARANCE.listColumns],
  });
  const [importing, setImporting] = useState(false);
  const workspaceFilters = {
    ...advanced,
    query,
    pipeline,
    owner,
    source,
    activity,
  };
  const applyWorkspaceFilters = (value: CrmWorkspaceFilters) => {
    setAdvanced(value);
    setQuery(value.query);
    setPipeline(value.pipeline);
    setOwner(value.owner);
    setSource(value.source);
    setActivity(value.activity);
    setSelected([]);
  };
  const showColumn = (name: (typeof appearance.listColumns)[number]) =>
    appearance.listColumns.includes(name);
  const [over, setOver] = useState<Stage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState<Stage>("contacted");
  const [bulkOwner, setBulkOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Pipeline | undefined | null>(null);
  const [quick, setQuick] = useState<Stage | null>(null);
  const [quickName, setQuickName] = useState("");
  const [activityEditor, setActivityEditor] = useState<{
    activity?: Activity;
    leadId?: string;
    date?: Date;
  } | null>(null);
  const [taskEditor, setTaskEditor] = useState<{ task?: Task } | null>(null);
  const filterKey = `xre-crm-filters:${demo ? `demo:${user?.openId || "local"}` : `live:${user?.openId || "anonymous"}`}`;
  const [loadedFilterKey, setLoadedFilterKey] = useState("");
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(filterKey) || "null");
      setAdvanced(safeCrmWorkspaceFilters(saved || {}));
      if (saved) {
        setPipeline(
          typeof saved.pipeline === "string" ? saved.pipeline : "sales",
        );
        setQuery(typeof saved.query === "string" ? saved.query : "");
        setOwner(typeof saved.owner === "string" ? saved.owner : "all");
        setSource(typeof saved.source === "string" ? saved.source : "all");
        setActivity(
          typeof saved.activity === "string" ? saved.activity : "all",
        );
      } else {
        setPipeline("sales");
        setQuery("");
        setOwner("all");
        setSource("all");
        setActivity("all");
      }
    } catch {
      // A blocked sessionStorage should not prevent the CRM from opening.
    }
    setLoadedFilterKey(filterKey);
  }, [filterKey]);
  useEffect(() => {
    if (loadedFilterKey !== filterKey) return;
    try {
      sessionStorage.setItem(filterKey, JSON.stringify(workspaceFilters));
    } catch {
      // Private browsing may deny storage; the in-memory filters still work.
    }
  }, [
    activity,
    filterKey,
    loadedFilterKey,
    owner,
    pipeline,
    query,
    source,
    advanced,
  ]);
  const pipelines = availablePipelines(data.pipelines);
  const current = pipelines.find((p) => p.id === pipeline) || pipelines[0];
  const stages = getPipelineStages(data.pipelines, pipeline);
  const owners = [
    ...new Set([
      ...data.members.map((m) => m.name),
      ...data.leads.map((l) => l.owner),
    ]),
  ];
  const next = (l: Lead) => nextOpenRecord(l.id, data.tasks, data.activities);
  const leads = data.leads.filter((l) =>
    matchesCrmWorkspaceFilters(
      {
        ...l,
        pipelineId: l.pipelineId || "sales",
        nextActivityAt: next(l)?.date,
        hasActivity: !!next(l),
      },
      workspaceFilters,
    ),
  );
  const open = leads.filter((l) => l.stage !== "won" && l.stage !== "lost");
  const openValue = open.reduce((n, l) => n + l.value, 0);
  const forecast = open.reduce(
    (n, l) =>
      n +
      (l.value *
        (l.probability ??
          (l.stage === "proposal" ? 75 : l.stage === "qualified" ? 50 : 20))) /
        100,
    0,
  );
  const move = async (id: string, s: Stage) => {
    try {
      await moveLead(id, s);
      toast.success("Müşteri aşaması güncellendi.");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setOver(null);
  };
  const add = async (s: Stage) => {
    if (!quickName.trim()) return;
    const stamp = new Date().toISOString();
    const l: Lead = {
      id: crypto.randomUUID(),
      name: quickName.trim(),
      phone: "",
      email: "",
      company: "",
      stage: s,
      owner: owners[0] || "XRE Ekibi",
      value: 0,
      source: "Manuel",
      notes: "",
      createdAt: stamp,
      lastActivity: stamp,
      tags: [],
      pipelineId: pipeline === "all" ? "sales" : pipeline,
    };
    try {
      await saveLead(l);
      setQuick(null);
      setQuickName("");
      toast.success("Müşteri eklendi. Karttan ayrıntıları tamamlayın.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  async function bulk(kind: "stage" | "owner") {
    setBusy(true);
    let done = 0;
    try {
      for (const id of selected) {
        const l = data.leads.find((x) => x.id === id);
        if (l) {
          if (kind === "stage") await moveLead(id, bulkStage);
          else await saveLead({ ...l, owner: bulkOwner });
          done++;
        }
      }
      setSelected([]);
      toast.success(`${done} müşteri güncellendi.`);
    } catch (e) {
      toast.error(`${done} kayıt güncellendi. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const exportData = () => {
    const q = (x: unknown) => {
      const raw = String(x ?? "");
      const value = /^[\s]*[=+@-]/.test(raw) ? "\'" + raw : raw;
      return `"${value.replaceAll('"', '""')}"`;
    };
    const csv =
      "\uFEFF" +
      [
        "Müşteri;Portföy;Telefon;Huni;Aşama;Sorumlu;Değer",
        ...leads.map((l) =>
          [
            l.name,
            l.dealTitle || l.company,
            l.phone,
            l.pipelineId || "sales",
            l.stage,
            l.owner,
            l.value,
          ]
            .map(q)
            .join(";"),
        ),
      ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "xre-musteriler.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const changeView = (nextView: CRMView) => {
    setLocalView(nextView);
    const routes: Record<CRMView, string> = {
      kanban: "/kanban",
      list: "/leads",
      activities: "/activities",
      calendar: "/calendar",
    };
    navigate?.(routes[nextView]);
  };
  const addActivity = (leadId?: string, date?: Date) =>
    setActivityEditor({ leadId, date });
  const editActivity = (activity: Activity) => setActivityEditor({ activity });
  const editTask = (task: Task) => setTaskEditor({ task });
  return (
    <>
      <CRMViews
        view={activeView}
        count={leads.length}
        onViewChange={changeView}
        actions={
          <div className="crm-view-actions">
            <button className="btn secondary" onClick={exportData}>
              <Download size={16} />
              Dışa aktar
            </button>
            <button
              className="btn secondary"
              onClick={() => setImporting(true)}
            >
              CSV içe aktar
            </button>
            <button
              className="btn primary"
              onClick={() =>
                onNewAt
                  ? onNewAt("new", pipeline === "all" ? "sales" : pipeline)
                  : onNew()
              }
            >
              <Plus size={17} />
              MÜŞTERİ OLUŞTUR
              <ChevronDown size={14} />
            </button>
          </div>
        }
      />
      <div className="b24-crm-control">
        <div className="b24-pipeline-select">
          <Columns3 size={18} />
          <select
            value={pipeline}
            onChange={(e) => {
              setPipeline(e.target.value);
              setSelected([]);
            }}
            aria-label="Satış hunisi"
          >
            <option value="all">Tüm satış hunileri</option>
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="icon-button"
            onClick={() => setEditing(undefined)}
            aria-label="Yeni satış hunisi"
          >
            <Plus size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setEditing(current)}
            aria-label="Satış hunisini düzenle"
          >
            <Settings2 size={16} />
          </button>
        </div>
      </div>
      <div className="crm-toolbar b24-filter-bar">
        <div className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Müşteri veya telefon ara…"
          />
        </div>
        <div className="toolbar-right">
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            aria-label="Danışman filtresi"
          >
            <option value="all">Tüm sorumlular</option>
            {owners.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <button
            className={`btn secondary ${filters ? "selected" : ""}`}
            onClick={() => setFilters(!filters)}
          >
            <SlidersHorizontal size={15} />
            Filtre ve arama
          </button>
        </div>
      </div>
      {filters && (
        <div className="filter-panel">
          <label>
            Kaynak
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">Tüm kaynaklar</option>
              {[...new Set(data.leads.map((l) => l.source))].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Sonraki etkinlik
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
            >
              <option value="all">Tüm müşteriler</option>
              <option value="overdue">Gecikmiş etkinlik</option>
              <option value="none">Etkinlik planlanmamış</option>
            </select>
          </label>
          <button
            className="text-button"
            onClick={() => {
              setOwner("all");
              setSource("all");
              setActivity("all");
              setQuery("");
              setAdvanced({ ...CRM_WORKSPACE_FILTER_DEFAULTS, pipeline });
            }}
          >
            Filtreleri temizle
          </button>
        </div>
      )}
      <CRMPersonalization
        filters={workspaceFilters}
        appearance={appearance}
        onApply={applyWorkspaceFilters}
        onAppearanceChange={setAppearance}
      />
      <div className="b24-deal-summary">
        <span>
          <i className="b24-summary-dot" />
          {open.length} açık müşteri<strong>{money(openValue)}</strong>
        </span>
        <span>
          Ağırlıklı tahmin<strong>{money(forecast)}</strong>
        </span>
        <span>
          Etkinlik bekleyen
          <strong>{open.filter((l) => !next(l)).length}</strong>
        </span>
        <button onClick={() => navigate?.("/automations")}>
          <Workflow size={15} />
          Robotlar & kurallar
          <ArrowUpRight size={13} />
        </button>
      </div>
      {selected.length > 0 && (
        <div className="b24-bulk">
          <strong>{selected.length} müşteri seçildi</strong>
          <select
            value={bulkStage}
            onChange={(e) => setBulkStage(e.target.value as Stage)}
            aria-label="Toplu aşama"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="btn secondary small"
            disabled={busy}
            onClick={() => bulk("stage")}
          >
            Aşamayı değiştir
          </button>
          <select
            value={bulkOwner}
            onChange={(e) => setBulkOwner(e.target.value)}
            aria-label="Toplu sorumlu"
          >
            <option value="">Sorumlu seçin</option>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <button
            className="btn secondary small"
            disabled={busy || !bulkOwner}
            onClick={() => bulk("owner")}
          >
            Sorumlu ata
          </button>
          <button className="text-button" onClick={() => setSelected([])}>
            Seçimi kaldır
          </button>
        </div>
      )}
      {importing && (
        <ImportWizard kind="leads" onClose={() => setImporting(false)} />
      )}
      {activeView === "activities" ? (
        <CRMActivities
          leads={leads}
          onLead={onLead}
          onMessage={onMessage}
          navigate={navigate}
          onActivity={addActivity}
          onEditActivity={editActivity}
          onEditTask={editTask}
        />
      ) : activeView === "calendar" ? (
        <CRMCalendar
          leads={leads}
          onLead={onLead}
          onMessage={onMessage}
          navigate={navigate}
          onActivity={addActivity}
          onEditActivity={editActivity}
          onEditTask={editTask}
        />
      ) : activeView === "kanban" ? (
        <div className="kanban-board b24-kanban">
          {stages.map((s) => {
            const items = leads.filter((l) => l.stage === s.id);
            return (
              <section
                key={s.id}
                className={`kanban-column ${over === s.id ? "drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(s.id);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  move(e.dataTransfer.getData("text/plain"), s.id);
                }}
              >
                <header style={{ background: s.color, borderColor: s.color }}>
                  <div>
                    <h3>{s.label}</h3>
                    <span className="column-count">{items.length}</span>
                    <button
                      className="icon-button"
                      aria-label={`${s.label} müşterisi ekle`}
                      onClick={() => {
                        setQuick(s.id);
                        setQuickName("");
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <p>{money(items.reduce((n, l) => n + l.value, 0))}</p>
                </header>
                <div className="kanban-cards">
                  {quick === s.id && (
                    <form
                      className="b24-quick-card"
                      onSubmit={(e) => {
                        e.preventDefault();
                        add(s.id);
                      }}
                    >
                      <input
                        autoFocus
                        placeholder="Müşteri adı"
                        value={quickName}
                        onChange={(e) => setQuickName(e.target.value)}
                        required
                      />
                      <div>
                        <button className="btn primary small">Ekle</button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setQuick(null)}
                        >
                          İptal
                        </button>
                      </div>
                    </form>
                  )}
                  {items.map((l) => {
                    const upcoming = next(l);
                    const overdue = upcoming && isOverdue(upcoming.date);
                    return (
                      <article
                        key={l.id}
                        className={`lead-card b24-deal-card crm-card-profile-${appearance.cardProfile}`}
                        draggable
                        onDragStart={(e) =>
                          e.dataTransfer.setData("text/plain", l.id)
                        }
                      >
                        <div className="lead-card-top">
                          <input
                            type="checkbox"
                            checked={selected.includes(l.id)}
                            aria-label={`${l.name} seç`}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, l.id]
                                  : selected.filter((x) => x !== l.id),
                              )
                            }
                          />
                          <span className="b24-card-source">
                            {l.source}
                            {l.city ? ` · ${l.city}` : ""}
                          </span>
                          <span
                            className="crm-open-count"
                            title={`${l.name} için açık etkinlik sayısı: ${openCount(l.id, data.tasks, data.activities)}`}
                            aria-label={`${l.name} için açık etkinlik sayısı: ${openCount(l.id, data.tasks, data.activities)}`}
                          >
                            <CalendarClock size={12} />{" "}
                            {openCount(l.id, data.tasks, data.activities)}
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Müşteri ayrıntısı"
                            onClick={() => onLead(l)}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                        </div>
                        <button
                          className="b24-deal-title"
                          onClick={() => onLead(l)}
                        >
                          {l.name}
                        </button>
                        <small className="b24-card-secondary">
                          {l.dealTitle ||
                            l.company ||
                            "Gayrimenkul müşteri kaydı"}
                        </small>
                        <strong className="b24-deal-value">
                          {money(l.value)}
                        </strong>
                        {appearance.cardProfile === "detailed" && (
                          <div className="crm-detailed-card">
                            <span>{l.phone || "Telefon eklenmedi"}</span>
                            {l.email && <span>{l.email}</span>}
                            {l.city && <span>Şehir: {l.city}</span>}
                            <span>
                              Kişi:{" "}
                              {data.contacts.find((c) => c.id === l.contactId)
                                ?.name || "Bağlanmadı"}
                            </span>
                            <span>
                              Şirket:{" "}
                              {data.companies.find((c) => c.id === l.companyId)
                                ?.name || "Bağlanmadı"}
                            </span>
                          </div>
                        )}
                        <button
                          className="b24-contact-link"
                          onClick={() => onLead(l)}
                        >
                          <Avatar name={l.name} size={24} />
                          {l.name}
                        </button>
                        {l.tags.length > 0 && (
                          <div className="b24-card-tags">
                            {l.tags.map((t) => (
                              <Badge
                                key={t}
                                tone={t === "Öncelikli" ? "amber" : "gray"}
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <div
                          className={`b24-next-activity ${overdue ? "overdue" : ""}`}
                        >
                          <CalendarClock size={13} />
                          {upcoming ? (
                            <span>
                              {upcoming.title}
                              <small>
                                {new Date(upcoming.date).toLocaleDateString(
                                  "tr-TR",
                                  {
                                    timeZone: "Europe/Istanbul",
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                                {overdue ? " · Gecikmiş" : ""}
                              </small>
                            </span>
                          ) : (
                            <button onClick={() => addActivity(l.id)}>
                              Etkinlik planlayın
                              <Plus size={12} />
                            </button>
                          )}
                        </div>
                        <CRMLeadActions
                          lead={l}
                          onMessage={
                            onMessage ||
                            ((id) =>
                              navigate?.(
                                `/whatsapp?lead=${encodeURIComponent(id)}`,
                              ))
                          }
                          onActivity={() => addActivity(l.id)}
                          navigate={navigate}
                        />
                        <div className="lead-card-footer">
                          <span>
                            <Avatar name={l.owner} size={21} />
                            {l.owner}
                          </span>
                          <select
                            value={l.stage}
                            aria-label={`${l.name} aşamasını değiştir`}
                            onChange={(e) =>
                              move(l.id, e.target.value as Stage)
                            }
                          >
                            {stages.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </article>
                    );
                  })}
                  <button
                    className="add-card"
                    onClick={() => {
                      setQuick(s.id);
                      setQuickName("");
                    }}
                  >
                    <Plus size={14} />
                    Hızlı müşteri ekle
                  </button>
                </div>
                <button
                  className="column-automation"
                  onClick={() => navigate?.("/automations")}
                >
                  <Workflow size={13} />
                  {
                    data.rules.filter(
                      (r) =>
                        r.enabled &&
                        r.triggerStage === s.id &&
                        (!r.pipelineId ||
                          r.pipelineId === "all" ||
                          r.pipelineId === pipeline),
                    ).length
                  }{" "}
                  otomasyon kuralı
                  <ChevronDown size={11} />
                </button>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Tüm müşterileri seç"
                      checked={
                        !!leads.length &&
                        leads.every((l) => selected.includes(l.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? leads.map((l) => l.id) : [],
                        )
                      }
                    />
                  </th>
                  <th>MÜŞTERİ / PORTFÖY</th>
                  {showColumn("stage") && <th>AŞAMA</th>}
                  {showColumn("value") && <th>TUTAR</th>}
                  {showColumn("next") && <th>SONRAKİ ETKİNLİK</th>}
                  {showColumn("owner") && <th>SORUMLU</th>}
                  {showColumn("source") && <th>KAYNAK</th>}
                  <th>ETKİNLİK / İLETİŞİM</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${l.name} seç`}
                        checked={selected.includes(l.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, l.id]
                              : selected.filter((x) => x !== l.id),
                          )
                        }
                      />
                    </td>
                    <td onClick={() => onLead(l)}>
                      <strong>{l.name}</strong>
                      <div className="b24-table-person">
                        {l.name} · {l.phone || "Telefon eklenmedi"}
                      </div>
                    </td>
                    {showColumn("stage") && (
                      <td>
                        <Badge
                          tone={
                            l.stage === "won"
                              ? "green"
                              : l.stage === "lost"
                                ? "red"
                                : "blue"
                          }
                        >
                          {stages.find((s) => s.id === l.stage)?.label}
                        </Badge>
                      </td>
                    )}
                    {showColumn("value") && <td>{money(l.value)}</td>}
                    {showColumn("next") && (
                      <td>
                        {next(l) ? (
                          <span
                            className={
                              isOverdue(next(l)!.date) ? "b24-red" : ""
                            }
                          >
                            {next(l)!.title}
                          </span>
                        ) : (
                          <button
                            className="text-button"
                            onClick={() => addActivity(l.id)}
                          >
                            Etkinlik planlayın
                            <Plus size={12} />
                          </button>
                        )}
                      </td>
                    )}
                    {showColumn("owner") && (
                      <td>
                        <span className="owner-cell">
                          <Avatar name={l.owner} size={23} />
                          {l.owner}
                        </span>
                      </td>
                    )}
                    {showColumn("source") && <td>{l.source}</td>}
                    <td>
                      <div className="v6-list-actions">
                        <span
                          title="Açık etkinlik sayısı"
                          className="crm-open-count"
                        >
                          {openCount(l.id, data.tasks, data.activities)}
                        </span>
                        <CRMLeadActions
                          lead={l}
                          onMessage={onMessage}
                          onActivity={() => addActivity(l.id)}
                          navigate={navigate}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!leads.length && (
              <Empty
                title="Bu hunide müşteri yok"
                description="Yeni müşteri ekleyin veya filtrelerinizi değiştirin."
              />
            )}
          </div>
          <div className="table-footer">
            {leads.length} müşteri gösteriliyor
            <span>{demo ? "Demo çalışma alanı" : "Kalıcı CRM kayıtları"}</span>
          </div>
        </section>
      )}
      <p className="b24-board-hint">
        Kartları sürükleyerek taşıyın. Başlığa tıklayarak müşteri zaman
        çizelgesini açın. {demo && "Örnek veriler · Dış iletişim gönderilmez."}
      </p>
      {editing !== null && (
        <PipelineEditor
          pipeline={editing}
          onClose={() => setEditing(null)}
          onSaved={setPipeline}
        />
      )}
      {activityEditor && (
        <ActivityEditor
          requireLead
          activity={activityEditor.activity}
          leadId={activityEditor.leadId}
          date={activityEditor.date}
          onClose={() => setActivityEditor(null)}
        />
      )}
      {taskEditor && (
        <TaskEditor
          task={taskEditor.task}
          onClose={() => setTaskEditor(null)}
        />
      )}
    </>
  );
}
