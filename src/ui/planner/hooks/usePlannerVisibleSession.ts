"use client";

/**
 * The planning session as the planner shows it (UX audit PP-01, OGV-D-285).
 *
 * Two rules decide what is on screen: an answer for a ride that lost a point it
 * needs is hidden (`visiblePlanningSession`), and a snap-as-you-go preview is
 * shown only while the pen is armed and is never rideable.
 */

import { useMemo } from "react";
import { useStore } from "zustand";

import { visiblePlanningSession } from "@/application/planner/planner-view-model";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import { isSketchPreviewBundle } from "@/application/planner/sketch-preview";
import type { RideDocument } from "@/domain/ride/types";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

export function usePlannerVisibleSession(input: {
  readonly document: RideDocument;
  readonly snapshot: PlanningSessionSnapshot;
  readonly plannerUiStore: PlannerUiStore;
}): { readonly session: PlanningSessionSnapshot; readonly showingSketchPreview: boolean } {
  const { document, snapshot, plannerUiStore } = input;
  const drawing = useStore(plannerUiStore, (state) => state.activeTool === "sketch");
  const generations = useStore(plannerUiStore, (state) => state.sketchPreviewGenerations);
  return useMemo(() => {
    const session = visiblePlanningSession(document, snapshot, { generations, drawing });
    return {
      session,
      showingSketchPreview: isSketchPreviewBundle(session.committedBundle ?? session.lastGoodBundle, generations),
    };
  }, [document, snapshot, generations, drawing]);
}
