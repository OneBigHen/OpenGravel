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
 * The analysis retains **run continuity** as well as aggregate bend metres.
 * This lets higher layers distinguish one sustained winding section from the
 * same number of bend metres scattered across many tiny fragments.
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

export interface BendAnalysis {
  readonly bendMeters: number;
  /** Longest uninterrupted qualifying bend run. */
  readonly longestRunMeters: number;
  /** Number of qualifying multi-vertex bend runs. */
  readonly runCount: number;
}

function bearing(from: Coordinate, to: Coordinate): number {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Aggregate and continuity metrics for bends on the line.
 *
 * A qualifying run requires two consecutive bend vertices, preserving the
 * original anti-kink semantics.
 */
export function analyzeBends(line: readonly Coordinate[]): BendAnalysis {
  let bends = 0;
  let longestRunMeters = 0;
  let runCount = 0;
  let run: number[] = [];
  let aggregateRun: number[] = [];

  const flushContinuity = (): void => {
    if (run.length >= 2) {
      const runMeters = run.reduce((sum, meters) => sum + meters, 0);
      longestRunMeters = Math.max(longestRunMeters, runMeters);
      runCount += 1;
    }
    run = [];
  };
  const flush = (): void => {
    // Preserve the existing aggregate and addition order used by curvature
    // scoring. Tiny duplicate legs interrupt only the new continuity reading.
    if (aggregateRun.length >= 2) for (const meters of aggregateRun) bends += meters;
    aggregateRun = [];
    flushContinuity();
  };

  for (let index = 1; index < line.length - 1; index += 1) {
    const previous = line[index - 1] as Coordinate;
    const vertex = line[index] as Coordinate;
    const next = line[index + 1] as Coordinate;
    const before = haversine(previous, vertex);
    const after = haversine(vertex, next);
    if (!(before >= 1) || !(after >= 1)) {
      flushContinuity();
      continue;
    }
    const turn = Math.abs(((bearing(vertex, next) - bearing(previous, vertex) + 540) % 360) - 180);
    if (turn > JUNCTION_TURN_DEGREES) {
      flush();
      continue;
    }
    const share = (before + after) / 2;
    const radius = turn === 0 ? Number.POSITIVE_INFINITY : share / ((turn * Math.PI) / 180);
    if (radius < BEND_RADIUS_METERS) {
      run.push(share);
      aggregateRun.push(share);
    }
    else flush();
  }
  flush();

  return {
    bendMeters: bends,
    longestRunMeters,
    runCount,
  };
}

/** Metres of the line ridden through bends (see the module note). */
export function bendMeters(line: readonly Coordinate[]): number {
  return analyzeBends(line).bendMeters;
}
