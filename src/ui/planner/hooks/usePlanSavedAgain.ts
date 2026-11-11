"use client";

/**
 * "Plan it again" on a saved line (R3-1, "saved means exact").
 *
 * A ride opened from My rides shows the line it was saved with and never asks
 * the router by itself. This is the one way to ask: it plans the same saved
 * request again (today's planner, today's roads) and says once, when the new
 * answer arrives, what changed against the saved line.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isSavedLineCandidate } from "@/application/explore/ride-this";
import { planAgainMessage, type PlanAgainNumbers } from "@/application/planner/plan-again";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import { isPlanningInFlight } from "@/application/planner/planner-view-model";
import type { RideDocument } from "@/domain/ride/types";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";

/** How long the sentence stands in for the plan status. */
export const PLAN_AGAIN_MESSAGE_MS = 8_000;

export interface PlanSavedAgain {
  /** `null` unless the answer on screen is a saved line. */
  readonly onPlanAgain: (() => void) | null;
  /** The one-time "what changed" sentence, while it is news. */
  readonly message: string | null;
}

function selected(session: PlanningSessionSnapshot) {
  const bundle = session.committedBundle ?? session.lastGoodBundle;
  return bundle?.candidates.find((candidate) => candidate.id === bundle.selectedRouteId);
}

export function usePlanSavedAgain(input: {
  readonly document: RideDocument;
  readonly session: PlanningSessionSnapshot;
  readonly planningSessionStore: PlanningSessionStore;
}): PlanSavedAgain {
  const { document, session, planningSessionStore } = input;
  const candidate = selected(session);
  const savedLine = isSavedLineCandidate(candidate) && !isPlanningInFlight(session.phase);
  const pending = useRef<PlanAgainNumbers | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const planAgain = useCallback((): void => {
    if (candidate === undefined) return;
    pending.current = { distanceMeters: candidate.distanceMeters, durationSeconds: candidate.durationSeconds };
    setMessage(null);
    void planningSessionStore.getState().begin({
      rideId: document.rideId,
      rideRevision: document.revision,
      intent: document.intent,
      fresh: true,
    });
  }, [candidate, document, planningSessionStore]);

  useEffect(() => {
    const saved = pending.current;
    if (saved === null || isPlanningInFlight(session.phase)) return;
    if (session.error !== null) {
      // The planner's own error says what went wrong; nothing to compare.
      pending.current = null;
      return;
    }
    const fresh = session.committedBundle === null ? undefined : selected(session);
    if (fresh === undefined || isSavedLineCandidate(fresh)) return;
    pending.current = null;
    setMessage(planAgainMessage(saved, fresh));
  }, [session]);

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => setMessage(null), PLAN_AGAIN_MESSAGE_MS);
    return (): void => clearTimeout(timer);
  }, [message]);

  return { onPlanAgain: savedLine ? planAgain : null, message };
}
