/**
 * RainViewer frame list for the animated rain radar (map-experience wave 3).
 *
 * One small route in front of RainViewer's free metadata endpoint, cached for
 * five minutes: the browser never asks RainViewer for the list itself, so a
 * rider opening the layer costs one upstream read per five minutes for the whole
 * deployment rather than one per client. The list is not viewport data — every
 * viewport draws the same frames — which is why it is its own route instead of a
 * provider inside `/api/map-layers`.
 *
 * Tiles are still RainViewer's own CDN URLs, built from the host and path this
 * route returns with {@link radarTileTemplate}. A failure here is reported as
 * unavailable, never as a timeline with no rain in it.
 */

import {
  RADAR_LIST_REFRESH_MS,
  parseRainViewerWeatherMaps,
  type RadarFrameList,
} from "@/application/map-layers";

export const RAINVIEWER_WEATHER_MAPS_URL = "https://api.rainviewer.com/public/weather-maps.json";

/** The upstream list changes about every ten minutes; five minutes is fresh enough. */
export const RAINVIEWER_CACHE_TTL_MS = RADAR_LIST_REFRESH_MS;

/** An upstream that hangs must not hold the route open. */
const UPSTREAM_TIMEOUT_MS = 8_000;

/**
 * How long a failed read is remembered. Without it, an outage turns every
 * client's timeline render into another call to RainViewer.
 */
const FAILURE_RETRY_MS = 60_000;

interface CacheEntry {
  readonly list: RadarFrameList;
  readonly expiresAt: number;
}

let cache: CacheEntry | null = null;
let retryAfter = 0;

/** Drops the cached list and the failure backoff; the next read goes upstream. */
export function clearRainViewerCache(): void {
  cache = null;
  retryAfter = 0;
}

export interface RainViewerDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export interface RadarUnavailableBody {
  readonly unavailable: true;
  readonly reason: string;
  readonly retryable: boolean;
}

/**
 * The frame list, from the five-minute cache when it is still good. Throws when
 * RainViewer cannot answer or answers with nothing usable.
 */
export async function readRadarFrames(deps: RainViewerDeps = {}): Promise<RadarFrameList> {
  const now = deps.now ?? Date.now;
  const current = now();
  if (cache !== null && cache.expiresAt > current) return cache.list;
  if (retryAfter > current) throw new Error("RainViewer is cooling down after a failed read");

  try {
    const signal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const response = await (deps.fetch ?? fetch)(RAINVIEWER_WEATHER_MAPS_URL, {
      signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("RainViewer did not answer");
    const payload: unknown = await response.json();
    const list = parseRainViewerWeatherMaps(payload, current);
    cache = { list, expiresAt: current + RAINVIEWER_CACHE_TTL_MS };
    return list;
  } catch (error) {
    retryAfter = current + FAILURE_RETRY_MS;
    throw error;
  }
}

function unavailable(reason: string, retryable: boolean, status: number): Response {
  return Response.json(
    { unavailable: true, reason, retryable } satisfies RadarUnavailableBody,
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function handleRadarFramesRequest(deps: RainViewerDeps = {}): Promise<Response> {
  try {
    const list = await readRadarFrames(deps);
    return Response.json(list, {
      headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" },
    });
  } catch {
    // RainViewer's own words stay upstream: the route is the product-copy
    // boundary, and a provider message is neither useful nor safe to forward.
    return unavailable("Rain radar frames are unavailable right now.", true, 503);
  }
}
