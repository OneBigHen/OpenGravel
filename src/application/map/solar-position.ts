/**
 * Where the sun is, for the map's own light (docs/vnext/design/MAP-EXPERIENCE-NEXT.md
 * Wave 3, item 10).
 *
 * The renderer needs an angle, not a sunrise time: hillshade relief, extruded
 * walls and the sky all read from one azimuth and one altitude for the map's
 * centre at the moment it is drawn. `calculateSunset`/`sunState` in
 * `application/long-trip` answer "is the sun up, and when does it set" through
 * NOAA's sunrise/sunset approximation, which solves for a horizon crossing and
 * has no position to give. This module is the other half of the same NOAA
 * bodies: the general solar position calculation (spreadsheet form, accurate to
 * about 0.01°), kept pure so it reads no clock and can be tested against known
 * angles.
 *
 * Three boundaries are deliberate:
 *
 * - **Unknown is `null`, never a guess.** A malformed coordinate or instant has
 *   no position, and the caller keeps its own fallback light rather than being
 *   handed a plausible-looking 0°/0°.
 * - **No refraction, no horizon correction.** The altitude is the geometric
 *   angle of the sun's centre, so horizon-crossing callers keep their own
 *   -0.833° convention (`calculateSunset` already owns that). The map only needs
 *   to know how low the light is, and 0° is the right line for "at the horizon".
 * - **No timezone.** Everything is derived from the UTC instant and longitude,
 *   which is what makes the result independent of the device's clock settings.
 */

import type { Coordinate } from "@/domain/ride/types";

const DAY_MS = 86_400_000;
/** Julian day of the Unix epoch, so a UTC instant converts with one addition. */
const JULIAN_DAY_UNIX_EPOCH = 2_440_587.5;
/** Julian day of J2000.0, the epoch the NOAA century series is measured from. */
const JULIAN_DAY_J2000 = 2_451_545;

function radians(value: number): number {
  return value * Math.PI / 180;
}

function degrees(value: number): number {
  return value * 180 / Math.PI;
}

function normalizedDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function clamped(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** The sun's position over one place at one instant. */
export interface SolarPosition {
  /** The compass bearing of the sun, degrees clockwise from true north, 0–360. */
  readonly azimuth: number;
  /** How high the sun is above the horizon in degrees; negative means below it. */
  readonly altitude: number;
}

/**
 * The sun over `coordinate` at `instantMs` (epoch milliseconds), or `null` when
 * the coordinate or instant is not a real one.
 *
 * The equations are NOAA's general solar position calculation: mean longitude
 * and anomaly from the Julian century, the equation of the centre, apparent
 * longitude and obliquity, declination and the equation of time, then the true
 * solar hour angle. The azimuth follows NOAA's own convention — degrees
 * clockwise from north, so 90° is east and 270° is west — which is also the
 * convention MapLibre's light and `hillshade-illumination-direction` use, so no
 * rotation is applied downstream.
 */
export function solarPositionAt(
  coordinate: Coordinate,
  instantMs: number,
): SolarPosition | null {
  if (
    !Number.isFinite(instantMs)
    || !Number.isFinite(coordinate.lat)
    || !Number.isFinite(coordinate.lon)
    || coordinate.lat < -90
    || coordinate.lat > 90
    || coordinate.lon < -180
    || coordinate.lon > 180
  ) return null;

  const julianDay = instantMs / DAY_MS + JULIAN_DAY_UNIX_EPOCH;
  const century = (julianDay - JULIAN_DAY_J2000) / 36525;

  const meanLongitude = normalizedDegrees(
    280.46646 + century * (36000.76983 + century * 0.0003032),
  );
  const meanAnomaly = 357.52911 + century * (35999.05029 - 0.0001537 * century);
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century);
  const anomaly = radians(meanAnomaly);
  const equationOfCentre =
    Math.sin(anomaly) * (1.914602 - century * (0.004817 + 0.000014 * century))
    + Math.sin(2 * anomaly) * (0.019993 - 0.000101 * century)
    + Math.sin(3 * anomaly) * 0.000289;
  const trueLongitude = meanLongitude + equationOfCentre;
  const ascendingNode = radians(125.04 - 1934.136 * century);
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(ascendingNode);
  const meanObliquity =
    23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(ascendingNode);

  const declination = degrees(
    Math.asin(Math.sin(radians(obliquity)) * Math.sin(radians(apparentLongitude))),
  );

  // The equation of time, in minutes: how far the true sun runs ahead of the
  // mean one. Longitude then converts clock time into the observer's solar time.
  const y = Math.tan(radians(obliquity) / 2) ** 2;
  const equationOfTime = 4 * degrees(
    y * Math.sin(2 * radians(meanLongitude))
    - 2 * eccentricity * Math.sin(anomaly)
    + 4 * eccentricity * y * Math.sin(anomaly) * Math.cos(2 * radians(meanLongitude))
    - 0.5 * y * y * Math.sin(4 * radians(meanLongitude))
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * anomaly),
  );

  const minutesUtc = (((instantMs % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;
  const trueSolarTime = (((minutesUtc + equationOfTime + 4 * coordinate.lon) % 1440) + 1440) % 1440;
  // True solar time runs 0–1440 minutes from the observer's midnight; shifted by
  // 180° it becomes the hour angle, negative before solar noon.
  const hourAngle = trueSolarTime / 4 - 180;

  const latitude = radians(coordinate.lat);
  const declinationRadians = radians(declination);
  const cosineZenith = clamped(
    Math.sin(latitude) * Math.sin(declinationRadians)
      + Math.cos(latitude) * Math.cos(declinationRadians) * Math.cos(radians(hourAngle)),
    -1,
    1,
  );
  const zenith = degrees(Math.acos(cosineZenith));

  // Directly overhead the azimuth is undefined; NOAA's denominator vanishes and
  // the hour angle alone says which side of north to fall back to.
  const denominator = Math.cos(latitude) * Math.sin(radians(zenith));
  let azimuth: number;
  if (Math.abs(denominator) < 1e-9) {
    azimuth = hourAngle > 0 ? 180 : 0;
  } else {
    const cosineAzimuth = clamped(
      (Math.sin(latitude) * Math.cos(radians(zenith)) - Math.sin(declinationRadians)) / denominator,
      -1,
      1,
    );
    const fromSouth = degrees(Math.acos(cosineAzimuth));
    azimuth = normalizedDegrees(hourAngle > 0 ? fromSouth + 180 : 540 - fromSouth);
  }

  return { azimuth, altitude: 90 - zenith };
}
