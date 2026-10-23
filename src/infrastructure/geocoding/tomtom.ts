/**
 * TomTom place search adapter.
 *
 * Riders search the way they search in a maps app: a brand and a town ("Wawa
 * Jim Thorpe"), a category around a town ("gas near Lehighton"), or the first
 * words of a place name ("Blue Mountain Ski"). Photon only knows places and
 * addresses, so those POI questions are answered here from TomTom Search's
 * nearby/fuzzy endpoints, the same API the map's stop layers already use.
 *
 * Three limits keep this an *optional* provider:
 *
 * - the key is read on the server and never appears in a response;
 * - one request gets at most {@link TOMTOM_PLACE_TIMEOUT_MS}, so place search
 *   stays fast and an absent answer is just an absent answer;
 * - every failure throws, and the caller catches it. Photon's places and
 *   addresses still answer on their own.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import { usStateCode } from "@/application/geocoding/us-states";

export const TOMTOM_SEARCH_BASE_URL = "https://api.tomtom.com/search/2";

/** A place search must not wait on a provider; past this the POI answers are dropped. */
export const TOMTOM_PLACE_TIMEOUT_MS = 1_800;

/** How far around the centre a POI answer may come from. */
export const TOMTOM_PLACE_RADIUS_METERS = 30_000;

export const TOMTOM_PLACE_LIMIT = 6;

export interface TomTomPlaceRequest {
  /** What to look for; omitted when the request is category-only. */
  readonly query?: string;
  /** TomTom category id, used when the term is a category with a stable id. */
  readonly categoryId?: string;
  /** The coordinate the answer is ranked around (the town, or the rider's ride). */
  readonly center: Coordinate;
  readonly radiusMeters?: number;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface TomTomPlaceSearch {
  search(request: TomTomPlaceRequest): Promise<PlaceMatch[]>;
}

export interface TomTomPlaceOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

interface TomTomAddress {
  readonly streetNumber?: unknown;
  readonly streetName?: unknown;
  readonly municipality?: unknown;
  readonly localName?: unknown;
  readonly countrySubdivision?: unknown;
  readonly country?: unknown;
  readonly countryCode?: unknown;
  readonly freeformAddress?: unknown;
}

interface TomTomResult {
  readonly id?: unknown;
  readonly score?: unknown;
  readonly poi?: { readonly name?: unknown; readonly brands?: readonly { readonly name?: unknown }[] };
  readonly address?: TomTomAddress;
  readonly position?: { readonly lat?: unknown; readonly lon?: unknown };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unique(parts: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const trimmed = part?.trim();
    if (trimmed === undefined || trimmed === "" || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    kept.push(trimmed);
  }
  return kept;
}

/** "1.2 mi": the same words the stop layers use for distance. */
function distanceWords(meters: number): string {
  const value = meters / 1609.344;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} mi`;
}

function regionLabel(address: TomTomAddress, isUs: boolean): string {
  const state = text(address.countrySubdivision) ?? "";
  if (isUs) return usStateCode(state);
  const country = text(address.country);
  return unique([state, country]).join(", ");
}

function coordinateOf(result: TomTomResult): Coordinate | null {
  const lat = finite(result.position?.lat);
  const lon = finite(result.position?.lon);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * One TomTom result as a `PlaceMatch`. A POI keeps its own name; an address
 * result (a fuzzy query can answer with one) keeps its street.
 */
export function placeFromTomTomResult(
  result: TomTomResult,
  center: Coordinate,
  index: number,
): PlaceMatch | null {
  const coordinate = coordinateOf(result);
  if (coordinate === null) return null;
  const address = result.address ?? {};
  const street = unique([
    [text(address.streetNumber), text(address.streetName)].filter((part) => part !== null).join(" "),
  ])[0] ?? null;
  const name = text(result.poi?.name) ?? street ?? text(address.freeformAddress);
  if (name === null) return null;
  const brand = (result.poi?.brands ?? [])
    .map((entry) => text(entry.name))
    .find((value) => value !== null) ?? null;
  const countryCode = text(address.countryCode)?.toUpperCase() ?? "";
  const isUs = countryCode === "US";
  const locality = text(address.municipality) ?? text(address.localName);
  const region = regionLabel(address, isUs);
  const label = unique([name, locality, region]).join(", ");
  const distance = distanceWords(haversine(center, coordinate));
  const context = unique([
    brand === null || brand.toLowerCase() === name.toLowerCase() ? null : brand,
    street === null || street.toLowerCase() === name.toLowerCase() ? null : street,
    distance,
  ]).join(" · ");
  const id = text(result.id) ?? `${coordinate.lat.toFixed(5)},${coordinate.lon.toFixed(5)}`;
  return {
    id: `tomtom:${id || index}`,
    label,
    name,
    context,
    coordinate,
    provider: "tomtom",
  };
}

/** TomTom answers `{ results: [...] }`; a different shape is not an empty answer. */
export function parseTomTomPlaces(payload: unknown, center: Coordinate): PlaceMatch[] {
  const results = record(payload)?.["results"];
  if (!Array.isArray(results)) throw new Error("TomTom search answered without results");
  return results.flatMap((entry, index): PlaceMatch[] => {
    const result = record(entry);
    if (result === null) return [];
    const place = placeFromTomTomResult(result, center, index);
    return place === null ? [] : [place];
  });
}

function searchUrl(baseUrl: string, request: TomTomPlaceRequest, radiusMeters: number, limit: number): URL {
  const categoryId = request.categoryId;
  const query = request.query?.trim() ?? "";
  const url = categoryId !== undefined
    ? new URL(`${baseUrl}/nearbySearch/.json`)
    : new URL(`${baseUrl}/fuzzySearch/${encodeURIComponent(query)}.json`);
  url.searchParams.set("lat", request.center.lat.toFixed(5));
  url.searchParams.set("lon", request.center.lon.toFixed(5));
  url.searchParams.set("radius", String(Math.round(radiusMeters)));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("language", "en-US");
  if (categoryId !== undefined) {
    url.searchParams.set("categorySet", categoryId);
  } else {
    // Business answers only: address questions are Photon's, and the rider's
    // next search is what asks them.
    url.searchParams.set("idxSet", "POI");
    url.searchParams.set("typeahead", "false");
  }
  return url;
}

function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export function createTomTomPlaceSearch(options: TomTomPlaceOptions): TomTomPlaceSearch {
  const baseUrl = (options.baseUrl ?? TOMTOM_SEARCH_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? TOMTOM_PLACE_TIMEOUT_MS;
  const fetcher = options.fetcher ?? fetch;

  return {
    async search(request) {
      const query = request.query?.trim() ?? "";
      if (request.categoryId === undefined && query === "") return [];
      const url = searchUrl(
        baseUrl,
        { ...request, query },
        request.radiusMeters ?? TOMTOM_PLACE_RADIUS_METERS,
        Math.max(1, Math.min(request.limit ?? TOMTOM_PLACE_LIMIT, 10)),
      );
      url.searchParams.set("key", options.apiKey);
      let response: Response;
      try {
        response = await fetcher(url, { signal: withDeadline(request.signal, timeoutMs) });
      } catch {
        throw new Error("TomTom place search unreachable");
      }
      if (!response.ok) throw new Error(`TomTom place search ${response.status}`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error("TomTom place search answered unreadable JSON");
      }
      return parseTomTomPlaces(body, request.center);
    },
  };
}
