import { describe, expect, it } from "vitest";

import {
  buildHikeProfile,
  computeHikeStats,
  lineLengthMeters,
  profileLengthMeters,
} from "@/domain/hike";
import type { Coordinate } from "@/domain/ride/types";

/** One hundredth of a degree of latitude at the equator, in meters. */
const STEP_METERS = ((Math.PI / 180) * 6_371_000) / 100;

function north(index: number): Coordinate {
  return { lon: -77, lat: 40 + index * 0.01 };
}

describe("buildHikeProfile", () => {
  it("accumulates great-circle distance and keeps elevation gaps as null", () => {
    const line = [north(0), north(1), north(2)];
    const profile = buildHikeProfile(line, [100, null, 120]);

    expect(profile).toHaveLength(3);
    expect(profile[0]?.distanceMeters).toBe(0);
    expect(profile[1]?.distanceMeters).toBeCloseTo(STEP_METERS, 6);
    expect(profile[2]?.distanceMeters).toBeCloseTo(2 * STEP_METERS, 6);
    expect(profile.map((point) => point.elevationMeters)).toEqual([100, null, 120]);
    expect(profileLengthMeters(profile)).toBeCloseTo(2 * STEP_METERS, 6);
  });

  it("rejects an elevation array that does not align with the line", () => {
    expect(() => buildHikeProfile([north(0), north(1)], [100])).toThrow(TypeError);
    expect(() => buildHikeProfile([north(0)], [100, 120])).toThrow(TypeError);
  });

  it("rejects non-finite elevations instead of treating them as unknown", () => {
    expect(() => buildHikeProfile([north(0)], [Number.NaN])).toThrow(TypeError);
    expect(() => buildHikeProfile([north(0)], [Number.POSITIVE_INFINITY])).toThrow(TypeError);
  });

  it("rejects malformed coordinates", () => {
    expect(() => buildHikeProfile([{ lon: 0, lat: 91 }], [100])).toThrow(TypeError);
  });

  it("measures line length independently of elevation", () => {
    const length = lineLengthMeters([north(0), north(1), north(2)]);
    expect(length).toBeCloseTo(2 * STEP_METERS, 6);
    expect(lineLengthMeters([])).toBe(0);
    expect(lineLengthMeters([north(0)])).toBe(0);
  });
});

describe("computeHikeStats", () => {
  it("measures a climb then a descent", () => {
    const stats = computeHikeStats([north(0), north(1), north(2)], [100, 130, 110]);

    expect(stats.lengthMeters).toBeCloseTo(2 * STEP_METERS, 6);
    expect(stats.gainMeters).toBeCloseTo(30, 9);
    expect(stats.lossMeters).toBeCloseTo(20, 9);
    // 30 m over a 1111.95 m run is 2.698% uphill.
    expect(stats.maxGrade?.percent).toBeCloseTo((30 / STEP_METERS) * 100, 9);
    expect(stats.maxGrade?.direction).toBe("up");
    expect(stats.maxGrade?.runMeters).toBeCloseTo(STEP_METERS, 6);
    expect(stats.maxGrade?.atMeters).toBe(0);
    expect(stats.highestPoint?.elevationMeters).toBe(130);
    expect(stats.highestPoint?.distanceMeters).toBeCloseTo(STEP_METERS, 6);
    expect(stats.highestPoint?.coordinate).toEqual(north(1));
    expect(stats.lowestPoint?.elevationMeters).toBe(100);
    expect(stats.lowestPoint?.distanceMeters).toBe(0);
    expect(stats.elevation.measuredSegments).toBe(2);
    expect(stats.elevation.unmeasuredSegments).toBe(0);
    expect(stats.elevation.knownSamples).toBe(3);
    expect(stats.elevation.totalSamples).toBe(3);
    expect(stats.elevation.measuredLengthShare).toBeCloseTo(1, 12);
    expect(stats.elevation.measuredLengthMeters).toBeCloseTo(2 * STEP_METERS, 6);
  });

  it("never bridges an elevation gap", () => {
    const stats = computeHikeStats(
      [north(0), north(1), north(2), north(3)],
      [100, null, 120, 140],
    );

    // Only 120 → 140 is measurable; 100 → null → 120 adds nothing.
    expect(stats.gainMeters).toBeCloseTo(20, 9);
    expect(stats.lossMeters).toBe(0);
    expect(stats.maxGrade?.percent).toBeCloseTo((20 / STEP_METERS) * 100, 9);
    expect(stats.maxGrade?.atMeters).toBeCloseTo(2 * STEP_METERS, 6);
    expect(stats.elevation.measuredSegments).toBe(1);
    expect(stats.elevation.unmeasuredSegments).toBe(2);
    expect(stats.elevation.knownSamples).toBe(3);
    expect(stats.elevation.measuredLengthShare).toBeCloseTo(1 / 3, 12);
    // 100 is still a known sample, so it remains the lowest point.
    expect(stats.lowestPoint?.elevationMeters).toBe(100);
    expect(stats.highestPoint?.elevationMeters).toBe(140);
  });

  it("reports gain, loss, grade and high/low as null when no segment has two elevations", () => {
    const stats = computeHikeStats([north(0), north(1), north(2)], [null, null, null]);

    expect(stats.lengthMeters).toBeCloseTo(2 * STEP_METERS, 6);
    expect(stats.gainMeters).toBeNull();
    expect(stats.lossMeters).toBeNull();
    expect(stats.maxGrade).toBeNull();
    expect(stats.highestPoint).toBeNull();
    expect(stats.lowestPoint).toBeNull();
    expect(stats.elevation.knownSamples).toBe(0);
    expect(stats.elevation.measuredSegments).toBe(0);
    expect(stats.elevation.measuredLengthShare).toBe(0);
  });

  it("does not count a repeated position as a segment", () => {
    const same = north(0);
    const stats = computeHikeStats([same, same], [100, 120]);

    expect(stats.lengthMeters).toBe(0);
    expect(stats.gainMeters).toBeNull();
    expect(stats.maxGrade).toBeNull();
    expect(stats.elevation.measuredSegments).toBe(0);
    expect(stats.highestPoint?.elevationMeters).toBe(120);
    expect(stats.lowestPoint?.elevationMeters).toBe(100);
  });

  it("does not offer a grade for a run shorter than the DEM can resolve", () => {
    // 0.000018° of latitude is about 2 m.
    const line: Coordinate[] = [{ lon: -77, lat: 40 }, { lon: -77, lat: 40.000018 }];
    expect(lineLengthMeters(line)).toBeLessThan(5);
    const stats = computeHikeStats(line, [100, 110]);

    expect(stats.gainMeters).toBeCloseTo(10, 9);
    expect(stats.maxGrade).toBeNull();
    expect(stats.elevation.measuredSegments).toBe(1);
  });

  it("handles a single point", () => {
    const stats = computeHikeStats([north(0)], [100]);
    expect(stats.lengthMeters).toBe(0);
    expect(stats.gainMeters).toBeNull();
    expect(stats.highestPoint?.elevationMeters).toBe(100);
    expect(stats.elevation.totalSamples).toBe(1);
  });

  it("handles an empty line", () => {
    const stats = computeHikeStats([], []);
    expect(stats.lengthMeters).toBe(0);
    expect(stats.gainMeters).toBeNull();
    expect(stats.highestPoint).toBeNull();
    expect(stats.elevation.measuredLengthShare).toBe(0);
  });
});
