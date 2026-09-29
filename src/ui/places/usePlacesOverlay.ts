"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { MapExtent } from "@/application/map/build-map-scene";
import type { MapIntent } from "@/application/map/types";
import { projectAlong } from "@/application/map-layers/along";
import type { LngLat } from "@/application/map-layers/types";
import type { Coordinate } from "@/domain/ride/types";
import {
  buildPlaceCard,
  buildPlaceScene,
  createPlacesOverlay,
  placeExtentFromMap,
  type NearbyPlace,
  type PlaceId,
  type PlaceKind,
  type PlaceQuery,
  type PlacesOverlayStatus,
  type PlacesSource,
  type PlaceWindow,
} from "@/application/places";

export interface UsePlacesOverlayOptions {
  readonly source: PlacesSource;
  readonly initialQuery: PlaceQuery;
  readonly storageKey: string;
  readonly enabledByDefault: boolean;
  /**
   * The chosen route: with one, only places within `NEAR_ROUTE_METERS` of it
   * are drawn and counted (UX rework 2, #12), so a planned ride shows the
   * stops worth making instead of every pin in view.
   */
  readonly nearLine?: readonly Coordinate[] | undefined;
}

/** "Near the ride": about a mile either side of the line. */
export const NEAR_ROUTE_METERS = 1_609;

export interface PlacesOverlayView {
  readonly enabled: boolean;
  readonly status: PlacesOverlayStatus;
  readonly reason: string | null;
  readonly attribution: string | null;
  readonly count: number;
  /** `route` when the count and pins are only the places along the chosen ride. */
  readonly scope: "view" | "route";
  readonly scenePlaces: ReturnType<typeof buildPlaceScene> | undefined;
  readonly selectedId: PlaceId | null;
  readonly selectedPlace: NearbyPlace | null;
  readonly selectedCard: ReturnType<typeof buildPlaceCard> | null;
  readonly query: PlaceQuery;
  readonly onViewport: (extent: MapExtent) => void;
  /** `null` consumes a place click; every other intent is passed through. */
  readonly interceptIntent: (next: MapIntent) => MapIntent | null;
  readonly toggle: () => void;
  readonly setWindow: (window: PlaceWindow) => void;
  readonly setKinds: (kinds: readonly PlaceKind[]) => void;
  readonly select: (placeId: PlaceId) => void;
  readonly clear: () => void;
}

function readStoredEnabled(storageKey: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? null : stored === "1";
  } catch {
    return null;
  }
}

function writeStoredEnabled(storageKey: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(storageKey, enabled ? "1" : "0");
  } catch {
    // Device storage is a convenience. Private mode and quota failures do not
    // prevent the rider from using places during this visit.
  }
}

interface EnabledPreferenceStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => boolean;
  readonly getServerSnapshot: () => boolean;
  readonly set: (enabled: boolean) => void;
}

function createEnabledPreferenceStore(storageKey: string, enabledByDefault: boolean): EnabledPreferenceStore {
  let current = enabledByDefault;
  let hydrated = false;
  const listeners = new Set<() => void>();
  const publish = (): void => {
    for (const listener of listeners) listener();
  };
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== storageKey && event.key !== null) return;
    current = event.key === null || event.newValue === null
      ? enabledByDefault
      : event.newValue === "1";
    hydrated = true;
    publish();
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!hydrated) {
        hydrated = true;
        current = readStoredEnabled(storageKey) ?? current;
        // The hydration read is an external-store update after the server and
        // client have both rendered the same default snapshot.
        listener();
      }
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot: () => current,
    getServerSnapshot: () => enabledByDefault,
    set(enabled) {
      current = enabled;
      hydrated = true;
      writeStoredEnabled(storageKey, enabled);
      publish();
    },
  };
}

export function usePlacesOverlay({
  source,
  initialQuery,
  storageKey,
  enabledByDefault,
  nearLine,
}: UsePlacesOverlayOptions): PlacesOverlayView {
  const [overlay] = useState(() => createPlacesOverlay(initialQuery, { source }));
  const preference = useMemo(
    () => createEnabledPreferenceStore(storageKey, enabledByDefault),
    [enabledByDefault, storageKey],
  );
  const enabled = useSyncExternalStore(
    preference.subscribe,
    preference.getSnapshot,
    preference.getServerSnapshot,
  );
  const [query, setQueryState] = useState(initialQuery);
  const [selectedId, setSelectedId] = useState<PlaceId | null>(null);
  const lastViewport = useRef<MapExtent | null>(null);
  const subscribe = useCallback((listener: () => void) => overlay.subscribe(() => listener()), [overlay]);
  const getSnapshot = useCallback(() => overlay.getState(), [overlay]);
  const overlayState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => () => overlay.dispose(), [overlay]);

  useEffect(() => {
    const viewport = lastViewport.current;
    if (enabled && viewport !== null) overlay.viewportChanged(placeExtentFromMap(viewport));
  }, [enabled, overlay]);

  const onViewport = useCallback((extent: MapExtent): void => {
    lastViewport.current = extent;
    if (enabled) overlay.viewportChanged(placeExtentFromMap(extent));
  }, [enabled, overlay]);

  const setWindow = useCallback((window: PlaceWindow): void => {
    const next = { ...query, window };
    setQueryState(next);
    overlay.setQuery(next);
  }, [overlay, query]);

  const setKinds = useCallback((kinds: readonly PlaceKind[]): void => {
    if (kinds.length === 0) return;
    const next = { ...query, kinds: [...kinds] };
    setQueryState(next);
    overlay.setQuery(next);
  }, [overlay, query]);

  const toggle = useCallback((): void => {
    const next = !enabled;
    preference.set(next);
    if (!next) setSelectedId(null);
  }, [enabled, preference]);

  const select = useCallback((placeId: PlaceId): void => setSelectedId(placeId), []);
  const clear = useCallback((): void => setSelectedId(null), []);

  const interceptIntent = useCallback((next: MapIntent): MapIntent | null => {
    if (next.type === "place-click") {
      select(next.placeId);
      return null;
    }
    if (next.type === "map-click" && selectedId !== null) clear();
    return next;
  }, [clear, selectedId, select]);

  const selectedPlace = useMemo(
    () => overlayState.places.find((place) => place.id === selectedId) ?? null,
    [overlayState.places, selectedId],
  );
  const routeLine = useMemo<readonly LngLat[] | null>(
    () => nearLine === undefined || nearLine.length < 2 ? null : nearLine.map((point) => [point.lon, point.lat] as const),
    [nearLine],
  );
  const shownPlaces = useMemo(
    () => routeLine === null
      ? overlayState.places
      : overlayState.places.filter((place) =>
          place.id === selectedId ||
          projectAlong(routeLine, [place.coordinate.lon, place.coordinate.lat]).offMeters <= NEAR_ROUTE_METERS),
    [overlayState.places, routeLine, selectedId],
  );
  const scenePlaces = useMemo(
    () => enabled ? buildPlaceScene(shownPlaces, { selectedId }) : undefined,
    [enabled, shownPlaces, selectedId],
  );

  return {
    enabled,
    status: overlayState.status,
    reason: overlayState.reason,
    attribution: overlayState.attribution,
    count: shownPlaces.length,
    scope: routeLine === null ? "view" : "route",
    scenePlaces,
    selectedId,
    selectedPlace,
    selectedCard: selectedPlace === null ? null : buildPlaceCard(selectedPlace, overlayState.fetchedAt),
    query,
    onViewport,
    interceptIntent,
    toggle,
    setWindow,
    setKinds,
    select,
    clear,
  };
}
