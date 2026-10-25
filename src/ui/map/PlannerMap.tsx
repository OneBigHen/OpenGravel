"use client";

/**
 * The planner map host seam (02-ARCHITECTURE-CONTRACT §17, 05 §2–§9, §11, §22).
 *
 * The component takes a `MapScene` and an `onIntent` handler and knows nothing
 * else: no store, no controller, no ride document, no engine, no URL. That is the
 * `MapHost` seam, and MapLibre sits behind it as the bounded basic renderer
 * (VNX-012) — the Mapbox Standard adapter lands later as another factory behind
 * the same port.
 *
 * The host factory is a **required prop**, and the concrete MapLibre host and its
 * stylesheet live in the composition root (`src/app`) instead of here. That is
 * finding 8 of the 4.0 review: a default factory in this file is still a UI
 * module importing `src/infrastructure`, so `src/ui` could not be scanned for the
 * renderer boundary — the seam existed but nothing enforced it. Now the UI layer
 * depends only on the port, and the architecture scanner forbids the rest.
 *
 * Five behaviours are load-bearing:
 *
 * - **One map for the lifetime of the surface.** The host is created once, in an
 *   effect, and disposed on unmount; a scene change, a style change, a selection
 *   or an opened sheet only ever calls `applyScene` (05 §2). React's StrictMode
 *   double-invokes effects, so create → dispose → create is the normal
 *   development path and the container refuses to keep two WebGL contexts.
 * - **The scene is pushed, not pulled.** The latest scene is kept in a ref, so a
 *   host that finishes loading after a scene change receives the current scene
 *   rather than the one from the render that created it.
 * - **One authoritative pointer tool.** `activeTool` is required and comes
 *   straight from the workspace's presentation state (05 §4); a default here
 *   would silently keep the map on `pan` while the rider's tool said otherwise,
 *   which is what the review found.
 * - **Escape is a UI decision.** This component relays Escape into the host's
 *   interaction machine (so an in-flight gesture is dropped) and reports it to
 *   the workspace, which owns the armed placement — the host no longer changes
 *   its own local tool behind the workspace's back (05 §4, finding 5).
 * - **Fits are requested, not decided.** The workspace bumps `fitKey` when
 *   automatic fit is allowed (05 §8); this component never decides to move the
 *   camera on its own.
 * - **Recovery is the host's, reported upward (4.0s).** The load health arrives
 *   through `onStatus` and the rider's one recovery request travels back as a
 *   `retryToken` bump: the surface never mints a second host to heal, because the
 *   host is where a lost WebGL context can actually be replaced.
 *
 * The map is also the app's own `data-*` seam (13 §7 spirit): `data-basemap`,
 * `data-map-extent`, `data-map-camera`, `data-bearing`, `data-map-scene`,
 * `data-map-error`, `data-map-load` and `data-layer-error` are published by the
 * host so a browser gate can compute a deterministic click position and assert
 * what is drawn — and what failed — without reading pixels it cannot parse.
 *
 * The rider's instruments — compass, zoom buttons and the scale rule — are drawn
 * here as one control column, but every number in them comes from the host
 * through `onCamera`: the map under the finger is the authority on which way it
 * is turned and how far a pixel reaches (05 §9).
 */

import { useDialogFocus } from "@/ui/hooks/use-dialog-focus";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Coordinate } from "@/domain/ride/types";
import { MAP_LAYERS } from "@/application/map-layers/catalog";

import { DEFAULT_MAP_EXTENT, sceneExtent, type MapExtent } from "@/application/map/build-map-scene";
import type { MapLayerDrawStatus } from "@/application/map/map-host";
import type { PointerTool } from "@/application/map/interaction";
import type { MapInsets } from "@/application/map/insets";
import type { RideCamera } from "@/application/map/ride-camera";
import type {
  BasemapMode,
  MapCameraState,
  MapErrorKind,
  MapHost,
  MapHostFactory,
  MapLoadStatus,
  MapRenderError,
} from "@/application/map/map-host";
import {
  MAX_SCALE_BAR_PX,
  scaleBarFor,
  type MapScaleBar as MapScaleBarReading,
} from "@/application/map/scale";
import type { MapIntent, MapPointAction, MapScene } from "@/application/map/types";
import {
  LOOK_LABEL,
  LOOK_NOTE,
  readLookChoice,
  writeLookChoice,
  type BasemapLook,
} from "@/ui/map/basemap-look";
import { MapCompass, MapScaleBar, MapZoomControls } from "@/ui/map/MapControls";

/**
 * The rider-facing copy for a renderer failure (05 §22, 4.0 review finding 1).
 *
 * One bounded line per failure kind, and every one of them says the same two
 * things: what is missing, and that the ride is safe. The map is a renderer, not
 * the product — a worker 404 must not be presented as a lost ride, and it must not
 * be silent either.
 */
export const MAP_ERROR_NOTICE: Readonly<Record<MapErrorKind, string>> = {
  "webgl-unavailable":
    "This device can't draw the map. Your ride is safe — you can still plan and edit it.",
  "renderer-unavailable":
    "The map couldn't start. Your ride is safe — you can still plan and edit it.",
  worker: "The map's renderer didn't load, so the drawing may be incomplete. Your ride is safe.",
  style: "The basemap couldn't load, so map detail may be missing. Your ride is safe.",
  source: "Some map layers couldn't be drawn. Your ride is safe.",
  tile: "Some map tiles couldn't load. Your ride is safe.",
  "context-lost":
    "The map's graphics context was lost, so the map had to restart. Your ride is safe.",
  renderer: "The map reported a problem, so some detail may be missing. Your ride is safe.",
};

/** Instructions for the map click armed by the planner's placement tool. */
export const TOOL_HINTS: Readonly<Record<"start" | "finish" | "stop", string>> = {
  start: "Tap the map to set your start.",
  finish: "Tap the map to set your destination.",
  stop: "Tap the map to place the stop.",
};

type PointMenuIntent = Extract<MapIntent, { type: "map-long-press" }>;

export interface PlannerMapProps {
  readonly onPointAction?: (action: MapPointAction, coordinate: Coordinate) => void;
  readonly longPressEnabled?: boolean;
  readonly addStopDisabledReason?: string | null;
  readonly scene: MapScene;
  readonly onIntent: (intent: MapIntent) => void;
  /**
   * How this surface obtains its renderer (05 §2). Injected by the composition
   * root, never defaulted here: the UI layer may not know which renderer it is
   * drawing with (02 §7, 4.0 review finding 8).
   */
  readonly hostFactory: MapHostFactory;
  /**
   * The deployment prefix the vendored MapLibre assets are served under (4.0
   * review finding 2), read from the environment at the composition root and
   * normalized on the way down.
   */
  readonly assetBasePath?: string;
  /**
   * The armed placement instruction, e.g. "Tap the map to set your start."
   * Rendered as a note over the surface, never as a control: the workspace owns
   * placement and the hint only says what the next tap does (OGV-D-214).
   */
  readonly hint?: string | null;
  /**
   * The map's accessible name (12 §15/§18). The default names the planner's map;
   * the Ride Focus surface passes its own, because "start and destination" is not
   * what a rider's ride map shows (08 §2).
   */
  readonly label?: string;
  /**
   * True while a plan is in flight (04 §9): the previous drawing stays visible
   * and is marked stale instead of blanking the map.
   */
  readonly dimmed?: boolean;
  /** The measured camera-fit insets of the current composition (05 §9). */
  readonly insets?: MapInsets;
  /**
   * The pointer tool that owns the pointer (05 §4). Required: this is the single
   * authoritative value from the workspace's presentation state.
   */
  readonly activeTool: PointerTool;
  /**
   * The ride revision. A change cancels an in-flight gesture, because a gesture
   * authored against the previous revision must not commit against this one.
   */
  readonly rideRevision?: number;
  /**
   * What the camera should frame, or `null` while the rider owns the camera
   * (05 §8). The workspace derives it from the drawn routes and from camera
   * ownership; this component reconciles it with the host, which is what keeps the
   * fit declarative instead of an imperative callback.
   */
  readonly fitKey?: string | null;
  /**
   * The extent a **fit request** should frame instead of the whole scene, or
   * `null` to frame the scene (05 §8). Only read when `fitKey` changes: it is what
   * lets an explicit "zoom to <object>" (04 §15) frame one object without turning
   * the camera into an imperative call from a component that cannot measure it.
   */
  readonly fitExtent?: MapExtent | null;
  /**
   * The ride's heading-up camera (DV-10), or `null` while nothing follows. Each
   * new `key` moves the camera; it is applied after any fit with the same
   * render, so a following ride is never snapped back to an overview.
   */
  readonly followCamera?: { readonly key: string; readonly camera: RideCamera } | null;
  /**
   * The live renderer, once it exists and `null` when it is disposed.
   *
   * A surface with its own map controls (the ride's 56 px zoom and compass)
   * sends them through the same port the map's own column uses, instead of
   * growing a second way to move the camera. Optional: a surface that shows no
   * controls needs no handle.
   */
  readonly onHost?: (host: MapHost | null) => void;
  /**
   * The camera as the rider's own controls need it: bearing, zoom and the
   * renderer's limits, rounded so a continuous easement does not re-render the
   * surface per frame. Reported only when it changes.
   */
  readonly onCamera?: (camera: CameraView) => void;
  /**
   * The basemap look this surface insists on, ignoring the rider's remembered
   * planner choice (the ride map follows Day/Night). Applied whenever it
   * changes; a look the rider picks afterwards wins until this prop changes
   * again, and a forced look is never written back as their preference.
   */
  readonly forcedLook?: "map" | "night";
  /** The basemap mode; `empty` in tests, OpenFreeMap in a real deployment. */
  readonly basemap?: BasemapMode;
  /**
   * Escape, reported to the workspace so the UI state machine can clear the armed
   * placement (05 §4, 4.0 review finding 5). Optional because a pure surface test
   * has no placement to clear.
   */
  readonly onEscape?: () => void;
  /**
   * A renderer failure the host reported (05 §22). The workspace turns it into a
   * bounded notice in the sheet; the surface keeps drawing whatever did load.
   */
  readonly onRenderError?: (error: MapRenderError) => void;
  /**
   * The host's load health (4.0s), reported as it changes and once at
   * subscription time. The workspace's honest "the map didn't load" surface and
   * its `Retry map` action are driven from this, never guessed from the DOM.
   */
  readonly onLoadStatus?: (status: MapLoadStatus) => void;
  /** The visible map extent after a camera move and once per settled subscription (OGV-D-274). */
  readonly onViewport?: (extent: MapExtent) => void;
  /** Show the ground in 3D with a tilted camera (phase 8 map layers). */
  readonly terrain3d?: boolean;
  readonly onLayerStatus?: (status: MapLayerDrawStatus) => void;
  /**
   * Extra controls for the bottom of the map's control column, rendered after
   * the zoom buttons (Locate, Show whole ride). A surface that adds one gets the
   * column's spacing, glass and pointer behaviour for free; the map itself stays
   * unaware of what those controls mean.
   */
  readonly clusterControls?: ReactNode;
  /**
   * The basemap look the layers sheet owns, when the sheet is the control on
   * this screen. Supplying it (with `onLookChange`) makes this surface's look
   * controlled; omitting both leaves the map's own button in charge.
   */
  readonly look?: BasemapLook;
  /** The rider's choice from the sheet, applied and reflected by the map. */
  readonly onLookChange?: (look: BasemapLook) => void;
  /**
   * The looks this host can actually draw, reported once the renderer is known.
   * A sheet must not offer Satellite on a host that cannot draw it.
   */
  readonly onLookOptions?: (looks: readonly BasemapLook[]) => void;
  /**
   * The rider's request for one more recovery attempt, as a token the workspace
   * bumps (05 §8's fit pattern). Only a *change* asks for a retry, so the mount
   * itself never spends one; the one live host is asked, never a new surface.
   */
  readonly retryToken?: number;
}

const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * What the instrument column shows, reduced to the values that change its
 * drawing.
 *
 * The host reports the camera on every animation frame of an eased zoom or a
 * rotate; a state update per frame would re-render the whole surface for a
 * needle that moved a fraction of a degree. Rounding to the degree and the
 * hundredth of a zoom level, and comparing the derived scale, means React only
 * hears about a change a rider could actually see.
 */
export interface CameraView {
  readonly bearing: number;
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly scale: MapScaleBarReading | null;
}

function cameraViewOf(camera: MapCameraState): CameraView {
  return {
    bearing: Math.round(camera.bearing),
    zoom: Math.round(camera.zoom * 100) / 100,
    minZoom: camera.minZoom,
    maxZoom: camera.maxZoom,
    // Unknown (a renderer that cannot name its centre) stays absent: no rule is
    // drawn rather than a ruler that might be wrong.
    scale: scaleBarFor(camera.metersPerPixel, MAX_SCALE_BAR_PX),
  };
}

function sameCameraView(previous: CameraView | null, next: CameraView): boolean {
  return (
    previous !== null &&
    previous.bearing === next.bearing &&
    previous.zoom === next.zoom &&
    previous.minZoom === next.minZoom &&
    previous.maxZoom === next.maxZoom &&
    previous.scale?.meters === next.scale?.meters &&
    previous.scale?.widthPx === next.scale?.widthPx
  );
}

/** `prefers-reduced-motion` (12 §13), read once per host creation. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function PlannerMap({
  scene,
  onIntent,
  onPointAction,
  longPressEnabled = onPointAction !== undefined,
  addStopDisabledReason = null,
  hostFactory,
  assetBasePath,
  hint = null,
  label = "Planner map with the current route, start and destination",
  dimmed = false,
  insets = NO_INSETS,
  activeTool,
  rideRevision = 0,
  fitKey = null,
  fitExtent = null,
  followCamera = null,
  onHost,
  onCamera,
  forcedLook,
  basemap = "empty",
  look: controlledLook,
  onLookChange,
  onLookOptions,
  onEscape,
  onRenderError,
  onLoadStatus,
  onViewport,
  terrain3d = false,
  onLayerStatus,
  retryToken = 0,
  clusterControls,
}: PlannerMapProps) {
  const [pointMenu, setPointMenu] = useState<PointMenuIntent | null>(null);
  const [menuContext, setMenuContext] = useState("");
  const context = `${activeTool}:${rideRevision}:${longPressEnabled}`;
  // Reset during render so a cancelled menu cannot reappear when a tool changes back.
  if (menuContext !== context) {
    setMenuContext(context);
    setPointMenu(null);
  }
  const longPressEnabledRef = useRef(longPressEnabled);
  useEffect(() => { longPressEnabledRef.current = longPressEnabled; }, [longPressEnabled]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<MapHost | null>(null);
  /** The camera the instrument column is showing (05 §9). */
  const [cameraView, setCameraView] = useState<CameraView | null>(null);
  /**
   * Folds one camera reading into the column's state. Only a visible change
   * replaces the object, so a continuous rotate does not re-render the surface
   * sixty times a second for a needle that moved a degree.
   */
  const updateCamera = useCallback((camera: MapCameraState): void => {
    const next = cameraViewOf(camera);
    setCameraView((previous) => (sameCameraView(previous, next) ? previous : next));
  }, []);
  /** The surface's own controls hear the same reading the map's column does. */
  const cameraOutRef = useRef(onCamera);
  useEffect(() => {
    cameraOutRef.current = onCamera;
  }, [onCamera]);
  const hostOutRef = useRef(onHost);
  useEffect(() => {
    hostOutRef.current = onHost;
  }, [onHost]);
  useEffect(() => {
    if (cameraView !== null) cameraOutRef.current?.(cameraView);
  }, [cameraView]);
  /** Satellite imagery, when the host can draw it (M3, OGV-D-265). */
  const [satelliteAvailable, setSatelliteAvailable] = useState(false);
  /** The night look (Night contrast, or the host's own dark scrim). */
  const [nightAvailable, setNightAvailable] = useState(false);
  /** The rider's basemap look; one of Map / Night / Satellite. */
  const [ownLook, setOwnLook] = useState<BasemapLook>(forcedLook ?? "map");
  const controlled = controlledLook !== undefined && onLookChange !== undefined;
  const look = controlled ? controlledLook : ownLook;
  const controlledLookRef = useRef(controlledLook);
  useEffect(() => {
    controlledLookRef.current = controlledLook;
  }, [controlledLook]);
  const setLook = useCallback((next: BasemapLook): void => {
    if (controlled) onLookChange(next);
    else setOwnLook(next);
  }, [controlled, onLookChange]);
  const [lookMenuOpen, setLookMenuOpen] = useState(false);
  const lookMenuRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef(scene);
  const insetsRef = useRef(insets);
  const fitExtentRef = useRef(fitExtent);
  const intentRef = useRef(onIntent);
  const activeToolRef = useRef(activeTool);
  const rideRevisionRef = useRef(rideRevision);
  const escapeRef = useRef(onEscape);
  const renderErrorRef = useRef(onRenderError);
  const loadStatusRef = useRef(onLoadStatus);
  const viewportRef = useRef(onViewport);
  const terrainRef = useRef(terrain3d);
  const layerStatusRef = useRef(onLayerStatus);
  useEffect(() => { layerStatusRef.current = onLayerStatus; }, [onLayerStatus]);
  const followRef = useRef(followCamera);
  useEffect(() => {
    followRef.current = followCamera;
  }, [followCamera]);
  useEffect(() => {
    terrainRef.current = terrain3d;
    hostRef.current?.setTerrain3d?.(terrain3d);
  }, [terrain3d]);

  // Latest-value refs, written in effects (never during render) and declared
  // before the creation effect so they are current by the time it runs.
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  useEffect(() => {
    insetsRef.current = insets;
  }, [insets]);
  useEffect(() => {
    intentRef.current = onIntent;
  }, [onIntent]);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);
  useEffect(() => {
    rideRevisionRef.current = rideRevision;
  }, [rideRevision]);
  useEffect(() => {
    fitExtentRef.current = fitExtent;
  }, [fitExtent]);
  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    renderErrorRef.current = onRenderError;
  }, [onRenderError]);
  useEffect(() => {
    loadStatusRef.current = onLoadStatus;
  }, [onLoadStatus]);
  useEffect(() => {
    viewportRef.current = onViewport;
  }, [onViewport]);

  /** Creates the one host for this container, and the intent subscription. */
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeError: (() => void) | null = null;
    let unsubscribeStatus: (() => void) | null = null;
    let unsubscribeLayerStatus: (() => void) | null = null;
    let unsubscribeViewport: (() => void) | null = null;
    let unsubscribeCamera: (() => void) | null = null;

    void (async () => {
      // A surface that insists on a look (the ride follows Day/Night) neither
      // reads nor writes the rider's planner preference. When a sheet owns the
      // choice, its value is the opening look; the stored value is only read by
      // an uncontrolled surface.
      const openedWith = forcedLook ?? controlledLookRef.current ?? readLookChoice();
      const host = await hostFactory(container, {
        basemap,
        ...(openedWith === "night" ? { basemapLook: "night" as const } : {}),
        initialExtent: sceneExtent(sceneRef.current),
        reducedMotion: prefersReducedMotion(),
        ...(assetBasePath === undefined ? {} : { assetBasePath }),
      });
      if (disposed) {
        // StrictMode (or a fast unmount) resolved after we gave up: the host must
        // not outlive the effect that asked for it.
        host.dispose();
        return;
      }
      hostRef.current = host;
      hostOutRef.current?.(host);
      unsubscribeLayerStatus = host.onLayerStatus?.((status) => layerStatusRef.current?.(status)) ?? null;
      if (terrainRef.current) host.setTerrain3d?.(true);
      if (host.supportsSatellite === true) setSatelliteAvailable(true);
      if (host.supportsNightLook === true) setNightAvailable(true);
      // Re-read a sheet-owned choice: it may have arrived from storage while
      // the renderer was starting. A look the host cannot draw falls back to
      // the map, so the sheet never claims an imagery mode that is not showing.
      const desired = forcedLook ?? controlledLookRef.current ?? openedWith;
      const resolved = desired === "satellite" && host.supportsSatellite !== true
        ? "map"
        : desired === "night" && host.supportsNightLook !== true
          ? "map"
          : desired;
      if (resolved === "satellite") host.setSatellite?.(true);
      else if (resolved === "night") host.setBasemapLook?.("night");
      // A sheet-owned surface already holds this value; only its fallback (an
      // unsupported remembered look) needs to travel back up.
      if (!controlled || controlledLookRef.current !== resolved) setLook(resolved);
      unsubscribe = host.onIntent((intent) => {
        if (intent.type === "map-long-press") {
          if (longPressEnabledRef.current && activeToolRef.current === "pan") setPointMenu(intent);
          return;
        }
        if (intent.type === "camera-changed" || intent.type === "gesture-cancel" ||
            intent.type === "object-click" || intent.type === "map-click") setPointMenu(null);
        intentRef.current(intent);
      });
      // A renderer failure is reported up rather than only painted on the
      // container: the rider-facing notice lives in the sheet, and the attribute
      // the browser gate reads is written by the host itself.
      unsubscribeError = host.onError?.((error) => renderErrorRef.current?.(error)) ?? null;
      // The host replays the state that already holds, so a surface that mounts
      // mid-load (or after a failure) is never left guessing (4.0s).
      unsubscribeStatus = host.onStatus?.((status) => loadStatusRef.current?.(status)) ?? null;
      unsubscribeViewport =
        host.onViewport?.((extent) => viewportRef.current?.(extent)) ?? null;
      // The camera's bearing, zoom and scale, for the compass, the zoom buttons
      // and the scale rule. A host without a camera (a test double) reports
      // nothing and the column simply has no instruments to show.
      unsubscribeCamera = host.onCamera?.((camera) => updateCamera(camera)) ?? null;
      // The scene may have changed while the renderer was loading; the refs hold
      // the current values, so the map never starts a frame — or a tool — behind.
      host.dispatch({ type: "long-press-enabled", enabled: longPressEnabledRef.current });
      host.dispatch({ type: "tool-change", tool: activeToolRef.current });
      host.dispatch({ type: "ride-revision-change", revision: rideRevisionRef.current });
      host.applyScene(sceneRef.current);
      host.fitBounds(sceneExtent(sceneRef.current), insetsRef.current);
      // A ride that began following before the renderer resolved is followed now.
      const follow = followRef.current;
      if (follow !== null && follow !== undefined) host.followCamera?.(follow.camera, insetsRef.current);
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      unsubscribeError?.();
      unsubscribeStatus?.();
      unsubscribeViewport?.();
      unsubscribeLayerStatus?.();
      unsubscribeCamera?.();
      hostRef.current?.dispose();
      hostRef.current = null;
      hostOutRef.current?.(null);
    };
    // The host is created once for the surface's lifetime (05 §2): the initial
    // basemap, the asset prefix and the factory are creation-time inputs by
    // contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Declarative scene sync. Never recreates the map (05 §2). */
  useEffect(() => {
    hostRef.current?.applyScene(scene);
  }, [scene]);

  /** The tool that owns the pointer, so the map can arm/disarm its gestures. */
  useEffect(() => {
    hostRef.current?.dispatch({ type: "tool-change", tool: activeTool });
  }, [activeTool]);

  useEffect(() => {
    hostRef.current?.dispatch({ type: "long-press-enabled", enabled: longPressEnabled });
  }, [longPressEnabled]);

  /** A ride-revision change cancels an in-flight gesture (05 §4). */
  useEffect(() => {
    hostRef.current?.dispatch({ type: "ride-revision-change", revision: rideRevision });
  }, [rideRevision]);

  /**
   * Escape (05 §4, 4.0 review finding 5).
   *
   * The decision belongs to the UI state machine, so the workspace is told and
   * clears its armed placement. The interaction machine still has to hear about
   * Escape too, because a gesture in flight must not commit after the rider
   * pressed it — so the same key press is relayed into the host. Both halves are
   * needed: either one alone leaves the rider escaping into a tool that is still
   * armed, or a gesture that still commits.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setPointMenu(null);
      hostRef.current?.dispatch({ type: "escape" });
      escapeRef.current?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * The rider's recovery request (4.0s).
   *
   * The token only *changes* on a press, so mounting asks for nothing — and what
   * it asks is the host that is already there, which rebuilds its renderer in
   * place. A recovery never becomes a second map, and the host itself bounds how
   * many attempts one press may spend.
   */
  useEffect(() => {
    if (retryToken === 0) return;
    hostRef.current?.retry?.();
  }, [retryToken]);

  /**
   * Reconciles the camera with the workspace's fit request (05 §8).
   *
   * A `null` key means the rider owns the camera, so nothing moves. The mount fit
   * already happened when the host resolved, which is why the first observed key
   * only records itself; later key changes — a committed route, a rider handing
   * control back, a sheet detent that changed the visible rectangle — fit against
   * the measured insets (05 §9).
   */
  const lastFitKey = useRef<string | null>(null);
  const observed = useRef(false);
  useEffect(() => {
    const key =
      fitKey === null
        ? null
        : `${fitKey}|${insets.top},${insets.right},${insets.bottom},${insets.left}`;
    if (!observed.current) {
      observed.current = true;
      lastFitKey.current = key;
      return;
    }
    if (lastFitKey.current === key) return;
    lastFitKey.current = key;
    if (key === null) return;
    hostRef.current?.fitBounds(fitExtentRef.current ?? sceneExtent(sceneRef.current), insets);
  }, [fitKey, insets]);

  /** The follow camera: each new key eases the map to the rider (DV-10). */
  const followKey = followCamera?.key ?? null;
  useEffect(() => {
    const follow = followRef.current;
    if (followKey === null || follow === null || follow === undefined) return;
    hostRef.current?.followCamera?.(follow.camera, insets);
  }, [followKey, insets]);

  /**
   * One look at a time: satellite draws over Map, Night swaps the basemap (or
   * dims it, on a host with no dark style of its own).
   */
  const applyLook = useCallback((next: BasemapLook): void => {
    const host = hostRef.current;
    host?.setSatellite?.(next === "satellite");
    host?.setBasemapLook?.(next === "night" ? "night" : "map");
  }, []);

  /** The rider's own pick: it is remembered, and it closes the menu. */
  const chooseLook = useCallback((next: BasemapLook): void => {
    applyLook(next);
    setLook(next);
    setLookMenuOpen(false);
    writeLookChoice(next);
  }, [applyLook, setLook]);

  // A sheet-owned choice arrives as a prop: apply it whenever it changes, but
  // not on the first render — the host creation effect already opened with it.
  const appliedLook = useRef<BasemapLook | null>(null);
  useEffect(() => {
    if (!controlled || controlledLook === undefined) return;
    if (appliedLook.current === controlledLook) return;
    appliedLook.current = controlledLook;
    if (hostRef.current === null) return;
    applyLook(controlledLook);
  }, [applyLook, controlled, controlledLook]);

  /*
    The look this surface insists on, re-applied only when it *changes*: a
    Day/Night switch mid-ride turns the map with the chrome, while a look the
    rider picked in the sheet afterwards stays until the next switch.
  */
  const [forcedLookSeen, setForcedLookSeen] = useState<"map" | "night" | null>(forcedLook ?? null);
  // Derived during render, so the map turns in the same commit as the chrome
  // that flipped the theme (the same pattern the point menu above uses).
  if (forcedLook !== undefined && forcedLookSeen !== forcedLook) setForcedLookSeen(forcedLook);
  useEffect(() => {
    if (forcedLookSeen === null || hostRef.current === null) return;
    applyLook(forcedLookSeen);
    setLook(forcedLookSeen);
  }, [forcedLookSeen, applyLook, setLook]);

  /**
   * The style button sits in a different corner per tier and surface, so the
   * menu is anchored to wherever the button actually is: beside it, opening
   * toward the middle of the map.
   */
  useEffect(() => {
    if (!lookMenuOpen) return;
    const wrap = lookMenuRef.current;
    const button = wrap?.querySelector<HTMLElement>(".og-map__layer-toggle");
    const host = wrap?.closest<HTMLElement>(".og-map-host");
    if (wrap == null || button == null || host == null) return;
    const b = button.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    const onRight = b.left + b.width / 2 > h.left + h.width / 2;
    wrap.dataset["side"] = onRight ? "right" : "left";
    wrap.style.setProperty("--og-look-top", `${Math.round(b.top - h.top)}px`);
    wrap.style.setProperty(
      "--og-look-x",
      `${Math.round(onRight ? h.right - b.left + 8 : b.right - h.left + 8)}px`,
    );
  }, [lookMenuOpen]);

  /** A tap outside, or Escape, closes the style menu. */
  useEffect(() => {
    if (!lookMenuOpen) return;
    const onPointer = (event: PointerEvent): void => {
      if (lookMenuRef.current?.contains(event.target as Node) === true) return;
      setLookMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setLookMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [lookMenuOpen]);

  const looks = useMemo<readonly BasemapLook[]>(
    () => [
      "map",
      ...(nightAvailable ? (["night"] as const) : []),
      ...(satelliteAvailable ? (["satellite"] as const) : []),
    ],
    [nightAvailable, satelliteAvailable],
  );
  useEffect(() => {
    onLookOptions?.(looks);
  }, [looks, onLookOptions]);

  const handleContextMenu = useCallback((event: React.MouseEvent): void => {
    // The host feeds contextmenu through the same reducer as a timed hold.
    event.preventDefault();
  }, []);

  /** One zoom level per press; the host clamps to its own limits (05 §9). */
  const zoomIn = useCallback((): void => hostRef.current?.zoomBy?.(1), []);
  const zoomOut = useCallback((): void => hostRef.current?.zoomBy?.(-1), []);
  /** The compass's one job: turn the map north-up again. */
  const faceNorth = useCallback((): void => hostRef.current?.faceNorth?.(), []);

  return (
    <div
      className="og-map-host"
      data-testid="map-host"
      data-dimmed={dimmed ? "true" : "false"}
    >
      <div
        ref={containerRef}
        className="og-map"
        data-testid="planner-map"
        data-basemap={basemap}
        /*
          The load health starts `loading` here, in the same render that creates
          the container (4.0s). The host owns this attribute from the moment it
          exists — it publishes `ready`, `retrying` or `failed` itself — but the
          renderer is a dynamically imported module, so between this element and
          the host there is a window in which the only honest thing to say is
          "still loading". Rendering it removes the window in which a blank map
          said nothing at all.
        */
        data-map-load="loading"
        role="application"
        aria-label={label}
        onContextMenu={handleContextMenu}
      />

      {pointMenu !== null && longPressEnabled && activeTool === "pan" ? (
        <MapPointMenu intent={pointMenu} scene={scene} container={containerRef}
          insets={insets} addStopDisabledReason={addStopDisabledReason}
          onClose={() => setPointMenu(null)}
          onAction={(action) => { onPointAction?.(action, pointMenu.coordinate); setPointMenu(null); }} />
      ) : null}

      {looks.length > 1 ? (
        <div className="og-map__look" ref={lookMenuRef}>
          <button
            type="button"
            className="og-map__layer-toggle"
            data-testid="map-satellite-toggle"
            aria-haspopup="true"
            aria-expanded={lookMenuOpen}
            aria-controls="og-map-look-menu"
            aria-label={`Map style: ${LOOK_LABEL[look]}`}
            onClick={() => setLookMenuOpen((open) => !open)}
          >
            <svg
              className="og-map__ctl-icon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z" />
            </svg>
            <span className="og-map__ctl-label">{LOOK_LABEL[look]}</span>
          </button>
          {lookMenuOpen ? (
            <div
              id="og-map-look-menu"
              className="og-map__look-menu"
              role="radiogroup"
              aria-label="Map style"
              data-testid="map-look-menu"
            >
              {looks.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={look === option}
                  className="og-map__look-option"
                  data-look={option}
                  data-testid={`map-look-${option}`}
                  onClick={() => chooseLook(option)}
                >
                  <span className="og-map__look-swatch" data-look={option} aria-hidden="true" />
                  <span className="og-map__look-name">{LOOK_LABEL[option]}</span>
                  <span className="og-map__look-note">{LOOK_NOTE[option]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/*
        One control column on the right edge: the map's own instruments first
        (compass, zoom), then whatever this surface adds below them (Locate,
        Show whole ride). Pointer events sit on the buttons alone, so a drag
        that starts between two of them still pans the map.
      */}
      <div className="og-map__cluster" data-testid="map-cluster">
        <MapCompass bearing={cameraView?.bearing ?? 0} onFaceNorth={faceNorth} />
        <MapZoomControls
          zoom={cameraView?.zoom ?? 0}
          minZoom={cameraView?.minZoom ?? Number.NEGATIVE_INFINITY}
          maxZoom={cameraView?.maxZoom ?? Number.POSITIVE_INFINITY}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
        />
        {clusterControls}
      </div>

      {/*
        The scale rule: bottom-left of the map the rider can actually see, which
        is why it is offset by the measured camera insets rather than by a tier.
      */}
      {cameraView?.scale === null || cameraView === null ? null : (
        <MapScaleBar
          scale={cameraView.scale}
          insetLeft={insets.left}
          insetBottom={insets.bottom}
        />
      )}

      {/*
        A visible "Loading map…" until the renderer has drawn tiles (AQ-01,
        ML-03, EX-09): a blank panel otherwise reads as a broken app. CSS hides
        it once the host marks the map painted, or when the load failed (the
        workspace's own failure surface takes over then).
      */}
      <div className="og-map__veil" data-testid="map-veil" aria-hidden="true">
        <span className="og-map__veil-label">Loading map…</span>
      </div>

      {hint === null ? null : (
        <p className="og-map__hint" data-testid="map-hint" role="note">
          {hint}
        </p>
      )}
    </div>
  );
}


/** The baseline region, re-exported so the E2E's documented default stays one value. */
export { DEFAULT_MAP_EXTENT };


/**
 * The width the instrument column reserves on the map's right edge: its 12 px
 * inset plus one 44 px button slot (`.og-map__cluster` in globals.css). A wide
 * card is clamped to end clear of it, so the plan-here menu and the compass /
 * zoom buttons never sit on top of each other.
 */
const CONTROL_COLUMN_PX = 56;

const POINT_ROWS = [
  { action: "start", label: "Start here", path: "M7 21V3l12 4-12 4" },
  { action: "stop", label: "Add stop here", path: "M12 5v14M5 12h14" },
  { action: "finish", label: "Finish here", path: "M6 21V3h13v9H6M10 3v9M15 3v9" },
  { action: "loop", label: "Loop from here (1 h)", path: "M19 8a8 8 0 1 0 1 7M19 3v5h-5" },
  { action: "info", label: "What's here?", path: "M12 11v6M12 7v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" },
] as const;

function MapPointMenu({ intent, scene, container, insets, addStopDisabledReason, onAction, onClose }: {
  readonly intent: PointMenuIntent;
  readonly scene: MapScene;
  readonly container: React.RefObject<HTMLDivElement | null>;
  readonly insets: MapInsets;
  readonly addStopDisabledReason: string | null;
  readonly onAction: (action: MapPointAction) => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showInfo, setShowInfo] = useState(false);
  const authority = scene.infoLayers?.features.find((feature) =>
    feature.id === intent.authorityFeatureId && feature.id.startsWith("authority:") &&
    (feature.layerId === "mvum" || feature.layerId === "work-zones"));

  useLayoutEffect(() => {
    const menu = ref.current;
    const map = container.current;
    if (menu === null || map === null) return;
    const position = (): void => {
      const bounds = map.getBoundingClientRect();
      const compact = window.matchMedia?.("(max-width: 1180px) and (not ((orientation: landscape) and (max-height: 500px) and (min-width: 560px)))").matches ?? window.innerWidth <= 1180;
      const dock = map.closest(".og-planner")?.querySelector(".og-planner__dock")?.getBoundingClientRect();
      const bottom = Math.min(window.innerHeight - 8, bounds.bottom - insets.bottom,
        compact && dock !== undefined && dock.height > 0 ? dock.top - 8 : Infinity);
      menu.style.maxHeight = `${Math.max(48, bottom - Math.max(8, bounds.top))}px`;
      menu.style.width = compact ? `${Math.max(0, Math.min(window.innerWidth, bounds.width) - 24)}px` : "min(320px, calc(100vw - 24px))";
      const box = menu.getBoundingClientRect();
      const pressX = bounds.left + intent.pixel.x;
      const pressY = bounds.top + intent.pixel.y;
      // Wide screens: beside the press point, flipped to the other side when the
      // card would run off the viewport — and always kept out of the instrument
      // column's right-edge slot, which is live chrome rather than map.
      const clearOfChrome = window.innerWidth - CONTROL_COLUMN_PX - box.width;
      const left = compact ? Math.max(12, bounds.left + 12)
        : Math.max(8, Math.min(
            pressX + box.width + 8 <= window.innerWidth - CONTROL_COLUMN_PX ? pressX + 8 : pressX - box.width - 8,
            clearOfChrome,
          ));
      const top = compact ? bottom - box.height
        : Math.max(8, Math.min(pressY + box.height + 8 <= bottom ? pressY + 8 : pressY - box.height - 8, bottom - box.height));
      menu.style.left = `${left}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(menu);
    const dock = map.closest(".og-planner")?.querySelector(".og-planner__dock");
    if (dock !== null && dock !== undefined) observer?.observe(dock);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [container, intent, insets]);

  // Focus enters the first row, Tab stays inside, Escape closes, and focus returns to the map (12 §20).
  useDialogFocus(ref, onClose);

  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [onClose]);

  return (
    <div ref={ref} className="og-map-point-menu" role="dialog" aria-modal="true" aria-label="Plan here"
      data-testid="map-point-menu">
      {POINT_ROWS.map((row) => {
        const reason = row.action === "stop" ? addStopDisabledReason : null;
        return <button key={row.action} type="button" className="og-map-point-menu__row"
          disabled={reason !== null}
          onClick={() => row.action === "info" ? setShowInfo(true) : onAction(row.action)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={row.path} /></svg>
          <span>{row.label}{reason === null ? null : <> <span className="og-map-point-menu__secondary">— {reason}</span></>}</span>
        </button>;
      })}
      {showInfo ? <div className="og-map-point-menu__info" role="status">
        <strong>{authority?.name ?? "No authority record for this spot"}</strong>
        <p>{authority?.detail ?? "Only loaded authority layers and their source coverage are checked. Missing, disabled or unavailable layers and source gaps leave this spot unknown."}</p>
        {authority === undefined ? null : <p>{MAP_LAYERS.find((layer) => layer.id === authority.layerId)?.caveat}</p>}
      </div> : null}
    </div>
  );
}
