/**
 * Does a route actually ride a record's road? Route-corridor matching for
 * road-authority records (§6 lane A): one spatial pass per candidate over an
 * already-fetched snapshot, never a remote call per route point (§11).
 *
 * `traverses` means the route runs along the record's line for a real
 * distance, which is the only match strong enough for a hard gate. Passing
 * near a point, or crossing a line, is at most `touches`.
 */

import { haversine, pointToSegmentDistanceMeters } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import type { BoundingBox, RoadAuthorityGeometry } from "./types";

/** A route point within this of a record's line rides that road. */
const ON_ROAD_METERS = 20;
/** A point record this close to the route is on it. */
const NEAR_POINT_METERS = 30;
/** Record lines are sampled at most this far apart. */
const SAMPLE_METERS = 25;
const CELL_DEGREES = 0.01;

export interface RouteMatch {
  readonly strength: "traverses" | "touches" | "none";
  /** Length of the record's line the route runs along. */
  readonly overlapMeters: number;
}

export interface RouteIndex {
  readonly box: BoundingBox;
  nearestMeters(point: Coordinate): number;
}

export function boundingBoxOf(points: readonly Coordinate[]): BoundingBox {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    west = Math.min(west, point.lon);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lon);
    north = Math.max(north, point.lat);
  }
  return { west, south, east, north };
}

export function boxesIntersect(left: BoundingBox, right: BoundingBox): boolean {
  return left.west <= right.east && right.west <= left.east && left.south <= right.north && right.south <= left.north;
}

/** Grows a box by about `meters` on every side. */
export function padBox(box: BoundingBox, meters: number): BoundingBox {
  const latDegrees = meters / 111_320;
  const midLat = ((box.south + box.north) / 2) * Math.PI / 180;
  const lonDegrees = meters / (111_320 * Math.max(0.2, Math.cos(midLat)));
  return {
    west: box.west - lonDegrees,
    south: box.south - latDegrees,
    east: box.east + lonDegrees,
    north: box.north + latDegrees,
  };
}

/** A grid over the route's segments, so each lookup scans only its neighborhood. */
export function indexRoute(geometry: readonly Coordinate[]): RouteIndex {
  const cells = new Map<string, Array<readonly [Coordinate, Coordinate]>>();
  for (let index = 1; index < geometry.length; index += 1) {
    const start = geometry[index - 1]!;
    const end = geometry[index]!;
    const box = boundingBoxOf([start, end]);
    for (let x = Math.floor(box.west / CELL_DEGREES); x <= Math.floor(box.east / CELL_DEGREES); x += 1) {
      for (let y = Math.floor(box.south / CELL_DEGREES); y <= Math.floor(box.north / CELL_DEGREES); y += 1) {
        const key = `${x}:${y}`;
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [[start, end]]);
        else list.push([start, end]);
      }
    }
  }
  const single = geometry.length === 1 ? geometry[0] : undefined;
  return {
    box: boundingBoxOf(geometry),
    nearestMeters(point) {
      if (single !== undefined) return haversine(point, single);
      let best = Number.POSITIVE_INFINITY;
      const x = Math.floor(point.lon / CELL_DEGREES);
      const y = Math.floor(point.lat / CELL_DEGREES);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const [start, end] of cells.get(`${x + dx}:${y + dy}`) ?? []) {
            best = Math.min(best, pointToSegmentDistanceMeters(point, start, end));
          }
        }
      }
      return best;
    },
  };
}

/** The record's line as evenly spaced samples, each standing for its share of length. */
function samples(line: readonly Coordinate[]): { readonly points: Coordinate[]; readonly lengthMeters: number } {
  const points: Coordinate[] = [];
  let lengthMeters = 0;
  if (line.length > 0) points.push(line[0]!);
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1]!;
    const end = line[index]!;
    const meters = haversine(start, end);
    lengthMeters += meters;
    const steps = Math.max(1, Math.ceil(meters / SAMPLE_METERS));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      points.push({ lon: start.lon + (end.lon - start.lon) * t, lat: start.lat + (end.lat - start.lat) * t });
    }
  }
  return { points, lengthMeters };
}

export function matchRecord(route: RouteIndex, geometry: RoadAuthorityGeometry): RouteMatch {
  if (geometry.type === "point") {
    const near = route.nearestMeters(geometry.coordinate) <= NEAR_POINT_METERS;
    return { strength: near ? "touches" : "none", overlapMeters: 0 };
  }
  if (geometry.coordinates.length < 2) return { strength: "none", overlapMeters: 0 };
  if (!boxesIntersect(padBox(boundingBoxOf(geometry.coordinates), ON_ROAD_METERS), route.box)) {
    return { strength: "none", overlapMeters: 0 };
  }
  const { points, lengthMeters } = samples(geometry.coordinates);
  const each = points.length <= 1 ? 0 : lengthMeters / (points.length - 1);
  let onRoad = 0;
  for (const point of points) {
    if (route.nearestMeters(point) <= ON_ROAD_METERS) onRoad += 1;
  }
  if (onRoad === 0) return { strength: "none", overlapMeters: 0 };
  const overlapMeters = Math.max(0, onRoad - 1) * each;
  // Riding along it for a real distance, not crossing it at a junction.
  const needed = Math.max(40, Math.min(150, lengthMeters * 0.6));
  return { strength: overlapMeters >= needed ? "traverses" : "touches", overlapMeters };
}
