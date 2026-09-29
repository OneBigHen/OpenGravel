import { describe, expect, it } from "vitest";

import { visibleRideInterestPoints } from "@/application/ride-interest/filter";
import type { RideInterestPoint } from "@/application/ride-interest/types";

function point(id: string, filter: RideInterestPoint["filter"]): RideInterestPoint {
  return {
    id,
    filter,
    kind: "viewpoint",
    name: id,
    coordinate: { lon: -75.3, lat: 40 },
    summary: null,
    photoUrl: null,
    detailUrl: null,
    attribution: "Test",
  };
}

describe("visibleRideInterestPoints", () => {
  const points = [point("scenic-1", "scenic"), point("food-1", "food"), point("events-1", "events")];

  it("shows nothing when the filter is off", () => {
    expect(visibleRideInterestPoints(points, "off")).toEqual([]);
  });

  it("shows only the chosen bucket", () => {
    expect(visibleRideInterestPoints(points, "scenic").map((p) => p.id)).toEqual(["scenic-1"]);
    expect(visibleRideInterestPoints(points, "food").map((p) => p.id)).toEqual(["food-1"]);
    expect(visibleRideInterestPoints(points, "events").map((p) => p.id)).toEqual(["events-1"]);
  });
});
