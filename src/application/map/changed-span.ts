/**
 * The changed-span computation and the route delta (05-MAP-INTERACTION-AND-
 * CARTOGRAPHY §12, 04-PLANNER-AND-WORKSPACE-UX §21).
 *
 * After a successful update, the rider has to be able to answer one question from
 * the map alone: *what did my edit actually change?* 05 §12 answers it with two
 * derived facts — the section of the new route that diverges from the old one, and
 * the distance/time difference between them — and it is explicit that the whole
 * route must not be re-animated to say so.
 *
 * ## Why a positional proximity walk
 *
 * The two lines have no shared vertices by construction (a provider answers a new
 * request), so nothing structural links them. Walking both from each end and
 * treating "within {@link SAME_PATH_METERS}" as "still the same road" is the
 * smallest rule that gets the rider's intent right:
 *
 * - a detour in the middle leaves a shared head and tail, and the emphasis lands
 *   on the detour;
 * - a re-ordered ride shares neither end, and the honest answer is the whole new
 *   line rather than a claim that only the ends moved;
 * - drift below the tolerance (a re-snapped vertex, a provider's own rounding) is
 *   the same road, so it produces no highlight at all.
 *
 * The walk is deliberately *positional*: index `i` of the new line is compared with
 * index `i` of the old one. A length-changing edit therefore reports the changed
 * range rather than silently re-aligning onto vertices it never travelled.
 *
 * ## What is deliberately not here
 *
 * Nothing in this module reads a scene, a session or a store: it is a pure
 * function of two lines, so the emphasis can be unit-tested without a renderer and
 * the workspace stays the only place that decides *when* the rider sees it (a
 * bounded interval, cleared by the next interaction — 05 §12).
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/**
 * How far a vertex may sit from its counterpart and still count as the same road.
 *
 * 15 m is a lane's width: a re-snapped vertex, a provider's rounding and a
 * re-routed approach inside one junction all stay under it, while a real edit —
 * moving a stop, avoiding a section, drawing a detour — is orders of magnitude
 * larger. This is the whole tolerance the §12 rule needs; there is deliberately no
 * second, per-route threshold.
 */
export const SAME_PATH_METERS = 15;

/**
 * How long the changed-span emphasis stays up, in milliseconds (05 §12).
 *
 * 05 §12's "bounded interval" has to be long enough to read and short enough not to
 * become part of the map. Twelve seconds covers "the route updated, look at what
 * moved" without surviving into the rider's next decision; the emphasis is also
 * cleared by the rider's next interaction, so the interval is an upper bound rather
 * than a minimum display time.
 */
export const CHANGED_SPAN_WINDOW_MS = 12_000;

/** The divergent section of the **next** route, as a fraction of its own length. */
export interface ChangedSpan {
  /** The next route's divergent section, in its own travel order. */
  readonly geometry: readonly Coordinate[];
  /** Where the section starts, as a fraction of the next route (`0`–`1`). */
  readonly fromFraction: number;
  /** Where the section ends, as a fraction of the next route (`0`–`1`). */
  readonly toFraction: number;
}

/** The two numbers a route's own summary exposes (04 §11). */
export interface RouteMetrics {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

/** How much longer (or shorter) the update made the ride. */
export interface RouteDelta {
  /** Whole minutes added; negative when the update is quicker. */
  readonly addedMinutes: number;
  /** Meters added; negative when the update is shorter. */
  readonly addedMeters: number;
}

/** How many leading vertices the two lines share, by index. */
function sharedPrefixLength(
  previous: readonly Coordinate[],
  next: readonly Coordinate[],
): number {
  const bound = Math.min(previous.length, next.length);
  let index = 0;
  while (index < bound) {
    const before = previous[index];
    const after = next[index];
    if (before === undefined || after === undefined) break;
    if (haversine(before, after) > SAME_PATH_METERS) break;
    index += 1;
  }
  return index;
}

/**
 * How many trailing vertices the two lines share, by index, never reaching back
 * into the shared prefix (a line cannot share one vertex from both ends).
 */
function sharedSuffixLength(
  previous: readonly Coordinate[],
  next: readonly Coordinate[],
  bound: number,
): number {
  let count = 0;
  while (count < bound) {
    const before = previous[previous.length - 1 - count];
    const after = next[next.length - 1 - count];
    if (before === undefined || after === undefined) break;
    if (haversine(before, after) > SAME_PATH_METERS) break;
    count += 1;
  }
  return count;
}

/**
 * The section of `next` that materially differs from `previous`, or `null` when
 * there is nothing to show.
 *
 * `null` covers three cases on purpose, and the rider-facing meaning is the same
 * in all of them — *this update did not move the line*: the two routes are the same
 * within {@link SAME_PATH_METERS}, the new route only draws a sub-path of the old
 * one, or either line has too few vertices to be a line (and therefore to be
 * walked).
 */
export function computeChangedSpan(
  previous: readonly Coordinate[],
  next: readonly Coordinate[],
): ChangedSpan | null {
  if (previous.length < 2 || next.length < 2) return null;
  const prefix = sharedPrefixLength(previous, next);
  if (prefix >= next.length) return null;
  const suffix = sharedSuffixLength(
    previous,
    next,
    Math.min(previous.length, next.length) - prefix,
  );
  const end = next.length - suffix;
  if (prefix >= end) return null;
  const geometry = next.slice(prefix, end);
  // A one-vertex divergence is a point, not a section: the renderer draws lines,
  // and a dashed highlight around a single vertex would claim a stretch of road
  // that never changed.
  if (geometry.length < 2) return null;
  const last = next.length - 1;
  return {
    geometry,
    fromFraction: prefix / last,
    toFraction: (end - 1) / last,
  };
}

/**
 * The signed difference between two answers, in the units the product states
 * elsewhere: whole minutes and meters (04 §11).
 *
 * Both numbers are signed, because "the update is quicker" is as much a fact as
 * "the update is longer", and a rider comparing two answers needs to see which.
 */
export function routeDelta(previous: RouteMetrics, next: RouteMetrics): RouteDelta {
  return {
    addedMinutes: Math.round((next.durationSeconds - previous.durationSeconds) / 60),
    addedMeters: Math.round(next.distanceMeters - previous.distanceMeters),
  };
}
