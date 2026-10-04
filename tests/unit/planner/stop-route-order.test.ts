/**
 * A stop added on the route goes where it falls along the ride, not at the end
 * (owner review 2026-10-04: dragging the line and "Add stop" on a place along
 * the ride must not make the ride double back).
 */

import { describe, expect, it } from "vitest";

import {
  alongRoutePosition,
  routeOrderInsertionBeforeId,
} from "@/application/planner/stop-insertion";
import { newStopId } from "@/domain/ride/ids";
import type { Coordinate, StopPoint } from "@/domain/ride/types";

// A ride heading east along one parallel, then north.
const LINE: readonly Coordinate[] = [
  { lon: -75.5, lat: 40.0 },
  { lon: -75.3, lat: 40.0 },
  { lon: -75.1, lat: 40.0 },
  { lon: -75.1, lat: 40.2 },
];

function stopAt(lon: number, lat: number): StopPoint {
  return {
    id: newStopId(),
    kind: "stop",
    coordinate: { lon, lat },
    provenance: { type: "map", selectedAt: "2026-10-04T00:00:00.000Z" },
  };
}

describe("alongRoutePosition", () => {
  it("orders points by where they project onto the line", () => {
    const early = alongRoutePosition(LINE, { lon: -75.45, lat: 40.01 });
    const middle = alongRoutePosition(LINE, { lon: -75.2, lat: 39.99 });
    const late = alongRoutePosition(LINE, { lon: -75.09, lat: 40.15 });
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
    expect(late).toBeGreaterThan(2);
  });

  it("is zero for a line too short to order along", () => {
    expect(alongRoutePosition([LINE[0]!], { lon: 0, lat: 0 })).toBe(0);
  });
});

describe("routeOrderInsertionBeforeId", () => {
  it("puts a new stop in front of the first stop that comes later on the ride", () => {
    const first = stopAt(-75.4, 40.0);
    const last = stopAt(-75.1, 40.15);
    const before = routeOrderInsertionBeforeId([first, last], LINE, { lon: -75.2, lat: 40.0 });
    expect(before).toBe(last.id);
  });

  it("appends when the new stop is past every existing stop", () => {
    const first = stopAt(-75.4, 40.0);
    expect(routeOrderInsertionBeforeId([first], LINE, { lon: -75.1, lat: 40.18 })).toBeUndefined();
  });

  it("goes first when it comes before every stop", () => {
    const later = stopAt(-75.2, 40.0);
    expect(routeOrderInsertionBeforeId([later], LINE, { lon: -75.48, lat: 40.0 })).toBe(later.id);
  });

  it("appends when there is no line or no stops", () => {
    expect(routeOrderInsertionBeforeId([], LINE, { lon: -75.2, lat: 40 })).toBeUndefined();
    expect(routeOrderInsertionBeforeId([stopAt(-75.2, 40)], [], { lon: -75.2, lat: 40 })).toBeUndefined();
  });
});
