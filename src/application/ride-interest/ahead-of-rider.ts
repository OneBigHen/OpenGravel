/**
 * Corridor filtering and ahead-of-rider selection (OGV#13): which prefetched
 * points are close enough to the line to matter, and how far ahead of the
 * rider's current position each one is right now.
 *
 * Pure and network-free: prefetching happens once per route
 * (`ride-interest-overlay.ts`); this runs again on every position tick with
 * no network call, which is what keeps the map from hammering a provider
 * while the rider rides.
 */

import { METERS_PER_MILE, projectAlong } from "@/application/map-layers/along";
import type { LngLat } from "@/application/map-layers/types";
import type { Coordinate } from "@/domain/ride/types";

import type { RideInterestPoint } from "./types";

export interface AheadRideInterestPoint {
  readonly point: RideInterestPoint;
  /** Distance from the rider's position to the point's spot on the line, in miles. Never negative. */
  readonly aheadMiles: number;
  /** How far the point sits off the route line, in miles. */
  readonly offRouteMiles: number;
}

export interface AheadOptions {
  /** Corridor half-width either side of the line (owner's proposal: 1–2 mi). */
  readonly corridorMiles?: number;
  /** Points further ahead than this are prefetched but not "ahead" yet. */
  readonly maxAheadMiles?: number;
  /** A point this close behind the rider still counts as "just here", not passed. */
  readonly behindToleranceMiles?: number;
}

const DEFAULT_CORRIDOR_MILES = 1.5;
const DEFAULT_MAX_AHEAD_MILES = 20;
const DEFAULT_BEHIND_TOLERANCE_MILES = 0.05;

function toLine(line: readonly Coordinate[]): readonly LngLat[] {
  return line.map((point) => [point.lon, point.lat] as const);
}

/**
 * The prefetched points that are both inside the corridor and ahead of (or
 * just at) the rider's position, nearest first. A point the rider already
 * passed — more than `behindToleranceMiles` behind — drops out, the same way
 * a satnav stops mentioning a turn once it is taken.
 */
export function pointsAheadOfRider(
  points: readonly RideInterestPoint[],
  routeLine: readonly Coordinate[],
  position: Coordinate,
  options: AheadOptions = {},
): readonly AheadRideInterestPoint[] {
  if (routeLine.length < 2 || points.length === 0) return [];
  const corridorMeters = (options.corridorMiles ?? DEFAULT_CORRIDOR_MILES) * METERS_PER_MILE;
  const maxAheadMeters = (options.maxAheadMiles ?? DEFAULT_MAX_AHEAD_MILES) * METERS_PER_MILE;
  const behindMeters = (options.behindToleranceMiles ?? DEFAULT_BEHIND_TOLERANCE_MILES) * METERS_PER_MILE;
  const line = toLine(routeLine);
  const here = projectAlong(line, [position.lon, position.lat]).alongMeters;

  const results: AheadRideInterestPoint[] = [];
  for (const point of points) {
    const projected = projectAlong(line, [point.coordinate.lon, point.coordinate.lat]);
    if (projected.offMeters > corridorMeters) continue;
    const aheadMeters = projected.alongMeters - here;
    if (aheadMeters < -behindMeters || aheadMeters > maxAheadMeters) continue;
    results.push({
      point,
      aheadMiles: Math.max(0, aheadMeters) / METERS_PER_MILE,
      offRouteMiles: projected.offMeters / METERS_PER_MILE,
    });
  }
  return results.sort((a, b) => a.aheadMiles - b.aheadMiles || a.point.id.localeCompare(b.point.id));
}
