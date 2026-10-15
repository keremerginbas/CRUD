import { SuiteState, emptySuite, makeSuiteDemo } from "./suite";
import type { AutomationPolicy } from "../../../shared/automation-policy";
export type Stage =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal"
  | "won"
  | "lost";
export interface Lead {
  stageTransitionToken?: string;
  city?: string;
  appointmentAt?: string;
  pipelineId?: string;
  contactId?: string;
  companyId?: string;
  dealTitle?: string;
  expectedCloseDate?: string;
  probability?: number;
  lostReason?: string;
  customFields?: Record<string, string>;
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  stage: Stage;
  owner: string;
  value: number;
  source: string;
  notes: string;
  createdAt: string;
  lastActivity: string;
  tags: string[];
}
export interface Rule {
  pipelineId?: string;
  id: string;
  name: string;
  triggerStage: Stage;
  action: "task" | "whatsapp" | "vapi" | "webhook";
  enabled: boolean;
  config: Record<string, string>;
  policy?: AutomationPolicy;
}
export interface EventItem {
  id: string;
  type: string;
  status: string;
  title: string;
  createdAt: string;
  detail?: string;
  leadId?: string;
  [key: string]: unknown;
}
export interface Message {
  id: string;
  leadId: string;
  text: string;
  direction: "inbound" | "outbound";
  createdAt: string;
  status: string;
}
export interface AppState extends SuiteState {
  leads: Lead[];
  rules: Rule[];
  messages: Message[];
  events: EventItem[];
  connections: any[];
  calls: any[];
  stageHistory?: { id: string; leadId: string; from: string | null; to: string; at: string; actor: string }[];
  settings: Record<string, unknown>;
}
export { lines, groupNames } from "../../../shared/lines";
export type { Line } from "../../../shared/lines";
export const formatPhone = (p: string) =>
  (/^90\d{10}$/.test(p) ? `+${p}` : p).replace(
    /^(\+90)(\d{3})(\d{3})(\d{2})(\d{2})$/,
    "$1 $2 $3 $4 $5",
  );
export const money = (n: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(n);
export const stages: { id: Stage; label: string; color: string }[] = [
  { id: "new", label: "Yeni müşteri", color: "#7f8de7" },
  { id: "contacted", label: "İletişime geçildi", color: "#54a6d9" },
  { id: "qualified", label: "Randevu", color: "#d1a148" },
  { id: "proposal", label: "Teklif gönderildi", color: "#bb82d6" },
  { id: "won", label: "Satış tamamlandı", color: "#299574" },
  { id: "lost", label: "Kaybedildi", color: "#ce8780" },
];
const customers = [
  [
    "Elif Yılmaz",
    "Kadıköy · Satılık daire",
    "new",
    "Zeynep K.",
    "WhatsApp",
    8250000,
    "EY",
  ],
  [
    "Burak Özdemir",
    "Ataşehir · Yatırımlık daire",
    "new",
    "Ali K.",
    "Web sitesi",
    6400000,
    "BÖ",
  ],
  [
    "Ayşe Demir",
    "Beşiktaş · Kiralık ofis",
    "contacted",
    "Zeynep K.",
    "WhatsApp",
    1850000,
    "AD",
  ],
  [
    "Mehmet Kaya",
    "Üsküdar · Satılık villa",
    "contacted",
    "Ali K.",
    "Telefon",
    14500000,
    "MK",
  ],
  [
    "Selin Aydın",
    "Maltepe · Satılık daire",
    "qualified",
    "Zeliha B.",
    "WhatsApp",
    5200000,
    "SA",
  ],
  [
    "Ahmet Çelik",
    "Sarıyer · Yatırımlık arsa",
    "qualified",
    "Ali K.",
    "Web sitesi",
    12000000,
    "AÇ",
  ],
  [
    "Deniz Arslan",
    "Beykoz · Satılık villa",
    "proposal",
    "Zeynep K.",
    "Telefon",
    18500000,
    "DA",
  ],
  [
    "Ece Karaca",
    "Pendik · Satılık daire",
    "proposal",
    "Zeliha B.",
    "WhatsApp",
    4750000,
    "EK",
  ],
  [
    "Can Tekin",
    "Şişli · Satılık ofis",
    "won",
    "Ali K.",
    "Referans",
    9500000,
    "CT",
  ],
  [
    "Derya Şahin",
    "Kartal · Satılık daire",
    "won",
    "Zeynep K.",
    "WhatsApp",
    6100000,
    "DŞ",
  ],
];
export function makeDemo(): AppState {
  const now = new Date().toISOString();
  return {
    ...makeSuiteDemo(),
    leads: customers.map((x, i) => ({
      id: `demo-${i + 1}`,
      pipelineId: i === 2 ? "rent" : i === 5 ? "investment" : "sales",
      contactId: i < 5 ? `contact-${i + 1}` : "",
      companyId: i < 3 ? `company-${i + 1}` : "",
      dealTitle: x[1] as string,
      probability: [10, 15, 25, 35, 50, 55, 75, 80, 100, 100][i],
      expectedCloseDate: new Date(Date.now() + 14 * 86400000)
        .toISOString()
        .slice(0, 10),
      name: x[0] as string,
      company: x[1] as string,
      stage: x[2] as Stage,
      owner: x[3] as string,
      source: x[4] as string,
      value: x[5] as number,
      phone: `+9055500000${String(i + 10)}`,
      email: `musteri${i + 1}@example.com`,
      notes:
        i === 0
          ? "Kadıköy bölgesinde 3+1 daire arıyor. Hafta sonu portföy ziyareti planlanacak."
          : "İhtiyaç ve bütçe bilgileri ilk görüşmede alındı.",
      // Genel bakış trendi anlamlı görünsün diye örnek kayıtlar son günlere yayılır.
      createdAt: new Date(
        Date.now() - ((i * 7) % 12) * 86400000 - i * 3600000,
      ).toISOString(),
      lastActivity: now,
      tags: i % 3 === 0 ? ["Öncelikli", "Satılık"] : ["Satılık"],
    })),
    rules: [
      {
        id: "r1",
        name: "İlk temas · Karşılama mesajı",
        triggerStage: "new",
        action: "whatsapp",
        enabled: true,
        config: {
          template:
            "Merhaba, XRE ekibine hoş geldiniz. Size nasıl yardımcı olabiliriz?",
        },
      },
      {
        id: "r2",
        name: "Nitelikli müşteri · Danışmana görev",
        triggerStage: "qualified",
        action: "task",
        enabled: true,
        config: { template: "Portföy seçeneklerini hazırla ve müşteriyi ara." },
      },
      {
        id: "r3",
        name: "Teklif sonrası · Yapay zekâ takibi",
        triggerStage: "proposal",
        action: "vapi",
        enabled: false,
        config: {},
      },
    ],
    messages: [
      {
        id: "m1",
        leadId: "demo-1",
        text: "Merhaba, Kadıköy’deki 3+1 daire hakkında bilgi alabilir miyim?",
        direction: "inbound",
        createdAt: now,
        status: "received",
      },
      {
        id: "m2",
        leadId: "demo-1",
        text: "Merhaba Elif Hanım. Elbette, size yardımcı olmaktan memnuniyet duyarız. Hangi gün ziyaret etmek istersiniz?",
        direction: "outbound",
        createdAt: now,
        status: "read",
      },
      {
        id: "m3",
        leadId: "demo-1",
        text: "Cumartesi öğleden sonra benim için uygun.",
        direction: "inbound",
        createdAt: now,
        status: "received",
      },
    ],
    events: [
      {
        id: "e1",
        type: "whatsapp",
        status: "demo",
        title: "Elif Yılmaz’dan yeni mesaj",
        createdAt: now,
        detail: "Örnek WhatsApp görüşmesi",
      },
      {
        id: "e2",
        type: "stage.changed",
        status: "demo",
        title: "Deniz Arslan → Teklif gönderildi",
        createdAt: now,
        detail: "Örnek CRM statü değişikliği",
      },
      {
        id: "e3",
        type: "automation",
        status: "demo",
        title: "Danışmana takip görevi oluşturuldu",
        createdAt: now,
        detail: "Örnek otomasyon çıktısı",
      },
    ],
    connections: [],
    calls: [],
    settings: {},
  };
}
export const emptyState: AppState = {
  ...emptySuite,
  leads: [],
  rules: [],
  messages: [],
  events: [],
  connections: [],
  calls: [],
  settings: {},
};
