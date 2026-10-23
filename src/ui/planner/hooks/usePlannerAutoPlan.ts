"use client";

/**
 * Plan as soon as there is somewhere to go (04-PLANNER-AND-WORKSPACE-UX §8, §21).
 *
 * The rule itself is pure and lives in `application/planner/auto-plan.ts`; this
 * hook is the one place it is applied. It watches the ride the document already
 * holds — never a field's text — and calls the **same** command the composer's
 * commitment button calls, so an automatic plan and a pressed one can never spend
 * different attempts.
 *
 * Two things it deliberately does not do:
 *
 * - **No baseline until the draft store has settled.** A restored ride arriving
 *   from storage would otherwise look like a rider placing both ends at once, and
 *   a reload would plan by itself. The existing restore rule (which asks once, for
 *   a draft that came back without its answer) is untouched.
 * - **No timer of its own.** A style change or a swap is a revision the answer
 *   lifecycle already replans after its settle window; a pick is immediate because
 *   the rider has finished that gesture.
 */

import { useEffect, useMemo, useRef } from "react";

import {
  autoPlanSnapshot,
  autoPlanTrigger,
  type AutoPlanSnapshot,
} from "@/application/planner/auto-plan";
import { nextPlacementTarget } from "@/application/planner/planner-view-model";
import type { RideDocument } from "@/domain/ride/types";
import type { SketchEndpoints } from "@/domain/sketch/types";

export interface PlannerAutoPlanInput {
  readonly document: RideDocument;
  /** The endpoints a committed sketch derives; they satisfy a missing end. */
  readonly sketchDerivedEndpoints: SketchEndpoints | null;
  /**
   * False while the draft store is still looking for a saved ride. Nothing is
   * compared, and no baseline is taken, until it is true.
   */
  readonly restoreSettled: boolean;
  /** The workspace's plan command — the one `Create ride` runs. */
  readonly plan: () => void;
}

export function usePlannerAutoPlan(input: PlannerAutoPlanInput): void {
  const { document, sketchDerivedEndpoints, restoreSettled, plan } = input;
  const previousRef = useRef<AutoPlanSnapshot | null>(null);

  const snapshot = useMemo(
    () =>
      autoPlanSnapshot({
        start: document.intent.start,
        finish: document.intent.finish,
        shape: document.intent.shape,
        plannable: nextPlacementTarget(document, sketchDerivedEndpoints) === null,
      }),
    [document, sketchDerivedEndpoints],
  );

  useEffect(() => {
    if (!restoreSettled) return;
    const trigger = autoPlanTrigger(previousRef.current, snapshot);
    previousRef.current = snapshot;
    // The command closes over the document of this render, which is the snapshot
    // just compared, so the attempt is spent on the ride the rider authored.
    if (trigger !== null) plan();
  }, [snapshot, restoreSettled, plan]);
}
