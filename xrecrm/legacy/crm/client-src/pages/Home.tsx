import { useAuth } from "../_core/hooks/useAuth";
import DashboardLayout from "../components/DashboardLayout";
import { Button } from "../components/ui/button";
import { trpc } from "../lib/trpc";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, Tooltip,
} from "recharts";
import {
  Users, Plus, ArrowUpRight, ArrowDownRight, Clock, Flame,
  ChevronRight, Trophy, MapPin, CalendarClock, Phone,
} from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

/* ----------------------------------------------------------------
   GayrimenkulCRM — Gösterge Paneli (gerçek verilere bağlı)
   Veri kaynakları: trpc.leads.list, trpc.statuses.list, trpc.users.list
-----------------------------------------------------------------*/

const GRADS = [
  ["#2f6bff", "#5b8bff"], ["#7c5cff", "#a855f7"], ["#10b981", "#34d399"],
  ["#f59e0b", "#fbbf24"], ["#06b6d4", "#22d3ee"], ["#f43f6e", "#fb7185"],
];
const SOURCE_COLORS = ["#2f6bff", "#7c5cff", "#10b981", "#f59e0b", "#06b6d4", "#f43f6e", "#8a93a8"];

function hashIdx(s: string, mod: number) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}
function trMonth(d: Date) {
  return d.toLocaleDateString("tr-TR", { month: "short" });
}
function fmtFollowUp(d: Date) {
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, now)) return { day: "Bugün", time };
  if (sameDay(d, tomorrow)) return { day: "Yarın", time };
  return { day: d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }), time };
}

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const { data: statuses = [], isLoading: sLoad } = trpc.statuses.list.useQuery(undefined);
  const { data: leads = [], isLoading: lLoad } = trpc.leads.list.useQuery(undefined);
  const { data: users = [] } = trpc.users.list.useQuery(undefined);

  const loading = sLoad || lLoad;

  /* ---------------- türetilmiş metrikler ---------------- */
  const m = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 6);

    const list = leads as any[];
    const total = list.length;

    const inRange = (d: any, from: Date, to?: Date) => {
      const t = new Date(d).getTime();
      return t >= from.getTime() && (!to || t < to.getTime());
    };
    const thisMonth = list.filter((l) => inRange(l.createdAt, startOfMonth)).length;
    const lastMonth = list.filter((l) => inRange(l.createdAt, startOfLastMonth, startOfMonth)).length;
    const thisWeek = list.filter((l) => inRange(l.createdAt, startOfWeek)).length;
    const monthDelta = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : (thisMonth > 0 ? 100 : 0);

    const highPriority = list.filter((l) => l.priority === "high" || l.priority === "urgent").length;

    const followUps = list
      .filter((l) => l.nextFollowUpDate)
      .map((l) => ({ ...l, _d: new Date(l.nextFollowUpDate) }))
      .sort((a, b) => a._d.getTime() - b._d.getTime());
    const overdue = followUps.filter((l) => l._d.getTime() < now.getTime()).length;
    const upcoming = followUps.filter((l) => l._d.getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());

    // pipeline: statü başına sayım
    const byStatus = (statuses as any[])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => ({
        id: s.id,
        name: s.displayName || s.name,
        color: s.color || "#2f6bff",
        count: list.filter((l) => l.statusId === s.id).length,
      }));
    const maxStatus = Math.max(1, ...byStatus.map((s) => s.count));

    // kaynak dağılımı
    const srcMap = new Map<string, number>();
    list.forEach((l) => {
      const k = (l.source && String(l.source).trim()) || "Bilinmiyor";
      srcMap.set(k, (srcMap.get(k) || 0) + 1);
    });
    const sources = Array.from(srcMap.entries())
      .map(([name, count]) => ({ name, count, pct: total ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // temsilci sıralaması
    const userMap = new Map<number, any>();
    (users as any[]).forEach((u) => userMap.set(u.id, u));
    const agentMap = new Map<number, number>();
    list.forEach((l) => {
      if (l.assignedToId != null) agentMap.set(l.assignedToId, (agentMap.get(l.assignedToId) || 0) + 1);
    });
    const agents = Array.from(agentMap.entries())
      .map(([id, count]) => ({ id, count, name: userMap.get(id)?.name || `Kullanıcı #${id}` }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    // son 8 ay trendi
    const trend: { label: string; value: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      trend.push({ label: trMonth(from), value: list.filter((l) => inRange(l.createdAt, from, to)).length });
    }

    // son adaylar
    const recent = list
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);

    const statusById = new Map<number, any>();
    (statuses as any[]).forEach((s) => statusById.set(s.id, s));

    return {
      total, thisMonth, lastMonth, thisWeek, monthDelta, highPriority,
      overdue, upcoming, byStatus, maxStatus, sources, agents, trend, recent, statusById,
    };
  }, [leads, statuses, users]);

  /* ---------------- giriş yapılmamış ekranı ---------------- */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "radial-gradient(900px 500px at 20% -10%, #2f6bff18, transparent 55%), radial-gradient(800px 500px at 100% 10%, #7c5cff14, transparent 50%), linear-gradient(160deg,#eef2f9,#e6ecf6)" }}>
        <div className="text-center p-12 rounded-3xl"
          style={{ background: "#fff", border: "1px solid #e7ebf2", boxShadow: "0 24px 80px rgba(16,24,40,.12)", maxWidth: 420, width: "100%" }}>
          <img src="/logo.png" alt="X Real Estate Beştepe"
            style={{ height: "84px", width: "auto", objectFit: "contain", margin: "0 auto 1.5rem", display: "block" }} />
          <p style={{ color: "#475069", marginBottom: "2rem", fontSize: "1.05rem", fontWeight: 500 }}>Müşteri & Süreç Yönetim Sistemi</p>
          <Button size="lg" onClick={() => (window.location.href = "/api/dev-login")} className="w-full"
            style={{ background: "linear-gradient(135deg,#2f6bff,#1f55e0)", border: "none", fontWeight: 600 }}>
            Giriş Yap
          </Button>
        </div>
      </div>
    );
  }

  const firstName = (user?.name || "").split(" ")[0] || "Hoş geldin";

  return (
    <DashboardLayout>
      <style>{CSS}</style>
      <div className="gc-dash">
        {/* başlık */}
        <div className="gc-head">
          <div>
            <div className="gc-crumb">Ana Sayfa / Gösterge Paneli</div>
            <h1>İyi günler, {firstName} 👋</h1>
            <p>
              {loading ? "Veriler yükleniyor…" : (
                <>Takip bekleyen <b>{m.upcoming.length}</b> adayın
                {m.overdue > 0 && <> · <b style={{ color: "#f43f6e" }}>{m.overdue} gecikmiş</b></>} var.</>
              )}
            </p>
          </div>
          <Button className="gc-cta" onClick={() => navigate("/leads")}>
            <Plus size={18} strokeWidth={2.4} /> Yeni Müşteri Adayı
          </Button>
        </div>

        {/* KPI */}
        <section className="gc-kpis">
          <Kpi icon={<Users size={24} />} cls="blue" label="Toplam Müşteri Adayı"
            value={m.total} delta={`${m.thisWeek} bu hafta`} dir="flat" trend={m.trend} color="#2f6bff" loading={loading} />
          <Kpi icon={<CalendarClock size={24} />} cls="emerald" label="Bu Ay Yeni Aday"
            value={m.thisMonth} delta={`%${Math.abs(m.monthDelta)}`} dir={m.monthDelta >= 0 ? "up" : "down"} trend={m.trend} color="#10b981" loading={loading} />
          <Kpi icon={<Clock size={24} />} cls="amber" label="Takip Bekleyen"
            value={m.upcoming.length} delta={m.overdue > 0 ? `${m.overdue} gecikmiş` : "güncel"} dir={m.overdue > 0 ? "down" : "up"} trend={m.trend} color="#f59e0b" loading={loading} />
          <Kpi icon={<Flame size={24} />} cls="violet" label="Yüksek Öncelikli"
            value={m.highPriority} delta={m.total ? `toplam %${Math.round((m.highPriority / m.total) * 100)}` : "—"} dir="flat" trend={m.trend} color="#7c5cff" loading={loading} />
        </section>

        {/* trend + pipeline */}
        <section className="gc-grid-2">
          <div className="gc-card">
            <div className="gc-card-head">
              <div><h3>Müşteri Adayı Akışı</h3><div className="gc-sub">Son 8 ay · eklenen adaylar</div></div>
              <a className="gc-link" onClick={() => navigate("/reports")}>Raporlar <ChevronRight size={15} /></a>
            </div>
            <div style={{ padding: "8px 14px 18px", height: 248 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={m.trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gcArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2f6bff" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#2f6bff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#8a93a8", fontSize: 12 }} dy={6} />
                  <Tooltip cursor={{ stroke: "#cdd8ec" }} contentStyle={{ borderRadius: 12, border: "1px solid #e7ebf2", fontSize: 13, boxShadow: "0 12px 32px -12px rgba(16,24,40,.25)" }}
                    labelStyle={{ color: "#475069", fontWeight: 600 }} formatter={(v: any) => [`${v} aday`, ""]} />
                  <Area type="monotone" dataKey="value" stroke="#2f6bff" strokeWidth={3.5} fill="url(#gcArea)" dot={false}
                    activeDot={{ r: 5, fill: "#2f6bff", stroke: "#fff", strokeWidth: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="gc-cstats">
              <div className="s"><b>{m.total}</b><span>Toplam aday</span></div>
              <div className="s"><b>{m.thisMonth}</b><span>Bu ay</span></div>
              <div className="s"><b>{m.statusById.size}</b><span>Pipeline aşaması</span></div>
            </div>
          </div>

          <div className="gc-card">
            <div className="gc-card-head">
              <div><h3>Satış Hattı</h3><div className="gc-sub">{m.total} aktif aday</div></div>
              <a className="gc-link" onClick={() => navigate("/kanban")}>Kanban <ChevronRight size={15} /></a>
            </div>
            <div className="gc-pipe">
              {m.byStatus.length === 0 && !loading && <div className="gc-empty-sm">Henüz statü tanımlı değil.</div>}
              {m.byStatus.map((s) => (
                <div key={s.id} className="gc-pipe-row">
                  <div className="gc-ptop">
                    <b>{s.name}</b><span className="amt">{s.count} <em>aday</em></span>
                  </div>
                  <div className="gc-bar">
                    <i style={{ width: `${Math.round((s.count / m.maxStatus) * 100)}%`, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* son adaylar + yaklaşan takipler */}
        <section className="gc-grid-3">
          <div className="gc-card">
            <div className="gc-card-head">
              <div><h3>Son Müşteri Adayları</h3></div>
              <a className="gc-link" onClick={() => navigate("/leads")}>Tümünü gör <ChevronRight size={15} /></a>
            </div>
            <div style={{ padding: "6px 22px 10px" }}>
              <table className="gc-table">
                <thead><tr><th>Müşteri</th><th>İlgi / Şehir</th><th>Durum</th><th style={{ textAlign: "right" }}>Öncelik</th></tr></thead>
                <tbody>
                  {loading && [0, 1, 2, 3].map((i) => (
                    <tr key={i}><td colSpan={4}><div className="gc-skel" /></td></tr>
                  ))}
                  {!loading && m.recent.length === 0 && (
                    <tr><td colSpan={4}><div className="gc-empty">Henüz müşteri adayı yok. İlkini ekleyerek başla.</div></td></tr>
                  )}
                  {!loading && m.recent.map((l: any) => {
                    const g = GRADS[hashIdx(`${l.firstName}${l.lastName}`, GRADS.length)];
                    const st = m.statusById.get(l.statusId);
                    return (
                      <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)} style={{ cursor: "pointer" }}>
                        <td>
                          <div className="gc-lead">
                            <div className="av" style={{ background: `linear-gradient(135deg,${g[0]},${g[1]})` }}>
                              {initials(`${l.firstName} ${l.lastName}`)}
                            </div>
                            <div><b>{l.firstName} {l.lastName}</b><span>{new Date(l.createdAt).toLocaleDateString("tr-TR")}</span></div>
                          </div>
                        </td>
                        <td>{l.projectName || "—"}{l.city ? ` · ${l.city}` : ""}</td>
                        <td>
                          <span className="gc-pill" style={{ color: st?.color || "#475069", background: (st?.color || "#888") + "1A" }}>
                            <i style={{ background: st?.color || "#888" }} />{st?.displayName || st?.name || "—"}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}><PriorityTag p={l.priority} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="gc-card">
            <div className="gc-card-head">
              <div><h3>Yaklaşan Takipler</h3><div className="gc-sub">{m.upcoming.length} planlı</div></div>
            </div>
            <div className="gc-sched">
              {!loading && m.upcoming.length === 0 && <div className="gc-empty">Planlı takip yok.</div>}
              {m.upcoming.slice(0, 6).map((l: any, i: number) => {
                const f = fmtFollowUp(l._d);
                const c = SOURCE_COLORS[i % SOURCE_COLORS.length];
                return (
                  <div className="gc-ev" key={l.id} onClick={() => navigate(`/leads/${l.id}`)} style={{ cursor: "pointer" }}>
                    <div className="time">{f.time}<span>{f.day}</span></div>
                    <div className="bar-v" style={{ background: c }} />
                    <div className="info">
                      <b>{l.firstName} {l.lastName}</b>
                      <p><MapPin size={13} />{l.projectName || l.city || "Takip görüşmesi"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* kaynaklar + hızlı eylemler + temsilciler */}
        <section className="gc-grid-mix">
          <div className="gc-card">
            <div className="gc-card-head"><div><h3>Lead Kaynakları</h3></div></div>
            <div className="gc-donut">
              <Donut data={m.sources} total={m.total} />
              <div className="gc-dleg">
                {m.sources.length === 0 && <div className="gc-empty-sm">Veri yok.</div>}
                {m.sources.map((s, i) => (
                  <div className="dl" key={s.name}>
                    <i style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                    {s.name} <b>%{s.pct}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="gc-card">
            <div className="gc-card-head"><div><h3>Hızlı Eylemler</h3></div></div>
            <div className="gc-qa">
              <QA color="#2f6bff" bg="#eef3ff" label="Aday Ekle" onClick={() => navigate("/leads")} icon={<Plus size={20} />} />
              <QA color="#7c5cff" bg="#f0ecff" label="Kanban" onClick={() => navigate("/kanban")} icon={<Trophy size={20} />} />
              <QA color="#10b981" bg="#e7f9f1" label="İletişim" onClick={() => navigate("/communications")} icon={<Phone size={20} />} />
              <QA color="#f59e0b" bg="#fef4e1" label="Raporlar" onClick={() => navigate("/reports")} icon={<ArrowUpRight size={20} />} />
            </div>
          </div>

          <div className="gc-card">
            <div className="gc-card-head"><div><h3>En Aktif Temsilciler</h3></div><a className="gc-link" onClick={() => navigate("/reports")}>Tümü</a></div>
            <div style={{ padding: "4px 22px 16px" }}>
              {!loading && m.agents.length === 0 && <div className="gc-empty">Atanmış aday yok.</div>}
              {m.agents.map((a, i) => {
                const g = GRADS[hashIdx(a.name, GRADS.length)];
                return (
                  <div className="gc-agent" key={a.id}>
                    <div className="rank">{i + 1}</div>
                    <div className="av" style={{ background: `linear-gradient(135deg,${g[0]},${g[1]})` }}>{initials(a.name)}</div>
                    <div className="info"><b>{a.name}</b><span>{a.count} aday atanmış</span></div>
                    <div className="val">{a.count}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

/* ---------------- alt bileşenler ---------------- */
function Kpi({ icon, cls, label, value, delta, dir, trend, color, loading }: any) {
  const path = useMemo(() => sparkPath(trend?.map((t: any) => t.value) || []), [trend]);
  return (
    <div className="gc-kpi">
      <div className="row1">
        <div className={"gc-ic " + cls}>{icon}</div>
        <div className={"gc-delta " + dir}>
          {dir === "up" && <ArrowUpRight size={14} strokeWidth={3} />}
          {dir === "down" && <ArrowDownRight size={14} strokeWidth={3} />}
          {delta}
        </div>
      </div>
      <div className="lab">{label}</div>
      <div className="val">{loading ? "…" : Number(value).toLocaleString("tr-TR")}</div>
      <svg className="gc-spark" viewBox="0 0 240 42" preserveAspectRatio="none">
        <path d={path.line} fill="none" stroke={color} strokeWidth="2.5" />
        <path d={path.fill} fill={color} opacity="0.08" />
      </svg>
    </div>
  );
}

function sparkPath(vals: number[]) {
  if (!vals.length) return { line: "", fill: "" };
  const max = Math.max(1, ...vals), min = Math.min(...vals);
  const range = max - min || 1;
  const step = 240 / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => [i * step, 38 - ((v - min) / range) * 30]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(0)},${p[1].toFixed(0)}`).join(" ");
  const fill = line + ` L240,42 L0,42 Z`;
  return { line, fill };
}

function PriorityTag({ p }: { p: string }) {
  const map: Record<string, [string, string, string]> = {
    urgent: ["Acil", "#f43f6e", "#ffeaf0"],
    high: ["Yüksek", "#f59e0b", "#fef4e1"],
    medium: ["Orta", "#2f6bff", "#eef3ff"],
    low: ["Düşük", "#8a93a8", "#eef1f6"],
  };
  const [t, c, b] = map[p] || map.medium;
  return <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20, color: c, background: b }}>{t}</span>;
}

function QA({ color, bg, label, icon, onClick }: any) {
  return (
    <button className="gc-qabtn" onClick={onClick}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = color)}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = "#e7ebf2")}>
      <span className="i" style={{ background: bg, color }}>{icon}</span>
      <b>{label}</b>
    </button>
  );
}

function Donut({ data, total }: { data: any[]; total: number }) {
  const C = 2 * Math.PI * 15.9;
  let acc = 0;
  return (
    <svg width="128" height="128" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="15.9" fill="none" stroke="#eef1f6" strokeWidth="6" />
      {data.map((s, i) => {
        const frac = total ? s.count / total : 0;
        const dash = frac * C;
        const off = -acc * C + C * 0.25;
        acc += frac;
        return (
          <circle key={s.name} cx="21" cy="21" r="15.9" fill="none"
            stroke={SOURCE_COLORS[i % SOURCE_COLORS.length]} strokeWidth="6"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={off} strokeLinecap="butt" />
        );
      })}
      <text x="21" y="20" textAnchor="middle" fontSize="7" fontWeight="800" fill="#0f1729">{total}</text>
      <text x="21" y="26" textAnchor="middle" fontSize="3.2" fill="#8a93a8" fontWeight="600">TOPLAM</text>
    </svg>
  );
}

/* ---------------- stiller ---------------- */
const CSS = `
.gc-dash{--ink:#0f1729;--ink2:#475069;--ink3:#8a93a8;--line:#e7ebf2;--line2:#eef1f6;--surf2:#f7f9fc;
  font-family:"Hanken Grotesk",system-ui,sans-serif;color:var(--ink);letter-spacing:-.01em;
  display:flex;flex-direction:column;gap:22px;max-width:1480px}
.gc-dash h1,.gc-dash h3{margin:0}
.gc-dash button{font-family:inherit}
.gc-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.gc-crumb{font-size:13px;color:var(--ink3);font-weight:500;margin-bottom:6px}
.gc-head h1{font-size:26px;font-weight:800;letter-spacing:-.03em}
.gc-head p{color:var(--ink2);font-size:14.5px;margin-top:4px}
.gc-cta{height:42px;padding:0 18px;border-radius:12px;background:#2f6bff !important;color:#fff !important;font-weight:600;
  display:flex;align-items:center;gap:8px;box-shadow:0 8px 18px -8px rgba(47,107,255,.7);border:none}
.gc-cta:hover{background:#1f55e0 !important}

.gc-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.gc-kpi{background:#fff;border:1px solid var(--line);border-radius:14px;padding:20px;position:relative;overflow:hidden;
  box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.16);transition:.2s}
.gc-kpi:hover{transform:translateY(-3px);box-shadow:0 24px 60px -24px rgba(16,24,40,.3)}
.gc-kpi .row1{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.gc-ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center}
.gc-ic.blue{background:#eef3ff;color:#2f6bff}.gc-ic.emerald{background:#e7f9f1;color:#10b981}
.gc-ic.amber{background:#fef4e1;color:#f59e0b}.gc-ic.violet{background:#f0ecff;color:#7c5cff}
.gc-delta{font-size:13px;font-weight:700;padding:4px 9px;border-radius:8px;display:flex;align-items:center;gap:3px}
.gc-delta.up{color:#10b981;background:#e7f9f1}.gc-delta.down{color:#f43f6e;background:#ffeaf0}.gc-delta.flat{color:#8a93a8;background:#eef1f6}
.gc-kpi .lab{font-size:13.5px;color:var(--ink2);font-weight:500}
.gc-kpi .val{font-size:30px;font-weight:800;letter-spacing:-.03em;margin-top:3px;font-variant-numeric:tabular-nums}
.gc-spark{position:absolute;right:0;bottom:0;width:100%;height:42px}

.gc-grid-2{display:grid;grid-template-columns:1.55fr 1fr;gap:18px}
.gc-grid-3{display:grid;grid-template-columns:1.7fr 1fr;gap:18px}
.gc-grid-mix{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:18px}
.gc-card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;
  box-shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px -12px rgba(16,24,40,.16);display:flex;flex-direction:column}
.gc-card-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px 12px}
.gc-card-head h3{font-size:16.5px;font-weight:700;letter-spacing:-.02em}
.gc-sub{font-size:13px;color:var(--ink3);margin-top:2px}
.gc-link{font-size:13px;font-weight:600;color:#2f6bff;display:flex;align-items:center;gap:3px;cursor:pointer}
.gc-cstats{display:flex;gap:26px;padding:0 22px 18px;border-top:1px solid var(--line2);margin-top:auto;padding-top:16px}
.gc-cstats .s b{font-size:22px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.gc-cstats .s span{font-size:12.5px;color:var(--ink3);font-weight:500;display:block}

.gc-pipe{display:flex;flex-direction:column;gap:14px;padding:6px 22px 22px}
.gc-pipe-row .gc-ptop{display:flex;align-items:center;justify-content:space-between;font-size:14px;margin-bottom:7px}
.gc-ptop b{font-weight:600}.gc-ptop .amt{font-weight:700;font-variant-numeric:tabular-nums}.gc-ptop em{font-style:normal;color:var(--ink3);font-size:12.5px;font-weight:500}
.gc-bar{height:9px;border-radius:20px;background:var(--line2);overflow:hidden}
.gc-bar i{display:block;height:100%;border-radius:20px;transition:width .9s cubic-bezier(.4,0,.2,1)}

.gc-table{width:100%;border-collapse:collapse}
.gc-table thead th{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:0 14px 12px}
.gc-table tbody td{padding:12px 14px;border-top:1px solid var(--line2);font-size:14px}
.gc-table tbody tr:hover{background:var(--surf2)}
.gc-lead{display:flex;align-items:center;gap:12px}
.gc-lead .av{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0}
.gc-lead b{font-weight:600;display:block}.gc-lead span{font-size:12.5px;color:var(--ink3)}
.gc-pill{font-size:12px;font-weight:600;padding:5px 11px;border-radius:20px;display:inline-flex;align-items:center;gap:6px}
.gc-pill i{width:6px;height:6px;border-radius:50%}

.gc-sched{padding:4px 22px 16px;display:flex;flex-direction:column}
.gc-ev{display:flex;gap:14px;padding:13px 0;border-bottom:1px solid var(--line2)}
.gc-ev:last-child{border:none}
.gc-ev .time{font-size:13px;font-weight:700;min-width:54px;font-variant-numeric:tabular-nums}
.gc-ev .time span{display:block;font-size:11px;color:var(--ink3);font-weight:600}
.gc-ev .bar-v{width:3px;border-radius:4px;flex-shrink:0}
.gc-ev .info b{font-size:14px;font-weight:600;display:block}
.gc-ev .info p{font-size:12.5px;color:var(--ink3);margin-top:2px;display:flex;align-items:center;gap:5px}

.gc-donut{display:flex;align-items:center;gap:22px;padding:6px 22px 24px}
.gc-dleg{display:flex;flex-direction:column;gap:13px;flex:1}
.gc-dleg .dl{display:flex;align-items:center;gap:10px;font-size:13.5px}
.gc-dleg .dl i{width:10px;height:10px;border-radius:3px}.gc-dleg .dl b{margin-left:auto;font-weight:700}

.gc-qa{padding:6px 22px 22px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gc-qabtn{padding:18px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surf2);
  display:flex;flex-direction:column;gap:10px;align-items:flex-start;transition:.16s;cursor:pointer}
.gc-qabtn .i{width:38px;height:38px;border-radius:11px;display:grid;place-items:center}
.gc-qabtn b{font-size:13.5px;font-weight:600}

.gc-agent{display:flex;align-items:center;gap:13px;padding:11px 0;border-bottom:1px solid var(--line2)}
.gc-agent:last-child{border:none}
.gc-agent .rank{width:22px;font-weight:800;color:var(--ink3);font-size:14px}
.gc-agent .av{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:14px}
.gc-agent .info{flex:1}.gc-agent .info b{font-size:14px;font-weight:600;display:block}.gc-agent .info span{font-size:12.5px;color:var(--ink3)}
.gc-agent .val{font-weight:800;font-variant-numeric:tabular-nums;font-size:16px}

.gc-empty{padding:24px 8px;text-align:center;color:var(--ink3);font-size:13.5px}
.gc-empty-sm{color:var(--ink3);font-size:13px}
.gc-skel{height:38px;border-radius:10px;background:linear-gradient(90deg,#eef1f6,#f7f9fc,#eef1f6);background-size:200% 100%;animation:gcsk 1.2s infinite}
@keyframes gcsk{0%{background-position:200% 0}100%{background-position:-200% 0}}

@media(max-width:1180px){.gc-kpis{grid-template-columns:repeat(2,1fr)}.gc-grid-2,.gc-grid-3,.gc-grid-mix{grid-template-columns:1fr}}
`;