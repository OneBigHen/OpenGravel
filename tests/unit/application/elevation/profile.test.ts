import { describe, expect, it } from "vitest";

import { buildElevationProfile, sampleLine } from "@/application/elevation/profile";

const LINE = [
  { lon: -75.7, lat: 40.8 },
  { lon: -75.6, lat: 40.8 },
  { lon: -75.6, lat: 40.9 },
];

describe("sampleLine", () => {
  it("spaces samples evenly by distance and keeps both ends", () => {
    const samples = sampleLine(LINE, 11);
    expect(samples).toHaveLength(11);
    expect(samples[0]?.coordinate).toEqual(LINE[0]);
    expect(samples[10]?.coordinate.lon).toBeCloseTo(-75.6, 6);
    expect(samples[10]?.coordinate.lat).toBeCloseTo(40.9, 6);
    const steps = samples.slice(1).map((sample, index) => sample.distanceMeters - samples[index]!.distanceMeters);
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 6);
  });

  it("refuses a line it cannot measure", () => {
    expect(sampleLine([LINE[0]!], 10)).toEqual([]);
    expect(sampleLine([LINE[0]!, LINE[0]!], 10)).toEqual([]);
  });
});

describe("buildElevationProfile", () => {
  const samples = sampleLine(LINE, 6);

  it("counts climb and descent, ignoring noise under the hysteresis", () => {
    const profile = buildElevationProfile(samples, [100, 102, 100, 150, 120, 121]);
    expect(profile?.climbMeters).toBe(50);
    expect(profile?.descentMeters).toBe(30);
    expect(profile?.minMeters).toBe(100);
    expect(profile?.maxMeters).toBe(150);
  });

  it("measures the steepest sustained uphill grade", () => {
    const profile = buildElevationProfile(samples, [100, 100, 100, 150, 150, 150]);
    expect(profile?.steepestGradePercent).toBeGreaterThan(0);
  });

  it("never draws a profile from a mismatched or non-finite answer", () => {
    expect(buildElevationProfile(samples, [1, 2, 3])).toBeNull();
    expect(buildElevationProfile(samples, [1, 2, Number.NaN, 4, 5, 6])).toBeNull();
  });
});
