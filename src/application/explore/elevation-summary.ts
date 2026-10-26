/**
 * What a route's stored elevation profile is worth saying, in the terms a rider
 * reads: how much the ride climbs, how much it drops, and how high it gets.
 *
 * The route page used to answer this with the number of samples it held
 * ("1,204 measured points"), which told a rider nothing about the ride and
 * exposed how the profile is stored. A profile too short or too broken to
 * summarise is `null`, so the page says nothing at all rather than dressing an
 * unknown up as a value.
 *
 * Pure: the profile is provider data about the ground, never ride state.
 */

import type { ElevationPoint } from "@/application/explore/catalog";

/**
 * Climb is counted only once the line has risen this far from its last turning
 * point. Same rule as the elevation profile the planner draws
 * (`src/application/elevation/profile.ts`), so the two surfaces cannot report
 * different climb for the same line: DEM noise on a flat road never adds up to
 * phantom feet.
 */
const CLIMB_HYSTERESIS_METERS = 4;

export interface ElevationSummary {
  readonly climbMeters: number;
  readonly descentMeters: number;
  readonly highPointMeters: number;
}

/** Climb and descent with hysteresis, so noise between samples is not climbing. */
function climbAndDescent(elevations: readonly number[]): { climb: number; descent: number } {
  let climb = 0;
  let descent = 0;
  let anchor = elevations[0] ?? 0;
  for (const elevation of elevations) {
    const delta = elevation - anchor;
    if (delta >= CLIMB_HYSTERESIS_METERS) {
      climb += delta;
      anchor = elevation;
    } else if (delta <= -CLIMB_HYSTERESIS_METERS) {
      descent -= delta;
      anchor = elevation;
    }
  }
  return { climb, descent };
}

/**
 * The ride's climb, descent and highest point, or `null` when the profile
 * cannot honestly say: fewer than two samples, or a value that is not a number.
 */
export function elevationSummaryOf(
  profile: readonly ElevationPoint[] | undefined,
): ElevationSummary | null {
  if (profile === undefined || profile.length < 2) return null;
  if (!profile.every((point) => Number.isFinite(point.distanceKm) && Number.isFinite(point.elevationMeters))) {
    return null;
  }
  const elevations = profile.map((point) => point.elevationMeters);
  const { climb, descent } = climbAndDescent(elevations);
  return {
    climbMeters: climb,
    descentMeters: descent,
    highPointMeters: Math.max(...elevations),
  };
}
