/**
 * The candidate pipeline (Task 3.1, 06-ROUTING-AND-DECISION-ENGINE §1, §7–§9).
 *
 * The stage order is the contract: normalize → eligibility → enrich → score.
 * An ineligible candidate is dropped **before** scoring and is explained by a
 * diagnostic — a route that cannot legally be ridden never receives a rank, and
 * a beautifully scored illegal route never reaches selection (06 §7).
 */

import { describe, expect, it } from "vitest";

import type { ProviderCandidate } from "@/application/planner/route-provider";
import { isUsableEvidence, knownEvidence } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { runCandidatePipeline } from "@/application/planner/pipeline";
import { aggregateRouteSurface } from "@/application/roads/surface-evidence";

const POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;

const ORIGIN: Coordinate = { lon: -77.1, lat: 40.1 };
const DESTINATION: Coordinate = { lon: -77.0, lat: 40.2 };

function providerCandidate(
  overrides: Partial<ProviderCandidate> = {},
): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: "motorcycle_fastest",
    geometry: [ORIGIN, DESTINATION],
    distanceMeters: 14_000,
    durationSeconds: 900,
    providerMetadata: { fingerprint: "fp_primary" },
    ...overrides,
  };
}

function run(
  candidates: readonly ProviderCandidate[],
  constraintContext?: Parameters<typeof runCandidatePipeline>[0]["constraintContext"],
) {
  return runCandidatePipeline({
    candidates,
    intent: {},
    policy: POLICY,
    ...(constraintContext === undefined ? {} : { constraintContext }),
  });
}

describe("runCandidatePipeline — ordering", () => {
  it("retains bounded provider instructions on the selected route candidate", () => {
    const instructions = [{
      text: "Turn left onto Ridge Pike",
      distanceMeters: 420,
      durationSeconds: 62,
      type: "turn",
      maneuver: "left" as const,
      roadName: "Ridge Pike",
      geometryIndex: 1,
    }];
    const result = run([providerCandidate({ instructions })]);

    expect(result.candidates[0]?.instructions).toEqual(instructions);
  });

  it("drops an ineligible candidate with a diagnostic before scoring", () => {
    const result = run([
      providerCandidate({ geometry: [ORIGIN] }),
      providerCandidate({ providerMetadata: { fingerprint: "fp_ok" } }),
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.fingerprint).toBe("fp_ok");
    expect(result.funShadowAssessments).toHaveLength(1);
    expect(result.funShadowAssessments[0]).toMatchObject({
      fingerprint: "fp_ok",
      providerId: "stub-router",
      profile: "motorcycle_fastest",
      assessment: { classification: "unknown" },
    });
    expect(result.candidates[0]?.eligibility.eligible).toBe(true);
    // The dropped candidate left a diagnostic naming its failure, not a score.
    const dropped = result.diagnostics.find(
      (entry) => entry.candidateIndex === 0,
    );
    expect(dropped?.code).toBe("ineligible");
    expect(dropped?.eligibilityCode).toBe("geometry-malformed");
    expect(dropped?.providerId).toBe("stub-router");
    // Only the dropped candidate is named by a diagnostic; the survivor scored.
    expect(result.diagnostics).toHaveLength(1);
    expect(result.candidates[0]?.score.policyVersion).toBe(POLICY.version);
  });

  it("attributes the score only to candidates that survived eligibility", () => {
    const result = run([
      providerCandidate({
        geometry: [ORIGIN, { lon: Number.NaN, lat: 40 }],
      }),
      providerCandidate({ durationSeconds: 600 }),
    ]);

    expect(result.candidates).toHaveLength(1);
    for (const entry of result.candidates) {
      expect(entry.eligibility.eligible).toBe(true);
      expect(entry.score.policyVersion).toBe(POLICY.version);
    }
  });
});

describe("runCandidatePipeline — empty and all-ineligible inputs", () => {
  it("returns an empty result with a diagnostic for no candidates", () => {
    const result = run([]);
    expect(result.candidates).toEqual([]);
    expect(result.funShadowAssessments).toEqual([]);
    expect(result.funShadowSelection).toBeNull();
    expect(result.diagnostics.map((entry) => entry.code)).toEqual([
      "empty-candidate-set",
    ]);
  });

  it("returns an empty result when every candidate is ineligible", () => {
    const result = run([
      providerCandidate({ geometry: [ORIGIN] }),
      providerCandidate({ geometry: [ORIGIN] }),
    ]);
    expect(result.candidates).toEqual([]);
    expect(result.funShadowAssessments).toEqual([]);
    expect(result.funShadowSelection).toBeNull();
    expect(
      result.diagnostics.filter((entry) => entry.code === "ineligible"),
    ).toHaveLength(2);
  });
});

describe("runCandidatePipeline — enrichment and shape", () => {
  it("keeps provider provenance and the provider fingerprint", () => {
    const [built] = run([providerCandidate()]).candidates;
    expect(built?.provider).toEqual({
      providerId: "stub-router",
      profile: "motorcycle_fastest",
    });
    expect(built?.fingerprint).toBe("fp_primary");
  });

  it("keys the surface mix honestly as unknown instead of inventing a value", () => {
    const [built] = run([providerCandidate()]).candidates;
    const surfaceMix = built?.evidence["surfaceMix"];
    expect(surfaceMix).toBeDefined();
    expect(surfaceMix?.status).toBe("unknown");
    expect(surfaceMix?.value).toBeNull();
    expect(isUsableEvidence(surfaceMix!)).toBe(false);
  });

  it("gives a freshly generated route zero surface evidence", () => {
    const [built] = run([providerCandidate()]).candidates;
    const assessment = aggregateRouteSurface(built?.evidence["surfaceMix"]);

    expect(assessment).toMatchObject({
      value: "unknown",
      band: "unknown",
      evidenceCount: 0,
      provenance: [],
    });
  });

  it("copies geometry so a caller cannot mutate a pipeline result afterwards", () => {
    const geometry: Coordinate[] = [ORIGIN, DESTINATION];
    const [built] = run([providerCandidate({ geometry })]).candidates;
    geometry.push({ lon: -76.9, lat: 40.3 });
    expect(built?.geometry).toEqual([ORIGIN, DESTINATION]);
  });

  it("feeds verified Gravel Atlas overlap into the shadow fun assessment", () => {
    const result = runCandidatePipeline({
      candidates: [providerCandidate({ distanceMeters: 10_000 })],
      intent: {},
      policy: POLICY,
      evidenceFor: () => ({
        verifiedGravel: knownEvidence(
          { meters: 5_000, corridors: ["Old Mine Road"] },
          {
            id: "gravel-atlas",
            label: "Gravel Atlas verified corridors",
            category: "survey",
          },
          0.8,
        ),
      }),
    });

    expect(
      result.funShadowAssessments[0]?.assessment.features.mappedGravelAffinity,
    ).toBe(0.4);
  });

  it("evaluates fun in shadow mode before diversity without changing selection", () => {
    const duplicate = providerCandidate({
      profile: "motorcycle_adventure",
      providerMetadata: { fingerprint: "fp_duplicate" },
    });
    const result = run([providerCandidate(), duplicate]);

    // Diversity may show only one near-identical route, but shadow evaluation
    // records both eligible candidates for later corpus calibration.
    expect(result.candidates).toHaveLength(1);
    expect(result.funShadowAssessments).toHaveLength(2);
    expect(result.funShadowAssessments.map((entry) => entry.fingerprint).sort()).toEqual([
      "fp_duplicate",
      "fp_primary",
    ]);
    expect(result.selectedIndex).toBe(0);
    // Sparse geometry-only evidence cannot manufacture a shadow winner.
    expect(result.funShadowSelection).toBeNull();
  });

  it("is deterministic for identical input", () => {
    const candidates = [providerCandidate(), providerCandidate({ durationSeconds: 500 })];
    expect(run(candidates)).toEqual(run(candidates));
  });

  it("scores a supplied core riding section without replacing the full route geometry", () => {
    const fullGeometry: readonly Coordinate[] = Array.from(
      { length: 21 },
      (_, index) => ({
        lon: -77.1 + index * 0.005,
        lat: 40.1 + index * 0.005 + Math.sin(index) * 0.01,
      }),
    );
    const coreGeometry: readonly Coordinate[] = [
      ORIGIN,
      { lon: -77.05, lat: 40.15 },
      DESTINATION,
    ];
    const result = runCandidatePipeline({
      candidates: [providerCandidate({ geometry: fullGeometry })],
      intent: {},
      policy: POLICY,
      scoringGeometryFor: () => coreGeometry,
    });

    expect(result.candidates[0]?.geometry).toEqual(fullGeometry);
    expect(result.candidates[0]?.score.components.curvature.input).toBe(0);
    expect(run([providerCandidate({ geometry: fullGeometry })]).candidates[0]
      ?.score.components.curvature.input).toBeGreaterThan(0);
  });
});
