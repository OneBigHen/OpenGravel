/**
 * The places port. The application asks "what's in this viewport" or "what's
 * along this line"; an adapter answers from whichever provider it wraps.
 *
 * Two adapters exist: the server-side one that holds the provider key
 * (`src/infrastructure/places/places-api-source.ts`) and the browser one that
 * talks to our own `/api/places` route (`http-places-source.ts`). UI code only
 * ever sees this interface.
 */

import type { Coordinate } from "@/domain/ride/types";

import type { PlaceExtent, PlaceQuery, PlacesResult } from "./types";

export interface PlacesAlongRequest {
  /** The route line in travel order. Adapters may thin it; they never reorder it. */
  readonly line: readonly Coordinate[];
  /** Corridor half-width in miles (0 < buffer ≤ 10). */
  readonly bufferMiles: number;
}

export interface PlacesSource {
  readonly id: string;
  inExtent(extent: PlaceExtent, query: PlaceQuery, signal?: AbortSignal): Promise<PlacesResult>;
  alongRoute(request: PlacesAlongRequest, query: PlaceQuery, signal?: AbortSignal): Promise<PlacesResult>;
}

/** Largest viewport side, in degrees, a single request may cover (provider contract). */
export const MAX_PLACE_EXTENT_DEGREES = 1.5;
/** Points an along-route request may carry after thinning. */
export const MAX_ALONG_POINTS = 400;
