/**
 * TomTom Search as the place-search fallback. Photon (the public komoot
 * instance) refused every connection on 2026-10-23 and search went dark; the
 * deployment already holds a TomTom key for map layers, so a Photon failure
 * now falls through to TomTom's fuzzy search and reverse geocoder. Results
 * come back as the same `PlaceMatch` shape, so the route and the UI never
 * know which upstream answered.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { PlaceMatch } from "@/application/geocoding/place-search";

import { GeocoderUnavailableError, type PhotonGeocoder } from "./photon";

export const TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2";
export const TOMTOM_GEOCODE_TIMEOUT_MS = 4_000;

export interface TomTomGeocoderOptions {
  readonly apiKey: string;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

interface TomTomAddress {
  readonly streetNameAndNumber?: string;
  readonly streetName?: string;
  readonly municipality?: string;
  readonly municipalitySubdivision?: string;
  readonly countrySecondarySubdivision?: string;
  readonly countrySubdivision?: string;
  readonly countrySubdivisionCode?: string;
  readonly countryCode?: string;
  readonly country?: string;
  readonly freeformAddress?: string;
}

interface TomTomResult {
  readonly id?: string;
  readonly type?: string;
  readonly poi?: { readonly name?: string };
  readonly address?: TomTomAddress;
  readonly position?: { readonly lat?: number; readonly lon?: number };
}

/** "PA" for US and Canadian results, the country name elsewhere. */
function region(address: TomTomAddress): string {
  const subdivision = address.countrySubdivisionCode ?? address.countrySubdivision ?? "";
  if (address.countryCode === "US" || address.countryCode === "CA") return subdivision;
  return [subdivision, address.country ?? ""].filter((part) => part !== "").join(", ");
}

function join(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part.trim() !== "").join(", ");
}

export function placeFromTomTom(result: TomTomResult, index: number): PlaceMatch | null {
  const lat = result.position?.lat;
  const lon = result.position?.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const address = result.address ?? {};
  const town = address.municipality ?? address.municipalitySubdivision ?? address.countrySecondarySubdivision;
  const where = join([town, region(address)]);
  const name = result.poi?.name
    ?? address.streetNameAndNumber
    ?? address.streetName
    ?? town
    ?? address.freeformAddress;
  if (name === undefined || name.trim() === "") return null;
  const context = name === town ? region(address) : where;
  return {
    id: `tomtom:${result.id ?? index}`,
    label: join([name, context]),
    name,
    context,
    coordinate: { lat, lon },
    provider: "tomtom",
  };
}

export function createTomTomGeocoder(options: TomTomGeocoderOptions): PhotonGeocoder {
  const timeoutMs = options.timeoutMs ?? TOMTOM_GEOCODE_TIMEOUT_MS;

  async function get(url: URL, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
    url.searchParams.set("key", options.apiKey);
    url.searchParams.set("language", "en-US");
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
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
      const url = new URL(`${TOMTOM_SEARCH_URL}/search/${encodeURIComponent(query)}.json`);
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
      const url = new URL(`${TOMTOM_SEARCH_URL}/reverseGeocode/${coordinate.lat.toFixed(6)},${coordinate.lon.toFixed(6)}.json`);
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
