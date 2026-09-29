/**
 * The drag preview's snap rule (04-PLANNER-AND-WORKSPACE-UX §15, 05 §7).
 *
 * 04 §15 asks a point drag for a "ghost marker, snap preview". A snap needs a
 * *thing to snap to*, and the honest candidate set this wave can offer is the set
 * of authored objects already in the ride: the endpoints, the stops and the
 * anchors the rider can see. There is deliberately no road-graph snap here —
 * village/road snapping belongs to the surface-confidence work, and inventing a
 * projection onto a road we cannot name would be a fabricated promise.
 *
 * The rule is pure and deterministic:
 *
 * - the nearest candidate **strictly** inside the tolerance wins, ties going to
 *   the earlier candidate in the caller's order (which is document order), so the
 *   same gesture always produces the same preview;
 * - outside the tolerance the pointer's own coordinate is kept, which is what
 *   makes "snap" a preview aid rather than a hidden magnet.
 *
 * Whatever this returns is also what the committed command carries: the ghost the
 * rider saw is the position that gets authored.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/**
 * How close a dragged point must be to an authored object to snap onto it, in
 * meters. 150 m is roughly the width of a fingertip's aim error at the planning
 * zooms this slice fits (a fitted fixture ride spans a few kilometres), so it
 * helps without ever moving a point the rider aimed at deliberately.
 */
export const SNAP_TOLERANCE_METERS = 150;

/** One thing the preview may snap to. */
export interface SnapCandidate {
  /** Stable identity of the authored object (never its array position). */
  readonly id: string;
  readonly coordinate: Coordinate;
}

export interface SnapResult {
  /** Where the preview (and the committed command) goes. */
  readonly coordinate: Coordinate;
  /** The object the preview attached to, or `null` for a free position. */
  readonly snappedToId: string | null;
}

/**
 * Snaps `coordinate` onto the nearest authored candidate inside the tolerance.
 * Returns the pointer's own coordinate when nothing is close enough.
 */
export function snapPreviewCoordinate(
  coordinate: Coordinate,
  candidates: readonly SnapCandidate[],
  toleranceMeters: number = SNAP_TOLERANCE_METERS,
): SnapResult {
  let best: SnapCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = haversine(coordinate, candidate.coordinate);
    if (!Number.isFinite(distance)) continue;
    if (distance > toleranceMeters) continue;
    // Strictly closer, so a tie keeps the earlier (document-order) candidate.
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === null) return { coordinate, snappedToId: null };
  return { coordinate: best.coordinate, snappedToId: best.id };
}
