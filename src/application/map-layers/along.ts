/**
 * Stops along a route (UX rework phase 8): where the fuel is, and the longest
 * stretch without it — the question a rider with a 150-mile tank actually asks.
 *
 * Pure geometry on `[lon, lat]` lines, shared by the server (which finds the
 * stops) and the planner (which measures the gaps against the bike's range).
 */

import type { InfoFeature, LngLat } from "./types";

const EARTH_RADIUS_METERS = 6_371_000;
export const METERS_PER_MILE = 1609.344;

/** A stop found near the route, with where it sits along it. */
export interface AlongStop {
  readonly feature: InfoFeature;
  /** Distance from the route's start to the stop's nearest point on it. */
  readonly alongMeters: number;
  /** How far off the route the stop is. */
  readonly offMeters: number;
}

export interface AlongStopsResult {
  readonly stops: readonly AlongStop[];
  readonly available: boolean;
}

function radians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthMeters(line: readonly LngLat[]): number {
  let total = 0;
  for (let index = 1; index < line.length; index += 1) total += haversineMeters(line[index - 1]!, line[index]!);
  return total;
}

/**
 * Points every `spacingMeters` along the line (start and end included), with
 * the spacing widened so no more than `maxSamples` come back.
 */
export function sampleLine(line: readonly LngLat[], spacingMeters: number, maxSamples: number): readonly LngLat[] {
  if (line.length === 0) return [];
  const total = lineLengthMeters(line);
  const spacing = Math.max(spacingMeters, total / Math.max(1, maxSamples - 1));
  const samples: LngLat[] = [line[0]!];
  let next = spacing;
  let walked = 0;
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]!;
    const b = line[index]!;
    const step = haversineMeters(a, b);
    while (step > 0 && walked + step >= next && samples.length < maxSamples - 1) {
      const t = (next - walked) / step;
      samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += spacing;
    }
    walked += step;
  }
  const last = line[line.length - 1]!;
  if (samples.length === 1 || haversineMeters(samples[samples.length - 1]!, last) > spacing / 4) samples.push(last);
  return samples;
}

/** Where a point sits along a line: distance from the start, and off the line. */
export function projectAlong(line: readonly LngLat[], point: LngLat): { readonly alongMeters: number; readonly offMeters: number } {
  let best = { alongMeters: 0, offMeters: Number.POSITIVE_INFINITY };
  let walked = 0;
  const cosLat = Math.cos(radians(point[1]));
  for (let index = 1; index < line.length; index += 1) {
    const a = line[index - 1]!;
    const b = line[index]!;
    // Local equirectangular projection around the point: accurate at stop scale.
    const ax = (a[0] - point[0]) * cosLat;
    const ay = a[1] - point[1];
    const bx = (b[0] - point[0]) * cosLat;
    const by = b[1] - point[1];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const foot: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const off = haversineMeters(foot, point);
    const segment = haversineMeters(a, b);
    if (off < best.offMeters) best = { alongMeters: walked + segment * t, offMeters: off };
    walked += segment;
  }
  return best;
}

export interface FuelGapSummary {
  /** The longest stretch of the route with no stop, start and finish included. */
  readonly longestGapMeters: number;
  /** Where that stretch starts, from the route's start. */
  readonly longestGapStartMeters: number;
  /** Stretches longer than the usable range, if a range is known. */
  readonly gapsOverRange: number;
}

/** The stretches between consecutive stops along a route of `totalMeters`. */
export function gapSummary(
  stops: readonly AlongStop[],
  totalMeters: number,
  usableRangeMeters: number | null,
): FuelGapSummary {
  const marks = [0, ...stops.map((stop) => Math.max(0, Math.min(totalMeters, stop.alongMeters))).sort((a, b) => a - b), totalMeters];
  let longest = 0;
  let longestStart = 0;
  let over = 0;
  for (let index = 1; index < marks.length; index += 1) {
    const gap = marks[index]! - marks[index - 1]!;
    if (gap > longest) {
      longest = gap;
      longestStart = marks[index - 1]!;
    }
    if (usableRangeMeters !== null && gap > usableRangeMeters) over += 1;
  }
  return { longestGapMeters: longest, longestGapStartMeters: longestStart, gapsOverRange: over };
}

/**
 * A short, spread-out list: the stop closest to the route in each band of
 * `bandMeters`, in route order, so a list of eight covers the whole ride
 * instead of eight stations at the start.
 */
export function spreadStops(stops: readonly AlongStop[], bandMeters: number, limit: number): readonly AlongStop[] {
  const bands = new Map<number, AlongStop>();
  for (const stop of stops) {
    const band = Math.floor(stop.alongMeters / Math.max(1, bandMeters));
    const current = bands.get(band);
    if (current === undefined || stop.offMeters < current.offMeters) bands.set(band, stop);
  }
  return [...bands.values()].sort((a, b) => a.alongMeters - b.alongMeters).slice(0, limit);
}
