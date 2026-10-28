import { readFile } from "node:fs/promises";
import path from "node:path";

import { createApiGuard, guarded } from "@/server/api-guard";
import type { WeatherSnapshot } from "@/application/preparation/providers";
import {
  fetchSnapshot as fetchNwsSnapshot,
  WeatherProviderError,
} from "@/infrastructure/weather/nws";
import {
  WEATHER_CACHE_TTL_MS,
  readWeatherCache,
  weatherCell,
  writeWeatherCache,
} from "@/server/weather/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The cache and its bounds live in `@/server/weather/cache` so
// `/api/weather/route` reads and warms the same map. Re-exported here because
// this route has always published them.
export {
  WEATHER_ALERT_CACHE_TTL_MS,
  WEATHER_CACHE_MAX_ENTRIES,
  WEATHER_CACHE_TTL_MS,
  WEATHER_FORECAST_CACHE_TTL_MS,
  clearWeatherCache,
} from "@/server/weather/cache";

const MAX_QUERY_LENGTH = 512;

export interface WeatherRouteDependencies {
  readonly fetchSnapshot?: (lat: number, lon: number, options?: { readonly signal?: AbortSignal }) => Promise<WeatherSnapshot>;
  readonly now?: () => number;
}

export interface WeatherUnavailableBody {
  readonly unavailable: true;
  readonly reason: string;
  readonly retryable: boolean;
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
  const cell = weatherCell("snapshot", latitude.value, longitude.value);
  const cached = readWeatherCache<WeatherSnapshot>(cell, currentTime);
  if (cached !== null) {
    return Response.json({ snapshot: cached }, { headers: { "cache-control": "private, no-store" } });
  }

  try {
    const snapshot = fixtureEnabled()
      ? await fixtureSnapshot(currentTime)
      : await (dependencies.fetchSnapshot ?? fetchNwsSnapshot)(cell.lat, cell.lon, { signal: request.signal });
    writeWeatherCache(cell, snapshot, WEATHER_CACHE_TTL_MS, currentTime);
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
