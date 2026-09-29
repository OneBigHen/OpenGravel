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

/**
 * Calculate sunset in UTC using NOAA's sunrise/sunset approximation.
 * The result is a fact, not a promise that the route can be ridden safely at
 * night; callers still compare it with the authored departure and duration.
 */
export function calculateSunset(
  coordinate: Coordinate,
  departureAt: string,
): LongTripDaylightFact | null {
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
  const approximateTime = ordinal + ((18 - longitudeHour) / 24);
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

  const hourAngle = degrees(Math.acos(cosineHourAngle)) / 15;
  const localMeanTime = hourAngle + rightAscension - (0.06571 * approximateTime) - 6.622;
  const utcHour = normalizedHours(localMeanTime - longitudeHour);
  const sunset = new Date(Date.UTC(year, month, day) + utcHour * 3_600_000);

  return {
    sunset: sunset.toISOString(),
    source: "NOAA solar calculation",
    sourceRef: `daylight:solar:${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}:${String(coordinate.lat)}:${String(coordinate.lon)}`,
  };
}
