import { describe, expect, it } from "vitest";
import { trailBreadcrumb } from "@/application/hikes/trail-breadcrumb";
import { breadcrumbIssues } from "@/domain/breadcrumb/route";
import type { Coordinate } from "@/domain/ride/types";

// A 5 km out-and-around loop whose ends sit 100 m apart: the case where the
// two ends alone would plan a 100 m shortcut instead of the trail.
function loop(): Coordinate[] {
  const points: Coordinate[] = [];
  for (let i = 0; i <= 200; i += 1) {
    const angle = (i / 200) * 2 * Math.PI * 0.98;
    points.push({ lon: -75.99 + 0.0095 * Math.sin(angle), lat: 40.63 + 0.0072 * (1 - Math.cos(angle)) });
  }
  return points;
}

describe("trail breadcrumb", () => {
  it("keeps the trail with waypoints along it, legs that tile the line, and a valid breadcrumb", () => {
    const line = loop();
    const route = trailBreadcrumb(line, "Lookout Loop")!;
    expect(breadcrumbIssues(route)).toEqual([]);
    expect(route.waypoints.length).toBeGreaterThanOrEqual(5);
    expect(route.waypoints[0]).toMatchObject({ id: "trail-start", name: "Lookout Loop start", coordinate: line[0] });
    expect(route.waypoints.at(-1)).toMatchObject({ id: "trail-end", name: "Lookout Loop end", coordinate: line.at(-1) });
    expect(route.legs.reduce((sum, leg) => sum + leg.geometry.length - 1, 0)).toBe(line.length - 1);
    expect(new Set(route.waypoints.map((point) => point.id)).size).toBe(route.waypoints.length);
  });

  it("caps the waypoint count on long trails and keeps a short one to its ends", () => {
    const long = Array.from({ length: 400 }, (_, i) => ({ lon: -75 + i * 0.001, lat: 40 }));
    expect(trailBreadcrumb(long, "Long")!.waypoints).toHaveLength(12);
    expect(trailBreadcrumb(long.slice(0, 5), "Short")!.waypoints).toHaveLength(2);
    expect(trailBreadcrumb([{ lon: 0, lat: 0 }], "Dot")).toBeNull();
  });
});
