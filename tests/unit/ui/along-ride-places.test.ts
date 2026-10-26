/**
 * The ride's place-search ordering: where an answer sits on the line the rider
 * is following, and what stopping there costs.
 *
 * Pins the four rules: ahead first and nearest first, anything behind the rider
 * last (never dressed up as "ahead"), free-ride answers ordered by distance from
 * the rider, and no number at all when the ride has not measured the line or its
 * own pace.
 */

import { describe, expect, it } from "vitest";

import type { PlaceMatch } from "@/application/geocoding/place-search";
import {
  alongRideDistanceLabel,
  alongRideExtraLabel,
  alongRidePlaces,
  ALONG_RIDE_RESULT_LIMIT,
  detourMinutes,
  remainingPaceMetersPerSecond,
} from "@/ui/ride/along-ride-places";

/** A straight north-running line: -75.0 lon, 40.0 → 40.5 lat (about 34.5 mi). */
const LINE = [
  { lon: -75.0, lat: 40.0 },
  { lon: -75.0, lat: 40.5 },
];
const RIDER = { lon: -75.0, lat: 40.05 };

function place(id: string, name: string, lat: number, lon = -75.0): PlaceMatch {
  return {
    id,
    label: `${name}, PA`,
    name,
    context: "Carbon County, PA",
    coordinate: { lon, lat },
    provider: "fixture",
  };
}

describe("alongRidePlaces", () => {
  it("orders answers by distance ahead along the line, behind the rider last", () => {
    const rows = alongRidePlaces({
      places: [
        place("far", "Far Diner", 40.4),
        place("behind", "Passed Cafe", 40.01),
        place("near", "Near Coffee", 40.1),
      ],
      line: LINE,
      position: RIDER,
    });
    expect(rows.map((row) => row.place.name)).toEqual(["Near Coffee", "Far Diner", "Passed Cafe"]);
    expect(rows[0]?.aheadMeters).toBeGreaterThan(0);
    expect(rows[0]?.aheadMeters).toBeLessThan(rows[1]?.aheadMeters ?? 0);
    expect(rows[2]?.aheadMeters).toBeLessThan(0);
    expect(alongRideDistanceLabel(rows[0]!)).toMatch(/ mi ahead$/);
    expect(alongRideDistanceLabel(rows[2]!)).toBe("Behind you");
  });

  it("measures a detour at the ride's own remaining pace, and says nothing without one", () => {
    const withPace = alongRidePlaces({
      places: [place("off", "Off Route Diner", 40.1, -75.012)],
      line: LINE,
      position: RIDER,
      remainingMeters: 40_000,
      remainingSeconds: 2_400, // about 37 mph: a mile off route costs ~2 min out and back
    });
    expect(withPace[0]?.offMeters).toBeGreaterThan(700);
    expect(withPace[0]?.extraMinutes).toBeGreaterThanOrEqual(2);
    expect(alongRideExtraLabel(withPace[0]!.extraMinutes)).toMatch(/^~\+\d+ min$/);

    const withoutPace = alongRidePlaces({
      places: [place("off", "Off Route Diner", 40.1, -75.012)],
      line: LINE,
      position: RIDER,
    });
    expect(withoutPace[0]?.extraMinutes).toBeNull();
    expect(alongRideExtraLabel(withoutPace[0]!.extraMinutes)).toBeNull();
  });

  it("orders a Free Ride's answers by distance from the rider, and says away not ahead", () => {
    const rows = alongRidePlaces({
      places: [place("far", "Far Cafe", 40.3), place("near", "Near Cafe", 40.07)],
      line: [],
      position: RIDER,
    });
    expect(rows.map((row) => row.place.name)).toEqual(["Near Cafe", "Far Cafe"]);
    expect(rows[0]?.aheadMeters).toBeNull();
    expect(rows[0]?.awayMeters).toBeGreaterThan(0);
    expect(alongRideDistanceLabel(rows[0]!)).toMatch(/ mi away$/);
    // No line means no detour to measure: unknown, not zero.
    expect(rows[0]?.extraMinutes).toBeNull();
  });

  it("keeps the geocoder's order and states no distance without a fix or a line", () => {
    const rows = alongRidePlaces({
      places: [place("a", "First Cafe", 40.3), place("b", "Second Cafe", 40.1)],
      line: LINE,
      position: null,
    });
    expect(rows.map((row) => row.place.name)).toEqual(["First Cafe", "Second Cafe"]);
    expect(rows[0]?.aheadMeters).toBeNull();
    expect(rows[0]?.awayMeters).toBeNull();
    expect(alongRideDistanceLabel(rows[0]!)).toBeNull();
  });

  it("shows a short list, not a page", () => {
    const places = Array.from({ length: ALONG_RIDE_RESULT_LIMIT + 3 }, (_, index) =>
      place(`p${index}`, `Place ${index}`, 40.05 + index * 0.01),
    );
    expect(alongRidePlaces({ places, line: LINE, position: RIDER })).toHaveLength(ALONG_RIDE_RESULT_LIMIT);
  });
});

describe("detour minutes", () => {
  it("is zero on the road, a whole minute off it, and unknown without a pace", () => {
    const pace = remainingPaceMetersPerSecond(40_000, 2_400);
    expect(pace).not.toBeNull();
    expect(detourMinutes(40, pace)).toBe(0);
    expect(detourMinutes(800, pace)).toBeGreaterThanOrEqual(1);
    expect(detourMinutes(800, null)).toBeNull();
    expect(alongRideExtraLabel(0)).toBeNull();
  });

  it("refuses a pace the ride did not measure", () => {
    expect(remainingPaceMetersPerSecond(null, 600)).toBeNull();
    expect(remainingPaceMetersPerSecond(4_000, null)).toBeNull();
    expect(remainingPaceMetersPerSecond(0, 600)).toBeNull();
    expect(remainingPaceMetersPerSecond(4_000, 0)).toBeNull();
  });
});
