import { afterEach, describe, expect, it } from "vitest";

import { NAV_SCREEN_STORAGE_KEY, readNavScreen, setNavScreen } from "@/ui/navigation/nav-screen";

describe("navigation screen preference", () => {
  afterEach(() => window.localStorage.clear());

  it("defaults to OpenGravel's ride screen", () => {
    expect(readNavScreen()).toBe("opengravel");
  });

  it("remembers the native choice and forgets it on switching back", () => {
    setNavScreen("native");
    expect(readNavScreen()).toBe("native");
    setNavScreen("opengravel");
    expect(window.localStorage.getItem(NAV_SCREEN_STORAGE_KEY)).toBeNull();
    expect(readNavScreen()).toBe("opengravel");
  });

  it("ignores a corrupt stored value", () => {
    window.localStorage.setItem(NAV_SCREEN_STORAGE_KEY, "carplay");
    expect(readNavScreen()).toBe("opengravel");
  });
});
