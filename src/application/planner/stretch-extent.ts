/**
 * The map extent of a stretch of a route, from metres along its line, so a tap
 * on a truth line or the surface bar can fly the map to that stretch (N3).
 */

import type { MapExtent } from "@/application/map/build-map-scene";
import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** `null` when the line is empty or the stretch is not on it. */
export function stretchExtent(
  line: readonly Coordinate[],
  fromMeters: number,
  toMeters: number,
): MapExtent | null {
  if (line.length === 0 || !(toMeters >= fromMeters)) return null;
  let walked = 0;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const take = (point: Coordinate): void => {
    minLon = Math.min(minLon, point.lon);
    minLat = Math.min(minLat, point.lat);
    maxLon = Math.max(maxLon, point.lon);
    maxLat = Math.max(maxLat, point.lat);
  };
  for (let index = 0; index < line.length; index += 1) {
    const point = line[index]!;
    if (index > 0) walked += haversine(line[index - 1]!, point);
    if (walked >= fromMeters && walked <= toMeters) take(point);
    // The point just before and just after the stretch, so a stretch shorter
    // than one segment still has an extent.
    else if (walked < fromMeters && index + 1 < line.length) {
      const next = walked + haversine(point, line[index + 1]!);
      if (next >= fromMeters) take(point);
    } else if (walked > toMeters) {
      take(point);
      break;
    }
  }
  return Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null;
}

/** The longest stretch whose kind is not paved or unknown, in metres. */
export function longestUnpaved(
  runs: readonly { readonly kind: string; readonly from: number; readonly to: number }[] | undefined,
  distanceMeters: number | undefined,
): { readonly fromMeters: number; readonly toMeters: number } | null {
  if (runs === undefined || distanceMeters === undefined || !(distanceMeters > 0)) return null;
  let best: { fromMeters: number; toMeters: number } | null = null;
  for (const run of runs) {
    if (run.kind === "paved" || run.kind === "unknown") continue;
    const fromMeters = run.from * distanceMeters;
    const toMeters = run.to * distanceMeters;
    if (best === null || toMeters - fromMeters > best.toMeters - best.fromMeters) best = { fromMeters, toMeters };
  }
  return best;
}
