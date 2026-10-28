import { describe, expect, it } from "vitest";

import { TOBLER, toblerSpeedKmh, toblerTime } from "@/domain/hike";
import type { HikeProfile } from "@/domain/hike";

/**
 * Tobler's flat-ground pace: 6 × exp(−3.5 × 0.05) km/h = 5.0367 km/h, so
 * one flat kilometre takes 60 / 5.0367 = 11.9125 minutes. Every expectation
 * below is derived from that by hand.
 */
const FLAT_KM_MINUTES = 60 / (6 * Math.exp(-0.175));

function profile(...points: readonly [number, number | null][]): HikeProfile {
  return points.map(([distanceMeters, elevationMeters]) => ({ distanceMeters, elevationMeters }));
}

describe("toblerSpeedKmh", () => {
  it("peaks at the preferred 5% descent", () => {
    expect(toblerSpeedKmh(-5)).toBeCloseTo(TOBLER.maxSpeedKmh, 12);
    expect(toblerSpeedKmh(-8)).toBeLessThan(toblerSpeedKmh(-5));
  });

  it("is 5.0367 km/h on flat ground", () => {
    expect(toblerSpeedKmh(0)).toBeCloseTo(6 * Math.exp(-0.175), 12);
    expect(toblerSpeedKmh(0)).toBeCloseTo(5.036742, 6);
  });

  it("climbs slower than it descends", () => {
    expect(toblerSpeedKmh(10)).toBeCloseTo(3.549332, 6);
    expect(toblerSpeedKmh(10)).toBeLessThan(toblerSpeedKmh(-10));
  });

  it("rejects a non-finite grade", () => {
    expect(() => toblerSpeedKmh(Number.NaN)).toThrow(TypeError);
  });
});

describe("toblerTime", () => {
  it("times a flat kilometre at 11.91 minutes", () => {
    const estimate = toblerTime(profile([0, 100], [1000, 100]));

    expect(estimate.preciseMinutes).toBeCloseTo(FLAT_KM_MINUTES, 9);
    expect(estimate.baselineMinutes).toBeCloseTo(FLAT_KM_MINUTES, 9);
    expect(estimate.minutes).toBe(12);
    expect(estimate.factors.combinedFactor).toBe(1);
    expect(estimate.measuredGradeMeters).toBe(1000);
    expect(estimate.unknownGradeMeters).toBe(0);
    expect(estimate.explanation).toBe("About 12 m (Tobler).");
  });

  it("times a 5% descent at exactly 10 minutes per kilometre", () => {
    const estimate = toblerTime(profile([0, 100], [1000, 50]));
    expect(estimate.preciseMinutes).toBeCloseTo(10, 9);
    expect(estimate.minutes).toBe(10);
  });

  it("times a 10% climb at 16.90 minutes per kilometre", () => {
    const estimate = toblerTime(profile([0, 100], [1000, 200]));
    expect(estimate.preciseMinutes).toBeCloseTo(16.904588, 6);
    expect(estimate.minutes).toBe(17);
  });

  it("adds the segment times of a mixed profile", () => {
    // 1 km at +5% (14.1907 min) then 1 km flat (11.9125 min).
    const estimate = toblerTime(profile([0, 100], [1000, 150], [2000, 150]));
    const fivePercentClimbMinutes = 60 / (6 * Math.exp(-0.35));
    expect(estimate.preciseMinutes).toBeCloseTo(fivePercentClimbMinutes + FLAT_KM_MINUTES, 9);
    expect(estimate.minutes).toBe(26);
    expect(estimate.measuredGradeMeters).toBe(2000);
  });

  it("scales the whole profile by surface, SAC and personal factors", () => {
    const estimate = toblerTime(profile([0, 100], [1000, 100]), {
      surfaceFactor: 1.3,
      sacScaleFactor: 1.2,
      personalPaceFactor: 1.1,
    });

    expect(estimate.factors.surfaceFactor).toBe(1.3);
    expect(estimate.factors.sacScaleFactor).toBe(1.2);
    expect(estimate.factors.personalPaceFactor).toBe(1.1);
    expect(estimate.factors.combinedFactor).toBeCloseTo(1.716, 12);
    expect(estimate.baselineMinutes).toBeCloseTo(FLAT_KM_MINUTES, 9);
    expect(estimate.preciseMinutes).toBeCloseTo(FLAT_KM_MINUTES * 1.716, 9);
    expect(estimate.minutes).toBe(20);
    expect(estimate.explanation).toContain("surface ×1.3");
    expect(estimate.explanation).toContain("SAC ×1.2");
    expect(estimate.explanation).toContain("your pace ×1.1");
    expect(estimate.explanation).toContain("Tobler,");
  });

  it("formats an estimate over an hour", () => {
    const estimate = toblerTime(profile([0, 100], [8000, 100]));
    expect(estimate.minutes).toBe(95);
    expect(estimate.explanation).toBe("About 1 h 35 m (Tobler).");
  });

  it("times unknown grades as flat and says how much of the line that is", () => {
    const estimate = toblerTime(profile([0, 100], [1000, null]));

    expect(estimate.preciseMinutes).toBeCloseTo(FLAT_KM_MINUTES, 9);
    expect(estimate.measuredGradeMeters).toBe(0);
    expect(estimate.unknownGradeMeters).toBe(1000);
    expect(estimate.explanation).toContain("100% of the line has no elevation profile");
    expect(estimate.explanation).toContain("timed as flat");
  });

  it("mixes measured and unknown segments and counts each", () => {
    const estimate = toblerTime(profile([0, 100], [1000, 150], [2000, null]));

    expect(estimate.measuredGradeMeters).toBe(1000);
    expect(estimate.unknownGradeMeters).toBe(1000);
    const fivePercentClimbMinutes = 60 / (6 * Math.exp(-0.35));
    expect(estimate.preciseMinutes).toBeCloseTo(fivePercentClimbMinutes + FLAT_KM_MINUTES, 9);
    expect(estimate.explanation).toContain("50% of the line has no elevation profile");
  });

  it("does not fabricate time for a profile with no distance", () => {
    expect(toblerTime([]).minutes).toBe(0);
    expect(toblerTime(profile([0, 100])).minutes).toBe(0);
    expect(toblerTime([]).explanation).toContain("No distance to time");
  });

  it("rejects non-positive or non-finite factors", () => {
    expect(() => toblerTime(profile([0, 100], [1000, 100]), { surfaceFactor: 0 })).toThrow(
      TypeError,
    );
    expect(() =>
      toblerTime(profile([0, 100], [1000, 100]), { sacScaleFactor: Number.NaN }),
    ).toThrow(TypeError);
    expect(() =>
      toblerTime(profile([0, 100], [1000, 100]), { personalPaceFactor: -1 }),
    ).toThrow(TypeError);
  });

  it("rejects a profile whose distance decreases", () => {
    expect(() => toblerTime(profile([0, 100], [500, 120], [400, 90]))).toThrow(TypeError);
  });

  it("rejects non-finite elevations instead of treating them as flat", () => {
    expect(() => toblerTime(profile([0, 100], [1000, Number.NaN]))).toThrow(TypeError);
  });
});
