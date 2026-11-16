import { expect, it } from "vitest";
import { summarizeWork } from "../server/assistant";

it("geciken etkinlik ve görevler tüm kayıtlardan sayılır (ilk 200 kayıtla sınırlı değil)", () => {
  const now = Date.parse("2026-11-16T12:00:00+03:00");
  const leads = [{ id: "l1", name: "Ayşe Yılmaz" }];
  // 500 tamamlanmış + 700 geciken + 3 bugün (ileri saat) + 2 gelecek
  const activities = [
    ...Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, title: "Bitti", startAt: "2026-11-01T09:00:00+03:00", completed: true })),
    ...Array.from({ length: 700 }, (_, i) => ({ id: `o${i}`, title: "Müşteriyle görüşün", leadId: "l1", assignee: i % 2 ? "Mert Kaya" : "", startAt: new Date(now - (i + 1) * 3_600_000).toISOString(), completed: false })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `t${i}`, title: "Bugün", startAt: "2026-11-16T18:00:00+03:00", completed: false })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `f${i}`, title: "Sonra", startAt: "2026-12-01T10:00:00+03:00" })),
    { id: "x", title: "Tarihsiz" },
  ];
  const tasks = [
    { id: "k1", title: "Teklif gönder", status: "todo", dueAt: "2026-11-10T10:00:00+03:00", assignee: "Mert Kaya" },
    { id: "k2", title: "Bitti", status: "done", dueAt: "2026-11-10T10:00:00+03:00" },
    { id: "k3", title: "Yarın", status: "progress", dueAt: "2026-11-17T10:00:00+03:00" },
  ];
  const s = summarizeWork(activities, tasks, leads, now);
  expect(s).toMatchObject({ openActivities: 706, overdueActivities: 700, openTasks: 2, overdueTasks: 1, tasksDueToday: 0 });
  // Bugün: ileri saatli 3 + bugün içinde gecikmiş olanlar (saat 00:00'dan beri 12 saat → 12 kayıt)
  expect(s.activitiesDueToday).toBe(15);
  expect(s.overdueByAssignee).toEqual({ "Mert Kaya": 351, Atanmamış: 350 });
  expect(s.oldestOverdue).toHaveLength(25);
  expect(s.oldestOverdue[0]).toMatchObject({ kind: "activity", id: "o699", leadName: "Ayşe Yılmaz" });
  expect(summarizeWork([], [], [], now)).toMatchObject({ openActivities: 0, overdueActivities: 0, oldestOverdue: [] });
});

it("müşteri, mesaj ve arama sayıları tüm kayıtlardan özetlenir", async () => {
  const { summarizeCrm } = await import("../server/assistant");
  const now = Date.parse("2026-11-16T12:00:00+03:00");
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
  const leads = [
    ...Array.from({ length: 900 }, (_, i) => ({ id: `a${i}`, name: "A", phone: "05550000001", stage: "new", city: "Ankara", source: "Instagram", owner: "Mert Kaya", value: 1000, createdAt: iso(24 * 40) })),
    ...Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, name: "B", phone: "", stage: "s_abcd1234", city: "İzmir", country: "Türkiye", source: "", owner: "", value: 500, projectName: "Örnek Proje", createdAt: iso(2) })),
    { id: "w", name: "C", phone: "1", stage: "won", value: 9000, createdAt: iso(24 * 3) },
    { id: "l", name: "D", phone: "1", stage: "lost", value: 7000, createdAt: iso(24 * 20) },
  ];
  const pipelines = [{ id: "sales", stages: [{ id: "new", label: "Yeni fırsat" }, { id: "s_abcd1234", label: "Tapu aşaması" }] }];
  const messages = [
    { lineId: "h1", phone: "905550000001", direction: "outbound", createdAt: iso(5) },
    { lineId: "h1", phone: "905550000001", direction: "inbound", createdAt: iso(1) },
    { lineId: "h1", phone: "905550000002", direction: "inbound", createdAt: iso(30) },
    { lineId: "h1", phone: "905550000002", direction: "outbound", createdAt: iso(29) },
    { lineId: "h2", phone: "905550000003", direction: "inbound", createdAt: iso(24 * 20) },
  ];
  const calls = [
    { direction: "outbound", status: "ended", durationSeconds: 150, agent: "101", startedAt: iso(2) },
    { direction: "inbound", status: "missed", agent: "101", createdAt: iso(48) },
    { direction: "outbound", status: "queued" },
  ];
  const s = summarizeCrm(leads, messages, calls, pipelines, now);
  expect(s.leads).toMatchObject({ total: 1202, open: 1200, won: 1, lost: 1, openValue: 1_050_000, wonValue: 9000, createdToday: 300, createdLast7Days: 301, createdLast30Days: 302, withoutPhone: 300, withoutOwner: 302 });
  expect(s.leads.byCity).toMatchObject({ Ankara: 900, İzmir: 300, Belirtilmemiş: 2 });
  expect(s.leads.byStage).toMatchObject({ "Yeni fırsat": 900, "Tapu aşaması": 300, "Satış tamamlandı": 1, Kaybedildi: 1 });
  expect(s.leads.byOwner).toMatchObject({ "Mert Kaya": 900, Atanmamış: 302 });
  expect(s.leads.byProject).toEqual({ "Örnek Proje": 300 });
  expect(s.leads.byCountry).toEqual({ Türkiye: 300 });
  expect(s.messages).toEqual({ total: 5, inbound: 3, outbound: 2, inboundToday: 1, outboundToday: 1, conversations: 3, waitingReply: 1 });
  expect(s.calls).toMatchObject({ total: 3, today: 1, inbound: 1, outbound: 2, answered: 1, missed: 1, totalMinutes: 3, byAgent: { "101": 2 } });
});
