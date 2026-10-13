import { useEffect, useState } from "react";
import {
  Workflow,
  CalendarDays,
  RefreshCw,
  ArrowUpRight,
  ShieldCheck,
  ChevronDown,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge } from "./ui";
import { SELECTED_WORKFLOWS } from "../../../../shared/n8n-workflows";
export default function N8nSelected() {
  const { demo, user, request } = useStore();
  const [live, setLive] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState("");
  useEffect(() => {
    setLive([]);
    setReports([]);
    if (!demo && user?.canAccess !== false && user) {
      request("/api/n8n/selected")
        .then((r) => setLive(r.data || []))
        .catch(() => {});
      request("/api/n8n/reports")
        .then((r) => setReports(r.reports || r.data || []))
        .catch(() => {});
    }
  }, [demo, user?.openId]);
  async function refresh() {
    if (demo) {
      toast.info("Demo modunda n8n çalıştırılmaz veya okunmaz.");
      return;
    }
    setBusy(true);
    try {
      const r = await request("/api/n8n/reports/refresh", {});
      setReports([
        ...(r.reports || r.data || []),
        ...(r.errors || []).map((e: any) => ({
          workflowId: e.workflowId,
          name: e.name,
          limits: [e.error],
        })),
      ]);
      if (r.errors?.length)
        toast.info(`${r.errors.length} akış için rapor verisi eksik.`);
      toast.success(
        "Mevcut n8n rapor çıktıları okundu; hiçbir akış tekrar çalıştırılmadı.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="nx-card nx-selected">
      <header>
        <div>
          <span className="nx-kicker">SİZİN SEÇTİĞİNİZ AKIŞLAR</span>
          <h2>6 iş akışı. Tek CRM bağlamı.</h2>
          <p>
            Aktif akışların son başarılı çıktıları okunur; raporlar yapay zekâya
            ayrı Bitrix kaynağı olarak aktarılır.
          </p>
        </div>
        <button
          disabled={busy || demo}
          className="btn secondary"
          onClick={refresh}
        >
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Raporları eşitle
        </button>
      </header>
      <div className="nx-selected-list">
        {SELECTED_WORKFLOWS.map((w) => {
          const status = live.find((x) => x.id === w.id);
          const report = reports.find((x) => x.workflowId === w.id);
          return (
            <article key={w.id}>
              <div className="nx-selected-top">
                <span className="nx-icon nx-icon-cyan">
                  {w.webhooks.length ? (
                    <Workflow size={18} />
                  ) : (
                    <CalendarDays size={18} />
                  )}
                </span>
                <div>
                  <h3>{w.name}</h3>
                  <p>{w.purpose}</p>
                </div>
                <Badge tone={demo ? "gray" : status?.active ? "green" : "gray"}>
                  {demo
                    ? "Demo"
                    : status?.active
                      ? "Aktif"
                      : "Kontrol bekliyor"}
                </Badge>
                <a
                  href={`https://xre111.shop/workflow/${w.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${w.name} n8n’de aç`}
                >
                  <ArrowUpRight size={17} />
                </a>
              </div>
              <div className="nx-selected-meta">
                <span>{w.trigger}</span>
                <code>{w.id}</code>
              </div>
              <p className="nx-selected-note">{w.note}</p>
              {report?.summary ? (
                <>
                  <button
                    className="nx-report-toggle"
                    onClick={() => setExpanded(expanded === w.id ? "" : w.id)}
                  >
                    <span>
                      Son rapor{" "}
                      {report.finishedAt
                        ? `· ${new Date(report.finishedAt).toLocaleString("tr-TR")}`
                        : ""}
                    </span>
                    <ChevronDown size={14} />
                  </button>
                  {expanded === w.id && (
                    <div className="nx-report-preview">
                      {report.summary}
                      <small>{(report.limits || []).join(" ")}</small>
                    </div>
                  )}
                </>
              ) : (
                <p className="nx-report-empty">
                  {report?.limits?.join(" ") ||
                    "Son rapor çıktısı henüz eşitlenmedi."}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <footer>
        <ShieldCheck size={14} />
        Webhook yolu, yönetim ekranı linki değildir. Bitrix olayları sayısal
        kaynak kimlikleriyle eşlenmeden yeni CRM UUID’leri eski akışlara
        gönderilmez.
      </footer>
    </section>
  );
}
