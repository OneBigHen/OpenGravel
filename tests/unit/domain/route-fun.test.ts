import { describe, expect, it } from "vitest";

import { knownEvidence, unknownEvidence } from "@/domain/evidence/types";
import {
  PA_NJ_FUN_POLICY_VNEXT_1,
  assessRouteFun,
  funFeaturesFromRouteScore,
  isFunRoute,
  mappedGravelAffinityFromEvidence,
  selectFunWithinDetour,
} from "@/domain/route/fun";
import type { RouteScore, ScoreComponent } from "@/domain/route/types";

function component(input: number | null): ScoreComponent {
  return {
    input,
    weight: 0,
    contribution: 0,
    explanationKey: "test",
    evidenceStatus: input === null ? "unknown" : "known",
  };
}

function routeScore(
  values: Partial<Record<keyof RouteScore["components"], number | null>> = {},
): RouteScore {
  return {
    policyVersion: "test-route-policy",
    total: 50,
    components: {
      curvature: component(values.curvature ?? null),
      backroad: component(values.backroad ?? null),
      surfaceFit: component(values.surfaceFit ?? null),
      elevation: component(values.elevation ?? null),
      traffic: component(values.traffic ?? null),
      junctionFriction: component(values.junctionFriction ?? null),
      novelty: component(values.novelty ?? null),
      closureRisk: component(values.closureRisk ?? null),
      timeCost: component(values.timeCost ?? null),
      confidence: component(values.confidence ?? null),
    },
  };
}

describe("assessRouteFun", () => {
  it("is deterministic and names the policy", () => {
    const score = routeScore({
      curvature: 0.8,
      backroad: 0.7,
      surfaceFit: 0.5,
      traffic: 0.2,
      junctionFriction: 0.2,
      confidence: 0.9,
    });

    const first = assessRouteFun(score);
    expect(first).toEqual(assessRouteFun(score));
    expect(first.policyVersion).toBe(PA_NJ_FUN_POLICY_VNEXT_1.version);
    expect(first.score).toBeGreaterThan(0);
  });

  it("keeps sparse evidence unknown instead of fabricating a yes/no answer", () => {
    const assessment = assessRouteFun(routeScore({ curvature: 0.9 }));

    expect(assessment.coverage).toBeLessThan(
      PA_NJ_FUN_POLICY_VNEXT_1.minimumCoverage,
    );
    expect(assessment.classification).toBe("unknown");
    expect(isFunRoute(assessment)).toBeNull();
  });

  it("turns cost axes into flow qualities", () => {
    const features = funFeaturesFromRouteScore(
      routeScore({ traffic: 0.2, junctionFriction: 0.75 }),
    );

    expect(features.trafficFlow).toBeCloseTo(0.8, 6);
    expect(features.junctionFlow).toBeCloseTo(0.25, 6);
  });

  it("accepts typed future signals without treating them as hard route facts", () => {
    const assessment = assessRouteFun(
      routeScore({
        curvature: 0.75,
        backroad: 0.7,
        surfaceFit: 0.7,
        traffic: 0.2,
        junctionFriction: 0.2,
        confidence: 0.9,
      }),
      {
        speedCharacterFit: 0.85,
        signalFlow: 0.9,
        mappedGravelAffinity: 0.8,
      },
    );

    expect(assessment.features.speedCharacterFit).toBe(0.85);
    expect(assessment.features.mappedGravelAffinity).toBe(0.8);
    expect(assessment.classification).toBe("fun");
    expect(
      assessment.reasons.some((reason) => reason.key === "fun.mapped-gravel"),
    ).toBe(true);
  });
});

describe("mappedGravelAffinityFromEvidence", () => {
  const source = {
    id: "gravel-atlas",
    label: "Gravel Atlas verified corridors",
    category: "survey" as const,
  };

  it("uses verified route share multiplied by evidence confidence", () => {
    const affinity = mappedGravelAffinityFromEvidence(
      {
        verifiedGravel: knownEvidence(
          { meters: 5_000, corridors: ["Old Mine Road"] },
          source,
          0.8,
        ),
      },
      10_000,
    );

    expect(affinity).toBe(0.4);
  });

  it("keeps missing or unusable gravel evidence unknown", () => {
    expect(mappedGravelAffinityFromEvidence({}, 10_000)).toBeNull();
    expect(
      mappedGravelAffinityFromEvidence(
        { verifiedGravel: unknownEvidence("not measured") },
        10_000,
      ),
    ).toBeNull();
  });

  it("does not invent confidence when a source omits it", () => {
    expect(
      mappedGravelAffinityFromEvidence(
        {
          verifiedGravel: knownEvidence(
            { meters: 5_000, corridors: [] },
            source,
          ),
        },
        10_000,
      ),
    ).toBeNull();
  });
});

describe("selectFunWithinDetour", () => {
  const funScore = routeScore({
    curvature: 0.85,
    backroad: 0.8,
    surfaceFit: 0.65,
    traffic: 0.15,
    junctionFriction: 0.2,
    confidence: 0.9,
  });

  const mixedScore = routeScore({
    curvature: 0.65,
    backroad: 0.55,
    surfaceFit: 0.4,
    traffic: 0.3,
    junctionFriction: 0.3,
    confidence: 0.9,
  });

  it("maximizes fun only inside the time envelope", () => {
    const selected = selectFunWithinDetour(
      [
        {
          id: "fast",
          durationSeconds: 600,
          distanceMeters: 10_000,
          score: mixedScore,
        },
        {
          id: "inside",
          durationSeconds: 720,
          distanceMeters: 12_000,
          score: funScore,
        },
        {
          id: "outside",
          durationSeconds: 900,
          distanceMeters: 13_000,
          score: funScore,
          funSignals: { mappedGravelAffinity: 1 },
        },
      ],
      0.25,
    );

    expect(selected?.id).toBe("inside");
    expect(selected?.detourPct).toBeCloseTo(0.2, 4);
  });

  it("returns null when only unknown/not-fun candidates fit", () => {
    const selected = selectFunWithinDetour(
      [
        {
          id: "unknown",
          durationSeconds: 600,
          distanceMeters: 10_000,
          score: routeScore({ curvature: 0.9 }),
        },
      ],
      0.25,
    );

    expect(selected).toBeNull();
  });

  it("breaks exact ties deterministically by duration, distance and id", () => {
    const selected = selectFunWithinDetour(
      [
        {
          id: "b",
          durationSeconds: 700,
          distanceMeters: 12_000,
          score: funScore,
        },
        {
          id: "a",
          durationSeconds: 700,
          distanceMeters: 12_000,
          score: funScore,
        },
        {
          id: "fast",
          durationSeconds: 600,
          distanceMeters: 10_000,
          score: mixedScore,
        },
      ],
      0.25,
    );

    expect(selected?.id).toBe("a");
  });
});
