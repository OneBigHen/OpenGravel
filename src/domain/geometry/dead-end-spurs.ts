/**
 * Dead-end spurs: a line that rides down a branch, turns around and comes back
 * the same way. Geometry proves retracing; it does not prove there was no
 * physical road onward, so a spur is a finding about the route, never a
 * statement about the map.
 *
 * Shared by the planner (which refuses spurs it can avoid) and the scorecard
 * (which counts them), so both measure the same thing.
 */

import type { Coordinate } from "@/domain/ride/types";
import { haversine } from "./analysis";

/** A one-way branch longer than this (metres) is a spur riders notice. */
export const DEAD_END_SPUR_METERS = 300;

/** How far apart the outbound and return sides may be and still be one road. */
const RETRACE_TOLERANCE_METERS = 15;
const SAMPLE_METERS = 25;

export interface DeadEndSpur {
  /** Index of the geometry vertex at the turnaround. */
  readonly turnaroundIndex: number;
  readonly turnaround: Coordinate;
  /** Distance along the route, in metres, of the turnaround. */
  readonly turnaroundMeters: number;
  /** Length of the branch one way, in metres. */
  readonly oneWayMeters: number;
}

/**
 * Every maximal out-and-back branch whose one-way length is strictly over
 * `thresholdMeters`, in travel order.
 *
 * A turnaround at the very end of the line (an A-to-B destination at the end of
 * a dead-end road) is not a spur: the branch must extend beyond the turnaround
 * as far as it extends before it.
 */
export function findDeadEndSpurs(
  line: readonly Coordinate[],
  thresholdMeters: number = DEAD_END_SPUR_METERS,
): readonly DeadEndSpur[] {
  if (line.length < 3) return [];
  const cumulative = [0];
  for (let i = 1; i < line.length; i += 1) {
    cumulative.push(cumulative[i - 1]! + haversine(line[i - 1]!, line[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  const at = (meters: number): Coordinate => {
    let low = 0;
    let high = cumulative.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid]! < meters) low = mid;
      else high = mid;
    }
    const length = cumulative[high]! - cumulative[low]!;
    const t = length > 0 ? (meters - cumulative[low]!) / length : 0;
    const a = line[low]!;
    const b = line[high]!;
    return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
  };

  const spurs: DeadEndSpur[] = [];
  let coveredUntil = -1;
  for (let pivot = 1; pivot < line.length - 1; pivot += 1) {
    const center = cumulative[pivot]!;
    if (center <= coveredUntil) continue;
    const maximum = Math.min(center, total - center);
    if (maximum <= thresholdMeters) continue;
    const matches = (d: number): boolean =>
      haversine(at(center - d), at(center + d)) <= RETRACE_TOLERANCE_METERS;
    // A genuine reversal must retrace immediately, not merely join a nearby
    // parallel road later. Check the exact endpoint as well as 25 m samples.
    if (!matches(Math.min(SAMPLE_METERS, maximum))) continue;
    let matched = 0;
    for (let d = SAMPLE_METERS; d <= maximum; d += SAMPLE_METERS) {
      if (!matches(d)) break;
      matched = d;
    }
    if (maximum - matched < SAMPLE_METERS && matches(maximum)) matched = maximum;
    if (matched > thresholdMeters) {
      spurs.push({
        turnaroundIndex: pivot,
        turnaround: { lat: line[pivot]!.lat, lon: line[pivot]!.lon },
        turnaroundMeters: center,
        oneWayMeters: matched,
      });
      coveredUntil = center + matched;
    }
  }
  return spurs;
}

/** Number of dead-end spurs over `thresholdMeters`. */
export function countDeadEndSpurs(
  line: readonly Coordinate[],
  thresholdMeters: number = DEAD_END_SPUR_METERS,
): number {
  return findDeadEndSpurs(line, thresholdMeters).length;
}
