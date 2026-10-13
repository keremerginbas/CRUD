// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import App from "../client/src/workspace/App";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState({}, "", "/kanban");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("CRM sekmeleri aynı çalışma alanında dört gerçek görünümü açar", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: /Müşteriler|Müşteri adayları/ });
  const tabs = screen.getByRole("tablist", { name: /CRM görünümü/ });
  fireEvent.click(within(tabs).getByRole("tab", { name: "Liste" }));
  expect(location.pathname).toBe("/leads");
  await screen.findByRole("columnheader", { name: /MÜŞTERİ/ });
  fireEvent.click(
    within(screen.getByRole("tablist", { name: /CRM görünümü/ })).getByRole(
      "tab",
      { name: "Etkinlikler" },
    ),
  );
  expect(location.pathname).toBe("/activities");
  await screen.findByText("Geciken");
  fireEvent.click(
    within(screen.getByRole("tablist", { name: /CRM görünümü/ })).getByRole(
      "tab",
      { name: "Takvim" },
    ),
  );
  expect(location.pathname).toBe("/calendar");
  await screen.findByRole("button", { name: "Sonraki ay" });
  fireEvent.click(
    screen.getByRole("button", { name: "Görünümü kişiselleştir" }),
  );
  await screen.findByRole("dialog", { name: "Görünümü kişiselleştir" });
});
