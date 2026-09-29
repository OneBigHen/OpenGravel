/**
 * Ride-along interest (OGV#13): the map is boring at speed with only the
 * route line and the puck, even though we already have provider data —
 * Wikimedia/Wikidata landmarks (`@/application/discover`), fuel/viewpoints
 * (`@/application/map-layers`), and happy hours/rodeo events
 * (`@/application/places`). This module is the seam that merges those three
 * already-existing along-route answers into one rider-facing vocabulary,
 * without inventing a fourth provider framework.
 *
 * Wikimedia stays discovery-only (OGV-D-278/282): nothing here ever touches
 * route ranking. A point becomes a stop only when the rider taps "Add as
 * stop", through the same reroute-detour command the fuel-ahead list uses.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { DiscoverCategory, InterestingPlace } from "@/application/discover";
import type { MapLayerId } from "@/application/map-layers";
import type { PlaceKind } from "@/application/places";

/** The rider's ride-sheet filter (OGV#13): one bucket at a time, or none. */
export type RideInterestFilter = "scenic" | "food" | "events" | "off";

export const RIDE_INTEREST_FILTERS: readonly RideInterestFilter[] = ["scenic", "food", "events", "off"];

export function isRideInterestFilter(value: unknown): value is RideInterestFilter {
  return value === "scenic" || value === "food" || value === "events" || value === "off";
}

/** What a ride-interest point actually is, across every source it can come from. */
export type RideInterestKind = DiscoverCategory | MapLayerId | PlaceKind;

/**
 * One rider-facing point along the route, normalized from whichever source
 * found it. `id` is source-namespaced (`ri:discover:…`, `ri:layer:fuel:…`,
 * `ri:place:…`) so a tap can be routed back to its source without the UI
 * knowing which provider answered.
 */
export interface RideInterestPoint {
  readonly id: string;
  /** Which sheet filter shows this point; never `"off"`. */
  readonly filter: Exclude<RideInterestFilter, "off">;
  readonly kind: RideInterestKind;
  readonly name: string;
  readonly coordinate: Coordinate;
  /** One or two plain sentences, or `null`. */
  readonly summary: string | null;
  readonly photoUrl: string | null;
  /** Where the rider can read more, or `null`. */
  readonly detailUrl: string | null;
  readonly attribution: string;
}

/** The discover port's along-route answer, as the browser needs it. */
export interface RideInterestDiscoverAnswer {
  readonly available: boolean;
  readonly places: readonly InterestingPlace[];
}

/**
 * The browser's view of `/api/discover`'s corridor query (POST). Mirrors
 * `PlacesSource.alongRoute` and `MapLayersSource.along`: one bounded call per
 * route, never one per viewport pan.
 */
export interface RideInterestDiscoverSource {
  alongRoute(
    line: readonly Coordinate[],
    bufferMeters: number,
    signal?: AbortSignal,
  ): Promise<RideInterestDiscoverAnswer>;
}
