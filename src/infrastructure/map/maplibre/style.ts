/**
 * The cartography table (05-MAP-INTERACTION-AND-CARTOGRAPHY §11–§15, §21, §23;
 * 12-DESIGN-SYSTEM-RESPONSIVE-ACCESSIBILITY §9).
 *
 * Every colour here comes from the design tokens in `src/app/globals.css`, read
 * at host-creation time from the document with the token values as documented
 * fallbacks. That is deliberate: the palette has one source of truth, the
 * stylesheet, and a layer can never drift into a colour that is not a token.
 *
 * The layer set is small on purpose (05 §14–§15: a layer catalogue is not a
 * feature). It is exactly what `MapScene` can draw:
 *
 * - routes, with the five 05 §11 treatments (selected, alternative, preview,
 *   previous, proposed) and the selected one unmistakably heaviest,
 * - points (start, finish, stop, shaping) with a selection halo,
 * - avoid areas as a low-opacity warm fill with a solid selection edge (05 §21),
 * - road spans, split by mode so a `must` span and an `avoid` span never read as
 *   the same constraint,
 * - nearby place dots and listing-map pills (OGV-D-274), below every ride layer,
 * - the sketch corridor as a dashed transient line.
 *
 * Sources are declared here and layered by the host. The empty basemap has no
 * sources at all, which is what makes `empty` deterministic: no tile request, no
 * attribution, and the same pixels on every machine.
 */

import { INFO_SOURCE_ID, infoLayerSpecs } from "./info-layers";
import { PLACE_IMAGE_IDS, ROUTE_LABEL_IMAGE_IDS } from "./place-images";
import { PUCK_IMAGE_ID } from "./puck-image";
import { MARKER_IMAGE_IDS } from "./marker-images";

/** The tokens the cartography uses, as literal CSS colour values. */
export interface MapPalette {
  readonly ink: string;
  readonly paper: string;
  readonly canvas: string;
  readonly ember: string;
  readonly emberStrong: string;
  readonly slate: string;
  readonly topoSage: string;
  readonly signalBlue: string;
  readonly goldenHour: string;
  readonly trailBrown: string;
  readonly deepSpruce: string;
  readonly routePlum: string;
  readonly routePlumStrong: string;
  /**
   * The selected route's casing: `auto` draws it in the route's own strong
   * tint; a colour (Ride Focus in Day) gives the line a dark edge that holds
   * up in direct sunlight.
   */
  readonly routeCasing: string;
  /** A width multiplier for the route and the rider's mark (Ride Focus in Day). */
  readonly emphasis: string;
}

/** The `globals.css` token values, used when the stylesheet cannot be read. */
export const DEFAULT_MAP_PALETTE: MapPalette = {
  ink: "#161d1c",
  paper: "#fbf9f4",
  canvas: "#f4f0e7",
  ember: "#d65a36",
  emberStrong: "#bf4829",
  slate: "#68716f",
  topoSage: "#9da98f",
  signalBlue: "#397c96",
  goldenHour: "#c99a46",
  trailBrown: "#776353",
  deepSpruce: "#243a35",
  routePlum: "#7b4fa0",
  routePlumStrong: "#5e3a7c",
  routeCasing: "auto",
  emphasis: "1",
};

/** Token name per palette slot, in the order `readMapPalette` reads them. */
const TOKEN_NAMES: Readonly<Record<keyof MapPalette, string>> = {
  ink: "--og-ink",
  paper: "--og-paper",
  canvas: "--og-canvas",
  ember: "--og-ember",
  emberStrong: "--og-ember-strong",
  slate: "--og-slate",
  topoSage: "--og-topo-sage",
  signalBlue: "--og-signal-blue",
  goldenHour: "--og-golden-hour",
  trailBrown: "--og-trail-brown",
  deepSpruce: "--og-deep-spruce",
  routePlum: "--og-route-plum",
  routePlumStrong: "--og-route-plum-strong",
  routeCasing: "--og-map-route-casing",
  emphasis: "--og-map-emphasis",
};

/**
 * Reads the palette from the live design tokens, falling back per slot.
 *
 * A slot whose token is missing or unreadable keeps the documented literal, so a
 * renderer can never end up with an empty colour (which MapLibre would reject at
 * `addLayer` time, taking the whole layer with it).
 */
export function readMapPalette(root: HTMLElement | null = null): MapPalette {
  const element = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (element === null) return DEFAULT_MAP_PALETTE;
  const computed = getComputedStyle(element);
  const palette = { ...DEFAULT_MAP_PALETTE } as Record<keyof MapPalette, string>;
  for (const key of Object.keys(TOKEN_NAMES) as (keyof MapPalette)[]) {
    const value = computed.getPropertyValue(TOKEN_NAMES[key]).trim();
    if (value.length > 0) palette[key] = value;
  }
  return palette;
}

/** Source ids. One GeoJSON source per drawable part of the scene. */
export const MAP_SOURCE_IDS = {
  routes: "ogv-routes",
  points: "ogv-points",
  avoidAreas: "ogv-avoid-areas",
  avoidPreview: "ogv-avoid-preview",
  roadSpans: "ogv-road-spans",
  roadSpanPreview: "ogv-road-span-preview",
  sketch: "ogv-sketch",
  sketchDraft: "ogv-sketch-draft",
  changedSpan: "ogv-changed-span",
  riderPosition: "ogv-rider-position",
  places: "ogv-places",
  infoLayers: INFO_SOURCE_ID,
  scrubMarker: "ogv-scrub-marker",
} as const;

/** Layer ids. Exported because hit-testing and the E2E seam both name them. */
export const MAP_LAYER_IDS = {
  background: "ogv-background",
  basemapRaster: "ogv-basemap-raster",
  sketchLine: "ogv-sketch-line",
  sketchDraftLine: "ogv-sketch-draft-line",
  avoidFill: "ogv-avoid-fill",
  avoidOutline: "ogv-avoid-outline",
  avoidHandle: "ogv-avoid-handle",
  avoidPreviewFill: "ogv-avoid-preview-fill",
  avoidPreviewOutline: "ogv-avoid-preview-outline",
  roadSpanMust: "ogv-road-span-must",
  roadSpanAvoid: "ogv-road-span-avoid",
  roadSpanPreviewLine: "ogv-road-span-preview-line",
  roadSpanPreviewHandle: "ogv-road-span-preview-handle",
  routePrevious: "ogv-route-previous",
  routeAlternativeCasing: "ogv-route-alternative-casing",
  routeAlternative: "ogv-route-alternative",
  routePreview: "ogv-route-preview",
  routeProposed: "ogv-route-proposed",
  routeCasing: "ogv-route-casing",
  routeSelected: "ogv-route-selected",
  routeLabel: "ogv-route-label",
  changedSpan: "ogv-changed-span",
  pointShaping: "ogv-point-shaping",
  pointStop: "ogv-point-stop",
  pointStart: "ogv-point-start",
  pointFinish: "ogv-point-finish",
  pointSelected: "ogv-point-selected",
  pointPreview: "ogv-point-preview",
  pointPin: "ogv-point-pin",
  avoidSelected: "ogv-avoid-selected",
  roadSpanSelected: "ogv-road-span-selected",
  riderPositionHalo: "ogv-rider-position-halo",
  riderPosition: "ogv-rider-position",
  riderHeading: "ogv-rider-heading",
  placeDot: "ogv-place-dot",
  placePill: "ogv-place-pill",
  placeSelected: "ogv-place-selected",
  scrubMarker: "ogv-scrub-marker",
} as const;

export interface MapSourceSpec {
  readonly type: "geojson";
  readonly data: unknown;
}

export interface MapLayerSpec {
  readonly id: string;
  readonly type: string;
  readonly source?: string;
  readonly filter?: unknown;
  readonly paint?: Readonly<Record<string, unknown>>;
  readonly layout?: Readonly<Record<string, unknown>>;
  readonly minzoom?: number;
  readonly maxzoom?: number;
}

export interface MapStyleSpec {
  readonly version: 8;
  readonly sources: Readonly<Record<string, MapSourceSpec | Record<string, unknown>>>;
  readonly layers: readonly MapLayerSpec[];
}

/** The empty basemap: a paper background and our own layers only (05 §22). */
export function emptyBasemapStyle(palette: MapPalette): MapStyleSpec {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: MAP_LAYER_IDS.background,
        type: "background",
        paint: { "background-color": palette.canvas },
      },
    ],
  };
}

/** The OSM raster fallback: one source, one layer, its own attribution (05 §23). */
export function osmBasemapStyle(palette: MapPalette, tiles: string, attribution: string): MapStyleSpec {
  return {
    version: 8,
    sources: {
      "ogv-basemap": {
        type: "raster",
        tiles: [tiles],
        tileSize: 256,
        attribution,
      },
    },
    layers: [
      {
        id: MAP_LAYER_IDS.background,
        type: "background",
        paint: { "background-color": palette.canvas },
      },
      { id: MAP_LAYER_IDS.basemapRaster, type: "raster", source: "ogv-basemap" },
    ],
  };
}

/**
 * `["==", ["get", key], value]` — the filter shape every layer below uses. The
 * value keeps its JSON type, so a boolean feature property is compared with a
 * boolean literal and never with the string `"true"`.
 */
function equals(key: string, value: string | boolean): unknown {
  return ["==", ["get", key], value];
}

const LINE_LAYOUT = { "line-join": "round", "line-cap": "round" } as const;

/** The palette's width multiplier, clamped to a sane range (1 when unreadable). */
function emphasisOf(palette: MapPalette): number {
  const value = Number.parseFloat(palette.emphasis);
  return Number.isFinite(value) ? Math.min(2, Math.max(1, value)) : 1;
}

/**
 * Route colours by the candidate's bundle index (`tint`), shared with the
 * decision cards in `globals.css` (`.og-route-card[data-tint]`): the rider
 * matches a line to its card by colour, as in a map app's route choices. Signal
 * Blue is not a route colour — it is reserved for the rider's position.
 */
function tintColor(palette: MapPalette, strong: boolean): unknown {
  return [
    "match",
    ["get", "tint"],
    0,
    strong ? palette.emberStrong : palette.ember,
    1,
    strong ? palette.routePlumStrong : palette.routePlum,
    2,
    strong ? palette.ink : palette.deepSpruce,
    palette.slate,
  ];
}

/**
 * Route layers, drawn in ascending weight: the previous route, the alternatives,
 * the preview, the proposal, then the selected line's casing and core. The
 * selected route is last for the same reason it is heaviest: it must never be
 * overdrawn by something the rider did not choose (05 §11).
 */
export function routeLayers(palette: MapPalette): readonly MapLayerSpec[] {
  const dashed = { "line-dasharray": [2, 2] } as const;
  return [
    {
      id: MAP_LAYER_IDS.routePrevious,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "previous"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.topoSage,
        "line-width": 4,
        "line-opacity": 0.45,
      },
    },
    {
      id: MAP_LAYER_IDS.routeAlternativeCasing,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "alternative"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.paper,
        "line-width": 8,
        "line-opacity": 0.9,
      },
    },
    {
      id: MAP_LAYER_IDS.routeAlternative,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "alternative"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": tintColor(palette, false),
        "line-width": 5,
        "line-opacity": 0.8,
      },
    },
    {
      id: MAP_LAYER_IDS.routePreview,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "preview"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.ember,
        "line-width": 5,
        "line-opacity": 0.9,
        ...dashed,
      },
    },
    {
      id: MAP_LAYER_IDS.routeProposed,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "proposed"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.signalBlue,
        "line-width": 4,
        "line-opacity": 0.9,
        ...dashed,
      },
    },
    {
      id: MAP_LAYER_IDS.routeCasing,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "selected"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.routeCasing === "auto" ? tintColor(palette, true) : palette.routeCasing,
        // Street zoom (riding) draws the line bold, like turn-by-turn apps;
        // overview zooms keep the planner's weight.
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 11 * emphasisOf(palette), 15, 14 * emphasisOf(palette), 17, 20 * emphasisOf(palette)],
        "line-opacity": palette.routeCasing === "auto" ? 0.9 : 1,
      },
    },
    {
      id: MAP_LAYER_IDS.routeSelected,
      type: "line",
      source: MAP_SOURCE_IDS.routes,
      filter: equals("state", "selected"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": tintColor(palette, false),
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 6 * emphasisOf(palette), 15, 8 * emphasisOf(palette), 17, 13 * emphasisOf(palette)],
      },
    },
    {
      // "Fastest · 1 h 57 min" where each choice stands apart from the others,
      // so the rider compares routes on the map instead of in a list beside it.
      id: MAP_LAYER_IDS.routeLabel,
      type: "symbol",
      source: MAP_SOURCE_IDS.routes,
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Bold"],
        "text-size": 12.5,
        "text-anchor": "center",
        "text-max-width": 14,
        "text-allow-overlap": false,
        "text-padding": 4,
        "icon-image": ["match", ["get", "tint"], 1, ROUTE_LABEL_IMAGE_IDS[1], 2, ROUTE_LABEL_IMAGE_IDS[2], 3, ROUTE_LABEL_IMAGE_IDS[3], ROUTE_LABEL_IMAGE_IDS[0]],
        "icon-text-fit": "both",
        "icon-text-fit-padding": [3, 8, 3, 8],
        // The chosen route's name wins a collision.
        "symbol-sort-key": ["case", equals("state", "selected"), 0, 1],
      },
      paint: {
        "text-color": palette.ink,
        // Alternatives' names recede a step, as their lines do.
        "icon-opacity": ["case", equals("state", "selected"), 1, 0.92],
        "text-opacity": ["case", equals("state", "selected"), 1, 0.82],
      },
    },
  ];
}

/** Points: endpoints loudest, stops and shaping anchors quieter (05 §11). */
export function pointLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.pointShaping,
      type: "circle",
      source: MAP_SOURCE_IDS.points,
      filter: equals("kind", "shaping"),
      paint: {
        "circle-radius": 4,
        "circle-color": palette.goldenHour,
        "circle-stroke-color": palette.ink,
        "circle-stroke-width": 1,
      },
    },
    {
      id: MAP_LAYER_IDS.pointStop,
      type: "circle",
      source: MAP_SOURCE_IDS.points,
      filter: equals("kind", "stop"),
      paint: {
        "circle-radius": 6,
        "circle-color": palette.topoSage,
        "circle-stroke-color": palette.ink,
        "circle-stroke-width": 2,
      },
    },
    {
      id: MAP_LAYER_IDS.pointStart,
      type: "circle",
      source: MAP_SOURCE_IDS.points,
      filter: equals("kind", "start"),
      paint: {
        "circle-radius": 7,
        "circle-color": palette.signalBlue,
        "circle-stroke-color": palette.paper,
        "circle-stroke-width": 3,
      },
    },
    {
      id: MAP_LAYER_IDS.pointFinish,
      type: "circle",
      source: MAP_SOURCE_IDS.points,
      filter: equals("kind", "finish"),
      paint: {
        // 05 §25: the destination is not "the other colour". It is larger with a
        // heavier ring than the start, so the two ends of the ride differ by more
        // than a hue. The shape cue the previous renderer had (a rounded square)
        // is a recorded gap for the accessibility wave (OGV-D-217).
        "circle-radius": 9,
        "circle-color": palette.ink,
        "circle-stroke-color": palette.paper,
        "circle-stroke-width": 4,
      },
    },
    {
      // The pins over the circles (owner review 2026-10-04): a green "go" start,
      // a checkered finish, numbered white stops. The circles stay underneath as
      // the fallback when the images cannot be added.
      id: MAP_LAYER_IDS.pointPin,
      type: "symbol",
      source: MAP_SOURCE_IDS.points,
      filter: ["match", ["get", "kind"], ["start", "finish", "stop"], true, false],
      layout: {
        "icon-image": [
          "match",
          ["get", "kind"],
          "start",
          MARKER_IMAGE_IDS.start,
          "finish",
          MARKER_IMAGE_IDS.finish,
          MARKER_IMAGE_IDS.stop,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "text-field": ["coalesce", ["get", "order"], ""],
        "text-font": ["Open Sans Bold"],
        "text-size": 13,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        // The finish draws over the start on a loop, and stops over both.
        "symbol-sort-key": ["match", ["get", "kind"], "start", 0, "finish", 1, 2],
      },
      paint: { "text-color": "#161d1c" },
    },
    {
      id: MAP_LAYER_IDS.pointSelected,
      type: "circle",
      source: MAP_SOURCE_IDS.points,
      filter: equals("selected", true),
      paint: {
        "circle-radius": 21,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.ember,
        "circle-stroke-width": 3,
      },
    },
    {
      // The drag ghost (04 §15): hollow, Ember-ringed and *unfilled*, so it reads
      // as a proposal in flight rather than as a placed object — and it is drawn
      // last, above every authored marker. It is deliberately absent from
      // `HIT_LAYER_IDS`: a proposal is not a selectable object (05 §4).
      id: MAP_LAYER_IDS.pointPreview,
      type: "circle",
      source: MAP_SOURCE_IDS.points,
      filter: equals("kind", "preview"),
      paint: {
        "circle-radius": 16,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": palette.ember,
        "circle-stroke-width": 3,
      },
    },
  ];
}

/** Avoid areas: low-opacity warm fill, with a solid edge when selected (05 §21). */
export function avoidAreaLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.avoidFill,
      type: "fill",
      source: MAP_SOURCE_IDS.avoidAreas,
      paint: { "fill-color": palette.goldenHour, "fill-opacity": 0.22 },
    },
    {
      id: MAP_LAYER_IDS.avoidOutline,
      type: "line",
      source: MAP_SOURCE_IDS.avoidAreas,
      layout: LINE_LAYOUT,
      paint: { "line-color": palette.trailBrown, "line-width": 2 },
    },
    {
      id: MAP_LAYER_IDS.avoidSelected,
      type: "line",
      source: MAP_SOURCE_IDS.avoidAreas,
      filter: equals("selected", true),
      layout: LINE_LAYOUT,
      paint: { "line-color": palette.ember, "line-width": 3 },
    },
    {
      // The vertex handles of the selected area (05 §21 "accessible handles"):
      // Paper-filled with an Ink ring, so each handle reads as a grabbable point
      // on the area's edge at any zoom. Drawn last, and deliberately absent from
      // `HIT_LAYER_IDS` — the workspace resolves a vertex drag against the
      // pointer's own coordinate, so the handle must not steal the tap that
      // selects the area underneath it.
      id: MAP_LAYER_IDS.avoidHandle,
      type: "circle",
      source: MAP_SOURCE_IDS.avoidAreas,
      filter: equals("kind", "handle"),
      paint: {
        "circle-radius": 6,
        "circle-color": palette.paper,
        "circle-stroke-color": palette.ink,
        "circle-stroke-width": 2,
      },
    },
  ];
}

/**
 * The in-flight avoid-area gesture (04 §18, 05 §21).
 *
 * A valid preview is Ember-dashed over a warm wash — the same "not yet authored"
 * language the point ghost uses; an invalid one drops to the muted trail colour
 * so a shape the store would refuse reads as refused *while* the rider is still
 * dragging, not as an error afterwards.
 */
export function avoidPreviewLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.avoidPreviewFill,
      type: "fill",
      source: MAP_SOURCE_IDS.avoidPreview,
      paint: { "fill-color": palette.goldenHour, "fill-opacity": 0.16 },
    },
    {
      id: MAP_LAYER_IDS.avoidPreviewOutline,
      type: "line",
      source: MAP_SOURCE_IDS.avoidPreview,
      layout: LINE_LAYOUT,
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "valid"], true],
          palette.ember,
          palette.trailBrown,
        ],
        "line-width": 2,
        "line-dasharray": [2, 2],
      },
    },
  ];
}

/**
 * Road spans, split by mode. A `must` span is solid and confident, an `avoid`
 * span is dashed: the two are opposite instructions and must never read alike
 * (05 §20).
 */export function roadSpanLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.roadSpanAvoid,
      type: "line",
      source: MAP_SOURCE_IDS.roadSpans,
      filter: equals("mode", "avoid"),
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.trailBrown,
        "line-width": 6,
        "line-opacity": 0.8,
        "line-dasharray": [1, 1.5],
      },
    },
    {
      id: MAP_LAYER_IDS.roadSpanMust,
      type: "line",
      source: MAP_SOURCE_IDS.roadSpans,
      filter: equals("mode", "must"),
      layout: LINE_LAYOUT,
      paint: { "line-color": palette.deepSpruce, "line-width": 6, "line-opacity": 0.9 },
    },
    {
      id: MAP_LAYER_IDS.roadSpanSelected,
      type: "line",
      source: MAP_SOURCE_IDS.roadSpans,
      filter: equals("selected", true),
      layout: LINE_LAYOUT,
      paint: { "line-color": palette.ember, "line-width": 8 },
    },
  ];
}

/**
 * The in-flight road-span selection (04 §17, 05 §20): Ember-dashed with a Paper
 * handle at each end, so the span reads as *not yet authored* in the same visual
 * language the point ghost and the avoid-area draft use.
 */
export function roadSpanPreviewLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.roadSpanPreviewLine,
      type: "line",
      source: MAP_SOURCE_IDS.roadSpanPreview,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.ember,
        "line-width": 7,
        "line-opacity": 0.85,
        "line-dasharray": [2, 1.5],
      },
    },
    {
      // The two endpoints (04 §17 "span has visible handles/endpoints"). Drawn
      // last and deliberately absent from `HIT_LAYER_IDS`: the workspace resolves
      // a handle grab against the pointer's own coordinate, so a handle must not
      // steal the tap that selects the route underneath it.
      id: MAP_LAYER_IDS.roadSpanPreviewHandle,
      type: "circle",
      source: MAP_SOURCE_IDS.roadSpanPreview,
      filter: equals("kind", "handle"),
      paint: {
        "circle-radius": 7,
        "circle-color": palette.paper,
        "circle-stroke-color": palette.ember,
        "circle-stroke-width": 3,
      },
    },
  ];
}

/** The sketch corridor: transient, dashed, and never mistaken for a route (05 §19). */
export function sketchLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.sketchLine,
      type: "line",
      source: MAP_SOURCE_IDS.sketch,
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.ink,
        "line-width": 5,
        "line-opacity": 0.5,
        "line-dasharray": [1, 1],
      },
    },
  ];
}

/**
 * The in-flight sketch draft: solid, brighter, and above the committed corridor
 * (04 §19, 05 §18).
 *
 * The draft is what the rider's finger is drawing right now, so it reads as the
 * *current* line while a committed sketch stays faint behind it. It is drawn from
 * its own source, so a pointer move re-uploads a few dozen coordinates instead of
 * the authored scene around it.
 */
export function sketchDraftLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.sketchDraftLine,
      type: "line",
      source: MAP_SOURCE_IDS.sketchDraft,
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.emberStrong,
        "line-width": 4,
        "line-opacity": 0.95,
      },
    },
  ];
}

/**
 * The changed-span emphasis (05 §12): a bright dashed thread over the answer the
 * rider is looking at, from its own source.
 *
 * It is drawn **above** the selected route's casing and core — the whole point is
 * that the rider sees *which part* of the line changed after an update, so the
 * emphasis cannot be overdrawn by the route it annotates — and it is dashed and
 * Paper-bright so it reads as an annotation rather than as a sixth route treatment.
 * It is deliberately absent from `HIT_LAYER_IDS`: a tap on the emphasis is a tap on
 * the route beneath it, never a selection of presentation state.
 */
export function changedSpanLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.changedSpan,
      type: "line",
      source: MAP_SOURCE_IDS.changedSpan,
      layout: LINE_LAYOUT,
      paint: {
        "line-color": palette.paper,
        "line-width": 7,
        "line-opacity": 0.95,
        "line-dasharray": [1.5, 1.5],
      },
    },
  ];
}

/** Nearby provider places (OGV-D-274): dots at low zoom and listing-map pills above it. */
export function placeLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.placeDot,
      type: "circle",
      source: MAP_SOURCE_IDS.places,
      maxzoom: 11.5,
      paint: {
        // Marigold is the places colour at every zoom; live places are the
        // larger, fully opaque dots (UX rework: ink dots read as map noise).
        "circle-radius": ["match", ["get", "tone"], "live", 5, 4],
        "circle-color": palette.goldenHour,
        "circle-opacity": ["match", ["get", "tone"], "live", 1, "soon", 0.85, 0.6],
        "circle-stroke-color": palette.paper,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: MAP_LAYER_IDS.placePill,
      type: "symbol",
      source: MAP_SOURCE_IDS.places,
      filter: equals("selected", false),
      minzoom: 11.5,
      layout: {
        "symbol-sort-key": ["get", "priority"],
        "text-field": ["get", "pill"],
        "text-font": ["Open Sans Bold"],
        "text-size": 12.5,
        "text-anchor": "center",
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-padding": 2,
        "icon-image": [
          "match",
          ["get", "tone"],
          "live",
          PLACE_IMAGE_IDS.live,
          "soon",
          PLACE_IMAGE_IDS.soon,
          "quiet",
          PLACE_IMAGE_IDS.quiet,
          PLACE_IMAGE_IDS.quiet,
        ],
        "icon-text-fit": "both",
        "icon-text-fit-padding": [3, 7, 3, 7],
        "icon-padding": 3,
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
      },
      paint: {
        "text-color": ["match", ["get", "tone"], "quiet", palette.slate, palette.ink],
        "text-opacity": ["match", ["get", "tone"], "quiet", 0.72, 1],
        "icon-opacity": ["match", ["get", "tone"], "quiet", 0.7, 1],
      },
    },
    {
      id: MAP_LAYER_IDS.placeSelected,
      type: "symbol",
      source: MAP_SOURCE_IDS.places,
      filter: equals("selected", true),
      minzoom: 0,
      layout: {
        "symbol-sort-key": ["get", "priority"],
        "text-field": ["get", "pill"],
        "text-font": ["Open Sans Bold"],
        "text-size": 12.5,
        "text-anchor": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-padding": 2,
        "icon-image": PLACE_IMAGE_IDS.selected,
        "icon-text-fit": "both",
        "icon-text-fit-padding": [3, 7, 3, 7],
        "icon-padding": 3,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "text-color": palette.paper,
        "icon-opacity": 1,
      },
    },
  ];
}

/** Every non-basemap layer, in draw order. */
export function overlayLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    ...infoLayerSpecs(palette),
    ...placeLayers(palette),
    ...sketchLayers(palette),
    ...sketchDraftLayers(palette),
    ...avoidAreaLayers(palette),
    ...avoidPreviewLayers(palette),
    ...roadSpanLayers(palette),
    ...roadSpanPreviewLayers(palette),
    ...routeLayers(palette),
    ...changedSpanLayers(palette),
    ...pointLayers(palette),
    ...riderPositionLayers(palette),
    ...scrubMarkerLayers(palette),
  ];
}

/**
 * The rider's current position (05 §3, 08 §2, §4, §9; 12 §9).
 *
 * Signal Blue is the location colour and is used for nothing else on the map, so
 * "where am I" is never confused with "the chosen route" (Ember). The mark is
 * drawn **last**, above every route and point layer: the rider's own position must
 * never be hidden under the line they are following.
 *
 * Freshness is drawn, not just labelled: a good fix is a filled Signal Blue disc
 * with a Paper ring, a weak fix is the same mark at reduced opacity (readable, but
 * not asserted), and a stale fix is drawn hollow with a muted outline — the shape
 * says "last known" without relying on colour alone (12 §16).
 *
 * It is deliberately absent from `HIT_LAYER_IDS`: a tap on your own position is a
 * tap on the map, and nothing here is selectable at speed.
 */
export function riderPositionLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.riderPositionHalo,
      type: "circle",
      source: MAP_SOURCE_IDS.riderPosition,
      paint: {
        "circle-radius": ["case", ["has", "heading"], 26 * emphasisOf(palette), 18 * emphasisOf(palette)],
        "circle-color": palette.signalBlue,
        "circle-opacity": ["match", ["get", "confidence"], "good", 0.18, 0.08],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: MAP_LAYER_IDS.riderPosition,
      type: "circle",
      source: MAP_SOURCE_IDS.riderPosition,
      // With a heading the arrow below is the mark; the dot is for "where, not which way".
      filter: ["!", ["has", "heading"]],
      paint: {
        "circle-radius": 7,
        "circle-color": ["match", ["get", "confidence"], "stale", "rgba(0,0,0,0)", palette.signalBlue],
        "circle-opacity": ["match", ["get", "confidence"], "good", 1, 0.75],
        "circle-stroke-color": ["match", ["get", "confidence"], "stale", palette.signalBlue, palette.paper],
        "circle-stroke-width": 3,
        "circle-stroke-opacity": ["match", ["get", "confidence"], "stale", 0.6, 1],
      },
    },
    {
      // The Google-Maps-style heading arrow: rotated to the direction of
      // travel and laid on the tilted ground, so heading-up it points up the road.
      id: MAP_LAYER_IDS.riderHeading,
      type: "symbol",
      source: MAP_SOURCE_IDS.riderPosition,
      filter: ["has", "heading"],
      layout: {
        "icon-image": PUCK_IMAGE_ID,
        // About 46 px on screen: GM-sized, readable in a glance on a mount.
        "icon-size": 1.3 * emphasisOf(palette),
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": ["match", ["get", "confidence"], "good", 1, 0.75],
      },
    },
  ];
}

/**
 * Hit-test priority: the small, on-top targets first, the long lines last, so a
 * point drawn over a route is what the rider selected. Only route-over-route
 * produces the 05 §6 chooser — a point over a route is one meaningful object.
 */
export const HIT_LAYER_IDS: readonly string[] = [
  MAP_LAYER_IDS.pointSelected,
  MAP_LAYER_IDS.pointStart,
  MAP_LAYER_IDS.pointFinish,
  MAP_LAYER_IDS.pointStop,
  MAP_LAYER_IDS.pointShaping,
  MAP_LAYER_IDS.roadSpanSelected,
  MAP_LAYER_IDS.roadSpanMust,
  MAP_LAYER_IDS.roadSpanAvoid,
  MAP_LAYER_IDS.avoidFill,
  MAP_LAYER_IDS.routeLabel,
  MAP_LAYER_IDS.routeCasing,
  MAP_LAYER_IDS.routeSelected,
  MAP_LAYER_IDS.routeAlternative,
  MAP_LAYER_IDS.routeAlternativeCasing,
  MAP_LAYER_IDS.routePreview,
  MAP_LAYER_IDS.routeProposed,
  MAP_LAYER_IDS.routePrevious,
];

/**
 * The elevation-profile scrub marker (UX rework phase 3): a paper disc with an
 * ink ring on the route, drawn last and outside hit-testing — it answers "where
 * is this point of the profile", and a tap on it is a tap on the map.
 */
export function scrubMarkerLayers(palette: MapPalette): readonly MapLayerSpec[] {
  return [
    {
      id: MAP_LAYER_IDS.scrubMarker,
      type: "circle",
      source: MAP_SOURCE_IDS.scrubMarker,
      paint: {
        "circle-radius": 7,
        "circle-color": palette.paper,
        "circle-stroke-color": palette.ink,
        "circle-stroke-width": 3,
      },
    },
  ];
}
