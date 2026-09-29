/**
 * Turns a discovery query into a few bounded circles (the owner's rule: never
 * one provider call per polyline point). A corridor becomes at most
 * `MAX_SAMPLES` circles whose radius covers the buffer; a very long route is
 * sampled evenly and says so (`partial`).
 */

import { haversine, pointToSegmentDistanceMeters } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import type { DiscoverQuery, DiscoverSearchArea } from "./types";

export const MAX_SAMPLES = 12;
/** MediaWiki geosearch's own ceiling; circles never exceed it. */
export const MAX_SAMPLE_RADIUS_METERS = 10_000;
export const MAX_CORRIDOR_BUFFER_METERS = 8_000;

function pointAlong(line: readonly Coordinate[], targetMeters: number): Coordinate {
  let walked = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1]!;
    const end = line[index]!;
    const meters = haversine(start, end);
    if (walked + meters >= targetMeters && meters > 0) {
      const t = (targetMeters - walked) / meters;
      return { lon: start.lon + (end.lon - start.lon) * t, lat: start.lat + (end.lat - start.lat) * t };
    }
    walked += meters;
  }
  return line.at(-1)!;
}

export function lineLengthMeters(line: readonly Coordinate[]): number {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) meters += haversine(line[index - 1]!, line[index]!);
  return meters;
}

export function searchAreaFor(query: DiscoverQuery): DiscoverSearchArea & { readonly partial: boolean } {
  if (query.kind !== "corridor") {
    return {
      samples: [{ center: query.center, radiusMeters: Math.min(query.radiusMeters, MAX_SAMPLE_RADIUS_METERS) }],
      partial: query.radiusMeters > MAX_SAMPLE_RADIUS_METERS,
    };
  }
  const buffer = Math.min(Math.max(query.bufferMeters, 200), MAX_CORRIDOR_BUFFER_METERS);
  const radius = Math.min(MAX_SAMPLE_RADIUS_METERS, Math.max(buffer * 1.25, 2_000));
  // Circles this far apart still cover the whole buffer width between them.
  const spacing = 2 * Math.sqrt(Math.max(radius * radius - buffer * buffer, 1));
  const length = lineLengthMeters(query.line);
  const needed = Math.max(1, Math.ceil(length / spacing) + 1);
  const count = Math.min(needed, MAX_SAMPLES);
  const samples = Array.from({ length: count }, (_, index) => ({
    center: pointAlong(query.line, count === 1 ? length / 2 : (length * index) / (count - 1)),
    radiusMeters: radius,
  }));
  return { samples, partial: needed > MAX_SAMPLES };
}

/** Shortest distance from a point to the line, in metres. */
export function distanceToLineMeters(point: Coordinate, line: readonly Coordinate[]): number {
  if (line.length === 1) return haversine(point, line[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, line[index - 1]!, line[index]!));
  }
  return best;
}

/** At most `max` points, evenly thinned, ends kept: bounds per-place distance work. */
export function thinLine(line: readonly Coordinate[], max = 500): readonly Coordinate[] {
  if (line.length <= max) return line;
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => line[Math.round(index * step)]!);
}
