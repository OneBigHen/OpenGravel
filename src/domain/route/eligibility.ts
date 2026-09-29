/**
 * Hard route eligibility (Task 3.1, 03-DOMAIN-MODEL §17,
 * 06-ROUTING-AND-DECISION-ENGINE §7).
 *
 * Ported from the legacy `src/lib/domain/routing/eligibility.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`), keeping
 * its central discipline: **explicit evidence rejects a candidate; absent
 * evidence never does**. A missing fact produces a warning (or nothing), never
 * a fabricated permission and never a fabricated rejection. A failed candidate
 * is dropped before scoring — a beautiful illegal route must never reach a rank
 * or a selection.
 *
 * ## What this module can and cannot assert today
 *
 * This is a geometry-and-constraint gate, not a road-legality verdict. Access,
 * closure, surface, bike and highway/toll rules need road-matching evidence
 * (Wave 7); with none available they are not evaluated, so `eligible: true`
 * here means "no Wave-3 hard failure", never "verified legal". The code returns
 * nothing for an unevaluated rule rather than pretending it passed. The one
 * constraint that *can* be evaluated from resolved geometry — an avoid area —
 * is checked exactly, and a `must` road span is checked exactly too once the
 * road-span engine (Task 4.3a, `../road/spans.ts`) has measured the returned
 * route: an unsatisfied required span is a hard failure, an unmeasured one is
 * still only a warning, and a `prefer` span never gates legality at all.
 *
 * No scoring, no AI, no I/O: pure over its input.
 */

import { haversine, pointToSegmentDistanceMeters } from "../geometry/analysis";
import {
  spanEligibilityFailures,
  type SpanEvaluation,
} from "../road/spans";
import type { Coordinate } from "../ride/types";
import type { PipelineIntent } from "./intent";

/**
 * Why a candidate failed hard eligibility. `geometry-malformed` and
 * `out-of-bounds` are separated so diagnostics can distinguish "this is not a
 * usable line" from "this line leaves the map". The three road-span codes are
 * the measured verdicts of Task 4.3a (`../road/spans.ts`):
 * `required-span-unsatisfied` and `required-span-unavailable` keep "the route
 * contradicts the required span" apart from "the span could not be resolved",
 * and `avoid-span-violated` is the entered avoid span.
 */
export type EligibilityFailureCode =
  | "geometry-malformed"
  | "too-short"
  | "out-of-bounds"
  | "duplicate-consecutive-points"
  | "avoid-area-violated"
  | "self-loop-endpoint-snap-failure"
  | "blocking-flag"
  | "required-span-unsatisfied"
  | "required-span-unavailable"
  | "avoid-span-violated"
  | "bike-incompatible"
  | "terrain-incompatible"
  /** An authoritative, active closure on a road the route rides (route intelligence RI-1). */
  | "road-closed"
  /** A legal designation shuts a road the route rides to motorcycles (USFS MVUM, RI-1). */
  | "access-prohibited";

/** Why a candidate is caveated but still legal. */
export type EligibilityWarningCode =
  | "must-road-unresolved"
  | "surface-preference-mismatch"
  | "surface-evidence-unverifiable"
  | "road-character-mismatch"
  | "weather-preference-mismatch"
  /** Route intelligence (RI-1): road work, a restriction, or a closure a non-authoritative source reports. */
  | "road-work-on-route"
  | "road-restriction-on-route"
  | "road-closure-reported"
  | "seasonal-access-unverified"
  /** A closure feed that covers the route did not answer: unknown, never clear. */
  | "road-authority-unavailable";

/** One hard failure; `constraintId` names the authored constraint when one exists. */
export interface RouteEligibilityFailure {
  readonly code: EligibilityFailureCode;
  readonly message: string;
  readonly constraintId?: string;
}

/** One caveat; never a rejection on its own. */
export interface RouteEligibilityWarning {
  readonly code: EligibilityWarningCode;
  readonly message: string;
  readonly constraintId?: string;
}

/**
 * The full verdict. Structurally assignable to the domain `EligibilityResult`
 * (`eligible` + `failures`), which is what `RouteCandidate` stores; `warnings`
 * is carried alongside because the pipeline surfaces them as route warnings.
 */
export interface RouteEligibility {
  readonly eligible: boolean;
  readonly failures: readonly RouteEligibilityFailure[];
  readonly warnings: readonly RouteEligibilityWarning[];
}

/** The candidate facts eligibility reads. */
export interface EligibilityCandidate {
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /**
   * Explicit blocking evidence flags reported by an adapter or matcher
   * (e.g. `"private"`, `"closed"`). Absent means "nothing was reported", never
   * "nothing is wrong"; Wave 3 supplies none, so the gate stays inert until a
   * source actually reports one.
   */
  readonly flags?: readonly string[];
}

/** One avoid area as resolved geometry: an id plus its rings (outer first). */
export interface AvoidAreaConstraint {
  readonly id: string;
  readonly rings: readonly (readonly Coordinate[])[];
}

/**
 * One road-span constraint, resolved to identity only. Geometry resolution and
 * traversal matching arrive with road intelligence, so today a `must` span can
 * be named but not verified.
 */
export interface RoadSpanConstraintRef {
  readonly id: string;
  readonly mode: "must" | "prefer" | "avoid";
}

/** Constraint context the intent resolves into (06 §8). */
export interface ConstraintContext {
  readonly avoidAreas: readonly AvoidAreaConstraint[];
  readonly roadSpans: readonly RoadSpanConstraintRef[];
  /**
   * Measured span verdicts (Task 4.3a) against the **returned** route, when the
   * caller has resolved the span geometry and the route line. Absent, or
   * missing one span id, means that span was never measured: it is warned
   * about, never treated as satisfied — "we did not measure" must not read as
   * "measured fine" (03-DOMAIN-MODEL §17).
   */
  readonly spanEvaluations?: readonly SpanEvaluation[];
}

export interface EligibilityInput {
  readonly candidate: EligibilityCandidate;
  readonly intent: PipelineIntent;
  readonly constraintContext: ConstraintContext;
}

/**
 * A route shorter than this cannot be a ride. Measured from the geometry, not
 * from the provider's own `distanceMeters`, because §8 requires measuring the
 * returned line rather than trusting the request or the report.
 */
export const MINIMUM_ROUTE_DISTANCE_METERS = 50;

/** Two consecutive points closer than this are the same point. */
const DUPLICATE_POINT_TOLERANCE_METERS = 0.5;

/** A loop must return within this distance of its start (06 §8 endpoint snap). */
const LOOP_ENDPOINT_TOLERANCE_METERS = 25;

/**
 * The legacy blocking-flag discipline, kept private: a flag that names a
 * blocking condition is an explicit rejection, and anything else is not a
 * verdict. Never widen this to "unknown means blocked".
 */
const BLOCKING_FLAGS = /(?:private|illegal|closure|closed|unsafe|invalid|impassable)/i;

function isFiniteCoordinate(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat);
}

/** Any ring edge, treated as closed even when the caller omitted the repeat. */
function ringEdges(
  ring: readonly Coordinate[],
): readonly (readonly [Coordinate, Coordinate])[] {
  const edges: (readonly [Coordinate, Coordinate])[] = [];
  if (ring.length < 2) return edges;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if (start === undefined || end === undefined) continue;
    edges.push([start, end]);
  }
  return edges;
}

/** Ray-cast on the lon/lat plane; adequate for the avoid areas we resolve. */
function pointInRing(point: Coordinate, ring: readonly Coordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index];
    const prior = ring[previous];
    if (current === undefined || prior === undefined) continue;
    // A point exactly on the boundary counts as inside, so an edge-clamped route
    // cannot slip through on a floating-point tie.
    if (pointToSegmentDistanceMeters(point, prior, current) <= 0.5) return true;
    const crosses =
      current.lat > point.lat !== prior.lat > point.lat &&
      point.lon <
        ((prior.lon - current.lon) * (point.lat - current.lat)) /
          (prior.lat - current.lat) +
          current.lon;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientation(
  first: Coordinate,
  second: Coordinate,
  third: Coordinate,
): number {
  const value =
    (second.lon - first.lon) * (third.lat - first.lat) -
    (second.lat - first.lat) * (third.lon - first.lon);
  if (value > 0) return 1;
  return value < 0 ? -1 : 0;
}

function onSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): boolean {
  return (
    point.lon <= Math.max(start.lon, end.lon) &&
    point.lon >= Math.min(start.lon, end.lon) &&
    point.lat <= Math.max(start.lat, end.lat) &&
    point.lat >= Math.min(start.lat, end.lat)
  );
}

function segmentsIntersect(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first !== second && third !== fourth) return true;
  if (first === 0 && onSegment(c, a, b)) return true;
  if (second === 0 && onSegment(d, a, b)) return true;
  if (third === 0 && onSegment(a, c, d)) return true;
  if (fourth === 0 && onSegment(b, c, d)) return true;
  return false;
}

/** Whether the candidate line enters, crosses, or touches one avoid area. */
function intersectsAvoidArea(
  geometry: readonly Coordinate[],
  area: AvoidAreaConstraint,
): boolean {
  for (const ring of area.rings) {
    for (const point of geometry) {
      if (pointInRing(point, ring)) return true;
    }
    const edges = ringEdges(ring);
    for (let index = 0; index + 1 < geometry.length; index += 1) {
      const start = geometry[index];
      const end = geometry[index + 1];
      if (start === undefined || end === undefined) continue;
      for (const [edgeStart, edgeEnd] of edges) {
        if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return true;
      }
    }
  }
  return false;
}

function measuredLengthMeters(geometry: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    if (start === undefined || end === undefined) continue;
    total += haversine(start, end);
  }
  return total;
}

function failure(
  code: EligibilityFailureCode,
  message: string,
  constraintId?: string,
): RouteEligibilityFailure {
  return constraintId === undefined ? { code, message } : { code, message, constraintId };
}

/** The fatal geometry verdict, or `null` when the line is usable. */
function geometryFailure(
  geometry: readonly Coordinate[],
): RouteEligibilityFailure | null {
  if (geometry.length < 2) {
    return failure("geometry-malformed", "The candidate has fewer than two coordinates.");
  }
  if (geometry.some((coordinate) => !isFiniteCoordinate(coordinate))) {
    return failure(
      "geometry-malformed",
      "The candidate carries a non-finite longitude or latitude.",
    );
  }
  if (
    geometry.some(
      (coordinate) =>
        Math.abs(coordinate.lon) > 180 || Math.abs(coordinate.lat) > 90,
    )
  ) {
    return failure(
      "out-of-bounds",
      "The candidate leaves the WGS84 coordinate domain.",
    );
  }
  return null;
}

/** Index of the first repeated consecutive pair, or `null` when none repeats. */
function firstDuplicateIndex(geometry: readonly Coordinate[]): number | null {
  for (let index = 0; index + 1 < geometry.length; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    if (start === undefined || end === undefined) continue;
    if (haversine(start, end) < DUPLICATE_POINT_TOLERANCE_METERS) return index;
  }
  return null;
}

/** A `loop` intent must return to its start; other shapes impose no such snap. */
function loopEndpointFailure(
  intent: PipelineIntent,
  geometry: readonly Coordinate[],
): RouteEligibilityFailure | null {
  if (intent.shape !== "loop") return null;
  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  if (first === undefined || last === undefined) return null;
  return haversine(first, last) > LOOP_ENDPOINT_TOLERANCE_METERS
    ? failure(
        "self-loop-endpoint-snap-failure",
        "A loop candidate does not return to its start point.",
      )
    : null;
}

/**
 * Evaluates the hard gates the current evidence supports. Pure and total: a
 * malformed candidate is described, never thrown at the caller.
 */
export function evaluateEligibility(input: EligibilityInput): RouteEligibility {
  const { candidate, intent, constraintContext } = input;
  const geometry = candidate.geometry;

  const invalid = geometryFailure(geometry);
  if (invalid !== null) {
    return { eligible: false, failures: [invalid], warnings: [] };
  }

  const failures: RouteEligibilityFailure[] = [];
  const warnings: RouteEligibilityWarning[] = [];

  const duplicateIndex = firstDuplicateIndex(geometry);
  if (duplicateIndex !== null) {
    failures.push(
      failure(
        "duplicate-consecutive-points",
        `Coordinates ${duplicateIndex} and ${duplicateIndex + 1} are the same point.`,
      ),
    );
  }

  if (measuredLengthMeters(geometry) < MINIMUM_ROUTE_DISTANCE_METERS) {
    failures.push(
      failure("too-short", "The candidate is shorter than the minimum rideable length."),
    );
  }

  const loopFailure = loopEndpointFailure(intent, geometry);
  if (loopFailure !== null) failures.push(loopFailure);

  for (const area of constraintContext.avoidAreas) {
    if (intersectsAvoidArea(geometry, area)) {
      failures.push(
        failure("avoid-area-violated", "The candidate enters an avoid area.", area.id),
      );
    }
  }

  if ((candidate.flags ?? []).some((flag) => BLOCKING_FLAGS.test(flag))) {
    failures.push(
      failure(
        "blocking-flag",
        "The candidate carries an explicit blocking access or safety flag.",
      ),
    );
  }

  if (constraintContext.spanEvaluations !== undefined) {
    failures.push(
      ...spanEligibilityFailures(
        constraintContext.roadSpans,
        constraintContext.spanEvaluations,
      ),
    );
  }

  // A required span the road-span engine has not measured is still unverified,
  // not satisfied: the warning is what keeps "we did not check" from reading as
  // "it passed". A span that *was* measured gets one verdict, never both.
  const measuredSpanIds = new Set<string>(
    (constraintContext.spanEvaluations ?? []).map(
      (evaluation) => evaluation.spanId,
    ),
  );
  for (const span of constraintContext.roadSpans) {
    if (span.mode !== "must" || measuredSpanIds.has(span.id)) continue;
    warnings.push({
      code: "must-road-unresolved",
      message:
        "A required road span could not be verified: road matching is not available yet.",
      constraintId: span.id,
    });
  }

  return { eligible: failures.length === 0, failures, warnings };
}
