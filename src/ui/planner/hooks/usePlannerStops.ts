"use client";

/**
 * Stop and point authoring for the planner.
 *
 * The RideDocument store remains the only writer. This hook translates the map
 * gesture and the existing itinerary actions into their typed commands, and
 * returns the state and callbacks consumed by the stop panel.
 */

import { useCallback, useMemo, useRef } from "react";

import {
  isDraggablePointRef,
  type MapObjectRef,
  type MapScene,
  type PreviewPointScene,
} from "@/application/map/types";
import {
  itineraryRefFor,
  itineraryRefKey,
  nextPlacementTarget,
  type ItineraryRef,
  type PlacementTarget,
  type PlannerViewModel,
  type PointRowVm,
} from "@/application/planner/planner-view-model";
import { snapPreviewCoordinate } from "@/application/planner/point-snap";
import { nextStopInsertionBeforeId } from "@/application/planner/stop-insertion";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import {
  insertStopCommand,
  moveFinishCommand,
  moveShapeCommand,
  moveStartCommand,
  moveStopCommand,
  placeFinishCommand,
  placeStartCommand,
  type RideDocumentStore,
} from "@/ui/stores/ride-document-store";
import type { PlannerUiStore, PlacementTool } from "@/ui/stores/planner-ui-store";
import type { StopsPanelProps } from "@/ui/planner/StopsPanel";
import { usePlannerItineraryActions } from "@/ui/planner/usePlannerItineraryActions";

export type ArmedPlacementTool = "start" | "finish" | "stop" | null;

export interface PlannerStopsAuthoring {
  readonly armedTool: ArmedPlacementTool;
  readonly missingTarget: PlacementTarget;
  readonly panelProps: StopsPanelProps;
  readonly changeDestination: () => void;
  /** Adds a stop at a known place (a places card's "Add as stop"). */
  readonly addStopAt: (coordinate: Coordinate, label: string) => void;
  beginPointDrag(ref: MapObjectRef | null, coordinate: Coordinate): void;
  previewPointDrag(coordinate: Coordinate): void;
  commitPointDrag(coordinate: Coordinate | undefined): void;
  cancelPointDrag(): void;
  placeFromMap(coordinate: Coordinate): boolean;
}

function armedToolFor(placementTool: PlacementTool): ArmedPlacementTool {
  switch (placementTool) {
    case "place-start":
      return "start";
    case "place-finish":
      return "finish";
    case "place-stop":
      return "stop";
    case "idle":
      return null;
  }
}

/** The list row a map ref addresses, or `null` for non-authored objects. */
function rowForMapRef(
  rows: readonly PointRowVm[],
  document: RideDocument,
  ref: MapObjectRef | null,
): PointRowVm | null {
  const listRef = ref === null ? null : itineraryRefFor(document, ref);
  if (listRef === null) return null;
  const key = itineraryRefKey(listRef);
  return rows.find((row) => itineraryRefKey(row.ref) === key) ?? null;
}

export function usePlannerStops(input: {
  readonly document: RideDocument;
  readonly viewModel: PlannerViewModel;
  readonly scene: MapScene;
  readonly selectedRef: ItineraryRef | null;
  readonly placementTool: PlacementTool;
  readonly placementStopId: StopsPanelProps["armedStopId"];
  readonly selectedObject: MapObjectRef | null;
  readonly rideDocumentStore: RideDocumentStore;
  readonly plannerUiStore: PlannerUiStore;
}): PlannerStopsAuthoring {
  const {
    document,
    viewModel,
    scene,
    selectedRef,
    placementTool,
    placementStopId,
    selectedObject,
    rideDocumentStore,
    plannerUiStore,
  } = input;
  const armedTool = armedToolFor(placementTool);
  const missingTarget = nextPlacementTarget(document);

  const actions = usePlannerItineraryActions({
    document,
    scene,
    rideDocumentStore,
    plannerUiStore,
  });
  const panelProps = useMemo<StopsPanelProps>(
    () => ({
      viewModel,
      selectedRef,
      armedTool: placementTool,
      armedStopId: placementStopId,
      onSelect: actions.selectRef,
      onZoomTo: actions.zoomTo,
      onReplacePlace: actions.replacePlace,
      onMoveStop: actions.moveStop,
      onRemove: actions.remove,
      onConvert: actions.convert,
      onAddStop: actions.addStop,
      onEditCoordinate: actions.editCoordinate,
      onSetArrivalIntent: actions.setArrivalIntent,
    }),
    [viewModel, selectedRef, placementTool, placementStopId, actions],
  );

  const dragTargetRef = useRef<ItineraryRef | null>(null);
  const allRows = useMemo(
    () => [...viewModel.itinerary, ...viewModel.shapingPoints],
    [viewModel],
  );
  const snappedCoordinate = useCallback(
    (coordinate: Coordinate, excludeRef: ItineraryRef | null): Coordinate => {
      const excludeKey = excludeRef === null ? null : itineraryRefKey(excludeRef);
      const candidates = allRows
        .filter((row) => excludeKey === null || itineraryRefKey(row.ref) !== excludeKey)
        .map((row) => ({ id: itineraryRefKey(row.ref), coordinate: row.coordinate }));
      return snapPreviewCoordinate(coordinate, candidates).coordinate;
    },
    [allRows],
  );
  const previewFor = useCallback(
    (target: ItineraryRef, coordinate: Coordinate): PreviewPointScene => {
      const snapped = snappedCoordinate(coordinate, target);
      return {
        kind: target.kind,
        coordinate: snapped,
        snapped: snapped.lon !== coordinate.lon || snapped.lat !== coordinate.lat,
      };
    },
    [snappedCoordinate],
  );
  const commitDrag = useCallback(
    (target: ItineraryRef, coordinate: Coordinate): void => {
      const landed = snappedCoordinate(coordinate, target);
      const state = rideDocumentStore.getState();
      const command =
        target.kind === "start"
          ? moveStartCommand(document, landed)
          : target.kind === "finish"
            ? moveFinishCommand(document, landed)
            : target.kind === "stop"
              ? moveStopCommand(document, target.stopId, landed)
              : moveShapeCommand(document, target.shapingId, landed);
      // An endpoint removed between press and release has nothing to move.
      if (command !== null) state.dispatch(command);
    },
    [document, rideDocumentStore, snappedCoordinate],
  );

  const beginPointDrag = useCallback(
    (ref: MapObjectRef | null, coordinate: Coordinate): void => {
      const row = isDraggablePointRef(ref) ? rowForMapRef(allRows, document, ref) : null;
      dragTargetRef.current = row?.ref ?? null;
      plannerUiStore
        .getState()
        .setDragPreview(row === null ? null : previewFor(row.ref, coordinate));
    },
    [allRows, document, plannerUiStore, previewFor],
  );

  const previewPointDrag = useCallback(
    (coordinate: Coordinate): void => {
      const target = dragTargetRef.current;
      if (target === null) return;
      plannerUiStore.getState().setDragPreview(previewFor(target, coordinate));
    },
    [plannerUiStore, previewFor],
  );

  const commitPointDrag = useCallback(
    (coordinate: Coordinate | undefined): void => {
      const target = dragTargetRef.current;
      dragTargetRef.current = null;
      plannerUiStore.getState().setDragPreview(null);
      if (target === null || coordinate === undefined) return;
      commitDrag(target, coordinate);
    },
    [commitDrag, plannerUiStore],
  );

  const cancelPointDrag = useCallback((): void => {
    dragTargetRef.current = null;
  }, []);

  const placeFromMap = useCallback(
    (coordinate: Coordinate): boolean => {
      const ui = plannerUiStore.getState();
      if (placementTool === "place-stop") {
        if (placementStopId === null) {
          const selectedStopId = selectedObject?.kind === "stop" ? selectedObject.stopId : null;
          rideDocumentStore
            .getState()
            .dispatch(
              insertStopCommand(
                document,
                coordinate,
                nextStopInsertionBeforeId(document.intent.stops, selectedStopId),
              ),
            );
        } else {
          rideDocumentStore
            .getState()
            .dispatch(moveStopCommand(document, placementStopId, coordinate));
        }
        ui.setPlacementTool("idle");
        ui.setPlacementStopId(null);
        return true;
      }

      const armedTarget: PlacementTarget = armedTool === "stop" ? null : armedTool;
      const target = armedTarget ?? missingTarget;
      if (target !== "start" && target !== "finish") return false;
      rideDocumentStore
        .getState()
        .dispatch(
          target === "start"
            ? placeStartCommand(document, coordinate)
            : placeFinishCommand(document, coordinate),
        );
      ui.setPlacementTool("idle");
      return true;
    },
    [
      armedTool,
      document,
      missingTarget,
      placementStopId,
      placementTool,
      plannerUiStore,
      rideDocumentStore,
      selectedObject,
    ],
  );

  return {
    armedTool,
    missingTarget,
    panelProps,
    changeDestination: actions.changeDestination,
    addStopAt: actions.addStopAt,
    beginPointDrag,
    previewPointDrag,
    commitPointDrag,
    cancelPointDrag,
    placeFromMap,
  };
}
