import { sunsetOnDepartureDay } from "@/application/long-trip/daylight";
import type { Coordinate } from "@/domain/ride/types";

/**
 * How long a loop may be if the rider wants to be home before dark.
 *
 * The value is the daylight left at the start point today, minus a margin, and
 * it is a *budget* like any other loop time — the router still decides what the
 * ride is; the sun only bounds how long it should take. No sunset is a fact
 * this module can state (polar day, polar night, an unknown start), so the
 * result is `null` and the picker offers no such chip rather than inventing a
 * duration.
 */

/** Daylight kept between the end of the loop and sunset, in minutes. */
export const SUNSET_LOOP_MARGIN_MINUTES = 20;

/** Below this, "before dark" is not a useful loop; the chip stays hidden. */
export const SUNSET_LOOP_MINIMUM_MINUTES = 45;

const ROUNDING_MINUTES = 5;
const MINUTE_MS = 60_000;

/**
 * Loop minutes that end `now`'s day with `SUNSET_LOOP_MARGIN_MINUTES` of light
 * to spare, rounded down to five minutes and capped at `maxMinutes`.
 *
 * Pure: the caller supplies the clock, and the sunset comes from the shared
 * NOAA calculation in `application/long-trip/daylight.ts`. `null` means there
 * is nothing truthful to offer (no start point, no sunset, or too little
 * daylight for even the shortest loop).
 */
export function loopMinutesUntilSunset(input: {
  readonly coordinate: Coordinate | null;
  readonly now: Date;
  readonly maxMinutes: number;
}): number | null {
  const { coordinate, now, maxMinutes } = input;
  if (coordinate === null || !Number.isFinite(now.getTime())) return null;
  const daylight = sunsetOnDepartureDay(coordinate, now.toISOString());
  if (daylight === null) return null;

  const daylightMinutes = Math.floor((Date.parse(daylight.sunset) - now.getTime()) / MINUTE_MS);
  const riddenMinutes = Math.floor(
    (daylightMinutes - SUNSET_LOOP_MARGIN_MINUTES) / ROUNDING_MINUTES,
  ) * ROUNDING_MINUTES;
  const minutes = Math.min(riddenMinutes, maxMinutes);
  return minutes < SUNSET_LOOP_MINIMUM_MINUTES ? null : minutes;
}
