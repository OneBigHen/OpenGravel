/**
 * Server-side `PlacesSource` for sample places provider.
 *
 * Holds the provider key, so it must only ever be constructed on the server
 * (`src/server/places/handler.ts`); the browser reaches it through our own
 * `/api/places` route. Upstream text never reaches the rider: failures become a
 * fixed reason plus a retryable flag.
 */

import {
  MAX_ALONG_POINTS,
  type PlacesAlongRequest,
  type PlacesResult,
  type PlacesSource,
} from "@/application/places";
import type { PlaceExtent, PlaceQuery } from "@/application/places";
import type { Coordinate } from "@/domain/ride/types";

import { parsePlacesCollection, PlacesContractError } from "./places-geojson";

export interface PlacesApiConfig {
  /** Base URL without a trailing `/api/v1`. */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const UNAVAILABLE = "Places are unavailable right now.";

/** Keeps the first and last point and an even stride between; never reorders. */
export function thinLine(line: readonly Coordinate[], max = MAX_ALONG_POINTS): readonly Coordinate[] {
  if (line.length <= max) return line;
  const out: Coordinate[] = [];
  const step = (line.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    const point = line[Math.round(i * step)];
    if (point !== undefined) out.push(point);
  }
  return out;
}

function unavailable(reason: string, retryable: boolean): PlacesResult {
  return { availability: "unavailable", places: [], reason, retryable };
}

export function createPlacesApiSource(config: PlacesApiConfig): PlacesSource {
  const base = config.baseUrl.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8000;

  async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<PlacesResult> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await doFetch(`${base}/api/v1${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${config.apiKey}`, accept: "application/json" },
        signal: combined,
        cache: "no-store",
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return unavailable(UNAVAILABLE, true);
    }
    if (response.status === 401 || response.status === 403) return unavailable(UNAVAILABLE, false);
    if (response.status === 429 || response.status >= 500) return unavailable(UNAVAILABLE, true);
    if (!response.ok) return unavailable("Places could not answer this area.", false);
    try {
      const parsed = parsePlacesCollection(await response.json());
      return {
        availability: "available",
        places: parsed.places,
        fetchedAt: parsed.fetchedAt,
        attribution: parsed.attribution,
      };
    } catch (error) {
      return unavailable(UNAVAILABLE, !(error instanceof PlacesContractError));
    }
  }

  return {
    id: "places-api",
    inExtent(extent: PlaceExtent, query: PlaceQuery, signal?: AbortSignal) {
      const params = new URLSearchParams({
        bbox: [extent.west, extent.south, extent.east, extent.north].map((v) => v.toFixed(4)).join(","),
        kinds: query.kinds.join(","),
        when: query.window,
      });
      return call(`/places?${params.toString()}`, { method: "GET" }, signal);
    },
    alongRoute(request: PlacesAlongRequest, query: PlaceQuery, signal?: AbortSignal) {
      const body = {
        coordinates: thinLine(request.line).map((c) => [Number(c.lon.toFixed(5)), Number(c.lat.toFixed(5))]),
        buffer_mi: request.bufferMiles,
        kinds: query.kinds,
        when: query.window,
      };
      return call(
        "/places/along",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
        signal,
      );
    },
  };
}
