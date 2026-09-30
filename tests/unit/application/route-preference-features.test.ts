import { describe, expect, it } from "vitest";

import { preferenceVectorFromRoute } from "@/application/personalization/route-features";
import type { RouteEvidence, RouteScore, ScoreComponent } from "@/domain/route/types";

function component(input: number | null): ScoreComponent {
  return {
    input,
    weight: 0.1,
    contribution: 0,
    explanationKey: "test",
    evidenceStatus: input === null ? "unknown" : "estimated",
  };
}

function score(surfaceFit: number): RouteScore {
  return {
    policyVersion: "test",
    total: 50,
    components: {
      curvature: component(0.8),
      backroad: component(0.7),
      surfaceFit: component(surfaceFit),
      elevation: component(0.4),
      traffic: component(0.2),
      junctionFriction: component(0.25),
      novelty: component(0.6),
      closureRisk: component(null),
      timeCost: component(0.3),
      confidence: component(0.9),
    },
  };
}

const SURFACE_SOURCE = {
  id: "osm",
  label: "OpenStreetMap",
  category: "osm" as const,
};

function evidence(): RouteEvidence {
  return {
    surfaceMix: {
      value: {
        surface: "paved",
        pavedMeters: 7_500,
        inferredPavedMeters: 0,
        gravelMeters: 2_000,
        dirtMeters: 500,
        unknownMeters: 0,
        unit: 0.1,
      },
      status: "estimated",
      confidence: 0.8,
      provenance: [SURFACE_SOURCE],
    },
  };
}

describe("preferenceVectorFromRoute", () => {
  it("learns intrinsic unpaved share instead of today's surface-fit score", () => {
    const first = preferenceVectorFromRoute(score(0.05), evidence());
    const second = preferenceVectorFromRoute(score(0.95), evidence());

    expect(first.unpaved).toBeCloseTo(0.25);
    expect(second.unpaved).toBeCloseTo(0.25);
    expect(first.unpaved).toBe(second.unpaved);
  });

  it("keeps missing surface evidence unknown", () => {
    expect(preferenceVectorFromRoute(score(1), {}).unpaved).toBeNull();
  });

  it("normalizes cost axes so larger means calmer / smoother / more efficient", () => {
    const vector = preferenceVectorFromRoute(score(0.5), evidence());
    expect(vector.trafficCalm).toBeCloseTo(0.8);
    expect(vector.junctionFlow).toBeCloseTo(0.75);
    expect(vector.timeEfficiency).toBeCloseTo(0.7);
  });
});
