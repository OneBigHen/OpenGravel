/**
 * The renderer port (02-ARCHITECTURE-CONTRACT §17, 05 §2–§6, §9).
 *
 * `MapHost` is the seam the planner workspace talks to, and it is deliberately
 * small: a declarative scene in, typed intents out, one camera command, one
 * disposal. The scene is projected outside any renderer-specific code and the
 * intents are consumed by the workspace's interaction controller, so MapHost has
 * no access to a ride-document store, a controller or a session (rule C) and the
 * workspace never learns which renderer is behind it.
 *
 * Two properties are contract, not implementation detail:
 *
 * - **One instance per container.** `dispose()` unloads the map, and a host that
 *   is created for a container that already has one takes it over rather than
 *   stacking a second WebGL context (05 §2, §26).
 * - **`applyScene` is a sync, not a rebuild.** A scene change updates sources and
 *   layers; it never recreates the map. Style changes, selections and openings of
 *   sheets are not recreation reasons.
 */

import type { MapLayerId } from "@/application/map-layers";

import type { MapExtent } from "./build-map-scene";
import type { InteractionEvent } from "./interaction";
import type { MapInsets } from "./insets";
import type { RideCamera } from "./ride-camera";
import type { MapIntent, MapScene } from "./types";

/** Which basemap the host draws under the OpenGravel layers. */
export type BasemapMode = "mapbox" | "openfreemap" | "osm" | "empty";

/**
 * What went wrong in the renderer, as a machine-readable token (05 §22).
 *
 * The renderer fails asynchronously and quietly — a worker 404, a style that
 * never fetches, a source that is rejected — so the tokens are the contract a
 * browser gate and a bounded notice read instead of pixels:
 *
 * - `webgl-unavailable` / `renderer-unavailable` — the renderer could not start
 *   at all (a locked-down browser, a device without graphics acceleration).
 * - `worker` — the vendored MapLibre worker module could not be loaded.
 * - `style` — the basemap style could not be fetched or parsed.
 * - `source` / `tile` — a source could not be added, or its data/tiles failed.
 * - `context-lost` — the WebGL context was lost; the renderer had to be rebuilt.
 * - `renderer` — anything else the renderer reported; still not invisible.
 */
export type MapErrorKind =
  | "webgl-unavailable"
  | "renderer-unavailable"
  | "worker"
  | "style"
  | "source"
  | "tile"
  | "context-lost"
  | "renderer";

/**
 * How far the renderer has got in loading *this* map (4.0s).
 *
 * A renderer fails asynchronously and quietly, and the default reading of a map
 * that draws nothing is "an empty map". This is the renderer's own answer to
 * "is it up?", published on the container as `data-map-load` so a browser gate
 * can wait for the map instead of guessing from pixels, and so the workspace can
 * tell `loading` (wait), `retrying` (a recovery is in flight), `ready` (drawing)
 * and `failed` (not coming back on its own) apart.
 *
 * `ready` means the style is loaded *and* the renderer has produced data for it:
 * tiles for a tile basemap, the layer sources for a local one. `loading` that
 * never ends is the failure this type exists to make impossible.
 */
export type MapLoadState = "loading" | "ready" | "retrying" | "failed";

/** The load state, and — while pending or failed — what blocked it. */
export interface MapLoadStatus {
  readonly state: MapLoadState;
  /** The failure kind behind `retrying`/`failed`; `null` while loading or ready. */
  readonly reason: MapErrorKind | null;
}

/** One renderer failure: what kind, and the id/detail the renderer named. */
export interface MapRenderError {
  readonly kind: MapErrorKind;
  /** The source id, layer id or message that named the failure; else `null`. */
  readonly detail: string | null;
}

export interface MapHostOptions {
  /** The basemap to draw under our own layers (env-driven, honest). */
  readonly basemap: BasemapMode;
  /**
   * The public Mapbox token (`pk.…`) the `mapbox` basemap and the satellite
   * layer need (M3, OGV-D-265). Absent means neither is offered.
   */
  readonly mapboxToken?: string;
  /**
   * The camera the host opens with. Not a claim about the rider's location: the
   * workspace passes the scene's extent, or the documented baseline region while
   * the scene is empty (04 §3).
   */
  readonly initialExtent: MapExtent;
  /** Honour `prefers-reduced-motion` for camera animation (12 §13). */
  readonly reducedMotion?: boolean;
  /**
   * The deployment prefix the vendored MapLibre assets are served under
   * (`src/application/map/asset-path.ts`). Read at the composition root and
   * joined here; the renderer never assumes the origin root, because a prefixed
   * deployment that silently 404s its worker draws a background and no data.
   */
  readonly assetBasePath?: string;
}

/** Renderer acknowledgement, separate from successful provider transport. */
export interface MapLayerDrawStatus {
  readonly layerId: MapLayerId;
  readonly state: "loading" | "ready" | "unavailable";
}

export interface MapHost {
  /** Declarative sync of the whole scene. Never recreates the map (05 §2). */
  applyScene(scene: MapScene): void;
  /**
   * Fits `extent` into the visible rectangle: `insets` are the measured
   * sheet/rail/header/safe-area numbers (05 §9), never a fixed reservation.
   */
  fitBounds(extent: MapExtent, insets: MapInsets): void;
  /**
   * The ride's heading-up camera (DV-10): centre on the rider, turn the road
   * ahead up the screen, tilt, and zoom for speed. `insets` are the chrome over
   * the map, so the rider sits in the open part of it. Optional: a test double
   * and a host without a camera simply do not follow.
   */
  followCamera?(camera: RideCamera, insets: MapInsets): void;
  /**
   * Non-pointer transitions the workspace owns (Escape, tool change, ride
   * revision). Pointer events belong to the host, which is what owns the DOM.
   */
  dispatch(event: InteractionEvent): void;
  /** Subscribe to intents; returns the unsubscribe function. */
  onIntent(listener: (intent: MapIntent) => void): () => void;
  /**
   * Subscribe to renderer failures (05 §22); returns the unsubscribe function.
   *
   * Optional, because a host that cannot fail asynchronously — a test double, a
   * host that never fetched anything — has nothing to report. A renderer that
   * *has* already failed (the degraded host) reports at subscription time so the
   * UI notice is never silently skipped.
   */
  onError?(listener: (error: MapRenderError) => void): () => void;
  /**
   * Subscribe to the renderer's load health (4.0s); returns the unsubscribe
   * function.
   *
   * Optional, like `onError`, because a test double has no asynchronous load to
   * report. A host that already settled reports its current status at
   * subscription time — a subscriber must never wait for a transition that has
   * already happened.
   */
  onStatus?(listener: (status: MapLoadStatus) => void): () => void;
  /**
   * One rider-initiated recovery attempt (4.0s).
   *
   * Callable whenever the map is not mid-recovery: the workspace offers it from
   * the `failed` surface, and it always spends exactly one attempt, so the rider
   * can always ask again but the host never loops. The automatic, unattended
   * retry is the host's own business and is bounded to one per load.
   */
  retry?(): void;
  /**
   * Shows or hides satellite imagery under the ride (M3, OGV-D-265). Present
   * only on a host that can draw it; a no-op before the style loads (the
   * choice is applied when it does).
   */
  setSatellite?(visible: boolean): void;
  /** True when this host can draw satellite imagery. */
  readonly supportsSatellite?: boolean;
  /**
   * Shows the ground in 3D and tilts the camera (UX rework phase 8), or lays it
   * flat again. A no-op before the style loads; applied when it does.
   */
  setTerrain3d?(on: boolean): void;
  /**
   * Subscribe to the visible extent (OGV-D-274); returns the unsubscribe function.
   *
   * Reported after every settled camera move — the rider's pans *and* the
   * host's own fits — because anything that loads data for "what is on screen"
   * (the places overlay) needs both. It is not a user-intent signal: that stays
   * `camera-changed`. A host that has settled reports its current extent at
   * subscription time. Optional, like `onStatus`, for test doubles.
   */
  onViewport?(listener: (extent: MapExtent) => void): () => void;
  /** Tile/renderer progress for layers with no feature-provider acknowledgement. */
  onLayerStatus?(listener: (status: MapLayerDrawStatus) => void): () => void;
  /** Remove listeners and unload the map. Idempotent. */
  dispose(): void;
}

/**
 * How the workspace obtains a host. Async because the MapLibre adapter is
 * dynamically imported (the renderer is a heavy, browser-only dependency), and
 * injectable because the component tests drive a stub host instead of WebGL.
 */
export type MapHostFactory = (
  container: HTMLElement,
  options: MapHostOptions,
) => MapHost | Promise<MapHost>;
