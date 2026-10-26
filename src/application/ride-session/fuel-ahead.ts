/**
 * "Next gas" on the ride (docs/vnext/design/maps-for-riders.md §1: one obvious
 * action, plain words, and the map never edits the ride by itself).
 *
 * A rider on a 150-mile tank asks one question between towns: *can I reach the
 * next station, or do I have to stop before it?* The planner answers it for the
 * whole route (`PlannerFuelAlong`); this module answers it for where the rider
 * is now, so the ride sheet can say one line and, when it matters, offer one
 * button.
 *
 * Three rules, all decided here rather than in the component:
 *
 * - **Unknown is never "fine".** A missing station list, a missing range or a
 *   position the ride cannot place on the route produce *no verdict* — the line
 *   states the next station it does know, and the range sentence is absent
 *   rather than reassuring.
 * - **The ridden count never overstates the range left.** The odometer only
 *   ever adds a forward step it measured on the same route: a route change
 *   rebases it and a backward jump (a reroute's new projection) adds nothing.
 *   A gap in the position stream counts in full, because losing fixes must make
 *   the tank look emptier than it is, never fuller. (Miles ridden while off the
 *   line are counted when the rider's projection moves on rejoining; a
 *   there-and-back detour that lands on the same mile adds nothing. Off the
 *   line there is no distance along the route at all, so the surface states the
 *   next station and withholds the range rather than guess.)
 * - **A refuel target is the last station the range still reaches.** When the
 *   next station is already beyond the range there is no such station, and the
 *   target falls back to that next station — the only place a rider can
 *   actually fill up — so the one button is never dead.
 *
 * Pure: no clock, no network, no React. Everything a rider reads is built from
 * these facts by the surface that shows it.
 */

import { METERS_PER_MILE, haversineMeters } from "@/application/map-layers/along";
import type { MapLayerBounds } from "@/application/map-layers/types";
import type { Coordinate } from "@/domain/ride/types";

/** How far ahead the ride looks for gas: about one big tank, in route order. */
export const FUEL_LOOK_AHEAD_MILES = 120;

/** How far a Free Ride searches for the nearest station around the rider. */
export const FREE_RIDE_FUEL_MILES = 25;

/**
 * A station the search found, without a distance yet: the same shape for an
 * along-route stop and a nearby one.
 */
export interface GasStation {
  readonly id: string;
  readonly name: string;
  readonly coordinate: Coordinate;
}

/** A station with how far ahead of the rider it is, in miles. */
export interface GasAhead extends GasStation {
  /** Miles ahead along the route, or straight-line on a Free Ride. Never negative. */
  readonly aheadMiles: number;
}

/** What the ride knows about the distance ridden since the last fill-up. */
export interface FuelOdometer {
  /** The route the last measurement belonged to; a new one rebases the reading. */
  readonly routeKey: string | null;
  /** The rider's distance along that route at the last measurement, in miles. */
  readonly alongMiles: number | null;
  /** Miles ridden since the last fill-up (or the ride's start). */
  readonly riddenMiles: number;
}

export const EMPTY_FUEL_ODOMETER: FuelOdometer = { routeKey: null, alongMiles: null, riddenMiles: 0 };

/** A station this close is where the rider already is, so it is not "ahead". */
const AT_STATION_MILES = 0.1;

/** The half-angle of "ahead" around the rider's heading, on a Free Ride. */
const AHEAD_CONE_DEGREES = 75;

/**
 * The range the bike can use before its reserve: `null` when the garage has no
 * usable range, because a range of nothing is not a range to judge a ride by.
 */
export function usableRangeMiles(
  fuelRangeMiles: number | null | undefined,
  reserveMiles: number | null | undefined,
): number | null {
  if (typeof fuelRangeMiles !== "number" || !Number.isFinite(fuelRangeMiles)) return null;
  const reserve = typeof reserveMiles === "number" && Number.isFinite(reserveMiles) ? reserveMiles : 0;
  const usable = fuelRangeMiles - reserve;
  return usable > 0 ? usable : null;
}

/**
 * The range still in the tank: the usable range minus the miles ridden since
 * the last fill-up. `null` when either side is unknown — an unknown range is
 * never printed as a full tank.
 */
export function rangeLeftMiles(
  usableMiles: number | null,
  riddenMiles: number | null,
): number | null {
  if (usableMiles === null || !Number.isFinite(usableMiles)) return null;
  if (riddenMiles === null || !Number.isFinite(riddenMiles)) return null;
  return Math.max(0, usableMiles - Math.max(0, riddenMiles));
}

/**
 * One measurement of where the rider is along the route, folded into the
 * ridden count. Forward steps on the same route add; a new route rebases
 * without adding; nothing ever subtracts, so the range left can only be
 * understated by a gap, never overstated by a jump.
 *
 * Returns the same object when nothing changed, so a caller may compare by
 * identity before storing it.
 */
export function advanceFuelOdometer(
  previous: FuelOdometer,
  sample: { readonly routeKey: string | null; readonly alongMiles: number | null },
): FuelOdometer {
  const along = sample.alongMiles;
  if (along === null || !Number.isFinite(along)) return previous;
  const known = previous.alongMiles;
  if (known === null) {
    // The first measurement of a ride: its route starts where the ride started,
    // so the distance along it is distance already ridden — never a reason to
    // assume a full tank on a ride that was already under way when it opened.
    const ridden = previous.routeKey === null ? along : previous.riddenMiles;
    return { routeKey: sample.routeKey, alongMiles: along, riddenMiles: ridden };
  }
  if (previous.routeKey !== sample.routeKey) {
    return { routeKey: sample.routeKey, alongMiles: along, riddenMiles: previous.riddenMiles };
  }
  const step = along - known;
  if (step === 0) return previous;
  if (step < 0) return { routeKey: sample.routeKey, alongMiles: along, riddenMiles: previous.riddenMiles };
  return { routeKey: sample.routeKey, alongMiles: along, riddenMiles: previous.riddenMiles + step };
}

/** The rider filled up: the count starts again from the next measurement. */
export function resetFuelOdometer(previous: FuelOdometer): FuelOdometer {
  return previous.riddenMiles === 0 ? previous : { ...previous, riddenMiles: 0 };
}

/** What the ride can say about the gas ahead. */
export type FuelAheadVerdict =
  /** Station data, and nothing ahead of the rider. */
  | { readonly kind: "none" }
  /** The next station, with the range left when the ride can measure it. */
  | {
      readonly kind: "next";
      readonly station: GasAhead;
      /** `null` when the ride cannot measure it; never a guessed full tank. */
      readonly rangeLeftMiles: number | null;
    }
  /** The next station is farther than the range left — fill up before it. */
  | {
      readonly kind: "short";
      readonly station: GasAhead;
      readonly rangeLeftMiles: number;
      /** The stop "Add gas stop" adds (see {@link gasStopToAdd}). */
      readonly stop: GasAhead;
    };

/** Nearest first, without mutating the caller's list. */
function byAhead(stations: readonly GasAhead[]): readonly GasAhead[] {
  return [...stations].sort((a, b) => a.aheadMiles - b.aheadMiles || a.id.localeCompare(b.id));
}

/** The station "Add gas stop" adds: the last one the range still reaches. */
export function gasStopToAdd(
  stations: readonly GasAhead[],
  rangeLeft: number | null,
): GasAhead | null {
  const ordered = byAhead(stations);
  if (ordered.length === 0) return null;
  if (rangeLeft === null || !Number.isFinite(rangeLeft)) return ordered[0]!;
  const reachable = ordered.filter((station) => station.aheadMiles <= rangeLeft);
  // Beyond the range of every station ahead, the next one is the only place to
  // fill up, so that is what the one button offers.
  return reachable[reachable.length - 1] ?? ordered[0]!;
}

/**
 * The one line the sheet needs: which station is next, and whether the range
 * left reaches it. A `null` range means "the ride cannot say" — the verdict is
 * then `next` with no range, never a reassurance.
 */
export function fuelAhead(
  stations: readonly GasAhead[],
  rangeLeft: number | null,
): FuelAheadVerdict {
  const ordered = byAhead(stations);
  const next = ordered[0];
  if (next === undefined) return { kind: "none" };
  const known = rangeLeft === null || !Number.isFinite(rangeLeft) ? null : Math.max(0, rangeLeft);
  if (known === null) return { kind: "next", station: next, rangeLeftMiles: null };
  if (next.aheadMiles <= known) return { kind: "next", station: next, rangeLeftMiles: known };
  const stop = gasStopToAdd(ordered, known);
  // A non-empty list always yields a stop; without one there is nothing to add,
  // so the honest verdict is the plain next-station line.
  if (stop === null) return { kind: "next", station: next, rangeLeftMiles: known };
  return { kind: "short", station: next, rangeLeftMiles: known, stop };
}

/** Rider miles for a sentence: whole miles, and never "0 mi" for "close". */
export function wholeMiles(miles: number): number {
  if (!Number.isFinite(miles) || miles <= 0) return 1;
  return Math.max(1, Math.round(miles));
}

/**
 * The range left for a sentence: whole miles, and a dry tank says 0 — a range
 * rounded up to "1 mi" would claim a mile the rider does not have.
 */
export function wholeRangeMiles(miles: number): number {
  if (!Number.isFinite(miles) || miles <= 0) return 0;
  return Math.round(miles);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/** The initial bearing from one coordinate to another, true north, 0–360. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** How far apart two bearings point, 0–180 degrees. */
export function bearingGapDegrees(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

export interface NearbyFuelOptions {
  /** The farthest the search may answer from, in miles. */
  readonly maxMiles?: number;
  /** The half-angle either side of the heading that still counts as ahead. */
  readonly coneDegrees?: number;
}

/**
 * The nearest station ahead of the rider, for a ride with no route to measure
 * along. Without a heading there is no "ahead": the answer is `null` rather
 * than the nearest station in any direction, and the surface says nothing.
 */
export function nearestGasAhead(
  stations: readonly GasStation[],
  from: Coordinate,
  heading: number | null,
  options: NearbyFuelOptions = {},
): GasAhead | null {
  if (heading === null || !Number.isFinite(heading)) return null;
  const maxMiles = options.maxMiles ?? FREE_RIDE_FUEL_MILES;
  const cone = options.coneDegrees ?? AHEAD_CONE_DEGREES;
  let best: GasAhead | null = null;
  for (const station of stations) {
    const miles = haversineMeters([from.lon, from.lat], [station.coordinate.lon, station.coordinate.lat]) / METERS_PER_MILE;
    if (!Number.isFinite(miles) || miles > maxMiles || miles < AT_STATION_MILES) continue;
    if (bearingGapDegrees(bearingDegrees(from, station.coordinate), heading) > cone) continue;
    if (best === null || miles < best.aheadMiles) {
      best = { id: station.id, name: station.name, coordinate: station.coordinate, aheadMiles: miles };
    }
  }
  return best;
}

/**
 * The box a Free Ride asks the layers endpoint for: a square of `miles` either
 * side of the rider, widened across longitude so it stays square on the ground.
 */
export function fuelSearchBounds(from: Coordinate): MapLayerBounds {
  const latDelta = FREE_RIDE_FUEL_MILES / 69.055;
  const cosLat = Math.cos(toRadians(from.lat));
  const lonDelta = cosLat <= 0.01 ? 90 : Math.min(180, latDelta / cosLat);
  return {
    west: from.lon - lonDelta,
    south: from.lat - latDelta,
    east: from.lon + lonDelta,
    north: from.lat + latDelta,
  };
}
