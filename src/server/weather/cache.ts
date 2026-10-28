/**
 * The process-local cache behind the weather routes.
 *
 * `/api/weather` answers one snapshot for a point, `/api/weather/route` answers
 * the hourly forecast at several points along a route, and the map's wind layer
 * reads the gridpoint wind series for its arrow grid. All three ask the same
 * upstream for the same area, so they share one bounded map: a route request
 * warms the conditions pill and vice versa. Keeping the map here (and not inside
 * either route) is what lets the endpoints reuse it without one importing the
 * other's route module.
 *
 * Keys are rounded to the cell the weather route has always used (0.05°, a few
 * kilometres) because a National Weather Service forecast covers a grid cell,
 * not a coordinate. Two points inside one cell cost one upstream request.
 */

export const WEATHER_ALERT_CACHE_TTL_MS = 5 * 60 * 1000;
export const WEATHER_FORECAST_CACHE_TTL_MS = 30 * 60 * 1000;
export const WEATHER_CACHE_MAX_ENTRIES = 256;
/**
 * A snapshot has one `fetchedAt` and is never returned with a fresh alert
 * paired to an unmarked forecast, so `/api/weather` refreshes at the shorter
 * alert TTL. `/api/weather/route` stores only forecast periods and uses the
 * longer forecast TTL.
 */
export const WEATHER_CACHE_TTL_MS = Math.min(
  WEATHER_ALERT_CACHE_TTL_MS,
  WEATHER_FORECAST_CACHE_TTL_MS,
);

/** What a cache entry holds; the weather endpoints never share a key. */
export type WeatherCacheKind = "snapshot" | "forecast" | "wind";

/** One rounded forecast cell and the key it is stored under. */
export interface WeatherCell {
  readonly key: string;
  readonly lat: number;
  readonly lon: number;
}

interface WeatherCacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
  touchedAt: number;
}

const cache = new Map<string, WeatherCacheEntry>();

function roundedCoordinate(value: number): number {
  return Math.round(value / 0.05) * 0.05;
}

/** The cell a coordinate falls in, rounded the same way for every caller. */
export function weatherCell(kind: WeatherCacheKind, lat: number, lon: number): WeatherCell {
  const roundedLat = Number(roundedCoordinate(lat).toFixed(2));
  const roundedLon = Number(roundedCoordinate(lon).toFixed(2));
  return {
    key: `${kind}:${roundedLat.toFixed(2)},${roundedLon.toFixed(2)}`,
    lat: roundedLat,
    lon: roundedLon,
  };
}

/** A live entry's value, or `null` when it is missing or expired. */
export function readWeatherCache<T>(cell: WeatherCell, now: number): T | null {
  const entry = cache.get(cell.key);
  if (entry === undefined || entry.expiresAt <= now) return null;
  entry.touchedAt = now;
  return entry.value as T;
}

/** Store a value in its cell, dropping the least recently touched entries. */
export function writeWeatherCache(
  cell: WeatherCell,
  value: unknown,
  ttlMs: number,
  now: number,
): void {
  cache.set(cell.key, { value, expiresAt: now + ttlMs, touchedAt: now });
  while (cache.size > WEATHER_CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
    if (oldest === undefined) return;
    cache.delete(oldest[0]);
  }
}

export function clearWeatherCache(): void {
  cache.clear();
}
