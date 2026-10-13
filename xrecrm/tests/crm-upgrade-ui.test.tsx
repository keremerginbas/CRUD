// @vitest-environment jsdom
import React from "react";
import { it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { StoreProvider } from "../client/src/workspace/store";
import CRM from "../client/src/workspace/pages/CRM";
import ImportWizard from "../client/src/workspace/components/ImportWizard";
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
function setup(node: React.ReactNode) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })),
  );
  return render(<StoreProvider>{node}</StoreProvider>);
}
it("liste kolonlarını gerçekten gizler ve ad ile iletişimi korur", async () => {
  setup(<CRM kanban={false} onLead={() => {}} onNew={() => {}} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Düzen" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Düzen" }));
  fireEvent.click(screen.getByLabelText("Kaynak"));
  fireEvent.click(screen.getByRole("button", { name: "Ayarları uygula" }));
  expect(screen.queryByRole("columnheader", { name: "KAYNAK" })).toBeNull();
  expect(
    screen.getByRole("columnheader", { name: "MÜŞTERİ / PORTFÖY" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("columnheader", { name: "ETKİNLİK / İLETİŞİM" }),
  ).toBeTruthy();
});
it("CSV sütunu elle eşlenir; demo aktarım sonucu dış servis olmadan gösterilir", async () => {
  setup(<ImportWizard kind="contacts" onClose={() => {}} />);
  const f = new File(["Kimlik;GSM\nYeni Test;05331231234"], "kisiler.csv", {
    type: "text/csv",
  });
  Object.defineProperty(f, "text", {
    value: async () => "Kimlik;GSM\nYeni Test;05331231234",
  });
  fireEvent.change(screen.getByLabelText("CSV dosyası seç"), {
    target: { files: [f] },
  });
  await screen.findByLabelText("Kimlik sütun eşlemesi");
  fireEvent.change(screen.getByLabelText("Kimlik sütun eşlemesi"), {
    target: { value: "name" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Önizlemeyi oluştur" }));
  await screen.findByRole("button", { name: "1 yeni kaydı içe aktar" });
  fireEvent.click(
    screen.getByRole("button", { name: "1 yeni kaydı içe aktar" }),
  );
  await screen.findByText("Aktarım sonucu");
  expect(screen.getByText(/1 yeni kayıt/)).toBeTruthy();
});
