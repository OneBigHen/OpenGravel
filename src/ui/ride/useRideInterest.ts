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
import { FUEL_LOOK_AHEAD_MILES, type GasAhead } from "@/application/ride-session/fuel-ahead";
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
  /**
   * Gas ahead of the rider along this route, nearest first: the ride sheet's
   * fuel line (OGV#13's own prefetched `fuel` stops, not a second request). It
   * ignores the rider's Scenic / Food / Events filter, because "can I reach the
   * next station?" is not a browse choice.
   */
  readonly fuelAhead: readonly GasAhead[];
  /**
   * How many gas stations the prefetch found along the whole route, behind the
   * rider included. Zero is a provider that did not answer, and the sheet says
   * so instead of reading it as "no gas on this road".
   */
  readonly fuelFound: number;
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
  // Fuel is asked for further ahead than the map's pins: a rider plans a tank,
  // not a glance, and a station 60 miles out still answers the question.
  const fuelPoints = useMemo(
    () => state.points.filter((point) => point.kind === "fuel"),
    [state.points],
  );
  const fuelAhead = useMemo<readonly GasAhead[]>(() => {
    if (position === null) return [];
    return pointsAheadOfRider(fuelPoints, routeLine, position, { maxAheadMiles: FUEL_LOOK_AHEAD_MILES }).map(
      (entry) => ({
        id: entry.point.id,
        name: entry.point.name,
        coordinate: entry.point.coordinate,
        aheadMiles: entry.aheadMiles,
      }),
    );
  }, [fuelPoints, position, routeLine]);
  const fuelFound = fuelPoints.length;
  const selectedPoint = useMemo(
    () => (selectedId === null ? null : state.points.find((point) => point.id === selectedId) ?? null),
    [selectedId, state.points],
  );

  return {
    status: state.status,
    scenePlaces,
    chip,
    fuelAhead,
    fuelFound,
    selectedPoint,
    select: setSelectedId,
    clear: useCallback(() => setSelectedId(null), []),
  };
}
