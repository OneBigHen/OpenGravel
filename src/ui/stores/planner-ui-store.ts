/**
 * The `PlannerUiState` container (02-ARCHITECTURE-CONTRACT §3, §8; 05 §4–§5, §8;
 * 04 §2).
 *
 * Presentation state only: which pointer tool owns interaction, which placement
 * the rider armed, whether the rider has taken camera control, which object is
 * selected, how tall the compact sheet is, and the measured camera insets. It may
 * reference domain IDs but never duplicates a mutable domain object, and it is
 * never a path into the ride document — a selection changes what is highlighted,
 * not what is authored.
 *
 * Two tool-ish fields are deliberately separate, because they answer different
 * questions:
 *
 * - `activeTool` is 05 §4's pointer tool: the thing that owns the pointer stream
 *   and decides what a drag means. It is `pan` in normal use.
 * - `placementTool` is OGV-D-213's armed placement: the thing that decides what
 *   the *next tap* authors. It is one-shot, and an unarmed tap is authored from
 *   the ride's own state.
 *
 * They are one *source of truth*, not one field: the map receives `activeTool`
 * and nothing else (4.0 review finding 5), so no component derives a pointer tool
 * of its own. Arming a placement does not change the pointer tool, and that is
 * deliberate — a placement is a **tap**, which is exactly what the neutral `pan`
 * tool produces; a drawing tool needs movement and would swallow the tap. Escape
 * clears both, in one place (`cancelPlacement`), because a rider who escaped an
 * armed placement must not still be holding it.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type { MapExtent } from "@/application/map/build-map-scene";
import type { PointerTool } from "@/application/map/interaction";
import type { MapInsets } from "@/application/map/insets";
import type { MapLoadStatus, MapRenderError } from "@/application/map/map-host";
import { EMPTY_SKETCH_DRAFT, type SketchDraftState } from "@/application/planner/sketch-draft";
import type { RoadSpanDraft } from "@/application/planner/road-span-draft";
import type { MapObjectRef, PreviewAreaScene, PreviewPointScene } from "@/application/map/types";
import type { AvoidAreaId, StopId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import type { SketchEndpointPolicy } from "@/domain/sketch/types";

/**
 * The armed placement (OGV-D-213). `idle` means the next tap is authored from
 * the ride's own state: the missing point if there is one, a selection if not.
 *
 * `place-stop` covers both stop placements 04 §15 names: with no
 * `placementStopId` the next tap **inserts** a stop (after the selected one, else
 * at the end), and with one it **replaces** that stop's place (`stop.move`).
 */
export type PlacementTool = "idle" | "place-start" | "place-finish" | "place-stop";

/**
 * An explicit one-shot fit request (04 §15 "zoom to", 04 §21 failure framing),
 * addressed by a token so asking for the same view twice moves the camera twice.
 *
 * The extent is decided by the workspace — the only layer that can turn an object
 * reference or a phase into a bounding box — and `null` means "frame the whole
 * scene", which is what a failed attempt wants: the authored points are the ride
 * that is left when no route answers.
 */
export interface FitRequest {
  readonly token: number;
  readonly extent: MapExtent | null;
}

/**
 * The armed avoid-area tool (04 §18), or `idle`.
 *
 * One field holds both halves of the avoid-area workflow because they are one
 * question — "what does the next pointer gesture mean?" — and splitting them
 * would let the two answers disagree:
 *
 * - `rectangle` and `polygon` **author** a new area (the target is `null`);
 * - `move` and `vertices` **edit** the area named by `avoidAreaTargetId`;
 * - `idle` means neither, and the pointer tool is the neutral `pan`.
 *
 * Arming one sets {@link PlannerUiState.activeTool} for it, because the pointer
 * tool is what the renderer disables its own camera gestures with (05 §4): a
 * rectangle drag must not pan the map, and neither may a vertex drag.
 */
export type AvoidAreaTool = "idle" | "rectangle" | "polygon" | "move" | "vertices";

/** The pointer tool each avoid-area tool needs, and `pan` when idle. */
export function pointerToolForAvoidArea(tool: AvoidAreaTool): PointerTool {
  switch (tool) {
    case "idle":
      return "pan";
    case "rectangle":
    case "polygon":
      return "avoid-area";
    case "move":
    case "vertices":
      return "polygon-edit";
  }
}

/** The two visible heights of the compact sheet (04 §2, task 4.0). */
/**
 * Phone sheet heights: `peek` is the composer; `ride` (UX rework 2, #8) is a
 * planned ride at a glance (the chosen route in one line and Start ride) so
 * the map keeps most of the screen; `expanded` is everything, scrolling.
 */
export type SheetDetent = "peek" | "ride" | "expanded";

/** A tap on the selected route: which route, and where on the map. */
export interface RouteTap {
  readonly routeId: string;
  readonly coordinate: Coordinate;
}

export interface PlannerUiState {
  readonly activeTool: PointerTool;
  readonly placementTool: PlacementTool;
  /** True once the rider has panned or zoomed: automatic fit suspends (05 §8). */
  readonly cameraUserOwned: boolean;
  /** The measured camera-fit insets of the current composition (05 §9). */
  readonly insets: MapInsets;
  readonly sheetDetent: SheetDetent;
  /**
   * The route candidates under the last overlapping tap (05 §6). Recorded, never
   * resolved by pixel order: the compact chooser that consumes this list is its
   * own task, and until then the selection is left alone rather than guessed.
   */
  readonly overlapCandidates: readonly MapObjectRef[];
  /** Where the overlapping tap landed, so a route chosen from it can offer its road. */
  readonly overlapAt: Coordinate | null;
  /**
   * Where the rider last tapped the selected route (NV-14), so the sheet can
   * offer "Avoid this road" for the road under it. Any other selection clears it.
   */
  readonly routeTap: RouteTap | null;
  readonly hoveredObject: MapObjectRef | null;
  readonly selectedObject: MapObjectRef | null;
  /** The stop a `place-stop` tap replaces, or `null` to insert a new one. */
  readonly placementStopId: StopId | null;
  /** The in-flight drag ghost (04 §15), or `null` when no point is dragged. */
  readonly dragPreview: PreviewPointScene | null;
  /**
   * The last renderer failure the map host reported (05 §22; 4.0 review finding
   * 1), or `null` while the renderer is healthy. The map keeps working — the
   * notice is bounded and the ride is unaffected.
   */
  readonly renderError: MapRenderError | null;
  /**
   * The map's load health (4.0s), straight from the host's own report.
   *
   * `loading` | `ready` | `retrying` | `failed`, plus the reason while it is
   * pending or dead. It is what lets the sheet say "the map didn't load" and
   * offer the one action that helps, instead of leaving a blank canvas unexplained.
   */
  readonly mapLoadStatus: MapLoadStatus;
  /**
   * How many times the rider has asked for a map recovery (4.0s).
   *
   * A counter rather than a callback, exactly like the fit request token: the
   * surface owns the host, so the workspace asks by bumping this and the map
   * component relays it to the one live host.
   */
  readonly mapRetryToken: number;
  /** The pending one-shot fit request, or `null` (04 §15, §21). */
  readonly fitRequest: FitRequest | null;
  readonly setActiveTool: (tool: PointerTool) => void;
  readonly setPlacementTool: (tool: PlacementTool) => void;
  readonly setPlacementStopId: (stopId: StopId | null) => void;
  readonly setDragPreview: (preview: PreviewPointScene | null) => void;
  /**
   * The armed avoid-area tool, and the area it edits when it edits one (04 §18).
   * Arming also sets `activeTool`, so the pointer tool the renderer hears and the
   * tool the workspace acts on can never disagree.
   */
  readonly avoidAreaTool: AvoidAreaTool;
  readonly avoidAreaTargetId: AvoidAreaId | null;
  readonly setAvoidAreaTool: (tool: AvoidAreaTool, targetId?: AvoidAreaId | null) => void;
  /** The polygon draft's vertices, in tap order; empty when nothing is drafted. */
  readonly avoidAreaDraft: readonly Coordinate[];
  readonly setAvoidAreaDraft: (vertices: readonly Coordinate[]) => void;
  readonly popAvoidAreaVertex: () => void;
  readonly clearAvoidAreaDraft: () => void;
  /** The ring validator's refusal, shown in the panel, or `null`. */
  readonly avoidAreaError: string | null;
  readonly setAvoidAreaError: (message: string | null) => void;
  /** The in-flight avoid-area gesture, drawn from its own scene source. */
  readonly avoidAreaPreview: PreviewAreaScene | null;
  readonly setAvoidAreaPreview: (preview: PreviewAreaScene | null) => void;
  /**
   * The in-flight road-span selection (04 §17, 05 §20), or `null`.
   *
   * Presentation state exactly like the avoid-area draft: it holds a route
   * identity and an index range into that route's returned line — never a
   * coordinate — so a redrawn route either still names a vertex or is out of
   * range, and nothing dispatches until one of the three action-bar actions
   * commits it.
   */
  readonly roadSpanDraft: RoadSpanDraft | null;
  readonly setRoadSpanDraft: (draft: RoadSpanDraft | null) => void;
  /** The span validator's refusal, shown in the panel, or `null`. */
  readonly roadSpanError: string | null;
  readonly setRoadSpanError: (message: string | null) => void;
  /**
   * The drawing draft (04 §19, 05 §18), or the resting empty draft.
   *
   * Presentation state exactly like the avoid-area draft and the span selection:
   * it holds coordinates the rider is drawing right now, it is never part of the
   * document, and nothing dispatches until `Done` commits it as **one**
   * `sketch.commit`. A pointer move writes this — and only this — which is what
   * keeps drawing a local visual update (05 §18).
   */
  readonly sketchDraft: SketchDraftState;
  readonly setSketchDraft: (draft: SketchDraftState) => void;
  /**
   * How the committed sketch treats the ride's authored endpoints (03 §13).
   * `derive` takes both from the trace; `preserve-existing` keeps the authored
   * ones and only fills a missing endpoint from the drawing.
   */
  readonly sketchEndpointPolicy: SketchEndpointPolicy;
  readonly setSketchEndpointPolicy: (policy: SketchEndpointPolicy) => void;
  /** The sketch validator's refusal, shown in the panel, or `null`. */
  readonly sketchError: string | null;
  readonly setSketchError: (message: string | null) => void;
  /**
   * The planning generations that planned the draft while the pen was armed
   * (snap-as-you-go, OGV-D-285). A bundle from one of them is a preview: shown
   * only while drawing, never rideable. Reset when a new drawing starts.
   */
  readonly sketchPreviewGenerations: readonly number[];
  readonly addSketchPreviewGeneration: (generation: number) => void;
  readonly resetSketchPreviewGenerations: () => void;
  /**
   * Arming and disarming the `sketch` pointer tool (05 §4, §18, §19).
   *
   * Arming sets {@link PlannerUiState.activeTool} so the renderer disables its own
   * camera gestures for the duration of the drawing, and it retires the other
   * gesture owners for the same reason {@link PlannerUiState.setRoadSpanSelecting}
   * does: exactly one thing may own the next drag. Disarming drops the draft, since
   * a draft nothing is armed to commit is a stale affordance — the committed sketch
   * is untouched and stays on the map.
   */
  readonly setSketchTool: (active: boolean) => void;
  /**
   * Arming and disarming the `road-span-select` pointer tool (05 §4, §20).
   *
   * Arming sets {@link PlannerUiState.activeTool} so the renderer disables its own
   * camera gestures for the duration of the selection, and it retires the other
   * gesture owners for the same reason {@link PlannerUiState.setAvoidAreaTool}
   * does: exactly one thing may own the next drag.
   */
  readonly setRoadSpanSelecting: (active: boolean) => void;
  /**
   * Escape, in one place (05 §4; 4.0 review finding 5): the workspace stops
   * owning the next tap, the drag ghost goes, and the pointer tool returns to the
   * neutral one. The host is told separately so an in-flight gesture is dropped.
   */
  readonly cancelPlacement: () => void;
  readonly setRenderError: (error: MapRenderError | null) => void;
  /**
   * The host's load report (4.0s). An unchanged state and reason writes nothing,
   * so a renderer that repeats itself cannot thrash the sheet.
   */
  readonly setMapLoadStatus: (status: MapLoadStatus) => void;
  /** The rider's "Retry map": one more attempt, relayed to the map component. */
  readonly requestMapRetry: () => void;
  readonly requestFit: (extent: MapExtent | null) => void;
  readonly clearFitRequest: () => void;
  readonly setCameraUserOwned: (owned: boolean) => void;
  readonly setInsets: (insets: MapInsets) => void;
  readonly setSheetDetent: (detent: SheetDetent) => void;
  /**
   * The handle: up opens everything; down returns to the ride at a glance
   * when there is a ride (`hasRide`), and to the composer when there is not.
   */
  readonly toggleSheet: (hasRide: boolean) => void;
  readonly setOverlapCandidates: (candidates: readonly MapObjectRef[], at?: Coordinate | null) => void;
  readonly setRouteTap: (tap: RouteTap | null) => void;
  readonly setHoveredObject: (ref: MapObjectRef | null) => void;
  readonly selectObject: (ref: MapObjectRef | null) => void;
}

/** Read-only store surface: presentation transitions are the exposed actions. */
export type PlannerUiStore = Pick<
  StoreApi<PlannerUiState>,
  "getState" | "getInitialState" | "subscribe"
>;

export interface PlannerUiStoreOptions {
  readonly activeTool?: PointerTool;
  readonly placementTool?: PlacementTool;
  readonly insets?: MapInsets;
  readonly sheetDetent?: SheetDetent;
}

/** The zero insets a composition has before it has been measured. */
export const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function sameInsets(a: MapInsets, b: MapInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

export function createPlannerUiStore(
  options: PlannerUiStoreOptions = {},
): PlannerUiStore {
  const store = createStore<PlannerUiState>((set, get) => ({
    // 05 §4: pan is the neutral tool; the drawing tools are armed by later waves.
    activeTool: options.activeTool ?? "pan",
    // 04 §3, OGV-D-213: first-open arms nothing. A tap on the empty map is
    // authored as a start because the ride has no start — not because a tool was
    // pre-armed — so the composer's disabled reason stays the only instruction.
    placementTool: options.placementTool ?? "idle",
    // 05 §8: the camera is auto-fit's until the rider takes it.
    cameraUserOwned: false,
    insets: options.insets ?? NO_INSETS,
    sheetDetent: options.sheetDetent ?? "peek",
    overlapCandidates: [],
    overlapAt: null,
    routeTap: null,
    hoveredObject: null,
    selectedObject: null,
    placementStopId: null,
    dragPreview: null,
    renderError: null,
    // The map has not reported yet, so the honest default is "still coming" — the
    // host replays its own state at subscription time, which is what replaces it.
    mapLoadStatus: { state: "loading", reason: null },
    mapRetryToken: 0,
    fitRequest: null,
    setActiveTool: (tool: PointerTool): void => set({ activeTool: tool }),
    setPlacementTool: (tool: PlacementTool): void =>
      set((state) => ({
        placementTool: tool,
        // The stop identity belongs to exactly one mode: leaving `place-stop`
        // clears it, so a later "add stop" can never silently move a stop.
        placementStopId: tool === "place-stop" ? state.placementStopId : null,
        // Arming a placement retires the avoid-area tools: they both own the next
        // pointer gesture, and two owners is how a drag becomes ambiguous.
        ...(tool === "idle"
          ? {}
          : {
              avoidAreaTool: "idle" as const,
              avoidAreaTargetId: null,
              avoidAreaPreview: null,
              // …and the road-span selection, for the same reason.
              roadSpanDraft: null,
              roadSpanError: null,
            }),
      })),
    setPlacementStopId: (stopId: StopId | null): void => set({ placementStopId: stopId }),
    setDragPreview: (preview: PreviewPointScene | null): void => set({ dragPreview: preview }),
    // 04 §18: authoring is armed, and arming is what decides the pointer tool.
    avoidAreaTool: "idle",
    avoidAreaTargetId: null,
    setAvoidAreaTool: (tool: AvoidAreaTool, targetId: AvoidAreaId | null = null): void =>
      set({
        avoidAreaTool: tool,
        avoidAreaTargetId: tool === "move" || tool === "vertices" ? targetId : null,
        activeTool: pointerToolForAvoidArea(tool),
        // Arming an avoid-area tool retires the armed placement, for the same
        // reason as the reverse: exactly one thing owns the next gesture. The
        // road-span selection goes with it.
        ...(tool === "idle"
          ? {}
          : {
              placementTool: "idle" as const,
              placementStopId: null,
              roadSpanDraft: null,
              roadSpanError: null,
            }),
        // Leaving the draft tools retires the draft: a rectangle drag must not
        // inherit half a polygon, and an edit must not inherit a new area.
        ...(tool === "polygon" ? {} : { avoidAreaDraft: [] }),
        ...(tool === "idle" ? { avoidAreaPreview: null } : {}),
      }),
    avoidAreaDraft: [],
    setAvoidAreaDraft: (vertices: readonly Coordinate[]): void =>
      set({ avoidAreaDraft: vertices }),
    popAvoidAreaVertex: (): void =>
      set((state) => ({ avoidAreaDraft: state.avoidAreaDraft.slice(0, -1) })),
    clearAvoidAreaDraft: (): void => set({ avoidAreaDraft: [], avoidAreaPreview: null }),
    avoidAreaError: null,
    setAvoidAreaError: (message: string | null): void => set({ avoidAreaError: message }),
    avoidAreaPreview: null,
    setAvoidAreaPreview: (preview: PreviewAreaScene | null): void =>
      set({ avoidAreaPreview: preview }),
    roadSpanDraft: null,
    setRoadSpanDraft: (draft: RoadSpanDraft | null): void => set({ roadSpanDraft: draft }),
    roadSpanError: null,
    setRoadSpanError: (message: string | null): void => set({ roadSpanError: message }),
    sketchDraft: EMPTY_SKETCH_DRAFT,
    setSketchDraft: (draft: SketchDraftState): void => set({ sketchDraft: draft }),
    sketchEndpointPolicy: "derive",
    setSketchEndpointPolicy: (policy: SketchEndpointPolicy): void =>
      set({ sketchEndpointPolicy: policy }),
    sketchError: null,
    setSketchError: (message: string | null): void => set({ sketchError: message }),
    sketchPreviewGenerations: [],
    addSketchPreviewGeneration: (generation: number): void =>
      set({ sketchPreviewGenerations: [...get().sketchPreviewGenerations, generation] }),
    resetSketchPreviewGenerations: (): void => set({ sketchPreviewGenerations: [] }),
    setSketchTool: (active: boolean): void =>
      set({
        activeTool: active ? "sketch" : "pan",
        sketchDraft: active ? get().sketchDraft : EMPTY_SKETCH_DRAFT,
        sketchError: null,
        // Arming the pen retires every other gesture owner: exactly one thing may
        // own the next drag (05 §4).
        ...(active
          ? {
              placementTool: "idle" as const,
              placementStopId: null,
              avoidAreaTool: "idle" as const,
              avoidAreaTargetId: null,
              avoidAreaDraft: [],
              avoidAreaPreview: null,
              roadSpanDraft: null,
              roadSpanError: null,
            }
          : {}),
      }),
    setRoadSpanSelecting: (active: boolean): void =>
      set({
        activeTool: active ? "road-span-select" : "pan",
        roadSpanDraft: active ? get().roadSpanDraft : null,
        roadSpanError: null,
        // Arming a span selection retires every other gesture owner.
        ...(active
          ? {
              avoidAreaTool: "idle" as const,
              avoidAreaTargetId: null,
              avoidAreaDraft: [],
              avoidAreaPreview: null,
              placementTool: "idle" as const,
              placementStopId: null,
            }
          : {}),
      }),
    cancelPlacement: (): void =>
      set((state) => ({
        placementTool: "idle",
        placementStopId: null,
        dragPreview: null,
        // Escape is the single "stop what you were doing" (05 §4): it must also
        // disarm the avoid-area tools and drop their draft and preview, or the
        // rider would escape into a mode that still owns the next drag. The span
        // selection is the third such mode and is dropped in the same transition.
        avoidAreaTool: "idle",
        avoidAreaTargetId: null,
        avoidAreaDraft: [],
        avoidAreaError: null,
        avoidAreaPreview: null,
        roadSpanDraft: null,
        roadSpanError: null,
        // 04 §19: Escape during a drawing cancels the **current stroke** and keeps
        // the strokes already drawn, so the pen stays armed and the draft keeps
        // its finished strokes. Escaping the pen entirely is `Cancel`, a different
        // action.
        ...(state.activeTool === "sketch"
          ? {
              activeTool: "sketch" as const,
              sketchDraft:
                state.sketchDraft.active === null
                  ? state.sketchDraft
                  : { ...state.sketchDraft, active: null },
            }
          : {
              activeTool: "pan" as const,
              sketchDraft: EMPTY_SKETCH_DRAFT,
              sketchError: null,
            }),
      })),
    // The host reports each failure kind once, but a re-mount or a replayed report
    // must not thrash the sheet: an identical error writes nothing.
    setRenderError: (error: MapRenderError | null): void => {
      const current = get().renderError;
      if (current?.kind === error?.kind && current?.detail === error?.detail) return;
      set({ renderError: error });
    },
    requestFit: (extent: MapExtent | null): void =>
      set((state) => ({
        fitRequest: { token: (state.fitRequest?.token ?? 0) + 1, extent },
      })),
    // The host reports a transition, and the state that already holds when it is
    // asked: identical reports write nothing, so the sheet is not re-rendered per
    // frame and a replayed `loading` cannot undo a later `ready`.
    setMapLoadStatus: (status: MapLoadStatus): void => {
      const current = get().mapLoadStatus;
      if (current.state === status.state && current.reason === status.reason) return;
      set({ mapLoadStatus: status });
    },
    requestMapRetry: (): void =>
      set((state) => ({ mapRetryToken: state.mapRetryToken + 1 })),
    clearFitRequest: (): void => {
      if (get().fitRequest === null) return;
      set({ fitRequest: null });
    },
    setCameraUserOwned: (owned: boolean): void => set({ cameraUserOwned: owned }),
    // A measurement loop (ResizeObserver → insets → render → measure) would spin
    // forever on a fresh object, so an unchanged rectangle writes nothing.
    setInsets: (insets: MapInsets): void => {
      if (sameInsets(get().insets, insets)) return;
      set({ insets });
    },
    setSheetDetent: (detent: SheetDetent): void => set({ sheetDetent: detent }),
    toggleSheet: (hasRide: boolean): void =>
      set((state) => ({ sheetDetent: state.sheetDetent !== "expanded" ? "expanded" : hasRide ? "ride" : "peek" })),
    setOverlapCandidates: (candidates: readonly MapObjectRef[], at: Coordinate | null = null): void =>
      set({ overlapCandidates: candidates, overlapAt: candidates.length === 0 ? null : at }),
    setRouteTap: (tap: RouteTap | null): void => set({ routeTap: tap }),
    setHoveredObject: (ref: MapObjectRef | null): void => set({ hoveredObject: ref }),
    selectObject: (ref: MapObjectRef | null): void =>
      set({ selectedObject: ref, overlapCandidates: [], overlapAt: null, routeTap: null }),
  }));

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}

/** The process-wide planner presentation container. */
export const plannerUiStore: PlannerUiStore = createPlannerUiStore();
