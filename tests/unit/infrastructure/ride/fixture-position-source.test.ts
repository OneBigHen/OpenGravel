import { describe, expect, it, vi } from "vitest";

import type {
  PositionSource,
  PositionSourceObserver,
  PositionWatch,
} from "@/application/ride-session/position-pipeline";
import { createFixturePositionSource } from "@/infrastructure/ride/fixture-position-source";

const LINE = [
  { lon: -75.44, lat: 40.14 },
  { lon: -75.4387, lat: 40.1407 },
] as const;

describe("fixture position source", () => {
  it("feeds prompt-permission fixes into the regular position observer", async () => {
    const scheduled: { tick?: () => void } = {};
    let cleared: number | null = null;
    const browserSource: PositionSource = {
      permission: async () => "prompt",
      watch: () => ({ stop: vi.fn() }),
    };
    const source = createFixturePositionSource({
      browserSource,
      routeLine: () => LINE,
      now: () => "2026-09-21T14:00:00.000Z",
      setInterval: (handler) => {
        scheduled.tick = handler;
        return 12;
      },
      clearInterval: (handle) => {
        cleared = handle;
      },
    });
    const observer: PositionSourceObserver = {
      position: vi.fn(),
      error: vi.fn(),
    };

    expect(await source.permission()).toBe("prompt");
    const watch = source.watch(observer);
    scheduled.tick?.();

    expect(observer.position).toHaveBeenCalledWith({
      coordinate: LINE[0],
      observedAt: "2026-09-21T14:00:00.000Z",
      accuracyMeters: 8,
      headingDegrees: expect.any(Number),
      speedMps: 12,
    });
    watch.stop();
    expect(cleared).toBe(12);
  });

  it("holds the rider still after maxFixes, so a screenshot can settle", async () => {
    let tick: (() => void) | undefined;
    const source = createFixturePositionSource({
      browserSource: { permission: async () => "prompt", watch: () => ({ stop: vi.fn() }) },
      routeLine: () => LINE,
      maxFixes: 2,
      setInterval: (handler) => { tick = handler; return 1; },
      clearInterval: () => {},
    });
    const seen: unknown[] = [];
    await source.permission();
    source.watch({ position: (fix) => seen.push(fix.coordinate), error: vi.fn() });
    for (let i = 0; i < 5; i++) tick?.();
    expect(seen[1]).not.toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[1]);
    expect(seen[4]).toEqual(seen[1]);
  });

  it("uses real browser GPS when permission is granted", async () => {
    const browserWatch: PositionWatch = { stop: vi.fn() };
    const browserSource: PositionSource = {
      permission: async () => "granted",
      watch: vi.fn(() => browserWatch),
    };
    const source = createFixturePositionSource({ browserSource, routeLine: () => LINE });
    const observer: PositionSourceObserver = {
      position: vi.fn(),
      error: vi.fn(),
    };

    expect(await source.permission()).toBe("granted");
    expect(source.watch(observer)).toBe(browserWatch);
    expect(browserSource.watch).toHaveBeenCalledWith(observer);
  });

  it("preserves an explicit browser permission denial", async () => {
    const browserSource: PositionSource = {
      permission: async () => "denied",
      watch: vi.fn(() => ({ stop: vi.fn() })),
    };
    const source = createFixturePositionSource({ browserSource, routeLine: () => LINE });

    expect(await source.permission()).toBe("denied");
    expect(vi.mocked(browserSource.watch)).not.toHaveBeenCalled();
  });
});
