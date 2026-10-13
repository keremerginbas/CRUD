import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  Clock3,
  Coffee,
  MapPin,
  Play,
  RefreshCw,
  Utensils,
  Video,
} from "lucide-react";
import { PageTitle } from "../components/ui";
import { useStore } from "../store";
import { readDemoWorktime, transitionDemoWorktime } from "../worktime-demo";
import type {
  WorktimeAction,
  WorktimeDayState,
  WorktimeOwnResponse,
  WorktimePauseType,
  WorktimePeriod,
  WorktimePeriodType,
  WorktimeTeamResponse,
  WorktimeTotals,
  WorktimeTransitionRequest,
} from "../../../../shared/worktime";
import "../worktime.css";

type Status = WorktimeDayState["status"];
type PeriodType = WorktimePeriodType;
type Period = WorktimePeriod;
type DayState = WorktimeDayState;
type WorktimeResponse = WorktimeOwnResponse;
type TeamResponse = WorktimeTeamResponse;

const typeLabels: Record<PeriodType, string> = {
  work: "Çalışma",
  need: "İhtiyaç molası",
  meal: "Yemek molası",
  appointment: "Online randevu",
};
const typeColors: Record<PeriodType, string> = {
  work: "#2ab978",
  need: "#e8ad58",
  meal: "#f08a62",
  appointment: "#7e7be9",
};

function randomOperationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours
    ? `${hours}s ${String(minutes).padStart(2, "0")}dk`
    : `${minutes}dk ${String(secs).padStart(2, "0")}sn`;
}

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function time(value: string | null): string {
  return value
    ? new Date(value).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

function dateLabel(value: string): string {
  return new Date(`${value}T12:00:00+03:00`).toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function displayTotals(state: DayState, now: number): WorktimeTotals {
  const totals: WorktimeTotals = {
    netMs: 0,
    networkMs: 0,
    breakMs: 0,
    elapsedMs: 0,
    liveMs: 0,
    byType: { work: 0, need: 0, meal: 0, appointment: 0 },
    firstStartAt: null,
    lastEndAt: null,
  };
  for (const period of state.periods) {
    const ms = Math.max(
      0,
      (period.endAt ? Date.parse(period.endAt) : now) -
        Date.parse(period.startAt),
    );
    totals.byType[period.type] += ms;
    if (
      !totals.firstStartAt ||
      Date.parse(period.startAt) < Date.parse(totals.firstStartAt)
    )
      totals.firstStartAt = period.startAt;
    if (
      period.endAt &&
      (!totals.lastEndAt ||
        Date.parse(period.endAt) > Date.parse(totals.lastEndAt))
    )
      totals.lastEndAt = period.endAt;
    if (!period.endAt) totals.liveMs += ms;
  }
  totals.breakMs = totals.byType.need + totals.byType.meal;
  totals.netMs = totals.byType.work + totals.byType.appointment;
  totals.networkMs = totals.netMs;
  totals.elapsedMs = totals.netMs + totals.breakMs;
  return totals;
}

function StatusPill({ state }: { state: DayState }) {
  const label =
    state.status === "working"
      ? "Mesai açık"
      : state.status === "paused"
        ? "Molada"
        : state.status === "finished"
          ? "Tamamlandı"
          : "Başlamadı";
  return (
    <span className={`worktime-status ${state.status}`}>
      <i />
      {label}
    </span>
  );
}

function ProgressRing({ value }: { value: number }) {
  const radius = 106;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);
  return (
    <div
      className="worktime-ring"
      aria-label={`8 saat hedefinin yüzde ${Math.round(value)}si`}
    >
      <svg viewBox="0 0 240 240" role="img">
        <circle className="worktime-ring-track" cx="120" cy="120" r={radius} />
        <circle
          className="worktime-ring-value"
          cx="120"
          cy="120"
          r={radius}
          style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
        />
      </svg>
      <div className="worktime-ring-center">
        <strong>{Math.round(value)}%</strong>
        <span>8 saat hedef</span>
      </div>
    </div>
  );
}

function Timeline({ state, now }: { state: DayState; now: number }) {
  const totals = displayTotals(state, now);
  const segments = state.periods
    .map((period) => ({
      ...period,
      ms: period.endAt
        ? Date.parse(period.endAt) - Date.parse(period.startAt)
        : now - Date.parse(period.startAt),
    }))
    .filter((period) => period.ms > 0);
  const total = Math.max(totals.elapsedMs, 1);
  return (
    <section className="worktime-card worktime-timeline-card">
      <div className="worktime-card-head">
        <div>
          <span className="worktime-eyebrow">GÜN ZAMAN ÇİZELGESİ</span>
          <h3>Bugünün akışı</h3>
        </div>
        <Clock3 size={18} />
      </div>
      <div className="worktime-timeline" aria-label="Gün zaman çizelgesi">
        {segments.length ? (
          segments.map((segment, index) => (
            <span
              key={`${segment.startAt}-${index}`}
              title={`${typeLabels[segment.type]} · ${duration(segment.ms)}`}
              style={{
                flex: Math.max(0.04, segment.ms / total),
                background: typeColors[segment.type],
              }}
              className={!segment.endAt ? "live" : ""}
            />
          ))
        ) : (
          <span className="empty" />
        )}
      </div>
      <div className="worktime-axis">
        <span>{time(state.periods[0]?.startAt || null)}</span>
        <span>{state.live ? "ŞU AN" : time(state.finishedAt)}</span>
      </div>
      <div className="worktime-legend">
        {(Object.keys(typeLabels) as PeriodType[]).map((type) => (
          <span key={type}>
            <i style={{ background: typeColors[type] }} />
            {typeLabels[type]} <b>{duration(totals.byType[type])}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

function PeriodList({ state, now }: { state: DayState; now: number }) {
  return (
    <section className="worktime-card">
      <div className="worktime-card-head">
        <div>
          <span className="worktime-eyebrow">AKIŞ</span>
          <h3>Giriş ve molalar</h3>
        </div>
        <CalendarDays size={18} />
      </div>
      <div className="worktime-periods">
        {[...state.periods].reverse().map((period, index) => {
          const ms = period.endAt
            ? Date.parse(period.endAt) - Date.parse(period.startAt)
            : now - Date.parse(period.startAt);
          return (
            <div
              className={`worktime-period ${!period.endAt ? "open" : ""}`}
              key={`${period.startAt}-${index}`}
            >
              <span
                className="worktime-period-icon"
                style={{
                  background: `${typeColors[period.type]}1c`,
                  color: typeColors[period.type],
                }}
              >
                {period.type === "work" ? (
                  <Play size={14} />
                ) : period.type === "need" ? (
                  <Coffee size={14} />
                ) : period.type === "meal" ? (
                  <Utensils size={14} />
                ) : (
                  <Video size={14} />
                )}
              </span>
              <div>
                <strong>
                  {typeLabels[period.type]}
                  {!period.endAt && <em>ŞU AN</em>}
                </strong>
                <small>
                  {time(period.startAt)}
                  {period.endAt
                    ? ` – ${time(period.endAt)}`
                    : " – devam ediyor"}
                </small>
              </div>
              <b>{duration(ms)}</b>
            </div>
          );
        })}
        {!state.periods.length && (
          <div className="worktime-empty">
            Henüz bugün için bir mesai kaydı yok.
          </div>
        )}
      </div>
    </section>
  );
}

export default function Worktime({
  navigate,
}: {
  navigate?: (path: string) => void;
}) {
  const { demo, request: storeRequest } = useStore();
  const [data, setData] = useState<WorktimeResponse | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [tab, setTab] = useState<"mesai" | "rapor">("mesai");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [teamVisible, setTeamVisible] = useState(false);
  const [teamDenied, setTeamDenied] = useState(false);

  // The store request keeps the live signature (api(url, body, method)); demo requests never fetch.
  const request = useCallback(
    async (url: string, body?: unknown, method = "POST") => {
      if (demo) {
        if (url === "/api/worktime" && body === undefined)
          return readDemoWorktime() as any;
        if (url === "/api/worktime/transition")
          return transitionDemoWorktime(
            body as WorktimeTransitionRequest,
          ) as any;
        throw new Error(
          "Demo modunda ekip raporu için sunucu isteği yapılmaz.",
        );
      }
      return storeRequest(url, body, method);
    },
    [demo, storeRequest],
  );

  const load = useCallback(async () => {
    try {
      const body = await request("/api/worktime");
      setData(body as WorktimeResponse);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sunucuya ulaşılamadı; kayıt yapılmadı.",
      );
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setData(null);
    setTeam(null);
    setTeamVisible(false);
    setTeamDenied(false);
    setError("");
    setNotice("");
  }, [demo]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(() => {
    if (!data) return null;
    if (!selectedDay || selectedDay === data.today.day) return data.today;
    return (
      data.history.find((state) => state.day === selectedDay) || data.today
    );
  }, [data, selectedDay]);
  const selectedTotals = selected ? displayTotals(selected, now) : null;
  const progress = selectedTotals
    ? Math.min(100, (selectedTotals.netMs / (8 * 60 * 60 * 1000)) * 100)
    : 0;

  const transition = async (
    action: "start" | "pause" | "resume" | "finish",
    pauseType?: "need" | "meal" | "appointment",
  ) => {
    if (!data || pending) return;
    if (
      action === "finish" &&
      !window.confirm("Bugünkü açık mesai sonlandırılsın mı?")
    )
      return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const body = await request(
        "/api/worktime/transition",
        {
          action,
          pauseType,
          operationId: randomOperationId(),
          expectedVersion:
            action === "finish" && data.previousOpen
              ? data.previousOpen.version
              : data.today.version,
          day:
            action === "finish" && data.previousOpen
              ? data.previousOpen.day
              : undefined,
        } satisfies WorktimeTransitionRequest,
        "POST",
      );
      setData(body as WorktimeResponse);
      setSelectedDay(null);
      window.dispatchEvent(new Event("xre-worktime-change"));
      setNotice(
        action === "start"
          ? "Mesai başladı."
          : action === "finish"
            ? "Mesai kaydedildi."
            : action === "pause"
              ? "Mola kaydedildi."
              : "Mesaiye dönüldü.",
      );
    } catch (cause) {
      // No local queue and no optimistic state: an unconfirmed network request never becomes a shift.
      setError(
        cause instanceof Error
          ? cause.message
          : "Sunucuya ulaşılamadı; işlem onaylanmadı.",
      );
    } finally {
      setPending(false);
    }
  };

  const showTeam = async () => {
    if (demo) {
      setNotice(
        "Demo modunda ekip raporu kapalıdır; yalnızca örnek sahibi mesaisi gösterilir.",
      );
      return;
    }
    if (teamDenied) return;
    if (team) {
      setTeamVisible(!teamVisible);
      return;
    }
    try {
      const body = await request("/api/worktime/team");
      setTeam(body as TeamResponse);
      setTeamVisible(true);
      setError("");
    } catch (cause) {
      if (cause instanceof Error && /yetki|forbidden|403/i.test(cause.message))
        setTeamDenied(true);
      else
        setError(
          cause instanceof Error ? cause.message : "Ekip raporu alınamadı.",
        );
    }
  };

  const modeBanner = (
    <div className="worktime-notice">
      <Check size={17} />
      {demo
        ? "Demo modu: mesai geçişleri yalnızca bu tarayıcıda saklanır; gerçek sunucuya veya ekibe gönderilmez."
        : "Canlı CRM: yalnızca sunucu tarafından onaylanan mesai geçişleri gösterilir."}
    </div>
  );
  if (!data || !selected || !selectedTotals)
    return (
      <div className="worktime-page">
        <PageTitle
          eyebrow="MESAİ"
          title="Mesai merkezi"
          description="Çalışma zamanınızı güvenli ve tek akışta yönetin."
        />
        {modeBanner}
        <div className="worktime-loading">
          <RefreshCw size={18} className="spin" /> Kayıtlar hazırlanıyor…
        </div>
        {error && (
          <div className="worktime-error">
            <AlertCircle size={17} />
            {error}
            <button onClick={() => void load()}>Tekrar dene</button>
          </div>
        )}
      </div>
    );
  const today = data.today;
  const todayTotals = displayTotals(today, now);
  const todayProgress = Math.min(
    100,
    (todayTotals.netMs / (8 * 60 * 60 * 1000)) * 100,
  );
  const canPause = today.status === "working";
  const canResume = today.status === "paused";
  const canFinish = today.status === "working" || today.status === "paused";

  return (
    <div className="worktime-page">
      <PageTitle
        eyebrow="XRE MESAİ MERKEZİ"
        title="Çalışma zamanınız, tek akışta."
        description="İhtiyaç, yemek ve online randevu molalarını kaybetmeden takip edin."
        actions={
          <div className="worktime-heading-actions">
            <button
              className={`worktime-tab ${tab === "mesai" ? "active" : ""}`}
              onClick={() => setTab("mesai")}
            >
              Mesai
            </button>
            <button
              className={`worktime-tab ${tab === "rapor" ? "active" : ""}`}
              onClick={() => setTab("rapor")}
            >
              Rapor
            </button>
            {!demo && !teamDenied && (
              <button
                className="worktime-team-button"
                onClick={() => void showTeam()}
              >
                Ekip raporu
              </button>
            )}
          </div>
        }
      />
      {modeBanner}
      {error && (
        <div className="worktime-error">
          <AlertCircle size={17} />
          {error}
          <button onClick={() => void load()}>Tekrar dene</button>
        </div>
      )}
      {notice && (
        <div className="worktime-notice">
          <Check size={17} />
          {notice}
        </div>
      )}
      {data.previousOpen && (
        <div className="worktime-warning">
          <AlertCircle size={17} />
          <span>
            <strong>{data.previousOpen.day}</strong> gününden açık kalan
            mesainiz var. Yeni gün açmadan önce onu bitirin.
          </span>
          <button
            onClick={() => {
              setSelectedDay(data.previousOpen?.day || null);
              setTab("rapor");
            }}
          >
            Günü görüntüle
          </button>
          <button disabled={pending} onClick={() => void transition("finish")}>
            Açık günü bitir
          </button>
        </div>
      )}
      {teamVisible && team && (
        <section className="worktime-card worktime-team-card">
          <div className="worktime-card-head">
            <div>
              <span className="worktime-eyebrow">EKİP RAPORU</span>
              <h3>
                {team.from} – {team.to}
              </h3>
            </div>
            <button
              className="worktime-icon-button"
              onClick={() => setTeamVisible(false)}
              aria-label="Ekip raporunu kapat"
            >
              ×
            </button>
          </div>
          {team.records.length ? (
            <div className="worktime-team-list">
              {team.records.map((row) => (
                <div key={`${row.userOpenId}-${row.day}`}>
                  <span>
                    <strong>{row.name}</strong>
                    <small>
                      {row.day} ·{" "}
                      {row.status === "working" || row.status === "paused"
                        ? "Açık"
                        : row.status === "finished"
                          ? "Tamamlandı"
                          : "Başlamadı"}
                    </small>
                  </span>
                  <b>{duration(row.summary.netMs)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="worktime-empty">
              Seçilen aralıkta ekip kaydı yok.
            </div>
          )}
        </section>
      )}
      {tab === "mesai" ? (
        <>
          <div className="worktime-grid">
            <section className="worktime-card worktime-hero-card">
              <div className="worktime-hero-top">
                <div>
                  <span className="worktime-eyebrow">
                    {dateLabel(today.day)}
                  </span>
                  <h2>Merhaba, mesaiye hazır mısınız?</h2>
                </div>
                <StatusPill state={today} />
              </div>
              <div className="worktime-ring-row">
                <ProgressRing value={todayProgress} />
                <div className="worktime-clock-block">
                  <span className="worktime-eyebrow">
                    {today.live ? "CANLI SÜRE" : "NET ÇALIŞMA"}
                  </span>
                  <strong>{clock(todayTotals.netMs)}</strong>
                  <p>
                    {duration(todayTotals.breakMs)} mola · giriş{" "}
                    {time(todayTotals.firstStartAt)}
                  </p>
                </div>
              </div>
              <div className="worktime-actions">
                {today.status === "idle" || today.status === "finished" ? (
                  <button
                    className="worktime-primary"
                    disabled={pending}
                    onClick={() => void transition("start")}
                  >
                    <Play size={17} />
                    {today.status === "finished"
                      ? "Mesaiye geri dön"
                      : "Mesaiyi başlat"}
                  </button>
                ) : null}
                {canPause && (
                  <button
                    className="worktime-secondary"
                    disabled={pending}
                    onClick={() => void transition("pause", "need")}
                  >
                    <CirclePause size={17} />
                    Mola seç
                  </button>
                )}
                {canResume && (
                  <button
                    className="worktime-primary resume"
                    disabled={pending}
                    onClick={() => void transition("resume")}
                  >
                    <Play size={17} />
                    Mesaiye dön
                  </button>
                )}
                {canFinish && (
                  <button
                    className="worktime-danger"
                    disabled={pending}
                    onClick={() => void transition("finish")}
                  >
                    <Check size={17} />
                    Mesaiyi sonlandır
                  </button>
                )}
              </div>
              {canPause && (
                <div className="worktime-break-menu">
                  <button
                    onClick={() => void transition("pause", "need")}
                    disabled={pending}
                  >
                    <Coffee size={17} />
                    <span>
                      İhtiyaç<small>Kısa mola</small>
                    </span>
                  </button>
                  <button
                    onClick={() => void transition("pause", "meal")}
                    disabled={pending}
                  >
                    <Utensils size={17} />
                    <span>
                      Yemek<small>Yemek molası</small>
                    </span>
                  </button>
                  <button
                    onClick={() => void transition("pause", "appointment")}
                    disabled={pending}
                  >
                    <Video size={17} />
                    <span>
                      Randevu<small>Online görüşme</small>
                    </span>
                  </button>
                </div>
              )}
              <p className="worktime-confirmed">
                <span />
                {demo
                  ? "Demo kaydı · yalnızca bu tarayıcıda saklanır"
                  : "Sunucu onaylı kayıt · çevrimdışı işlem kuyruğa alınmaz"}
              </p>
            </section>
            <div className="worktime-side">
              <section className="worktime-card worktime-stat-card">
                <span className="worktime-eyebrow">BUGÜNÜN ÖZETİ</span>
                <div className="worktime-stat-line">
                  <span>Net çalışma</span>
                  <b>{duration(todayTotals.netMs)}</b>
                </div>
                <div className="worktime-stat-line">
                  <span>Toplam mola</span>
                  <b>{duration(todayTotals.breakMs)}</b>
                </div>
                <div className="worktime-stat-line">
                  <span>Giriş</span>
                  <b>{time(todayTotals.firstStartAt)}</b>
                </div>
                <div className="worktime-stat-line">
                  <span>Çıkış</span>
                  <b>{time(todayTotals.lastEndAt)}</b>
                </div>
              </section>
              <section className="worktime-card worktime-location-card">
                <MapPin size={17} />
                <div>
                  <strong>Konum isteğe bağlı</strong>
                  <p>
                    Konum paylaşımı yok; yalnızca siz açıkça seçerseniz geçişe
                    eklenir.
                  </p>
                </div>
              </section>
            </div>
          </div>
          <Timeline state={today} now={now} />
          <PeriodList state={today} now={now} />
        </>
      ) : (
        <section className="worktime-report">
          <div className="worktime-report-nav">
            <button
              onClick={() => {
                const index = [today, ...data.history].findIndex(
                  (state) => state.day === (selected?.day || today.day),
                );
                const next = [today, ...data.history][
                  Math.min(index + 1, data.history.length)
                ];
                setSelectedDay(next?.day || today.day);
              }}
              aria-label="Önceki gün"
            >
              <ChevronLeft size={17} />
            </button>
            <div>
              <span className="worktime-eyebrow">GÜN RAPORU</span>
              <h2>{dateLabel(selected.day)}</h2>
            </div>
            <button
              onClick={() => {
                const list = [today, ...data.history];
                const index = list.findIndex(
                  (state) => state.day === (selected?.day || today.day),
                );
                setSelectedDay(index > 0 ? list[index - 1].day : today.day);
              }}
              aria-label="Sonraki gün"
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="worktime-report-stats">
            <div>
              <small>Net çalışma</small>
              <strong>{duration(selectedTotals.netMs)}</strong>
            </div>
            <div>
              <small>Toplam mola</small>
              <strong>{duration(selectedTotals.breakMs)}</strong>
            </div>
            <div>
              <small>İlerleme</small>
              <strong>
                {Math.round(
                  Math.min(100, selectedTotals.netMs / (8 * 60 * 60 * 1000)),
                )}
                %
              </strong>
            </div>
          </div>
          <PeriodList state={selected} now={now} />
        </section>
      )}
    </div>
  );
}
