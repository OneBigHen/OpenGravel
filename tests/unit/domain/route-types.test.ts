/**
 * Route domain value types (03-DOMAIN-MODEL §14–§19) and their branded IDs.
 *
 * These tests are mostly a compile-time contract plus a few runtime anchors:
 * they build a fully populated candidate and bundle so a missing or
 * misspelled field fails the suite instead of silently shipping an
 * incomplete pipeline value.
 */

import { describe, expect, it } from "vitest";

import type { EvidenceValue } from "@/domain/evidence/types";
import { unknownEvidence } from "@/domain/evidence/types";
import { asGeometryRef, asRoadEntityId, newRideId } from "@/domain/ride/ids";
import {
  asBlobRef,
  asRouteCandidateId,
  asRouteSpanRef,
  newRouteCandidateId,
  type RouteCandidateId,
} from "@/domain/route/ids";
import type {
  EligibilityResult,
  ProviderProvenance,
  RouteBundle,
  RouteCandidate,
  RouteEvidence,
  RouteEvidenceKey,
  RouteRoles,
  RouteScore,
  RouteWarning,
  ScoreComponent,
} from "@/domain/route/types";

const EVIDENCE_KEYS: readonly RouteEvidenceKey[] = [
  "surfaceMix",
  "difficultyCoverage",
  "access",
  "closures",
  "traffic",
  "weatherExposure",
  "daylight",
  "curvature",
  "elevation",
  "urbanFriction",
  "roadClassMix",
  "scenery",
  "novelty",
  "fuelGap",
  "knownRoadConfidence",
];

function component(explanationKey: string): ScoreComponent {
  return {
    input: 0.5,
    weight: 0.1,
    contribution: 0.05,
    explanationKey,
    evidenceStatus: "estimated",
  };
}

/** Every §19 component, so a renamed component is a compile error here. */
function buildScore(): RouteScore {
  return {
    policyVersion: "PA_NJ_ROUTE_POLICY_VNEXT_1",
    total: 0.5,
    components: {
      curvature: component("score.curvature"),
      backroad: component("score.backroad"),
      surfaceFit: component("score.surfaceFit"),
      elevation: component("score.elevation"),
      traffic: component("score.traffic"),
      junctionFriction: component("score.junctionFriction"),
      novelty: component("score.novelty"),
      closureRisk: component("score.closureRisk"),
      timeCost: component("score.timeCost"),
      confidence: component("score.confidence"),
    },
  };
}

/** Every documented evidence key, plus one future key the open map must accept. */
function buildEvidence(): RouteEvidence {
  const evidence: Record<string, EvidenceValue<unknown>> = {};
  for (const key of EVIDENCE_KEYS) evidence[key] = unknownEvidence<unknown>();
  evidence["futureKeyNotInventedHere"] = unknownEvidence<unknown>();
  return evidence;
}

function buildWarning(id: string): RouteWarning {
  return { id, code: "route.warning.surface-unknown", severity: "warning", message: id };
}

function buildEligibility(): EligibilityResult {
  return {
    eligible: false,
    failures: [
      {
        code: "avoid-area-violated",
        message: "the route enters an active avoid area",
        constraintId: "avoid_1",
      },
    ],
  };
}

function buildProvenance(): ProviderProvenance {
  return { providerId: "graphhopper", profile: "motorcycle", providerVersion: "11.0" };
}

function buildCandidate(id: RouteCandidateId): RouteCandidate {
  return {
    id,
    provider: buildProvenance(),
    geometryRef: asGeometryRef("geo_route_1"),
    instructionsRef: undefined,
    distanceMeters: 121_000,
    durationSeconds: 7_200,
    eligibility: buildEligibility(),
    evidence: buildEvidence(),
    score: buildScore(),
    warnings: [buildWarning("warn_1")],
    fingerprint: "route-fingerprint-1",
  };
}

function buildRoles(selected: RouteCandidateId): RouteRoles {
  return {
    "best-ride": selected,
    fastest: null,
    "fast-and-fun": null,
    "more-twisties": null,
    "more-dirt": null,
    "lower-workload": null,
  };
}

describe("route candidate identity (03-DOMAIN-MODEL §1)", () => {
  it("mints route_ ids that are unique", () => {
    const first = newRouteCandidateId();
    const second = newRouteCandidateId();

    expect(first.startsWith("route_")).toBe(true);
    expect(first).not.toBe(second);
  });

  it("narrows an existing candidate id without minting one", () => {
    expect(asRouteCandidateId("route_7")).toBe("route_7");
  });

  it("keeps the span brand owned by the route module available to evidence", () => {
    expect(asRouteSpanRef("span_7")).toBe("span_7");
  });
});

describe("RouteCandidate (03-DOMAIN-MODEL §14)", () => {
  it("holds id, provider provenance, geometry ref, metrics, eligibility, evidence, score, warnings and fingerprint", () => {
    const candidate = buildCandidate(asRouteCandidateId("route_1"));

    expect(candidate.id).toBe("route_1");
    expect(candidate.provider).toEqual(buildProvenance());
    expect(candidate.geometryRef).toBe("geo_route_1");
    expect(candidate.distanceMeters).toBe(121_000);
    expect(candidate.durationSeconds).toBe(7_200);
    expect(candidate.eligibility.eligible).toBe(false);
    expect(candidate.eligibility.failures).toHaveLength(1);
    expect(candidate.score.components.curvature.evidenceStatus).toBe("estimated");
    expect(candidate.evidence["surfaceMix"]?.status).toBe("unknown");
    expect(candidate.warnings.map((warning) => warning.severity)).toEqual(["warning"]);
    expect(candidate.fingerprint).toBe("route-fingerprint-1");
  });

  it("accepts an optional instructions blob ref", () => {
    const withInstructions: RouteCandidate = {
      ...buildCandidate(asRouteCandidateId("route_2")),
      instructionsRef: asBlobRef("blob_instructions_1"),
    };

    expect(withInstructions.instructionsRef).toBe("blob_instructions_1");
  });

  it("carries road entity identity from road intelligence on constraints", () => {
    expect(asRoadEntityId("road_44")).toBe("road_44");
  });
});

describe("RouteBundle (03-DOMAIN-MODEL §15)", () => {
  it("carries ownership identity, versions, candidates, selection, roles and creation time", () => {
    const selected = asRouteCandidateId("route_1");
    const bundle: RouteBundle = {
      rideId: newRideId(),
      rideRevision: 12,
      planningGeneration: 8,
      policyVersion: "PA_NJ_ROUTE_POLICY_VNEXT_1",
      graphVersion: "gh-nj-2026-04",
      evidenceVersion: "road-intel-3",
      candidates: [buildCandidate(selected)],
      selectedRouteId: selected,
      selectionSource: "automatic",
      roles: buildRoles(selected),
      createdAt: "2026-04-01T10:00:00.000Z",
    };

    expect(bundle.planningGeneration).toBe(8);
    expect(bundle.candidates).toHaveLength(1);
    expect(bundle.selectedRouteId).toBe("route_1");
    expect(bundle.roles["best-ride"]).toBe("route_1");
    expect(bundle.roles.fastest).toBeNull();
  });
});

describe("eligibility failures (03-DOMAIN-MODEL §17)", () => {
  it("allow a machine-readable code with an optional constraint id", () => {
    const withoutConstraint = buildEligibility().failures.map((failure) => ({
      code: failure.code,
      message: failure.message,
    }));

    expect(withoutConstraint).toEqual([
      { code: "avoid-area-violated", message: "the route enters an active avoid area" },
    ]);
  });

  it("distinguish eligible from not eligible", () => {
    const eligible: EligibilityResult = { eligible: true, failures: [] };

    expect(eligible.eligible).toBe(true);
    expect(eligible.failures).toEqual([]);
  });
});
