/**
 * The sketch corridor builder (04 §19, 05 §18–§19, 06 §18; Task 4.4).
 *
 * A rider's free-hand trace is **intent, not geometry**: the drawn line says which
 * way to go, and a router decides the road. This module is the one pure function
 * that turns raw multi-stroke input into what planning needs — a simplified
 * traversal corridor, the measured gap breaks between strokes, the topology hints
 * 05 §19 requires preserved, the derived endpoints, and a near-loop verdict.
 *
 * Four rules are load-bearing, and they are the reason this is a module rather
 * than a few lines inside the request builder:
 *
 * 1. **Authoring order is traversal order.** Strokes are consumed in the order the
 *    rider drew them, and the corridor is the concatenation of that order. A
 *    figure-eight is never collapsed "spatially" into a pinched loop, because the
 *    corridor is a path, not a shape.
 * 2. **A gap is only bridged when it is small.** Two strokes less than
 *    {@link STROKE_JOIN_GAP_METERS} apart are one continuous traversal; a longer
 *    gap becomes a **break**, and the segments either side of a break are reported
 *    as separate lines. Nothing here ever produces a long straight connector
 *    (06 §18) — the renderer draws one line per segment, and the provider anchors
 *    a break's two sides independently.
 * 3. **Simplification is bounded and structure-preserving.** Douglas–Peucker at
 *    {@link SKETCH_SIMPLIFY_TOLERANCE_METERS} bounds every dropped vertex, so the
 *    p95 chord error can never exceed it, and topology is detected on the **raw**
 *    trace, so a hairpin the simplifier could have flattened is still reported.
 * 4. **Nothing is fabricated.** A trace with fewer than two usable positions has no
 *    corridor and no endpoints; adherence is measured against the returned route
 *    rather than assumed, and an unmeasurable pair returns the zero verdict.
 *
 * Everything here is pure and deterministic: same strokes, same options, same
 * result, in any order of evaluation.
 */

import {
  haversine,
  simplifyGeometry,
} from "@/domain/geometry/analysis";
import {
  LOOP_CLOSE_METERS,
  MAX_SKETCH_CORRIDOR_ENVELOPE_METERS,
  MAX_SKETCH_REQUEST_ANCHORS,
  MAX_SKETCH_TOPOLOGY_HINTS,
  MIN_SKETCH_CORRIDOR_ENVELOPE_METERS,
  SKETCH_ADHERENCE_KNOWN_COVERED_SHARE,
  SKETCH_CORRIDOR_ENVELOPE_LENGTH_SHARE,
  SKETCH_DEVIATION_WARNING_COVERED_SHARE,
  SKETCH_SIMPLIFY_TOLERANCE_METERS,
  STROKE_DOUBLE_BACK_MIN_TURN_DEGREES,
  STROKE_JOIN_GAP_METERS,
} from "@/domain/sketch/types";
import type {
  SketchEndpoints,
  SketchTopologyHint,
} from "@/domain/sketch/types";
import { createLineIndex } from "@/domain/sketch/snap";
import type { EvidenceStatus } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";

/** The evidence key a sketch's adherence is recorded under (03 §18, 06 §18). */
export const SKETCH_ADHERENCE_EVIDENCE_KEY = "sketchAdherence";

/** Rider copy for a route that used the drawing as a vague direction. */
export const SKETCH_DEVIATION_WARNING = "Route deviates from your sketch.";

/** Two positions closer than this are one position. */
const SAME_POSITION_METERS = 0.5;

/** How far apart two reported crossings must be to be two crossings. */
const CROSSING_MERGE_METERS = 25;

/** Distances below this are one position for the double-back lookahead. */
const DOUBLE_BACK_MIN_SEGMENT_METERS = 3;

export interface SketchCorridorOptions {
  /** Gap at or below which two strokes are one traversal (04 §19). */
  readonly joinGapMeters?: number;
  /** Endpoint distance at or below which the trace is a near-loop (04 §19). */
  readonly loopCloseMeters?: number;
  /** Douglas–Peucker tolerance for the corridor (04 §19). */
  readonly simplifyToleranceMeters?: number;
  /** Turn angle that makes a consecutive reversal a double-back (05 §19). */
  readonly doubleBackDegrees?: number;
}

/**
 * One place the corridor stops being continuous: the rider lifted the pen for
 * longer than the join gap.
 *
 * `afterIndex` is the corridor index the break sits after, so a renderer can draw
 * `corridor[0..afterIndex]` and `corridor[afterIndex+1..]` as two lines and never
 * join them. `gapMeters` is the measured distance, kept so a consumer can explain
 * *why* it is two passes instead of guessing.
 */
export interface SketchCorridorBreak {
  /** The stroke the corridor resumes at, in authoring order. */
  readonly strokeIndex: number;
  readonly afterIndex: number;
  readonly gapMeters: number;
  /** The last drawn position before the gap. */
  readonly at: Coordinate;
}

export interface SketchCorridorResult {
  /** The whole traversal, in authoring order; breaks are not connectors to draw. */
  readonly corridor: Coordinate[];
  readonly breaks: readonly SketchCorridorBreak[];
  /** The drawn lines between breaks, each one a continuous pass. */
  readonly segments: readonly (readonly Coordinate[])[];
  readonly topologyHints: readonly SketchTopologyHint[];
  /** The rest of the stroke indices, in authoring order. */
  readonly strokeIndices: readonly number[];
  /** The trace's own endpoints, or `null` when there is no corridor. */
  readonly derivedEndpoints: SketchEndpoints | null;
  /** True when the trace's own endpoints are within the loop threshold. */
  readonly nearLoop: boolean;
  /** Total drawn length of the corridor, in meters. */
  readonly lengthMeters: number;
}

function isUsableCoordinate(coordinate: Coordinate | undefined): coordinate is Coordinate {
  return (
    coordinate !== undefined &&
    Number.isFinite(coordinate.lon) &&
    Number.isFinite(coordinate.lat) &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180 &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90
  );
}

/** One stroke's usable positions, with consecutive duplicates removed. */
function cleanStroke(stroke: readonly Coordinate[]): Coordinate[] {
  const cleaned: Coordinate[] = [];
  for (const coordinate of stroke) {
    if (!isUsableCoordinate(coordinate)) continue;
    const previous = cleaned[cleaned.length - 1];
    if (previous !== undefined && haversine(previous, coordinate) < SAME_POSITION_METERS) {
      continue;
    }
    cleaned.push({ lon: coordinate.lon, lat: coordinate.lat });
  }
  return cleaned;
}

/** A continuous pass assembled from one or more strokes, plus its point owners. */
interface RawPass {
  readonly strokeIndices: number[];
  readonly points: Coordinate[];
  /** The stroke index each point came from, parallel to `points`. */
  readonly pointStrokes: number[];
  /** The measured gap to the previous pass, or `null` for the first one. */
  readonly gapMeters: number | null;
  /** The position the gap starts from, or `null` for the first pass. */
  readonly gapFrom: Coordinate | null;
}

function bearingDegrees(first: Coordinate, second: Coordinate): number {
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const longitudeDelta = toRadians(second.lon - first.lon);
  const y = Math.sin(longitudeDelta) * Math.cos(secondLat);
  const x =
    Math.cos(firstLat) * Math.sin(secondLat) -
    Math.sin(firstLat) * Math.cos(secondLat) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** The absolute direction change between two consecutive segments, in degrees. */
function turnDegrees(
  before: Coordinate,
  pivot: Coordinate,
  after: Coordinate,
): number {
  let angle = bearingDegrees(pivot, after) - bearingDegrees(before, pivot);
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return Math.abs(angle);
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/**
 * The traversal passes: authoring order, joined only across a small gap.
 *
 * A join concatenates the next stroke's positions onto the previous pass, which is
 * what makes the corridor one continuous line; a gap beyond the threshold starts a
 * new pass and records the measured break.
 */
function buildPasses(
  strokes: readonly (readonly Coordinate[])[],
  joinGapMeters: number,
): RawPass[] {
  const passes: RawPass[] = [];
  strokes.forEach((stroke, index) => {
    const points = cleanStroke(stroke);
    if (points.length < 2) return;
    const previous = passes[passes.length - 1];
    const first = points[0];
    if (previous === undefined || first === undefined) {
      passes.push({
        strokeIndices: [index],
        points,
        pointStrokes: points.map(() => index),
        gapMeters: null,
        gapFrom: null,
      });
      return;
    }
    const previousLast = previous.points[previous.points.length - 1];
    if (previousLast === undefined) return;
    const gap = haversine(previousLast, first);
    if (gap <= joinGapMeters) {
      // A join inside the same position costs nothing; a join across a small gap
      // is the short hop the rider's finger made.
      const appended = gap < SAME_POSITION_METERS ? points.slice(1) : points;
      previous.points.push(...appended.map(copyCoordinate));
      for (let appendedIndex = 0; appendedIndex < appended.length; appendedIndex += 1) {
        previous.pointStrokes.push(index);
      }
      previous.strokeIndices.push(index);
      return;
    }
    passes.push({
      strokeIndices: [index],
      points,
      pointStrokes: points.map(() => index),
      gapMeters: gap,
      gapFrom: copyCoordinate(previousLast),
    });
  });
  return passes;
}

/** One candidate crossing, before de-duplication. */
interface CrossingCandidate {
  readonly at: Coordinate;
  readonly strokeIndices: readonly number[];
}

/**
 * Whether two segments of one pass may be tested at all.
 *
 * Adjacent segments meet at their shared vertex by construction, and a trace's own
 * first and last segments meet where the trace closes — which is a near-loop and is
 * reported as its own hint. Everything else is a real question.
 */
function segmentsMayCross(
  samePass: boolean,
  firstIndex: number,
  firstLength: number,
  secondIndex: number,
  secondLength: number,
): boolean {
  if (!samePass) return true;
  if (Math.abs(firstIndex - secondIndex) <= 1) return false;
  return !(
    (firstIndex === 1 && secondIndex === secondLength - 1) ||
    (secondIndex === 1 && firstIndex === firstLength - 1)
  );
}

/** Every segment pair between two passes that crosses, as raw candidates. */
function segmentCrossings(
  first: RawPass,
  second: RawPass,
  samePass: boolean,
): CrossingCandidate[] {
  const crossings: CrossingCandidate[] = [];
  for (let i = 1; i < first.points.length; i += 1) {
    const a0 = first.points[i - 1];
    const a1 = first.points[i];
    if (a0 === undefined || a1 === undefined) continue;
    for (let j = 1; j < second.points.length; j += 1) {
      if (
        !segmentsMayCross(samePass, i, first.points.length, j, second.points.length)
      ) {
        continue;
      }
      const b0 = second.points[j - 1];
      const b1 = second.points[j];
      if (b0 === undefined || b1 === undefined) continue;
      const at = properIntersection(a0, a1, b0, b1);
      if (at === null) continue;
      const ownerA = first.pointStrokes[i] ?? first.strokeIndices[0] ?? 0;
      const ownerB = second.pointStrokes[j] ?? second.strokeIndices[0] ?? 0;
      crossings.push({
        at,
        strokeIndices: ownerA === ownerB ? [ownerA] : [ownerA, ownerB],
      });
    }
  }
  return crossings;
}

/** The same crossing, sampled several times, is one hint. */
function sameCrossing(hint: SketchTopologyHint, candidate: CrossingCandidate): boolean {
  return (
    hint.kind === "crossing" &&
    haversine(hint.at, candidate.at) < CROSSING_MERGE_METERS &&
    (hint.strokeIndices ?? []).join(",") === candidate.strokeIndices.join(",")
  );
}

/**
 * Every crossing between two passes, or inside one (05 §19).
 *
 * A crossing is a segment intersection, endpoints included: two strokes that cross
 * exactly at a vertex — which is what a perpendicular crossing looks like once the
 * trace is sampled — cross just as much as two that cross between their vertices.
 * Three pairs are deliberately *not* crossings: two adjacent segments of one pass
 * (they meet at their shared vertex by construction), a trace's first and last
 * segments (that is the trace closing, reported as the near-loop hint), and
 * anything that does not meet at all. Pairs are de-duplicated within
 * {@link CROSSING_MERGE_METERS} and the same owner strokes, so one crossing
 * sampled several times is one hint.
 */
function crossingHints(passes: readonly RawPass[], limit: number): SketchTopologyHint[] {
  if (limit <= 0) return [];
  const candidates: CrossingCandidate[] = [];
  for (let a = 0; a < passes.length; a += 1) {
    const first = passes[a];
    if (first === undefined) continue;
    for (let b = a; b < passes.length; b += 1) {
      const second = passes[b];
      if (second === undefined) continue;
      if (candidates.length >= limit * 8) break;
      candidates.push(...segmentCrossings(first, second, a === b));
    }
  }

  const hints: SketchTopologyHint[] = [];
  for (const candidate of candidates) {
    if (hints.length >= limit) break;
    if (hints.some((hint) => sameCrossing(hint, candidate))) continue;
    hints.push({
      kind: "crossing",
      at: candidate.at,
      strokeIndices: candidate.strokeIndices,
    });
  }
  return hints;
}

/**
 * The intersection of two segments, or `null` when they do not cross properly.
 *
 * The projection is local and equirectangular, which is exact enough at the scale
 * a sketch is drawn at: two segments that cross within a few tens of meters cross
 * in the plane and in the world.
 */
function properIntersection(
  a0: Coordinate,
  a1: Coordinate,
  b0: Coordinate,
  b1: Coordinate,
): Coordinate | null {
  const cosLat = Math.cos((((a0.lat + a1.lat) / 2) * Math.PI) / 180);
  const ax0 = a0.lon * cosLat;
  const ay0 = a0.lat;
  const ax1 = a1.lon * cosLat;
  const ay1 = a1.lat;
  const bx0 = b0.lon * cosLat;
  const by0 = b0.lat;
  const bx1 = b1.lon * cosLat;
  const by1 = b1.lat;
  const denominator = (ax1 - ax0) * (by1 - by0) - (ay1 - ay0) * (bx1 - bx0);
  if (denominator === 0) return null;
  const t = ((bx0 - ax0) * (by1 - by0) - (by0 - ay0) * (bx1 - bx0)) / denominator;
  const u = ((bx0 - ax0) * (ay1 - ay0) - (by0 - ay0) * (ax1 - ax0)) / denominator;
  const epsilon = 1e-9;
  // Closed on both ends: two strokes that cross exactly at a vertex cross. The
  // caller removes the pairs that are not crossings — adjacent segments inside one
  // pass, and a trace's own closure.
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null;
  return {
    lon: (ax0 + t * (ax1 - ax0)) / cosLat,
    lat: ay0 + t * (ay1 - ay0),
  };
}

/**
 * Consecutive direction reversals inside one continuous pass (05 §19).
 *
 * The measurement is on the drawn sequence, not on the simplified corridor: a
 * simplifier is allowed to remove a vertex, and a double-back is exactly the
 * structure whose removal would change what the sketch means. Consecutive pivots
 * are merged, so a hairpin sampled every 20 m reports one hint rather than ten.
 */
function doubleBackHints(
  passes: readonly RawPass[],
  minimumDegrees: number,
  limit: number,
): SketchTopologyHint[] {
  const hints: SketchTopologyHint[] = [];
  for (const pass of passes) {
    let lastHintedIndex = -2;
    for (let index = 1; index + 1 < pass.points.length; index += 1) {
      if (hints.length >= limit) return hints;
      const before = pass.points[index - 1];
      const pivot = pass.points[index];
      const after = pass.points[index + 1];
      if (before === undefined || pivot === undefined || after === undefined) continue;
      if (
        haversine(before, pivot) < DOUBLE_BACK_MIN_SEGMENT_METERS ||
        haversine(pivot, after) < DOUBLE_BACK_MIN_SEGMENT_METERS
      ) {
        continue;
      }
      if (turnDegrees(before, pivot, after) < minimumDegrees) continue;
      if (index - lastHintedIndex <= 1) continue;
      lastHintedIndex = index;
      hints.push({
        kind: "double-back",
        at: copyCoordinate(pivot),
        strokeIndices: [pass.pointStrokes[index] ?? pass.strokeIndices[0] ?? 0],
      });
    }
  }
  return hints;
}

/** The near-loop hint, or `null` when the trace's endpoints are not close. */
function nearLoopHint(
  derivedEndpoints: SketchEndpoints | null,
  loopCloseMeters: number,
  strokeIndices: readonly number[],
): SketchTopologyHint | null {
  if (derivedEndpoints === null) return null;
  const distance = haversine(derivedEndpoints.start, derivedEndpoints.finish);
  if (distance > loopCloseMeters) return null;
  const owners =
    strokeIndices.length > 1
      ? [strokeIndices[0] as number, strokeIndices[strokeIndices.length - 1] as number]
      : strokeIndices.slice(0, 1);
  return {
    kind: "near-loop",
    at: copyCoordinate(derivedEndpoints.start),
    ...(owners.length === 0 ? {} : { strokeIndices: owners }),
  };
}

/**
 * Builds the corridor for one multi-stroke trace. Pure and total: empty input is an
 * empty corridor, and an input with no usable stroke produces no endpoints rather
 * than an invented pair.
 */
export function buildSketchCorridor(
  strokes: readonly (readonly Coordinate[])[],
  options: SketchCorridorOptions = {},
): SketchCorridorResult {
  const joinGapMeters = options.joinGapMeters ?? STROKE_JOIN_GAP_METERS;
  const loopCloseMeters = options.loopCloseMeters ?? LOOP_CLOSE_METERS;
  const simplifyToleranceMeters =
    options.simplifyToleranceMeters ?? SKETCH_SIMPLIFY_TOLERANCE_METERS;
  const doubleBackDegrees =
    options.doubleBackDegrees ?? STROKE_DOUBLE_BACK_MIN_TURN_DEGREES;

  const passes = buildPasses(strokes, joinGapMeters);
  const empty: SketchCorridorResult = {
    corridor: [],
    breaks: [],
    segments: [],
    topologyHints: [],
    strokeIndices: passes.flatMap((pass) => pass.strokeIndices),
    derivedEndpoints: null,
    nearLoop: false,
    lengthMeters: 0,
  };
  if (passes.length === 0) return empty;

  const segments = passes.map((pass) =>
    simplifyGeometry(pass.points, simplifyToleranceMeters),
  );

  const corridor: Coordinate[] = [];
  const breaks: SketchCorridorBreak[] = [];
  segments.forEach((segment, index) => {
    const pass = passes[index];
    if (pass === undefined) return;
    if (index > 0 && pass.gapMeters !== null && pass.gapFrom !== null) {
      breaks.push({
        strokeIndex: pass.strokeIndices[0] ?? 0,
        afterIndex: corridor.length - 1,
        gapMeters: pass.gapMeters,
        at: copyCoordinate(pass.gapFrom),
      });
    }
    corridor.push(...segment.map(copyCoordinate));
  });

  const first = corridor[0];
  const last = corridor[corridor.length - 1];
  const derivedEndpoints =
    first === undefined || last === undefined
      ? null
      : { start: copyCoordinate(first), finish: copyCoordinate(last) };

  const hints: SketchTopologyHint[] = [
    ...crossingHints(passes, MAX_SKETCH_TOPOLOGY_HINTS),
    ...doubleBackHints(passes, doubleBackDegrees, MAX_SKETCH_TOPOLOGY_HINTS),
  ];
  const loop = nearLoopHint(derivedEndpoints, loopCloseMeters, empty.strokeIndices);
  if (loop !== null) hints.push(loop);

  return {
    corridor,
    breaks,
    segments,
    topologyHints: hints.slice(0, MAX_SKETCH_TOPOLOGY_HINTS),
    strokeIndices: empty.strokeIndices,
    derivedEndpoints,
    nearLoop: loop !== null,
    lengthMeters: corridorLengthMeters(corridor),
  };
}

/** Total along-corridor length in meters. */
export function corridorLengthMeters(corridor: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < corridor.length; index += 1) {
    const start = corridor[index - 1];
    const end = corridor[index];
    if (start === undefined || end === undefined) continue;
    total += haversine(start, end);
  }
  return total;
}

/**
 * How many positions {@link sampleSketchAnchors} keeps by default. The planner's
 * own requests no longer use even sampling (they place anchors by shape,
 * `shapeAwareSketchAnchors`, OGV-D-285); this remains the even arc-length
 * sampler for callers that want a fixed, shape-blind handful.
 */
export const DEFAULT_EVEN_SKETCH_SAMPLES = 20;

/**
 * Resamples a corridor to at most `maxAnchors` positions, evenly spaced **by arc
 * length**, keeping both ends (06 §18).
 *
 * Even spacing means a rider who drew one bend slowly does not have that bend
 * over-represented. A corridor with no length (every position identical) keeps
 * its own distinct positions, and a corridor already shorter than the bound is
 * returned unchanged. The bound never exceeds the wire's anchor cap.
 */
export function sampleSketchAnchors(
  corridor: readonly Coordinate[],
  maxAnchors: number = DEFAULT_EVEN_SKETCH_SAMPLES,
): Coordinate[] {
  const clean = corridor.filter(isUsableCoordinate);
  if (clean.length <= 2) return clean.map(copyCoordinate);
  const limit = Math.max(2, Math.min(Math.trunc(maxAnchors), MAX_SKETCH_REQUEST_ANCHORS));
  if (clean.length <= limit) return clean.map(copyCoordinate);

  const total = corridorLengthMeters(clean);
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (first === undefined || last === undefined) return [];
  if (total <= 0) return [copyCoordinate(first), copyCoordinate(last)];

  const spacing = total / (limit - 1);
  const anchors: Coordinate[] = [copyCoordinate(first)];
  let travelled = 0;
  let nextTarget = spacing;
  for (let index = 1; index < clean.length && anchors.length < limit - 1; index += 1) {
    const start = clean[index - 1];
    const end = clean[index];
    if (start === undefined || end === undefined) continue;
    const segment = haversine(start, end);
    if (segment <= 0) continue;
    while (nextTarget <= travelled + segment && anchors.length < limit - 1) {
      const ratio = (nextTarget - travelled) / segment;
      anchors.push({
        lon: start.lon + (end.lon - start.lon) * ratio,
        lat: start.lat + (end.lat - start.lat) * ratio,
      });
      nextTarget += spacing;
    }
    travelled += segment;
  }
  anchors.push(copyCoordinate(last));
  return anchors;
}

/**
 * How far a route may wander from the drawn line before it stops being the ride
 * the rider asked for, derived from the corridor's own length (ported from the
 * legacy `corridorEnvelopeMeters`).
 */
export function sketchCorridorEnvelopeMeters(corridor: readonly Coordinate[]): number {
  const length = corridorLengthMeters(corridor);
  return Math.min(
    MAX_SKETCH_CORRIDOR_ENVELOPE_METERS,
    Math.max(MIN_SKETCH_CORRIDOR_ENVELOPE_METERS, length * SKETCH_CORRIDOR_ENVELOPE_LENGTH_SHARE),
  );
}

/** One measured adherence value (06 §18 "trace adherence"). */
export interface SketchAdherence {
  /** 0–100: how closely the returned route follows the drawn trace. */
  readonly score: number;
  /** Mean distance from each corridor sample to the nearest point on the route. */
  readonly meanDeviationMeters: number;
  /** Worst single-sample deviation. */
  readonly maxDeviationMeters: number;
  /** Share (0..1) of corridor samples the route passes within the envelope. */
  readonly coveredShare: number;
}

const EMPTY_ADHERENCE: SketchAdherence = {
  score: 0,
  meanDeviationMeters: Number.POSITIVE_INFINITY,
  maxDeviationMeters: Number.POSITIVE_INFINITY,
  coveredShare: 0,
};

/**
 * Measures a returned route against the drawn trace (06 §18).
 *
 * Deviation is measured from the **corridor to the route**, not the other way
 * round, on purpose: a route that covers the whole drawing and then adds a
 * detour elsewhere still traced what the rider asked for — the extra distance is
 * priced by the duration lane, not here. An unmeasurable pair returns the zero
 * verdict with infinite deviations, so a caller can distinguish "measured badly"
 * from "not measured at all".
 */
export function sketchAdherence(
  geometry: readonly Coordinate[],
  corridor: readonly Coordinate[],
  envelopeMeters?: number,
): SketchAdherence {
  const samples = corridor.filter(isUsableCoordinate);
  const line = geometry.filter(isUsableCoordinate);
  if (samples.length === 0 || line.length === 0) return EMPTY_ADHERENCE;
  const envelope = Math.max(
    1,
    envelopeMeters ?? sketchCorridorEnvelopeMeters(samples),
  );
  let total = 0;
  let worst = 0;
  let covered = 0;
  // Indexed: a 2,000-point corridor against a 300-mile route is millions of
  // segment checks brute force, and this runs for every candidate.
  const index = createLineIndex(line);
  for (const sample of samples) {
    const distance = index.nearest(sample).distanceMeters;
    total += distance;
    if (distance > worst) worst = distance;
    if (distance <= envelope) covered += 1;
  }
  const mean = total / samples.length;
  const coveredShare = covered / samples.length;
  const meanFit = Math.max(0, 1 - mean / envelope);
  return {
    score: Math.round(100 * Math.max(0, Math.min(1, coveredShare * 0.6 + meanFit * 0.4))),
    meanDeviationMeters: Math.round(mean),
    maxDeviationMeters: Math.round(worst),
    coveredShare: Number(coveredShare.toFixed(3)),
  };
}

/** The evidence value one adherence measurement becomes (03 §18). */
export interface SketchAdherenceEvidence {
  readonly value: SketchAdherence;
  /**
   * `known` at or above {@link SKETCH_ADHERENCE_KNOWN_COVERED_SHARE} of the
   * corridor, `estimated` below it: the measurement is real either way, and the
   * status says how much of the trace it actually accounts for.
   */
  readonly status: EvidenceStatus;
  readonly confidence: number;
  /** Rider copy when the route is materially off the trace, or `null`. */
  readonly warning: string | null;
}

/** Maps one measurement onto the evidence status, confidence and warning. */
export function sketchAdherenceEvidence(
  adherence: SketchAdherence,
): SketchAdherenceEvidence {
  const warning =
    adherence.coveredShare < SKETCH_DEVIATION_WARNING_COVERED_SHARE
      ? SKETCH_DEVIATION_WARNING
      : null;
  return {
    value: adherence,
    status:
      adherence.coveredShare >= SKETCH_ADHERENCE_KNOWN_COVERED_SHARE
        ? "known"
        : "estimated",
    confidence: adherence.coveredShare,
    warning,
  };
}
