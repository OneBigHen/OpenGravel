/**
 * Turning somebody else's line into a breadcrumb (07 §breadcrumb).
 *
 * A recorded GPX track can carry thousands of points. A breadcrumb route is
 * authored, so every point is a waypoint the rider can see, drag, rename or
 * follow — and a route with two thousand waypoints is not authorable. The line
 * is therefore thinned to a bounded number of waypoints with the same
 * Douglas–Peucker importance the sketch helpers use, so the shape survives and
 * the legs between waypoints are honest straight lines rather than claims about
 * the surface underneath them.
 *
 * Nothing here decides access, surface or rideability: a thinned line is a
 * shape, and the legs are straight.
 */

import { resampleSketchCorridorIndices } from "@/domain/sketch/snap";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The most waypoints a breadcrumb route built from an imported line may carry.
 *
 * Fifty is a phone-sized editing budget: a rider can scroll the list and drag
 * any point, and a 30-mile track still keeps every bend that matters. More
 * points do not make the straight legs closer to the source road, they only
 * make the route harder to work with.
 */
export const MAX_BREADCRUMB_WAYPOINTS = 50;

function usable(point: Coordinate | undefined): point is Coordinate {
  return (
    point !== undefined &&
    Number.isFinite(point.lon) &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lon) <= 180 &&
    Math.abs(point.lat) <= 90
  );
}

/**
 * The source positions kept as breadcrumb waypoints, in along-line order.
 *
 * Consecutive duplicates are dropped first (a paused recorder writes the same
 * fix many times, and a zero-length leg is not a waypoint), then the line is
 * fitted to `maxWaypoints` with Douglas–Peucker importance. The returned
 * indices address the caller's own array, so per-point names stay attached to
 * the waypoints that survived. Invalid coordinates are never kept.
 */
export function breadcrumbKeepIndices(
  line: readonly Coordinate[],
  maxWaypoints: number = MAX_BREADCRUMB_WAYPOINTS,
): number[] {
  const candidates: number[] = [];
  line.forEach((point, index) => {
    if (!usable(point)) return;
    const previous = candidates.at(-1);
    if (previous !== undefined) {
      const prior = line[previous] as Coordinate;
      if (prior.lon === point.lon && prior.lat === point.lat) return;
    }
    candidates.push(index);
  });
  const kept = resampleSketchCorridorIndices(
    candidates.map((index) => line[index] as Coordinate),
    maxWaypoints,
  );
  return kept.map((index) => candidates[index] as number);
}

/** The thinned positions themselves, for callers that carry no per-point data. */
export function thinBreadcrumbLine(
  line: readonly Coordinate[],
  maxWaypoints: number = MAX_BREADCRUMB_WAYPOINTS,
): Coordinate[] {
  return breadcrumbKeepIndices(line, maxWaypoints).map((index) => {
    const point = line[index] as Coordinate;
    return { lon: point.lon, lat: point.lat };
  });
}
