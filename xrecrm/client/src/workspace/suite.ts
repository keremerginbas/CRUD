import type { StagePolicy } from "../../../shared/crm-stage-policy";
import type { Stage } from "./data";
export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  companyId: string;
  owner: string;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface Company {
  id: string;
  name: string;
  industry: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  owner: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface Pipeline {
  id: string;
  name: string;
  description: string;
  stages: { id: Stage; label: string; color: string }[];
  requiredFieldsByStage?: StagePolicy;
  createdAt: string;
  updatedAt: string;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  status: "todo" | "progress" | "done";
  priority: "low" | "normal" | "high";
  assignee: string;
  leadId: string;
  dueAt: string;
  checklist: { id: string; text: string; done: boolean }[];
  createdAt: string;
  updatedAt: string;
}
export interface Activity {
  id: string;
  leadId: string;
  type: "call" | "meeting" | "task";
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  assignee: string;
  completed: boolean;
  cancelled?: boolean;
  appointmentLinked?: boolean;
  meetingUrl?: string;
  provider?: "google" | "manual";
  meetingProvider?: "google" | "manual";
  googleEventId?: string;
  conferenceStatus?: "ready" | "pending" | "failed" | "unavailable";
  attendees?: string[];
  createdAt: string;
  updatedAt: string;
}
export interface FeedPost {
  id: string;
  author: string;
  text: string;
  leadId: string;
  likes: string[];
  comments: { id: string; author: string; text: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
}
export interface Member {
  id: string;
  name: string;
  email: string;
  title: string;
  department: string;
  status: "active" | "away";
  createdAt: string;
  updatedAt: string;
}
export interface SuiteState {
  contacts: Contact[];
  companies: Company[];
  pipelines: Pipeline[];
  tasks: Task[];
  activities: Activity[];
  feed: FeedPost[];
  members: Member[];
}
export type RecordKind = keyof SuiteState;
export type SuiteRecord =
  | Contact
  | Company
  | Pipeline
  | Task
  | Activity
  | FeedPost
  | Member;
export const baseStages: Pipeline["stages"] = [
  { id: "new", label: "Yeni fırsat", color: "#3bc8f5" },
  { id: "contacted", label: "İlk görüşme", color: "#4fafea" },
  { id: "qualified", label: "Portföy sunumu", color: "#a28beb" },
  { id: "proposal", label: "Teklif & pazarlık", color: "#f3b743" },
  { id: "won", label: "Satış tamamlandı", color: "#8bc34a" },
  { id: "lost", label: "Kaybedildi", color: "#e78988" },
];
export const defaultPipeline: Pipeline = {
  id: "sales",
  name: "Gayrimenkul Satış",
  description: "Satılık konut ve ticari gayrimenkul fırsatları",
  stages: baseStages,
  createdAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
};
export const emptySuite: SuiteState = {
  contacts: [],
  companies: [],
  pipelines: [],
  tasks: [],
  activities: [],
  feed: [],
  members: [],
};
export function availablePipelines(items: Pipeline[]) {
  return items.some((p) => p.id === "sales")
    ? items
    : [defaultPipeline, ...items];
}
export function getPipelineStages(items: Pipeline[], id?: string) {
  return (
    availablePipelines(items).find((p) => p.id === (id || "sales"))?.stages ||
    baseStages
  );
}
export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function isOverdue(date: string, completed = false) {
  return !completed && !!date && new Date(date).getTime() < Date.now();
}
export function dateTimeLabel(date: string) {
  return date
    ? new Date(date).toLocaleString("tr-TR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Tarih belirlenmedi";
}
export function localDateInput(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function toIso(local: string) {
  return local ? new Date(local).toISOString() : "";
}
export function makeSuiteDemo(): SuiteState {
  const now = new Date();
  const stamp = now.toISOString();
  const day = (n: number, h = 10) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  const companies: Company[] = [
    {
      id: "company-1",
      name: "Mavi Yapı Gayrimenkul",
      industry: "Gayrimenkul",
      phone: "+905550010101",
      email: "bilgi@maviyapi.example",
      website: "https://example.com",
      address: "Kadıköy, İstanbul",
      owner: "Ali K.",
      notes: "Konut yatırım ve geliştirme portföyü.",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "company-2",
      name: "Nova Yatırım",
      industry: "Yatırım",
      phone: "+905550010102",
      email: "info@novayatirim.example",
      website: "",
      address: "Ataşehir, İstanbul",
      owner: "Zeynep K.",
      notes: "Ticari gayrimenkul yatırımcısı.",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "company-3",
      name: "Atlas Mimarlık",
      industry: "Mimarlık",
      phone: "+905550010103",
      email: "ofis@atlas.example",
      website: "",
      address: "Beşiktaş, İstanbul",
      owner: "Zeliha B.",
      notes: "Yeni ofis arayışı.",
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const contacts: Contact[] = [
    ["Elif Yılmaz", "+905550000010", "company-1", "Zeynep K."],
    ["Burak Özdemir", "+905550000011", "company-2", "Ali K."],
    ["Ayşe Demir", "+905550000012", "company-3", "Zeynep K."],
    ["Mehmet Kaya", "+905550000013", "", "Ali K."],
    ["Selin Aydın", "+905550000014", "", "Zeliha B."],
  ].map((x, i) => ({
    id: `contact-${i + 1}`,
    name: x[0],
    phone: x[1],
    companyId: x[2],
    owner: x[3],
    email: `kisi${i + 1}@example.com`,
    tags: i === 0 ? ["VIP", "Yatırımcı"] : ["Müşteri"],
    notes: "Örnek kişi kaydı · Gerçek müşteri değil.",
    createdAt: stamp,
    updatedAt: stamp,
  }));
  const tasks: Task[] = [
    {
      id: "task-1",
      title: "Elif Hanım için Kadıköy portföyünü hazırla",
      description:
        "3+1 daire alternatifleri ve güncel fiyat bilgisini hazırla.",
      status: "progress",
      priority: "high",
      assignee: "Zeynep K.",
      leadId: "demo-1",
      dueAt: day(0, 16),
      checklist: [
        { id: "c1", text: "Portföyleri karşılaştır", done: true },
        { id: "c2", text: "Sunum dosyasını hazırla", done: false },
      ],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "task-2",
      title: "Villa ziyareti için teyit araması",
      description: "Mehmet Bey ile ziyaret saatini netleştir.",
      status: "todo",
      priority: "normal",
      assignee: "Ali K.",
      leadId: "demo-4",
      dueAt: day(1, 11),
      checklist: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "task-3",
      title: "Deniz Bey’in teklifini takip et",
      description: "Teklif değerlendirme geri dönüşünü al.",
      status: "todo",
      priority: "high",
      assignee: "Zeynep K.",
      leadId: "demo-7",
      dueAt: day(-1, 15),
      checklist: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "task-4",
      title: "Maltepe daire bilgilerini güncelle",
      description: "Müşteriye güncel teknik bilgileri gönder.",
      status: "done",
      priority: "low",
      assignee: "Zeliha B.",
      leadId: "demo-5",
      dueAt: day(0, 10),
      checklist: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "task-5",
      title: "Yeni yatırım taleplerini değerlendir",
      description: "Gelen talepleri incele ve sorumlu danışmanı belirle.",
      status: "todo",
      priority: "normal",
      assignee: "Ali K.",
      leadId: "",
      dueAt: day(2, 14),
      checklist: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const activities: Activity[] = [
    {
      id: "activity-1",
      leadId: "demo-1",
      type: "meeting",
      title: "Kadıköy portföy ziyareti",
      description: "Elif Hanım ile yerinde daire sunumu.",
      startAt: day(1, 14),
      endAt: day(1, 15),
      assignee: "Zeynep K.",
      completed: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "activity-2",
      leadId: "demo-4",
      type: "call",
      title: "Villa talebi · İhtiyaç analizi",
      description: "Mehmet Bey ile bütçe ve bölge görüşmesi.",
      startAt: day(0, 11),
      endAt: day(0, 11),
      assignee: "Ali K.",
      completed: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "activity-3",
      leadId: "demo-7",
      type: "meeting",
      title: "Teklif değerlendirme toplantısı",
      description: "Deniz Bey ile teklif üzerinden geçilecek.",
      startAt: day(2, 16),
      endAt: day(2, 17),
      assignee: "Zeynep K.",
      completed: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const members: Member[] = [
    {
      id: "member-1",
      name: "Ali K.",
      email: "ali@example.com",
      title: "Satış Direktörü",
      department: "Satış",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "member-2",
      name: "Zeynep K.",
      email: "zeynep@example.com",
      title: "Gayrimenkul Danışmanı",
      department: "Satış",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "member-3",
      name: "Zeliha B.",
      email: "zeliha@example.com",
      title: "Müşteri İlişkileri",
      department: "İletişim",
      status: "away",
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const feed: FeedPost[] = [
    {
      id: "feed-1",
      author: "Ali K.",
      text: "Bu hafta odağımız: yeni yatırım talepleri ve teklif aşamasındaki fırsatlar. Ziyaret planlarını takvimde güncel tutalım.",
      leadId: "",
      likes: ["Zeynep K."],
      comments: [
        {
          id: "comment-1",
          author: "Zeynep K.",
          text: "Kadıköy ziyaretini planladım. Portföy sunumu hazırlanıyor.",
          createdAt: stamp,
        },
      ],
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: "feed-2",
      author: "Zeynep K.",
      text: "Elif Hanım cumartesi ziyaret için uygun. Kadıköy’deki alternatifleri karşılaştırıp sunacağız.",
      leadId: "demo-1",
      likes: [],
      comments: [],
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  return {
    contacts,
    companies,
    pipelines: [
      defaultPipeline,
      {
        ...defaultPipeline,
        id: "rent",
        name: "Kiralama",
        description: "Konut ve ticari kiralama",
        stages: baseStages.map((s) => ({
          ...s,
          label: s.id === "won" ? "Kiralama tamamlandı" : s.label,
        })),
      },
      {
        ...defaultPipeline,
        id: "investment",
        name: "Yatırım & Arsa",
        description: "Yatırım ve arsa fırsatları",
      },
    ],
    tasks,
    activities,
    feed,
    members,
  };
}
