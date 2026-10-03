"use client";

/**
 * Road-span projection, pointer editing and typed authoring for the planner.
 *
 * Draft selection stays in PlannerUiStore; committed spans reach RideDocument
 * only through the road-span authoring commands.
 */

import { useCallback, useMemo, useRef } from "react";
import { useStore } from "zustand";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { MapScene, PreviewRoadSpanScene, MapObjectRef } from "@/application/map/types";
import type { GeometryPayload } from "@/domain/geometry/types";
import {
  authorRoadSpan,
  flipRoadSpanModeCommand,
  removeRoadSpanCommand,
  type RoadSpanAuthoringResult,
} from "@/application/planner/road-span-authoring";
import {
  beginRoadSpanDraft,
  moveSpanHandle,
  nearestHandle,
  spanDraftAnchors,
  spanDraftGeometry,
  spanDirectionFor,
  type RoadSpanDraft,
  type RoadSpanHandle,
} from "@/application/planner/road-span-draft";
import { buildRoadSpanStatusRows } from "@/application/planner/road-span-status";
import { roadStretchAt } from "@/application/planner/road-stretch";
import { objectExtent } from "@/application/map/build-map-scene";
import type { RoadOpeningSummary } from "@/application/route-intelligence/opening-calendar-contract";
import type { RouteInstruction } from "@/domain/route/types";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { RoadSpanMode } from "@/domain/road/spans";
import type { RoadSpanId } from "@/domain/ride/ids";
import type { RoadSpansPanelProps } from "@/ui/planner/RoadSpansPanel";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

export type RoadSpansPanelProjection = Omit<RoadSpansPanelProps, "onZoomTo">;

interface ActiveRoute {
  readonly routeId: string;
  readonly geometry: readonly Coordinate[];
  readonly instructions?: readonly RouteInstruction[];
}

/** "Avoid this road" for the road under a tap on the route (NV-14). */
export interface RoadTapOffer {
  /** The road's name, or null for an unnamed stretch. */
  readonly roadName: string | null;
  readonly onAvoid: () => void;
  readonly onDismiss: () => void;
}

interface RoadSpanGesture {
  readonly routeId: string;
  readonly handle: RoadSpanHandle;
}

export interface PlannerRoadSpansAuthoring {
  readonly draft: RoadSpanDraft | null;
  readonly error: string | null;
  readonly preview: PreviewRoadSpanScene | null;
  readonly panelProps: RoadSpansPanelProjection;
  readonly roadTap: RoadTapOffer | null;
  routeThrough(road: RoadOpeningSummary): Promise<void>;
  zoomTo(spanId: RoadSpanId, scene: MapScene): void;
  clearGesture(): void;
  beginPointerDown(coordinate: Coordinate): void;
  previewPointerMove(coordinate: Coordinate): boolean;
  commitGesture(release: Coordinate | undefined): void;
}

function draftLineFor(
  draft: RoadSpanDraft,
  activeRoute: ActiveRoute | null,
): readonly Coordinate[] {
  if (activeRoute === null || draft.routeId !== activeRoute.routeId) return [];
  return activeRoute.geometry;
}

function roadSpanRefusalMessage(
  result: Exclude<RoadSpanAuthoringResult, { readonly outcome: "applied" }>,
): string {
  switch (result.outcome) {
    case "rejected":
      return result.message;
    case "invalid":
      return `The road span was refused (${result.code}).`;
    case "stale":
      return `The ride changed while the span was being selected (revision ${result.currentRevision}), so it was not saved.`;
  }
}

export function usePlannerRoadSpans(input: {
  readonly document: RideDocument;
  readonly activeRoute: ActiveRoute | null;
  readonly activeRouteLine: readonly Coordinate[];
  readonly readGeometry: (
    ref: RideDocument["intent"]["roadSpans"][number]["geometryRef"],
  ) => GeometryPayload | null;
  readonly geometryStore: GeometryStore;
  readonly selectedObject: MapObjectRef | null;
  readonly activeTool: string;
  readonly rideDocumentStore: RideDocumentStore;
  readonly plannerUiStore: PlannerUiStore;
}): PlannerRoadSpansAuthoring {
  const {
    document,
    activeRoute,
    activeRouteLine,
    readGeometry,
    geometryStore,
    selectedObject,
    activeTool,
    rideDocumentStore,
    plannerUiStore,
  } = input;
  const draft = useStore(plannerUiStore, (state) => state.roadSpanDraft);
  const error = useStore(plannerUiStore, (state) => state.roadSpanError);
  const routeTap = useStore(plannerUiStore, (state) => state.routeTap);
  const gestureRef = useRef<RoadSpanGesture | null>(null);

  const rows = useMemo(
    () =>
      buildRoadSpanStatusRows({
        spans: document.intent.roadSpans,
        routeGeometry: activeRouteLine,
        readGeometry,
      }),
    [document.intent.roadSpans, activeRouteLine, readGeometry],
  );
  const draftGeometry = useMemo(
    () => (draft === null ? [] : spanDraftGeometry(draft, activeRouteLine)),
    [draft, activeRouteLine],
  );
  const preview = useMemo<PreviewRoadSpanScene | null>(() => {
    if (draft === null || draft.routeId !== activeRoute?.routeId) return null;
    if (draftGeometry.length < 2) return null;
    const start = draftGeometry[0];
    const end = draftGeometry[draftGeometry.length - 1];
    if (start === undefined || end === undefined) return null;
    return {
      geometry: draftGeometry,
      direction: spanDirectionFor(draft, activeRouteLine),
      start: { lon: start.lon, lat: start.lat },
      end: { lon: end.lon, lat: end.lat },
    };
  }, [draft, draftGeometry, activeRouteLine, activeRoute]);

  const clearGesture = useCallback((): void => {
    gestureRef.current = null;
  }, []);
  const beginPointerDown = useCallback(
    (coordinate: Coordinate): void => {
      if (activeRoute === null || activeRoute.geometry.length < 2) return;
      const ui = plannerUiStore.getState();
      const current = ui.roadSpanDraft;
      if (current !== null && current.routeId === activeRoute.routeId) {
        const handle = nearestHandle(current, activeRoute.geometry, coordinate);
        gestureRef.current = { routeId: activeRoute.routeId, handle };
        ui.setRoadSpanDraft(
          moveSpanHandle(current, activeRoute.geometry, handle, coordinate),
        );
      } else {
        const nextDraft = beginRoadSpanDraft(
          activeRoute.routeId,
          activeRoute.geometry,
          coordinate,
        );
        gestureRef.current =
          nextDraft === null ? null : { routeId: activeRoute.routeId, handle: "end" };
        ui.setRoadSpanDraft(nextDraft);
      }
      ui.setRoadSpanError(null);
    },
    [activeRoute, plannerUiStore],
  );
  const previewPointerMove = useCallback(
    (coordinate: Coordinate): boolean => {
      const gesture = gestureRef.current;
      if (gesture === null) return false;
      const ui = plannerUiStore.getState();
      const current = ui.roadSpanDraft;
      if (current !== null) {
        ui.setRoadSpanDraft(
          moveSpanHandle(
            current,
            draftLineFor(current, activeRoute),
            gesture.handle,
            coordinate,
          ),
        );
      }
      return true;
    },
    [activeRoute, plannerUiStore],
  );
  const commitGesture = useCallback(
    (release: Coordinate | undefined): void => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      const ui = plannerUiStore.getState();
      const current = ui.roadSpanDraft;
      if (gesture !== null && current !== null && release !== undefined) {
        ui.setRoadSpanDraft(
          moveSpanHandle(
            current,
            draftLineFor(current, activeRoute),
            gesture.handle,
            release,
          ),
        );
      }
    },
    [activeRoute, plannerUiStore],
  );

  const startSelecting = useCallback((): void => {
    const ui = plannerUiStore.getState();
    gestureRef.current = null;
    ui.setRoadSpanDraft(null);
    ui.setRoadSpanError(null);
    ui.setRoadSpanSelecting(true);
  }, [plannerUiStore]);
  const selectWholeRoute = useCallback((): void => {
    const ui = plannerUiStore.getState();
    if (activeRoute === null || activeRoute.geometry.length < 2) {
      ui.setRoadSpanError("Plan a route first — there is nothing to select yet.");
      return;
    }
    gestureRef.current = null;
    ui.setRoadSpanSelecting(true);
    ui.setRoadSpanDraft({
      routeId: activeRoute.routeId,
      startIndex: 0,
      endIndex: activeRoute.geometry.length - 1,
    });
    ui.setRoadSpanError(null);
  }, [activeRoute, plannerUiStore]);
  const cancelDraft = useCallback((): void => {
    gestureRef.current = null;
    const ui = plannerUiStore.getState();
    ui.setRoadSpanDraft(null);
    ui.setRoadSpanError(null);
    ui.setRoadSpanSelecting(false);
  }, [plannerUiStore]);
  const commitDraft = useCallback(
    async (current: RoadSpanDraft, mode: RoadSpanMode): Promise<void> => {
      const ui = plannerUiStore.getState();
      const geometry = spanDraftGeometry(current, activeRouteLine);
      const anchors = spanDraftAnchors(current, activeRouteLine);
      const result = await authorRoadSpan({
        document,
        geometry,
        anchors,
        direction: spanDirectionFor(current, activeRouteLine),
        mode,
        geometryStore,
        dispatch: (command) => rideDocumentStore.getState().dispatch(command),
      });
      if (result.outcome !== "applied") {
        ui.setRoadSpanError(roadSpanRefusalMessage(result));
        return;
      }
      ui.setRoadSpanError(null);
      ui.setRoadSpanDraft(null);
      ui.setRoadSpanSelecting(false);
      ui.selectObject({ kind: "road-span", roadSpanId: result.spanId });
    },
    [activeRouteLine, document, geometryStore, plannerUiStore, rideDocumentStore],
  );
  const commit = useCallback(
    async (mode: RoadSpanMode): Promise<void> => {
      const current = plannerUiStore.getState().roadSpanDraft;
      if (current === null) return;
      await commitDraft(current, mode);
    },
    [commitDraft, plannerUiStore],
  );

  // One tap on the selected route offers the road under it; one more avoids it.
  const stretch = useMemo(
    () =>
      routeTap === null || activeRoute === null || routeTap.routeId !== activeRoute.routeId
        ? null
        : roadStretchAt(activeRoute.routeId, activeRoute.geometry, activeRoute.instructions, routeTap.coordinate),
    [routeTap, activeRoute],
  );
  const roadTap = useMemo<RoadTapOffer | null>(() => {
    if (stretch === null || activeTool === "road-span-select") return null;
    return {
      roadName: stretch.roadName,
      onAvoid: (): void => {
        plannerUiStore.getState().setRouteTap(null);
        void commitDraft(stretch.draft, "avoid");
      },
      onDismiss: (): void => plannerUiStore.getState().setRouteTap(null),
    };
  }, [stretch, activeTool, commitDraft, plannerUiStore]);
  const select = useCallback(
    (spanId: RoadSpanId): void => {
      plannerUiStore.getState().selectObject({ kind: "road-span", roadSpanId: spanId });
    },
    [plannerUiStore],
  );
  const flipMode = useCallback(
    (spanId: RoadSpanId): void => {
      const command = flipRoadSpanModeCommand(document, spanId);
      if (command === null) return;
      rideDocumentStore.getState().dispatch(command);
    },
    [document, rideDocumentStore],
  );
  const remove = useCallback(
    (spanId: RoadSpanId): void => {
      const ui = plannerUiStore.getState();
      rideDocumentStore.getState().dispatch(removeRoadSpanCommand(document, spanId));
      if (selectedObject?.kind === "road-span" && selectedObject.roadSpanId === spanId) {
        ui.selectObject(null);
      }
    },
    [document, plannerUiStore, rideDocumentStore, selectedObject],
  );

  const routeThrough = useCallback(async (road: RoadOpeningSummary): Promise<void> => {
    if (road.line === undefined || road.line.length < 2) throw new Error("This road has no published line to route through.");
    const outcome = await authorRoadSpan({
      document: rideDocumentStore.getState().document,
      geometryStore,
      geometry: road.line,
      anchors: [road.line[0]!, road.line.at(-1)!],
      mode: "prefer",
      direction: "either",
      label: `Route through ${road.roadName ?? "seasonal road"}`,
      dispatch: rideDocumentStore.getState().dispatch,
    });
    if (outcome.outcome !== "applied") throw new Error("The road could not be added. Try again with the current ride.");
  }, [geometryStore, rideDocumentStore]);

  const zoomTo = useCallback((spanId: RoadSpanId, scene: MapScene): void => {
    const ui = plannerUiStore.getState();
    ui.selectObject({ kind: "road-span", roadSpanId: spanId });
    ui.requestFit(objectExtent(scene, { kind: "road-span", roadSpanId: spanId }));
  }, [plannerUiStore]);

  const panelProps = useMemo<RoadSpansPanelProjection>(
    () => ({
      rows,
      selectedSpanId:
        selectedObject?.kind === "road-span" ? selectedObject.roadSpanId : null,
      selecting: activeTool === "road-span-select",
      draft,
      draftVertexCount: draftGeometry.length,
      draftDirection:
        draft === null || draftGeometry.length < 2
          ? null
          : spanDirectionFor(draft, activeRouteLine),
      error,
      onSelect: select,
      onStartSelecting: startSelecting,
      onSelectWholeRoute: selectWholeRoute,
      onCancelDraft: cancelDraft,
      onCommit: commit,
      onFlipMode: flipMode,
      onRemove: remove,
    }),
    [
      rows,
      selectedObject,
      activeTool,
      draft,
      draftGeometry.length,
      activeRouteLine,
      error,
      select,
      startSelecting,
      selectWholeRoute,
      cancelDraft,
      commit,
      flipMode,
      remove,
    ],
  );

  return {
    draft,
    error,
    preview,
    panelProps,
    roadTap,
    routeThrough,
    zoomTo,
    clearGesture,
    beginPointerDown,
    previewPointerMove,
    commitGesture,
  };
}
