import type { ReactNode } from "react";
import { Activity, CalendarDays, LayoutGrid, List, Plus } from "lucide-react";
import type { Lead, Stage } from "../data";
import { Avatar, Badge } from "./ui";
import {
  istanbulDateTimeLabel,
  type CrmOpenRecord,
} from "../../../../shared/crm-activities";
import LeadQuickActions from "../components/LeadQuickActions";
import "../crm-views.css";

export type CRMView = "kanban" | "list" | "activities" | "calendar";

export const CRM_VIEW_ROUTES: Record<CRMView, string> = {
  kanban: "/kanban",
  list: "/leads",
  activities: "/activities",
  calendar: "/calendar",
};

const viewLabels: Record<CRMView, string> = {
  kanban: "Kanban",
  list: "Liste",
  activities: "Etkinlikler",
  calendar: "Takvim",
};

const viewIcons: Record<CRMView, typeof LayoutGrid> = {
  kanban: LayoutGrid,
  list: List,
  activities: Activity,
  calendar: CalendarDays,
};

export function CRMViews({
  view,
  onViewChange,
  navigate,
  count,
  actions,
  children,
}: {
  view: CRMView;
  onViewChange?: (view: CRMView) => void;
  navigate?: (path: string) => void;
  count?: number;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const change = (next: CRMView) => {
    if (onViewChange) onViewChange(next);
    else navigate?.(CRM_VIEW_ROUTES[next]);
  };
  return (
    <>
      <div className="b24-page-head crm-views-heading">
        <div>
          <h1>
            Müşteriler {typeof count === "number" && <span>{count}</span>}
          </h1>
          <p>Müşteri, iletişim ve sonraki adım — aynı çalışma alanında.</p>
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <nav className="crm-views-tabs" aria-label="CRM görünümü" role="tablist">
        {(Object.keys(CRM_VIEW_ROUTES) as CRMView[]).map((item) => {
          const Icon = viewIcons[item];
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              className={view === item ? "active" : ""}
              onClick={() => change(item)}
            >
              <Icon size={15} />
              {viewLabels[item]}
            </button>
          );
        })}
      </nav>
      {children}
    </>
  );
}

export function CRMLeadActions({
  lead,
  onMessage,
  onActivity,
  navigate,
}: {
  lead: Lead;
  onMessage?: (id: string) => void;
  onActivity?: () => void;
  navigate?: (path: string) => void;
}) {
  const message =
    onMessage ||
    ((id: string) => navigate?.(`/whatsapp?lead=${encodeURIComponent(id)}`));
  return (
    <div
      className="crm-lead-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <LeadQuickActions
        lead={lead}
        onMessage={message}
        onActivity={onActivity}
      />
    </div>
  );
}

export function CRMContactCard({
  lead,
  nextRecord,
  openCount = 0,
  stageLabel,
  onLead,
  onMessage,
  onActivity,
  navigate,
  children,
  selected,
  onSelectedChange,
  onStageChange,
  stages,
}: {
  lead: Lead;
  nextRecord?: CrmOpenRecord;
  openCount?: number;
  stageLabel?: string;
  onLead?: (lead: Lead) => void;
  onMessage?: (id: string) => void;
  onActivity?: () => void;
  navigate?: (path: string) => void;
  children?: ReactNode;
  selected?: boolean;
  onSelectedChange?: (checked: boolean) => void;
  onStageChange?: (stage: Stage) => void;
  stages?: { id: Stage; label: string }[];
}) {
  const secondary =
    lead.dealTitle || lead.company || "Gayrimenkul müşteri kaydı";
  return (
    <article className="crm-contact-card">
      <div className="crm-contact-card-top">
        {onSelectedChange && (
          <input
            type="checkbox"
            checked={!!selected}
            aria-label={`${lead.name} seç`}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
        )}
        <span className="crm-card-source">
          {lead.source || "Kaynak yok"}
          {lead.city ? ` · ${lead.city}` : ""}
        </span>
        <span
          className="crm-open-count"
          title={`${lead.name} için açık etkinlik sayısı: ${openCount}`}
          aria-label={`${lead.name} için açık etkinlik sayısı: ${openCount}`}
        >
          <Activity size={13} /> {openCount}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={`${lead.name} müşteri ayrıntısı`}
          onClick={() => onLead?.(lead)}
        >
          <Plus size={14} style={{ transform: "rotate(45deg)" }} />
        </button>
      </div>
      <div className="crm-contact-heading">
        <button
          type="button"
          className="crm-contact-name"
          onClick={() => onLead?.(lead)}
        >
          {lead.name}
        </button>
        <strong>{secondary}</strong>
      </div>
      <div className="crm-contact-meta">
        <Avatar name={lead.name} size={24} />
        <span>{lead.owner || "Sorumlu atanmadı"}</span>
        {stageLabel && <Badge tone="blue">{stageLabel}</Badge>}
      </div>
      <div className="crm-contact-record">
        {nextRecord ? (
          <>
            <span>
              <b>{nextRecord.title}</b>
              <small>{istanbulDateTimeLabel(nextRecord.date)}</small>
            </span>
          </>
        ) : (
          <span className="crm-no-record">
            {openCount
              ? "Açık kayıt var · Tarih belirlenmedi"
              : "Açık etkinlik yok"}
          </span>
        )}
      </div>
      {children}
      <div className="crm-contact-footer">
        <CRMLeadActions
          lead={lead}
          onMessage={onMessage}
          onActivity={onActivity}
          navigate={navigate}
        />
        {onStageChange && stages && (
          <select
            value={lead.stage}
            aria-label={`${lead.name} aşamasını değiştir`}
            onChange={(event) => onStageChange(event.target.value as Stage)}
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </article>
  );
}

export default CRMViews;
