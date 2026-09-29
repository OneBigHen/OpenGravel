import { describe, expect, it, vi } from "vitest";
import type { PositionFix } from "@/domain/ride-session/types";

import {
  createPositionPipeline,
  type PositionSource,
  type PositionSourceObserver,
  type RawPosition,
} from "@/application/ride-session/position-pipeline";

function raw(
  lon: number,
  lat: number,
  observedAt: string,
  overrides: Partial<RawPosition> = {},
): RawPosition {
  return {
    coordinate: { lon, lat },
    observedAt,
    accuracyMeters: 8,
    headingDegrees: null,
    speedMps: null,
    ...overrides,
  };
}

function source(initialPermission: "prompt" | "granted" | "denied") {
  let permission = initialPermission;
  let observer: PositionSourceObserver | null = null;
  const stop = vi.fn();
  const positionSource: PositionSource = {
    permission: vi.fn(async () => permission),
    watch(nextObserver) {
      observer = nextObserver;
      return { stop };
    },
  };
  return {
    positionSource,
    stop,
    setPermission(next: typeof permission) {
      permission = next;
    },
    position(position: RawPosition) {
      observer?.position(position);
    },
    error(code: "permission-denied" | "position-unavailable" | "timeout") {
      observer?.error({ code });
    },
  };
}

describe("position permission and watch lifecycle", () => {
  it("moves denied → acquiring → recovered when retry later succeeds", async () => {
    const fake = source("denied");
    const fixes: RawPosition[] = [];
    const states: string[] = [];
    const pipeline = createPositionPipeline({
      source: fake.positionSource,
      onFix: async (fix) => fixes.push(fix),
    });
    pipeline.subscribe((state) => states.push(`${state.permission}:${state.status}`));

    await pipeline.start();
    expect(pipeline.snapshot().status).toBe("denied");
    fake.setPermission("granted");
    await pipeline.retry();
    fake.position(raw(-75.44, 40.14, "2026-09-21T12:00:00.000Z"));
    await pipeline.flush();

    expect(states).toContain("denied:denied");
    expect(states).toContain("granted:acquiring");
    expect(states.at(-1)).toBe("granted:recovered");
    expect(fixes).toHaveLength(1);
    expect(pipeline.snapshot().lastFix).toEqual(fixes[0]);
  });

  it("retains the last fix while lost and recovers on the same watch", async () => {
    const fake = source("granted");
    const pipeline = createPositionPipeline({
      source: fake.positionSource,
      onFix: vi.fn(async () => undefined),
    });
    await pipeline.start();
    fake.position(raw(-75.44, 40.14, "2026-09-21T12:00:00.000Z"));
    await pipeline.flush();
    const retained = pipeline.snapshot().lastFix;
    fake.error("position-unavailable");
    expect(pipeline.snapshot()).toMatchObject({ status: "lost", lastFix: retained });
    fake.position(raw(-75.4399, 40.14, "2026-09-21T12:00:01.000Z"));
    await pipeline.flush();
    expect(pipeline.snapshot().status).toBe("recovered");
    fake.position(raw(-75.4398, 40.14, "2026-09-21T12:00:02.000Z"));
    await pipeline.flush();
    expect(pipeline.snapshot().status).toBe("tracking");

    await pipeline.stop();
    await pipeline.stop();
    expect(fake.stop).toHaveBeenCalledOnce();
    expect(pipeline.snapshot().status).toBe("stopped");
  });
});

describe("position normalization", () => {
  it("smooths nearby coordinates, derives a missing heading, and derives a missing speed only from measured movement", async () => {
    const fake = source("granted");
    const fixes: PositionFix[] = [];
    const pipeline = createPositionPipeline({
      source: fake.positionSource,
      onFix: async (fix) => fixes.push(fix),
    });
    await pipeline.start();
    fake.position(raw(-75.44, 40.14, "2026-09-21T12:00:00.000Z"));
    fake.position(raw(-75.4398, 40.14, "2026-09-21T12:00:01.000Z"));
    await pipeline.flush();

    const second = fixes[1];
    expect(second?.coordinate.lon).toBeGreaterThan(-75.44);
    expect(second?.coordinate.lon).toBeLessThan(-75.4398);
    expect(second?.headingDegrees).toBeGreaterThan(80);
    expect(second?.headingDegrees).toBeLessThan(100);
    // RIDE-INSTRUMENT-STRIP §6.1: no device speed, so it is derived from the
    // two credible raw fixes (17 m in 1 s) and marked as derived. The first
    // fix has no baseline, so it still reports none.
    expect(fixes[0]?.speedMps).toBeNull();
    expect(fixes[0]).not.toHaveProperty("speedDerived");
    expect(second?.speedMps).toBeCloseTo(17, 0);
    expect(second?.speedDerived).toBe(true);
  });

  it("never turns GPS jitter inside the fix accuracy into speed", async () => {
    const fake = source("granted");
    const fixes: PositionFix[] = [];
    const pipeline = createPositionPipeline({ source: fake.positionSource, onFix: async (fix) => fixes.push(fix) });
    await pipeline.start();
    // Standing still: 3 m of jitter against 8 m accuracy.
    fake.position(raw(-75.44, 40.14, "2026-09-21T12:00:00.000Z"));
    fake.position(raw(-75.44003, 40.14001, "2026-09-21T12:00:01.000Z"));
    fake.position(raw(-75.43998, 40.13999, "2026-09-21T12:00:02.000Z"));
    await pipeline.flush();
    expect(fixes[1]?.speedMps).toBe(0);
    expect(fixes[2]?.speedMps).toBe(0);
  });

  it("keeps a reported speed as reported, rejects a negative one, and passes altitude through", async () => {
    const fake = source("granted");
    const fixes: PositionFix[] = [];
    const pipeline = createPositionPipeline({ source: fake.positionSource, onFix: async (fix) => fixes.push(fix) });
    await pipeline.start();
    fake.position(raw(-75.44, 40.14, "2026-09-21T12:00:00.000Z", { speedMps: 12.5, altitudeMeters: 131.4, altitudeAccuracyMeters: 6 }));
    fake.position(raw(-75.4398, 40.14, "2026-09-21T12:00:01.000Z", { speedMps: -1 }));
    fake.position(raw(-75.4396, 40.14, "2026-09-21T12:00:02.000Z", { altitudeMeters: Number.NaN }));
    await pipeline.flush();
    expect(fixes[0]).toMatchObject({ speedMps: 12.5, altitudeMeters: 131.4, altitudeAccuracyMeters: 6 });
    expect(fixes[0]).not.toHaveProperty("speedDerived");
    // A negative device speed means "unknown": derived instead, never kept.
    expect(fixes[1]?.speedMps).toBeGreaterThan(0);
    expect(fixes[1]?.speedDerived).toBe(true);
    expect(fixes[1]).not.toHaveProperty("altitudeMeters");
    expect(fixes[2]).not.toHaveProperty("altitudeMeters");
  });
});
