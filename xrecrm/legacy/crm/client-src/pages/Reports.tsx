import DashboardLayout from "../components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { trpc } from "../lib/trpc";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { Download, Filter, TrendingUp, Users, Target, Zap } from "lucide-react";
import { useState } from "react";
import * as XLSX from "xlsx";

const CHART_COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];

export default function Reports() {
  const [hoveredStat, setHoveredStat] = useState<number | null>(null);
  const { data: leads = [] } = trpc.leads.list.useQuery(undefined);
  const { data: statuses = [] } = trpc.statuses.list.useQuery(undefined);

  // Kaynak bazlı lead analizi
  const sourceData = Object.entries(
    leads.reduce((acc: Record<string, number>, lead) => {
      const source = lead.source || "Bilinmiyor";
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  // Statü dağılımı
  const statusData = statuses.map(status => ({
    name: status.displayName,
    value: leads.filter(l => l.statusId === status.id).length,
    color: status.color,
  }));

  // Öncelik dağılımı
  const priorityData = [
    { name: "Düşük", value: leads.filter(l => l.priority === "low").length, color: "oklch(0.50 0.18 145)" },
    { name: "Orta", value: leads.filter(l => l.priority === "medium").length, color: "oklch(0.65 0.18 85)" },
    { name: "Yüksek", value: leads.filter(l => l.priority === "high").length, color: "oklch(0.60 0.18 45)" },
    { name: "Acil", value: leads.filter(l => l.priority === "urgent").length, color: "oklch(0.55 0.24 27)" },
  ];

  // Şehir bazlı lead dağılımı
  const cityData = Object.entries(
    leads.reduce((acc: Record<string, number>, lead) => {
      const city = lead.city || "Bilinmiyor";
      acc[city] = (acc[city] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value }));

  // Günlük lead ekleme trendi (son 7 gün)
  const today = new Date();
  const dailyData = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - i));
    const dateStr = date.toLocaleDateString("tr-TR");
    const count = leads.filter(l => {
      const leadDate = new Date(l.createdAt);
      return leadDate.toLocaleDateString("tr-TR") === dateStr;
    }).length;
    return { date: dateStr, leads: count };
  });

  const stats = [
    {
      label: "Toplam Leads",
      value: leads.length,
      sub: "Tüm zamanlar",
      icon: Users,
      color: "oklch(0.48 0.20 255)",
      glow: "oklch(0.45 0.18 255 / 0.25)",
    },
    {
      label: "Bu Ay Eklenen",
      value: leads.filter(l => {
        const createdDate = new Date(l.createdAt);
        const now = new Date();
        return createdDate.getMonth() === now.getMonth() && 
               createdDate.getFullYear() === now.getFullYear();
      }).length,
      sub: "Yeni müşteriler",
      icon: TrendingUp,
      color: "oklch(0.50 0.18 145)",
      glow: "oklch(0.50 0.18 145 / 0.25)",
    },
    {
      label: "Ortalama Öncelik",
      value: leads.length > 0 ? (
        leads.reduce((acc, l) => {
          const priorityMap = { low: 1, medium: 2, high: 3, urgent: 4 };
          return acc + (priorityMap[l.priority as keyof typeof priorityMap] || 0);
        }, 0) / leads.length
      ).toFixed(1) : "0",
      sub: "1-4 arası",
      icon: Target,
      color: "oklch(0.65 0.18 85)",
      glow: "oklch(0.65 0.18 85 / 0.25)",
    },
    {
      label: "Kaynak Türü",
      value: sourceData.length,
      sub: "Farklı kaynaklar",
      icon: Zap,
      color: "oklch(0.55 0.20 300)",
      glow: "oklch(0.55 0.20 300 / 0.25)",
    },
  ];
  const handleExportExcel = () => {
  const statusMap = Object.fromEntries(
    statuses.map((status) => [status.id, status.displayName])
  );

  const priorityMap: Record<string, string> = {
    low: "Düşük",
    medium: "Orta",
    high: "Yüksek",
    urgent: "Acil",
  };

  const leadRows = leads.map((lead) => ({
    "ID": lead.id,
    "Ad": lead.firstName || "",
    "Soyad": lead.lastName || "",
    "Telefon": lead.phone || "",
    "E-posta": lead.email || "",
    "Proje": lead.projectName || "",
    "Şehir": lead.city || "",
    "Kaynak": lead.source || "",
    "Statü": statusMap[lead.statusId] || "Bilinmiyor",
    "Öncelik": priorityMap[lead.priority || ""] || lead.priority || "",
    "Oluşturulma Tarihi": lead.createdAt
      ? new Date(lead.createdAt).toLocaleString("tr-TR")
      : "",
    "Güncellenme Tarihi": lead.updatedAt
      ? new Date(lead.updatedAt).toLocaleString("tr-TR")
      : "",
  }));

  const statusRows = statusData.map((item) => ({
    "Statü": item.name,
    "Lead Sayısı": item.value,
  }));

  const sourceRows = sourceData.map((item) => ({
    "Kaynak": item.name,
    "Lead Sayısı": item.value,
  }));

  const cityRows = cityData.map((item) => ({
    "Şehir": item.name,
    "Lead Sayısı": item.value,
  }));

  const priorityRows = priorityData.map((item) => ({
    "Öncelik": item.name,
    "Lead Sayısı": item.value,
  }));

  const trendRows = dailyData.map((item) => ({
    "Tarih": item.date,
    "Lead Sayısı": item.leads,
  }));

  const workbook = XLSX.utils.book_new();

  const leadsSheet = XLSX.utils.json_to_sheet(leadRows);
  const statusSheet = XLSX.utils.json_to_sheet(statusRows);
  const sourceSheet = XLSX.utils.json_to_sheet(sourceRows);
  const citySheet = XLSX.utils.json_to_sheet(cityRows);
  const prioritySheet = XLSX.utils.json_to_sheet(priorityRows);
  const trendSheet = XLSX.utils.json_to_sheet(trendRows);

  XLSX.utils.book_append_sheet(workbook, leadsSheet, "Tüm Leadler");
  XLSX.utils.book_append_sheet(workbook, statusSheet, "Statü Özeti");
  XLSX.utils.book_append_sheet(workbook, sourceSheet, "Kaynak Özeti");
  XLSX.utils.book_append_sheet(workbook, citySheet, "Şehir Özeti");
  XLSX.utils.book_append_sheet(workbook, prioritySheet, "Öncelik Özeti");
  XLSX.utils.book_append_sheet(workbook, trendSheet, "Günlük Trend");

  XLSX.writeFile(
    workbook,
    `xre-crm-rapor-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
};
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
        @keyframes statCardIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes chartCardIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes numberCount {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
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
        
        .stat-card-premium {
          background: linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255));
          border: 1px solid oklch(1 0 0 / 0.08);
          border-radius: 1rem;
          padding: 1.5rem;
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          cursor: pointer;
          animation: statCardIn 0.5s ease-out;
        }
        
        .stat-card-premium::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: radial-gradient(circle at 30% 30%, oklch(1 0 0 / 0.1), transparent 70%);
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        
        .stat-card-premium:hover {
          transform: translateY(-8px) scale(1.02);
          border-color: oklch(1 0 0 / 0.15);
          box-shadow: 0 20px 60px oklch(0 0 0 / 0.12), 0 0 40px var(--glow-color, oklch(0.48 0.20 255 / 0.15));
          background: linear-gradient(135deg, oklch(0.99 0.003 240), oklch(0.98 0.005 255));
        }
        
        .stat-card-premium:hover::before {
          opacity: 1;
        }
        
        .stat-icon {
          width: 44px;
          height: 44px;
          border-radius: 0.875rem;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--stat-color, oklch(0.48 0.20 255))15;
          border: 1px solid var(--stat-color, oklch(0.48 0.20 255))30;
          flex-shrink: 0;
          transition: all 0.3s ease;
          box-shadow: 0 0 12px var(--stat-color, oklch(0.48 0.20 255))20;
        }
        
        .stat-card-premium:hover .stat-icon {
          transform: scale(1.15) rotate(5deg);
          box-shadow: 0 0 20px var(--stat-color, oklch(0.48 0.20 255))40;
        }
        
        .stat-value {
          font-size: 2.25rem;
          font-weight: 700;
          letter-spacing: -0.04em;
          line-height: 1;
          margin-top: 0.75rem;
          animation: numberCount 0.6s ease-out;
        }
        
        .stat-label {
          font-weight: 600;
          font-size: 0.875rem;
          letter-spacing: -0.01em;
          margin-top: 0.5rem;
          color: oklch(0.35 0.01 240);
        }
        
        .stat-sub {
          font-size: 0.75rem;
          color: oklch(0.55 0.015 250);
          margin-top: 0.25rem;
        }
        
        .chart-card-premium {
          background: linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255));
          border: 1px solid oklch(1 0 0 / 0.08);
          border-radius: 1rem;
          box-shadow: 0 8px 32px oklch(0 0 0 / 0.08);
          animation: chartCardIn 0.6s ease-out;
          overflow: hidden;
        }
        
        .chart-header {
          padding: 1.5rem;
          border-bottom: 1px solid oklch(1 0 0 / 0.08);
          background: linear-gradient(90deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255));
        }
        
        .chart-title {
          font-size: 1.125rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: oklch(0.15 0.01 240);
        }
        
        .chart-container {
          padding: 1.5rem;
          height: 320px;
        }
      `}</style>

      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="page-header-premium">
          <div>
            <h1 className="page-title-premium">Raporlama</h1>
            <p style={{ fontSize: "0.875rem", color: "oklch(0.55 0.015 250)", marginTop: "0.25rem" }}>
              Detaylı analitik ve istatistikler
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              style={{
                border: "1px solid oklch(1 0 0 / 0.12)",
                borderRadius: "0.75rem",
                fontWeight: 600,
                transition: "all 0.3s ease",
                cursor: "pointer",
              }}
              onMouseEnter={e => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = "oklch(1 0 0 / 0.04)";
                btn.style.borderColor = "oklch(0.48 0.20 255)";
              }}
              onMouseLeave={e => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.background = "transparent";
                btn.style.borderColor = "oklch(1 0 0 / 0.12)";
              }}
            >
              <Filter className="w-4 h-4" />
              Filtre
            </Button>
            <Button
              className="gap-2"
              onClick={handleExportExcel}
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
              <Download className="w-4 h-4" />
              İndir
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {stats.map((stat, i) => {
            const IconComponent = stat.icon;
            return (
              <div
                key={stat.label}
                className="stat-card-premium"
                style={{
                  "--glow-color": stat.glow,
                  "--stat-color": stat.color,
                  animationDelay: `${i * 80}ms`,
                } as React.CSSProperties}
                onMouseEnter={() => setHoveredStat(i)}
                onMouseLeave={() => setHoveredStat(null)}
              >
                <div className="stat-icon" style={{ "--stat-color": stat.color } as React.CSSProperties}>
                  <IconComponent className="w-5 h-5" style={{ color: stat.color }} />
                </div>
                <div className="stat-value" style={{ color: stat.color }}>
                  {stat.value}
                </div>
                <div className="stat-label">{stat.label}</div>
                <div className="stat-sub">{stat.sub}</div>
              </div>
            );
          })}
        </div>

        {/* Charts */}
        <Tabs defaultValue="source" className="w-full">
          <TabsList style={{
            background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
            border: "1px solid oklch(1 0 0 / 0.08)",
            borderRadius: "0.75rem",
            padding: "0.5rem",
          }}>
            <TabsTrigger value="source">📊 Kaynak Analizi</TabsTrigger>
            <TabsTrigger value="status">🎯 Statü Dağılımı</TabsTrigger>
            <TabsTrigger value="priority">⚡ Öncelik</TabsTrigger>
            <TabsTrigger value="city">🗺️ Şehirler</TabsTrigger>
            <TabsTrigger value="trend">📈 Trend</TabsTrigger>
          </TabsList>

          {/* Source Tab */}
          <TabsContent value="source" className="mt-4">
            <div className="chart-card-premium">
              <div className="chart-header">
                <h3 className="chart-title">Kaynak Bazlı Lead Dağılımı</h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.08)" />
                    <XAxis dataKey="name" stroke="oklch(0.55 0.015 250)" />
                    <YAxis stroke="oklch(0.55 0.015 250)" />
                    <Tooltip
                      contentStyle={{
                        background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                        border: "1px solid oklch(1 0 0 / 0.12)",
                        borderRadius: "0.75rem",
                        boxShadow: "0 8px 24px oklch(0 0 0 / 0.12)",
                      }}
                    />
                    <Bar dataKey="value" fill="oklch(0.48 0.20 255)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          {/* Status Tab */}
          <TabsContent value="status" className="mt-4">
            <div className="chart-card-premium">
              <div className="chart-header">
                <h3 className="chart-title">Statü Dağılımı</h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                        border: "1px solid oklch(1 0 0 / 0.12)",
                        borderRadius: "0.75rem",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          {/* Priority Tab */}
          <TabsContent value="priority" className="mt-4">
            <div className="chart-card-premium">
              <div className="chart-header">
                <h3 className="chart-title">Öncelik Dağılımı</h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.08)" />
                    <XAxis dataKey="name" stroke="oklch(0.55 0.015 250)" />
                    <YAxis stroke="oklch(0.55 0.015 250)" />
                    <Tooltip
                      contentStyle={{
                        background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                        border: "1px solid oklch(1 0 0 / 0.12)",
                        borderRadius: "0.75rem",
                      }}
                    />
                    <Bar dataKey="value" fill="oklch(0.50 0.18 145)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          {/* City Tab */}
          <TabsContent value="city" className="mt-4">
            <div className="chart-card-premium">
              <div className="chart-header">
                <h3 className="chart-title">Şehir Bazlı Dağılım</h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.08)" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} stroke="oklch(0.55 0.015 250)" />
                    <YAxis stroke="oklch(0.55 0.015 250)" />
                    <Tooltip
                      contentStyle={{
                        background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                        border: "1px solid oklch(1 0 0 / 0.12)",
                        borderRadius: "0.75rem",
                      }}
                    />
                    <Bar dataKey="value" fill="oklch(0.65 0.18 85)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          {/* Trend Tab */}
          <TabsContent value="trend" className="mt-4">
            <div className="chart-card-premium">
              <div className="chart-header">
                <h3 className="chart-title">Son 7 Gün Lead Trendi</h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 0.08)" />
                    <XAxis dataKey="date" stroke="oklch(0.55 0.015 250)" />
                    <YAxis stroke="oklch(0.55 0.015 250)" />
                    <Tooltip
                      contentStyle={{
                        background: "linear-gradient(135deg, oklch(0.98 0.002 240), oklch(0.97 0.004 255))",
                        border: "1px solid oklch(1 0 0 / 0.12)",
                        borderRadius: "0.75rem",
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="leads"
                      stroke="oklch(0.48 0.20 255)"
                      strokeWidth={3}
                      dot={{ fill: "oklch(0.48 0.20 255)", r: 5 }}
                      activeDot={{ r: 7 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
