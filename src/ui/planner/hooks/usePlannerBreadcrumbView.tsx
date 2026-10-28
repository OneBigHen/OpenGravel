"use client";

import { newCommandId } from "@/domain/ride/ids";
import { useActivityMode } from "@/ui/stores/activity-mode";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LibraryServicePort } from "@/application/library/library-service";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import type { MapIntent, MapPointAction, MapScene } from "@/application/map/types";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import { breadcrumbLine, breadcrumbMeasurements, STEEP_LEG_PERCENT } from "@/application/breadcrumb/measurements";
import { useElevationProfile } from "@/ui/planner/useElevationProfile";
import { usePlannerBreadcrumb } from "@/ui/planner/hooks/usePlannerBreadcrumb";
import { BreadcrumbWaypointEditor } from "@/ui/planner/BreadcrumbWaypointEditor";
import { BreadcrumbSummary } from "@/ui/planner/BreadcrumbSummary";
import type { PlannerRideActions } from "@/application/ride-session/ride-focus-handoff";
import type { PlanningSessionStore } from "@/ui/stores/planning-session-store";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";

interface Wiring {
  readonly document: RideDocument;
  readonly rideDocumentStore: RideDocumentStore;
  readonly planningSessionStore: PlanningSessionStore;
  readonly plannerUiStore: PlannerUiStore;
  readonly libraryService: LibraryServicePort | undefined;
  readonly preparationProviders: PreparationProviderRegistry | undefined;
  readonly rideActions: PlannerRideActions | undefined;
}

/** Everything the planner workspace needs to host Breadcrumb mode, in one place. */
export function usePlannerBreadcrumbView(wiring: Wiring) {
  const { document, rideDocumentStore, planningSessionStore, plannerUiStore, libraryService, preparationProviders, rideActions } = wiring;
  const activity = useActivityMode();
  const base = usePlannerBreadcrumb(document, rideDocumentStore);
  const baseRoute = base.route;
  const baseProject = base.project;
  const line = useMemo(() => baseRoute === null ? [] : breadcrumbLine(baseRoute), [baseRoute]);
  const elevation = useElevationProfile(preparationProviders?.breadcrumbElevationProfile, `breadcrumb-${document.rideId}-${document.revision}`, line);
  const profile = elevation?.status === "ready" ? elevation.profile : null;
  const measurements = useMemo(() => baseRoute === null ? null : breadcrumbMeasurements(baseRoute, profile), [baseRoute, profile]);
  /** Straight legs steeper than this are flagged on the map and in the card. */
  const steep = useMemo(() => baseRoute === null || measurements === null ? [] : baseRoute.legs.filter((_, index) => (measurements.legs[index]?.maxGradePercent ?? 0) > STEEP_LEG_PERCENT).map((leg) => leg.geometry), [baseRoute, measurements]);
  const project = useCallback((scene: MapScene): MapScene => {
    const projected = baseProject(scene);
    return { ...projected, routes: projected.routes.map((item) => item.offRoute === undefined ? item : { ...item, offRoute: { steep } }) };
  }, [baseProject, steep]);
  const breadcrumb = useMemo(() => ({ ...base, project }), [base, project]);
  const [mapCenter, setMapCenter] = useState<Coordinate | null>(null);
  const { route, selected, setEditing, setSelected, add, edit } = breadcrumb;
  // A breadcrumb that arrives whole (a trail opened from Explore, a GPX import,
  // a saved ride) is framed once; one being tapped out point by point is not.
  const arrived = route !== null && !breadcrumb.editing;
  const framed = useRef(false);
  useEffect(() => {
    if (!arrived) { if (route === null) framed.current = false; return; }
    if (framed.current) return;
    framed.current = true;
    plannerUiStore.getState().setCameraUserOwned(false);
    plannerUiStore.getState().requestFit(null);
  }, [arrived, route, plannerUiStore]);
  const beginEditing = useCallback((): void => {
    planningSessionStore.getState().cancel();
    setEditing(true);
    plannerUiStore.getState().setCameraUserOwned(true);
    plannerUiStore.getState().setSheetDetent("peek");
  }, [planningSessionStore, plannerUiStore, setEditing]);
  const selectedIndex = route?.waypoints.findIndex((point) => point.id === selected) ?? -1;
  const selectedWaypoint = route?.waypoints[selectedIndex];
  const bar = {
    editing: breadcrumb.editing,
    count: route?.waypoints.length ?? 0,
    canUndo: document.history.cursor >= 0,
    canRedo: document.history.cursor < document.history.entries.length - 1,
    onStart: beginEditing,
    onDone: () => setEditing(false),
    onAddCenter: () => { if (mapCenter !== null) add(mapCenter); },
    onUndo: () => rideDocumentStore.getState().undo(),
    onRedo: () => rideDocumentStore.getState().redo(),
    centerAvailable: mapCenter !== null,
  };
  const mapGlance = (base: ReactNode): ReactNode => (
    <>{route === null ? base : null}{selectedWaypoint === undefined ? null : <BreadcrumbWaypointEditor key={selectedWaypoint.id} point={selectedWaypoint} index={selectedIndex} onClose={() => setSelected(null)} onSave={(name) => { edit(selectedWaypoint.id, (point) => ({ ...point, name: name.trim() }), "Renamed breadcrumb waypoint"); setSelected(null); }} onRemove={() => { edit(selectedWaypoint.id, () => null, "Removed breadcrumb waypoint"); setSelected(null); }} />}</>
  );
  const dockGlance = (base: ReactNode): ReactNode => route === null ? base : (
    <BreadcrumbSummary onPlanTrails={activity !== "hike" || route.waypoints.length < 2 || route.waypoints.length > 10 ? undefined : () => {
      const current = rideDocumentStore.getState().document;
      const result = rideDocumentStore.getState().dispatch({ type: "breadcrumb.plan", selectedAt: new Date().toISOString(), commandId: newCommandId(), rideId: current.rideId, baseRevision: current.revision, source: "rider", label: "Plan breadcrumb on trails" });
      if (result.outcome === "applied") { setEditing(false); void planningSessionStore.getState().begin({ rideId: result.document.rideId, rideRevision: result.document.revision, intent: result.document.intent }); }
    }} route={route} document={document} editing={breadcrumb.editing} libraryService={libraryService} elevation={elevation} measurements={measurements} onClear={breadcrumb.clear} onToggleSnap={(index) => void breadcrumb.toggleSnap(index)} snapping={breadcrumb.snapping} snapError={breadcrumb.snapError} onStart={rideActions?.startBreadcrumb === undefined ? undefined : async () => { const result = await rideActions.startBreadcrumb!(rideDocumentStore.getState().document); return result.outcome === "rejected" ? result.message : null; }} />
  );
  /** Map handlers: breadcrumb gets first refusal, everything else falls through. */
  const mapProps = (fallback: { readonly pointAction: (action: MapPointAction, coordinate: Coordinate) => void; readonly intercept: (intent: MapIntent) => boolean }, handleIntent: (intent: MapIntent) => void, longPressWhenIdle: boolean) => ({
    longPressEnabled: !breadcrumb.editing && longPressWhenIdle,
    onPointAction: (action: MapPointAction, coordinate: Coordinate): void => {
      if (action !== "breadcrumb") { fallback.pointAction(action, coordinate); return; }
      add(coordinate);
      beginEditing();
    },
    onIntent: (intent: MapIntent): void => { if (!breadcrumb.intercept(intent) && !fallback.intercept(intent)) handleIntent(intent); },
    onCamera: (camera: { readonly center?: Coordinate | undefined }): void => { if (camera.center !== undefined) setMapCenter(camera.center); },
  });
  return { breadcrumb, bar, mapGlance, dockGlance, mapProps };
}

/** The scene with the breadcrumb route and waypoints projected onto it. */
export function useBreadcrumbScene(project: (scene: MapScene) => MapScene, scene: MapScene): MapScene {
  return useMemo(() => project(scene), [project, scene]);
}
