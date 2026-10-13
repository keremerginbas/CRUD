import type { AssistantAction } from "../../../shared/assistant";
import type { AppState, Lead, Rule } from "./data";
import type { RecordKind, SuiteRecord } from "./suite";
export const actionLabels: Record<string, string> = {
  lead: "Müşteri kaydı",
  task: "Görev",
  activity: "Takvim etkinliği",
  note: "Müşteri notu",
  contact: "Kişi kaydı",
  company: "Şirket kaydı",
  rule: "Otomasyon kuralı",
  message: "WhatsApp mesajı",
  call: "Vapi araması",
};
export const actionFields: Record<string, string[]> = {
  lead: [
    "name",
    "phone",
    "email",
    "company",
    "owner",
    "stage",
    "value",
    "pipelineId",
    "contactId",
    "companyId",
    "dealTitle",
    "expectedCloseDate",
    "probability",
    "source",
    "tags",
    "notes",
    "lostReason",
    "customFields",
  ],
  task: [
    "title",
    "description",
    "assignee",
    "leadId",
    "dueAt",
    "priority",
    "status",
  ],
  activity: [
    "title",
    "description",
    "leadId",
    "assignee",
    "type",
    "startAt",
    "endAt",
    "completed",
  ],
  note: ["leadId", "text"],
  contact: ["name", "phone", "email", "companyId", "owner", "notes"],
  company: [
    "name",
    "industry",
    "phone",
    "email",
    "website",
    "address",
    "owner",
    "notes",
  ],
  rule: [
    "name",
    "triggerStage",
    "pipelineId",
    "action",
    "enabled",
    "template",
    "lineId",
    "url",
  ],
  message: ["leadId", "lineId", "text"],
  call: ["leadId", "lineId", "assistantId"],
};
export const fieldLabels: Record<string, string> = {
  name: "Ad / unvan",
  phone: "Telefon",
  email: "E-posta",
  company: "Portföy / başlık",
  owner: "Danışman",
  stage: "CRM aşaması",
  value: "Fırsat tutarı (₺)",
  pipelineId: "Satış hunisi",
  notes: "Notlar",
  title: "Başlık",
  description: "Açıklama",
  assignee: "Sorumlu",
  leadId: "İlgili müşteri",
  dueAt: "Son tarih",
  priority: "Öncelik",
  status: "Görev durumu",
  type: "Etkinlik türü",
  startAt: "Başlangıç",
  endAt: "Bitiş",
  completed: "Tamamlandı",
  text: "Metin",
  companyId: "Şirket",
  contactId: "Kişi kaydı",
  dealTitle: "Fırsat başlığı",
  expectedCloseDate: "Beklenen kapanış tarihi",
  probability: "Kazanma olasılığı (%)",
  source: "Kaynak",
  tags: "Etiketler (virgülle)",
  lostReason: "Kaybetme nedeni",
  customFields: "Özel alanlar (JSON)",
  industry: "Sektör",
  website: "Web sitesi",
  address: "Adres",
  triggerStage: "Tetikleyen aşama",
  action: "Kural işlemi",
  enabled: "Kural etkin",
  template: "Görev / mesaj şablonu",
  lineId: "Gönderen hat",
  url: "HTTPS webhook hedefi",
  assistantId: "Vapi asistan kimliği",
};
type ActionStore = {
  data: AppState;
  demo: boolean;
  user: any;
  saveLead: (l: Lead) => Promise<void>;
  saveRecord: (k: RecordKind, r: SuiteRecord) => Promise<void>;
  saveRule: (r: Rule) => Promise<void>;
  addNote: (id: string, t: string) => Promise<void>;
  sendMessage: (id: string, l: string, t: string) => Promise<void>;
  request: (url: string, b?: unknown, m?: string) => Promise<any>;
  refresh: () => Promise<void>;
};
const required = (v: unknown, label: string) => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${label} gerekli.`);
  return v.trim();
};
export async function applyAssistantAction(
  action: AssistantAction,
  values: Record<string, any>,
  s: ActionStore,
) {
  const stamp = new Date().toISOString();
  const payload: Record<string, any> = {};
  for (const k of actionFields[action.kind] || [])
    if (values[k] !== undefined) payload[k] = values[k];
  if (
    action.operation === "create" &&
    (
      [
        "leads",
        "tasks",
        "activities",
        "contacts",
        "companies",
        "rules",
      ] as const
    ).some((k) => s.data[k].some((x) => x.id === `ai-${action.id}`))
  )
    throw new Error("Bu öneri daha önce CRM’ye uygulanmış.");
  const owner = s.user?.name || s.data.members[0]?.name || "XRE Ekibi";
  const id =
    action.operation === "update"
      ? required(action.recordId, "Kayıt kimliği")
      : `ai-${action.id}`;
  const leadId = payload.leadId || "";
  if (leadId && !s.data.leads.some((l) => l.id === leadId))
    throw new Error("Bağlı müşteri bu çalışma alanında bulunamadı.");
  if (action.kind === "note") {
    await s.addNote(required(leadId, "Müşteri"), required(payload.text, "Not"));
    return "Not CRM zaman çizelgesine kaydedildi.";
  }
  if (action.kind === "message") {
    required(payload.lineId, "Gönderen hat");
    required(leadId, "Müşteri");
    await s.sendMessage(
      leadId,
      payload.lineId,
      required(payload.text, "Mesaj"),
    );
    return s.demo
      ? "Demo mesaj kaydedildi; dış iletişim gönderilmedi."
      : "WhatsApp mesajı sağlayıcıya gönderildi.";
  }
  if (action.kind === "call") {
    if (s.demo) throw new Error("Demo modunda gerçek arama başlatılmaz.");
    required(payload.lineId, "Arama hattı");
    await s.request("/api/calls", {
      leadId: required(leadId, "Müşteri"),
      lineId: payload.lineId,
      assistantId: payload.assistantId || "",
    });
    await s.refresh();
    return "Arama talebi Vapi sağlayıcısına iletildi.";
  }
  if (action.kind === "lead") {
    const previous = s.data.leads.find((l) => l.id === id);
    if (action.operation === "update" && !previous)
      throw new Error("Müşteri artık bulunamıyor.");
    const lead: Lead = {
      id,
      name: "",
      phone: "",
      email: "",
      company: "",
      owner,
      stage: "new",
      value: 0,
      source: "AI asistan",
      notes: "",
      tags: [],
      createdAt: stamp,
      lastActivity: stamp,
      pipelineId: "sales",
      ...previous,
      ...payload,
    };
    lead.value = Number(lead.value) || 0;
    if (typeof lead.tags === "string")
      lead.tags = String(lead.tags)
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (typeof lead.customFields === "string") {
      try {
        lead.customFields = JSON.parse(lead.customFields);
      } catch {
        throw new Error("Özel alanlar geçerli JSON olmalı.");
      }
    }
    required(lead.name, "Müşteri adı");
    await s.saveLead(lead);
    return "Müşteri kaydı CRM’ye işlendi.";
  }
  if (action.kind === "rule") {
    const previous = s.data.rules.find((r) => r.id === id);
    if (action.operation === "update" && !previous)
      throw new Error("Kural artık bulunamıyor.");
    const c =
      values.config && typeof values.config === "object" ? values.config : {};
    const config = { ...previous?.config, ...c };
    for (const k of ["template", "lineId", "url"])
      if (payload[k] !== undefined) {
        config[k] = payload[k];
        delete payload[k];
      }
    const rule: Rule = {
      id,
      name: "",
      triggerStage: "new",
      action: "task",
      enabled: false,
      config,
      ...previous,
      ...payload,
    };
    rule.config = config;
    required(rule.name, "Kural adı");
    if (
      rule.action === "webhook" &&
      !String(config.url || "").startsWith("https://")
    )
      throw new Error("Webhook hedefi HTTPS olmalı.");
    await s.saveRule(rule);
    return rule.enabled
      ? "Otomasyon kuralı etkin olarak kaydedildi."
      : "Otomasyon kuralı taslak olarak kaydedildi.";
  }
  const kind = (
    {
      task: "tasks",
      activity: "activities",
      contact: "contacts",
      company: "companies",
    } as Record<string, RecordKind>
  )[action.kind];
  if (!kind) throw new Error("Bu öneri işlemi desteklenmiyor.");
  const previous = (s.data[kind] as SuiteRecord[]).find((x) => x.id === id);
  if (action.operation === "update" && !previous)
    throw new Error("Kayıt artık bulunamıyor.");
  const defaults: Record<string, any> = {
    tasks: {
      title: "",
      description: "",
      status: "todo",
      priority: "normal",
      assignee: owner,
      leadId: "",
      dueAt: "",
      checklist: [],
    },
    activities: {
      leadId: "",
      type: "meeting",
      title: "",
      description: "",
      assignee: owner,
      completed: false,
      startAt: "",
      endAt: "",
    },
    contacts: {
      name: "",
      phone: "",
      email: "",
      companyId: "",
      owner,
      tags: [],
      notes: "",
    },
    companies: {
      name: "",
      industry: "",
      phone: "",
      email: "",
      website: "",
      address: "",
      owner,
      notes: "",
    },
  };
  const record = {
    id,
    createdAt: stamp,
    updatedAt: stamp,
    ...defaults[kind],
    ...previous,
    ...payload,
  };
  required(
    record.title || record.name,
    record.title !== undefined ? "Başlık" : "Ad",
  );
  if (
    kind === "activities" &&
    (!record.startAt ||
      !record.endAt ||
      new Date(record.endAt) < new Date(record.startAt))
  )
    throw new Error(
      "Etkinlik için geçerli başlangıç ve bitiş tarihleri gerekli.",
    );
  await s.saveRecord(kind, record);
  return `${actionLabels[action.kind]} kaydedildi.`;
}
