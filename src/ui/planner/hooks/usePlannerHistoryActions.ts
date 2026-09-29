import { useCallback } from "react";

import type { RideDocument } from "@/domain/ride/types";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";
import { clearRideCommand, type RideDocumentStore } from "@/ui/stores/ride-document-store";

export interface PlannerHistoryActions {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** True when the ride has any authored point, so there is a route to clear. */
  readonly canClear: boolean;
  readonly onClearRide: () => void;
}

/**
 * Whole-ride history for the sheet (04 §20): undo, redo, and Clear route (OW-01),
 * which removes every authored point as one undoable step. It owns no state; the
 * ride document store stays the one authority.
 */
export function usePlannerHistoryActions(input: {
  readonly document: RideDocument;
  readonly rideDocumentStore: RideDocumentStore;
  readonly plannerUiStore: PlannerUiStore;
}): PlannerHistoryActions {
  const { document, rideDocumentStore, plannerUiStore } = input;
  const { intent } = document;

  const onUndo = useCallback((): void => {
    rideDocumentStore.getState().undo();
  }, [rideDocumentStore]);

  const onRedo = useCallback((): void => {
    rideDocumentStore.getState().redo();
  }, [rideDocumentStore]);

  const onClearRide = useCallback((): void => {
    rideDocumentStore.getState().dispatch(clearRideCommand(document));
    // With no ride left, the sheet is the composer again, not an empty ride row.
    plannerUiStore.getState().setSheetDetent("peek");
  }, [document, plannerUiStore, rideDocumentStore]);

  return {
    onUndo,
    onRedo,
    canClear:
      intent.start !== null || intent.finish !== null || intent.stops.length > 0 || intent.shaping.length > 0,
    onClearRide,
  };
}
