import { expect, it } from "vitest";
import { senetCsv } from "../shared/senet";

it("senet dökümü Excel için: noktalı virgül, virgüllü kuruş, gecikme faizi ve formül koruması", () => {
  const base = { quoteNo: "T-1", customer: "=HYPERLINK(\"x\")", phone: "+905550000000", projectName: "Nova; Life", unitLabel: "A-12", employee: "Ayşe", lateInterestMonthlyPct: 3 };
  const csv = senetCsv(
    [
      { ...base, senet: { no: 1, of: 2, amount: 100000, currency: "TRY", dueDate: "2026-10-17", kind: "taksit", status: "bekliyor", paidAt: null } as never },
      { ...base, senet: { no: 2, of: 2, amount: 50000.5, currency: "TRY", dueDate: "2026-12-17", kind: "taksit", status: "bekliyor", paidAt: null } as never },
    ],
    "2026-11-16",
  );
  const lines = csv.replace("﻿", "").trim().split("\r\n");
  expect(lines).toHaveLength(3);
  expect(lines[0].split(";")).toHaveLength(17);
  // 30 gün gecikme × %3 = 3.000,00
  expect(lines[1]).toContain(";1/2;taksit;2026-10-17;100000,00;TRY;Vadesi geçti;;30;3,00;3000,00;103000,00;Ayşe");
  expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
  expect(lines[1]).toContain(`'+905550000000`);
  expect(lines[1]).toContain(`"Nova; Life"`);
  expect(lines[2]).toContain(";50000,50;TRY;Bekliyor;;0;3,00;0,00;50000,50;");
});
