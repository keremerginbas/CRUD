import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Sparkles,
  Send,
  X,
  ArrowUpRight,
  Download,
  Check,
  ChevronRight,
  ShieldCheck,
  CalendarDays,
  LoaderCircle,
  MessageSquare,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { useStore } from "../store";
import { Badge, Modal } from "./ui";
import { lines, formatPhone, money } from "../data";
import {
  availablePipelines,
  baseStages,
  localDateInput,
  toIso,
} from "../suite";
import {
  applyAssistantAction,
  actionLabels,
  actionFields,
  fieldLabels,
} from "../assistant-actions";
import {
  makeDemoAssistantResponse,
  reportToMarkdown,
} from "../../../../shared/assistant";
import type {
  AssistantAction,
  AssistantResponse,
} from "../../../../shared/assistant";
import "../assistant.css";
export type ChatItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  actions?: AssistantAction[];
  report?: any;
  sources?: any[];
  applied?: string[];
  archived?: boolean;
};
type AIContext = {
  items: ChatItem[];
  busy: boolean;
  error: string;
  status: any;
  open: boolean;
  setOpen: (v: boolean) => void;
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  send: (text: string, report?: boolean) => Promise<void>;
  clear: () => void;
  review: (a: AssistantAction) => void;
  context: { path: string; leadId?: string };
};
const Context = createContext<AIContext>(null!);
export const useAssistant = () => useContext(Context);
export const todayTurkey = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function RichText({ text }: { text: string }) {
  return (
    <div className="ai-rich-text">
      {text.split("\n").map((line, i) => {
        const strong = line
          .split(/(\*\*[^*]+\*\*)/g)
          .map((part, k) =>
            part.startsWith("**") ? (
              <strong key={k}>{part.slice(2, -2)}</strong>
            ) : (
              part
            ),
          );
        return line.startsWith("### ") ? (
          <h4 key={i}>{line.slice(4)}</h4>
        ) : line.startsWith("## ") ? (
          <h3 key={i}>{line.slice(3)}</h3>
        ) : line.startsWith("# ") ? (
          <h3 key={i}>{line.slice(2)}</h3>
        ) : line ? (
          <p className={/^[-•]\s/.test(line) ? "ai-bullet" : ""} key={i}>
            {strong}
          </p>
        ) : (
          <div className="ai-text-gap" key={i} />
        );
      })}
    </div>
  );
}
export function downloadAIReport(item: ChatItem) {
  const text = item.report
    ? reportToMarkdown({
        ...item,
        answer: item.content,
        report: item.report,
      } as any)
    : `# XRE CRM · Yapay zekâ analizi\n\n${item.content}\n\n${item.createdAt}\n`;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `xre-crm-rapor-${todayTurkey()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
export function AssistantProvider({
  children,
  path,
  leadId,
}: {
  children: React.ReactNode;
  path: string;
  leadId?: string;
}) {
  const store = useStore();
  const { demo, user, request, data } = store;
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<any>({ configured: false });
  const [from, setFrom] = useState(todayTurkey());
  const [to, setTo] = useState(todayTurkey());
  const [editing, setEditing] = useState<AssistantAction | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [applying, setApplying] = useState(false);
  const session = useRef(0);
  const activeRef = useRef(false);
  const applyingRef = useRef(false);
  useEffect(() => {
    session.current++;
    activeRef.current = false;
    setItems([]);
    setError("");
    setBusy(false);
    if (demo) {
      setStatus({
        configured: true,
        model: "Yerel örnek yanıt",
        provider: "Demo",
      });
      try {
        setItems(
          JSON.parse(localStorage.getItem("xre-ai-demo-v1") || "[]").map(
            (m: ChatItem) => ({ ...m, archived: true }),
          ),
        );
      } catch {}
    } else if (user?.canAccess !== false && user) {
      const current = session.current;
      request("/api/assistant/status")
        .then((r) => {
          if (current === session.current) setStatus(r);
        })
        .catch(() => setStatus({ configured: false }));
      request("/api/assistant/history")
        .then((r) => {
          if (current === session.current)
            setItems(
              (r.messages || [])
                .slice(-40)
                .map((m: ChatItem) => ({ ...m, archived: true })),
            );
        })
        .catch(() => {});
    } else setStatus({ configured: false });
  }, [demo, user?.openId]);
  useEffect(() => {
    if (demo)
      localStorage.setItem("xre-ai-demo-v1", JSON.stringify(items.slice(-40)));
  }, [items, demo]);
  const send = async (text: string, report = false) => {
    report = report || /rapor|report/i.test(text);
    const clean = text.trim();
    if (!clean || activeRef.current) return;
    if (!demo && (!user || user.canAccess === false)) {
      setError("Gerçek CRM analizi için yetkili sahip oturumu gerekli.");
      return;
    }
    activeRef.current = true;
    setBusy(true);
    setError("");
    const current = session.current;
    const question: ChatItem = {
      id: crypto.randomUUID(),
      role: "user",
      content: clean,
      createdAt: new Date().toISOString(),
    };
    setItems((x) => [...x, question]);
    const context = { path, leadId };
    try {
      const input = {
        message: clean,
        history: items
          .slice(-12)
          .map((x) => ({ role: x.role, content: x.content.slice(0, 4000) })),
        context,
        ...(report ? { dateRange: { from, to } } : {}),
        clientMessageId: question.id,
      };
      const result: AssistantResponse = demo
        ? await Promise.resolve(
            makeDemoAssistantResponse({
              ...input,
              ...(report ? { dateRange: { from, to } } : {}),
              state: data,
            } as any),
          )
        : await request(
            report ? "/api/assistant/report" : "/api/assistant/chat",
            report
              ? {
                  from,
                  to,
                  context,
                  message: clean,
                  clientMessageId: question.id,
                  history: input.history,
                }
              : input,
          );
      if (current !== session.current) return;
      setItems((x) => [
        ...x,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          createdAt: result.generatedAt || new Date().toISOString(),
          actions: result.actions || [],
          report: result.report,
          sources: result.sources || [],
        },
      ]);
    } catch (e) {
      if (current === session.current)
        setError((e as Error).message || "Asistan yanıtı alınamadı.");
    } finally {
      if (current === session.current) {
        setBusy(false);
        activeRef.current = false;
      }
    }
  };
  const review = (a: AssistantAction) => {
    setEditing(a);
    setValues({
      ...a.payload,
      ...(a.payload.patch && typeof a.payload.patch === "object"
        ? a.payload.patch
        : {}),
      ...(a.payload.config && typeof a.payload.config === "object"
        ? a.payload.config
        : {}),
    });
  };
  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    if (["message", "call"].includes(editing.kind)) {
      const actionId = editing.id;
      setItems((x) =>
        x.map((m) =>
          m.actions?.some((a) => a.id === actionId)
            ? { ...m, applied: [...(m.applied || []), actionId] }
            : m,
        ),
      );
    }
    try {
      const message = await applyAssistantAction(editing, values, store);
      toast.success(message);
      const actionId = editing.id;
      setItems((x) =>
        x.map((m) =>
          m.actions?.some((a) => a.id === actionId)
            ? { ...m, applied: [...(m.applied || []), actionId] }
            : m,
        ),
      );
      setEditing(null);
    } catch (e) {
      toast.error((e as Error).message);
      if (["message", "call"].includes(editing.kind)) setEditing(null);
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };
  const field = (key: string) => {
    const rawValue = values[key] ?? "";
    const value = Array.isArray(rawValue)
      ? rawValue.join(", ")
      : rawValue && typeof rawValue === "object"
        ? JSON.stringify(rawValue)
        : rawValue;
    const set = (v: any) => setValues((x) => ({ ...x, [key]: v }));
    if (["enabled", "completed"].includes(key))
      return (
        <label className="ai-check" key={key}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => set(e.target.checked)}
          />
          {fieldLabels[key]}
        </label>
      );
    let options: { value: string; label: string }[] = [];
    if (key === "leadId")
      options = data.leads.map((l) => ({ value: l.id, label: l.name }));
    if (key === "lineId")
      options = lines
        .filter((l) => editing?.kind !== "call" || l.group === "ai")
        .map((l) => ({ value: l.id, label: formatPhone(l.phone) }));
    if (key === "contactId")
      options = data.contacts.map((c) => ({ value: c.id, label: c.name }));
    if (key === "companyId")
      options = data.companies.map((c) => ({ value: c.id, label: c.name }));
    if (key === "pipelineId")
      options = availablePipelines(data.pipelines).map((p) => ({
        value: p.id,
        label: p.name,
      }));
    if (["stage", "triggerStage"].includes(key))
      options = baseStages.map((s) => ({ value: s.id, label: s.label }));
    if (key === "priority")
      options = [
        ["low", "Düşük"],
        ["normal", "Normal"],
        ["high", "Yüksek"],
      ].map(([value, label]) => ({ value, label }));
    if (key === "status")
      options = [
        ["todo", "Yapılacak"],
        ["progress", "Devam ediyor"],
        ["done", "Tamamlandı"],
      ].map(([value, label]) => ({ value, label }));
    if (key === "type")
      options = [
        ["meeting", "Toplantı"],
        ["call", "Arama planı"],
        ["task", "Görev etkinliği"],
      ].map(([value, label]) => ({ value, label }));
    if (key === "action")
      options = [
        ["task", "Görev oluştur"],
        ["whatsapp", "WhatsApp gönder"],
        ["vapi", "Vapi arama"],
        ["webhook", "Webhook gönder"],
      ].map(([value, label]) => ({ value, label }));
    return (
      <label
        key={key}
        className={
          ["notes", "description", "text", "template"].includes(key)
            ? "ai-full"
            : ""
        }
      >
        {fieldLabels[key] || key}
        {options.length || ["leadId", "lineId", "companyId"].includes(key) ? (
          <select value={value} onChange={(e) => set(e.target.value)}>
            <option value="">Seçin / boş bırakın</option>
            {options.map((o) => (
              <option value={o.value} key={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : ["dueAt", "startAt", "endAt"].includes(key) ? (
          <input
            type="datetime-local"
            value={localDateInput(value)}
            onChange={(e) => set(toIso(e.target.value))}
          />
        ) : ["notes", "description", "text", "template"].includes(key) ? (
          <textarea
            rows={3}
            value={value}
            onChange={(e) => set(e.target.value)}
          />
        ) : (
          <input
            value={value}
            type={
              ["value", "probability"].includes(key)
                ? "number"
                : key === "email"
                  ? "email"
                  : "text"
            }
            onChange={(e) =>
              set(
                ["value", "probability"].includes(key)
                  ? Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        )}
      </label>
    );
  };
  return (
    <Context.Provider
      value={{
        items,
        busy,
        error,
        status,
        open,
        setOpen,
        from,
        to,
        setFrom,
        setTo,
        send,
        clear: () => {
          setItems([]);
          setError("");
        },
        review,
        context: { path, leadId },
      }}
    >
      {children}
      {editing && (
        <Modal
          wide
          title={`${actionLabels[editing.kind]} · ${editing.operation === "update" ? "Düzenle" : "Oluştur"}`}
          subtitle="Asistanın önerisini kontrol edin; aşağıdaki işlem CRM’ye uygulanacaktır."
          onClose={() => {
            if (!applying) setEditing(null);
          }}
        >
          <form onSubmit={apply}>
            <div className="modal-content">
              <div className="ai-review-summary">
                <Sparkles size={18} />
                <span>{editing.summary}</span>
              </div>
              {["message", "call"].includes(editing.kind) && (
                <div className="ai-action-warning">
                  <ShieldCheck size={18} />
                  <p>
                    {demo
                      ? "Demo modunda gerçek iletişim gönderilmez."
                      : "Bu işlem seçili müşteriye gerçek mesaj veya arama gönderir. Hedefi, hattı ve metni kontrol edin."}
                  </p>
                </div>
              )}
              {editing.kind === "lead" &&
                values.stage &&
                values.stage !==
                  data.leads.find((l) => l.id === editing.recordId)?.stage && (
                  <p className="ai-action-note">
                    Aşama değişimi, etkin statü otomasyonlarını da
                    tetikleyebilir.
                  </p>
                )}
              <div className="ai-action-form">
                {(actionFields[editing.kind] || []).map(field)}
              </div>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="btn secondary"
                disabled={applying}
                onClick={() => setEditing(null)}
              >
                Vazgeç
              </button>
              <button className="btn primary" disabled={applying}>
                {applying ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}{" "}
                {applying
                  ? "Uygulanıyor…"
                  : editing.kind === "message"
                    ? "Mesajı gönder"
                    : editing.kind === "call"
                      ? "Aramayı başlat"
                      : "CRM’ye uygula"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </Context.Provider>
  );
}
export function ChatSurface({
  full = false,
  navigate,
  onLead,
}: {
  full?: boolean;
  navigate?: (p: string) => void;
  onLead?: (id: string) => void;
}) {
  const { data, demo } = useStore();
  const ai = useAssistant();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [ai.items.length, ai.busy]);
  const lead = data.leads.find((l) => l.id === ai.context.leadId);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      void ai.send(text);
      setText("");
    }
  };
  const prompts = [
    "Bugünkü CRM raporunu analiz et",
    "Geciken takipler neler?",
    "Satış hunim için önerilerin neler?",
    "Yeni bir takip görevi oluşturalım",
  ];
  return (
    <section className={`ai-chat-surface ${full ? "ai-full-chat" : ""}`}>
      <header className="ai-chat-header">
        <span className="ai-orb">
          <Sparkles size={20} />
        </span>
        <div>
          <h3>
            XRE Asistan{" "}
            <Badge tone={demo ? "amber" : "blue"}>{demo ? "Demo" : "AI"}</Badge>
          </h3>
          <p>
            {demo
              ? "Örnek CRM · dış model çağrısı yok"
              : `OpenAI · ${ai.status.model || "CRM bağlantılı"}`}
          </p>
        </div>
        {!full && (
          <>
            <button
              className="ai-header-btn"
              aria-label="Asistan merkezini aç"
              onClick={() => {
                navigate?.("/ai");
                ai.setOpen(false);
              }}
            >
              <ArrowUpRight size={17} />
            </button>
            <button
              className="ai-header-btn"
              aria-label="Asistanı kapat"
              onClick={() => ai.setOpen(false)}
            >
              <X size={18} />
            </button>
          </>
        )}
      </header>
      {lead && (
        <div className="ai-context-strip">
          <span>
            <MessageSquare size={14} />
            Müşteri bağlamı: <strong>{lead.name}</strong>
          </span>
          <button onClick={() => onLead?.(lead.id)}>
            <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <div className="ai-date-strip">
        <CalendarDays size={14} />
        <span>Rapor dönemi</span>
        <input
          aria-label="AI rapor başlangıcı"
          type="date"
          value={ai.from}
          onChange={(e) => ai.setFrom(e.target.value)}
        />
        <i>—</i>
        <input
          aria-label="AI rapor bitişi"
          type="date"
          value={ai.to}
          onChange={(e) => ai.setTo(e.target.value)}
        />
      </div>
      <div className="ai-chat-body">
        {!ai.items.length && (
          <div className="ai-welcome">
            <div className="ai-welcome-symbol">
              <Sparkles size={33} />
            </div>
            <span className="ai-eyebrow">CRM’NİN İÇİNDE, YANINIZDA</span>
            <h2>
              Birlikte sonraki adımı
              <br />
              bulalım.
            </h2>
            <p>
              Raporunuzu analiz edebilirim, müşterilerinizi bulabilirim ve takip
              işlerini hazırlayabilirim.
            </p>
            <div className="ai-prompts">
              {prompts.map((p) => (
                <button key={p} onClick={() => ai.send(p, p === prompts[0])}>
                  <MessageSquare size={14} />
                  {p}
                  <ChevronRight size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
        {ai.items.map((m) => (
          <article className={`ai-chat-item ${m.role}`} key={m.id}>
            <div className="ai-message-author">
              {m.role === "assistant" ? (
                <>
                  <Sparkles size={14} />
                  XRE Asistan
                </>
              ) : (
                <>Siz</>
              )}
              <time>
                {new Date(m.createdAt).toLocaleTimeString("tr-TR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <RichText text={m.content} />
            {m.report && (
              <div className="ai-report-card">
                <header>
                  <CalendarDays size={15} />
                  <strong>{m.report.title || "CRM raporu"}</strong>
                </header>
                <div className="ai-report-metrics">
                  {(m.report.metrics || []).slice(0, 6).map((metric: any) => (
                    <div key={metric.key || metric.label}>
                      <span>{metric.label}</span>
                      <strong>
                        {metric.unit === "TRY"
                          ? money(Number(metric.value))
                          : metric.value}
                        {metric.unit &&
                        metric.unit !== "TRY" &&
                        metric.unit !== "count"
                          ? ` ${metric.unit}`
                          : ""}
                      </strong>
                    </div>
                  ))}
                </div>
                <button onClick={() => downloadAIReport(m)}>
                  <Download size={14} />
                  Raporu indir
                </button>
              </div>
            )}
            {!!m.actions?.length && (
              <div className="ai-suggestions">
                {m.actions.map((a) => (
                  <button
                    key={a.id}
                    disabled={!!m.archived || m.applied?.includes(a.id)}
                    onClick={() => ai.review(a)}
                  >
                    <span className="ai-action-icon">
                      {m.applied?.includes(a.id) ? (
                        <Check size={16} />
                      ) : (
                        <Plus size={16} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {m.archived
                          ? "Geçmiş öneri · yeniden uygulanmaz"
                          : m.applied?.includes(a.id)
                            ? "Uygulandı"
                            : actionLabels[a.kind]}
                      </strong>
                      <small>{a.summary}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            )}
            {!!m.sources?.length && (
              <div className="ai-sources">
                {m.sources.slice(0, 6).map((source: any, i: number) => (
                  <button
                    key={source.kind + source.id + i}
                    onClick={() =>
                      source.kind === "lead"
                        ? onLead?.(source.id)
                        : source.path && navigate?.(source.path)
                    }
                  >
                    {source.label}
                    <ArrowUpRight size={10} />
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
        {ai.busy && (
          <div className="ai-thinking">
            <Sparkles size={15} />
            <span>CRM bağlamı analiz ediliyor</span>
            <i />
            <i />
            <i />
          </div>
        )}
        {ai.error && (
          <div className="ai-error" role="alert">
            {ai.error}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form className="ai-composer" onSubmit={submit}>
        <textarea
          aria-label="Asistana mesaj"
          placeholder="CRM’nizle ilgili bir soru sorun…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) {
                void ai.send(text);
                setText("");
              }
            }
          }}
        />
        <div>
          <span>
            <ShieldCheck size={12} />
            {demo
              ? "Örnek veriyle yanıtlanır"
              : "Verileriniz sunucudan, yetkili kapsamda okunur"}
          </span>
          <button
            aria-label="Asistana gönder"
            disabled={ai.busy || !text.trim()}
            type="submit"
          >
            {ai.busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </form>
      <footer className="ai-chat-footnote">
        AI önerilerini doğrulayın. İşlemler inceleme kartından uygulanır.
      </footer>
    </section>
  );
}
export function GlobalAssistant({
  navigate,
  onLead,
}: {
  navigate: (p: string) => void;
  onLead: (id: string) => void;
}) {
  const ai = useAssistant();
  return (
    <>
      {!ai.open && (
        <button
          className="ai-floating-launch"
          onClick={() => ai.setOpen(true)}
          aria-label="CRM yapay zekâ asistanını aç"
        >
          <Sparkles size={19} />
          <span>Asistana sor</span>
          <kbd>AI</kbd>
        </button>
      )}
      {ai.open && (
        <aside className="ai-sidepanel">
          <ChatSurface navigate={navigate} onLead={onLead} />
        </aside>
      )}
    </>
  );
}
