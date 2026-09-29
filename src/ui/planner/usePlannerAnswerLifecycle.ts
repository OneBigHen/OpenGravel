import { useCallback, useEffect, useRef, useState } from "react";

import type { GeometryPayload } from "@/domain/geometry/types";
import type { RideDocument } from "@/domain/ride/types";
import type { ChangedSpanScene } from "@/application/map/types";
import {
  CHANGED_SPAN_WINDOW_MS,
  computeChangedSpan,
  routeDelta,
  type RouteDelta,
} from "@/application/map/changed-span";
import { isPlanningInFlight, nextPlacementTarget } from "@/application/planner/planner-view-model";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

export interface PlannerUpdateHighlight {
  readonly span: ChangedSpanScene | null;
  readonly delta: RouteDelta;
  readonly untilIso: string;
}

export interface PlannerAnswerLifecycle {
  readonly updateHighlight: PlannerUpdateHighlight | null;
  clearUpdateHighlight(): void;
  markRevisionAttempted(revision: number): void;
}

/** How long an edit waits for the next one before the ride is planned again. */
export const REPLAN_SETTLE_MS = 600;

/**
 * Owns the lifecycle of an answered plan without becoming another state authority.
 *
 * This hook coordinates presentation consequences of PlanningSession changes:
 * - expand the planner sheet when route choices first appear;
 * - replan exactly once when RideDocument advances past the displayed answer;
 * - derive the bounded changed-span/delta emphasis between committed answers.
 *
 * It never writes RideDocument and never owns route selection.
 */
export function usePlannerAnswerLifecycle(input: {
  readonly document: RideDocument;
  readonly session: PlanningSessionSnapshot;
  readonly geometry: Readonly<Record<string, GeometryPayload>>;
  readonly routeCardCount: number;
  /** True when the document on screen was restored from a saved draft. */
  readonly restored: boolean;
  readonly planningSessionStore: PlanningSessionStore;
  readonly plannerUiStore: PlannerUiStore;
}): PlannerAnswerLifecycle {
  const {
    document,
    session,
    geometry,
    routeCardCount,
    restored,
    planningSessionStore,
    plannerUiStore,
  } = input;

  const [updateHighlight, setUpdateHighlight] =
    useState<PlannerUpdateHighlight | null>(null);

  // 04 §2: a route result settles the sheet at its ride detent (the chosen
  // route and Start ride; UX rework 2, #8), once, when the choices first
  // appear, so the map shows the route. A rider who moved it keeps it moved.
  const previousCardCount = useRef(0);
  useEffect(() => {
    if (routeCardCount > 0 && previousCardCount.current === 0) {
      plannerUiStore.getState().setSheetDetent("ride");
    }
    previousCardCount.current = routeCardCount;
  }, [routeCardCount, plannerUiStore]);

  /**
   * Replan an answer that no longer answers this revision (04 §21).
   *
   * Each revision is attempted once, so a failed attempt cannot loop. The
   * PlanningSession retains last-good geometry while the new attempt runs.
   */
  const attemptedRevisionRef = useRef<number | null>(null);
  useEffect(() => {
    const drawn = session.committedBundle ?? session.lastGoodBundle;
    if (drawn === null) return;
    if (drawn.rideRevision === document.revision) return;
    if (isPlanningInFlight(session.phase)) return;
    if (attemptedRevisionRef.current === document.revision) return;
    // An edit (or an undo) that leaves the ride without a required point is
    // not a failed update: there is nothing to ask for until the rider places
    // it, and the composer already says which point is missing.
    if (document.intent.sketch === null && nextPlacementTarget(document) !== null) return;
    // A burst of preference taps settles first, so it plans once for the
    // combination rather than once per tap (PQ-03); a newer revision cancels this.
    const timer = setTimeout(() => {
      attemptedRevisionRef.current = document.revision;
      void planningSessionStore.getState().begin({
        rideId: document.rideId,
        rideRevision: document.revision,
        intent: document.intent,
      });
    }, REPLAN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [document, session, planningSessionStore]);

  /**
   * Answer a restored draft once (04 §20 "reload → same intent").
   *
   * Planning answers are not part of the document checkpoint, so a reload
   * restores the ride without its routes. A complete restored ride is asked for
   * again, once, so the rider comes back to the answer rather than an empty list.
   */
  const restoredAttemptRef = useRef(false);
  useEffect(() => {
    if (!restored || restoredAttemptRef.current) return;
    if ((session.committedBundle ?? session.lastGoodBundle) !== null) return;
    if (isPlanningInFlight(session.phase) || session.error !== null) return;
    if (document.intent.sketch === null && nextPlacementTarget(document) !== null) return;
    restoredAttemptRef.current = true;
    attemptedRevisionRef.current = document.revision;
    void planningSessionStore.getState().begin({
      rideId: document.rideId,
      rideRevision: document.revision,
      intent: document.intent,
    });
  }, [restored, document, session, planningSessionStore]);

  /**
   * Previous committed answer, used only to derive one bounded visual comparison.
   * It is bookkeeping, not another route authority.
   */
  const lastAnswerRef = useRef<{
    readonly revision: number;
    readonly geometry: readonly { readonly lon: number; readonly lat: number }[];
    readonly distanceMeters: number;
    readonly durationSeconds: number;
  } | null>(null);

  useEffect(() => {
    const bundle = session.committedBundle;
    if (bundle === null) return;
    const candidate = bundle.candidates.find(
      (entry) => entry.id === bundle.selectedRouteId,
    );
    if (candidate === undefined) return;
    const payload = geometry[candidate.geometryRef];
    if (payload === undefined || payload.kind !== "line") return;

    const answer = {
      revision: bundle.rideRevision,
      geometry: payload.coordinates,
      distanceMeters: candidate.distanceMeters,
      durationSeconds: candidate.durationSeconds,
    };
    const previous = lastAnswerRef.current;
    lastAnswerRef.current = answer;

    if (previous === null || previous.revision === answer.revision) return;

    const span = computeChangedSpan(previous.geometry, answer.geometry);
    const delta = routeDelta(previous, answer);
    if (span === null && delta.addedMinutes === 0 && delta.addedMeters === 0) return;

    const untilIso = new Date(
      Date.now() + CHANGED_SPAN_WINDOW_MS,
    ).toISOString();
    setUpdateHighlight({
      span: span === null ? null : { coordinates: span.geometry, untilIso },
      delta,
      untilIso,
    });
  }, [session, geometry]);

  useEffect(() => {
    if (updateHighlight === null) return;
    const remaining = Date.parse(updateHighlight.untilIso) - Date.now();
    const timer = setTimeout(
      () => setUpdateHighlight(null),
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [updateHighlight]);

  const clearUpdateHighlight = useCallback((): void => {
    setUpdateHighlight(null);
  }, []);

  const markRevisionAttempted = useCallback((revision: number): void => {
    attemptedRevisionRef.current = revision;
  }, []);

  return {
    updateHighlight,
    clearUpdateHighlight,
    markRevisionAttempted,
  };
}
