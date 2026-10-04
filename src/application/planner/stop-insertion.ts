/**
 * Stop insertion and stop ordering (04-PLANNER-AND-WORKSPACE-UX §15, §31).
 *
 * 04 §15 gives every object "reorder" and the stop list "add stop", and 03 §27
 * makes each of those exactly one history unit. Which neighbour a gesture aims at
 * is therefore a decision with a right answer, not a detail of a component's
 * render: it lives here, pure, so a list button, a keyboard path and a future
 * drag-to-reorder affordance share one rule.
 *
 * The rule speaks the reducer's own vocabulary: `stop.insert` and `stop.reorder`
 * take a **`beforeStopId`** ("put it in front of this stop"), and `undefined`
 * means "at the end". Every helper below therefore returns either a neighbour's
 * identity or `undefined` — never an index — so array position never crosses a
 * boundary (03 §1: position is not identity).
 *
 * Two deliberate properties:
 *
 * - **A stale selection degrades to append.** A selected stop that no longer
 *   exists (removed in another render, restored by an undo) cannot fail the
 *   gesture; appending is the one outcome a rider can predict without seeing the
 *   rule.
 * - **Addition follows the rider's attention.** "Add stop" inserts *after* the
 *   currently selected stop, which is the one place the rider is looking, and
 *   appends when nothing (or the last stop) is selected.
 */

import type { StopId } from "@/domain/ride/ids";
import type { StopPoint } from "@/domain/ride/types";

/**
 * The stop a new stop is inserted *before*: the one after the selected stop, or
 * `undefined` (append) when nothing is selected, the selection is stale, or the
 * selected stop is already last.
 */
export function nextStopInsertionBeforeId(
  stops: readonly StopPoint[],
  selectedStopId: StopId | null | undefined,
): StopId | undefined {
  if (selectedStopId === null || selectedStopId === undefined) return undefined;
  const index = stops.findIndex((stop) => stop.id === selectedStopId);
  if (index === -1) return undefined;
  return stops[index + 1]?.id;
}

/**
 * The anchor a "move up" aims at: the previous stop. Moving the first stop up is
 * a no-op the UI prevents anyway ({@link canMoveStopUp}), so `undefined` here
 * means "there is nothing above it".
 */
export function moveUpBeforeId(
  stops: readonly StopPoint[],
  index: number,
): StopId | undefined {
  return stops[index - 1]?.id;
}

/**
 * The anchor a "move down" aims at: the stop after the next one, or `undefined`
 * when the stop would become last (the reducer's append position).
 */
export function moveDownBeforeId(
  stops: readonly StopPoint[],
  index: number,
): StopId | undefined {
  return stops[index + 2]?.id;
}

/** True when the stop at `index` has a stop above it. */
export function canMoveStopUp(index: number): boolean {
  return index > 0;
}

/** True when the stop at `index` has a stop below it. */
export function canMoveStopDown(index: number, count: number): boolean {
  return index >= 0 && index < count - 1;
}

/**
 * Where along `line` a coordinate falls, as a fractional vertex index: the
 * nearest segment's start index plus how far along that segment the
 * coordinate projects. Plane geometry on lon/lat scaled by latitude is plenty
 * for ordering points along one ride.
 */
export function alongRoutePosition(
  line: readonly { readonly lon: number; readonly lat: number }[],
  coordinate: { readonly lon: number; readonly lat: number },
): number {
  if (line.length < 2) return 0;
  const k = Math.cos((coordinate.lat * Math.PI) / 180);
  let best = Number.POSITIVE_INFINITY;
  let at = 0;
  for (let index = 0; index < line.length - 1; index += 1) {
    const a = line[index]!;
    const b = line[index + 1]!;
    const ax = a.lon * k;
    const bx = b.lon * k;
    const px = coordinate.lon * k;
    const dx = bx - ax;
    const dy = b.lat - a.lat;
    const span = dx * dx + dy * dy;
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (coordinate.lat - a.lat) * dy) / span));
    const ex = ax + t * dx - px;
    const ey = a.lat + t * dy - coordinate.lat;
    const distance = ex * ex + ey * ey;
    if (distance < best) {
      best = distance;
      at = index + t;
    }
  }
  return at;
}

/**
 * The stop a new stop belongs in front of when it is added *on the route*
 * (a dragged route line, an "Add stop" on a place along the ride): the first
 * existing stop that comes later along the drawn line, or `undefined` (append)
 * when none does. Without this, a place at mile 3 was appended after a stop at
 * mile 40 and the ride doubled back.
 */
export function routeOrderInsertionBeforeId(
  stops: readonly StopPoint[],
  line: readonly { readonly lon: number; readonly lat: number }[],
  coordinate: { readonly lon: number; readonly lat: number },
): StopId | undefined {
  if (stops.length === 0 || line.length < 2) return undefined;
  const target = alongRoutePosition(line, coordinate);
  return stops.find((stop) => alongRoutePosition(line, stop.coordinate) > target)?.id;
}
