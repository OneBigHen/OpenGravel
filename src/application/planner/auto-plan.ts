/**
 * When the planner plans by itself (04-PLANNER-AND-WORKSPACE-UX §8, §21).
 *
 * A rider who has said where they are going has already answered the question the
 * commitment button asks, so the planner asks the router itself: the pick that
 * completes a ride starts an attempt, through the very command `Create ride` runs.
 * This module is that whole rule, and it is pure — the decision can be read and
 * tested without a workspace, a store or a timer. The hook that applies it
 * (`usePlannerAutoPlan`) owns the one side effect: calling the plan command.
 *
 * ## One endpoint at a time is a pick
 *
 * A pick fills or replaces exactly one end of the ride. Both ends changing at once
 * is a swap, or an undo that restores a cleared ride: those are edits to a ride
 * that already has an answer, and the answer lifecycle's own settle window replans
 * them once the rider stops changing things (04 §21). Planning a half-swapped pair
 * here would spend an attempt on a question the rider never asked.
 *
 * ## What never triggers
 *
 * - **A loop.** Its shape and ride time are the rider's to accept, so it keeps a
 *   single `Make my loop` tap.
 * - **A restore.** The hook has no baseline until the draft store has finished
 *   loading, so a reload is not an authoring act: nothing here plans on page load.
 * - **Typing.** A query in a search field is not a ride revision; only a chosen
 *   place is, and this rule only ever reads the document.
 * - **A ride that is still incomplete.** There is nothing to ask for until every
 *   point planning requires exists, and the composer already says which one is
 *   missing.
 */

import type { RideIntent } from "@/domain/ride/types";

/**
 * One endpoint as the rule compares it: its identity and its place, or `null`.
 *
 * The point's id is part of the key because "a new start here" and "the same start
 * moved here" are both a pick, and a swap moves an existing pair of ids to the
 * other end of the ride — which is exactly the difference the rule needs.
 */
export type AutoPlanEndpointKey = string | null;

/** What the trigger compares: the two ends, the ride's shape, whether it is whole. */
export interface AutoPlanSnapshot {
  readonly start: AutoPlanEndpointKey;
  readonly finish: AutoPlanEndpointKey;
  readonly shape: RideIntent["shape"];
  /** True when the ride holds every point planning requires. */
  readonly plannable: boolean;
}

/** Why the planner is planning without a press. */
export type AutoPlanTrigger = "endpoint-picked";

/** The key of an endpoint, or `null` when that end is empty. */
export function autoPlanEndpointKey(
  point: {
    readonly id: string;
    readonly coordinate: { readonly lat: number; readonly lon: number };
  } | null,
): AutoPlanEndpointKey {
  if (point === null) return null;
  return `${point.id}@${point.coordinate.lat},${point.coordinate.lon}`;
}

/** The comparable snapshot of one ride, as the hook builds it each revision. */
export function autoPlanSnapshot(input: {
  readonly start: Parameters<typeof autoPlanEndpointKey>[0];
  readonly finish: Parameters<typeof autoPlanEndpointKey>[0];
  readonly shape: RideIntent["shape"];
  readonly plannable: boolean;
}): AutoPlanSnapshot {
  return {
    start: autoPlanEndpointKey(input.start),
    finish: autoPlanEndpointKey(input.finish),
    shape: input.shape,
    plannable: input.plannable,
  };
}

/**
 * The trigger for the change from `previous` to `current`, or `null`.
 *
 * `previous === null` is the first observation (mount, or the moment a restored
 * draft finishes loading) and never triggers: a page load is not a pick.
 */
export function autoPlanTrigger(
  previous: AutoPlanSnapshot | null,
  current: AutoPlanSnapshot,
): AutoPlanTrigger | null {
  if (previous === null) return null;
  if (current.shape === "loop") return null;
  if (!current.plannable) return null;
  const startChanged = current.start !== previous.start;
  const finishChanged = current.finish !== previous.finish;
  // Both ends changed (a swap, or an undo restoring both) is not a pick.
  if (startChanged === finishChanged) return null;
  return "endpoint-picked";
}
