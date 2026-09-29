/**
 * Avoid-area ring geometry and validation (04-PLANNER-AND-WORKSPACE-UX §18,
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §21, 03-DOMAIN-MODEL §11).
 *
 * The rider authors avoid areas in two shapes — a dragged rectangle and a
 * clicked polygon — and then edits them (translate the whole shape, move one
 * vertex). All of that is pure geometry over `Coordinate`s, so it lives here
 * rather than in a component or a renderer: the rectangle the rider released is
 * the ring the command carries, and the ring the store rejects is rejected
 * *before* anything is written.
 *
 * ## Units
 *
 * Distances are metres and areas are square metres, converted from degrees with
 * a local equirectangular projection centred on the ring's own latitude. That is
 * exact enough for the two questions asked here (is this drag bigger than a
 * mis-tap; is this point inside that area) and it costs no dependency. Every
 * threshold in this module is a **metre** threshold, so nothing here silently
 * changes meaning with latitude.
 *
 * ## The on-edge rule (OGV-D-233)
 *
 * A required point exactly on a ring is a conflict, not a near miss: the rider
 * drew the edge *through* that point, so pretending it is outside would let the
 * plan route across a forbidden boundary. "On the edge" is therefore inside, and
 * the check is a distance comparison against `ON_EDGE_EPSILON_METERS` (1 m) so
 * float noise in a projected edge cannot flip the answer. Outside the epsilon the
 * answer is the plain ray-cast result — the epsilon is a tolerance, never a
 * tolerance *band*: two metres out is outside.
 */

import { haversine, pointToSegmentDistanceMeters } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/**
 * The smallest authored area, in square metres (~22 m × 22 m). Below this the
 * shape is a mis-tap rather than an area a rider meant to draw.
 */
export const MIN_AVOID_AREA_SQUARE_METERS = 500;

/**
 * The smallest span a **rectangle drag** may cover on either axis, in metres. A
 * drag is one gesture with two axes, and a drag that never moved on one of them
 * is not a rectangle: this is the rule that turns a straight-line gesture into a
 * refusal instead of a zero-height polygon.
 *
 * It is deliberately a rectangle-tool option rather than a rule of
 * {@link validateAvoidAreaRings}: a long thin strip (say 200 m of road) is a
 * legitimate authored area for the polygon tool, and a ring validator that
 * rejected it would be rejecting the rider's intent.
 */
export const MIN_AVOID_AREA_SPAN_METERS = 50;

/**
 * How close a vertex drag must land to a vertex handle, in metres.
 *
 * Vertex editing is its own armed mode (OGV-D-232), so this radius is the only
 * question a drag in that mode asks: 120 m is comfortably larger than a touch
 * target at the zooms the gate and the product use, and small enough that the
 * four corners of a 200 m square are still individually addressable.
 */
export const VERTEX_HANDLE_HIT_RADIUS_METERS = 120;

/** How far off a ring edge still counts as *on* the edge, in metres. */
export const ON_EDGE_EPSILON_METERS = 1;

/** Two vertices closer than this are the same vertex (a degenerate edge). */
export const MIN_VERTEX_SPACING_METERS = 1;

const METERS_PER_DEGREE_LAT = 111_320;

/** One vertex's place in a ring: the ring, the position, and where it is. */
export interface RingVertexHandle {
  readonly ringIndex: number;
  readonly vertexIndex: number;
  readonly coordinate: Coordinate;
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/** Local planar metres: `x` is east, `y` is north, both relative to `origin`. */
function project(origin: Coordinate): (coordinate: Coordinate) => { readonly x: number; readonly y: number } {
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return (coordinate) => ({
    x: (coordinate.lon - origin.lon) * metersPerDegreeLon,
    y: (coordinate.lat - origin.lat) * METERS_PER_DEGREE_LAT,
  });
}

/** The ring's first vertex, or `null` for an empty ring. */
function firstVertex(ring: readonly Coordinate[]): Coordinate | null {
  return ring.length === 0 ? null : (ring[0] ?? null);
}

/**
 * The closed ring of a rectangle drag: the two dragged corners plus the two
 * mixed pairs, ending on a repeat of the first vertex.
 *
 * Normalized, so dragging north-west or south-east produces the same ring — the
 * gesture's direction is not authored state.
 */
export function rectangleRing(
  origin: Coordinate,
  corner: Coordinate,
): readonly Coordinate[] {
  const west = Math.min(origin.lon, corner.lon);
  const east = Math.max(origin.lon, corner.lon);
  const south = Math.min(origin.lat, corner.lat);
  const north = Math.max(origin.lat, corner.lat);
  return [
    { lon: west, lat: south },
    { lon: east, lat: south },
    { lon: east, lat: north },
    { lon: west, lat: north },
    { lon: west, lat: south },
  ];
}

/** Every ring translated by `delta`. Never aliases the input coordinates. */
export function translateRings(
  rings: readonly (readonly Coordinate[])[],
  delta: Coordinate,
): readonly (readonly Coordinate[])[] {
  return rings.map((ring) =>
    ring.map((coordinate) => ({
      lon: coordinate.lon + delta.lon,
      lat: coordinate.lat + delta.lat,
    })),
  );
}

/**
 * One ring with a single vertex moved, the closing duplicate kept in step.
 *
 * An out-of-range ring or vertex index returns the rings unchanged rather than
 * throwing: the caller is a gesture whose target may have been removed by an
 * undo between press and release, and "nothing to move" is an ordinary outcome.
 */
export function moveRingVertex(
  rings: readonly (readonly Coordinate[])[],
  ringIndex: number,
  vertexIndex: number,
  coordinate: Coordinate,
): readonly (readonly Coordinate[])[] {
  const ring = rings[ringIndex];
  if (ring === undefined || vertexIndex < 0 || vertexIndex >= ring.length) return rings;
  const lastIndex = ring.length - 1;
  // The closing duplicate is index 0's twin in a well-formed ring; moving one
  // without the other would open the polygon.
  const isClosingDuplicate = vertexIndex === lastIndex;
  const movesFirst = vertexIndex === 0 || isClosingDuplicate;

  return rings.map((candidate, index) => {
    if (index !== ringIndex) return candidate;
    return candidate.map((vertex, position) => {
      if (position === vertexIndex) return copyCoordinate(coordinate);
      if (movesFirst && (position === 0 || position === lastIndex)) {
        return copyCoordinate(coordinate);
      }
      return copyCoordinate(vertex);
    });
  });
}

/**
 * The signed area of one ring in square metres, via the shoelace formula on a
 * local planar projection. The sign is dropped: orientation is not authored
 * state and a clockwise ring is a legitimate area.
 */
export function ringAreaSquareMeters(ring: readonly Coordinate[]): number {
  const origin = firstVertex(ring);
  if (origin === null || ring.length < 3) return 0;
  const toLocal = project(origin);
  let doubled = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (current === undefined || next === undefined) continue;
    const a = toLocal(current);
    const b = toLocal(next);
    doubled += a.x * b.y - b.x * a.y;
  }
  return Math.abs(doubled) / 2;
}

/** The ring's own bounding span in metres: `[east-west, north-south]`. */
export function ringSpanMeters(ring: readonly Coordinate[]): readonly [number, number] {
  const origin = firstVertex(ring);
  if (origin === null) return [0, 0];
  const toLocal = project(origin);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const coordinate of ring) {
    const local = toLocal(coordinate);
    minX = Math.min(minX, local.x);
    maxX = Math.max(maxX, local.x);
    minY = Math.min(minY, local.y);
    maxY = Math.max(maxY, local.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return [0, 0];
  return [maxX - minX, maxY - minY];
}

/** True when `coordinate` repeats the ring's first vertex. */
export function ringIsClosed(ring: readonly Coordinate[]): boolean {
  const first = firstVertex(ring);
  const last = ring.length === 0 ? null : (ring[ring.length - 1] ?? null);
  if (first === null || last === null) return false;
  return first.lon === last.lon && first.lat === last.lat;
}

/** The distinct vertices of a ring: the closing duplicate is not one. */
export function ringVertices(ring: readonly Coordinate[]): readonly Coordinate[] {
  if (ring.length === 0) return [];
  return ringIsClosed(ring) ? ring.slice(0, -1) : [...ring];
}

/**
 * Whether two open segments meet at all, endpoints included.
 *
 * Inclusive on purpose: for a ring, a vertex that lies *on* a non-adjacent edge
 * is a pinch, and a pinch is a self-intersection. Two edges that merely share an
 * endpoint are handled by the caller (adjacent edges are skipped), so this
 * function never has to guess which touch is legitimate.
 */
function segmentsIntersect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  function cross(
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ): number {
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  }
  function onSegment(
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ): boolean {
    return (
      Math.min(p.x, q.x) <= r.x &&
      r.x <= Math.max(p.x, q.x) &&
      Math.min(p.y, q.y) <= r.y &&
      r.y <= Math.max(p.y, q.y)
    );
  }

  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // Collinear and touching cases: an endpoint of one segment on the other.
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}

/**
 * True when a ring's own edges cross or touch somewhere other than at a shared
 * vertex.
 *
 * A ring that crosses itself is not an area a router can honour: the provider's
 * own polygon handling would either reject it or silently pick one lobe, and
 * "which lobe" is not a decision this product makes on the rider's behalf. So the
 * authoring path refuses it with a message instead.
 */
export function ringSelfIntersects(ring: readonly Coordinate[]): boolean {
  const vertices = ringVertices(ring);
  const count = vertices.length;
  if (count < 4) return false;

  const origin = vertices[0];
  if (origin === undefined) return false;
  const toLocal = project(origin);
  const local = vertices.map(toLocal);

  for (let first = 0; first < count; first += 1) {
    const firstStart = local[first];
    const firstEnd = local[(first + 1) % count];
    if (firstStart === undefined || firstEnd === undefined) continue;
    for (let second = first + 1; second < count; second += 1) {
      // Adjacent edges share a vertex by construction; the pair (0, count-1)
      // shares the ring's first vertex. Those touches are the ring, not a pinch.
      if (second === first + 1) continue;
      if (first === 0 && second === count - 1) continue;
      const secondStart = local[second];
      const secondEnd = local[(second + 1) % count];
      if (secondStart === undefined || secondEnd === undefined) continue;
      if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return true;
    }
  }
  return false;
}

export interface AvoidAreaRingValidationOptions {
  /**
   * The minimum span each axis must cover, in metres. Only the rectangle tool
   * passes it (see {@link MIN_AVOID_AREA_SPAN_METERS}); a polygon is measured by
   * area alone.
   */
  readonly minSpanMeters?: number;
}

/** The first reason this ring cannot be stored, or `null` when it can. */
export function validateAvoidAreaRing(
  ring: readonly Coordinate[],
  options: AvoidAreaRingValidationOptions = {},
): string | null {
  if (ring.length < 3) {
    return "An avoid area needs at least three corners.";
  }
  if (!ringIsClosed(ring)) {
    return "An avoid area ring must be closed: the last corner repeats the first.";
  }
  const vertices = ringVertices(ring);
  if (vertices.length < 3) {
    return "An avoid area needs at least three corners.";
  }
  // Duplicate consecutive vertices are a degenerate edge, not a corner. The walk
  // is over the *distinct* vertices, so the closing duplicate is never compared
  // against the vertex it repeats.
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (current === undefined || next === undefined) continue;
    if (haversine(current, next) < MIN_VERTEX_SPACING_METERS) {
      return "An avoid area cannot have two corners in the same place.";
    }
  }
  if (ringSelfIntersects(ring)) {
    return "The outline crosses itself. Draw a simple shape with no crossing edges.";
  }
  if (ringAreaSquareMeters(ring) < MIN_AVOID_AREA_SQUARE_METERS) {
    return "That area is too small to avoid. Draw a larger shape.";
  }
  const minSpan = options.minSpanMeters;
  if (minSpan !== undefined) {
    const [spanX, spanY] = ringSpanMeters(ring);
    if (spanX < minSpan || spanY < minSpan) {
      return "That area is too small to avoid. Drag a larger rectangle.";
    }
  }
  return null;
}

/** The first reason these rings cannot be stored, or `null` when they can. */
export function validateAvoidAreaRings(
  rings: readonly (readonly Coordinate[])[],
  options: AvoidAreaRingValidationOptions = {},
): string | null {
  if (rings.length === 0) return "An avoid area needs at least one ring.";
  for (const ring of rings) {
    const issue = validateAvoidAreaRing(ring, options);
    if (issue !== null) return issue;
  }
  return null;
}

/**
 * Every vertex handle of a ring: one per distinct vertex, addressed by ring and
 * vertex index, never the closing duplicate (moving it *is* moving vertex 0).
 */
export function ringVertexHandles(
  rings: readonly (readonly Coordinate[])[],
  ringIndex: number,
): readonly RingVertexHandle[] {
  const ring = rings[ringIndex];
  if (ring === undefined) return [];
  return ringVertices(ring).map((coordinate, vertexIndex) => ({
    ringIndex,
    vertexIndex,
    coordinate,
  }));
}

/** Every vertex handle of every ring, in ring order. */
export function allVertexHandles(
  rings: readonly (readonly Coordinate[])[],
): readonly RingVertexHandle[] {
  return rings.flatMap((_, ringIndex) => ringVertexHandles(rings, ringIndex));
}

/**
 * The vertex handle a grab was aimed at, or `null` when the grab is further than
 * `maxMeters` from every handle.
 *
 * Ties are resolved by the lower distance and then by ring/vertex order, so the
 * same grab always picks the same handle (03 §19 determinism).
 */
export function nearestVertexHandle(
  rings: readonly (readonly Coordinate[])[],
  coordinate: Coordinate,
  maxMeters: number = VERTEX_HANDLE_HIT_RADIUS_METERS,
): RingVertexHandle | null {
  let best: RingVertexHandle | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const handle of allVertexHandles(rings)) {
    const distance = haversine(coordinate, handle.coordinate);
    if (distance > maxMeters) continue;
    if (distance < bestDistance) {
      best = handle;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Whether `coordinate` is inside `ring` — the 04 §18 conflict question.
 *
 * On the edge counts as inside within {@link ON_EDGE_EPSILON_METERS}; beyond that
 * the plain even-odd ray cast decides. A degenerate ring (fewer than three
 * vertices) contains nothing, which is the honest answer for a shape that cannot
 * be drawn.
 */
export function pointInRing(
  coordinate: Coordinate,
  ring: readonly Coordinate[],
  epsilonMeters: number = ON_EDGE_EPSILON_METERS,
): boolean {
  const vertices = ringVertices(ring);
  if (vertices.length < 3) return false;

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (start === undefined || end === undefined) continue;
    if (pointToSegmentDistanceMeters(coordinate, start, end) <= epsilonMeters) return true;
  }

  // Even-odd ray cast on a local planar projection: a horizontal ray east from
  // the point, counting the edges it crosses.
  const origin = vertices[0];
  if (origin === undefined) return false;
  const toLocal = project(origin);
  const point = toLocal(coordinate);
  let crossings = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (start === undefined || end === undefined) continue;
    const a = toLocal(start);
    const b = toLocal(end);
    // A half-open test on `y`: an edge's upper endpoint belongs to it and its
    // lower one does not, so a vertex exactly on the ray is counted once.
    const straddles = a.y > point.y !== b.y > point.y;
    if (!straddles) continue;
    const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (x > point.x) crossings += 1;
  }
  return crossings % 2 === 1;
}

/** Whether a coordinate is inside any ring of the area. */
export function pointInRings(
  coordinate: Coordinate,
  rings: readonly (readonly Coordinate[])[],
  epsilonMeters: number = ON_EDGE_EPSILON_METERS,
): boolean {
  return rings.some((ring) => pointInRing(coordinate, ring, epsilonMeters));
}
