/**
 * Hike statistics from a line and a DEM profile (HIKE-MODE-PLAN H1 item 5).
 *
 * Length is always measured. Gain, loss, max grade and the high/low points
 * exist only where two adjacent samples have an elevation; a segment with a
 * gap is skipped rather than bridged, so a partial DEM cannot manufacture a
 * climb. The measured share is returned with the numbers, which is what lets
 * `difficultyFromNumbers` (and the UI) say "gain unknown" instead of zero.
 *
 * Gain sums every measured rise. There is no deadband here: DEM quantisation
 * is a property of the source, and the adapter that samples the DEM decides
 * how to smooth it before building the profile. The steepest grade is the one
 * exception: it is measured over at least `MIN_GRADE_WINDOW_METERS` so a noisy
 * DEM cannot invent a wall.
 */

import type { Coordinate } from "../ride/types";
import { buildHikeProfile } from "./profile";
import type {
  HikeElevationCoverage,
  HikeElevationPoint,
  HikeGrade,
  HikeProfilePoint,
  HikeStats,
} from "./types";

/**
 * A grade is measured across at least this much horizontal run. A DEM's
 * vertical error over a few meters reads as a cliff, so a shorter window would
 * report noise as the trail's steepest pitch.
 */
export const MIN_GRADE_WINDOW_METERS = 100;

/**
 * A measured run shorter than the window is reported as its own average grade,
 * but only once it is long enough for the DEM to resolve a slope at all. Below
 * this, gain and loss still count the segment while the grade stays unknown.
 */
export const MIN_GRADE_RUN_METERS = 5;

function highestPointOf(
  current: HikeElevationPoint | null,
  candidate: HikeElevationPoint,
): HikeElevationPoint {
  if (current === null || candidate.elevationMeters > current.elevationMeters) {
    return candidate;
  }
  return current;
}

function lowestPointOf(
  current: HikeElevationPoint | null,
  candidate: HikeElevationPoint,
): HikeElevationPoint {
  if (current === null || candidate.elevationMeters < current.elevationMeters) {
    return candidate;
  }
  return current;
}

/** One point of a contiguous measured run, as the grade needs it. */
interface HikeGradePoint {
  readonly distanceMeters: number;
  readonly elevationMeters: number;
}

/** A stretch of line whose every segment has an elevation at both ends. */
interface HikeGradeRun {
  readonly points: HikeGradePoint[];
}

function gradePoint(point: HikeProfilePoint): HikeGradePoint {
  return { distanceMeters: point.distanceMeters, elevationMeters: point.elevationMeters! };
}

/** Keeps the candidate with the greatest absolute grade, signed. */
function steeper(
  current: HikeGrade | null,
  percent: number,
  runMeters: number,
  atMeters: number,
): HikeGrade | null {
  if (current !== null && Math.abs(percent) <= Math.abs(current.percent)) return current;
  return {
    percent,
    direction: percent >= 0 ? "up" : "down",
    runMeters,
    atMeters,
  };
}

/**
 * The steepest sustained grade across contiguous measured runs.
 *
 * A window is exactly `MIN_GRADE_WINDOW_METERS` long, ending on a measured
 * sample with its start interpolated between samples: every candidate measures
 * the same length of ground, so a sawtooth DEM cannot swing the answer with the
 * sample spacing. A run shorter than the window has no sustained stretch to
 * find; it offers its average grade instead, and only once it is long enough to
 * resolve at all. Gaps end a run, so no window is ever measured across one.
 */
function steepestGrade(runs: readonly HikeGradeRun[]): HikeGrade | null {
  let steepest: HikeGrade | null = null;
  for (const run of runs) {
    const first = run.points[0];
    if (first === undefined) continue;
    let back = 0;
    for (let index = 1; index < run.points.length; index += 1) {
      const to = run.points[index]!;
      const start = to.distanceMeters - MIN_GRADE_WINDOW_METERS;
      if (start < first.distanceMeters) continue;
      while (back + 1 < index && run.points[back + 1]!.distanceMeters < start) back += 1;
      const before = run.points[back]!;
      const after = run.points[back + 1] ?? to;
      const span = after.distanceMeters - before.distanceMeters;
      const startElevation = span <= 0
        ? after.elevationMeters
        : before.elevationMeters +
          ((after.elevationMeters - before.elevationMeters) * (start - before.distanceMeters)) / span;
      steepest = steeper(
        steepest,
        ((to.elevationMeters - startElevation) / MIN_GRADE_WINDOW_METERS) * 100,
        MIN_GRADE_WINDOW_METERS,
        start,
      );
    }
  }
  for (const run of runs) {
    const first = run.points[0];
    const last = run.points[run.points.length - 1];
    if (first === undefined || last === undefined) continue;
    const runMeters = last.distanceMeters - first.distanceMeters;
    if (runMeters >= MIN_GRADE_WINDOW_METERS || runMeters < MIN_GRADE_RUN_METERS) continue;
    steepest = steeper(
      steepest,
      ((last.elevationMeters - first.elevationMeters) / runMeters) * 100,
      runMeters,
      first.distanceMeters,
    );
  }
  return steepest;
}

/**
 * Measures a hike.
 *
 * @param line ordered WGS84 line; length is great-circle distance.
 * @param elevations one entry per line vertex, `null` where the DEM has none.
 */
export function computeHikeStats(
  line: readonly Coordinate[],
  elevations: readonly (number | null)[],
): HikeStats {
  const profile = buildHikeProfile(line, elevations);

  let lengthMeters = 0;
  let gainMeters = 0;
  let lossMeters = 0;
  let measuredLengthMeters = 0;
  let measuredSegments = 0;
  let unmeasuredSegments = 0;
  let knownSamples = 0;
  let highestPoint: HikeElevationPoint | null = null;
  let lowestPoint: HikeElevationPoint | null = null;
  let previous: HikeProfilePoint | null = null;
  // Contiguous stretches where every segment has an elevation at both ends.
  // A grade window never crosses a gap, because bridging one would invent a
  // slope the DEM never measured.
  const runs: HikeGradeRun[] = [];
  let currentRun: HikeGradeRun | null = null;

  for (let index = 0; index < profile.length; index += 1) {
    const point = profile[index];
    if (point === undefined) continue;
    lengthMeters = Math.max(lengthMeters, point.distanceMeters);
    const coordinate = line[index];

    if (coordinate !== undefined && point.elevationMeters !== null) {
      knownSamples += 1;
      const elevationPoint: HikeElevationPoint = {
        elevationMeters: point.elevationMeters,
        distanceMeters: point.distanceMeters,
        coordinate,
      };
      highestPoint = highestPointOf(highestPoint, elevationPoint);
      lowestPoint = lowestPointOf(lowestPoint, elevationPoint);
    }

    if (previous !== null) {
      const runMeters = point.distanceMeters - previous.distanceMeters;
      const startElevation = previous.elevationMeters;
      const endElevation = point.elevationMeters;
      if (runMeters > 0) {
        if (startElevation !== null && endElevation !== null) {
          measuredSegments += 1;
          measuredLengthMeters += runMeters;
          const riseMeters = endElevation - startElevation;
          if (riseMeters > 0) gainMeters += riseMeters;
          else lossMeters -= riseMeters;
          if (currentRun === null) {
            currentRun = { points: [gradePoint(previous), gradePoint(point)] };
          } else {
            currentRun.points.push(gradePoint(point));
          }
        } else {
          // Never bridge an elevation gap: an unknown segment adds neither
          // gain nor loss and is reported as unmeasured.
          unmeasuredSegments += 1;
          if (currentRun !== null) {
            runs.push(currentRun);
            currentRun = null;
          }
        }
      }
    }

    previous = point;
  }
  if (currentRun !== null) runs.push(currentRun);

  const elevation: HikeElevationCoverage = {
    knownSamples,
    totalSamples: profile.length,
    measuredSegments,
    unmeasuredSegments,
    measuredLengthMeters,
    measuredLengthShare:
      lengthMeters > 0 ? measuredLengthMeters / lengthMeters : 0,
  };

  return {
    lengthMeters,
    gainMeters: measuredSegments > 0 ? gainMeters : null,
    lossMeters: measuredSegments > 0 ? lossMeters : null,
    maxGrade: steepestGrade(runs),
    highestPoint,
    lowestPoint,
    elevation,
  };
}
