/**
 * Corridor filtering and ahead-of-rider selection (OGV#13): a point counts
 * only when it is close enough to the line and not already behind the
 * rider, and the survivors come back nearest-ahead-first.
 *
 * The route is a straight line of longitude at lat 40°N, where each 0.01°
 * of longitude is close to 0.53 mi and each 0.01° of latitude is close to
 * 0.69 mi (the module's own spherical Earth radius) — comfortable margins
 * are used everywhere a threshold is being crossed, so the test does not
 * depend on matching the module's geodesy to the decimal.
 */

import { describe, expect, it } from "vitest";

import { pointsAheadOfRider } from "@/application/ride-interest/ahead-of-rider";
import type { RideInterestPoint } from "@/application/ride-interest/types";

const LAT = 40;

function routeLine(startLon: number, endLon: number, steps = 20): { readonly lon: number; readonly lat: number }[] {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    lon: startLon + ((endLon - startLon) * index) / steps,
    lat: LAT,
  }));
}

function point(overrides: Partial<RideInterestPoint> & Pick<RideInterestPoint, "id" | "name">): RideInterestPoint {
  return {
    filter: "scenic",
    kind: "viewpoint",
    coordinate: { lon: -75.3, lat: LAT },
    summary: null,
    photoUrl: null,
    detailUrl: null,
    attribution: "Test",
    ...overrides,
  };
}

const RIDER_LON = -75.3; // ~10.6 mi from the route's -75.5 start
const RIDER = { lon: RIDER_LON, lat: LAT };
const ROUTE = routeLine(-75.5, -75.0);

describe("pointsAheadOfRider", () => {
  it("drops a point behind the rider by more than the tolerance", () => {
    const behind = point({ id: "behind", name: "Behind", coordinate: { lon: RIDER_LON - 0.01, lat: LAT } });
    const ahead = pointsAheadOfRider([behind], ROUTE, RIDER, { behindToleranceMiles: 0.1 });
    expect(ahead).toHaveLength(0);
  });

  it("keeps a point just behind the tolerance, clamped to 0 mi ahead", () => {
    const justBehind = point({ id: "just-behind", name: "Just behind", coordinate: { lon: RIDER_LON - 0.0005, lat: LAT } });
    const ahead = pointsAheadOfRider([justBehind], ROUTE, RIDER, { behindToleranceMiles: 0.1 });
    expect(ahead).toHaveLength(1);
    expect(ahead[0]!.aheadMiles).toBe(0);
  });

  it("keeps a point ahead and on the line, with a positive ahead distance", () => {
    const near = point({ id: "near", name: "Near", coordinate: { lon: RIDER_LON + 0.02, lat: LAT } });
    const ahead = pointsAheadOfRider([near], ROUTE, RIDER);
    expect(ahead).toHaveLength(1);
    expect(ahead[0]!.point.id).toBe("near");
    expect(ahead[0]!.aheadMiles).toBeGreaterThan(0.5);
    expect(ahead[0]!.aheadMiles).toBeLessThan(1.5);
    expect(ahead[0]!.offRouteMiles).toBeCloseTo(0, 1);
  });

  it("drops a point beyond maxAheadMiles", () => {
    const far = point({ id: "far", name: "Far", coordinate: { lon: RIDER_LON + 0.25, lat: LAT } }); // ~13 mi ahead
    const ahead = pointsAheadOfRider([far], ROUTE, RIDER, { maxAheadMiles: 10 });
    expect(ahead).toHaveLength(0);
  });

  it("keeps a point within the corridor and drops one outside it", () => {
    const inCorridor = point({ id: "in", name: "In corridor", coordinate: { lon: RIDER_LON + 0.02, lat: LAT + 0.01 } }); // ~0.7 mi off
    const outCorridor = point({ id: "out", name: "Out of corridor", coordinate: { lon: RIDER_LON + 0.02, lat: LAT + 0.03 } }); // ~2.1 mi off
    const ahead = pointsAheadOfRider([inCorridor, outCorridor], ROUTE, RIDER, { corridorMiles: 1.5 });
    expect(ahead.map((entry) => entry.point.id)).toEqual(["in"]);
  });

  it("sorts survivors nearest-ahead-first", () => {
    const farther = point({ id: "farther", name: "Farther", coordinate: { lon: RIDER_LON + 0.1, lat: LAT } });
    const nearer = point({ id: "nearer", name: "Nearer", coordinate: { lon: RIDER_LON + 0.02, lat: LAT } });
    const ahead = pointsAheadOfRider([farther, nearer], ROUTE, RIDER);
    expect(ahead.map((entry) => entry.point.id)).toEqual(["nearer", "farther"]);
  });

  it("returns nothing for a degenerate route line", () => {
    expect(pointsAheadOfRider([point({ id: "x", name: "X" })], [RIDER], RIDER)).toEqual([]);
    expect(pointsAheadOfRider([point({ id: "x", name: "X" })], [], RIDER)).toEqual([]);
  });

  it("returns nothing when there are no points to place", () => {
    expect(pointsAheadOfRider([], ROUTE, RIDER)).toEqual([]);
  });
});
