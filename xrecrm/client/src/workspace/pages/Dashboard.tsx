import { getPipelineStages, baseStages } from "../suite";
import { useState } from "react";
import {
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  Phone,
  MessageCircle,
  MoreHorizontal,
  ChevronDown,
  Plus,
  ArrowRight,
  Check,
  Activity,
  Workflow,
  Radio,
  Download,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useStore } from "../store";
import { Lead, stages, money, lines, groupNames } from "../data";
import {
  Avatar,
  Badge,
  PageTitle,
  SectionTitle,
  Empty,
} from "../components/ui";
export default function Dashboard({
  navigate,
  onLead,
  onNew,
}: {
  navigate: (p: string) => void;
  onLead: (l: Lead) => void;
  onNew: () => void;
}) {
  const { data, demo } = useStore();
  const [period, setPeriod] = useState("Bu hafta");
  const [range, setRange] = useState("7 gün");
  const won = data.leads.filter((x) => x.stage === "won");
  const total = data.leads
    .filter((l) => l.stage !== "won" && l.stage !== "lost")
    .reduce((s, l) => s + l.value, 0);
  const conversion = data.leads.length
    ? Math.round((won.length / data.leads.length) * 100)
    : 0;
  const chart = demo
    ? range === "7 gün"
      ? [
          { name: "Pzt", lead: 14, contact: 9 },
          { name: "Sal", lead: 22, contact: 15 },
          { name: "Çar", lead: 18, contact: 12 },
          { name: "Per", lead: 32, contact: 22 },
          { name: "Cum", lead: 25, contact: 17 },
          { name: "Cmt", lead: 40, contact: 28 },
          { name: "Paz", lead: 35, contact: 25 },
        ]
      : [
          { name: "1. hafta", lead: 34, contact: 21 },
          { name: "2. hafta", lead: 58, contact: 32 },
          { name: "3. hafta", lead: 42, contact: 29 },
          { name: "4. hafta", lead: 76, contact: 52 },
        ]
    : [
        {
          name: "Bugün",
          lead: data.leads.length,
          contact: data.leads.filter((l) => l.stage !== "new").length,
        },
      ];
  const download = () => {
    const blob = new Blob(
      [
        "Müşteri;Aşama;Değer\n" +
          data.leads.map((l) => `${l.name};${l.stage};${l.value}`).join("\n"),
      ],
      { type: "text/csv;charset=utf-8;" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "xre-satis-ozeti.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <PageTitle
        eyebrow="ÇALIŞMA ALANINIZA GENEL BAKIŞ"
        title="XRE çalışma alanı"
        description="CRM, görevler, takvim ve iletişim ekibinizle aynı bağlamda."
        actions={
          <>
            <button
              className="btn secondary period"
              onClick={() => navigate("/reports")}
            >
              <CalendarDays size={16} />
              CRM analitiği
              <ChevronDown size={14} />
            </button>
            <button className="btn primary" onClick={onNew}>
              <Plus size={17} />
              Yeni müşteri
            </button>
          </>
        }
      />
      <div className="b24-home-launcher">
        <button onClick={() => navigate("/kanban")}>
          <Workflow size={19} />
          <span>
            <strong>CRM fırsatları</strong>
            <small>Satış hunilerinizi yönetin</small>
          </span>
          <ArrowUpRight size={15} />
        </button>
        <button onClick={() => navigate("/tasks")}>
          <Check size={19} />
          <span>
            <strong>
              {data.tasks.filter((t) => t.status !== "done").length} açık görev
            </strong>
            <small>Bugünün takip işlerine bakın</small>
          </span>
          <ArrowUpRight size={15} />
        </button>
        <button onClick={() => navigate("/calendar")}>
          <CalendarDays size={19} />
          <span>
            <strong>Takvim</strong>
            <small>
              {data.activities.filter((a) => !a.completed).length} planlanmış
              etkinlik
            </small>
          </span>
          <ArrowUpRight size={15} />
        </button>
        <button onClick={() => navigate("/feed")}>
          <MessageCircle size={19} />
          <span>
            <strong>Ekip akışı</strong>
            <small>Güncellemeleri paylaşın</small>
          </span>
          <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Toplam müşteri",
            value: String(data.leads.length).padStart(2, "0"),
            note: `${data.leads.filter((l) => l.stage === "new").length} yeni müşteri`,
            icon: Users,
            color: "green",
            tag: "CRM",
          },
          {
            label: "Aktif fırsat değeri",
            value:
              total >= 1000000
                ? `₺${(total / 1000000).toFixed(1).replace(".", ",")} M`
                : money(total),
            note: `${data.leads.filter((l) => l.stage !== "won" && l.stage !== "lost").length} açık fırsat`,
            icon: Activity,
            color: "blue",
            tag: "SATIŞ",
          },
          {
            label: "Mesaj trafiği",
            value: String(data.messages.length).padStart(2, "0"),
            note: `${data.messages.filter((m) => m.direction === "inbound").length} gelen · ${data.messages.filter((m) => m.direction === "outbound").length} giden`,
            icon: MessageCircle,
            color: "purple",
            tag: "WHATSAPP",
          },
          {
            label: "Satışa dönüşüm",
            value: `%${conversion}`,
            note: `${won.length} tamamlanan satış`,
            icon: ArrowUpRight,
            color: "amber",
            tag: "PERFORMANS",
          },
        ].map((s) => (
          <article className="stat-card" key={s.label}>
            <div className="stat-top">
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={19} />
              </span>
              <span className="stat-tag">{s.tag}</span>
              <MoreHorizontal size={17} />
            </div>
            <p>{s.label}</p>
            <div className="stat-value">
              {s.value}
              <span className="tiny-trend">
                <ArrowUpRight size={13} />
                {demo ? "Örnek" : "Canlı"}
              </span>
            </div>
            <div className="stat-bottom">
              <span className="green-dot" />
              {s.note}
            </div>
          </article>
        ))}
      </div>
      <div className="dashboard-main">
        <section className="panel performance">
          <SectionTitle
            title="Satış performansı"
            description={
              demo
                ? "Müşteri kazanımı ve iletişim trafiği · Örnek grafik"
                : "Güncel CRM kayıtları"
            }
          />
          <div className="chart-toolbar">
            <div className="chart-legend">
              <span>
                <i className="green" />
                Yeni müşteriler
              </span>
              <span>
                <i className="mint" />
                İletişime geçilen
              </span>
            </div>
            <div className="segmented">
              {["7 gün", "30 gün"].map((x) => (
                <button
                  key={x}
                  className={range === x ? "active" : ""}
                  onClick={() => setRange(x)}
                >
                  {x}
                </button>
              ))}
            </div>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chart}
                margin={{ left: -24, right: 12, top: 10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="leadGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#29b5e8" stopOpacity={0.19} />
                    <stop offset="95%" stopColor="#29b5e8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 5"
                  vertical={false}
                  stroke="#e9ecea"
                />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#929b95", fontSize: 11 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#929b95", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: "1px solid #e4e9e5",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="contact"
                  name="İletişim"
                  stroke="#a4d3e8"
                  strokeWidth={2}
                  fill="transparent"
                  strokeDasharray="4 3"
                />
                <Area
                  type="monotone"
                  dataKey="lead"
                  name="Yeni müşteri"
                  stroke="#29b5e8"
                  strokeWidth={2.7}
                  fill="url(#leadGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-summary">
            <span>
              <span className="green-dot" />
              Müşterilerinizle bağınızı güçlendirin.
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
              toplam fırsat<Badge tone="green">{stages.length} aşama</Badge>
            </span>
          </div>
          <div className="pipeline-bars">
            {baseStages.map((s, i) => {
              const count = data.leads.filter((x) => x.stage === s.id).length;
              return (
                <button
                  key={s.id}
                  onClick={() => navigate("/kanban")}
                  className="pipeline-row"
                >
                  <div>
                    <span>
                      <i style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <b>
                      {count}
                      <em>
                        {data.leads.length
                          ? Math.round((count / data.leads.length) * 100)
                          : 0}
                        %
                      </em>
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
          <div className="pipeline-footer">
            <span className="check-ring">
              <Check size={14} />
            </span>
            <span>{won.length} fırsat başarıyla sonuçlandı</span>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel recent-leads">
          <SectionTitle
            title="Son müşteriler"
            description="Yeni fırsatları kaçırmayın"
            action="Tüm müşteriler"
            onAction={() => navigate("/leads")}
          />
          {data.leads.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MÜŞTERİ</th>
                    <th>KAYNAK</th>
                    <th>AŞAMA</th>
                    <th>DANIŞMAN</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.leads.slice(0, 4).map((l) => (
                    <tr key={l.id} onClick={() => onLead(l)}>
                      <td>
                        <div className="person-cell">
                          <Avatar name={l.name} />
                          <div>
                            <strong>{l.name}</strong>
                            <span>{l.company}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="source-cell">
                          {l.source === "WhatsApp" ? (
                            <MessageCircle size={14} className="green-text" />
                          ) : l.source === "Telefon" ? (
                            <Phone size={14} />
                          ) : (
                            <ArrowUpRight size={14} />
                          )}{" "}
                          {l.source}
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            l.stage === "new"
                              ? "purple"
                              : l.stage === "qualified"
                                ? "amber"
                                : "blue"
                          }
                        >
                          {getPipelineStages(data.pipelines, l.pipelineId).find(
                            (s) => s.id === l.stage,
                          )?.label || l.stage}
                        </Badge>
                      </td>
                      <td>
                        <span className="owner-cell">
                          <Avatar name={l.owner} size={23} />
                          {l.owner}
                        </span>
                      </td>
                      <td>
                        <ArrowUpRight size={16} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Henüz müşteri yok"
              description="İlk müşteri kaydınızı ekleyin."
            />
          )}
        </section>
        <section className="panel activities">
          <SectionTitle
            title="Son hareketler"
            action="Tümü"
            onAction={() => navigate("/webhooks")}
          />
          <div className="activity-list">
            {data.events.slice(0, 3).map((e, i) => (
              <div className="activity-item" key={e.id}>
                <span
                  className={`activity-icon ${i === 1 ? "blue" : i === 2 ? "purple" : "green"}`}
                >
                  {i === 0 ? (
                    <MessageCircle size={16} />
                  ) : i === 1 ? (
                    <ArrowRight size={16} />
                  ) : (
                    <Workflow size={16} />
                  )}
                </span>
                <div>
                  <strong>{e.title}</strong>
                  <p>{e.detail || e.type}</p>
                  <time>
                    {new Date(e.createdAt).toLocaleTimeString("tr-TR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {demo ? "Örnek veri" : "CRM"}
                  </time>
                </div>
              </div>
            ))}
            {!data.events.length && (
              <Empty
                title="Henüz hareket yok"
                description="CRM etkinlikleri burada görünecek."
              />
            )}
          </div>
          <button
            className="activity-more"
            onClick={() => navigate("/automations")}
          >
            Otomasyonları yönet
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <section className="channel-strip">
        <div className="channel-strip-title">
          <span className="channel-symbol">
            <Radio size={20} />
          </span>
          <div>
            <strong>İletişim altyapınız, bir arada.</strong>
            <p>{lines.length} kayıtlı hat · 3 hizmet grubu</p>
          </div>
        </div>
        <div className="channel-provider">
          <span className="provider-icon whatsapp">
            <MessageCircle size={20} />
          </span>
          <div>
            <strong>WhatsApp</strong>
            <small>QR & Meta Cloud API</small>
          </div>
          <Badge tone="gray">Kurulum gerekli</Badge>
        </div>
        <div className="channel-provider">
          <span className="provider-icon pbx">
            <Phone size={19} />
          </span>
          <div>
            <strong>Netgsm</strong>
            <small>SIP · OFİX & Bulut PBX</small>
          </div>
          <Badge tone="gray">Kurulum gerekli</Badge>
        </div>
        <div className="channel-provider">
          <span className="provider-icon vapi">
            <Sparkles size={19} />
          </span>
          <div>
            <strong>Vapi AI</strong>
            <small>8 yapay zekâ hattı</small>
          </div>
          <button
            className="round-arrow"
            onClick={() => navigate("/integrations")}
            aria-label="Entegrasyonları aç"
          >
            <ArrowUpRight size={17} />
          </button>
        </div>
      </section>
    </>
  );
}
