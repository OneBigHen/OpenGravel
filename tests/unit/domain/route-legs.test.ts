/**
 * Leg lengths along a route line (04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * The itinerary's second line is a measurement, so these tests are about what
 * the measurement is allowed to claim: measured slices add up to the route the
 * rider sees, a point the line does not cover is not given a number, and a
 * leg's time is the route's own duration shared out — never a second estimate
 * invented for the slice.
 */

import { describe, expect, it } from "vitest";

import { haversine } from "@/domain/geometry/analysis";
import { routeLegs, LEG_ON_ROUTE_TOLERANCE_METERS } from "@/domain/route/legs";
import type { Coordinate } from "@/domain/ride/types";

/** A straight line east along the equator: one degree is ~111.2 km. */
const WEST: Coordinate = { lon: 0, lat: 0 };
const MIDDLE: Coordinate = { lon: 0.01, lat: 0 };
const EAST: Coordinate = { lon: 0.02, lat: 0 };
const LINE = [WEST, MIDDLE, EAST];

/** The route's own totals, as a candidate would declare them. */
const TOTALS = {
  distanceMeters: haversine(WEST, MIDDLE) + haversine(MIDDLE, EAST),
  durationSeconds: 600,
};

function measured(leg: ReturnType<typeof routeLegs>[number]) {
  if (leg.kind !== "measured") throw new Error(`expected a measured leg, got ${leg.kind}`);
  return leg;
}

describe("routeLegs", () => {
  it("measures each slice and sums to the route's own distance", () => {
    const legs = routeLegs(LINE, [WEST, MIDDLE, EAST], TOTALS);

    expect(legs.map((leg) => leg.kind)).toEqual(["first", "measured", "measured"]);
    const total = legs.reduce(
      (sum, leg) => sum + (leg.kind === "measured" ? leg.distanceMeters : 0),
      0,
    );
    expect(total).toBeCloseTo(TOTALS.distanceMeters, 3);
    expect(measured(legs[1]!).distanceMeters).toBeCloseTo(TOTALS.distanceMeters / 2, 3);
    expect(measured(legs[2]!).distanceMeters).toBeCloseTo(TOTALS.distanceMeters / 2, 3);
  });

  it("shares the route's measured duration out by distance", () => {
    const legs = routeLegs(LINE, [WEST, MIDDLE, EAST], TOTALS);

    expect(measured(legs[1]!).durationSeconds).toBeCloseTo(300, 3);
    expect(measured(legs[2]!).durationSeconds).toBeCloseTo(300, 3);
  });

  it("leaves a leg's time unknown when the route measured none", () => {
    const legs = routeLegs(LINE, [WEST, MIDDLE], {
      ...TOTALS,
      durationSeconds: Number.NaN,
    });

    expect(measured(legs[1]!).durationSeconds).toBeNull();
    expect(measured(legs[1]!).distanceMeters).toBeGreaterThan(0);
  });

  it("says a point the line does not cover is off the route, and gives it no number", () => {
    // ~5.5 km north of the line: no stretch of this route reaches it.
    const faraway: Coordinate = { lon: 0.01, lat: 0.05 };
    const legs = routeLegs(LINE, [WEST, faraway, EAST], TOTALS);

    expect(legs).toHaveLength(3);
    expect(legs[1]?.kind).toBe("off-route");
    expect(legs[2]?.kind).toBe("off-route");
  });

  it("treats a point within the tolerance as covered", () => {
    const nearlyOnLine: Coordinate = { lon: 0.01, lat: 0.0005 };
    expect(haversine(nearlyOnLine, MIDDLE)).toBeLessThan(LEG_ON_ROUTE_TOLERANCE_METERS);
    const legs = routeLegs(LINE, [WEST, nearlyOnLine, EAST], TOTALS);

    expect(legs.map((leg) => leg.kind)).toEqual(["first", "measured", "measured"]);
  });

  it("locates the points in travel order on a line that passes a place twice", () => {
    // Out east and back: a loop whose second half retraces the first.
    const line = [WEST, EAST, WEST];
    const legs = routeLegs(line, [WEST, EAST, WEST], {
      distanceMeters: haversine(WEST, EAST) * 2,
      durationSeconds: 1200,
    });

    expect(legs.map((leg) => leg.kind)).toEqual(["first", "measured", "measured"]);
    expect(measured(legs[2]!).distanceMeters).toBeCloseTo(haversine(WEST, EAST), 3);
  });

  it("refuses a line that has nothing to measure", () => {
    const legs = routeLegs([WEST], [WEST, MIDDLE, EAST], TOTALS);

    expect(legs.map((leg) => leg.kind)).toEqual(["first", "unknown", "unknown"]);
  });

  it("reports nothing for an empty itinerary and only the first for one point", () => {
    expect(routeLegs(LINE, [], TOTALS)).toEqual([]);
    expect(routeLegs(LINE, [MIDDLE], TOTALS)).toEqual([{ kind: "first" }]);
  });
});
