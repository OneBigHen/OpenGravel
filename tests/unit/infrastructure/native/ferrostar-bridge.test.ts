import { describe, expect, it, vi } from "vitest";

import { nativeNavigationBridge } from "@/infrastructure/native/ferrostar-bridge";

function plugin() {
  return {
    isAvailable: vi.fn(async () => ({ available: true })),
    start: vi.fn(async () => ({ accepted: true, activeRouteId: "route_1" })),
    stop: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    showOverview: vi.fn(async () => undefined),
    recenter: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: () => undefined })),
  };
}

describe("nativeNavigationBridge", () => {
  it("is absent in a browser", () => {
    expect(nativeNavigationBridge({})).toBeUndefined();
  });

  it("is absent when the native shell has not registered the complete plugin", () => {
    expect(
      nativeNavigationBridge({
        Capacitor: {
          isNativePlatform: () => true,
          Plugins: { OpenGravelNavigation: { stop: async () => undefined } },
        },
      }),
    ).toBeUndefined();
  });

  it("returns the registered native navigation plugin unchanged", async () => {
    const registered = plugin();
    const bridge = nativeNavigationBridge({
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: { OpenGravelNavigation: registered },
      },
    });

    expect(bridge).toBe(registered);
    await expect(bridge?.isAvailable()).resolves.toEqual({ available: true });
  });
});
