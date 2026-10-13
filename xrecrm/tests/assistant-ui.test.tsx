// @vitest-environment jsdom
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { StoreProvider, useStore } from "../client/src/workspace/store";
import {
  AssistantProvider,
  GlobalAssistant,
  ChatSurface,
  useAssistant,
} from "../client/src/workspace/components/Assistant";
import { applyAssistantAction } from "../client/src/workspace/assistant-actions";
import { makeDemo, emptyState } from "../client/src/workspace/data";
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  vi.stubGlobal("crypto", { randomUUID: () => `test-${Math.random()}` });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Harness() {
  const s = useStore();
  const ai = useAssistant();
  return (
    <>
      <GlobalAssistant navigate={() => {}} onLead={() => {}} />
      <button onClick={() => ai.send('Görev: "Teklifi kontrol et"')}>
        Görev iste
      </button>
      <output data-testid="tasks">
        {s.data.tasks.map((t) => t.title).join("|")}
      </output>
    </>
  );
}
describe("CRM yapay zekâ kullanıcı akışları", () => {
  it("her sayfada chatbotu açar, yerel demo yanıtını ağ çağrısı yapmadan gösterir", async () => {
    render(
      <StoreProvider>
        <AssistantProvider path="/kanban">
          <Harness />
        </AssistantProvider>
      </StoreProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "CRM yapay zekâ asistanını aç" }),
    );
    fireEvent.change(screen.getByLabelText("Asistana mesaj"), {
      target: { value: "CRM hunimi analiz et" },
    });
    fireEvent.click(screen.getByLabelText("Asistana gönder"));
    await waitFor(() =>
      expect(screen.getByText(/yerel demo yanıtıdır/)).toBeTruthy(),
    );
    expect(vi.mocked(fetch).mock.calls.every((c) => c[0] === "/api/me")).toBe(
      true,
    );
  });
  it("demoda görev önerisini inceleyerek CRM görevlerine uygular", async () => {
    render(
      <StoreProvider>
        <AssistantProvider path="/tasks">
          <Harness />
        </AssistantProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText("CRM yapay zekâ asistanını aç"));
    fireEvent.click(screen.getByText("Görev iste"));
    await waitFor(() =>
      expect(screen.getByText(/Demo görev önerisi:/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByText(/Demo görev önerisi:/));
    fireEvent.click(screen.getByRole("button", { name: "CRM’ye uygula" }));
    await waitFor(() =>
      expect(screen.getByTestId("tasks").textContent).toContain(
        "Teklifi kontrol et",
      ),
    );
  });
  it("statü patch alanını mevcut müşteriyle birleştirir ve yabancı müşteri ilişkisini reddeder", async () => {
    const data = makeDemo();
    const saveLead = vi.fn();
    const s: any = { data, demo: true, user: null, saveLead };
    const action: any = {
      id: "proposal-1",
      kind: "lead",
      operation: "update",
      recordId: data.leads[0].id,
      summary: "Aşamayı değiştir",
      payload: { patch: { stage: "proposal" } },
    };
    await applyAssistantAction(action, { stage: "proposal" }, s);
    expect(saveLead.mock.calls[0][0]).toMatchObject({
      id: data.leads[0].id,
      stage: "proposal",
      name: data.leads[0].name,
    });
    await expect(
      applyAssistantAction(
        {
          id: "p2",
          kind: "note",
          operation: "create",
          summary: "",
          payload: {},
        } as any,
        { leadId: "foreign", text: "test" },
        s,
      ),
    ).rejects.toThrow("çalışma alanında");
  });
});
