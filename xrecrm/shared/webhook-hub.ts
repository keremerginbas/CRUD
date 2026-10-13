// Webhook merkezi: tarayıcı ve sunucunun ortak sözleşmesi.
// Bitrix24'teki "gelen webhook" (kapsamlı REST anahtarı) ve "giden webhook"
// (olay aboneliği) kavramlarının XRE CRM karşılığıdır.

export const INBOUND_ACTIONS = [
  {
    id: "lead.create",
    label: "Müşteri oluştur",
    description: "Form, reklam, web sitesi veya n8n'den yeni müşteri kaydı.",
  },
  {
    id: "lead.update",
    label: "Müşteri güncelle",
    description: "Var olan müşterinin alanlarını değiştirir.",
  },
  {
    id: "lead.stage",
    label: "Aşama değiştir",
    description: "Müşteriyi başka bir statüye taşır; otomasyonlar çalışır.",
  },
  {
    id: "lead.find",
    label: "Müşteri bul",
    description: "Telefon, e-posta veya kimlikle müşteri arar (salt okunur).",
  },
  {
    id: "note.add",
    label: "Not ekle",
    description: "Müşteri notlarına zaman damgalı satır ekler.",
  },
  {
    id: "task.create",
    label: "Görev oluştur",
    description: "Sorumlu, son tarih ve müşteri bağlantılı görev.",
  },
  {
    id: "activity.create",
    label: "Etkinlik oluştur",
    description: "Arama, toplantı veya görev etkinliği planlar.",
  },
  {
    id: "call.log",
    label: "Arama kaydı (PBX/CDR)",
    description:
      "Santral/FST/Asterisk arama sonucunu müşteriye bağlar; cevapsız aramaları görünür kılar.",
  },
  {
    id: "message.log",
    label: "Mesaj kaydı",
    description: "Harici kanaldan (SMS, WhatsApp, e-posta) gelen/giden mesaj.",
  },
] as const;
export type InboundAction = (typeof INBOUND_ACTIONS)[number]["id"];
export const inboundActionIds = INBOUND_ACTIONS.map(
  (a) => a.id,
) as InboundAction[];

export const OUTBOUND_EVENTS = [
  { id: "lead.created", label: "Müşteri oluşturuldu", group: "CRM" },
  { id: "lead.updated", label: "Müşteri güncellendi", group: "CRM" },
  { id: "lead.stage_changed", label: "Aşama değişti", group: "CRM" },
  { id: "contact.created", label: "Kişi oluşturuldu", group: "CRM" },
  { id: "company.created", label: "Şirket oluşturuldu", group: "CRM" },
  { id: "task.created", label: "Görev oluşturuldu", group: "Görevler" },
  { id: "task.completed", label: "Görev tamamlandı", group: "Görevler" },
  { id: "activity.created", label: "Etkinlik planlandı", group: "Görevler" },
  {
    id: "activity.completed",
    label: "Etkinlik tamamlandı",
    group: "Görevler",
  },
  { id: "message.received", label: "Mesaj geldi", group: "İletişim" },
  { id: "message.sent", label: "Mesaj gönderildi", group: "İletişim" },
  { id: "call.created", label: "Arama başladı / kaydedildi", group: "İletişim" },
  { id: "call.ended", label: "Arama bitti", group: "İletişim" },
  { id: "call.missed", label: "Cevapsız arama", group: "İletişim" },
] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number]["id"];
export const outboundEventIds = OUTBOUND_EVENTS.map(
  (e) => e.id,
) as OutboundEvent[];

export interface InboundHookView {
  id: string;
  name: string;
  actions: InboundAction[];
  enabled: boolean;
  tokenPreview: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  lastError?: string;
}

export interface OutboundHookView {
  id: string;
  name: string;
  url: string;
  events: OutboundEvent[];
  enabled: boolean;
  skipInboundEcho: boolean;
  headers: { name: string; valuePreview: string }[];
  secretPreview: string;
  createdAt: string;
  updatedAt: string;
  lastDeliveryAt?: string;
  lastStatus?: number | null;
  lastError?: string;
  successCount: number;
  failureCount: number;
}

export function inboundUrl(origin: string, hook: { id: string }, token = "<TOKEN>") {
  return `${origin.replace(/\/$/, "")}/api/hooks/in/${hook.id}/${token}`;
}
