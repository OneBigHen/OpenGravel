import { decodeCatalogPolyline, encodeCatalogPolyline } from "@/application/explore/catalog-build";
import { haversine } from "@/domain/geometry/analysis";
import { LOOP_CLOSE_METERS } from "@/domain/sketch/types";
import type { Coordinate } from "@/domain/ride/types";

import type { LibraryBounds } from "./types";

/** Every stored line is `polyline5`: about 1.1 m, which a 5 m simplified line cannot use up. */
export const LINE_PRECISION = 5;
export const SIMPLIFY_METERS = 5;
/** The app's public-ride cap (plan section 5.1 stage 3). */
export const MAX_RIDE_POINTS = 20_000;
export const MAP_LINE_POINTS = 64;
export const CARD_LINE_POINTS = 24;
/** Bundles: how many of the longest segments reach the map, and how many points each gets. */
const BUNDLE_MAP_SEGMENTS = 24;
const BUNDLE_MAP_SEGMENT_POINTS = 16;
const METERS_PER_MILE = 1609.344;
/** "Rough": fewer than this many points per 30 miles, or a jump over 3 miles on a single track. */
export const ROUGH_POINTS_PER_30_MILES = 20;
export const ROUGH_JUMP_MILES = 3;

export function encodeLine(points: readonly Coordinate[]): string {
  return encodeCatalogPolyline(points, LINE_PRECISION);
}

export function decodeLine(encoded: string): Coordinate[] {
  return decodeCatalogPolyline(encoded, LINE_PRECISION);
}

/** Bundle segments are joined with `;` in a stored line. */
export function splitSegments(stored: string): string[] {
  return stored === "" ? [] : stored.split(";");
}

function lengthMeters(points: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversine(points[index - 1]!, points[index]!);
  return total;
}

function dropRepeats(points: readonly Coordinate[]): Coordinate[] {
  const kept: Coordinate[] = [];
  for (const point of points) {
    const previous = kept.at(-1);
    if (previous === undefined || previous.lat !== point.lat || previous.lon !== point.lon) kept.push(point);
  }
  return kept;
}

/**
 * Douglas-Peucker on a local flat projection, with an explicit stack so a
 * 100,000-point bundle cannot overflow the call stack. Returns the kept points.
 */
export function simplifyLine(points: readonly Coordinate[], toleranceMeters: number): Coordinate[] {
  const count = points.length;
  if (count <= 2) return [...points];
  const origin = points[0]!;
  const metersPerDegree = 111_319.49;
  const scaleX = metersPerDegree * Math.cos(origin.lat * Math.PI / 180);
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    xs[index] = (points[index]!.lon - origin.lon) * scaleX;
    ys[index] = (points[index]!.lat - origin.lat) * metersPerDegree;
  }
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack: number[] = [0, count - 1];
  while (stack.length > 0) {
    const high = stack.pop()!;
    const low = stack.pop()!;
    if (high - low < 2) continue;
    const dx = xs[high]! - xs[low]!;
    const dy = ys[high]! - ys[low]!;
    const squared = dx * dx + dy * dy;
    let farthest = -1;
    let farthestIndex = -1;
    for (let index = low + 1; index < high; index += 1) {
      const px = xs[index]! - xs[low]!;
      const py = ys[index]! - ys[low]!;
      const along = squared === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / squared));
      const distance = Math.hypot(px - along * dx, py - along * dy);
      if (distance > farthest) {
        farthest = distance;
        farthestIndex = index;
      }
    }
    if (farthest > toleranceMeters && farthestIndex > 0) {
      keep[farthestIndex] = 1;
      stack.push(low, farthestIndex, farthestIndex, high);
    }
  }
  const kept: Coordinate[] = [];
  for (let index = 0; index < count; index += 1) if (keep[index] === 1) kept.push(points[index]!);
  return kept;
}

/** Thins a line to at most `target` points, keeping its shape (bisection on the tolerance). */
export function reduceToCount(points: readonly Coordinate[], target: number): Coordinate[] {
  if (points.length <= target) return [...points];
  let low = 0;
  let high = 200_000;
  let best = simplifyLine(points, high);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const tolerance = (low + high) / 2;
    const candidate = simplifyLine(points, tolerance);
    if (candidate.length <= target) {
      best = candidate;
      high = tolerance;
    } else {
      low = tolerance;
    }
  }
  return best;
}

function boundsOf(points: readonly Coordinate[]): LibraryBounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of points) {
    if (point.lon < west) west = point.lon;
    if (point.lon > east) east = point.lon;
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
  }
  return { west, south, east, north };
}

export interface BuiltGeometry {
  /** Stored line: `polyline5`, bundle segments joined with `;`. */
  readonly line: string;
  readonly segmentCount: number;
  /** Points kept after simplifying (never above 20,000). */
  readonly points: number;
  /** Points in the source track before simplifying. */
  readonly rawPoints: number;
  /** Measured miles. For a bundle this is the segments added up. */
  readonly miles: number;
  readonly start: Coordinate;
  readonly end: Coordinate;
  readonly bounds: LibraryBounds;
  readonly loop: boolean;
  readonly rough: boolean;
  readonly longestJumpMiles: number;
  /** About 64 points per segment group for the state files. */
  readonly mapLine: string;
  /** 24 points for the index card. */
  readonly cardLine: string;
}

export interface GeometryOptions {
  readonly bundle: boolean;
  readonly toleranceMeters?: number;
  readonly maxPoints?: number;
}

/**
 * Stage 3 and 4's measurements from a track's raw segments. A single ride's
 * segments are joined into one line; a bundle keeps them apart. Returns `null`
 * when there is no line of two or more distinct points.
 */
export function buildGeometry(rawSegments: readonly (readonly Coordinate[])[], options: GeometryOptions): BuiltGeometry | null {
  const maxPoints = options.maxPoints ?? MAX_RIDE_POINTS;
  const startTolerance = options.toleranceMeters ?? SIMPLIFY_METERS;
  const cleaned = (options.bundle ? rawSegments.map((segment) => dropRepeats(segment)) : [dropRepeats(rawSegments.flat())]).filter((segment) => segment.length >= 2);
  if (cleaned.length === 0) return null;
  const rawPoints = cleaned.reduce((total, segment) => total + segment.length, 0);
  const meters = cleaned.reduce((total, segment) => total + lengthMeters(segment), 0);
  const miles = meters / METERS_PER_MILE;
  let longestJump = 0;
  if (!options.bundle) {
    const joined = cleaned[0]!;
    for (let index = 1; index < joined.length; index += 1) longestJump = Math.max(longestJump, haversine(joined[index - 1]!, joined[index]!));
  }
  const longestJumpMiles = longestJump / METERS_PER_MILE;

  let tolerance = startTolerance;
  let simplified = cleaned.map((segment) => simplifyLine(segment, tolerance));
  let total = simplified.reduce((sum, segment) => sum + segment.length, 0);
  for (let attempt = 0; total > maxPoints && attempt < 60; attempt += 1) {
    tolerance *= 1.5;
    simplified = cleaned.map((segment) => simplifyLine(segment, tolerance));
    total = simplified.reduce((sum, segment) => sum + segment.length, 0);
  }

  const first = simplified[0]![0]!;
  const lastSegment = simplified.at(-1)!;
  const last = lastSegment.at(-1)!;
  const all = simplified.flat();
  const longest = simplified.reduce((best, segment) => (lengthMeters(segment) > lengthMeters(best) ? segment : best), simplified[0]!);
  const loop = !options.bundle && haversine(first, last) <= LOOP_CLOSE_METERS && meters > LOOP_CLOSE_METERS * 2;
  const rough = miles > 0 && (rawPoints / (miles / 30) < ROUGH_POINTS_PER_30_MILES || longestJumpMiles > ROUGH_JUMP_MILES);

  let mapSegments: Coordinate[][];
  if (simplified.length === 1) {
    mapSegments = [reduceToCount(simplified[0]!, MAP_LINE_POINTS)];
  } else {
    mapSegments = [...simplified]
      .sort((a, b) => lengthMeters(b) - lengthMeters(a))
      .slice(0, BUNDLE_MAP_SEGMENTS)
      .map((segment) => reduceToCount(segment, BUNDLE_MAP_SEGMENT_POINTS));
  }

  return {
    line: simplified.map(encodeLine).join(";"),
    segmentCount: simplified.length,
    points: total,
    rawPoints,
    miles,
    start: first,
    end: last,
    bounds: boundsOf(all),
    loop,
    rough,
    longestJumpMiles,
    mapLine: mapSegments.map(encodeLine).join(";"),
    cardLine: encodeLine(reduceToCount(longest, CARD_LINE_POINTS)),
  };
}
