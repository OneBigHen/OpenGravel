import { describe, expect, it } from "vitest";

import { routeLabelAnchors } from "@/application/map/route-labels";
import type { Coordinate } from "@/domain/ride/types";

function line(points: readonly (readonly [number, number])[]): readonly Coordinate[] {
  return points.map(([lon, lat]) => ({ lon, lat }));
}

describe("route label anchors", () => {
  it("puts each label where its line is farthest from the other choices", () => {
    // Two routes share both ends and part; the second bulges east in its middle.
    const west = line([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10]]);
    const east = line([[0, 0], [0, 1], [0, 2], [0.5, 3], [1, 4], [2, 5], [1, 6], [0.5, 7], [0, 8], [0, 9], [0, 10]]);
    const [westAt, eastAt] = routeLabelAnchors([west, east]);
    expect(eastAt).toEqual({ lon: 2, lat: 5 });
    // The west line's farthest point from the bulge stays within the middle of the ride.
    expect(westAt?.lat).toBeGreaterThanOrEqual(1.5);
    expect(westAt?.lat).toBeLessThanOrEqual(8.5);
  });

  it("uses the midpoint for a lone line and skips an empty one", () => {
    const only = line([[0, 0], [0, 1], [0, 2]]);
    expect(routeLabelAnchors([only])).toEqual([{ lon: 0, lat: 1 }]);
    expect(routeLabelAnchors([only, []])[1]).toBeNull();
  });

  it("keeps a name off a marked finish (DV-09)", () => {
    // Two parallel choices; the finish sits at the west line's far end.
    const west = line([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10]]);
    const east = line([[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10]]);
    const [westAt] = routeLabelAnchors([west, east], [{ lon: 0, lat: 8.6 }]);
    expect(westAt?.lat).toBeLessThanOrEqual(6);
  });
});
