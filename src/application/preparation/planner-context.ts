/**
 * The planner's route briefing context (MVP parity M4, OGV-D-266).
 *
 * Explore builds a `RoutePreparationContext` from a catalogue entry; the
 * planner builds it from the selected route and the authored intent. This is
 * the one pure place that decides what the planner's briefing is about:
 *
 * - the **trip window** runs from the departure (the authored future time, or
 *   `now`) for the route's own duration, which is what the weather reads;
 * - **traffic** is live flow, so it is asked only for a ride leaving within
 *   `LIVE_TRAFFIC_WINDOW_MINUTES`; a later departure says so instead;
 * - **fuel** compares the bike's usable range (range minus reserve) with the
 *   route's length;
 * - **daylight** compares the ride with the sunset at the start, on the
 *   departure day.
 */

import { calculateSunset } from "@/application/long-trip/daylight";
import type { Coordinate, DepartureIntent, BikeConstraintSnapshot } from "@/domain/ride/types";

import type { RoutePreparationContext } from "./prepare-route";

const METERS_PER_KM = 1000;
const KM_PER_MILE = 1.609344;
/** `/api/route-traffic` accepts at most this many corridor points. */
export const TRAFFIC_CORRIDOR_POINTS = 128;
/** Live traffic describes the road now; beyond this it is not a forecast. */
export const LIVE_TRAFFIC_WINDOW_MINUTES = 30;

export interface PlannerPreparationRoute {
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

export interface PlannerPreparationInput {
  readonly route: PlannerPreparationRoute;
  readonly departure: DepartureIntent;
  readonly bike: BikeConstraintSnapshot;
  /** ISO instant used for a `now` departure. */
  readonly now: string;
  readonly riderTimeZone?: string;
}

/** Evenly thins a line to at most `limit` points, keeping both ends. */
export function thinLine(line: readonly Coordinate[], limit: number): readonly Coordinate[] {
  if (line.length <= limit) return line;
  const step = (line.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => line[Math.round(index * step)]!);
}

/** The departure instant the briefing is about. */
export function departureInstant(departure: DepartureIntent, now: string): string {
  return departure.kind === "future" ? departure.at : now;
}

/** True when live traffic describes this departure. */
export function departureIsLive(departure: DepartureIntent, now: string): boolean {
  if (departure.kind === "now") return true;
  const lead = (Date.parse(departure.at) - Date.parse(now)) / 60_000;
  return Number.isFinite(lead) && lead <= LIVE_TRAFFIC_WINDOW_MINUTES;
}

/**
 * The sunset of the rider's own day. `calculateSunset` works on the UTC date,
 * which for the Americas is the *previous* evening for a morning departure
 * (a 10 AM EDT start got last night's sunset). The departure's solar-local day
 * is found from longitude, and of the sunsets computed for the neighbouring UTC
 * dates the one nearest that day's late afternoon wins.
 */
export function sunsetOnDepartureDay(start: Coordinate, departAt: string): string | null {
  const departure = Date.parse(departAt);
  if (!Number.isFinite(departure)) return null;
  const offsetMs = (start.lon / 15) * 3_600_000;
  const solarLocal = new Date(departure + offsetMs);
  const solarNoonUtc =
    Date.UTC(solarLocal.getUTCFullYear(), solarLocal.getUTCMonth(), solarLocal.getUTCDate(), 12) - offsetMs;
  const target = solarNoonUtc + 6 * 3_600_000;
  let best: string | null = null;
  for (const shiftHours of [-24, 0, 24]) {
    const fact = calculateSunset(start, new Date(solarNoonUtc + shiftHours * 3_600_000).toISOString());
    if (fact === null) continue;
    if (best === null || Math.abs(Date.parse(fact.sunset) - target) < Math.abs(Date.parse(best) - target)) {
      best = fact.sunset;
    }
  }
  return best;
}

export function plannerPreparationContext(input: PlannerPreparationInput): RoutePreparationContext {
  const { route, bike } = input;
  const start = route.geometry[0];
  const departAt = departureInstant(input.departure, input.now);
  const durationMinutes = Number.isFinite(route.durationSeconds) ? route.durationSeconds / 60 : null;
  const end =
    durationMinutes === null ? null : new Date(Date.parse(departAt) + durationMinutes * 60_000).toISOString();
  const sunset = start === undefined ? null : sunsetOnDepartureDay(start, departAt);
  const remainingDaylightMinutes =
    sunset === null ? null : Math.round((Date.parse(sunset) - Date.parse(departAt)) / 60_000);
  const usableRangeMiles = Math.max(0, bike.fuelRangeMiles - bike.reserveMiles);
  const live = departureIsLive(input.departure, input.now);

  return {
    distanceKm: Number.isFinite(route.distanceMeters) ? route.distanceMeters / METERS_PER_KM : null,
    rideDurationMinutes: durationMinutes,
    departure: departAt,
    ...(end === null ? {} : { tripWindow: { start: departAt, end } }),
    // Traffic is only a fact for a ride leaving now; for a later one the
    // briefing leaves it out rather than presenting today's flow as a forecast.
    routeTouchesMappedCorridor: live,
    ...(live ? { trafficCorridor: thinLine(route.geometry, TRAFFIC_CORRIDOR_POINTS) } : {}),
    fuelRangeKm: usableRangeMiles * KM_PER_MILE,
    ...(sunset === null ? {} : { sunset, remainingDaylightMinutes }),
    weatherLocation: start === undefined ? null : { lat: start.lat, lon: start.lon },
    ...(input.riderTimeZone === undefined ? {} : { riderTimeZone: input.riderTimeZone }),
  };
}
