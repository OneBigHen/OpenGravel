"use client";
import { useEffect } from "react";
import { newCommandId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";
import type { RouteCandidate } from "@/domain/route/types";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import type { HikeActivityProps } from "@/ui/planner/PlannerWorkspaceFrame";
import type { HikeSummaryModel } from "@/ui/planner/HikeSummary";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

export function usePlannerHikeActivity(document: RideDocument, store: RideDocumentStore, planning: PlanningSessionStore, session: PlanningSessionSnapshot, candidate: RouteCandidate | null, drawing: boolean, sketch: HikeActivityProps["sketch"]): HikeActivityProps {
  return {
    drawing, sketch, candidate,
    breadcrumb: document.intent.breadcrumb != null,
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

/**
 * The planned hike's sheet summary, or null while no hike is planned. A freshly
 * planned hike also opens the sheet to half, as a new ride does, so its time,
 * climb and Start hike are on screen instead of folded under the map.
 */
export function usePlannedHikeSummary(hike: HikeActivityProps, ui: PlannerUiStore): HikeSummaryModel | null {
  const planned = hike.candidate?.provider.profile === "hike" ? hike.candidate : null;
  const plannedId = planned?.id ?? null;
  useEffect(() => {
    if (plannedId === null) return;
    const detent = ui.getState().sheetDetent;
    if (detent === "peek" || detent === "mini") ui.getState().setSheetDetent("half");
  }, [plannedId, ui]);
  return planned === null ? null : { candidate: planned, returnToStart: hike.returnToStart, onReturnToStart: hike.onReturnToStart, canPlan: hike.canPlan, onPlan: hike.onPlan, onDraw: hike.sketch.onStartDrawing };
}
