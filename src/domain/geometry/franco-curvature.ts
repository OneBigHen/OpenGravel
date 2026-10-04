/**
 * Adam Franco style road curvature analysis for route and atlas lines.
 *
 * This is deliberately independent of GraphHopper's per-edge curvature
 * value.  A line is measured in metres, tight radii receive more weight, and
 * intersection corners and digitising noise are removed before sections are
 * ranked.  The implementation is used for both paved backroads and dirt
 * corridors (Franco v1).
 */

import { haversine } from "./analysis";
import type { Coordinate } from "@/domain/ride/types";

export const FRANCO_VERSION = "franco-v1";
export const FRANCO_MAX_STRAIGHT_RUN_METERS = 2_414;
export const FRANCO_SUPPRESSION_METERS = 30;
export const FRANCO_WORTHWHILE_CURVATURE = 300;
export const FRANCO_GREAT_CURVATURE = 1_000;

export interface FrancoSuppressionPoint {
  readonly coordinate: Coordinate;
  /** A source tag is retained in diagnostics; all listed points suppress. */
  readonly reason?: string;
}

export interface FrancoCurvatureOptions {
  /** Controls and intersection points where corners are not riding curves. */
  readonly controlPoints?: readonly (Coordinate | FrancoSuppressionPoint)[];
  /** Optional source-known vertex indices to suppress. */
  readonly suppressedVertexIndices?: readonly number[];
  /** A small angular change over a long gap is digitising noise. */
  readonly lookaheadSegments?: readonly number[];
}

export interface FrancoSection {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly lengthMeters: number;
  readonly bendMeters: number;
  readonly totalCurvature: number;
  readonly curvaturePerKm: number;
  readonly quality: "below-threshold" | "worthwhile" | "great";
}

export interface FrancoCurvatureAnalysis {
  readonly version: typeof FRANCO_VERSION;
  readonly totalCurvature: number;
  readonly curvaturePerKm: number;
  readonly bendMeters: number;
  readonly bendShare: number;
  readonly longestRunMeters: number;
  readonly sections: readonly FrancoSection[];
  readonly suppressedVertexIndices: readonly number[];
}

interface XY {
  readonly x: number;
  readonly y: number;
}

function project(point: Coordinate, origin: Coordinate): XY {
  const latScale = Math.PI / 180;
  const cos = Math.cos((origin.lat * latScale));
  return {
    x: (point.lon - origin.lon) * 111_320 * cos,
    y: (point.lat - origin.lat) * 110_540,
  };
}

function distance(a: Coordinate, b: Coordinate): number {
  return haversine(a, b);
}

function heading(a: Coordinate, b: Coordinate): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function angleDifference(left: number, right: number): number {
  return Math.abs(((right - left + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

function circumradius(a: XY, b: XY, c: XY): number {
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const twiceArea = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  if (twiceArea < 1e-6 || ab < 1 || bc < 1 || ca < 1) return Number.POSITIVE_INFINITY;
  return (ab * bc * ca) / (2 * twiceArea);
}

function radiusWeight(radius: number): number {
  if (radius < 30) return 2;
  if (radius < 60) return 1.6;
  if (radius < 100) return 1.3;
  if (radius < 175) return 1;
  return 0;
}

function suppressionDistance(point: Coordinate, controls: readonly Coordinate[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const control of controls) nearest = Math.min(nearest, distance(point, control));
  return nearest;
}

function coordinateOf(value: Coordinate | FrancoSuppressionPoint): Coordinate {
  return "coordinate" in value ? value.coordinate : value;
}

function quality(totalCurvature: number): FrancoSection["quality"] {
  if (totalCurvature >= FRANCO_GREAT_CURVATURE) return "great";
  if (totalCurvature >= FRANCO_WORTHWHILE_CURVATURE) return "worthwhile";
  return "below-threshold";
}

/** Analyze a line using the Franco v1 radius, noise, and intersection rules. */
export function analyzeFrancoCurvature(
  line: readonly Coordinate[],
  options: FrancoCurvatureOptions = {},
): FrancoCurvatureAnalysis {
  if (line.length < 3) {
    return {
      version: FRANCO_VERSION,
      totalCurvature: 0,
      curvaturePerKm: 0,
      bendMeters: 0,
      bendShare: 0,
      longestRunMeters: 0,
      sections: [],
      suppressedVertexIndices: [],
    };
  }

  const origin = line[0] as Coordinate;
  const projected = line.map((point) => project(point, origin));
  const segments = line.slice(0, -1).map((point, index) => distance(point, line[index + 1] as Coordinate));
  const controls = (options.controlPoints ?? []).map(coordinateOf);
  const suppressed = new Set(options.suppressedVertexIndices ?? []);
  const lookahead = options.lookaheadSegments ?? [3, 4, 5, 6, 7];
  const weights = new Array<number>(line.length).fill(0);

  for (let index = 1; index < line.length - 1; index += 1) {
    const before = segments[index - 1] ?? 0;
    const after = segments[index] ?? 0;
    if (before < 1 || after < 1 || suppressed.has(index)) continue;
    if (controls.length > 0 && suppressionDistance(line[index] as Coordinate, controls) <= FRANCO_SUPPRESSION_METERS) continue;

    const radius = circumradius(
      projected[index - 1] as XY,
      projected[index] as XY,
      projected[index + 1] as XY,
    );
    const weight = radiusWeight(radius);
    if (weight === 0) continue;

    // A heading change spread across a long look-ahead is a straight-road
    // digitising artefact. `gap / 175` is the angular change of a 175 m
    // radius arc over that gap (radians), which is Franco's gap threshold.
    const incoming = heading(line[index - 1] as Coordinate, line[index] as Coordinate);
    let noisy = false;
    for (const count of lookahead) {
      const target = Math.min(line.length - 1, index + count);
      if (target <= index) continue;
      const gap = segments.slice(index, target).reduce((sum, value) => sum + value, 0);
      if (gap <= 0) continue;
      let cumulativeDeflection = angleDifference(incoming, heading(line[index] as Coordinate, line[index + 1] as Coordinate));
      for (let vertex = index + 1; vertex < target - 1; vertex += 1) {
        cumulativeDeflection += angleDifference(
          heading(line[vertex] as Coordinate, line[vertex + 1] as Coordinate),
          heading(line[vertex + 1] as Coordinate, line[vertex + 2] as Coordinate),
        );
      }
      if (cumulativeDeflection < gap / 175) {
        noisy = true;
        break;
      }
    }
    if (!noisy) weights[index] = weight;
  }

  let totalCurvature = 0;
  let bendMeters = 0;
  let longestRunMeters = 0;
  const sections: FrancoSection[] = [];
  let start = -1;
  let lengthMeters = 0;
  let sectionBend = 0;
  let sectionCurvature = 0;
  let lastIncludedSegment = -1;

  const flush = (): void => {
    if (start < 0) return;
    const endIndex = Math.max(start + 1, Math.min(line.length - 1, lastIncludedSegment + 1));
    const section: FrancoSection = {
      startIndex: start,
      endIndex,
      lengthMeters,
      bendMeters: sectionBend,
      totalCurvature: sectionCurvature,
      curvaturePerKm: lengthMeters > 0 ? (sectionCurvature / lengthMeters) * 1000 : 0,
      quality: quality(sectionCurvature),
    };
    sections.push(section);
    start = -1;
    lengthMeters = 0;
    sectionBend = 0;
    sectionCurvature = 0;
    lastIncludedSegment = -1;
  };

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? 0;
    const vertexWeight = Math.max(weights[index] ?? 0, weights[index + 1] ?? 0);
    if (vertexWeight > 0) {
      if (start < 0) start = index;
      lengthMeters += segment;
      sectionBend += segment;
      sectionCurvature += segment * vertexWeight;
      totalCurvature += segment * vertexWeight;
      bendMeters += segment;
      lastIncludedSegment = index;
    } else {
      longestRunMeters = Math.max(longestRunMeters, lengthMeters);
      flush();
    }
  }
  flush();

  const totalLength = segments.reduce((sum, value) => sum + value, 0);
  return {
    version: FRANCO_VERSION,
    totalCurvature,
    curvaturePerKm: totalLength > 0 ? (totalCurvature / totalLength) * 1000 : 0,
    bendMeters,
    bendShare: totalLength > 0 ? bendMeters / totalLength : 0,
    longestRunMeters: Math.max(longestRunMeters, ...sections.map((section) => section.lengthMeters), 0),
    sections,
    suppressedVertexIndices: [...suppressed].sort((left, right) => left - right),
  };
}
