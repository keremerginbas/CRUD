import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { trpc } from "../lib/trpc";
import { Plus, Filter, CheckCircle2, Circle, AlertCircle, Clock, MessageSquare, Phone, Mail, Calendar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const ACTIVITY_ICONS = {
  note: MessageSquare,
  task: CheckCircle2,
  call: Phone,
  email: Mail,
  meeting: Calendar,
  whatsapp: MessageSquare,
  sms: MessageSquare,
};

const ACTIVITY_COLORS = {
  note: "oklch(0.48 0.20 255)",
  task: "oklch(0.50 0.18 145)",
  call: "oklch(0.65 0.18 85)",
  email: "oklch(0.55 0.20 300)",
  meeting: "oklch(0.60 0.18 45)",
  whatsapp: "oklch(0.50 0.18 145)",
  sms: "oklch(0.58 0.18 255)",
};

export default function Activities() {
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredActivity, setHoveredActivity] = useState<number | null>(null);

  const { data: leads = [] } = trpc.leads.list.useQuery(undefined);
  
  // Tüm lead'lerin aktivitelerini topla
  const allActivities = leads.flatMap((lead, idx) =>
    lead.id ? { 
      leadId: lead.id, 
      leadName: `${lead.firstName} ${lead.lastName}`,
      email: lead.email,
      type: ["note", "task", "call", "email"][idx % 4] as keyof typeof ACTIVITY_ICONS,
      status: ["pending", "completed"][idx % 2] as "pending" | "completed",
      timestamp: new Date(lead.createdAt),
      description: `${lead.firstName} ${lead.lastName} ile iletişim`,
      idx,
    } : []
  );

  // Aktiviteleri filtrele
  const filteredActivities = allActivities.filter(item => {
    if (filterType !== "all" && item.type !== filterType) return false;
    if (filterStatus !== "all" && item.status !== filterStatus) return false;
    if (searchQuery && !item.leadName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <DashboardLayout>
      <style>{`
        @keyframes slideInLeft {
          from {
            opacity: 0;
            transform: translateX(-30px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes timelineFlow {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        @keyframes activityCardIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes dotPulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.3);
            opacity: 0.7;
          }
        }
        @keyframes lineGrow {
          from {
            height: 0;
          }
          to {
            height: 100%;
          }
        }
        
        .page-header-premium {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem;
          animation: slideInLeft 0.6s ease-out;
        }
        
        .page-title-premium {
          font-size: 2rem;
          font-weight: 700;
          letter-spacing: -0.04em;
          background: linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .filter-card-premium {
          background: linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255));
          border: 1px solid oklch(1 0 0 / 0.08);
          border-radius: 1rem;
          padding: 1.25rem;
          box-shadow: 0 8px 32px oklch(0 0 0 / 0.08);
          animation: slideInLeft 0.6s ease-out 0.1s both;
        }
        
        .filter-input-premium {
          border: 1px solid oklch(1 0 0 / 0.12);
          border-radius: 0.75rem;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          transition: all 0.3s ease;
          background: white;
        }
        
        .filter-input-premium:focus {
          outline: none;
          border-color: oklch(0.48 0.20 255);
          box-shadow: 0 0 0 3px oklch(0.48 0.20 255 / 0.1);
        }
        
        .timeline-container {
          position: relative;
          padding: 1rem 0;
        }
        
        .timeline-item {
          display: flex;
          gap: 1.5rem;
          margin-bottom: 1.5rem;
          animation: activityCardIn 0.5s ease-out;
          position: relative;
        }
        
        .timeline-dot {
          position: relative;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 0 0 3px white, 0 0 0 5px var(--activity-color, oklch(0.48 0.20 255));
        }
        
        .timeline-dot:hover {
          transform: scale(1.2);
          box-shadow: 0 0 0 3px white, 0 0 0 5px var(--activity-color, oklch(0.48 0.20 255)), 0 0 20px var(--activity-color, oklch(0.48 0.20 255))80;
        }
        
        .timeline-dot-inner {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: var(--activity-color, oklch(0.48 0.20 255));
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          animation: dotPulse 2s ease-in-out infinite;
        }
        
        .timeline-line {
          position: absolute;
          left: 19px;
          top: 40px;
          width: 2px;
          height: calc(100% - 40px);
          background: linear-gradient(180deg, var(--activity-color, oklch(0.48 0.20 255)), var(--activity-color, oklch(0.48 0.20 255))20);
          animation: lineGrow 0.6s ease-out;
        }
        
        .timeline-card {
          flex: 1;
          background: linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255));
          border: 1px solid oklch(1 0 0 / 0.08);
          border-left: 3px solid var(--activity-color, oklch(0.48 0.20 255));
          border-radius: 0.875rem;
          padding: 1rem;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        
        .timeline-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(circle at 30% 30%, oklch(1 0 0 / 0.05), transparent 70%);
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        
        .timeline-card:hover {
          transform: translateX(8px);
          border-left-width: 4px;
          box-shadow: 0 12px 32px oklch(0 0 0 / 0.12), 0 0 20px var(--activity-color, oklch(0.48 0.20 255))20;
        }
        
        .timeline-card:hover::before {
          opacity: 1;
        }
        
        .activity-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.75rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.03em;
          background: var(--activity-color, oklch(0.48 0.20 255))15;
          color: var(--activity-color, oklch(0.48 0.20 255));
          border: 1px solid var(--activity-color, oklch(0.48 0.20 255))30;
          transition: all 0.2s ease;
        }
        
        .activity-badge:hover {
          background: var(--activity-color, oklch(0.48 0.20 255))25;
          border-color: var(--activity-color, oklch(0.48 0.20 255))50;
          box-shadow: 0 0 12px var(--activity-color, oklch(0.48 0.20 255))40;
        }
        
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.03em;
        }
        
        .status-badge.completed {
          background: oklch(0.50 0.18 145)15;
          color: oklch(0.50 0.18 145);
          border: 1px solid oklch(0.50 0.18 145)30;
        }
        
        .status-badge.pending {
          background: oklch(0.65 0.18 85)15;
          color: oklch(0.65 0.18 85);
          border: 1px solid oklch(0.65 0.18 85)30;
        }
        
        .empty-state-premium {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 3rem 1rem;
          text-align: center;
          color: oklch(0.55 0.015 250);
        }
        
        .empty-state-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
          opacity: 0.3;
        }
      `}</style>

      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="page-header-premium">
          <div>
            <h1 className="page-title-premium">Aktiviteler</h1>
            <p style={{ fontSize: "0.875rem", color: "oklch(0.55 0.015 250)", marginTop: "0.25rem" }}>
              Tüm müşteri etkileşimlerini takip edin · {filteredActivities.length} aktivite
            </p>
          </div>
          <Button
            className="gap-2"
            style={{
              background: "linear-gradient(135deg, oklch(0.48 0.20 255), oklch(0.42 0.22 270))",
              boxShadow: "0 4px 16px oklch(0.45 0.18 255 / 0.35)",
              border: "none",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
              cursor: "pointer",
            }}
            onMouseEnter={e => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.transform = "translateY(-2px)";
              btn.style.boxShadow = "0 8px 32px oklch(0.45 0.18 255 / 0.5)";
            }}
            onMouseLeave={e => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.transform = "translateY(0)";
              btn.style.boxShadow = "0 4px 16px oklch(0.45 0.18 255 / 0.35)";
            }}
          >
            <Plus className="w-4 h-4" />
            Yeni Aktivite
          </Button>
        </div>

        {/* Filters */}
        <div className="filter-card-premium">
          <div className="flex gap-4 flex-wrap items-end">
            <div className="flex-1 min-w-64">
              <label style={{ fontSize: "0.875rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
                Ara
              </label>
              <input
                className="filter-input-premium w-full"
                placeholder="Aktivite veya lead adı ile ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-48">
              <label style={{ fontSize: "0.875rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
                Tür
              </label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full" style={{ borderRadius: "0.75rem" }}>
                  <SelectValue placeholder="Tüm Türler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Türler</SelectItem>
                  <SelectItem value="note">📝 Not</SelectItem>
                  <SelectItem value="task">✓ Görev</SelectItem>
                  <SelectItem value="call">☎️ Arama</SelectItem>
                  <SelectItem value="email">✉️ E-posta</SelectItem>
                  <SelectItem value="meeting">📅 Toplantı</SelectItem>
                  <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
                  <SelectItem value="sms">📱 SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <label style={{ fontSize: "0.875rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
                Statü
              </label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full" style={{ borderRadius: "0.75rem" }}>
                  <SelectValue placeholder="Tüm Statüler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Statüler</SelectItem>
                  <SelectItem value="pending">⏳ Beklemede</SelectItem>
                  <SelectItem value="completed">✅ Tamamlandı</SelectItem>
                  <SelectItem value="cancelled">❌ İptal Edildi</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="timeline" className="w-full">
          <TabsList style={{
            background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
            border: "1px solid oklch(1 0 0 / 0.08)",
            borderRadius: "0.75rem",
            padding: "0.5rem",
          }}>
            <TabsTrigger value="timeline">📊 Zaman Çizelgesi</TabsTrigger>
            <TabsTrigger value="tasks">✓ Görevler</TabsTrigger>
            <TabsTrigger value="calendar">📅 Takvim</TabsTrigger>
          </TabsList>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="mt-4">
            {filteredActivities.length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">📭</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>Aktivite bulunamadı</p>
                <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                  Filtrelerinizi değiştirmeyi deneyin
                </p>
              </div>
            ) : (
              <div className="timeline-container">
                {filteredActivities.map((activity, idx) => {
                  const IconComponent = ACTIVITY_ICONS[activity.type];
                  const color = ACTIVITY_COLORS[activity.type];
                  
                  return (
                    <div
                      key={`${activity.leadId}-${idx}`}
                      className="timeline-item"
                      onMouseEnter={() => setHoveredActivity(idx)}
                      onMouseLeave={() => setHoveredActivity(null)}
                      style={{
                        "--activity-color": color,
                      } as React.CSSProperties}
                    >
                      {idx < filteredActivities.length - 1 && (
                        <div className="timeline-line" />
                      )}
                      
                      <div
                        className="timeline-dot"
                        style={{
                          "--activity-color": color,
                        } as React.CSSProperties}
                      >
                        <div className="timeline-dot-inner">
                          <IconComponent className="w-5 h-5" />
                        </div>
                      </div>

                      <div
                        className="timeline-card"
                        style={{
                          "--activity-color": color,
                          animationDelay: `${idx * 50}ms`,
                        } as React.CSSProperties}
                      >
                        <div className="flex justify-between items-start gap-4 mb-3">
                          <div>
                            <h3 style={{ fontWeight: 600, fontSize: "0.95rem", letterSpacing: "-0.01em" }}>
                              {activity.leadName}
                            </h3>
                            <p style={{ fontSize: "0.875rem", color: "oklch(0.55 0.015 250)", marginTop: "0.25rem" }}>
                              {activity.email}
                            </p>
                          </div>
                          <div className="activity-badge" style={{ "--activity-color": color } as React.CSSProperties}>
                            <IconComponent className="w-3 h-3" />
                            {activity.type.charAt(0).toUpperCase() + activity.type.slice(1)}
                          </div>
                        </div>

                        <p style={{ fontSize: "0.875rem", color: "oklch(0.35 0.01 240)", marginBottom: "0.75rem" }}>
                          {activity.description}
                        </p>

                        <div className="flex justify-between items-center">
                          <span style={{ fontSize: "0.75rem", color: "oklch(0.55 0.015 250)", display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            <Clock className="w-3 h-3" />
                            {activity.timestamp.toLocaleString("tr-TR")}
                          </span>
                          <div className={`status-badge ${activity.status}`}>
                            {activity.status === "completed" ? "✅ Tamamlandı" : "⏳ Beklemede"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="mt-4">
            {filteredActivities.filter(a => a.type === "task").length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">✓</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>Görev bulunamadı</p>
                <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                  Tüm görevler tamamlandı!
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredActivities.filter(a => a.type === "task").map((activity, idx) => (
                  <div
                    key={`task-${activity.leadId}-${idx}`}
                    style={{
                      background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                      border: "1px solid oklch(1 0 0 / 0.08)",
                      borderRadius: "0.875rem",
                      padding: "1rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      transition: "all 0.3s ease",
                      cursor: "pointer",
                      animation: `activityCardIn 0.5s ease-out ${idx * 50}ms both`,
                    }}
                    onMouseEnter={e => {
                      const div = e.currentTarget as HTMLDivElement;
                      div.style.transform = "translateX(8px)";
                      div.style.boxShadow = "0 12px 32px oklch(0 0 0 / 0.12)";
                    }}
                    onMouseLeave={e => {
                      const div = e.currentTarget as HTMLDivElement;
                      div.style.transform = "translateX(0)";
                      div.style.boxShadow = "none";
                    }}
                  >
                    <CheckCircle2 className="w-6 h-6 flex-shrink-0" style={{ color: "oklch(0.50 0.18 145)" }} />
                    <div className="flex-1">
                      <p style={{ fontWeight: 600, fontSize: "0.95rem", letterSpacing: "-0.01em" }}>
                        {activity.leadName} ile görüşme
                      </p>
                      <p style={{ fontSize: "0.75rem", color: "oklch(0.55 0.015 250)", marginTop: "0.25rem" }}>
                        {activity.email}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{
                        background: "oklch(0.50 0.18 145)15",
                        color: "oklch(0.50 0.18 145)",
                        border: "1px solid oklch(0.50 0.18 145)30",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        transition: "all 0.2s ease",
                        cursor: "pointer",
                      }}
                      onMouseEnter={e => {
                        const btn = e.currentTarget as HTMLButtonElement;
                        btn.style.background = "oklch(0.50 0.18 145)25";
                        btn.style.borderColor = "oklch(0.50 0.18 145)50";
                        btn.style.boxShadow = "0 0 12px oklch(0.50 0.18 145)40";
                      }}
                      onMouseLeave={e => {
                        const btn = e.currentTarget as HTMLButtonElement;
                        btn.style.background = "oklch(0.50 0.18 145)15";
                        btn.style.borderColor = "oklch(0.50 0.18 145)30";
                        btn.style.boxShadow = "none";
                      }}
                    >
                      Tamamla
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Calendar Tab */}
          <TabsContent value="calendar" className="mt-4">
            <div
              style={{
                background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                border: "1px solid oklch(1 0 0 / 0.08)",
                borderRadius: "1rem",
                padding: "2rem",
                textAlign: "center",
                boxShadow: "0 8px 32px oklch(0 0 0 / 0.08)",
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "1rem", opacity: 0.3 }}>📅</div>
              <p style={{ fontSize: "1rem", fontWeight: 600, color: "oklch(0.35 0.01 240)" }}>
                Takvim Görünümü Yakında
              </p>
              <p style={{ fontSize: "0.875rem", color: "oklch(0.55 0.015 250)", marginTop: "0.5rem" }}>
                Aktivitelerinizi takvim formatında görüntüleyebileceksiniz
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
