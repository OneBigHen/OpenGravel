/**
 * `POST /api/weather/route`: the weather a rider will meet along the ride, not
 * at map centre (MAP-EXPERIENCE-NEXT Wave 2, item 7).
 *
 * The body is
 *
 * ```json
 * {
 *   "line": [{ "lon": -75.44, "lat": 40.14 }, …],
 *   "departureTime": "2026-10-27T14:00:00.000Z",
 *   "durationSeconds": 7200,
 *   "timeZone": "America/New_York",
 *   "samples": 6
 * }
 * ```
 *
 * where `line` is the route in travel order (`[lon, lat]` pairs are accepted
 * too), `durationSeconds` is the route's own measured duration, `timeZone` is
 * the rider's IANA zone (without it the headline states no clock time), and
 * `samples` is optional (default six, capped). The answer is a
 * {@link RouteWeatherReport}: one reading per point at its ETA, plus a headline.
 *
 * NWS is optional to the rest of the product, so this is too: a sample whose
 * forecast cannot be read keeps `null` weather, the rest of the answer still
 * arrives, and the headline never turns absence into "dry". Every upstream
 * lookup goes through the shared weather cache and the existing NWS client.
 */

import {
  evenDurationProfile,
  forecastForInstant,
  isKnownTimeZone,
  routeLineMeters,
  routeWeatherHeadline,
  routeWeatherReading,
  sampleRouteWeatherPoints,
  type RouteWeatherReading,
  type RouteWeatherReport,
  type RouteWeatherSample,
  ROUTE_WEATHER_SAMPLES,
} from "@/application/weather/route-weather";
import type { WeatherForecastPeriod } from "@/application/preparation/providers";
import type { Coordinate } from "@/domain/ride/types";
import {
  createCachedHourlyForecastSource,
  type HourlyForecastSource,
} from "./forecast-source";
import { weatherCell, type WeatherCell } from "./cache";

/** A full route geometry is longer than a traced finger-path; this is still ample. */
export const MAX_ROUTE_WEATHER_LINE_POINTS = 2048;
export const MAX_ROUTE_WEATHER_BODY_BYTES = 512 * 1024;
export const MIN_ROUTE_WEATHER_SAMPLES = 2;
export const MAX_ROUTE_WEATHER_SAMPLES = 8;

export interface RouteWeatherHandlerDeps {
  /** The hourly forecast source; defaults to the cached NWS client. */
  readonly source?: HourlyForecastSource;
}

interface RouteWeatherBody {
  readonly line: readonly Coordinate[];
  readonly departureTime: string;
  readonly durationSeconds: number;
  readonly timeZone: string | null;
  readonly samples: number;
}

type ParseResult =
  | { readonly ok: true; readonly body: RouteWeatherBody }
  | { readonly ok: false; readonly message: string };

let defaultSource: HourlyForecastSource | null = null;

function forecastSource(): HourlyForecastSource {
  defaultSource ??= createCachedHourlyForecastSource();
  return defaultSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coordinate(value: unknown): Coordinate | null {
  if (Array.isArray(value)) {
    const [lon, lat] = value as readonly unknown[];
    if (value.length !== 2) return null;
    return finiteCoordinate(lon, lat);
  }
  if (!isRecord(value)) return null;
  return finiteCoordinate(value["lon"], value["lat"]);
}

function finiteCoordinate(lon: unknown, lat: unknown): Coordinate | null {
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { lon, lat };
}

function parseBody(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, message: "The route weather body must be a JSON object." };
  const rawLine = value["line"];
  if (!Array.isArray(rawLine)
    || rawLine.length < 2
    || rawLine.length > MAX_ROUTE_WEATHER_LINE_POINTS) {
    return {
      ok: false,
      message: `line must be 2–${MAX_ROUTE_WEATHER_LINE_POINTS} points.`,
    };
  }
  const line: Coordinate[] = [];
  for (const entry of rawLine) {
    const point = coordinate(entry);
    if (point === null) return { ok: false, message: "Every line point needs a finite lon and lat." };
    line.push(point);
  }
  const departureTime = value["departureTime"];
  if (typeof departureTime !== "string" || !Number.isFinite(Date.parse(departureTime))) {
    return { ok: false, message: "departureTime must be an ISO 8601 instant." };
  }
  const durationSeconds = value["durationSeconds"];
  if (typeof durationSeconds !== "number"
    || !Number.isFinite(durationSeconds)
    || durationSeconds < 0) {
    return { ok: false, message: "durationSeconds must be the route's measured duration." };
  }
  const rawTimeZone = value["timeZone"];
  if (rawTimeZone !== undefined && rawTimeZone !== null
    && (typeof rawTimeZone !== "string" || !isKnownTimeZone(rawTimeZone))) {
    return { ok: false, message: "timeZone must be an IANA time zone such as America/New_York." };
  }
  const rawSamples = value["samples"];
  if (rawSamples !== undefined
    && (typeof rawSamples !== "number"
      || !Number.isSafeInteger(rawSamples)
      || rawSamples < MIN_ROUTE_WEATHER_SAMPLES
      || rawSamples > MAX_ROUTE_WEATHER_SAMPLES)) {
    return {
      ok: false,
      message: `samples must be a whole number between ${MIN_ROUTE_WEATHER_SAMPLES} and ${MAX_ROUTE_WEATHER_SAMPLES}.`,
    };
  }
  return {
    ok: true,
    body: {
      line,
      departureTime,
      durationSeconds,
      timeZone: typeof rawTimeZone === "string" ? rawTimeZone : null,
      samples: typeof rawSamples === "number" ? rawSamples : ROUTE_WEATHER_SAMPLES,
    },
  };
}

function errorResponse(status: number, message: string): Response {
  return Response.json(
    { error: { code: "validation", message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function readBody(
  request: Request,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly status: number; readonly message: string }> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_ROUTE_WEATHER_BODY_BYTES) {
    return { ok: false, status: 413, message: "The route weather body is too large." };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, message: "The route weather body could not be read." };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_ROUTE_WEATHER_BODY_BYTES) {
    return { ok: false, status: 413, message: "The route weather body is too large." };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, message: "The route weather body must be JSON." };
  }
}

/**
 * The forecast for a cell, or `null` when the provider did not answer. The
 * failure stays local to this cell: one unavailable grid point must not erase
 * the weather the rest of the route has.
 */
async function safeForecast(
  source: HourlyForecastSource,
  cell: WeatherCell,
  signal: AbortSignal | undefined,
): Promise<readonly WeatherForecastPeriod[] | null> {
  try {
    return await source.forecast(cell.lat, cell.lon, signal === undefined ? {} : { signal });
  } catch {
    return null;
  }
}

function readingFor(
  point: { readonly eta: string | null },
  periods: readonly WeatherForecastPeriod[] | null,
): RouteWeatherReading {
  if (periods === null || point.eta === null) return routeWeatherReading(null);
  const instant = Date.parse(point.eta);
  if (!Number.isFinite(instant)) return routeWeatherReading(null);
  return routeWeatherReading(forecastForInstant(periods, instant));
}

export async function handleRouteWeatherRequest(
  request: Request,
  deps: RouteWeatherHandlerDeps = {},
): Promise<Response> {
  const parsedBody = await readBody(request);
  if (!parsedBody.ok) return errorResponse(parsedBody.status, parsedBody.message);
  const parsed = parseBody(parsedBody.value);
  if (!parsed.ok) return errorResponse(400, parsed.message);
  const { line, departureTime, durationSeconds, timeZone, samples: sampleCount } = parsed.body;

  const points = sampleRouteWeatherPoints({
    line,
    durationProfile: evenDurationProfile(routeLineMeters(line), durationSeconds),
    departureMs: Date.parse(departureTime),
    count: sampleCount,
  });
  if (points.length === 0) {
    return errorResponse(400, "line must be a route with a measurable length.");
  }

  // One lookup per forecast cell, not per sample: six points along a 60-mile
  // ride usually land in two or three NWS cells.
  const cells = new Map<string, WeatherCell>();
  for (const point of points) {
    const cell = weatherCell("forecast", point.coordinate.lat, point.coordinate.lon);
    if (!cells.has(cell.key)) cells.set(cell.key, cell);
  }
  const source = deps.source ?? forecastSource();
  const answers = await Promise.all(
    [...cells.entries()].map(async ([key, cell]) => [key, await safeForecast(source, cell, request.signal)] as const),
  );
  const forecasts = new Map(answers);

  const samples: RouteWeatherSample[] = points.map((point) => {
    const cell = weatherCell("forecast", point.coordinate.lat, point.coordinate.lon);
    return {
      ...point,
      ...readingFor(point, forecasts.get(cell.key) ?? null),
    };
  });

  const report: RouteWeatherReport = {
    source: "nws",
    samples,
    headline: routeWeatherHeadline({ samples, timeZone }),
    forecastAvailable: samples.some(
      (sample) => sample.shortForecast !== null || sample.rainChancePct !== null,
    ),
  };
  return Response.json({ report }, { headers: { "cache-control": "private, no-store" } });
}
