// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { StoreProvider, useStore } from "../client/src/workspace/store";
import LeadModal from "../client/src/workspace/components/LeadModal";
import WhatsApp from "../client/src/workspace/pages/WhatsApp";
function StateHarness() {
  const s = useStore();
  return (
    <>
      <output data-testid="state">{JSON.stringify(s.data)}</output>
      <output data-testid="user">{JSON.stringify(s.user)}</output>
      <button onClick={() => s.moveLead("demo-1", "qualified")}>Taşı</button>
      <button onClick={() => s.setDemo(false)}>Canlıya geç</button>
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  if (!globalThis.crypto.randomUUID)
    vi.stubGlobal("crypto", { randomUUID: () => Math.random().toString(36) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("CRM çalışma alanı", () => {
  it("boş oturumu yetkili kullanıcı olarak yorumlamaz ve demo dışına çıkmaz", async () => {
    render(
      <StoreProvider>
        <StateHarness />
      </StoreProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("null"),
    );
    fireEvent.click(screen.getByText("Canlıya geç"));
    expect(
      JSON.parse(screen.getByTestId("state").textContent!).leads,
    ).toHaveLength(10);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("Kanban aşamasını günceller ve ilgili demo kuralını geçmişe işler", async () => {
    render(
      <StoreProvider>
        <StateHarness />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByText("Taşı"));
    await screen.findByText("Randevu tarih ve saatini seçin");
    fireEvent.change(screen.getByLabelText(/Randevu günü/), {
      target: { value: "2030-10-13" },
    });
    fireEvent.change(screen.getByLabelText(/Randevu saati/), {
      target: { value: "11:00" },
    });
    fireEvent.click(screen.getByText("Randevuyu kaydet ve taşı"));
    await waitFor(() => {
      const d = JSON.parse(screen.getByTestId("state").textContent!);
      expect(d.leads[0].stage).toBe("qualified");
      expect(
        d.events.some(
          (e: any) => e.title === "Nitelikli müşteri · Danışmana görev",
        ),
      ).toBe(true);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("müşteri formunu kaydeder ve örnek veriyi kalıcı yerel depoya aktarır", async () => {
    const close = vi.fn();
    render(
      <StoreProvider>
        <LeadModal onClose={close} />
        <StateHarness />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("Ad Soyad"), {
      target: { value: "Test Müşterisi" },
    });
    fireEvent.change(screen.getByPlaceholderText("+90 5xx xxx xx xx"), {
      target: { value: "+905551234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    const d = JSON.parse(localStorage.getItem("xre-demo-v2")!);
    expect(d.leads.some((l: any) => l.name === "Test Müşterisi")).toBe(true);
  });
  it("demo mesajını kaydeder ancak gerçek mesaj API çağrısı yapmaz", async () => {
    render(
      <StoreProvider>
        <WhatsApp onLead={() => {}} />
        <StateHarness />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("Mesajınızı yazın…"), {
      target: { value: "Test demo mesajı" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mesaj gönder" }));
    await waitFor(() =>
      expect(screen.getAllByText("Test demo mesajı").length).toBeGreaterThan(0),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("QR düğmesi sahte kod üretmez, açık kurulum engelini gösterir", async () => {
    render(
      <StoreProvider>
        <WhatsApp onLead={() => {}} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hesap bağla" }));
    await waitFor(() =>
      expect(screen.getByText("Oturum sağlayıcısı gerekli")).toBeTruthy(),
    );
    expect(screen.queryByAltText("WhatsApp gerçek oturum QR kodu")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
