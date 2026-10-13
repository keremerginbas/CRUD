import { getPipelineStages, baseStages } from "../suite";
import { useEffect, useMemo, useState } from "react";
import {
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Phone,
  PhoneMissed,
  MessageCircle,
  Plus,
  Check,
  Activity,
  Workflow,
  Radio,
  Download,
  Sparkles,
  AlertTriangle,
  Trophy,
  Webhook,
  Inbox,
  CheckSquare,
} from "lucide-react";
import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useStore } from "../store";
import { Lead, money, lines, groupNames, formatPhone } from "../data";
import { Avatar, Badge, PageTitle, SectionTitle, Empty } from "../components/ui";
import {
  computeDashboard,
  periodLabels,
  type Period,
} from "../dashboard-metrics";
import "../dashboard.css";

const compactMoney = (value: number) =>
  value >= 1_000_000
    ? `₺${(value / 1_000_000).toFixed(1).replace(".", ",")} M`
    : money(value);

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
const dateTimeOf = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("tr-TR", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Istanbul" }).format(new Date()),
  );
  return hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
}

type ProviderStatus = Record<string, { configured?: boolean; connected?: boolean }>;

export default function Dashboard({
  navigate,
  onLead,
  onNew,
}: {
  navigate: (p: string) => void;
  onLead: (l: Lead) => void;
  onNew: () => void;
}) {
  const { data, demo, user, request } = useStore();
  const [period, setPeriod] = useState<Period>("7d");
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [hooks, setHooks] = useState<{ inbound: number; outbound: number } | null>(null);
  const m = useMemo(() => computeDashboard(data, period), [data, period]);
  const leadById = useMemo(
    () => new Map(data.leads.map((l) => [l.id, l])),
    [data.leads],
  );

  useEffect(() => {
    if (demo || !user) {
      setStatus(null);
      setHooks(null);
      return;
    }
    request("/api/integrations/status").then(setStatus).catch(() => setStatus(null));
    request("/api/webhook-hub")
      .then((h) => setHooks({ inbound: h.inbound.length, outbound: h.outbound.length }))
      .catch(() => setHooks(null));
  }, [demo, user?.openId]);

  const k = m.kpis;
  const leadTrend = k.newLeads - k.newLeadsPrev;
  const openLead = (id?: string) => {
    const lead = id ? leadById.get(id) : undefined;
    if (lead) onLead(lead);
  };

  const download = () => {
    const rows = [
      ["Tarih", "Yeni müşteri", "Kazanılan", "Arama", "Mesaj"],
      ...m.trend.map((t) => [t.key, t.leads, t.won, t.calls, t.messages]),
      [],
      ["Danışman", "Açık", "Kazanılan", "Kazanılan değer", "Yeni", "Geciken görev", "Arama"],
      ...m.owners.map((o) => [o.owner, o.open, o.won, o.wonValue, o.newLeads, o.overdue, o.calls]),
    ];
    const blob = new Blob(["﻿" + rows.map((r) => r.join(";")).join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xre-genel-bakis-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const providerBadge = (id: string) => {
    if (demo) return <Badge tone="gray">Demo</Badge>;
    const s = status?.[id];
    if (!s) return <Badge tone="gray">Bilinmiyor</Badge>;
    if (s.connected) return <Badge tone="green">Bağlı</Badge>;
    if (s.configured) return <Badge tone="blue">Yapılandırıldı</Badge>;
    return <Badge tone="amber">Kurulum gerekli</Badge>;
  };

  const kpis = [
    {
      label: "Yeni müşteri",
      value: String(k.newLeads),
      note:
        period === "today"
          ? `Dün: ${k.newLeadsPrev}`
          : `Önceki ${periodLabels[period].toLowerCase()}: ${k.newLeadsPrev}`,
      trend: leadTrend,
      icon: Users,
      color: "green",
      to: "/kanban",
    },
    {
      label: "Açık fırsat değeri",
      value: compactMoney(k.openValue),
      note: `${k.openCount} açık fırsat`,
      icon: Activity,
      color: "blue",
      to: "/kanban",
    },
    {
      label: "Kazanılan",
      value: String(k.wonCount),
      note: `${compactMoney(k.wonValue)} · kapanışların %${k.conversion}'i`,
      icon: Trophy,
      color: "amber",
      to: "/reports",
    },
    {
      label: "Aramalar",
      value: String(k.calls),
      note: `${k.callsAnswered} cevaplanan · ${k.callsMissed} cevapsız`,
      icon: Phone,
      color: "purple",
      to: "/calls",
      alert: k.callsMissed > 0,
    },
    {
      label: "Mesajlar",
      value: String(k.messagesIn + k.messagesOut),
      note: `${k.messagesIn} gelen · ${k.messagesOut} giden`,
      icon: MessageCircle,
      color: "green",
      to: "/whatsapp",
    },
    {
      label: "Geciken görev",
      value: String(k.overdueTasks),
      note: `${k.openTasks} açık görev`,
      icon: CheckSquare,
      color: k.overdueTasks ? "red" : "blue",
      to: "/tasks",
      alert: k.overdueTasks > 0,
    },
  ];

  const attentionCount =
    m.attention.missedCalls.length +
    m.attention.unansweredChats.length +
    m.attention.idleLeads.length;
  const lineGroups = (["ai", "office", "cloud"] as const).map((g) => ({
    group: g,
    count: lines.filter((l) => l.group === g).length,
  }));

  return (
    <>
      <PageTitle
        eyebrow={new Date().toLocaleDateString("tr-TR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "Europe/Istanbul",
        }).toLocaleUpperCase("tr-TR")}
        title={`${greeting()}${user?.name ? `, ${String(user.name).split(" ")[0]}` : ""}`}
        description={
          attentionCount || m.agenda.length
            ? `Bugün ${m.agenda.length} planlı iş ve ${attentionCount} dikkat bekleyen kayıt var.`
            : "Bugün için bekleyen iş yok. Yeni fırsatlara odaklanın."
        }
        actions={
          <>
            <div className="segmented" role="tablist" aria-label="Dönem">
              {(Object.keys(periodLabels) as Period[]).map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={period === p}
                  className={period === p ? "active" : ""}
                  onClick={() => setPeriod(p)}
                >
                  {periodLabels[p]}
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={onNew}>
              <Plus size={17} />
              Yeni müşteri
            </button>
          </>
        }
      />

      <div className="db-kpis">
        {kpis.map((s) => (
          <button
            className={`db-kpi ${s.alert ? "alert" : ""}`}
            key={s.label}
            onClick={() => navigate(s.to)}
          >
            <span className={`stat-icon ${s.color}`}>
              <s.icon size={18} />
            </span>
            <span className="db-kpi-label">{s.label}</span>
            <strong>
              {s.value}
              {s.trend !== undefined && s.trend !== 0 && (
                <em className={s.trend > 0 ? "up" : "down"}>
                  {s.trend > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(s.trend)}
                </em>
              )}
            </strong>
            <small>{s.note}</small>
          </button>
        ))}
      </div>

      <div className="db-grid two">
        <section className="panel db-agenda">
          <SectionTitle
            title="Bugünün ajandası"
            description="Etkinlikler, son tarihi gelen görevler ve randevular"
            action="Etkinlikler"
            onAction={() => navigate("/activities")}
          />
          {m.agenda.length ? (
            <ul className="db-list">
              {m.agenda.slice(0, 8).map((item) => {
                const lead = item.leadId ? leadById.get(item.leadId) : undefined;
                return (
                  <li key={`${item.kind}-${item.id}`} className={item.overdue ? "overdue" : ""}>
                    <time>{dayLabel(item.at)}</time>
                    <span className={`db-dot ${item.kind}`} />
                    <div>
                      <strong>{item.title}</strong>
                      <small>
                        {item.kind === "task" ? "Görev" : item.kind === "appointment" ? "Randevu" : item.type === "meeting" ? "Toplantı" : item.type === "call" ? "Arama" : "Etkinlik"}
                        {lead && (
                          <>
                            {" · "}
                            <button className="link" onClick={() => onLead(lead)}>
                              {lead.name}
                            </button>
                          </>
                        )}
                        {item.overdue && <b> · Gecikti</b>}
                      </small>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="Bugün plan yok" description="Takvimde bugüne ait açık etkinlik veya görev bulunmuyor." />
          )}
        </section>

        <section className="panel db-attention">
          <SectionTitle
            title="Dikkat bekleyenler"
            description="Geri dönüş yapılmamış iletişimler ve sahipsiz fırsatlar"
          />
          <div className="db-attention-groups">
            <div>
              <h4>
                <PhoneMissed size={15} /> Geri aranmamış cevapsız arama
                <Badge tone={m.attention.missedCalls.length ? "red" : "green"}>
                  {m.attention.missedCalls.length}
                </Badge>
              </h4>
              {m.attention.missedCalls.slice(0, 4).map((c) => {
                const lead = c.leadId ? leadById.get(c.leadId) : undefined;
                return (
                  <button key={c.id} className="db-row" onClick={() => (lead ? onLead(lead) : navigate("/calls"))}>
                    <span>{lead?.name || (c.phone ? formatPhone(`+${c.phone}`) : "Bilinmeyen numara")}</span>
                    <small>{dateTimeOf(c.at)}</small>
                  </button>
                );
              })}
              {!m.attention.missedCalls.length && <p className="db-ok">Tüm aramalara dönüş yapılmış.</p>}
            </div>
            <div>
              <h4>
                <Inbox size={15} /> Yanıt bekleyen mesaj
                <Badge tone={m.attention.unansweredChats.length ? "amber" : "green"}>
                  {m.attention.unansweredChats.length}
                </Badge>
              </h4>
              {m.attention.unansweredChats.slice(0, 4).map((c) => (
                <button key={c.leadId} className="db-row" onClick={() => navigate("/whatsapp")}>
                  <span>
                    {leadById.get(c.leadId)?.name || "Müşteri"}
                    <em>{c.text}</em>
                  </span>
                  <small>{dateTimeOf(c.at)}</small>
                </button>
              ))}
              {!m.attention.unansweredChats.length && <p className="db-ok">Bekleyen mesaj yok.</p>}
            </div>
            <div>
              <h4>
                <AlertTriangle size={15} /> Planlı işi olmayan açık fırsat
                <Badge tone={m.attention.idleLeads.length ? "amber" : "green"}>
                  {m.attention.idleLeads.length}
                </Badge>
              </h4>
              {m.attention.idleLeads.slice(0, 4).map((l) => (
                <button key={l.id} className="db-row" onClick={() => onLead(l)}>
                  <span>
                    {l.name}
                    <em>{l.owner || "Atanmamış"}</em>
                  </span>
                  <small>{compactMoney(l.value || 0)}</small>
                </button>
              ))}
              {m.attention.idleLeads.length > 4 && (
                <button className="text-button" onClick={() => navigate("/activities")}>
                  +{m.attention.idleLeads.length - 4} fırsat daha
                </button>
              )}
              {!m.attention.idleLeads.length && <p className="db-ok">Her açık fırsatın planlı bir işi var.</p>}
            </div>
          </div>
        </section>
      </div>

      <div className="dashboard-main">
        <section className="panel performance">
          <SectionTitle
            title="Hareket trendi"
            description={`Günlük yeni müşteri, kazanım, arama ve mesaj · ${period === "today" ? "son 7 gün" : periodLabels[period]}`}
          />
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={m.trend} margin={{ left: -24, right: 12, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#29b5e8" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#29b5e8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#e9ecea" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#929b95", fontSize: 11 }} dy={10} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#929b95", fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e4e9e5", fontSize: 12 }} />
                <Bar dataKey="calls" name="Arama" fill="#b9a4e6" radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Bar dataKey="messages" name="Mesaj" fill="#9fd8c3" radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Area type="monotone" dataKey="leads" name="Yeni müşteri" stroke="#29b5e8" strokeWidth={2.5} fill="url(#leadGradient)" />
                <Area type="monotone" dataKey="won" name="Kazanılan" stroke="#299574" strokeWidth={2} fill="transparent" strokeDasharray="4 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-summary">
            <span>
              <span className="green-dot" />
              {demo ? "Örnek veri" : "Canlı CRM kayıtları"} · Türkiye saati
            </span>
            <button className="text-button" onClick={download}>
              Raporu indir
              <Download size={14} />
            </button>
          </div>
        </section>
        <section className="panel pipeline-summary">
          <SectionTitle
            title="Satış hunisi"
            description="Fırsatların aşamalara dağılımı"
            action="Kanban"
            onAction={() => navigate("/kanban")}
          />
          <div className="pipeline-total">
            <strong>{data.leads.length}</strong>
            <span>
              toplam fırsat<Badge tone="green">{baseStages.length} aşama</Badge>
            </span>
          </div>
          <div className="pipeline-bars">
            {baseStages.map((s) => {
              const items = data.leads.filter((x) => x.stage === s.id);
              const count = items.length;
              return (
                <button key={s.id} onClick={() => navigate("/kanban")} className="pipeline-row">
                  <div>
                    <span>
                      <i style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <b>
                      {count}
                      <em>{compactMoney(items.reduce((sum, l) => sum + (l.value || 0), 0))}</em>
                    </b>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${data.leads.length ? (count / data.leads.length) * 100 : 0}%`,
                        background: s.color,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="db-grid two">
        <section className="panel">
          <SectionTitle
            title="Danışman performansı"
            description={`${periodLabels[period]} · kazanılan değere göre`}
            action="CRM analitiği"
            onAction={() => navigate("/reports")}
          />
          {m.owners.length ? (
            <div className="table-wrap">
              <table className="db-table">
                <thead>
                  <tr>
                    <th>DANIŞMAN</th>
                    <th>AÇIK</th>
                    <th>YENİ</th>
                    <th>KAZANILAN</th>
                    <th>ARAMA</th>
                    <th>GECİKEN</th>
                  </tr>
                </thead>
                <tbody>
                  {m.owners.slice(0, 8).map((o) => (
                    <tr key={o.owner}>
                      <td>
                        <span className="owner-cell">
                          <Avatar name={o.owner} size={23} />
                          {o.owner}
                        </span>
                      </td>
                      <td>{o.open}</td>
                      <td>{o.newLeads}</td>
                      <td>
                        {o.won}
                        {o.wonValue > 0 && <small> · {compactMoney(o.wonValue)}</small>}
                      </td>
                      <td>{o.calls}</td>
                      <td>{o.overdue ? <Badge tone="red">{o.overdue}</Badge> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Henüz müşteri yok" description="İlk müşteri kaydınızı ekleyin." />
          )}
        </section>
        <section className="panel">
          <SectionTitle
            title="Müşteri kaynakları"
            description={m.kpis.newLeads ? `${periodLabels[period]} içinde gelen müşteriler` : "Açık fırsatların kaynağı"}
          />
          <div className="db-sources">
            {m.sources.slice(0, 7).map((s) => {
              const max = m.sources[0]?.count || 1;
              return (
                <div key={s.source} className="db-source">
                  <span>{s.source}</span>
                  <div className="progress-track">
                    <span style={{ width: `${(s.count / max) * 100}%` }} />
                  </div>
                  <b>{s.count}</b>
                </div>
              );
            })}
            {!m.sources.length && <Empty title="Kaynak verisi yok" description="Müşteri kaynakları burada görünür." />}
          </div>
          <h4 className="db-subhead">Son müşteriler</h4>
          <div className="db-recent">
            {[...data.leads]
              .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
              .slice(0, 4)
              .map((l) => (
                <button key={l.id} className="db-row" onClick={() => onLead(l)}>
                  <span className="person-cell">
                    <Avatar name={l.name} size={26} />
                    <span>
                      {l.name}
                      <em>
                        {l.source} ·{" "}
                        {getPipelineStages(data.pipelines, l.pipelineId).find((s) => s.id === l.stage)?.label || l.stage}
                      </em>
                    </span>
                  </span>
                  <small>{dateTimeOf(l.createdAt)}</small>
                </button>
              ))}
          </div>
        </section>
      </div>

      <section className="channel-strip db-channels">
        <div className="channel-strip-title">
          <span className="channel-symbol">
            <Radio size={20} />
          </span>
          <div>
            <strong>İletişim altyapısı</strong>
            <p>
              {lines.length} hat ·{" "}
              {lineGroups.map((g) => `${g.count} ${groupNames[g.group]}`).join(" · ")}
            </p>
          </div>
        </div>
        {[
          { id: "evolution", name: "WhatsApp QR", sub: "Evolution API", icon: MessageCircle, cls: "whatsapp", to: "/whatsapp" },
          { id: "meta", name: "WhatsApp Cloud", sub: "Meta resmi API", icon: MessageCircle, cls: "whatsapp", to: "/integrations" },
          { id: "netgsm", name: "Santral / SIP", sub: "Netgsm · FST · PBX", icon: Phone, cls: "pbx", to: "/lines" },
          { id: "vapi", name: "Vapi AI", sub: "Yapay zekâ aramaları", icon: Sparkles, cls: "vapi", to: "/integrations" },
        ].map((p) => (
          <button key={p.id} className="channel-provider" onClick={() => navigate(p.to)}>
            <span className={`provider-icon ${p.cls}`}>
              <p.icon size={19} />
            </span>
            <div>
              <strong>{p.name}</strong>
              <small>{p.sub}</small>
            </div>
            {providerBadge(p.id)}
          </button>
        ))}
        <button className="channel-provider" onClick={() => navigate("/webhooks")}>
          <span className="provider-icon pbx">
            <Webhook size={19} />
          </span>
          <div>
            <strong>Webhooklar</strong>
            <small>
              {hooks ? `${hooks.inbound} gelen · ${hooks.outbound} giden` : "n8n ve dış sistemler"}
            </small>
          </div>
          <Workflow size={16} />
        </button>
      </section>

      <section className="panel activities db-events">
        <SectionTitle title="Son sistem hareketleri" action="Tümü" onAction={() => navigate("/webhooks")} />
        <div className="activity-list">
          {data.events.slice(0, 5).map((e) => (
            <div className="activity-item" key={e.id}>
              <span className={`activity-icon ${e.status === "failed" ? "purple" : e.type === "hook-delivery" || e.type === "hook-inbound" ? "blue" : "green"}`}>
                {e.type.startsWith("hook") ? <Webhook size={16} /> : e.type === "stage-change" ? <Check size={16} /> : <Workflow size={16} />}
              </span>
              <div>
                <strong>{e.title}</strong>
                <p>{e.detail || e.type}</p>
                <time>
                  {dateTimeOf(e.createdAt)} · {demo ? "Örnek veri" : e.status === "failed" ? "Hatalı" : "CRM"}
                </time>
              </div>
            </div>
          ))}
          {!data.events.length && (
            <Empty title="Henüz hareket yok" description="Otomasyon ve webhook olayları burada görünecek." />
          )}
        </div>
      </section>
    </>
  );
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  const day = date.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  return day === today
    ? timeOf(iso)
    : date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", timeZone: "Europe/Istanbul" });
}

