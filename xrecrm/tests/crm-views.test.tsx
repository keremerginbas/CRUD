// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  activityBucket,
  next,
  openCount,
  type CrmOpenRecord,
} from "../shared/crm-activities";
import { CRMViews } from "../client/src/workspace/components/CRMViews";

describe("CRM v6 activity helpers", () => {
  it("counts only open tasks and activities and selects the closest dated record", () => {
    const tasks = [
      { id: "undated", leadId: "lead-1", title: "Tarihsiz görev", status: "todo" },
      { id: "done", leadId: "lead-1", title: "Bitti", status: "done", dueAt: "2026-10-13T08:00:00.000Z" },
      { id: "later", leadId: "lead-1", title: "Sonra", status: "progress", dueAt: "2026-10-15T08:00:00.000Z" },
    ];
    const activities = [
      { id: "cancelled", leadId: "lead-1", title: "İptal", startAt: "2026-10-13T09:00:00.000Z", completed: false, cancelled: true },
      { id: "soon", leadId: "lead-1", title: "Yakın etkinlik", startAt: "2026-10-14T08:00:00.000Z", completed: false },
    ];
    expect(openCount("lead-1", tasks, activities)).toBe(3);
    expect(next("lead-1", tasks, activities)).toMatchObject({ id: "soon", kind: "activity" });
    expect(next("other", tasks, activities)).toBeUndefined();
  });

  it("uses the exact Istanbul time before assigning today versus overdue", () => {
    const make = (date: string): CrmOpenRecord => ({
      id: date,
      leadId: "lead-1",
      title: "Takip",
      date,
      kind: "task",
      record: { id: date, leadId: "lead-1", dueAt: date, status: "todo" },
    });
    const now = new Date("2026-10-13T10:00:00.000Z"); // 13:00 in Istanbul
    expect(activityBucket(make("2026-10-13T09:59:00.000Z"), now)).toBe("overdue");
    expect(activityBucket(make("2026-10-13T10:00:00.000Z"), now)).toBe("today");
    expect(activityBucket(undefined, now)).toBe("none");
  });

  it("uses Monday calendar weeks for next week and two weeks later", () => {
    const now = new Date("2026-10-13T08:00:00.000Z"); // Tuesday in Istanbul
    const make = (date: string): CrmOpenRecord => ({
      id: date,
      leadId: "lead-1",
      title: "Takip",
      date,
      kind: "activity",
      record: { id: date, leadId: "lead-1", startAt: date, completed: false },
    });
    expect(activityBucket(make("2026-10-19T08:00:00.000Z"), now)).toBe("next-week");
    expect(activityBucket(make("2026-10-26T08:00:00.000Z"), now)).toBe("two-weeks");
  });
});

describe("CRMViews", () => {
  it("exposes four accessible tabs and routes each tab to its main CRM path", () => {
    const navigate = vi.fn();
    render(<CRMViews view="kanban" count={4} navigate={navigate} />);
    expect(screen.getByRole("heading", { name: /Müşteriler/ })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    fireEvent.click(screen.getByRole("tab", { name: /Etkinlikler/ }));
    expect(navigate).toHaveBeenCalledWith("/activities");
    expect(screen.getByRole("tab", { name: /Kanban/ }).getAttribute("aria-selected")).toBe("true");
  });
});
