// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StoreProvider } from "../client/src/workspace/store";
import { ActivityEditor } from "../client/src/workspace/pages/Work";
import { CRMViews } from "../client/src/workspace/components/CRMViews";
import CRMActivities from "../client/src/workspace/pages/CRMActivities";
import { makeDemo } from "../client/src/workspace/data";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("sekme geçişi tek callback üretir, ikinci navigate çağrısı üretmez", () => {
  const change = vi.fn();
  const navigate = vi.fn();
  render(<CRMViews view="kanban" onViewChange={change} navigate={navigate} />);
  fireEvent.click(screen.getByRole("tab", { name: "Liste" }));
  expect(change).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});
it("CRM etkinliği müşteri seçilmeden başarıyla kaydedilmez", () => {
  const close = vi.fn();
  render(
    <StoreProvider>
      <ActivityEditor requireLead onClose={close} />
    </StoreProvider>,
  );
  fireEvent.change(screen.getByLabelText("Başlık"), {
    target: { value: "Müşteri görüşmesi" },
  });
  fireEvent.change(screen.getByLabelText("Başlangıç"), {
    target: { value: "2030-05-07T11:30" },
  });
  fireEvent.change(screen.getByLabelText("Bitiş"), {
    target: { value: "2030-05-07T12:00" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Etkinliği kaydet" }));
  expect(close).not.toHaveBeenCalled();
  expect(localStorage.getItem("xre-demo-v2")).not.toContain("2030-05-07");
});
it("tarihsiz açık görev düzenlenebilir, gizlenmez veya açık yok denmez", () => {
  const state = makeDemo();
  state.tasks = [
    {
      ...state.tasks[0],
      id: "undated",
      leadId: state.leads[0].id,
      title: "Tarihsiz müşteri görevi",
      status: "todo",
      dueAt: "",
    },
  ];
  state.activities = [];
  localStorage.setItem("xre-demo-v2", JSON.stringify(state));
  const edit = vi.fn();
  render(
    <StoreProvider>
      <CRMActivities leads={[state.leads[0]]} onEditTask={edit} />
    </StoreProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: /Tarihsiz müşteri görevi · Tarih belirlenmedi/,
    }),
  );
  expect(edit).toHaveBeenCalledWith(expect.objectContaining({ id: "undated" }));
  expect(screen.getByText("Açık kayıt var · Tarih belirlenmedi")).toBeTruthy();
});
