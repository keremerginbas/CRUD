// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import CRMPersonalization from "../client/src/workspace/components/CRMPersonalization";
import type { CrmWorkspaceFilters } from "../shared/crm-workspace";

const filters: CrmWorkspaceFilters = {
  query: "",
  owner: "all",
  source: "all",
  activity: "all",
  pipeline: "sales",
  stage: "all",
  city: "",
  createdFrom: "",
  createdTo: "",
  minValue: "",
  maxValue: "",
  contact: "any",
  company: "any",
};

afterEach(() => cleanup());

describe("CRMPersonalization", () => {
  it("keeps advanced filters local until apply and sends the controlled filters to the parent", () => {
    const onApply = vi.fn();
    render(<CRMPersonalization filters={filters} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: /Gelişmiş filtre/ }));
    fireEvent.change(screen.getByLabelText("Şehir"), {
      target: { value: "İstanbul" },
    });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Filtreleri uygula/ }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ city: "İstanbul" }),
    );
  });

  it("does not allow removing the required name or communication columns", () => {
    render(<CRMPersonalization filters={filters} />);
    fireEvent.click(screen.getByRole("button", { name: /^Düzen$/ }));
    const columns = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(columns[0].checked).toBe(true);
    expect(columns[columns.length - 1].checked).toBe(true);
    expect(columns[0].hasAttribute("readonly")).toBe(true);
    expect(columns[columns.length - 1].hasAttribute("readonly")).toBe(true);
  });
});
