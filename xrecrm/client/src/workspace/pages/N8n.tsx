import N8nSelected from "../components/N8nSelected";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { stages, type Stage } from "../data";
import { PageTitle, Badge, Empty } from "../components/ui";
import "../n8n.css";

type N8nSettings = {
  baseUrl: string;
  webhookUrl: string;
  configured: boolean;
  apiKeyConfigured: boolean;
  connected?: boolean;
};
type WorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string | null;
  webhookPaths?: string[];
};
type ExecutionSummary = {
  id: string;
  workflowId?: string | null;
  status?: string | null;
  mode?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  finished?: boolean | null;
};

const emptySettings: N8nSettings = {
  baseUrl: "",
  webhookUrl: "",
  configured: false,
  apiKeyConfigured: false,
};
const DEFAULT_N8N_BASE_URL = "https://xre111.shop";
const eventExample = `{
  "eventId": "xre-event-123",
  "type": "lead.updated",
  "lead": {
    "id": "lead_123",
    "name": "Örnek müşteri",
    "stage": "qualified",
    "owner": "owner-open-id"
  }
}`;

function date(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString("tr-TR", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "İşlem tamamlanamadı.";
}

export default function N8n({
  navigate,
}: {
  navigate?: (path: string) => void;
}) {
  const { data, demo, user, request, refresh } = useStore();
  const [settings, setSettings] = useState<N8nSettings>(emptySettings);
  const [draft, setDraft] = useState({
    baseUrl: DEFAULT_N8N_BASE_URL,
    webhookUrl: "",
  });
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);
  const [tab, setTab] = useState<"workflows" | "executions">("workflows");
  const [busy, setBusy] = useState("");
  const [token, setToken] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleStage, setRuleStage] = useState<Stage>("new");
  const [rulePipeline, setRulePipeline] = useState("all");
  const [selectedLead, setSelectedLead] = useState(data.leads[0]?.id || "");

  const pipelines = useMemo(
    () =>
      (Array.isArray((data as any).pipelines)
        ? (data as any).pipelines
        : []) as {
        id: string;
        name: string;
      }[],
    [data],
  );
  const inboundUrl = `${window.location.origin}/api/webhooks/n8n`;
  const liveOwner = !demo && Boolean(user) && user?.canAccess !== false;
  const recentN8nEvents = data.events.filter((event) => {
    const payload = (event as any).payload;
    return (
      payload?.provider === "n8n" ||
      payload?.origin === "n8n" ||
      event.type === "n8n-delivery"
    );
  });

  async function loadSettings() {
    if (!liveOwner) return;
    try {
      const next = (await request("/api/n8n/settings")) as N8nSettings;
      setSettings({ ...emptySettings, ...next });
      setDraft({
        baseUrl: next.baseUrl || DEFAULT_N8N_BASE_URL,
        webhookUrl: next.webhookUrl || "",
      });
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function loadList(kind: "workflows" | "executions") {
    if (!liveOwner || !settings.configured) return;
    setBusy(`load-${kind}`);
    try {
      const result = await request(`/api/n8n/${kind}?limit=25`);
      if (kind === "workflows") setWorkflows(result.data || []);
      else setExecutions(result.data || []);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (!liveOwner) return;
    void loadSettings();
  }, [demo, user?.openId]);

  useEffect(() => {
    if (liveOwner && settings.configured) void loadList(tab);
  }, [tab, settings.configured, demo, user?.openId]);

  useEffect(() => {
    if (!selectedLead && data.leads[0]?.id) setSelectedLead(data.leads[0].id);
  }, [data.leads, selectedLead]);

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!liveOwner) {
      toast.info("Demo modunda n8n ayarları kaydedilmez.");
      return;
    }
    setBusy("settings");
    try {
      const next = (await request(
        "/api/n8n/settings",
        draft,
        "PUT",
      )) as N8nSettings;
      setSettings({ ...emptySettings, ...next });
      setDraft({
        baseUrl: next.baseUrl || DEFAULT_N8N_BASE_URL,
        webhookUrl: next.webhookUrl || "",
      });
      toast.success("n8n ayarları kaydedildi.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function testConnection() {
    if (!liveOwner) {
      toast.info("Demo modunda canlı n8n bağlantısı test edilmez.");
      return;
    }
    setBusy("test");
    try {
      const next = (await request("/api/n8n/test", {})) as N8nSettings;
      setSettings({ ...emptySettings, ...next });
      toast.success("n8n salt-okuma bağlantısı doğrulandı.");
      await loadList(tab);
    } catch (error) {
      toast.error(errorText(error));
      await loadSettings();
    } finally {
      setBusy("");
    }
  }

  async function revealToken() {
    if (!liveOwner) {
      toast.info("Demo modunda webhook tokenı üretilmez.");
      return;
    }
    setBusy("token");
    try {
      const result = await request("/api/n8n/token", {});
      setToken(String(result.token || ""));
      setTokenVisible(true);
      toast.success("Inbound token yalnızca bu oturumda gösteriliyor.");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function copy(value: string, message = "Panoya kopyalandı.") {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error("Panoya erişilemiyor.");
    }
  }

  async function saveRule(event: React.FormEvent) {
    event.preventDefault();
    if (!liveOwner) {
      toast.info("Demo modunda otomasyon kuralı kaydedilmez.");
      return;
    }
    if (!ruleName.trim()) {
      toast.error("Kural adı gerekli.");
      return;
    }
    setBusy("rule");
    try {
      await request(
        "/api/n8n/rule",
        {
          name: ruleName.trim(),
          triggerStage: ruleStage,
          ...(rulePipeline !== "all" ? { pipelineId: rulePipeline } : {}),
          enabled: true,
        },
        "POST",
      );
      setRuleName("");
      toast.success("n8n statü kuralı kaydedildi.");
      await refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  async function queueTestDelivery() {
    if (!liveOwner) {
      toast.info("Demo modunda gerçek olay kuyruğa alınmaz.");
      return;
    }
    if (!selectedLead) {
      toast.error("Önce bir müşteri seçin.");
      return;
    }
    setBusy("delivery");
    try {
      const result = await request(
        "/api/n8n/delivery",
        { leadId: selectedLead, eventType: "lead.updated" },
        "POST",
      );
      toast.success(
        result.duplicate
          ? "Bu olay zaten kuyrukta; ikinci kez gönderilmedi."
          : "Gerçek lead.updated olayı outbox kuyruğuna alındı.",
      );
      await refresh();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy("");
    }
  }

  const connectionLabel = demo
    ? "Demo — canlı sorgu yapılmadı"
    : settings.connected === true
      ? "Bağlı · son salt-okuma testi başarılı"
      : settings.connected === false
        ? "Bağlı değil · son test başarısız"
        : "Henüz test edilmedi";
  const connectionTone = demo
    ? "amber"
    : settings.connected === true
      ? "green"
      : settings.connected === false
        ? "red"
        : "gray";

  return (
    <div className="nx-page">
      <PageTitle
        eyebrow="ENTEGRASYON KONTROLÜ"
        title="n8n ile CRM olaylarını bağlayın."
        description="Yönetim API’si yalnızca salt-okuma görünümü sağlar; üretim webhookları ayrı ve imzalı çalışır."
        actions={
          <>
            {navigate && (
              <button
                className="btn secondary"
                onClick={() => navigate("/automations")}
              >
                Otomasyonlara dön <ExternalLink size={14} />
              </button>
            )}
            <button
              className="btn secondary"
              disabled={busy === "test" || demo}
              onClick={testConnection}
            >
              <RefreshCw size={15} className={busy === "test" ? "spin" : ""} />
              Bağlantıyı test et
            </button>
          </>
        }
      />

      {demo && (
        <div className="nx-alert" role="status">
          <ShieldCheck size={19} />
          <div>
            <strong>Demo modu açık.</strong>
            <p>
              Canlı n8n çağrıları, token üretimi ve gerçek teslimat kuyruğu
              çalıştırılmaz.
            </p>
          </div>
        </div>
      )}
      {!demo && !user && (
        <div className="nx-alert nx-alert-warning" role="alert">
          <ShieldCheck size={19} />
          <div>
            <strong>Owner oturumu gerekli.</strong>
            <p>
              n8n ayarları ve olay verileri yalnızca yetkili owner hesabına
              açıktır.
            </p>
          </div>
        </div>
      )}

      <div className="nx-status-grid">
        <section className="nx-card nx-status-card">
          <div className="nx-card-heading">
            <div className="nx-icon nx-icon-cyan">
              <Activity size={20} />
            </div>
            <div>
              <span className="nx-kicker">SUNUCU DURUMU</span>
              <h2>Bağlantı görünümü</h2>
            </div>
            <Badge tone={connectionTone}>{connectionLabel}</Badge>
          </div>
          <div className="nx-status-lines">
            <div>
              <span>Management API</span>
              <strong>
                {settings.apiKeyConfigured
                  ? "Sunucu anahtarı hazır"
                  : "Anahtar yapılandırılmamış"}
              </strong>
            </div>
            <div>
              <span>Salt-okuma erişimi</span>
              <strong>
                {settings.connected === true ? "Doğrulandı" : "Test bekliyor"}
              </strong>
            </div>
            <div>
              <span>Workflow değişikliği</span>
              <strong>Bu uygulamadan kapalı</strong>
            </div>
          </div>
        </section>
        <section className="nx-card nx-contract-card">
          <div className="nx-contract-mark">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <span className="nx-kicker">SÖZLEŞME</span>
            <h2>Güvenli ayrım</h2>
            <p>
              n8n Public API anahtarı yönetim çağrılarında kullanılır. Webhook
              Bearer tokenı farklıdır ve API anahtarı değildir.
            </p>
          </div>
        </section>
      </div>

      <div className="nx-two-column">
        <section className="nx-card nx-config-card">
          <div className="nx-card-heading">
            <div className="nx-icon">
              <Link2 size={19} />
            </div>
            <div>
              <span className="nx-kicker">BAĞLANTI AYARLARI</span>
              <h2>Sunucu ve üretim hedefi</h2>
            </div>
          </div>
          <form onSubmit={saveSettings} className="nx-form">
            <label>
              n8n base URL
              <input
                type="url"
                value={draft.baseUrl}
                onChange={(event) =>
                  setDraft({ ...draft, baseUrl: event.target.value })
                }
                placeholder="https://n8n.example.com"
                autoComplete="url"
              />
              <small>
                HTTPS hostname ve isteğe bağlı alt yol. /api/v1 girilirse sunucu
                onu normalize eder.
              </small>
            </label>
            <label>
              Üretim webhook hedefi
              <input
                type="url"
                value={draft.webhookUrl}
                onChange={(event) =>
                  setDraft({ ...draft, webhookUrl: event.target.value })
                }
                placeholder="https://n8n.example.com/webhook/xre-crm"
                autoComplete="url"
              />
              <small>
                Yalnızca base URL ile aynı origin üzerindeki n8n /webhook üretim
                yolu kabul edilir.
              </small>
            </label>
            <div className="nx-form-actions">
              <span>
                <KeyRound size={14} /> API anahtarı tarayıcıya gönderilmez.
              </span>
              <button
                className="btn primary"
                disabled={busy === "settings" || demo}
              >
                {busy === "settings" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}
                Ayarları kaydet
              </button>
            </div>
          </form>
        </section>

        <section className="nx-card nx-token-card">
          <div className="nx-card-heading">
            <div className="nx-icon nx-icon-cyan">
              <KeyRound size={19} />
            </div>
            <div>
              <span className="nx-kicker">INBOUND AUTH</span>
              <h2>Webhook tokenı</h2>
            </div>
          </div>
          <p className="nx-card-intro">
            Token yalnızca açıkça istediğinizde üretilir ve bu sayfada tutulur;
            localStorage’a yazılmaz.
          </p>
          <div className="nx-code-line">
            <code>{inboundUrl}</code>
            <button
              className="icon-button"
              onClick={() => copy(inboundUrl)}
              aria-label="Inbound URL kopyala"
            >
              <Clipboard size={15} />
            </button>
          </div>
          {token && tokenVisible ? (
            <div className="nx-secret-line">
              <code>{token}</code>
              <button
                className="icon-button"
                onClick={() => copy(token, "Token panoya kopyalandı.")}
                aria-label="Token kopyala"
              >
                <Clipboard size={15} />
              </button>
              <button
                className="icon-button"
                onClick={() => setTokenVisible(false)}
                aria-label="Tokenı gizle"
              >
                <EyeOff size={15} />
              </button>
            </div>
          ) : (
            <div className="nx-secret-placeholder">
              <span>Token gösterilmiyor</span>
              <Eye size={15} />
            </div>
          )}
          <div className="nx-token-actions">
            <button
              className="btn secondary"
              disabled={busy === "token" || demo}
              onClick={revealToken}
            >
              {busy === "token" ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Eye size={15} />
              )}
              Tokenı göster
            </button>
            <span>API anahtarı dönerse bu türetilmiş token da değişir.</span>
          </div>
        </section>
      </div>

      <N8nSelected />
      <section className="nx-card nx-data-card">
        <div className="nx-card-heading nx-data-heading">
          <div className="nx-icon nx-icon-cyan">
            <Workflow size={19} />
          </div>
          <div>
            <span className="nx-kicker">SALT-OKUMA</span>
            <h2>n8n kaynakları</h2>
          </div>
          <div className="nx-tabbar" role="tablist">
            <button
              className={tab === "workflows" ? "active" : ""}
              onClick={() => setTab("workflows")}
              role="tab"
            >
              Workflows <b>{workflows.length}</b>
            </button>
            <button
              className={tab === "executions" ? "active" : ""}
              onClick={() => setTab("executions")}
              role="tab"
            >
              Executions <b>{executions.length}</b>
            </button>
          </div>
          <button
            className="icon-button"
            disabled={!liveOwner || busy === `load-${tab}`}
            onClick={() => loadList(tab)}
            aria-label="Listeyi yenile"
          >
            <RefreshCw
              size={15}
              className={busy === `load-${tab}` ? "spin" : ""}
            />
          </button>
        </div>
        {!liveOwner || !settings.configured ? (
          <div className="nx-empty-state">
            <ListChecks size={23} />
            <strong>Canlı n8n listesi hazır değil.</strong>
            <span>
              {demo
                ? "Demo modunda dış kaynak listesi çağrılmaz."
                : "Base URL ve sunucu anahtarı ile bağlantıyı yapılandırın."}
            </span>
          </div>
        ) : tab === "workflows" ? (
          workflows.length ? (
            <div className="nx-table-wrap">
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>WORKFLOW</th>
                    <th>DURUM</th>
                    <th>WEBHOOK YOLLARI</th>
                    <th>GÜNCELLENME</th>
                  </tr>
                </thead>
                <tbody>
                  {workflows.map((workflow) => (
                    <tr key={workflow.id}>
                      <td>
                        <strong>{workflow.name}</strong>
                        <small className="nx-mono">{workflow.id}</small>
                      </td>
                      <td>
                        <Badge tone={workflow.active ? "green" : "gray"}>
                          {workflow.active ? "Aktif" : "Pasif"}
                        </Badge>
                      </td>
                      <td>
                        {workflow.webhookPaths?.length ? (
                          <span className="nx-path-list">
                            {workflow.webhookPaths.join(" · ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{date(workflow.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Workflow listesi boş"
              description="n8n yönetim API’si güvenli özet döndürdüğünde kayıtlar burada görünür."
            />
          )
        ) : executions.length ? (
          <div className="nx-table-wrap">
            <table className="nx-table">
              <thead>
                <tr>
                  <th>EXECUTION</th>
                  <th>DURUM</th>
                  <th>MOD</th>
                  <th>BAŞLANGIÇ</th>
                  <th>BİTİŞ</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((execution) => (
                  <tr key={execution.id}>
                    <td>
                      <strong className="nx-mono">{execution.id}</strong>
                      <small>
                        {execution.workflowId || "Workflow bilinmiyor"}
                      </small>
                    </td>
                    <td>
                      <Badge
                        tone={
                          execution.status === "success"
                            ? "green"
                            : execution.status === "error"
                              ? "red"
                              : "gray"
                        }
                      >
                        {execution.status || "—"}
                      </Badge>
                    </td>
                    <td>{execution.mode || "—"}</td>
                    <td>{date(execution.startedAt)}</td>
                    <td>{date(execution.stoppedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Execution geçmişi boş"
            description="n8n execution payload’ları CRM’e aktarılmaz; yalnızca güvenli özetler gösterilir."
          />
        )}
      </section>

      <div className="nx-two-column">
        <section className="nx-card nx-rule-card">
          <div className="nx-card-heading">
            <div className="nx-icon">
              <Activity size={19} />
            </div>
            <div>
              <span className="nx-kicker">CRM OTOMASYONU</span>
              <h2>Statüden n8n kuralı üret</h2>
            </div>
          </div>
          <p className="nx-card-intro">
            Kural mevcut CRM outbox altyapısına pending olay ekler. Otomatik
            workflow oluşturmaz, düzenlemez veya aktive etmez.
          </p>
          <form className="nx-form nx-rule-form" onSubmit={saveRule}>
            <label>
              Kural adı
              <input
                value={ruleName}
                onChange={(event) => setRuleName(event.target.value)}
                placeholder="Örn. Nitelikli lead’i n8n’e aktar"
              />
            </label>
            <label>
              CRM statüsü
              <select
                value={ruleStage}
                onChange={(event) => setRuleStage(event.target.value as Stage)}
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pipeline
              <select
                value={rulePipeline}
                onChange={(event) => setRulePipeline(event.target.value)}
              >
                <option value="all">Tüm pipeline’lar</option>
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary" disabled={busy === "rule" || demo}>
              {busy === "rule" ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Send size={15} />
              )}{" "}
              n8n kuralını kaydet
            </button>
          </form>
        </section>

        <section className="nx-card nx-delivery-card">
          <div className="nx-card-heading">
            <div className="nx-icon nx-icon-cyan">
              <Play size={19} />
            </div>
            <div>
              <span className="nx-kicker">AÇIK TEST AKSİYONU</span>
              <h2>Gerçek olay kuyruğa al</h2>
            </div>
          </div>
          <p className="nx-card-intro">
            Bu düğme demo değildir: seçilen CRM lead’i n8n üretim webhook’una
            gönderilmek üzere outbox’a eklenir.
          </p>
          <label className="nx-form-label">
            Müşteri
            <select
              value={selectedLead}
              onChange={(event) => setSelectedLead(event.target.value)}
            >
              {data.leads.length ? (
                data.leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} · {lead.stage}
                  </option>
                ))
              ) : (
                <option value="">Müşteri yok</option>
              )}
            </select>
          </label>
          <button
            className="btn secondary nx-real-action"
            disabled={busy === "delivery" || demo || !selectedLead}
            onClick={queueTestDelivery}
          >
            {busy === "delivery" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Send size={15} />
            )}{" "}
            Gerçek lead.updated olayı kuyruğa al
          </button>
          <div className="nx-inline-warning">
            <ShieldCheck size={15} /> Gönderim, seçtiğinizde ve canlı owner
            modunda yapılır.
          </div>
        </section>
      </div>

      <section className="nx-card nx-events-card">
        <div className="nx-card-heading">
          <div className="nx-icon">
            <Activity size={19} />
          </div>
          <div>
            <span className="nx-kicker">CRM OLAY GÜNLÜĞÜ</span>
            <h2>Son n8n olayları</h2>
          </div>
          <Badge>{recentN8nEvents.length} olay</Badge>
        </div>
        {recentN8nEvents.length ? (
          <div className="nx-event-list">
            {recentN8nEvents.slice(0, 8).map((event) => (
              <div className="nx-event-row" key={event.id}>
                <span
                  className={`nx-event-dot ${event.status === "failed" ? "failed" : event.status === "completed" ? "completed" : "pending"}`}
                />
                <div>
                  <strong>{event.title || event.type}</strong>
                  <span>{event.detail || "n8n olayı"}</span>
                </div>
                <Badge
                  tone={
                    event.status === "failed"
                      ? "red"
                      : event.status === "completed"
                        ? "green"
                        : "amber"
                  }
                >
                  {event.status}
                </Badge>
                <time>{date(event.createdAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="Henüz n8n olayı yok"
            description="Inbound tekrar koruması ve outbox teslimat sonuçları bu listede görünür."
          />
        )}
      </section>

      <div className="nx-two-column nx-bottom-grid">
        <section className="nx-card nx-json-card">
          <div className="nx-card-heading">
            <div className="nx-icon">
              <Code2 size={19} />
            </div>
            <div>
              <span className="nx-kicker">EVENT CONTRACT</span>
              <h2>Örnek güvenli olay</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => copy(eventExample)}
              aria-label="Örnek olayı kopyala"
            >
              <Clipboard size={15} />
            </button>
          </div>
          <pre>
            <code>{eventExample}</code>
          </pre>
        </section>
        <section className="nx-card nx-doc-card">
          <div className="nx-card-heading">
            <div className="nx-icon nx-icon-cyan">
              <ShieldCheck size={19} />
            </div>
            <div>
              <span className="nx-kicker">RESMÎ SÖZLEŞMELER</span>
              <h2>Kimlik doğrulama notu</h2>
            </div>
          </div>
          <p>
            n8n Public API anahtarı ile webhook node kimlik doğrulaması aynı şey
            değildir. Yönetim API anahtarını inbound veya generic webhook
            hedeflerine kopyalamayın.
          </p>
          <div className="nx-doc-links">
            <a
              href="https://docs.n8n.io/connect/n8n-api/authentication/"
              target="_blank"
              rel="noreferrer"
            >
              n8n Public API authentication <ExternalLink size={13} />
            </a>
            <a
              href="https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/"
              target="_blank"
              rel="noreferrer"
            >
              Webhook node dokümantasyonu <ExternalLink size={13} />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
