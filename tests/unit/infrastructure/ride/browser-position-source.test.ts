import { describe, expect, it, vi } from "vitest";

import { createBrowserPositionSource } from "@/infrastructure/ride/browser-position-source";

describe("browser position source", () => {
  it("maps an observed browser fix into a raw position and clears its watch", () => {
    const positionCallbacks: PositionCallback[] = [];
    const clearWatch = vi.fn();
    const source = createBrowserPositionSource({
      browser: {
        geolocation: {
          watchPosition: (success: PositionCallback) => {
            positionCallbacks.push(success);
            return 17;
          },
          clearWatch,
        } as unknown as Geolocation,
      },
    });
    const position = vi.fn();
    const error = vi.fn();
    const watch = source.watch({ position, error });

    positionCallbacks[0]?.({
      timestamp: Date.parse("2026-09-23T12:00:00.000Z"),
      coords: {
        longitude: -75.2,
        latitude: 39.95,
        accuracy: 7,
        heading: 82,
        speed: 11,
        altitude: null,
        altitudeAccuracy: null,
      },
    } as GeolocationPosition);

    expect(position).toHaveBeenCalledWith({
      coordinate: { lon: -75.2, lat: 39.95 },
      observedAt: "2026-09-23T12:00:00.000Z",
      accuracyMeters: 7,
      headingDegrees: 82,
      speedMps: 11,
    });
    expect(error).not.toHaveBeenCalled();
    watch.stop();
    expect(clearWatch).toHaveBeenCalledWith(17);
  });

  it("passes a reported altitude and its accuracy through, and drops a meaningless accuracy", () => {
    const positionCallbacks: PositionCallback[] = [];
    const source = createBrowserPositionSource({
      browser: {
        geolocation: {
          watchPosition: (success: PositionCallback) => {
            positionCallbacks.push(success);
            return 3;
          },
          clearWatch: vi.fn(),
        } as unknown as Geolocation,
      },
    });
    const position = vi.fn();
    source.watch({ position, error: vi.fn() });
    const fix = (altitude: number | null, altitudeAccuracy: number | null) =>
      positionCallbacks[0]?.({
        timestamp: Date.parse("2026-09-23T12:00:00.000Z"),
        coords: { longitude: -75.2, latitude: 39.95, accuracy: 7, heading: null, speed: null, altitude, altitudeAccuracy },
      } as GeolocationPosition);
    fix(-4.5, 3);
    fix(210, Number.NaN);
    expect(position.mock.calls[0]?.[0]).toMatchObject({ altitudeMeters: -4.5, altitudeAccuracyMeters: 3 });
    expect(position.mock.calls[1]?.[0]).toMatchObject({ altitudeMeters: 210, altitudeAccuracyMeters: null });
  });

  it("reports denied permission without starting a position watch", async () => {
    const watchPosition = vi.fn();
    const source = createBrowserPositionSource({
      browser: {
        geolocation: { watchPosition, clearWatch: vi.fn() } as unknown as Geolocation,
        permissions: {
          query: async () => ({ state: "denied", onchange: null }),
        } as unknown as Permissions,
      },
    });

    await expect(source.permission()).resolves.toBe("denied");
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it("reads a microsecond timestamp (a WebKit WPE quirk) as milliseconds, keeping the real time", () => {
    const callbacks: PositionCallback[] = [];
    const source = createBrowserPositionSource({
      browser: { geolocation: { watchPosition: (success: PositionCallback) => { callbacks.push(success); return 1; }, clearWatch: vi.fn() } as unknown as Geolocation },
    });
    const position = vi.fn();
    source.watch({ position, error: vi.fn() });
    const observed = Date.now() - 1_500;
    callbacks[0]?.({ timestamp: observed * 1000, coords: { longitude: -75.2, latitude: 39.95, accuracy: 7, heading: null, speed: null, altitude: null, altitudeAccuracy: null } } as GeolocationPosition);
    expect(position).toHaveBeenCalledWith(expect.objectContaining({ observedAt: new Date(observed).toISOString() }));
  });
});
