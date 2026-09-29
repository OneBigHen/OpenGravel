import type {
  RoutePreparationContext,
} from "./prepare-route";
import type {
  ProviderCapability,
  ProviderResult,
  WeatherAlert,
  WeatherData,
  WeatherForecastPeriod,
  WeatherProvider,
  WeatherSnapshot,
} from "./providers";

const WEATHER_PATH = "/api/weather";
const STALE_AFTER_MS = 45 * 60 * 1000;
/**
 * What the rider is told the forecast came from: the agency by name, so the
 * "Fresh" claim has a source a rider can weigh (FT-06; replaces OGV-D-151's
 * anonymous label). The US-only coverage follows from the name.
 */
const SOURCE_LABEL = "National Weather Service";

export interface WeatherProviderResponse {
  readonly snapshot?: unknown;
  readonly unavailable?: boolean;
  readonly reason?: unknown;
  readonly retryable?: unknown;
}

export interface NwsWeatherProviderOptions {
  readonly fetcher?: typeof fetch;
  readonly path?: string;
  readonly now?: () => number;
}

export interface NwsWeatherProvider extends WeatherProvider {
  refresh(context: RoutePreparationContext): Promise<ProviderResult<WeatherData>>;
  snapshot(): WeatherSnapshot | null;
}

type OverlapWindow = { readonly start: string; readonly end?: string };

function instant(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Unknown alert or trip bounds never become an asserted overlap. */
export function alertOverlapsTripWindow(
  alert: WeatherAlert,
  tripWindow: OverlapWindow | null | undefined,
): boolean {
  if (tripWindow === undefined || tripWindow === null) return false;
  const tripStart = instant(tripWindow.start);
  const tripEnd = instant(tripWindow.end ?? tripWindow.start);
  const alertStart = instant(alert.onset);
  const alertEnd = instant(alert.ends);
  if (tripStart === null || tripEnd === null || tripStart > tripEnd) return false;
  if (alertStart === null || alertEnd === null || alertStart > alertEnd) return false;
  return alertStart <= tripEnd && alertEnd >= tripStart;
}

function formatClock(value: string, hour12 = true, timeZone = "UTC"): string {
  const parsed = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12,
    timeZone,
    timeZoneName: "short",
  }).format(parsed);
}

function formatUpdatedAge(fetchedAt: string, now: number): string {
  const ageMinutes = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 60_000));
  return ageMinutes === 0 ? "just now" : `${ageMinutes} min ago`;
}

function formatForecast(period: WeatherForecastPeriod): string {
  const parts = [period.shortForecast];
  if (period.temperatureF !== undefined) parts.push(`${Math.round(period.temperatureF)}°F`);
  if (period.windMph !== undefined) parts.push(`${Math.round(period.windMph)} mph wind`);
  if (period.precipChance !== undefined) parts.push(`${Math.round(period.precipChance)}% precip`);
  return parts.join(" · ");
}

function forecastOverlapsTripWindow(
  period: WeatherForecastPeriod,
  tripWindow: OverlapWindow | null | undefined,
): boolean {
  if (tripWindow === undefined || tripWindow === null) return false;
  const periodStart = instant(period.startTime);
  const periodEnd = instant(period.endTime);
  const tripStart = instant(tripWindow.start);
  const tripEnd = instant(tripWindow.end ?? tripWindow.start);
  return periodStart !== null && periodEnd !== null && tripStart !== null && tripEnd !== null
    && periodStart <= tripEnd && periodEnd >= tripStart;
}

function severityRank(severity: string): number {
  return {
    extreme: 5,
    severe: 4,
    moderate: 3,
    minor: 2,
    unknown: 1,
  }[severity.toLowerCase()] ?? 0;
}

function primaryAlert(alerts: readonly WeatherAlert[]): WeatherAlert | undefined {
  return [...alerts].sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
}

function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const alerts = record.alerts;
  const forecast = record.forecast;
  const validAlerts = Array.isArray(alerts) && alerts.every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const alert = entry as Record<string, unknown>;
    return typeof alert.event === "string"
      && alert.event.length > 0
      && typeof alert.severity === "string"
      && alert.severity.length > 0
      && (alert.onset === null || (typeof alert.onset === "string" && instant(alert.onset) !== null))
      && (alert.ends === null || (typeof alert.ends === "string" && instant(alert.ends) !== null))
      && typeof alert.area === "string"
      && alert.area.length > 0;
  });
  const validForecast = Array.isArray(forecast) && forecast.every((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const period = entry as Record<string, unknown>;
    return typeof period.name === "string"
      && period.name.length > 0
      && typeof period.startTime === "string"
      && instant(period.startTime) !== null
      && typeof period.endTime === "string"
      && instant(period.endTime) !== null
      && typeof period.shortForecast === "string"
      && period.shortForecast.length > 0
      && (period.temperatureF === undefined || (typeof period.temperatureF === "number" && Number.isFinite(period.temperatureF)))
      && (period.windMph === undefined || (typeof period.windMph === "number" && Number.isFinite(period.windMph)))
      && (period.precipChance === undefined || (typeof period.precipChance === "number" && Number.isFinite(period.precipChance) && period.precipChance >= 0 && period.precipChance <= 100));
  });
  return record.source === "nws"
    && typeof record.fetchedAt === "string"
    && instant(record.fetchedAt) !== null
    && validAlerts
    && validForecast
    && forecast.length > 0;
}

function unavailable(reason: string, provenance = SOURCE_LABEL): ProviderResult<WeatherData> {
  return { state: "unavailable", reason, provenance };
}

function locationFrom(context: RoutePreparationContext): { readonly lat: number; readonly lon: number } | null {
  const location = context.weatherLocation;
  if (location === undefined || location === null) return null;
  return Number.isFinite(location.lat) && Number.isFinite(location.lon) ? location : null;
}

function dataForSnapshot(snapshot: WeatherSnapshot, context: RoutePreparationContext, now: number): ProviderResult<WeatherData> {
  const fetched = Date.parse(snapshot.fetchedAt);
  const stale = now - fetched > STALE_AFTER_MS;
  const overlapping = context.tripWindow === undefined || context.tripWindow === null
    ? []
    : snapshot.alerts.filter((alert) => alertOverlapsTripWindow(alert, context.tripWindow));
  const tripWindowScoped = context.tripWindow !== undefined && context.tripWindow !== null;
  const forecastForDecision = tripWindowScoped
    ? snapshot.forecast.filter((period) => forecastOverlapsTripWindow(period, context.tripWindow))
    : snapshot.forecast;
  const alert = primaryAlert(overlapping);
  const firstForecast = snapshot.forecast[0];
  const age = formatUpdatedAge(snapshot.fetchedAt, now);
  let display = firstForecast === undefined ? "Forecast is unavailable." : formatForecast(firstForecast);
  let reason = stale
    ? "Weather data is older than 45 minutes; check before you ride."
    : "Forecast received for the selected route.";

  if (alert !== undefined) {
    const through = alert.ends === null
      ? "active; timing unavailable"
      : `through ${formatClock(alert.ends, true, context.riderTimeZone)}`;
    display = `${alert.event} — ${through} (updated ${age})`;
    reason = stale
      ? "A weather alert covers your trip window, but the weather data is stale; check before you ride."
      : "A weather alert covers your trip window; check before you ride.";
  } else if (context.tripWindow !== undefined && context.tripWindow !== null && snapshot.alerts.length > 0) {
    // An active alert with incomplete timing is not projected into the trip,
    // but it is also not silently treated as an all-clear.
    const unknownTiming = snapshot.alerts.some((entry) => entry.onset === null || entry.ends === null);
    if (unknownTiming) {
      display = `${display} · Active alert timing unavailable`;
      reason = `${reason} Active alert timing is unavailable; check before you ride.`;
    }
  }

  const validUntil = snapshot.forecast.at(-1)?.endTime;
  return {
    state: stale ? "stale" : "ready",
    reason,
    provenance: `Source: ${SOURCE_LABEL} · updated ${formatClock(snapshot.fetchedAt, false, context.riderTimeZone)}`,
    data: {
      display,
      source: "nws",
      fetchedAt: snapshot.fetchedAt,
      freshnessLabel: stale ? "Stale" : "Fresh",
      ageMinutes: Math.max(0, Math.floor((now - fetched) / 60_000)),
      alerts: snapshot.alerts,
      tripWindowScoped,
      ...(tripWindowScoped ? { tripAlerts: overlapping } : {}),
      ...(forecastForDecision.some((period) => period.precipChance !== undefined)
        ? { maxPrecipChance: Math.max(...forecastForDecision.map((period) => period.precipChance ?? 0)) }
        : {}),
      ...(forecastForDecision.some((period) => period.windMph !== undefined)
        ? { maxWindMph: Math.max(...forecastForDecision.map((period) => period.windMph ?? 0)) }
        : {}),
      ...(firstForecast === undefined ? {} : { validUntil: validUntil ?? firstForecast.endTime }),
      ...(alert === undefined ? {} : { primaryAlert: alert }),
    },
  };
}

export function createNwsWeatherProvider(options: NwsWeatherProviderOptions = {}): NwsWeatherProvider {
  const fetcher = options.fetcher ?? fetch;
  const path = options.path ?? WEATHER_PATH;
  const now = options.now ?? Date.now;
  let current: WeatherSnapshot | null = null;
  let lastResult: ProviderResult<WeatherData> | null = null;

  const capability = (): ProviderCapability => {
    if (lastResult?.state === "unavailable") {
      return {
        kind: "weather",
        availability: "unavailable",
        freshness: "time-bound",
        reason: lastResult.reason,
        provenance: lastResult.provenance,
      };
    }
    return {
      kind: "weather",
      availability: lastResult?.state === "stale" ? "degraded" : "available",
      freshness: "time-bound",
      reason: null,
      provenance: SOURCE_LABEL,
    };
  };

  const provider: NwsWeatherProvider = {
    id: "weather-nws",
    kind: "weather",
    capabilities: capability,
    snapshot: () => current,
    getWeather(context): ProviderResult<WeatherData> {
      if (current === null) return lastResult ?? unavailable("Weather is loading.");
      const result = dataForSnapshot(current, context, now());
      lastResult = result;
      return result;
    },
    async refresh(context): Promise<ProviderResult<WeatherData>> {
      const location = locationFrom(context);
      if (location === null) {
        lastResult = unavailable("Weather needs a route location.");
        return lastResult;
      }
      const query = `?lat=${encodeURIComponent(String(location.lat))}&lon=${encodeURIComponent(String(location.lon))}`;
      let response: Response;
      try {
        response = await fetcher(`${path}${query}`);
      } catch {
        lastResult = unavailable("Weather is unavailable right now.");
        return lastResult;
      }
      if (response.status === 404) {
        lastResult = unavailable("Weather needs the planning server.");
        return lastResult;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        lastResult = unavailable("Weather returned an unreadable response.");
        return lastResult;
      }
      if (!response.ok) {
        lastResult = unavailable("Weather is unavailable right now.");
        return lastResult;
      }
      const candidate = body as WeatherProviderResponse;
      if (!isWeatherSnapshot(candidate.snapshot)) {
        lastResult = unavailable(
          candidate.unavailable === true && typeof candidate.reason === "string"
            ? candidate.reason
            : "Weather returned an unreadable response.",
        );
        return lastResult;
      }
      current = candidate.snapshot;
      lastResult = dataForSnapshot(current, context, now());
      return lastResult;
    },
  };
  return provider;
}

export const createWeatherProvider = createNwsWeatherProvider;
