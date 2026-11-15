/**
 * Great roads along a ride that is already planned (L6).
 *
 * The national library is a catalogue of rides, each with a known start. With a
 * line on the map, the useful question is not "what is near me" but "what is
 * near the road I am about to ride". A ride counts when its start is within
 * `ALONG_ROUTE_MAX_METERS` of the planned line; that is the plan's own rule and
 * the only distance this module claims. It never looks at an unlocated record,
 * never invents a start, and never treats a nearby ride as being on the route.
 *
 * Pure data in, pure data out: the UI decides how a ride is worded, and the map
 * draws only rides whose own line was fetched for their state.
 */

import { thinLine } from "@/application/discover/search-area";
import { projectAlong } from "@/application/map-layers/along";
import type { Coordinate } from "@/domain/ride/types";

import { hasLine } from "./client";
import type { IndexRow } from "./types";

/** The plan's "on my way" reach: a ride starting within 15 mi of the line. */
export const ALONG_ROUTE_MAX_METERS = 15 * 1609.344;

/** At most this many rides are offered: three is a choice, not a second list. */
export const ALONG_ROUTE_LIMIT = 3;

/** How many points of the planned line the distance check walks. */
const MAX_ROUTE_POINTS = 600;

const METERS_PER_DEGREE_LAT = 110_540;

export interface AlongRouteRide {
  readonly row: IndexRow;
  /** How far the ride's stated start is from the planned line. */
  readonly offRouteMeters: number;
  /** How far along the planned line the nearest point sits. */
  readonly alongRouteMeters: number;
  /** That point as a mile marker from the route's start; `null` for a dot of a line. */
  readonly routeMile: number | null;
}

export interface AlongRouteOptions {
  readonly maxMeters?: number;
  readonly limit?: number;
  /**
   * The ride the line itself came from, when the planner knows it: a library
   * ride is not a discovery beside its own route.
   */
  readonly excludeIds?: ReadonlySet<string>;
}

function lineBox(line: readonly Coordinate[], meters: number): {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
} {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of line) {
    west = Math.min(west, point.lon);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lon);
    north = Math.max(north, point.lat);
  }
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const dLat = meters / METERS_PER_DEGREE_LAT;
  const dLon = meters / (111_320 * Math.max(0.01, Math.cos(midLat)));
  return { west: west - dLon, south: south - dLat, east: east + dLon, north: north + dLat };
}

/**
 * The library rides whose stated start is within reach of the planned line,
 * best first. A ride with no place is left out: "near" is not a guess.
 */
export function ridesAlongRoute(
  rows: readonly IndexRow[],
  line: readonly Coordinate[],
  options: AlongRouteOptions = {},
): readonly AlongRouteRide[] {
  if (line.length < 2) return [];
  const maxMeters = options.maxMeters ?? ALONG_ROUTE_MAX_METERS;
  if (!(maxMeters > 0)) return [];
  const limit = Math.max(0, options.limit ?? ALONG_ROUTE_LIMIT);
  if (limit === 0) return [];

  // A long planned line is walked at a bounded resolution: 600 points keep the
  // corridor answer well inside the 15 mi reach without spending a phone's time
  // on every library row.
  const sampled = thinLine(line, MAX_ROUTE_POINTS);
  const route = sampled.map((point) => [point.lon, point.lat] as const);
  const box = lineBox(sampled, maxMeters);
  const hits: AlongRouteRide[] = [];

  for (const row of rows) {
    if (row.p === null || options.excludeIds?.has(row.id) === true) continue;
    const [lat, lon] = row.p;
    if (lat < box.south || lat > box.north || lon < box.west || lon > box.east) continue;
    const placed = projectAlong(route, [lon, lat]);
    if (!Number.isFinite(placed.offMeters) || placed.offMeters > maxMeters) continue;
    hits.push({
      row,
      offRouteMeters: placed.offMeters,
      alongRouteMeters: placed.alongMeters,
      routeMile: placed.alongMeters / 1609.344,
    });
  }

  hits.sort((left, right) =>
    right.row.q - left.row.q
    || Number(hasLine(right.row)) - Number(hasLine(left.row))
    || left.offRouteMeters - right.offRouteMeters
    || left.row.n.localeCompare(right.row.n)
    || left.row.id.localeCompare(right.row.id));
  return hits.slice(0, limit);
}
