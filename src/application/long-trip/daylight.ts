import type { Coordinate } from "@/domain/ride/types";

import type { LongTripDaylightFact } from "./index";

const DAY_MS = 86_400_000;

function radians(value: number): number {
  return value * Math.PI / 180;
}

function degrees(value: number): number {
  return value * 180 / Math.PI;
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizedHours(value: number): number {
  return ((value % 24) + 24) % 24;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / DAY_MS) + 1;
}

/** The two horizon crossings the NOAA approximation can resolve. */
type SolarEvent = "sunrise" | "sunset";

/**
 * One horizon crossing in UTC, using NOAA's sunrise/sunset approximation.
 *
 * `event` picks which side of noon the hour angle is read from: sunset keeps
 * the afternoon estimate, sunrise the morning one. The result is a fact, not a
 * promise that a route can be ridden in the dark; callers still compare it with
 * the authored departure and duration.
 */
function solarEvent(
  coordinate: Coordinate,
  departureAt: string,
  event: SolarEvent,
): { readonly at: string; readonly sourceRef: string } | null {
  const date = new Date(departureAt);
  if (
    !Number.isFinite(date.getTime())
    || !Number.isFinite(coordinate.lat)
    || !Number.isFinite(coordinate.lon)
    || coordinate.lat < -90
    || coordinate.lat > 90
    || coordinate.lon < -180
    || coordinate.lon > 180
  ) return null;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const ordinal = dayOfYear(date);
  const longitudeHour = coordinate.lon / 15;
  const approximateTime = ordinal + (((event === "sunrise" ? 6 : 18) - longitudeHour) / 24);
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  const sunLongitude = normalizedDegrees(
    meanAnomaly
      + (1.916 * Math.sin(radians(meanAnomaly)))
      + (0.020 * Math.sin(radians(2 * meanAnomaly)))
      + 282.634,
  );
  let rightAscension = degrees(Math.atan(0.91764 * Math.tan(radians(sunLongitude))));
  rightAscension = normalizedDegrees(rightAscension);
  const longitudeQuadrant = Math.floor(sunLongitude / 90) * 90;
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15;

  const sineDeclination = 0.39782 * Math.sin(radians(sunLongitude));
  const cosineDeclination = Math.cos(Math.asin(sineDeclination));
  const cosineHourAngle = (
    Math.cos(radians(90.833))
      - (sineDeclination * Math.sin(radians(coordinate.lat)))
  ) / (cosineDeclination * Math.cos(radians(coordinate.lat)));
  if (cosineHourAngle > 1 || cosineHourAngle < -1) return null;

  const hourAngle = (event === "sunrise" ? -1 : 1) * degrees(Math.acos(cosineHourAngle)) / 15;
  const localMeanTime = hourAngle + rightAscension - (0.06571 * approximateTime) - 6.622;
  const utcHour = normalizedHours(localMeanTime - longitudeHour);
  const crossing = new Date(Date.UTC(year, month, day) + utcHour * 3_600_000);
  return {
    at: crossing.toISOString(),
    sourceRef: `daylight:solar:${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}:${String(coordinate.lat)}:${String(coordinate.lon)}`,
  };
}

/** Calculate sunset in UTC using NOAA's sunrise/sunset approximation. */
export function calculateSunset(
  coordinate: Coordinate,
  departureAt: string,
): LongTripDaylightFact | null {
  const event = solarEvent(coordinate, departureAt, "sunset");
  if (event === null) return null;
  return {
    sunset: event.at,
    source: "NOAA solar calculation",
    sourceRef: event.sourceRef,
  };
}

/**
 * Sunrise in UTC, the morning mirror of {@link calculateSunset}: the instant
 * the sun is due to clear the horizon at this coordinate, or `null` when the
 * approximation cannot resolve one (a polar day or night).
 */
export function calculateSunrise(coordinate: Coordinate, departureAt: string): string | null {
  return solarEvent(coordinate, departureAt, "sunrise")?.at ?? null;
}

/** Whether the sun is up, or unknown. */
export type SunState = "day" | "night";

/**
 * The solar-local calendar date of `nowMs` at `coordinate`, as a midday UTC
 * instant.
 *
 * `calculateSunset`/`calculateSunrise` read only the date part of what they are
 * given, and shift it by the coordinate's own longitude internally; handing
 * them this date lands on the observer's own day rather than on the UTC one,
 * which for the Americas is a day off for most of the evening.
 */
function solarLocalNoon(coordinate: Coordinate, nowMs: number): string {
  const offsetMs = (coordinate.lon / 15) * 3_600_000;
  const local = new Date(nowMs + offsetMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 12)).toISOString();
}

/**
 * Is the sun up at `coordinate` at `nowMs`?
 *
 * `null` — never a guess — when the calculation cannot answer: a polar day or
 * night (no horizon crossing to compare against), or a coordinate and time that
 * are not real. A caller that needs a theme falls back to the device's own
 * light/dark setting rather than inventing daylight.
 */
export function sunState(coordinate: Coordinate, nowMs: number): SunState | null {
  if (!Number.isFinite(nowMs)) return null;
  const day = solarLocalNoon(coordinate, nowMs);
  const sunrise = calculateSunrise(coordinate, day);
  const sunset = calculateSunset(coordinate, day);
  if (sunrise === null || sunset === null) return null;
  const sunriseMs = Date.parse(sunrise);
  const sunsetMs = Date.parse(sunset.sunset);
  if (!Number.isFinite(sunriseMs) || !Number.isFinite(sunsetMs) || sunsetMs <= sunriseMs) return null;
  return nowMs < sunriseMs || nowMs >= sunsetMs ? "night" : "day";
}

/**
 * The sunset of the rider's own day at `coordinate`.
 *
 * `calculateSunset` works on the UTC calendar date, which for the Americas is
 * the *previous* evening for a morning departure (a 10 AM EDT start got last
 * night's sunset, and every western long ride then looked like it finished in
 * the dark). The departure's solar-local day is found from longitude, and of
 * the sunsets computed for the neighbouring UTC dates the one nearest that
 * day's late afternoon wins.
 */
export function sunsetOnDepartureDay(
  coordinate: Coordinate,
  departureAt: string,
): LongTripDaylightFact | null {
  const departure = Date.parse(departureAt);
  if (!Number.isFinite(departure)) return null;
  const offsetMs = (coordinate.lon / 15) * 3_600_000;
  const solarLocal = new Date(departure + offsetMs);
  const solarNoonUtc =
    Date.UTC(solarLocal.getUTCFullYear(), solarLocal.getUTCMonth(), solarLocal.getUTCDate(), 12) - offsetMs;
  const target = solarNoonUtc + 6 * 3_600_000;
  let best: LongTripDaylightFact | null = null;
  for (const shiftHours of [-24, 0, 24]) {
    const fact = calculateSunset(coordinate, new Date(solarNoonUtc + shiftHours * 3_600_000).toISOString());
    if (fact === null) continue;
    if (best === null || Math.abs(Date.parse(fact.sunset) - target) < Math.abs(Date.parse(best.sunset) - target)) {
      best = fact;
    }
  }
  return best;
}
