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

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { MapExtent } from "@/application/map/build-map-scene";
import type { InfoLayersScene, MapIntent } from "@/application/map/types";
import {
  MAP_LAYERS,
  clampLayerBounds,
  featureLayerIds,
  isMapLayerId,
  mapLayer,
  type InfoFeature,
  type InfoProvider,
  type MapLayerId,
  type MapLayersSource,
} from "@/application/map-layers";

export type MapLayerStatus = "off" | "zoom-in" | "loading" | "ready" | "unavailable";

export interface MapLayersView {
  readonly enabled: readonly MapLayerId[];
  readonly status: Readonly<Record<MapLayerId, MapLayerStatus>>;
  readonly counts: Readonly<Record<MapLayerId, number>>;
  readonly scene: InfoLayersScene | undefined;
  readonly selected: InfoFeature | null;
  readonly toggle: (id: MapLayerId) => void;
  readonly clearAll: () => void;
  readonly select: (id: string | null) => void;
  readonly onViewport: (extent: MapExtent) => void;
  /** `null` consumes a feature tap; every other intent is passed through. */
  readonly interceptIntent: (intent: MapIntent) => MapIntent | null;
}

const STORAGE_KEY = "ogv.map-layers.v1";
const LOAD_DEBOUNCE_MS = 450;

/** Which provider serves each feature layer, to read `unavailable` per layer. */
const LAYER_PROVIDER: Partial<Record<MapLayerId, InfoProvider>> = {
  "live-traffic": "tomtom",
  weather: "nws",
  closures: "osm",
  "great-roads": "roads",
  gravel: "roads",
  fuel: "tomtom",
  food: "tomtom",
  coffee: "tomtom",
  camping: "tomtom",
  lodging: "tomtom",
  repair: "tomtom",
  viewpoints: "tomtom",
  "public-land": "osm",
  "forest-roads": "osm",
  "cell-towers": "osm",
};

/** The enabled-layer choice as an external store, so SSR and hydration agree. */
const enabledListeners = new Set<() => void>();
let enabledSnapshot: readonly MapLayerId[] | null = null;
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

function readEnabled(): readonly MapLayerId[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is MapLayerId => typeof id === "string" && isMapLayerId(id)) : [];
  } catch {
    return [];
  }
}

function writeEnabled(ids: readonly MapLayerId[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // A per-device convenience: private mode just forgets the choice.
  }
}

/** The web-mercator zoom a view of this width shows, from its longitude span. */
export function zoomOf(extent: MapExtent, widthPx: number): number {
  const span = Math.max(1e-6, extent.maxLon - extent.minLon);
  return Math.log2((360 * Math.max(1, widthPx)) / (512 * span));
}

function emptyRecord<T>(value: T): Record<MapLayerId, T> {
  return Object.fromEntries(MAP_LAYERS.map((layer) => [layer.id, value])) as Record<MapLayerId, T>;
}

export function useMapLayers(source: MapLayersSource | undefined): MapLayersView {
  const enabled = useSyncExternalStore(subscribeEnabled, enabledNow, () => NONE);
  const [extent, setExtent] = useState<MapExtent | null>(null);
  const [result, setResult] = useState<{
    readonly key: string;
    readonly features: readonly InfoFeature[];
    readonly unavailable: ReadonlySet<InfoProvider>;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const toggle = useCallback((id: MapLayerId): void => {
    const current = enabledNow();
    setEnabledNow(current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
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
  const loadKey = extent === null ? "" : `${loadable.join(",")}|${[extent.minLon, extent.minLat, extent.maxLon, extent.maxLat].map((value) => value.toFixed(3)).join(",")}`;

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
          setResult({ key, features: answer.features, unavailable: new Set(answer.unavailable) });
        },
        () => {
          // ML-02: a request that failed outright is every asked-for provider
          // being unavailable; the row says so instead of looking switched on.
          if (controller.signal.aborted) return;
          const providers = loadable
            .map((id) => LAYER_PROVIDER[id])
            .filter((provider): provider is InfoProvider => provider !== undefined);
          setResult({ key, features: [], unavailable: new Set(providers) });
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
  const features = useMemo(
    () => (result === null ? [] : result.features.filter((feature) => loadable.includes(feature.layerId))),
    [loadable, result],
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
        record[id] = "ready";
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
              : "ready";
    }
    return record;
  }, [enabled, extent, loadable, pending, unavailable, zoom]);

  const trafficFlow = enabled.includes("traffic-flow") && source?.trafficTileUrl != null ? source.trafficTileUrl : null;
  const scene = useMemo<InfoLayersScene | undefined>(
    () =>
      enabled.length === 0
        ? undefined
        : { features, trafficFlowTiles: trafficFlow, selectedId, visible: enabled },
    [enabled, features, selectedId, trafficFlow],
  );

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

  return { enabled, status, counts, scene, selected, toggle, clearAll, select: setSelectedId, onViewport, interceptIntent };
}
