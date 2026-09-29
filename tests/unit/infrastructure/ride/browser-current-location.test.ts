import { describe, expect, it, vi } from "vitest";
import { createBrowserCurrentLocationSource } from "@/infrastructure/ride/browser-current-location";

describe("one-shot current location source", () => {
  it("requests a fresh high-accuracy location", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { longitude: -77.2, latitude: 40.1 } } as GeolocationPosition);
    });
    const source = createBrowserCurrentLocationSource({ geolocation: { getCurrentPosition } });

    await expect(source.read()).resolves.toEqual({ lon: -77.2, lat: 40.1 });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  });

  it("keeps an explicit permission denial distinguishable", async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => {
      failure({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError);
    });
    const source = createBrowserCurrentLocationSource({ geolocation: { getCurrentPosition } });

    await expect(source.read()).rejects.toThrow("location-denied");
  });
});
