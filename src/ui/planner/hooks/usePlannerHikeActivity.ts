"use client";
import { newCommandId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";
import type { RouteCandidate } from "@/domain/route/types";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import type { HikeActivityProps } from "@/ui/planner/PlannerWorkspaceFrame";

export function usePlannerHikeActivity(document: RideDocument, store: RideDocumentStore, planning: PlanningSessionStore, session: PlanningSessionSnapshot, candidate: RouteCandidate | null, drawing: boolean, sketch: HikeActivityProps["sketch"]): HikeActivityProps {
  return {
    drawing, sketch, candidate,
    onEnterHike: () => planning.getState().cancel(),
    error: session.error?.code === "hike-routing-unavailable" ? "Hike routing unavailable." : session.error?.code === "no-trail-route" ? "No trail route between these points." : null,
    canPlan: document.intent.start !== null && (document.intent.finish !== null || document.intent.shape === "loop"),
    returnToStart: document.intent.hikeReturnToStart === true,
    onReturnToStart: enabled => {
      const current = store.getState().document;
      store.getState().dispatch({ type: "hike.returnToStart.set", commandId: newCommandId(), rideId: current.rideId, baseRevision: current.revision, source: "rider", label: enabled ? "There and back" : "One way", enabled });
    },
    onPlan: () => {
      const current = store.getState().document;
      void planning.getState().begin({ rideId: current.rideId, rideRevision: current.revision, intent: current.intent });
    },
  };
}
