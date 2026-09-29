"use client";

/**
 * Sketch projection and authoring for the planner.
 *
 * The draft remains in PlannerUiStore; completed traces reach RideDocument only
 * through the sketch commands and trigger planning from the applied revision.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import type { PreviewSketchScene } from "@/application/map/types";
import {
  authorSketch,
  clearSketchCommand,
  type SketchAuthoringResult,
} from "@/application/planner/sketch-authoring";
import {
  appendSketchPoint,
  beginSketchStroke,
  cancelSketchStroke,
  clearSketchDraft,
  finishSketchStroke,
  redoSketchStroke,
  sketchDraftIsEmpty,
  sketchDraftPreview,
  sketchDraftStrokes,
  undoSketchedStroke,
  type SketchDraftState,
} from "@/application/planner/sketch-draft";
import {
  isPlanningInFlight,
  nextPlacementTarget,
} from "@/application/planner/planner-view-model";
import {
  SKETCH_PREVIEW_SETTLE_MS,
  isSketchPreviewBundle,
  previewSketchIntent,
} from "@/application/planner/sketch-preview";
import { haversine } from "@/domain/geometry/analysis";
import type { GeometryRef } from "@/domain/ride/ids";
import { LOOP_CLOSE_METERS, type SketchEndpointPolicy } from "@/domain/sketch/types";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";
import type { SketchPanelProps } from "@/ui/planner/SketchPanel";

export type SketchPanelProjection = Omit<
  SketchPanelProps,
  "drawing" | "committed" | "hasAuthoredEndpoints"
>;

/** Where snap-as-you-go stands for the draft on screen (OGV-D-285). */
export type SketchSnapStatus = "snapping" | "snapped" | null;

export interface PlannerSketchAuthoring {
  readonly draft: SketchDraftState;
  readonly error: string | null;
  readonly endpointPolicy: SketchEndpointPolicy;
  readonly preview: PreviewSketchScene | null;
  readonly nearLoop: boolean | null;
  readonly panelProps: SketchPanelProjection;
  cancelInFlightStroke(): void;
  beginStroke(coordinate: Coordinate): void;
  appendPoint(coordinate: Coordinate): void;
  finishStroke(coordinate: Coordinate): void;
}

function sketchRefusalMessage(
  result: Exclude<SketchAuthoringResult, { readonly outcome: "applied" }>,
): string {
  switch (result.outcome) {
    case "rejected":
      return result.message;
    case "invalid":
      return `The sketch was refused (${result.code}).`;
    case "stale":
      return `The ride changed while you were drawing (revision ${result.currentRevision}), so the sketch was not saved.`;
  }
}

export function usePlannerSketch(input: {
  readonly document: RideDocument;
  readonly geometryStore: GeometryStore;
  readonly rideDocumentStore: RideDocumentStore;
  readonly planningSessionStore: PlanningSessionStore;
  readonly plannerUiStore: PlannerUiStore;
  readonly markRevisionAttempted: (revision: number) => void;
}): PlannerSketchAuthoring {
  const {
    document,
    geometryStore,
    rideDocumentStore,
    planningSessionStore,
    plannerUiStore,
    markRevisionAttempted,
  } = input;
  const draft = useStore(plannerUiStore, (state) => state.sketchDraft);
  const error = useStore(plannerUiStore, (state) => state.sketchError);
  const endpointPolicy = useStore(
    plannerUiStore,
    (state) => state.sketchEndpointPolicy,
  );
  const previewGenerations = useStore(plannerUiStore, (state) => state.sketchPreviewGenerations);
  const planning = useStore(planningSessionStore, (state) => state.snapshot);
  const snapStatus = useMemo<SketchSnapStatus>(() => {
    const latest = previewGenerations[previewGenerations.length - 1];
    if (latest === undefined) return null;
    if (planning.identity.planningGeneration === latest && isPlanningInFlight(planning.phase)) {
      return "snapping";
    }
    return isSketchPreviewBundle(planning.committedBundle ?? planning.lastGoodBundle, previewGenerations)
      ? "snapped"
      : null;
  }, [planning, previewGenerations]);

  /*
   * Snap-as-you-go (OGV-D-285): when the finger lifts and rests, the draft is
   * planned as the ride's sketch without authoring anything. The payloads each
   * preview stores are removed once the drawing ends either way.
   */
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRefs = useRef<GeometryRef[]>([]);
  const stopPreviewTimer = useCallback((): void => {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    previewTimer.current = null;
  }, []);
  const discardPreviewPayloads = useCallback((): void => {
    const refs = previewRefs.current;
    previewRefs.current = [];
    for (const ref of refs) void geometryStore.remove(ref);
  }, [geometryStore]);
  const schedulePreview = useCallback((): void => {
    stopPreviewTimer();
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      const ui = plannerUiStore.getState();
      const scheduled = ui.sketchDraft;
      if (ui.activeTool !== "sketch" || scheduled.active !== null) return;
      const strokes = sketchDraftStrokes(scheduled);
      if (strokes.length === 0) return;
      const current = rideDocumentStore.getState().document;
      void previewSketchIntent({
        document: current,
        strokes,
        endpointPolicy: ui.sketchEndpointPolicy,
        geometryStore,
      }).then((preview) => {
        if (preview === null) return;
        const now = plannerUiStore.getState();
        // The rider drew on, undid, or put the pen away while this was built.
        if (now.activeTool !== "sketch" || now.sketchDraft !== scheduled) {
          for (const ref of preview.geometryRefs) void geometryStore.remove(ref);
          return;
        }
        previewRefs.current.push(...preview.geometryRefs);
        const sessionStore = planningSessionStore.getState();
        void sessionStore.begin({
          rideId: current.rideId,
          rideRevision: current.revision,
          intent: preview.intent,
        });
        now.addSketchPreviewGeneration(
          planningSessionStore.getState().snapshot.identity.planningGeneration,
        );
      });
    }, SKETCH_PREVIEW_SETTLE_MS);
  }, [geometryStore, plannerUiStore, planningSessionStore, rideDocumentStore, stopPreviewTimer]);
  useEffect(() => stopPreviewTimer, [stopPreviewTimer]);

  const preview = useMemo(() => sketchDraftPreview(draft), [draft]);
  const nearLoop = useMemo(() => {
    const drawn = sketchDraftStrokes(draft);
    const firstStroke = drawn[0];
    const lastStroke = drawn[drawn.length - 1];
    const first = firstStroke?.[0];
    const last = lastStroke?.[lastStroke.length - 1];
    if (first === undefined || last === undefined) return null;
    return haversine(first, last) <= LOOP_CLOSE_METERS;
  }, [draft]);

  const startDrawing = useCallback((): void => {
    const ui = plannerUiStore.getState();
    if (ui.activeTool === "sketch") return;
    discardPreviewPayloads();
    ui.resetSketchPreviewGenerations();
    ui.setSketchEndpointPolicy(
      document.intent.start === null && document.intent.finish === null
        ? "derive"
        : "preserve-existing",
    );
    ui.setSketchTool(true);
  }, [discardPreviewPayloads, document, plannerUiStore]);
  /**
   * Extend: re-open the committed drawing with its own strokes in the draft, so
   * the next stroke carries on from its end (a stroke starting within 30 m of
   * it joins the same pass) and Done commits old and new as one sketch.
   */
  const extend = useCallback(async (): Promise<void> => {
    const sketch = document.intent.sketch;
    const ui = plannerUiStore.getState();
    if (sketch === null || ui.activeTool === "sketch") return;
    const records = await Promise.all(sketch.rawStrokeRefs.map((ref) => geometryStore.get(ref)));
    const strokes = records.flatMap((record) =>
      record !== null && record.payload.kind === "line" ? [record.payload.coordinates] : [],
    );
    if (strokes.length !== sketch.rawStrokeRefs.length) {
      ui.setSketchError("This drawing can't be reopened. Draw it again instead.");
      return;
    }
    discardPreviewPayloads();
    ui.resetSketchPreviewGenerations();
    ui.setSketchEndpointPolicy(sketch.endpointPolicy);
    ui.setSketchTool(true);
    ui.setSketchDraft({ strokes, active: null, undone: [] });
  }, [discardPreviewPayloads, document, geometryStore, plannerUiStore]);
  const undo = useCallback((): void => {
    const ui = plannerUiStore.getState();
    ui.setSketchDraft(undoSketchedStroke(ui.sketchDraft));
    schedulePreview();
  }, [plannerUiStore, schedulePreview]);
  const redo = useCallback((): void => {
    const ui = plannerUiStore.getState();
    ui.setSketchDraft(redoSketchStroke(ui.sketchDraft));
    schedulePreview();
  }, [plannerUiStore, schedulePreview]);
  const clear = useCallback((): void => {
    const ui = plannerUiStore.getState();
    if (!sketchDraftIsEmpty(ui.sketchDraft)) {
      ui.setSketchDraft(clearSketchDraft());
      ui.setSketchError(null);
      return;
    }
    if (document.intent.sketch === null) return;
    rideDocumentStore.getState().dispatch(clearSketchCommand(document));
    ui.setSketchError(null);
  }, [document, plannerUiStore, rideDocumentStore]);
  const done = useCallback(async (): Promise<void> => {
    stopPreviewTimer();
    const ui = plannerUiStore.getState();
    const strokes = sketchDraftStrokes(ui.sketchDraft);
    if (strokes.length === 0) {
      ui.setSketchError("Draw a line on the map first.");
      return;
    }
    const result = await authorSketch({
      document,
      strokes,
      endpointPolicy: ui.sketchEndpointPolicy,
      geometryStore,
      dispatch: (command) => rideDocumentStore.getState().dispatch(command),
    });
    if (result.outcome !== "applied") {
      ui.setSketchError(sketchRefusalMessage(result));
      return;
    }
    ui.setSketchError(null);
    ui.setSketchDraft(clearSketchDraft());
    ui.setSketchTool(false);
    discardPreviewPayloads();
    const applied = rideDocumentStore.getState().document;
    markRevisionAttempted(applied.revision);
    void planningSessionStore.getState().begin({
      rideId: applied.rideId,
      rideRevision: applied.revision,
      intent: applied.intent,
    });
  }, [
    discardPreviewPayloads,
    document,
    geometryStore,
    markRevisionAttempted,
    plannerUiStore,
    planningSessionStore,
    rideDocumentStore,
    stopPreviewTimer,
  ]);
  const cancel = useCallback((): void => {
    stopPreviewTimer();
    const ui = plannerUiStore.getState();
    const previewed = ui.sketchPreviewGenerations.length > 0;
    ui.setSketchDraft(clearSketchDraft());
    ui.setSketchTool(false);
    ui.setSketchError(null);
    discardPreviewPayloads();
    // The answer on screen planned the abandoned drawing; the ride's own answer
    // is asked for again. A ride with nothing to plan just shows none.
    if (previewed && (document.intent.sketch !== null || nextPlacementTarget(document) === null)) {
      void planningSessionStore.getState().begin({
        rideId: document.rideId,
        rideRevision: document.revision,
        intent: document.intent,
      });
    }
  }, [discardPreviewPayloads, document, plannerUiStore, planningSessionStore, stopPreviewTimer]);
  const toggleEndpoints = useCallback(
    (keep: boolean): void => {
      plannerUiStore
        .getState()
        .setSketchEndpointPolicy(keep ? "preserve-existing" : "derive");
    },
    [plannerUiStore],
  );
  const cancelInFlightStroke = useCallback((): void => {
    const ui = plannerUiStore.getState();
    ui.setSketchDraft(cancelSketchStroke(ui.sketchDraft));
  }, [plannerUiStore]);
  const beginStroke = useCallback(
    (coordinate: Coordinate): void => {
      stopPreviewTimer();
      const ui = plannerUiStore.getState();
      ui.setSketchDraft(beginSketchStroke(ui.sketchDraft, coordinate));
      ui.setSketchError(null);
    },
    [plannerUiStore, stopPreviewTimer],
  );
  const appendPoint = useCallback(
    (coordinate: Coordinate): void => {
      const ui = plannerUiStore.getState();
      ui.setSketchDraft(appendSketchPoint(ui.sketchDraft, coordinate));
    },
    [plannerUiStore],
  );
  const finishStroke = useCallback(
    (coordinate: Coordinate): void => {
      const ui = plannerUiStore.getState();
      ui.setSketchDraft(finishSketchStroke(ui.sketchDraft, coordinate));
      schedulePreview();
    },
    [plannerUiStore, schedulePreview],
  );

  const panelProps = useMemo<SketchPanelProjection>(
    () => ({
      draft,
      endpointPolicy,
      nearLoop,
      error,
      snapStatus,
      onStartDrawing: startDrawing,
      onExtend: () => void extend(),
      onUndo: undo,
      onRedo: redo,
      onClear: clear,
      onDone: () => void done(),
      onCancel: cancel,
      onToggleEndpoints: toggleEndpoints,
    }),
    [
      draft,
      endpointPolicy,
      nearLoop,
      error,
      snapStatus,
      startDrawing,
      extend,
      undo,
      redo,
      clear,
      done,
      cancel,
      toggleEndpoints,
    ],
  );

  return {
    draft,
    error,
    endpointPolicy,
    preview,
    nearLoop,
    panelProps,
    cancelInFlightStroke,
    beginStroke,
    appendPoint,
    finishStroke,
  };
}
