import "../automation-policy.css";
import { availablePipelines, getPipelineStages } from "../suite";
import { useState } from "react";
import {
  Plus,
  Workflow,
  MessageCircle,
  Phone,
  CheckSquare,
  Webhook,
  ArrowRight,
  Play,
  Clock,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Rule, Lead, lines, formatPhone } from "../data";
import { useStore } from "../store";
import { PageTitle, Badge, Toggle, Modal, Empty } from "../components/ui";
import {
  DEFAULT_AUTOMATION_POLICY,
  evaluateAutomationPolicy,
  type AutomationCondition,
  type AutomationConditionField,
  type AutomationConditionOperator,
  type AutomationPolicy,
  type AutomationPolicyEvaluation,
} from "../../../../shared/automation-policy";

const actionNames = {
  task: "Danışmana görev oluştur",
  whatsapp: "WhatsApp mesajı gönder",
  vapi: "Vapi AI araması başlat",
  webhook: "Webhook gönder",
};
const icons = {
  task: CheckSquare,
  whatsapp: MessageCircle,
  vapi: Phone,
  webhook: Webhook,
};
const conditionFields: { value: AutomationConditionField; label: string }[] = [
  { value: "city", label: "Şehir" },
  { value: "source", label: "Kaynak" },
  { value: "owner", label: "Sorumlu" },
  { value: "value", label: "Fırsat değeri" },
  { value: "phone", label: "Telefon" },
  { value: "email", label: "E-posta" },
  { value: "tags", label: "Etiket" },
];
const operatorLabels: Record<AutomationConditionOperator, string> = {
  eq: "eşittir",
  neq: "eşit değildir",
  contains: "içerir",
  gte: "en az",
  lte: "en çok",
  isEmpty: "boşsa",
  isNotEmpty: "doluysa",
};
const textOperators: AutomationConditionOperator[] = [
  "eq",
  "neq",
  "contains",
  "isEmpty",
  "isNotEmpty",
];
const valueOperators: AutomationConditionOperator[] = [
  "eq",
  "neq",
  "gte",
  "lte",
  "isEmpty",
  "isNotEmpty",
];

type DryRunResult = AutomationPolicyEvaluation & {
  ruleId?: string;
  leadId?: string;
  dryRun?: boolean;
  active?: boolean;
  policyEligible?: boolean;
};

function policyFor(rule: Rule): AutomationPolicy {
  if (!rule.policy) return { ...DEFAULT_AUTOMATION_POLICY, conditions: [] };
  return {
    ...rule.policy,
    conditions: rule.policy.conditions.map((condition) => ({ ...condition })),
  };
}

function operatorsFor(
  field: AutomationConditionField,
): AutomationConditionOperator[] {
  return field === "value" ? valueOperators : textOperators;
}

function policySummary(policy: AutomationPolicy | undefined): string {
  const current = policy || DEFAULT_AUTOMATION_POLICY;
  const count = current.conditions.length;
  const mode = count > 1 ? (current.mode === "all" ? "AND" : "OR") : "";
  const delay = current.delayMinutes
    ? `${current.delayMinutes} dk sonra`
    : "Hemen";
  return `${count ? `${count} koşul${mode ? ` · ${mode}` : ""}` : "Koşul yok"} · ${delay}${current.businessHours ? " · Türkiye mesai saati" : ""}`;
}

function planTime(runAt: string | null): string {
  if (!runAt) return "Çalışmayacak";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(runAt));
}

function conditionLabel(condition: AutomationCondition): string {
  const field = conditionFields.find(
    (item) => item.value === condition.field,
  )?.label;
  return `${field || condition.field} ${operatorLabels[condition.op]}`;
}

export default function Automations() {
  const { data, saveRule, demo, request } = useStore();
  const [editing, setEditing] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<DryRunResult | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [tab, setTab] = useState("rules");
  const displayStages = getPipelineStages(data.pipelines, editing?.pipelineId);
  const selectedLead =
    data.leads.find((lead) => lead.id === selectedLeadId) || data.leads[0];

  const openEditor = (rule: Rule) => {
    setEditing(rule);
    setSelectedLeadId(data.leads[0]?.id || "");
    setTestResult(null);
  };
  const create = () => {
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      triggerStage: "new",
      action: "task",
      enabled: true,
      config: {},
    });
    setSelectedLeadId(data.leads[0]?.id || "");
    setTestResult(null);
  };
  const updateEditing = (patch: Partial<Rule>) => {
    setEditing((current) => (current ? { ...current, ...patch } : current));
    setTestResult(null);
  };
  const updatePolicy = (patch: Partial<AutomationPolicy>) => {
    if (!editing) return;
    const current = policyFor(editing);
    updateEditing({
      policy: {
        ...current,
        ...patch,
        conditions: patch.conditions || current.conditions,
      },
    });
  };
  const updateCondition = (
    index: number,
    patch: Partial<AutomationCondition>,
  ) => {
    if (!editing) return;
    const policy = policyFor(editing);
    updatePolicy({
      conditions: policy.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    });
  };
  const addCondition = () => {
    if (!editing) return;
    const policy = policyFor(editing);
    if (policy.conditions.length >= 50) return;
    updatePolicy({
      conditions: [
        ...policy.conditions,
        { field: "city", op: "eq", value: "" },
      ],
    });
  };
  const removeCondition = (index: number) => {
    if (!editing) return;
    const policy = policyFor(editing);
    updatePolicy({
      conditions: policy.conditions.filter(
        (_, conditionIndex) => conditionIndex !== index,
      ),
    });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("Kural adı gerekli.");
      return;
    }
    if (
      editing.action === "webhook" &&
      !editing.config.url?.startsWith("https://")
    ) {
      toast.error("Webhook için HTTPS adresi girin.");
      return;
    }
    if (editing.policy) {
      const delay = editing.policy.delayMinutes;
      if (
        !Number.isInteger(delay) ||
        delay < 0 ||
        (delay > 0 && delay < 10) ||
        delay > 10080
      ) {
        toast.error("Gecikme 0 veya 10–10080 dakika arasında olmalı.");
        return;
      }
    }
    setBusy(true);
    try {
      await saveRule(editing);
      setEditing(null);
      setTestResult(null);
      toast.success("Otomasyon kuralı kaydedildi.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function dryRun() {
    if (!editing || !selectedLead) {
      toast.error("Test için görünür bir müşteri seçin.");
      return;
    }
    setTestBusy(true);
    setTestResult(null);
    try {
      const result = demo
        ? (() => {
            const evaluation = evaluateAutomationPolicy(
              editing,
              selectedLead,
              new Date(),
            );
            return {
              ...evaluation,
              active: editing.enabled,
              policyEligible: evaluation.eligible,
              eligible: evaluation.eligible && editing.enabled,
              runAt:
                evaluation.eligible && editing.enabled
                  ? evaluation.runAt
                  : null,
              reason: editing.enabled
                ? evaluation.reason
                : "Kural pasif; çalışmayacak.",
            };
          })()
        : await request("/api/automations/dry-run", {
            rule: editing,
            leadId: selectedLead.id,
          });
      const plan = (result?.plan || result) as DryRunResult;
      setTestResult(plan);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="İŞ AKIŞI YÖNETİMİ"
        title="Rutin işler otomatik, odağınız satış."
        description="CRM aşaması değiştiğinde doğru adımı, doğru zamanda tetikleyin."
        actions={
          <button className="btn primary" onClick={create}>
            <Plus size={17} />
            Yeni otomasyon
          </button>
        }
      />
      <div className="automation-intro">
        <div className="automation-visual">
          <span>
            <Workflow size={24} />
          </span>
          <i />
          <span>
            <MessageCircle size={24} />
          </span>
          <i />
          <span>
            <CheckSquare size={24} />
          </span>
        </div>
        <div>
          <h3>Bir aşama değişimi. Bir sonraki doğru adım.</h3>
          <p>
            WhatsApp ile karşılayın, danışmana görev atayın veya yapay zekâ ile
            takip edin.
          </p>
        </div>
        <Badge tone="green">
          {data.rules.filter((r) => r.enabled).length} aktif kural
        </Badge>
      </div>
      <div className="page-tabs">
        <button
          className={tab === "rules" ? "active" : ""}
          onClick={() => setTab("rules")}
        >
          Otomasyon kuralları<Badge>{data.rules.length}</Badge>
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          Çalışma geçmişi
        </button>
      </div>
      {tab === "rules" ? (
        <div className="rule-list">
          {data.rules.map((r) => {
            const Icon = icons[r.action];
            return (
              <article className="rule-card" key={r.id}>
                <div
                  className={`rule-icon ${r.action === "whatsapp" ? "green" : r.action === "vapi" ? "purple" : "blue"}`}
                >
                  <Icon size={23} />
                </div>
                <div className="rule-content">
                  <h3>
                    {r.name}
                    <Badge tone={r.enabled ? "green" : "gray"}>
                      {r.enabled ? "Aktif" : "Duraklatıldı"}
                    </Badge>
                  </h3>
                  <div className="rule-flow">
                    <span>
                      {availablePipelines(data.pipelines).find(
                        (p) => p.id === r.pipelineId,
                      )?.name || "Tüm huniler"}{" "}
                      · Müşteri aşaması
                    </span>
                    <b>
                      {
                        getPipelineStages(data.pipelines, r.pipelineId).find(
                          (s) => s.id === r.triggerStage,
                        )?.label
                      }
                    </b>
                    <ArrowRight size={15} />
                    <span>{actionNames[r.action]}</span>
                  </div>
                  <div className="automation-rule-policy">
                    <Badge
                      tone={r.policy?.conditions.length ? "amber" : "gray"}
                    >
                      {r.policy?.conditions.length
                        ? `${r.policy.conditions.length} koşul · ${r.policy.mode === "all" ? "AND" : "OR"}`
                        : "Koşulsuz"}
                    </Badge>
                    <span>
                      <Clock size={13} /> {policySummary(r.policy)}
                    </span>
                  </div>
                  <p>
                    {r.config.template ||
                      "Entegrasyon ayarlarıyla çalışır · Olay kimliği ile tekrar koruması"}
                  </p>
                </div>
                <button className="text-button" onClick={() => openEditor(r)}>
                  Düzenle
                </button>
                <Toggle
                  value={r.enabled}
                  label={`${r.name} etkinliği`}
                  onChange={async () => {
                    try {
                      await saveRule({ ...r, enabled: !r.enabled });
                      toast.success(
                        r.enabled
                          ? "Kural duraklatıldı."
                          : "Kural etkinleştirildi.",
                      );
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                />
              </article>
            );
          })}
          {!data.rules.length && (
            <Empty
              title="İlk otomasyonunuzu oluşturun"
              description="Bir CRM aşaması ve yapılacak işlemi seçin."
            />
          )}
          <button className="new-rule" onClick={create}>
            <Plus size={21} />
            <span>Yeni bir iş akışı oluşturun</span>
            <small>Müşteri sürecinize bir sonraki adımı ekleyin</small>
          </button>
        </div>
      ) : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>OLAY</th>
                  <th>TÜR</th>
                  <th>DURUM</th>
                  <th>ZAMAN</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.title}</strong>
                      <p className="table-detail">{e.detail}</p>
                    </td>
                    <td>
                      <Badge>{e.type}</Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          e.status === "failed"
                            ? "red"
                            : e.status === "demo"
                              ? "amber"
                              : "green"
                        }
                      >
                        {e.status === "demo" ? "Demo" : e.status}
                      </Badge>
                    </td>
                    <td>{new Date(e.createdAt).toLocaleString("tr-TR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="info-banner slim">
        <ShieldCheck size={17} />
        <p>
          {demo
            ? "Demo kurallarında dış mesaj, webhook veya arama gönderilmez. Görevler ve statü hareketleri örnek geçmişe kaydedilir."
            : "Dış iletişim kuralları sağlayıcı kimlik bilgileri gerektirir. Hatalar işlem günlüğüne kaydedilir."}
        </p>
      </div>
      {editing && (
        <Modal
          title="Otomasyon kuralı"
          subtitle="Tetikleyiciyi, koşulları ve yapılacak işlemi belirleyin."
          onClose={() => {
            setEditing(null);
            setTestResult(null);
          }}
          wide
        >
          <form onSubmit={save}>
            <div className="modal-content form-grid">
              <label className="full">
                Kural adı
                <input
                  required
                  placeholder="Örn. Yeni müşteri karşılama"
                  value={editing.name}
                  onChange={(e) => updateEditing({ name: e.target.value })}
                />
              </label>
              <label className="full">
                Satış hunisi
                <select
                  value={editing.pipelineId || "all"}
                  onChange={(e) =>
                    updateEditing({ pipelineId: e.target.value })
                  }
                >
                  <option value="all">Tüm satış hunileri</option>
                  {availablePipelines(data.pipelines).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                Müşteri bu aşamaya geçtiğinde
                <select
                  value={editing.triggerStage}
                  onChange={(e) =>
                    updateEditing({
                      triggerStage: e.target.value as Rule["triggerStage"],
                    })
                  }
                >
                  {displayStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <section
                className="automation-policy-panel full"
                aria-label="Otomasyon politikası"
              >
                <div className="automation-policy-heading">
                  <div>
                    <h3>Koşullar ve zamanlama</h3>
                    <p>Eski kurallar koşulsuz ve hemen çalışmaya devam eder.</p>
                  </div>
                  <Badge>{policySummary(editing.policy)}</Badge>
                </div>
                <div className="automation-mode-row">
                  <span>Koşulların çalışma biçimi</span>
                  <div
                    className="automation-segmented"
                    role="group"
                    aria-label="Koşul modu"
                  >
                    <button
                      type="button"
                      className={
                        policyFor(editing).mode === "all" ? "active" : ""
                      }
                      onClick={() => updatePolicy({ mode: "all" })}
                    >
                      AND · tümü
                    </button>
                    <button
                      type="button"
                      className={
                        policyFor(editing).mode === "any" ? "active" : ""
                      }
                      onClick={() => updatePolicy({ mode: "any" })}
                    >
                      OR · biri
                    </button>
                  </div>
                </div>
                <div className="automation-condition-list">
                  {policyFor(editing).conditions.map((condition, index) => {
                    const validOperators = operatorsFor(condition.field);
                    return (
                      <div
                        className="automation-condition-row"
                        key={`${index}-${condition.field}`}
                      >
                        <select
                          aria-label={`Koşul ${index + 1} alanı`}
                          value={condition.field}
                          onChange={(e) => {
                            const field = e.target
                              .value as AutomationConditionField;
                            const op = operatorsFor(field)[0];
                            updateCondition(index, {
                              field,
                              op,
                              value: field === "value" ? 0 : "",
                            });
                          }}
                        >
                          {conditionFields.map((field) => (
                            <option key={field.value} value={field.value}>
                              {field.label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`Koşul ${index + 1} karşılaştırması`}
                          value={
                            validOperators.includes(condition.op)
                              ? condition.op
                              : validOperators[0]
                          }
                          onChange={(e) =>
                            updateCondition(index, {
                              op: e.target.value as AutomationConditionOperator,
                              value:
                                e.target.value === "isEmpty" ||
                                e.target.value === "isNotEmpty"
                                  ? ""
                                  : condition.value,
                            })
                          }
                        >
                          {validOperators.map((operator) => (
                            <option key={operator} value={operator}>
                              {operatorLabels[operator]}
                            </option>
                          ))}
                        </select>
                        {condition.op === "isEmpty" ||
                        condition.op === "isNotEmpty" ? (
                          <span className="automation-value-muted">
                            Değer kullanılmıyor
                          </span>
                        ) : (
                          <input
                            aria-label={`Koşul ${index + 1} değeri`}
                            type={
                              condition.field === "value" ? "number" : "text"
                            }
                            value={
                              condition.value === undefined
                                ? ""
                                : String(condition.value)
                            }
                            onChange={(e) =>
                              updateCondition(index, {
                                value:
                                  condition.field === "value" &&
                                  e.target.value !== ""
                                    ? Number(e.target.value)
                                    : e.target.value,
                              })
                            }
                            placeholder="Değer"
                          />
                        )}
                        <button
                          type="button"
                          className="automation-remove-condition"
                          onClick={() => removeCondition(index)}
                          aria-label={`Koşul ${index + 1} sil`}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="text-button automation-add-condition"
                  onClick={addCondition}
                >
                  <Plus size={15} /> Koşul ekle
                </button>
                <div className="automation-timing-grid">
                  <label>
                    Gecikme
                    <select
                      value={
                        policyFor(editing).delayMinutes === 0 ? "0" : "custom"
                      }
                      onChange={(e) =>
                        updatePolicy({
                          delayMinutes:
                            e.target.value === "0"
                              ? 0
                              : Math.max(
                                  10,
                                  policyFor(editing).delayMinutes || 10,
                                ),
                        })
                      }
                    >
                      <option value="0">Hemen</option>
                      <option value="custom">Gecikmeli</option>
                    </select>
                  </label>
                  {policyFor(editing).delayMinutes > 0 && (
                    <label>
                      Dakika (10–10080)
                      <input
                        type="number"
                        min="10"
                        max="10080"
                        step="1"
                        value={policyFor(editing).delayMinutes}
                        onChange={(e) =>
                          updatePolicy({
                            delayMinutes:
                              e.target.value === ""
                                ? 10
                                : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="automation-checkbox-label">
                    <input
                      type="checkbox"
                      checked={policyFor(editing).businessHours}
                      onChange={(e) =>
                        updatePolicy({ businessHours: e.target.checked })
                      }
                    />
                    Yalnızca Türkiye mesai saatleri (Pzt–Cum, 09:00–18:00)
                  </label>
                </div>
                <div className="automation-dry-run">
                  <div>
                    <strong>Kuralı müşteriyle test et</strong>
                    <small>
                      Müşterinin tetikleme aşamasına girdiği varsayımıyla, dış
                      işlem yapmadan test edilir. Mesaj, arama veya webhook
                      gönderilmez.
                    </small>
                  </div>
                  <div className="automation-dry-run-actions">
                    <select
                      aria-label="Test müşterisi"
                      value={selectedLead?.id || ""}
                      onChange={(e) => setSelectedLeadId(e.target.value)}
                      disabled={!data.leads.length}
                    >
                      {!data.leads.length && (
                        <option value="">Görünür müşteri yok</option>
                      )}
                      {data.leads.map((lead) => (
                        <option key={lead.id} value={lead.id}>
                          {lead.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={dryRun}
                      disabled={testBusy || !selectedLead}
                    >
                      <Play size={15} />{" "}
                      {testBusy ? "Test ediliyor…" : "Test et"}
                    </button>
                  </div>
                </div>
                {testResult && (
                  <div
                    className={`automation-test-result ${testResult.eligible ? "eligible" : "ineligible"}`}
                    role="alert"
                  >
                    <div className="automation-test-result-heading">
                      <strong>
                        {testResult.eligible
                          ? "Kural çalışır"
                          : "Kural çalışmaz"}
                      </strong>
                      <button
                        type="button"
                        onClick={() => setTestResult(null)}
                        aria-label="Test sonucunu temizle"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <p>{testResult.reason}</p>
                    <span>
                      {testResult.eligible
                        ? `Planlanan zaman: ${planTime(testResult.runAt)}`
                        : "Plan oluşturulmadı."}
                    </span>
                    {!!testResult.conditionResults.length && (
                      <ul>
                        {testResult.conditionResults.map((result, index) => (
                          <li key={`${result.field}-${result.op}-${index}`}>
                            <b>
                              {conditionLabel(result as AutomationCondition)}
                            </b>
                            : {result.matched ? "uygun" : "uygun değil"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              <label className="full">
                Yapılacak işlem
                <select
                  value={editing.action}
                  onChange={(e) =>
                    updateEditing({ action: e.target.value as Rule["action"] })
                  }
                >
                  {Object.entries(actionNames).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {(["task", "whatsapp"] as string[]).includes(editing.action) && (
                <label className="full">
                  {editing.action === "task"
                    ? "Görev açıklaması"
                    : "Mesaj metni"}
                  <textarea
                    rows={3}
                    required
                    value={editing.config.template || ""}
                    onChange={(e) =>
                      updateEditing({
                        config: { ...editing.config, template: e.target.value },
                      })
                    }
                    placeholder="Görev ya da mesaj içeriğini yazın…"
                  />
                </label>
              )}
              {editing.action === "task" && (
                <>
                  <label>
                    Sorumlu
                    <select
                      value={editing.config.assignee || ""}
                      onChange={(e) =>
                        updateEditing({
                          config: {
                            ...editing.config,
                            assignee: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Fırsatın sorumlusu</option>
                      {data.members.map((m) => (
                        <option key={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Son tarih (saat sonra)
                    <input
                      type="number"
                      min="1"
                      max="720"
                      value={editing.config.dueHours || "24"}
                      onChange={(e) =>
                        updateEditing({
                          config: {
                            ...editing.config,
                            dueHours: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </>
              )}
              {editing.action === "webhook" && (
                <label className="full">
                  Hedef HTTPS adresi
                  <input
                    type="url"
                    required
                    value={editing.config.url || ""}
                    onChange={(e) =>
                      updateEditing({
                        config: { ...editing.config, url: e.target.value },
                      })
                    }
                    placeholder="https://uygulama.com/webhook"
                  />
                </label>
              )}
              {["whatsapp", "vapi"].includes(editing.action) && (
                <label className="full">
                  Gönderen hat
                  <select
                    value={editing.config.lineId || ""}
                    required
                    onChange={(e) =>
                      updateEditing({
                        config: { ...editing.config, lineId: e.target.value },
                      })
                    }
                  >
                    <option value="">Hat seçin</option>
                    {lines
                      .filter(
                        (l) => editing.action !== "vapi" || l.group === "ai",
                      )
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {formatPhone(l.phone)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {editing.action === "vapi" && (
                <label className="full">
                  Vapi asistan kimliği
                  <input
                    value={editing.config.assistantId || ""}
                    onChange={(e) =>
                      updateEditing({
                        config: {
                          ...editing.config,
                          assistantId: e.target.value,
                        },
                      })
                    }
                    placeholder="Varsayılan asistan için boş bırakın"
                  />
                </label>
              )}
              <div className="full toggle-row">
                <span>Kural etkin</span>
                <Toggle
                  label="Kural etkin"
                  value={editing.enabled}
                  onChange={() => updateEditing({ enabled: !editing.enabled })}
                />
              </div>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setEditing(null);
                  setTestResult(null);
                }}
              >
                Vazgeç
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? "Kaydediliyor…" : "Kuralı kaydet"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
