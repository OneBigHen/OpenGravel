/**
 * The ride-interest overlay controller (OGV#13): prefetches Wikimedia/OSM
 * landmarks, fuel and viewpoints, and Places/rodeo events along the route
 * **once**, when the route changes — never per pan, never per frame. A later
 * `routeChanged` for the same route is a no-op, so remounts and store
 * refreshes cannot repeat the same network calls.
 *
 * Framework-free like `places-overlay.ts`: no React, no timers of its own.
 * A source that fails or is not wired in just contributes nothing — an
 * outage here never blocks the other two, and never surfaces as a ride
 * error (OGV#13: "offline, use what's cached, degrade silently").
 */

import { METERS_PER_MILE } from "@/application/map-layers/along";
import type { MapLayerId, MapLayersSource } from "@/application/map-layers";
import { DEFAULT_PLACE_QUERY, type PlacesSource } from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";

import { alongStopsToRideInterest, discoverPlacesToRideInterest, nearbyPlacesToRideInterest } from "./normalize";
import type { RideInterestDiscoverSource, RideInterestPoint } from "./types";

export type RideInterestStatus = "idle" | "loading" | "ready" | "unavailable";

export interface RideInterestState {
  readonly status: RideInterestStatus;
  /** Every prefetched point for the current route; filtering happens on read. */
  readonly points: readonly RideInterestPoint[];
  readonly attribution: readonly string[];
}

export interface RideInterestOverlayDeps {
  readonly discoverSource?: RideInterestDiscoverSource;
  readonly mapLayersSource?: MapLayersSource;
  readonly placesSource?: PlacesSource;
  /** Corridor half-width every source is asked for (owner's proposal: 1–2 mi). */
  readonly bufferMeters?: number;
}

export interface RideInterestOverlay {
  /** Prefetches once per distinct `routeKey`; `null` clears to idle. */
  routeChanged(routeKey: string | null, line: readonly Coordinate[]): void;
  getState(): RideInterestState;
  subscribe(listener: (state: RideInterestState) => void): () => void;
  dispose(): void;
}

const IDLE: RideInterestState = { status: "idle", points: [], attribution: [] };
/** The OSM layers worth one along-route call each: fuel (Food & fuel), viewpoints (Scenic). */
const ALONG_LAYERS: readonly MapLayerId[] = ["fuel", "viewpoints"];
const DEFAULT_BUFFER_METERS = 1.5 * METERS_PER_MILE;

export function createRideInterestOverlay(deps: RideInterestOverlayDeps): RideInterestOverlay {
  const bufferMeters = deps.bufferMeters ?? DEFAULT_BUFFER_METERS;
  const listeners = new Set<(state: RideInterestState) => void>();
  let state: RideInterestState = IDLE;
  let currentKey: string | null = null;
  let inFlight: AbortController | null = null;
  let generation = 0;
  let disposed = false;

  function publish(next: RideInterestState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  async function fromDiscover(line: readonly Coordinate[], signal: AbortSignal): Promise<{ readonly points: readonly RideInterestPoint[]; readonly attribution: string | null }> {
    if (deps.discoverSource === undefined) return { points: [], attribution: null };
    try {
      const answer = await deps.discoverSource.alongRoute(line, bufferMeters, signal);
      if (!answer.available || answer.places.length === 0) return { points: [], attribution: null };
      return { points: discoverPlacesToRideInterest(answer.places), attribution: "Wikimedia" };
    } catch {
      return { points: [], attribution: null };
    }
  }

  async function fromMapLayers(line: readonly Coordinate[], signal: AbortSignal): Promise<{ readonly points: readonly RideInterestPoint[]; readonly attribution: string | null }> {
    const along = deps.mapLayersSource?.along;
    if (along === undefined) return { points: [], attribution: null };
    const lngLat = line.map((point) => [point.lon, point.lat] as const);
    const answers = await Promise.all(
      ALONG_LAYERS.map(async (layerId) => {
        try {
          const result = await along(lngLat, layerId, signal);
          return result.available ? alongStopsToRideInterest(result.stops, layerId) : [];
        } catch {
          return [];
        }
      }),
    );
    const points = answers.flat();
    return { points, attribution: points.length === 0 ? null : "OpenStreetMap" };
  }

  async function fromPlaces(line: readonly Coordinate[], signal: AbortSignal): Promise<{ readonly points: readonly RideInterestPoint[]; readonly attribution: string | null }> {
    if (deps.placesSource === undefined) return { points: [], attribution: null };
    try {
      const result = await deps.placesSource.alongRoute(
        { line, bufferMiles: bufferMeters / METERS_PER_MILE },
        DEFAULT_PLACE_QUERY,
        signal,
      );
      if (result.availability !== "available" || result.places.length === 0) return { points: [], attribution: null };
      return { points: nearbyPlacesToRideInterest(result.places), attribution: result.attribution };
    } catch {
      return { points: [], attribution: null };
    }
  }

  async function load(routeKey: string, line: readonly Coordinate[]): Promise<void> {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const mine = ++generation;
    publish({ ...state, status: "loading" });
    const [discover, layers, places] = await Promise.all([
      fromDiscover(line, controller.signal),
      fromMapLayers(line, controller.signal),
      fromPlaces(line, controller.signal),
    ]);
    if (disposed || mine !== generation || currentKey !== routeKey) return;
    inFlight = null;
    const points = [...discover.points, ...layers.points, ...places.points];
    const attribution = [discover.attribution, layers.attribution, places.attribution].filter(
      (value): value is string => value !== null,
    );
    publish({ status: points.length === 0 ? "unavailable" : "ready", points, attribution });
  }

  return {
    routeChanged(routeKey, line) {
      if (routeKey === currentKey) return;
      currentKey = routeKey;
      inFlight?.abort();
      inFlight = null;
      if (routeKey === null || line.length < 2) {
        publish(IDLE);
        return;
      }
      void load(routeKey, line);
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      inFlight?.abort();
      listeners.clear();
    },
  };
}
