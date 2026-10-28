/**
 * "Which road is closest, and which way is it?" for the emergency card
 * (HIKE-MODE-PLAN H4 §19).
 *
 * The answer is only ever derived from road lines this device already holds —
 * the map's loaded layer features, a downloaded ride, anything with a name and
 * a line. Nothing here fetches, guesses or synthesises a road: with no lines,
 * the answer is `null` and the card says "unknown", because inventing a nearest
 * road is exactly the kind of comfortable lie an emergency surface must not
 * tell.
 *
 * The measurement is a local flat projection around the point (metres east and
 * north of it, scaled by the cosine of its latitude). At the distances that
 * matter here — metres to a few kilometres — that is well inside the error of
 * the road line itself, and it lets the nearest point on a segment be solved
 * directly instead of by vertex sampling. The distance that is finally reported
 * is the great-circle distance to that nearest point.
 */

import { haversine } from "./analysis";
import type { Coordinate } from "../ride/types";

const METRES_PER_DEGREE_LAT = 111_320;
const POINTS_OF_COMPASS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

export type CompassDirection = (typeof POINTS_OF_COMPASS)[number];

/** One named line the caller has already decided is a road. */
export interface RoadLine {
  /** Stable id from the source feature. */
  readonly id: string;
  /** The road's name, or an empty string when the source has none. */
  readonly name: string;
  readonly line: readonly Coordinate[];
}

export interface NearestRoad {
  readonly id: string;
  /** The name as the source gave it; `""` means the source did not name it. */
  readonly name: string;
  /** Great-circle metres from the point to the closest point on the road. */
  readonly meters: number;
  /** Initial bearing from the point toward that closest point, 0–360°. */
  readonly bearingDegrees: number;
  /** That bearing as one of eight compass points, for reading aloud. */
  readonly direction: CompassDirection;
  /** The closest point on the road, so a map can mark the way out. */
  readonly access: Coordinate;
}

/** The initial bearing from `from` to `to`, in degrees clockwise from north. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const toRadians = Math.PI / 180;
  const fromLat = from.lat * toRadians;
  const toLat = to.lat * toRadians;
  const deltaLon = (to.lon - from.lon) * toRadians;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** The eight-point compass name for a bearing; 337.5° and 22.5° both read north. */
export function compassDirection(bearing: number): CompassDirection {
  const normalised = ((bearing % 360) + 360) % 360;
  const index = Math.round(normalised / 45) % POINTS_OF_COMPASS.length;
  return POINTS_OF_COMPASS[index] ?? "north";
}

/** The nearest point on segment `a→b` to `point`, in a local metric plane. */
function closestOnSegment(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): Coordinate {
  const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.cos((point.lat * Math.PI) / 180);
  const ax = (a.lon - point.lon) * metresPerDegreeLon;
  const ay = (a.lat - point.lat) * METRES_PER_DEGREE_LAT;
  const bx = (b.lon - point.lon) * metresPerDegreeLon;
  const by = (b.lat - point.lat) * METRES_PER_DEGREE_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return a;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  if (t === 0) return a;
  if (t === 1) return b;
  return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
}

function validLine(line: readonly Coordinate[]): boolean {
  return line.length >= 2 &&
    line.every((vertex) => Number.isFinite(vertex.lat) && Number.isFinite(vertex.lon));
}

/**
 * The closest road in `roads` to `point`, or `null` when none of them is a
 * usable line. Ties keep the first road in the order given, so a caller that
 * orders its sources (say, forest roads before paved ones) owns the tie-break.
 */
export function nearestRoad(
  point: Coordinate,
  roads: readonly RoadLine[],
): NearestRoad | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;
  let best: NearestRoad | null = null;
  for (const road of roads) {
    if (!validLine(road.line)) continue;
    for (let index = 0; index + 1 < road.line.length; index += 1) {
      const a = road.line[index];
      const b = road.line[index + 1];
      if (a === undefined || b === undefined) continue;
      const access = closestOnSegment(point, a, b);
      const meters = haversine(point, access);
      if (!Number.isFinite(meters)) continue;
      if (best !== null && meters >= best.meters) continue;
      const bearing = bearingDegrees(point, access);
      best = {
        id: road.id,
        name: road.name,
        meters,
        bearingDegrees: bearing,
        direction: compassDirection(bearing),
        access,
      };
    }
  }
  return best;
}
