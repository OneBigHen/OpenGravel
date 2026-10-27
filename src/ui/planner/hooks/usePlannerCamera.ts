"use client";

/**
 * Automatic camera fitting and measured planner insets.
 *
 * Camera ownership and fit requests remain in PlannerUiStore; this hook only
 * derives the declarative map fit and measures the surfaces around it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { drawnRoutesKey } from "@/application/map/build-map-scene";
import { computeInsets, toRect, type Rect } from "@/application/map/insets";
import type { MapScene } from "@/application/map/types";
import type { PlanningSessionSnapshot } from "@/application/planner/planning-session";
import type { PlannerUiStore } from "@/ui/stores/planner-ui-store";

/** How far in from the map's sides a phone's floating sheet may sit and still
 *  count as a bottom sheet (it floats 8px in; 24px leaves room for safe areas). */
const FLOATING_SHEET_INSET_PX = 24;

const SETTLED_PHASES: ReadonlySet<string> = new Set(["ready", "failed", "cancelled"]);

function px(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function readSafeArea() {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    top: px(style.getPropertyValue("--og-safe-top")),
    right: px(style.getPropertyValue("--og-safe-right")),
    bottom: px(style.getPropertyValue("--og-safe-bottom")),
    left: px(style.getPropertyValue("--og-safe-left")),
  };
}

/** The ride inspector beside the map slot, when the composition has one. */
/** Controls that float over the top of the map on every tier (UX rework 2, #8). */
const TOP_CHROME = ["places-control", "top-search"] as const;
/** The map's own button column down its right-hand side. */
const SIDE_CHROME = ["map-satellite-toggle", "show-whole-ride", "map-layers"] as const;

/**
 * The floating chrome as two bands, so a fit frames the route in the map the
 * rider can see instead of under the places chip or the
 * button column. Bands, not the raw buttons: a raw floating rect would also
 * inset the nearest side edge by its whole distance from it.
 */
function chromeBands(map: Rect): Rect[] {
  const visible = (id: string): DOMRect | null => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (element === null) return null;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? box : null;
  };
  const bands: Rect[] = [];
  const mapBottom = map.top + map.height;
  const mapRight = map.left + map.width;
  let topEdge = map.top;
  for (const id of TOP_CHROME) {
    const box = visible(id);
    if (box !== null && box.top < map.top + map.height / 3 && box.bottom > map.top) topEdge = Math.max(topEdge, box.bottom);
  }
  if (topEdge > map.top) bands.push({ left: map.left, top: map.top, width: map.width, height: topEdge - map.top });
  let sideLeft = mapRight;
  for (const id of SIDE_CHROME) {
    const box = visible(id);
    if (box !== null && box.left > map.left + map.width / 2 && box.top < mapBottom) sideLeft = Math.min(sideLeft, box.left);
  }
  if (sideLeft < mapRight) bands.push({ left: sideLeft, top: map.top, width: mapRight - sideLeft, height: map.height });
  return bands;
}

function inspectorOf(mapSlot: HTMLElement): HTMLElement | null {
  return mapSlot.parentElement?.querySelector<HTMLElement>(":scope > .og-planner__inspector") ?? null;
}

export function usePlannerCamera(input: {
  readonly scene: MapScene;
  readonly session: PlanningSessionSnapshot;
  readonly cameraUserOwned: boolean;
  readonly fitRequest: ReturnType<PlannerUiStore["getState"]>["fitRequest"];
  readonly plannerUiStore: PlannerUiStore;
}) {
  const { scene, session, cameraUserOwned, fitRequest, plannerUiStore } = input;
  // The map holds still under the pen: a snap-as-you-go answer arriving mid-
  // drawing must not re-frame the map (it would cancel the stroke in progress
  // and move the roads away from the finger). Done re-frames on the answer.
  const drawing = useStore(plannerUiStore, (state) => state.activeTool === "sketch");

  const autoFitKey = useMemo(
    () => (cameraUserOwned || drawing ? null : drawnRoutesKey(scene)),
    [cameraUserOwned, drawing, scene],
  );
  const fitExtent = fitRequest?.extent ?? null;
  const autoFitKeyRef = useRef(autoFitKey);
  useEffect(() => {
    if (autoFitKeyRef.current === autoFitKey) return;
    autoFitKeyRef.current = autoFitKey;
    plannerUiStore.getState().clearFitRequest();
  }, [autoFitKey, plannerUiStore]);
  const fitKey = fitRequest === null ? autoFitKey : `fit:${fitRequest.token}`;

  const showWholeRide = useCallback((): void => {
    plannerUiStore.getState().setCameraUserOwned(false);
  }, [plannerUiStore]);

  const framedGenerationRef = useRef(0);
  useEffect(() => {
    if (cameraUserOwned || drawing) return;
    if (session.identity.planningGeneration === 0) return;
    if (!SETTLED_PHASES.has(session.phase)) return;
    if (scene.routes.some((route) => route.geometry.length >= 2)) return;
    if (framedGenerationRef.current === session.identity.planningGeneration) return;
    framedGenerationRef.current = session.identity.planningGeneration;
    plannerUiStore.getState().requestFit(null);
  }, [cameraUserOwned, drawing, scene, session, plannerUiStore]);

  const mapSlotRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const sheetHeadRef = useRef<HTMLDivElement | null>(null);
  const [sheetHeadHeight, setSheetHeadHeight] = useState(0);
  useEffect(() => {
    const measure = (): void => {
      const mapSlot = mapSlotRef.current;
      const dock = dockRef.current;
      if (mapSlot === null || dock === null) return;
      const header = headerRef.current;
      // The wide tier's ride inspector floats over the map's right side.
      const inspector = inspectorOf(mapSlot);
      plannerUiStore.getState().setInsets(
        computeInsets({
          viewport: { width: window.innerWidth, height: window.innerHeight },
          map: toRect(mapSlot.getBoundingClientRect()),
          dock: (() => {
            const box = dock.getBoundingClientRect();
            const map = mapSlot.getBoundingClientRect();
            // A phone's bottom sheet floats a few pixels in from each edge and
            // above the tab bar (DESIGN.md §2, v4): it still hides everything
            // from its top edge down, across the whole width.
            const bottomSheet = box.top > map.top
              && box.left - map.left <= FLOATING_SHEET_INSET_PX
              && map.right - box.right <= FLOATING_SHEET_INSET_PX;
            return toRect(bottomSheet
              ? { left: map.left, top: box.top, width: map.width, height: Math.max(box.height, map.bottom - box.top) }
              : box);
          })(),
          header: header === null ? null : toRect(header.getBoundingClientRect()),
          overlays: [
            ...(inspector === null ? [] : [toRect(inspector.getBoundingClientRect())]),
            ...chromeBands(toRect(mapSlot.getBoundingClientRect())),
          ],
          safeArea: readSafeArea(),
        }),
      );
      const sheetHead = sheetHeadRef.current;
      const measured = sheetHead === null ? 0 : sheetHead.getBoundingClientRect().height;
      setSheetHeadHeight((current) => (current === measured ? current : measured));
    };

    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (observer !== null) {
      if (dockRef.current !== null) observer.observe(dockRef.current);
      if (headerRef.current !== null) observer.observe(headerRef.current);
      if (mapSlotRef.current !== null) observer.observe(mapSlotRef.current);
      for (const id of TOP_CHROME) {
        const chrome = document.querySelector(`[data-testid="${id}"]`);
        if (chrome !== null) observer.observe(chrome);
      }
      if (sheetHeadRef.current !== null) observer.observe(sheetHeadRef.current);
      const inspector = mapSlotRef.current === null ? null : inspectorOf(mapSlotRef.current);
      if (inspector !== null) observer.observe(inspector);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [plannerUiStore]);

  return {
    fitKey,
    fitExtent,
    showWholeRide,
    mapSlotRef,
    dockRef,
    headerRef,
    sheetHeadRef,
    sheetHeadHeight,
  };
}
