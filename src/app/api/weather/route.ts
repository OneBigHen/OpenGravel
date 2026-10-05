import { readFile } from "node:fs/promises";
import path from "node:path";

import { createApiGuard, guarded } from "@/server/api-guard";
import type { WeatherSnapshot } from "@/application/preparation/providers";
import {
  fetchSnapshot as fetchNwsSnapshot,
  WeatherProviderError,
} from "@/infrastructure/weather/nws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const WEATHER_ALERT_CACHE_TTL_MS = 5 * 60 * 1000;
export const WEATHER_FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;
export const WEATHER_CACHE_MAX_ENTRIES = 256;
const MAX_QUERY_LENGTH = 512;
// A snapshot has one fetchedAt and is intentionally never returned with a
// fresh alert paired to an unmarked forecast. The combined response therefore
// refreshes at the shorter alert TTL; forecasts are never served past their
// own 30-minute bound, and a future split-resource adapter can use the longer
// constant without changing the public response.
const CACHE_TTL_MS = Math.min(WEATHER_ALERT_CACHE_TTL_MS, WEATHER_FORECAST_CACHE_TTL_MS);
export const WEATHER_CACHE_TTL_MS = CACHE_TTL_MS;

interface WeatherCacheEntry {
  readonly snapshot: WeatherSnapshot;
  readonly expiresAt: number;
  readonly touchedAt: number;
}

export interface WeatherRouteDependencies {
  readonly fetchSnapshot?: (lat: number, lon: number, options?: { readonly signal?: AbortSignal }) => Promise<WeatherSnapshot>;
  readonly now?: () => number;
}

export interface WeatherUnavailableBody {
  readonly unavailable: true;
  readonly reason: string;
  readonly retryable: boolean;
}

const cache = new Map<string, WeatherCacheEntry>();

export function clearWeatherCache(): void {
  cache.clear();
}

function roundedCoordinate(value: number): number {
  return Math.round(value / 0.05) * 0.05;
}

function cacheKey(lat: number, lon: number): { readonly key: string; readonly lat: number; readonly lon: number } {
  const roundedLat = Number(roundedCoordinate(lat).toFixed(2));
  const roundedLon = Number(roundedCoordinate(lon).toFixed(2));
  return {
    key: `${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`,
    lat: roundedLat,
    lon: roundedLon,
  };
}

function unavailableResponse(
  body: WeatherUnavailableBody,
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function coordinateParam(value: string | null, label: "Latitude" | "Longitude"): { value: number } | { reason: string } {
  if (value === null || value.trim() === "" || !Number.isFinite(Number(value))) {
    return { reason: `${label} must be a finite number.` };
  }
  const number = Number(value);
  const min = label === "Latitude" ? -90 : -180;
  const max = label === "Latitude" ? 90 : 180;
  if (number < min || number > max) {
    return { reason: `${label} must be between ${min} and ${max}.` };
  }
  return { value: number };
}

function evictIfNeeded(): void {
  while (cache.size > WEATHER_CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
    if (oldest === undefined) return;
    cache.delete(oldest[0]);
  }
}

function fixtureEnabled(): boolean {
  return process.env.OGV_WEATHER_FIXTURE === "1";
}

function validFixture(value: unknown): value is WeatherSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<WeatherSnapshot>;
  return candidate.source === "nws"
    && typeof candidate.fetchedAt === "string"
    && Array.isArray(candidate.alerts)
    && Array.isArray(candidate.forecast);
}

async function fixtureSnapshot(now: number): Promise<WeatherSnapshot> {
  const fixturePath = path.join(process.cwd(), "tests", "fixtures", "weather", "snapshot.json");
  const contents = await readFile(fixturePath, "utf8");
  const parsed: unknown = JSON.parse(contents);
  if (!validFixture(parsed)) throw new Error("weather fixture is malformed");
  return { ...parsed, fetchedAt: new Date(now).toISOString() };
}

export async function handleWeatherRequest(
  request: Request,
  dependencies: WeatherRouteDependencies = {},
): Promise<Response> {
  if (request.url.length > MAX_QUERY_LENGTH) {
    return unavailableResponse({ unavailable: true, reason: "Weather query is too large.", retryable: false }, 413);
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return unavailableResponse({ unavailable: true, reason: "Weather query is malformed.", retryable: false }, 400);
  }
  const latitude = coordinateParam(url.searchParams.get("lat"), "Latitude");
  if ("reason" in latitude) return unavailableResponse({ unavailable: true, reason: latitude.reason, retryable: false }, 400);
  const longitude = coordinateParam(url.searchParams.get("lon"), "Longitude");
  if ("reason" in longitude) return unavailableResponse({ unavailable: true, reason: longitude.reason, retryable: false }, 400);

  const now = dependencies.now ?? Date.now;
  const currentTime = now();
  const rounded = cacheKey(latitude.value, longitude.value);
  const cached = cache.get(rounded.key);
  if (cached !== undefined && cached.expiresAt > currentTime) {
    return Response.json({ snapshot: cached.snapshot }, { headers: { "cache-control": "private, no-store" } });
  }

  try {
    const snapshot = fixtureEnabled()
      ? await fixtureSnapshot(currentTime)
      : await (dependencies.fetchSnapshot ?? fetchNwsSnapshot)(rounded.lat, rounded.lon, { signal: request.signal });
    cache.set(rounded.key, { snapshot, expiresAt: currentTime + CACHE_TTL_MS, touchedAt: currentTime });
    evictIfNeeded();
    return Response.json({ snapshot }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    // Do not forward provider text or coordinates. The route is the privacy and
    // product-copy boundary for all upstream failures.
    if (error instanceof Error && "code" in error && error.code === "invalid-coordinate") {
      return unavailableResponse({ unavailable: true, reason: "Weather coordinates are invalid.", retryable: false }, 400);
    }
    return unavailableResponse({
      unavailable: true,
      reason: "Weather is unavailable right now.",
      retryable: error instanceof WeatherProviderError ? error.retryable : true,
    }, 503);
  }
}

const guard = createApiGuard({ perMinute: 60, maxConcurrent: 6 });

export async function GET(request: Request): Promise<Response> {
  return guarded(guard, request, () => handleWeatherRequest(request));
}
