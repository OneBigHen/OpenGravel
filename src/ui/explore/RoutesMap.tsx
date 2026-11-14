"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { MapHost } from "@/application/map/map-host";
import type { MapScene } from "@/application/map/types";
import { sortBest, type LibraryChip, type RouteLibrary } from "@/application/route-library/client";
import type { IndexRow } from "@/application/route-library/types";
import { PlannerMap } from "@/ui/map/PlannerMap";
import type { ExploreMapConfig } from "@/ui/explore/ExploreMap";
import { bubblesFor, COUNTRY_EXTENT, extentFromCamera, spreadBubbles, statesInView, type Bubble } from "@/ui/explore/routes-camera";
import { createRoutesOverlay, LINE_MIN_ZOOM, STATE_BUBBLE_MAX_ZOOM, type MapView } from "@/ui/explore/routes-overlay";
import { RoutesMapCard } from "@/ui/explore/RoutesMapCard";

export interface RoutesCamera {
  readonly lat: number;
  readonly lon: number;
  readonly zoom: number;
}

export interface RoutesMapProps extends ExploreMapConfig {
  readonly library: RouteLibrary;
  /** The rides that pass the chips (and Standout). */
  readonly rows: readonly IndexRow[];
  readonly chips: readonly LibraryChip[];
  readonly standoutOnly: boolean;
  /** Where the map opens; the whole country when absent. */
  readonly camera: RoutesCamera | null;
  /** The view settled: the numbers the address bar and the "rides here" pill need. */
  readonly onView: (view: MapView) => void;
  readonly onOpen: (id: string) => void;
  /** The card sits above this bottom clearance (the pill and tab bar); CSS owns the number. */
  readonly className?: string;
}

const EMPTY_SCENE: MapScene = {
  mode: "explore",
  routes: [],
  selectedRouteId: null,
  points: [],
  preview: null,
  avoidAreas: [],
  roadSpans: [],
  sketch: null,
  avoidHandles: [],
  previewArea: null,
  selectedObject: null,
};

const GROUP_ZOOM_STEP = 2;

/**
 * Explore's whole-country map: a bubble per state, then bubbles for groups of
 * rides, then the rides themselves as thin lines. The bubbles are page buttons
 * pinned to the map (so they are real, labelled, thumb-sized controls); the
 * lines and dots are map layers (routes-overlay.ts).
 */
export function RoutesMap({ library, rows, chips, standoutOnly, camera, onView, onOpen, hostFactory, basemap, assetBasePath, className }: RoutesMapProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<MapHost | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [pickedIds, setPickedIds] = useState<readonly string[]>([]);
  const [pickedIndex, setPickedIndex] = useState(0);
  const [initial] = useState(() => camera);
  const [linesDrawn, setLinesDrawn] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const byId = useMemo(() => new Map(library.rows.map((row) => [row.id, row])), [library.rows]);
  const handlers = useRef({ onView, tap: (ids: readonly string[]): void => { void ids; }, frame: () => {} });
  // The callbacks only read the ref when the map fires them, never during render.
  /* eslint-disable react-hooks/refs */
  const overlay = useMemo(
    () => createRoutesOverlay({
      onView: (next) => { setView(next); handlers.current.onView(next); },
      onTap: (ids) => handlers.current.tap(ids),
      onFrame: () => handlers.current.frame(),
    }),
    [],
  );
  /* eslint-enable react-hooks/refs */

  useEffect(() => { handlers.current.onView = onView; }, [onView]);

  // The map opens on the whole country, or where the address bar says it was.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame !== null) setSize({ width: frame.clientWidth, height: frame.clientHeight });
  }, []);
  const fitExtent = useMemo(() => {
    if (initial === null) return COUNTRY_EXTENT;
    if (size === null) return null;
    return extentFromCamera(initial.lat, initial.lon, initial.zoom, size.width, size.height);
  }, [initial, size]);

  // The opening fit: PlannerMap's own mount fit frames an empty scene, so say where to look.
  const fitted = useRef<MapHost | null>(null);
  useEffect(() => {
    if (host === null || fitExtent === null || fitted.current === host) return;
    fitted.current = host;
    host.fitBounds(fitExtent, { top: 0, right: 0, bottom: 0, left: 0 });
  }, [host, fitExtent]);

  useEffect(() => {
    overlay.setAllRows(library.rows);
  }, [library.rows, overlay]);
  useEffect(() => {
    overlay.setShownRows(rows);
    overlay.setChips(chips, standoutOnly);
  }, [rows, chips, standoutOnly, overlay]);
  useEffect(() => {
    if (host?.attachOverlay === undefined) return undefined;
    return host.attachOverlay(overlay.attach);
  }, [host, overlay]);

  // Line files for the states in view, one request each, once.
  const openingFitSeen = useRef(false);
  useEffect(() => {
    if (view === null) return;
    // The map first reports a stand-in view while it is still flying to the opening
    // frame (it is zoomed in on the app's default place); that is not worth six
    // state downloads. The first view that matches the opening frame ends the wait.
    if (!openingFitSeen.current) {
      const matches = initial === null ? view.zoom < STATE_BUBBLE_MAX_ZOOM : Math.abs(view.zoom - initial.zoom) < 0.5;
      if (!matches) return;
      openingFitSeen.current = true;
    }
    if (view.zoom < LINE_MIN_ZOOM) return;
    let live = true;
    const timer = setTimeout(() => {
      for (const state of statesInView(library.rows, view.bounds)) {
        void library.linesFor(state).then((lines) => { if (live && lines !== null) { overlay.addLines(state, lines); setLinesDrawn(overlay.linesLoaded()); } });
      }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [view, library, overlay, initial]);

  const pickedRows = useMemo(() => pickedIds.flatMap((id) => { const row = byId.get(id); return row === undefined ? [] : [row]; }), [pickedIds, byId]);
  useEffect(() => {
    overlay.setPicked(pickedRows[pickedIndex]?.id ?? null);
  }, [overlay, pickedRows, pickedIndex]);

  useEffect(() => {
    handlers.current.tap = (ids) => {
      const found = sortBest(ids.flatMap((id) => { const row = byId.get(id); return row === undefined ? [] : [row]; }));
      setPickedIds(found.map((row) => row.id));
      setPickedIndex(0);
    };
  }, [byId]);

  const bubbles = useMemo<readonly Bubble[]>(
    () => (view === null ? [] : bubblesFor(rows, view.zoom, view.bounds)),
    [rows, view],
  );

  // Page bubbles follow the map while it moves.
  const place = useCallback((): void => {
    const layer = bubbleRef.current;
    if (layer === null) return;
    const placed: { element: HTMLElement; x: number; y: number }[] = [];
    for (const element of layer.querySelectorAll<HTMLElement>("[data-lon]")) {
      const point = overlay.project(Number(element.dataset["lon"]), Number(element.dataset["lat"]));
      if (point === null) continue;
      placed.push({ element, x: point.x, y: point.y });
    }
    // The states crowd the east coast on a phone: nudge their bubbles apart so each count reads.
    if (placed.length > 1 && placed[0]?.element.dataset["kind"] === "state") spreadBubbles(placed, 42, 14, { minX: 24, maxX: layer.clientWidth - 24, minY: 84, maxY: layer.clientHeight - 100 });
    for (const { element, x, y } of placed) {
      element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      element.style.visibility = "visible";
    }
  }, [overlay]);
  useEffect(() => { handlers.current.frame = place; }, [place]);
  useLayoutEffect(() => { place(); }, [place, bubbles]);

  function openBubble(bubble: Bubble): void {
    const zoom = view?.zoom ?? 3;
    if (bubble.kind === "state") {
      // Look where the state's best ride is, not at the state's middle: a state's rides can all be at one edge.
      let best: IndexRow | null = null;
      for (const row of rows) {
        if (row.p !== null && bubble.state !== undefined && row.st.includes(bubble.state) && (best === null || row.q > best.q)) best = row;
      }
      if (best?.p != null) { overlay.zoomTo(best.p[1], best.p[0], 6); return; }
    }
    overlay.zoomTo(bubble.lon, bubble.lat, bubble.kind === "state" ? 6 : Math.min(Math.max(zoom + GROUP_ZOOM_STEP, LINE_MIN_ZOOM + 0.5), 12));
  }

  const picked = pickedRows[pickedIndex];
  return (
    <div className={className === undefined ? "og-routes__map" : `og-routes__map ${className}`} ref={frameRef} data-testid="routes-map" data-zoom={view === null ? undefined : view.zoom.toFixed(1)} data-bubbles={bubbles.length} data-lines={linesDrawn}>
      {fitExtent === null ? null : (
        <PlannerMap
          scene={EMPTY_SCENE}
          onIntent={() => {}}
          label="Map of rides across the country"
          hostFactory={hostFactory}
          activeTool="pan"
          basemap={basemap}
          dimmed={false}
          fitKey={initial === null ? "country" : "camera"}
          fitExtent={fitExtent}
          onHost={setHost}
          {...(assetBasePath === undefined ? {} : { assetBasePath })}
        />
      )}
      <div className="og-routes__bubbles" ref={bubbleRef}>
        {bubbles.map((bubble) => (
          <button
            key={bubble.key}
            type="button"
            className="og-routes__bubble"
            data-lon={bubble.lon}
            data-lat={bubble.lat}
            data-kind={bubble.kind}
            {...(bubble.state === undefined ? {} : { "data-state": bubble.state })}
            aria-label={bubble.label}
            style={{ visibility: "hidden" }}
            onClick={() => openBubble(bubble)}
          >
            {bubble.count}
          </button>
        ))}
      </div>
      {picked === undefined ? null : (
        <RoutesMapCard
          rows={pickedRows}
          index={pickedIndex}
          sources={library.sources}
          onIndex={setPickedIndex}
          onOpen={onOpen}
          onClose={() => { setPickedIds([]); setPickedIndex(0); }}
        />
      )}
    </div>
  );
}
