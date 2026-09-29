/**
 * Geometry analysis for route evaluation.
 *
 * The algorithms are kept; the coordinate type is VNext's `{ lon, lat }`
 * object instead of the legacy `[lon, lat]` tuple. These tests anchor the
 * numbers the deterministic score depends on, so a later "optimization" cannot
 * silently change route ranking.
 */

import { describe, expect, it } from "vitest";

import {
  analyzeGeometry,
  calculateGeometryOverlap,
  curvedDistanceShare,
  haversine,
  pointToSegmentDistanceMeters,
  simplifyGeometry,
  smoothedRouteMetrics,
} from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -77.1, lat: 40.1 };

/** A point offset from the origin by decimal degrees. */
function at(lon: number, lat: number): Coordinate {
  return { lon, lat };
}

describe("haversine", () => {
  it("measures one degree of latitude at ~111.2 km", () => {
    const meters = haversine(at(0, 0), at(0, 1));
    expect(meters).toBeGreaterThan(111_000);
    expect(meters).toBeLessThan(111_300);
  });

  it("is symmetric and zero for the same point", () => {
    expect(haversine(ORIGIN, ORIGIN)).toBe(0);
    expect(haversine(at(-77.1, 40.1), at(-77.0, 40.2))).toBeCloseTo(
      haversine(at(-77.0, 40.2), at(-77.1, 40.1)),
      6,
    );
  });
});

describe("analyzeGeometry", () => {
  it("reports a straight line as untwisted", () => {
    const straight = [at(0, 40), at(0, 40.01), at(0, 40.02), at(0, 40.03)];
    const analysis = analyzeGeometry(straight);
    expect(analysis.turnCount).toBe(0);
    expect(analysis.turnDensity).toBe(0);
    expect(analysis.twistiness).toBe(0);
    expect(analysis.straightRatio).toBe(1);
  });

  it("counts meaningful turns and raises twistiness on a zigzag", () => {
    const zigzag = [at(-77.1, 40.1), at(-77.09, 40.11), at(-77.1, 40.12), at(-77.09, 40.13)];
    const analysis = analyzeGeometry(zigzag);
    expect(analysis.turnCount).toBeGreaterThan(0);
    expect(analysis.turnDensity).toBeGreaterThan(0);
    expect(analysis.twistiness).toBeGreaterThan(0);
    expect(analysis.straightRatio).toBeLessThan(1);
  });

  it("returns the empty analysis for fewer than three points", () => {
    expect(analyzeGeometry([at(0, 0), at(0, 1)])).toEqual({
      twistiness: 0,
      turnCount: 0,
      turnDensity: 0,
      straightRatio: 1,
    });
  });
});

describe("pointToSegmentDistanceMeters", () => {
  it("is zero for a point on the segment and grows off it", () => {
    const start = at(0, 0);
    const end = at(0, 0.01);
    expect(pointToSegmentDistanceMeters(at(0, 0.005), start, end)).toBeLessThan(1);
    expect(pointToSegmentDistanceMeters(at(0.01, 0.005), start, end)).toBeGreaterThan(500);
  });
});

describe("simplifyGeometry", () => {
  it("drops collinear interior points and keeps real corners", () => {
    const collinear = [
      at(0, 0),
      at(0.001, 0),
      at(0.002, 0),
      at(0.003, 0),
      at(0.004, 0),
    ];
    expect(simplifyGeometry(collinear)).toHaveLength(2);

    const corner = [at(0, 0), at(0.01, 0), at(0.01, 0.01)];
    expect(simplifyGeometry(corner)).toHaveLength(3);
  });

  it("is stable under a second pass and copies short inputs", () => {
    const geometry = [at(0, 0), at(0.01, 0.01), at(0.02, 0), at(0.03, 0.02)];
    const once = simplifyGeometry(geometry);
    expect(simplifyGeometry(once)).toEqual(once);

    const twoPoints = [at(0, 0), at(0, 1)];
    const copied = simplifyGeometry(twoPoints);
    expect(copied).toEqual(twoPoints);
    expect(copied).not.toBe(twoPoints);
  });
});

describe("smoothedRouteMetrics", () => {
  it("reports no curves for a straight route", () => {
    const metrics = smoothedRouteMetrics([at(0, 40), at(0, 40.01), at(0, 40.02)]);
    expect(metrics.turnCount).toBe(0);
    expect(metrics.curvedDistanceShare).toBe(0);
    expect(metrics.twistiness).toBe(0);
  });

  it("finds meaningful turns on a zigzag route", () => {
    const zigzag = [at(-77.1, 40.1), at(-77.09, 40.11), at(-77.1, 40.12), at(-77.09, 40.13)];
    const metrics = smoothedRouteMetrics(zigzag);
    expect(metrics.turnCount).toBeGreaterThan(0);
    expect(metrics.turnsPerMile).toBeGreaterThan(0);
    expect(metrics.curvedDistanceShare).toBeGreaterThan(0);
    expect(metrics.twistiness).toBeGreaterThan(0);
  });
});

describe("curvedDistanceShare", () => {
  it("uses the provider's curvature detail when it is present", () => {
    const geometry = [at(0, 40), at(0, 40.01), at(0, 40.02)];
    expect(curvedDistanceShare(geometry, [[0, 2, "0.5"]])).toBeCloseTo(1, 6);
    expect(curvedDistanceShare(geometry, [[0, 2, "1.5"]])).toBeCloseTo(0, 6);
  });

  it("falls back to the smoothed geometry estimate without detail", () => {
    const zigzag = [at(-77.1, 40.1), at(-77.09, 40.11), at(-77.1, 40.12), at(-77.09, 40.13)];
    expect(curvedDistanceShare(zigzag)).toBeCloseTo(
      smoothedRouteMetrics(zigzag).curvedDistanceShare,
      6,
    );
  });
});

describe("calculateGeometryOverlap", () => {
  it("reports identical geometry as complete overlap", () => {
    const geometry = [at(0, 40), at(0.01, 40.01), at(0.02, 40.02)];
    expect(calculateGeometryOverlap(geometry, geometry)).toBe(100);
  });

  it("reports disjoint geometry as no overlap", () => {
    expect(
      calculateGeometryOverlap([at(0, 40), at(0.02, 40.02)], [at(1, 41), at(1.02, 41.02)]),
    ).toBe(0);
  });

  it("scores a partial overlap between zero and one hundred", () => {
    const full = [at(0, 40), at(0.01, 40), at(0.02, 40), at(0.03, 40)];
    const half = [at(0, 40), at(0.01, 40), at(0.02, 40)];
    const overlap = calculateGeometryOverlap(full, half);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(100);
  });
});
