/**
 * Sketch snapping geometry (04 §19, 06 §18; OGV-D-285).
 *
 * A long free-hand sketch used to reach the engine as 20 evenly spaced via
 * points, and its drawn line was dropped from the request above 256 points, so a
 * 60-mile drawing gave the router one hint every three miles and the router
 * went its own way between them. This module holds the pure geometry that
 * replaces that: everything here is deterministic, framework-free and cheap
 * enough to run on every plan.
 *
 * - {@link resampleSketchCorridor} fits the drawn line to the wire budget by
 *   Douglas–Peucker at a growing tolerance, so the shape survives at any length
 *   instead of being dropped.
 * - {@link shapeAwareSketchAnchors} places via points by shape: one in the
 *   middle of every run between two significant bends (a hand cuts corners, so
 *   the bend vertex itself is the least reliable place to snap), topped up so no
 *   gap is longer than {@link SKETCH_ANCHOR_MAX_SPACING_METERS}.
 * - {@link sketchCorridorBand} buffers the line into the band a router is told
 *   to stay inside, and {@link chunkSketchWaypoints} / {@link stitchSketchLines}
 *   split a long via list into engine-sized requests and join the answers.
 * - {@link reviewSketchLeg}, {@link sketchStraySections} and
 *   {@link routeShareNearLine} measure the answer against the drawing, so a
 *   stray section is repaired once and, when it cannot be, reported honestly.
 *
 * Map matching (`/match`) was measured and rejected for latency: 8–54 s for one
 * 1,000-point stroke per lane on the self-hosted engine, against a budget of a
 * couple of seconds (DECISIONS OGV-D-285).
 */

import {
  haversine,
  pointToSegmentDistanceMeters,
} from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/**
 * Half-width of the band the router is asked to stay inside, in meters.
 *
 * Wide enough for a finger's error at the zoom a day ride is drawn at (±45 m of
 * wobble plus a cut corner), narrow enough that a parallel road one block over
 * sits outside it. Measured on a long synthetic fixture: 80 m followed the
 * drawn road for 97% of the route, 150 m for 95%.
 */
export const SKETCH_CORRIDOR_BAND_METERS = 80;

/**
 * The priority factor for roads outside the band.
 *
 * A penalty, never a zero: a drawn section with no road under it must still
 * route around, and the adherence review then says so. At 0.1 a road outside
 * the band has to be ten times shorter than the drawn one before the router
 * prefers it.
 */
export const SKETCH_OUTSIDE_BAND_PRIORITY = 0.1;

/** The most band segments one request carries; a longer line is simplified. */
export const SKETCH_BAND_MAX_SEGMENTS = 600;

/** Douglas–Peucker tolerance that separates a significant bend from wobble. */
export const SKETCH_ANCHOR_BEND_TOLERANCE_METERS = 150;

/** The longest gap between two anchors on a straight, in meters (~1.5 mi). */
export const SKETCH_ANCHOR_MAX_SPACING_METERS = 2_400;

/**
 * The shortest gap between two anchors, in meters (~0.5 mi).
 *
 * Denser anchors made the route worse, not better, in every measurement: a
 * noisy anchor every few hundred meters snaps onto side roads and forces
 * out-and-back spurs, while the band already holds the route to the drawn road
 * between anchors.
 */
export const SKETCH_ANCHOR_MIN_SPACING_METERS = 800;

/** How far either side of an anchor its drawn heading is measured over. */
export const SKETCH_HEADING_WINDOW_METERS = 100;

/** Route distance from the drawing at which a stretch counts as strayed. */
export const SKETCH_STRAY_TOLERANCE_METERS = 150;

/** The shortest strayed stretch worth repairing or telling the rider about. */
export const SKETCH_STRAY_MIN_LENGTH_METERS = 400;

/** One via point derived from the drawing, with the direction it was drawn in. */
export interface SketchAnchor {
  readonly at: Coordinate;
  /** Compass bearing the stroke was drawn in here, or `null` at an endpoint. */
  readonly heading: number | null;
  /** Distance along the corridor, in meters. */
  readonly alongMeters: number;
}

function copy(point: Coordinate): Coordinate {
  return { lon: point.lon, lat: point.lat };
}

function usable(point: Coordinate | undefined): point is Coordinate {
  return (
    point !== undefined &&
    Number.isFinite(point.lon) &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lon) <= 180 &&
    Math.abs(point.lat) <= 90
  );
}

/** Cumulative along-line distance at each vertex. */
export function cumulativeMeters(line: readonly Coordinate[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let index = 0; index < line.length; index += 1) {
    const previous = line[index - 1];
    const current = line[index];
    if (previous !== undefined && current !== undefined) total += haversine(previous, current);
    out.push(total);
  }
  return out;
}

/** The position `along` meters into a line, clamped to its ends. */
export function pointAlong(
  line: readonly Coordinate[],
  cumulative: readonly number[],
  along: number,
): Coordinate {
  const first = line[0];
  if (first === undefined) throw new RangeError("pointAlong needs a line");
  if (along <= 0) return copy(first);
  let low = 0;
  let high = cumulative.length - 1;
  if (along >= (cumulative[high] ?? 0)) return copy(line[high] ?? first);
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((cumulative[middle] ?? 0) <= along) low = middle;
    else high = middle;
  }
  const start = line[low] ?? first;
  const end = line[high] ?? start;
  const span = (cumulative[high] ?? 0) - (cumulative[low] ?? 0);
  const ratio = span <= 0 ? 0 : (along - (cumulative[low] ?? 0)) / span;
  return {
    lon: start.lon + (end.lon - start.lon) * ratio,
    lat: start.lat + (end.lat - start.lat) * ratio,
  };
}

/** Initial compass bearing from one position to another, 0–360°. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const radians = Math.PI / 180;
  const fromLat = from.lat * radians;
  const toLat = to.lat * radians;
  const deltaLon = (to.lon - from.lon) * radians;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) / radians) % 360 + 360) % 360;
}

/**
 * Each vertex projected to local meters (x scaled by the cosine of its own
 * latitude), so the Douglas–Peucker inner loop is arithmetic, not trigonometry.
 * The distortion over a day ride's few degrees of latitude is a few percent of
 * a tolerance, far inside what simplification needs.
 */
function projectMeters(line: readonly Coordinate[]): Float64Array {
  const xy = new Float64Array(line.length * 2);
  line.forEach((point, index) => {
    xy[index * 2] = point.lon * METERS_PER_DEGREE * Math.cos((point.lat * Math.PI) / 180);
    xy[index * 2 + 1] = point.lat * METERS_PER_DEGREE;
  });
  return xy;
}

/** Planar distance from vertex `p` to the segment between vertices `a` and `b`. */
function segmentDistance(xy: Float64Array, p: number, a: number, b: number): number {
  const ax = xy[a * 2] as number;
  const ay = xy[a * 2 + 1] as number;
  const dx = (xy[b * 2] as number) - ax;
  const dy = (xy[b * 2 + 1] as number) - ay;
  const px = (xy[p * 2] as number) - ax;
  const py = (xy[p * 2 + 1] as number) - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSq));
  return Math.hypot(px - t * dx, py - t * dy);
}

/**
 * Every vertex's Douglas–Peucker importance: the tolerance below which it is
 * kept, capped by the vertex that split its range so a child never outranks
 * its parent. Ends are infinitely important. One pass answers every tolerance,
 * iteratively, so a 5,000-point stroke cannot overflow the stack.
 */
function douglasPeuckerImportance(line: readonly Coordinate[]): Float64Array {
  const importance = new Float64Array(line.length).fill(0);
  if (line.length === 0) return importance;
  importance[0] = Number.POSITIVE_INFINITY;
  importance[line.length - 1] = Number.POSITIVE_INFINITY;
  const xy = projectMeters(line);
  const pending: [number, number, number][] = [[0, line.length - 1, Number.POSITIVE_INFINITY]];
  while (pending.length > 0) {
    const range = pending.pop();
    if (range === undefined) break;
    const [start, end, cap] = range;
    if (end <= start + 1) continue;
    let farthest = start + 1;
    let distance = -1;
    for (let index = start + 1; index < end; index += 1) {
      const d = segmentDistance(xy, index, start, end);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    const rank = Math.min(distance, cap);
    importance[farthest] = rank;
    pending.push([start, farthest, rank], [farthest, end, rank]);
  }
  return importance;
}

/**
 * Douglas–Peucker that answers with the kept **indices**: every vertex whose
 * importance exceeds the tolerance, ends included.
 */
export function simplifyIndices(
  line: readonly Coordinate[],
  toleranceMeters: number,
): number[] {
  if (line.length <= 2) return line.map((_point, index) => index);
  const importance = douglasPeuckerImportance(line);
  const kept: number[] = [];
  importance.forEach((rank, index) => {
    if (rank > toleranceMeters) kept.push(index);
  });
  return kept;
}

/**
 * Fits a corridor to at most `maxPoints` positions, keeping its shape (06 §18).
 *
 * The most important vertices survive: exactly what Douglas–Peucker would keep
 * at the smallest tolerance that fits the budget, found in one pass rather than
 * by re-running it. A short sketch travels untouched and a 300-mile one loses
 * only its least significant wobble. Both ends are always kept.
 */
export function resampleSketchCorridor(
  corridor: readonly Coordinate[],
  maxPoints: number,
): Coordinate[] {
  const clean = corridor.filter(usable);
  const limit = Math.max(2, Math.trunc(maxPoints));
  if (clean.length <= limit) return clean.map(copy);
  const importance = douglasPeuckerImportance(clean);
  const ranked = Array.from(importance.keys()).sort(
    (a, b) => (importance[b] as number) - (importance[a] as number) || a - b,
  );
  return ranked
    .slice(0, limit)
    .sort((a, b) => a - b)
    .map((index) => copy(clean[index] as Coordinate));
}

/** The drawn heading at `along`, measured over ± the heading window. */
function headingAt(
  line: readonly Coordinate[],
  cumulative: readonly number[],
  along: number,
): number | null {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const before = pointAlong(line, cumulative, Math.max(0, along - SKETCH_HEADING_WINDOW_METERS));
  const after = pointAlong(line, cumulative, Math.min(total, along + SKETCH_HEADING_WINDOW_METERS));
  if (haversine(before, after) < 10) return null;
  return Math.round(bearingDegrees(before, after));
}

export interface ShapeAwareAnchorOptions {
  readonly maxAnchors: number;
  readonly bendToleranceMeters?: number;
  readonly maxSpacingMeters?: number;
  readonly minSpacingMeters?: number;
}

/** Keeps positions at least `spacing` apart, walking from the start. */
function thinAlongs(alongs: readonly number[], total: number, spacing: number): number[] {
  const kept: number[] = [];
  let last = 0;
  for (const along of alongs) {
    if (along - last < spacing || total - along < spacing) continue;
    kept.push(along);
    last = along;
  }
  return kept;
}

/**
 * Via points placed by the drawing's shape (06 §18, OGV-D-285).
 *
 * Dense where the stroke twists, sparse on straights: one anchor in the middle
 * of each run between significant bends, topped up so no gap exceeds the max
 * spacing, thinned so none is closer than the min spacing, and — when that is
 * still more than the budget — thinned evenly to fit it. The first and last
 * anchors are exactly the drawing's own ends; every interior anchor carries the
 * heading the rider drew there, so the router snaps it to a road running that
 * way instead of a side street.
 */
export function shapeAwareSketchAnchors(
  corridor: readonly Coordinate[],
  options: ShapeAwareAnchorOptions,
): SketchAnchor[] {
  const line = corridor.filter(usable);
  const first = line[0];
  const last = line[line.length - 1];
  if (first === undefined || last === undefined) return [];
  const cumulative = cumulativeMeters(line);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const ends: SketchAnchor[] = [
    { at: copy(first), heading: null, alongMeters: 0 },
    { at: copy(last), heading: null, alongMeters: total },
  ];
  if (line.length < 2 || total <= 0) return line.length < 2 ? ends.slice(0, 1) : ends;

  const maxAnchors = Math.max(2, Math.trunc(options.maxAnchors));
  const bendTolerance = options.bendToleranceMeters ?? SKETCH_ANCHOR_BEND_TOLERANCE_METERS;
  const maxSpacing = options.maxSpacingMeters ?? SKETCH_ANCHOR_MAX_SPACING_METERS;
  const minSpacing = options.minSpacingMeters ?? SKETCH_ANCHOR_MIN_SPACING_METERS;

  const bends = simplifyIndices(line, bendTolerance).map((index) => cumulative[index] ?? 0);
  const candidates: number[] = [];
  for (let index = 1; index < bends.length; index += 1) {
    candidates.push(((bends[index - 1] ?? 0) + (bends[index] ?? 0)) / 2);
  }
  // Top up long gaps (a long straight) so the router is never left guessing.
  const stops = [0, ...candidates, total];
  const filled: number[] = [];
  for (let index = 1; index < stops.length; index += 1) {
    const from = stops[index - 1] ?? 0;
    const to = stops[index] ?? total;
    const pieces = Math.ceil((to - from) / maxSpacing);
    for (let piece = 1; piece < pieces; piece += 1) filled.push(from + ((to - from) * piece) / pieces);
    if (index < stops.length - 1) filled.push(to);
  }
  let interior = thinAlongs(filled, total, minSpacing);
  if (interior.length > maxAnchors - 2) {
    interior = thinAlongs(filled, total, total / (maxAnchors - 1));
    while (interior.length > maxAnchors - 2) {
      // Rounding can leave one too many; drop evenly until it fits.
      interior = interior.filter((_along, index) => index % 2 === 0);
    }
  }
  return [
    ends[0] as SketchAnchor,
    ...interior.map((along) => ({
      at: pointAlong(line, cumulative, along),
      heading: headingAt(line, cumulative, along),
      alongMeters: along,
    })),
    ends[1] as SketchAnchor,
  ];
}

/**
 * A spatial index over a line's segments, so "how far is this point from the
 * drawing" costs a few segment checks instead of the whole line.
 */
export interface LineIndex {
  /**
   * Distance to the nearest segment and the along-line distance there. With
   * `minAlongMeters`, only the line from that distance on is considered — how
   * an ordered list of points is located on a line that passes the same place
   * twice (a crossing, an out-and-back) without jumping to the other pass.
   */
  nearest(
    point: Coordinate,
    minAlongMeters?: number,
  ): { readonly distanceMeters: number; readonly alongMeters: number };
}

const INDEX_CELL_METERS = 400;
const METERS_PER_DEGREE = 111_320;

export function createLineIndex(line: readonly Coordinate[]): LineIndex {
  const points = line.filter(usable);
  const cumulative = cumulativeMeters(points);
  const first = points[0];
  const cosLat = Math.cos(((first?.lat ?? 0) * Math.PI) / 180) || 1;
  const cellLat = INDEX_CELL_METERS / METERS_PER_DEGREE;
  const cellLon = cellLat / cosLat;
  // A longitude cell is narrowest (in meters) at the line's highest latitude;
  // the early exit below must use that width to stay exact.
  const highestLat = points.reduce((max, point) => Math.max(max, Math.abs(point.lat)), 0);
  const narrowest = Math.min(1, (Math.cos((highestLat * Math.PI) / 180) || 0) / cosLat);
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number): string => `${x}:${y}`;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Coordinate;
    const b = points[index] as Coordinate;
    const x0 = Math.floor(Math.min(a.lon, b.lon) / cellLon);
    const x1 = Math.floor(Math.max(a.lon, b.lon) / cellLon);
    const y0 = Math.floor(Math.min(a.lat, b.lat) / cellLat);
    const y1 = Math.floor(Math.max(a.lat, b.lat) / cellLat);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const bucket = cells.get(key(x, y));
        if (bucket === undefined) cells.set(key(x, y), [index]);
        else bucket.push(index);
      }
    }
  }

  const measure = (point: Coordinate, index: number, minAlong: number) => {
    const a = points[index - 1] as Coordinate;
    const b = points[index] as Coordinate;
    const distance = pointToSegmentDistanceMeters(point, a, b);
    const toA = haversine(a, point);
    const segment = (cumulative[index] ?? 0) - (cumulative[index - 1] ?? 0);
    const offset = Math.min(segment, Math.sqrt(Math.max(0, toA * toA - distance * distance)));
    return {
      distanceMeters: distance,
      alongMeters: Math.max(minAlong, (cumulative[index - 1] ?? 0) + offset),
    };
  };

  return {
    nearest(point, minAlongMeters = Number.NEGATIVE_INFINITY) {
      const eligible = (index: number): boolean => (cumulative[index] ?? 0) >= minAlongMeters;
      if (points.length === 1 && first !== undefined) {
        return { distanceMeters: haversine(point, first), alongMeters: 0 };
      }
      const cx = Math.floor(point.lon / cellLon);
      const cy = Math.floor(point.lat / cellLat);
      let best = { distanceMeters: Number.POSITIVE_INFINITY, alongMeters: 0 };
      const seen = new Set<number>();
      // Widen ring by ring; once a hit is closer than the next ring can be, stop.
      for (let ring = 0; ring <= 8; ring += 1) {
        for (let x = cx - ring; x <= cx + ring; x += 1) {
          for (let y = cy - ring; y <= cy + ring; y += 1) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
            for (const index of cells.get(key(x, y)) ?? []) {
              if (seen.has(index) || !eligible(index)) continue;
              seen.add(index);
              const hit = measure(point, index, minAlongMeters);
              if (hit.distanceMeters < best.distanceMeters) best = hit;
            }
          }
        }
        if (best.distanceMeters <= ring * INDEX_CELL_METERS * narrowest) return best;
      }
      for (let index = 1; index < points.length; index += 1) {
        if (!eligible(index)) continue;
        const hit = measure(point, index, minAlongMeters);
        if (hit.distanceMeters < best.distanceMeters) best = hit;
      }
      return best;
    },
  };
}

/**
 * Locates an ordered list of points on a line, each at or after the previous
 * one. Anchors are in drawing order, and a drawing can pass the same place
 * twice; plain nearest-point projection would put such an anchor on the other
 * pass and give it that pass's direction — a reversed heading that forces the
 * router into a loop to approach it "correctly".
 */
export function locateInOrder(
  line: readonly Coordinate[],
  points: readonly Coordinate[],
): { readonly distanceMeters: number; readonly alongMeters: number }[] {
  const index = createLineIndex(line);
  let floor = Number.NEGATIVE_INFINITY;
  return points.map((point) => {
    const hit = index.nearest(point, floor);
    // A point far off the drawing (an authored endpoint the sketch does not
    // reach) says nothing about progress along it.
    if (hit.distanceMeters <= SKETCH_STRAY_TOLERANCE_METERS) floor = hit.alongMeters;
    return hit;
  });
}

/**
 * The drawn heading at each anchor, in drawing order: the anchors are located
 * on the corridor in order ({@link locateInOrder}) and the bearing measured
 * over ± the heading window there. `null` where the corridor has no direction
 * (a dot, or an anchor off the drawing).
 */
export function sketchAnchorHeadings(
  corridor: readonly Coordinate[],
  anchors: readonly Coordinate[],
): (number | null)[] {
  const line = corridor.filter(usable);
  if (line.length < 2) return anchors.map(() => null);
  const cumulative = cumulativeMeters(line);
  return locateInOrder(line, anchors).map((hit) =>
    hit.distanceMeters > SKETCH_STRAY_TOLERANCE_METERS
      ? null
      : headingAt(line, cumulative, hit.alongMeters),
  );
}

/** The stretch of a line between two along-line distances, clamped to its ends. */
export function sliceLineByAlong(
  line: readonly Coordinate[],
  fromMeters: number,
  toMeters: number,
): Coordinate[] {
  const clean = line.filter(usable);
  if (clean.length < 2) return clean.map(copy);
  const cumulative = cumulativeMeters(clean);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const from = Math.max(0, Math.min(total, fromMeters));
  const to = Math.max(from, Math.min(total, toMeters));
  const out: Coordinate[] = [pointAlong(clean, cumulative, from)];
  for (let index = 0; index < clean.length; index += 1) {
    const along = cumulative[index] ?? 0;
    if (along > from && along < to) out.push(copy(clean[index] as Coordinate));
  }
  out.push(pointAlong(clean, cumulative, to));
  return out;
}

/** Samples a line every `stepMeters`, ends included. */
export function sampleLine(line: readonly Coordinate[], stepMeters: number): Coordinate[] {
  const clean = line.filter(usable);
  if (clean.length < 2) return clean.map(copy);
  const cumulative = cumulativeMeters(clean);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const count = Math.max(1, Math.ceil(total / Math.max(1, stepMeters)));
  return Array.from({ length: count + 1 }, (_value, index) =>
    pointAlong(clean, cumulative, (total * index) / count),
  );
}

/**
 * The share (0..1) of a route's length that runs within `toleranceMeters` of a
 * line — "how much of what the rider will ride is on what they drew".
 */
export function routeShareNearLine(
  route: readonly Coordinate[],
  line: readonly Coordinate[],
  toleranceMeters: number,
  stepMeters = 20,
): number {
  const samples = sampleLine(route, stepMeters);
  if (samples.length === 0 || line.length === 0) return 0;
  const index = createLineIndex(line);
  let near = 0;
  for (const sample of samples) {
    if (index.nearest(sample).distanceMeters <= toleranceMeters) near += 1;
  }
  return near / samples.length;
}

/** One stretch of the drawing the route does not follow. */
export interface SketchStraySection {
  readonly fromAlongMeters: number;
  readonly toAlongMeters: number;
  readonly lengthMeters: number;
  /** The drawn position farthest from the route in this stretch. */
  readonly farthest: Coordinate;
  readonly farthestDistanceMeters: number;
}

/**
 * The stretches of the drawing that the route stays more than `tolerance` away
 * from, each at least `minLength` long (06 §18 "show significant deviation").
 */
export function sketchStraySections(
  route: readonly Coordinate[],
  corridor: readonly Coordinate[],
  options: { readonly toleranceMeters?: number; readonly minLengthMeters?: number; readonly stepMeters?: number } = {},
): SketchStraySection[] {
  const tolerance = options.toleranceMeters ?? SKETCH_STRAY_TOLERANCE_METERS;
  const minLength = options.minLengthMeters ?? SKETCH_STRAY_MIN_LENGTH_METERS;
  const step = options.stepMeters ?? 25;
  const line = corridor.filter(usable);
  if (line.length < 2 || route.length < 2) return [];
  const cumulative = cumulativeMeters(line);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const index = createLineIndex(route);
  const sections: SketchStraySection[] = [];
  let open: { from: number; farthest: Coordinate; distance: number } | null = null;
  const close = (to: number): void => {
    if (open !== null && to - open.from >= minLength) {
      sections.push({
        fromAlongMeters: open.from,
        toAlongMeters: to,
        lengthMeters: to - open.from,
        farthest: open.farthest,
        farthestDistanceMeters: Math.round(open.distance),
      });
    }
    open = null;
  };
  const count = Math.max(1, Math.ceil(total / step));
  for (let sample = 0; sample <= count; sample += 1) {
    const along = (total * sample) / count;
    const at = pointAlong(line, cumulative, along);
    const distance = index.nearest(at).distanceMeters;
    if (distance > tolerance) {
      if (open === null) open = { from: along, farthest: at, distance };
      else if (distance > open.distance) {
        open.farthest = at;
        open.distance = distance;
      }
    } else {
      close(along);
    }
  }
  close(total);
  return sections;
}

/**
 * The band a router is asked to stay inside: one rectangle per segment of the
 * (simplified) drawing, each extended by the half-width at both ends so the
 * joins overlap. Separate rectangles rather than one outline, because the
 * outline of a twisty line crosses itself and a self-intersecting polygon is
 * not a valid area for the engine.
 */
export function sketchCorridorBand(
  corridor: readonly Coordinate[],
  halfWidthMeters: number = SKETCH_CORRIDOR_BAND_METERS,
  maxSegments: number = SKETCH_BAND_MAX_SEGMENTS,
): Coordinate[][] {
  const line = resampleSketchCorridor(corridor, maxSegments + 1);
  const rings: Coordinate[][] = [];
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1] as Coordinate;
    const b = line[index] as Coordinate;
    const cosLat = Math.cos((a.lat * Math.PI) / 180) || 1;
    const dx = (b.lon - a.lon) * cosLat;
    const dy = b.lat - a.lat;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const scale = halfWidthMeters / METERS_PER_DEGREE;
    const ux = dx / length;
    const uy = dy / length;
    const px = (-uy * scale) / cosLat;
    const py = ux * scale;
    const ex = (ux * scale) / cosLat;
    const ey = uy * scale;
    const round = (value: number): number => Math.round(value * 1e6) / 1e6;
    const corner = (lon: number, lat: number): Coordinate => ({ lon: round(lon), lat: round(lat) });
    const start = corner(a.lon - ex + px, a.lat - ey + py);
    rings.push([
      start,
      corner(b.lon + ex + px, b.lat + ey + py),
      corner(b.lon + ex - px, b.lat + ey - py),
      corner(a.lon - ex - px, a.lat - ey - py),
      start,
    ]);
  }
  return rings;
}

/**
 * Splits an ordered waypoint list into engine-sized requests that share their
 * joins: the last waypoint of one chunk is the first of the next, so the
 * stitched route passes through every waypoint exactly once and no chunk
 * starts somewhere the previous one did not finish.
 */
export function chunkSketchWaypoints<T>(
  waypoints: readonly T[],
  maxPointsPerRequest: number,
): T[][] {
  const size = Math.max(2, Math.trunc(maxPointsPerRequest));
  if (waypoints.length <= size) return [waypoints.slice()];
  const chunks: T[][] = [];
  // Even chunk sizes, so the last request is not a two-point stub.
  const count = Math.ceil((waypoints.length - 1) / (size - 1));
  const legs = waypoints.length - 1;
  let start = 0;
  for (let chunk = 0; chunk < count; chunk += 1) {
    const end = Math.round((legs * (chunk + 1)) / count);
    chunks.push(waypoints.slice(start, end + 1));
    start = end;
  }
  return chunks;
}

/**
 * Joins chunk lines into one, dropping the duplicated join position. Returns
 * the joined line and, per chunk, the index its first point landed at, so a
 * consumer can re-base per-chunk indices (instructions, details).
 */
export function stitchSketchLines(
  lines: readonly (readonly Coordinate[])[],
): { readonly line: Coordinate[]; readonly offsets: number[] } {
  const line: Coordinate[] = [];
  const offsets: number[] = [];
  for (const part of lines) {
    const head = part[0];
    const tail = line[line.length - 1];
    const joins =
      head !== undefined && tail !== undefined && head.lon === tail.lon && head.lat === tail.lat;
    offsets.push(joins ? line.length - 1 : line.length);
    line.push(...(joins ? part.slice(1) : part).map(copy));
  }
  return { line, offsets };
}

/** What one routed leg between two anchors did wrong, if anything. */
export type SketchLegVerdict =
  | { readonly kind: "ok" }
  /**
   * The leg rides far more than the drawing between its anchors: an anchor
   * snapped onto the wrong carriageway of a divided road, or across a bridge
   * it cannot reach, and the router drove miles to approach it. Drop the
   * anchors at both ends and let the band hold the route.
   */
  | { readonly kind: "detour" }
  /** The route left the drawing here: add a via where it strayed farthest. */
  | { readonly kind: "stray"; readonly at: Coordinate; readonly heading: number | null; readonly alongMeters: number };

/**
 * A leg longer than this multiple of its drawn span, plus the slack below, is a
 * detour. Generous on purpose: a hand-drawn line cuts every bend, so the road
 * under it is always somewhat longer than the drawing.
 */
const DETOUR_LENGTH_FACTOR = 1.6;
const DETOUR_SLACK_METERS = 1_000;

/** How far either side of a via the route is compared with itself. */
const SPUR_PROBE_METERS = 150;
/** A route that comes back within this of where it was is doubling back. */
const SPUR_RETURN_METERS = 40;

/**
 * Whether the route doubles back through `viaIndex` — the out-and-back spur a
 * via point snapped onto a dead end produces.
 */
export function isSpurAt(route: readonly Coordinate[], viaIndex: number): boolean {
  const cumulative = cumulativeMeters(route);
  const at = cumulative[viaIndex];
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (at === undefined || at < SPUR_PROBE_METERS || total - at < SPUR_PROBE_METERS) return false;
  const before = pointAlong(route, cumulative, at - SPUR_PROBE_METERS);
  const after = pointAlong(route, cumulative, at + SPUR_PROBE_METERS);
  return haversine(before, after) <= SPUR_RETURN_METERS;
}

/**
 * Reviews one leg — the routed line between two consecutive anchors — against
 * the stretch of the drawing between them.
 */
export function reviewSketchLeg(
  leg: readonly Coordinate[],
  corridor: readonly Coordinate[],
  fromAlongMeters: number,
  toAlongMeters: number,
): SketchLegVerdict {
  const line = corridor.filter(usable);
  if (leg.length < 2 || line.length < 2 || toAlongMeters - fromAlongMeters <= 0) return { kind: "ok" };
  const legLength = cumulativeMeters(leg).at(-1) ?? 0;
  if (legLength > (toAlongMeters - fromAlongMeters) * DETOUR_LENGTH_FACTOR + DETOUR_SLACK_METERS) {
    return { kind: "detour" };
  }
  const cumulative = cumulativeMeters(line);
  const index = createLineIndex(leg);
  const span = toAlongMeters - fromAlongMeters;
  const count = Math.max(2, Math.ceil(span / 25));
  let worst: { at: Coordinate; along: number; distance: number } | null = null;
  let strayed = 0;
  for (let sample = 0; sample <= count; sample += 1) {
    const along = fromAlongMeters + (span * sample) / count;
    const at = pointAlong(line, cumulative, along);
    const distance = index.nearest(at).distanceMeters;
    if (distance > SKETCH_STRAY_TOLERANCE_METERS) strayed += span / count;
    if (worst === null || distance > worst.distance) worst = { at, along, distance };
  }
  if (worst === null || strayed < SKETCH_STRAY_MIN_LENGTH_METERS) return { kind: "ok" };
  return {
    kind: "stray",
    at: worst.at,
    heading: headingAt(line, cumulative, worst.along),
    alongMeters: worst.along,
  };
}
