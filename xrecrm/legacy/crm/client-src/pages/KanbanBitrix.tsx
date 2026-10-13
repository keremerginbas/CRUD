/**
 * Bitrix24 Benzeri Kanban Board - PREMIUM DARK THEME
 * Glassmorphism kartlar, drag-drop animasyonları, neon efektler
 */

import { useState } from "react";
import { trpc } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Spinner } from "../components/ui/spinner";
import { Phone, MessageCircle, Mail, Calendar, MoreVertical, Plus, User } from "lucide-react";
import BitrixDashboardLayout from "../components/DashboardLayout";
import LeadDetailModal from "../components/LeadDetailModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  projectName: string | null;
  city: string | null;
  statusId: number;
  source: string | null;
  priority: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Status {
  id: number;
  name: string;
  displayName: string;
  color: string;
  order: number;
}

const priorityConfig: Record<string, { label: string; bg: string; color: string; dot: string }> = {
  high: {
    label: "Yüksek",
    bg: "oklch(0.58 0.24 27 / 0.15)",
    color: "oklch(0.72 0.18 27)",
    dot: "oklch(0.65 0.22 27)",
  },
  medium: {
    label: "Orta",
    bg: "oklch(0.72 0.18 85 / 0.15)",
    color: "oklch(0.72 0.18 85)",
    dot: "oklch(0.72 0.18 85)",
  },
  low: {
    label: "Düşük",
    bg: "oklch(0.60 0.18 145 / 0.15)",
    color: "oklch(0.65 0.18 145)",
    dot: "oklch(0.60 0.18 145)",
  },
  urgent: {
    label: "Acil",
    bg: "oklch(0.55 0.26 15 / 0.15)",
    color: "oklch(0.68 0.22 15)",
    dot: "oklch(0.58 0.26 15)",
  },
};

export default function KanbanBitrix() {
  const utils = trpc.useUtils();
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const { data: statuses, isLoading: statusesLoading } = trpc.statuses.list.useQuery(undefined);
  const { data: leads, isLoading: leadsLoading } = trpc.leads.list.useQuery(undefined);
  const updateLeadMutation = trpc.leads.update.useMutation({
    onMutate: async (vars: any) => {
      await utils.leads.list.cancel();
      const prev = utils.leads.list.getData(undefined);
      utils.leads.list.setData(undefined, (old: any) =>
        Array.isArray(old) ? old.map((l: any) => (l.id === vars.id ? { ...l, statusId: vars.statusId } : l)) : old
      );
      return { prev };
    },
    onError: (_e: any, _vars: any, ctx: any) => {
      if (ctx?.prev) utils.leads.list.setData(undefined, ctx.prev);
    },
    onSettled: () => { utils.leads.list.invalidate(); },
  });

  const [draggedLead, setDraggedLead] = useState<Lead | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<number | null>(null);

  const leadsByStatus = (statusId: number) => {
    return (leads || []).filter((lead) => lead.statusId === statusId);
  };

  const handleDragStart = (lead: Lead) => {
    setDraggedLead(lead);
  };

  const handleDragOver = (e: React.DragEvent, statusId: number) => {
    e.preventDefault();
    setDragOverColumn(statusId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (statusId: number) => {
    if (draggedLead && draggedLead.statusId !== statusId) {
      updateLeadMutation.mutate({ id: draggedLead.id, statusId });
    }
    setDraggedLead(null);
    setDragOverColumn(null);
  };

  if (statusesLoading || leadsLoading) {
    return (
      <BitrixDashboardLayout>
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <Spinner />
            <p style={{ color: "oklch(0.55 0.015 250)", fontSize: "0.875rem" }}>Yükleniyor...</p>
          </div>
        </div>
      </BitrixDashboardLayout>
    );
  }

  return (
    <BitrixDashboardLayout>
      <div style={{ padding: "1.5rem", minHeight: "100%" }}>
        {/* Header */}
        <div
          className="flex items-center justify-between mb-6"
          style={{ paddingBottom: "1.25rem", borderBottom: "1px solid oklch(1 0 0 / 0.06)" }}
        >
          <div>
            <h1
              className="font-bold"
              style={{
                fontSize: "1.5rem",
                letterSpacing: "-0.03em",
                background: "linear-gradient(135deg, oklch(0.88 0.008 240), oklch(0.78 0.06 255))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              CRM Kanban Board
            </h1>
            <p style={{ fontSize: "0.8125rem", color: "oklch(0.55 0.015 250)", marginTop: "0.25rem" }}>
              Müşterilerinizi yönetin · {(leads || []).length} toplam lead
            </p>
          </div>
          <Button
            style={{
              background: "linear-gradient(135deg, oklch(0.62 0.20 255), oklch(0.52 0.24 270))",
              boxShadow: "0 4px 16px oklch(0.62 0.20 255 / 0.35)",
              border: "none",
              fontWeight: 600,
              fontSize: "0.875rem",
              letterSpacing: "-0.01em",
              color: "white",
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Yeni Lead
          </Button>
        </div>

        {/* Kanban Board */}
        <div
          className="kanban-board-wrapper"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min((statuses || []).length, 4)}, minmax(280px, 1fr))`,
            gap: "1rem",
            overflowX: "auto",
            paddingBottom: "1rem",
          }}
        >
          {(statuses || []).map((status, colIdx) => {
            const colLeads = leadsByStatus(status.id);
            const isDragOver = dragOverColumn === status.id;

            return (
              <div
                key={status.id}
                className="flex flex-col rounded-2xl overflow-hidden"
                style={{
                  minHeight: "600px",
                  background: isDragOver
                    ? "linear-gradient(180deg, oklch(0.185 0.022 255) 0%, oklch(0.165 0.018 255) 100%)"
                    : "linear-gradient(180deg, oklch(0.165 0.016 255) 0%, oklch(0.155 0.012 255) 100%)",
                  border: isDragOver
                    ? `1px solid oklch(0.62 0.20 255 / 0.5)`
                    : "1px solid oklch(1 0 0 / 0.07)",
                  boxShadow: isDragOver
                    ? "0 0 0 2px oklch(0.62 0.20 255 / 0.2), 0 8px 32px oklch(0 0 0 / 0.35)"
                    : "0 4px 24px oklch(0 0 0 / 0.25)",
                  transition: "all 0.2s ease",
                  animationDelay: `${colIdx * 80}ms`,
                }}
                onDragOver={(e) => handleDragOver(e, status.id)}
                onDragLeave={handleDragLeave}
                onDrop={() => handleDrop(status.id)}
              >
                {/* Column Header */}
                <div
                  className="flex items-center justify-between shrink-0"
                  style={{
                    padding: "1rem 1.125rem",
                    borderBottom: `2px solid ${status.color}`,
                    background: `${status.color}12`,
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: status.color,
                        boxShadow: `0 0 8px ${status.color}80`,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      className="font-semibold"
                      style={{
                        fontSize: "0.875rem",
                        letterSpacing: "-0.01em",
                        color: "oklch(0.88 0.008 240)",
                      }}
                    >
                      {status.displayName}
                    </span>
                  </div>
                  <span
                    className="flex items-center justify-center rounded-full font-bold"
                    style={{
                      minWidth: "24px",
                      height: "24px",
                      padding: "0 0.5rem",
                      background: `${status.color}25`,
                      color: status.color,
                      fontSize: "0.75rem",
                      border: `1px solid ${status.color}40`,
                    }}
                  >
                    {colLeads.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div
                  className="flex-1 overflow-y-auto"
                  style={{
                    padding: "0.875rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.625rem",
                  }}
                >
                  {colLeads.map((lead, cardIdx) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      status={status}
                      onDragStart={handleDragStart}
                      onOpen={setSelectedLeadId}
                      animDelay={cardIdx * 50}
                    />
                  ))}

                  {colLeads.length === 0 && (
                    <div
                      className="flex flex-col items-center justify-center"
                      style={{
                        height: "120px",
                        border: `1.5px dashed oklch(1 0 0 / 0.10)`,
                        borderRadius: "0.75rem",
                        color: "oklch(0.45 0.012 250)",
                        fontSize: "0.8125rem",
                        gap: "0.5rem",
                        transition: "all 0.2s ease",
                      }}
                    >
                      <User className="w-5 h-5 opacity-40" />
                      <span>Müşteri yok</span>
                    </div>
                  )}
                </div>

                {/* Add Button */}
                <div
                  className="shrink-0"
                  style={{ padding: "0.75rem", borderTop: "1px solid oklch(1 0 0 / 0.06)" }}
                >
                  <button
                    className="w-full flex items-center justify-center gap-2 rounded-xl"
                    style={{
                      padding: "0.5rem",
                      fontSize: "0.8125rem",
                      fontWeight: 500,
                      color: "oklch(0.55 0.015 250)",
                      background: "oklch(1 0 0 / 0.03)",
                      border: "1px dashed oklch(1 0 0 / 0.10)",
                      transition: "all 0.2s ease",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.07)";
                      (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = `${status.color}60`;
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.03)";
                      (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.55 0.015 250)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.10)";
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Yeni Müşteri
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <LeadDetailModal leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
    </BitrixDashboardLayout>
  );
}

function LeadCard({
  lead,
  status,
  onDragStart,
  onOpen,
  animDelay = 0,
}: {
  lead: Lead;
  status: Status;
  onDragStart: (lead: Lead) => void;
  onOpen?: (id: number) => void;
  animDelay?: number;
}) {
  const priority = lead.priority ? priorityConfig[lead.priority] : null;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(lead)}
      onDoubleClick={() => onOpen?.(lead.id)}
      title="Detay için çift tıklayın"
      className="kanban-card animate-scale-in"
      style={{
        padding: "1rem",
        animationDelay: `${animDelay}ms`,
      }}
    >
      {/* Top: Name + Menu */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex items-center justify-center rounded-full shrink-0 font-bold text-white"
            style={{
              width: "32px",
              height: "32px",
              background: `linear-gradient(135deg, ${status.color}, ${status.color}80)`,
              fontSize: "0.75rem",
              boxShadow: `0 2px 8px ${status.color}40`,
            }}
          >
            {lead.firstName.charAt(0)}
          </div>
          <div className="min-w-0">
            <div
              className="font-semibold truncate"
              style={{ fontSize: "0.875rem", color: "oklch(0.88 0.008 240)", letterSpacing: "-0.01em" }}
            >
              {lead.firstName} {lead.lastName}
            </div>
            {lead.email && (
              <div
                className="truncate"
                style={{ fontSize: "0.6875rem", color: "oklch(0.52 0.012 250)", marginTop: "1px" }}
              >
                {lead.email}
              </div>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{
                width: "28px",
                height: "28px",
                background: "transparent",
                color: "oklch(0.50 0.012 250)",
                transition: "all 0.15s ease",
                cursor: "pointer",
                border: "1px solid transparent",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.08)";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.88 0.008 240)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.10)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.50 0.012 250)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
              }}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            style={{
              background: "oklch(0.175 0.016 255)",
              border: "1px solid oklch(1 0 0 / 0.08)",
              boxShadow: "0 16px 48px oklch(0 0 0 / 0.5)",
            }}
          >
            <DropdownMenuItem
              style={{ color: "oklch(0.75 0.015 250)", cursor: "pointer", fontSize: "0.8125rem" }}
              onClick={() => window.location.href = `/leads/${lead.id}`}
            >
              Detayları Gör
            </DropdownMenuItem>
            <DropdownMenuItem
              style={{ color: "oklch(0.75 0.015 250)", cursor: "pointer", fontSize: "0.8125rem" }}
            >
              Düzenle
            </DropdownMenuItem>
            <DropdownMenuItem
              style={{ color: "oklch(0.65 0.22 22)", cursor: "pointer", fontSize: "0.8125rem" }}
            >
              Sil
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Details */}
      {(lead.projectName || lead.city || lead.source) && (
        <div
          className="rounded-lg mb-2.5"
          style={{
            padding: "0.5rem 0.625rem",
            background: "oklch(1 0 0 / 0.04)",
            border: "1px solid oklch(1 0 0 / 0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          {lead.projectName && (
            <div style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.012 250)" }}>
              <span style={{ color: "oklch(0.45 0.012 250)" }}>Proje: </span>
              {lead.projectName}
            </div>
          )}
          {lead.city && (
            <div style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.012 250)" }}>
              <span style={{ color: "oklch(0.45 0.012 250)" }}>Şehir: </span>
              {lead.city}
            </div>
          )}
          {lead.source && (
            <div style={{ fontSize: "0.6875rem", color: "oklch(0.55 0.012 250)" }}>
              <span style={{ color: "oklch(0.45 0.012 250)" }}>Kaynak: </span>
              {lead.source}
            </div>
          )}
        </div>
      )}

      {/* Priority Badge */}
      {priority && (
        <div className="mb-2.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{
              background: priority.bg,
              color: priority.color,
              fontSize: "0.6875rem",
              fontWeight: 600,
              letterSpacing: "0.03em",
              border: `1px solid ${priority.color}30`,
            }}
          >
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: priority.dot,
                flexShrink: 0,
              }}
            />
            {priority.label}
          </span>
        </div>
      )}

      {/* Quick Actions */}
      <div
        className="flex items-center gap-1 pt-2.5"
        style={{ borderTop: "1px solid oklch(1 0 0 / 0.06)" }}
      >
        {[
          { icon: Phone, label: "Ara", color: "oklch(0.60 0.18 145)" },
          { icon: MessageCircle, label: "WhatsApp", color: "oklch(0.60 0.18 145)" },
          { icon: Mail, label: "E-posta", color: "oklch(0.55 0.18 255)" },
          { icon: Calendar, label: "Randevu", color: "oklch(0.65 0.18 85)" },
        ].map(({ icon: Icon, label, color }) => (
          <button
            key={label}
            title={label}
            className="flex items-center justify-center rounded-lg"
            style={{
              width: "30px",
              height: "30px",
              background: "oklch(1 0 0 / 0.04)",
              border: "1px solid oklch(1 0 0 / 0.06)",
              color: "oklch(0.48 0.012 250)",
              transition: "all 0.15s ease",
              cursor: "pointer",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = `${color}15`;
              (e.currentTarget as HTMLButtonElement).style.color = color;
              (e.currentTarget as HTMLButtonElement).style.borderColor = `${color}40`;
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "oklch(1 0 0 / 0.04)";
              (e.currentTarget as HTMLButtonElement).style.color = "oklch(0.48 0.012 250)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "oklch(1 0 0 / 0.06)";
              (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
            }}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}

        {/* Date */}
        <span
          className="ml-auto"
          style={{ fontSize: "0.625rem", color: "oklch(0.42 0.010 250)", letterSpacing: "0.02em" }}
        >
          {new Date(lead.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })}
        </span>
      </div>
    </div>
  );
}