import { describe, expect, it } from "vitest";

import { personalPaceFactor, PERSONAL_PACE_LIMITS } from "@/domain/hike";
import type { HikeProfile, RecordedHike } from "@/domain/hike";

/** Tobler time for one flat kilometre: 11.9125 minutes. */
const FLAT_KM_MINUTES = 60 / (6 * Math.exp(-0.175));

function flatProfile(meters = 1000): HikeProfile {
  return [
    { distanceMeters: 0, elevationMeters: 100 },
    { distanceMeters: meters, elevationMeters: 100 },
  ];
}

function hike(id: string, ratio: number, meters = 1000): RecordedHike {
  return {
    id,
    profile: flatProfile(meters),
    // `ratio` is relative to Tobler's flat pace over the same distance.
    movingMinutes: FLAT_KM_MINUTES * ratio * (meters / 1000),
  };
}

describe("personalPaceFactor", () => {
  it("is null with no recordings, rather than inventing a pace", () => {
    const result = personalPaceFactor([]);

    expect(result.factor).toBeNull();
    expect(result.sampleCount).toBe(0);
    expect(result.samples).toEqual([]);
    expect(result.explanation).toContain("No usable recorded hikes");
  });

  it("compares recorded moving time with Tobler time", () => {
    const result = personalPaceFactor([hike("hike-1", 1.1)]);

    expect(result.factor).toBeCloseTo(1.1, 6);
    expect(result.sampleCount).toBe(1);
    expect(result.samples[0]?.id).toBe("hike-1");
    expect(result.samples[0]?.toblerMinutes).toBeCloseTo(FLAT_KM_MINUTES, 9);
    expect(result.samples[0]?.factor).toBeCloseTo(1.1, 6);
    expect(result.explanation).toContain("×1.1 of Tobler's pace");
    expect(result.explanation).toContain("median of 1 recorded hike");
  });

  it("uses the median so a single slow day does not set the pace", () => {
    const result = personalPaceFactor([
      hike("fast", 0.9),
      hike("typical", 1.2),
      hike("slow", 1.5),
    ]);

    expect(result.factor).toBeCloseTo(1.2, 6);
    expect(result.sampleCount).toBe(3);
    expect(result.explanation).toContain("median of 3 recorded hikes");
  });

  it("is not dragged by one outlier", () => {
    const result = personalPaceFactor([
      hike("first", 1.0),
      hike("second", 1.0),
      hike("long-lunch", 3.5),
    ]);

    expect(result.factor).toBeCloseTo(1.0, 6);
  });

  it("bounds a single implausible recording and says so", () => {
    const result = personalPaceFactor([hike("gps-gap", 10)]);

    expect(result.factor).toBe(PERSONAL_PACE_LIMITS.factorMax);
    expect(result.samples[0]?.factor).toBe(PERSONAL_PACE_LIMITS.sampleFactorMax);
    expect(result.explanation).toContain("bounded to ×2");
  });

  it("bounds a suspiciously fast recording too", () => {
    // A 10 km recording at a tenth of Tobler's pace still has 11.9 minutes of
    // moving time, so it passes the length/time filters and reaches the bounds.
    const result = personalPaceFactor([hike("car-ride", 0.1, 10_000)]);

    expect(result.factor).toBe(PERSONAL_PACE_LIMITS.factorMin);
    expect(result.samples[0]?.factor).toBe(PERSONAL_PACE_LIMITS.sampleFactorMin);
    expect(result.explanation).toContain("bounded to ×0.5");
  });

  it("skips recordings too short to compare", () => {
    const result = personalPaceFactor([
      { id: "short", profile: flatProfile(200), movingMinutes: 20 },
    ]);

    expect(result.factor).toBeNull();
    expect(result.sampleCount).toBe(0);
    expect(result.explanation).toContain("Skipped 1 recording");
  });

  it("skips a malformed recorded profile without losing the good ones", () => {
    const broken: RecordedHike = {
      id: "broken",
      // Distance decreases, so Tobler cannot time it.
      profile: [
        { distanceMeters: 0, elevationMeters: 100 },
        { distanceMeters: 800, elevationMeters: 120 },
        { distanceMeters: 500, elevationMeters: 90 },
      ],
      movingMinutes: 30,
    };
    const result = personalPaceFactor([broken, hike("good", 1.15)]);

    expect(result.sampleCount).toBe(1);
    expect(result.samples[0]?.id).toBe("good");
    expect(result.factor).toBeCloseTo(1.15, 6);
    expect(result.explanation).toContain("Skipped 1 recording");
  });

  it("skips a recording whose profile is mostly unknown", () => {
    const result = personalPaceFactor([
      {
        id: "no-dem",
        profile: [
          { distanceMeters: 0, elevationMeters: 100 },
          { distanceMeters: 1000, elevationMeters: 100 },
          { distanceMeters: 2000, elevationMeters: null },
        ],
        movingMinutes: 30,
      },
    ]);

    expect(result.factor).toBeNull();
    expect(result.explanation).toContain("Skipped 1 recording");
  });

  it("skips recordings shorter than the minimum moving time", () => {
    const result = personalPaceFactor([
      { id: "brief", profile: flatProfile(), movingMinutes: 2 },
    ]);

    expect(result.factor).toBeNull();
    expect(result.explanation).toContain("Skipped 1 recording");
  });

  it("treats a missing id as null", () => {
    const result = personalPaceFactor([
      { profile: flatProfile(), movingMinutes: FLAT_KM_MINUTES * 1.2 },
    ]);

    expect(result.samples[0]?.id).toBeNull();
  });
});
