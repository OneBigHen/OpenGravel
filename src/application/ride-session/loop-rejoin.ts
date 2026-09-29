/**
 * Keeping a loop a loop after a missed turn (UX rework 2, ride findings).
 *
 * A loop's reroute used to plan "from here to the loop's start": one wrong
 * turn ten miles in and the router took the rider straight home, dropping the
 * rest of the ride. Instead, the reroute rides back onto the part of the loop
 * still ahead, by shaping through points sampled along it.
 *
 * Everything here is pure geometry over the bound route line and the rider's
 * last matched distance along it.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** Leave the first stretch to the router: it picks how to get back on. */
export const REJOIN_SKIP_METERS = 1_000;
/** One anchor every few miles holds the loop's line without over-constraining it. */
export const REJOIN_SPACING_METERS = 6_000;
/** Anchors per request, so a long loop stays a small, fast request. */
export const REJOIN_MAX_POINTS = 15;
/** Anchors this close to the loop's end add nothing: the finish is right there. */
const FINISH_CLEARANCE_METERS = 1_500;

/** The route line from `alongMeters` to its end, starting at the matched point. */
export function lineAhead(line: readonly Coordinate[], alongMeters: number): readonly Coordinate[] {
  if (line.length < 2) return [];
  const target = Number.isFinite(alongMeters) ? Math.max(0, alongMeters) : 0;
  let walked = 0;
  for (let index = 1; index < line.length; index += 1) {
    const from = line[index - 1] as Coordinate;
    const to = line[index] as Coordinate;
    const length = haversine(from, to);
    if (walked + length >= target) {
      const fraction = length === 0 ? 0 : (target - walked) / length;
      const matched = {
        lon: from.lon + (to.lon - from.lon) * fraction,
        lat: from.lat + (to.lat - from.lat) * fraction,
      };
      return [matched, ...line.slice(index)];
    }
    walked += length;
  }
  return [];
}

/** The index of the vertex of `line` nearest `point`. */
function nearestVertex(line: readonly Coordinate[], point: Coordinate): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  line.forEach((vertex, index) => {
    const distance = haversine(vertex, point);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Shaping anchors along the loop still ahead, in riding order.
 *
 * The provider rides origin → stops → shaping → finish, so anchors may only
 * come from the part of the loop after the last remaining stop; the stretch
 * before it is already held in place by the stops themselves.
 */
export function loopRejoinAnchors(
  ahead: readonly Coordinate[],
  remainingStops: readonly Coordinate[] = [],
  skipMeters?: number,
): readonly Coordinate[] {
  if (ahead.length < 2) return [];
  const lastStop = remainingStops.at(-1);
  const fromIndex = lastStop === undefined ? 0 : nearestVertex(ahead, lastStop);
  const skip = skipMeters ?? (lastStop === undefined ? REJOIN_SKIP_METERS : 0);

  let total = 0;
  for (let index = fromIndex + 1; index < ahead.length; index += 1) {
    total += haversine(ahead[index - 1] as Coordinate, ahead[index] as Coordinate);
  }
  const usable = total - FINISH_CLEARANCE_METERS;
  if (usable <= skip) return [];

  const count = Math.min(REJOIN_MAX_POINTS, Math.max(1, Math.ceil((usable - skip) / REJOIN_SPACING_METERS)));
  const spacing = count === 1 ? 0 : (usable - skip) / (count - 1);
  const targets = Array.from({ length: count }, (_, index) => skip + spacing * index);

  const anchors: Coordinate[] = [];
  let walked = 0;
  let next = 0;
  for (let index = fromIndex + 1; index < ahead.length && next < targets.length; index += 1) {
    const from = ahead[index - 1] as Coordinate;
    const to = ahead[index] as Coordinate;
    const length = haversine(from, to);
    while (next < targets.length && walked + length >= (targets[next] as number)) {
      const fraction = length === 0 ? 0 : ((targets[next] as number) - walked) / length;
      anchors.push({
        lon: from.lon + (to.lon - from.lon) * fraction,
        lat: from.lat + (to.lat - from.lat) * fraction,
      });
      next += 1;
    }
    walked += length;
  }
  return anchors;
}
