/**
 * Road-span evaluation and rematch (Wave 4, Task 4.3a; 03-DOMAIN-MODEL §12/§17,
 * 06-ROUTING-AND-DECISION-ENGINE §8/§19, 04-PLANNER-AND-WORKSPACE-UX §17).
 *
 * The pure half of the legacy `src/lib/roads/road-locks.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`) is ported
 * here — `distanceToLineMeters`, `anchorsInOrder`, the rematch algorithm and
 * `convertMustLockToPrefer` — and re-expressed as the VNext road-span engine.
 * The Dexie `RoadLockLibrary`, the lock *factories* (manual/GPX/image-trace
 * provenance) and the rider-facing copy (`describePreferSkipReason`) are
 * deliberately **not** ported; storage and UI copy are VNext's own.
 *
 * Two invariants dominate this suite:
 *
 * - **Coverage is measured, never assumed** (06 §8): every number here comes
 *   from the returned route geometry, so a request that asked for a span and a
 *   route that ignores it must produce different answers.
 * - **"We cannot measure" is not "no"** (03 §17): an unresolvable span or an
 *   anchor set that no longer answers the route reports `unavailable`, never a
 *   fabricated `conflict` or a fabricated pass.
 *
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMATCH_DRIFT_METERS,
  DEFAULT_SPAN_EVALUATION_POLICY,
  UNRESOLVED_SPAN_OPTIONS,
  anchorTraversalDirection,
  anchorsInOrder,
  convertMustToPrefer,
  distanceToLineMeters,
  evaluateRoadSpan,
  evaluateRoadSpans,
  rematchAnchors,
  spanEligibilityFailures,
  type ResolvedRoadSpan,
  type SpanEvaluation,
} from "@/domain/road/spans";
import type { RoadSpanId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";

const spanId = (value: string): RoadSpanId => value as RoadSpanId;

const EARTH_RADIUS_METERS = 6_371_000;

/** A straight north–south line of equal segments, laid out in real meters. */
function northLine(
  startLatitude: number,
  segments: number,
  segmentMeters: number,
): readonly Coordinate[] {
  const stepDegrees =
    (segmentMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  return Array.from({ length: segments + 1 }, (_unused, index) => ({
    lon: -76.5,
    lat: startLatitude + index * stepDegrees,
  }));
}

/** The legacy `baseLine`/`baseAnchors` fixture, in VNext coordinates. */
const HAWK_LINE: readonly Coordinate[] = [
  { lon: -76.5, lat: 40.2 },
  { lon: -76.45, lat: 40.21 },
  { lon: -76.4, lat: 40.22 },
];

const HAWK_ANCHORS: readonly Coordinate[] = [HAWK_LINE[0]!, HAWK_LINE[2]!];

function span(overrides: Partial<ResolvedRoadSpan> = {}): ResolvedRoadSpan {
  return {
    id: spanId("span_hawk"),
    mode: "must",
    direction: "either",
    geometry: HAWK_LINE,
    anchorRefs: HAWK_ANCHORS,
    ...overrides,
  };
}

function route(geometry: readonly Coordinate[]): { geometry: readonly Coordinate[] } {
  return { geometry };
}

/** Two 500 m segments, so "forward" and "reverse" are geometrically distinct. */
const DIRECTED_LINE = northLine(40, 2, 500);
const DIRECTED_ANCHORS: readonly Coordinate[] = [DIRECTED_LINE[0]!, DIRECTED_LINE[2]!];
const FORWARD_ROUTE = DIRECTED_LINE;
const REVERSE_ROUTE: readonly Coordinate[] = [...DIRECTED_LINE].reverse();

describe("road-span geometry ports", () => {
  it("computes the distance from a point to a stored LineString (legacy: point-to-line)", () => {
    const far: Coordinate = { lon: -75, lat: 41 };
    expect(distanceToLineMeters(far, HAWK_LINE)).toBeGreaterThan(50_000);
    expect(distanceToLineMeters(HAWK_LINE[1]!, HAWK_LINE)).toBeLessThan(20);
    expect(distanceToLineMeters(HAWK_LINE[0]!, [])).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToLineMeters(HAWK_LINE[0]!, [HAWK_LINE[0]!])).toBe(0);
  });

  it("detects ordered anchors walking a line (legacy: anchors-in-order)", () => {
    expect(anchorsInOrder(HAWK_ANCHORS, HAWK_LINE)).toBe(true);
    expect(anchorsInOrder([HAWK_ANCHORS[1]!, HAWK_ANCHORS[0]!], HAWK_LINE)).toBe(false);
    // Fewer than two anchors impose no order, exactly like the legacy lock.
    expect(anchorsInOrder([HAWK_ANCHORS[0]!], HAWK_LINE)).toBe(true);
  });

  it("reports the traversal direction the route actually walks", () => {
    expect(anchorTraversalDirection(DIRECTED_ANCHORS, FORWARD_ROUTE)).toBe("forward");
    expect(anchorTraversalDirection(DIRECTED_ANCHORS, REVERSE_ROUTE)).toBe("reverse");
    // A single anchor cannot state a direction.
    expect(anchorTraversalDirection([HAWK_ANCHORS[0]!], HAWK_LINE)).toBe("unmatched");
  });
});

describe("road-span evaluation — coverage is measured on the returned geometry", () => {
  it("satisfies a must span whose returned route walks the stored anchors (legacy: satisfied must lock)", () => {
    const evaluation = evaluateRoadSpan(
      span({ geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("satisfied");
    expect(evaluation.coveredMeters).toBeCloseTo(evaluation.totalMeters, 6);
    expect(evaluation.totalMeters).toBeCloseTo(1000, 0);
    expect(evaluation.note).toBeUndefined();
  });

  it("conflicts when the returned route ignores the required span", () => {
    const elsewhere = northLine(41, 2, 500);
    const evaluation = evaluateRoadSpan(
      span({ geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(elsewhere),
    );
    expect(evaluation.status).toBe("conflict");
    expect(evaluation.coveredMeters).toBe(0);
    expect(evaluation.totalMeters).toBeCloseTo(1000, 0);
    expect(evaluation.note).toBeDefined();
  });

  it("never assumes the request was honored: the same span against two routes differs", () => {
    const declaration = span({ geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS });
    const honored = evaluateRoadSpan(declaration, route(FORWARD_ROUTE));
    const ignored = evaluateRoadSpan(declaration, route(northLine(41, 2, 500)));
    expect(honored.status).toBe("satisfied");
    expect(ignored.status).toBe("conflict");
  });

  it("covers a span when the returned route lies within the on-route tolerance of it", () => {
    const parallel = DIRECTED_LINE.map((coordinate) => ({
      lon: coordinate.lon,
      lat: coordinate.lat + 10 / EARTH_RADIUS_METERS * (180 / Math.PI),
    }));
    const evaluation = evaluateRoadSpan(
      span({ geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(parallel),
    );
    expect(evaluation.status).toBe("satisfied");
  });
});

describe("road-span direction matrix", () => {
  it("honors a forward span only when the route walks it forward", () => {
    const declaration = span({
      geometry: DIRECTED_LINE,
      anchorRefs: DIRECTED_ANCHORS,
      direction: "forward",
    });
    expect(evaluateRoadSpan(declaration, route(FORWARD_ROUTE)).status).toBe("satisfied");
    const reversed = evaluateRoadSpan(declaration, route(REVERSE_ROUTE));
    expect(reversed.status).toBe("conflict");
    expect(reversed.note).toContain("direction");
  });

  it("honors a reverse span only when the route walks it backward", () => {
    const declaration = span({
      geometry: DIRECTED_LINE,
      anchorRefs: DIRECTED_ANCHORS,
      direction: "reverse",
    });
    expect(evaluateRoadSpan(declaration, route(REVERSE_ROUTE)).status).toBe("satisfied");
    expect(evaluateRoadSpan(declaration, route(FORWARD_ROUTE)).status).toBe("conflict");
  });

  it("accepts either direction when the span declares either", () => {
    const declaration = span({
      geometry: DIRECTED_LINE,
      anchorRefs: DIRECTED_ANCHORS,
      direction: "either",
    });
    expect(evaluateRoadSpan(declaration, route(FORWARD_ROUTE)).status).toBe("satisfied");
    expect(evaluateRoadSpan(declaration, route(REVERSE_ROUTE)).status).toBe("satisfied");
  });

  it("rejects a parallel-road substitution that passes both anchors out of order (legacy SB-014)", () => {
    const declaration = span({
      geometry: DIRECTED_LINE,
      anchorRefs: DIRECTED_ANCHORS,
      direction: "forward",
    });
    // The route reaches both anchors but visits the exit before the entry.
    const evaluation = evaluateRoadSpan(declaration, route(REVERSE_ROUTE));
    expect(evaluation.status).toBe("conflict");
    expect(evaluation.note).toContain("direction");
  });
});

describe("road-span coverage threshold", () => {
  /** 100 equal 5 m segments (≈500 m) so coverage moves in exact 1 % steps. */
  const BOUNDARY_SPAN = northLine(40, 100, 5);
  const BOUNDARY_DECLARATION: ResolvedRoadSpan = {
    id: spanId("span_boundary"),
    mode: "must",
    direction: "either",
    geometry: BOUNDARY_SPAN,
    anchorRefs: [BOUNDARY_SPAN[0]!, BOUNDARY_SPAN[100]!],
  };

  function coverageOf(leadingSegments: number): number {
    const evaluation = evaluateRoadSpan(
      BOUNDARY_DECLARATION,
      route(BOUNDARY_SPAN.slice(0, leadingSegments + 1)),
    );
    return evaluation.coveredMeters / evaluation.totalMeters;
  }

  it("conflicts just below the threshold (0.89)", () => {
    const evaluation = evaluateRoadSpan(
      BOUNDARY_DECLARATION,
      route(BOUNDARY_SPAN.slice(0, 85)),
    );
    expect(coverageOf(84)).toBeCloseTo(0.89, 2);
    expect(evaluation.status).toBe("conflict");
  });

  it("satisfies exactly at the threshold (0.90)", () => {
    const evaluation = evaluateRoadSpan(
      BOUNDARY_DECLARATION,
      route(BOUNDARY_SPAN.slice(0, 86)),
    );
    expect(coverageOf(85)).toBeCloseTo(0.9, 2);
    expect(evaluation.status).toBe("satisfied");
  });

  it("satisfies above the threshold (0.91)", () => {
    const evaluation = evaluateRoadSpan(
      BOUNDARY_DECLARATION,
      route(BOUNDARY_SPAN.slice(0, 87)),
    );
    expect(coverageOf(86)).toBeCloseTo(0.91, 2);
    expect(evaluation.status).toBe("satisfied");
  });

  it("credits coverage that lands on the threshold, representation noise included", () => {
    // Every sample of this span lies on the route, so the honest answer is "all
    // of it" — but the sampled shares still sum to 0.9999999999999986, an ULP
    // below 1. A threshold of 1.0 must therefore be credited within the policy
    // epsilon rather than missed by rounding (OGV-D-203's rule, and the reason
    // the 0.90 boundary below is credited too).
    const evaluation = evaluateRoadSpan(
      BOUNDARY_DECLARATION,
      route(BOUNDARY_SPAN),
      { ...DEFAULT_SPAN_EVALUATION_POLICY, coverageThreshold: 1 },
    );
    const coverage = evaluation.coveredMeters / evaluation.totalMeters;
    expect(coverage).toBeCloseTo(1, 9);
    expect(coverage).toBeLessThanOrEqual(1);
    expect(evaluation.status).toBe("satisfied");
  });

  it("uses the default 0.9 threshold of the span length", () => {
    expect(DEFAULT_SPAN_EVALUATION_POLICY.coverageThreshold).toBe(0.9);
    expect(DEFAULT_SPAN_EVALUATION_POLICY.onRouteToleranceMeters).toBeGreaterThan(0);
  });

  it("falls back to the default resolution when a policy names a non-positive one", () => {
    const evaluation = evaluateRoadSpan(BOUNDARY_DECLARATION, route(BOUNDARY_SPAN), {
      ...DEFAULT_SPAN_EVALUATION_POLICY,
      coverageSampleMeters: 0,
    });
    expect(evaluation.coveredMeters / evaluation.totalMeters).toBeCloseTo(1, 9);
    expect(evaluation.status).toBe("satisfied");
  });
});

describe("road-span prefer semantics", () => {
  it("satisfies a preferred span the route clearly uses (legacy: prefer satisfied)", () => {
    const evaluation = evaluateRoadSpan(
      span({ mode: "prefer", geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("satisfied");
  });

  it("reports a partly used preferred span as partially satisfied (legacy: prefer skip reason)", () => {
    const quartered = northLine(40, 4, 1000);
    const evaluation = evaluateRoadSpan(
      span({
        id: spanId("span_prefer"),
        mode: "prefer",
        geometry: quartered,
        anchorRefs: [quartered[0]!, quartered[4]!],
      }),
      route(quartered.slice(0, 2)),
    );
    expect(evaluation.status).toBe("partially-satisfied");
    expect(evaluation.coveredMeters).toBeGreaterThan(0);
    expect(evaluation.coveredMeters).toBeLessThan(evaluation.totalMeters);
    expect(evaluation.note).toBeDefined();
  });

  it("reports a preferred span the route never touches as a conflict, never a hard failure", () => {
    const declaration = span({
      id: spanId("span_prefer"),
      mode: "prefer",
      geometry: DIRECTED_LINE,
      anchorRefs: DIRECTED_ANCHORS,
    });
    const evaluation = evaluateRoadSpan(declaration, route(northLine(41, 2, 500)));
    expect(evaluation.status).toBe("conflict");
    const failures = spanEligibilityFailures(
      [{ id: "span_prefer", mode: "prefer" }],
      [evaluation],
    );
    expect(failures).toEqual([]);
  });

  it("reports a preferred span used in the wrong direction as partially satisfied", () => {
    const declaration = span({
      id: spanId("span_prefer"),
      mode: "prefer",
      geometry: DIRECTED_LINE,
      anchorRefs: DIRECTED_ANCHORS,
      direction: "forward",
    });
    const evaluation = evaluateRoadSpan(declaration, route(REVERSE_ROUTE));
    expect(evaluation.status).toBe("partially-satisfied");
    expect(evaluation.note).toContain("direction");
  });
});

describe("road-span avoid semantics", () => {
  it("conflicts when the returned route enters the avoided span", () => {
    const evaluation = evaluateRoadSpan(
      span({ mode: "avoid", geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("conflict");
  });

  it("conflicts on a near-miss that still stays inside the on-route tolerance", () => {
    const parallel = DIRECTED_LINE.map((coordinate) => ({
      lon: coordinate.lon,
      lat: coordinate.lat + 10 / EARTH_RADIUS_METERS * (180 / Math.PI),
    }));
    const evaluation = evaluateRoadSpan(
      span({ mode: "avoid", geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(parallel),
    );
    expect(evaluation.status).toBe("conflict");
  });

  it("satisfies a near-miss that clips only a small share of the avoided span", () => {
    const quartered = northLine(40, 4, 1000);
    const evaluation = evaluateRoadSpan(
      span({
        id: spanId("span_avoid"),
        mode: "avoid",
        geometry: quartered,
        anchorRefs: [quartered[0]!, quartered[4]!],
      }),
      route(quartered.slice(0, 2)),
    );
    expect(evaluation.coveredMeters).toBeGreaterThan(0);
    expect(evaluation.status).toBe("satisfied");
  });

  it("satisfies an avoided span the route stays away from", () => {
    const evaluation = evaluateRoadSpan(
      span({ mode: "avoid", geometry: DIRECTED_LINE, anchorRefs: DIRECTED_ANCHORS }),
      route(northLine(41, 2, 500)),
    );
    expect(evaluation.status).toBe("satisfied");
    expect(evaluation.coveredMeters).toBe(0);
  });
});

describe("road-span unresolvable states (graph / changed geometry honesty)", () => {
  it("reports an unresolved span geometry as unavailable, never as conflict", () => {
    const evaluation = evaluateRoadSpan(
      span({ geometry: [], anchorRefs: [] }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("unavailable");
    expect(evaluation.note).toBeDefined();
  });

  it("reports a degenerate zero-length span as unavailable", () => {
    const point = DIRECTED_LINE[0]!;
    const evaluation = evaluateRoadSpan(
      span({ geometry: [point, point], anchorRefs: [point] }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("unavailable");
  });

  it("reports an unusable returned route as unavailable", () => {
    const evaluation = evaluateRoadSpan(span(), route([HAWK_LINE[0]!]));
    expect(evaluation.status).toBe("unavailable");
    expect(evaluation.note).toContain("route");
  });

  it("reports anchors that no longer answer the returned geometry as unavailable", () => {
    const stale = northLine(41, 2, 500);
    const evaluation = evaluateRoadSpan(
      span({
        mode: "must",
        direction: "forward",
        geometry: DIRECTED_LINE,
        anchorRefs: [stale[0]!, stale[2]!],
      }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("unavailable");
    expect(evaluation.note).toContain("anchor");
  });

  it("reports a direction that cannot be verified with fewer than two anchors as unavailable", () => {
    const evaluation = evaluateRoadSpan(
      span({
        direction: "forward",
        geometry: DIRECTED_LINE,
        anchorRefs: [DIRECTED_LINE[0]!],
      }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("unavailable");
  });

  it("reports a non-finite anchor as unavailable instead of measuring it", () => {
    const evaluation = evaluateRoadSpan(
      span({
        direction: "forward",
        geometry: DIRECTED_LINE,
        anchorRefs: [DIRECTED_LINE[0]!, { lon: Number.NaN, lat: 40 }],
      }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("unavailable");
  });

  it("keeps a declared-direction span satisfiable when direction is either", () => {
    const evaluation = evaluateRoadSpan(
      span({ direction: "either", geometry: DIRECTED_LINE, anchorRefs: [] }),
      route(FORWARD_ROUTE),
    );
    expect(evaluation.status).toBe("satisfied");
  });
});

describe("road-span rematch (legacy: rematchRoadLock, geometry half)", () => {
  it("rematches exactly when the anchors lie on the candidate line", () => {
    const result = rematchAnchors(HAWK_ANCHORS, HAWK_LINE, 50);
    expect(result.rematched).not.toBeNull();
    expect(result.maxDriftMeters).toBeLessThan(1);
    expect(result.confidence).toBe("exact");
  });

  it("rematches as matched when the anchors moved inside the drift limit", () => {
    const shifted = HAWK_ANCHORS.map((anchor) => ({
      lon: anchor.lon,
      lat: anchor.lat + 0.0001,
    }));
    const result = rematchAnchors(shifted, HAWK_LINE, 60);
    expect(result.rematched).not.toBeNull();
    expect(result.confidence).toBe("matched");
    expect(result.maxDriftMeters).toBeGreaterThan(1);
    expect(result.maxDriftMeters).toBeLessThanOrEqual(60);
  });

  it("rematches onto a newer line that still carries the anchors in order (legacy: approximate rematch)", () => {
    const newer = HAWK_LINE.map((coordinate) => ({
      lon: coordinate.lon + 0.0001,
      lat: coordinate.lat + 0.0001,
    }));
    const result = rematchAnchors(HAWK_ANCHORS, newer, 60);
    expect(result.rematched).not.toBeNull();
    expect(result.confidence).toBe("matched");
  });

  it("refuses to slide the span when the anchors project out of order (legacy: refusal)", () => {
    const result = rematchAnchors([...HAWK_ANCHORS].reverse(), HAWK_LINE, 1000);
    expect(result.rematched).toBeNull();
    expect(result.confidence).toBe("approximate");
  });

  it("refuses to rematch when an anchor falls outside the drift limit (legacy: fallback corridor)", () => {
    const result = rematchAnchors(
      [HAWK_ANCHORS[0]!, { lon: -76, lat: 41 }],
      HAWK_LINE,
      50,
    );
    expect(result.rematched).toBeNull();
    expect(result.maxDriftMeters).toBeGreaterThan(50);
    expect(result.confidence).toBe("approximate");
  });

  it("refuses to rematch against an unusable line and reports the drift as unmeasurable", () => {
    const result = rematchAnchors(HAWK_ANCHORS, [HAWK_LINE[0]!], 50);
    expect(result.rematched).toBeNull();
    expect(result.maxDriftMeters).toBe(Number.POSITIVE_INFINITY);
  });

  it("defaults the drift limit to the ported legacy fallback corridor", () => {
    expect(DEFAULT_REMATCH_DRIFT_METERS).toBe(50);
    const shifted = HAWK_ANCHORS.map((anchor) => ({
      lon: anchor.lon,
      lat: anchor.lat + 0.0001,
    }));
    expect(rematchAnchors(shifted, HAWK_LINE).rematched).not.toBeNull();
  });

  it("refuses to rematch fewer than two anchors", () => {
    expect(rematchAnchors([HAWK_ANCHORS[0]!], HAWK_LINE, 50).rematched).toBeNull();
    expect(rematchAnchors([], HAWK_LINE, 50).rematched).toBeNull();
  });

  it("refuses a drift limit that states no usable tolerance", () => {
    expect(
      rematchAnchors(HAWK_ANCHORS, HAWK_LINE, Number.POSITIVE_INFINITY).rematched,
    ).toBeNull();
    expect(
      rematchAnchors(HAWK_ANCHORS, HAWK_LINE, Number.NaN).rematched,
    ).toBeNull();
    expect(rematchAnchors(HAWK_ANCHORS, HAWK_LINE, -1).rematched).toBeNull();
  });
});

describe("road-span user rescope helpers", () => {
  it("converts a must span to prefer while preserving every other field (legacy: convertMustLockToPrefer)", () => {
    const declaration = {
      id: spanId("span_hawk"),
      mode: "must" as const,
      direction: "forward" as const,
      geometry: HAWK_LINE,
      anchorRefs: HAWK_ANCHORS,
      roadEntityId: "road-7",
    };
    const converted = convertMustToPrefer(declaration);
    expect(converted.mode).toBe("prefer");
    expect(converted.direction).toBe("forward");
    expect(converted.roadEntityId).toBe("road-7");
    expect(converted.geometry).toBe(HAWK_LINE);
    // A span that is not `must` is returned untouched.
    expect(convertMustToPrefer(converted)).toBe(converted);
  });

  it("offers the four explicit unresolved-span choices (legacy: MUST_LOCK_UNRESOLVED_OPTIONS)", () => {
    expect(UNRESOLVED_SPAN_OPTIONS).toEqual([
      "retry-rematch",
      "convert-to-prefer",
      "remove-span",
      "keep-disabled",
    ]);
  });
});

describe("road-span eligibility mapping", () => {
  function evaluation(
    id: string,
    status: SpanEvaluation["status"],
  ): SpanEvaluation {
    return { spanId: spanId(id), status, coveredMeters: 0, totalMeters: 100 };
  }

  it("turns a must conflict into a required-span failure (legacy: must lock unresolved)", () => {
    const failures = spanEligibilityFailures(
      [{ id: "span_must", mode: "must" }],
      [evaluation("span_must", "conflict")],
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      code: "required-span-unsatisfied",
      constraintId: "span_must",
    });
    expect(failures[0]?.message).toBeTruthy();
  });

  it("turns a must unavailable into its own failure code", () => {
    const failures = spanEligibilityFailures(
      [{ id: "span_must", mode: "must" }],
      [evaluation("span_must", "unavailable")],
    );
    expect(failures.map((failure) => failure.code)).toEqual([
      "required-span-unavailable",
    ]);
  });

  it("fails a must span in any state other than satisfied", () => {
    const failures = spanEligibilityFailures(
      [{ id: "span_must", mode: "must" }],
      [evaluation("span_must", "partially-satisfied")],
    );
    expect(failures.map((failure) => failure.code)).toEqual([
      "required-span-unsatisfied",
    ]);
  });

  it("passes a satisfied must span and ignores prefer spans", () => {
    expect(
      spanEligibilityFailures(
        [
          { id: "span_must", mode: "must" },
          { id: "span_prefer", mode: "prefer" },
        ],
        [
          evaluation("span_must", "satisfied"),
          evaluation("span_prefer", "conflict"),
        ],
      ),
    ).toEqual([]);
  });

  it("turns an avoid conflict into an avoid-span violation", () => {
    const failures = spanEligibilityFailures(
      [{ id: "span_avoid", mode: "avoid" }],
      [evaluation("span_avoid", "conflict")],
    );
    expect(failures.map((failure) => failure.code)).toEqual(["avoid-span-violated"]);
    expect(failures[0]?.constraintId).toBe("span_avoid");
  });

  it("says nothing about a span the engine never measured", () => {
    expect(
      spanEligibilityFailures([{ id: "span_unknown", mode: "must" }], []),
    ).toEqual([]);
  });
});

describe("road-span engine purity and determinism", () => {
  it("evaluates every span in author order", () => {
    const spans: ResolvedRoadSpan[] = [
      span({ id: spanId("span_a") }),
      span({ id: spanId("span_b"), mode: "prefer" }),
      span({ id: spanId("span_c"), mode: "avoid" }),
    ];
    const evaluations = evaluateRoadSpans(spans, route(FORWARD_ROUTE));
    expect(evaluations.map((evaluation) => evaluation.spanId)).toEqual([
      "span_a",
      "span_b",
      "span_c",
    ]);
  });

  it("returns the same answer twice and never mutates its inputs", () => {
    const declaration = span({ direction: "forward" });
    const snapshot = JSON.stringify(declaration);
    const geometrySnapshot = JSON.stringify(HAWK_LINE);
    const first = evaluateRoadSpan(declaration, route(HAWK_LINE));
    const second = evaluateRoadSpan(declaration, route(HAWK_LINE));
    expect(second).toEqual(first);
    expect(JSON.stringify(declaration)).toBe(snapshot);
    expect(JSON.stringify(HAWK_LINE)).toBe(geometrySnapshot);
    expect(rematchAnchors(HAWK_ANCHORS, HAWK_LINE, 50)).toEqual(
      rematchAnchors(HAWK_ANCHORS, HAWK_LINE, 50),
    );
  });
});
