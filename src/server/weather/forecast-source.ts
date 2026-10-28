/**
 * The hourly forecast source behind `/api/weather/route`.
 *
 * It reuses the National Weather Service client `/api/weather` already talks to
 * and the shared weather cache, so six samples along a route cost one upstream
 * request per forecast cell instead of one per point — and a route request
 * warms the map's conditions pill as a side effect. A cell with a live entry is
 * answered from memory; everything else is fetched and stored under the longer
 * forecast TTL, because this reader never asks for alerts.
 */

import type { WeatherForecastPeriod } from "@/application/preparation/providers";
import { fetchHourlyForecast } from "@/infrastructure/weather/nws";
import {
  WEATHER_FORECAST_CACHE_TTL_MS,
  readWeatherCache,
  weatherCell,
  writeWeatherCache,
} from "./cache";

/** Hourly periods for a coordinate, or a typed provider error. */
export interface HourlyForecastSource {
  forecast(
    lat: number,
    lon: number,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly WeatherForecastPeriod[]>;
}

export interface HourlyForecastSourceOptions {
  /** The NWS call, injectable so the handler can be tested without a network. */
  readonly fetchForecast?: (
    lat: number,
    lon: number,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<readonly WeatherForecastPeriod[]>;
  readonly now?: () => number;
}

export function createCachedHourlyForecastSource(
  options: HourlyForecastSourceOptions = {},
): HourlyForecastSource {
  const fetchForecast =
    options.fetchForecast ??
    ((lat: number, lon: number, requestOptions?: { readonly signal?: AbortSignal }) =>
      fetchHourlyForecast(lat, lon, requestOptions));
  const now = options.now ?? Date.now;
  return {
    async forecast(lat, lon, requestOptions) {
      const cell = weatherCell("forecast", lat, lon);
      const cached = readWeatherCache<readonly WeatherForecastPeriod[]>(cell, now());
      if (cached !== null) return cached;
      const forecast = await fetchForecast(cell.lat, cell.lon, requestOptions);
      writeWeatherCache(cell, forecast, WEATHER_FORECAST_CACHE_TTL_MS, now());
      return forecast;
    },
  };
}
