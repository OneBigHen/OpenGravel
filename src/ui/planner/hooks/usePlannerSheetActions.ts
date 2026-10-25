import { useCallback } from "react";

import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

/** The compact sheet's height changes: tap the handle, or swipe/drag the head. */
export function usePlannerSheetActions(
  plannerUiStore: PlannerUiStore,
  planningSessionStore: PlanningSessionStore,
): {
  readonly onToggleSheet: () => void;
  readonly onStepSheet: (direction: "up" | "down") => void;
} {
  const hasRide = useCallback((): boolean => {
    const session = planningSessionStore.getState().snapshot;
    return (session.committedBundle ?? session.lastGoodBundle) !== null;
  }, [planningSessionStore]);

  const onToggleSheet = useCallback((): void => {
    const state = plannerUiStore.getState();
    if (window.matchMedia("(max-width: 760px)").matches) {
      state.setSheetDetent(state.sheetDetent === "expanded" ? "peek" : state.sheetDetent === "half" ? "expanded" : "half");
    } else state.toggleSheet(hasRide());
  }, [hasRide, plannerUiStore]);

  const onStepSheet = useCallback(
    (direction: "up" | "down"): void => {
      const state = plannerUiStore.getState();
      if (window.matchMedia("(max-width: 760px)").matches) {
        const current = state.sheetDetent;
        state.setSheetDetent(direction === "up"
          ? current === "half" || current === "expanded" ? "expanded" : "half"
          : current === "expanded" ? "half" : "peek");
      } else state.stepSheet(direction, hasRide());
    },
    [hasRide, plannerUiStore],
  );

  return { onToggleSheet, onStepSheet };
}
