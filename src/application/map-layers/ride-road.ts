/**
 * "Ride this road" (a tapped road on the map becomes part of the ride).
 *
 * A road drawn by a layer is a line, and routing needs two via points on it:
 * where the rider joins it and where they leave it. The rider should join the
 * end they are coming from (their last stop, or their start), and both points
 * are pulled a little inside the line so the router does not snap to a side
 * street where two roads meet at a junction.
 *
 * Pure geometry on `[lon, lat]` lines, like `along.ts`: it never decides whether
 * the road is legal, open or paved, only which two points a rider's tap means.
 */

import { haversineMeters, lineLengthMeters } from "./along";
import type { MapLayerId } from "./catalog";
import type { LngLat } from "./types";

/** How far along the line each via point sits, from its own end, by length. */
export const ROAD_VIA_INSET_FRACTION = 0.05;

/** The layers whose lines describe a road a rider can choose to ride. */
export const RIDE_ROAD_LAYER_IDS: readonly MapLayerId[] = ["great-roads", "gravel"];

export function isRideRoadLayer(id: MapLayerId): boolean {
  return RIDE_ROAD_LAYER_IDS.includes(id);
}

/** The point `fraction` of the way along the line, measured by length. */
function pointAtFraction(line: readonly LngLat[], fraction: number): LngLat | null {
  const total = lineLengthMeters(line);
  if (!(total > 0)) return null;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let walked = 0;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1]!;
    const to = line[index]!;
    const step = haversineMeters(from, to);
    if (walked + step >= target) {
      const t = step === 0 ? 0 : (target - walked) / step;
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    }
    walked += step;
  }
  return line[line.length - 1]!;
}

/**
 * The two via points for a tapped road, `[entry, exit]`, so the rider enters at
 * the end nearer `reference` (the last stop before the destination, the start
 * when there are no stops, `null` when neither is known).
 *
 * `null` means the tap cannot become a ride: a line with fewer than two points
 * or no length at all has no distinct entry and exit to offer.
 */
export function rideRoadViaPoints(
  line: readonly LngLat[],
  reference: LngLat | null,
): readonly [LngLat, LngLat] | null {
  if (line.length < 2) return null;
  const insideFromStart = pointAtFraction(line, ROAD_VIA_INSET_FRACTION);
  const insideFromEnd = pointAtFraction(line, 1 - ROAD_VIA_INSET_FRACTION);
  if (insideFromStart === null || insideFromEnd === null) return null;
  if (reference === null) return [insideFromStart, insideFromEnd];
  const nearStart = haversineMeters(reference, line[0]!);
  const nearEnd = haversineMeters(reference, line[line.length - 1]!);
  return nearEnd < nearStart ? [insideFromEnd, insideFromStart] : [insideFromStart, insideFromEnd];
}
