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
