"use client";

import { useCallback, useRef, useState } from "react";
import type { MapIntent, MapObjectRef, MapScene } from "@/application/map/types";
import { straightBreadcrumb } from "@/domain/breadcrumb/route";
import type { BreadcrumbRoute, BreadcrumbWaypoint } from "@/domain/breadcrumb/types";
import { newCommandId } from "@/domain/ride/ids";
import type { Coordinate, RideDocument } from "@/domain/ride/types";
import type { RideDocumentStore } from "@/ui/stores/ride-document-store";
import { snapBreadcrumbLeg } from "@/application/breadcrumb/snap";

function replaceWaypoints(route: BreadcrumbRoute | null | undefined, waypoints: readonly BreadcrumbWaypoint[]): BreadcrumbRoute {
  const next = straightBreadcrumb(waypoints);
  if (route == null) return next;
  return { ...next, legs: next.legs.map((leg, index) => {
    const start = waypoints[index]!;
    const end = waypoints[index + 1]!;
    const oldIndex = route.waypoints.findIndex((point, position) => point.id === start.id && route.waypoints[position + 1]?.id === end.id);
    const oldStart = route.waypoints[oldIndex];
    const oldEnd = route.waypoints[oldIndex + 1];
    return oldIndex >= 0 && oldStart?.coordinate.lon === start.coordinate.lon && oldStart.coordinate.lat === start.coordinate.lat && oldEnd?.coordinate.lon === end.coordinate.lon && oldEnd.coordinate.lat === end.coordinate.lat ? route.legs[oldIndex]! : leg;
  }) };
}

export function usePlannerBreadcrumb(document: RideDocument, store: RideDocumentStore) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; coordinate: Coordinate } | null>(null);
  const [snapping, setSnapping] = useState<number | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const drag = useRef<string | null>(null);
  const route = document.intent.breadcrumb ?? null;

  const commit = useCallback((next: BreadcrumbRoute | null, label: string): void => {
    const current = store.getState().document;
    store.getState().dispatch({ type: "breadcrumb.set", commandId: newCommandId(), rideId: current.rideId, baseRevision: current.revision, source: "map", label, breadcrumb: next });
  }, [store]);
  const add = useCallback((coordinate: Coordinate): void => {
    const current = store.getState().document.intent.breadcrumb;
    const point = { id: `breadcrumb_${crypto.randomUUID()}`, coordinate };
    commit(replaceWaypoints(current, [...(current?.waypoints ?? []), point]), "Added breadcrumb waypoint");
  }, [store, commit]);
  const edit = useCallback((id: string, update: (point: BreadcrumbWaypoint) => BreadcrumbWaypoint | null, label: string): void => {
    const current = store.getState().document.intent.breadcrumb;
    if (current == null) return;
    const points = current.waypoints.flatMap((point) => point.id === id ? [update(point)].filter((item): item is BreadcrumbWaypoint => item !== null) : [point]);
    commit(replaceWaypoints(current, points), label);
  }, [store, commit]);
  const toggleSnap = useCallback(async (index: number): Promise<void> => {
    const current = store.getState().document;
    const currentRoute = current.intent.breadcrumb;
    const leg = currentRoute?.legs[index];
    if (currentRoute == null || leg === undefined) return;
    setSnapError(null);
    if (leg.kind === "snapped") {
      const straight = straightBreadcrumb(currentRoute.waypoints).legs[index]!;
      commit({ ...currentRoute, legs: currentRoute.legs.map((value, position) => position === index ? straight : value) }, "Made breadcrumb leg straight");
      return;
    }
    setSnapping(index);
    try {
      const geometry = await snapBreadcrumbLeg(current, index, AbortSignal.timeout(30000));
      if (store.getState().document.revision !== current.revision) { setSnapError("The route changed. Try snapping this leg again."); return; }
      commit({ ...currentRoute, legs: currentRoute.legs.map((value, position) => position === index ? { kind: "snapped", geometry } : value) }, "Snapped breadcrumb leg");
    } catch {
      setSnapError("Trail or road snapping is unavailable for this leg. The straight line remains.");
    } finally { setSnapping(null); }
  }, [store, commit]);
  const pointId = useCallback((ref: MapObjectRef | null): string | null => {
    if (ref?.kind !== "point") return null;
    return store.getState().document.intent.breadcrumb?.waypoints.some((point) => point.id === ref.pointId) ? ref.pointId : null;
  }, [store]);
  const intercept = useCallback((intent: MapIntent): boolean => {
    if (intent.type === "gesture-cancel" && drag.current !== null) {
      drag.current = null; setDragPreview(null); return true;
    }
    if (intent.type === "pointer-down") {
      const id = pointId(intent.ref);
      if (id !== null) { drag.current = id; return true; }
    }
    if (intent.type === "pointer-move" && drag.current !== null) {
      setDragPreview({ id: drag.current, coordinate: intent.coordinate }); return true;
    }
    if (intent.type === "pointer-up" && drag.current !== null) return true;
    if (intent.type === "gesture-commit" && drag.current !== null) {
      const id = drag.current; drag.current = null; setDragPreview(null);
      const coordinate = intent.geometry.at(-1);
      if (coordinate !== undefined) edit(id, (point) => ({ ...point, coordinate }), "Moved breadcrumb waypoint");
      return true;
    }
    if (intent.type === "object-click") {
      const id = pointId(intent.ref);
      if (id !== null) { drag.current = null; setDragPreview(null); setSelected(id); return true; }
    }
    if (editing && (intent.type === "map-click" || intent.type === "object-click" || intent.type === "overlap-click")) {
      add(intent.coordinate); return true;
    }
    return false;
  }, [add, edit, editing, pointId]);
  const project = useCallback((scene: MapScene): MapScene => {
    if (route === null) return scene;
    const points = route.waypoints.map((point) => ({ id: point.id as never, kind: "shaping" as const, coordinate: dragPreview?.id === point.id ? dragPreview.coordinate : point.coordinate, label: point.name ?? null }));
    const geometry = route.legs.flatMap((leg, index) => index === 0 ? [...leg.geometry] : leg.geometry.slice(1));
    return { ...scene, routes: geometry.length < 2 ? [] : [{ id: "breadcrumb_route" as never, role: null, geometry, state: "selected" }], selectedRouteId: "breadcrumb_route" as never, points, preview: null };
  }, [route, dragPreview]);
  return { route, editing, selected, setSelected, setEditing, add, edit, intercept, project, toggleSnap, snapping, snapError };
}
