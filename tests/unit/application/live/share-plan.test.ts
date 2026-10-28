import { describe, expect, it } from "vitest";

import { LIVE_SHARE_ROUTE_POINTS, shareRouteGeometry } from "@/application/live/share-plan";

/**
 * The line a rider's screen sends with a live link. The server refuses more than
 * 5,000 positions, and a route can hold far more than that, so the thinning here
 * is what keeps a long ride shareable — and it keeps the shape, not just the ends.
 */

function line(count: number): { lon: number; lat: number }[] {
  return Array.from({ length: count }, (_, index) => ({ lon: -75.4 + index * 0.0001, lat: 40.1 + index * 0.0001 }));
}

describe("sharing the planned line", () => {
  it("shares nothing when there is no line to draw", () => {
    expect(shareRouteGeometry([])).toBeNull();
    expect(shareRouteGeometry(line(1))).toBeNull();
  });

  it("shares a short line unchanged, as one segment", () => {
    const shared = shareRouteGeometry(line(3));
    expect(shared?.segments).toHaveLength(1);
    expect(shared?.segments[0]).toEqual(line(3));
  });

  it("thins a long line to the cap, keeping the first and last positions", () => {
    const long = line(LIVE_SHARE_ROUTE_POINTS * 2);
    const shared = shareRouteGeometry(long);
    const points = shared?.segments[0] ?? [];
    expect(points.length).toBeLessThanOrEqual(LIVE_SHARE_ROUTE_POINTS);
    expect(points[0]).toEqual(long[0]);
    expect(points.at(-1)).toEqual(long.at(-1));
    // Evenly spaced, so the corners in the middle stay corners on a follower's map.
    expect(points.length).toBeGreaterThan(LIVE_SHARE_ROUTE_POINTS / 2);
    expect(points[3]?.lon).toBeGreaterThan(points[2]?.lon ?? 0);
  });

  it("honours a smaller cap and never drops below a drawable pair", () => {
    expect(shareRouteGeometry(line(500), 10)?.segments[0]).toHaveLength(10);
    // The smallest line a follower can draw still has two ends.
    expect(shareRouteGeometry(line(5), 1)?.segments[0]).toHaveLength(2);
    expect(shareRouteGeometry(line(5), -3)?.segments[0]).toHaveLength(2);
  });

  it("copies the positions instead of aliasing the ride's own line", () => {
    const input = line(3);
    const shared = shareRouteGeometry(input);
    const first = shared?.segments[0]?.[0];
    expect(first).not.toBe(input[0]);
    expect(first).toEqual(input[0]);
  });
});
