"use client";

/**
 * Avoid-area authoring, editing and conflict presentation for the planner.
 *
 * Drafts, tools and gesture previews stay in PlannerUiStore; committed areas
 * still reach RideDocument only through the typed authoring commands.
 */

import { useCallback, useMemo, useRef } from "react";
import { useStore } from "zustand";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { MapObjectRef, PreviewAreaScene } from "@/application/map/types";
import {
  detectAvoidAreaConflicts,
  type AvoidAreaConflict,
} from "@/application/planner/avoid-area-conflicts";
import {
  applyPolygonTap,
  closePolygonDraft,
  draftPreviewRing,
  popPolygonVertex,
  type PolygonTap,
} from "@/application/planner/avoid-area-draft";
import {
  MIN_AVOID_AREA_SPAN_METERS,
  moveRingVertex,
  nearestVertexHandle,
  rectangleRing,
  translateRings,
  validateAvoidAreaRings,
} from "@/application/planner/avoid-area-geometry";
import {
  authorAvoidArea,
  removeAvoidAreaCommand,
  renameAvoidAreaCommand,
  setAvoidAreaEnabledCommand,
  updateAvoidAreaGeometry,
  type AvoidAreaAuthoringResult,
} from "@/application/planner/avoid-area-authoring";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { AvoidAreaId, StopId } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import {
  avoidAreaRowName,
  type AvoidAreasPanelProps,
  type AvoidAreaRowVm,
} from "@/ui/planner/AvoidAreasPanel";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import type {
  AvoidAreaTool,
  PlannerUiStore,
  PlacementTool,
} from "@/ui/stores/planner-ui-store";

type AvoidAreaGesture =
  | { readonly kind: "rectangle"; readonly origin: Coordinate }
  | {
      readonly kind: "move";
      readonly areaId: AvoidAreaId;
      readonly rings: readonly (readonly Coordinate[])[];
      readonly origin: Coordinate;
    }
  | {
      readonly kind: "vertex";
      readonly areaId: AvoidAreaId;
      readonly rings: readonly (readonly Coordinate[])[];
      readonly origin: Coordinate;
      readonly ringIndex: number;
      readonly vertexIndex: number;
    };

export type AvoidAreasPanelProjection = Omit<AvoidAreasPanelProps, "onZoomTo">;

export interface PlannerAvoidAreasAuthoring {
  readonly tool: AvoidAreaTool;
  readonly draft: readonly Coordinate[];
  readonly error: string | null;
  readonly preview: PreviewAreaScene | null;
  readonly conflicts: readonly AvoidAreaConflict[];
  readonly rows: readonly AvoidAreaRowVm[];
  readonly names: ReadonlyMap<AvoidAreaId, string>;
  readonly panelProps: AvoidAreasPanelProjection;
  readonly moveConflictEndpoint: (conflict: AvoidAreaConflict) => void;
  readonly editConflictArea: (areaId: AvoidAreaId) => void;
  clearGesture(): void;
  cancelToolGesture(): void;
  beginPointerDown(coordinate: Coordinate, ref: MapObjectRef | null): boolean;
  previewPointerMove(coordinate: Coordinate): boolean;
  appendPolygonVertex(coordinate: Coordinate): void;
  commitGesture(release: Coordinate | undefined): boolean;
}

function deltaBetween(origin: Coordinate, current: Coordinate): Coordinate {
  return { lon: current.lon - origin.lon, lat: current.lat - origin.lat };
}

function avoidAreaRefusalMessage(
  result: Exclude<AvoidAreaAuthoringResult, { readonly outcome: "applied" }>,
): string {
  switch (result.outcome) {
    case "rejected":
      return result.message;
    case "invalid":
      return `The avoid area was refused (${result.code}).`;
    case "stale":
      return `The ride changed while the area was being drawn (revision ${result.currentRevision}), so it was not saved.`;
  }
}

function placementForConflict(conflict: AvoidAreaConflict): {
  readonly tool: PlacementTool;
  readonly stopId: StopId | null;
} {
  switch (conflict.endpoint.kind) {
    case "start":
      return { tool: "place-start", stopId: null };
    case "finish":
      return { tool: "place-finish", stopId: null };
    case "stop":
      return { tool: "place-stop", stopId: conflict.endpoint.id as StopId };
  }
}

function ringsForArea(
  areaId: AvoidAreaId,
  document: RideDocument,
  readGeometry: (ref: RideDocument["intent"]["avoidAreas"][number]["geometryRef"]) =>
    GeometryPayload | null,
): readonly (readonly Coordinate[])[] {
  const area = document.intent.avoidAreas.find((candidate) => candidate.id === areaId);
  if (area === undefined) return [];
  const payload = readGeometry(area.geometryRef);
  return payload?.kind === "polygon" ? payload.rings : [];
}

export function usePlannerAvoidAreas(input: {
  readonly document: RideDocument;
  readonly selectedObject: MapObjectRef | null;
  readonly areaStore: GeometryStore;
  readonly readGeometry: (
    ref: RideDocument["intent"]["avoidAreas"][number]["geometryRef"],
  ) => GeometryPayload | null;
  readonly rideDocumentStore: RideDocumentStore;
  readonly plannerUiStore: PlannerUiStore;
}): PlannerAvoidAreasAuthoring {
  const {
    document,
    selectedObject,
    areaStore,
    readGeometry,
    rideDocumentStore,
    plannerUiStore,
  } = input;
  const tool = useStore(plannerUiStore, (state) => state.avoidAreaTool);
  const draft = useStore(plannerUiStore, (state) => state.avoidAreaDraft);
  const error = useStore(plannerUiStore, (state) => state.avoidAreaError);
  const preview = useStore(plannerUiStore, (state) => state.avoidAreaPreview);

  const ringsByAreaId = useMemo(
    () =>
      new Map(
        document.intent.avoidAreas.map((area) => [
          area.id,
          ringsForArea(area.id, document, readGeometry),
        ]),
      ),
    [document, readGeometry],
  );
  const conflicts = useMemo(
    () => detectAvoidAreaConflicts({ intent: document.intent, ringsByAreaId }),
    [document.intent, ringsByAreaId],
  );
  const conflictCountByAreaId = useMemo(() => {
    const counts = new Map<AvoidAreaId, number>();
    for (const conflict of conflicts) {
      counts.set(conflict.areaId, (counts.get(conflict.areaId) ?? 0) + 1);
    }
    return counts;
  }, [conflicts]);
  const rows: readonly AvoidAreaRowVm[] = useMemo(
    () =>
      document.intent.avoidAreas.map((area) => {
        const rings = ringsByAreaId.get(area.id) ?? [];
        return {
          id: area.id,
          name: area.name,
          enabled: area.enabled,
          // The closing vertex repeats the first and is not an editable corner.
          vertexCount: rings.reduce(
            (total, ring) => total + Math.max(0, ring.length - 1),
            0,
          ),
          geometryResolved: rings.length > 0,
          conflictCount: conflictCountByAreaId.get(area.id) ?? 0,
        };
      }),
    [document.intent.avoidAreas, ringsByAreaId, conflictCountByAreaId],
  );
  const names = useMemo(() => {
    const result = new Map<AvoidAreaId, string>();
    rows.forEach((row, index) => result.set(row.id, avoidAreaRowName(row, index)));
    return result;
  }, [rows]);

  const areaGestureRef = useRef<AvoidAreaGesture | null>(null);
  const lastPolygonTapRef = useRef<PolygonTap | null>(null);

  const commitNewAvoidArea = useCallback(
    async (
      rings: readonly (readonly Coordinate[])[],
      validation?: { readonly minSpanMeters?: number },
    ): Promise<boolean> => {
      const ui = plannerUiStore.getState();
      const result = await authorAvoidArea({
        document,
        rings,
        geometryStore: areaStore,
        dispatch: (command) => rideDocumentStore.getState().dispatch(command),
        ...(validation === undefined ? {} : { validation }),
      });
      if (result.outcome !== "applied") {
        ui.setAvoidAreaError(avoidAreaRefusalMessage(result));
        return false;
      }
      ui.setAvoidAreaError(null);
      ui.setAvoidAreaDraft([]);
      ui.setAvoidAreaPreview(null);
      ui.setAvoidAreaTool("idle");
      ui.selectObject({ kind: "avoid-area", avoidAreaId: result.areaId });
      return true;
    },
    [areaStore, document, plannerUiStore, rideDocumentStore],
  );

  const commitAvoidAreaGeometry = useCallback(
    async (
      areaId: AvoidAreaId,
      rings: readonly (readonly Coordinate[])[],
    ): Promise<boolean> => {
      const ui = plannerUiStore.getState();
      const result = await updateAvoidAreaGeometry({
        document,
        areaId,
        rings,
        geometryStore: areaStore,
        dispatch: (command) => rideDocumentStore.getState().dispatch(command),
      });
      if (result.outcome !== "applied") {
        ui.setAvoidAreaError(avoidAreaRefusalMessage(result));
        return false;
      }
      ui.setAvoidAreaError(null);
      return true;
    },
    [areaStore, document, plannerUiStore, rideDocumentStore],
  );

  const closeDraft = useCallback((): void => {
    const ui = plannerUiStore.getState();
    const closed = closePolygonDraft(ui.avoidAreaDraft);
    if (closed.ring === null) {
      ui.setAvoidAreaError(closed.message);
      return;
    }
    lastPolygonTapRef.current = null;
    void commitNewAvoidArea([closed.ring]);
  }, [commitNewAvoidArea, plannerUiStore]);

  const startTool = useCallback(
    (nextTool: AvoidAreaTool, targetId: AvoidAreaId | null = null): void => {
      const ui = plannerUiStore.getState();
      lastPolygonTapRef.current = null;
      areaGestureRef.current = null;
      ui.setAvoidAreaPreview(null);
      ui.setAvoidAreaError(null);
      ui.setAvoidAreaTool(nextTool, targetId);
      if (targetId !== null) ui.selectObject({ kind: "avoid-area", avoidAreaId: targetId });
    },
    [plannerUiStore],
  );

  const removeLastVertex = useCallback((): void => {
    const ui = plannerUiStore.getState();
    lastPolygonTapRef.current = null;
    ui.setAvoidAreaDraft(popPolygonVertex(ui.avoidAreaDraft));
    ui.setAvoidAreaError(null);
  }, [plannerUiStore]);

  const cancelDraft = useCallback((): void => {
    const ui = plannerUiStore.getState();
    lastPolygonTapRef.current = null;
    ui.clearAvoidAreaDraft();
    ui.setAvoidAreaError(null);
    ui.setAvoidAreaTool("idle");
  }, [plannerUiStore]);

  const renameArea = useCallback(
    (areaId: AvoidAreaId, name: string | null): void => {
      rideDocumentStore
        .getState()
        .dispatch(renameAvoidAreaCommand(document, areaId, name));
    },
    [document, rideDocumentStore],
  );

  const setAreaEnabled = useCallback(
    (areaId: AvoidAreaId, enabled: boolean): void => {
      rideDocumentStore
        .getState()
        .dispatch(setAvoidAreaEnabledCommand(document, areaId, enabled));
    },
    [document, rideDocumentStore],
  );

  const removeArea = useCallback(
    (areaId: AvoidAreaId): void => {
      const ui = plannerUiStore.getState();
      rideDocumentStore.getState().dispatch(removeAvoidAreaCommand(document, areaId));
      if (ui.avoidAreaTargetId === areaId) ui.setAvoidAreaTool("idle");
      if (selectedObject?.kind === "avoid-area" && selectedObject.avoidAreaId === areaId) {
        ui.selectObject(null);
      }
    },
    [document, plannerUiStore, rideDocumentStore, selectedObject],
  );

  const selectArea = useCallback(
    (areaId: AvoidAreaId): void => {
      plannerUiStore.getState().selectObject({ kind: "avoid-area", avoidAreaId: areaId });
    },
    [plannerUiStore],
  );

  const moveConflictEndpoint = useCallback(
    (conflict: AvoidAreaConflict): void => {
      const ui = plannerUiStore.getState();
      const placement = placementForConflict(conflict);
      ui.setPlacementTool(placement.tool);
      ui.setPlacementStopId(placement.stopId);
    },
    [plannerUiStore],
  );

  const editConflictArea = useCallback(
    (areaId: AvoidAreaId): void => {
      startTool("vertices", areaId);
      plannerUiStore.getState().setSheetDetent("expanded");
    },
    [plannerUiStore, startTool],
  );

  const startAreaEdit = useCallback(
    (
      editTool: "move" | "vertices",
      targetId: AvoidAreaId | null,
      pressed: Coordinate,
      ref: MapObjectRef | null,
    ): AvoidAreaGesture | null => {
      if (targetId === null) return null;
      if (ref === null || ref.kind !== "avoid-area" || ref.avoidAreaId !== targetId) {
        return null;
      }
      const rings = ringsByAreaId.get(targetId);
      if (rings === undefined || rings.length === 0) return null;
      if (editTool === "move") {
        return { kind: "move", areaId: targetId, rings, origin: pressed };
      }
      const handle = nearestVertexHandle(rings, pressed);
      if (handle === null) return null;
      return {
        kind: "vertex",
        areaId: targetId,
        rings,
        origin: pressed,
        ringIndex: handle.ringIndex,
        vertexIndex: handle.vertexIndex,
      };
    },
    [ringsByAreaId],
  );

  const areaPreview = useCallback(
    (gesture: AvoidAreaGesture, current: Coordinate): PreviewAreaScene => {
      if (gesture.kind === "rectangle") {
        const rings = [rectangleRing(gesture.origin, current)];
        return {
          rings,
          valid:
            validateAvoidAreaRings(rings, { minSpanMeters: MIN_AVOID_AREA_SPAN_METERS }) === null,
        };
      }
      const delta = deltaBetween(gesture.origin, current);
      if (gesture.kind === "move") {
        const rings = translateRings(gesture.rings, delta);
        return { rings, valid: validateAvoidAreaRings(rings) === null };
      }
      const vertex = gesture.rings[gesture.ringIndex]?.[gesture.vertexIndex];
      if (vertex === undefined) return { rings: gesture.rings, valid: false };
      const rings = moveRingVertex(gesture.rings, gesture.ringIndex, gesture.vertexIndex, {
        lon: vertex.lon + delta.lon,
        lat: vertex.lat + delta.lat,
      });
      return { rings, valid: validateAvoidAreaRings(rings) === null };
    },
    [],
  );

  const appendPolygonVertex = useCallback(
    (coordinate: Coordinate): void => {
      const ui = plannerUiStore.getState();
      const outcome = applyPolygonTap(
        ui.avoidAreaDraft,
        coordinate,
        lastPolygonTapRef.current,
        Date.now(),
      );
      if (outcome.kind === "vertex") {
        lastPolygonTapRef.current = outcome.lastTap;
        ui.setAvoidAreaDraft(outcome.vertices);
        ui.setAvoidAreaError(null);
        const ring = draftPreviewRing(outcome.vertices);
        ui.setAvoidAreaPreview(
          ring === null ? null : { rings: [ring], valid: validateAvoidAreaRings([ring]) === null },
        );
        return;
      }
      if (outcome.kind === "too-few") {
        ui.setAvoidAreaError(outcome.message);
        return;
      }
      lastPolygonTapRef.current = null;
      const closed = closePolygonDraft(outcome.vertices);
      if (closed.ring === null) {
        ui.setAvoidAreaError(closed.message);
        return;
      }
      void commitNewAvoidArea([closed.ring]);
    },
    [commitNewAvoidArea, plannerUiStore],
  );

  const commitAreaGesture = useCallback(
    (gesture: AvoidAreaGesture, release: Coordinate): void => {
      if (gesture.kind === "rectangle") {
        void commitNewAvoidArea([rectangleRing(gesture.origin, release)], {
          minSpanMeters: MIN_AVOID_AREA_SPAN_METERS,
        });
        return;
      }
      void commitAvoidAreaGeometry(gesture.areaId, areaPreview(gesture, release).rings);
    },
    [areaPreview, commitAvoidAreaGeometry, commitNewAvoidArea],
  );

  const clearGesture = useCallback((): void => {
    areaGestureRef.current = null;
  }, []);
  const cancelToolGesture = useCallback((): void => {
    areaGestureRef.current = null;
    lastPolygonTapRef.current = null;
  }, []);
  const beginPointerDown = useCallback(
    (coordinate: Coordinate, ref: MapObjectRef | null): boolean => {
      const ui = plannerUiStore.getState();
      if (ui.avoidAreaTool === "rectangle") {
        areaGestureRef.current = { kind: "rectangle", origin: coordinate };
        return true;
      }
      if (ui.avoidAreaTool === "move" || ui.avoidAreaTool === "vertices") {
        areaGestureRef.current = startAreaEdit(
          ui.avoidAreaTool,
          ui.avoidAreaTargetId,
          coordinate,
          ref,
        );
        return true;
      }
      return ui.avoidAreaTool === "polygon";
    },
    [plannerUiStore, startAreaEdit],
  );
  const previewPointerMove = useCallback(
    (coordinate: Coordinate): boolean => {
      const gesture = areaGestureRef.current;
      if (gesture === null) return false;
      plannerUiStore.getState().setAvoidAreaPreview(areaPreview(gesture, coordinate));
      return true;
    },
    [areaPreview, plannerUiStore],
  );
  const commitGesture = useCallback(
    (release: Coordinate | undefined): boolean => {
      const gesture = areaGestureRef.current;
      if (gesture === null) return false;
      areaGestureRef.current = null;
      plannerUiStore.getState().setAvoidAreaPreview(null);
      if (release !== undefined) commitAreaGesture(gesture, release);
      return true;
    },
    [commitAreaGesture, plannerUiStore],
  );

  const panelProps = useMemo<AvoidAreasPanelProjection>(
    () => ({
      rows,
      selectedAreaId:
        selectedObject?.kind === "avoid-area" ? selectedObject.avoidAreaId : null,
      tool,
      draftVertexCount: draft.length,
      error,
      onSelect: selectArea,
      onStartTool: startTool,
      onCloseDraft: closeDraft,
      onRemoveLastVertex: removeLastVertex,
      onCancelDraft: cancelDraft,
      onRename: renameArea,
      onSetEnabled: setAreaEnabled,
      onRemove: removeArea,
    }),
    [
      rows,
      selectedObject,
      tool,
      draft.length,
      error,
      selectArea,
      startTool,
      closeDraft,
      removeLastVertex,
      cancelDraft,
      renameArea,
      setAreaEnabled,
      removeArea,
    ],
  );

  return {
    tool,
    draft,
    error,
    preview,
    conflicts,
    rows,
    names,
    panelProps,
    moveConflictEndpoint,
    editConflictArea,
    clearGesture,
    cancelToolGesture,
    beginPointerDown,
    previewPointerMove,
    appendPolygonVertex,
    commitGesture,
  };
}
