import { describe, expect, it } from "vitest";
import { matchHikeFilters, rankHikes, profileTimeSeconds, type HikeFilters } from "@/application/hikes/discovery";
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
  describe("filters", () => {
    const none: HikeFilters = { length: "", gain: "", time: "", dogs: false, kids: false };
    const measured = (id: string, gainM: number | null, minutes: number | null) => ({ ...hike(id, id, 3000, -75), elevationGainMeters: gainM, toblerMinutes: minutes });
    it("rules hikes out on catalog facts before any profile loads", () => {
      expect(matchHikeFilters(measured("steep", 400, 60), { ...none, gain: "500" })).toBe(false);
      expect(matchHikeFilters(measured("gentle", 100, 60), { ...none, gain: "500" })).toBe(true);
      expect(matchHikeFilters(measured("long", 100, 300), { ...none, time: "4" })).toBe(false);
      expect(matchHikeFilters({ ...hike("far", "far", 20_000, -75) }, { ...none, length: "5" })).toBe(false);
    });
    it("leaves unknown gain or time undecided until a profile settles it", () => {
      const unknown = measured("unknown", null, null);
      expect(matchHikeFilters(unknown, { ...none, gain: "500" })).toBe("unknown");
      const flat: ElevationProfile = { points: [{ distanceMeters: 0, elevationMeters: 0, coordinate: { lon: 0, lat: 0 } }, { distanceMeters: 1000, elevationMeters: 10, coordinate: { lon: 0, lat: 0 } }], totalMeters: 1000, climbMeters: 10, descentMeters: 0, minMeters: 0, maxMeters: 10, steepestGradePercent: 1, steepestGradeShare: 1 };
      expect(matchHikeFilters(unknown, { ...none, gain: "500" }, flat)).toBe(true);
      expect(matchHikeFilters(unknown, none)).toBe(true);
    });
    it("filters by mapped shape", () => {
      const loopHike = { ...measured("loop", 100, 60), shape: "loop" as const };
      expect(matchHikeFilters(loopHike, { ...none, shape: "loop" })).toBe(true);
      expect(matchHikeFilters(loopHike, { ...none, shape: "out-and-back" })).toBe(false);
    });
    it("short and easy needs the easy grade, 3 miles and 500 ft", () => {
      const easy = { ...measured("easy", 100, 60), sacScale: "hiking" };
      expect(matchHikeFilters(easy, { ...none, kids: true })).toBe(true);
      expect(matchHikeFilters({ ...easy, elevationGainMeters: 200 }, { ...none, kids: true })).toBe(false);
      expect(matchHikeFilters({ ...easy, sacScale: "mountain_hiking" }, { ...none, kids: true })).toBe(false);
    });
  });
});
