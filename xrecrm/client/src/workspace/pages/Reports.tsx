import { buildReport, reportToMarkdown } from "../../../../shared/assistant";
import { useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Target,
  CalendarClock,
  Download,
  ArrowUpRight,
} from "lucide-react";
import { useStore } from "../store";
import { Lead, money } from "../data";
import { availablePipelines, getPipelineStages, isOverdue } from "../suite";
import { Avatar, Badge, Empty } from "../components/ui";
export default function Reports({
  onLead,
  navigate,
}: {
  onLead: (l: Lead) => void;
  navigate: (p: string) => void;
}) {
  const { data, demo } = useStore();
  const [pipeline, setPipeline] = useState("all");
  const today = new Date(Date.now() + 10800000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today);
  const dailyReport = buildReport(data, { from, to });
  const downloadDaily = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([reportToMarkdown(dailyReport)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    a.download = `xre-faaliyet-${from}-${to}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const leads = data.leads.filter(
    (l) => pipeline === "all" || (l.pipelineId || "sales") === pipeline,
  );
  const won = leads.filter((l) => l.stage === "won");
  const lost = leads.filter((l) => l.stage === "lost");
  const open = leads.filter((l) => !["won", "lost"].includes(l.stage));
  const stages = getPipelineStages(data.pipelines, pipeline);
  const amount = (items: Lead[]) => items.reduce((n, l) => n + l.value, 0);
  const group = (field: "owner" | "source") =>
    [...new Set(leads.map((l) => l[field]))].map((name) => ({
      name,
      items: leads.filter((l) => l[field] === name),
    }));
  const overdue = [
    ...data.tasks
      .filter((t) => isOverdue(t.dueAt, t.status === "done"))
      .map((t) => ({ ...t, kind: "task" })),
    ...data.activities
      .filter((a) => !a.cancelled && isOverdue(a.startAt, a.completed))
      .map((a) => ({ ...a, dueAt: a.startAt, kind: "activity" })),
  ]
    .filter((t) => pipeline === "all" || leads.some((l) => l.id === t.leadId))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const conversion =
    won.length + lost.length
      ? Math.round((won.length / (won.length + lost.length)) * 100)
      : 0;
  const exportCsv = () => {
    const lines = [
      "Huni;Aşama;Fırsat sayısı;Toplam tutar",
      ...stages.map(
        (s) =>
          `${pipeline};${s.label};${leads.filter((l) => l.stage === s.id).length};${amount(leads.filter((l) => l.stage === s.id))}`,
      ),
    ];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\uFEFF" + lines.join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    a.download = "xre-satis-ozeti.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <div className="b24-page-head">
        <div>
          <h1>CRM analitiği</h1>
          <p>Satış performansı, huni dağılımı ve takip riskleri.</p>
        </div>
        <div>
          <select
            className="b24-report-select"
            aria-label="Rapor hunisi"
            value={pipeline}
            onChange={(e) => setPipeline(e.target.value)}
          >
            <option value="all">Tüm satış hunileri</option>
            {availablePipelines(data.pipelines).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn secondary" onClick={exportCsv}>
            <Download size={16} />
            Raporu indir
          </button>
        </div>
      </div>
      <div className="b24-report-note">
        {demo ? "Örnek veri analizi" : "Mevcut CRM kayıtlarının anlık özeti"} ·
        Tarihsel dönüşüm veya geçmiş dönem kıyaslaması değildir.
      </div>
      <div className="b24-report-kpis">
        {[
          {
            title: "Açık fırsat tutarı",
            value: money(amount(open)),
            sub: `${open.length} fırsat`,
            icon: TrendingUp,
          },
          {
            title: "Kazanılmış tutar",
            value: money(amount(won)),
            sub: `${won.length} tamamlanan satış`,
            icon: Target,
          },
          {
            title: "Kapanan fırsat başarı oranı",
            value: `%${conversion}`,
            sub: `${won.length} kazanıldı / ${won.length + lost.length} kapandı`,
            icon: BarChart3,
          },
          {
            title: "Gecikmiş görev & etkinlikler",
            value: overdue.length,
            sub: "Takip gerektiriyor",
            icon: CalendarClock,
          },
        ].map((k) => (
          <article key={k.title}>
            <k.icon size={19} />
            <span>{k.title}</span>
            <strong>{k.value}</strong>
            <small>{k.sub}</small>
          </article>
        ))}
      </div>
      <section className="panel cx-communications-report">
        <header>
          <div>
            <h3>CRM iletişim ve görüşme raporu</h3>
            <p>
              Bu çalışma alanına gelen kayıtlar · Türkiye saati · Planlama ile
              gerçekleşmiş iletişim ayrıdır.
            </p>
          </div>
          <div>
            <input
              aria-label="Faaliyet raporu başlangıç"
              type="date"
              max={to}
              value={from}
              onChange={(e) => {
                if (
                  e.target.value &&
                  e.target.value <= to &&
                  Date.parse(to) - Date.parse(e.target.value) <= 365 * 86400000
                )
                  setFrom(e.target.value);
              }}
            />
            <input
              aria-label="Faaliyet raporu bitiş"
              type="date"
              min={from}
              value={to}
              onChange={(e) => {
                if (
                  e.target.value &&
                  e.target.value >= from &&
                  Date.parse(e.target.value) - Date.parse(from) <=
                    365 * 86400000
                )
                  setTo(e.target.value);
              }}
            />
            <button className="btn secondary" onClick={downloadDaily}>
              <Download size={14} />
              Faaliyet raporu
            </button>
          </div>
        </header>
        <div className="cx-metrics-grid">
          {dailyReport.metrics
            .filter((m) =>
              [
                "calls",
                "incomingCalls",
                "outgoingCalls",
                "successfulCalls",
                "failedCalls",
                "unknownOutcomeCalls",
                "inboundMessages",
                "outboundMessages",
                "createdMeetings",
                "completedMeetings",
              ].includes(m.key),
            )
            .map((m) => (
              <article key={m.key}>
                <small>{m.label}</small>
                <strong>{m.value}</strong>
              </article>
            ))}
        </div>
        <details>
          <summary>Veri kapsamı ve bilinmeyen sonuçlar</summary>
          {dailyReport.dataLimits.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </details>
      </section>
      <div className="b24-report-columns">
        <section className="panel b24-report-panel">
          <header>
            <h3>Aşama dağılımı</h3>
            <Badge>{leads.length} fırsat</Badge>
          </header>
          {stages.map((s) => {
            const items = leads.filter((l) => l.stage === s.id);
            return (
              <div className="b24-funnel-row" key={s.id}>
                <div>
                  <span style={{ background: s.color }} />
                  {s.label}
                  <b>{items.length}</b>
                </div>
                <div className="b24-funnel-track">
                  <i
                    style={{
                      width: `${leads.length ? Math.max(2, (items.length / leads.length) * 100) : 0}%`,
                      background: s.color,
                    }}
                  />
                </div>
                <strong>{money(amount(items))}</strong>
              </div>
            );
          })}
        </section>
        <section className="panel b24-report-panel">
          <header>
            <h3>Kaynak performansı</h3>
            <span>Mevcut kayıtlar</span>
          </header>
          {group("source").map((g) => (
            <div className="b24-source-report" key={g.name}>
              <strong>{g.name || "Belirtilmemiş"}</strong>
              <span>{g.items.length} fırsat</span>
              <b>{money(amount(g.items))}</b>
            </div>
          ))}
          {!leads.length && (
            <Empty
              title="Rapor için fırsat yok"
              description="CRM kayıtları eklendikçe analiz güncellenir."
            />
          )}
        </section>
      </div>
      <section className="panel b24-report-panel">
        <header>
          <h3>Danışman performansı</h3>
          <button className="text-button" onClick={() => navigate("/team")}>
            Ekip dizini
            <ArrowUpRight size={14} />
          </button>
        </header>
        <div className="table-wrap">
          <table className="leads-table">
            <thead>
              <tr>
                <th>DANIŞMAN</th>
                <th>TOPLAM FIRSAT</th>
                <th>AÇIK TUTAR</th>
                <th>KAZANILMIŞ TUTAR</th>
                <th>KAYBEDİLEN</th>
                <th>GECİKMİŞ TAKİP</th>
              </tr>
            </thead>
            <tbody>
              {group("owner").map((g) => (
                <tr key={g.name}>
                  <td>
                    <span className="owner-cell">
                      <Avatar name={g.name} size={27} />
                      {g.name}
                    </span>
                  </td>
                  <td>{g.items.length}</td>
                  <td>
                    {money(
                      amount(
                        g.items.filter(
                          (l) => !["won", "lost"].includes(l.stage),
                        ),
                      ),
                    )}
                  </td>
                  <td>
                    {money(amount(g.items.filter((l) => l.stage === "won")))}
                  </td>
                  <td>{g.items.filter((l) => l.stage === "lost").length}</td>
                  <td>{overdue.filter((t) => t.assignee === g.name).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel b24-report-panel">
        <header>
          <h3>Takip bekleyen fırsatlar</h3>
          <span>Gecikmiş görev & etkinlikler</span>
        </header>
        {overdue.slice(0, 8).map((t) => (
          <button
            className="b24-overdue-report"
            key={t.id}
            onClick={() => {
              const l = leads.find((l) => l.id === t.leadId);
              l
                ? onLead(l)
                : navigate(t.kind === "activity" ? "/calendar" : "/tasks");
            }}
          >
            <CalendarClock size={17} />
            <span>
              <strong>{t.title}</strong>
              <small>
                {t.assignee} · {new Date(t.dueAt).toLocaleDateString("tr-TR")}
              </small>
            </span>
            <Badge tone="red">Gecikmiş</Badge>
            <ArrowUpRight size={16} />
          </button>
        ))}
        {!overdue.length && (
          <p className="muted">Gecikmiş görev veya etkinlik bulunmuyor.</p>
        )}
      </section>
    </>
  );
}
