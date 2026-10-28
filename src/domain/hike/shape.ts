/**
 * Loop / out-and-back / point-to-point from the line alone (H1 item 5).
 *
 * Two independent measurements decide it:
 *
 * 1. **Endpoint distance** — how far the last position is from the first. A
 *    circuit comes home; a traverse ends somewhere else.
 * 2. **Retrace share** — how much of the line runs back over an earlier stretch
 *    within a tolerance. A there-and-back has the same endpoints as a loop, so
 *    closure alone cannot tell them apart; the retrace test can.
 *
 * The classification is a description of the mapped line, not a promise about
 * the route. A horseshoe whose ends are 150 m apart is reported as a loop
 * because that is what a walker experiences, and the numbers behind the call
 * are returned with it so the UI can explain the approximation.
 */

import { haversine } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";
import { lineLengthMeters } from "./profile";
import type { HikeShape, HikeShapeClassification } from "./types";

const METERS_PER_DEGREE = 111_320;

/** Thresholds, exported so tests and copy quote the same numbers. */
export const SHAPE_LIMITS = {
  /** Shorter than this, a line cannot be told apart: report unknown. */
  minClassifiableLengthMeters: 200,
  /** Positions are sampled every this many metres along the line. */
  sampleSpacingMeters: 25,
  /** A later position within this distance of an earlier one retraces it. */
  retraceToleranceMeters: 30,
  /** The earlier position must be this much earlier along the line. */
  retraceMinSeparationMeters: 100,
  /** At least this share of sampled positions retraced means out-and-back. */
  outAndBackRetraceShare: 0.35,
  /** Ends closer than this are a loop, whatever the line length. */
  loopMaxEndpointMeters: 250,
  /** Or ends closer than this share of the line length. */
  loopMaxClosureRatio: 0.05,
} as const;

interface LineSample {
  readonly coordinate: Coordinate;
  readonly distanceMeters: number;
}

function at(from: Coordinate, to: Coordinate, fraction: number): Coordinate {
  return {
    lon: from.lon + (to.lon - from.lon) * fraction,
    lat: from.lat + (to.lat - from.lat) * fraction,
  };
}

/**
 * Samples the line at a fixed along-line spacing. Interpolation is linear in
 * lon/lat, which is far below any measuring precision at 25 m spacing.
 */
function sampleLine(line: readonly Coordinate[]): LineSample[] {
  const samples: LineSample[] = [];
  let travelled = 0;
  let nextSampleAt = 0;

  for (let index = 0; index < line.length; index += 1) {
    const coordinate = line[index];
    if (coordinate === undefined) continue;
    if (index === 0) {
      samples.push({ coordinate, distanceMeters: 0 });
      nextSampleAt = SHAPE_LIMITS.sampleSpacingMeters;
      continue;
    }
    const previous = line[index - 1];
    if (previous === undefined) continue;
    const segmentMeters = haversine(previous, coordinate);
    if (!(segmentMeters > 0)) continue;
    while (nextSampleAt <= travelled + segmentMeters) {
      const fraction = (nextSampleAt - travelled) / segmentMeters;
      samples.push({
        coordinate: at(previous, coordinate, fraction),
        distanceMeters: nextSampleAt,
      });
      nextSampleAt += SHAPE_LIMITS.sampleSpacingMeters;
    }
    travelled += segmentMeters;
  }

  const last = line[line.length - 1];
  const lastSample = samples[samples.length - 1];
  if (last !== undefined && (lastSample === undefined || travelled - lastSample.distanceMeters > 1)) {
    samples.push({ coordinate: last, distanceMeters: travelled });
  }
  return samples;
}

function isNearEarlier(
  sample: LineSample,
  grid: ReadonlyMap<string, readonly LineSample[]>,
  cosLat: number,
  cellMeters: number,
): boolean {
  const x = Math.floor((sample.coordinate.lon * cosLat * METERS_PER_DEGREE) / cellMeters);
  const y = Math.floor((sample.coordinate.lat * METERS_PER_DEGREE) / cellMeters);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const bucket = grid.get(`${x + dx},${y + dy}`);
      if (bucket === undefined) continue;
      for (const candidate of bucket) {
        if (
          haversine(sample.coordinate, candidate.coordinate) <=
          SHAPE_LIMITS.retraceToleranceMeters
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Share of sampled positions that lie within the retrace tolerance of a
 * position at least `retraceMinSeparationMeters` earlier along the line.
 *
 * Earlier samples age into a uniform grid, so the test is one neighbourhood
 * lookup per sample instead of an all-pairs comparison on long lines.
 */
function retraceShare(samples: readonly LineSample[]): number {
  if (samples.length < 2) return 0;
  const middle = samples[Math.floor(samples.length / 2)];
  const centerLat = middle === undefined ? 0 : middle.coordinate.lat;
  // Clamped so a polar line cannot shrink longitude cells to nothing.
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const cellMeters = SHAPE_LIMITS.retraceToleranceMeters;
  const grid = new Map<string, LineSample[]>();

  let aged = 0;
  let retraced = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample === undefined) continue;

    while (aged < index) {
      const candidate = samples[aged];
      if (candidate === undefined) {
        aged += 1;
        continue;
      }
      if (
        candidate.distanceMeters >
        sample.distanceMeters - SHAPE_LIMITS.retraceMinSeparationMeters
      ) {
        break;
      }
      const x = Math.floor((candidate.coordinate.lon * cosLat * METERS_PER_DEGREE) / cellMeters);
      const y = Math.floor((candidate.coordinate.lat * METERS_PER_DEGREE) / cellMeters);
      const key = `${x},${y}`;
      const bucket = grid.get(key);
      if (bucket === undefined) grid.set(key, [candidate]);
      else bucket.push(candidate);
      aged += 1;
    }

    if (isNearEarlier(sample, grid, cosLat, cellMeters)) retraced += 1;
  }
  return retraced / samples.length;
}

function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function explain(
  shape: HikeShape,
  lengthMeters: number,
  endpointDistanceMeters: number,
  closureRatio: number,
  retraced: number,
): string {
  if (shape === "unknown") {
    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) {
      return "Shape unknown: the line has no measurable length.";
    }
    return `Shape unknown: a ${formatMeters(lengthMeters)} line is too short to tell a loop from an out-and-back.`;
  }
  const ends = `the ends are ${formatMeters(endpointDistanceMeters)} apart (${formatShare(closureRatio)} of the line)`;
  const retrace = `${formatShare(retraced)} of the line retraces an earlier stretch more than ${SHAPE_LIMITS.retraceMinSeparationMeters} m back`;
  if (shape === "out-and-back") return `Out and back: ${retrace}, and ${ends}.`;
  if (shape === "loop") return `Loop: ${ends}, and only ${formatShare(retraced)} of the line retraces an earlier stretch.`;
  return `Point to point: ${ends}, and only ${formatShare(retraced)} of the line retraces an earlier stretch.`;
}

/**
 * Classifies the line. A line under {@link SHAPE_LIMITS.minClassifiableLengthMeters}
 * is `unknown` rather than guessed: 80 m of sidewalk is all three shapes.
 */
export function classifyShape(line: readonly Coordinate[]): HikeShapeClassification {
  const lengthMeters = lineLengthMeters(line);
  const first = line[0];
  const last = line[line.length - 1];
  const endpointDistanceMeters =
    first !== undefined && last !== undefined ? haversine(first, last) : 0;
  const endpointClosureRatio = lengthMeters > 0 ? endpointDistanceMeters / lengthMeters : 0;
  const samples = sampleLine(line);
  const retraced = retraceShare(samples);

  let shape: HikeShape;
  if (
    !Number.isFinite(lengthMeters) ||
    lengthMeters < SHAPE_LIMITS.minClassifiableLengthMeters ||
    samples.length < 2
  ) {
    shape = "unknown";
  } else if (retraced >= SHAPE_LIMITS.outAndBackRetraceShare) {
    shape = "out-and-back";
  } else if (
    endpointDistanceMeters <= SHAPE_LIMITS.loopMaxEndpointMeters ||
    endpointClosureRatio <= SHAPE_LIMITS.loopMaxClosureRatio
  ) {
    shape = "loop";
  } else {
    shape = "point-to-point";
  }

  return {
    shape,
    lengthMeters,
    endpointDistanceMeters,
    endpointClosureRatio,
    retracedShare: retraced,
    explanation: explain(shape, lengthMeters, endpointDistanceMeters, endpointClosureRatio, retraced),
  };
}
