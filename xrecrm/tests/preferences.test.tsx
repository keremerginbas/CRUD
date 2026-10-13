// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DEFAULT_PREFERENCES,
  PreferencesSchema,
} from "../shared/preferences";
import {
  DEMO_PREFERENCES_STORAGE_KEY,
  ThemeButton,
  ThemeProvider,
} from "../client/src/workspace/components/ThemePreferences";
import { StoreProvider } from "../client/src/workspace/store";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ user: null }),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("kişisel görünüm tercihleri", () => {
  it("strict sözleşmeyi korur ve demo tercihini yalnız Apply ile kaydeder", async () => {
    expect(
      PreferencesSchema.safeParse({
        ...DEFAULT_PREFERENCES,
        unexpected: true,
      }).success,
    ).toBe(false);

    render(
      <StoreProvider>
        <ThemeProvider>
          <ThemeButton />
        </ThemeProvider>
      </StoreProvider>,
    );

    const button = await screen.findByRole("button", {
      name: "Görünümü kişiselleştir",
    });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("radio", { name: "Mor Cam" }));

    // Selection previews immediately but does not write the local profile.
    expect(document.documentElement.dataset.xreTheme).toBe("purple-glass");
    expect(localStorage.getItem(DEMO_PREFERENCES_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Uygula" }));
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(DEMO_PREFERENCES_STORAGE_KEY) || "null"),
      ).toEqual({ ...DEFAULT_PREFERENCES, theme: "purple-glass" }),
    );
    expect(document.documentElement.dataset.xreTheme).toBe("purple-glass");
  });

  it("vazgeç demo profilini değiştirmez", async () => {
    render(
      <StoreProvider>
        <ThemeProvider>
          <ThemeButton />
        </ThemeProvider>
      </StoreProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Görünümü kişiselleştir",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Okyanus" }));
    expect(document.documentElement.dataset.xreTheme).toBe("ocean");
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(document.documentElement.dataset.xreTheme).toBe("night");
    expect(localStorage.getItem(DEMO_PREFERENCES_STORAGE_KEY)).toBeNull();
  });
});
