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
 * how to smooth it before building the profile.
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
 * A grade over a shorter run than this is dominated by the DEM's vertical
 * accuracy, so it is not offered as the trail's max grade. Gain and loss still
 * count the segment.
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
  let maxGrade: HikeGrade | null = null;
  let highestPoint: HikeElevationPoint | null = null;
  let lowestPoint: HikeElevationPoint | null = null;
  let previous: HikeProfilePoint | null = null;

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
          if (runMeters >= MIN_GRADE_RUN_METERS) {
            const percent = (riseMeters / runMeters) * 100;
            if (maxGrade === null || Math.abs(percent) > Math.abs(maxGrade.percent)) {
              maxGrade = {
                percent,
                direction: percent >= 0 ? "up" : "down",
                runMeters,
                atMeters: previous.distanceMeters,
              };
            }
          }
        } else {
          // Never bridge an elevation gap: an unknown segment adds neither
          // gain nor loss and is reported as unmeasured.
          unmeasuredSegments += 1;
        }
      }
    }

    previous = point;
  }

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
    maxGrade,
    highestPoint,
    lowestPoint,
    elevation,
  };
}
