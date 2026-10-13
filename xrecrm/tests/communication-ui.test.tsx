// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StoreProvider } from "../client/src/workspace/store";
import { makeDemo } from "../client/src/workspace/data";
import LeadQuickActions, {
  CustomerCallDialog,
} from "../client/src/workspace/components/LeadQuickActions";
import OnlineMeeting from "../client/src/workspace/components/OnlineMeeting";
import WhatsApp from "../client/src/workspace/pages/WhatsApp";
const customer = makeDemo().leads[0];
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
describe("Kart iletişimi ve online toplantı", () => {
  it("kartın Ara ve WhatsApp düğmeleri doğru müşteriyi taşır", () => {
    const event = vi.fn();
    window.addEventListener("xre:call", event);
    const message = vi.fn();
    render(
      <StoreProvider>
        <LeadQuickActions lead={customer} onMessage={message} />
      </StoreProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${customer.name} ara` }),
    );
    expect(event.mock.calls[0][0].detail.leadId).toBe(customer.id);
    fireEvent.click(
      screen.getByRole("button", { name: `${customer.name} WhatsApp` }),
    );
    expect(message).toHaveBeenCalledWith(customer.id);
    window.removeEventListener("xre:call", event);
  });
  it("demo arama gerçekten dış arama isteği göndermez", () => {
    render(
      <StoreProvider>
        <CustomerCallDialog leadId={customer.id} onClose={() => {}} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Yapay zekâ araması" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Demo AI aramasını dene" }),
    );
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === "/api/calls")).toBe(
      false,
    );
  });
  it("ayrı tarih saat seçimi ve demo etkinlik kaydı vardır, sahte link yoktur", async () => {
    render(
      <StoreProvider>
        <OnlineMeeting
          leadId={customer.id}
          onClose={() => {}}
          onShare={() => {}}
        />
      </StoreProvider>,
    );
    expect(
      (screen.getByLabelText("Toplantı tarihi") as HTMLInputElement).required,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Toplantı saati") as HTMLInputElement).required,
    ).toBe(true);
    const future = new Date(Date.now() + 86400000 * 2);
    const day = new Date(future.getTime() + 10800000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(screen.getByLabelText("Toplantı tarihi"), {
      target: { value: day },
    });
    fireEvent.change(screen.getByLabelText("Toplantı saati"), {
      target: { value: "14:30" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Demo toplantısını kaydet" }),
    );
    await screen.findByText(
      "Demo planlama kaydı oluşturuldu. Gerçek Meet bağlantısı üretilmedi.",
    );
    const state = JSON.parse(localStorage.getItem("xre-demo-v2") || "{}");
    const activity = state.activities.find(
      (a: any) => a.title === "Online müşteri görüşmesi",
    );
    expect(activity.leadId).toBe(customer.id);
    expect(activity.startAt).toContain("11:30");
    expect(activity.meetingUrl).toBeUndefined();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([u]) => String(u).includes("/api/meetings")),
    ).toBe(false);
  });
  it("mesaj taslağını hedef konuşmaya yazar ama göndermez", async () => {
    const consume = vi.fn();
    render(
      <StoreProvider>
        <WhatsApp
          initialLead={customer.id}
          initialDraft="Toplantı bağlantınız hazır."
          onDraftConsumed={consume}
          onLead={() => {}}
        />
      </StoreProvider>,
    );
    expect(
      (screen.getByPlaceholderText("Mesajınızı yazın…") as HTMLTextAreaElement)
        .value,
    ).toBe("Toplantı bağlantınız hazır.");
    expect(consume).toHaveBeenCalled();
    expect(
      vi.mocked(fetch).mock.calls.some(([u]) => u === "/api/messages"),
    ).toBe(false);
  });
});
