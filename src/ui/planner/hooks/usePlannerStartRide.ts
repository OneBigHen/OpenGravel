"use client";

/**
 * Starting the ride from the planner (04 §28), plus OG-02: Start on a drawing
 * that is not kept yet keeps it (the same as Done) and starts the ride as soon
 * as the kept drawing is planned. The rider asked to ride; a footnote telling
 * them to press another button first was a dead end. Also starts the ride on
 * its own when "Ride to the start" was tapped on this ride's card.
 */

import { useCallback, useEffect, useState } from "react";

import { isPlanningInFlight } from "@/application/planner/planner-view-model";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import {
  type PlannerRideActions,
  type RideHandoffOutcome,
} from "@/application/ride-session/ride-focus-handoff";
import type { RideDocument } from "@/domain/ride/types";
import { useAutoStartApproach } from "./useAutoStartApproach";

export interface PlannerRideStart {
  readonly state: "idle" | "starting";
  readonly message: string | null;
}

export function usePlannerStartRide(input: {
  readonly rideActions: PlannerRideActions | undefined;
  readonly rideHandoff: RideHandoffOutcome;
  readonly sketchPanelProps: { readonly onDone: () => void };
  readonly sketchError: string | null;
  readonly session: PlanningSessionSnapshot;
  readonly document: RideDocument;
}): {
  readonly rideStart: PlannerRideStart;
  readonly handleStartPressed: () => void;
  readonly startAfterDrawing: boolean;
  readonly drawingStartFailed: boolean;
} {
  const { rideActions, rideHandoff, sketchPanelProps, sketchError, session, document } = input;
  const [rideStart, setRideStart] = useState<PlannerRideStart>({ state: "idle", message: null });

  /**
   * The §28 handoff: the composition root journals the session, writes the
   * bootstrap pointer and moves to `/ride`. This only reports the outcome; it
   * neither writes storage nor changes the URL.
   */
  const handleStartRide = useCallback(async (): Promise<void> => {
    if (rideActions === undefined || rideHandoff.outcome !== "ready") return;
    setRideStart({ state: "starting", message: null });
    try {
      const outcome = await rideActions.start(rideHandoff.request);
      if (outcome.outcome === "rejected") {
        setRideStart({ state: "idle", message: outcome.message });
        return;
      }
      // A successful start navigates away; the surface must not flash an idle
      // button while the route changes.
      setRideStart({ state: "starting", message: null });
    } catch (error: unknown) {
      setRideStart({
        state: "idle",
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : "The ride could not be started.",
      });
    }
  }, [rideActions, rideHandoff]);

  const [startAfterDrawing, setStartAfterDrawing] = useState(false);
  const handleStartPressed = useCallback((): void => {
    if (rideHandoff.outcome === "refused" && rideHandoff.code === "sketch-preview") {
      setRideStart({ state: "idle", message: null });
      setStartAfterDrawing(true);
      sketchPanelProps.onDone();
      return;
    }
    setStartAfterDrawing(false);
    void handleStartRide();
  }, [rideHandoff, sketchPanelProps, handleStartRide]);
  // The kept drawing could not be planned: say so beside Start instead of waiting.
  const drawingStartFailed =
    startAfterDrawing && (sketchError !== null || session.phase === "failed" || session.phase === "cancelled");
  const drawingStartReady =
    startAfterDrawing &&
    !drawingStartFailed &&
    !isPlanningInFlight(session.phase) &&
    session.committedBundle !== null &&
    session.committedBundle.rideRevision === document.revision &&
    rideHandoff.outcome === "ready";
  useEffect(() => {
    if (!drawingStartReady) return;
    // The kept drawing has its own plan now: start it, once.
    void Promise.resolve().then(() => {
      setStartAfterDrawing(false);
      return handleStartRide();
    });
  }, [drawingStartReady, handleStartRide]);

  useAutoStartApproach(String(document.rideId), rideActions !== undefined && rideHandoff.outcome === "ready", handleStartRide);

  return { rideStart, handleStartPressed, startAfterDrawing, drawingStartFailed };
}
