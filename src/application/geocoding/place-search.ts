/**
 * Place search and place naming (MVP parity M1).
 *
 * Two questions a rider asks of a geocoder, behind one port:
 *
 * - **search** — "where is Jim Thorpe?": a typed query becomes a short list of
 *   named places the rider picks from. A pick is authored intent, so it reaches
 *   the RideDocument as one typed `start.set` / `finish.set` carrying the place
 *   label and `search` provenance.
 * - **reverse** — "what is this pin near?": a coordinate becomes a name. That
 *   name is *derived evidence about a coordinate*, not something the rider
 *   authored, so it never becomes a command (OGV-D-260): it is cached here and
 *   projected into the view model beside the point, and a dropped pin still is
 *   what the document says it is.
 *
 * Neither question may block planning. A search that fails says so in one line;
 * a reverse lookup that fails leaves the point reading "Dropped pin".
 *
 * The HTTP client below talks to OpenGravel's own `/api/geocode` routes; which
 * upstream answers them (Photon today) is a server concern the UI never sees.
 */

import type { Coordinate } from "@/domain/ride/types";

/** One named place a geocoder returned. */
export interface PlaceMatch {
  /** Provider-stable identity (e.g. `photon:N123`), for provenance only. */
  readonly id: string;
  /** The line the rider reads and the point keeps: `Jim Thorpe, PA`. */
  readonly label: string;
  /** The primary name alone: `Jim Thorpe`. */
  readonly name: string;
  /** The secondary line under the name: `Carbon County, PA`. May be empty. */
  readonly context: string;
  readonly coordinate: Coordinate;
  /** Which upstream answered (`photon`, `fixture`). */
  readonly provider: string;
}

export type PlaceSearchOutcome =
  | { readonly status: "ok"; readonly places: readonly PlaceMatch[] }
  | { readonly status: "unavailable"; readonly reason: string };

export interface PlaceSearchOptions {
  /** Rank nearby namesakes first (the ride's own points, or the map's region). */
  readonly bias?: Coordinate;
  readonly signal?: AbortSignal;
}

/** The port the planner surface consumes. Implementations never throw. */
export interface PlaceSearchPort {
  search(query: string, options?: PlaceSearchOptions): Promise<PlaceSearchOutcome>;
  /** A name for the coordinate, or `null` when none could be found. */
  reverse(coordinate: Coordinate, options?: { readonly signal?: AbortSignal }): Promise<PlaceMatch | null>;
}

/** Shorter queries are noise: one letter matches half a continent. */
export const PLACE_QUERY_MIN_LENGTH = 2;
/** Longer queries are not a place name; the server rejects them too. */
export const PLACE_QUERY_MAX_LENGTH = 120;

/** The one line a rider reads when search cannot answer. */
export const PLACE_SEARCH_UNAVAILABLE =
  "Place search is unavailable right now. You can still set the point on the map.";

export function isPlaceMatch(value: unknown): value is PlaceMatch {
  if (typeof value !== "object" || value === null) return false;
  const place = value as Partial<PlaceMatch>;
  const coordinate = place.coordinate as Partial<Coordinate> | undefined;
  return (
    typeof place.id === "string" &&
    typeof place.label === "string" &&
    place.label.length > 0 &&
    typeof place.name === "string" &&
    typeof place.context === "string" &&
    typeof place.provider === "string" &&
    typeof coordinate === "object" &&
    coordinate !== null &&
    typeof coordinate.lat === "number" &&
    Number.isFinite(coordinate.lat) &&
    Math.abs(coordinate.lat) <= 90 &&
    typeof coordinate.lon === "number" &&
    Number.isFinite(coordinate.lon) &&
    Math.abs(coordinate.lon) <= 180
  );
}

export interface HttpPlaceSearchOptions {
  readonly fetcher?: typeof fetch;
  /** Defaults to `/api/geocode`; reverse lives at `<path>/reverse`. */
  readonly path?: string;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** The browser client for OpenGravel's own geocode routes. */
export function createHttpPlaceSearch(options: HttpPlaceSearchOptions = {}): PlaceSearchPort {
  const path = options.path ?? "/api/geocode";
  const fetcher = (input: string, init: RequestInit): Promise<Response> =>
    (options.fetcher ?? fetch)(input, init);

  return {
    async search(query, searchOptions = {}): Promise<PlaceSearchOutcome> {
      const trimmed = query.trim();
      if (trimmed.length < PLACE_QUERY_MIN_LENGTH) return { status: "ok", places: [] };
      const params = new URLSearchParams({ q: trimmed.slice(0, PLACE_QUERY_MAX_LENGTH) });
      if (searchOptions.bias !== undefined) {
        params.set("lat", searchOptions.bias.lat.toFixed(4));
        params.set("lon", searchOptions.bias.lon.toFixed(4));
      }
      try {
        const response = await fetcher(`${path}?${params.toString()}`, {
          headers: { accept: "application/json" },
          ...(searchOptions.signal === undefined ? {} : { signal: searchOptions.signal }),
        });
        if (!response.ok) return { status: "unavailable", reason: PLACE_SEARCH_UNAVAILABLE };
        const body = (await response.json()) as { places?: unknown };
        const places = Array.isArray(body.places) ? body.places.filter(isPlaceMatch) : [];
        return { status: "ok", places };
      } catch (error) {
        if (isAbort(error)) throw error;
        return { status: "unavailable", reason: PLACE_SEARCH_UNAVAILABLE };
      }
    },

    async reverse(coordinate, reverseOptions = {}): Promise<PlaceMatch | null> {
      const params = new URLSearchParams({
        lat: coordinate.lat.toFixed(5),
        lon: coordinate.lon.toFixed(5),
      });
      try {
        const response = await fetcher(`${path}/reverse?${params.toString()}`, {
          headers: { accept: "application/json" },
          ...(reverseOptions.signal === undefined ? {} : { signal: reverseOptions.signal }),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { place?: unknown };
        return isPlaceMatch(body.place) ? body.place : null;
      } catch {
        return null;
      }
    },
  };
}
