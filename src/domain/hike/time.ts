/**
 * Honest walking time on a DEM profile (HIKE-MODE-PLAN H1 item 6).
 *
 * Tobler's hiking function gives a speed for every slope:
 *
 *   speed (km/h) = 6 × exp(−3.5 × |slope + 0.05|)
 *
 * where slope is rise/run. It peaks at a 5% descent (6 km/h) and falls away on
 * both sides, which is why a steep climb costs far more than the same distance
 * downhill. Each measured segment is timed with its own slope; the surface,
 * SAC and personal factors then scale the total time.
 *
 * A segment with no elevation on one end is timed as flat and counted in
 * `unknownGradeMeters`. That is a transparent fallback, not a claim: the
 * explanation says how much of the line it covers and that the estimate may be
 * short.
 */

import type { HikeProfile } from "./types";

/** Tobler's constants, named so the formula in the doc comment is checkable. */
export const TOBLER = {
  /** Speed coefficient in km/h at the preferred slope. */
  maxSpeedKmh: 6,
  /** Exponential penalty on the distance from the preferred slope. */
  penalty: 3.5,
  /** Preferred slope (rise/run): a 5% descent. */
  preferredSlope: -0.05,
} as const;

/** Tobler speed for a grade in percent (positive climbs). */
export function toblerSpeedKmh(gradePercent: number): number {
  if (!Number.isFinite(gradePercent)) {
    throw new TypeError(`grade must be a finite percentage; received ${String(gradePercent)}`);
  }
  const slope = gradePercent / 100;
  return (
    TOBLER.maxSpeedKmh *
    Math.exp(-TOBLER.penalty * Math.abs(slope - TOBLER.preferredSlope))
  );
}

export interface ToblerOptions {
  /** Multiplier on time for the mapped surface; 1.3 means 30% slower. */
  readonly surfaceFactor?: number;
  /** Multiplier on time for the SAC scale; 1.2 means 20% slower. */
  readonly sacScaleFactor?: number;
  /** Multiplier on time from the hiker's own recorded pace; 1.1 means 10% slower. */
  readonly personalPaceFactor?: number;
}

export interface ToblerFactors {
  readonly surfaceFactor: number;
  readonly sacScaleFactor: number;
  readonly personalPaceFactor: number;
  /** Product of the three, applied to the Tobler baseline. */
  readonly combinedFactor: number;
}

export interface ToblerTimeEstimate {
  /** Whole minutes, rounded for display. */
  readonly minutes: number;
  /** Unrounded minutes, for summing or personal-pace comparisons. */
  readonly preciseMinutes: number;
  /** Tobler's own time before any factor, unrounded. */
  readonly baselineMinutes: number;
  readonly factors: ToblerFactors;
  /** Distance whose grade was measured. */
  readonly measuredGradeMeters: number;
  /** Distance with no elevation, timed as flat and disclosed in the explanation. */
  readonly unknownGradeMeters: number;
  readonly explanation: string;
}

function factor(value: number | undefined, name: string): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive multiplier; received ${String(value)}`);
  }
  return value;
}

function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} m`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} m`;
}

function formatFactor(value: number): string {
  return String(Number(value.toFixed(2)));
}

function validateProfile(profile: HikeProfile): void {
  let previousDistance = 0;
  for (let index = 0; index < profile.length; index += 1) {
    const point = profile[index];
    if (point === undefined) continue;
    if (!Number.isFinite(point.distanceMeters) || point.distanceMeters < 0) {
      throw new TypeError(
        `profile point ${index} needs a finite non-negative distance; received ${String(point.distanceMeters)}`,
      );
    }
    if (point.distanceMeters < previousDistance) {
      throw new TypeError(
        `profile distances must not decrease (point ${index}: ${point.distanceMeters} after ${previousDistance})`,
      );
    }
    if (point.elevationMeters !== null && !Number.isFinite(point.elevationMeters)) {
      throw new TypeError(
        `profile point ${index} needs a finite elevation or null; received ${String(point.elevationMeters)}`,
      );
    }
    previousDistance = point.distanceMeters;
  }
}

/**
 * Times a profile with Tobler per segment, then applies the factors.
 *
 * The factors are multipliers on time: a `surfaceFactor` of 1.3 is 30% slower
 * than the function's own pace. Unknown grades use the flat (0%) slope, which
 * is the function's value at 0%, and are reported separately.
 */
export function toblerTime(
  profile: HikeProfile,
  options: ToblerOptions = {},
): ToblerTimeEstimate {
  validateProfile(profile);
  const surfaceFactor = factor(options.surfaceFactor, "surfaceFactor");
  const sacScaleFactor = factor(options.sacScaleFactor, "sacScaleFactor");
  const personalPaceFactor = factor(options.personalPaceFactor, "personalPaceFactor");
  const combinedFactor = surfaceFactor * sacScaleFactor * personalPaceFactor;

  let baselineMinutes = 0;
  let measuredGradeMeters = 0;
  let unknownGradeMeters = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const start = profile[index - 1];
    const end = profile[index];
    if (start === undefined || end === undefined) continue;
    const runMeters = end.distanceMeters - start.distanceMeters;
    if (!(runMeters > 0)) continue;
    if (start.elevationMeters !== null && end.elevationMeters !== null) {
      const gradePercent =
        ((end.elevationMeters - start.elevationMeters) / runMeters) * 100;
      baselineMinutes += (runMeters / 1000 / toblerSpeedKmh(gradePercent)) * 60;
      measuredGradeMeters += runMeters;
    } else {
      baselineMinutes += (runMeters / 1000 / toblerSpeedKmh(0)) * 60;
      unknownGradeMeters += runMeters;
    }
  }

  const preciseMinutes = baselineMinutes * combinedFactor;
  const minutes = Math.round(preciseMinutes);

  const factorParts: string[] = [];
  if (surfaceFactor !== 1) factorParts.push(`surface ×${formatFactor(surfaceFactor)}`);
  if (sacScaleFactor !== 1) factorParts.push(`SAC ×${formatFactor(sacScaleFactor)}`);
  if (personalPaceFactor !== 1) {
    factorParts.push(`your pace ×${formatFactor(personalPaceFactor)}`);
  }
  const formula =
    factorParts.length === 0
      ? "Tobler"
      : `Tobler, ${factorParts.join(", ")}`;

  let explanation = `About ${formatDuration(minutes)} (${formula}).`;
  const knownMeters = measuredGradeMeters + unknownGradeMeters;
  if (unknownGradeMeters > 0 && knownMeters > 0) {
    const share = Math.round((unknownGradeMeters / knownMeters) * 100);
    explanation += ` ${share}% of the line has no elevation profile and is timed as flat, so the estimate may be short.`;
  }
  if (baselineMinutes === 0) {
    explanation = "No distance to time: the profile has no segment.";
  }

  return {
    minutes,
    preciseMinutes,
    baselineMinutes,
    factors: {
      surfaceFactor,
      sacScaleFactor,
      personalPaceFactor,
      combinedFactor,
    },
    measuredGradeMeters,
    unknownGradeMeters,
    explanation,
  };
}
