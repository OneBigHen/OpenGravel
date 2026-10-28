/**
 * Daylight on the route line (05-MAP-INTERACTION-AND-CARTOGRAPHY §11;
 * docs/vnext/design/MAP-EXPERIENCE-NEXT.md Wave 2, item 8).
 *
 * A rider looking at a ride in the evening wants to know how much of it happens
 * in the dark, and *where*. This module answers exactly that: it walks the line
 * in travel order, asks the NOAA daylight calculation for the sunset at each
 * vertex's own **ETA**, and cuts the line where the light runs out. It is a pure
 * projection — the caller supplies the line, the ETA profile (the engine's own
 * duration, mapped onto the drawn geometry) and the departure — so it reads no
 * clock and can be tested without one.
 *
 * Three things are deliberately not guesses:
 *
 * - **The date.** `calculateSunset` reads the UTC calendar date of what it is
 *   given and puts its crossing back inside that same UTC date, which for the
 *   Americas is a day off from the rider's own evening: a 10 AM ET start is
 *   compared with *last night's* sunset and the whole ride reads as dark, and
 *   after 8 PM ET the UTC date has already rolled over. `sunsetOnDepartureDay`
 *   resolves the rider's own solar-local day from longitude, which is why it is
 *   the helper used here (and the tests pin both directions of that trap).
 * - **The sunset's own drift.** Sunset is not one instant for a long ride: it
 *   moves with longitude and latitude, so each vertex's ETA is compared with the
 *   sunset *at that vertex*, not with the start point's.
 * - **Unknown.** A polar day or night, a malformed profile, an unreadable
 *   departure: the result says `unknown` and claims neither half. CLAUDE.md is
 *   explicit that unknown is never converted into daylight or darkness.
 *
 * Two boundaries are deliberate and worth naming. The annotation is about
 * **sunset**, so a ride that starts before dawn is drawn as one lit line until
 * that evening's sunset (the dark hour before sunrise is not a second claim this
 * slice makes). And it describes **one day's ride**: once the first sunset is
 * passed the rest of the line is dark, because an answer that spans a night and
 * the next morning has more than one split and this shape carries one.
 */

import { sunsetOnDepartureDay } from "@/application/long-trip";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

import { isDrawableLine } from "./drawable";
import type { RouteDaylightScene } from "./types";

/** A route's own ETA at each of its vertices, in travel order. */
export interface RouteEtaProfile {
  /**
   * Cumulative travel seconds from the start to each vertex, one entry per
   * geometry position, non-decreasing. The last entry is the ride's duration as
   * the engine measured it.
   */
  readonly offsetsSeconds: readonly number[];
}

/**
 * What the split found.
 *
 * `all-daylight` and `after-dark` are the two whole-line answers; `crosses-sunset`
 * is the line cut in two; `unknown` is the calculation declining to answer (and
 * therefore claiming nothing at all).
 */
export type RouteDaylightOutcome = "all-daylight" | "crosses-sunset" | "after-dark" | "unknown";

/** A line cut where the sun sets, with both halves meeting at the split point. */
export interface RouteDaylightSplit {
  readonly outcome: RouteDaylightOutcome;
  /** The part ridden in daylight, in travel order (empty when the ride starts dark). */
  readonly inDaylight: readonly Coordinate[];
  /** The part ridden after sunset, in travel order (empty when the whole ride is lit). */
  readonly afterSunset: readonly Coordinate[];
  /**
   * Where the light runs out: the split point, or the line's own start when the
   * rider left after dark. `null` when the whole ride is in daylight — there is
   * nothing to mark — and when the answer is unknown.
   */
  readonly sunsetAt: Coordinate | null;
  /** The sunset that ends this ride's daylight, UTC ISO-8601, or `null`. */
  readonly sunsetIso: string | null;
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

function copyLine(line: readonly Coordinate[]): readonly Coordinate[] {
  return line.map(copyCoordinate);
}

function unknown(): RouteDaylightSplit {
  return {
    outcome: "unknown",
    inDaylight: [],
    afterSunset: [],
    sunsetAt: null,
    sunsetIso: null,
  };
}

function withSunset(
  outcome: RouteDaylightOutcome,
  halves: Pick<RouteDaylightSplit, "inDaylight" | "afterSunset" | "sunsetAt" | "sunsetIso">,
): RouteDaylightSplit {
  return { outcome, ...halves };
}

/** Between two points, at `share` of the way from `from` to `to`. */
function interpolate(from: Coordinate, to: Coordinate, share: number): Coordinate {
  return {
    lon: from.lon + (to.lon - from.lon) * share,
    lat: from.lat + (to.lat - from.lat) * share,
  };
}

/** True when a profile is one usable cumulative offset per position. */
function profileFitsLine(profile: RouteEtaProfile, line: readonly Coordinate[]): boolean {
  const offsets = profile.offsetsSeconds;
  if (offsets.length !== line.length) return false;
  let previous = 0;
  for (const offset of offsets) {
    if (!Number.isFinite(offset) || offset < 0 || offset < previous) return false;
    previous = offset;
  }
  return true;
}

/** Sunset at `coordinate` on the solar-local day of `instantMs`, as epoch ms. */
function sunsetAt(coordinate: Coordinate, instantMs: number): number | null {
  const fact = sunsetOnDepartureDay(coordinate, new Date(instantMs).toISOString());
  if (fact === null) return null;
  const parsed = Date.parse(fact.sunset);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Cuts a line where the light runs out.
 *
 * The comparison is made per vertex with that vertex's own sunset, and the
 * crossing is placed *between* the last lit vertex and the first dark one by
 * linear interpolation of the gap between the ETA and the sunset. That is the
 * honest resolution of the data: the geometry samples the road, the sunset moves
 * slowly, and a several-kilometre segment cannot say more precisely than this.
 *
 * `departure` is the instant the ride leaves, ISO-8601. A departure after dark
 * returns the whole line as `afterSunset` with the line's start as
 * {@link RouteDaylightSplit.sunsetAt}: the light ran out before the ride did, and
 * the marker still says when.
 */
export function splitRouteByDaylight(
  line: readonly Coordinate[],
  etaProfile: RouteEtaProfile,
  departure: string,
): RouteDaylightSplit {
  if (!isDrawableLine(line) || !profileFitsLine(etaProfile, line)) return unknown();
  const departureMs = Date.parse(departure);
  if (!Number.isFinite(departureMs)) return unknown();

  const offsets = etaProfile.offsetsSeconds;
  let previousEtaMs = departureMs + offsets[0]! * 1000;
  let previousSunsetMs = sunsetAt(line[0]!, previousEtaMs);
  if (previousSunsetMs === null) return unknown();

  if (previousEtaMs >= previousSunsetMs) {
    return withSunset("after-dark", {
      inDaylight: [],
      afterSunset: copyLine(line),
      sunsetAt: copyCoordinate(line[0]!),
      sunsetIso: new Date(previousSunsetMs).toISOString(),
    });
  }

  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1]!;
    const to = line[index]!;
    const etaMs = departureMs + offsets[index]! * 1000;
    const sunsetMs = sunsetAt(to, etaMs);
    if (sunsetMs === null) return unknown();
    if (etaMs < sunsetMs) {
      previousEtaMs = etaMs;
      previousSunsetMs = sunsetMs;
      continue;
    }
    // The ETA outran the sunset somewhere on this segment. Both gaps use their
    // own vertex's sunset, so the zero crossing is where the rider meets it.
    const gapBefore = previousEtaMs - previousSunsetMs;
    const gapAfter = etaMs - sunsetMs;
    const share = gapAfter === gapBefore ? 1 : Math.min(1, Math.max(0, gapBefore / (gapBefore - gapAfter)));
    const splitPoint = interpolate(from, to, share);
    const crossingMs = previousEtaMs + (etaMs - previousEtaMs) * share;
    // The marker names the sunset at its own position, not at either neighbour's.
    const splitSunsetMs = sunsetAt(splitPoint, crossingMs);
    if (splitSunsetMs === null) return unknown();
    return withSunset("crosses-sunset", {
      inDaylight: [...copyLine(line.slice(0, index)), copyCoordinate(splitPoint)],
      afterSunset: [copyCoordinate(splitPoint), ...copyLine(line.slice(index))],
      sunsetAt: splitPoint,
      sunsetIso: new Date(splitSunsetMs).toISOString(),
    });
  }

  return withSunset("all-daylight", {
    inDaylight: copyLine(line),
    afterSunset: [],
    sunsetAt: null,
    sunsetIso: null,
  });
}

/**
 * The map's whole daylight annotation for one line: the dark stretch, the point
 * where the light runs out, and the words the marker says.
 *
 * `null` when there is nothing to draw: the whole ride is in daylight, or the sun
 * calculation declined to answer (a polar day or night, an unreadable input).
 * `null` is the honest "no annotation": the line keeps exactly the treatment it
 * had before this module existed, and no marker claims a sunset the calculation
 * could not find. It costs one sun calculation per vertex, which is why the
 * caller memoizes it against the route rather than recomputing it every frame.
 */
export function routeDaylightScene(
  line: readonly Coordinate[],
  durationSeconds: number,
  departureAt: string,
  riderTimeZone?: string,
): RouteDaylightScene | null {
  const profile = proportionalEtaProfile(line, durationSeconds);
  if (profile === null) return null;
  const split = splitRouteByDaylight(line, profile, departureAt);
  if (split.outcome !== "crosses-sunset" && split.outcome !== "after-dark") return null;
  const { sunsetAt, sunsetIso } = split;
  if (sunsetAt === null || sunsetIso === null || split.afterSunset.length === 0) return null;
  const label = sunsetMarkerLabel(sunsetIso, riderTimeZone);
  if (label === null) return null;
  return {
    afterSunset: split.afterSunset.map(copyCoordinate),
    sunsetAt: copyCoordinate(sunsetAt),
    sunsetIso,
    label,
  };
}

/**
 * An ETA profile from the engine's duration, spread over the line by ground
 * distance.
 *
 * The engine states one duration for the whole route, not one per vertex, and
 * the drawn geometry is a different sampling of the same road. Distributing the
 * duration proportionally is the same honest approximation the surface band makes
 * with its run shares: it cannot place an ETA more precisely than the line it is
 * drawn on, and it never invents a speed change the engine did not report.
 *
 * `null` when there is nothing to spread it over: no line, no positive duration,
 * or a line with no ground length.
 */
export function proportionalEtaProfile(
  line: readonly Coordinate[],
  durationSeconds: number,
): RouteEtaProfile | null {
  if (!isDrawableLine(line)) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  const at = [0];
  for (let index = 1; index < line.length; index += 1) {
    at.push(at[index - 1]! + haversine(line[index - 1]!, line[index]!));
  }
  const total = at[at.length - 1]!;
  if (!(total > 0)) return null;
  return { offsetsSeconds: at.map((meters) => (meters / total) * durationSeconds) };
}

/**
 * What the marker says, in words a rider reads out: `Sunset around 6:12 PM`.
 *
 * The time is the rider's own clock (`timeZone`), never UTC: the sunset instant
 * is a solar fact, and the rider reads it in the zone they are riding in. A
 * timezone the platform does not know falls back to the device's own.
 */
export function sunsetMarkerLabel(sunsetIso: string, timeZone?: string): string | null {
  const ms = Date.parse(sunsetIso);
  if (!Number.isFinite(ms)) return null;
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: true };
  let clock: string;
  try {
    clock = new Intl.DateTimeFormat("en-US", timeZone === undefined ? options : { ...options, timeZone }).format(new Date(ms));
  } catch {
    clock = new Intl.DateTimeFormat("en-US", options).format(new Date(ms));
  }
  return `Sunset around ${clock}`;
}
