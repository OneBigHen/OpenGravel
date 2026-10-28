import { DEFAULT_NWS_USER_AGENT, nwsUserAgentFromEnv } from "@/infrastructure/weather/config";
import type {
  WeatherAlert,
  WeatherForecastPeriod,
  WeatherSnapshot,
} from "@/application/preparation/providers";
import type { WindInterval, WindSeries } from "@/application/map-layers/wind";

export const NWS_BASE_URL = "https://api.weather.gov";
/** Compatibility export for callers/tests that imported the historical constant. */
export const NWS_USER_AGENT = DEFAULT_NWS_USER_AGENT;
export const NWS_TIMEOUT_MS = 10_000;
export const NWS_MAX_RETRIES = 2;

type JsonRecord = Record<string, unknown>;

export type WeatherProviderErrorCode =
  | "invalid-coordinate"
  | "timeout"
  | "network"
  | "http"
  | "malformed";

export class WeatherProviderError extends Error {
  readonly code: WeatherProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    message: string,
    code: WeatherProviderErrorCode,
    options: { readonly retryable?: boolean; readonly status?: number | null } = {},
  ) {
    super(message);
    this.name = "WeatherProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
  }
}

export interface FetchSnapshotOptions {
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly baseUrl?: string;
  /** Override for tests/special transports; deployment default comes from NWS_USER_AGENT. */
  readonly userAgent?: string;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WeatherProviderError(`NWS ${field} is malformed.`, "malformed");
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!Number.isFinite(Date.parse(text))) {
    throw new WeatherProviderError(`NWS ${field} is malformed.`, "malformed");
  }
  return text;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return timestamp(value, field);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WeatherProviderError(`NWS ${field} is malformed.`, "malformed");
  }
  return value;
}

function optionalNumber(value: unknown, field: string, bounds?: { readonly min: number; readonly max: number }): number | undefined {
  if (value === null || value === undefined) return undefined;
  const number = finiteNumber(value, field);
  if (bounds !== undefined && (number < bounds.min || number > bounds.max)) {
    throw new WeatherProviderError(`NWS ${field} is malformed.`, "malformed");
  }
  return number;
}

function temperatureF(value: unknown, unit: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const number = finiteNumber(value, "temperature");
  if (unit === "F") return number;
  if (unit === "C") return Math.round((number * 9 / 5 + 32) * 100) / 100;
  throw new WeatherProviderError("NWS temperature unit is malformed.", "malformed");
}

function windMph(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new WeatherProviderError("NWS wind speed is malformed.", "malformed");
  }
  if (/^calm$/i.test(value.trim())) return undefined;
  const match = /(-?\d+(?:\.\d+)?)\s*(mph|km\/h|kph)\b/i.exec(value);
  if (match === null) {
    throw new WeatherProviderError("NWS wind speed is malformed.", "malformed");
  }
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number < 0) {
    throw new WeatherProviderError("NWS wind speed is malformed.", "malformed");
  }
  return match[2]?.toLowerCase() === "mph"
    ? number
    : Math.round(number * 0.621371 * 100) / 100;
}

export function parseNwsPoints(value: unknown): { readonly office: string; readonly x: number; readonly y: number } {
  const root = record(value);
  const properties = record(root?.properties);
  if (properties === null) throw new WeatherProviderError("NWS points response is malformed.", "malformed");
  const office = requiredString(properties.gridId, "grid id");
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(office)) {
    throw new WeatherProviderError("NWS grid id is malformed.", "malformed");
  }
  const x = finiteNumber(properties.gridX, "grid x");
  const y = finiteNumber(properties.gridY, "grid y");
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new WeatherProviderError("NWS grid coordinates are malformed.", "malformed");
  }
  return { office, x, y };
}

export function parseNwsForecast(value: unknown): readonly WeatherForecastPeriod[] {
  const root = record(value);
  const properties = record(root?.properties);
  const periods = properties?.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    throw new WeatherProviderError("NWS forecast periods are malformed.", "malformed");
  }
  return periods.map((value) => {
    const period = record(value);
    if (period === null) throw new WeatherProviderError("NWS forecast period is malformed.", "malformed");
    const probability = record(period.probabilityOfPrecipitation);
    if (period.probabilityOfPrecipitation !== undefined
      && period.probabilityOfPrecipitation !== null
      && probability === null) {
      throw new WeatherProviderError("NWS precipitation probability is malformed.", "malformed");
    }
    const precipChance = optionalNumber(probability?.value, "precipitation probability", { min: 0, max: 100 });
    const temperature = temperatureF(period.temperature, period.temperatureUnit);
    const wind = windMph(period.windSpeed);
    const startTime = timestamp(period.startTime, "period start time");
    const endTime = timestamp(period.endTime, "period end time");
    if (Date.parse(startTime) > Date.parse(endTime)) {
      throw new WeatherProviderError("NWS forecast period is malformed.", "malformed");
    }
    return {
      // Hourly periods carry an empty name; the start time names them instead.
      name: typeof period.name === "string" && period.name.trim() !== "" ? period.name : startTime,
      startTime,
      endTime,
      ...(temperature === undefined ? {} : { temperatureF: temperature }),
      ...(wind === undefined ? {} : { windMph: wind }),
      ...(precipChance === undefined ? {} : { precipChance }),
      shortForecast: requiredString(period.shortForecast, "short forecast"),
    };
  });
}

export function parseNwsAlerts(value: unknown): readonly WeatherAlert[] {
  const root = record(value);
  if (!Array.isArray(root?.features)) {
    throw new WeatherProviderError("NWS alerts response is malformed.", "malformed");
  }
  return root.features.map((value) => {
    const feature = record(value);
    const properties = record(feature?.properties);
    if (properties === null) throw new WeatherProviderError("NWS alert is malformed.", "malformed");
    return {
      event: requiredString(properties.event, "alert event"),
      severity: requiredString(properties.severity, "alert severity"),
      onset: optionalTimestamp(properties.onset, "alert onset"),
      ends: optionalTimestamp(properties.ends, "alert end"),
      area: requiredString(properties.areaDesc, "alert area"),
    };
  });
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function transientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function requestJson(
  url: string,
  options: FetchSnapshotOptions,
): Promise<unknown> {
  const fetcher = options.fetcher ?? fetch;
  const signal = options.signal;
  const timeoutMs = options.timeoutMs ?? NWS_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? NWS_MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeoutReject: ((reason?: unknown) => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutReject = reject;
      timer = setTimeout(() => {
        controller.abort();
        reject(new WeatherProviderError("NWS request timed out.", "timeout", { retryable: true }));
      }, timeoutMs);
    });
    let rejectExternal: ((reason?: unknown) => void) | undefined;
    const onExternalAbort = () => rejectExternal?.(signal?.reason);
    const externalAbort = signal === undefined
      ? null
      : new Promise<never>((_, reject) => {
          rejectExternal = reject;
          signal.addEventListener("abort", onExternalAbort, { once: true });
        });
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const fetchRequest = fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/geo+json, application/json",
          "User-Agent": options.userAgent ?? nwsUserAgentFromEnv(),
        },
        signal: controller.signal,
      });
      const response = await Promise.race([
        fetchRequest,
        timeout,
        ...(externalAbort === null ? [] : [externalAbort]),
      ]);
      if (!response.ok) {
        const retryable = transientStatus(response.status);
        if (retryable && attempt < maxRetries) {
          await sleep(Math.round((250 * 2 ** attempt) + random() * 250));
          continue;
        }
        throw new WeatherProviderError("NWS returned an unavailable response.", "http", {
          retryable,
          status: response.status,
        });
      }
      try {
        return await Promise.race([
          response.json(),
          timeout,
          ...(externalAbort === null ? [] : [externalAbort]),
        ]);
      } catch (error) {
        if (error instanceof WeatherProviderError) throw error;
        throw new WeatherProviderError("NWS returned malformed JSON.", "malformed");
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof WeatherProviderError) {
        if (error.retryable && attempt < maxRetries) {
          await sleep(Math.round((250 * 2 ** attempt) + random() * 250));
          continue;
        }
        throw error;
      }
      const retryable = true;
      if (attempt < maxRetries) {
        await sleep(Math.round((250 * 2 ** attempt) + random() * 250));
        continue;
      }
      throw new WeatherProviderError(
        "NWS request failed.",
        "network",
        { retryable },
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      timeoutReject?.();
      signal?.removeEventListener("abort", onExternalAbort);
      signal?.removeEventListener("abort", abort);
    }
  }
  throw new WeatherProviderError("NWS request failed.", "network", { retryable: true });
}

export async function fetchHourlyForecast(
  lat: number,
  lon: number,
  options: FetchSnapshotOptions = {},
): Promise<readonly WeatherForecastPeriod[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new WeatherProviderError("Weather coordinates are outside geographic bounds.", "invalid-coordinate");
  }
  const baseUrl = options.baseUrl ?? NWS_BASE_URL;
  const points = await requestJson(`${baseUrl}/points/${lat},${lon}`, options);
  const grid = parseNwsPoints(points);
  // The hourly forecast (M4, OGV-D-266). The bare `/gridpoints/{office}/{x},{y}`
  // resource is raw grid data with no `periods`, so every live request used
  // to fail as "malformed" and only the fixture ever showed weather.
  return parseNwsForecast(
    await requestJson(`${baseUrl}/gridpoints/${grid.office}/${grid.x},${grid.y}/forecast/hourly`, options),
  );
}

// --- Wind grid (map-experience wave 3, item 13) -----------------------------

/**
 * The National Weather Service's raw gridpoint forecast carries wind as three
 * series of `validTime`/`value` windows: sustained speed, direction and — where
 * the office publishes it — gusts. `/forecast/hourly` has a single wind number
 * per hour for one point; the grid is what lets one cell answer one reading at
 * an instant, and it is what the map's coarse arrow grid is built from.
 */

/** NWS gridpoint speeds arrive in km/h; the map speaks mph. */
const WIND_SPEED_TO_MPH: Readonly<Record<string, number>> = {
  "wmoUnit:km_h-1": 0.621371192,
  "wmoUnit:mph": 1,
  "wmoUnit:m_s-1": 2.236936292,
  "wmoUnit:kn": 1.150779448,
};

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** An ISO 8601 duration ("PT3H", "P1DT6H") in milliseconds, or `null`. */
export function parseIsoDurationMs(text: string): number | null {
  const match = ISO_DURATION.exec(text.trim());
  if (match === null) return null;
  const [, days, hours, minutes, seconds] = match;
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) return null;
  const milliseconds = (((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes ?? 0)) * 60
    + Number(seconds ?? 0)) * 1_000;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

/**
 * One grid window: `start/PT3H` or `start/end`. A window we cannot read is
 * skipped by the parser rather than guessed at, because a value attached to the
 * wrong hour is worse than no arrow.
 */
export function parseGridValidTime(value: unknown): { readonly startMs: number; readonly endMs: number } | null {
  if (typeof value !== "string") return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  const startMs = Date.parse(value.slice(0, slash));
  if (!Number.isFinite(startMs)) return null;
  const rest = value.slice(slash + 1).trim();
  const endMs = rest.startsWith("P")
    ? startMs + (parseIsoDurationMs(rest) ?? Number.NaN)
    : Date.parse(rest);
  if (!Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

function windIntervals(
  group: unknown,
  field: string,
  scale: number,
  bounds?: { readonly min: number; readonly max: number },
): readonly WindInterval[] {
  const container = record(group);
  if (container === null) return [];
  const values = container["values"];
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new WeatherProviderError(`NWS wind ${field} is malformed.`, "malformed");
  const intervals: WindInterval[] = [];
  for (const entry of values) {
    const item = record(entry);
    if (item === null) continue;
    const window = parseGridValidTime(item["validTime"]);
    if (window === null) continue;
    const raw = item["value"];
    // NWS publishes `null` for a window it has no value for: unknown, not zero.
    if (raw === null || raw === undefined) continue;
    const number = finiteNumber(raw, `wind ${field}`);
    if (bounds !== undefined && (number < bounds.min || number > bounds.max)) {
      throw new WeatherProviderError(`NWS wind ${field} is malformed.`, "malformed");
    }
    intervals.push({ ...window, value: Math.round(number * scale * 100) / 100 });
  }
  return intervals;
}

/**
 * Parses a `/gridpoints/{office}/{x},{y}` answer into the wind series the map
 * samples. Throws when the payload has no wind speed group at all — that is not
 * a wind grid — and keeps an unpublished gust series empty, which the map reads
 * as "gusts unknown".
 */
export function parseNwsWindGrid(payload: unknown): WindSeries {
  const properties = record(record(payload)?.["properties"]);
  if (properties === null) throw new WeatherProviderError("NWS wind grid is malformed.", "malformed");
  const speedGroup = record(properties["windSpeed"]);
  if (speedGroup === null) throw new WeatherProviderError("NWS wind grid is malformed.", "malformed");
  const unit = speedGroup["uom"];
  const scale = typeof unit === "string" ? WIND_SPEED_TO_MPH[unit] : undefined;
  if (scale === undefined) throw new WeatherProviderError("NWS wind speed unit is malformed.", "malformed");
  return {
    speedMph: windIntervals(speedGroup, "speed", scale, { min: 0, max: 400 }),
    gustMph: windIntervals(properties["windGust"], "gust", scale, { min: 0, max: 500 }),
    fromDegrees: windIntervals(properties["windDirection"], "direction", 1, { min: 0, max: 360 }),
  };
}

/**
 * The wind series for one coordinate: `/points` resolves the office and grid
 * square, then the gridpoint resource publishes the windows. Two upstream reads,
 * which is why the caller caches the result per cell.
 */
export async function fetchWindGridSeries(
  lat: number,
  lon: number,
  options: FetchSnapshotOptions = {},
): Promise<WindSeries> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new WeatherProviderError("Weather coordinates are outside geographic bounds.", "invalid-coordinate");
  }
  const baseUrl = options.baseUrl ?? NWS_BASE_URL;
  const grid = parseNwsPoints(await requestJson(`${baseUrl}/points/${lat},${lon}`, options));
  return parseNwsWindGrid(
    await requestJson(`${baseUrl}/gridpoints/${grid.office}/${grid.x},${grid.y}`, options),
  );
}

export async function fetchSnapshot(
  lat: number,
  lon: number,
  options: FetchSnapshotOptions = {},
): Promise<WeatherSnapshot> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new WeatherProviderError("Weather coordinates are outside geographic bounds.", "invalid-coordinate");
  }
  const [forecast, alerts] = await Promise.all([
    fetchHourlyForecast(lat, lon, options),
    requestJson(`${options.baseUrl ?? NWS_BASE_URL}/alerts/active?point=${lat},${lon}`, options).then(parseNwsAlerts),
  ]);
  return {
    fetchedAt: new Date().toISOString(),
    source: "nws",
    alerts,
    forecast,
  };
}

export const fetchWeatherSnapshot = fetchSnapshot;
