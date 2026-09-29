import { describe, expect, it } from "vitest";

import {
  COORDINATE_ROUNDING_DECIMALS,
  HIDE_ZONE_METERS,
  applyPrivacyTrim,
  defaultPrivacyTrim,
  routeDistanceMeters,
  type PrivacyTrimSettings,
} from "@/domain/sharing/privacy";
import type { ShareRoute } from "@/domain/sharing/types";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The one shared privacy implementation (10-SHARING-AND-OFFLINE §11): hide
 * start, hide finish, trim N distance from both ends, and coordinate
 * blurring. These are the trim rules themselves; the snapshot and link paths
 * both call into this module, so what is tested here is exactly what a link
 * exposes.
 */

/** A straight north-south line of `count` points, each `stepMeters` apart. */
function meridianLine(count: number, stepMeters: number): readonly Coordinate[] {
  // 60°N: one degree of latitude is ~111.19 km on the analysis sphere, and the
  // tests measure through the same `haversine` the trim uses, so the exact
  // constant does not matter.
  const stepDegrees = stepMeters / 111_194.9266;
  return Array.from({ length: count }, (_, index) => ({
    lon: -75.43,
    lat: 40.13 + index * stepDegrees,
  }));
}

function line(points: readonly Coordinate[]): ShareRoute {
  return { segments: [points] };
}

const SETTINGS = (overrides: Partial<PrivacyTrimSettings>): PrivacyTrimSettings => ({
  hideStart: false,
  hideFinish: false,
  trimMetersFromEnds: 0,
  blurCoordinates: false,
  ...overrides,
});

/** Distance from a point to the nearest point of a polyline end, in meters. */
function distanceBetween(first: Coordinate, second: Coordinate): number {
  return routeDistanceMeters({ segments: [[first, second]] });
}

describe("applyPrivacyTrim — hide start", () => {
  it("hides exactly a 500 m zone from the start and nothing else", () => {
    const route = line(meridianLine(11, 100));
    const total = routeDistanceMeters(route);

    const trimmed = applyPrivacyTrim(route, SETTINGS({ hideStart: true }));

    const segments = trimmed.segments;
    expect(segments).toHaveLength(1);
    const points = segments[0] ?? [];
    // The exact kept-point count depends on how the ~100 m steps fall against
    // the cut; what the rule pins is the hidden distance below.
    expect(points.length).toBeLessThan(route.segments[0]?.length ?? 0);
    // The new start sits at exactly HIDE_ZONE_METERS along the original line.
    const origin = route.segments[0]?.[0] as Coordinate;
    expect(distanceBetween(origin, points[0] as Coordinate)).toBeCloseTo(HIDE_ZONE_METERS, 0);
    expect(routeDistanceMeters(trimmed)).toBeCloseTo(total - HIDE_ZONE_METERS, 0);
    // The finish is untouched.
    const originalFinish = route.segments[0]?.at(-1) as Coordinate;
    expect(points.at(-1)).toEqual(originalFinish);
  });

  it("hides nothing before the start (interpolation keeps the tail intact)", () => {
    const route = line(meridianLine(11, 100));
    const trimmed = applyPrivacyTrim(route, SETTINGS({ hideStart: true }));
    const origin = route.segments[0]?.[0] as Coordinate;
    for (const point of trimmed.segments[0] ?? []) {
      expect(distanceBetween(origin, point)).toBeGreaterThanOrEqual(HIDE_ZONE_METERS - 1);
    }
  });
});

describe("applyPrivacyTrim — hide finish", () => {
  it("hides exactly a 500 m zone from the finish and nothing else", () => {
    const route = line(meridianLine(11, 100));
    const total = routeDistanceMeters(route);

    const trimmed = applyPrivacyTrim(route, SETTINGS({ hideFinish: true }));

    const points = trimmed.segments[0] ?? [];
    const originalStart = route.segments[0]?.[0] as Coordinate;
    expect(points[0]).toEqual(originalStart);
    const originalFinish = route.segments[0]?.at(-1) as Coordinate;
    expect(distanceBetween(originalFinish, points.at(-1) as Coordinate)).toBeCloseTo(
      HIDE_ZONE_METERS,
      0,
    );
    expect(routeDistanceMeters(trimmed)).toBeCloseTo(total - HIDE_ZONE_METERS, 0);
  });
});

describe("applyPrivacyTrim — trim N distance from the ends", () => {
  it("trims exactly N meters from both ends", () => {
    const route = line(meridianLine(21, 100));
    const total = routeDistanceMeters(route);

    const trimmed = applyPrivacyTrim(route, SETTINGS({ trimMetersFromEnds: 250 }));

    const points = trimmed.segments[0] ?? [];
    const origin = route.segments[0]?.[0] as Coordinate;
    const finish = route.segments[0]?.at(-1) as Coordinate;
    expect(distanceBetween(origin, points[0] as Coordinate)).toBeCloseTo(250, 0);
    expect(distanceBetween(finish, points.at(-1) as Coordinate)).toBeCloseTo(250, 0);
    expect(routeDistanceMeters(trimmed)).toBeCloseTo(total - 500, 0);
  });

  it("composes hide zones and the N trim additively", () => {
    const route = line(meridianLine(31, 100));

    const trimmed = applyPrivacyTrim(
      route,
      SETTINGS({ hideStart: true, hideFinish: true, trimMetersFromEnds: 100 }),
    );

    const points = trimmed.segments[0] ?? [];
    const origin = route.segments[0]?.[0] as Coordinate;
    const finish = route.segments[0]?.at(-1) as Coordinate;
    expect(distanceBetween(origin, points[0] as Coordinate)).toBeCloseTo(
      HIDE_ZONE_METERS + 100,
      0,
    );
    expect(distanceBetween(finish, points.at(-1) as Coordinate)).toBeCloseTo(
      HIDE_ZONE_METERS + 100,
      0,
    );
  });

  it("trims nothing when both knobs are off", () => {
    const route = line(meridianLine(5, 100));
    const trimmed = applyPrivacyTrim(route, SETTINGS({}));
    expect(trimmed.segments[0]).toEqual(route.segments[0]);
  });

  it("consumes the whole route when the trim covers it, leaving no points at all", () => {
    const route = line(meridianLine(5, 100));

    const trimmed = applyPrivacyTrim(
      route,
      SETTINGS({ hideStart: true, hideFinish: true }),
    );

    expect(trimmed.segments).toEqual([]);
    expect(routeDistanceMeters(trimmed)).toBe(0);
  });

  it("rejects a negative or non-finite trim instead of guessing", () => {
    const route = line(meridianLine(5, 100));
    expect(() => applyPrivacyTrim(route, SETTINGS({ trimMetersFromEnds: -1 }))).toThrow(/trim/i);
    expect(() =>
      applyPrivacyTrim(route, SETTINGS({ trimMetersFromEnds: Number.NaN })),
    ).toThrow(/trim/i);
    expect(() =>
      applyPrivacyTrim(route, SETTINGS({ trimMetersFromEnds: Number.POSITIVE_INFINITY })),
    ).toThrow(/trim/i);
  });
});

describe("applyPrivacyTrim — segments and gaps", () => {
  it("carries the trim across a segment gap without counting the gap", () => {
    const first = meridianLine(4, 100); // 300 m
    const second = meridianLine(4, 100).map((point) => ({ ...point, lon: -75.0 })); // 300 m
    const route: ShareRoute = { segments: [first, second] };
    // 600 m of geometry; 450 m trimmed from the start lands 150 m into segment 2.
    const trimmed = applyPrivacyTrim(
      route,
      SETTINGS({ hideStart: true, trimMetersFromEnds: 200 }), // 700 > 600: fully consumed
    );
    expect(trimmed.segments).toEqual([]);

    const partial = applyPrivacyTrim(route, SETTINGS({ hideStart: true })); // 500 of 600
    expect(partial.segments).toHaveLength(1);
    expect(routeDistanceMeters(partial)).toBeCloseTo(100, 0);
  });

  it("drops segments the trim fully consumes and keeps the rest", () => {
    const short = meridianLine(3, 50); // 100 m
    const long = meridianLine(11, 100).map((point) => ({ ...point, lon: -75.0 })); // 1000 m
    const route: ShareRoute = { segments: [short, long] };

    // 200 m from the start: consumes the short segment entirely (100 m) and
    // 100 m of the long one.
    const trimmed = applyPrivacyTrim(route, SETTINGS({ trimMetersFromEnds: 200 }));

    expect(trimmed.segments).toHaveLength(1);
    expect(routeDistanceMeters(trimmed)).toBeCloseTo(1100 - 400, 0);
  });

  it("survives duplicate points without dividing by zero", () => {
    const points = [...meridianLine(3, 100), meridianLine(3, 100)[2] as Coordinate];
    const route = line(points);
    const trimmed = applyPrivacyTrim(route, SETTINGS({ trimMetersFromEnds: 50 }));
    expect(routeDistanceMeters(trimmed)).toBeCloseTo(routeDistanceMeters(route) - 100, 0);
  });
});

describe("applyPrivacyTrim — coordinate blurring (round/blur)", () => {
  it("rounds every shared coordinate to three decimals when asked", () => {
    const route = line(meridianLine(6, 137));

    const blurred = applyPrivacyTrim(route, SETTINGS({ blurCoordinates: true }));

    const factor = 10 ** COORDINATE_ROUNDING_DECIMALS;
    for (const point of blurred.segments[0] ?? []) {
      expect(point.lon).toBe(Math.round(point.lon * factor) / factor);
      expect(point.lat).toBe(Math.round(point.lat * factor) / factor);
    }
  });

  it("leaves coordinates untouched when blurring is off", () => {
    const route = line(meridianLine(6, 137));
    const plain = applyPrivacyTrim(route, SETTINGS({}));
    expect(plain.segments[0]).toEqual(route.segments[0]);
  });

  it("blurs after trimming, so the trim still lands where it promised", () => {
    const route = line(meridianLine(11, 100));
    const trimmed = applyPrivacyTrim(
      route,
      SETTINGS({ trimMetersFromEnds: 100, blurCoordinates: true }),
    );
    const origin = route.segments[0]?.[0] as Coordinate;
    // Rounding is ~100 m of blur; the trimmed start must still be well past
    // the original start and clearly before the untrimmed 100 m point's zone.
    const hidden = distanceBetween(origin, trimmed.segments[0]?.[0] as Coordinate);
    expect(hidden).toBeGreaterThan(50);
    expect(hidden).toBeLessThan(250);
  });
});

describe("privacy defaults", () => {
  it("hides both ends and blurs by default (privacy-first)", () => {
    const defaults = defaultPrivacyTrim();
    expect(defaults.hideStart).toBe(true);
    expect(defaults.hideFinish).toBe(true);
    expect(defaults.blurCoordinates).toBe(true);
    expect(defaults.trimMetersFromEnds).toBe(0);
  });

  it("pins the two numbers the knobs rest on", () => {
    expect(HIDE_ZONE_METERS).toBe(500);
    expect(COORDINATE_ROUNDING_DECIMALS).toBe(3);
  });
});
