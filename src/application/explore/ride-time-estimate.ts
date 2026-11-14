/**
 * The one ride-time estimate for a ride nobody timed: a catalog route with no
 * published time, an imported track with no timestamps, a weekend card.
 *
 * The pace is the app's own rule (28 mph, the figure the ride page states). The
 * rounding has to be useful at both ends of the scale: a two-mile rural track
 * rounded to a quarter hour read "15 min" for 2.9 mi (11 mph), which is not a
 * number a rider recognizes. So short estimates are rounded to the minute and
 * longer ones to five minutes, which still never reads as a measurement.
 *
 * The number is exposed in minutes (cards) and seconds (the planner's answer),
 * and every surface reads this module, so one ride cannot show two times.
 */

const KM_PER_MILE = 1.609344;

/** The mileage pace an untimed ride is estimated at. */
export const RIDE_TIME_PACE_MPH = 28;

/** Up to this many minutes, the estimate is rounded to the nearest minute. */
const MINUTE_STEP_BELOW_MINUTES = 30;
/** Above it, to the nearest five minutes. */
const COARSE_STEP_MINUTES = 5;

/** The estimated ride time in minutes for a distance in miles, or `null`. */
export function estimatedRideMinutesForMiles(miles: number | null | undefined): number | null {
  if (miles === null || miles === undefined || !Number.isFinite(miles) || miles <= 0) return null;
  const minutes = (miles / RIDE_TIME_PACE_MPH) * 60;
  if (!(minutes > 0)) return null;
  if (minutes < MINUTE_STEP_BELOW_MINUTES) return Math.max(1, Math.round(minutes));
  return Math.round(minutes / COARSE_STEP_MINUTES) * COARSE_STEP_MINUTES;
}

/** The estimated ride time in minutes for a distance in kilometres, or `null`. */
export function estimatedRideMinutes(distanceKm: number | null | undefined): number | null {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  return estimatedRideMinutesForMiles(distanceKm / KM_PER_MILE);
}

/** The same estimate in seconds, for a ride whose length is known. */
export function estimatedRideSeconds(distanceMeters: number): number {
  const minutes = estimatedRideMinutes(Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null) ?? 1;
  return minutes * 60;
}
