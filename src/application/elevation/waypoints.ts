/**
 * Where the rider's authored points sit along the planned line.
 *
 * The elevation chart draws a numbered notch at each authored point's distance
 * (UX rework), so the chart needs the share of the ride each point belongs to.
 * The itinerary carries coordinates, not distances, so each point is projected
 * onto the nearest segment of the planned line and expressed as a share of the
 * line's measured length. Pure and total: a point that cannot be placed is
 * never guessed onto a made-up distance.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** An authored point as the itinerary knows it: a coordinate and its own label. */
export interface ElevationWaypoint {
  readonly coordinate: Coordinate;
  /** The rider's label or the itinerary role word; never an invented name. */
  readonly label: string;
}

/** One notch on the chart: the authored order, the share and the label. */
export interface WaypointNotch {
  /** 1-based authored order: start, then the stops, then the finish. */
  readonly position: number;
  /** Where along the ride the point sits, 0–1. */
  readonly share: number;
  readonly label: string;
}

interface Segment {
  readonly start: Coordinate;
  readonly end: Coordinate;
  /** Distance from the line's start to this segment's start, in meters. */
  readonly from: number;
  readonly length: number;
}

/** Where along one segment the point projects: the fraction and the offset. */
function projectOnSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): { readonly fraction: number; readonly meters: number } {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const ax = start.lon * scale;
  const bx = end.lon * scale;
  const px = point.lon * scale;
  const dx = bx - ax;
  const dy = end.lat - start.lat;
  const squared = dx * dx + dy * dy;
  const fraction = squared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (point.lat - start.lat) * dy) / squared));
  const nearest: Coordinate = {
    lon: start.lon + (end.lon - start.lon) * fraction,
    lat: start.lat + (end.lat - start.lat) * fraction,
  };
  return { fraction, meters: haversine(point, nearest) };
}

function segmentsOf(line: readonly Coordinate[]): readonly Segment[] {
  const segments: Segment[] = [];
  let from = 0;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    if (start === undefined || end === undefined) continue;
    const length = haversine(start, end);
    segments.push({ start, end, from, length });
    from += length;
  }
  return segments;
}

/**
 * The notch for each authored point, in authored order. A point off the line
 * (an edited stop while an older answer is still on screen) is placed at the
 * nearest point of the line it is shown with, not dropped: the notch is an
 * annotation of the chart, never route truth.
 */
export function waypointNotches(
  line: readonly Coordinate[],
  waypoints: readonly ElevationWaypoint[],
): readonly WaypointNotch[] {
  if (line.length < 2 || waypoints.length === 0) return [];
  const segments = segmentsOf(line);
  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (total <= 0) return [];
  return waypoints.map((waypoint, index) => {
    // A point can sit on two stretches (a loop closes where it opens, a road is
    // ridden twice). The first authored point is where the ride starts, so it
    // keeps the earliest match; every later point advances, so a tie goes to the
    // later stretch (a loop's finish notch lands at the end, not on the start).
    const preferLater = index > 0;
    let best: { readonly meters: number; readonly distance: number } | null = null;
    for (const segment of segments) {
      const projected = projectOnSegment(waypoint.coordinate, segment.start, segment.end);
      const distance = segment.from + segment.length * projected.fraction;
      const closer = best === null || projected.meters < best.meters;
      const tieAndLater = preferLater && best !== null && projected.meters <= best.meters;
      if (closer || tieAndLater) best = { meters: projected.meters, distance };
    }
    const distance = best?.distance ?? 0;
    return {
      position: index + 1,
      share: Math.min(1, Math.max(0, distance / total)),
      label: waypoint.label,
    };
  });
}
