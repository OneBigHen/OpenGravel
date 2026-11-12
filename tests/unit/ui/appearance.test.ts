import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPEARANCE_BOOT_SCRIPT,
  APPEARANCE_SUN_STORAGE_KEY,
  applyAppearance,
  forgetRiderPlace,
  isAppearanceMode,
  rememberRiderPlace,
  resolveTheme,
  riderSunTheme,
  sunTheme,
} from "@/ui/appearance/appearance";
import { useResolvedTheme } from "@/ui/appearance/use-appearance";

/** State College, PA (40.72, -77.89), on 2026-11-11, Eastern Standard Time (UTC-5). */
const STATE_COLLEGE = { lat: 40.72, lon: -77.89 };
const ONE_PM = Date.parse("2026-11-11T18:00:00.000Z");
const NINE_PM = Date.parse("2026-11-12T02:00:00.000Z");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetRiderPlace();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("appearance", () => {
  it("Auto follows the phone until the rider's place is known; Day and Night are fixed", () => {
    expect(resolveTheme("auto", true)).toBe("day");
    expect(resolveTheme("auto", false)).toBe("night");
    expect(resolveTheme("day", false)).toBe("day");
    expect(resolveTheme("night", true)).toBe("night");
    expect(resolveTheme("day", true, "night")).toBe("day");
    expect(resolveTheme("night", false, "day")).toBe("night");
  });

  it("Auto is night at 9 PM and day at 1 PM at 40.72, -77.89, whatever the phone says", () => {
    const afternoon = sunTheme(STATE_COLLEGE, ONE_PM);
    const evening = sunTheme(STATE_COLLEGE, NINE_PM);
    expect(afternoon?.theme).toBe("day");
    expect(evening?.theme).toBe("night");
    for (const phoneLight of [true, false]) {
      expect(resolveTheme("auto", phoneLight, afternoon?.theme ?? null)).toBe("day");
      expect(resolveTheme("auto", phoneLight, evening?.theme ?? null)).toBe("night");
    }
    // The afternoon answer holds until sunset (about 4:55 PM EST), not past it.
    expect(afternoon?.untilMs).toBeGreaterThan(ONE_PM);
    expect(afternoon?.untilMs).toBeLessThanOrEqual(ONE_PM + 3_600_000);
  });

  it("remembers the rider's place only roughly and uses it for Auto", () => {
    expect(riderSunTheme(ONE_PM)).toBeNull();
    rememberRiderPlace({ lat: 40.7234, lon: -77.8912 });
    const stored = JSON.parse(localStorage.getItem(APPEARANCE_SUN_STORAGE_KEY) ?? "{}") as { lat: number; lon: number };
    expect(stored.lat).toBe(40.7);
    expect(stored.lon).toBe(-77.9);
    expect(riderSunTheme(ONE_PM)).toBe("day");
    expect(riderSunTheme(NINE_PM)).toBe("night");
  });

  it("puts the sun's theme on the page for Auto", () => {
    rememberRiderPlace(STATE_COLLEGE);
    const expected = riderSunTheme();
    expect(applyAppearance("auto")).toBe(expected);
    expect(document.documentElement.dataset["theme"]).toBe(expected);
  });

  it("the pre-paint script reads the sun's kept theme while it is current", () => {
    expect(APPEARANCE_BOOT_SCRIPT).toContain(APPEARANCE_SUN_STORAGE_KEY);
    localStorage.setItem(APPEARANCE_SUN_STORAGE_KEY, JSON.stringify({ lat: 40.7, lon: -77.9, theme: "night", until: Date.now() + 60_000 }));
    document.documentElement.dataset["theme"] = "day";
    new Function(APPEARANCE_BOOT_SCRIPT)();
    expect(document.documentElement.dataset["theme"]).toBe("night");
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
