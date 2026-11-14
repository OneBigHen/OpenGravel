import type { OverlayContext, OverlayMap } from "@/application/map/map-host";
import type { LibraryChip, LinePart, StateLines, ViewBounds } from "@/application/route-library/client";
import type { IndexRow } from "@/application/route-library/types";

/**
 * The ride library's own layers on the Explore map: thin plum lines (dashed for
 * Dirt and Trails), small dots for rides that have a place but no line, and the
 * chosen ride drawn full weight. The count bubbles are page elements, not map
 * layers (see RoutesMap), so this file never draws text.
 *
 * The map only draws what it is told: rows and lines come in, taps and the
 * visible view go out. It owns no data of its own.
 */

/** Below this the map shows one bubble per state; from it, bubbles for groups of rides. */
export const STATE_BUBBLE_MAX_ZOOM = 5;
/** From here the rides themselves are drawn. */
export const LINE_MIN_ZOOM = 7;
/** How far from a fingertip a ride still counts as touched, in CSS pixels. */
export const TAP_RADIUS_PX = 12;

const SRC_LINES = "og-lib-lines";
const SRC_DOTS = "og-lib-dots";
const SRC_PICK = "og-lib-picked";
const L_SOLID = "og-lib-lines-solid";
const L_DASH = "og-lib-lines-dash";
const L_DOTS = "og-lib-dots";
const L_PICK_CASING = "og-lib-picked-casing";
const L_PICK_LINE = "og-lib-picked-line";
const L_PICK_DOT = "og-lib-picked-dot";
const HIT_LAYERS = [L_SOLID, L_DASH, L_DOTS];

export interface MapView {
  readonly zoom: number;
  readonly center: { readonly lon: number; readonly lat: number };
  readonly bounds: ViewBounds;
}

export interface OverlayHandlers {
  /** The camera settled (or the layers were attached): where the map is now. */
  readonly onView: (view: MapView) => void;
  /** A tap landed on rides (best handled by the caller) at this screen point. */
  readonly onTap: (ids: readonly string[]) => void;
  /** The camera is moving: page elements pinned to the map should follow. */
  readonly onFrame: () => void;
}

export interface RoutesOverlay {
  readonly attach: (context: OverlayContext) => () => void;
  /** Every row in the index, for looking up a line's type and score. */
  setAllRows(rows: readonly IndexRow[]): void;
  /** The rows that pass the chips: only these draw. */
  setShownRows(rows: readonly IndexRow[]): void;
  setChips(types: readonly LibraryChip[], standoutOnly: boolean): void;
  addLines(state: string, lines: StateLines): void;
  setPicked(id: string | null): void;
  project(lon: number, lat: number): { readonly x: number; readonly y: number } | null;
  zoomTo(lon: number, lat: number, zoom: number): void;
  view(): MapView | null;
  /** How many rides have their line loaded. */
  linesLoaded(): number;
}

type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
const empty = { type: "FeatureCollection", features: [] as Feature[] };

function chipTest(chip: LibraryChip): unknown {
  switch (chip) {
    case "twisty": return ["==", ["get", "t"], "twisty"];
    case "scenic": return ["==", ["get", "t"], "scenic"];
    case "dirt": return ["==", ["get", "t"], "dirt"];
    case "trails": return ["==", ["get", "t"], "trail"];
    case "trips": return ["==", ["get", "k"], "trip"];
  }
}

/** The lines' filter for the chips: any chosen chip, and Standout when asked. */
export function lineFilter(types: readonly LibraryChip[], standoutOnly: boolean, dashed: boolean): unknown[] {
  const parts: unknown[] = [["match", ["get", "t"], ["dirt", "trail"], dashed, !dashed]];
  if (types.length > 0) parts.push(["any", ...types.map(chipTest)]);
  if (standoutOnly) parts.push([">=", ["get", "q"], 5]);
  return ["all", ...parts];
}

function lineFeature(row: IndexRow, parts: readonly LinePart[]): Feature {
  return {
    type: "Feature",
    properties: { id: row.id, t: row.t, k: row.k, q: row.q },
    geometry: parts.length === 1
      ? { type: "LineString", coordinates: parts[0] }
      : { type: "MultiLineString", coordinates: parts },
  };
}

export function createRoutesOverlay(handlers: OverlayHandlers): RoutesOverlay {
  let map: OverlayMap | null = null;
  let rowsById = new Map<string, IndexRow>();
  let shown: readonly IndexRow[] = [];
  let types: readonly LibraryChip[] = [];
  let standoutOnly = false;
  let picked: string | null = null;
  const stateLines = new Map<string, StateLines>();
  /** One feature per ride, whichever state file it came from. */
  const drawn = new Map<string, Feature>();
  const partsById = new Map<string, readonly LinePart[]>();

  function setData(source: string, features: readonly Feature[]): void {
    map?.getSource(source)?.setData({ type: "FeatureCollection", features });
  }

  function pushDots(): void {
    const features: Feature[] = [];
    for (const row of shown) {
      if (row.p === null || partsById.has(row.id)) continue;
      features.push({ type: "Feature", properties: { id: row.id, q: row.q, t: row.t, k: row.k }, geometry: { type: "Point", coordinates: [row.p[1], row.p[0]] } });
    }
    setData(SRC_DOTS, features);
  }

  function pushPicked(): void {
    const row = picked === null ? undefined : rowsById.get(picked);
    const parts = picked === null ? undefined : partsById.get(picked);
    if (row === undefined) return setData(SRC_PICK, []);
    if (parts !== undefined) return setData(SRC_PICK, [lineFeature(row, parts)]);
    if (row.p !== null) setData(SRC_PICK, [{ type: "Feature", properties: { id: row.id }, geometry: { type: "Point", coordinates: [row.p[1], row.p[0]] } }]);
    else setData(SRC_PICK, []);
  }

  function pushLines(): void {
    setData(SRC_LINES, [...drawn.values()]);
  }

  function pushFilters(): void {
    if (map === null) return;
    if (map.getLayer(L_SOLID) !== undefined) map.setFilter(L_SOLID, lineFilter(types, standoutOnly, false));
    if (map.getLayer(L_DASH) !== undefined) map.setFilter(L_DASH, lineFilter(types, standoutOnly, true));
  }

  function currentView(): MapView | null {
    if (map === null) return null;
    const [[west, south], [east, north]] = map.getBounds().toArray() as readonly [readonly [number, number], readonly [number, number]];
    const centre = map.getCenter();
    return { zoom: map.getZoom(), center: { lon: centre.lng, lat: centre.lat }, bounds: { west, south, east, north } };
  }

  function attach({ map: live, colours }: OverlayContext): () => void {
    map = live;
    const add = (id: string): void => {
      if (live.getSource(id) === undefined) live.addSource(id, { type: "geojson", data: empty });
    };
    for (const id of [SRC_LINES, SRC_DOTS, SRC_PICK]) add(id);
    const lineWidth = ["interpolate", ["linear"], ["zoom"], 7, 1.2, 10, 2, 14, 3.2];
    const common = { type: "line", source: SRC_LINES, minzoom: LINE_MIN_ZOOM, layout: { "line-cap": "round", "line-join": "round" } };
    live.addLayer({ ...common, id: L_SOLID, filter: lineFilter(types, standoutOnly, false), paint: { "line-color": colours.route, "line-width": lineWidth, "line-opacity": 0.8 } });
    live.addLayer({ ...common, id: L_DASH, filter: lineFilter(types, standoutOnly, true), paint: { "line-color": colours.route, "line-width": lineWidth, "line-opacity": 0.85, "line-dasharray": [2, 1.4] } });
    live.addLayer({ id: L_DOTS, type: "circle", source: SRC_DOTS, minzoom: LINE_MIN_ZOOM, paint: { "circle-radius": 4.5, "circle-color": colours.route, "circle-stroke-color": colours.paper, "circle-stroke-width": 1.5 } });
    const pickWidth = ["interpolate", ["linear"], ["zoom"], 7, 3, 12, 5, 16, 7];
    live.addLayer({ id: L_PICK_CASING, type: "line", source: SRC_PICK, filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colours.paper, "line-width": ["+", pickWidth, 3], "line-opacity": 0.9 } });
    live.addLayer({ id: L_PICK_LINE, type: "line", source: SRC_PICK, filter: ["!=", ["geometry-type"], "Point"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colours.route, "line-width": pickWidth } });
    live.addLayer({ id: L_PICK_DOT, type: "circle", source: SRC_PICK, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": colours.route, "circle-stroke-color": colours.paper, "circle-stroke-width": 3 } });
    pushLines();
    pushDots();
    pushPicked();

    const onClick = (payload: unknown): void => {
      const point = (payload as { point?: { x: number; y: number } }).point;
      if (point === undefined) return;
      const layers = HIT_LAYERS.filter((id) => live.getLayer(id) !== undefined);
      if (layers.length === 0) return;
      const hits = live.queryRenderedFeatures([[point.x - TAP_RADIUS_PX, point.y - TAP_RADIUS_PX], [point.x + TAP_RADIUS_PX, point.y + TAP_RADIUS_PX]], { layers });
      const ids = [...new Set(hits.flatMap((hit) => typeof hit.properties?.["id"] === "string" ? [hit.properties["id"]] : []))];
      handlers.onTap(ids);
    };
    const onSettled = (): void => {
      const view = currentView();
      if (view !== null) handlers.onView(view);
    };
    const onMove = (): void => handlers.onFrame();
    live.on("click", onClick);
    live.on("moveend", onSettled);
    live.on("move", onMove);
    onSettled();
    return () => {
      live.off("click", onClick);
      live.off("moveend", onSettled);
      live.off("move", onMove);
      if (map === live) map = null;
      for (const id of [L_PICK_DOT, L_PICK_LINE, L_PICK_CASING, L_DOTS, L_DASH, L_SOLID]) if (live.getLayer(id) !== undefined) live.removeLayer(id);
      for (const id of [SRC_PICK, SRC_DOTS, SRC_LINES]) if (live.getSource(id) !== undefined) live.removeSource(id);
    };
  }

  return {
    attach,
    setAllRows(rows) { rowsById = new Map(rows.map((row) => [row.id, row])); },
    setShownRows(rows) { shown = rows; pushDots(); },
    setChips(nextTypes, nextStandout) { types = nextTypes; standoutOnly = nextStandout; pushFilters(); },
    addLines(state, lines) {
      if (stateLines.has(state)) return;
      stateLines.set(state, lines);
      for (const [id, parts] of lines) {
        const row = rowsById.get(id);
        if (row === undefined || partsById.has(id)) continue;
        partsById.set(id, parts);
        drawn.set(id, lineFeature(row, parts));
      }
      pushLines();
      pushDots();
      pushPicked();
    },
    setPicked(id) { picked = id; pushPicked(); },
    project(lon, lat) {
      if (map === null) return null;
      const point = map.project([lon, lat]);
      return { x: point.x, y: point.y };
    },
    zoomTo(lon, lat, zoom) { map?.easeTo({ center: [lon, lat], zoom, duration: 350 }); },
    view: currentView,
    linesLoaded: () => partsById.size,
  };
}

