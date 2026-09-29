/**
 * Geometry analysis for routing decisions (Task 3.1, 06 §9).
 *
 * Ported from the legacy `src/lib/routing/scoring.ts` geometry half
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`); the
 * algorithms are kept and the coordinate type is the VNext `{ lon, lat }`
 * object instead of the legacy `[lon, lat]` tuple.
 *
 * Everything here is a **measurement of the geometry we actually have**. That
 * is a deliberate limit: curvature and turn density are derived from the
 * returned line, never presented as mapped road character (07 §4's
 * `switchback-geometry` provenance limitation). No module here reads road
 * evidence, a clock, or a random source, so the same line always yields the
 * same numbers (03-DOMAIN-MODEL §19).
 */

import type { Coordinate } from "../ride/types";

const EARTH_RADIUS_METERS = 6_371_000;

/** One provider detail interval: `[fromIndex, toIndex, value]`. */
export type DetailInterval = readonly [from: number, to: number, value: string];

/** Bend summary of a line, in the legacy `GeometryAnalysis` shape. */
export interface GeometryAnalysis {
  /** 0–100 integer from directional change per km and meaningful turns per km. */
  readonly twistiness: number;
  readonly turnCount: number;
  /** Meaningful turns per kilometre, rounded to 2 decimals. */
  readonly turnDensity: number;
  /** 0–1 share of the line that is not turning, rounded to 3 decimals. */
  readonly straightRatio: number;
}

/** Smoothed (point-noise-resistant) bend metrics. */
export interface SmoothedRouteMetrics {
  /** 0–100; curved share dominates and turn density saturates near 4 turns/mile. */
  readonly twistiness: number;
  /** Meaningful turns on simplified ≥40 m segments with a 15°–120° bearing change. */
  readonly turnCount: number;
  readonly turnsPerMile: number;
  /** Share 0–1 of route distance on curved road (curvature < 0.98). */
  readonly curvedDistanceShare: number;
}

const SIMPLIFY_TOLERANCE_METERS = 25;
const MIN_TURN_SEGMENT_METERS = 40;
const MIN_TURN_BEARING_DEGREES = 15;
const MAX_TURN_BEARING_DEGREES = 120;
const CURVED_CURVATURE_THRESHOLD = 0.98;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/**
 * Great-circle distance between two positions, in meters.
 *
 * A non-finite component produces `NaN`, never a plausible-looking number: a
 * caller must reject malformed geometry rather than measure it (`evaluateEligibility`).
 */
export function haversine(first: Coordinate, second: Coordinate): number {
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const latitudeDelta = secondLat - firstLat;
  const longitudeDelta = toRadians(second.lon - first.lon);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

function bearing(first: Coordinate, second: Coordinate): number {
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const longitudeDelta = toRadians(second.lon - first.lon);
  const y = Math.sin(longitudeDelta) * Math.cos(secondLat);
  const x =
    Math.cos(firstLat) * Math.sin(secondLat) -
    Math.sin(firstLat) * Math.cos(secondLat) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function turnAngle(firstBearing: number, secondBearing: number): number {
  let angle = secondBearing - firstBearing;
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Bend summary of a line: meaningful turns (≥12°) and directional change per
 * kilometre. Fewer than three points, or fewer than two measurable segments,
 * is the zero analysis.
 */
export function analyzeGeometry(coordinates: readonly Coordinate[]): GeometryAnalysis {
  const empty: GeometryAnalysis = {
    twistiness: 0,
    turnCount: 0,
    turnDensity: 0,
    straightRatio: 1,
  };
  if (coordinates.length < 3) return empty;

  const segments: { distance: number; bearing: number }[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (start === undefined || end === undefined) continue;
    const distance = haversine(start, end);
    if (distance >= 2) segments.push({ distance, bearing: bearing(start, end) });
  }

  const distanceKilometers =
    segments.reduce((total, segment) => total + segment.distance, 0) / 1000;
  if (segments.length < 2 || distanceKilometers === 0) return empty;

  const meaningfulTurns: number[] = [];
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const first = segments[index];
    const second = segments[index + 1];
    if (first === undefined || second === undefined) continue;
    const angle = Math.abs(turnAngle(first.bearing, second.bearing));
    if (angle >= 12) meaningfulTurns.push(angle);
  }

  const totalTurnDegrees = meaningfulTurns.reduce((total, angle) => total + angle, 0);
  const turnDensity = meaningfulTurns.length / distanceKilometers;
  const directionalChangePerKilometer = totalTurnDegrees / distanceKilometers;
  const twistiness = Math.round(
    Math.min(100, directionalChangePerKilometer * 1.9 + turnDensity * 9),
  );
  const straightRatio = clamp(
    1 - totalTurnDegrees / Math.max(180, distanceKilometers * 50),
    0,
    1,
  );

  return {
    twistiness,
    turnCount: meaningfulTurns.length,
    turnDensity: Number(turnDensity.toFixed(2)),
    straightRatio: Number(straightRatio.toFixed(3)),
  };
}

/** Distance from a point to a great-circle line segment, in meters. */
export function pointToSegmentDistanceMeters(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number {
  const segmentMeters = haversine(start, end);
  if (segmentMeters < 1) return haversine(point, start);
  // Project onto the segment using a local equirectangular plane.
  const cosLat = Math.cos((((start.lat + end.lat) / 2) * Math.PI) / 180);
  const ax = start.lon * cosLat;
  const ay = start.lat;
  const bx = end.lon * cosLat;
  const by = end.lat;
  const px = point.lon * cosLat;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  const nearest: Coordinate = { lon: (ax + t * dx) / cosLat, lat: ay + t * dy };
  return haversine(nearest, point);
}

/**
 * Douglas-Peucker simplification with a tolerance in meters. Keeps the first and
 * last coordinates; an interior point is dropped when it lies within the
 * tolerance of the chord.
 *
 * The kept set is the legacy recursive algorithm's; the walk is iterative so a
 * pathological 50k-point line cannot overflow the stack.
 */
export function simplifyGeometry(
  coordinates: readonly Coordinate[],
  toleranceMeters = SIMPLIFY_TOLERANCE_METERS,
): Coordinate[] {
  if (coordinates.length <= 2) return [...coordinates];
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first === undefined || last === undefined) return [...coordinates];

  const keep = new Array<boolean>(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;

  const pending: { start: number; end: number }[] = [
    { start: 0, end: coordinates.length - 1 },
  ];
  while (pending.length > 0) {
    const range = pending.pop();
    if (range === undefined) break;
    const { start, end } = range;
    if (end <= start + 1) continue;
    const startPoint = coordinates[start];
    const endPoint = coordinates[end];
    if (startPoint === undefined || endPoint === undefined) continue;

    const farthest = farthestInteriorPoint(
      coordinates,
      start,
      end,
      startPoint,
      endPoint,
    );
    if (farthest !== null && farthest.distance > toleranceMeters) {
      keep[farthest.index] = true;
      pending.push(
        { start, end: farthest.index },
        { start: farthest.index, end },
      );
    }
  }

  const simplified: Coordinate[] = [];
  for (let index = 0; index < coordinates.length; index += 1) {
    const point = coordinates[index];
    if (point !== undefined && keep[index] === true) simplified.push(point);
  }
  return simplified;
}

function turnAngleDegrees(firstBearing: number, secondBearing: number): number {
  return Math.abs(turnAngle(firstBearing, secondBearing));
}

/** Index and distance of the interior point farthest from the chord, or `null`. */
function farthestInteriorPoint(
  coordinates: readonly Coordinate[],
  start: number,
  end: number,
  startPoint: Coordinate,
  endPoint: Coordinate,
): { readonly index: number; readonly distance: number } | null {
  let best: { index: number; distance: number } | null = null;
  for (let index = start + 1; index < end; index += 1) {
    const point = coordinates[index];
    if (point === undefined) continue;
    const distance = pointToSegmentDistanceMeters(point, startPoint, endPoint);
    if (best === null || distance > best.distance) best = { index, distance };
  }
  return best;
}

/**
 * Distance-weighted share of a route whose provider `curvature` detail is below
 * the curved threshold. Falls back to the smoothed geometry estimate when the
 * provider omitted the detail, so missing data degrades but never fabricates
 * curvature.
 */
export function curvedDistanceShare(
  coordinates: readonly Coordinate[],
  curvatureDetails?: readonly DetailInterval[],
): number {
  if (curvatureDetails !== undefined && curvatureDetails.length > 0) {
    let curved = 0;
    let total = 0;
    for (const [from, to, value] of curvatureDetails) {
      let distance = 0;
      for (
        let index = Math.max(0, from);
        index < Math.min(to, coordinates.length - 1);
        index += 1
      ) {
        const start = coordinates[index];
        const end = coordinates[index + 1];
        if (start === undefined || end === undefined) continue;
        distance += haversine(start, end);
      }
      total += distance;
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric < CURVED_CURVATURE_THRESHOLD) {
        curved += distance;
      }
    }
    return total > 0 ? curved / total : 0;
  }
  return smoothedRouteMetrics(coordinates).curvedDistanceShare;
}

/**
 * Point-noise-resistant bend metrics: simplify at 25 m, then count meaningful
 * turns on simplified segments of at least 40 m with bearing changes from 15°
 * through 120°, so point noise and U-turns cannot saturate a "fun" score.
 */
export function smoothedRouteMetrics(
  coordinates: readonly Coordinate[],
): SmoothedRouteMetrics {
  const simplified = simplifyGeometry(coordinates);
  if (simplified.length < 3) {
    return { twistiness: 0, turnCount: 0, turnsPerMile: 0, curvedDistanceShare: 0 };
  }

  const segments: {
    distance: number;
    bearing: number;
  }[] = [];
  for (let index = 0; index + 1 < simplified.length; index += 1) {
    const start = simplified[index];
    const end = simplified[index + 1];
    if (start === undefined || end === undefined) continue;
    segments.push({
      distance: haversine(start, end),
      bearing: bearing(start, end),
    });
  }

  const totalDistance = segments.reduce(
    (total, segment) => total + segment.distance,
    0,
  );

  let meaningfulTurns = 0;
  let curvedDistance = 0;
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const first = segments[index];
    const second = segments[index + 1];
    if (first === undefined || second === undefined) continue;
    if (
      first.distance < MIN_TURN_SEGMENT_METERS ||
      second.distance < MIN_TURN_SEGMENT_METERS
    ) {
      continue;
    }
    const angle = turnAngleDegrees(first.bearing, second.bearing);
    if (angle >= MIN_TURN_BEARING_DEGREES && angle <= MAX_TURN_BEARING_DEGREES) {
      meaningfulTurns += 1;
      // The shared vertex's adjacent segments count as curved when the turn is
      // meaningful (the locked Phase-4 semantics).
      curvedDistance += first.distance + second.distance;
    }
  }
  curvedDistance = Math.min(curvedDistance, totalDistance);

  const miles = totalDistance / 1609.344;
  const turnsPerMile = miles > 0 ? meaningfulTurns / miles : 0;
  const curvedShare = totalDistance > 0 ? curvedDistance / totalDistance : 0;
  const twistiness = Math.round(
    Math.min(100, curvedShare * 60 + Math.min(1, turnsPerMile / 4) * 40),
  );
  return {
    twistiness,
    turnCount: meaningfulTurns,
    turnsPerMile: Number(turnsPerMile.toFixed(2)),
    curvedDistanceShare: Number(curvedShare.toFixed(3)),
  };
}

/** Resamples a line every `spacingMeters`, for the overlap comparison. */
function sampleLine(
  coordinates: readonly Coordinate[],
  spacingMeters = 120,
): Coordinate[] {
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (coordinates.length < 2 || first === undefined || last === undefined) {
    return [...coordinates];
  }
  const samples: Coordinate[] = [first];
  let carry = 0;

  for (let index = 0; index + 1 < coordinates.length; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    if (start === undefined || end === undefined) continue;
    const segmentDistance = haversine(start, end);
    if (segmentDistance === 0) continue;

    let position = spacingMeters - carry;
    while (position < segmentDistance) {
      const ratio = position / segmentDistance;
      samples.push({
        lon: start.lon + (end.lon - start.lon) * ratio,
        lat: start.lat + (end.lat - start.lat) * ratio,
      });
      position += spacingMeters;
    }
    carry = Math.max(0, segmentDistance - (position - spacingMeters));
  }

  samples.push(last);
  return samples;
}

function haversineSq(first: Coordinate, second: Coordinate): number {
  return haversine(first, second) ** 2;
}

/**
 * Share of `first`'s samples that sit within ~140 m of a `second` sample, using
 * a coarse grid so the comparison stays linear in the number of samples.
 */
function directionalOverlap(
  first: readonly Coordinate[],
  second: readonly Coordinate[],
): number {
  if (first.length === 0 || second.length === 0) return 0;

  const gridMeters = 140;
  const degreesPerMeter = 1 / 111_000;
  const cellDegrees = gridMeters * degreesPerMeter;

  const buckets = new Map<string, Coordinate[]>();
  for (const coordinate of second) {
    const key = `${Math.round(coordinate.lat / cellDegrees)},${Math.round(coordinate.lon / cellDegrees)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(coordinate);
    else buckets.set(key, [coordinate]);
  }

  let matches = 0;
  const thresholdSq = (gridMeters * 1.05) ** 2;
  for (const coordinate of first) {
    const cx = Math.round(coordinate.lat / cellDegrees);
    const cy = Math.round(coordinate.lon / cellDegrees);
    let found = false;
    outer: for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const bucket = buckets.get(`${cx + dx},${cy + dy}`);
        if (bucket === undefined) continue;
        for (const candidate of bucket) {
          if (haversineSq(coordinate, candidate) <= thresholdSq) {
            found = true;
            break outer;
          }
        }
      }
    }
    if (found) matches += 1;
  }
  return matches / first.length;
}

/**
 * Symmetric overlap of two lines, as an integer percentage (0–100). Used by the
 * diversity/dedupe stage (06 §14) to reject near-duplicates across providers.
 */
export function calculateGeometryOverlap(
  first: readonly Coordinate[],
  second: readonly Coordinate[],
): number {
  const firstSamples = sampleLine(first);
  const secondSamples = sampleLine(second);
  const overlap =
    (directionalOverlap(firstSamples, secondSamples) +
      directionalOverlap(secondSamples, firstSamples)) /
    2;
  return Math.round(overlap * 100);
}
