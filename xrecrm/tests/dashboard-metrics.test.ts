import { describe, expect, it } from "vitest";
import { computeDashboard, dayKey, dayKeys } from "../client/src/workspace/dashboard-metrics";

const NOW = Date.parse("2026-10-13T09:00:00Z"); // 12:00 İstanbul
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString();
const lead = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, phone: "", email: "", company: "", stage: "new", owner: "Ali", value: 100,
  source: "Web", notes: "", createdAt: iso(1), lastActivity: iso(1), tags: [], ...over,
}) as any;

describe("Genel bakış metrikleri", () => {
  it("Türkiye gününe göre anahtar üretir", () => {
    expect(dayKey("2026-10-12T21:30:00Z")).toBe("2026-10-13");
    expect(dayKeys(3, NOW)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13"]);
  });

  it("dönem KPI'larını, ajandayı ve dikkat listelerini hesaplar", () => {
    const m = computeDashboard(
      {
        leads: [
          lead("a"),
          lead("b", { createdAt: iso(30), stage: "won", value: 500, lastActivity: iso(2) }),
          lead("c", { createdAt: iso(24 * 10), owner: "Ayşe" }),
          lead("d", { stage: "lost", lastActivity: iso(3) }),
        ],
        messages: [
          { id: "m1", leadId: "a", text: "Fiyat?", direction: "inbound", createdAt: iso(2), status: "received" },
          { id: "m2", leadId: "c", text: "Selam", direction: "inbound", createdAt: iso(5), status: "received" },
          { id: "m3", leadId: "c", text: "Merhaba", direction: "outbound", createdAt: iso(4), status: "sent" },
        ],
        calls: [
          { id: "c1", leadId: "a", status: "missed", direction: "inbound", createdAt: iso(3) },
          { id: "c2", leadId: "c", status: "missed", direction: "inbound", createdAt: iso(6) },
          { id: "c3", leadId: "c", status: "ended", direction: "outbound", createdAt: iso(5) },
        ],
        tasks: [
          { id: "t1", title: "Ara", status: "todo", leadId: "c", dueAt: iso(1), assignee: "Ayşe" },
          { id: "t2", title: "Bitti", status: "done", leadId: "a", dueAt: iso(1), assignee: "Ali" },
        ],
        activities: [
          { id: "x1", leadId: "a", type: "meeting", title: "Görüşme", startAt: new Date(NOW + 3600_000).toISOString(), endAt: new Date(NOW + 7200_000).toISOString(), completed: false },
        ],
      } as any,
      "7d",
      NOW,
    );
    expect(m.kpis).toMatchObject({ newLeads: 3, wonCount: 1, wonValue: 500, conversion: 50, calls: 3, callsMissed: 2, callsAnswered: 1, overdueTasks: 1, openTasks: 1 });
    expect(m.agenda.map((a) => a.id)).toEqual(["t1", "x1"]);
    expect(m.attention.missedCalls.map((c) => c.id)).toEqual(["c1"]);
    expect(m.attention.unansweredChats.map((c) => c.leadId)).toEqual(["a"]);
    expect(m.attention.idleLeads).toEqual([]);
    expect(m.trend).toHaveLength(7);
    expect(m.trend.at(-1)).toMatchObject({ leads: 2, calls: 3 });
    expect(m.owners[0]).toMatchObject({ owner: "Ali", won: 1, wonValue: 500 });
  });
});
