import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isAppearanceMode, resolveTheme } from "@/ui/appearance/appearance";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset["theme"];
});

describe("appearance", () => {
  it("Auto follows the phone, Day and Night are fixed", () => {
    expect(resolveTheme("auto", true)).toBe("day");
    expect(resolveTheme("auto", false)).toBe("night");
    expect(resolveTheme("day", false)).toBe("day");
    expect(resolveTheme("night", true)).toBe("night");
  });

  it("accepts only the three stored modes", () => {
    expect(isAppearanceMode("day")).toBe(true);
    expect(isAppearanceMode("light")).toBe(false);
    expect(isAppearanceMode(null)).toBe(false);
  });

  it("re-reads the theme when the phone's own setting changes", () => {
    // Screens that draw with the theme (a night map thumbnail) must hear the
    // live system change, not only a Day / Night choice made in Settings.
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("light"),
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }));
    document.documentElement.dataset["theme"] = "day";
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("day");
    document.documentElement.dataset["theme"] = "night";
    act(() => { for (const listener of listeners) listener(); });
    expect(result.current).toBe("night");
  });
});
