"use client";

/**
 * The rider's map layers as UI state (UX rework phase 8): which layers are on
 * (remembered per device), what the current view loaded for them, each
 * layer's status, and the feature whose card is open.
 *
 * Loading follows the viewport, debounced, and only for layers the current
 * zoom can carry: a whole-state view asks for nothing, and the panel says
 * "zoom in" instead of pretending the layer is empty.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { MapLayerDrawStatus } from "@/application/map/map-host";
import type { MapExtent } from "@/application/map/build-map-scene";
import type { InfoLayersScene, MapIntent } from "@/application/map/types";
import {
  CAMERA_ROUTE_ONLY_STORAGE_KEY,
  MAP_LAYERS_STORAGE_KEY,
} from "@/application/map/preferences";
import {
  MAP_LAYERS,
  RADAR_FRAME_INTERVAL_MS,
  RADAR_LIST_REFRESH_MS,
  advanceRadarTimeline,
  clampLayerBounds,
  featureLayerIds,
  initialRadarTimeline,
  isMapLayerId,
  latestFrameIndex,
  mapLayer,
  projectAlong,
  radarFrameLabel,
  radarFreshness,
  radarTileTemplate,
  scrubRadarTimeline,
  setRadarPlaying,
  type InfoFeature,
  type LayerFreshness,
  type LayerRaster,
  type LngLat,
  type InfoProvider,
  type MapLayerId,
  type MapLayersSource,
  type RadarFrame,
  type RadarFrameList,
  type RadarTimelineState,
} from "@/application/map-layers";

export type MapLayerStatus = "off" | "zoom-in" | "loading" | "ready" | "stale" | "unavailable";

/**
 * The animated rain radar as the map's timeline sees it (map-experience wave 3):
 * the frame list, the frame on screen, whether it is playing, and the two
 * actions that move it. Empty `frames` with `unavailable` means the list could
 * not be read — never that the sky is clear.
 */
export interface RadarView {
  readonly frames: readonly RadarFrame[];
  readonly index: number;
  readonly playing: boolean;
  /** "2:40 PM" for an observed frame, "+20 min" for a nowcast frame. */
  readonly label: string;
  readonly unavailable: boolean;
  readonly loading: boolean;
  readonly scrub: (index: number) => void;
  readonly togglePlay: () => void;
}

export interface MapLayersView {
  readonly freshness: readonly LayerFreshness[];
  readonly enabled: readonly MapLayerId[];
  readonly status: Readonly<Record<MapLayerId, MapLayerStatus>>;
  readonly counts: Readonly<Record<MapLayerId, number>>;
  readonly scene: InfoLayersScene | undefined;
  /** `null` while the rain radar layer is off; the timeline renders only then. */
  readonly radar: RadarView | null;
  readonly selected: InfoFeature | null;
  readonly cameraRouteOnly: boolean;
  readonly cameraRouteAvailable: boolean;
  readonly toggleCameraRouteOnly: () => void;
  readonly toggle: (id: MapLayerId) => void;
  /** Turns a whole set on, or off when every one of them is already on. */
  readonly toggleSet: (ids: readonly MapLayerId[]) => void;
  readonly clearAll: () => void;
  readonly select: (id: string | null) => void;
  readonly onViewport: (extent: MapExtent) => void;
  readonly onLayerStatus: (status: MapLayerDrawStatus) => void;
  /** `null` consumes a feature tap; every other intent is passed through. */
  readonly interceptIntent: (intent: MapIntent) => MapIntent | null;
}

const CAMERA_ROUTE_CORRIDOR_METERS = 5_000;
const LOAD_DEBOUNCE_MS = 450;

/** Which provider serves each feature layer, to read `unavailable` per layer. */
const LAYER_PROVIDER: Partial<Record<MapLayerId, InfoProvider>> = {
  hillshade: "hillshade", contours: "terrain", slope: "terrain",
  "live-traffic": "tomtom",
  "traffic-cameras": "traffic-cameras",
  weather: "nws",
  "active-fire": "firms",
  "great-roads": "roads",
  gravel: "roads",
  "road-history": "road-history",
  fuel: "tomtom",
  food: "tomtom",
  coffee: "tomtom",
  camping: "tomtom",
  lodging: "tomtom",
  repair: "tomtom",
  viewpoints: "tomtom",
  "public-land": "padus",
  mvum: "authority",
  "work-zones": "authority",
};

/** The enabled-layer choice as an external store, so SSR and hydration agree. */
const enabledListeners = new Set<() => void>();
let enabledSnapshot: readonly MapLayerId[] | null = null;
const cameraRouteListeners = new Set<() => void>();
let cameraRouteSnapshot: boolean | null = null;
const NONE: readonly MapLayerId[] = [];

function subscribeEnabled(listener: () => void): () => void {
  enabledListeners.add(listener);
  return () => enabledListeners.delete(listener);
}

function enabledNow(): readonly MapLayerId[] {
  if (enabledSnapshot === null) enabledSnapshot = readEnabled();
  return enabledSnapshot;
}

function setEnabledNow(next: readonly MapLayerId[]): void {
  enabledSnapshot = next;
  writeEnabled(next);
  for (const listener of enabledListeners) listener();
}

/** Enable a discovery layer through the same preference store as Layers. */
export function enableMapLayer(id: MapLayerId): void {
  const current = enabledNow();
  if (!current.includes(id)) setEnabledNow([...current, id]);
}

function readEnabled(): readonly MapLayerId[] {
  try {
    const raw = window.localStorage.getItem(MAP_LAYERS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is MapLayerId => typeof id === "string" && isMapLayerId(id)) : [];
  } catch {
    return [];
  }
}

function writeEnabled(ids: readonly MapLayerId[]): void {
  try {
    window.localStorage.setItem(MAP_LAYERS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // A per-device convenience: private mode just forgets the choice.
  }
}

function subscribeCameraRouteOnly(listener: () => void): () => void {
  cameraRouteListeners.add(listener);
  return () => cameraRouteListeners.delete(listener);
}

function readCameraRouteOnly(): boolean {
  try {
    return window.localStorage.getItem(CAMERA_ROUTE_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function cameraRouteOnlyNow(): boolean {
  if (cameraRouteSnapshot === null) cameraRouteSnapshot = readCameraRouteOnly();
  return cameraRouteSnapshot;
}

function setCameraRouteOnlyNow(next: boolean): void {
  cameraRouteSnapshot = next;
  try {
    window.localStorage.setItem(CAMERA_ROUTE_ONLY_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // A per-device convenience only.
  }
  for (const listener of cameraRouteListeners) listener();
}

/**
 * Keeps camera markers close enough to be useful for a planned ride while
 * leaving every other enabled information layer untouched.
 */
export function filterTrafficCamerasToRoute(
  features: readonly InfoFeature[],
  route: readonly LngLat[],
  maxOffMeters = CAMERA_ROUTE_CORRIDOR_METERS,
): readonly InfoFeature[] {
  if (route.length < 2) return features;
  return features.filter((feature) => {
    if (feature.layerId !== "traffic-cameras") return true;
    if (feature.geometry.type !== "Point") return false;
    return projectAlong(route, feature.geometry.coordinates).offMeters <= maxOffMeters;
  });
}

/** The web-mercator zoom a view of this width shows, from its longitude span. */
export function zoomOf(extent: MapExtent, widthPx: number): number {
  const span = Math.max(1e-6, extent.maxLon - extent.minLon);
  return Math.log2((360 * Math.max(1, widthPx)) / (512 * span));
}

function emptyRecord<T>(value: T): Record<MapLayerId, T> {
  return Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, value])) as Record<MapLayerId, T>;
}

export function useMapLayers(
  source: MapLayersSource | undefined,
  cameraRoute: readonly LngLat[] | null = null,
): MapLayersView {
  const [drawStatus, setDrawStatus] = useState<Partial<Record<MapLayerId, MapLayerDrawStatus["state"]>>>({});
  const onLayerStatus = useCallback(({ layerId, state }: MapLayerDrawStatus): void => {
    setDrawStatus((current) => current[layerId] === state ? current : { ...current, [layerId]: state });
  }, []);
  const enabled = useSyncExternalStore(subscribeEnabled, enabledNow, () => NONE);
  const [extent, setExtent] = useState<MapExtent | null>(null);
  const [result, setResult] = useState<{
    readonly rasters: readonly LayerRaster[];
    readonly freshness: readonly LayerFreshness[];
    readonly key: string;
    readonly features: readonly InfoFeature[];
    readonly unavailable: ReadonlySet<InfoProvider>;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (enabled.length === 0) return;
    const timer = setInterval(() => setRefresh((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [enabled.length]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cameraRouteOnly = useSyncExternalStore(
    subscribeCameraRouteOnly,
    cameraRouteOnlyNow,
    () => false,
  );

  /*
   * The rain radar's frame list and timeline (map-experience wave 3). The list
   * comes from our own cached route, never from RainViewer; the frame on screen
   * is projected into the scene as one tile template, and the timeline is UI
   * state here so the map stays a renderer.
   *
   * Staleness is stamped when the list is read, inside the async callback: a
   * render must stay pure, and the list is re-read every five minutes anyway.
   */
  const reducedMotion = useReducedMotion();
  const radarOn = enabled.includes("weather-radar");
  const [radarList, setRadarList] = useState<RadarFrameList | null>(null);
  const [radarFresh, setRadarFresh] = useState<LayerFreshness | null>(null);
  const [radarFailure, setRadarFailure] = useState(false);
  const [radarTimeline, setRadarTimeline] = useState<RadarTimelineState | null>(null);
  // The previous list, so a refresh keeps the rider on the frame they were
  // looking at instead of silently moving them to a different time.
  const radarShownFrames = useRef<readonly RadarFrame[]>([]);
  const radarReadable = source?.radarFrames !== undefined;

  useEffect(() => {
    if (source === undefined || source.radarFrames === undefined) return;
    const readFrames = source.radarFrames.bind(source);
    const controller = new AbortController();
    const forget = (): void => {
      radarShownFrames.current = [];
      setRadarList(null);
      setRadarFresh(null);
      setRadarFailure(false);
      setRadarTimeline(null);
    };
    // Switched off: forget the frames, so switching on again starts at "now".
    if (!radarOn) {
      forget();
      return;
    }
    const read = (): void => {
      void readFrames(controller.signal).then(
        (list) => {
          if (controller.signal.aborted) return;
          if (list === null || list.frames.length === 0) {
            setRadarList(null);
            setRadarFresh(null);
            setRadarFailure(true);
            return;
          }
          setRadarFailure(false);
          const previous = radarShownFrames.current;
          radarShownFrames.current = list.frames;
          setRadarList(list);
          setRadarFresh(radarFreshness(list, Date.now()));
          setRadarTimeline((current) => {
            if (current === null) return current;
            const shown = previous[current.index];
            const sameTime = shown === undefined ? -1 : list.frames.findIndex((frame) => frame.time === shown.time);
            return {
              index: sameTime >= 0 ? sameTime : Math.min(current.index, list.frames.length - 1),
              playing: current.playing,
            };
          });
        },
        () => {
          if (controller.signal.aborted) return;
          setRadarList(null);
          setRadarFresh(null);
          setRadarFailure(true);
        },
      );
    };
    read();
    const timer = setInterval(read, RADAR_LIST_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [radarOn, source]);

  // A fresh list starts the timeline at the frame that reads as "now". Reduced
  // motion starts it paused: an animation nobody asked for is what that setting
  // asks us not to run.
  useEffect(() => {
    if (radarList === null) return;
    const reference = Date.parse(radarList.generatedAt);
    const start = (): void => {
      setRadarTimeline((current) => current ?? initialRadarTimeline(radarList.frames, reference, reducedMotion));
    };
    start();
  }, [radarList, reducedMotion]);

  const radarPlaying = radarTimeline?.playing === true;
  const radarFrameCount = radarList?.frames.length ?? 0;
  useEffect(() => {
    if (!radarPlaying || reducedMotion || radarFrameCount < 2) return;
    const timer = setInterval(() => {
      setRadarTimeline((current) => (current === null ? current : advanceRadarTimeline(current, radarFrameCount)));
    }, RADAR_FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [radarFrameCount, radarPlaying, reducedMotion]);

  // Reduced motion can arrive mid-loop (the OS setting changes): stop, keep the frame.
  useEffect(() => {
    if (!reducedMotion) return;
    const stop = (): void => {
      setRadarTimeline((current) => (current === null || !current.playing ? current : setRadarPlaying(current, false, 0)));
    };
    stop();
  }, [reducedMotion]);

  const scrubRadar = useCallback((index: number): void => {
    setRadarTimeline((current) => {
      const count = radarList?.frames.length ?? 0;
      if (current === null || count === 0) return current;
      return scrubRadarTimeline(index, count);
    });
  }, [radarList]);

  const toggleRadarPlay = useCallback((): void => {
    setRadarTimeline((current) => {
      const count = radarList?.frames.length ?? 0;
      if (current === null || count === 0) return current;
      return setRadarPlaying(current, !current.playing, count);
    });
  }, [radarList]);

  const radarReferenceMs = radarList === null ? 0 : Date.parse(radarList.generatedAt);
  const radarIndex = radarList === null
    ? 0
    : Math.min(radarTimeline?.index ?? latestFrameIndex(radarList.frames, radarReferenceMs), Math.max(0, radarFrameCount - 1));
  const radarFrame = radarList === null ? null : radarList.frames[radarIndex] ?? null;
  const radarTiles = radarOn && radarList !== null && radarFrame !== null
    ? radarTileTemplate(radarList.host, radarFrame.path)
    : null;
  const radarUnavailable = !radarReadable || radarFailure;
  const radarView = useMemo<RadarView | null>(() => {
    if (!radarOn) return null;
    const frames = radarList?.frames ?? [];
    const frame = frames[radarIndex] ?? null;
    return {
      frames,
      index: radarIndex,
      playing: radarPlaying && !reducedMotion,
      label: frame === null ? "" : radarFrameLabel(frame, radarReferenceMs),
      unavailable: radarUnavailable,
      loading: !radarUnavailable && radarList === null,
      scrub: scrubRadar,
      togglePlay: toggleRadarPlay,
    };
  }, [
    radarOn, radarList, radarIndex, radarPlaying, reducedMotion, radarReferenceMs,
    radarUnavailable, scrubRadar, toggleRadarPlay,
  ]);

  const cameraRouteAvailable = cameraRoute !== null && cameraRoute.length >= 2;
  const toggleCameraRouteOnly = useCallback((): void => {
    setCameraRouteOnlyNow(!cameraRouteOnlyNow());
  }, []);

  const toggle = useCallback((id: MapLayerId): void => {
    const current = enabledNow();
    setEnabledNow(current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  }, []);

  const toggleSet = useCallback((ids: readonly MapLayerId[]): void => {
    const current = enabledNow();
    const allOn = ids.every((id) => current.includes(id));
    setEnabledNow(allOn ? current.filter((entry) => !ids.includes(entry)) : [...current, ...ids.filter((id) => !current.includes(id))]);
  }, []);

  const clearAll = useCallback((): void => {
    setEnabledNow([]);
    setSelectedId(null);
  }, []);

  const onViewport = useCallback((next: MapExtent): void => setExtent(next), []);

  const zoom = extent === null || typeof window === "undefined" ? 0 : zoomOf(extent, window.innerWidth);
  const loadable = useMemo(
    () => (source === undefined ? [] : featureLayerIds(enabled).filter((id) => zoom >= mapLayer(id).minZoom)),
    [enabled, source, zoom],
  );
  const loadKey = extent === null ? "" : `${refresh}|${loadable.join(",")}|${[extent.minLon, extent.minLat, extent.maxLon, extent.maxLat].map((value) => value.toFixed(3)).join(",")}`;

  useEffect(() => {
    if (source === undefined || extent === null || loadable.length === 0) return;
    const controller = new AbortController();
    const key = loadKey;
    const timer = setTimeout(() => {
      const bounds = clampLayerBounds({
        west: extent.minLon,
        south: extent.minLat,
        east: extent.maxLon,
        north: extent.maxLat,
      });
      void source.load(bounds, loadable, controller.signal).then(
        (answer) => {
          if (controller.signal.aborted) return;
          setResult({ key, rasters: answer.rasters ?? [], freshness: answer.freshness ?? [], features: answer.features, unavailable: new Set(answer.unavailable) });
        },
        () => {
          // ML-02: a request that failed outright is every asked-for provider
          // being unavailable; the row says so instead of looking switched on.
          if (controller.signal.aborted) return;
          const providers = loadable
            .map((id) => LAYER_PROVIDER[id])
            .filter((provider): provider is InfoProvider => provider !== undefined);
          setResult({ key, rasters: [], freshness: [], features: [], unavailable: new Set(providers) });
        },
      );
    }, LOAD_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `loadKey` carries the extent and the loadable layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey, source]);

  // The last answer stays on screen while the next view loads, trimmed to the
  // layers that are still on and loadable.
  const rawFeatures = useMemo(
    () => (result === null ? [] : result.features.filter((feature) => loadable.includes(feature.layerId))),
    [loadable, result],
  );
  const features = useMemo(
    () =>
      cameraRouteOnly && cameraRouteAvailable && cameraRoute !== null
        ? filterTrafficCamerasToRoute(rawFeatures, cameraRoute)
        : rawFeatures,
    [cameraRoute, cameraRouteAvailable, cameraRouteOnly, rawFeatures],
  );
  const pending = loadable.length > 0 && result?.key !== loadKey;
  const unavailable = useMemo(() => result?.unavailable ?? new Set<InfoProvider>(), [result]);

  const counts = useMemo(() => {
    const record = emptyRecord(0);
    for (const feature of features) record[feature.layerId] += 1;
    return record;
  }, [features]);

  const status = useMemo(() => {
    const record = emptyRecord<MapLayerStatus>("off");
    for (const id of enabled) {
      const definition = mapLayer(id);
      if (definition.kind === "view") {
        record[id] = drawStatus[id] ?? "loading";
        continue;
      }
      // The rain radar's own frame list decides its row: a layer that could not
      // read frames is unavailable, not a clear map (map-experience wave 3).
      if (id === "weather-radar") {
        record[id] = radarUnavailable
          ? "unavailable"
          : radarList === null
            ? "loading"
            : radarFresh?.stale === true ? "stale" : "ready";
        continue;
      }
      if (definition.kind === "raster") {
        record[id] = zoom >= definition.minZoom || extent === null ? "ready" : "zoom-in";
        continue;
      }
      const provider = LAYER_PROVIDER[id];
      record[id] =
        zoom < definition.minZoom
          ? "zoom-in"
          : pending && loadable.includes(id)
            ? "loading"
            : provider !== undefined && unavailable.has(provider)
              ? "unavailable"
              : result?.freshness.some((entry) => entry.layerId === id && (entry.stale)) ? "stale" : "ready";
    }
    return record;
  }, [drawStatus, enabled, extent, loadable, pending, radarFresh, radarList, radarUnavailable, result, unavailable, zoom]);

  const trafficFlow = enabled.includes("traffic-flow") && source?.trafficTileUrl != null ? source.trafficTileUrl : null;
  const scene = useMemo<InfoLayersScene | undefined>(
    () =>
      enabled.length === 0
        ? undefined
        : { rasters: (result?.rasters ?? []).filter((raster) => enabled.includes(raster.layerId)), features, trafficFlowTiles: trafficFlow, radarTiles, selectedId, visible: enabled.filter((id) => mapLayer(id).kind === "view" || status[id] === "ready" || status[id] === "stale") },
    [enabled, features, radarTiles, result, selectedId, status, trafficFlow],
  );

  const freshness = useMemo(() => {
    const loaded = result?.freshness ?? [];
    return radarOn && radarFresh !== null ? [...loaded, radarFresh] : loaded;
  }, [radarFresh, radarOn, result]);

  const selected = useMemo(
    () => (selectedId === null ? null : features.find((feature) => feature.id === selectedId) ?? null),
    [features, selectedId],
  );

  const interceptIntent = useCallback((intent: MapIntent): MapIntent | null => {
    if (intent.type === "info-feature-click") {
      setSelectedId(intent.featureId);
      return null;
    }
    if (intent.type === "map-click") setSelectedId(null);
    return intent;
  }, []);

  return {
    enabled,
    freshness,
    status,
    radar: radarView,
    counts,
    scene,
    selected,
    cameraRouteOnly,
    cameraRouteAvailable,
    toggleCameraRouteOnly,
    toggle,
    toggleSet,
    clearAll,
    select: setSelectedId,
    onViewport,
    onLayerStatus,
    interceptIntent,
  };
}

/**
 * `prefers-reduced-motion`, live. The OS setting can change while the map is
 * open, and the radar loop must stop the moment it does — that is the setting's
 * whole point — so this subscribes instead of reading once.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
