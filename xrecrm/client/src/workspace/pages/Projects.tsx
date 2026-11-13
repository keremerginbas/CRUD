// Projeler: proje galerisi, proje ayrıntısı ve daire (bağımsız bölüm) gezgini.
// Gayrimenkul satış modülünün 1. fazı — yalnız envanter; ödeme planı, teklif vb. sonraki fazlardadır.
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, ArrowLeft, Building2, CalendarClock, FileSpreadsheet, MapPin, Pencil, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  activeInventory,
  emptyProjectStats,
  formatPriceShort,
  projectStatsMap,
  type Project,
  type ProjectImageKind,
  type ProjectStats,
  type Unit,
  type UnitStatus,
} from "../../../../shared/real-estate";
import { Empty, PageTitle } from "../components/ui";
import { useInventory } from "../projects";
import UnitExplorer, { statusLabel } from "../components/projects/UnitExplorer";
import BudgetFinder from "../components/projects/BudgetFinder";
import UnitImport from "../components/projects/UnitImport";
import { ProjectEditor, UnitDetail, UnitEditor, blankProject, blankUnit, imageKindLabel, projectStatusLabel } from "../components/projects/ProjectForms";
import "../suite-pages.css";
import "../projects.css";

const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const deliveryLabel = (date: string) => {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  return match ? `${months[Number(match[2]) - 1] || ""} ${match[1]}`.trim() : "";
};
const location = (project: Project) => [project.district, project.city].filter(Boolean).join(", ");
const cover = (project: Project) => project.images.find((i) => i.kind === "render") || project.images[0];
const projectTone: Record<Project["status"], string> = { satışta: "ok", yakında: "hold", tamamlandı: "sold" };

function priceRange(stats: ProjectStats): string {
  if (!stats.ranges.length) return stats.available ? "Fiyat girilmemiş" : "Müsait daire yok";
  return stats.ranges
    .slice(0, 2)
    .map((r) => (r.min === r.max ? formatPriceShort(r.min, r.currency) : `${formatPriceShort(r.min, r.currency)} – ${formatPriceShort(r.max, r.currency)}`))
    .join(" · ");
}

function ProjectCard({ project, stats, onOpen }: { project: Project; stats: ProjectStats; onOpen: () => void }) {
  const image = cover(project);
  return (
    <li>
      <button type="button" className="pj-card" onClick={onOpen}>
        <span className="pj-card-cover">
          {image ? <img src={image.url} alt="" loading="lazy" /> : <Building2 size={40} aria-hidden="true" />}
          <span className={`pj-status pj-tone-${projectTone[project.status]}`}>{project.archived ? "Arşivde" : projectStatusLabel[project.status]}</span>
        </span>
        <span className="pj-card-body">
          <strong className="pj-card-title">{project.name}</strong>
          <span className="pj-muted pj-card-loc">
            <MapPin size={13} aria-hidden="true" /> {location(project) || "Konum girilmemiş"}
          </span>
          <span className="pj-card-stats">
            <span>
              <b>{stats.available}</b> müsait daire
            </span>
            <span className="pj-muted">/ {stats.total} toplam</span>
          </span>
          <span className="pj-card-price">{priceRange(stats)}</span>
        </span>
      </button>
    </li>
  );
}

function Gallery({ project }: { project: Project }) {
  const kinds = useMemo(() => (["render", "gerçek"] as ProjectImageKind[]).filter((k) => project.images.some((i) => i.kind === k)), [project.images]);
  const [kind, setKind] = useState<ProjectImageKind>(kinds[0] || "render");
  const [index, setIndex] = useState(0);
  const active = kinds.includes(kind) ? kind : kinds[0];
  const images = project.images.filter((i) => i.kind === active);
  const current = images[Math.min(index, images.length - 1)];
  if (!project.images.length)
    return (
      <div className="pj-gallery pj-gallery-empty">
        <Building2 size={44} aria-hidden="true" />
        <span className="pj-muted">Bu projeye henüz görsel eklenmedi.</span>
      </div>
    );
  return (
    <div className="pj-gallery">
      <div className="pj-gallery-main">
        {current && <img src={current.url} alt={current.caption || `${project.name} — ${imageKindLabel[current.kind]}`} />}
        {kinds.length > 0 && (
          <div className="pj-seg pj-gallery-toggle" role="group" aria-label="Görsel türü">
            {kinds.map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={k === active}
                onClick={() => {
                  setKind(k);
                  setIndex(0);
                }}
              >
                {imageKindLabel[k]} ({project.images.filter((i) => i.kind === k).length})
              </button>
            ))}
          </div>
        )}
        {current?.caption && <span className="pj-gallery-caption">{current.caption}</span>}
      </div>
      {images.length > 1 && (
        <div className="pj-thumbs">
          {images.map((image, i) => (
            <button type="button" key={image.id} aria-label={image.caption || `Görsel ${i + 1}`} aria-pressed={image.id === current?.id} onClick={() => setIndex(i)}>
              <img src={image.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Projects() {
  const store = useInventory();
  const { canWrite } = store;
  const [view, setView] = useState<"gallery" | "explorer">("gallery");
  const [projectId, setProjectId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [projectEdit, setProjectEdit] = useState<{ project: Project; isNew: boolean } | null>(null);
  const [unitEdit, setUnitEdit] = useState<{ unit: Unit; isNew: boolean } | null>(null);
  const [unitOpen, setUnitOpen] = useState("");
  const [importing, setImporting] = useState(false);
  const [budget, setBudget] = useState(false);

  const live = useMemo(() => activeInventory(store.projects, store.units), [store.projects, store.units]);
  const stats = useMemo(() => projectStatsMap(store.units), [store.units]);
  const archivedProjects = useMemo(() => store.projects.filter((p) => p.archived), [store.projects]);
  const project = store.projects.find((p) => p.id === projectId);
  const archivedUnits = useMemo(() => (projectId ? store.units.filter((u) => u.projectId === projectId && u.archived) : []), [store.units, projectId]);
  const openUnit = store.units.find((u) => u.id === unitOpen);
  const unarchivedUnits = useMemo(() => store.units.filter((u) => !u.archived), [store.units]);

  useEffect(() => {
    if (projectId && !store.loading && !project) setProjectId("");
  }, [projectId, project, store.loading]);

  const openProject = (id: string) => {
    setProjectId(id);
    window.scrollTo(0, 0);
  };
  const guard = async (task: () => Promise<unknown>, done?: string) => {
    try {
      await task();
      if (done) toast.success(done);
    } catch (error) {
      toast.error((error as Error).message || "İşlem tamamlanamadı.");
    }
  };
  const changeStatus = (unit: Unit, status: UnitStatus) =>
    void guard(() => store.saveUnit({ ...unit, status }), `No ${unit.unitNo}: ${statusLabel[status]}`);
  const archiveUnit = (unit: Unit) => {
    if (!window.confirm(`No ${unit.unitNo} arşivlensin mi? Daire listelerde görünmez; kayıt silinmez ve geri alınabilir.`)) return;
    setUnitOpen("");
    void guard(() => store.saveUnit({ ...unit, archived: true }), "Daire arşivlendi.");
  };
  const archiveProject = (target: Project) => {
    if (!window.confirm(`"${target.name}" arşivlensin mi? Proje ve daireleri listelerde görünmez; kayıtlar silinmez ve geri alınabilir.`)) return;
    void guard(async () => {
      await store.saveProject({ ...target, archived: true });
      setProjectId("");
    }, "Proje arşivlendi.");
  };

  const actions = (
    <>
      <button type="button" className="btn secondary pj-touch" onClick={() => setBudget(true)} disabled={!live.units.length}>
        <Wallet size={16} /> Bütçeye göre bul
      </button>
      {canWrite && (
        <>
          <button type="button" className="btn secondary pj-touch" onClick={() => setImporting(true)} disabled={!live.projects.length}>
            <FileSpreadsheet size={16} /> İçe aktar
          </button>
          {project && !project.archived ? (
            <button type="button" className="btn primary pj-touch" onClick={() => setUnitEdit({ unit: blankUnit(project.id), isNew: true })}>
              <Plus size={16} /> Yeni daire
            </button>
          ) : (
            <button type="button" className="btn primary pj-touch" onClick={() => setProjectEdit({ project: blankProject(), isNew: true })}>
              <Plus size={16} /> Yeni proje
            </button>
          )}
        </>
      )}
    </>
  );

  const modals = (
    <>
      {projectEdit && <ProjectEditor {...projectEdit} store={store} onClose={() => setProjectEdit(null)} />}
      {unitEdit && <UnitEditor {...unitEdit} projects={live.projects} store={store} onClose={() => setUnitEdit(null)} />}
      {openUnit && !unitEdit && (
        <UnitDetail
          unit={openUnit}
          project={store.projects.find((p) => p.id === openUnit.projectId)}
          canWrite={canWrite}
          onClose={() => setUnitOpen("")}
          onEdit={() => {
            setUnitEdit({ unit: openUnit, isNew: false });
            setUnitOpen("");
          }}
          onArchive={() => archiveUnit(openUnit)}
        />
      )}
      {importing && <UnitImport projects={live.projects} units={store.units} initialProjectId={project && !project.archived ? project.id : ""} store={store} onClose={() => setImporting(false)} />}
      {budget && (
        <BudgetFinder
          projects={live.projects}
          units={live.units}
          initialProjectId={project && !project.archived ? project.id : ""}
          onOpen={(unit) => {
            setBudget(false);
            setUnitOpen(unit.id);
          }}
          onClose={() => setBudget(false)}
        />
      )}
    </>
  );

  if (project) {
    const s = stats.get(project.id) || emptyProjectStats;
    return (
      <div className="pj-page">
        <button type="button" className="pj-back" onClick={() => setProjectId("")}>
          <ArrowLeft size={16} /> Tüm projeler
        </button>
        <PageTitle eyebrow="PROJE" title={project.name} description={[location(project), project.address].filter(Boolean).join(" · ") || "Konum girilmemiş"} actions={actions} />
        <div className="pj-detail">
          <Gallery key={project.id} project={project} />
          <div className="pj-detail-info pj-panel">
            <div className="pj-detail-badges">
              <span className={`pj-status pj-tone-${projectTone[project.status]}`}>{project.archived ? "Arşivde" : projectStatusLabel[project.status]}</span>
              {project.deliveryDate && (
                <span className="pj-meta">
                  <CalendarClock size={14} aria-hidden="true" /> Teslim: {deliveryLabel(project.deliveryDate)}
                </span>
              )}
              {project.developer && (
                <span className="pj-meta">
                  <Building2 size={14} aria-hidden="true" /> {project.developer}
                </span>
              )}
            </div>
            <dl className="pj-kpis">
              <div>
                <dt>Müsait</dt>
                <dd>{s.available}</dd>
              </div>
              <div>
                <dt>Opsiyonlu</dt>
                <dd>{s.optioned}</dd>
              </div>
              <div>
                <dt>Satıldı</dt>
                <dd>{s.sold}</dd>
              </div>
              <div>
                <dt>Toplam</dt>
                <dd>{s.total}</dd>
              </div>
            </dl>
            <p className="pj-card-price">{priceRange(s)}</p>
            {project.description && <p className="pj-text">{project.description}</p>}
            {project.amenities.length > 0 && (
              <div className="pj-tags" aria-label="Olanaklar">
                {project.amenities.map((a) => (
                  <span key={a}>{a}</span>
                ))}
              </div>
            )}
            {canWrite && (
              <div className="pj-detail-actions">
                <button type="button" className="btn secondary pj-touch" onClick={() => setProjectEdit({ project, isNew: false })}>
                  <Pencil size={15} /> Projeyi düzenle
                </button>
                {project.archived ? (
                  <button type="button" className="btn secondary pj-touch" onClick={() => void guard(() => store.saveProject({ ...project, archived: false }), "Proje arşivden çıkarıldı.")}>
                    <ArchiveRestore size={15} /> Arşivden çıkar
                  </button>
                ) : (
                  <button type="button" className="btn secondary pj-touch" onClick={() => archiveProject(project)}>
                    <Archive size={15} /> Arşivle
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <h2 className="pj-section-title">Daireler</h2>
        <UnitExplorer
          projects={store.projects}
          units={unarchivedUnits}
          lockedProjectId={project.id}
          canWrite={canWrite && !project.archived}
          onOpen={(unit) => setUnitOpen(unit.id)}
          onEdit={(unit) => setUnitEdit({ unit, isNew: false })}
          onStatus={changeStatus}
        />
        {canWrite && archivedUnits.length > 0 && (
          <details className="pj-archived">
            <summary>Arşivdeki daireler ({archivedUnits.length})</summary>
            <ul>
              {archivedUnits.map((unit) => (
                <li key={unit.id}>
                  <span>
                    {unit.block ? `${unit.block} Blok · ` : ""}No {unit.unitNo} {unit.type && `· ${unit.type}`}
                  </span>
                  <button type="button" className="btn secondary pj-touch" onClick={() => void guard(() => store.saveUnit({ ...unit, archived: false }), "Daire arşivden çıkarıldı.")}>
                    <ArchiveRestore size={15} /> Geri al
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {modals}
      </div>
    );
  }

  const shown = showArchived ? archivedProjects : live.projects;
  return (
    <div className="pj-page">
      <PageTitle
        eyebrow="GAYRİMENKUL SATIŞ"
        title="Projeler"
        description="Proje ve bağımsız bölüm envanteri: müşterinin bütçesine ve isteğine uyan daireyi hızla bulun."
        actions={actions}
      />
      <div className="pj-topbar">
        <div className="pj-seg" role="group" aria-label="Görünüm">
          <button type="button" aria-pressed={view === "gallery"} onClick={() => setView("gallery")}>
            Projeler ({live.projects.length})
          </button>
          <button type="button" aria-pressed={view === "explorer"} onClick={() => setView("explorer")}>
            Daire bul ({live.units.length.toLocaleString("tr-TR")})
          </button>
        </div>
        {view === "gallery" && archivedProjects.length > 0 && (
          <button type="button" className="pj-link" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            <Archive size={14} /> {showArchived ? "Etkin projelere dön" : `Arşiv (${archivedProjects.length})`}
          </button>
        )}
      </div>
      {store.error && (
        <p className="pj-error" role="alert">
          {store.error}{" "}
          <button type="button" className="pj-link" onClick={() => void store.reload()}>
            Yeniden dene
          </button>
        </p>
      )}
      {store.loading && !store.projects.length ? (
        <div className="pj-panel pj-loading" role="status">
          Projeler yükleniyor…
        </div>
      ) : view === "gallery" ? (
        shown.length ? (
          <ul className="pj-grid">
            {shown.map((p) => (
              <ProjectCard key={p.id} project={p} stats={stats.get(p.id) || emptyProjectStats} onOpen={() => openProject(p.id)} />
            ))}
          </ul>
        ) : (
          <div className="pj-panel">
            <Empty
              title={showArchived ? "Arşivde proje yok" : "Henüz proje yok"}
              description={canWrite ? "“Yeni proje” ile ilk projenizi ekleyin, ardından daireleri tek tek veya Excel’den toplu içe aktarın." : "Projeler eklendiğinde burada görünecek."}
            />
          </div>
        )
      ) : (
        <UnitExplorer
          projects={live.projects}
          units={live.units}
          canWrite={canWrite}
          onOpen={(unit) => setUnitOpen(unit.id)}
          onEdit={(unit) => setUnitEdit({ unit, isNew: false })}
          onStatus={changeStatus}
          onProject={openProject}
        />
      )}
      {modals}
    </div>
  );
}
