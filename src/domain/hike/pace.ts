/**
 * The hiker's own pace factor from recorded hikes (H1 item 6).
 *
 * Each recorded hike offers one comparison: recorded moving time against
 * Tobler's time for the same profile. The median of those ratios is used, so a
 * single hike with a long lunch stop or a GPS gap cannot define the pace. The
 * result is bounded to a human range and returned with its sample count and an
 * explanation; with no usable recording the factor is null and time stays on
 * Tobler's own pace rather than a guessed one.
 */

import { profileLengthMeters } from "./profile";
import { toblerTime, type ToblerTimeEstimate } from "./time";
import type { HikeProfile } from "./types";

/** One hike the hiker actually walked, with the time the recorder measured. */
export interface RecordedHike {
  readonly id?: string;
  /** DEM profile of the recorded track; build it with `buildHikeProfile`. */
  readonly profile: HikeProfile;
  /** Moving time from the recorder, in minutes (pauses excluded). */
  readonly movingMinutes: number;
}

export interface PersonalPaceSample {
  readonly id: string | null;
  readonly toblerMinutes: number;
  readonly movingMinutes: number;
  /** movingMinutes / toblerMinutes, bounded per sample before the median. */
  readonly factor: number;
}

export interface PersonalPaceFactor {
  /** Median pace multiplier, or null when no recording is usable. */
  readonly factor: number | null;
  readonly sampleCount: number;
  readonly samples: readonly PersonalPaceSample[];
  readonly explanation: string;
}

/** Thresholds, exported so tests and copy quote the same numbers. */
export const PERSONAL_PACE_LIMITS = {
  /** A shorter moving time than this says more about the stopwatch than the hiker. */
  minMovingMinutes: 5,
  /** Same for a Tobler baseline too short to compare. */
  minToblerMinutes: 5,
  /** Recordings shorter than this have too much start/stop noise. */
  minLengthMeters: 500,
  /**
   * A recording whose profile is mostly unknown would compare moving time
   * against a partly-flat Tobler baseline, so it is not evidence about pace.
   */
  maxUnknownGradeShare: 0.2,
  /** Per-sample bounds before the median: one GPS gap cannot dominate. */
  sampleFactorMin: 0.25,
  sampleFactorMax: 4,
  /** Reported bounds: no hiker is three times Tobler over a whole route. */
  factorMin: 0.5,
  factorMax: 2,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return Number.NaN;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

function roundFactor(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Measures how fast the hiker actually moves against Tobler, from their own
 * recordings.
 *
 * @param recordedHikes recorded tracks with moving time; order does not matter.
 */
export function personalPaceFactor(
  recordedHikes: readonly RecordedHike[],
): PersonalPaceFactor {
  const samples: PersonalPaceSample[] = [];
  let skipped = 0;

  for (const hike of recordedHikes) {
    if (
      !Number.isFinite(hike.movingMinutes) ||
      hike.movingMinutes < PERSONAL_PACE_LIMITS.minMovingMinutes
    ) {
      skipped += 1;
      continue;
    }
    if (profileLengthMeters(hike.profile) < PERSONAL_PACE_LIMITS.minLengthMeters) {
      skipped += 1;
      continue;
    }
    let baseline: ToblerTimeEstimate;
    try {
      baseline = toblerTime(hike.profile);
    } catch {
      // A malformed recorded profile is not evidence about pace.
      skipped += 1;
      continue;
    }
    if (baseline.preciseMinutes < PERSONAL_PACE_LIMITS.minToblerMinutes) {
      skipped += 1;
      continue;
    }
    const profiledMeters = baseline.measuredGradeMeters + baseline.unknownGradeMeters;
    if (
      profiledMeters <= 0 ||
      baseline.unknownGradeMeters / profiledMeters >
        PERSONAL_PACE_LIMITS.maxUnknownGradeShare
    ) {
      skipped += 1;
      continue;
    }
    const ratio = hike.movingMinutes / baseline.preciseMinutes;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      skipped += 1;
      continue;
    }
    samples.push({
      id: hike.id ?? null,
      toblerMinutes: baseline.preciseMinutes,
      movingMinutes: hike.movingMinutes,
      factor: clamp(
        ratio,
        PERSONAL_PACE_LIMITS.sampleFactorMin,
        PERSONAL_PACE_LIMITS.sampleFactorMax,
      ),
    });
  }

  const skippedText =
    skipped === 0
      ? ""
      : ` Skipped ${skipped} recording${skipped === 1 ? "" : "s"} that ${
          skipped === 1 ? "was" : "were"
        } too short or had no elevation profile.`;

  if (samples.length === 0) {
    return {
      factor: null,
      sampleCount: 0,
      samples,
      explanation: `No usable recorded hikes yet; time uses Tobler's own pace.${skippedText}`,
    };
  }

  const medianFactor = median(samples.map((sample) => sample.factor));
  const bounded = clamp(
    medianFactor,
    PERSONAL_PACE_LIMITS.factorMin,
    PERSONAL_PACE_LIMITS.factorMax,
  );
  const factor = roundFactor(bounded);
  const hikes = samples.length === 1 ? "hike" : "hikes";
  let explanation = `Your recorded ${hikes} run at ×${factor} of Tobler's pace (median of ${samples.length} recorded ${hikes}).`;
  if (bounded !== medianFactor) {
    explanation += ` The value is bounded to ×${bounded === PERSONAL_PACE_LIMITS.factorMin ? PERSONAL_PACE_LIMITS.factorMin : PERSONAL_PACE_LIMITS.factorMax} so one bad recording cannot set the estimate.`;
  }
  explanation += skippedText;

  return { factor, sampleCount: samples.length, samples, explanation };
}
