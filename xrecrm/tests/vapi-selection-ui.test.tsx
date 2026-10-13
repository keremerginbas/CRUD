// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import VapiCallFields, {
  canUseVapiSelection,
  type VapiOptions,
} from "../client/src/workspace/components/VapiCallFields";
vi.mock("../client/src/workspace/store", () => ({
  useStore: () => ({ demo: false, user: { openId: "test" }, request: vi.fn() }),
}));
afterEach(cleanup);
const catalog: VapiOptions = {
  keyConfigured: true,
  assistants: [
    { id: "asst-a", name: "Giden proje asistanı" },
    { id: "asst-b", name: "Gelen proje asistanı" },
  ],
  lines: [
    {
      lineId: "cloud-8",
      phone: "+905553000008",
      group: "cloud",
      name: "FİNEST YAŞAMKENT",
      phoneNumberId: "remote-a",
      credentialConfigured: true,
      inboundAssistantId: "asst-b",
    },
  ],
  unavailableLineIds: [],
  unmatchedNumbers: 0,
  webhookConfigured: false,
  checkedAt: "2026-10-13T10:00:00Z",
};
it("Bulut PBX hatları doğrulandığında seçilebilir; gelen asistan kendiliğinden giden asistan olmaz", () => {
  const onAssistant = vi.fn();
  const onLine = vi.fn();
  render(
    <VapiCallFields
      catalog={catalog}
      loading={false}
      error=""
      lineId=""
      assistantId=""
      onLine={onLine}
      onAssistant={onAssistant}
      onReload={() => {}}
    />,
  );
  expect(screen.getByRole("option", { name: /FİNEST YAŞAMKENT/ })).toBeTruthy();
  expect(onLine).toHaveBeenCalledWith("cloud-8");
  expect(onAssistant).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Vapi asistanı"), {
    target: { value: "asst-a" },
  });
  expect(onAssistant).toHaveBeenCalledWith("asst-a");
});
it("yalnız gerçekten katalogda bulunan asistan ve hat başlatma seçimini açar", () => {
  expect(canUseVapiSelection(catalog, "cloud-8", "asst-a")).toBe(true);
  expect(canUseVapiSelection(catalog, "ai-3", "asst-a")).toBe(false);
  expect(canUseVapiSelection(catalog, "cloud-8", "")).toBe(false);
  expect(canUseVapiSelection(catalog, "cloud-8", "başka-hesap")).toBe(false);
  expect(canUseVapiSelection(null, "cloud-8", "asst-a")).toBe(false);
});
it("API anahtarı veya asistan promptu istemci formunda istenmez", () => {
  render(
    <VapiCallFields
      catalog={catalog}
      loading={false}
      error=""
      lineId="cloud-8"
      assistantId=""
      onLine={() => {}}
      onAssistant={() => {}}
      onReload={() => {}}
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.getByText(/webhook\/n8n köprüsü henüz doğrulanmadı/),
  ).toBeTruthy();
});
