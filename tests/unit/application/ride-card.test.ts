import { describe, expect, it } from "vitest";

import {
  buildRideCard,
  buildStoredRideCard,
  rideCardSurface,
  simplifyLine,
  RIDE_CARD_MAX_POINTS,
  type RideCardPoint,
} from "@/application/ride-metrics/ride-card";
import type { SurfaceRunSpan } from "@/application/ride-session/surface-ahead";
import type { Coordinate } from "@/domain/ride/types";

/** 6371000 m × π/180: one degree of latitude, the haversine's own Earth. */
const METERS_PER_DEGREE_LAT = (6_371_000 * Math.PI) / 180;

const START = Date.parse("2026-11-11T14:00:00.000Z");
const ORIGIN: Coordinate = { lon: -75.44, lat: 40.14 };

/** `steps` fixes one second apart, each `meters` further north. */
function straightRide(options: {
  readonly steps: number;
  readonly meters: number;
  readonly from?: number;
  readonly startMs?: number;
  readonly latitude?: number;
  readonly pausedAtStep?: number;
  readonly pausedMs?: number;
  readonly altitude?: (step: number) => number | undefined;
}): RideCardPoint[] {
  const points: RideCardPoint[] = [];
  const startMs = options.startMs ?? START;
  const baseLat = options.latitude ?? ORIGIN.lat;
  const stepDegrees = options.meters / METERS_PER_DEGREE_LAT;
  let pausedMs = 0;
  for (let step = 0; step <= options.steps; step += 1) {
    if (options.pausedAtStep !== undefined && step === options.pausedAtStep) {
      pausedMs = options.pausedMs ?? 0;
    }
    const offsetMs = step * 1_000 + (step >= (options.pausedAtStep ?? Number.POSITIVE_INFINITY) ? pausedMs : 0);
    const altitude = options.altitude?.(step);
    points.push({
      coordinate: { lon: ORIGIN.lon, lat: baseLat + step * stepDegrees },
      observedAt: new Date(startMs + offsetMs).toISOString(),
      accuracyMeters: 5,
      ...(altitude === undefined ? {} : { altitudeMeters: altitude, altitudeAccuracyMeters: 3 }),
      ...(pausedMs === 0 ? {} : { pausedDurationMs: pausedMs }),
    });
  }
  return points;
}

const GUIDED_RUNS: readonly SurfaceRunSpan[] = [
  { from: 0, to: 300, kind: "gravel" },
  { from: 300, to: 500, kind: "paved" },
];

describe("the ride card", () => {
  it("sums a guided ride with measured surface: 0.6 km, one minute moving, 300 m dirt, 10 m climb", () => {
    // 61 fixes one second apart, each 10 m further north: 60 intervals = 600 m.
    // Altitude 100 m for the first 31 s, then a 10 m step held for 30 s. The
    // filter smooths over 5 s and credits climb in 5 m dead-band steps, so the
    // crossing lands at 105.5 m and the rest of the rise stays inside the next
    // band: the climb it reports is 5.5 m (the same number the strip showed).
    const card = buildRideCard({
      points: straightRide({
        steps: 60,
        meters: 10,
        altitude: (step) => (step <= 30 ? 100 : 110),
      }),
      surfaceRuns: GUIDED_RUNS,
    });

    // 600 m is 0.373 mi: tenths below ten miles.
    expect(card.distanceMeters).toBeCloseTo(600, 6);
    expect(card.numbers.distance).toEqual({ value: "0.4", unit: "mi" });
    // 60 s of moving time, rounded as the app rounds a minute.
    expect(card.movingMs).toBe(60_000);
    expect(card.numbers.moving).toEqual({ value: "1", unit: "min" });
    // 600 m ÷ 60 s = 10 m/s = 22.4 mph.
    expect(card.averageSpeedMps).toBeCloseTo(10, 6);
    expect(card.average).toEqual({ value: "22", unit: "mph" });
    // 5.5067 m × 3.28084 = 18.07 ft.
    expect(card.climbMeters).toBeCloseTo(5.5067, 3);
    expect(card.numbers.climb).toEqual({ value: "18", unit: "ft" });

    // The plan measured 300 m gravel and 200 m paved; the last 100 m is unknown.
    expect(card.surface.dirtMeters).toBeCloseTo(300, 6);
    expect(card.surface.pavedMeters).toBeCloseTo(200, 6);
    expect(card.surface.unknownMeters).toBeCloseTo(100, 6);
    expect(card.surface.dirtShare).toBeCloseTo(0.6, 6);
    expect(card.numbers.dirt).toEqual({ value: "0.2", unit: "mi" });

    expect(card.startedAt).toBe(new Date(START).toISOString());
    expect(card.endedAt).toBe(new Date(START + 60_000).toISOString());
    expect(card.date).toBe("Nov 11");
    expect(card.title).toBe("Ride, Nov 11");
    expect(card.line).toHaveLength(61);
    expect(card.line[0]).toEqual(ORIGIN);
  });

  it("says the surface is unknown on a Free Ride, never paved or gravel", () => {
    const card = buildRideCard({ points: straightRide({ steps: 60, meters: 10 }) });
    expect(card.numbers.distance).toEqual({ value: "0.4", unit: "mi" });
    expect(card.surface).toEqual({
      dirtMeters: 0,
      pavedMeters: 0,
      unknownMeters: card.distanceMeters,
      dirtShare: null,
    });
    expect(card.numbers.dirt).toBeNull();
  });

  it("does not count the minute standing still, and ends where the rider really stopped", () => {
    const card = buildRideCard({
      points: straightRide({ steps: 61, meters: 10, startMs: START, pausedAtStep: 31, pausedMs: 330_000 }),
    });
    // Two 30 s stretches of riding, a 5:30 gap between them.
    expect(card.movingMs).toBe(60_000);
    expect(card.numbers.moving).toEqual({ value: "1", unit: "min" });
    expect(card.distanceMeters).toBeCloseTo(600, 6);
    expect(card.average).toEqual({ value: "22", unit: "mph" });
    expect(Date.parse(card.endedAt!) - Date.parse(card.startedAt!)).toBe(391_000);
  });

  it("keeps a ride with no GPS at all: nothing invented, nothing thrown away", () => {
    const card = buildRideCard({ points: [], date: "2026-11-11T12:00:00.000Z" });
    expect(card.distanceMeters).toBe(0);
    expect(card.numbers.distance).toEqual({ value: "0.0", unit: "mi" });
    expect(card.numbers.moving).toEqual({ value: "0", unit: "min" });
    expect(card.average).toBeNull();
    expect(card.numbers.climb).toBeNull();
    expect(card.numbers.dirt).toBeNull();
    expect(card.startedAt).toBeNull();
    expect(card.endedAt).toBeNull();
    expect(card.line).toEqual([]);
    expect(card.date).toBe("Nov 11");
    expect(card.title).toBe("Ride, Nov 11");
  });

  it("reads a short ride honestly: under 100 m is 0.0 mi, never a larger one", () => {
    // 41 fixes at 2 m/s. The filter's first three intervals have no baseline
    // yet (the displacement is inside the fix noise), so 37 s of riding at
    // 2 m/s is credited: 74 m.
    const card = buildRideCard({ points: straightRide({ steps: 40, meters: 2 }) });
    expect(card.movingMs).toBe(37_000);
    expect(card.distanceMeters).toBeCloseTo(74, 6);
    expect(card.numbers.distance).toEqual({ value: "0.0", unit: "mi" });
    expect(card.numbers.moving).toEqual({ value: "1", unit: "min" });
    expect(card.average).toEqual({ value: "4", unit: "mph" });
    expect(card.numbers.climb).toBeNull();
    expect(card.numbers.dirt).toBeNull();
  });

  it("speaks metric when the rider chose it, and keeps the same ride", () => {
    const card = buildRideCard({
      points: straightRide({ steps: 60, meters: 10 }),
      surfaceRuns: GUIDED_RUNS,
      units: "metric",
    });
    expect(card.numbers.distance).toEqual({ value: "0.6", unit: "km" });
    expect(card.average).toEqual({ value: "36", unit: "km/h" });
    expect(card.numbers.dirt).toEqual({ value: "0.3", unit: "km" });
  });
});

describe("the card's surface", () => {
  it("counts only what the plan measured within the distance ridden", () => {
    const surface = rideCardSurface(600, [
      { from: 0, to: 300, kind: "gravel" },
      { from: 300, to: 500, kind: "paved" },
    ]);
    expect(surface).toEqual({ dirtMeters: 300, pavedMeters: 200, unknownMeters: 100, dirtShare: 0.6 });
  });

  it("clips a run that runs past the end of the ride", () => {
    const surface = rideCardSurface(100, [{ from: 0, to: 1_000, kind: "dirt" }]);
    expect(surface.dirtMeters).toBe(100);
    expect(surface.unknownMeters).toBe(0);
    expect(surface.dirtShare).toBe(1);
  });

  it("trims overlapping answers instead of counting a metre twice", () => {
    const surface = rideCardSurface(300, [
      { from: 0, to: 200, kind: "gravel" },
      { from: 100, to: 300, kind: "paved" },
    ]);
    expect(surface.dirtMeters).toBe(200);
    expect(surface.pavedMeters).toBe(100);
    expect(surface.unknownMeters).toBe(0);
  });

  it("treats an explicit unknown run as unknown, never as paved", () => {
    const surface = rideCardSurface(300, [
      { from: 0, to: 100, kind: "paved" },
      { from: 100, to: 300, kind: "unknown" },
    ]);
    expect(surface.pavedMeters).toBe(100);
    expect(surface.dirtMeters).toBe(0);
    expect(surface.unknownMeters).toBe(200);
    expect(surface.dirtShare).toBe(0);
  });

  it("has no share when nothing was measured", () => {
    expect(rideCardSurface(500, [])).toEqual({
      dirtMeters: 0,
      pavedMeters: 0,
      unknownMeters: 500,
      dirtShare: null,
    });
  });
});

describe("the line on the card", () => {
  it("keeps at most 400 points and both ends", () => {
    const line = Array.from({ length: 5_000 }, (_, index): Coordinate => ({
      lon: -75.44 + index * 0.00001,
      lat: 40.14 + Math.sin(index / 40) * 0.001,
    }));
    const simplified = simplifyLine(line);
    expect(simplified.length).toBeLessThanOrEqual(RIDE_CARD_MAX_POINTS);
    expect(simplified[0]).toEqual(line[0]);
    expect(simplified[simplified.length - 1]).toEqual(line[line.length - 1]);
  });

  it("leaves a short line alone", () => {
    const line: Coordinate[] = [
      { lon: -75.44, lat: 40.14 },
      { lon: -75.43, lat: 40.15 },
    ];
    expect(simplifyLine(line)).toEqual(line);
  });

  it("caps a line of points on one spot", () => {
    const line = Array.from({ length: 900 }, (): Coordinate => ({ lon: -75.44, lat: 40.14 }));
    expect(simplifyLine(line).length).toBeLessThanOrEqual(RIDE_CARD_MAX_POINTS);
  });
});

describe("a saved ride's card", () => {
  it("shows what the library kept, and leaves climb and dirt unknown", () => {
    const card = buildStoredRideCard({
      title: "Sunday Pine Barrens",
      savedAt: "2026-11-11T18:30:00.000Z",
      summary: { distanceMeters: 16_093, elapsedSeconds: 4_200, movingSeconds: 3_600, pointCount: 480 },
      line: [
        { lon: -75.44, lat: 40.14 },
        { lon: -75.43, lat: 40.15 },
      ],
    });
    expect(card.title).toBe("Sunday Pine Barrens");
    expect(card.date).toBe("Nov 11");
    expect(card.numbers.distance).toEqual({ value: "10", unit: "mi" });
    expect(card.numbers.moving).toEqual({ value: "1:00", unit: "h" });
    expect(card.average).toEqual({ value: "10", unit: "mph" });
    expect(card.numbers.climb).toBeNull();
    expect(card.numbers.dirt).toBeNull();
    expect(card.surface.unknownMeters).toBe(16_093);
    expect(card.line).toHaveLength(2);
  });
});
