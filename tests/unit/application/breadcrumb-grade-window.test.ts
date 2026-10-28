import { describe, expect, it } from "vitest";

import {
  GRADE_WINDOW_METERS,
  STEEP_LEG_PERCENT,
  breadcrumbMeasurements,
  breadcrumbLine,
} from "@/application/breadcrumb/measurements";
import { buildElevationProfile } from "@/application/elevation/profile";
import { straightBreadcrumb } from "@/domain/breadcrumb/route";
import type { BreadcrumbRoute, BreadcrumbWaypoint } from "@/domain/breadcrumb/types";

/** A profile at even spacing: the coordinate is a formality, the distances are the line. */
function profileAt(distances: readonly number[], elevations: readonly number[]) {
  const profile = buildElevationProfile(
    distances.map((distanceMeters) => ({ distanceMeters, coordinate: { lat: 40, lon: -75 } })),
    elevations,
  );
  if (profile === null) throw new Error("test profile could not be built");
  return profile;
}

/** A route whose one leg is `meters` long, north from a fixed point. */
function oneLegRoute(meters: number): BreadcrumbRoute {
  const waypoints: BreadcrumbWaypoint[] = [
    { id: "a", coordinate: { lat: 40, lon: -75 } },
    { id: "b", coordinate: { lat: 40 + meters / 111_194.9, lon: -75 } },
  ];
  return straightBreadcrumb(waypoints);
}

function spaced(totalMeters: number, stepMeters: number): number[] {
  const distances: number[] = [];
  for (let distance = 0; distance <= totalMeters + 1e-9; distance += stepMeters) distances.push(distance);
  return distances;
}

/** The naive grade a 30 m DEM window would read, for comparison in the tests. */
function maxThirtyMetreGrade(distances: readonly number[], elevations: readonly number[]): number {
  let steepest = 0;
  let back = 0;
  for (let index = 1; index < distances.length; index += 1) {
    while (back < index && distances[index]! - distances[back + 1]! >= 30) back += 1;
    const run = distances[index]! - distances[back]!;
    if (run < 30) continue;
    steepest = Math.max(steepest, Math.abs(((elevations[index]! - elevations[back]!) / run) * 100));
  }
  return steepest;
}

describe("breadcrumb max grade", () => {
  it("measures over at least the grade window, not a 30 m DEM wobble", () => {
    const distances = spaced(2000, 10);
    // A 2% climb with a ±8 m sawtooth that flips every 10 m: over 30 m this
    // reads as a 53% wall, over 100 m the wobble cancels and the climb remains.
    const elevations = distances.map((distance, index) => 0.02 * distance + (index % 2 === 0 ? 8 : -8));
    expect(maxThirtyMetreGrade(distances, elevations)).toBeGreaterThan(45);

    const route = oneLegRoute(2000);
    const measured = breadcrumbMeasurements(route, profileAt(distances, elevations));

    expect(GRADE_WINDOW_METERS).toBe(100);
    expect(measured.maxGradePercent).not.toBeNull();
    expect(measured.maxGradePercent!).toBeLessThan(10);
    expect(measured.maxGradePercent!).toBeGreaterThan(1);
    expect(measured.legs[0]!.maxGradePercent!).toBeLessThan(STEEP_LEG_PERCENT);
  });

  it("keeps the steep flag for a genuinely sustained steep pitch", () => {
    const distances = spaced(1000, 10);
    // Gentle 2% approach, then 150 m of honest 42% climb, then a gentle top-out.
    const elevations = distances.map((distance) => {
      if (distance <= 400) return 0.02 * distance;
      if (distance <= 550) return 0.02 * 400 + 0.42 * (distance - 400);
      return 0.02 * 400 + 0.42 * 150 + 0.02 * (distance - 550);
    });
    const measured = breadcrumbMeasurements(oneLegRoute(1000), profileAt(distances, elevations));

    expect(measured.maxGradePercent!).toBeGreaterThan(STEEP_LEG_PERCENT);
    expect(measured.maxGradePercent!).toBeCloseTo(42, 0);
    expect(measured.legs[0]!.maxGradePercent!).toBeCloseTo(42, 0);
  });

  it("reports the average of a leg shorter than the window instead of its noisiest step", () => {
    const distances = spaced(80, 2);
    // A steady 2% grade with ±6 m rock noise: the leg's ends sit on the same
    // noise phase, so the honest average is 2% even though single steps jump.
    const elevations = distances.map((distance) => 0.02 * distance + (Math.round(distance / 2) % 2 === 0 ? 6 : -6));
    const route = oneLegRoute(80);
    const measured = breadcrumbMeasurements(route, profileAt(distances, elevations));

    expect(measured.legs[0]!.distanceMeters).toBeLessThan(GRADE_WINDOW_METERS);
    expect(measured.legs[0]!.maxGradePercent!).toBeCloseTo(2, 0);
    expect(measured.legs[0]!.maxGradePercent!).toBeLessThan(STEEP_LEG_PERCENT);
    expect(measured.maxGradePercent!).toBeCloseTo(2, 0);
  });

  it("keeps a ridge line believable when the DEM is jagged", () => {
    // A 3 km ridge: 15% climb for 1.2 km, a rocky crest, then the descent.
    const distances = spaced(3000, 10);
    const elevations = distances.map((distance, index) => {
      const climb = distance <= 1200 ? 0.15 * distance : distance <= 1500 ? 0.15 * 1200 : 0.15 * 1200 - 0.12 * (distance - 1500);
      const crest = distance > 1100 && distance < 1600 ? (index % 2 === 0 ? 8 : -8) : 0;
      return climb + crest;
    });
    const measured = breadcrumbMeasurements(oneLegRoute(3000), profileAt(distances, elevations));

    expect(maxThirtyMetreGrade(distances, elevations)).toBeGreaterThan(60);
    expect(measured.maxGradePercent!).toBeGreaterThan(10);
    expect(measured.maxGradePercent!).toBeLessThan(30);
    expect(measured.legs[0]!.maxGradePercent!).toBeLessThan(STEEP_LEG_PERCENT);
  });

  it("keeps grade unknown without a profile, including the steep flag", () => {
    const measured = breadcrumbMeasurements(oneLegRoute(500), null);
    expect(measured).toMatchObject({ maxGradePercent: null, timeSeconds: null });
    expect(measured.legs[0]!.maxGradePercent).toBeNull();
  });

  it("measures each leg from the windows over its own stretch", () => {
    const distances = spaced(400, 10);
    // 40% up the first 200 m, 0% after it.
    const elevations = distances.map((distance) => (distance <= 200 ? 0.4 * distance : 80));
    const route: BreadcrumbRoute = straightBreadcrumb([
      { id: "a", coordinate: { lat: 40, lon: -75 } },
      { id: "mid", coordinate: { lat: 40 + 200 / 111_194.9, lon: -75 } },
      { id: "b", coordinate: { lat: 40 + 400 / 111_194.9, lon: -75 } },
    ]);
    const measured = breadcrumbMeasurements(route, profileAt(distances, elevations));

    expect(breadcrumbLine(route)).toHaveLength(3);
    expect(measured.legs[0]!.maxGradePercent!).toBeCloseTo(40, 0);
    expect(measured.legs[0]!.distanceMeters).toBeCloseTo(200, 0);
    // The flat leg is not steep; its top window still reaches back over the
    // climb, so it is lower than the climbing leg and below the steep flag.
    expect(measured.legs[1]!.maxGradePercent!).toBeLessThan(STEEP_LEG_PERCENT);
    expect(measured.legs[1]!.maxGradePercent!).toBeLessThan(measured.legs[0]!.maxGradePercent!);
    expect(measured.maxGradePercent!).toBeCloseTo(40, 0);
  });

  it("never returns a grade for a zero-length leg", () => {
    const route = straightBreadcrumb([
      { id: "a", coordinate: { lat: 40, lon: -75 } },
      { id: "b", coordinate: { lat: 40, lon: -75 } },
    ]);
    const distances = spaced(100, 10);
    const measured = breadcrumbMeasurements(route, profileAt(distances, distances.map(() => 100)));

    expect(measured.legs[0]!.distanceMeters).toBe(0);
    expect(measured.legs[0]!.maxGradePercent).toBeNull();
  });
});
