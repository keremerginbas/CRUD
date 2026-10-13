// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { StoreProvider } from "../client/src/workspace/store";
import Access from "../client/src/workspace/pages/Access";
import Employees from "../client/src/workspace/pages/Employees";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Erişim ve şirket yapısı ekranları", () => {
  it("demo rol matrisi düzenlenir, kilitli sahip değişmez, gerçek API yazımı yapılmaz", async () => {
    render(
      <StoreProvider>
        <Access />
      </StoreProvider>,
    );
    const save = screen.getByRole("button", { name: /Değişiklikleri kaydet/ });
    expect(save.hasAttribute("disabled")).toBe(false);
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]);
    fireEvent.click(save);
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("xre-access-demo-v1")!).roles.find(
          (r: any) => r.id === "manager",
        ).grants.crm.read,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Sahip/ }));
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("örnek departman ağacını gösterir ve yeni alt departman kaydeder", async () => {
    render(
      <StoreProvider>
        <Employees structure />
      </StoreProvider>,
    );
    expect(screen.getByText("Şirket yapısı")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Departman ekle/ }));
    fireEvent.change(screen.getByLabelText("Departman adı"), {
      target: { value: "Yazılım Destek" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() =>
      expect(screen.getAllByText("Yazılım Destek").length).toBeGreaterThan(0),
    );
    expect(
      JSON.parse(localStorage.getItem("xre-access-demo-v1")!).departments.some(
        (d: any) => d.name === "Yazılım Destek",
      ),
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
