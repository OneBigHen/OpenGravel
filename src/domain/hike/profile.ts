/**
 * Line + elevations → a cumulative DEM profile, and the length it measures.
 *
 * The profile is the one place elevations are aligned with line vertices. A
 * `null` elevation stays `null`: callers can skip that segment, but they can
 * never turn a gap into sea level. A length mismatch between the line and the
 * elevation array is a data error and throws, because silently pairing point 4
 * with the elevation of point 5 would invent a climb.
 */

import { haversine } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";
import { validateCoordinate } from "../ride/validate";
import type { HikeProfile, HikeProfilePoint } from "./types";

function elevationAt(
  elevations: readonly (number | null)[],
  index: number,
): number | null {
  const elevation = elevations[index];
  // A sparse array reads as undefined; the type says number | null, so treat it
  // as an absent elevation rather than a zero.
  if (elevation === undefined || elevation === null) return null;
  if (!Number.isFinite(elevation)) {
    throw new TypeError(
      `elevation ${index} must be a finite number of meters or null; received ${String(elevation)}`,
    );
  }
  return elevation;
}

/**
 * Walks the line in order and accumulates great-circle distance, so every
 * profile point knows how far along the walk it is. Coordinates are validated
 * first: a malformed latitude would otherwise poison every later distance.
 */
export function buildHikeProfile(
  line: readonly Coordinate[],
  elevations: readonly (number | null)[],
): HikeProfile {
  if (elevations.length !== line.length) {
    throw new TypeError(
      `elevations must align with the line: ${elevations.length} elevations for ${line.length} coordinates`,
    );
  }

  const points: HikeProfilePoint[] = [];
  let distanceMeters = 0;
  let previous: Coordinate | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const coordinate = line[index];
    if (coordinate === undefined) continue;
    const issues = validateCoordinate(coordinate);
    if (issues.length > 0) {
      throw new TypeError(`hike line point ${index}: ${issues[0] ?? "invalid coordinate"}`);
    }
    if (previous !== null) distanceMeters += haversine(previous, coordinate);
    points.push({
      distanceMeters,
      elevationMeters: elevationAt(elevations, index),
    });
    previous = coordinate;
  }
  return points;
}

/** Great-circle length of a line in meters; malformed coordinates give NaN. */
export function lineLengthMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1];
    const to = line[index];
    if (from === undefined || to === undefined) continue;
    total += haversine(from, to);
  }
  return total;
}

/** Last along-line distance in a profile; 0 for an empty profile. */
export function profileLengthMeters(profile: HikeProfile): number {
  let lengthMeters = 0;
  for (const point of profile) {
    if (Number.isFinite(point.distanceMeters) && point.distanceMeters > lengthMeters) {
      lengthMeters = point.distanceMeters;
    }
  }
  return lengthMeters;
}
