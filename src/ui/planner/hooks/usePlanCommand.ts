"use client";

/**
 * "Ask again for the revision on screen" as one command (04 §21, §29).
 *
 * Three places in the workspace ask for the same thing — the composer's plan
 * button, the failed-update banner's Retry, and the glance strip's Retry — and
 * they must ask in exactly the same way, or a retry could spend a different
 * attempt than the button beside it.
 *
 * The automatic replan guard (`usePlannerAnswerLifecycle`) is armed for this
 * revision on purpose: an explicit rider action must be allowed to spend an
 * attempt the background rule already spent, while still preventing a failure
 * from looping.
 *
 * The fourth caller is the planner itself: the pick that completes a ride asks
 * through this same command, without a press (04 §8). `usePlannerAutoPlan` owns
 * *when* that happens — one endpoint at a time, never on a reload, never for a
 * loop — so the composition root gains no second way to plan.
 */

import { useCallback } from "react";

import type { RideDocument } from "@/domain/ride/types";
import type { SketchEndpoints } from "@/domain/sketch/types";
import { usePlannerAutoPlan } from "@/ui/planner/hooks/usePlannerAutoPlan";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";

export interface PlanCommandInput {
  readonly document: RideDocument;
  /** Arms the once-per-revision guard this explicit attempt is allowed to spend. */
  readonly markRevisionAttempted: (revision: number) => void;
  readonly planningSessionStore: PlanningSessionStore;
  /** The endpoints a committed sketch derives; they satisfy a missing end. */
  readonly sketchDerivedEndpoints?: SketchEndpoints | null;
  /**
   * False while the draft store is still looking for a saved ride: nothing is
   * compared then, so a reload is not mistaken for a rider placing a point.
   */
  readonly restoreSettled?: boolean;
}

export function usePlanCommand(input: PlanCommandInput): () => void {
  const {
    document,
    markRevisionAttempted,
    planningSessionStore,
    sketchDerivedEndpoints = null,
    restoreSettled = true,
  } = input;
  const plan = useCallback((): void => {
    if (document.intent.breadcrumb != null) return;
    markRevisionAttempted(document.revision);
    void planningSessionStore.getState().begin({
      rideId: document.rideId,
      rideRevision: document.revision,
      intent: document.intent,
    });
  }, [document, markRevisionAttempted, planningSessionStore]);
  const autoPlan = useCallback(() => {
    const identity = planningSessionStore.getState().snapshot.identity;
    if (identity.rideId === document.rideId && identity.rideRevision === document.revision) return;
    plan();
  }, [document, planningSessionStore, plan]);
  usePlannerAutoPlan({ document, sketchDerivedEndpoints, restoreSettled, plan: autoPlan });
  return plan;
}
