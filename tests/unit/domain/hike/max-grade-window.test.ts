import { describe, expect, it } from "vitest";

import {
  MIN_GRADE_WINDOW_METERS,
  computeHikeStats,
  type HikeStats,
} from "@/domain/hike";
import type { Coordinate } from "@/domain/ride/types";

/** One hundredth of a degree of latitude at the equator, in meters. */
const STEP_METERS = ((Math.PI / 180) * 6_371_000) / 100;

/** A line of evenly spaced points, `stepMeters` apart. */
function lineOf(steps: number, stepMeters: number): Coordinate[] {
  const line: Coordinate[] = [];
  for (let index = 0; index <= steps; index += 1) {
    line.push({ lon: -77, lat: 40 + (index * stepMeters) / STEP_METERS / 100 });
  }
  return line;
}

/** The naive grade a per-sample DEM read would report, for comparison. */
function maxSegmentGrade(line: readonly Coordinate[], elevations: readonly (number | null)[]): number {
  let steepest = 0;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1]!;
    const to = line[index]!;
    const run = Math.hypot(to.lat - from.lat, to.lon - from.lon) * (Math.PI / 180) * 6_371_000;
    const startElevation = elevations[index - 1];
    const endElevation = elevations[index];
    if (run >= 5 && startElevation != null && endElevation != null) {
      steepest = Math.max(steepest, Math.abs(((endElevation - startElevation) / run) * 100));
    }
  }
  return steepest;
}

function maxGradeOf(stats: HikeStats) {
  const grade = stats.maxGrade;
  if (grade === null) throw new Error("expected a measured max grade");
  return grade;
}

describe("hike max grade window", () => {
  it("measures over at least the window, so DEM wobble is not a cliff", () => {
    const line = lineOf(200, 10);
    // A 2% climb with a ±8 m sawtooth every 10 m: per sample it reads as a
    // 78% cliff in both directions, over 100 m the wobble cancels.
    const elevations = line.map((_, index) => 0.02 * index * 10 + (index % 2 === 0 ? 8 : -8));
    expect(maxSegmentGrade(line, elevations)).toBeGreaterThan(50);

    const stats = computeHikeStats(line, elevations);
    const grade = maxGradeOf(stats);

    expect(MIN_GRADE_WINDOW_METERS).toBe(100);
    expect(Math.abs(grade.percent)).toBeLessThan(10);
    expect(Math.abs(grade.percent)).toBeGreaterThan(1);
    expect(grade.runMeters).toBeGreaterThanOrEqual(MIN_GRADE_WINDOW_METERS);
  });

  it("still finds a sustained 20% climb on a real-looking ridge", () => {
    // 600 m of honest 20% up, 600 m of rocky crest, then 800 m of 15% down.
    const line = lineOf(200, 10);
    const elevations = line.map((_, index) => {
      const distance = index * 10;
      const climb = distance <= 600 ? 0.2 * distance : 0.2 * 600;
      const crest = distance > 600 && distance < 1200 ? (index % 2 === 0 ? 8 : -8) : 0;
      const descent = distance > 1200 ? 0.15 * (distance - 1200) : 0;
      return climb + crest - descent;
    });
    const stats = computeHikeStats(line, elevations);
    const grade = maxGradeOf(stats);

    expect(grade.direction).toBe("up");
    expect(grade.percent).toBeGreaterThan(18);
    expect(grade.percent).toBeLessThan(30);
    expect(grade.runMeters).toBe(MIN_GRADE_WINDOW_METERS);
    // The steepest window is on the climb, not the flat crest or the descent.
    expect(grade.atMeters).toBeLessThan(600);
  });

  it("reports the average of a measured run shorter than the window", () => {
    const line = lineOf(6, 10);
    // 60 m at a steady 12%, with ±6 m of rock noise that cancels end to end.
    const elevations = line.map((_, index) => 0.12 * index * 10 + (index % 2 === 0 ? 6 : -6));
    const stats = computeHikeStats(line, elevations);
    const grade = maxGradeOf(stats);

    expect(stats.lengthMeters).toBeCloseTo(60, 6);
    expect(grade.percent).toBeCloseTo(12, 6);
    expect(grade.runMeters).toBeCloseTo(60, 6);
    expect(grade.atMeters).toBe(0);
    expect(grade.direction).toBe("up");
  });

  it("never measures a window across an elevation gap", () => {
    // A 100 m cliff sits between two unknown samples. A window that bridged
    // the gap would read 500%; the measured stretches are both gentle.
    const line = lineOf(40, 10);
    const elevations = line.map((_, index) => {
      if (index === 20 || index === 21) return null;
      if (index < 20) return 0.02 * index * 10;
      return 100 + 0.04 * (index - 21) * 10;
    });
    const stats = computeHikeStats(line, elevations);
    const grade = maxGradeOf(stats);

    // The 4% grade after the gap wins; the 100 m step across it adds nothing.
    expect(grade.percent).toBeCloseTo(4, 6);
    expect(Math.abs(grade.percent)).toBeLessThan(10);
    expect(grade.atMeters).toBeGreaterThanOrEqual(200);
    expect(stats.gainMeters!).toBeLessThan(15);
  });

  it("keeps grade unknown when no stretch is long enough for the DEM to resolve", () => {
    // Two samples 2 m apart are below MIN_GRADE_RUN_METERS.
    const line: Coordinate[] = [{ lon: -77, lat: 40 }, { lon: -77, lat: 40.000018 }];
    const stats = computeHikeStats(line, [100, 110]);

    expect(stats.gainMeters).toBeCloseTo(10, 9);
    expect(stats.maxGrade).toBeNull();
  });
});
