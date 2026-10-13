// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import App from "../client/src/workspace/App";
beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/access");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ user: null, identity: null }),
    })),
  );
  vi.stubGlobal("scrollTo", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Ortak CRM kabuğu", () => {
  it("erişim, çalışanlar, şirket yapısı, profil ve mesai yolları gerçek modülleri açar", async () => {
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Erişim ve roller" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Çalışanlar" }));
    expect(
      await screen.findByRole("heading", { name: "Çalışanlar" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Şirket yapısı" }));
    expect(
      await screen.findByRole("heading", { name: "Ekip yapısı" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Profilim" }));
    expect(
      await screen.findByRole("heading", { name: "Profilim" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "XRE Mesai" }));
    expect(
      await screen.findByRole("button", { name: "Mesaiyi başlat" }),
    ).toBeTruthy();
    expect(location.pathname).toBe("/worktime");
    expect(
      screen.getByRole("img", { name: "XRE CRM" }).getAttribute("src"),
    ).toBe("/xre-crm-logo-white.png");
  });
});
