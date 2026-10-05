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
    plannerUiStore.getState().toggleSheet(hasRide());
  }, [hasRide, plannerUiStore]);

  const onStepSheet = useCallback(
    (direction: "up" | "down"): void => {
      plannerUiStore.getState().stepSheet(direction, hasRide());
    },
    [hasRide, plannerUiStore],
  );

  return { onToggleSheet, onStepSheet };
}
