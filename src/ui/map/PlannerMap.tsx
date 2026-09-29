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
 * `data-map-extent`, `data-map-camera`, `data-map-scene`, `data-map-error`,
 * `data-map-load` and `data-layer-error` are published by the host so a browser
 * gate can compute a deterministic click position and assert what is drawn — and
 * what failed — without reading pixels it cannot parse.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_MAP_EXTENT, sceneExtent, type MapExtent } from "@/application/map/build-map-scene";
import type { PointerTool } from "@/application/map/interaction";
import type { MapInsets } from "@/application/map/insets";
import type { RideCamera } from "@/application/map/ride-camera";
import type {
  BasemapMode,
  MapErrorKind,
  MapHost,
  MapHostFactory,
  MapLoadStatus,
  MapRenderError,
} from "@/application/map/map-host";
import type { MapIntent, MapScene } from "@/application/map/types";
import { SATELLITE_PREFERENCE_KEY } from "@/application/map/preferences";

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

export interface PlannerMapProps {
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
  /**
   * The rider's request for one more recovery attempt, as a token the workspace
   * bumps (05 §8's fit pattern). Only a *change* asks for a retry, so the mount
   * itself never spends one; the one live host is asked, never a new surface.
   */
  readonly retryToken?: number;
}

const NO_INSETS: MapInsets = { top: 0, right: 0, bottom: 0, left: 0 };

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
  basemap = "empty",
  onEscape,
  onRenderError,
  onLoadStatus,
  onViewport,
  terrain3d = false,
  retryToken = 0,
}: PlannerMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<MapHost | null>(null);
  /** Satellite imagery, when the host can draw it (M3, OGV-D-265). */
  const [satelliteAvailable, setSatelliteAvailable] = useState(false);
  const [satellite, setSatellite] = useState(false);
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
    let unsubscribeViewport: (() => void) | null = null;

    void (async () => {
      const host = await hostFactory(container, {
        basemap,
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
      if (terrainRef.current) host.setTerrain3d?.(true);
      if (host.supportsSatellite === true) {
        setSatelliteAvailable(true);
        const remembered = readSatelliteChoice();
        if (remembered) {
          host.setSatellite?.(true);
          setSatellite(true);
        }
      }
      unsubscribe = host.onIntent((intent) => intentRef.current(intent));
      // A renderer failure is reported up rather than only painted on the
      // container: the rider-facing notice lives in the sheet, and the attribute
      // the browser gate reads is written by the host itself.
      unsubscribeError = host.onError?.((error) => renderErrorRef.current?.(error)) ?? null;
      // The host replays the state that already holds, so a surface that mounts
      // mid-load (or after a failure) is never left guessing (4.0s).
      unsubscribeStatus = host.onStatus?.((status) => loadStatusRef.current?.(status)) ?? null;
      unsubscribeViewport =
        host.onViewport?.((extent) => viewportRef.current?.(extent)) ?? null;
      // The scene may have changed while the renderer was loading; the refs hold
      // the current values, so the map never starts a frame — or a tool — behind.
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
      hostRef.current?.dispose();
      hostRef.current = null;
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

  const toggleSatellite = useCallback((): void => {
    setSatellite((current) => {
      const next = !current;
      hostRef.current?.setSatellite?.(next);
      writeSatelliteChoice(next);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((event: React.MouseEvent): void => {
    // A long-press/right-click menu (05 §7) is not authored yet; the context menu
    // must not cover the map in the meantime.
    event.preventDefault();
  }, []);

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

      {satelliteAvailable ? (
        <button
          type="button"
          className="og-map__layer-toggle"
          data-testid="map-satellite-toggle"
          aria-pressed={satellite}
          onClick={toggleSatellite}
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
          <span className="og-map__ctl-label">{satellite ? "Map" : "Satellite"}</span>
        </button>
      ) : null}

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


/** The rider's last map/satellite choice; a per-device convenience only. */
function readSatelliteChoice(): boolean {
  try {
    return window.localStorage.getItem(SATELLITE_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSatelliteChoice(visible: boolean): void {
  try {
    window.localStorage.setItem(SATELLITE_PREFERENCE_KEY, visible ? "1" : "0");
  } catch {
    // Storage may be unavailable (private mode); the choice simply is not kept.
  }
}

/** The baseline region, re-exported so the E2E's documented default stays one value. */
export { DEFAULT_MAP_EXTENT };
