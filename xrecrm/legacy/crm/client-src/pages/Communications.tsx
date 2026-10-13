import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { trpc } from "../lib/trpc";
import { MessageSquare, Mail, Phone, MessageCircle, Plus, ExternalLink, Clock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const COMM_TYPES = {
  whatsapp: { icon: MessageCircle, color: "oklch(0.50 0.18 145)", label: "WhatsApp", emoji: "💬" },
  sms: { icon: MessageSquare, color: "oklch(0.48 0.20 255)", label: "SMS", emoji: "📱" },
  email: { icon: Mail, color: "oklch(0.55 0.20 300)", label: "E-posta", emoji: "✉️" },
  phone: { icon: Phone, color: "oklch(0.65 0.18 85)", label: "Telefon", emoji: "☎️" },
  video_call: { icon: Phone, color: "oklch(0.60 0.18 45)", label: "Video", emoji: "📹" },
};

export default function Communications() {
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);

  const { data: leads = [] } = trpc.leads.list.useQuery(undefined);

  // Simüle edilmiş iletişim verileri
  const communications = leads.flatMap((lead, idx) => {
    const types = ["whatsapp", "sms", "email", "phone"] as const;
    return {
      id: lead.id,
      leadName: `${lead.firstName} ${lead.lastName}`,
      email: lead.email,
      phone: lead.phone,
      type: types[idx % types.length],
      timestamp: new Date(lead.updatedAt),
      message: `${lead.firstName} ile son iletişim`,
      idx,
    };
  });

  const filteredComms = communications.filter(comm => {
    if (filterType !== "all" && comm.type !== filterType) return false;
    if (searchQuery && !comm.leadName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
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
        @keyframes commCardIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes badgePulse {
          0%, 100% {
            box-shadow: 0 0 0 0 var(--badge-color, oklch(0.50 0.18 145))40;
          }
          50% {
            box-shadow: 0 0 0 6px var(--badge-color, oklch(0.50 0.18 145))00;
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
        
        .comm-card {
          background: linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255));
          border: 1px solid oklch(1 0 0 / 0.08);
          border-left: 4px solid var(--comm-color, oklch(0.48 0.20 255));
          border-radius: 0.875rem;
          padding: 1.25rem;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          cursor: pointer;
          position: relative;
          overflow: hidden;
          animation: commCardIn 0.5s ease-out;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
        }
        
        .comm-card::before {
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
        
        .comm-card:hover {
          transform: translateX(8px);
          border-left-width: 5px;
          box-shadow: 0 12px 32px oklch(0 0 0 / 0.12), 0 0 20px var(--comm-color, oklch(0.48 0.20 255))20;
        }
        
        .comm-card:hover::before {
          opacity: 1;
        }
        
        .comm-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--comm-color, oklch(0.48 0.20 255))15;
          border: 2px solid var(--comm-color, oklch(0.48 0.20 255))30;
          flex-shrink: 0;
          font-size: 1.5rem;
          box-shadow: 0 0 12px var(--comm-color, oklch(0.48 0.20 255))20;
          transition: all 0.3s ease;
        }
        
        .comm-card:hover .comm-avatar {
          transform: scale(1.15);
          box-shadow: 0 0 20px var(--comm-color, oklch(0.48 0.20 255))40;
        }
        
        .comm-content {
          flex: 1;
          min-width: 0;
        }
        
        .comm-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }
        
        .comm-name {
          font-weight: 600;
          font-size: 0.95rem;
          letter-spacing: -0.01em;
          color: oklch(0.15 0.01 240);
        }
        
        .comm-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.375rem 0.75rem;
          border-radius: 0.5rem;
          font-size: 0.75rem;
          font-weight: 600;
          letter-spacing: 0.03em;
          background: var(--comm-color, oklch(0.48 0.20 255))15;
          color: var(--comm-color, oklch(0.48 0.20 255));
          border: 1px solid var(--comm-color, oklch(0.48 0.20 255))30;
          transition: all 0.2s ease;
          animation: badgePulse 2s ease-in-out infinite;
        }
        
        .comm-badge:hover {
          background: var(--comm-color, oklch(0.48 0.20 255))25;
          border-color: var(--comm-color, oklch(0.48 0.20 255))50;
        }
        
        .comm-details {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        
        .comm-info {
          font-size: 0.875rem;
          color: oklch(0.55 0.015 250);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .comm-time {
          font-size: 0.75rem;
          color: oklch(0.55 0.015 250);
          display: flex;
          align-items: center;
          gap: 0.375rem;
          margin-top: 0.25rem;
        }
        
        .comm-action {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-shrink: 0;
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
            <h1 className="page-title-premium">İletişim Geçmişi</h1>
            <p style={{ fontSize: "0.875rem", color: "oklch(0.55 0.015 250)", marginTop: "0.25rem" }}>
              Tüm müşteri iletişimlerini takip edin · {filteredComms.length} kayıt
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
            Yeni İletişim
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
                placeholder="Lead adı, e-posta veya telefon ile ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-48">
              <label style={{ fontSize: "0.875rem", fontWeight: 600, display: "block", marginBottom: "0.5rem" }}>
                İletişim Türü
              </label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full" style={{ borderRadius: "0.75rem" }}>
                  <SelectValue placeholder="Tüm Türler" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm Türler</SelectItem>
                  <SelectItem value="whatsapp">💬 WhatsApp</SelectItem>
                  <SelectItem value="sms">📱 SMS</SelectItem>
                  <SelectItem value="email">✉️ E-posta</SelectItem>
                  <SelectItem value="phone">☎️ Telefon</SelectItem>
                  <SelectItem value="video_call">📹 Video Konferans</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList style={{
            background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
            border: "1px solid oklch(1 0 0 / 0.08)",
            borderRadius: "0.75rem",
            padding: "0.5rem",
          }}>
            <TabsTrigger value="all">Tüm İletişimler</TabsTrigger>
            <TabsTrigger value="whatsapp">💬 WhatsApp</TabsTrigger>
            <TabsTrigger value="sms">📱 SMS</TabsTrigger>
            <TabsTrigger value="email">✉️ E-posta</TabsTrigger>
            <TabsTrigger value="phone">☎️ Telefon</TabsTrigger>
          </TabsList>

          {/* All Communications Tab */}
          <TabsContent value="all" className="mt-4">
            {filteredComms.length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">📭</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>İletişim kaydı bulunamadı</p>
                <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                  Filtrelerinizi değiştirmeyi deneyin
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredComms.map((comm, idx) => {
                  const commType = COMM_TYPES[comm.type as keyof typeof COMM_TYPES];
                  const IconComponent = commType.icon;
                  
                  return (
                    <div
                      key={`${comm.id}-${idx}`}
                      className="comm-card"
                      style={{
                        "--comm-color": commType.color,
                        animationDelay: `${idx * 50}ms`,
                      } as React.CSSProperties}
                      onMouseEnter={() => setHoveredCard(idx)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <div className="comm-avatar" style={{ "--comm-color": commType.color } as React.CSSProperties}>
                        {commType.emoji}
                      </div>

                      <div className="comm-content">
                        <div className="comm-header">
                          <span className="comm-name">{comm.leadName}</span>
                          <div className="comm-badge" style={{ "--comm-color": commType.color } as React.CSSProperties}>
                            <IconComponent className="w-3 h-3" />
                            {commType.label}
                          </div>
                        </div>
                        <div className="comm-details">
                          {comm.email && <div className="comm-info">{comm.email}</div>}
                          {comm.phone && <div className="comm-info">{comm.phone}</div>}
                          <div className="comm-time">
                            <Clock className="w-3 h-3" />
                            {comm.timestamp.toLocaleString("tr-TR")}
                          </div>
                        </div>
                      </div>

                      <div className="comm-action">
                        <Button
                          variant="ghost"
                          size="sm"
                          style={{
                            background: commType.color + "15",
                            color: commType.color,
                            border: `1px solid ${commType.color}30`,
                            fontWeight: 600,
                            fontSize: "0.875rem",
                            transition: "all 0.2s ease",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.375rem",
                          }}
                          onMouseEnter={e => {
                            const btn = e.currentTarget as HTMLButtonElement;
                            btn.style.background = commType.color + "25";
                            btn.style.borderColor = commType.color + "50";
                            btn.style.boxShadow = `0 0 12px ${commType.color}40`;
                          }}
                          onMouseLeave={e => {
                            const btn = e.currentTarget as HTMLButtonElement;
                            btn.style.background = commType.color + "15";
                            btn.style.borderColor = commType.color + "30";
                            btn.style.boxShadow = "none";
                          }}
                        >
                          Aç
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* WhatsApp Tab */}
          <TabsContent value="whatsapp" className="mt-4">
            {filteredComms.filter(c => c.type === "whatsapp").length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">💬</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>WhatsApp iletişimi yok</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredComms.filter(c => c.type === "whatsapp").map((comm, idx) => (
                  <div
                    key={`whatsapp-${comm.id}`}
                    className="comm-card"
                    style={{
                      "--comm-color": COMM_TYPES.whatsapp.color,
                      animationDelay: `${idx * 50}ms`,
                    } as React.CSSProperties}
                  >
                    <div className="comm-avatar" style={{ "--comm-color": COMM_TYPES.whatsapp.color } as React.CSSProperties}>
                      💬
                    </div>
                    <div className="comm-content">
                      <div className="comm-name">{comm.leadName}</div>
                      <div className="comm-info">{comm.phone}</div>
                      <div className="comm-time">
                        <Clock className="w-3 h-3" />
                        {comm.timestamp.toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" style={{ color: COMM_TYPES.whatsapp.color }}>
                      Konuşmayı Aç
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* SMS Tab */}
          <TabsContent value="sms" className="mt-4">
            {filteredComms.filter(c => c.type === "sms").length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">📱</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>SMS iletişimi yok</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredComms.filter(c => c.type === "sms").map((comm, idx) => (
                  <div
                    key={`sms-${comm.id}`}
                    className="comm-card"
                    style={{
                      "--comm-color": COMM_TYPES.sms.color,
                      animationDelay: `${idx * 50}ms`,
                    } as React.CSSProperties}
                  >
                    <div className="comm-avatar" style={{ "--comm-color": COMM_TYPES.sms.color } as React.CSSProperties}>
                      📱
                    </div>
                    <div className="comm-content">
                      <div className="comm-name">{comm.leadName}</div>
                      <div className="comm-info">{comm.phone}</div>
                      <div className="comm-time">
                        <Clock className="w-3 h-3" />
                        {comm.timestamp.toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" style={{ color: COMM_TYPES.sms.color }}>
                      SMS Gönder
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Email Tab */}
          <TabsContent value="email" className="mt-4">
            {filteredComms.filter(c => c.type === "email").length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">✉️</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>E-posta kaydı yok</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredComms.filter(c => c.type === "email").map((comm, idx) => (
                  <div
                    key={`email-${comm.id}`}
                    className="comm-card"
                    style={{
                      "--comm-color": COMM_TYPES.email.color,
                      animationDelay: `${idx * 50}ms`,
                    } as React.CSSProperties}
                  >
                    <div className="comm-avatar" style={{ "--comm-color": COMM_TYPES.email.color } as React.CSSProperties}>
                      ✉️
                    </div>
                    <div className="comm-content">
                      <div className="comm-name">{comm.leadName}</div>
                      <div className="comm-info">{comm.email}</div>
                      <div className="comm-time">
                        <Clock className="w-3 h-3" />
                        {comm.timestamp.toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" style={{ color: COMM_TYPES.email.color }}>
                      E-posta Gönder
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Phone Tab */}
          <TabsContent value="phone" className="mt-4">
            {filteredComms.filter(c => c.type === "phone").length === 0 ? (
              <div className="empty-state-premium">
                <div className="empty-state-icon">☎️</div>
                <p style={{ fontSize: "1rem", fontWeight: 600 }}>Telefon kaydı yok</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredComms.filter(c => c.type === "phone").map((comm, idx) => (
                  <div
                    key={`phone-${comm.id}`}
                    className="comm-card"
                    style={{
                      "--comm-color": COMM_TYPES.phone.color,
                      animationDelay: `${idx * 50}ms`,
                    } as React.CSSProperties}
                  >
                    <div className="comm-avatar" style={{ "--comm-color": COMM_TYPES.phone.color } as React.CSSProperties}>
                      ☎️
                    </div>
                    <div className="comm-content">
                      <div className="comm-name">{comm.leadName}</div>
                      <div className="comm-info">{comm.phone}</div>
                      <div className="comm-time">
                        <Clock className="w-3 h-3" />
                        {comm.timestamp.toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" style={{ color: COMM_TYPES.phone.color }}>
                      Ara
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
