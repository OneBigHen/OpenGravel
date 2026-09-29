import { describe, expect, it } from "vitest";

import { isAppearanceMode, resolveTheme } from "@/ui/appearance/appearance";

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
});
