import { describe, expect, it } from "vitest";
import { buildReport } from "../shared/assistant";

const range = { from: "2025-01-01", to: "2025-01-31" };
const value = (report: ReturnType<typeof buildReport>, key: string) =>
  report.metrics.find((metric) => metric.key === key)?.value;

function limitContaining(
  report: ReturnType<typeof buildReport>,
  text: string,
): string {
  return report.dataLimits.find((limit) => limit.includes(text)) || "";
}

describe("buildReport veri sınırları", () => {
  it("bilinmeyen yönü outbound saymaz ve eksik zamanları sayısal sınır olarak bildirir", () => {
    const report = buildReport(
      {
        leads: [{ id: "l1" }, { id: "l2", createdAt: "not-a-date" }],
        messages: [
          { createdAt: "2025-01-02T10:00:00Z", direction: "inbound" },
          { createdAt: "2025-01-03T10:00:00Z", direction: "outbound" },
          { createdAt: "2025-01-04T10:00:00Z", direction: "sideways" },
          { direction: "in" },
        ],
        calls: [{ createdAt: "bad" }],
        tasks: [{ status: "done" }],
        activities: [{ createdAt: "bad" }],
        events: [{ type: "stage-change", createdAt: "bad" }],
      },
      range,
      new Date("2025-02-01T00:00:00Z"),
    );

    expect(value(report, "inboundMessages")).toBe(1);
    expect(value(report, "outboundMessages")).toBe(1);
    expect(report.dataLimits).toContain(
      "1 mesaj kaydının yönü bilinmiyor; yalnızca açıkça in/inbound ve out/outbound yönleri sayıldı.",
    );
    expect(
      limitContaining(report, "lead kaydında geçerli oluşturulma zamanı yok"),
    ).toContain("2");
    expect(
      limitContaining(report, "mesaj kaydında geçerli oluşturulma zamanı yok"),
    ).toContain("1");
    expect(
      limitContaining(report, "arama kaydında geçerli oluşturulma zamanı yok"),
    ).toContain("1");
    expect(
      limitContaining(
        report,
        "tamamlanmış görevde geçerli tamamlanma zamanı yok",
      ),
    ).toContain("1");
    expect(
      limitContaining(report, "aktivite kaydında geçerli zaman yok"),
    ).toContain("1");
    expect(
      limitContaining(report, "aşama değişikliği olayında geçerli zaman yok"),
    ).toContain("1");
  });

  it("geçerli ama dönem dışı stage geçmişini kullanılabilir sayar; geçersiz olayı saymaz", () => {
    const report = buildReport(
      {
        leads: [{ stage: "won" }],
        events: [
          {
            type: "stage-change",
            createdAt: "2024-12-31T20:00:00Z",
            payload: { toStage: "won" },
          },
          {
            type: "stage-change",
            createdAt: "invalid",
            payload: { toStage: "won" },
          },
        ],
      },
      range,
      new Date("2025-02-01T00:00:00Z"),
    );

    expect(value(report, "stageChanges")).toBe(0);
    expect(value(report, "wonInRange")).toBe(0);
    expect(report.dataLimits).not.toContain(
      "Aşama değişikliği geçmişi yok; dönemsel kazanım ve günlük kazanım sayısı hesaplanmadı.",
    );
    expect(
      limitContaining(report, "aşama değişikliği olayında geçerli zaman yok"),
    ).toContain("1");
  });

  it("mevcut pipeline metriklerini dönemsel tarih filtresinden ayrı tutar", () => {
    const report = buildReport(
      { leads: [{ stage: "open" }, { stage: "won" }, { stage: "lost" }] },
      range,
      new Date("2025-02-01T00:00:00Z"),
    );
    expect(value(report, "pipelineOpen")).toBe(1);
    expect(value(report, "pipelineWon")).toBe(1);
    expect(value(report, "pipelineLost")).toBe(1);
  });
});
