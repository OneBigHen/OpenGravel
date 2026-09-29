import { useCallback } from "react";

import { objectExtent } from "@/application/map/build-map-scene";
import type { MapScene } from "@/application/map/types";
import {
  mapRefForItineraryRef,
  type ItineraryRef,
} from "@/application/planner/planner-view-model";
import {
  moveDownBeforeId,
  moveUpBeforeId,
} from "@/application/planner/stop-insertion";
import type { StopId } from "@/domain/ride/ids";
import type {
  Coordinate,
  RideDocument,
  StopArrivalIntent,
} from "@/domain/ride/types";
import {
  convertPointCommand,
  insertStopCommand,
  moveFinishCommand,
  moveShapeCommand,
  moveStartCommand,
  moveStopCommand,
  removeFinishCommand,
  removeShapeCommand,
  removeStartCommand,
  removeStopCommand,
  reorderStopCommand,
  setArrivalIntentCommand,
  type RideDocumentStore,
} from "@/ui/stores/ride-document-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

export interface PlannerItineraryActions {
  readonly selectRef: (ref: ItineraryRef) => void;
  readonly zoomTo: (ref: ItineraryRef) => void;
  readonly replacePlace: (ref: ItineraryRef) => void;
  readonly moveStop: (stopId: StopId, direction: "up" | "down") => void;
  readonly remove: (ref: ItineraryRef) => void;
  readonly convert: (ref: ItineraryRef) => void;
  readonly addStop: () => void;
  readonly addStopAt: (coordinate: Coordinate, label: string) => void;
  readonly editCoordinate: (ref: ItineraryRef, coordinate: Coordinate) => void;
  readonly setArrivalIntent: (
    stopId: StopId,
    arrivalIntent: StopArrivalIntent | null,
  ) => void;
  readonly changeDestination: () => void;
}

/**
 * Bounded controller for the planner's itinerary/object-list actions.
 *
 * These actions translate rider UI intent into either presentation-state updates
 * or one typed RideDocument command. They own no ride state and introduce no
 * fourth authority; the stores remain the existing VNext containers.
 */
export function usePlannerItineraryActions(input: {
  readonly document: RideDocument;
  readonly scene: MapScene;
  readonly rideDocumentStore: RideDocumentStore;
  readonly plannerUiStore: PlannerUiStore;
}): PlannerItineraryActions {
  const {
    document,
    scene,
    rideDocumentStore,
    plannerUiStore,
  } = input;

  const selectRef = useCallback(
    (ref: ItineraryRef): void => {
      plannerUiStore
        .getState()
        .selectObject(mapRefForItineraryRef(document, ref));
    },
    [document, plannerUiStore],
  );

  const zoomTo = useCallback(
    (ref: ItineraryRef): void => {
      const mapRef = mapRefForItineraryRef(document, ref);
      if (mapRef === null) return;
      plannerUiStore.getState().requestFit(objectExtent(scene, mapRef));
    },
    [document, plannerUiStore, scene],
  );

  const replacePlace = useCallback(
    (ref: ItineraryRef): void => {
      const ui = plannerUiStore.getState();
      if (ref.kind === "stop") {
        ui.setPlacementTool("place-stop");
        ui.setPlacementStopId(ref.stopId);
        return;
      }
      if (ref.kind === "start") {
        ui.setPlacementTool("place-start");
        return;
      }
      if (ref.kind === "finish") {
        ui.setPlacementTool("place-finish");
      }
    },
    [plannerUiStore],
  );

  const moveStop = useCallback(
    (stopId: StopId, direction: "up" | "down"): void => {
      const stops = document.intent.stops;
      const index = stops.findIndex((stop) => stop.id === stopId);
      if (index === -1) return;

      const beforeStopId =
        direction === "up"
          ? moveUpBeforeId(stops, index)
          : moveDownBeforeId(stops, index);

      rideDocumentStore
        .getState()
        .dispatch(reorderStopCommand(document, stopId, beforeStopId));
    },
    [document, rideDocumentStore],
  );

  const remove = useCallback(
    (ref: ItineraryRef): void => {
      const state = rideDocumentStore.getState();
      switch (ref.kind) {
        case "start":
          state.dispatch(removeStartCommand(document));
          return;
        case "finish":
          state.dispatch(removeFinishCommand(document));
          return;
        case "stop":
          state.dispatch(removeStopCommand(document, ref.stopId));
          return;
        case "shaping":
          state.dispatch(removeShapeCommand(document, ref.shapingId));
      }
    },
    [document, rideDocumentStore],
  );

  const convert = useCallback(
    (ref: ItineraryRef): void => {
      if (ref.kind === "stop") {
        rideDocumentStore
          .getState()
          .dispatch(convertPointCommand(document, ref.stopId));
        return;
      }
      if (ref.kind === "shaping") {
        rideDocumentStore
          .getState()
          .dispatch(convertPointCommand(document, ref.shapingId));
      }
    },
    [document, rideDocumentStore],
  );

  const addStop = useCallback((): void => {
    const ui = plannerUiStore.getState();
    ui.setPlacementTool("place-stop");
    ui.setPlacementStopId(null);
  }, [plannerUiStore]);

  const addStopAt = useCallback(
    (coordinate: Coordinate, label: string): void => {
      const command = insertStopCommand(document, coordinate, undefined);
      rideDocumentStore.getState().dispatch({
        ...command,
        stop: { ...command.stop, label },
      });
    },
    [document, rideDocumentStore],
  );

  const editCoordinate = useCallback(
    (ref: ItineraryRef, coordinate: Coordinate): void => {
      const state = rideDocumentStore.getState();
      switch (ref.kind) {
        case "start": {
          const command = moveStartCommand(document, coordinate);
          if (command !== null) state.dispatch(command);
          return;
        }
        case "finish": {
          const command = moveFinishCommand(document, coordinate);
          if (command !== null) state.dispatch(command);
          return;
        }
        case "stop":
          state.dispatch(moveStopCommand(document, ref.stopId, coordinate));
          return;
        case "shaping":
          state.dispatch(moveShapeCommand(document, ref.shapingId, coordinate));
      }
    },
    [document, rideDocumentStore],
  );

  const setArrivalIntent = useCallback(
    (stopId: StopId, arrivalIntent: StopArrivalIntent | null): void => {
      rideDocumentStore
        .getState()
        .dispatch(setArrivalIntentCommand(document, stopId, arrivalIntent));
    },
    [document, rideDocumentStore],
  );

  const changeDestination = useCallback((): void => {
    plannerUiStore.getState().setPlacementTool("place-finish");
  }, [plannerUiStore]);

  return {
    selectRef,
    zoomTo,
    replacePlace,
    moveStop,
    remove,
    convert,
    addStop,
    addStopAt,
    editCoordinate,
    setArrivalIntent,
    changeDestination,
  };
}
