/**
 * The polygon draft (04-PLANNER-AND-WORKSPACE-UX §18, 03 §19).
 *
 * A polygon is authored by taps: each tap adds a vertex, a second tap in the same
 * place (a double-click) closes the ring, Enter closes it from the keyboard,
 * Backspace removes the last vertex, and Escape cancels the whole draft — nothing
 * is written and no partial area is left behind.
 *
 * It is pure so the lifecycle is testable without a pointer: the workspace keeps
 * the draft and the timestamp of the previous tap, feeds them in, and acts on the
 * answer. Nothing here writes geometry or dispatches a command.
 *
 * ## Why a double-click is a *place*, not just a time
 *
 * Two taps inside {@link POLYGON_DOUBLE_TAP_MS} that are also within
 * {@link POLYGON_DOUBLE_TAP_METERS} of each other are one double-click; two taps
 * in different places are two vertices even when the rider is fast. A
 * time-only rule would close a rider's polygon because they tapped twice quickly,
 * which is a way to lose authored work.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** Two taps inside this window may be a double-click. */
export const POLYGON_DOUBLE_TAP_MS = 400;

/** …and only when they land within this distance of each other. */
export const POLYGON_DOUBLE_TAP_METERS = 30;

/** How many distinct vertices a closable polygon needs. */
export const MIN_POLYGON_VERTICES = 3;

/** The previous tap, as the double-click test needs it. */
export interface PolygonTap {
  readonly coordinate: Coordinate;
  readonly at: number;
}

/** What one tap on the map means for the draft. */
export type PolygonTapOutcome =
  | {
      /** A new vertex was added. */
      readonly kind: "vertex";
      readonly vertices: readonly Coordinate[];
      readonly lastTap: PolygonTap;
    }
  | {
      /** The tap closed the draft; the duplicate tap is not a vertex. */
      readonly kind: "close";
      readonly vertices: readonly Coordinate[];
    }
  | {
      /** A close was attempted but the draft cannot form an area yet. */
      readonly kind: "too-few";
      readonly vertices: readonly Coordinate[];
      readonly message: string;
    };

/**
 * One tap, folded into the draft.
 *
 * A tap that is not a double-click appends its coordinate. A double-click does
 * **not** append: the second tap is the rider saying "close it", so storing it
 * would add a duplicate vertex the validator would then reject for being in the
 * same place as its neighbour.
 */
export function applyPolygonTap(
  vertices: readonly Coordinate[],
  coordinate: Coordinate,
  previousTap: PolygonTap | null,
  at: number,
): PolygonTapOutcome {
  const isDoubleTap =
    previousTap !== null &&
    at - previousTap.at <= POLYGON_DOUBLE_TAP_MS &&
    haversine(coordinate, previousTap.coordinate) <= POLYGON_DOUBLE_TAP_METERS;

  if (!isDoubleTap) {
    const next = [...vertices, { lon: coordinate.lon, lat: coordinate.lat }];
    return { kind: "vertex", vertices: next, lastTap: { coordinate: { ...coordinate }, at } };
  }

  const closed = closePolygonDraft(vertices);
  return closed.ring === null
    ? { kind: "too-few", vertices, message: closed.message }
    : { kind: "close", vertices };
}

/** The closing ring of a draft, or the reason it cannot close yet. */
export function closePolygonDraft(
  vertices: readonly Coordinate[],
): { readonly ring: readonly Coordinate[] } | { readonly ring: null; readonly message: string } {
  if (vertices.length < MIN_POLYGON_VERTICES) {
    return {
      ring: null,
      message: `A polygon needs at least ${MIN_POLYGON_VERTICES} corners. Tap the map to add more.`,
    };
  }
  const first = vertices[0];
  if (first === undefined) {
    return { ring: null, message: "A polygon needs at least three corners." };
  }
  return { ring: [...vertices.map(copy), copy(first)] };
}

/**
 * The draft as a closed ring **for preview only**: while the rider is drafting,
 * the shape on screen is the polygon they would get if they closed it now. The
 * preview is not the commit — the commit re-validates the ring — and a two-vertex
 * draft is shown as the closed sliver it is, which is exactly the feedback that
 * says "keep tapping".
 */
export function draftPreviewRing(
  vertices: readonly Coordinate[],
): readonly Coordinate[] | null {
  if (vertices.length < 2) return null;
  const first = vertices[0];
  if (first === undefined) return null;
  return [...vertices.map(copy), copy(first)];
}

/** Drop the last vertex; an empty draft stays empty. */
export function popPolygonVertex(
  vertices: readonly Coordinate[],
): readonly Coordinate[] {
  return vertices.length === 0 ? vertices : vertices.slice(0, -1);
}

function copy(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}
