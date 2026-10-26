/**
 * Place search answers, ordered against the ride (maps-for-riders §3).
 *
 * A maps app lists search results by "best match"; a rider already riding a line
 * asks a narrower question — *where is it relative to me?* — so every answer is
 * measured on the ride's own line:
 *
 * - **On a guided ride** a place is placed by the distance along the line ahead
 *   of the rider (`projectAlong`), so the list reads in riding order, and the
 *   estimate of what stopping there costs is derived from the line's own
 *   remaining distance and time, not from a guess about road speed.
 * - **In Free Ride there is no line**, so distance from the rider is the only
 *   honest order, and it is stated as "away" rather than "ahead".
 * - **Unknown stays unknown.** Without a fix, or with a line too short to
 *   project onto, a row carries no distance at all instead of a made-up zero;
 *   without a measured ride time there is no "+N min" at all.
 *
 * Nothing here invents a place, an opening state or a legal status: it only
 * reorders what the geocoder already returned.
 */

import { METERS_PER_MILE, haversineMeters, projectAlong, type LngLat } from "@/application/map-layers";
import type { PlaceMatch } from "@/application/geocoding/place-search";
import type { Coordinate } from "@/domain/ride/types";

/** How many answers the ride's search list shows: enough to choose, not a page. */
export const ALONG_RIDE_RESULT_LIMIT = 6;

/** A place one of these is behind the rider; closer than this is "here". */
const BESIDE_METERS = 150;

/** One search answer, measured against the ride. */
export interface AlongRidePlace {
  readonly place: PlaceMatch;
  /**
   * Metres along the line ahead of the rider. Negative when the place is behind
   * the rider along the line; `null` when the ride has no line to measure on.
   */
  readonly aheadMeters: number | null;
  /** How far off the line the place is, in metres; `null` without a line. */
  readonly offMeters: number | null;
  /** Straight-line metres from the rider, for a ride with no line; else `null`. */
  readonly awayMeters: number | null;
  /**
   * Estimated extra minutes the stop adds, at the ride's own remaining pace, or
   * `null` when the ride cannot measure it (no remaining time/distance, or a
   * place behind the rider where "extra" is not two trips off the line).
   */
  readonly extraMinutes: number | null;
}

export interface AlongRidePlaceInput {
  readonly places: readonly PlaceMatch[];
  /** The line the rider is following; empty (or one point) in Free Ride. */
  readonly line: readonly Coordinate[];
  readonly position: Coordinate | null;
  /** The ride's own measured distance and time left, for the detour estimate. */
  readonly remainingMeters?: number | null;
  readonly remainingSeconds?: number | null;
}

function lngLat(coordinate: Coordinate): LngLat {
  return [coordinate.lon, coordinate.lat];
}

/**
 * The ride's own average pace over what is left of it, in metres per second.
 * `null` unless both measurements exist and are positive: an unmeasured ride
 * does not get a guessed speed.
 */
export function remainingPaceMetersPerSecond(
  remainingMeters: number | null | undefined,
  remainingSeconds: number | null | undefined,
): number | null {
  if (remainingMeters === null || remainingMeters === undefined) return null;
  if (remainingSeconds === null || remainingSeconds === undefined) return null;
  if (!Number.isFinite(remainingMeters) || !Number.isFinite(remainingSeconds)) return null;
  if (remainingMeters <= 0 || remainingSeconds <= 0) return null;
  return remainingMeters / remainingSeconds;
}

/**
 * Extra minutes for a place `offMeters` off the line, at `pace`: out to it and
 * back onto the road, rounded to the minute a rider thinks in.
 *
 * `0` is returned as `0` rather than `null` — the stop is on the road and costs
 * nothing — and the surface prints nothing for it, because "+0 min" is noise.
 */
export function detourMinutes(
  offMeters: number | null,
  paceMetersPerSecond: number | null,
): number | null {
  if (offMeters === null || paceMetersPerSecond === null) return null;
  if (!Number.isFinite(offMeters) || !Number.isFinite(paceMetersPerSecond)) return null;
  if (offMeters < BESIDE_METERS) return 0;
  if (paceMetersPerSecond <= 0) return null;
  return Math.max(1, Math.round((2 * offMeters) / paceMetersPerSecond / 60));
}

/**
 * The answers in the order a rider meets them: ahead first, nearest first, and
 * anything behind the rider last. With no line, nearest to the rider first.
 * With no fix either, the geocoder's own ranking is kept untouched.
 */
export function alongRidePlaces(input: AlongRidePlaceInput): readonly AlongRidePlace[] {
  const { places, position } = input;
  const line = input.line.map(lngLat);
  const onLine = line.length >= 2 && position !== null;
  const pace = remainingPaceMetersPerSecond(input.remainingMeters, input.remainingSeconds);
  // Where the rider sits on the line is the same for every answer.
  const riderAlong = onLine && position !== null
    ? projectAlong(line, lngLat(position)).alongMeters
    : null;

  const rows: AlongRidePlace[] = places.map((place) => {
    if (riderAlong !== null) {
      const projected = projectAlong(line, lngLat(place.coordinate));
      const aheadMeters = projected.alongMeters - riderAlong;
      return {
        place,
        aheadMeters,
        offMeters: projected.offMeters,
        awayMeters: null,
        // A stop behind the rider is a different question (a U-turn, or a new
        // route), so no detour estimate is claimed for it.
        extraMinutes: aheadMeters < 0 ? null : detourMinutes(projected.offMeters, pace),
      };
    }
    return {
      place,
      aheadMeters: null,
      offMeters: null,
      awayMeters: position === null ? null : haversineMeters(lngLat(position), lngLat(place.coordinate)),
      extraMinutes: null,
    };
  });

  const rank = (row: AlongRidePlace): number => {
    if (row.aheadMeters !== null) return row.aheadMeters;
    if (row.awayMeters !== null) return row.awayMeters;
    return Number.POSITIVE_INFINITY;
  };
  // A stable sort keeps the geocoder's own order between equally ranked rows.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftAhead = left.row.aheadMeters;
      const rightAhead = right.row.aheadMeters;
      if (leftAhead !== null && rightAhead !== null) {
        const leftBehind = leftAhead < 0;
        const rightBehind = rightAhead < 0;
        // Behind the rider: the least far back is the first one passed again.
        if (leftBehind !== rightBehind) return leftBehind ? 1 : -1;
        if (leftBehind) return rightAhead - leftAhead || left.index - right.index;
        return leftAhead - rightAhead || left.index - right.index;
      }
      return rank(left.row) - rank(right.row) || left.index - right.index;
    })
    .map((entry) => entry.row)
    .slice(0, ALONG_RIDE_RESULT_LIMIT);
}

/** "6.2 mi ahead" / "Behind you" / "4.1 mi away"; `null` when unmeasured. */
export function alongRideDistanceLabel(row: AlongRidePlace): string | null {
  if (row.aheadMeters !== null) {
    if (row.aheadMeters < -BESIDE_METERS) return "Behind you";
    return row.aheadMeters < BESIDE_METERS ? "Nearby" : `${milesLabel(row.aheadMeters)} ahead`;
  }
  if (row.awayMeters !== null) {
    return row.awayMeters < BESIDE_METERS ? "Nearby" : `${milesLabel(row.awayMeters)} away`;
  }
  return null;
}

/** The extra time as a rider reads it: "~+4 min", or `null` for none worth saying. */
export function alongRideExtraLabel(minutes: number | null): string | null {
  return minutes === null || minutes <= 0 ? null : `~+${minutes} min`;
}

/** Miles the way the ride's own rows print them: one decimal under ten. */
function milesLabel(meters: number): string {
  const value = meters / METERS_PER_MILE;
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} mi`;
}
