// Tetikleyici ve bildirim türleri (sunucu ve arayüz ortak kullanır).
export const TRIGGER_EVENTS = [
  "message.first",
  "message.inbound",
  "message.outbound",
  "call.inbound",
  "call.missed",
  "call.outbound",
  "email.inbound",
  "email.outbound",
  "task.done",
] as const;
export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

export interface AutomationTrigger {
  id: string;
  name: string;
  event: TriggerEvent;
  pipelineId?: string;
  targetStage: string;
  enabled: boolean;
  allowBackward: boolean;
}

export interface InboxNotification {
  id: string;
  recipient: string;
  title: string;
  body: string;
  leadId: string | null;
  createdAt: string;
  readAt: string | null;
}

export const TRIGGER_CATALOG: { event: TriggerEvent; group: "customer" | "team"; title: string; description: string }[] = [
  { event: "message.first", group: "customer", title: "Müşterinin ilk mesajı", description: "Müşteriden ilk WhatsApp mesajı geldiğinde müşteriyi bu aşamaya taşır." },
  { event: "message.inbound", group: "customer", title: "Müşteri mesaj gönderdiğinde", description: "Müşteri her yeni mesaj gönderdiğinde müşteriyi bu aşamaya taşır." },
  { event: "message.outbound", group: "team", title: "Müşteriye mesaj gönderildiğinde", description: "Bir çalışan müşteriye mesaj yazdığında müşteriyi bu aşamaya taşır." },
  { event: "call.inbound", group: "customer", title: "Gelen arama", description: "Müşteri aradığında müşteriyi bu aşamaya taşır." },
  { event: "call.missed", group: "customer", title: "Cevapsız arama", description: "Müşterinin araması cevapsız kaldığında müşteriyi bu aşamaya taşır." },
  { event: "call.outbound", group: "team", title: "Giden arama", description: "Bir çalışan müşteriyi aradığında müşteriyi bu aşamaya taşır." },
  { event: "email.inbound", group: "customer", title: "Gelen e-posta", description: "Müşteriden e-posta geldiğinde müşteriyi bu aşamaya taşır." },
  { event: "email.outbound", group: "team", title: "Müşteriye e-posta gönderildiğinde", description: "Bir çalışan müşteriye e-posta gönderdiğinde müşteriyi bu aşamaya taşır." },
  { event: "task.done", group: "team", title: "Görev tamamlandığında", description: "Müşteriye bağlı bir görev tamamlandığında müşteriyi bu aşamaya taşır." },
];
