/**
 * The MapLibre host (05-MAP-INTERACTION-AND-CARTOGRAPHY §2–§9, §22–§23; VNX-012).
 *
 * MapLibre GL is the bounded basic renderer: OpenStreetMap-family vector or
 * raster tiles under OpenGravel's own GeoJSON layers, no token, no plugin
 * framework, and no claim to Mapbox Standard's premium cartography (which arrives
 * later as a separate adapter behind the same `MapHost` port).
 *
 * Five behaviours are the reason this file is written the way it is:
 *
 * 1. **One instance.** `createMapLibreHost` takes over a container that already
 *    has a host instead of stacking a second WebGL context, and `dispose()` is
 *    idempotent. React's StrictMode double-invokes effects, so "create, dispose,
 *    create" is the normal development path.
 * 2. **A scene change is a sync.** `applyScene` fingerprints the scene and re-sets
 *    only the parts that changed; the map object is never recreated for a route
 *    change, a selection, or a sheet opening (05 §2).
 * 3. **A release has one meaning.** Raw pointer events go through the pure
 *    interaction machine, which decides whether the release is a tap, a committed
 *    gesture, or nothing at all. Only a tap is hit-tested, so a pan drag or a
 *    finished stroke can never also fire a background click (05 §4).
 * 4. **The camera is fitted to what is visible.** `fitBounds` pads with the
 *    workspace's measured insets (05 §9) and never with a fixed reservation, and
 *    a user pan/zoom is reported as `camera-changed` so automatic fit suspends
 *    (05 §8).
 * 5. **The worker is a vendored asset.** MapLibre builds its worker URL from a
 *    dynamic expression, so neither Turbopack nor webpack emits a loadable worker
 *    chunk; the two files are served from `public/vendor/maplibre` and registered
 *    with `setWorkerUrl`. Without it the map renders its background but every
 *    GeoJSON source stays unparsed — a silent, tile-less failure.
 * 6. **Nothing fails silently.** MapLibre reports a worker, style, source or tile
 *    failure through its own `error` event and nowhere else, and the default
 *    reading of a map that draws nothing is "an empty map". So every reported
 *    failure is classified into a bounded token and published as
 *    `data-map-error` (05 §22), in addition to the per-layer `data-layer-error`:
 *    a browser gate fails on it and a bounded notice explains it.
 * 7. **The host heals itself, within a bound.** A load that fails — a style or
 *    worker error before the first frame, a lost WebGL context, or the tile
 *    starvation that follows a `style.load` that never produces data — is
 *    rebuilt exactly once, in a fresh renderer inside a fresh container child
 *    (4.0s). A second failure is `failed`, never another attempt: a self-healing
 *    host that loops is a battery drain with a blank map on top.
 * 8. **A blank map is a state, not an absence.** `data-map-load` (with
 *    `data-map-load-reason`) says `loading` | `ready` | `retrying` | `failed`, so
 *    "no tiles and no error" is unrepresentable: either the map drew, or it is
 *    being rebuilt, or it said why it could not. The rider gets an honest,
 *    actionable surface instead of an unexplained canvas.
 *
 * Escape is deliberately **not** handled here: it is a presentation decision
 * (05 §4), so the workspace clears the armed placement and the map component
 * relays the event into this interaction machine, which drops any in-flight
 * gesture. A host that changed its own local tool would leave the UI's armed
 * placement armed — the behaviour the 4.0 review found.
 */

import { INFO_HIT_LAYERS, INFO_LAYER_IDS, TRAFFIC_FLOW_SOURCE_ID, infoFeatureCollection } from "./info-layers";
import {
  gestureControlsPointer,
  initialInteractionState,
  exceedsTapThreshold,
  reduceInteraction,
  type InteractionEffect,
  type InteractionEvent,
  type InteractionState,
  type PointerPixel,
  type PointerTool,
} from "@/application/map/interaction";
import { assetUrl } from "@/application/map/asset-path";
import type { MapLayerDrawStatus } from "@/application/map/map-host";
import type { MapExtent } from "@/application/map/build-map-scene";
import {
  isDrawableArea,
  isDrawableLine,
  isDrawableRoadSpan,
  isDrawableRoute,
  isDrawableSketch,
} from "@/application/map/drawable";
import type {
  MapErrorKind,
  MapHost,
  MapHostOptions,
  MapLoadStatus,
  MapRenderError,
} from "@/application/map/map-host";
import type { PlaceId } from "@/application/places/types";
import { clampInsetsToViewport, type MapInsets } from "@/application/map/insets";
import type { RideCamera } from "@/application/map/ride-camera";
import {
  isDraggablePointRef,
  type ChangedSpanScene,
  type MapIntent,
  type MapObjectRef,
  type MapScene,
} from "@/application/map/types";
import {
  describeBasemap,
  isPublicMapboxToken,
  mapboxRequestUrl,
  mapboxSatelliteTiles,
  OPENFREEMAP_STYLE_URL,
} from "@/infrastructure/map/basemap";
import {
  avoidAreaFeatureCollection,
  avoidPreviewFeatureCollection,
  changedSpanFeatureCollection,
  placesFeatureCollection,
  pointFeatureCollection,
  riderPositionFeatureCollection,
  scrubMarkerFeatureCollection,
  roadSpanFeatureCollection,
  roadSpanPreviewFeatureCollection,
  routeFeatureCollection,
  sketchDraftFeatureCollection,
  sketchFeatureCollection,
} from "@/infrastructure/map/maplibre/geojson";
import { createPlacePillImages, type PlacePillImage } from "@/infrastructure/map/maplibre/place-images";
import { createPuckImage } from "@/infrastructure/map/maplibre/puck-image";
import { createMarkerImages } from "@/infrastructure/map/maplibre/marker-images";
import { planSceneSync, type SceneFingerprints } from "@/infrastructure/map/maplibre/scene-diff";
import {
  HIT_LAYER_IDS,
  MAP_LAYER_IDS,
  MAP_SOURCE_IDS,
  emptyBasemapStyle,
  osmBasemapStyle,
  overlayLayers,
  readMapPalette,
  type MapStyleSpec,
} from "@/infrastructure/map/maplibre/style";
import {
  BUILDING_EXTRUSION_LAYER_ID,
  HILLSHADE_LAYER_ID,
  TERRAIN_EXAGGERATION,
  TERRAIN_SOURCE_ID,
  buildingExtrusionLayerSpec,
  buildingInsertion,
  hillshadeBeforeId,
  hillshadeLayerSpec,
  terrainSourceSpec,
  type HostedStyleLayer,
} from "@/infrastructure/map/maplibre/visual-detail";
import { prepareOfflineBasemap, type MapLibreProtocolHost } from "@/infrastructure/map/offline-basemap";
import { NIGHT_CONTRAST_BASE_STYLE_URL, toNightContrast } from "@/infrastructure/map/night-contrast-style";

/** The default location of the vendored worker module (see the header). */
export const DEFAULT_WORKER_PATH = "/vendor/maplibre/maplibre-gl-worker.mjs";

/** Routes/points never zoom in further than this on an automatic fit. */
const MAX_FIT_ZOOM = 15;

/** Camera animation, unless the rider asked for reduced motion (12 §13). */
const FIT_DURATION_MS = 450;
/** One fix a second: the follow camera glides from one to the next. */
const FOLLOW_DURATION_MS = 950;
/** Where the rider sits in the open map, from its top: low, to show the road ahead. */
const FOLLOW_RIDER_HEIGHT = 0.8;
/** How often a following camera reports its viewport to what loads for it. */
const FOLLOW_VIEWPORT_MS = 8_000;
/** A press that moves this far over a following map is the rider panning. */
const FOLLOW_PAN_PX = 8;

/** Attribute the host publishes so a browser gate can compute a click position. */
export const MAP_EXTENT_ATTRIBUTE = "data-map-extent";

/** The camera generation, bumped on every completed camera move. */
export const MAP_CAMERA_ATTRIBUTE = "data-map-camera";

/** A compact description of what is drawn, for the browser gate's assertions. */
export const MAP_SCENE_ATTRIBUTE = "data-map-scene";

/** The basemap mode actually in use. */
export const MAP_BASEMAP_ATTRIBUTE = "data-basemap";

/**
 * Set when the renderer could not start or reported a failure, as a
 * comma-separated, sorted, de-duplicated list of the machine-readable tokens of
 * `MapErrorKind` (`worker`, `style`, `source`, `tile`, `renderer`, and the
 * start-up reasons `webgl-unavailable` / `renderer-unavailable`). A bounded
 * notice reads this instead of the whole app failing (05 §22), and a browser
 * gate fails on its presence — a worker or style 404 otherwise leaves the map
 * looking merely empty.
 */
export const MAP_ERROR_ATTRIBUTE = "data-map-error";

/**
 * Set when one or more overlay layers could not be added, listing their ids: the
 * layer is unavailable and the map says so, rather than silently drawing less
 * than the scene asked for (05 §22).
 */
export const MAP_LAYER_ERROR_ATTRIBUTE = "data-layer-error";

/**
 * The load health of the current renderer attempt (4.0s), one of `loading`,
 * `ready`, `retrying` or `failed`.
 *
 * `ready` means the style loaded *and* the renderer produced data for it — tiles
 * for a tile basemap, the layer sources for a local one — so a browser gate can
 * wait for the map instead of guessing from pixels, and the workspace can tell a
 * map that is still coming from one that is not coming back. Published from the
 * first moment the host exists, which is what makes "no tiles and no error"
 * impossible to observe.
 */
export const MAP_LOAD_ATTRIBUTE = "data-map-load";

/**
 * Why the load is pending or has failed, as a `MapErrorKind` (`style`, `tile`,
 * `context-lost`, `webgl-unavailable`, …), or absent when nothing is wrong.
 *
 * A separate attribute rather than part of the value: `data-map-load` stays a
 * four-value enum a gate can compare exactly, while the reason is the diagnosable
 * token the notice and the QA script quote.
 */
export const MAP_LOAD_REASON_ATTRIBUTE = "data-map-load-reason";

/**
 * `true` once the renderer has drawn a whole frame of what is in view, tiles
 * included (its first `idle`). `ready` means data is arriving, which can be
 * seconds before the basemap shows (AQ-01, ML-03, PP-02): the surface keeps a
 * visible loading veil up until this says the rider can see a map.
 */
export const MAP_PAINTED_ATTRIBUTE = "data-map-painted";

/**
 * The class of the container child one renderer attempt owns (4.0s).
 *
 * Each attempt builds its own child, so a recovery discards the dead WebGL
 * context (and the DOM it lived in) and can never stack two canvases. A gate can
 * assert exactly one of these exists whatever happened during the load.
 */
export const MAP_ATTEMPT_CLASS = "og-map__attempt";

/**
 * How long a renderer may take to reach `style.load` before its boot is a failure
 * (4.0s).
 *
 * A backstop, not the documented bound: an aborted style fetch is normally
 * reported through MapLibre's own `error` event, and this only exists for a boot
 * that goes silent without reporting anything at all. Generous on purpose — a
 * hosted style over a slow link is a slow load, not a failure.
 */
export const BOOT_WATCHDOG_MS = 15_000;

/**
 * How long the tiles may starve after `style.load` before the load is a failure
 * (4.0s; 05 §22).
 *
 * Armed when the style loads and cleared by the *first* data the renderer
 * produces, so it counts up to the first tiles and never past them: a slow but
 * working load cannot trip it, and a `style.load` that is never followed by any
 * data cannot hide.
 */
export const TILE_STARVATION_MS = 8_000;

/**
 * Unattended recoveries one load may spend (4.0s): exactly one.
 *
 * The 4.0s bound, as a number: a failed load is rebuilt once, a second failure is
 * reported as `failed` and waits for the rider. A rider-initiated `retry()` is not
 * counted here — it spends its own single attempt.
 */
export const MAX_AUTOMATIC_RETRIES = 1;

/** Minimal structural views of the MapLibre API this adapter uses. */
interface MapLibreLayerSpec {
  readonly id: string;
}

/** The satellite raster source and layer id (M3, OGV-D-265). */
const SATELLITE_ID = "og-satellite";

interface MapLibreMap {
  getCanvas(): HTMLCanvasElement;
  getCanvasContainer(): HTMLElement;
  getBounds(): { toArray(): readonly (readonly [number, number])[] };
  getZoom?(): number;
  getPitch?(): number;
  getBearing?(): number;
  getContainer(): HTMLElement;
  project(coordinate: readonly [number, number]): { x: number; y: number };
  unproject(point: readonly [number, number]): { lng: number; lat: number };
  addSource(id: string, source: Record<string, unknown>): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addLayer(layer: unknown, beforeId?: string): void;
  addImage(id: string, image: PlacePillImage["data"], options: PlacePillImage["options"]): void;
  hasImage(id: string): boolean;
  getLayer(id: string): unknown;
  getStyle?():
    | {
        readonly glyphs?: string;
        readonly layers?: readonly HostedStyleLayer[];
      }
    | undefined;
  setLayoutProperty?(layerId: string, name: string, value: unknown): void;
  setPaintProperty?(layerId: string, name: string, value: unknown): void;
  isSourceLoaded?(sourceId: string): boolean;
  getPitch?(): number;
  setTerrain?(terrain: { readonly source: string; readonly exaggeration?: number } | null): void;
  easeTo?(options: Readonly<Record<string, unknown>>): void;
  moveLayer(id: string, beforeId?: string): void;
  setStyle?(style: unknown, options?: Record<string, unknown>): void;
  removeLayer(id: string): void;
  removeSource(id: string): void;
  queryRenderedFeatures(
    point:
      | readonly [number, number]
      | { x: number; y: number }
      | readonly [readonly [number, number], readonly [number, number]],
    options?: { layers?: readonly string[] },
  ): readonly { readonly layer: { readonly id: string }; readonly properties?: Record<string, unknown> | null }[];
  fitBounds(
    bounds: readonly [readonly [number, number], readonly [number, number]],
    options?: Record<string, unknown>,
  ): void;
  on(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
  remove(): void;
  isStyleLoaded?(): boolean;
  loaded?(): boolean;
  dragPan?: { enable(): void; disable(): void };
  boxZoom?: { enable(): void; disable(): void };
  doubleClickZoom?: { enable(): void; disable(): void };
}

/** How far from a pin a press still picks it up, in CSS pixels. */
const GRAB_RADIUS_PX = 18;
/** How far from the selected route line a press still picks it up. */
const ROUTE_GRAB_RADIUS_PX = 9;
/** How long a finger rests on the route line before it picks the line up. */
const ROUTE_HOLD_MS = 420;
const GRAB_POINT_LAYER_IDS: readonly string[] = [
  MAP_LAYER_IDS.pointStart,
  MAP_LAYER_IDS.pointFinish,
  MAP_LAYER_IDS.pointStop,
  MAP_LAYER_IDS.pointShaping,
];

/**
 * The ride's line layers: drawn under the basemap's labels, so a town name or a
 * road number is never cut by the route (the owner's 2026-10-04 iPad review
 * showed "Buck ingham" and "War inster" split by the line).
 */
const ROUTE_LINE_LAYER_IDS: ReadonlySet<string> = new Set([
  MAP_LAYER_IDS.routePrevious,
  MAP_LAYER_IDS.routeAlternativeCasing,
  MAP_LAYER_IDS.routeAlternative,
  MAP_LAYER_IDS.routePreview,
  MAP_LAYER_IDS.routeProposed,
  MAP_LAYER_IDS.routeCasing,
  MAP_LAYER_IDS.routeSelected,
]);

/** The basemap's first label layer (never one of ours), or `undefined`. */
function firstBasemapLabelId(map: MapLibreMap): string | undefined {
  return map.getStyle?.()?.layers?.find((layer) => layer.type === "symbol" && !layer.id.startsWith("ogv-"))?.id;
}

/**
 * Where a late basemap-detail layer (satellite, traffic, radar, hillshade,
 * buildings) goes: before `beforeId`, or before our own first layer when that
 * comes earlier, so detail added after the ride is drawn never covers it.
 */
function belowOverlay(map: MapLibreMap, beforeId: string | undefined): string | undefined {
  const layers = map.getStyle?.()?.layers ?? [];
  const ours = layers.findIndex((layer) => layer.id.startsWith("ogv-") && layer.id !== MAP_LAYER_IDS.background && layer.id !== MAP_LAYER_IDS.basemapRaster);
  if (ours < 0) return beforeId;
  const wanted = beforeId === undefined ? -1 : layers.findIndex((layer) => layer.id === beforeId);
  return wanted >= 0 && wanted < ours ? beforeId : layers[ours]?.id;
}

interface MapLibreModule extends MapLibreProtocolHost {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  setWorkerUrl(url: string): void;
}

/** True when the browser says there is no network at all. */
function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * The message patterns MapLibre uses when it does not name a source, in the order
 * they are tested. First match wins, and the list is deliberately short: it is a
 * classifier for a notice, not a parser.
 */
const MESSAGE_ERROR_KINDS: readonly (readonly [RegExp, MapErrorKind])[] = [
  [/worker/i, "worker"],
  [/style/i, "style"],
  [/tile/i, "tile"],
  [/source|geojson/i, "source"],
];

/** The `Error` message a payload carries, or `""` when it carries none. */
function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * What kind of failure a MapLibre `error` payload is (05 §22).
 *
 * MapLibre reports asynchronous failures (a style that never fetched, a tile or
 * source that failed, a worker that could not load) through one `"error"` event,
 * and it is easy to treat the whole event as noise — which is exactly how a
 * 404'd worker stays invisible. This classifies the payload into a bounded,
 * machine-readable kind so the surface can say *what* failed without parsing a
 * message, and so a browser gate can fail on it.
 *
 * The payload order is deliberate: MapLibre names `sourceId` (and `tile` for a
 * tile failure) when it knows them, which is stronger evidence than the message;
 * the message is the fallback, read case-insensitively. Anything else is
 * `renderer` — still surfaced, never swallowed. A payload that carries no error
 * at all is `null`: there is nothing to report.
 */
export function classifyMapError(payload: unknown): MapRenderError | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as {
    readonly error?: unknown;
    readonly sourceId?: unknown;
    readonly tile?: unknown;
  };
  if (record.error === undefined) return null;
  const named = typeof record.sourceId === "string" ? record.sourceId : null;
  if (named !== null) {
    return { kind: record.tile === undefined ? "source" : "tile", detail: named };
  }
  const message = errorMessageOf(record.error);
  const detail = message.length > 0 ? message : null;
  const matched = MESSAGE_ERROR_KINDS.find(([pattern]) => pattern.test(message));
  return { kind: matched?.[1] ?? "renderer", detail };
}

/** Containers the host module has already claimed (05 §2, §26). */
const claimedContainers = new WeakMap<HTMLElement, { dispose(): void }>();

/** Which pointer tools need the map's own drag gestures switched off. */
function needsNativeGestures(tool: PointerTool): boolean {
  return tool === "pan";
}

/** The GeoJSON a source should carry, given the scene. */
function sourceData(sourceId: string, scene: MapScene): unknown {
  switch (sourceId) {
    case MAP_SOURCE_IDS.routes:
      return routeFeatureCollection(scene);
    case MAP_SOURCE_IDS.points:
      return pointFeatureCollection(scene);
    case MAP_SOURCE_IDS.avoidAreas:
      return avoidAreaFeatureCollection(scene);
    case MAP_SOURCE_IDS.avoidPreview:
      return avoidPreviewFeatureCollection(scene);
    case MAP_SOURCE_IDS.roadSpans:
      return roadSpanFeatureCollection(scene);
    case MAP_SOURCE_IDS.roadSpanPreview:
      return roadSpanPreviewFeatureCollection(scene);
    case MAP_SOURCE_IDS.sketch:
      return sketchFeatureCollection(scene);
    case MAP_SOURCE_IDS.sketchDraft:
      return sketchDraftFeatureCollection(scene);
    case MAP_SOURCE_IDS.changedSpan:
      return changedSpanFeatureCollection(scene);
    case MAP_SOURCE_IDS.riderPosition:
      return riderPositionFeatureCollection(scene);
    case MAP_SOURCE_IDS.scrubMarker:
      return scrubMarkerFeatureCollection(scene);
    case MAP_SOURCE_IDS.places:
      return placesFeatureCollection(scene);
    case MAP_SOURCE_IDS.infoLayers:
      return infoFeatureCollection(scene);
    default:
      return { type: "FeatureCollection", features: [] };
  }
}

const PLACE_SYMBOL_LAYERS = [MAP_LAYER_IDS.placePill, MAP_LAYER_IDS.placeSelected] as const;
const PLACE_HIT_LAYERS = [
  MAP_LAYER_IDS.placeSelected,
  MAP_LAYER_IDS.placePill,
  MAP_LAYER_IDS.placeDot,
] as const;

function isPlaceSymbolLayer(id: string): boolean {
  return id === MAP_LAYER_IDS.placePill || id === MAP_LAYER_IDS.placeSelected;
}

/** Selects a bold face declared by the active style, with a common glyph fallback. */
function placeFontStack(map: MapLibreMap): readonly string[] | null {
  const style = map.getStyle?.();
  if (typeof style?.glyphs !== "string" || style.glyphs.trim().length === 0) return null;
  const stacks = (style.layers ?? [])
    .filter((layer) => layer.type === "symbol")
    .map((layer) => layer.layout?.["text-font"])
    .filter((fonts): fonts is readonly string[] =>
      Array.isArray(fonts) && fonts.length > 0 && fonts.every((font) => typeof font === "string"),
    );
  const declaredBold = stacks.find((stack) =>
    stack.some((font) => /bold|semibold|semi-bold|medium/i.test(font)),
  );
  if (declaredBold !== undefined) return declaredBold;
  const derivedBold = stacks
    .map((stack) => stack.map((font) => font.replace(/\bRegular\b/i, "Bold")))
    .find((stack, index) => stack.some((font, fontIndex) => font !== stacks[index]?.[fontIndex]));
  return derivedBold ?? stacks[0] ?? ["Open Sans Bold"];
}

/**
 * Turns hit-test results into one intent (05 §5–§6).
 *
 * The candidate list is de-duplicated by *meaningful object*: several layers can
 * describe one route (its casing and its core), and reporting the same route
 * twice would look like an overlap the rider does not actually have. Only
 * multiple *routes* are an overlap — a point over a route is one object, and the
 * point wins because it is the smaller, on-top target.
 */
export function resolveIntent(
  hits: readonly {
    readonly layer: { readonly id: string };
    readonly properties?: Record<string, unknown> | null;
  }[],
  coordinate: { readonly lon: number; readonly lat: number },
): MapIntent {
  const points: MapObjectRef[] = [];
  const others: MapObjectRef[] = [];
  const routes: MapObjectRef[] = [];
  const seen = new Set<string>();
  let routeOverlap = false;

  for (const hit of hits) {
    const properties = hit.properties ?? {};
    const id = typeof properties["id"] === "string" ? properties["id"] : null;
    if (id === null) continue;
    const layerId = hit.layer.id;
    if (
      layerId === MAP_LAYER_IDS.placeDot ||
      layerId === MAP_LAYER_IDS.placePill ||
      layerId === MAP_LAYER_IDS.placeSelected
    ) continue;
    const ref: MapObjectRef | null =
      layerId === MAP_LAYER_IDS.pointStart || layerId === MAP_LAYER_IDS.pointShaping
        ? { kind: "point", pointId: id as never }
        : layerId === MAP_LAYER_IDS.pointStop
          ? { kind: "stop", stopId: id as never }
          : layerId === MAP_LAYER_IDS.pointFinish
            // 05 §5: the destination is a `point` object, exactly like the
            // start and the shaping anchors — the feature's `selected`
            // property is written from the same ref, so resolving it as a stop
            // made a finish selection that could never match its own feature.
            ? { kind: "point", pointId: id as never }
            : layerId === MAP_LAYER_IDS.pointSelected
              ? null
              : layerId === MAP_LAYER_IDS.avoidFill
                ? { kind: "avoid-area", avoidAreaId: id as never }
                : layerId === MAP_LAYER_IDS.roadSpanMust ||
                    layerId === MAP_LAYER_IDS.roadSpanAvoid ||
                    layerId === MAP_LAYER_IDS.roadSpanSelected
                  ? { kind: "road-span", roadSpanId: id as never }
                  : { kind: "route", routeId: id as never };
    if (ref === null) continue;
    const key = Object.values(ref).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.kind === "route") {
      if (routes.length >= 1) routeOverlap = true;
      routes.push(ref);
    } else if (ref.kind === "point" || ref.kind === "stop") {
      points.push(ref);
    } else {
      others.push(ref);
    }
  }

  const first = points[0] ?? others[0] ?? routes[0];
  if (first === undefined) return { type: "map-click", coordinate };
  if (routeOverlap && points.length === 0 && others.length === 0) {
    return { type: "overlap-click", candidates: routes, coordinate };
  }
  return { type: "object-click", ref: first, coordinate };
}

/** An empty collection: what an expired emphasis leaves in its source (05 §12). */
const EMPTY_FEATURES = { type: "FeatureCollection", features: [] } as const;

/**
 * The bookkeeping one renderer attempt owns.
 *
 * An *attempt* is one constructed MapLibre map in its own container child. The
 * facade below outlives it: the interaction machine, the newest scene, the camera
 * request and the published attributes all belong to the surface, which is what
 * lets a recovery replace a dead WebGL context without replacing the map the
 * rider and the browser gate are looking at.
 */
interface HostAttempt {
  readonly map: MapLibreMap;
  /** The fresh container child this attempt owns; removed with the attempt. */
  readonly mount: HTMLElement;
  /**
   * True once the style exists and our own sources and layers are in — from then
   * on a scene syncs directly instead of being held (see `applyScene`).
   */
  styleReady: boolean;
  /** True when the latest camera transition has emitted `moveend`. */
  viewportSettled: boolean;
  /** Per-attempt: a replacement renderer starts with no sources or layers. */
  fingerprints: SceneFingerprints | null;
  /** Whether this attempt opened on the camera the previous one was showing. */
  readonly openedWhereItWas: boolean;
  /** The bounded boot/starvation watchdog for this attempt, or `null`. */
  watchdog: ReturnType<typeof setTimeout> | null;
}

/**
 * Why a renderer that could not be constructed is a device problem or a load one.
 *
 * A missing WebGL2 context is a capability, and every retry would fail the same
 * way; anything else the constructor throws is treated as transient (driver
 * pressure, a lost GPU process), because that is recoverable with a fresh
 * context — which is exactly what the bounded retry does.
 */
function startupFailureReason(error: unknown): MapErrorKind {
  return error instanceof Error && /webgl2/i.test(error.message)
    ? "webgl-unavailable"
    : "renderer-unavailable";
}

/**
 * Creates the one MapLibre map for `container`, and keeps it drawing (4.0s).
 *
 * The `maplibre-gl` module is imported dynamically: it is a large, browser-only
 * dependency, and the planner's first paint must not wait for it.
 *
 * Two things here are about *staying* up rather than starting up:
 *
 * - **Health is published, not inferred.** The load is tracked as
 *   `data-map-load`, and the map is `ready` only when the style exists *and* the
 *   renderer has produced data for it. A map that draws nothing therefore has a
 *   state that says so — the silent blank the 4.0s evidence caught had a map
 *   element, a basemap attribute and no traffic at all.
 * - **Recovery is bounded and honest.** A failed load is rebuilt exactly once,
 *   into a fresh renderer and a fresh container child, and a second failure is
 *   reported as `failed` instead of being retried in a loop. The rider gets one
 *   more attempt on demand (`retry()`), which always spends exactly one.
 */
export async function createMapLibreHost(
  container: HTMLElement,
  options: MapHostOptions,
): Promise<MapHost> {
  const claimed = claimedContainers.get(container);
  if (claimed !== undefined) claimed.dispose();

  const listeners = new Set<(intent: MapIntent) => void>();
  /** Subscribers to the settled camera extent (OGV-D-274). */
  const viewportListeners = new Set<(extent: MapExtent) => void>();
  /** Subscribers to renderer failures (the UI notice, and a test). */
  const errorListeners = new Set<(error: MapRenderError) => void>();
  /** Subscribers to load health (the workspace's honest failure surface). */
  const statusListeners = new Set<(status: MapLoadStatus) => void>();
  /**
   * Every failure kind reported for the attempt in flight.
   *
   * Kinds accumulate while an attempt is up (a style that failed and a source
   * that failed are two different facts, and a listener is told about each kind
   * once, because a renderer that retries a failing tile must not re-render the
   * notice on every frame). They are cleared when the map reaches `ready`: the
   * attribute describes the map as it *is*, so a map that recovered does not keep
   * claiming to be broken.
   */
  const errorKinds = new Set<MapErrorKind>();
  let interaction: InteractionState = initialInteractionState("pan", 0);
  /**
   * The newest scene, kept outside the attempts.
   *
   * A renderer that resolves later — and, more importantly, the replacement built
   * after a failure — is handed this, so a recovery comes back to the ride the
   * rider had instead of an empty map.
   */
  let latestScene: MapScene | null = null;
  /** The newest camera request, replayed on a replacement (05 §8–§9). */
  let latestFit: { readonly extent: MapExtent; readonly insets: MapInsets } | null = null;
  /** The newest heading-up ride camera; set, it wins over `latestFit` (DV-10). */
  let latestFollow: { readonly camera: RideCamera; readonly insets: MapInsets } | null = null;
  /** The follow camera tilted and turned the map; the next overview lays it flat. */
  let followTilted = false;
  /** The camera the previous attempt was showing, so a recovery does not jump. */
  let restoredCamera: readonly [readonly [number, number], readonly [number, number]] | null =
    null;
  let attributionOffset = 0;
  let disposed = false;
  let cameraGeneration = 0;
  /**
   * The changed-span emphasis's own deadline (05 §12), or `null`.
   *
   * Host-scoped rather than per-attempt: the emphasis belongs to the scene, and a
   * replaced renderer is handed the newest scene (with a fresh fingerprint table),
   * so the interval is the surface's fact and not the renderer's.
   */
  let changedSpanExpiry: ReturnType<typeof setTimeout> | null = null;
  /** Bumped on every re-arm, so a superseded deadline cannot retract a newer one. */
  let changedSpanToken = 0;
  /**
   * True while the current gesture holds a tool the renderer scoped itself:
   * a press on a point with the neutral tool becomes a one-gesture `point-drag`
   * (see `onPointerDown`). It is always cleared on release or cancellation.
   */
  let gestureScoped = false;
  /** A touch press on the selected route, waiting to become a route drag. */
  let routeHold: {
    readonly pointerId: number;
    readonly origin: { readonly x: number; readonly y: number };
    readonly timer: ReturnType<typeof setTimeout>;
  } | null = null;
  function clearRouteHold(): void {
    if (routeHold === null) return;
    clearTimeout(routeHold.timer);
    routeHold = null;
  }
  /** The published load health; `loading` until an attempt says otherwise. */
  let status: MapLoadStatus = { state: "loading", reason: null };
  /** Unattended recoveries spent by this host: one, ever (4.0s). */
  let automaticRetries = 0;
  /** The renderer attempt currently mounted, or `null` while booting or failed. */
  let attempt: HostAttempt | null = null;
  /** The imported renderer module; `null` until — or unless — it arrives. */
  let renderer: MapLibreModule | null = null;
  /** True while the renderer module is being fetched. */
  let booting = false;

  const palette = readMapPalette(container);
  const placePillImages = createPlacePillImages(palette);
  const puckImage = createPuckImage(palette);
  const markerImages = createMarkerImages();
  const spec = describeBasemap(options.basemap);
  /**
   * The style the renderer loads.
   *
   * `openfreemap` hands MapLibre the hosted Liberty style *URL*, so the basemap is
   * real cartography with its own attribution on the sources. `osm` builds a small
   * raster style locally. `empty` is our own background plus our layers, which is
   * what makes a test deterministic — and, being the explicit fallback, what a
   * deployment that asks for nothing never silently gets.
   */
  // Mapbox needs its public token; without one the mode falls back to the
  // token-free style rather than a canvas that never loads (OGV-D-265).
  const mapboxToken =
    options.basemap === "mapbox" && isPublicMapboxToken(options.mapboxToken)
      ? options.mapboxToken.trim()
      : null;
  let satelliteVisible = false;
  let terrainOn = false;
  let terrainPitchBefore: number | null = null;
  const terrainApplied = new WeakMap<MapLibreMap, boolean>();
  const layerStatusListeners = new Set<(status: MapLayerDrawStatus) => void>();
  const layerStates = new Map<MapLayerDrawStatus["layerId"], MapLayerDrawStatus["state"]>();
  let terrainFailed = false;
  let terrainHasContent = false;
  let terrainRequested = false;
  let terrainTimer: ReturnType<typeof setTimeout> | null = null;
  function reportLayer(layerId: MapLayerDrawStatus["layerId"], state: MapLayerDrawStatus["state"]): void {
    if (layerStates.get(layerId) === state) return;
    layerStates.set(layerId, state);
    for (const listener of layerStatusListeners) listener({ layerId, state });
  }
  function reportTerrain(state: MapLayerDrawStatus["state"]): void {
    if (state === "unavailable") terrainFailed = true;
    if (terrainFailed) state = "unavailable";
    if (terrainOn) reportLayer("terrain-3d", state);
    if (latestScene?.infoLayers?.visible.includes("hillshade")) reportLayer("hillshade", state);
    if (state !== "loading" && terrainTimer !== null) { clearTimeout(terrainTimer); terrainTimer = null; }
    if (state === "loading" && terrainTimer === null) terrainTimer = setTimeout(() => {
      terrainTimer = null;
      // Slow is not failed: a DEM that finished loading is ready.
      const map = attempt?.map;
      reportTerrain(map?.getSource(TERRAIN_SOURCE_ID) !== undefined && map?.isSourceLoaded?.(TERRAIN_SOURCE_ID) === true ? "ready" : "unavailable");
    }, 15_000);
  }
  let style: string | MapStyleSpec =
    options.basemap === "mapbox"
      ? mapboxToken !== null && spec.styleUrl !== null
        ? spec.styleUrl
        : OPENFREEMAP_STYLE_URL
      : options.basemap === "openfreemap" && spec.styleUrl !== null
      ? spec.styleUrl
      : options.basemap === "osm" && spec.rasterTiles !== null && spec.attribution !== null
        ? osmBasemapStyle(palette, spec.rasterTiles, spec.attribution)
        : emptyBasemapStyle(palette);

  container.setAttribute(MAP_BASEMAP_ATTRIBUTE, options.basemap);
  /** The configured basemap, kept so Night contrast can switch back to it. */
  const configuredStyle = style;
  /** Night contrast is a Mapbox map: it needs the public token. */
  const nightAvailable = mapboxToken !== null;
  let basemapLook: "map" | "night" = nightAvailable && options.basemapLook === "night" ? "night" : "map";
  /** The repainted Night contrast style, fetched once per host. */
  let nightStyle: Promise<MapStyleSpec | null> | null = null;
  function loadNightStyle(): Promise<MapStyleSpec | null> {
    if (mapboxToken === null) return Promise.resolve(null);
    nightStyle ??= fetch(mapboxRequestUrl(NIGHT_CONTRAST_BASE_STYLE_URL, mapboxToken))
      .then(async (response) => (response.ok ? (toNightContrast(await response.json()) as MapStyleSpec) : null))
      .catch(() => null);
    return nightStyle;
  }
  /** True when the map draws the rider's downloaded basemap (Lane A2). */
  let drawingOfflineBasemap = false;

  // --- The published state ------------------------------------------------

  function emit(intent: MapIntent): void {
    for (const listener of [...listeners]) listener(intent);
  }

  /** Publishes the load health on the container and to the workspace (4.0s). */
  function publishStatus(next: MapLoadStatus): void {
    const changed = status.state !== next.state || status.reason !== next.reason;
    status = next;
    container.setAttribute(MAP_LOAD_ATTRIBUTE, next.state);
    if (next.reason === null) container.removeAttribute(MAP_LOAD_REASON_ATTRIBUTE);
    else container.setAttribute(MAP_LOAD_REASON_ATTRIBUTE, next.reason);
    if (!changed) return;
    for (const listener of [...statusListeners]) listener(next);
  }

  /**
   * Records one renderer failure: the attribute for the gate, the listeners for
   * the bounded notice (05 §22).
   */
  function recordError(error: MapRenderError): void {
    const repeated = errorKinds.has(error.kind);
    errorKinds.add(error.kind);
    container.setAttribute(MAP_ERROR_ATTRIBUTE, [...errorKinds].sort().join(","));
    if (repeated) return;
    for (const listener of [...errorListeners]) listener(error);
  }

  /** Empties the S1 failure channel, because the map is drawing again. */
  function clearErrors(): void {
    if (errorKinds.size === 0) return;
    errorKinds.clear();
    container.removeAttribute(MAP_ERROR_ATTRIBUTE);
  }

  // --- Geometry, for the interaction machine ------------------------------

  /** The canvas-relative pixel of a pointer event, in CSS pixels. */
  function pixelAt(
    map: MapLibreMap,
    event: { clientX: number; clientY: number },
  ): readonly [number, number] {
    const rect = map.getCanvas().getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  /**
   * The pointer's position in CSS pixels, as the interaction machine measures it.
   *
   * Client pixels, not canvas pixels: the tap/drag threshold (05 §4) is a
   * physical distance the finger travelled, so a canvas that is offset or scaled
   * on the page must not change what counts as a drag.
   */
  function pixelOf(event: { clientX: number; clientY: number }): PointerPixel {
    return { x: event.clientX, y: event.clientY };
  }

  /** `{lon, lat}` for a pointer event. */
  function coordinateAt(
    map: MapLibreMap,
    event: { clientX: number; clientY: number },
  ): { lon: number; lat: number } {
    const [x, y] = pixelAt(map, event);
    const { lng, lat } = map.unproject([x, y]);
    return { lon: lng, lat };
  }

  function publishCamera(map: MapLibreMap): void {
    const bounds = map.getBounds().toArray();
    const [southWest, northEast] = bounds;
    if (southWest === undefined || northEast === undefined) return;
    container.setAttribute(
      MAP_EXTENT_ATTRIBUTE,
      [
        southWest[0].toFixed(7),
        southWest[1].toFixed(7),
        northEast[0].toFixed(7),
        northEast[1].toFixed(7),
      ].join(","),
    );
    cameraGeneration += 1;
    container.setAttribute(MAP_CAMERA_ATTRIBUTE, String(cameraGeneration));
    // The ride camera's shape, for the browser gate and QA (DV-10).
    const zoom = map.getZoom?.();
    const pitch = map.getPitch?.();
    const bearing = map.getBearing?.();
    if (zoom !== undefined) container.setAttribute("data-map-zoom", zoom.toFixed(2));
    if (pitch !== undefined) container.setAttribute("data-map-pitch", pitch.toFixed(1));
    if (bearing !== undefined) container.setAttribute("data-map-bearing", bearing.toFixed(1));
  }

  function visibleExtent(map: MapLibreMap): MapExtent | null {
    const [southWest, northEast] = map.getBounds().toArray();
    if (southWest === undefined || northEast === undefined) return null;
    return {
      minLon: southWest[0],
      minLat: southWest[1],
      maxLon: northEast[0],
      maxLat: northEast[1],
    };
  }

  let viewportPublishedAt = Number.NEGATIVE_INFINITY;
  function publishViewport(map: MapLibreMap): void {
    // The follow camera moves once a second; what loads "for the screen"
    // (places, fuel, traffic) only needs to hear about it now and then.
    const at = Date.now();
    if (latestFollow !== null && at - viewportPublishedAt < FOLLOW_VIEWPORT_MS) return;
    const extent = visibleExtent(map);
    if (extent === null) return;
    viewportPublishedAt = at;
    for (const listener of [...viewportListeners]) listener(extent);
  }

  /**
   * A compact description of the drawn scene, for the browser gate.
   *
   * Held as a value rather than re-derived from the last scene so the emphasis's
   * own deadline can retract exactly one entry when it passes: the attribute the
   * gate reads must never claim an emphasis the renderer has stopped drawing
   * (05 §12).
   */
  let sceneReport = {
    routes: 0,
    points: 0,
    selected: "none",
    previous: 0,
    areas: 0,
    spans: 0,
    sketch: 0,
    sketchDraft: 0,
    preview: 0,
    changedSpan: 0,
    position: "none",
  };

  function writeSceneAttribute(): void {
    container.setAttribute(
      MAP_SCENE_ATTRIBUTE,
      [
        `routes:${sceneReport.routes}`,
        `points:${sceneReport.points}`,
        `selected:${sceneReport.selected}`,
        `previous:${sceneReport.previous}`,
        `areas:${sceneReport.areas}`,
        `spans:${sceneReport.spans}`,
        `sketch:${sceneReport.sketch}`,
        `sketchDraft:${sceneReport.sketchDraft}`,
        `preview:${sceneReport.preview}`,
        `changedSpan:${sceneReport.changedSpan}`,
        `position:${sceneReport.position}`,
      ].join(","),
    );
  }

  function publishScene(scene: MapScene): void {
    // The same drawable predicates the layers and the camera use, so the number
    // this attribute publishes is the number of lines actually on screen.
    const routes = scene.routes.filter(isDrawableRoute);
    const selected = routes.find((route) => route.state === "selected");
    const draft = scene.sketchDraft ?? null;
    const draftStrokes = draft === null ? 0 : draft.strokes.length + (draft.active === null ? 0 : 1);
    const span = scene.changedSpan ?? null;
    sceneReport = {
      routes: routes.length,
      points: scene.points.length,
      selected: selected?.id ?? "none",
      // 05 §11: how much of what is drawn is the *stale* answer. A browser gate can
      // assert the previous treatment without reading pixels (04 §9, §21).
      previous: routes.filter((route) => route.state === "previous").length,
      areas: scene.avoidAreas.filter(isDrawableArea).length,
      spans: scene.roadSpans.filter(isDrawableRoadSpan).length,
      sketch: isDrawableSketch(scene.sketch) ? 1 : 0,
      sketchDraft: draftStrokes,
      preview: scene.preview === null ? 0 : 1,
      changedSpan: span !== null && isDrawableLine(span.coordinates) ? 1 : 0,
      // 08 §2/§4: whether a present position is drawn, and how much of it the
      // renderer is willing to call current. A browser gate asserts the ride
      // surface's own mark without reading pixels.
      position:
        scene.riderPosition === undefined || scene.riderPosition === null
          ? "none"
          : scene.riderPosition.confidence,
    };
    writeSceneAttribute();
  }

  /** Keeps the attribution legible above the sheet (05 §23). */
  function placeAttribution(): void {
    const control = container.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
    if (control === null) return;
    control.style.bottom = `${attributionOffset}px`;
  }

  /**
   * Adds the overlay sources, tolerating one that is already present and
   * reporting one that cannot be added.
   *
   * Sources come first, always: a MapLibre layer whose source does not exist yet
   * is rejected outright, and a rejected layer is simply missing for the rest of
   * the session. That is why each addition is guarded *individually* — one bad
   * source must not take the other four with it — and why a failure is recorded
   * as a `source` error instead of being swallowed: without it the map would
   * simply draw less than the scene asked for and look merely empty (05 §22).
   */
  function addSources(map: MapLibreMap): void {
    const failed: string[] = [];
    for (const sourceId of Object.values(MAP_SOURCE_IDS)) {
      if (map.getSource(sourceId) !== undefined) continue;
      try {
        map.addSource(sourceId, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      } catch {
        failed.push(sourceId);
      }
    }
    if (failed.length === 0) return;
    recordError({ kind: "source", detail: failed.join(",") });
  }

  /**
   * Adds the overlay layers above the basemap.
   *
   * One failing layer must not take the others with it (05 §22: "custom layer
   * failure: mark only layer unavailable"), so each addition is guarded and the
   * failures are reported on the surface as machine-readable tokens instead of
   * being swallowed. The map keeps drawing whatever did load.
   */
  function addOverlayLayers(map: MapLibreMap): void {
    const failed: string[] = [];
    const fonts = placeFontStack(map);
    let placeImagesReady = false;
    if (fonts !== null) {
      placeImagesReady = true;
      for (const image of placePillImages) {
        if (map.hasImage(image.id)) continue;
        try {
          map.addImage(image.id, image.data, image.options);
        } catch {
          for (const layerId of PLACE_SYMBOL_LAYERS) {
            if (!failed.includes(layerId)) failed.push(layerId);
          }
          placeImagesReady = false;
          recordError({ kind: "renderer", detail: `image:${image.id}` });
        }
      }
    }
    // The heading arrow needs its image; without it the rider keeps the dot.
    let puckReady = map.hasImage(puckImage.id);
    if (!puckReady) {
      try {
        map.addImage(puckImage.id, puckImage.data, puckImage.options as PlacePillImage["options"]);
        puckReady = true;
      } catch {
        recordError({ kind: "renderer", detail: `image:${puckImage.id}` });
      }
    }
    // The ride's pins; without their images the plain circles still mark the points.
    let pinsReady = true;
    for (const image of markerImages) {
      if (map.hasImage(image.id)) continue;
      try {
        map.addImage(image.id, image.data, image.options as PlacePillImage["options"]);
      } catch {
        pinsReady = false;
        recordError({ kind: "renderer", detail: `image:${image.id}` });
      }
    }
    for (const layer of overlayLayers(palette)) {
      if (isPlaceSymbolLayer(layer.id) && !placeImagesReady) continue;
      if (layer.id === MAP_LAYER_IDS.pointPin && !pinsReady) continue;
      if (layer.id === MAP_LAYER_IDS.riderHeading && !puckReady) continue;
      // Info labels need the basemap's glyphs; without them the dots still draw.
      if ((layer.id === INFO_LAYER_IDS.label || layer.id === MAP_LAYER_IDS.routeLabel) && fonts === null) continue;
      if (map.getLayer(layer.id) !== undefined) continue;
      try {
        // Appending puts our cartography above every basemap layer: a hosted style
        // has its own layer stack, and the ride must never be drawn under it.
        const styledLayer = (isPlaceSymbolLayer(layer.id) || layer.id === INFO_LAYER_IDS.label || layer.id === MAP_LAYER_IDS.routeLabel) && fonts !== null
          ? { ...layer, layout: { ...layer.layout, "text-font": fonts } }
          : layer;
        // No arrow image: the dot stands in for the arrow, so it drops its filter.
        const added: Record<string, unknown> = { ...styledLayer };
        // Stop numbers are map text: with the basemap's fonts, or not at all.
        if (layer.id === MAP_LAYER_IDS.pointPin) {
          const layout = { ...(layer.layout ?? {}) } as Record<string, unknown>;
          if (fonts === null) {
            for (const key of Object.keys(layout)) if (key.startsWith("text-")) delete layout[key];
          } else layout["text-font"] = fonts;
          added["layout"] = layout;
        }
        if (layer.id === MAP_LAYER_IDS.riderPosition && !puckReady) delete added["filter"];
        if (ROUTE_LINE_LAYER_IDS.has(layer.id)) {
          map.addLayer(added as unknown as MapLibreLayerSpec, firstBasemapLabelId(map));
        } else {
          map.addLayer(added as unknown as MapLibreLayerSpec);
        }
      } catch {
        failed.push(layer.id);
      }
    }
    // On Night contrast a light casing makes an alternative read as a highway.
    if (basemapLook === "night" && map.getLayer(MAP_LAYER_IDS.routeAlternativeCasing) !== undefined) {
      try {
        map.setPaintProperty?.(MAP_LAYER_IDS.routeAlternativeCasing, "line-color", "#0a0f0d");
      } catch {
        // Cosmetic only; the alternative still draws.
      }
    }
    if (failed.length === 0) {
      container.removeAttribute(MAP_LAYER_ERROR_ATTRIBUTE);
    } else {
      container.setAttribute(MAP_LAYER_ERROR_ATTRIBUTE, failed.join(","));
    }
  }

  /**
   * Satellite imagery under the ride (M3, OGV-D-265): a raster layer inserted
   * below the basemap's first label layer, so road names stay readable over
   * it, and hidden until the rider asks. Only on a Mapbox host with a token.
   */
  function addSatellite(map: MapLibreMap): void {
    if (mapboxToken === null) return;
    try {
      if (map.getSource(SATELLITE_ID) === undefined) {
        map.addSource(SATELLITE_ID, {
          type: "raster",
          tiles: [mapboxSatelliteTiles(mapboxToken)],
          tileSize: 512,
          maxzoom: 19,
          attribution: "© Mapbox © Maxar",
        });
      }
      if (map.getLayer(SATELLITE_ID) === undefined) {
        const firstLabel = map.getStyle?.()?.layers?.find((layer) => layer.type === "symbol")?.id;
        map.addLayer(
          {
            id: SATELLITE_ID,
            type: "raster",
            source: SATELLITE_ID,
            layout: { visibility: satelliteVisible ? "visible" : "none" },
          },
          belowOverlay(map, firstLabel),
        );
      }
    } catch {
      recordError({ kind: "source", detail: SATELLITE_ID });
    }
  }

  /**
   * TomTom's live traffic-flow raster (phase 8), inserted under the basemap's
   * first label like satellite imagery, added the first time the scene asks for
   * it and hidden, not removed, when the rider switches it off.
   */
  function syncTrafficFlow(map: MapLibreMap, tiles: string | null): void {
    try {
      if (tiles === null) {
        if (map.getLayer(TRAFFIC_FLOW_SOURCE_ID) !== undefined) {
          map.setLayoutProperty?.(TRAFFIC_FLOW_SOURCE_ID, "visibility", "none");
        }
        return;
      }
      if (map.getSource(TRAFFIC_FLOW_SOURCE_ID) === undefined) {
        map.addSource(TRAFFIC_FLOW_SOURCE_ID, {
          type: "raster",
          tiles: [tiles],
          tileSize: 512,
          minzoom: 5,
          maxzoom: 18,
          attribution: "Traffic © TomTom",
        });
      }
      if (map.getLayer(TRAFFIC_FLOW_SOURCE_ID) === undefined) {
        const firstLabel = map.getStyle?.()?.layers?.find((layer) => layer.type === "symbol")?.id;
        map.addLayer(
          { id: TRAFFIC_FLOW_SOURCE_ID, type: "raster", source: TRAFFIC_FLOW_SOURCE_ID, paint: { "raster-opacity": 0.85 } },
          belowOverlay(map, firstLabel),
        );
      }
      map.setLayoutProperty?.(TRAFFIC_FLOW_SOURCE_ID, "visibility", "visible");
    } catch {
      recordError({ kind: "source", detail: TRAFFIC_FLOW_SOURCE_ID });
    }
  }

  const radarScenes = new WeakMap<MapLibreMap, string>();
  function syncLayerRasters(map: MapLibreMap, scene: MapScene): void {
    const id = "ogv-radar";
    try {
      const raster = scene.infoLayers?.rasters?.find((entry) => entry.layerId === "weather-radar");
      const signature = raster === undefined ? "off" : `${raster.url}|${JSON.stringify(raster.bounds)}`;
      if (radarScenes.get(map) === signature && (raster === undefined || map.getLayer(id) !== undefined)) return;
      if (map.getLayer(id) !== undefined) map.removeLayer(id);
      if (map.getSource(id) !== undefined) map.removeSource(id);
      if (raster === undefined) { radarScenes.set(map, signature); return; }
      const b = raster.bounds;
      map.addSource(id, { type: "image", url: raster.url, coordinates: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]] });
      const firstLabel = map.getStyle?.()?.layers?.find((layer) => layer.type === "symbol")?.id;
      map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": 0.55, "raster-fade-duration": 0 } }, belowOverlay(map, firstLabel));
      radarScenes.set(map, signature);
    } catch { recordError({ kind: "source", detail: id }); }
  }

  /**
   * Terrain detail is one bounded renderer feature: raised ground, subtle
   * hillshade and high-zoom building extrusion. It never moves the camera.
   *
   * The current DEM remains the proven fallback while the PA/NJ build benchmarks
   * Mapterhorn and our own 3DEP artifacts. Swapping that source later changes one
   * visual-detail helper, not Ride Focus or planner code.
   */
  function applyTerrain(map: MapLibreMap): void {
    // The DEM is a network source; a downloaded basemap draws flat rather than
    // reporting a terrain failure the rider cannot fix without signal.
    if (map.setTerrain === undefined || drawingOfflineBasemap) { reportTerrain("unavailable"); return; }
    try {
      const requested = terrainOn || latestScene?.infoLayers?.visible.includes("hillshade") === true;
      if (requested && !terrainRequested) terrainFailed = false;
      terrainRequested = requested;
      const newDem = requested && map.getSource(TERRAIN_SOURCE_ID) === undefined;
      if (newDem) {
        terrainHasContent = false;
        terrainFailed = false;
        map.addSource(TERRAIN_SOURCE_ID, terrainSourceSpec());
      }

      const styleLayers = map.getStyle?.()?.layers ?? [];
      if ((terrainOn || latestScene?.infoLayers?.visible.includes("hillshade")) && map.getLayer(HILLSHADE_LAYER_ID) === undefined) {
        map.addLayer(hillshadeLayerSpec(palette), belowOverlay(map, hillshadeBeforeId(styleLayers)));
      }

      if (terrainOn && map.getLayer(BUILDING_EXTRUSION_LAYER_ID) === undefined) {
        const insertion = buildingInsertion(styleLayers);
        if (insertion !== null) {
          map.addLayer(buildingExtrusionLayerSpec(insertion.source), belowOverlay(map, insertion.beforeId));
        }
      }

      // setTerrain destroys/rebuilds the mesh even for identical options.
      // A provider result, selection or status update must not restart DEM work.
      if (terrainApplied.get(map) !== terrainOn || newDem) {
        terrainApplied.set(map, terrainOn);
        map.setTerrain(terrainOn ? { source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION } : null);
      }
      if (terrainOn && terrainPitchBefore === null) {
        terrainPitchBefore = map.getPitch?.() ?? 0;
        map.easeTo?.({ pitch: Math.max(55, terrainPitchBefore), duration: options.reducedMotion === true ? 0 : 300 });
      } else if (!terrainOn && terrainPitchBefore !== null) {
        map.easeTo?.({ pitch: terrainPitchBefore, duration: options.reducedMotion === true ? 0 : 300 });
        terrainPitchBefore = null;
      }
      if (requested) reportTerrain(!newDem && terrainHasContent && map.isSourceLoaded?.(TERRAIN_SOURCE_ID) === true ? "ready" : "loading");
      else if (terrainTimer !== null) { clearTimeout(terrainTimer); terrainTimer = null; }

      const visibility = terrainOn ? "visible" : "none";
      if (map.getLayer(HILLSHADE_LAYER_ID) !== undefined) {
        map.setLayoutProperty?.(HILLSHADE_LAYER_ID, "visibility", terrainOn || latestScene?.infoLayers?.visible.includes("hillshade") ? "visible" : "none");
      }
      if (map.getLayer(BUILDING_EXTRUSION_LAYER_ID) !== undefined) {
        map.setLayoutProperty?.(BUILDING_EXTRUSION_LAYER_ID, "visibility", visibility);
      }
    } catch {
      reportTerrain("unavailable");
      recordError({ kind: "source", detail: TERRAIN_SOURCE_ID });
    }
  }

  function syncScene(current: HostAttempt, scene: MapScene): void {
    const plan = planSceneSync(current.fingerprints, scene);
    current.fingerprints = plan.fingerprints;
    // Guarded exactly like the layer table: a renderer failure here is reported
    // on the surface instead of leaving the scene half-applied and silent.
    try {
      addSources(current.map);
    } catch {
      recordError({ kind: "source", detail: "sources" });
    }
    addOverlayLayers(current.map);
    const parts: readonly [string, boolean][] = [
      [MAP_SOURCE_IDS.routes, plan.routes],
      [MAP_SOURCE_IDS.points, plan.points],
      [MAP_SOURCE_IDS.avoidAreas, plan.avoidAreas],
      [MAP_SOURCE_IDS.avoidPreview, plan.avoidPreview],
      [MAP_SOURCE_IDS.roadSpans, plan.roadSpans],
      [MAP_SOURCE_IDS.roadSpanPreview, plan.roadSpanPreview],
      [MAP_SOURCE_IDS.sketch, plan.sketch],
      [MAP_SOURCE_IDS.sketchDraft, plan.sketchDraft],
      [MAP_SOURCE_IDS.changedSpan, plan.changedSpan],
      [MAP_SOURCE_IDS.riderPosition, plan.riderPosition],
      [MAP_SOURCE_IDS.places, plan.places],
      [MAP_SOURCE_IDS.infoLayers, plan.infoLayers],
      [MAP_SOURCE_IDS.scrubMarker, plan.scrubMarker],
    ];
    for (const [sourceId, changed] of parts) {
      if (!changed) continue;
      current.map.getSource(sourceId)?.setData(sourceData(sourceId, scene));
    }
    syncTrafficFlow(current.map, scene.infoLayers?.trafficFlowTiles ?? null);
    syncLayerRasters(current.map, scene);
    applyTerrain(current.map);
    armChangedSpanExpiry(current, scene.changedSpan ?? null);
    publishScene(scene);
  }

  /**
   * Honours the changed-span deadline the scene itself carries (05 §12).
   *
   * The emphasis is bounded, and the bound belongs here as well as in the surface:
   * a surface that is late (a backgrounded tab, a busy main thread) must not be
   * able to leave a highlight on the map that claims a change the rider already
   * scrolled past. When the deadline passes the source is emptied, the attribute is
   * retracted and the attempt's fingerprints are dropped — so a scene that still
   * carries the span is drawn again rather than mistaken for `already drawn`.
   */
  function armChangedSpanExpiry(current: HostAttempt, span: ChangedSpanScene | null): void {
    if (changedSpanExpiry !== null) {
      clearTimeout(changedSpanExpiry);
      changedSpanExpiry = null;
    }
    if (span === null || span.untilIso === undefined) return;
    const deadline = Date.parse(span.untilIso);
    if (Number.isNaN(deadline)) return;
    changedSpanToken += 1;
    const token = changedSpanToken;
    changedSpanExpiry = setTimeout(() => {
      changedSpanExpiry = null;
      // A newer scene (with or without an emphasis) owns the drawing now.
      if (token !== changedSpanToken || disposed) return;
      current.fingerprints = null;
      try {
        current.map.getSource(MAP_SOURCE_IDS.changedSpan)?.setData(EMPTY_FEATURES);
      } catch {
        // The emphasis is the renderer's, not the data's: a renderer that cannot
        // take the update reports its own failure through `data-map-error`.
      }
      sceneReport = { ...sceneReport, changedSpan: 0 };
      writeSceneAttribute();
    }, Math.max(0, deadline - Date.now()));
  }

  function applyGestures(map: MapLibreMap, tool: PointerTool): void {
    const native = needsNativeGestures(tool);
    const canvas = map.getCanvas();
    canvas.style.cursor = native ? "" : "crosshair";
    if (native) {
      map.dragPan?.enable();
      map.boxZoom?.enable();
      map.doubleClickZoom?.enable();
    } else {
      map.dragPan?.disable();
      map.boxZoom?.disable();
      map.doubleClickZoom?.disable();
    }
  }

  function handleInteraction(event: InteractionEvent): readonly InteractionEffect[] {
    const before = interaction;
    const result = reduceInteraction(interaction, event);
    interaction = result.state;
    if (interaction.activeTool !== before.activeTool) {
      const current = attempt;
      if (current !== null) applyGestures(current.map, interaction.activeTool);
    }
    // A cancellation is reported, never guessed at: the workspace drops what it
    // was previewing and commits nothing (05 §4).
    if (interaction.lastCancel !== null && interaction.lastCancel !== before.lastCancel) {
      const reason = interaction.lastCancel;
      emit({ type: "gesture-cancel" });
      // A gesture-scoped tool (a press that grabbed a point, see `onPointerDown`)
      // only ever existed for the gesture that just died, so it goes back to the
      // neutral tool — except when the cancellation *was* a tool change, in which
      // case the rider's tool is the one that must survive.
      if (gestureScoped) {
        gestureScoped = false;
        if (reason !== "tool-change") {
          handleInteraction({ type: "tool-change", tool: "pan" });
        }
      }
    }
    return result.effects;
  }

  /** Every hit-test layer the renderer currently draws, in priority order. */
  function hitLayers(map: MapLibreMap): readonly string[] {
    return HIT_LAYER_IDS.filter((layerId) => map.getLayer(layerId) !== undefined);
  }

  /**
   * What a press picks up with a finger-sized box: the nearest authored pin
   * within {@link GRAB_RADIUS_PX}, else the selected route line within
   * {@link ROUTE_GRAB_RADIUS_PX}, else `null`.
   */
  function grabAt(map: MapLibreMap, pixel: { readonly x: number; readonly y: number }): MapObjectRef | null {
    const pointLayers = GRAB_POINT_LAYER_IDS.filter((layerId) => map.getLayer(layerId) !== undefined);
    if (pointLayers.length > 0) {
      const box: [[number, number], [number, number]] = [
        [pixel.x - GRAB_RADIUS_PX, pixel.y - GRAB_RADIUS_PX],
        [pixel.x + GRAB_RADIUS_PX, pixel.y + GRAB_RADIUS_PX],
      ];
      const hits = map.queryRenderedFeatures(box, { layers: pointLayers });
      if (hits.length > 0) {
        const coordinate = map.unproject([pixel.x, pixel.y]);
        const intent = resolveIntent(hits, { lon: coordinate.lng, lat: coordinate.lat });
        if (intent.type === "object-click") return intent.ref;
        if (intent.type === "overlap-click") return intent.candidates[0] ?? null;
      }
    }
    const selected = latestScene?.selectedRouteId ?? null;
    const routeLayers = [MAP_LAYER_IDS.routeSelected, MAP_LAYER_IDS.routeCasing].filter((layerId) => map.getLayer(layerId) !== undefined);
    if (selected === null || routeLayers.length === 0) return null;
    const box: [[number, number], [number, number]] = [
      [pixel.x - ROUTE_GRAB_RADIUS_PX, pixel.y - ROUTE_GRAB_RADIUS_PX],
      [pixel.x + ROUTE_GRAB_RADIUS_PX, pixel.y + ROUTE_GRAB_RADIUS_PX],
    ];
    const onLine = map
      .queryRenderedFeatures(box, { layers: routeLayers })
      .some((hit) => hit.properties?.["id"] === selected);
    return onLine ? { kind: "route", routeId: selected as never } : null;
  }

  /** The one selectable object under a coordinate, or `null` for the surface. */
  function objectAt(
    map: MapLibreMap,
    coordinate: { readonly lon: number; readonly lat: number },
  ): MapObjectRef | null {
    const pixel = map.project([coordinate.lon, coordinate.lat]);
    const intent = resolveIntent(
      map.queryRenderedFeatures([pixel.x, pixel.y], { layers: hitLayers(map) }),
      coordinate,
    );
    return intent.type === "object-click" ? intent.ref : null;
  }

  /** Places stay outside object resolution and cannot steal a drawing pointer. */
  function placeAt(
    map: MapLibreMap,
    coordinate: { readonly lon: number; readonly lat: number },
  ): PlaceId | null {
    const pixel = map.project([coordinate.lon, coordinate.lat]);
    const layers = PLACE_HIT_LAYERS.filter((layerId) => map.getLayer(layerId) !== undefined);
    const hits = map.queryRenderedFeatures([pixel.x, pixel.y], { layers });
    const id = hits.find((hit) => typeof hit.properties?.["id"] === "string")?.properties?.["id"];
    return typeof id === "string" ? (id as PlaceId) : null;
  }

  /** The map-layer feature under a tap, with a finger-sized box around it. */
  function infoFeatureAt(
    map: MapLibreMap,
    coordinate: { readonly lon: number; readonly lat: number },
  ): string | null {
    const layers = INFO_HIT_LAYERS.filter((layerId) => map.getLayer(layerId) !== undefined);
    if (layers.length === 0) return null;
    const pixel = map.project([coordinate.lon, coordinate.lat]);
    const box: [[number, number], [number, number]] = [[pixel.x - 8, pixel.y - 8], [pixel.x + 8, pixel.y + 8]];
    const hits = map.queryRenderedFeatures(box, { layers });
    const id = hits.find((hit) => typeof hit.properties?.["id"] === "string")?.properties?.["id"];
    return typeof id === "string" ? id : null;
  }

  function onMouseMove(payload: unknown): void {
    const current = attempt;
    if (current === null || !needsNativeGestures(interaction.activeTool)) return;
    const point = (payload as { readonly point?: { readonly x?: unknown; readonly y?: unknown } } | null)
      ?.point;
    if (typeof point?.x !== "number" || typeof point.y !== "number") return;
    const layers = PLACE_SYMBOL_LAYERS.filter((layerId) => current.map.getLayer(layerId) !== undefined);
    const hits = current.map.queryRenderedFeatures([point.x, point.y], { layers });
    const hasPlace = hits.some((hit) => typeof hit.properties?.["id"] === "string");
    // A pin or the selected line under the mouse says it can be dragged.
    const grabbable = !hasPlace && interaction.activeTool === "pan" && grabAt(current.map, { x: point.x, y: point.y }) !== null;
    current.map.getCanvas().style.cursor = hasPlace ? "pointer" : grabbable ? "grab" : "";
  }

  function onPointerDown(event: PointerEvent): void {
    const current = attempt;
    if (current === null || event.button !== 0) return;
    const map = current.map;
    const canvasContainer = map.getCanvasContainer();
    const coordinate = coordinateAt(map, event);
    const pixel = pixelOf(event);
    // What the press grabbed is decided here, at press time, by the renderer's
    // own hit test: a release cannot be asked which object it started on, and the
    // workspace may not query the renderer (05 §4).
    clearRouteHold();
    // Pins are grabbed with a finger-sized box, not a single pixel: a 14 px dot
    // under a gloved thumb was the difference between moving the start and
    // panning the map.
    const grabbed = interaction.activeTool === "pan" ? grabAt(map, pixel) : null;
    const ref = grabbed ?? objectAt(map, coordinate);
    const onSelectedRoute =
      interaction.activeTool === "pan" &&
      ref?.kind === "route" &&
      latestScene !== null &&
      ref.routeId === latestScene.selectedRouteId;
    // A press on an authored point with the neutral tool is a point drag, not a
    // camera pan — the rider grabbed the marker. The scope lasts exactly this one
    // gesture, so the neutral tool is what the rider still holds afterwards.
    // A mouse or pen press on the selected route line drags the line itself.
    if (interaction.activeTool === "pan" && (isDraggablePointRef(ref) || (onSelectedRoute && event.pointerType !== "touch"))) {
      gestureScoped = true;
      handleInteraction({ type: "tool-change", tool: "point-drag" });
    } else if (onSelectedRoute && event.pointerType === "touch") {
      // On touch the line is under every pan, so it is grabbed by a hold: a
      // finger that rests on it ~0.4 s picks it up, one that moves pans.
      const pointerId = event.pointerId;
      routeHold = {
        pointerId,
        origin: pixel,
        timer: setTimeout(() => {
          const held = routeHold;
          routeHold = null;
          const live = attempt;
          if (held === null || live === null || disposed) return;
          // The switch cancels the pan that was in flight, and that cancel
          // clears a gesture scope; so the scope is claimed after the switch,
          // or the map would stay on point-drag once the finger lifts.
          handleInteraction({ type: "tool-change", tool: "point-drag" });
          gestureScoped = true;
          handleInteraction({ type: "pointer-down", pointerId, coordinate, pixel: held.origin });
          try {
            live.map.getCanvasContainer().setPointerCapture?.(pointerId);
          } catch {
            // The finger may already be gone; the release still ends the gesture.
          }
          if (typeof navigator !== "undefined") navigator.vibrate?.(12);
          emit({ type: "pointer-down", pointerId, coordinate, ref });
        }, ROUTE_HOLD_MS),
      };
    }
    handleInteraction({
      type: "pointer-down",
      pointerId: event.pointerId,
      coordinate,
      pixel,
    });
    // The pointer stream belongs to a drawing tool only (05 §4): a pan is a camera
    // gesture, so a `pan` press emits nothing at all — there is no owner to
    // forward it to, and a `pointer-down` for pan would announce a stream the
    // contract never promised.
    //
    // Capture is a different question from the stream, and every owned gesture
    // asks for it: it is how the release is *received*, so a pan that wanders off
    // the canvas still ends. Without it the machine would keep ownership forever
    // and ignore the next press.
    if (interaction.ownership !== null && typeof canvasContainer.setPointerCapture === "function") {
      // Pointer capture is not universally implemented (jsdom, an old DOM shim);
      // an environment without it still streams while the pointer is over the
      // canvas.
      canvasContainer.setPointerCapture(event.pointerId);
    }
    if (gestureControlsPointer(interaction)) {
      emit({ type: "pointer-down", pointerId: event.pointerId, coordinate, ref });
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (routeHold !== null && routeHold.pointerId === event.pointerId && exceedsTapThreshold(routeHold.origin, pixelOf(event))) {
      clearRouteHold();
    }
    const current = attempt;
    if (current === null || !gestureControlsPointer(interaction)) return;
    if (interaction.ownership === null || interaction.ownership.pointerId !== event.pointerId) {
      return;
    }
    const coordinate = coordinateAt(current.map, event);
    handleInteraction({
      type: "pointer-move",
      pointerId: event.pointerId,
      coordinate,
      pixel: pixelOf(event),
    });
    emit({ type: "pointer-move", pointerId: event.pointerId, coordinate });
  }

  function onPointerUp(event: PointerEvent): void {
    if (routeHold?.pointerId === event.pointerId) clearRouteHold();
    const current = attempt;
    const ownership = interaction.ownership;
    if (current === null || ownership === null || ownership.pointerId !== event.pointerId) {
      return;
    }
    const coordinate = coordinateAt(current.map, event);
    const pixel = pixelOf(event);
    const drawing = gestureControlsPointer(interaction);
    // Captured before the machine clears the gesture: an unmoved release of a
    // *gesture-scoped* tool is still the rider's tap (see below), and the
    // threshold is measured in CSS pixels (05 §4), never by geography.
    const moved = ownership.moved || exceedsTapThreshold(ownership.originPixel, pixel);
    const wasScoped = gestureScoped;
    const effects = handleInteraction({
      type: "pointer-up",
      pointerId: event.pointerId,
      coordinate,
      pixel,
    });
    if (drawing) emit({ type: "pointer-up", pointerId: event.pointerId, coordinate });
    for (const effect of effects) {
      if (effect.type === "tap") tapAt(current.map, coordinate, !drawing);
      else if (effect.type === "commit-gesture") {
        // The machine committed a drawing gesture: this is the one and only
        // commit point of a drag, and it can never also be a tap (05 §4).
        emit({ type: "gesture-commit", tool: effect.tool, geometry: effect.geometry });
      }
    }
    if (wasScoped) {
      gestureScoped = false;
      handleInteraction({ type: "tool-change", tool: "pan" });
      // The rider's tool was `pan` all along, and a release without movement is a
      // tap for that tool — the same release the machine would have turned into a
      // tap had the press not grabbed a marker. Without this, tapping a marker to
      // select it would author nothing at all.
      // The renderer temporarily armed `point-drag`, so this release belonged to
      // a drawing owner even though the rider's neutral tool is restored above.
      if (!moved) tapAt(current.map, coordinate, false);
    }
  }

  /** One tap, resolved by hit-testing: surface, object, or the 05 §6 chooser. */
  function tapAt(
    map: MapLibreMap,
    coordinate: { lon: number; lat: number },
    allowPlace: boolean,
  ): void {
    if (allowPlace) {
      const placeId = placeAt(map, coordinate);
      if (placeId !== null) {
        emit({ type: "place-click", placeId, coordinate });
        return;
      }
      const featureId = infoFeatureAt(map, coordinate);
      if (featureId !== null) {
        emit({ type: "info-feature-click", featureId, coordinate });
        return;
      }
    }
    const pixel = map.project([coordinate.lon, coordinate.lat]);
    const hits = map.queryRenderedFeatures([pixel.x, pixel.y], {
      layers: hitLayers(map),
    });
    emit(resolveIntent(hits, coordinate));
  }

  function onPointerCancel(event: PointerEvent): void {
    clearRouteHold();
    // A cancelled pointer is not a release: it drops the gesture and emits
    // `gesture-cancel`, never a commit and never a tap (05 §4).
    handleInteraction({ type: "pointer-cancel", pointerId: event.pointerId });
  }

  function onLostCapture(event: PointerEvent): void {
    handleInteraction({ type: "lost-capture", pointerId: event.pointerId });
  }

  function onMoveStart(event: { readonly originalEvent?: unknown }): void {
    terrainFailed = false;
    if (event.originalEvent === undefined) return;
    // 05 §8: a rider pan/zoom suspends automatic fit until they ask for it back.
    riderTookCamera();
  }

  /**
   * Wheel and double-tap zooms animate the camera through `easeTo`, whose
   * `movestart` carries no `originalEvent`, so they read as a programmatic move
   * and a following ride camera snapped straight back. The DOM gesture itself
   * is unambiguous rider intent.
   */
  function onRiderZoomGesture(): void {
    riderTookCamera();
  }

  /**
   * The rider moved the map: whatever followed stops here, and what loads for
   * the screen hears about every move again (no follow-rate throttle).
   */
  function riderTookCamera(): void {
    latestFollow = null;
    emit({ type: "camera-changed" });
  }

  /**
   * While the follow camera glides, MapLibre reports a drag late (after the
   * glide it interrupted), and one more follow step can land first. The
   * pointer itself is the fast, certain signal: a press that moves is a pan.
   */
  let followPan: { readonly pointerId: number; readonly x: number; readonly y: number } | null = null;
  function onFollowPanDown(event: PointerEvent): void {
    followPan = latestFollow === null ? null : { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onFollowPanMove(event: PointerEvent): void {
    if (followPan === null || followPan.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - followPan.x, event.clientY - followPan.y) < FOLLOW_PAN_PX) return;
    followPan = null;
    if (latestFollow !== null) riderTookCamera();
  }
  function onFollowPanEnd(): void {
    followPan = null;
  }

  /** Two fingers on the map are a pinch or a rotate: rider intent, mid-glide too. */
  function onRiderPinch(event: TouchEvent): void {
    if (event.touches.length >= 2) riderTookCamera();
  }

  function onMoveEnd(): void {
    const current = attempt;
    if (current === null) return;
    current.viewportSettled = true;
    publishCamera(current.map);
    publishViewport(current.map);
  }

  // --- Load health, the watchdog, and bounded recovery --------------------

  /** Disarms one attempt's watchdog. */
  function clearWatchdog(current: HostAttempt): void {
    if (current.watchdog === null) return;
    clearTimeout(current.watchdog);
    current.watchdog = null;
  }

  /**
   * Arms the bounded watchdog for one attempt (4.0s).
   *
   * Two phases, one timer: until the style exists the bound covers a boot that
   * never happens (an aborted style fetch reports nothing of its own), and from
   * `style.load` it covers the data that never arrives. The first data the
   * renderer produces clears it and it is never re-armed, so it counts *up to the
   * first tiles* and never past them: a slow-but-working load cannot fail on it.
   *
   * A hidden page paints nothing, so its silence is not evidence. Rather than
   * declare a working map dead, the bound waits until the page is visible again.
   */
  function armWatchdog(current: HostAttempt, reason: MapErrorKind, delay: number): void {
    clearWatchdog(current);
    current.watchdog = setTimeout(() => {
      current.watchdog = null;
      if (disposed || attempt !== current) return;
      if (document.visibilityState === "hidden") {
        armWatchdog(current, reason, delay);
        return;
      }
      failAttempt(reason);
    }, delay);
  }

  /**
   * The renderer is drawing: the style loaded and it produced data.
   *
   * Reaching `ready` is the end of the *load* question, not an erasure of what is
   * still wrong with the map: a source that could not be added, or an overlay
   * layer that failed, stays on the 05 §22 channels. What the recovery does erase
   * is the failure of the renderer it replaced — see `createAttempt`.
   */
  function markReady(current: HostAttempt): void {
    if (disposed || attempt !== current || status.state === "ready") return;
    clearWatchdog(current);
    publishStatus({ state: "ready", reason: null });
  }

  /**
   * One renderer attempt has failed. Rebuild once, or say so (4.0s).
   *
   * The bound is the point: a load gets exactly one unattended rebuild, so a
   * renderer that cannot come up costs two attempts and then stops — no loop, and
   * never a blank map that nothing explains. A device that cannot produce a WebGL
   * context at all is reported straight away, because a second identical context
   * would fail in exactly the same way.
   */
  function failAttempt(reason: MapErrorKind, detail: string | null = null): void {
    if (disposed) return;
    recordError({ kind: reason, detail });
    const recoverable = reason !== "webgl-unavailable" && automaticRetries < MAX_AUTOMATIC_RETRIES;
    if (!recoverable) {
      publishStatus({ state: "failed", reason });
      return;
    }
    automaticRetries += 1;
    publishStatus({ state: "retrying", reason });
    startAttempt();
  }

  /** The camera one attempt is showing, or `null` if it cannot answer. */
  function readCameraBounds(
    current: HostAttempt,
  ): readonly [readonly [number, number], readonly [number, number]] | null {
    try {
      const [southWest, northEast] = current.map.getBounds().toArray();
      if (southWest === undefined || northEast === undefined) return null;
      return [southWest, northEast];
    } catch {
      // A renderer whose context is gone may not answer; the replacement then
      // opens on the extent the workspace asked for.
      return null;
    }
  }

  function runFit(current: HostAttempt, extent: MapExtent, fitInsets: MapInsets): void {
    if (disposed || attempt !== current) return;
    current.viewportSettled = false;
    current.map.fitBounds(
      [
        [extent.minLon, extent.minLat],
        [extent.maxLon, extent.maxLat],
      ],
      {
        padding: {
          top: fitInsets.top,
          right: fitInsets.right,
          bottom: fitInsets.bottom,
          left: fitInsets.left,
        },
        maxZoom: MAX_FIT_ZOOM,
        duration: options.reducedMotion === true ? 0 : FIT_DURATION_MS,
        // An overview after heading-up riding is flat and north-up, like a map.
        ...(followTilted ? { pitch: 0, bearing: 0 } : {}),
      },
    );
  }

  /**
   * The heading-up ride camera (DV-10). The rider is placed low in the part of
   * the map the chrome leaves open, so more of the road ahead shows. `offset`
   * rather than `padding`, because MapLibre keeps an eased padding and every
   * later fit would inherit it.
   */
  function runFollow(current: HostAttempt, camera: RideCamera, followInsets: MapInsets, animate: boolean): void {
    if (disposed || attempt !== current || current.map.easeTo === undefined) return;
    followTilted = true;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const openWidth = Math.max(1, width - followInsets.left - followInsets.right);
    const openHeight = Math.max(1, height - followInsets.top - followInsets.bottom);
    const x = followInsets.left + openWidth / 2 - width / 2;
    const y = followInsets.top + openHeight * FOLLOW_RIDER_HEIGHT - height / 2;
    current.map.easeTo({
      center: [camera.center.lon, camera.center.lat],
      zoom: camera.zoom,
      pitch: camera.pitch,
      ...(camera.bearing === null ? {} : { bearing: camera.bearing }),
      offset: [Math.round(x), Math.round(y)],
      duration: !animate || options.reducedMotion === true ? 0 : FOLLOW_DURATION_MS,
      easing: (t: number): number => t,
      essential: true,
    });
  }

  /**
   * Unmounts one attempt: its listeners, its watchdog, its canvas and its child.
   *
   * The camera is read first, because the replacement should open where the rider
   * was rather than at the baseline region. The renderer's own teardown is guarded:
   * a renderer whose context is gone must not be able to block its replacement by
   * throwing out of `remove()`.
   */
  function teardownAttempt(current: HostAttempt | null): void {
    if (current === null) return;
    clearWatchdog(current);
    const camera = readCameraBounds(current);
    if (camera !== null) restoredCamera = camera;
    const canvasContainer = current.map.getCanvasContainer();
    canvasContainer.removeEventListener("pointerdown", onPointerDown);
    canvasContainer.removeEventListener("pointermove", onPointerMove);
    canvasContainer.removeEventListener("pointerup", onPointerUp);
    canvasContainer.removeEventListener("pointercancel", onPointerCancel);
    canvasContainer.removeEventListener("lostpointercapture", onLostCapture);
    canvasContainer.removeEventListener("wheel", onRiderZoomGesture);
    canvasContainer.removeEventListener("dblclick", onRiderZoomGesture);
    canvasContainer.removeEventListener("touchstart", onRiderPinch);
    canvasContainer.removeEventListener("pointerdown", onFollowPanDown);
    canvasContainer.removeEventListener("pointermove", onFollowPanMove);
    canvasContainer.removeEventListener("pointerup", onFollowPanEnd);
    canvasContainer.removeEventListener("pointercancel", onFollowPanEnd);
    current.map.off("dragstart", onMoveStart as (payload: unknown) => void);
    current.map.off("mousemove", onMouseMove);
    current.map.off("style.load", onStyleLoad);
    current.map.off("load", onLoad);
    current.map.off("movestart", onMoveStart as (payload: unknown) => void);
    current.map.off("zoomstart", onMoveStart as (payload: unknown) => void);
    current.map.off("rotatestart", onMoveStart as (payload: unknown) => void);
    current.map.off("pitchstart", onMoveStart as (payload: unknown) => void);
    current.map.off("moveend", onMoveEnd);
    current.map.off("error", onMapError);
    current.map.off("sourcedata", onSourceData);
    current.map.off("sourcedataloading", onSourceLoading);
    current.map.off("idle", onIdle);
    current.map.off("webglcontextlost", onContextLost);
    try {
      current.map.remove();
    } catch {
      // Nothing to report and nothing to do: the renderer is being discarded, and
      // its replacement must not inherit its failure.
    }
    current.mount.remove();
    // The layers went with the renderer, so a claim about which of them failed no
    // longer describes anything on screen.
    container.removeAttribute(MAP_LAYER_ERROR_ATTRIBUTE);
  }

  /**
   * Makes the attempt draw OpenGravel's own layers, and publishes what it shows.
   *
   * Called at the first of `style.load` and `load`, and idempotent: a hosted
   * basemap's tile chain can be slow, and the rider's own route must not wait
   * behind it (the 4.0s evidence had a map element with no overlay traffic at
   * all). Every addition skips what already exists, so the second call is the
   * cheap one.
   */
  function prepare(current: HostAttempt): void {
    if (disposed || attempt !== current || current.styleReady) return;
    current.styleReady = true;
    const openedWhereItWas = current.openedWhereItWas;
    // The opening camera has been consumed by the constructor.
    restoredCamera = null;
    addSources(current.map);
    addSatellite(current.map);
    addOverlayLayers(current.map);
    if (terrainOn) applyTerrain(current.map);
    if (latestScene !== null) syncScene(current, latestScene);
    if (latestFollow !== null) {
      runFollow(current, latestFollow.camera, latestFollow.insets, false);
      current.viewportSettled = true;
    } else if (!openedWhereItWas && latestFit !== null) {
      runFit(current, latestFit.extent, latestFit.insets);
    } else {
      current.viewportSettled = true;
    }
    placeAttribution();
    publishCamera(current.map);
    if (current.viewportSettled) publishViewport(current.map);
  }

  /** A style reset drops all renderer images, sources and layers; restore the same scene. */
  function restoreStyle(current: HostAttempt): void {
    if (disposed || attempt !== current) return;
    current.fingerprints = null;
    addSources(current.map);
    addSatellite(current.map);
    addOverlayLayers(current.map);
    if (terrainOn) applyTerrain(current.map);
    if (latestScene !== null) syncScene(current, latestScene);
    placeAttribution();
    publishCamera(current.map);
  }

  /** The style exists: from here the watchdog is about data, not about fetching. */
  function onStyleLoad(): void {
    const current = attempt;
    if (disposed || current === null) return;
    if (current.styleReady) restoreStyle(current);
    else prepare(current);
    armWatchdog(current, "tile", TILE_STARVATION_MS);
  }

  /** The renderer's one-time `load`: the style and every source it asked for are in. */
  function onLoad(): void {
    const current = attempt;
    if (disposed || current === null) return;
    prepare(current);
    // A compact attribution starts expanded and only collapses on the first
    // drag; start it collapsed to its (i) button so it never covers the map.
    current.map
      .getContainer()
      .querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")
      ?.classList.remove("maplibregl-compact-show");
    // `load` is the strongest evidence there is: MapLibre fires it only once its
    // style and sources are loaded, tiles included.
    markReady(current);
    markPainted(current);
  }

  function markPainted(current: HostAttempt): void {
    if (disposed || attempt !== current) return;
    container.setAttribute(MAP_PAINTED_ATTRIBUTE, "true");
  }

  /** Renderer data arrived: a tile, a source update, or a settled map. */
  function onSourceData(payload?: unknown): void {
    const current = attempt;
    if (disposed || current === null || !current.styleReady) return;
    const event = payload as { sourceId?: string; sourceDataType?: string } | undefined;
    // DEM tile loads arrive as plain `sourcedata` (no `content` type), so any
    // terrain-source event counts once the source reports itself loaded.
    if (event?.sourceId === TERRAIN_SOURCE_ID) {
      terrainHasContent = true;
      if (current.map.isSourceLoaded?.(TERRAIN_SOURCE_ID) === true) reportTerrain("ready");
    }
    // Whether it was a basemap tile or one of our own GeoJSON sources, the
    // renderer is parsing and drawing. The starvation bound has been satisfied and
    // is never re-armed, which is what keeps a slow-but-working load from being
    // declared failed.
    clearWatchdog(current);
    markReady(current);
  }

  function onIdle(): void {
    const current = attempt;
    if (disposed || current === null || !current.styleReady) return;
    clearWatchdog(current);
    markReady(current);
    markPainted(current);
    // A settled map with a loaded DEM has drawn the relief.
    if (terrainRequested && current.map.getSource(TERRAIN_SOURCE_ID) !== undefined && current.map.isSourceLoaded?.(TERRAIN_SOURCE_ID) === true) {
      terrainHasContent = true;
      reportTerrain("ready");
    }
  }

  function onSourceLoading(payload: unknown): void {
    if ((payload as { sourceId?: string } | null)?.sourceId === TERRAIN_SOURCE_ID) reportTerrain("loading");
  }

  /**
   * The WebGL context is gone (4.0s).
   *
   * MapLibre can attempt its own restoration *into the same canvas*, but the
   * evidence behind this handler is a context that was lost and never replaced:
   * the map element stayed, the tiles stopped, and nothing said so. A lost context
   * is therefore treated as a failed renderer — the attempt is discarded and a
   * fresh context is built in a fresh child, never a revived one.
   */
  function onContextLost(): void {
    if (disposed) return;
    failAttempt("context-lost");
  }

  /** The renderer's own `error` event, classified and never swallowed. */
  function onMapError(payload: unknown): void {
    if (disposed) return;
    if ((payload as { sourceId?: string } | null)?.sourceId === TERRAIN_SOURCE_ID) reportTerrain("unavailable");
    const error = classifyMapError(payload);
    if (error === null) return;
    const current = attempt;
    // A failure *before* the map has drawn is a load failure: the load is not
    // going to finish on its own, so the bounded recovery starts here. Afterwards
    // a reported error belongs to the 05 §22 channel — a working map is not torn
    // down because one tile failed.
    if (current !== null && !current.styleReady) {
      failAttempt(error.kind, error.detail);
      return;
    }
    recordError(error);
  }

  /**
   * Builds one renderer attempt in a fresh container child.
   *
   * A lost WebGL context is never reused: each attempt owns its own child
   * element, so a dead context has no DOM left to come back into and a recovery
   * can never stack two canvases in the container the gates measure.
   */
  function createAttempt(module: MapLibreModule): void {
    // A new renderer has painted nothing yet.
    container.setAttribute(MAP_PAINTED_ATTRIBUTE, "false");
    if (disposed) return;
    const replacing = attempt !== null;
    teardownAttempt(attempt);
    attempt = null;
    // The failure channel describes the renderer that is on screen. The attempt
    // being replaced is gone, so the tokens it recorded are about a map that no
    // longer exists — a recovered map must not keep claiming to be broken, and a
    // gate asking the *live* map for errors must not hear the dead one. Why the
    // load is still retrying is published on `data-map-load-reason` meanwhile.
    if (replacing) clearErrors();

    const mount = document.createElement("div");
    mount.className = MAP_ATTEMPT_CLASS;
    container.appendChild(mount);

    const openedWhereItWas = restoredCamera !== null;
    let map: MapLibreMap;
    try {
      map = new module.Map({
        container: mount,
        style,
        bounds: restoredCamera ?? [
          [options.initialExtent.minLon, options.initialExtent.minLat],
          [options.initialExtent.maxLon, options.initialExtent.maxLat],
        ],
        // 05 §23: no attribution exists for the empty basemap, and a false
        // attribution is worse than none. The OSM raster source carries its own.
        //
        // Where an attribution does exist it is created **compact** (the touch
        // dead-band fix, 2026-09-17): the expanded pill is a full sentence of
        // links along the map's lower edge, and it swallowed every tap in a ~40 px
        // band above it. Compact keeps an (i) button that expands only on demand,
        // so the band belongs to the map again.
        attributionControl: options.basemap !== "empty" || drawingOfflineBasemap ? { compact: true } : false,
        // A rider's first pan must not fight an animation.
        fadeDuration: 0,
        // `mapbox://` URLs become HTTPS API URLs with the public token; any
        // other host's request is left alone (OGV-D-265).
        ...(mapboxToken === null
          ? {}
          : {
              transformRequest: (url: string) => ({ url: mapboxRequestUrl(url, mapboxToken) }),
              // Mapbox styles carry `projection: {name: "globe"}`, a Mapbox-only
              // spelling MapLibre's validator rejects outright; unvalidated, it
              // is ignored and the map draws in Mercator (OGV-D-265).
              validateStyle: false,
            }),
      });
    } catch (error) {
      // The child goes with the constructor that could not fill it: there is
      // nothing to keep, and nothing to reuse.
      mount.remove();
      failAttempt(startupFailureReason(error));
      return;
    }

    const current: HostAttempt = {
      map,
      mount,
      styleReady: false,
      viewportSettled: false,
      fingerprints: null,
      openedWhereItWas,
      watchdog: null,
    };
    attempt = current;
    // The boot backstop, replaced by the tighter data bound once the style lands.
    armWatchdog(current, "style", BOOT_WATCHDOG_MS);

    const canvasContainer = map.getCanvasContainer();
    canvasContainer.addEventListener("pointerdown", onPointerDown);
    canvasContainer.addEventListener("pointermove", onPointerMove);
    canvasContainer.addEventListener("pointerup", onPointerUp);
    canvasContainer.addEventListener("pointercancel", onPointerCancel);
    canvasContainer.addEventListener("lostpointercapture", onLostCapture);
    canvasContainer.addEventListener("wheel", onRiderZoomGesture, { passive: true });
    canvasContainer.addEventListener("dblclick", onRiderZoomGesture);
    canvasContainer.addEventListener("touchstart", onRiderPinch, { passive: true });
    canvasContainer.addEventListener("pointerdown", onFollowPanDown);
    canvasContainer.addEventListener("pointermove", onFollowPanMove);
    canvasContainer.addEventListener("pointerup", onFollowPanEnd);
    canvasContainer.addEventListener("pointercancel", onFollowPanEnd);

    map.on("mousemove", onMouseMove);
    map.on("style.load", onStyleLoad);
    map.on("load", onLoad);
    map.on("movestart", onMoveStart as (payload: unknown) => void);
    // Pinch, rotate and pitch report their own start with the touch that began them.
    map.on("zoomstart", onMoveStart as (payload: unknown) => void);
    map.on("rotatestart", onMoveStart as (payload: unknown) => void);
    map.on("pitchstart", onMoveStart as (payload: unknown) => void);
    // The follow camera glides almost continuously, and a drag that starts
    // mid-glide raises no new `movestart`; the drag's own start is the signal.
    map.on("dragstart", onMoveStart as (payload: unknown) => void);
    map.on("moveend", onMoveEnd);
    // The renderer's asynchronous failures (worker, style, source, tile) arrive
    // here and nowhere else. Without this listener a worker 404 leaves
    // `data-basemap` and `data-map-scene` present while nothing is drawn — the
    // silent failure the 4.0 review found.
    map.on("error", onMapError);
    // The evidence the load-health machine waits for, and the evidence that ends
    // the starvation bound.
    map.on("sourcedata", onSourceData);
    map.on("sourcedataloading", onSourceLoading);
    map.on("idle", onIdle);
    // A lost context is a failed renderer, not a working one (4.0s).
    map.on("webglcontextlost", onContextLost);
  }

  /**
   * Starts one attempt, fetching the renderer module first when it is not in yet.
   *
   * The module is imported once per host, so the ordinary path here is
   * synchronous. The fetch path exists because a chunk that never arrived is the
   * same class of load failure as a style that never arrived, and the bounded
   * recovery has to cover it: the retry is what turns "the renderer never showed
   * up" into a map rather than a dead canvas.
   */
  function startAttempt(): void {
    if (disposed || booting) return;
    if (renderer !== null) {
      createAttempt(renderer);
      return;
    }
    booting = true;
    void (async (): Promise<void> => {
      let loaded: MapLibreModule | null = null;
      try {
        loaded = (await import("maplibre-gl")) as unknown as MapLibreModule;
      } catch {
        loaded = null;
      }
      booting = false;
      if (loaded === null) {
        failAttempt("renderer-unavailable");
        return;
      }
      loaded.setWorkerUrl(assetUrl(options.assetBasePath, DEFAULT_WORKER_PATH));
      renderer = loaded;
      if (disposed) return;
      createAttempt(loaded);
    })();
  }

  const host: MapHost = {
    applyScene(scene: MapScene): void {
      if (disposed) return;
      // Kept outside the attempt: a renderer that has not resolved yet, and the
      // replacement built after a failure, both draw this scene rather than an
      // empty one.
      latestScene = scene;
      const current = attempt;
      if (current === null || !current.styleReady) {
        // The style is still loading: hold the newest scene and apply it once the
        // renderer is ready, rather than dropping it.
        return;
      }
      syncScene(current, scene);
    },

    fitBounds(extent: MapExtent, nextInsets: MapInsets): void {
      if (disposed) return;
      const clamped = clampInsetsToViewport(nextInsets, {
        width: container.clientWidth,
        height: container.clientHeight,
      });
      attributionOffset = clamped.bottom;
      placeAttribution();
      // Kept, not just scheduled: a recovered renderer is handed the same request,
      // so the map comes back to what the workspace asked to frame.
      latestFit = { extent, insets: clamped };
      latestFollow = null;
      const current = attempt;
      if (current === null || !current.styleReady) return;
      runFit(current, extent, clamped);
    },

    followCamera(camera: RideCamera, nextInsets: MapInsets): void {
      if (disposed) return;
      const clamped = clampInsetsToViewport(nextInsets, {
        width: container.clientWidth,
        height: container.clientHeight,
      });
      latestFollow = { camera, insets: clamped };
      const current = attempt;
      if (current === null || !current.styleReady) return;
      runFollow(current, camera, clamped, true);
    },

    dispatch(event: InteractionEvent): void {
      if (disposed) return;
      handleInteraction(event);
    },

    onIntent(listener: (intent: MapIntent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onLayerStatus(listener: (status: MapLayerDrawStatus) => void): () => void {
      layerStatusListeners.add(listener);
      for (const [layerId, state] of layerStates) listener({ layerId, state });
      return () => layerStatusListeners.delete(listener);
    },

    onError(listener: (error: MapRenderError) => void): () => void {
      errorListeners.add(listener);
      // The failure may already have happened — a renderer that could not start,
      // or a load that starved before this subscriber existed. The notice must
      // not wait for an event that will never come again.
      for (const kind of [...errorKinds].sort()) listener({ kind, detail: null });
      return () => errorListeners.delete(listener);
    },

    onStatus(listener: (next: MapLoadStatus) => void): () => void {
      statusListeners.add(listener);
      // Same rule as `onError`: a subscriber that attaches after the map settled
      // is told the state that holds, not left guessing at `loading`.
      listener(status);
      return () => statusListeners.delete(listener);
    },

    onViewport(listener: (extent: MapExtent) => void): () => void {
      viewportListeners.add(listener);
      const current = attempt;
      if (current?.viewportSettled === true) {
        const extent = visibleExtent(current.map);
        if (extent !== null) listener(extent);
      }
      return () => viewportListeners.delete(listener);
    },

    supportsSatellite: mapboxToken !== null,

    supportsNightContrast: nightAvailable,

    setBasemapLook(look: "map" | "night"): void {
      if (!nightAvailable || drawingOfflineBasemap || look === basemapLook) return;
      basemapLook = look;
      container.setAttribute("data-basemap-look", look);
      void (async () => {
        const next = look === "night" ? await loadNightStyle() : configuredStyle;
        // A later choice wins; a failed fetch keeps the map the rider has.
        if (disposed || basemapLook !== look || next === null) return;
        style = next;
        const map = attempt?.map;
        // `style.load` follows, and restoreStyle redraws the ride on the new map.
        map?.setStyle?.(next, { diff: false });
      })();
    },

    setSatellite(visible: boolean): void {
      satelliteVisible = visible;
      const map = attempt?.map;
      if (map === undefined || map.getLayer(SATELLITE_ID) === undefined) return;
      try {
        map.setLayoutProperty?.(SATELLITE_ID, "visibility", visible ? "visible" : "none");
      } catch {
        recordError({ kind: "source", detail: SATELLITE_ID });
      }
    },

    setTerrain3d(on: boolean): void {
      if (terrainOn === on) return;
      terrainOn = on;
      const current = attempt;
      if (current === null || !current.styleReady) return;
      applyTerrain(current.map);
    },

    retry(): void {
      if (disposed) return;
      // One attempt in flight at a time: a second press during a recovery would
      // stack renderers rather than help the first one.
      if (status.state === "retrying") return;
      // A rider-initiated retry *is* the recovery for this load: it spends the
      // attempt itself, so a failure after it reports `failed` instead of hiding
      // behind one more automatic attempt (4.0s: one automatic retry per load,
      // one attempt per explicit action).
      automaticRetries = MAX_AUTOMATIC_RETRIES;
      publishStatus({ state: "retrying", reason: null });
      startAttempt();
    },

    dispose(): void {
      if (disposed) return;
      if (terrainTimer !== null) clearTimeout(terrainTimer);
      layerStatusListeners.clear();
      disposed = true;
      if (changedSpanExpiry !== null) {
        clearTimeout(changedSpanExpiry);
        changedSpanExpiry = null;
      }
      listeners.clear();
      viewportListeners.clear();
      errorListeners.clear();
      statusListeners.clear();
      const current = attempt;
      attempt = null;
      teardownAttempt(current);
      container.removeAttribute(MAP_EXTENT_ATTRIBUTE);
      container.removeAttribute(MAP_CAMERA_ATTRIBUTE);
      container.removeAttribute(MAP_ERROR_ATTRIBUTE);
      container.removeAttribute(MAP_LOAD_ATTRIBUTE);
      container.removeAttribute(MAP_LOAD_REASON_ATTRIBUTE);
      if (claimedContainers.get(container) === host) claimedContainers.delete(container);
    },
  };

  // Import the renderer once, here, so the first attempt is synchronous: the
  // caller's `await` resolves with a host whose renderer already exists (React's
  // effect ordering and the browser gates both depend on that).
  try {
    const loadedModule = (await import("maplibre-gl")) as unknown as MapLibreModule;
    loadedModule.setWorkerUrl(assetUrl(options.assetBasePath, DEFAULT_WORKER_PATH));
    renderer = loadedModule;
  } catch {
    renderer = null;
  }
  // With no network, the configured basemap cannot draw; a downloaded one can.
  if (renderer !== null && deviceOffline()) {
    const offlineStyle = await prepareOfflineBasemap(renderer).catch(() => null);
    if (offlineStyle !== null) {
      style = offlineStyle as unknown as MapStyleSpec;
      drawingOfflineBasemap = true;
      container.setAttribute(MAP_BASEMAP_ATTRIBUTE, "offline");
    }
  }
  // Two independent StrictMode creates can both be past the first claim sweep;
  // sweeping again after the await keeps "one host per container" true whichever
  // one resolves last.
  const claimedAfterLoad = claimedContainers.get(container);
  if (claimedAfterLoad !== undefined) claimedAfterLoad.dispose();

  // Night contrast opens dark from the first frame instead of flashing the day map.
  if (renderer !== null && basemapLook === "night" && !drawingOfflineBasemap) {
    const night = await loadNightStyle();
    if (night !== null) style = night;
    else basemapLook = "map";
  }
  if (basemapLook === "night") container.setAttribute("data-basemap-look", "night");

  claimedContainers.set(container, host);
  publishStatus({ state: "loading", reason: null });
  if (renderer === null) failAttempt("renderer-unavailable");
  else createAttempt(renderer);

  return host;
}
