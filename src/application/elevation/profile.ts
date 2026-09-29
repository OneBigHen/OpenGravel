/**
 * The elevation profile of a route (UX rework phase 3).
 *
 * Pure: the line is resampled at even distances, the source answers one
 * elevation per sample, and this module turns the pair into what the rider
 * reads — climb, descent, lowest and highest point, and the steepest sustained
 * grade. Elevations are provider data about the route, never ride state.
 */

import { haversine } from "@/domain/geometry/analysis";
import type { Coordinate } from "@/domain/ride/types";

/** Samples per profile: fine enough for a 200-mile ride, cheap for the tile source. */
export const ELEVATION_SAMPLES = 160;

/**
 * Climb is counted only once the line has risen this far from its last turning
 * point, so DEM noise on a flat road never adds up to phantom feet.
 */
const CLIMB_HYSTERESIS_METERS = 4;

/** The steepest grade is measured over this run, not between two noisy pixels. */
const GRADE_RUN_METERS = 400;

export interface ElevationSample {
  readonly coordinate: Coordinate;
  readonly distanceMeters: number;
}

export type ElevationResult =
  | { readonly availability: "available"; readonly elevationsMeters: readonly number[] }
  | { readonly availability: "unavailable"; readonly reason: string };

/** The elevation port: one elevation per point, or an honest unavailable. */
export interface ElevationSource {
  elevations(points: readonly Coordinate[], signal?: AbortSignal): Promise<ElevationResult>;
}

export interface ElevationProfile {
  readonly points: readonly {
    readonly distanceMeters: number;
    readonly elevationMeters: number;
    /** Where on the line this sample is, for the map's scrub marker. */
    readonly coordinate: Coordinate;
  }[];
  readonly totalMeters: number;
  readonly climbMeters: number;
  readonly descentMeters: number;
  readonly minMeters: number;
  readonly maxMeters: number;
  /** Steepest sustained grade uphill, as a percentage; `null` on a short line. */
  readonly steepestGradePercent: number | null;
}

/** `count` points evenly spaced along the line by distance, both ends included. */
export function sampleLine(line: readonly Coordinate[], count: number = ELEVATION_SAMPLES): readonly ElevationSample[] {
  if (line.length < 2 || count < 2) return [];
  const cumulative: number[] = [0];
  for (let index = 1; index < line.length; index += 1) {
    cumulative.push(cumulative[index - 1]! + haversine(line[index - 1]!, line[index]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total <= 0) return [];
  const samples: ElevationSample[] = [];
  let segment = 1;
  for (let step = 0; step < count; step += 1) {
    const target = (total * step) / (count - 1);
    while (segment < line.length - 1 && cumulative[segment]! < target) segment += 1;
    const start = cumulative[segment - 1]!;
    const length = cumulative[segment]! - start;
    const t = length <= 0 ? 0 : Math.min(1, Math.max(0, (target - start) / length));
    const a = line[segment - 1]!;
    const b = line[segment]!;
    samples.push({
      coordinate: { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t },
      distanceMeters: target,
    });
  }
  return samples;
}

/** Climb and descent with hysteresis, so DEM noise is not counted as climbing. */
function climbAndDescent(elevations: readonly number[]): { climb: number; descent: number } {
  let climb = 0;
  let descent = 0;
  let anchor = elevations[0] ?? 0;
  for (const elevation of elevations) {
    const delta = elevation - anchor;
    if (delta >= CLIMB_HYSTERESIS_METERS) {
      climb += delta;
      anchor = elevation;
    } else if (delta <= -CLIMB_HYSTERESIS_METERS) {
      descent -= delta;
      anchor = elevation;
    }
  }
  return { climb, descent };
}

function steepestGrade(points: ElevationProfile["points"]): number | null {
  let steepest: number | null = null;
  let back = 0;
  for (let index = 1; index < points.length; index += 1) {
    const here = points[index]!;
    while (back < index && here.distanceMeters - points[back + 1]!.distanceMeters >= GRADE_RUN_METERS) back += 1;
    const from = points[back]!;
    const run = here.distanceMeters - from.distanceMeters;
    if (run < GRADE_RUN_METERS) continue;
    const grade = ((here.elevationMeters - from.elevationMeters) / run) * 100;
    if (steepest === null || grade > steepest) steepest = grade;
  }
  return steepest;
}

/** The profile from samples and the source's answer; `null` if they disagree. */
export function buildElevationProfile(
  samples: readonly ElevationSample[],
  elevationsMeters: readonly number[],
): ElevationProfile | null {
  if (samples.length < 2 || samples.length !== elevationsMeters.length) return null;
  if (!elevationsMeters.every((value) => Number.isFinite(value))) return null;
  const points = samples.map((sample, index) => ({
    distanceMeters: sample.distanceMeters,
    elevationMeters: elevationsMeters[index]!,
    coordinate: sample.coordinate,
  }));
  const { climb, descent } = climbAndDescent(elevationsMeters);
  return {
    points,
    totalMeters: samples[samples.length - 1]!.distanceMeters,
    climbMeters: climb,
    descentMeters: descent,
    minMeters: Math.min(...elevationsMeters),
    maxMeters: Math.max(...elevationsMeters),
    steepestGradePercent: steepestGrade(points),
  };
}
