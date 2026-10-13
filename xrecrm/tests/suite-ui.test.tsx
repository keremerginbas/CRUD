// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { StoreProvider, useStore } from "../client/src/workspace/store";
import { makeDemo } from "../client/src/workspace/data";
import Reports from "../client/src/workspace/pages/Reports";
import LeadModal from "../client/src/workspace/components/LeadModal";
import CRM from "../client/src/workspace/pages/CRM";
import LeadDrawer from "../client/src/workspace/components/LeadDrawer";
import Work from "../client/src/workspace/pages/Work";
import Directory from "../client/src/workspace/pages/Directory";
function State() {
  const { data, moveLead } = useStore();
  return (
    <>
      <output data-testid="suite-state">{JSON.stringify(data)}</output>
      <button onClick={() => moveLead("demo-1", "qualified")}>Rule task</button>
    </>
  );
}
function Drawer() {
  const { data } = useStore();
  return (
    <LeadDrawer lead={data.leads[0]} onClose={() => {}} onMessage={() => {}} />
  );
}
const state = () => JSON.parse(screen.getByTestId("suite-state").textContent!);
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
describe("Bitrix24 tarzı CRM modülleri", () => {
  it("eski demo müşterilerini korur ve yeni modülleri ekler", () => {
    const old = makeDemo();
    const saved: any = { ...old };
    for (const k of [
      "contacts",
      "companies",
      "tasks",
      "activities",
      "feed",
      "members",
      "pipelines",
    ])
      delete saved[k];
    saved.leads[0].notes = "Kullanıcının saklanan notu";
    localStorage.setItem("xre-demo-v2", JSON.stringify(saved));
    render(
      <StoreProvider>
        <State />
      </StoreProvider>,
    );
    expect(state().leads[0].notes).toBe("Kullanıcının saklanan notu");
    expect(state().contacts.length).toBeGreaterThan(0);
    expect(state().tasks.length).toBeGreaterThan(0);
  });
  it("statü kuralı gerçek görev modülüne bağlı demo görev oluşturur", async () => {
    render(
      <StoreProvider>
        <State />
      </StoreProvider>,
    );
    const initial = state().tasks.length;
    fireEvent.click(screen.getByText("Rule task"));
    await screen.findByText("Randevu tarih ve saatini seçin");
    fireEvent.change(screen.getByLabelText(/Randevu günü/), {
      target: { value: "2030-10-13" },
    });
    fireEvent.change(screen.getByLabelText(/Randevu saati/), {
      target: { value: "11:00" },
    });
    fireEvent.click(screen.getByText("Randevuyu kaydet ve taşı"));
    await waitFor(() => expect(state().tasks.length).toBe(initial + 1));
    expect(state().tasks[0].leadId).toBe("demo-1");
    expect(state().tasks[0].status).toBe("todo");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("huni seçimi fırsatları filtreler ve aşama kimliklerini korur", () => {
    render(
      <StoreProvider>
        <CRM kanban onLead={() => {}} onNew={() => {}} />
        <State />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByLabelText("Satış hunisi"), {
      target: { value: "rent" },
    });
    const rental = state().leads.filter((l: any) => l.pipelineId === "rent");
    expect(rental.length).toBe(1);
    expect(screen.getByText(rental[0].dealTitle)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: state().leads[0].dealTitle }),
    ).toBeNull();
  });
  it("fırsat panelindeki notu ekip akışıyla ilişkili kaydeder", async () => {
    render(
      <StoreProvider>
        <Drawer />
        <State />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByLabelText("Yorum metni"), {
      target: { value: "Müşteri cumartesi ziyaret için teyit verdi." },
    });
    fireEvent.click(screen.getByRole("button", { name: /KAYDET/ }));
    await waitFor(() =>
      expect(
        state().feed.some(
          (p: any) =>
            p.text === "Müşteri cumartesi ziyaret için teyit verdi." &&
            p.leadId === "demo-1",
        ),
      ).toBe(true),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("görevi düzenler, CRM bağlantısını saklar ve tamamlar", async () => {
    render(
      <StoreProvider>
        <Work onLead={() => {}} />
        <State />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yeni görev" }));
    fireEvent.change(
      screen.getByPlaceholderText("Örn. Portföy sunumunu hazırla"),
      { target: { value: "Test satış görevi" } },
    );
    fireEvent.change(screen.getByLabelText("Bağlı CRM müşterisi"), {
      target: { value: "demo-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Görevi kaydet" }));
    await waitFor(() =>
      expect(
        state().tasks.some(
          (t: any) => t.title === "Test satış görevi" && t.leadId === "demo-1",
        ),
      ).toBe(true),
    );
    fireEvent.click(
      screen.getByLabelText("Test satış görevi tamamlanma durumunu değiştir"),
    );
    await waitFor(() =>
      expect(
        state().tasks.find((t: any) => t.title === "Test satış görevi").status,
      ).toBe("done"),
    );
  });
  it("dizin sekmeleri gerçek uygulama sayfalarına yönlenir", () => {
    const navigate = vi.fn();
    render(
      <StoreProvider>
        <Directory type="contacts" onLead={() => {}} navigate={navigate} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Şirketler/ }));
    expect(navigate).toHaveBeenCalledWith("/companies");
  });
  it("yeni fırsat canlı kullanıcı varsayılanını kullanır, sabit demo danışmanı değil", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ user: { name: "Canlı Sahip", canAccess: true } }),
      })),
    );
    function Form() {
      const { user } = useStore();
      return user ? <LeadModal onClose={() => {}} /> : null;
    }
    render(
      <StoreProvider>
        <Form />
      </StoreProvider>,
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Sorumlu danışman") as HTMLSelectElement).value,
      ).toBe("Canlı Sahip"),
    );
  });
  it("şirketsiz kişiye geçişte eski şirket bağlantısını temizler", async () => {
    render(
      <StoreProvider>
        <Drawer />
        <State />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByLabelText("Kişi"), {
      target: { value: "contact-4" },
    });
    expect((screen.getByLabelText("Şirket") as HTMLSelectElement).value).toBe(
      "",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Değişiklikleri kaydet" }),
    );
    await waitFor(() => expect(state().leads[0].companyId).toBe(""));
  });
  it("aynı kişiye bağlı ikinci fırsatı dizinde görünür tutar", () => {
    const d = makeDemo();
    d.leads[1].contactId = "contact-1";
    localStorage.setItem("xre-demo-v2", JSON.stringify(d));
    const onLead = vi.fn();
    render(
      <StoreProvider>
        <Directory type="contacts" onLead={onLead} />
      </StoreProvider>,
    );
    expect(screen.getByText("2 fırsat")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(d.leads[1].dealTitle!) }),
    );
    expect(onLead).toHaveBeenCalledWith(
      expect.objectContaining({ id: d.leads[1].id }),
    );
  });
  it("analitik gecikmiş görüşmeleri ve ilişkisiz görevleri de sayar", () => {
    const d = makeDemo();
    d.tasks = [];
    d.activities = [
      {
        ...d.activities[0],
        startAt: new Date(Date.now() - 86400000).toISOString(),
        endAt: new Date(Date.now() - 86000000).toISOString(),
        completed: false,
        leadId: "",
      },
    ];
    localStorage.setItem("xre-demo-v2", JSON.stringify(d));
    render(
      <StoreProvider>
        <Reports onLead={() => {}} navigate={() => {}} />
      </StoreProvider>,
    );
    const label = screen.getAllByText("Gecikmiş görev & etkinlikler")[0];
    expect(label.parentElement?.querySelector("strong")?.textContent).toBe("1");
    expect(screen.getByText(d.activities[0].title)).toBeTruthy();
  });
});
