/**
 * Browser-side `RideInterestDiscoverSource`: the ride's own client for
 * `/api/discover`'s corridor query (POST), which holds the Wikimedia user
 * agent and the OSM places index server-side. Mirrors `http-places-source.ts`
 * and `http-map-layers-source.ts`: the response is already shaped, so this
 * adapter only checks it and turns transport failures into "unavailable"
 * rather than throwing into the ride (OGV#13: degrade silently, offline or
 * not).
 */

import type { RideInterestDiscoverAnswer, RideInterestDiscoverSource } from "@/application/ride-interest";
import type { InterestingPlace } from "@/application/discover";
import type { Coordinate } from "@/domain/ride/types";

export interface HttpDiscoverSourceOptions {
  /** Deployment prefix (`asset-base-path`), e.g. `/ogv`. Empty at the origin root. */
  readonly basePath?: string;
  readonly fetch?: typeof fetch;
}

const UNAVAILABLE: RideInterestDiscoverAnswer = { available: false, places: [] };

function isPlacesArray(value: unknown): value is readonly InterestingPlace[] {
  return Array.isArray(value) && value.every((entry) =>
    typeof entry === "object" && entry !== null &&
    typeof (entry as { id?: unknown }).id === "string" &&
    typeof (entry as { name?: unknown }).name === "string" &&
    typeof (entry as { coordinate?: unknown }).coordinate === "object");
}

export function createHttpDiscoverSource(options: HttpDiscoverSourceOptions = {}): RideInterestDiscoverSource {
  const base = (options.basePath ?? "").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  return {
    async alongRoute(line: readonly Coordinate[], bufferMeters: number, signal?: AbortSignal): Promise<RideInterestDiscoverAnswer> {
      let response: Response;
      try {
        response = await doFetch(`${base}/api/discover`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            line: line.map((point) => [point.lon, point.lat]),
            bufferMeters,
          }),
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (signal?.aborted === true) throw error;
        return UNAVAILABLE;
      }
      if (!response.ok) return UNAVAILABLE;
      try {
        const body: unknown = await response.json();
        const places = typeof body === "object" && body !== null ? (body as { places?: unknown }).places : undefined;
        return isPlacesArray(places) ? { available: true, places } : UNAVAILABLE;
      } catch {
        return UNAVAILABLE;
      }
    },
  };
}
