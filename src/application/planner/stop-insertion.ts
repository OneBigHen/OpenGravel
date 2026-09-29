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
