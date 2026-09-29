/**
 * Hard eligibility: explicit evidence can reject a candidate; missing evidence cannot.
 *
 * The ported discipline: an explicit fact can reject a candidate, and an absent
 * fact never can. These tests pin both halves, because "we do not know" and
 * "the answer is no" must never collapse into one another (03-DOMAIN-MODEL §17).
 */

import { describe, expect, it } from "vitest";

import {
  evaluateEligibility,
  type ConstraintContext,
} from "@/domain/route/eligibility";
import type { SpanEvaluation } from "@/domain/road/spans";
import type { RoadSpanId } from "@/domain/ride/ids";
import type { Coordinate } from "@/domain/ride/types";

const ORIGIN: Coordinate = { lon: -77.1, lat: 40.1 };
const DESTINATION: Coordinate = { lon: -77.0, lat: 40.2 };

/** A closed square around (-77.0, 40.0), the avoid area every test reuses. */
const AVOID_RING: readonly Coordinate[] = [
  { lon: -77.01, lat: 39.99 },
  { lon: -76.99, lat: 39.99 },
  { lon: -76.99, lat: 40.01 },
  { lon: -77.01, lat: 40.01 },
  { lon: -77.01, lat: 39.99 },
];

const EMPTY_CONSTRAINTS: ConstraintContext = { avoidAreas: [], roadSpans: [] };

function constraints(overrides: Partial<ConstraintContext> = {}): ConstraintContext {
  return { ...EMPTY_CONSTRAINTS, ...overrides };
}

/** An ordinary destination-shaped candidate with a 2-point line. */
function candidate(overrides: Partial<{
  geometry: readonly Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  flags: readonly string[];
}> = {}) {
  return {
    geometry: [ORIGIN, DESTINATION],
    distanceMeters: 14_000,
    durationSeconds: 900,
    ...overrides,
  };
}

describe("evaluateEligibility — geometry gates", () => {
  it("rejects a candidate that cannot be a line", () => {
    const result = evaluateEligibility({
      candidate: candidate({ geometry: [ORIGIN] }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain("geometry-malformed");
  });

  it("rejects a non-finite coordinate as malformed, not as out of bounds", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [ORIGIN, { lon: Number.NaN, lat: 40 }],
      }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(["geometry-malformed"]);
  });

  it("rejects a finite coordinate outside WGS84 as out of bounds", () => {
    const result = evaluateEligibility({
      candidate: candidate({ geometry: [ORIGIN, { lon: 200, lat: 40 }] }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(["out-of-bounds"]);
  });

  it("rejects a route shorter than the minimum rideable length", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [{ lon: -77.1, lat: 40.1 }, { lon: -77.0999, lat: 40.1 }],
        distanceMeters: 8,
      }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(["too-short"]);
  });

  it("rejects repeated consecutive points", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [ORIGIN, { lon: ORIGIN.lon, lat: ORIGIN.lat }, DESTINATION],
      }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "duplicate-consecutive-points",
    ]);
  });
});

describe("evaluateEligibility — avoid areas", () => {
  it("hard-fails a route whose vertices enter an avoid area", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [
          { lon: -77.05, lat: 40.0 },
          { lon: -77.0, lat: 40.0 },
          { lon: -76.95, lat: 40.0 },
        ],
      }),
      intent: { shape: "destination" },
      constraintContext: constraints({
        avoidAreas: [{ id: "avoid_a", rings: [AVOID_RING] }],
      }),
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "avoid-area-violated",
    ]);
    expect(result.failures[0]?.constraintId).toBe("avoid_a");
  });

  it("hard-fails a route that crosses an avoid area without a vertex inside it", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [
          { lon: -77.05, lat: 40.0 },
          { lon: -76.95, lat: 40.0 },
        ],
      }),
      intent: { shape: "destination" },
      constraintContext: constraints({
        avoidAreas: [{ id: "avoid_a", rings: [AVOID_RING] }],
      }),
    });
    expect(result.eligible).toBe(false);
    expect(result.failures[0]?.code).toBe("avoid-area-violated");
  });

  it("leaves a route that misses the avoid area eligible", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [
          { lon: -77.05, lat: 39.95 },
          { lon: -76.95, lat: 39.95 },
        ],
      }),
      intent: { shape: "destination" },
      constraintContext: constraints({
        avoidAreas: [{ id: "avoid_a", rings: [AVOID_RING] }],
      }),
    });
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
  });
});

describe("evaluateEligibility — loop endpoint snap", () => {
  const LOOP_ORIGIN: Coordinate = { lon: -77.1, lat: 40.1 };

  it("fails a loop that never returns to its start", () => {
    const result = evaluateEligibility({
      candidate: candidate({ geometry: [LOOP_ORIGIN, DESTINATION] }),
      intent: { shape: "loop" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "self-loop-endpoint-snap-failure",
    ]);
  });

  it("accepts a loop that closes on its start", () => {
    const result = evaluateEligibility({
      candidate: candidate({
        geometry: [LOOP_ORIGIN, DESTINATION, { ...LOOP_ORIGIN }],
      }),
      intent: { shape: "loop" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("does not apply the loop check to a destination ride", () => {
    const result = evaluateEligibility({
      candidate: candidate({ geometry: [LOOP_ORIGIN, DESTINATION] }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(true);
  });
});

describe("evaluateEligibility — unknown evidence never fails", () => {
  it("stays eligible when nothing is known about the route", () => {
    const result = evaluateEligibility({
      candidate: candidate(),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result).toEqual({ eligible: true, failures: [], warnings: [] });
  });

  it("warns instead of failing when a must-road span cannot be verified yet", () => {
    const result = evaluateEligibility({
      candidate: candidate(),
      intent: { shape: "destination" },
      constraintContext: constraints({
        roadSpans: [{ id: "span_a", mode: "must" }],
      }),
    });
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "must-road-unresolved",
    ]);
    expect(result.warnings[0]?.constraintId).toBe("span_a");
  });

  it("leaves prefer and avoid spans inert until road matching exists", () => {
    const result = evaluateEligibility({
      candidate: candidate(),
      intent: { shape: "destination" },
      constraintContext: constraints({
        roadSpans: [
          { id: "span_prefer", mode: "prefer" },
          { id: "span_avoid", mode: "avoid" },
        ],
      }),
    });
    expect(result.eligible).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("fails on an explicit blocking evidence flag", () => {
    const result = evaluateEligibility({
      candidate: candidate({ flags: ["private", "seasonal"] }),
      intent: { shape: "destination" },
      constraintContext: EMPTY_CONSTRAINTS,
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(["blocking-flag"]);
  });
});

/**
 * The Task 4.3a hook (06 §8, §19): once the road-span engine has measured the
 * returned route, an evaluated span replaces the "not verified yet" warning with
 * its measured verdict — a required span in conflict is a hard failure, and a
 * measured span is never also reported as unresolved.
 */
describe("evaluateEligibility — measured road spans", () => {
  function spanEvaluation(
    id: string,
    status: SpanEvaluation["status"],
  ): SpanEvaluation {
    return {
      spanId: id as RoadSpanId,
      status,
      coveredMeters: status === "satisfied" ? 100 : 0,
      totalMeters: 100,
    };
  }

  function evaluateSpans(overrides: Partial<ConstraintContext>) {
    return evaluateEligibility({
      candidate: candidate(),
      intent: { shape: "destination" },
      constraintContext: constraints(overrides),
    });
  }

  it("fails a required span the engine measured in conflict, with no unresolved warning", () => {
    const result = evaluateSpans({
      roadSpans: [{ id: "span_a", mode: "must" }],
      spanEvaluations: [spanEvaluation("span_a", "conflict")],
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "required-span-unsatisfied",
    ]);
    expect(result.failures[0]?.constraintId).toBe("span_a");
    expect(result.warnings).toEqual([]);
  });

  it("fails a required span the engine could not resolve", () => {
    const result = evaluateSpans({
      roadSpans: [{ id: "span_a", mode: "must" }],
      spanEvaluations: [spanEvaluation("span_a", "unavailable")],
    });
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "required-span-unavailable",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("passes a required span the engine measured as satisfied", () => {
    const result = evaluateSpans({
      roadSpans: [{ id: "span_a", mode: "must" }],
      spanEvaluations: [spanEvaluation("span_a", "satisfied")],
    });
    expect(result).toEqual({ eligible: true, failures: [], warnings: [] });
  });

  it("fails an avoided span the engine measured as entered", () => {
    const result = evaluateSpans({
      roadSpans: [{ id: "span_avoid", mode: "avoid" }],
      spanEvaluations: [spanEvaluation("span_avoid", "conflict")],
    });
    expect(result.eligible).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      "avoid-span-violated",
    ]);
  });

  it("leaves a preferred span informational however it was measured", () => {
    const result = evaluateSpans({
      roadSpans: [{ id: "span_prefer", mode: "prefer" }],
      spanEvaluations: [spanEvaluation("span_prefer", "conflict")],
    });
    expect(result).toEqual({ eligible: true, failures: [], warnings: [] });
  });

  it("warns only about the required spans the engine never measured", () => {
    const result = evaluateSpans({
      roadSpans: [
        { id: "span_measured", mode: "must" },
        { id: "span_unmeasured", mode: "must" },
      ],
      spanEvaluations: [spanEvaluation("span_measured", "satisfied")],
    });
    expect(result.eligible).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((warning) => warning.constraintId)).toEqual([
      "span_unmeasured",
    ]);
  });
});
