/**
 * Browser-side `PlacesSource`: talks to our own `/api/places` routes, which hold
 * the provider key. The response body is already `PlacesResult`, so this adapter
 * only checks the shape and turns transport failures into `unavailable`.
 */

import type {
  PlaceExtent,
  PlaceQuery,
  PlacesAlongRequest,
  PlacesResult,
  PlacesSource,
} from "@/application/places";

export interface HttpPlacesSourceOptions {
  /** Deployment prefix (`asset-base-path`), e.g. `/ogv`. Empty at the origin root. */
  readonly basePath?: string;
  readonly fetch?: typeof fetch;
}

function unavailable(retryable: boolean): PlacesResult {
  return { availability: "unavailable", places: [], reason: "Places are unavailable right now.", retryable };
}

function isResult(value: unknown): value is PlacesResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { availability?: unknown; places?: unknown };
  return (candidate.availability === "available" || candidate.availability === "unavailable")
    && Array.isArray(candidate.places);
}

export function createHttpPlacesSource(options: HttpPlacesSourceOptions = {}): PlacesSource {
  const base = (options.basePath ?? "").replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<PlacesResult> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, ...(signal === undefined ? {} : { signal }) });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      return unavailable(true);
    }
    try {
      const body: unknown = await response.json();
      return isResult(body) ? body : unavailable(true);
    } catch {
      return unavailable(true);
    }
  }

  return {
    id: "http",
    inExtent(extent: PlaceExtent, query: PlaceQuery, signal?: AbortSignal) {
      const params = new URLSearchParams({
        bbox: [extent.west, extent.south, extent.east, extent.north].join(","),
        kinds: query.kinds.join(","),
        when: query.window,
      });
      return call(`${base}/api/places?${params.toString()}`, { method: "GET" }, signal);
    },
    alongRoute(request: PlacesAlongRequest, query: PlaceQuery, signal?: AbortSignal) {
      return call(
        `${base}/api/places/along`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ line: request.line, bufferMiles: request.bufferMiles, kinds: query.kinds, window: query.window }),
        },
        signal,
      );
    },
  };
}
