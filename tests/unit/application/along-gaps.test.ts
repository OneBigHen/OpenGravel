/**
 * Which stations sit at the ends of the longest dry stretch: the planner shows
 * exactly these when the bike cannot cross that stretch on one tank.
 */

import { describe, expect, it } from "vitest";

import { gapBoundingStops, METERS_PER_MILE, type AlongStop } from "@/application/map-layers";

function stop(id: string, alongMiles: number): AlongStop {
  return {
    feature: {
      id,
      layerId: "fuel",
      name: id,
      detail: null,
      weight: null,
      geometry: { type: "Point", coordinates: [-75, 40] },
    },
    alongMeters: alongMiles * METERS_PER_MILE,
    offMeters: 20,
  };
}

describe("gapBoundingStops", () => {
  it("returns the stop before and the stop after the dry stretch", () => {
    const stops = [stop("a", 5), stop("b", 20), stop("c", 65), stop("d", 68)];
    // The 45-mile stretch between mile 20 and mile 65.
    expect(gapBoundingStops(stops, 20 * METERS_PER_MILE, 45 * METERS_PER_MILE).map((entry) => entry.feature.id))
      .toEqual(["b", "c"]);
  });

  it("returns only the stop after a stretch that starts at the route start", () => {
    expect(gapBoundingStops([stop("first", 30), stop("second", 70)], 0, 30 * METERS_PER_MILE)
      .map((entry) => entry.feature.id)).toEqual(["first"]);
  });

  it("never invents a stop when none was found", () => {
    expect(gapBoundingStops([], 0, 60 * METERS_PER_MILE)).toEqual([]);
  });
});
