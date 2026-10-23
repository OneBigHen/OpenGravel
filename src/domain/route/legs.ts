/**
 * Leg lengths along a route line (04-PLANNER-AND-WORKSPACE-UX §15).
 *
 * The itinerary list states the leg each point ends — "34 mi · ~48 min from
 * previous" — so the list reads as a ride briefing instead of a set of pins.
 * The measurement is made on the route the rider is actually looking at: the
 * selected candidate's own geometry, sliced between the ride's points in the
 * order the ride travels them.
 *
 * Three rules keep the projection honest:
 *
 * - **A point the line does not pass near is not measured.** The leg reports
 *   `off-route` rather than projecting the point onto some unrelated stretch of
 *   the line and calling the difference a distance.
 * - **Travel order, not nearest-point.** Anchors are located monotonically along
 *   the line, so a ride that passes the same place twice does not swap the two
 *   visits ({@link locate} mirrors the sketch's own ordered projection).
 * - **A leg's time is shared out, never invented.** The route measured one
 *   duration; a leg's share of it by distance is an estimate of that slice, and
 *   it is `null` when the route measured no duration at all.
 */

import { haversine } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";

/**
 * How far a point may sit off the line and still count as covered by it, in
 * meters. Wider than a lane (a point is placed by tapping a road, not a
 * centerline) and narrower than a parallel road a rider would notice.
 */
export const LEG_ON_ROUTE_TOLERANCE_METERS = 250;

/** What one point's leg costs, in the order the ride travels it. */
export type RouteLeg =
  /** The first point: nothing precedes it, so it has no leg. */
  | { readonly kind: "first" }
  | {
      readonly kind: "measured";
      /** Distance along the line from the previous point, in meters. */
      readonly distanceMeters: number;
      /** The route's own duration shared out by distance, or `null` if unknown. */
      readonly durationSeconds: number | null;
    }
  /** The line does not cover one of the leg's ends. */
  | { readonly kind: "off-route" }
  /** Nothing was measured: no line, or no totals to share out. */
  | { readonly kind: "unknown" };

/** The route's own measured totals, which a leg's time is shared out from. */
export interface RouteLegTotals {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

interface LocatedPoint {
  /** Distance along the line at the point's projection, in meters. */
  alongMeters: number;
  /** Distance from the point to its projection, in meters. */
  offsetMeters: number;
}

interface Projection {
  /** Position along the segment, `0..1`. */
  readonly t: number;
  readonly distanceMeters: number;
}

function isFiniteCoordinate(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lat) && Number.isFinite(coordinate.lon);
}

/**
 * The projection of one position onto one segment, using a local
 * equirectangular plane (the same approximation the geometry analysis uses).
 * The offset is measured on the globe, so the reported distance is not a plane
 * artifact.
 */
function projectOnSegment(point: Coordinate, start: Coordinate, end: Coordinate): Projection {
  const cosLat = Math.cos((((start.lat + end.lat) / 2) * Math.PI) / 180) || 1;
  const ax = start.lon * cosLat;
  const ay = start.lat;
  const bx = end.lon * cosLat;
  const by = end.lat;
  const px = point.lon * cosLat;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const span = dx * dx + dy * dy;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / span));
  const nearest: Coordinate = { lon: (ax + t * dx) / cosLat, lat: ay + t * dy };
  return { t, distanceMeters: haversine(nearest, point) };
}

/**
 * Cumulative length of the line at each vertex, in meters. Consecutive duplicate
 * vertices contribute nothing, which is what keeps a provider's repeated point
 * from becoming a phantom distance.
 */
function cumulativeMeters(line: readonly Coordinate[]): number[] {
  const cumulative = [0];
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    const previous = cumulative[index] ?? 0;
    cumulative.push(
      start === undefined || end === undefined ? previous : previous + haversine(start, end),
    );
  }
  return cumulative;
}

function nearestFrom(
  line: readonly Coordinate[],
  cumulative: readonly number[],
  point: Coordinate,
  floorMeters: number,
): LocatedPoint {
  let best: LocatedPoint = { alongMeters: floorMeters, offsetMeters: Number.POSITIVE_INFINITY };
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    if (start === undefined || end === undefined) continue;
    const segmentStart = cumulative[index] ?? 0;
    const segmentEnd = cumulative[index + 1] ?? segmentStart;
    if (segmentEnd < floorMeters) continue;
    const projection = projectOnSegment(point, start, end);
    if (projection.distanceMeters >= best.offsetMeters) continue;
    const along = Math.min(
      segmentEnd,
      Math.max(floorMeters, segmentStart + projection.t * (segmentEnd - segmentStart)),
    );
    best = { alongMeters: along, offsetMeters: projection.distanceMeters };
  }
  return best;
}

/**
 * Locates the points on the line in travel order. A point the line passes near
 * raises the floor for the points after it; a stray point does not, so one
 * misplaced stop cannot push every later leg onto a different stretch.
 */
function locate(
  line: readonly Coordinate[],
  cumulative: readonly number[],
  points: readonly Coordinate[],
): LocatedPoint[] {
  let floor = 0;
  return points.map((point) => {
    const located = nearestFrom(line, cumulative, point, floor);
    if (located.offsetMeters <= LEG_ON_ROUTE_TOLERANCE_METERS) {
      floor = located.alongMeters;
    }
    return located;
  });
}

function durationShare(
  distanceMeters: number,
  totals: RouteLegTotals,
): number | null {
  if (
    !Number.isFinite(totals.durationSeconds) ||
    totals.durationSeconds < 0 ||
    !Number.isFinite(totals.distanceMeters) ||
    totals.distanceMeters <= 0
  ) {
    return null;
  }
  const share = totals.durationSeconds * (distanceMeters / totals.distanceMeters);
  return Number.isFinite(share) ? share : null;
}

/**
 * One leg per point, in the order the ride travels them.
 *
 * The first entry is always `first`. Entries after it are measured from the
 * previous point when the line covers both ends, and say so when it does not.
 * The first and last points are pinned to the line's own ends when they sit on
 * it, so the legs of a route that starts and ends at the rider's points add up
 * to the route's own length.
 */
export function routeLegs(
  line: readonly Coordinate[],
  points: readonly Coordinate[],
  totals: RouteLegTotals,
): readonly RouteLeg[] {
  if (points.length === 0) return [];
  const legs: RouteLeg[] = [{ kind: "first" }];
  if (points.length === 1) return legs;

  const usableLine = line.filter(isFiniteCoordinate);
  if (usableLine.length < 2 || !points.every(isFiniteCoordinate)) {
    return points.map((_point, index) => (index === 0 ? { kind: "first" } : { kind: "unknown" }));
  }

  const cumulative = cumulativeMeters(usableLine);
  const located = locate(usableLine, cumulative, points);
  const lineLength = cumulative.at(-1) ?? 0;
  const first = located[0];
  const last = located[located.length - 1];
  if (first !== undefined && first.offsetMeters <= LEG_ON_ROUTE_TOLERANCE_METERS) {
    located[0] = { ...first, alongMeters: 0 };
  }
  if (last !== undefined && last.offsetMeters <= LEG_ON_ROUTE_TOLERANCE_METERS) {
    located[located.length - 1] = { ...last, alongMeters: lineLength };
  }

  for (let index = 1; index < located.length; index += 1) {
    const previous = located[index - 1];
    const current = located[index];
    if (previous === undefined || current === undefined) {
      legs.push({ kind: "unknown" });
      continue;
    }
    if (
      previous.offsetMeters > LEG_ON_ROUTE_TOLERANCE_METERS ||
      current.offsetMeters > LEG_ON_ROUTE_TOLERANCE_METERS
    ) {
      legs.push({ kind: "off-route" });
      continue;
    }
    const distanceMeters = Math.max(0, current.alongMeters - previous.alongMeters);
    legs.push({
      kind: "measured",
      distanceMeters,
      durationSeconds: durationShare(distanceMeters, totals),
    });
  }
  return legs;
}
