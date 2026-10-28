/**
 * Trailhead matching: a `highway=trailhead` or `amenity=parking` place counts
 * for a trail only when it is within the radius of an end of the trail's own
 * geometry. A parking lot in the middle of a loop is not a trailhead, and a
 * trail with nothing mapped near its ends keeps `trailheads: []` — unknown, not
 * "no parking".
 */

import { nearestEnd } from "./geometry";
import type { Line } from "./geometry";
import type { Coordinate } from "../../../src/domain/ride/types";
import { haversine } from "../../../src/domain/geometry/analysis";
import type { PlaceCandidate, Trailhead } from "./types";

/** ~1.1 km cells: a 300 m radius never needs more than the 3×3 neighbourhood. */
const CELL_DEGREES = 0.01;

const cellKey = (lon: number, lat: number): string =>
  `${Math.floor(lon / CELL_DEGREES)},${Math.floor(lat / CELL_DEGREES)}`;

/**
 * Places bucketed by a coarse grid. A state extract holds far more parking
 * nodes than trails, so matching every trail against every place would be
 * quadratic for no reason.
 */
export class PlaceGrid {
  private readonly cells = new Map<string, PlaceCandidate[]>();

  constructor(places: readonly PlaceCandidate[]) {
    for (const place of places) {
      const key = cellKey(place.coordinate.lon, place.coordinate.lat);
      const bucket = this.cells.get(key);
      if (bucket === undefined) this.cells.set(key, [place]);
      else bucket.push(place);
    }
  }

  near(point: Coordinate, radiusMeters: number): PlaceCandidate[] {
    const centreLon = Math.floor(point.lon / CELL_DEGREES);
    const centreLat = Math.floor(point.lat / CELL_DEGREES);
    const found: PlaceCandidate[] = [];
    for (let lon = centreLon - 1; lon <= centreLon + 1; lon += 1) {
      for (let lat = centreLat - 1; lat <= centreLat + 1; lat += 1) {
        for (const place of this.cells.get(`${lon},${lat}`) ?? []) {
          if (haversine(place.coordinate, point) <= radiusMeters) found.push(place);
        }
      }
    }
    return found;
  }
}

/** More trailheads than this per trail is a car park, not useful rider-facing data. */
export const MAX_TRAILHEADS_PER_TRAIL = 10;

export const DEFAULT_TRAILHEAD_RADIUS_METERS = 300;

export function attachTrailheads(
  lines: readonly Line[],
  grid: PlaceGrid,
  radiusMeters: number = DEFAULT_TRAILHEAD_RADIUS_METERS,
): Trailhead[] {
  const matches = new Map<string, Trailhead>();
  for (const line of lines) {
    const ends: [Coordinate, "start" | "end"][] = [];
    const first = line[0];
    const last = line[line.length - 1];
    if (first !== undefined) ends.push([first, "start"]);
    if (last !== undefined && last !== first) ends.push([last, "end"]);
    for (const [coordinate] of ends) {
      for (const place of grid.near(coordinate, radiusMeters)) {
        const key = `${place.sourceId}:${place.recordId}`;
        const existing = matches.get(key);
        if (existing !== undefined) continue;
        const end = nearestEnd(lines, place.coordinate);
        if (end === null || end.distanceMeters > radiusMeters) continue;
        matches.set(key, {
          kind: place.kind,
          name: place.name,
          coordinate: place.coordinate,
          distanceMeters: Math.round(end.distanceMeters),
          lineIndex: end.lineIndex,
          end: end.end,
          sources: [
            {
              sourceId: place.sourceId,
              sourceLabel: place.sourceId === "osm" ? "OpenStreetMap" : place.sourceId === "usfs" ? "USDA Forest Service" : "National Park Service",
              recordId: place.recordId,
              url: place.url,
            },
          ],
        });
      }
    }
  }
  return [...matches.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters || (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, MAX_TRAILHEADS_PER_TRAIL);
}
