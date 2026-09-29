/**
 * How much of a known road a route actually rides (M3, OGV-D-264).
 *
 * The curvy-road catalogue and the Gravel Atlas describe roads as lines. A
 * route "rides" a road for the metres of that line lying within
 * `toleranceMeters` of the route. Matching is geometric, not by name: two
 * roads can share a name and one road can change name.
 *
 * The route is indexed once in an equirectangular grid (~cell-size squares),
 * so each probe checks only the route segments near it. Distances use a local
 * flat projection, which is accurate to well under a metre at these scales.
 */

import type { Coordinate } from "@/domain/ride/types";

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEFAULT_TOLERANCE_METERS = 35;

interface Projected {
  readonly x: number;
  readonly y: number;
}

export interface RouteIndex {
  readonly probe: (point: Coordinate) => number;
  readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
}

/** Builds a reusable index; probe returns the metres from a point to the route. */
export function indexRoute(route: readonly Coordinate[], cellMeters = 200): RouteIndex {
  const origin = route[0] ?? { lon: 0, lat: 0 };
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const project = (point: Coordinate): Projected => ({
    x: ((point.lon - origin.lon) * Math.PI * EARTH_RADIUS_METERS * cosLat) / 180,
    y: ((point.lat - origin.lat) * Math.PI * EARTH_RADIUS_METERS) / 180,
  });
  const points = route.map(project);
  const cells = new Map<string, number[]>();
  const key = (cx: number, cy: number): string => `${cx}:${cy}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!;
    const b = points[index + 1]!;
    const minX = Math.floor(Math.min(a.x, b.x) / cellMeters);
    const maxX = Math.floor(Math.max(a.x, b.x) / cellMeters);
    const minY = Math.floor(Math.min(a.y, b.y) / cellMeters);
    const maxY = Math.floor(Math.max(a.y, b.y) / cellMeters);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const list = cells.get(key(cx, cy));
        if (list === undefined) cells.set(key(cx, cy), [index]);
        else list.push(index);
      }
    }
  }
  const segmentDistance = (p: Projected, index: number): number => {
    const a = points[index]!;
    const b = points[index + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of route) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  return {
    bounds: { west, south, east, north },
    probe(point) {
      const p = project(point);
      const cx = Math.floor(p.x / cellMeters);
      const cy = Math.floor(p.y / cellMeters);
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const index of cells.get(key(cx + dx, cy + dy)) ?? []) {
            best = Math.min(best, segmentDistance(p, index));
          }
        }
      }
      return best;
    },
  };
}

function haversineMeters(a: Coordinate, b: Coordinate): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LineOverlap {
  /** Metres of the line within tolerance of the route. */
  readonly riddenMeters: number;
  readonly lineMeters: number;
}

/**
 * Metres of `line` that lie along the route: each line step counts when both
 * of its ends are within tolerance (a road crossed at a junction rides ~0 m).
 */
export function lineOverlap(
  index: RouteIndex,
  line: readonly Coordinate[],
  toleranceMeters = DEFAULT_TOLERANCE_METERS,
): LineOverlap {
  let riddenMeters = 0;
  let lineMeters = 0;
  let previousNear = line.length > 0 ? index.probe(line[0]!) <= toleranceMeters : false;
  for (let step = 1; step < line.length; step += 1) {
    const from = line[step - 1]!;
    const to = line[step]!;
    const meters = haversineMeters(from, to);
    lineMeters += meters;
    const near = index.probe(to) <= toleranceMeters;
    if (near && previousNear) riddenMeters += meters;
    previousNear = near;
  }
  return { riddenMeters, lineMeters };
}
