/**
 * The discovery source port. Adapters live in `src/infrastructure/discover`
 * and run server-side; the browser talks only to `/api/discover`.
 */

import type { DiscoverSearchArea, InterestingPlace } from "./types";

export interface InterestingPlaceAnswer {
  readonly status: "ok" | "stale" | "unavailable";
  readonly reason: string | null;
  readonly places: readonly InterestingPlace[];
}

export interface InterestingPlaceSource {
  readonly id: string;
  readonly label: string;
  /** Never throws: an outage is `unavailable` with a reason. */
  search(area: DiscoverSearchArea, signal: AbortSignal): Promise<InterestingPlaceAnswer>;
}

/**
 * Adds what another source lacks (an image, a summary, what the place is) to
 * places that already exist. Never adds or removes a place; bounded by
 * `budgetMs`, and on any failure returns the places unchanged.
 */
export interface PlaceEnricher {
  readonly id: string;
  enrich(places: readonly InterestingPlace[], signal: AbortSignal, budgetMs: number): Promise<readonly InterestingPlace[]>;
}
