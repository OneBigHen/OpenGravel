/**
 * Weather along the route (MAP-EXPERIENCE-NEXT Wave 2, item 7).
 *
 * A rider's weather question is not "what is it like at map centre" but "what
 * will I ride into at mile 38, and when will I be there". This module is the
 * pure half of that answer: it places a handful of points at even distance
 * along the route, gives each one the time the rider is expected to reach it,
 * and turns the rain chances those points end up carrying into one headline.
 * It contains no provider call and no clock of its own, so the sampler and the
 * wording can be read and tested without the network.
 *
 * Two rules keep it honest:
 *
 * - **A sample's time comes from the route's own duration.** The profile below
 *   is the measured total spread over the measured distance; a caller with a
 *   richer profile (a provider that knows the slow climb) can pass it in.
 * - **Unknown is never dry.** A sample with no forecast keeps every weather
 *   field `null`, and "Dry the whole way" is said only when every sample has an
 *   actual rain chance below the threshold. A headline never names a clock time
 *   in a time zone it was not given.
 */

import type { WeatherForecastPeriod } from "@/application/preparation/providers";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

const METERS_PER_MILE = 1609.344;

/** Six points is a strip a rider can read at a glance on a phone. */
export const ROUTE_WEATHER_SAMPLES = 6;
/**
 * At or above this chance a sample is rain for the headline, not a maybe. The
 * point forecast already starts mentioning rain at 20%, and a headline that
 * stayed quiet about it would be the more misleading of the two.
 */
export const ROUTE_RAIN_CHANCE_PCT = 20;
/**
 * How far outside a forecast period an ETA may sit and still borrow it. NWS
 * hourly periods start on the hour, so a departure at 2:53 PM has no period of
 * its own yet; half an hour is closer than the forecast's own resolution.
 */
const FORECAST_SNAP_MS = 30 * 60 * 1000;

/** One stop of a duration profile: distance along the route, time elapsed there. */
export interface DurationProfileStop {
  readonly distanceMeters: number;
  readonly elapsedSeconds: number;
}

/**
 * How long the ride takes to reach a given distance along it. Stops are in
 * travel order; between two stops the time is interpolated, never invented.
 */
export interface RouteDurationProfile {
  readonly stops: readonly DurationProfileStop[];
}

/**
 * The profile of a route that measured one total duration: time spreads evenly
 * over distance. `null` when the route did not measure enough to place a time.
 */
export function evenDurationProfile(
  distanceMeters: number,
  durationSeconds: number,
): RouteDurationProfile | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  return {
    stops: [
      { distanceMeters: 0, elapsedSeconds: 0 },
      { distanceMeters, elapsedSeconds: durationSeconds },
    ],
  };
}

/** Seconds into the ride at `distanceMeters`, or `null` when the profile cannot say. */
export function elapsedSecondsAt(
  profile: RouteDurationProfile,
  distanceMeters: number,
): number | null {
  const stops = profile.stops;
  if (stops.length < 2 || !Number.isFinite(distanceMeters)) return null;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (!Number.isFinite(first.distanceMeters) || !Number.isFinite(last.distanceMeters)) return null;
  if (last.distanceMeters <= first.distanceMeters) return null;
  if (distanceMeters <= first.distanceMeters) return first.elapsedSeconds;
  if (distanceMeters >= last.distanceMeters) return last.elapsedSeconds;
  for (let index = 1; index < stops.length; index += 1) {
    const before = stops[index - 1]!;
    const after = stops[index]!;
    if (distanceMeters > after.distanceMeters) continue;
    const span = after.distanceMeters - before.distanceMeters;
    if (span <= 0) return after.elapsedSeconds;
    const share = Math.min(1, Math.max(0, (distanceMeters - before.distanceMeters) / span));
    return before.elapsedSeconds + (after.elapsedSeconds - before.elapsedSeconds) * share;
  }
  return last.elapsedSeconds;
}

/** Length of a line in meters; duplicate vertices add nothing. */
export function routeLineMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) {
    total += haversine(line[index - 1]!, line[index]!);
  }
  return total;
}

/** One place along the route and the time the rider reaches it. */
export interface RouteWeatherPoint {
  readonly coordinate: Coordinate;
  /** Distance from the start of the line, in meters. */
  readonly alongMeters: number;
  /** The same distance in miles, one decimal, as the strip labels it. */
  readonly mile: number;
  /** Seconds into the ride, or `null` when the duration profile cannot say. */
  readonly elapsedSeconds: number | null;
  /** The instant the rider is there, ISO 8601, or `null` when it is unknown. */
  readonly eta: string | null;
}

export interface RouteWeatherSampleInput {
  readonly line: readonly Coordinate[];
  /** The route's duration profile, or `null` when it has no usable duration. */
  readonly durationProfile: RouteDurationProfile | null;
  /** Epoch milliseconds of departure; `null` leaves every ETA unknown. */
  readonly departureMs: number | null;
  /** Points to place, both ends included. Defaults to {@link ROUTE_WEATHER_SAMPLES}. */
  readonly count?: number;
}

/**
 * `count` points at even distance along the line (both ends included), each
 * with its ETA from the duration profile. Empty when the line has no length.
 */
export function sampleRouteWeatherPoints(
  input: RouteWeatherSampleInput,
): readonly RouteWeatherPoint[] {
  const { line, durationProfile, departureMs } = input;
  const count = input.count ?? ROUTE_WEATHER_SAMPLES;
  if (line.length < 2 || !Number.isSafeInteger(count) || count < 2) return [];
  const cumulative: number[] = [0];
  for (let index = 1; index < line.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + haversine(line[index - 1]!, line[index]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (!Number.isFinite(total) || total <= 0) return [];
  const points: RouteWeatherPoint[] = [];
  let segment = 1;
  for (let step = 0; step < count; step += 1) {
    const target = (total * step) / (count - 1);
    while (segment < line.length - 1 && cumulative[segment]! < target) segment += 1;
    const start = cumulative[segment - 1]!;
    const length = cumulative[segment]! - start;
    const t = length <= 0 ? 0 : Math.min(1, Math.max(0, (target - start) / length));
    const a = line[segment - 1]!;
    const b = line[segment]!;
    const elapsed = durationProfile === null ? null : elapsedSecondsAt(durationProfile, target);
    points.push({
      coordinate: { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t },
      alongMeters: target,
      mile: Math.round((target / METERS_PER_MILE) * 10) / 10,
      elapsedSeconds: elapsed,
      eta:
        elapsed === null || departureMs === null || !Number.isFinite(departureMs)
          ? null
          : new Date(departureMs + elapsed * 1000).toISOString(),
    });
  }
  return points;
}

/** The sample's weather. Every field is `null` when the forecast is unknown. */
export interface RouteWeatherReading {
  readonly tempF: number | null;
  readonly rainChancePct: number | null;
  readonly windMph: number | null;
  readonly shortForecast: string | null;
}

/** One point of the answer: where, when, and what the sky is doing there. */
export interface RouteWeatherSample extends RouteWeatherPoint, RouteWeatherReading {}

/** What `/api/weather/route` answers. */
export interface RouteWeatherReport {
  readonly source: "nws";
  readonly samples: readonly RouteWeatherSample[];
  readonly headline: string;
  /** False when no sample found a forecast, so the strip shows no invented sky. */
  readonly forecastAvailable: boolean;
}

const UNKNOWN_READING: RouteWeatherReading = {
  tempF: null,
  rainChancePct: null,
  windMph: null,
  shortForecast: null,
};

/** The reading a forecast period carries, or all-unknown when there is none. */
export function routeWeatherReading(
  period: WeatherForecastPeriod | null | undefined,
): RouteWeatherReading {
  if (period === null || period === undefined) return UNKNOWN_READING;
  const temperature = period.temperatureF;
  const rain = period.precipChance;
  const wind = period.windMph;
  return {
    tempF: typeof temperature === "number" && Number.isFinite(temperature) ? temperature : null,
    rainChancePct: typeof rain === "number" && Number.isFinite(rain) ? rain : null,
    windMph: typeof wind === "number" && Number.isFinite(wind) ? wind : null,
    shortForecast: period.shortForecast,
  };
}

/**
 * The hourly period that covers `instantMs`. A period within
 * {@link FORECAST_SNAP_MS} counts, because the hourly grid starts on the hour;
 * further away there is no honest answer and this returns `null`.
 */
export function forecastForInstant(
  periods: readonly WeatherForecastPeriod[],
  instantMs: number,
): WeatherForecastPeriod | null {
  if (!Number.isFinite(instantMs)) return null;
  let nearest: { readonly period: WeatherForecastPeriod; readonly distanceMs: number } | null = null;
  for (const period of periods) {
    const start = Date.parse(period.startTime);
    const end = Date.parse(period.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (instantMs >= start && instantMs < end) return period;
    const distanceMs = instantMs < start ? start - instantMs : instantMs - end;
    if (nearest === null || distanceMs < nearest.distanceMs) nearest = { period, distanceMs };
  }
  return nearest !== null && nearest.distanceMs <= FORECAST_SNAP_MS ? nearest.period : null;
}

/** True for an IANA time zone `Intl` accepts, so a headline never guesses one. */
export function isKnownTimeZone(value: string): boolean {
  if (value.trim() === "" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The ETA as the headline says it — the local hour, rounded to the nearest one
 * ("3 PM"), or `null` when the instant or the time zone is unknown. Rounding is
 * why the wording is "around": a forecast is not a minute-accurate promise.
 */
export function routeWeatherHourLabel(eta: string | null, timeZone: string | null): string | null {
  if (eta === null || timeZone === null || !isKnownTimeZone(timeZone)) return null;
  const instant = Date.parse(eta);
  if (!Number.isFinite(instant)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(new Date(instant));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const rounded = (hour + (minute >= 30 ? 1 : 0)) % 24;
  const display = rounded % 12 === 0 ? 12 : rounded % 12;
  return `${display} ${rounded < 12 ? "AM" : "PM"}`;
}

/** The part of a sample the headline is worded from. */
export interface RouteWeatherHeadlineSample {
  readonly mile: number;
  readonly eta: string | null;
  readonly rainChancePct: number | null;
}

export interface RouteWeatherHeadlineInput {
  readonly samples: readonly RouteWeatherHeadlineSample[];
  /** The rider's IANA zone; without one the headline states no clock time. */
  readonly timeZone?: string | null;
}

interface RainRun {
  readonly start: number;
  readonly end: number;
}

function rainRuns(rainy: readonly boolean[]): readonly RainRun[] {
  const runs: RainRun[] = [];
  let start: number | null = null;
  rainy.forEach((isRainy, index) => {
    if (isRainy && start === null) start = index;
    if (!isRainy && start !== null) {
      runs.push({ start, end: index - 1 });
      start = null;
    }
  });
  if (start !== null) runs.push({ start, end: rainy.length - 1 });
  return runs;
}

function mileLabel(sample: RouteWeatherHeadlineSample): string {
  return String(Math.round(sample.mile));
}

function aroundLabel(sample: RouteWeatherHeadlineSample, timeZone: string | null): string {
  const hour = routeWeatherHourLabel(sample.eta, timeZone);
  return hour === null ? "" : ` around ${hour}`;
}

/**
 * One sentence a rider can act on: "Rain from mile 38 around 3 PM", "Dry the
 * whole way", "Showers on and off along the route". Every branch that claims
 * rain names where it starts; every branch that claims dry requires a rain
 * chance at every sample, so an unknown forecast is never reported as clear.
 */
export function routeWeatherHeadline(input: RouteWeatherHeadlineInput): string {
  const { samples } = input;
  const timeZone = input.timeZone ?? null;
  if (samples.length === 0) return "No route to check the weather along";
  const known = samples.filter((sample) => sample.rainChancePct !== null);
  if (known.length === 0) return "Forecast along the route is unavailable";
  const rainy = samples.map(
    (sample) => sample.rainChancePct !== null && sample.rainChancePct >= ROUTE_RAIN_CHANCE_PCT,
  );
  const runs = rainRuns(rainy);
  const last = samples.length - 1;

  if (runs.length === 0) {
    return known.length === samples.length
      ? "Dry the whole way"
      : "Mostly dry, but part of the route has no forecast";
  }
  if (runs.length > 1) return "Showers on and off along the route";

  const run = runs[0]!;
  if (run.start === 0 && run.end === last) return "Rain the whole way";
  if (run.start === 0) {
    const clears = samples[run.end + 1];
    const after = clears === undefined ? "" : `, easing after mile ${mileLabel(clears)}`;
    return `Rain at the start${aroundLabel(samples[0]!, timeZone)}${after}`;
  }
  const rain = `Rain from mile ${mileLabel(samples[run.start]!)}${aroundLabel(samples[run.start]!, timeZone)}`;
  if (run.end === last) return rain;
  const easing = samples[run.end + 1];
  return easing === undefined ? rain : `${rain}, easing by mile ${mileLabel(easing)}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSample(value: unknown): value is RouteWeatherSample {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const sample = value as Record<string, unknown>;
  const coordinate = sample["coordinate"];
  if (typeof coordinate !== "object" || coordinate === null || Array.isArray(coordinate)) return false;
  const point = coordinate as Record<string, unknown>;
  return isFiniteNumber(point["lon"])
    && isFiniteNumber(point["lat"])
    && isFiniteNumber(sample["alongMeters"])
    && isFiniteNumber(sample["mile"])
    && (sample["eta"] === null || (typeof sample["eta"] === "string" && Number.isFinite(Date.parse(sample["eta"]))))
    && (sample["elapsedSeconds"] === null || isFiniteNumber(sample["elapsedSeconds"]))
    && (sample["tempF"] === null || isFiniteNumber(sample["tempF"]))
    && (sample["rainChancePct"] === null || isFiniteNumber(sample["rainChancePct"]))
    && (sample["windMph"] === null || isFiniteNumber(sample["windMph"]))
    && (sample["shortForecast"] === null || typeof sample["shortForecast"] === "string");
}

/** Validation at the API boundary: an unreadable report is unavailable, not dry. */
export function isRouteWeatherReport(value: unknown): value is RouteWeatherReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return report["source"] === "nws"
    && Array.isArray(report["samples"])
    && report["samples"].every(isSample)
    && typeof report["headline"] === "string"
    && report["headline"].length > 0
    && typeof report["forecastAvailable"] === "boolean";
}
