/**
 * What the renderer can actually draw (4.0 review, finding 10; 05 §3, §11, §21).
 *
 * A scene carries authored objects, and an authored object is not automatically a
 * drawable one: a disabled avoid area is not in force (05 §21), a handle that did
 * not resolve is an empty line (never a fabricated one), and a one-point line is
 * not a line. GeoJSON conversion has always applied those rules; the camera extent
 * did not, so a disabled area forty kilometres away could pull the opening camera
 * — or the automatic fit after a plan — away from everything the rider can see.
 *
 * Both halves now read these predicates, which is the only way the two can be
 * guaranteed to agree: "what the rider sees" and "what the camera frames" are the
 * same question asked twice, and answering it twice is how they drift apart.
 *
 * The predicates are deliberately about *drawability*, not about validity: an
 * undrawable object stays in the scene (the map says the handle did not resolve,
 * and the constraint still exists in the ride), it just does not contribute
 * geometry to the drawing or to the camera.
 */

import type { Coordinate } from "@/domain/ride/types";

import type {
  AreaScene,
  PreviewSketchScene,
  RoadSpanScene,
  RouteScene,
  SketchScene,
} from "./types";

/**
 * The smallest number of positions a drawn line needs.
 *
 * Two: MapLibre rejects a `LineString` with fewer, which is why this single
 * constant is what a route, a road span and a sketch corridor are all measured
 * against.
 */
export const MIN_DRAWABLE_LINE_POSITIONS = 2;

/** The smallest number of positions a drawn polygon ring needs. */
export const MIN_DRAWABLE_RING_POSITIONS = 3;

/** True when a line has enough positions to be drawn. */
export function isDrawableLine(geometry: readonly Coordinate[]): boolean {
  return geometry.length >= MIN_DRAWABLE_LINE_POSITIONS;
}

/** True when this route has a line to draw. */
export function isDrawableRoute(route: RouteScene): boolean {
  return isDrawableLine(route.geometry);
}

/** True when this road span has a line to draw (05 §20). */
export function isDrawableRoadSpan(span: RoadSpanScene): boolean {
  return isDrawableLine(span.geometry);
}

/**
 * True when this sketch has a corridor line to draw (05 §19).
 *
 * A type predicate, not a boolean: every caller that draws a sketch has to narrow
 * `null` away anyway, and doing it here is what keeps the `?? []` out of the
 * camera and the projection.
 */
export function isDrawableSketch(sketch: SketchScene | null): sketch is SketchScene {
  return sketch !== null && isDrawableLine(sketch.geometry);
}

/**
 * True when an in-flight sketch draft has a line to draw (04 §19, 05 §18).
 *
 * A draft is drawable when *any* stroke it accumulated is a line, or when the
 * stroke under the pointer has two positions: a finger that has not travelled yet
 * has not drawn anything, and a preview that rendered a one-position line would be
 * a dot the renderer has to invent an endpoint for.
 */
export function isDrawableSketchDraft(draft: PreviewSketchScene | null): boolean {
  if (draft === null) return false;
  if (draft.strokes.some((stroke) => isDrawableLine(stroke))) return true;
  return draft.active !== null && isDrawableLine(draft.active);
}

/**
 * The rings of an avoid area that can be drawn, or none.
 *
 * 05 §21: a disabled area is not drawn, because the plan ignores it and the map
 * must not imply it is in force. A ring with fewer than three positions is not a
 * polygon and is dropped by the same rule the GeoJSON projection uses.
 */
export function drawableAreaRings(
  area: AreaScene,
): readonly (readonly Coordinate[])[] {
  if (!area.enabled) return [];
  return area.rings.filter((ring) => ring.length >= MIN_DRAWABLE_RING_POSITIONS);
}

/** True when this avoid area has at least one drawable ring. */
export function isDrawableArea(area: AreaScene): boolean {
  return drawableAreaRings(area).length > 0;
}
