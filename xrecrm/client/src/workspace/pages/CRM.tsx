import CRMPersonalization from "../components/CRMPersonalization";
import ImportWizard from "../components/ImportWizard";
import {
  CRM_WORKSPACE_FILTER_DEFAULTS,
  CRM_WORKSPACE_DEFAULT_APPEARANCE,
  createCrmWorkspaceMatcher,
  matchesCrmWorkspaceFilters,
  safeCrmWorkspaceFilters,
  type CrmWorkspaceFilters,
  type CrmWorkspaceAppearance,
} from "../../../../shared/crm-workspace";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../components/ui";
import { useStore } from "../store";
import { Lead, Stage, money } from "../data";
import { KanbanBoard, KanbanCard, KanbanColumn } from "../components/KanbanDnd";
import { useInventory } from "../projects";
import { cleanPhoneInput, phoneProblem } from "../../../../shared/phone";
import { KANBAN_SORTS, rankForDrop, sortLeads, type KanbanSort } from "../../../../shared/kanban-order";
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
  const { data, moveLead, saveLead, deleteLead, demo, user, saveRecord } = useStore();
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
  // Süzgeç nesnesi yalnız bir değeri değişince yenilenir; yoksa her çizimde tüm müşteriler yeniden süzülür.
  const workspaceFilters = useMemo(
    () => ({ ...advanced, query, pipeline, owner, source, activity }),
    [advanced, query, pipeline, owner, source, activity],
  );
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState<Stage>("contacted");
  const [bulkOwner, setBulkOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Pipeline | undefined | null>(null);
  const [quick, setQuick] = useState<Stage | null>(null);
  const [quickName, setQuickName] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [quickProject, setQuickProject] = useState("");
  const inventory = useInventory();
  const quickProjects = useMemo(() => inventory.projects.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, "tr")), [inventory.projects]);
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
  // "Tüm satış hunileri" görünümünde de varsayılan huninin düzenlenmiş aşama adları kullanılır.
  const stages = current?.stages || getPipelineStages(data.pipelines, pipeline);
  const [stageEdit, setStageEdit] = useState<{ id: string; label: string; description: string; color: string } | null>(null);
  const [stageBusy, setStageBusy] = useState(false);
  const saveStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageEdit || !current) return;
    const label = stageEdit.label.trim();
    if (!label) {
      toast.error("Aşama adı gerekli.");
      return;
    }
    setStageBusy(true);
    try {
      await saveRecord("pipelines", {
        ...current,
        stages: current.stages.map((s) =>
          s.id === stageEdit.id
            ? { ...s, label, color: stageEdit.color, description: stageEdit.description.trim() }
            : s,
        ),
        updatedAt: new Date().toISOString(),
      });
      toast.success("Aşama güncellendi.");
      setStageEdit(null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setStageBusy(false);
    }
  };
  const owners = [
    ...new Set([
      ...data.members.map((m) => m.name),
      ...data.leads.map((l) => l.owner),
    ]),
  ];
  // Binlerce müşteride her kart için tüm görev ve etkinlikleri taramamak adına
  // "sıradaki iş" müşteri başına bir kez hesaplanıp saklanır.
  const openCounts = useMemo(() => new Map<string, number>(), [data.tasks, data.activities]);
  const nextByLead = useMemo(() => {
    const tasksOf = new Map<string, typeof data.tasks>();
    const activitiesOf = new Map<string, typeof data.activities>();
    for (const t of data.tasks) if (t.leadId) (tasksOf.get(t.leadId) || tasksOf.set(t.leadId, []).get(t.leadId)!).push(t);
    for (const a of data.activities) if (a.leadId) (activitiesOf.get(a.leadId) || activitiesOf.set(a.leadId, []).get(a.leadId)!).push(a);
    const map = new Map<string, ReturnType<typeof nextOpenRecord>>();
    for (const id of new Set([...tasksOf.keys(), ...activitiesOf.keys()])) {
      map.set(id, nextOpenRecord(id, tasksOf.get(id) || [], activitiesOf.get(id) || []));
      openCounts.set(id, openCount(id, tasksOf.get(id) || [], activitiesOf.get(id) || []));
    }
    return map;
  }, [data.tasks, data.activities]);
  // Kart başına açık etkinlik sayısı: her çizimde tüm görev ve etkinlikler yeniden taranmaz.
  const openCountOf = (id: string) => openCounts.get(id) || 0;
  const next = (l: Lead) => nextByLead.get(l.id) || nextOpenRecord(l.id, [], []);
  const leads = useMemo(
    () =>
      (() => {
        const matches = createCrmWorkspaceMatcher(workspaceFilters);
        return data.leads.filter((l) => {
          const upcoming = nextByLead.get(l.id);
          return matches({
            ...l,
            pipelineId: l.pipelineId || "sales",
            nextActivityAt: upcoming?.date,
            hasActivity: !!upcoming,
          });
        });
      })(),
    [data.leads, nextByLead, workspaceFilters],
  );
  // Kart sırası: elle (bırakılan yer), tarih, tutar veya ad. Seçim bu tarayıcıda hatırlanır.
  const [sortMode, setSortMode] = useState<KanbanSort>(() => {
    try {
      const saved = localStorage.getItem("xre-kanban-sort") as KanbanSort | null;
      return saved && KANBAN_SORTS.some(([key]) => key === saved) ? saved : "manual";
    } catch {
      return "manual";
    }
  });
  const chooseSort = (mode: KanbanSort) => {
    setSortMode(mode);
    try {
      localStorage.setItem("xre-kanban-sort", mode);
    } catch {
      /* depolama kapalı */
    }
  };
  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const l of leads) {
      const list = map.get(l.stage);
      if (list) list.push(l);
      else map.set(l.stage, [l]);
    }
    for (const [stage, list] of map) map.set(stage, sortLeads(list, sortMode));
    return map;
  }, [leads, sortMode]);
  // Sütun başına ekrana çizilen kart sayısı sınırlıdır; sayılar ve tutarlar yine tüm müşterileri kapsar.
  const COLUMN_PAGE = 20;
  const [columnLimit, setColumnLimit] = useState<Record<string, number>>({});
  const LIST_PAGE = 100;
  const [listLimit, setListLimit] = useState(LIST_PAGE);
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
  const dragLead = dragId ? data.leads.find((l) => l.id === dragId) : null;
  // Kartı bıraktıktan hemen sonra bir otomasyon kuralı müşteriyi başka aşamaya taşırsa kart "kendiliğinden"
  // yer değiştirmiş görünür; nedenini kullanıcıya söyleriz.
  const movedByMe = useRef<{ id: string; stage: string; name: string; at: number } | null>(null);
  useEffect(() => {
    const mine = movedByMe.current;
    if (!mine) return;
    if (Date.now() - mine.at > 30_000) return void (movedByMe.current = null);
    const now = data.leads.find((l) => l.id === mine.id);
    if (!now || now.stage === mine.stage) return;
    movedByMe.current = null;
    const from = stages.find((x) => x.id === mine.stage)?.label || mine.stage;
    const to = stages.find((x) => x.id === now.stage)?.label || now.stage;
    toast.info(`${mine.name} az önce “${to}” aşamasına taşındı.`, {
      description: `Bunu siz yapmadınız: büyük olasılıkla “${from}” aşamasına bağlı bir otomasyon kuralı çalıştı. Kuralı Otomasyonlar sayfasından görebilir veya kapatabilirsiniz.`,
      duration: 12000,
      action: navigate ? { label: "Kurallara git", onClick: () => navigate("/automations") } : undefined,
    });
  }, [data.leads]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = async (id: string, s: Stage, beforeId: string | null = null) => {
    const lead = data.leads.find((l) => l.id === id);
    if (!lead) return;
    try {
      // Elle sıralamada kart bırakıldığı yere yerleşir; diğer sıralamalarda yerini sıralama belirler.
      const rank = sortMode === "manual" ? rankForDrop((byStage.get(s) || []).filter((l) => l.id !== id), beforeId) : undefined;
      await moveLead(id, s, rank);
      if (lead.stage !== s) {
        toast.success("Müşteri aşaması güncellendi.");
        movedByMe.current = { id, stage: s, name: lead.name, at: Date.now() };
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const add = async (s: Stage) => {
    // Hızlı eklemede ad soyad, telefon ve proje zorunludur: eksik kartlar sonradan tamamlanmıyor.
    const name = quickName.trim();
    if (name.length < 2) return void toast.error("Ad soyad yazın.");
    const phoneIssue = quickPhone.trim() ? phoneProblem(quickPhone) : "Telefon numarası yazın.";
    if (phoneIssue) return void toast.error(phoneIssue);
    const chosen = quickProjects.find((p) => p.id === quickProject);
    const projectName = (chosen?.name || (quickProjects.length ? "" : quickProject)).trim();
    if (!projectName) return void toast.error("Proje seçin.");
    const stamp = new Date().toISOString();
    const l: Lead = {
      id: crypto.randomUUID(),
      name,
      phone: quickPhone.trim(),
      // Proje, kartta ad altında görünür; bayi kaydı ve teklif de bu bilgiyi kullanır.
      dealTitle: projectName,
      ...({ projectId: chosen?.id || "", projectName } as object),
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
      setQuickPhone("");
      setQuickProject("");
      toast.success("Müşteri eklendi.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  // Tek müşteri ya da seçilenler kalıcı olarak silinir (onay sorulur).
  async function removeLeads(ids: string[]) {
    if (!ids.length) return;
    const names = ids.map((id) => data.leads.find((l) => l.id === id)?.name).filter(Boolean);
    const label = ids.length === 1 ? `"${names[0] || "Müşteri"}"` : `${ids.length} müşteri`;
    if (
      !window.confirm(
        `${label} kalıcı olarak silinsin mi?\n\nMüşteriye bağlı görevler, etkinlikler ve notlar da silinir. Bu işlem geri alınamaz.`,
      )
    )
      return;
    setBusy(true);
    let done = 0;
    try {
      for (const id of ids) {
        await deleteLead(id);
        done += 1;
      }
      toast.success(done === 1 ? "Müşteri silindi." : `${done} müşteri silindi.`);
    } catch (e) {
      toast.error(`${done ? `${done} müşteri silindi; ` : ""}${(e as Error).message}`);
    } finally {
      setSelected((current) => current.filter((id) => !ids.includes(id)));
      setBusy(false);
    }
  }
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
              İçe aktar
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
        {activeView === "kanban" && (
          <label className="kanban-sort">
            Sıralama
            <select value={sortMode} onChange={(e) => chooseSort(e.target.value as KanbanSort)} aria-label="Kart sıralaması">
              {KANBAN_SORTS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
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
          <button className="btn secondary small danger" disabled={busy} onClick={() => void removeLeads(selected)}>
            <Trash2 size={14} /> Seçilenleri sil
          </button>
          <button className="text-button" onClick={() => setSelected([])}>
            Seçimi kaldır
          </button>
        </div>
      )}
      {stageEdit && (
        <Modal
          title="Aşamayı düzenle"
          subtitle={`${current?.name || "Satış hunisi"} · bu hunideki tüm kullanıcılar için geçerlidir`}
          onClose={() => setStageEdit(null)}
        >
          <form onSubmit={saveStage}>
            <div className="modal-content form-grid">
              <label className="full">
                Aşama adı
                <input
                  required
                  autoFocus
                  maxLength={120}
                  value={stageEdit.label}
                  onChange={(e) => setStageEdit({ ...stageEdit, label: e.target.value })}
                />
              </label>
              <label className="full">
                Açıklama (isteğe bağlı)
                <textarea
                  rows={3}
                  maxLength={500}
                  value={stageEdit.description}
                  onChange={(e) => setStageEdit({ ...stageEdit, description: e.target.value })}
                  placeholder="Bu aşamada ne yapılır? Örn. İlk arama yapıldı, ihtiyaç soruldu."
                />
              </label>
              <label>
                Renk
                <input
                  type="color"
                  value={stageEdit.color}
                  onChange={(e) => setStageEdit({ ...stageEdit, color: e.target.value })}
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button type="button" className="btn secondary" onClick={() => setStageEdit(null)}>
                Vazgeç
              </button>
              <button className="btn primary" disabled={stageBusy}>
                Kaydet
              </button>
            </footer>
          </form>
        </Modal>
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
        <KanbanBoard
          className="kanban-board b24-kanban"
          activeId={dragId}
          onStart={setDragId}
          onCancel={() => setDragId(null)}
          onMove={(id, stage, beforeId) => {
            setDragId(null);
            if (stage) void move(id, stage as Stage, beforeId);
          }}
          overlay={
            dragLead && (
              <article className={`lead-card b24-deal-card kanban-drag-ghost crm-card-profile-${appearance.cardProfile}`}>
                <strong>{dragLead.name}</strong>
                <span>{[dragLead.company, dragLead.phone].filter(Boolean).join(" · ") || dragLead.source}</span>
                <b>{money(dragLead.value)}</b>
              </article>
            )
          }
        >
          {stages.map((s) => {
            const items = byStage.get(s.id) || [];
            return (
              <KanbanColumn
                key={s.id}
                id={s.id}
                className="kanban-column"
                style={{ ["--stage" as string]: s.color } as React.CSSProperties}
              >
                <header style={{ background: s.color, borderColor: s.color }}>
                  <div>
                    <h3 title={s.description || undefined}>{s.label}</h3>
                    <button
                      className="icon-button stage-edit"
                      aria-label={`${s.label} aşamasını düzenle`}
                      title="Aşama adını ve açıklamasını düzenle"
                      onClick={() =>
                        setStageEdit({ id: s.id, label: s.label, description: s.description || "", color: s.color })
                      }
                    >
                      <Pencil size={13} />
                    </button>
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
                  {s.description && <small className="stage-description">{s.description}</small>}
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
                        placeholder="Ad soyad *"
                        aria-label="Ad soyad"
                        value={quickName}
                        onChange={(e) => setQuickName(e.target.value)}
                        required
                        minLength={2}
                      />
                      <input
                        type="tel"
                        inputMode="tel"
                        placeholder="Telefon * (0532 123 45 67)"
                        aria-label="Telefon"
                        value={quickPhone}
                        onChange={(e) => setQuickPhone(cleanPhoneInput(e.target.value))}
                        required
                      />
                      {quickProjects.length > 0 ? (
                        <select aria-label="Proje" value={quickProject} onChange={(e) => setQuickProject(e.target.value)} required>
                          <option value="">Proje seçin *</option>
                          {quickProjects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input placeholder="Proje adı *" aria-label="Proje adı" value={quickProject} onChange={(e) => setQuickProject(e.target.value)} required maxLength={200} />
                      )}
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
                  {items.slice(0, columnLimit[s.id] || COLUMN_PAGE).map((l) => {
                    const upcoming = next(l);
                    const overdue = upcoming && isOverdue(upcoming.date);
                    return (
                      <KanbanCard
                        key={l.id}
                        id={l.id}
                        stage={s.id}
                        className={`lead-card b24-deal-card crm-card-profile-${appearance.cardProfile}`}
                        // Kartın boş bir yerine çift tıklamak müşteri kartını açar;
                        // düğme, seçim kutusu ve açılır listeler kendi işini yapmaya devam eder.
                        onDoubleClick={(e) => {
                          if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label")) return;
                          onLead(l);
                        }}
                        title="Müşteri kartını açmak için çift tıklayın"
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
                            title={`${l.name} için açık etkinlik sayısı: ${openCountOf(l.id)}`}
                            aria-label={`${l.name} için açık etkinlik sayısı: ${openCountOf(l.id)}`}
                          >
                            <CalendarClock size={12} />{" "}
                            {openCountOf(l.id)}
                          </span>
                          <button
                            className="icon-button"
                            aria-label="Müşteri ayrıntısı"
                            onClick={() => onLead(l)}
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          <button
                            className="icon-button lead-delete"
                            aria-label={`${l.name} müşterisini sil`}
                            title="Müşteriyi sil"
                            disabled={busy}
                            onClick={() => void removeLeads([l.id])}
                          >
                            <Trash2 size={14} />
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
                      </KanbanCard>
                    );
                  })}
                  {items.length > (columnLimit[s.id] || COLUMN_PAGE) && (
                    <button
                      type="button"
                      className="add-card column-more"
                      onClick={() =>
                        setColumnLimit((current) => ({ ...current, [s.id]: (current[s.id] || COLUMN_PAGE) + COLUMN_PAGE * 2 }))
                      }
                    >
                      {(items.length - (columnLimit[s.id] || COLUMN_PAGE)).toLocaleString("tr-TR")} müşteri daha · göster
                    </button>
                  )}
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
              </KanbanColumn>
            );
          })}
        </KanbanBoard>
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
                {leads.slice(0, listLimit).map((l) => (
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
                          {openCountOf(l.id)}
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
            {leads.length > listLimit && (
              <button type="button" className="add-card column-more" onClick={() => setListLimit((n) => n + LIST_PAGE * 2)}>
                {(leads.length - listLimit).toLocaleString("tr-TR")} müşteri daha · göster
              </button>
            )}
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
