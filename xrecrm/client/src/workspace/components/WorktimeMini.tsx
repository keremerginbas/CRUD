import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CirclePause, Clock3, Play } from "lucide-react";
import { useStore } from "../store";
import { readDemoWorktime } from "../worktime-demo";
import type { WorktimeDayState } from "../../../../shared/worktime";
import "../worktime.css";

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
}

function liveNet(state: WorktimeDayState | null, now: number): number {
  if (!state) return 0;
  return state.periods.reduce((sum, period) => {
    const counted = period.type === "work" || period.type === "appointment";
    if (!counted) return sum;
    const end = period.endAt
      ? Date.parse(period.endAt)
      : state.status === "working"
        ? now
        : Date.parse(period.startAt);
    return sum + Math.max(0, end - Date.parse(period.startAt));
  }, 0);
}

export default function WorktimeMini({
  navigate,
}: {
  navigate?: (path: string) => void;
}) {
  const { demo, request } = useStore();
  const [state, setState] = useState<WorktimeDayState | null>(null);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    try {
      const body = demo ? readDemoWorktime() : await request("/api/worktime");
      setState((body as { today: WorktimeDayState }).today);
      setFailed(false);
      setUnauthorized(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setFailed(true);
      setUnauthorized(
        !demo && /401|oturum|geçerli manus|unauthor/i.test(message),
      );
    }
  }, [demo, request]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (active) await refresh();
    };
    void load();
    const onChange = () => void load();
    window.addEventListener("xre-worktime-change", onChange);
    const poll = window.setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      window.removeEventListener("xre-worktime-change", onChange);
      window.clearInterval(poll);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const label = unauthorized
    ? "Oturum gerekli (401)"
    : failed
      ? "Mesai bilgisi alınamadı"
      : state?.status === "working"
        ? "Mesai açık"
        : state?.status === "paused"
          ? "Molada"
          : state?.status === "finished"
            ? "Tamamlandı"
            : demo
              ? "Demo mesai başlamadı"
              : "Mesai başlamadı";
  const net = liveNet(state, now);
  const caption = unauthorized
    ? "Mesai için kimliği doğrulanmış oturum gerekli"
    : failed
      ? "Sunucu onayı alınamadı"
      : `${duration(net)} net çalışma${demo ? " · Demo modu" : ""}`;

  return (
    <button
      className="worktime-mini"
      onClick={() => navigate?.("/worktime")}
      type="button"
    >
      <span className={`worktime-mini-icon ${state?.status || "idle"}`}>
        {state?.status === "working" ? (
          <Play size={14} />
        ) : state?.status === "paused" ? (
          <CirclePause size={14} />
        ) : (
          <Clock3 size={15} />
        )}
      </span>
      <span className="worktime-mini-copy">
        <strong>{label}</strong>
        <small>{caption}</small>
      </span>
      <ArrowUpRight size={15} />
    </button>
  );
}
