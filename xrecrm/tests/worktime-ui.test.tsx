// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Worktime from "../client/src/workspace/pages/Worktime";
import WorktimeMini from "../client/src/workspace/components/WorktimeMini";
import { StoreProvider } from "../client/src/workspace/store";
import {
  readDemoWorktime,
  transitionDemoWorktime,
} from "../client/src/workspace/worktime-demo";

function mockSessionFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/me")
        return { ok: true, json: async () => ({ user: null }) };
      throw new Error(`Beklenmeyen demo fetch: ${String(input)}`);
    }),
  );
}

function renderWorktime(withWidget = false) {
  return render(
    <StoreProvider>
      <Worktime />
      {withWidget && <WorktimeMini />}
    </StoreProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockSessionFetch();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("demo mesai arayüzü", () => {
  it("start → meal break → resume → finish yaşam döngüsünü sunucu çağrısı olmadan tamamlar", async () => {
    renderWorktime();
    await screen.findByRole("button", { name: /Mesaiyi başlat/ });

    fireEvent.click(screen.getByRole("button", { name: /Mesaiyi başlat/ }));
    await screen.findByText("Mesai başladı.");
    expect(screen.getByText("Mesai açık")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Yemek/ }));
    await screen.findByText("Mola kaydedildi.");
    expect(screen.getByText("Molada")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mesaiye dön/ }));
    await screen.findByText("Mesaiye dönüldü.");
    fireEvent.click(screen.getByRole("button", { name: /Mesaiyi sonlandır/ }));
    await screen.findByText("Mesai kaydedildi.");
    expect(screen.getByText("Tamamlandı")).toBeTruthy();

    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes("/api/worktime"))).toEqual([]);
  });

  it("sayfa geçiş olayını yayınlar ve widget demo kaydını anında yeniler", async () => {
    renderWorktime(true);
    await screen.findByRole("button", { name: /Mesaiyi başlat/ });
    await screen.findByRole("button", { name: /Demo mesai başlamadı/ });

    fireEvent.click(screen.getByRole("button", { name: /Mesaiyi başlat/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Mesai açık/ })).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: /Mesai açık/ }).textContent,
    ).toContain("net çalışma");
  });

  it("demo reducer expectedVersion, idempotency ve aynı gün yeniden başlatma geçmişini korur", () => {
    const now = Date.now();
    const startInput = {
      action: "start" as const,
      operationId: "demo-op-start",
      expectedVersion: 0,
    };
    const started = transitionDemoWorktime(startInput, now - 4_000);
    const duplicate = transitionDemoWorktime(startInput, now - 3_000);
    expect(started.state.version).toBe(1);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.version).toBe(1);

    const finished = transitionDemoWorktime(
      { action: "finish", operationId: "demo-op-finish", expectedVersion: 1 },
      now - 2_000,
    );
    const restarted = transitionDemoWorktime(
      { action: "start", operationId: "demo-op-restart", expectedVersion: 2 },
      now - 1_000,
    );
    expect(finished.state.status).toBe("finished");
    expect(
      restarted.state.periods.filter((period) => period.type === "work"),
    ).toHaveLength(2);
    expect(readDemoWorktime(now).today.version).toBe(3);
  });
});
