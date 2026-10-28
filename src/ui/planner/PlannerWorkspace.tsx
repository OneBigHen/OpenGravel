"use client";

/**
 * The planner workspace: map + composer + object list + route decisions + status
 * (02-ARCHITECTURE-CONTRACT §8, §17; 04-PLANNER-AND-WORKSPACE-UX §2–§15, §20–§21,
 * §29, §31).
 *
 * This is the composition root of the slice, and the only place the three
 * authorities meet:
 *
 * - the **ride document store** holds authored state and is mutated only through
 *   `dispatch(command)` — an explicit map edit authors a point, a drag
 *   becomes `stop.move`, and a button in the object list becomes the one command
 *   that expresses the action;
 * - the **planning session store** holds the attempt, its bundles and its
 *   selection, and is driven by `begin`/`cancel`/`selectRoute`;
 * - the **planner UI store** holds presentation (pointer tool, armed placement,
 *   drag preview, camera ownership, zoom request, insets, sheet detent,
 *   selection).
 *
 * The map emits `MapIntent`; this composition chooses its authority.
 * Scene and view-model builders only project state during render.
 *
 * ## One gesture, one command, one undo unit (03 §27)
 *
 * Every authoring path here ends in exactly one `dispatch`. A drag is the clearest
 * case: the pointer stream only ever updates the **preview** (presentation, in the
 * UI store), and the single `gesture-commit` the machine reports is what produces
 * the one `stop.move`/`start.set` command. A cancelled gesture produces none —
 * `gesture-cancel` clears the preview and commits nothing.
 *
 * ## Camera ownership (05 §8)
 *
 * The map is fitted automatically at mount, and after a committed route or an
 * authored point *only* while the rider has not taken camera control; a user
 * pan/zoom (`camera-changed`) marks the camera as theirs, an explicit "zoom to"
 * frames one object on demand, and "Show whole ride" hands it back. The fit itself
 * is requested declaratively (`fitKey` + `fitExtent`) and executed by the host
 * against the measured insets (05 §9).
 *
 * Replanning follows authored revisions through the planning session. Search
 * selections remain presentation state until an explicit Directions or edit.
 *
 * The compact dock shares peek, half and full heights across place details,
 * category results, route choices and the ride editor. The map stays visible
 * above the half sheet; the desktop retains its planning rail.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import {
  buildRideHandoff,
  type PlannerRideActions,
} from "@/application/ride-session/ride-focus-handoff";
import { objectExtent } from "@/application/map/build-map-scene";
import type {
  BasemapMode,
  MapHostFactory,
  MapLoadStatus,
  MapRenderError,
} from "@/application/map/map-host";
import { buildSketchCorridor } from "@/application/planner/sketch-corridor";
import type { ShareServicePort } from "@/application/sharing/share-commands";

import {
  fastestReference,
  isPlanningInFlight, itineraryRefFor,
} from "@/application/planner/planner-view-model";
import { buildRouteExplanation } from "@/application/planner/route-explanation";
import { addedMinutesVsFastest } from "@/domain/route/roles";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import {
  discardFailedUpdate,
  editFailedUpdate,
  selectUpdateRecovery,
  updateRecoveryActions,
} from "@/application/planner/update-recovery";
import {
  PlannerWorkspaceDock,
  PlannerWorkspaceFrame,
  PlannerTripCard,
} from "@/ui/planner/PlannerWorkspaceSurfaces";
import type { LibraryServicePort } from "@/application/library/library-service";
import { selectedOfflineRoute } from "@/application/offline/selected-offline-route";
import {
  usePlannerHikeActivity, usePlannedHikeSummary, usePlannerActiveRoute,
  usePlannerAnswerLifecycle,
  usePlannerAvoidAreas,
  usePlannerCamera,
  usePlannerGeometryCache,
  usePlannerHistoryActions,
  usePlannerSheetActions,
  usePlannerMapIntentController,
  usePlanCommand, usePlaceFlow,
  useRideGlance,
  usePlannerPlaces,
  usePlannerRideStyle,
  usePlannerRoadSpans,
  useBreadcrumbScene, usePlannerBreadcrumbView, usePlannerScene,
  useRestoreAnnouncement,
  usePlannerSketch,
  usePlannerStops,
  usePlannerViewModel, usePlannerVisibleSession,
  type PlannerPlaceServices,
} from "@/ui/planner/controllers";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import type { PlannerRouteBriefingProps } from "@/ui/planner/PlannerRouteBriefing";
import {
  rideDocumentStore as defaultRideDocumentStore,
  type RideDocumentStore,
} from "@/ui/stores/ride-document-store";
import {
  planningSessionStore as defaultPlanningSessionStore,
  type PlanningSessionStore,
} from "@/ui/stores/planning-session-store";
import {
  plannerUiStore as defaultPlannerUiStore,
  type PlannerUiStore,
} from "@/ui/stores/planner-ui-store";
import type { AvoidAreaId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
export interface PlannerWorkspaceProps {
  /** Injected containers for tests and embedding; the singletons by default. */
  readonly rideDocumentStore?: RideDocumentStore;
  readonly planningSessionStore?: PlanningSessionStore;
  readonly plannerUiStore?: PlannerUiStore;
  /**
   * The map host factory, supplied by the composition root (05 §2). Required:
   * the UI layer may not import a renderer, so it cannot own a default one either
   * (4.0 review finding 8).
   */
  readonly mapHostFactory: MapHostFactory;
  /**
   * The basemap the renderer draws (VNX-011/012). Resolved per request by the page
   * and passed down so no component invents its own environment reading; the
   * default is the deterministic `empty` basemap, because a component that does
   * not know its deployment must not reach for tiles.
   */
  readonly basemap?: BasemapMode;
  readonly mapboxToken?: string;
  /** Named saves are deliberately separate from the autosaved active draft. */
  readonly libraryService?: LibraryServicePort;
  /**
   * The share service (11.1). The UI dispatches typed share commands through
   * this port and never touches the store behind it (RULE UI-INFRA).
   */
  readonly shareService?: ShareServicePort;
  /**
   * The deployment prefix the vendored map assets are served under (4.0 review
   * finding 2), read at the composition root and passed down unchanged.
   */
  readonly assetBasePath?: string;
  /**
   * Where avoid-area polygons are stored (02-ARCHITECTURE-CONTRACT §4). The
   * composition root injects the persisted adapter; the default is an in-memory
   * store, which is what a surface test and SSR have.
   */
  readonly geometryStore?: GeometryStore;
  /**
   * Starts (or resumes) the physical ride for a selected route and enters the
   * Ride Focus surface (04 §28). Supplied by the composition root, because the
   * handoff writes the durable bootstrap pointer and changes the URL — neither of
   * which a workspace may own. Absent means the action is not offered at all,
   * which is the honest state for an embedding that has no ride surface.
   */
  readonly rideActions?: PlannerRideActions;
  /** Place search, dropped-pin names and "Current location" (M1); absent = map only. */
  readonly places?: PlannerPlaceServices;
  /** Weather and traffic for the route briefing (M4); absent = no live checks. */
  readonly preparationProviders?: PreparationProviderRegistry;
  readonly bikes?: PlannerRouteBriefingProps["bikes"];
}

/** The empty line a missing route or an unusable draft resolves to. */
const NO_COORDINATES: readonly Coordinate[] = [];

/**
 * The bounded "what changed" emphasis a successful update leaves behind (05 §12).
 *
 * `span` is the divergent section the map emphasises (or `null` when the update did
 * not move the line), `delta` is the pair of numbers the chip states, and `untilIso`
 * is the deadline the renderer itself enforces. Presentation state only: it is
 * derived in one effect, cleared by the next interaction or by its own deadline, and
 * it is never written into the ride document.
 */
export function PlannerWorkspace({
  rideDocumentStore = defaultRideDocumentStore,
  planningSessionStore = defaultPlanningSessionStore,
  plannerUiStore = defaultPlannerUiStore,
  mapHostFactory,
  basemap = "empty",
  mapboxToken,
  libraryService,
  assetBasePath,
  geometryStore,
  rideActions,
  shareService,
  places,
  preparationProviders,
  bikes = [],
}: PlannerWorkspaceProps) {
  const document = useStore(rideDocumentStore, (state) => state.document);
  const { placeNameFor, composerSearch, riderPosition, locateMe, locateStart } = usePlannerPlaces({ document, rideDocumentStore, plannerUiStore, places });
  const rideStyle = usePlannerRideStyle({ document, rideDocumentStore });
  const planningSnapshot = useStore(planningSessionStore, (state) => state.snapshot);
  const { session, showingSketchPreview } = usePlannerVisibleSession({ document, snapshot: planningSnapshot, plannerUiStore });
  const geometry = useStore(planningSessionStore, (state) => state.geometry);
  const activeTool = useStore(plannerUiStore, (state) => state.activeTool);
  const placementTool = useStore(plannerUiStore, (state) => state.placementTool);
  const placementStopId = useStore(plannerUiStore, (state) => state.placementStopId);
  const selectedObject = useStore(plannerUiStore, (state) => state.selectedObject);
  const overlapCandidates = useStore(plannerUiStore, (state) => state.overlapCandidates);
  const renderError = useStore(plannerUiStore, (state) => state.renderError);
  const mapLoadStatus = useStore(plannerUiStore, (state) => state.mapLoadStatus);
  const mapRetryToken = useStore(plannerUiStore, (state) => state.mapRetryToken);
  const dragPreview = useStore(plannerUiStore, (state) => state.dragPreview);
  const fitRequest = useStore(plannerUiStore, (state) => state.fitRequest);
  const insets = useStore(plannerUiStore, (state) => state.insets);
  const sheetDetent = useStore(plannerUiStore, (state) => state.sheetDetent);
  const cameraUserOwned = useStore(plannerUiStore, (state) => state.cameraUserOwned);
  const saveStatus = useStore(rideDocumentStore, (state) => state.saveStatus);
  const restoreStatus = useStore(rideDocumentStore, (state) => state.restoreStatus);
  const restoreAnnouncement = useRestoreAnnouncement({ restoreStatus });
  const conflict = useStore(rideDocumentStore, (state) => state.conflict);
  const reloadLatest = useStore(rideDocumentStore, (state) => state.reloadLatest);
  const keepMyCopy = useStore(rideDocumentStore, (state) => state.keepMyCopy);
  const retrySave = useStore(rideDocumentStore, (state) => state.retrySave);
  const [inspectorNode, setInspectorNode] = useState<HTMLElement | null>(null);
  const [refineEditing, setRefineEditing] = useState(false);
  const { breadcrumb, bar: breadcrumbBar, mapGlance, dockGlance, mapProps: breadcrumbMapProps } = usePlannerBreadcrumbView({ document, rideDocumentStore, planningSessionStore, plannerUiStore, libraryService, preparationProviders, rideActions });
  const [rideStart, setRideStart] = useState<{
    readonly state: "idle" | "starting";
    readonly message: string | null;
  }>({ state: "idle", message: null });

  const {
    store: areaStore,
    readGeometry,
    sketchStrokeGeometry,
  } = usePlannerGeometryCache({
    document,
    geometryStore,
    sessionGeometry: geometry,
  });
  const avoidAreaAuthoring = usePlannerAvoidAreas({
    document,
    selectedObject,
    areaStore,
    readGeometry,
    rideDocumentStore,
    plannerUiStore,
  });
  const {
    tool: avoidAreaTool,
    draft: avoidAreaDraft,
    error: avoidAreaError,
    preview: avoidAreaPreview,
    conflicts,
    names: avoidAreaNames,
    panelProps: avoidAreaPanelProps,
    moveConflictEndpoint: handleMoveConflictEndpoint,
    editConflictArea: handleEditConflictArea,
    clearGesture: clearAvoidAreaGesture,
    cancelToolGesture: cancelAvoidAreaToolGesture,
    beginPointerDown: beginAvoidAreaPointerDown,
    previewPointerMove: previewAvoidAreaPointerMove,
    appendPolygonVertex,
    commitGesture: commitAvoidAreaGesture,
  } = avoidAreaAuthoring;
  const {
    onCloseDraft: closeAvoidAreaDraft,
    onRemoveLastVertex: handleRemoveAvoidAreaVertex,
    onRemove: handleRemoveAvoidArea,
  } = avoidAreaPanelProps;

  const offlineRoute = useMemo(
    () => selectedOfflineRoute(document, session, geometry),
    [document, session, geometry],
  );

  /**
   * The endpoints the committed sketch derives from its own trace (04 §19).
   *
   * Derived here, with the builder the commit used, rather than read back from the
   * document: the raw trace is the authority, so a ride whose start is missing is
   * plannable because the drawing says where it starts — and the label says so.
   */
  const sketchDerivedEndpoints = useMemo(() => {
    if (document.intent.sketch === null || sketchStrokeGeometry.length === 0) return null;
    return buildSketchCorridor(sketchStrokeGeometry).derivedEndpoints;
  }, [document.intent.sketch, sketchStrokeGeometry]);

  /**
   * The line of the route the rider is looking at, resolved from the session's own
   * geometry cache. The span draft indexes into this line, the itinerary measures
   * its legs on it, and the preview is part of the scene, so it is read **before**
   * the projection runs. The candidate itself comes with it because the handoff
   * (04 §28) needs the `geometryRef` the line lives under.
   */
  const { activeRoute, selectedCandidate } = usePlannerActiveRoute({ session, geometry });

  const { viewModel, setRouteTraffic } = usePlannerViewModel({
    document,
    session,
    sketchDerivedEndpoints,
    placeNameFor,
    routeLine: activeRoute,
  });

  /**
   * The deterministic explanation of the route on screen (04 §13, Wave-3 task
   * 3.4). It is built for the selected candidate only, from the same bundle the
   * cards project and the bundle's own quickest candidate as the fastest
   * reference — the same one their `+N min vs Fastest` line uses (`06 §13`), so
   * the headline and the delta can never name different routes.
   *
   * The policy is read for the rider's road-character weights, which order the
   * headline's benefits (06 §6). No score is recomputed here and no number the
   * server did not produce is invented.
   */
  const routeExplanation = useMemo(() => {
    const bundle = session.committedBundle ?? session.lastGoodBundle;
    if (bundle === null) return null;
    const candidate = bundle.candidates.find(
      (entry) => entry.id === bundle.selectedRouteId,
    );
    if (candidate === undefined) return null;
    const fastest = fastestReference(bundle.candidates);
    const addedMinutes =
      fastest === null ? null : addedMinutesVsFastest(candidate, fastest);
    return buildRouteExplanation({
      candidate,
      intent: document.intent,
      policy: PA_NJ_ROUTE_POLICY_VNEXT_1,
      fastest:
        fastest === null || addedMinutes === null
          ? null
          : { candidate: fastest, addedMinutes },
    });
  }, [session, document.intent]);

  const activeRouteLine = activeRoute?.geometry ?? NO_COORDINATES;
  const roadSpanAuthoring = usePlannerRoadSpans({
    document,
    activeRoute,
    activeRouteLine,
    readGeometry,
    geometryStore: areaStore,
    selectedObject,
    activeTool,
    rideDocumentStore,
    plannerUiStore,
  });
  const {
    draft: roadSpanDraft,
    error: roadSpanError,
    preview: roadSpanPreview,
    panelProps: roadSpanPanelProps,
    roadTap,
    clearGesture: clearRoadSpanGesture,
    beginPointerDown: beginRoadSpanPointerDown,
    previewPointerMove: previewRoadSpanPointerMove,
    commitGesture: commitRoadSpanGesture,
  } = roadSpanAuthoring;

  /**
   * Whether this ride can start right now, and with which identity. Pure, so the
   * button's own reason and the state it starts are decided in one place (04 §28).
   */
  const rideHandoff = useMemo(
    () =>
      buildRideHandoff({
        document,
        bundle: session.committedBundle ?? session.lastGoodBundle,
        selectedCandidate,
        hasRouteLine: activeRoute !== null,
        sketchPreview: showingSketchPreview, sketchDerivedEndpoints,
      }),
    [document, session, selectedCandidate, activeRoute, showingSketchPreview, sketchDerivedEndpoints],
  );

  const routeCardCount = viewModel.routeCards.length;
  const {
    updateHighlight,
    clearUpdateHighlight,
    markRevisionAttempted,
  } = usePlannerAnswerLifecycle({
    document,
    session: planningSnapshot,
    geometry,
    routeCardCount,
    restored: restoreStatus.state === "restored",
    planningSessionStore,
    plannerUiStore,
  });
  const sketchAuthoring = usePlannerSketch({
    document,
    geometryStore: areaStore,
    rideDocumentStore,
    planningSessionStore,
    plannerUiStore,
    markRevisionAttempted,
  });
  const {
    error: sketchError,
    preview: sketchPreview,
    panelProps: sketchPanelProps,
    cancelInFlightStroke: cancelSketchGesture,
    beginStroke: beginSketchGesture,
    appendPoint: appendSketchGesturePoint,
    finishStroke: finishSketchGesture,
  } = sketchAuthoring;

  const scene = useBreadcrumbScene(breadcrumb.project, usePlannerScene(
    {
      document,
      session,
      uiState: { selectedObject },
      preview: dragPreview,
      previewArea: avoidAreaPreview,
      previewSpan: roadSpanPreview,
      previewSketch: sketchPreview,
      // 05 §12: the changed section after a successful update, if the emphasis's
      // bounded interval is still running.
      changedSpan: updateHighlight?.span ?? null,
      readGeometry,
      riderPosition,
    },
    { refineEditing, activeTool, placementTool },
  ));

  const selectedRef = useMemo(
    () => (selectedObject === null ? null : itineraryRefFor(document, selectedObject)),
    [selectedObject, document],
  );
  const stopAuthoring = usePlannerStops({
    document,
    viewModel,
    scene,
    selectedRef,
    placementTool,
    placementStopId,
    selectedObject,
    rideDocumentStore,
    plannerUiStore,
  });
  const {
    armedTool,
    panelProps: stopsPanelProps,
    beginPointDrag,
    previewPointDrag,
    commitPointDrag,
    cancelPointDrag,
    placeFromMap,
    changeDestination,
  } = stopAuthoring;
  const placeFlow = usePlaceFlow({ services: places, search: composerSearch,
    rider: riderPosition?.coordinate ?? null, locateStart, rideStore: rideDocumentStore,
    uiStore: plannerUiStore, hasRoute: activeRoute !== null, route: activeRoute, mapLayers: preparationProviders?.mapLayers,
    onMapPointAction: (action, coordinate) => action === "avoid" ? avoidAreaAuthoring.avoidHere(coordinate) : stopAuthoring.onMapPointAction(action, coordinate),
    onDirectionsReady: (next) => {
      markRevisionAttempted(next.revision);
      void planningSessionStore.getState().begin({ rideId: next.rideId, rideRevision: next.revision, intent: next.intent });
    } });
  const mapIntents = usePlannerMapIntentController({
    plannerUiStore,
    planningSessionStore,
    clearUpdateHighlight,
    stops: {
      beginPointDrag,
      previewPointDrag,
      commitPointDrag,
      cancelPointDrag,
      placeFromMap,
    },
    avoidAreas: {
      clearGesture: clearAvoidAreaGesture,
      beginPointerDown: beginAvoidAreaPointerDown,
      previewPointerMove: previewAvoidAreaPointerMove,
      appendPolygonVertex,
      commitGesture: commitAvoidAreaGesture,
    },
    roadSpans: {
      clearGesture: clearRoadSpanGesture,
      beginPointerDown: beginRoadSpanPointerDown,
      previewPointerMove: previewRoadSpanPointerMove,
      commitGesture: commitRoadSpanGesture,
    },
    sketch: {
      cancelInFlightStroke: cancelSketchGesture,
      beginStroke: beginSketchGesture,
      appendPoint: appendSketchGesturePoint,
      finishStroke: finishSketchGesture,
    },
  });
  const {
    onIntent: handleIntent,
    onSelectOverlap: handleSelectOverlap,
    onDismissOverlap: handleDismissOverlap,
  } = mapIntents;
  const camera = usePlannerCamera({
    scene,
    session,
    cameraUserOwned,
    fitRequest,
    plannerUiStore,
  });
  const {
    fitKey,
    fitExtent,
    showWholeRide: handleShowWholeRide,
    mapSlotRef,
    dockRef,
    headerRef,
    sheetHeadRef,
    sheetHeadHeight,
  } = camera;

  /** 04 §31 "zoom to", the same one-shot fit the object list uses. */
  const handleZoomAvoidArea = useCallback(
    (areaId: AvoidAreaId): void => {
      plannerUiStore
        .getState()
        .requestFit(objectExtent(scene, { kind: "avoid-area", avoidAreaId: areaId }));
    },
    [plannerUiStore, scene],
  );

  // A pick that completes the ride plans itself (04 §8); a draft still loading is
  // not compared, so a reload never starts a plan on its own.
  const handlePlan = usePlanCommand({ document, markRevisionAttempted, planningSessionStore, sketchDerivedEndpoints, restoreSettled: restoreStatus.state !== "loading" });

  const handleCancel = useCallback((): void => {
    planningSessionStore.getState().cancel();
  }, [planningSessionStore]);

  const handleSelectRoute = useCallback(
    (routeId: RouteCandidateId): void => {
      planningSessionStore.getState().selectRoute(routeId);
      plannerUiStore.getState().selectObject({ kind: "route", routeId });
    },
    [planningSessionStore, plannerUiStore],
  );

  /**
   * Escape (05 §4, 4.0 review finding 5): the workspace's armed placement is
   * cleared, in one place, for every way Escape can arrive. The map relays its own
   * Escape to this handler, which is what makes the state machine — not a
   * component's local tool — the authority on what the next tap does.
   *
   * `cancelPlacement` also disarms the avoid-area tools, so Escape cancels a
   * polygon draft "entirely" (04 §18) in the same transition.
   */
  const handleEscape = useCallback((): void => {
    plannerUiStore.getState().cancelPlacement();
    cancelAvoidAreaToolGesture();
  }, [cancelAvoidAreaToolGesture, plannerUiStore]);

  /**
   * The polygon draft's keyboard path (04 §18, §31): Enter closes it, Backspace
   * removes the last corner. Escape is the map's own listener, which relays into
   * the same `cancelPlacement` the rest of the surface uses.
   *
   * The handler yields to a text field: a Backspace while the rider is renaming an
   * area must edit the name, not silently drop a corner.
   */
  useEffect(() => {
    if (avoidAreaTool !== "polygon") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        closeAvoidAreaDraft();
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        handleRemoveAvoidAreaVertex();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [avoidAreaTool, closeAvoidAreaDraft, handleRemoveAvoidAreaVertex]);

  /** A renderer failure the map host reported (05 §22). */
  const handleRenderError = useCallback(
    (error: MapRenderError): void => {
      plannerUiStore.getState().setRenderError(error);
    },
    [plannerUiStore],
  );

  /**
   * The map's load health, straight from the host (4.0s).
   *
   * The map reaching `ready` is also what clears an earlier renderer failure: the
   * bounded notice described a map that was not drawing, and this one is (the host
   * clears its own `data-map-error` for the same reason, so the sheet and the
   * attribute never disagree).
   */
  const handleMapLoadStatus = useCallback(
    (status: MapLoadStatus): void => {
      const ui = plannerUiStore.getState();
      ui.setMapLoadStatus(status);
      if (status.state === "ready") ui.setRenderError(null);
    },
    [plannerUiStore],
  );

  /**
   * "Retry map" (4.0s): the request, never the attempt.
   *
   * The workspace owns the surface and the token, and the map component relays it
   * to the one live host, which rebuilds its own renderer and bounds how many
   * attempts a press may spend. Nothing here can create a second map.
   */
  const handleRetryMap = useCallback((): void => {
    plannerUiStore.getState().requestMapRetry();
  }, [plannerUiStore]);

  const sheetActions = usePlannerSheetActions(plannerUiStore, planningSessionStore);

  /** 04 §20 undo/redo and OW-01 Clear route, for the sheet. */
  const history = usePlannerHistoryActions({ document, rideDocumentStore, plannerUiStore, planningSessionStore, clearUpdateHighlight });

  // --- Failed-update recovery (04 §21) --------------------------------------

  /**
   * The failed update this surface can act on, or `null` (04 §21).
   *
   * Derived, never stored: the session keeps the last-good answer and the document
   * keeps the attempted change, so a failure that is retried, superseded or undone
   * stops being a failure without anything having to clear a flag.
   */
  const updateRecovery = useMemo(
    () => selectUpdateRecovery(document, session),
    [document, session],
  );
  const recoveryActions = useMemo(
    () =>
      updateRecovery === null ? null : updateRecoveryActions(document, updateRecovery),
    [document, updateRecovery],
  );

  /**
   * Edit: open the editor of the object the failed change touched (04 §21).
   *
   * The target is derived from the change itself (`update-recovery.ts`); this
   * handler only decides how a selection becomes an editor — select the object and
   * open the sheet, because the object's own panel lives in the scrolling body and a
   * collapsed sheet would hide the editor the rider just asked for (04 §2).
   */
  const handleEditFailedUpdate = useCallback((): void => {
    if (updateRecovery === null) return;
    const target = editFailedUpdate(document, updateRecovery);
    if (target === null) return;
    if (target.kind === "map") plannerUiStore.getState().selectObject(target.ref);
    plannerUiStore.getState().setSheetDetent("expanded");
  }, [document, updateRecovery, plannerUiStore]);

  /**
   * Discard: one whole-ride undo of exactly the attempted change (04 §20, §21).
   *
   * The guard lives in `update-recovery.ts`: it moves only when the history cursor
   * is still on the failed revision's own entry, and it reports a refusal through
   * its `onRefused` channel — which is where a logging implementation (13 §13) will
   * attach. This surface has already withheld the action when the guard would refuse
   * (`canDiscard`), so there is nothing rider-facing to add for the race in which a
   * press arrives between the refusal and the re-render: the ride is untouched, and
   * that is the honest outcome.
   */
  const handleDiscardFailedUpdate = useCallback((): void => {
    if (updateRecovery === null) return;
    const move = discardFailedUpdate(document, updateRecovery);
    if (move === null) return;
    // The same undo, applied through the document store: persistence, dirty
    // marking and checkpointing stay in one place (04 §20).
    rideDocumentStore.getState().undo();
  }, [document, updateRecovery, rideDocumentStore]);

  /**
   * The §28 handoff: the composition root journals the session, writes the
   * bootstrap pointer and moves to `/ride`. This component only reports the
   * outcome — it neither writes storage nor changes the URL.
   */
  const handleStartRide = useCallback(async (): Promise<void> => {
    if (rideActions === undefined || rideHandoff.outcome !== "ready") return;
    setRideStart({ state: "starting", message: null });
    try {
      const outcome = await rideActions.start(rideHandoff.request);
      if (outcome.outcome === "rejected") {
        setRideStart({ state: "idle", message: outcome.message });
        return;
      }
      // A successful start navigates away; the surface must not flash an idle
      // button while the route changes.
      setRideStart({ state: "starting", message: null });
    } catch (error: unknown) {
      setRideStart({
        state: "idle",
        message:
          error instanceof Error && error.message.length > 0
            ? error.message
            : "The ride could not be started.",
      });
    }
  }, [rideActions, rideHandoff]);

  const planning = isPlanningInFlight(session.phase);

  /**
   * Where the rider is coming from, so a tapped road is entered at the near end:
   * the last stop before the destination, or the start when there are no stops
   * yet. `null` when the ride has neither, and the road is then taken in the
   * order it is drawn.
   */
  const rideRoadReference =
    document.intent.stops.at(-1)?.coordinate ?? document.intent.start?.coordinate ?? null;

  /** The ride summary over the map: built once, mounted in the map slot and above the sheet (CSS shows one). */
  const glance = useRideGlance({
    cards: viewModel.routeCards, route: activeRoute,
    elevationSource: preparationProviders?.elevationProfile, failed: viewModel.failed,
    planning, onRetry: handlePlan, plannerUiStore,
  });

  const tripCard = viewModel.routeCards.length > 0 || planning ? (
    <PlannerTripCard document={document} viewModel={viewModel} rideStyle={rideStyle} route={activeRoute}
      onCancelPlanning={handleCancel} onClearRide={() => { placeFlow.closeOptions(); history.onClearRide(); }}
      onEditRide={() => plannerUiStore.getState().setSheetDetent("expanded")} />
  ) : null;

  const hikeActivity = usePlannerHikeActivity(document, rideDocumentStore, planningSessionStore, session, selectedCandidate, activeTool === "sketch", sketchPanelProps), plannedHike = usePlannedHikeSummary(hikeActivity, plannerUiStore, breadcrumbBar?.onStart);
  return (
    <PlannerWorkspaceFrame
      trip={tripCard}
      document={document} libraryService={libraryService}
      headerRef={headerRef}
      mapSlotRef={mapSlotRef}
      armedTool={armedTool}
      retryingMap={mapLoadStatus.state === "retrying"}
      places={preparationProviders?.places && { source: preparationProviders.places, onAddStop: (place) => stopAuthoring.addStopAt(place.coordinate, place.name), onOpenPlace: placeFlow.overlayPlace }}
      layers={preparationProviders?.mapLayers && {
        source: preparationProviders.mapLayers,
        onAddStop: stopAuthoring.addStopAt,
        rideRoadReference,
        onRideRoad: stopAuthoring.addRideRoad, onAvoidRoad: roadSpanAuthoring.avoidRoad,
      }}
      onShowWholeRide={handleShowWholeRide}
      locateMe={locateMe}
      glance={mapGlance(glance.map)}
      topSearch={placeFlow.top} activity={hikeActivity}
      editBar={{ scene, activeTool, placementTool, sketch: sketchPanelProps, breadcrumb: breadcrumbBar, onAddStop: stopsPanelProps.onAddStop, onCancelPlacement: () => plannerUiStore.getState().cancelPlacement() }}
      map={{
        scene: { ...scene, places: placeFlow.pins },
        onViewport: placeFlow.onViewport,
        ...breadcrumbMapProps(placeFlow, handleIntent, placementTool === "idle" && activeTool === "pan"),
        directionsWhenEmpty: places !== undefined && activeRoute === null,
        addStopDisabledReason: document.intent.start === null || document.intent.finish === null ? "plan a start and finish first" : null,
        hostFactory: mapHostFactory,
        ...(assetBasePath === undefined ? {} : { assetBasePath }),
        dimmed: planning && session.phase !== "alternatives-loading" && session.phase !== "primary-ready",
        insets,
        activeTool,
        rideRevision: document.revision,
        fitKey,
        fitExtent,
        basemap,
        onEscape: handleEscape,
        onRenderError: handleRenderError,
        onLoadStatus: handleMapLoadStatus,
        retryToken: mapRetryToken,
      }}
    >
        <PlannerWorkspaceDock
          placeSheet={placeFlow.sheet} onDismissPlace={placeFlow.dismissSheet}
          showOptions={placeFlow.optionsOpen} onFullSheet={() => plannerUiStore.getState().setSheetDetent("expanded")}
          dockRef={dockRef}
          sheetHeadRef={sheetHeadRef}
          sheetHeadHeight={sheetHeadHeight}
          glance={dockGlance(glance.dock)}
          editBar={{ scene, activeTool, placementTool, sketch: sketchPanelProps, breadcrumb: breadcrumbBar, onAddStop: stopsPanelProps.onAddStop, onCancelPlacement: () => plannerUiStore.getState().cancelPlacement() }}
          sheetDetent={sheetDetent}
          viewModel={viewModel}
          status={{
            statusMessage: restoreAnnouncement ?? viewModel.statusMessage,
            saveStatus,
            updateHighlight,
            updateRecovery,
            recoveryActions,
            onRetryFailedUpdate: handlePlan,
            onEditFailedUpdate: handleEditFailedUpdate,
            onDiscardFailedUpdate: handleDiscardFailedUpdate,
            onRetrySave: retrySave,
            conflict,
            onReloadLatest: reloadLatest,
            onKeepMyCopy: keepMyCopy,
            conflicts,
            areaNames: avoidAreaNames,
            onMoveConflictEndpoint: handleMoveConflictEndpoint,
            onEditConflictArea: handleEditConflictArea,
            onRemoveConflictArea: handleRemoveAvoidArea,
            errorMessage: viewModel.errorMessage,
            renderError,
            mapLoadStatus,
            onRetryMap: handleRetryMap,
          }}
          overlapCandidates={overlapCandidates}
          onSelectOverlap={handleSelectOverlap}
          onDismissOverlap={handleDismissOverlap}
          roadTap={roadTap}
          onToggleSheet={sheetActions.onToggleSheet}
          onStepSheet={sheetActions.onStepSheet}
          onSnapSheet={(next) => plannerUiStore.getState().setSheetDetent(next === "full" ? "expanded" : next)}
          {...history}
          composer={{
            viewModel,
            armedTool,
            mapUnavailable: mapLoadStatus.state === "failed",
            onSetStart: (): void => plannerUiStore.getState().setPlacementTool("place-start"),
            onSetFinish: (): void =>
              plannerUiStore.getState().setPlacementTool("place-finish"),
            onPlan: handlePlan,
            planLabel: viewModel.planLabel,
            onChangeDestination: changeDestination,
            ...(placeFlow.composerSearch === undefined ? {} : { placeSearch: placeFlow.composerSearch }),
            rideStyle,
          }}
          planning={planning}
          onCancelPlanning={handleCancel}
          results={{
            inspector: inspectorNode,
            rideStyle,
            choices: {
              cards: viewModel.routeCards,
              explanation: routeExplanation,
              onSelect: handleSelectRoute,
              comparisons: viewModel.routingComparisons,
            },
            actions: {
              document,
              libraryService,
              shareService,
              route: offlineRoute,
              rideActions,
              start:
                viewModel.routeCards.length === 0 || rideActions === undefined
                  ? null
                  : {
                      refusal: rideHandoff.outcome === "refused" ? rideHandoff.message : null,
                      starting: rideStart.state === "starting",
                      error: rideStart.message,
                      onStart: (): void => void handleStartRide(),
                    },
            },
            briefing: {
              route: activeRoute,
              ride: document,
              bikes,
              providers: preparationProviders,
              offlineRoute,
              opportunityMap: { hostFactory: mapHostFactory, basemap, ...(mapboxToken === undefined ? {} : { staticMapToken: mapboxToken }), ...(assetBasePath === undefined ? {} : { assetBasePath }) },
              onRouteThrough: roadSpanAuthoring.routeThrough,
              onAddStopAt: stopAuthoring.addStopAt,
              actions: rideStyle.actions,
              onRouteTraffic: setRouteTraffic,
            },
            sheetExpanded: sheetDetent === "expanded",
            hike: plannedHike,
          }}
          refine={{
            onExpandedChange: setRefineEditing,
            forceOpen:
              (activeTool !== "pan" &&
                activeTool !== "point-drag" &&
                activeTool !== "route-sculpt" &&
                activeTool !== "sketch") ||
              avoidAreaTool !== "idle" ||
              avoidAreaDraft.length > 0 ||
              roadSpanDraft !== null ||
              placementStopId !== null ||
              selectedObject?.kind === "avoid-area" ||
              selectedObject?.kind === "road-span" ||
              avoidAreaError !== null ||
              roadSpanError !== null ||
              sketchError !== null,
            summaryCounts: {
              stops: document.intent.stops.length,
              avoidAreas: document.intent.avoidAreas.length,
              roadSpans: document.intent.roadSpans.length,
              sketch: document.intent.sketch !== null,
            },
            stops: stopsPanelProps,
            avoidAreas: {
              ...avoidAreaPanelProps,
              onZoomTo: handleZoomAvoidArea,
            },
            roadSpans:
              activeRoute === null && document.intent.roadSpans.length === 0
                ? null
                : {
                    ...roadSpanPanelProps,
                    onZoomTo: (spanId) => roadSpanAuthoring.zoomTo(spanId, scene),
                  },
            sketch: {
              ...sketchPanelProps,
              drawing: activeTool === "sketch",
              committed: document.intent.sketch !== null,
              hasAuthoredEndpoints:
                document.intent.start !== null || document.intent.finish !== null,
            },
          }}
        />
        <aside className="og-planner__inspector" ref={setInspectorNode} />
    </PlannerWorkspaceFrame>
  );
}

