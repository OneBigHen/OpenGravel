/**
 * The road-span selection draft (04-PLANNER-AND-WORKSPACE-UX §17,
 * 05-MAP-INTERACTION-AND-CARTOGRAPHY §20; 03-DOMAIN-MODEL §12).
 *
 * Selecting a road span is a **pure interaction**: a tap on the route resolves to
 * the nearest route vertex, grabbing either end handle extends or shrinks the
 * range, and the draft answers the two facts a `RoadSpanConstraint` needs — the
 * snapped line in draft order and the direction that order means against the
 * route's own traversal.
 *
 * ## Why the draft is indices, and the line comes from outside
 *
 * A draft holds `startIndex`/`endIndex` into the **returned route line**, not
 * coordinates: the route can be re-fitted or redrawn under the rider, and an
 * index either still names a vertex or is out of range. Nothing here stores a
 * coordinate that the route might no longer pass through.
 *
 * ## Why draft order is the span's order
 *
 * The rider drags from one end to the other, so the draft runs *in the order they
 * authored it*. {@link spanDraftGeometry} therefore returns the slice in draft
 * order (reversed when the rider dragged backwards), and
 * {@link spanDirectionFor} declares the direction the route actually walks that
 * order: `forward` when the draft follows the route, `reverse` when it runs
 * against it, and `either` only when the route demonstrably passes the span both
 * ways — an out-and-back. That last case is **computed**, never assumed: a
 * one-way route can never claim `either`.
 *
 * Escape and a ride-revision change drop the draft; nothing here writes geometry
 * or dispatches a command.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { SpanDirection } from "@/domain/road/spans";
import type { Coordinate } from "@/domain/ride/types";

/** One in-flight span selection: a route identity plus an inclusive index range. */
export interface RoadSpanDraft {
  readonly routeId: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

/** Which end of the draft a pointer grab moves. */
export type RoadSpanHandle = "start" | "end";

function isFiniteCoordinate(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat);
}

/** The inclusive range a draft covers, in ascending route order. */
export function spanRange(draft: RoadSpanDraft): { readonly from: number; readonly to: number } {
  return draft.startIndex <= draft.endIndex
    ? { from: draft.startIndex, to: draft.endIndex }
    : { from: draft.endIndex, to: draft.startIndex };
}

/**
 * The route vertex nearest to `coordinate`, or `null` when the line has no
 * usable vertex. Ties keep the lower index, so the answer never depends on
 * iteration order beyond the line itself.
 */
export function nearestVertexIndex(
  line: readonly Coordinate[],
  coordinate: Coordinate,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  line.forEach((vertex, index) => {
    if (!isFiniteCoordinate(vertex) || !isFiniteCoordinate(coordinate)) return;
    const distance = haversine(coordinate, vertex);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/**
 * Starts a one-vertex draft at the nearest route vertex. A tap that resolves to
 * no vertex (an empty or malformed line) starts nothing rather than guessing.
 */
export function beginRoadSpanDraft(
  routeId: string,
  line: readonly Coordinate[],
  coordinate: Coordinate,
): RoadSpanDraft | null {
  const index = nearestVertexIndex(line, coordinate);
  return index === null ? null : { routeId, startIndex: index, endIndex: index };
}

/** Moves one handle to the vertex nearest the pointer, leaving the other fixed. */
export function moveSpanHandle(
  draft: RoadSpanDraft,
  line: readonly Coordinate[],
  handle: RoadSpanHandle,
  coordinate: Coordinate,
): RoadSpanDraft {
  const index = nearestVertexIndex(line, coordinate);
  if (index === null) return draft;
  return handle === "start"
    ? { ...draft, startIndex: index }
    : { ...draft, endIndex: index };
}

/**
 * The handle a press should grab: whichever end vertex of the draft is nearer the
 * press. A tie, and a draft whose ends the line cannot resolve, return `end`, so a
 * drag extends the span rather than moving the anchor the rider just placed.
 */
export function nearestHandle(
  draft: RoadSpanDraft,
  line: readonly Coordinate[],
  coordinate: Coordinate,
): RoadSpanHandle {
  const startVertex = line[draft.startIndex];
  const endVertex = line[draft.endIndex];
  if (startVertex === undefined || endVertex === undefined) return "end";
  return haversine(coordinate, startVertex) < haversine(coordinate, endVertex)
    ? "start"
    : "end";
}

/**
 * The snapped line in draft order: `startIndex → endIndex` inclusive, stepping
 * one vertex at a time. Out-of-range indices return nothing, so a stale draft can
 * never produce an invented line.
 */
export function spanDraftGeometry(
  draft: RoadSpanDraft,
  line: readonly Coordinate[],
): readonly Coordinate[] {
  const { from, to } = spanRange(draft);
  if (from < 0 || to >= line.length) return [];
  const ordered: Coordinate[] = [];
  const ascending = draft.startIndex <= draft.endIndex;
  for (let index = 0; index <= to - from; index += 1) {
    const vertex = line[ascending ? from + index : to - index];
    if (vertex === undefined) return [];
    ordered.push({ lon: vertex.lon, lat: vertex.lat });
  }
  return ordered;
}

/** The draft's entry and exit anchors, in draft order; empty when unusable. */
export function spanDraftAnchors(
  draft: RoadSpanDraft,
  line: readonly Coordinate[],
): readonly Coordinate[] {
  const geometry = spanDraftGeometry(draft, line);
  if (geometry.length < 2) return [];
  const entry = geometry[0];
  const exit = geometry[geometry.length - 1];
  if (entry === undefined || exit === undefined) return [];
  return [entry, exit];
}

/**
 * How confidently an anchor must land on a vertex to count as a traversal.
 *
 * The draft's anchors *are* route vertices, so a real traversal matches to
 * floating-point noise; ten centimetres is generous for a measured position and
 * far below any distance at which two roads are confused.
 */
const TRAVERSAL_MATCH_METERS = 0.1;

/**
 * Whether `anchors` are walked by `line` in the order given, each matched to a
 * distinct later vertex that is actually at the anchor.
 *
 * This is deliberately **not** `anchorTraversalDirection` from the domain
 * engine: that helper matches each anchor to its nearest later vertex with no
 * distance threshold, so for a two-anchor span the reversed pair almost always
 * finds *some* later vertex and the answer collapses to `both` — the opposite of
 * an honest "this route passes it both ways". The draft needs the strict form,
 * and the tolerance is what makes `both` mean an out-and-back rather than a
 * coincidence.
 */
function anchorsWalkedInOrder(
  anchors: readonly Coordinate[],
  line: readonly Coordinate[],
): boolean {
  let lastIndex = -1;
  for (const anchor of anchors) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = lastIndex + 1; index < line.length; index += 1) {
      const vertex = line[index];
      if (vertex === undefined) continue;
      const distance = haversine(anchor, vertex);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestDistance > TRAVERSAL_MATCH_METERS) return false;
    lastIndex = bestIndex;
  }
  return true;
}

/**
 * The direction the draft declaration should carry (03 §12).
 *
 * Draft order **is** the span's order, so the ordinal answer (the draft ran with
 * the route's order, or against it) is always known. `either` is reported only
 * when the route verifiably walks the two anchors both ways — an out-and-back —
 * which is computed from the line itself, never assumed: a one-way route can
 * never claim `either`.
 */
export function spanDirectionFor(
  draft: RoadSpanDraft,
  line: readonly Coordinate[],
): SpanDirection {
  const anchors = spanDraftAnchors(draft, line);
  const ordinal: SpanDirection = draft.startIndex <= draft.endIndex ? "forward" : "reverse";
  if (anchors.length < 2) return ordinal;
  const forward = anchorsWalkedInOrder(anchors, line);
  const reverse = anchorsWalkedInOrder([...anchors].reverse(), line);
  if (forward && reverse) return "either";
  if (forward) return "forward";
  if (reverse) return "reverse";
  return ordinal;
}
