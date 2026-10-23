"use client";

/**
 * Translate renderer MapIntents into presentation actions and typed authoring
 * commands. All state changes still go through the existing stores and hooks.
 */

import { useCallback } from "react";

import type { MapIntent, MapObjectRef } from "@/application/map/types";
import type { Coordinate } from "@/domain/ride/types";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

const CLEARS_CHANGED_SPAN: ReadonlySet<MapIntent["type"]> = new Set([
  "map-click",
  "object-click",
  "overlap-click",
  "pointer-down",
  "gesture-commit",
]);

export function usePlannerMapIntentController(input: {
  readonly plannerUiStore: PlannerUiStore;
  readonly planningSessionStore: PlanningSessionStore;
  readonly clearUpdateHighlight: () => void;
  readonly stops: {
    readonly beginPointDrag: (ref: MapObjectRef | null, coordinate: Coordinate) => void;
    readonly previewPointDrag: (coordinate: Coordinate) => void;
    readonly commitPointDrag: (coordinate: Coordinate | undefined) => void;
    readonly cancelPointDrag: () => void;
    readonly placeFromMap: (coordinate: Coordinate) => boolean;
  };
  readonly avoidAreas: {
    readonly clearGesture: () => void;
    readonly beginPointerDown: (
      coordinate: Coordinate,
      ref: MapObjectRef | null,
    ) => boolean;
    readonly previewPointerMove: (coordinate: Coordinate) => boolean;
    readonly appendPolygonVertex: (coordinate: Coordinate) => void;
    readonly commitGesture: (release: Coordinate | undefined) => boolean;
  };
  readonly roadSpans: {
    readonly clearGesture: () => void;
    readonly beginPointerDown: (coordinate: Coordinate) => void;
    readonly previewPointerMove: (coordinate: Coordinate) => boolean;
    readonly commitGesture: (release: Coordinate | undefined) => void;
  };
  readonly sketch: {
    readonly cancelInFlightStroke: () => void;
    readonly beginStroke: (coordinate: Coordinate) => void;
    readonly appendPoint: (coordinate: Coordinate) => void;
    readonly finishStroke: (coordinate: Coordinate) => void;
  };
}) {
  const {
    plannerUiStore,
    planningSessionStore,
    clearUpdateHighlight,
    stops,
    avoidAreas,
    roadSpans,
    sketch,
  } = input;
  const {
    beginPointDrag,
    previewPointDrag,
    commitPointDrag,
    cancelPointDrag,
    placeFromMap,
  } = stops;
  const {
    clearGesture: clearAvoidAreaGesture,
    beginPointerDown: beginAvoidAreaPointerDown,
    previewPointerMove: previewAvoidAreaPointerMove,
    appendPolygonVertex,
    commitGesture: commitAvoidAreaGesture,
  } = avoidAreas;
  const {
    clearGesture: clearRoadSpanGesture,
    beginPointerDown: beginRoadSpanPointerDown,
    previewPointerMove: previewRoadSpanPointerMove,
    commitGesture: commitRoadSpanGesture,
  } = roadSpans;
  const {
    cancelInFlightStroke: cancelSketchStroke,
    beginStroke: beginSketchStroke,
    appendPoint: appendSketchPoint,
    finishStroke: finishSketchStroke,
  } = sketch;

  const onIntent = useCallback(
    (intent: MapIntent): void => {
      const ui = plannerUiStore.getState();
      if (CLEARS_CHANGED_SPAN.has(intent.type)) clearUpdateHighlight();

      if (intent.type === "camera-changed") {
        ui.setCameraUserOwned(true);
        return;
      }

      if (intent.type === "gesture-cancel") {
        cancelPointDrag();
        clearAvoidAreaGesture();
        clearRoadSpanGesture();
        ui.setDragPreview(null);
        ui.setAvoidAreaPreview(null);
        if (ui.activeTool !== "road-span-select") ui.setRoadSpanDraft(null);
        if (ui.activeTool === "sketch") cancelSketchStroke();
        return;
      }

      if (intent.type === "pointer-down") {
        if (ui.activeTool === "sketch") {
          beginSketchStroke(intent.coordinate);
          return;
        }
        if (ui.activeTool === "road-span-select") {
          beginRoadSpanPointerDown(intent.coordinate);
          return;
        }
        if (beginAvoidAreaPointerDown(intent.coordinate, intent.ref)) return;
        beginPointDrag(intent.ref, intent.coordinate);
        return;
      }

      if (intent.type === "pointer-move") {
        if (ui.activeTool === "sketch") {
          appendSketchPoint(intent.coordinate);
          return;
        }
        if (previewRoadSpanPointerMove(intent.coordinate)) return;
        if (previewAvoidAreaPointerMove(intent.coordinate)) return;
        previewPointDrag(intent.coordinate);
        return;
      }

      if (intent.type === "pointer-up") {
        if (ui.activeTool === "sketch") {
          finishSketchStroke(intent.coordinate);
          return;
        }
        if (ui.avoidAreaTool === "polygon") {
          appendPolygonVertex(intent.coordinate);
        }
        return;
      }

      if (intent.type === "gesture-commit") {
        const release = intent.geometry[intent.geometry.length - 1];
        if (intent.tool === "sketch") return;
        if (intent.tool === "road-span-select") {
          commitRoadSpanGesture(release);
          return;
        }
        if (commitAvoidAreaGesture(release)) return;
        commitPointDrag(release);
        return;
      }

      if (placeFromMap(intent.coordinate)) return;
      if (intent.type === "overlap-click") {
        ui.setOverlapCandidates(intent.candidates, intent.coordinate);
        return;
      }
      if (intent.type === "object-click") {
        ui.selectObject(intent.ref);
        if (intent.ref.kind === "route") {
          planningSessionStore.getState().selectRoute(intent.ref.routeId);
          ui.setRouteTap({ routeId: intent.ref.routeId, coordinate: intent.coordinate });
        }
        return;
      }
      ui.selectObject(null);
    },
    [
      plannerUiStore,
      clearUpdateHighlight,
      planningSessionStore,
      beginPointDrag,
      previewPointDrag,
      commitPointDrag,
      cancelPointDrag,
      placeFromMap,
      clearAvoidAreaGesture,
      beginAvoidAreaPointerDown,
      previewAvoidAreaPointerMove,
      appendPolygonVertex,
      commitAvoidAreaGesture,
      clearRoadSpanGesture,
      beginRoadSpanPointerDown,
      previewRoadSpanPointerMove,
      commitRoadSpanGesture,
      cancelSketchStroke,
      beginSketchStroke,
      appendSketchPoint,
      finishSketchStroke,
    ],
  );

  const onSelectOverlap = useCallback(
    (ref: MapObjectRef): void => {
      const ui = plannerUiStore.getState();
      const at = ui.overlapAt;
      if (ref.kind === "route") {
        planningSessionStore.getState().selectRoute(ref.routeId);
      }
      ui.selectObject(ref);
      // The rider tapped a road and then said which ride: offer that road (NV-14).
      if (ref.kind === "route" && at !== null) ui.setRouteTap({ routeId: ref.routeId, coordinate: at });
    },
    [planningSessionStore, plannerUiStore],
  );
  const onDismissOverlap = useCallback((): void => {
    plannerUiStore.getState().setOverlapCandidates([]);
  }, [plannerUiStore]);

  return { onIntent, onSelectOverlap, onDismissOverlap };
}
