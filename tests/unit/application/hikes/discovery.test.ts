import { describe, expect, it } from "vitest";
import { rankHikes, profileTimeSeconds } from "@/application/hikes/discovery";
import type { HikeRecord } from "../../../../infra/trails/lib/types";
import type { ElevationProfile } from "@/application/elevation/profile";

function hike(id: string, name: string, lengthMeters: number, lon: number): HikeRecord {
  return { id, name, ref: null, operator: null, lengthMeters, sacScale: null, surface: null, trailVisibility: null, dog: null, access: null, bbox: [lon, 40, lon + .001, 40.001], start: { lon, lat: 40 }, end: { lon: lon + .001, lat: 40.001 }, trailheadCount: 0, trailheads: [], sources: [], elevationGainMeters: null, elevationLossMeters: null, maxGradePercent: null, toblerMinutes: null, elevationMeasuredShare: 0, elevationSource: null, timeMethod: null };
}
describe("hike discovery", () => {
  it("hides fragments, groups nearby names without merging distant hikes, and favors a substantial nearby trail", () => {
    const trails = [hike("stub", "Stub", 300, -75), hike("piece", "Ridge Trail", 1100, -75.001), hike("whole", "Ridge Trail", 5000, -75.002), hike("distant", "Ridge Trail", 5000, -75.2), hike("short", "Short", 900, -75)];
    const ranked = rankHikes(trails, { lon: -75, lat: 40 });
    expect(ranked.map((item) => item.id)).toEqual(["whole", "short", "distant"]);
  });
  it("groups same-name pieces that meet at their ends even when their starts are far apart", () => {
    const first = { ...hike("first", "Ridge", 5000, -75), end: { lon: -75.03, lat: 40 } };
    const next = hike("next", "Ridge", 1500, -75.03);
    expect(rankHikes([first, next], { lat: 40, lon: -75 }).map((item) => item.id)).toEqual(["first"]);
  });
  it("sums Tobler time over the signed profile grades", () => {
    const profile: ElevationProfile = { points: [{ distanceMeters: 0, elevationMeters: 0, coordinate: { lon: 0, lat: 0 } }, { distanceMeters: 1000, elevationMeters: 0, coordinate: { lon: 0, lat: 0 } }, { distanceMeters: 2000, elevationMeters: 100, coordinate: { lon: 0, lat: 0 } }], totalMeters: 2000, climbMeters: 100, descentMeters: 0, minMeters: 0, maxMeters: 100, steepestGradePercent: 10, steepestGradeShare: .75 };
    expect(profileTimeSeconds(profile)).toBeCloseTo(1729, -1);
  });
});
