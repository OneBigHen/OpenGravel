/**
 * Road-span evaluation and rematch (Wave 4, Task 4.3a; 03-DOMAIN-MODEL §12/§17,
 * 06-ROUTING-AND-DECISION-ENGINE §8/§19, 04-PLANNER-AND-WORKSPACE-UX §17).
 *
 * The **pure half** of the legacy `src/lib/roads/road-locks.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`) is ported
 * here: `distanceToLineMeters`, `anchorsInOrder`, the rematch algorithm,
 * `convertMustLockToPrefer` and the four unresolved-lock options. Two legacy
 * halves are deliberately **not** ported — the Dexie `RoadLockLibrary` (VNext
 * owns its own storage, OGV-D-229) and the lock *factories* with their
 * manual/GPX/image-trace provenance and rider-facing copy (`ImageTraceAccuracy`
 * statement, `describePreferSkipReason`), because provenance is authored
 * elsewhere and rider copy belongs to the UI.
 *
 * ## The one rule this engine exists to enforce
 *
 * A request is not evidence (06 §8): asking the router for a shaping point does
 * not mean the returned route honored it. Every number here is therefore
 * measured against the **returned route geometry**, never derived from the
 * request, the authored span, or the provider's own report. `must` is the strict
 * mode — coverage at or above the policy threshold *and* the declared direction
 * honored, or the candidate is rejected (03 §17, 06 §19).
 *
 * ## "We cannot measure" is never "no"
 *
 * An unresolvable span line, an unusable route line, a non-finite anchor or a
 * span whose anchors no longer answer the returned geometry reports
 * `unavailable`, never a fabricated `conflict` and never a fabricated pass —
 * the graph-change honesty 06 §19 asks for ("unresolved constraint becomes
 * explicit conflict") and 04 §17 renders as "unavailable after graph update".
 * The distinction is load-bearing: `conflict` says the route is wrong, and
 * `unavailable` says the constraint could not be checked at all.
 *
 * Pure and framework-free: no storage, no clock, no randomness, no provider,
 * no mutation of its inputs. The caller resolves `geometryRef` and passes the
 * lines in; the domain only measures what it was given.
 */

import { haversine, pointToSegmentDistanceMeters } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";
import type { RoadEntityId, RoadSpanId } from "../ride/ids";
import { deepFreeze } from "../util/freeze";

/** How a span must be treated (03 §12): keep it, prefer it, or avoid it. */
export type RoadSpanMode = "must" | "prefer" | "avoid";

/** Which way along the span the rider intends to travel (03 §12). */
export type SpanDirection = "forward" | "reverse" | "either";

/** The four verdicts 04 §17 publishes in the constraint inspector. */
export type SpanSatisfaction =
  | "satisfied"
  | "partially-satisfied"
  | "conflict"
  | "unavailable";

/** One span's measured outcome against one returned route. */
export interface SpanEvaluation {
  readonly spanId: RoadSpanId;
  readonly status: SpanSatisfaction;
  /** Length of the span the returned route covers, in meters (a measurement). */
  readonly coveredMeters: number;
  /** Length of the span itself, in meters; 0 when the geometry has no length. */
  readonly totalMeters: number;
  /** Diagnostics for a non-`satisfied` verdict; never rider copy. */
  readonly note?: string;
}

/** The declaration fields evaluation reads; a `RoadSpanConstraint` supplies them. */
export interface RoadSpanDeclaration {
  readonly id: RoadSpanId;
  readonly mode: RoadSpanMode;
  readonly direction: SpanDirection;
  /** Ordered entry/exit anchors the span must preserve in sequence (03 §12). */
  readonly anchorRefs: readonly Coordinate[];
}

/**
 * A span whose own line the caller has resolved. `geometryRef` is a storage
 * handle (VNX-004), so the domain cannot read it: whoever can resolve it passes
 * the line here, and a span that could not be resolved is passed as an
 * unusable line and honestly evaluates to `unavailable`.
 */
export interface ResolvedRoadSpan extends RoadSpanDeclaration {
  readonly geometry: readonly Coordinate[];
  /** Present when the span names a road entity; carried through rescope helpers. */
  readonly roadEntityId?: RoadEntityId;
}

/** The returned route as the engine measures it. */
export interface SpanRouteGeometry {
  readonly geometry: readonly Coordinate[];
}

/**
 * The bounded policy the coverage measurement reads. Values live beside the
 * route policy rather than inside it for the same reason as OGV-D-198: they
 * are product policy, but folding them into the frozen `RoutePolicy` would
 * either edit a versioned object or claim a version whose corpus has not run.
 */
export interface SpanEvaluationPolicy {
  /** Covered share of the span at or above which a span counts as used. */
  readonly coverageThreshold: number;
  /** Distance from the returned route within which a span point counts as covered. */
  readonly onRouteToleranceMeters: number;
  /**
   * Target resolution of the coverage measurement: the longest sub-interval
   * sampled, in meters. A non-positive value (which cannot subdivide anything)
   * falls back to the default rather than sampling forever.
   */
  readonly coverageSampleMeters: number;
}

/** Default covered-share threshold: "clearly used", with room for a clipped end. */
export const SPAN_COVERAGE_THRESHOLD = 0.9;

/**
 * How far a span point may sit from the returned route and still count as
 * covered. Wide enough for graph-versus-GPS drift and provider vertex pruning,
 * far narrower than the distance at which two parallel roads are confused.
 */
export const ON_ROUTE_TOLERANCE_METERS = 25;

/** Longest sub-interval of a span segment the coverage measurement samples. */
export const SPAN_COVERAGE_SAMPLE_METERS = 5;

/** The frozen default span policy. */
export const DEFAULT_SPAN_EVALUATION_POLICY: SpanEvaluationPolicy = deepFreeze({
  coverageThreshold: SPAN_COVERAGE_THRESHOLD,
  onRouteToleranceMeters: ON_ROUTE_TOLERANCE_METERS,
  coverageSampleMeters: SPAN_COVERAGE_SAMPLE_METERS,
});

/** Drift at or below which a rematch is reported as `exact` rather than `matched`. */
export const EXACT_ANCHOR_DRIFT_METERS = 1;

/**
 * The rematch drift limit used when a caller has no per-span tolerance: the
 * ported legacy fallback corridor (legacy `fallbackToleranceMeters`, default
 * 50 m, floor 10 m). VNext keeps the number, not the storage: 03 §12 forbids
 * exposing a matching tolerance to the rider, so a per-span override is the
 * caller's policy and this is only the honest default.
 */
export const DEFAULT_REMATCH_DRIFT_METERS = 50;

/**
 * Representation noise at the coverage threshold. A measured 0.9 can compute as
 * `0.8999999999999999`, and a span exactly at the threshold must be credited,
 * not rejected — the same 1e-9 rule OGV-D-203 applies to metric comparisons.
 */
const COVERAGE_EPSILON = 1e-9;

/**
 * How a route walks a span's anchors: in order, mirrored, both (an out-and-back
 * that visits them each way) or neither. `both` honors either declared
 * direction; `unmatched` means the anchors state nothing about this route.
 */
export type SpanTraversal = "forward" | "reverse" | "both" | "unmatched";

/** How confidently a rematch found the anchors on the candidate line. */
export type AnchorMatchConfidence = "exact" | "matched" | "approximate";

/** The outcome of rematching a span's anchors against a newer line. */
export interface AnchorRematchResult {
  /**
   * The projected anchors, in the caller's anchor order, or `null` when the
   * rematch must not be used. `null` is the caller's signal to take the
   * needs-review path (migration §9); `confidence` is descriptive only.
   */
  readonly rematched: readonly Coordinate[] | null;
  /**
   * The largest anchor drift observed, in meters — reported even when the
   * rematch is refused, so the caller can say how far off the line it was.
   * `Infinity` means no drift could be measured at all.
   */
  readonly maxDriftMeters: number;
  readonly confidence: AnchorMatchConfidence;
}

function isFiniteCoordinate(coordinate: Coordinate): boolean {
  return Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat);
}

/** A line the engine can measure: at least two finite positions. */
function lineIsUsable(line: readonly Coordinate[]): boolean {
  return line.length >= 2 && line.every(isFiniteCoordinate);
}

/** Total measured length of a line, in meters. */
function measuredLengthMeters(line: readonly Coordinate[]): number {
  let total = 0;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    if (start === undefined || end === undefined) continue;
    total += haversine(start, end);
  }
  return total;
}

/**
 * Distance in meters from `point` to the nearest segment of `line` (legacy
 * `distanceToLineMeters`). An empty line has no nearest point, so the distance
 * is infinite rather than zero: "nothing to measure" must not read as "touching".
 */
export function distanceToLineMeters(
  point: Coordinate,
  line: readonly Coordinate[],
): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversine(point, line[0]!);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    if (start === undefined || end === undefined) continue;
    const distance = pointToSegmentDistanceMeters(point, start, end);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Whether `anchorRefs` walk `line` in the order they were authored (legacy
 * `anchorsInOrder`). Each anchor is matched to its nearest later vertex, so an
 * out-of-sequence anchor — the parallel-road substitution of legacy SB-014 —
 * fails rather than sliding the span onto a neighbouring road. Fewer than two
 * anchors impose no order, exactly like the legacy lock.
 */
export function anchorsInOrder(
  anchorRefs: readonly Coordinate[],
  line: readonly Coordinate[],
): boolean {
  if (anchorRefs.length < 2) return true;
  let lastIndex = -1;
  for (const anchor of anchorRefs) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = lastIndex + 1; index < line.length; index += 1) {
      const candidate = line[index];
      if (candidate === undefined) continue;
      const distance = haversine(anchor, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return false;
    if (bestIndex <= lastIndex) return false;
    lastIndex = bestIndex;
  }
  return true;
}

/**
 * The direction the route actually walks the anchors. `both` is an out-and-back
 * that visits them each way, which honors either declared direction.
 */
export function anchorTraversalDirection(
  anchorRefs: readonly Coordinate[],
  line: readonly Coordinate[],
): SpanTraversal {
  if (anchorRefs.length < 2 || line.length < 2) return "unmatched";
  const forward = anchorsInOrder(anchorRefs, line);
  const reverse = anchorsInOrder([...anchorRefs].reverse(), line);
  if (forward && reverse) return "both";
  if (forward) return "forward";
  if (reverse) return "reverse";
  return "unmatched";
}

/** One bounded-resolution coverage measurement of a span against a route. */
interface CoverageMeasurement {
  readonly coveredMeters: number;
  readonly totalMeters: number;
}

/**
 * Measures how much of `spanLine` lies within the on-route tolerance of
 * `routeLine`. Each span segment is divided into sub-intervals of at most
 * `coverageSampleMeters` and the sub-interval's midpoint is tested, so the
 * measurement is deterministic, bounded in cost, and honest about its
 * resolution: coverage is reported to roughly one sample per sub-interval, not
 * as an exact arc-length integral.
 */
function measureCoverage(
  spanLine: readonly Coordinate[],
  routeLine: readonly Coordinate[],
  policy: SpanEvaluationPolicy,
): CoverageMeasurement {
  // A non-positive resolution cannot subdivide a segment and `segmentMeters / 0`
  // would ask for an infinite number of samples; the default is the honest
  // fallback for a policy that names none.
  const resolution =
    policy.coverageSampleMeters > 0
      ? policy.coverageSampleMeters
      : SPAN_COVERAGE_SAMPLE_METERS;
  let totalMeters = 0;
  let coveredMeters = 0;
  for (let index = 0; index + 1 < spanLine.length; index += 1) {
    const start = spanLine[index];
    const end = spanLine[index + 1];
    if (start === undefined || end === undefined) continue;
    const segmentMeters = haversine(start, end);
    totalMeters += segmentMeters;
    if (segmentMeters <= 0) continue;
    const parts = Math.max(1, Math.ceil(segmentMeters / resolution));
    const partMeters = segmentMeters / parts;
    for (let part = 0; part < parts; part += 1) {
      const fraction = (part + 0.5) / parts;
      const sample: Coordinate = {
        lon: start.lon + (end.lon - start.lon) * fraction,
        lat: start.lat + (end.lat - start.lat) * fraction,
      };
      if (distanceToLineMeters(sample, routeLine) <= policy.onRouteToleranceMeters) {
        coveredMeters += partMeters;
      }
    }
  }
  return { coveredMeters, totalMeters };
}

function spanEvaluation(
  spanId: RoadSpanId,
  status: SpanSatisfaction,
  measured: CoverageMeasurement,
  note?: string,
): SpanEvaluation {
  return note === undefined
    ? {
        spanId,
        status,
        coveredMeters: measured.coveredMeters,
        totalMeters: measured.totalMeters,
      }
    : {
        spanId,
        status,
        coveredMeters: measured.coveredMeters,
        totalMeters: measured.totalMeters,
        note,
      };
}

/**
 * Why the span cannot be measured at all, or `null` when it can. Each case is a
 * different fact and gets its own sentence, because "the route is unusable" and
 * "the span was never resolved" call for different recovery.
 */
function unmeasurableReason(
  span: ResolvedRoadSpan,
  route: SpanRouteGeometry,
  spanMeters: number,
): string | null {
  if (!lineIsUsable(route.geometry)) {
    return "The returned route has no usable geometry to measure against.";
  }
  if (!lineIsUsable(span.geometry)) {
    return "The span geometry could not be resolved, so its coverage is unknown.";
  }
  if (span.anchorRefs.some((anchor) => !isFiniteCoordinate(anchor))) {
    return "A span anchor is not a usable coordinate.";
  }
  if (spanMeters <= 0) {
    return "The span geometry has no length, so it cannot be covered.";
  }
  return null;
}

type DirectionVerdict = "honored" | "violated" | "unverifiable";

/**
 * Whether the returned route honors the declared direction. `unverifiable` is
 * the graph/geometry-changed case: the span is covered, but its anchors no
 * longer answer the route, so no direction can be read from it. That is a
 * different fact from a wrong-way traversal and must never be reported as one.
 */
function directionVerdict(
  span: ResolvedRoadSpan,
  route: SpanRouteGeometry,
  policy: SpanEvaluationPolicy,
): DirectionVerdict {
  if (span.direction === "either") return "honored";
  if (span.anchorRefs.length < 2) return "unverifiable";
  const anchorsResolve = span.anchorRefs.every(
    (anchor) =>
      distanceToLineMeters(anchor, route.geometry) <= policy.onRouteToleranceMeters,
  );
  if (!anchorsResolve) return "unverifiable";
  const traversal = anchorTraversalDirection(span.anchorRefs, route.geometry);
  if (traversal === "both") return "honored";
  if (traversal === "unmatched") return "unverifiable";
  return traversal === span.direction ? "honored" : "violated";
}

const COVERED_DIRECTION_UNKNOWN =
  "The span is covered, but its anchors no longer resolve against the returned geometry, so its direction cannot be verified.";
const PREFERRED_DIRECTION_UNKNOWN =
  "The preferred span is covered, but its anchors no longer resolve against the returned geometry, so its direction cannot be verified.";

/**
 * Evaluates one span against the returned route (06 §8, §19).
 *
 * - `must` — `satisfied` only when coverage reaches the threshold *and* the
 *   declared direction is honored; otherwise `conflict`, or `unavailable` when
 *   the covered span's direction cannot be read.
 * - `prefer` — `satisfied` when clearly used and honored, `partially-satisfied`
 *   when only partly used or used the wrong way, `conflict` when ignored. A
 *   `prefer` verdict is reported, never fatal (`spanEligibilityFailures`).
 * - `avoid` — `conflict` when the route covers the span, `satisfied` otherwise;
 *   an avoid span has no direction to honor.
 */
export function evaluateRoadSpan(
  span: ResolvedRoadSpan,
  route: SpanRouteGeometry,
  policy: SpanEvaluationPolicy = DEFAULT_SPAN_EVALUATION_POLICY,
): SpanEvaluation {
  const spanMeters = lineIsUsable(span.geometry)
    ? measuredLengthMeters(span.geometry)
    : 0;
  const reason = unmeasurableReason(span, route, spanMeters);
  if (reason !== null) {
    return spanEvaluation(
      span.id,
      "unavailable",
      { coveredMeters: 0, totalMeters: spanMeters },
      reason,
    );
  }

  const measured = measureCoverage(span.geometry, route.geometry, policy);
  const covered =
    measured.totalMeters > 0 &&
    measured.coveredMeters / measured.totalMeters + COVERAGE_EPSILON >=
      policy.coverageThreshold;

  switch (span.mode) {
    case "must": {
      if (!covered) {
        return spanEvaluation(
          span.id,
          "conflict",
          measured,
          "The returned route does not cover the required span.",
        );
      }
      const verdict = directionVerdict(span, route, policy);
      if (verdict === "unverifiable") {
        return spanEvaluation(
          span.id,
          "unavailable",
          measured,
          COVERED_DIRECTION_UNKNOWN,
        );
      }
      if (verdict === "violated") {
        return spanEvaluation(
          span.id,
          "conflict",
          measured,
          "The span is covered, but the returned route traverses it in the wrong direction.",
        );
      }
      return spanEvaluation(span.id, "satisfied", measured);
    }
    case "prefer": {
      if (covered) {
        const verdict = directionVerdict(span, route, policy);
        if (verdict === "unverifiable") {
          return spanEvaluation(
            span.id,
            "unavailable",
            measured,
            PREFERRED_DIRECTION_UNKNOWN,
          );
        }
        if (verdict === "violated") {
          return spanEvaluation(
            span.id,
            "partially-satisfied",
            measured,
            "The preferred span is used, but the route traverses it in the wrong direction.",
          );
        }
        return spanEvaluation(span.id, "satisfied", measured);
      }
      if (measured.coveredMeters > 0) {
        return spanEvaluation(
          span.id,
          "partially-satisfied",
          measured,
          "The returned route uses only part of the preferred span.",
        );
      }
      return spanEvaluation(
        span.id,
        "conflict",
        measured,
        "The returned route does not use the preferred span.",
      );
    }
    case "avoid": {
      return covered
        ? spanEvaluation(
            span.id,
            "conflict",
            measured,
            "The returned route enters the avoided span.",
          )
        : spanEvaluation(span.id, "satisfied", measured);
    }
  }
}

/** Evaluates every authored span against one returned route, in author order. */
export function evaluateRoadSpans(
  spans: readonly ResolvedRoadSpan[],
  route: SpanRouteGeometry,
  policy: SpanEvaluationPolicy = DEFAULT_SPAN_EVALUATION_POLICY,
): SpanEvaluation[] {
  return spans.map((span) => evaluateRoadSpan(span, route, policy));
}

/** One anchor's nearest point on a candidate line, with the drift to reach it. */
interface NearestPoint {
  readonly point: Coordinate;
  readonly meters: number;
  readonly segment: number;
  readonly fraction: number;
}

/**
 * Projects a point onto a segment in a local equirectangular plane (the same
 * approximation `pointToSegmentDistanceMeters` uses) and returns both the
 * clamped position and where along the segment it landed.
 */
function projectOnSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): { readonly point: Coordinate; readonly fraction: number } {
  const cosLatitude = Math.cos((((start.lat + end.lat) / 2) * Math.PI) / 180);
  const startX = start.lon * cosLatitude;
  const endX = end.lon * cosLatitude;
  const pointX = point.lon * cosLatitude;
  const deltaX = endX - startX;
  const deltaY = end.lat - start.lat;
  const lengthSq = deltaX * deltaX + deltaY * deltaY;
  const raw =
    lengthSq === 0
      ? 0
      : ((pointX - startX) * deltaX + (point.lat - start.lat) * deltaY) /
        lengthSq;
  const fraction = Math.min(1, Math.max(0, raw));
  return {
    point: {
      lon: start.lon + (end.lon - start.lon) * fraction,
      lat: start.lat + (end.lat - start.lat) * fraction,
    },
    fraction,
  };
}

/** The nearest point on `line` to `point`, or `null` for an empty line. */
function nearestPointOnLine(
  point: Coordinate,
  line: readonly Coordinate[],
): NearestPoint | null {
  if (line.length === 0) return null;
  if (line.length === 1) {
    const only = line[0];
    return only === undefined
      ? null
      : { point: only, meters: haversine(point, only), segment: 0, fraction: 0 };
  }
  let best: NearestPoint | null = null;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const start = line[index];
    const end = line[index + 1];
    if (start === undefined || end === undefined) continue;
    const projected = projectOnSegment(point, start, end);
    const meters = haversine(point, projected.point);
    // Strictly-less keeps the lowest segment on a tie, so the answer never
    // depends on iteration order beyond the line itself.
    if (best === null || meters < best.meters) {
      best = {
        point: projected.point,
        meters,
        segment: index,
        fraction: projected.fraction,
      };
    }
  }
  return best;
}

/**
 * Rematches a span's anchors against a newer line (legacy `rematchRoadLock`,
 * geometry half; 06 §19 "graph changes: rematch road entity/span").
 *
 * Every anchor is projected to its nearest point on the candidate line, and the
 * rematch is accepted only when every drift is within `maxDriftMeters` **and**
 * the projections advance monotonically along the line — the ported refusal to
 * slide a span onto a parallel road. The returned anchor order is the caller's
 * own order, so a caller that passes entry-then-exit gets entry-then-exit back.
 *
 * `rematched: null` is the needs-review signal (migration §9): the caller
 * decides whether to offer a retry, a rescope or a disabled span. `confidence`
 * describes the projection that was found (`exact` when every anchor sits on
 * the line within `EXACT_ANCHOR_DRIFT_METERS`, `matched` within the limit) and
 * is `approximate` whenever `rematched` is `null` — never a licence to use a
 * refused rematch. A drift limit that is not a finite non-negative number is
 * refused for the same reason: a rematch with no stated tolerance can only be
 * accepted or rejected arbitrarily, so `Infinity` is a refusal, not a licence.
 */
export function rematchAnchors(
  anchors: readonly Coordinate[],
  candidateLine: readonly Coordinate[],
  maxDriftMeters: number = DEFAULT_REMATCH_DRIFT_METERS,
): AnchorRematchResult {
  const unmeasurable: AnchorRematchResult = {
    rematched: null,
    maxDriftMeters: Number.POSITIVE_INFINITY,
    confidence: "approximate",
  };
  if (
    !lineIsUsable(candidateLine) ||
    anchors.length < 2 ||
    anchors.some((anchor) => !isFiniteCoordinate(anchor)) ||
    !Number.isFinite(maxDriftMeters) ||
    maxDriftMeters < 0
  ) {
    return unmeasurable;
  }

  const projected: NearestPoint[] = [];
  for (const anchor of anchors) {
    const nearest = nearestPointOnLine(anchor, candidateLine);
    if (nearest === null) return unmeasurable;
    projected.push(nearest);
  }

  let observedDriftMeters = 0;
  let ordered = true;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index]!;
    observedDriftMeters = Math.max(observedDriftMeters, current.meters);
    if (index === 0) continue;
    const previous = projected[index - 1]!;
    const advances =
      current.segment > previous.segment ||
      (current.segment === previous.segment && current.fraction > previous.fraction);
    if (!advances) ordered = false;
  }

  if (!ordered || observedDriftMeters > maxDriftMeters) {
    return {
      rematched: null,
      maxDriftMeters: observedDriftMeters,
      confidence: "approximate",
    };
  }

  return {
    rematched: projected.map((nearest) => nearest.point),
    maxDriftMeters: observedDriftMeters,
    confidence:
      observedDriftMeters <= EXACT_ANCHOR_DRIFT_METERS ? "exact" : "matched",
  };
}

/**
 * Converts a `must` span to `prefer` while preserving every other field
 * (legacy `convertMustLockToPrefer`). This is the explicit rider rescope — an
 * authored decision, never an automatic downgrade: a planner that silently
 * weakened a required span would be lying about the ride it returned. A span
 * that is not `must` is returned untouched.
 */
export function convertMustToPrefer<T extends { readonly mode: RoadSpanMode }>(
  span: T,
): T {
  if (span.mode !== "must") return span;
  return { ...span, mode: "prefer" };
}

/**
 * The four explicit choices offered when a required span cannot be resolved
 * (port of `MUST_LOCK_UNRESOLVED_OPTIONS`): the planner keeps the previous
 * route visible and lets the rider decide, rather than silently dropping the
 * span. These are machine tokens; the UI owns their copy.
 */
export const UNRESOLVED_SPAN_OPTIONS = deepFreeze([
  "retry-rematch",
  "convert-to-prefer",
  "remove-span",
  "keep-disabled",
] as const);

export type UnresolvedSpanOption = (typeof UNRESOLVED_SPAN_OPTIONS)[number];

/** The stable machine codes a road span contributes to hard eligibility. */
export const SPAN_ELIGIBILITY_FAILURE_CODES = [
  "required-span-unsatisfied",
  "required-span-unavailable",
  "avoid-span-violated",
] as const;

export type SpanEligibilityFailureCode =
  (typeof SPAN_ELIGIBILITY_FAILURE_CODES)[number];

/** Why a span made a route ineligible; `constraintId` names the span. */
export interface SpanEligibilityFailure {
  readonly code: SpanEligibilityFailureCode;
  readonly message: string;
  readonly constraintId: string;
}

/** The declaration identity eligibility holds, without geometry. */
export interface SpanEligibilityRef {
  readonly id: string;
  readonly mode: RoadSpanMode;
}

/**
 * Maps measured span verdicts onto hard eligibility (03 §17, 06 §19): a `must`
 * span that is anything but `satisfied` fails the candidate — `conflict` and
 * `partially-satisfied` as `required-span-unsatisfied`, and an unresolvable
 * span as its own `required-span-unavailable` so the two facts stay separable —
 * and an `avoid` span the route entered is `avoid-span-violated`. A `prefer`
 * span contributes nothing here: it shapes ranking, never legality.
 *
 * A span with no evaluation is simply absent from the result. That is not a
 * pass: the caller still owes it the "not verified yet" warning, which is
 * `evaluateEligibility`'s job, so "we did not measure" can never be read as
 * "measured fine" (03 §17).
 */
export function spanEligibilityFailures(
  spans: readonly SpanEligibilityRef[],
  evaluations: readonly SpanEvaluation[],
): SpanEligibilityFailure[] {
  // First evaluation wins for one span id, so a duplicated measurement cannot
  // make the answer depend on the order of the list after the first.
  const measured = new Map<string, SpanEvaluation>();
  for (const evaluation of evaluations) {
    if (!measured.has(evaluation.spanId)) measured.set(evaluation.spanId, evaluation);
  }

  const failures: SpanEligibilityFailure[] = [];
  for (const span of spans) {
    const evaluation = measured.get(span.id);
    if (evaluation === undefined) continue;
    if (span.mode === "must") {
      if (evaluation.status === "satisfied") continue;
      failures.push(
        evaluation.status === "unavailable"
          ? {
              code: "required-span-unavailable",
              message: `Required road span "${span.id}" could not be resolved against the returned route.`,
              constraintId: span.id,
            }
          : {
              code: "required-span-unsatisfied",
              message: `Required road span "${span.id}" is not satisfied by the returned route.`,
              constraintId: span.id,
            },
      );
      continue;
    }
    if (span.mode === "avoid" && evaluation.status === "conflict") {
      failures.push({
        code: "avoid-span-violated",
        message: `The returned route enters avoided road span "${span.id}".`,
        constraintId: span.id,
      });
    }
  }
  return failures;
}
