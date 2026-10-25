/**
 * Which way a loop heads from its start (04 §3).
 *
 * A rider who asks for "2 h from Jim Thorpe" may want the ridges to the north
 * or the valley to the south. The engine takes a bearing at the start, and this
 * module is the OpenGravel half of that preference: the compass words the rider
 * chooses, and the measurement that tells a returned loop heading one way from
 * a loop that came back the other.
 *
 * Two rules keep this honest:
 *
 * - the heading is a **preference**, never a promise. The returned line is
 *   measured; an off-heading loop is ranked after an on-heading one, and it is
 *   still offered when nothing heads the asked-for way (an empty promise would
 *   be the alternative — "no route" over a legal loop);
 * - the measurement reads only the returned geometry and the start point, so it
 *   never claims anything about access, surface or closure.
 *
 * Bearings are degrees clockwise from north in `[0, 360)`, which is the
 * convention GraphHopper's `headings` parameter uses.
 */

import type { Coordinate, LoopHeading } from "@/domain/ride/types";

/** The bearing each compass word asks for. `any` has none by definition. */
export const LOOP_HEADING_DEGREES: Readonly<Record<Exclude<LoopHeading, "any">, number>> = {
  north: 0,
  east: 90,
  south: 180,
  west: 270,
};

/**
 * How far off the asked-for heading a loop may run and still count as heading
 * that way: a quarter turn. More than this is a different part of the country.
 */
export const LOOP_HEADING_MAX_OFFSET_DEGREES = 90;

/** Below this distance a centroid is the start point, not a direction. */
const DEGENERATE_METERS = 25;

/** The bearing for a heading choice, or `null` for "any way". */
export function loopHeadingDegrees(heading: LoopHeading | undefined): number | null {
  if (heading === undefined || heading === "any") return null;
  return LOOP_HEADING_DEGREES[heading];
}

const DEGREES = Math.PI / 180;

/** Initial great-circle bearing from `from` to `to`, degrees clockwise of north. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const fromLat = from.lat * DEGREES;
  const toLat = to.lat * DEGREES;
  const deltaLon = (to.lon - from.lon) * DEGREES;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) / DEGREES) + 360) % 360;
}

/**
 * How far `bearing` is from `heading`, in `[0, 180]`.
 *
 * The subtraction wraps across north: bearing 350° is 20° off heading 10°, not
 * 340° off. Without the wrap a loop that heads just west of north would be
 * rejected for a north request.
 */
export function bearingOffsetDegrees(bearing: number, heading: number): number {
  const difference = Math.abs(((bearing % 360) + 360) % 360 - (((heading % 360) + 360) % 360));
  return difference > 180 ? 360 - difference : difference;
}

/** Metres between two nearby coordinates, for the degenerate check only. */
function distanceMeters(from: Coordinate, to: Coordinate): number {
  const midLat = ((from.lat + to.lat) / 2) * DEGREES;
  const east = (to.lon - from.lon) * Math.cos(midLat) * 111_320;
  const north = (to.lat - from.lat) * 111_320;
  return Math.hypot(east, north);
}

/**
 * The mean position of the returned line.
 *
 * Vertex density is not distance density (a twisting section contributes more
 * vertices than a straight one), so this is a rough centre rather than a
 * centroid of length. That is enough for a bearing: a loop that heads north and
 * comes back has its centre north of its start either way.
 */
export function loopCentroid(geometry: readonly Coordinate[]): Coordinate | null {
  if (geometry.length === 0) return null;
  let lon = 0;
  let lat = 0;
  for (const point of geometry) {
    lon += point.lon;
    lat += point.lat;
  }
  return { lon: lon / geometry.length, lat: lat / geometry.length };
}

/**
 * How far a returned loop runs from the asked-for heading, or `null` when there
 * is too little line to tell.
 *
 * `null` is "not measured", never "on heading": a two-point answer has no
 * centre to read, and inventing one would make the preference a claim.
 */
export function loopHeadingOffsetDegrees(
  geometry: readonly Coordinate[],
  origin: Coordinate,
  headingDegrees: number,
): number | null {
  const centroid = loopCentroid(geometry);
  if (centroid === null) return null;
  if (distanceMeters(origin, centroid) < DEGENERATE_METERS) return null;
  return bearingOffsetDegrees(bearingDegrees(origin, centroid), headingDegrees);
}

/** Whether a returned loop heads the asked-for way (unmeasured counts as yes). */
export function loopMatchesHeading(
  geometry: readonly Coordinate[],
  origin: Coordinate,
  headingDegrees: number,
): boolean {
  const offset = loopHeadingOffsetDegrees(geometry, origin, headingDegrees);
  return offset === null || offset <= LOOP_HEADING_MAX_OFFSET_DEGREES;
}

/** One rider's answer to "which way?", with the start it is measured from. */
export interface LoopHeadingPreference {
  readonly origin: Coordinate;
  readonly headingDegrees: number;
}

/**
 * The loop candidates that head the asked-for way, or the closest ones when
 * none do.
 *
 * `null` means "no heading was asked for", exactly like the discovery timebox:
 * ordinary planning is unchanged. The fallback keeps this a ranking preference
 * rather than a filter, so an asked-for direction can never turn a legal loop
 * into "no route".
 */
export function loopHeadingPreferredIndexes(
  candidates: readonly { readonly geometry: readonly Coordinate[] }[],
  preference: LoopHeadingPreference | undefined,
): ReadonlySet<number> | null {
  if (preference === undefined) return null;
  const offsets = candidates.map((candidate) =>
    loopHeadingOffsetDegrees(candidate.geometry, preference.origin, preference.headingDegrees),
  );
  const matching = offsets.flatMap((offset, index) =>
    offset !== null && offset <= LOOP_HEADING_MAX_OFFSET_DEGREES ? [index] : [],
  );
  if (matching.length > 0) return new Set(matching);
  const measured = offsets.flatMap((offset, index) => (offset === null ? [] : [{ offset, index }]));
  if (measured.length === 0) return null;
  const closest = Math.min(...measured.map((entry) => entry.offset));
  return new Set(
    measured.flatMap((entry) => (entry.offset === closest ? [entry.index] : [])),
  );
}
