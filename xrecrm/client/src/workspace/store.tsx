import { evaluateAutomationPolicy } from "../../../shared/automation-policy";
import { resetLineInventory, setLineInventory } from "../../../shared/lines";
import {
  validateStagePolicy,
  StagePolicySchema,
} from "../../../shared/crm-stage-policy";
import AppointmentPrompt from "./components/AppointmentPrompt";
import {
  appointmentStage,
  validateAppointment,
} from "../../../shared/appointments";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { toast } from "sonner";
import { AppState, Lead, Rule, Stage, makeDemo, emptyState } from "./data";
import { RecordKind, SuiteRecord, makeSuiteDemo, Task } from "./suite";
function loadDemo(): AppState {
  try {
    const raw = JSON.parse(localStorage.getItem("xre-demo-v2") || "null");
    if (!raw) return makeDemo();
    const defaults = makeSuiteDemo();
    return {
      ...defaults,
      ...raw,
      leads: (raw.leads || []).map((l: Lead) => {
        const i = Number(l.id.replace("demo-", ""));
        return {
          ...l,
          pipelineId: l.pipelineId || "sales",
          contactId: l.contactId || (i >= 1 && i <= 5 ? `contact-${i}` : ""),
          companyId: l.companyId || (i >= 1 && i <= 3 ? `company-${i}` : ""),
        };
      }),
    };
  } catch {
    return makeDemo();
  }
}
interface Store {
  data: AppState;
  demo: boolean;
  user: any;
  loading: boolean;
  setDemo: (v: boolean) => void;
  refresh: () => Promise<void>;
  saveLead: (l: Lead) => Promise<void>;
  moveLead: (id: string, stage: Stage) => Promise<void>;
  saveRule: (r: Rule) => Promise<void>;
  sendMessage: (id: string, line: string, text: string) => Promise<void>;
  saveRecord: <T extends SuiteRecord>(
    kind: RecordKind,
    record: T,
  ) => Promise<void>;
  addNote: (leadId: string, text: string) => Promise<void>;
  request: (url: string, body?: unknown, method?: string) => Promise<any>;
}
const Context = createContext<Store>(null!);
export async function api(url: string, body?: unknown, method = "POST") {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : method,
    credentials: "include",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({ error: "Sunucu yanıtı okunamadı." }));
  if (!r.ok) {
    const error = new Error(
      d.message || d.error || "İşlem tamamlanamadı.",
    ) as Error & { status: number };
    error.status = r.status;
    throw error;
  }
  return d;
}
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [appointmentDraft, setAppointmentDraft] = useState<{
    name: string;
    initial?: string;
  } | null>(null);
  const appointmentResolver = useRef<((v: string | null) => void) | null>(null);
  const chooseAppointment = (l: Lead) =>
    new Promise<string>((resolve, reject) => {
      if (appointmentResolver.current) {
        reject(new Error("Önce açık randevu seçimini tamamlayın."));
        return;
      }
      appointmentResolver.current = (v) => {
        appointmentResolver.current = null;
        setAppointmentDraft(null);
        v
          ? resolve(v)
          : reject(
              new Error("Randevu seçimi iptal edildi; aşama değiştirilmedi."),
            );
      };
      setAppointmentDraft({ name: l.name, initial: l.appointmentAt });
    });
  const [demo, setDemoState] = useState(true);
  const [data, setData] = useState<AppState>(loadDemo);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/api/me")
      .then((d) =>
        setUser(
          d && Object.prototype.hasOwnProperty.call(d, "user") ? d.user : null,
        ),
      )
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (demo) localStorage.setItem("xre-demo-v2", JSON.stringify(data));
  }, [data, demo]);
  const refresh = useCallback(async () => {
    if (demo) return;
    try {
      const state = await api("/api/state");
      if (Array.isArray(state?.lines)) setLineInventory(state.lines);
      setData({ ...emptyState, ...state });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [demo]);
  const setDemo = (v: boolean) => {
    if (!v && (!user || user.canAccess === false)) {
      toast.error("Gerçek CRM verileri için yetkili oturum gerekli.");
      return;
    }
    setDemoState(v);
    if (v) {
      resetLineInventory();
      setData(loadDemo());
    }
    else setData(emptyState);
  };
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (demo || !user) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [demo, user, refresh]);
  const event = (
    title: string,
    detail: string,
    type = "automation",
    leadId?: string,
  ) => ({
    id: crypto.randomUUID(),
    title,
    detail,
    type,
    status: "demo",
    createdAt: new Date().toISOString(),
    leadId,
  });
  const ruleTasks = (rules: Rule[], lead: Lead): Task[] =>
    rules
      .filter((r) => r.action === "task")
      .map((r) => {
        const stamp = new Date().toISOString();
        return {
          id: crypto.randomUUID(),
          title: r.config.template || r.name,
          description: `CRM statü kuralı: ${r.name}`,
          status: "todo",
          priority: "normal",
          assignee: r.config.assignee || lead.owner,
          leadId: lead.id,
          dueAt: new Date(
            Date.now() +
              Math.min(720, Math.max(1, Number(r.config.dueHours) || 24)) *
                3600000,
          ).toISOString(),
          checklist: [],
          createdAt: stamp,
          updatedAt: stamp,
        };
      });
  const saveLead = async (l: Lead) => {
    validateStagePolicy(
      l as unknown as Record<string, unknown>,
      data.pipelines,
    );
    const old = data.leads.find((x) => x.id === l.id);
    if (
      old &&
      appointmentStage(old as any, data.pipelines) &&
      !appointmentStage(l as any, data.pipelines)
    )
      l = { ...l, appointmentAt: "" };
    const entering =
      appointmentStage(l as any, data.pipelines) &&
      (!old || old.stage !== l.stage || old.pipelineId !== l.pipelineId);
    if (entering) {
      if (!l.appointmentAt || Date.parse(l.appointmentAt) <= Date.now())
        l = { ...l, appointmentAt: await chooseAppointment(l) };
      validateAppointment(l.appointmentAt);
    }
    if (
      l.appointmentAt !== old?.appointmentAt &&
      (l.appointmentAt || appointmentStage(l as any, data.pipelines))
    )
      validateAppointment(l.appointmentAt);
    if (!demo) {
      await api(
        data.leads.some((x) => x.id === l.id)
          ? `/api/leads/${l.id}`
          : "/api/leads",
        data.leads.some((x) => x.id === l.id) ? l : { lead: l },
        data.leads.some((x) => x.id === l.id) ? "PATCH" : "POST",
      );
      await refresh();
      return;
    }
    setData((d) => {
      const previous = d.leads.find((x) => x.id === l.id);
      const triggered =
        !previous || previous.stage !== l.stage
          ? d.rules.filter(
              (r) =>
                r.enabled &&
                r.triggerStage === l.stage &&
                (!r.pipelineId ||
                  r.pipelineId === "all" ||
                  r.pipelineId === (l.pipelineId || "sales")),
            )
          : [];
      const immediate = triggered.filter((r) => {
        const p = evaluateAutomationPolicy(r, l, Date.now());
        return p.eligible && !!p.runAt && Date.parse(p.runAt) <= Date.now();
      });
      return {
        ...d,
        activities:
          l.appointmentAt &&
          (!previous || l.appointmentAt !== previous.appointmentAt || entering)
            ? [
                {
                  id: `appointment-${l.id}`,
                  leadId: l.id,
                  type: "meeting",
                  title: "Müşteriyle görüşün",
                  description: "CRM randevu aşaması için planlandı.",
                  assignee: l.owner,
                  startAt: l.appointmentAt,
                  endAt: new Date(
                    Date.parse(l.appointmentAt) + 1800000,
                  ).toISOString(),
                  completed: false,
                  appointmentLinked: true,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
                ...d.activities.filter((a) => a.id !== `appointment-${l.id}`),
              ]
            : !l.appointmentAt && previous?.appointmentAt
              ? d.activities.map((a) =>
                  a.id === `appointment-${l.id}`
                    ? { ...a, cancelled: true }
                    : a,
                )
              : d.activities,
        tasks: [...ruleTasks(immediate, l), ...d.tasks],
        leads: previous
          ? d.leads.map((x) => (x.id === l.id ? l : x))
          : [l, ...d.leads],
        events: [
          event(
            `${l.name} · CRM kaydı güncellendi`,
            "Örnek veri — dış sisteme aktarılmadı",
            "crm",
            l.id,
          ),
          ...triggered.map((r) =>
            event(
              r.name,
              !evaluateAutomationPolicy(r, l, Date.now()).eligible
                ? "Koşul sağlanmadı; demo işlem atlandı."
                : !immediate.includes(r)
                  ? `Demo planı: ${new Date(evaluateAutomationPolicy(r, l, Date.now()).runAt!).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}; otomatik dış işlem yapılmaz.`
                  : r.action === "task"
                    ? r.config.template || "Takip görevi oluşturuldu"
                    : "Demo: dış iletişim gönderilmedi",
              r.action,
              l.id,
            ),
          ),
          ...d.events,
        ],
      };
    });
  };
  const moveLead = async (id: string, stage: Stage) => {
    const l = data.leads.find((x) => x.id === id);
    if (!l || l.stage === stage) return;
    await saveLead({ ...l, stage, lastActivity: new Date().toISOString() });
  };
  const saveRule = async (r: Rule) => {
    if (!demo) {
      await api(
        data.rules.some((x) => x.id === r.id)
          ? `/api/rules/${r.id}`
          : "/api/rules",
        r,
        data.rules.some((x) => x.id === r.id) ? "PATCH" : "POST",
      );
      await refresh();
      return;
    }
    setData((d) => ({
      ...d,
      rules: d.rules.some((x) => x.id === r.id)
        ? d.rules.map((x) => (x.id === r.id ? r : x))
        : [...d.rules, r],
    }));
  };
  const sendMessage = async (id: string, line: string, text: string) => {
    if (!demo) {
      await api("/api/messages", { leadId: id, lineId: line, text });
      await refresh();
      return;
    }
    setData((d) => ({
      ...d,
      messages: [
        ...d.messages,
        {
          id: crypto.randomUUID(),
          leadId: id,
          text,
          direction: "outbound",
          createdAt: new Date().toISOString(),
          status: "demo",
        },
      ],
      events: [
        event(
          "WhatsApp mesajı hazırlandı",
          "Demo: gerçek mesaj gönderilmedi",
          "whatsapp",
          id,
        ),
        ...d.events,
      ],
    }));
  };
  const saveRecord = async <T extends SuiteRecord>(
    kind: RecordKind,
    record: T,
  ) => {
    if (!demo) {
      const exists = data[kind].some((x) => x.id === record.id);
      await api(
        exists ? `/api/${kind}/${record.id}` : `/api/${kind}`,
        record,
        exists ? "PATCH" : "POST",
      );
      await refresh();
      return;
    }
    if (kind === "contacts") {
      const c = record as any;
      const digits = (p: string) =>
        p.replace(/\D/g, "").replace(/^90/, "").replace(/^0/, "");
      if (
        data.contacts.some(
          (x) =>
            x.id !== c.id &&
            ((c.phone && digits(x.phone) === digits(c.phone)) ||
              (c.email && x.email.toLowerCase() === c.email.toLowerCase())),
        )
      )
        throw new Error("Bu telefon veya e-posta ile kişi kaydı zaten var.");
    }
    if (
      kind === "companies" &&
      data.companies.some(
        (x) =>
          x.id !== record.id &&
          x.name.trim().toLocaleLowerCase("tr") ===
            (record as any).name.trim().toLocaleLowerCase("tr"),
      )
    )
      throw new Error("Bu şirket adıyla kayıt zaten var.");
    if (kind === "activities") {
      const a = record as any;
      if (!a.startAt || !a.endAt || new Date(a.endAt) < new Date(a.startAt))
        throw new Error("Geçerli başlangıç ve bitiş tarihleri gerekli.");
    }
    if (
      kind === "pipelines" &&
      (record as any).requiredFieldsByStage !== undefined
    )
      StagePolicySchema.parse((record as any).requiredFieldsByStage);
    const updated = { ...record, updatedAt: new Date().toISOString() };
    setData((d) => ({
      ...d,
      [kind]: (d[kind] as SuiteRecord[]).some((x) => x.id === record.id)
        ? (d[kind] as SuiteRecord[]).map((x) =>
            x.id === record.id ? updated : x,
          )
        : [updated, ...d[kind]],
      events: [
        event(
          `${kind === "tasks" ? "Görev" : kind === "activities" ? "Etkinlik" : kind === "feed" ? "Akış" : kind === "contacts" ? "Kişi" : kind === "companies" ? "Şirket" : "CRM"} kaydı güncellendi`,
          (record as any).title ||
            (record as any).name ||
            (record as any).text ||
            "",
          kind,
          (record as any).leadId,
        ),
        ...d.events,
      ],
    }));
  };
  const addNote = async (leadId: string, text: string) => {
    const stamp = new Date().toISOString();
    await saveRecord("feed", {
      id: crypto.randomUUID(),
      author: user?.name || "XRE Ekibi",
      text,
      leadId,
      likes: [],
      comments: [],
      createdAt: stamp,
      updatedAt: stamp,
    });
  };
  return (
    <Context.Provider
      value={{
        data,
        demo,
        user,
        loading,
        setDemo,
        refresh,
        saveLead,
        moveLead,
        saveRule,
        sendMessage,
        saveRecord,
        addNote,
        request: api,
      }}
    >
      {children}
      {appointmentDraft && (
        <AppointmentPrompt
          {...appointmentDraft}
          onResolve={(v) => appointmentResolver.current?.(v)}
        />
      )}
    </Context.Provider>
  );
}
export const useStore = () => useContext(Context);
