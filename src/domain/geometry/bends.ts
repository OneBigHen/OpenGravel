/**
 * Bends a rider would call bends, measured on the route line itself.
 *
 * The routing engine's own curvature is a per-edge ratio (straight-line over
 * road length), and edges end at every junction, so a winding mountain road
 * cut into short edges reads as straight: on 2026-09-26 Hawk Mountain → Jim
 * Thorpe measured 79% "dead straight" and every card said Straight. This
 * follows the idea behind roadcurvature.com instead: the turn radius at each
 * vertex of the line, counting the metres ridden through radii tighter than
 * `BEND_RADIUS_METERS`.
 *
 * Two filters keep town driving out of it:
 * - a turn sharper than `JUNCTION_TURN_DEGREES` at one vertex is a junction
 *   corner, not a bend;
 * - a bend spans at least two consecutive vertices; a single kink is a lane
 *   shift or a corner cut by the line's simplification.
 *
 * PA/NJ reference shares (the engine's own lines, 2026-09-26): I-76 1.9%,
 * suburban arterials 4–5%, Hawk Mountain climb 9%, River Road 13%, PA-611
 * through the Water Gap 13%, Old Mine Road 19%.
 */

import { haversine } from "./analysis";
import type { Coordinate } from "@/domain/ride/types";

/** A turn at least this tight (metres of radius) is a bend. */
export const BEND_RADIUS_METERS = 300;
/** A single-vertex turn sharper than this is a junction corner. */
export const JUNCTION_TURN_DEGREES = 70;

function bearing(from: Coordinate, to: Coordinate): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Metres of the line ridden through bends (see the module note). */
export function bendMeters(line: readonly Coordinate[]): number {
  let bends = 0;
  let run: number[] = [];
  const flush = (): void => {
    if (run.length >= 2) for (const meters of run) bends += meters;
    run = [];
  };
  for (let index = 1; index < line.length - 1; index += 1) {
    const previous = line[index - 1] as Coordinate;
    const vertex = line[index] as Coordinate;
    const next = line[index + 1] as Coordinate;
    const before = haversine(previous, vertex);
    const after = haversine(vertex, next);
    if (!(before >= 1) || !(after >= 1)) continue;
    const turn = Math.abs(((bearing(vertex, next) - bearing(previous, vertex) + 540) % 360) - 180);
    if (turn > JUNCTION_TURN_DEGREES) {
      flush();
      continue;
    }
    const share = (before + after) / 2;
    const radius = turn === 0 ? Number.POSITIVE_INFINITY : share / ((turn * Math.PI) / 180);
    if (radius < BEND_RADIUS_METERS) run.push(share);
    else flush();
  }
  flush();
  return bends;
}
