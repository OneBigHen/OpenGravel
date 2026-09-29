/**
 * `/api/geocode` and `/api/geocode/reverse` (MVP parity M1).
 *
 * The route is the privacy and product-copy boundary for the upstream geocoder:
 * it validates the query, rate-limits per client (30/min, as SwitchBack did),
 * caches reverse answers (a pin is re-read on every reload), and never forwards
 * provider text. A failure is one fixed sentence with a 503, and the planner
 * treats it as "search unavailable", never as a planning failure.
 */

import {
  PLACE_QUERY_MAX_LENGTH,
  PLACE_QUERY_MIN_LENGTH,
  type PlaceMatch,
} from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";
import { createRateLimiter, type RateLimiter } from "@/server/rate-limit";
import {
  fixtureReverse,
  fixtureSearch,
  GEOCODE_FIXTURE_ENV,
} from "./fixture-places";

export interface GeocodeDependencies {
  readonly search: (query: string, bias: Coordinate | undefined, signal: AbortSignal) => Promise<PlaceMatch[]>;
  readonly reverse: (coordinate: Coordinate, signal: AbortSignal) => Promise<PlaceMatch | null>;
  readonly limiter?: RateLimiter;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Optional regional hint configured by the deployment operator. */
  readonly defaultBias?: Coordinate;
}

const NO_STORE = { "cache-control": "private, no-store" } as const;
const UNAVAILABLE = "Place search is unavailable right now.";

const REVERSE_CACHE_LIMIT = 1_000;
const REVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const reverseCache = new Map<string, { readonly place: PlaceMatch | null; readonly expiresAt: number }>();

export function clearReverseGeocodeCache(): void {
  reverseCache.clear();
}

const defaultLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });
/** Reverse lookups are cheaper and cached; a planning session makes several. */
const defaultReverseLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

function coordinateFrom(url: URL): Coordinate | "invalid" | undefined {
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (lat === null && lon === null) return undefined;
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (lat === null || lon === null || lat.trim() === "" || lon.trim() === "") return "invalid";
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return "invalid";
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return "invalid";
  return { lat: latitude, lon: longitude };
}

function error(status: number, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { message } }, { status, headers: { ...NO_STORE, ...headers } });
}

function limited(limiter: RateLimiter, request: Request): Response | null {
  const retryAfterSeconds = limiter.check(request);
  if (retryAfterSeconds === null) return null;
  return error(429, "Too many place searches. Try again in a moment.", {
    "retry-after": String(retryAfterSeconds),
  });
}

function fixtureMode(dependencies: GeocodeDependencies): boolean {
  return (dependencies.env ?? process.env)[GEOCODE_FIXTURE_ENV] === "1";
}

export async function handleGeocodeSearch(
  request: Request,
  dependencies: GeocodeDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query.length > PLACE_QUERY_MAX_LENGTH) return error(400, "That search is too long.");
  if (query.length < PLACE_QUERY_MIN_LENGTH) {
    return Response.json({ places: [] }, { headers: NO_STORE });
  }
  const bias = coordinateFrom(url);
  if (bias === "invalid") return error(400, "The search location is invalid.");
  const blocked = limited(dependencies.limiter ?? defaultLimiter, request);
  if (blocked !== null) return blocked;
  try {
    const places = fixtureMode(dependencies)
      ? fixtureSearch(query)
      : await dependencies.search(query, bias ?? dependencies.defaultBias, request.signal);
    return Response.json({ places }, { headers: NO_STORE });
  } catch {
    return error(503, UNAVAILABLE);
  }
}

export async function handleGeocodeReverse(
  request: Request,
  dependencies: GeocodeDependencies & { readonly now?: () => number },
): Promise<Response> {
  const url = new URL(request.url);
  const coordinate = coordinateFrom(url);
  if (coordinate === undefined || coordinate === "invalid") {
    return error(400, "The location is invalid.");
  }
  if (fixtureMode(dependencies)) {
    return Response.json({ place: fixtureReverse(coordinate) }, { headers: NO_STORE });
  }
  const now = (dependencies.now ?? Date.now)();
  // ~11 m: the precision the planner shows, and the one its cache keys on.
  const key = `${coordinate.lat.toFixed(4)},${coordinate.lon.toFixed(4)}`;
  const cached = reverseCache.get(key);
  if (cached !== undefined && cached.expiresAt > now) {
    return Response.json({ place: cached.place }, { headers: NO_STORE });
  }
  const blocked = limited(dependencies.limiter ?? defaultReverseLimiter, request);
  if (blocked !== null) return blocked;
  try {
    const place = await dependencies.reverse(coordinate, request.signal);
    reverseCache.set(key, { place, expiresAt: now + REVERSE_CACHE_TTL_MS });
    while (reverseCache.size > REVERSE_CACHE_LIMIT) {
      const oldest = reverseCache.keys().next().value;
      if (oldest === undefined) break;
      reverseCache.delete(oldest);
    }
    return Response.json({ place }, { headers: NO_STORE });
  } catch {
    return error(503, UNAVAILABLE);
  }
}
