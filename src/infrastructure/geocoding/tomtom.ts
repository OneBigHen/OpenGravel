/**
 * TomTom Search adapters: the deployment's fallback geocoder and the POI /
 * brand / category search behind place search.
 *
 * Two questions share the same upstream:
 *
 * - **places and addresses** — Photon answers first and TomTom answers whenever
 *   Photon cannot (see {@link withFallback}). The public Photon refused every
 *   connection on 2026-10-23 and search went dark, and the deployment already
 *   holds a TomTom key for map layers. Results come back as the same
 *   `PlaceMatch` shape, so the route and the UI never know which upstream
 *   answered.
 * - **businesses** — riders search the way they search in a maps app: a brand
 *   and a town ("Wawa Jim Thorpe"), a category around a town ("gas near
 *   Lehighton"), or the first words of a place name ("Blue Mountain Ski").
 *   Photon only knows places and addresses, so those POI questions are answered
 *   here from TomTom Search's nearby/fuzzy endpoints, the same API the map's
 *   stop layers already use.
 *
 * Three limits keep this an *optional* provider:
 *
 * - the key is read on the server and never appears in a response;
 * - one request gets at most its own timeout — {@link TOMTOM_GEOCODE_TIMEOUT_MS}
 *   for the fallback, {@link TOMTOM_PLACE_TIMEOUT_MS} for POI answers — so place
 *   search stays fast and an absent answer is just an absent answer;
 * - the fallback reports an outage as {@link GeocoderUnavailableError}; POI
 *   search throws and its caller catches it. Photon's places and addresses
 *   still answer on their own.
 */

import type { PlaceMatch } from "@/application/geocoding/place-search";
import { usStateCode } from "@/application/geocoding/us-states";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import { GeocoderUnavailableError, type PhotonGeocoder } from "./photon";

export const TOMTOM_SEARCH_BASE_URL = "https://api.tomtom.com/search/2";

/** A place search must not wait on a provider; past this the POI answers are dropped. */
export const TOMTOM_PLACE_TIMEOUT_MS = 1_800;

/** How far around the centre a POI answer may come from. */
export const TOMTOM_PLACE_RADIUS_METERS = 30_000;

export const TOMTOM_PLACE_LIMIT = 6;

/** The fallback geocoder answers a page once; it may take a little longer. */
export const TOMTOM_GEOCODE_TIMEOUT_MS = 4_000;

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

export interface TomTomGeocoderOptions {
  readonly apiKey: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

interface TomTomAddress {
  readonly streetNumber?: unknown;
  readonly streetName?: unknown;
  readonly streetNameAndNumber?: unknown;
  readonly municipality?: unknown;
  readonly municipalitySubdivision?: unknown;
  readonly localName?: unknown;
  readonly countrySecondarySubdivision?: unknown;
  readonly countrySubdivision?: unknown;
  readonly countrySubdivisionCode?: unknown;
  readonly country?: unknown;
  readonly countryCode?: unknown;
  readonly freeformAddress?: unknown;
}

interface TomTomResult {
  readonly id?: unknown;
  readonly type?: unknown;
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

/** Ordered words for a label, empty parts dropped and repeats kept. */
function join(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part.trim() !== "").join(", ");
}

/** "1.2 mi": the same words the stop layers use for distance. */
function distanceWords(meters: number): string {
  const value = meters / 1609.344;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} mi`;
}

/**
 * "PA" for US and Canadian results, the country name elsewhere. The code is
 * preferred when TomTom sends one; a state name becomes its code.
 */
function regionLabel(address: TomTomAddress, countryCode: string): string {
  const code = countryCode.toUpperCase();
  const subdivision = text(address.countrySubdivisionCode) ?? text(address.countrySubdivision) ?? "";
  if (code === "US" || code === "CA") return usStateCode(subdivision);
  return unique([subdivision, text(address.country)]).join(", ");
}

function coordinateOf(result: TomTomResult): Coordinate | null {
  const lat = finite(result.position?.lat);
  const lon = finite(result.position?.lon);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function deadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

/**
 * One TomTom POI result as a `PlaceMatch`. A POI keeps its own name; an address
 * result (a fuzzy query can answer with one) keeps its street. The distance is
 * measured from the search centre.
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
  const countryCode = text(address.countryCode) ?? "";
  const locality = text(address.municipality) ?? text(address.localName);
  const region = regionLabel(address, countryCode);
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

/**
 * One TomTom search or reverse-geocode result as a `PlaceMatch`. The place
 * keeps its own name ("30 River Street" when the answer is an address), the
 * label names the town and region beneath it.
 */
export function placeFromTomTom(result: TomTomResult, index: number): PlaceMatch | null {
  const coordinate = coordinateOf(result);
  if (coordinate === null) return null;
  const address = result.address ?? {};
  const town =
    text(address.municipality) ??
    text(address.municipalitySubdivision) ??
    text(address.countrySecondarySubdivision);
  const region = regionLabel(address, text(address.countryCode) ?? "");
  const where = join([town, region]);
  const name =
    text(result.poi?.name) ??
    text(address.streetNameAndNumber) ??
    text(address.streetName) ??
    town ??
    text(address.freeformAddress);
  if (name === null || name.trim() === "") return null;
  const context = name === town ? region : where;
  return {
    id: `tomtom:${String(result.id ?? index)}`,
    label: join([name, context]),
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
    : // `/search/{query}` is TomTom's fuzzy search; a `/fuzzySearch/` path answers
      // 200 with no results at all, which is how brand searches came back empty.
      new URL(`${baseUrl}/search/${encodeURIComponent(query)}.json`);
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
        response = await fetcher(url, { signal: deadline(request.signal, timeoutMs) });
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

export function createTomTomGeocoder(options: TomTomGeocoderOptions): PhotonGeocoder {
  const timeoutMs = options.timeoutMs ?? TOMTOM_GEOCODE_TIMEOUT_MS;

  async function get(url: URL, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
    url.searchParams.set("key", options.apiKey);
    url.searchParams.set("language", "en-US");
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: deadline(signal, timeoutMs),
      });
    } catch {
      throw new GeocoderUnavailableError(503);
    }
    if (!response.ok) throw new GeocoderUnavailableError(response.status >= 500 ? 502 : 503);
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new GeocoderUnavailableError(502);
    }
  }

  return {
    async search(query, searchOptions = {}) {
      const url = new URL(`${TOMTOM_SEARCH_BASE_URL}/search/${encodeURIComponent(query)}.json`);
      url.searchParams.set("limit", String(Math.max(1, Math.min(searchOptions.limit ?? 8, 12))));
      url.searchParams.set("typeahead", "false");
      if (searchOptions.bias !== undefined) {
        url.searchParams.set("lat", searchOptions.bias.lat.toFixed(4));
        url.searchParams.set("lon", searchOptions.bias.lon.toFixed(4));
      }
      const body = await get(url, searchOptions.signal);
      const results = Array.isArray(body["results"]) ? (body["results"] as TomTomResult[]) : [];
      return results.flatMap((result, index) => {
        const place = placeFromTomTom(result, index);
        return place === null ? [] : [place];
      });
    },
    async reverse(coordinate: Coordinate, reverseOptions = {}) {
      const url = new URL(`${TOMTOM_SEARCH_BASE_URL}/reverseGeocode/${coordinate.lat.toFixed(6)},${coordinate.lon.toFixed(6)}.json`);
      const body = await get(url, reverseOptions.signal);
      const addresses = Array.isArray(body["addresses"]) ? (body["addresses"] as { address?: TomTomAddress }[]) : [];
      const first = addresses[0];
      if (first?.address === undefined) return null;
      return placeFromTomTom({ type: "Point Address", address: first.address, position: coordinate }, 0);
    },
  };
}

/**
 * Photon first, TomTom when Photon cannot answer. An empty Photon answer is a
 * real "nothing found" and is returned as is; only an outage falls through.
 */
export function withFallback(primary: PhotonGeocoder, fallback: PhotonGeocoder | null): PhotonGeocoder {
  if (fallback === null) return primary;
  return {
    async search(query, options) {
      try {
        return await primary.search(query, options);
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        return fallback.search(query, options);
      }
    },
    async reverse(coordinate, options) {
      try {
        return await primary.reverse(coordinate, options);
      } catch (error) {
        if (options?.signal?.aborted === true) throw error;
        return fallback.reverse(coordinate, options);
      }
    },
  };
}
