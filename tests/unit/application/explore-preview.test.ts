import { describe, expect, it } from "vitest";

import { projectRouteGeometry } from "@/application/explore/preview";

describe("Explore route preview projection", () => {
  it("normalizes geographic geometry into the fixed 96 by 64 view box", () => {
    const projected = projectRouteGeometry([
      { lon: -75, lat: 40 },
      { lon: -74, lat: 41 },
    ]);

    expect(projected.viewBox).toBe("0 0 96 64");
    expect(projected.points).toHaveLength(2);
    expect(projected.points[0]?.[0]).toBeGreaterThanOrEqual(6);
    expect(projected.points[0]?.[0]).toBeLessThanOrEqual(90);
    expect(projected.points[1]?.[1]).toBeGreaterThanOrEqual(6);
    expect(projected.points[1]?.[1]).toBeLessThanOrEqual(58);
  });

  it("returns no path points for unknown geometry instead of drawing a fake line", () => {
    expect(projectRouteGeometry([]).points).toEqual([]);
  });
});
