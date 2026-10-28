"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { LibraryServicePort } from "@/application/library/library-service";
import type { PreparationProviderRegistry } from "@/application/preparation/providers";
import type { MapIntent, MapPointAction, MapScene } from "@/application/map/types";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
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
  const breadcrumb = usePlannerBreadcrumb(document, rideDocumentStore);
  const [mapCenter, setMapCenter] = useState<Coordinate | null>(null);
  const { route, selected, setEditing, setSelected, add, edit } = breadcrumb;
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
    <BreadcrumbSummary route={route} document={document} editing={breadcrumb.editing} libraryService={libraryService} source={preparationProviders?.breadcrumbElevationProfile} onToggleSnap={(index) => void breadcrumb.toggleSnap(index)} snapping={breadcrumb.snapping} snapError={breadcrumb.snapError} onStart={rideActions?.startBreadcrumb === undefined ? undefined : async () => { const result = await rideActions.startBreadcrumb!(rideDocumentStore.getState().document); return result.outcome === "rejected" ? result.message : null; }} />
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
