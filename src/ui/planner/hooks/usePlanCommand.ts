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
 */

import { useCallback } from "react";

import type { RideDocument } from "@/domain/ride/types";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";

export interface PlanCommandInput {
  readonly document: RideDocument;
  /** Arms the once-per-revision guard this explicit attempt is allowed to spend. */
  readonly markRevisionAttempted: (revision: number) => void;
  readonly planningSessionStore: PlanningSessionStore;
}

export function usePlanCommand(input: PlanCommandInput): () => void {
  const { document, markRevisionAttempted, planningSessionStore } = input;
  return useCallback((): void => {
    markRevisionAttempted(document.revision);
    void planningSessionStore.getState().begin({
      rideId: document.rideId,
      rideRevision: document.revision,
      intent: document.intent,
    });
  }, [document, markRevisionAttempted, planningSessionStore]);
}
