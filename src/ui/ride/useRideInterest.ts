"use client";

/**
 * The ride surface's view of "ride-along interest" (OGV#13): wires the
 * framework-free `RideInterestOverlay` controller into React, recomputes
 * what's ahead on every position tick (pure, no network), and tracks which
 * pin the rider tapped.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  buildRideInterestScene,
  comingUpChip,
  createRideInterestOverlay,
  pointsAheadOfRider,
  rideMapInterestPoints,
  visibleRideInterestPoints,
  type RideInterestChip,
  type RideInterestDiscoverSource,
  type RideInterestFilter,
  type RideInterestPoint,
  type RideInterestStatus,
} from "@/application/ride-interest";
import type { MapLayersSource } from "@/application/map-layers";
import type { PlaceScene, PlacesSource } from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";

export interface UseRideInterestOptions {
  readonly discoverSource?: RideInterestDiscoverSource | undefined;
  readonly mapLayersSource?: MapLayersSource | undefined;
  readonly placesSource?: PlacesSource | undefined;
  readonly filter: RideInterestFilter;
  /** A stable id for the current guided route; `null` outside a guided ride. */
  readonly routeKey: string | null;
  readonly routeLine: readonly Coordinate[];
  readonly position: Coordinate | null;
}

export interface RideInterestView {
  readonly status: RideInterestStatus;
  /** Gas, and the opened point, as map pins (see `rideMapInterestPoints`). */
  readonly scenePlaces: readonly PlaceScene[];
  readonly chip: RideInterestChip | null;
  readonly selectedPoint: RideInterestPoint | null;
  readonly select: (id: string) => void;
  readonly clear: () => void;
}

export function useRideInterest({
  discoverSource,
  mapLayersSource,
  placesSource,
  filter,
  routeKey,
  routeLine,
  position,
}: UseRideInterestOptions): RideInterestView {
  const [overlay] = useState(() => createRideInterestOverlay({ discoverSource, mapLayersSource, placesSource }));
  useEffect(() => () => overlay.dispose(), [overlay]);

  const subscribe = useCallback((listener: () => void) => overlay.subscribe(() => listener()), [overlay]);
  const getSnapshot = useCallback(() => overlay.getState(), [overlay]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    overlay.routeChanged(routeKey, routeLine);
  }, [overlay, routeKey, routeLine]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A new route retires any card the rider had open on the old one's point.
  // Adjusted during render (React's own pattern for this), not in an effect:
  // an effect here would paint the stale card for one frame before clearing it.
  const [selectedRouteKey, setSelectedRouteKey] = useState(routeKey);
  if (routeKey !== selectedRouteKey) {
    setSelectedRouteKey(routeKey);
    setSelectedId(null);
  }

  const visible = useMemo(
    () => visibleRideInterestPoints(state.points, filter),
    [state.points, filter],
  );
  const ahead = useMemo(
    () => (position === null ? [] : pointsAheadOfRider(visible, routeLine, position)),
    [visible, routeLine, position],
  );
  const chip = useMemo(() => comingUpChip(ahead), [ahead]);
  // The map draws gas and the pin the rider opened; the sheet's filter and
  // "coming up" row stay the way to browse landmarks (`rideMapInterestPoints`).
  const mapPoints = useMemo(
    () => rideMapInterestPoints(state.points, { selectedId, filter }),
    [filter, selectedId, state.points],
  );
  const mapAhead = useMemo(
    () => (position === null ? [] : pointsAheadOfRider(mapPoints, routeLine, position)),
    [mapPoints, routeLine, position],
  );
  const scenePlaces = useMemo(() => buildRideInterestScene(mapAhead, { selectedId }), [mapAhead, selectedId]);
  const selectedPoint = useMemo(
    () => (selectedId === null ? null : state.points.find((point) => point.id === selectedId) ?? null),
    [selectedId, state.points],
  );

  return {
    status: state.status,
    scenePlaces,
    chip,
    selectedPoint,
    select: setSelectedId,
    clear: useCallback(() => setSelectedId(null), []),
  };
}
