import { describe, expect, it } from "vitest";

import { preferenceVectorFromRoute } from "@/application/personalization/route-features";
import type { EvidenceStatus } from "@/domain/evidence/types";
import type { RouteEvidence, RouteScore, ScoreComponent } from "@/domain/route/types";

type ComponentKey = keyof RouteScore["components"];

function component(input: number | null, evidenceStatus?: EvidenceStatus): ScoreComponent {
  return {
    input,
    weight: 0.1,
    contribution: 0,
    explanationKey: "test",
    evidenceStatus: evidenceStatus ?? (input === null ? "unknown" : "estimated"),
  };
}

function score(
  surfaceFit: number,
  statuses: Partial<Record<ComponentKey, EvidenceStatus>> = {},
): RouteScore {
  return {
    policyVersion: "test",
    total: 50,
    components: {
      curvature: component(0.8, statuses.curvature),
      backroad: component(0.7, statuses.backroad),
      surfaceFit: component(surfaceFit, statuses.surfaceFit),
      elevation: component(0.4, statuses.elevation),
      traffic: component(0.2, statuses.traffic),
      junctionFriction: component(0.25, statuses.junctionFriction),
      novelty: component(0.6, statuses.novelty),
      closureRisk: component(null, statuses.closureRisk),
      timeCost: component(0.3, statuses.timeCost),
      confidence: component(0.9, statuses.confidence),
    },
  };
}

const SURFACE_SOURCE = {
  id: "osm",
  label: "OpenStreetMap",
  category: "osm" as const,
};

function evidence(
  options: {
    readonly status?: EvidenceStatus;
    readonly coverage?: number;
    readonly value?: Record<string, unknown>;
  } = {},
): RouteEvidence {
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
        ...options.value,
      },
      status: options.status ?? "estimated",
      confidence: 0.8,
      ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
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

  it.each(["known", "estimated"] as const)(
    "accepts complete surface accounting with %s evidence",
    (status) => {
      expect(
        preferenceVectorFromRoute(score(1), evidence({ status, coverage: 1 })).unpaved,
      ).toBeCloseTo(0.25);
    },
  );

  it.each(["unknown", "unavailable", "stale"] as const)(
    "does not learn surface from %s evidence even when the payload is finite",
    (status) => {
      expect(preferenceVectorFromRoute(score(1), evidence({ status })).unpaved).toBeNull();
    },
  );

  it.each([
    ["missing unknown accounting", { unknownMeters: undefined }],
    ["known unknown distance", { unknownMeters: 9_900 }],
    ["partial coverage", {}],
  ] as const)("keeps %s surface evidence unknown", (_label, value) => {
    const options = _label === "partial coverage"
      ? { coverage: 0.75 }
      : { value };
    expect(preferenceVectorFromRoute(score(1), evidence(options))).toMatchObject({ unpaved: null });
  });

  it.each(["unknown", "unavailable", "stale"] as const)(
    "does not learn finite route components when their evidence is %s",
    (status) => {
      const statuses: Partial<Record<ComponentKey, EvidenceStatus>> = {
        curvature: status,
        backroad: status,
        elevation: status,
        traffic: status,
        junctionFriction: status,
        novelty: status,
        timeCost: status,
      };
      const vector = preferenceVectorFromRoute(score(0.5, statuses), evidence());

      expect(vector.curvature).toBeNull();
      expect(vector.backroad).toBeNull();
      expect(vector.elevation).toBeNull();
      expect(vector.trafficCalm).toBeNull();
      expect(vector.junctionFlow).toBeNull();
      expect(vector.novelty).toBeNull();
      expect(vector.timeEfficiency).toBeNull();
    },
  );

  it("normalizes cost axes so larger means calmer / smoother / more efficient", () => {
    const vector = preferenceVectorFromRoute(score(0.5), evidence());
    expect(vector.trafficCalm).toBeCloseTo(0.8);
    expect(vector.junctionFlow).toBeCloseTo(0.75);
    expect(vector.timeEfficiency).toBeCloseTo(0.7);
  });
});
