import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../server/db";
import {
  appointmentStore,
  appointmentNotifications,
} from "../server/appointments";
import { appointmentIso, appointmentParts } from "../shared/appointments";
import { callFacts } from "../shared/communications";
import { buildReport } from "../shared/assistant";
describe("Randevu ve gerçek iletişim raporu", () => {
  beforeEach(() => {});
  it("ayrı tarih ve saat Türkiye UTC+3 olarak doğrulanır", () => {
    expect(appointmentIso("2030-10-13", "11:00")).toBe(
      "2030-10-13T08:00:00.000Z",
    );
    expect(appointmentParts("2030-10-13T08:00:00.000Z")).toEqual({
      day: "2030-10-13",
      time: "11:00",
    });
    expect(() => appointmentIso("2030-02-30", "11:00")).toThrow();
    expect(() => appointmentIso("2030-10-13", "")).toThrow();
  });
  it("her store yazımında randevu alanı zorunlu ve takvim kaydı oluşur", async () => {
    const raw = createMemoryStore();
    const store = appointmentStore(raw);
    await raw.put(
      "lead",
      "l",
      { id: "l", name: "Müşteri", stage: "new", owner: "x" },
      "owner",
    );
    await expect(
      store.put("lead", "l", { id: "l", stage: "qualified" }, "owner"),
    ).rejects.toThrow("zorunludur");
    const start = new Date(Date.now() + 300000).toISOString();
    await store.put(
      "lead",
      "l",
      {
        id: "l",
        name: "Müşteri",
        stage: "qualified",
        appointmentAt: start,
        owner: "x",
      },
      "owner",
    );
    const a = await raw.get<any>("activities", "appointment-l", "owner");
    expect(a?.payload.startAt).toBe(start);
    expect(a?.payload.title).toBe("Müşteriyle görüşün");
    await expect(
      store.put(
        "lead",
        "l",
        { id: "l", stage: "qualified", appointmentAt: "" },
        "owner",
      ),
    ).rejects.toThrow();
  });
  it("10 dk hatırlatma tektir, okunur ve tarih değişiminde eski hatırlatma kaybolur", async () => {
    const raw = createMemoryStore(),
      store = appointmentStore(raw);
    const clock = Date.now();
    const start = new Date(clock + 300000).toISOString();
    await store.put(
      "lead",
      "l",
      { id: "l", name: "Test", stage: "qualified", appointmentAt: start },
      "o",
    );
    const first = await appointmentNotifications(raw, "o", "u", clock);
    expect(first).toHaveLength(1);
    expect((await appointmentNotifications(raw, "o", "u", clock))[0].id).toBe(
      first[0].id,
    );
    await raw.put(
      "notification_ack",
      `u:${first[0].id}`,
      { userOpenId: "u" },
      "o",
    );
    expect((await appointmentNotifications(raw, "o", "u", clock))[0].read).toBe(
      true,
    );
    await store.put(
      "lead",
      "l",
      {
        id: "l",
        stage: "qualified",
        appointmentAt: new Date(clock + 3600000).toISOString(),
      },
      "o",
    );
    expect(await appointmentNotifications(raw, "o", "u", clock)).toHaveLength(
      0,
    );
  });
  it("ended tek başına başarılı sayılmaz ve görüşün kaydı aramadan ayrıdır", () => {
    expect(callFacts({ status: "ended" }).outcome).toBe("unknown");
    expect(
      callFacts({
        status: "ended",
        analysis: { successEvaluation: "true" },
        direction: "inbound",
        durationSeconds: 9,
      }),
    ).toMatchObject({
      outcome: "success",
      connected: true,
      direction: "inbound",
    });
    const report = buildReport(
      {
        calls: [
          {
            createdAt: "2026-10-13T08:00:00Z",
            status: "ended",
            direction: "outbound",
          },
          {
            createdAt: "2026-10-13T08:00:00Z",
            status: "ended",
            direction: "inbound",
            successEvaluation: true,
          },
        ],
        activities: [
          {
            type: "meeting",
            createdAt: "2026-10-13T08:00:00Z",
            startAt: "2026-10-15T08:00:00Z",
            completed: false,
          },
        ],
      },
      { from: "2026-10-13", to: "2026-10-13" },
    );
    const val = (key: string) =>
      report.metrics.find((m) => m.key === key)?.value;
    expect(val("calls")).toBe(2);
    expect(val("incomingCalls")).toBe(1);
    expect(val("successfulCalls")).toBe(1);
    expect(val("unknownOutcomeCalls")).toBe(1);
    expect(val("createdMeetings")).toBe(1);
  });
  it("randevudan çıkış eski etkinliği iptal eder ve bildirim üretmez", async () => {
    const raw = createMemoryStore(),
      store = appointmentStore(raw);
    await store.put(
      "lead",
      "l",
      {
        id: "l",
        name: "Test",
        stage: "qualified",
        appointmentAt: new Date(Date.now() + 300000).toISOString(),
      },
      "o",
    );
    await store.put(
      "lead",
      "l",
      {
        id: "l",
        stage: "contacted",
        appointmentAt: new Date(Date.now() + 300000).toISOString(),
      },
      "o",
    );
    expect(
      (await raw.get<any>("activities", "appointment-l", "o"))?.payload
        .cancelled,
    ).toBe(true);
    expect(await appointmentNotifications(raw, "o", "u")).toHaveLength(0);
  });
  it("tarihsiz müşterilerin aşamasını randevu olarak yeniden adlandırmayı reddeder", async () => {
    const raw = createMemoryStore(),
      store = appointmentStore(raw);
    await raw.put(
      "lead",
      "l",
      { id: "l", stage: "proposal", pipelineId: "p" },
      "o",
    );
    await expect(
      store.put(
        "pipelines",
        "p",
        { id: "p", stages: [{ id: "proposal", label: "Randevu" }] },
        "o",
      ),
    ).rejects.toThrow("tüm müşterilere");
  });
});
