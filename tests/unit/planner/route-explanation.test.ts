/**
 * `buildRouteExplanation` (04-PLANNER-AND-WORKSPACE-UX §13, 06 §9–§10,
 * 07 §2/§5; Wave-3 task 3.4).
 *
 * The explanation is a pure projection of structured evidence, so every
 * sentence is asserted against the input that produced it: the headline states
 * the measured trade against the fastest reference, the bullets are the
 * evidence ledger (what is measured, what is unknown, and where the number came
 * from), and an unknown never becomes a claim. Same input, byte-identical
 * output is a contract here, not an aspiration.
 */

import { describe, expect, it } from "vitest";

import {
  EXPLANATION_MATERIALITY,
  MAX_HEADLINE_BENEFITS,
  buildRouteExplanation,
} from "@/application/planner/route-explanation";
import { unknownEvidence } from "@/domain/evidence/types";
import type { EvidenceSource } from "@/domain/evidence/types";
import { asGeometryRef } from "@/domain/ride/ids";
import { defaultRideIntent } from "@/domain/ride/create";
import type { RideIntent, RoadCharacterIntent } from "@/domain/ride/types";
import { asRouteCandidateId } from "@/domain/route/ids";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import type {
  RouteCandidate,
  RouteScoreComponents,
  ScoreComponent,
} from "@/domain/route/types";

const POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;
const BEST = asRouteCandidateId("route_best");
const FAST = asRouteCandidateId("route_fast");

/** The mock surface source `knownEvidence` needs; weight 1.0 as `official`. */
const SURFACE_SOURCE: EvidenceSource = {
  id: "official",
  label: "State survey",
  category: "survey",
};

/**
 * The §19 component set with every metric unmeasured — the honest shape of a
 * candidate no evidence source has reached yet (Wave 3's default).
 */
function unmeasuredComponents(): RouteScoreComponents {
  const unmeasured = (): ScoreComponent => ({
    input: null,
    weight: 0,
    contribution: 0,
    explanationKey: "unscored.component",
    evidenceStatus: "unknown",
  });
  return {
    curvature: unmeasured(),
    backroad: unmeasured(),
    surfaceFit: unmeasured(),
    elevation: unmeasured(),
    traffic: unmeasured(),
    junctionFriction: unmeasured(),
    novelty: unmeasured(),
    closureRisk: unmeasured(),
    timeCost: unmeasured(),
    confidence: unmeasured(),
  };
}

/** One measured component; the weight is irrelevant to the explanation. */
function measured(input: number, explanationKey = "score.component.evidence"): ScoreComponent {
  return { input, weight: 0.1, contribution: input * 10, explanationKey, evidenceStatus: "estimated" };
}

function scoreWith(overrides: Partial<RouteScoreComponents>): RouteCandidate["score"] {
  return {
    policyVersion: POLICY.version,
    total: 42,
    components: { ...unmeasuredComponents(), ...overrides },
  };
}

interface CandidateOptions {
  readonly id?: RouteCandidate["id"];
  readonly distanceMeters?: number;
  readonly durationSeconds?: number;
  readonly components?: Partial<RouteScoreComponents>;
  readonly evidence?: RouteCandidate["evidence"];
}

function candidate(options: CandidateOptions = {}): RouteCandidate {
  const id = options.id ?? BEST;
  return {
    id,
    provider: { providerId: "graphhopper", profile: "motorcycle_fastest" },
    geometryRef: asGeometryRef(`geo_${id}`),
    distanceMeters: options.distanceMeters ?? 125_529,
    durationSeconds: options.durationSeconds ?? 6_480,
    eligibility: { eligible: true, failures: [] },
    evidence: options.evidence ?? {},
    score: scoreWith(options.components ?? {}),
    warnings: [],
    fingerprint: `fp_${id}`,
  };
}

function intent(roadCharacter?: RoadCharacterIntent): RideIntent {
  return { ...defaultRideIntent(), roadCharacter: roadCharacter ?? "balanced" };
}

function explain(input: {
  readonly candidate?: RouteCandidate;
  readonly fastest?: RouteCandidate | null;
  readonly addedMinutes?: number;
  readonly intent?: RideIntent;
}): ReturnType<typeof buildRouteExplanation> {
  const fastest = input.fastest ?? null;
  return buildRouteExplanation({
    candidate: input.candidate ?? candidate(),
    intent: input.intent ?? intent(),
    policy: POLICY,
    fastest:
      fastest === null
        ? null
        : { candidate: fastest, addedMinutes: input.addedMinutes ?? 11 },
  });
}

function bulletKeys(explanation: ReturnType<typeof buildRouteExplanation>): string[] {
  return explanation.bullets.map((bullet) => bullet.key);
}

function bulletText(explanation: ReturnType<typeof buildRouteExplanation>, key: string): string {
  const bullet = explanation.bullets.find((entry) => entry.key === key);
  if (bullet === undefined) throw new Error(`no bullet for ${key}`);
  return bullet.text;
}

describe("buildRouteExplanation — the headline states the measured trade", () => {
  it("leads with the added time and the component the rider buys with it", () => {
    const explanation = explain({
      candidate: candidate({ components: { curvature: measured(0.6) } }),
      fastest: candidate({ id: FAST, components: { curvature: measured(0.3) } }),
      addedMinutes: 11,
    });

    expect(explanation.headline).toBe("Adds 11 minutes for a curvier line.");
  });

  it("names the cost axes the faster route wins on, not the route's own score", () => {
    const explanation = explain({
      candidate: candidate({
        components: { curvature: measured(0.6), traffic: measured(0.2) },
      }),
      fastest: candidate({
        id: FAST,
        components: { curvature: measured(0.3), traffic: measured(0.8) },
      }),
      addedMinutes: 11,
      // A `curvy` rider's weights notice the curve before the traffic saving.
      intent: intent("curvy"),
    });

    expect(explanation.headline).toBe(
      "Adds 11 minutes for a curvier line and lower traffic.",
    );
  });

  it("caps the headline at two benefits, ordered by the rider's character", () => {
    const components: Partial<RouteScoreComponents> = {
      curvature: measured(0.6),
      traffic: measured(0.2),
      junctionFriction: measured(0.1),
    };
    const fastComponents: Partial<RouteScoreComponents> = {
      curvature: measured(0.3),
      traffic: measured(0.8),
      junctionFriction: measured(0.9),
    };

    // `efficient` weights traffic (0.20) and junction friction (0.18) above
    // curvature (0.05), so the two cost axes are the headline and the curve is
    // the benefit that does not fit.
    const explanation = explain({
      candidate: candidate({ components }),
      fastest: candidate({ id: FAST, components: fastComponents }),
      intent: intent("efficient"),
    });

    expect(EXPLANATION_MATERIALITY).toBeLessThan(0.2);
    expect(MAX_HEADLINE_BENEFITS).toBe(2);
    expect(explanation.headline).toBe(
      "Adds 11 minutes for lower traffic and fewer junctions.",
    );
  });

  it("keeps a sub-material improvement out of the headline", () => {
    const explanation = explain({
      candidate: candidate({
        components: { curvature: measured(0.30 + EXPLANATION_MATERIALITY / 2) },
      }),
      fastest: candidate({ id: FAST, components: { curvature: measured(0.3) } }),
      addedMinutes: 11,
    });

    expect(explanation.headline).toBe("Adds 11 minutes over the fastest option.");
  });

  it("credits an improvement exactly at the materiality margin", () => {
    const explanation = explain({
      candidate: candidate({
        components: { curvature: measured(0.3 + EXPLANATION_MATERIALITY) },
      }),
      fastest: candidate({ id: FAST, components: { curvature: measured(0.3) } }),
      addedMinutes: 11,
    });

    expect(explanation.headline).toBe("Adds 11 minutes for a curvier line.");
  });

  it("adds the distance the detour costs when it is longer", () => {
    const explanation = explain({
      candidate: candidate({
        distanceMeters: 140_000,
        components: { curvature: measured(0.6) },
      }),
      fastest: candidate({
        id: FAST,
        distanceMeters: 125_000,
        components: { curvature: measured(0.3) },
      }),
      addedMinutes: 11,
    });

    expect(explanation.headline).toBe(
      "Adds 11 minutes and 9.3 mi more for a curvier line.",
    );
  });

  it("never claims more miles when the candidate is shorter", () => {
    const explanation = explain({
      candidate: candidate({ distanceMeters: 120_000 }),
      fastest: candidate({ id: FAST, distanceMeters: 125_000 }),
      addedMinutes: 11,
    });

    expect(explanation.headline).toBe("Adds 11 minutes over the fastest option.");
  });

  it("says it matches the fastest option when the detour is zero", () => {
    const explanation = explain({
      fastest: candidate({ id: FAST, durationSeconds: 6_480 }),
      addedMinutes: 0,
    });

    expect(explanation.headline).toBe("Matches the fastest option in time.");
    expect(explanation.headline).not.toMatch(/adds/i);
  });

  it("states the absence of a comparison instead of inventing one", () => {
    const explanation = explain({ fastest: null });

    expect(explanation.headline).toBe(
      "No faster route to compare this ride against.",
    );
    expect(explanation.bullets.map((bullet) => bullet.text).join(" ")).not.toMatch(
      /minute/i,
    );
  });
});

describe("buildRouteExplanation — bullets are an evidence ledger", () => {
  it("says the surface mileage is unverified when no surface evidence exists", () => {
    const explanation = explain({
      candidate: candidate({
        distanceMeters: 125_529,
        evidence: { surfaceMix: unknownEvidence("no surface source yet") },
      }),
      fastest: candidate({ id: FAST }),
    });

    expect(bulletKeys(explanation)).toContain("surface.coverage");
    const bullet = explanation.bullets.find((entry) => entry.key === "surface.coverage");
    expect(bullet?.text).toBe("Surface is unverified on 78 mi of this route.");
    expect(bullet?.evidenceStatus).toBe("unknown");
  });

  it("reports only the uncovered share when part of the route is verified", () => {
    const explanation = explain({
      candidate: candidate({
        distanceMeters: 128_747.52,
        evidence: {
          surfaceMix: {
            value: "gravel",
            status: "known",
            confidence: 0.9,
            coverage: 0.75,
            provenance: [SURFACE_SOURCE],
          },
        },
      }),
      fastest: candidate({ id: FAST }),
    });

    const bullet = explanation.bullets.find((entry) => entry.key === "surface.coverage");
    expect(bullet?.text).toBe("Surface is unverified on 20 mi of this route.");
    expect(bullet?.evidenceStatus).toBe("known");
  });

  it("says the verified share is not measured when the evidence states no coverage", () => {
    const explanation = explain({
      candidate: candidate({
        distanceMeters: 128_747.52,
        evidence: {
          surfaceMix: {
            value: "gravel",
            status: "known",
            confidence: 0.9,
            provenance: [SURFACE_SOURCE],
          },
        },
      }),
      fastest: candidate({ id: FAST }),
    });

    const bullet = explanation.bullets.find((entry) => entry.key === "surface.coverage");
    expect(bullet?.text).toBe(
      "How much of this route's surface is verified is not measured.",
    );
  });

  it("claims no delay when traffic evidence is unknown", () => {
    const explanation = explain({ fastest: candidate({ id: FAST }) });

    const traffic = explanation.bullets.find((entry) => entry.key === "component.traffic");
    expect(traffic?.text).toBe("Traffic is unknown for this route, so no delay is claimed.");
    expect(traffic?.evidenceStatus).toBe("unknown");
    expect(explanation.bullets.map((entry) => entry.text).join(" ")).not.toMatch(
      /delay is (?:short|long|\d)/i,
    );
  });

  it("replaces the traffic caveat with the measurement once traffic is measured", () => {
    const explanation = explain({
      candidate: candidate({ components: { traffic: measured(0.2) } }),
      fastest: candidate({ id: FAST }),
    });

    expect(bulletText(explanation, "component.traffic")).toBe(
      "Traffic cost is measured for this route.",
    );
  });

  it("states an unknown closure risk explicitly", () => {
    const explanation = explain({ fastest: candidate({ id: FAST }) });

    const closure = explanation.bullets.find(
      (entry) => entry.key === "component.closureRisk",
    );
    expect(closure?.text).toBe("Closure risk is unknown for this route.");
    expect(closure?.evidenceStatus).toBe("unknown");
  });

  it("names the geometry proxy as the curvature source and omits it when unmeasured", () => {
    const measuredExplanation = explain({
      candidate: candidate({
        components: {
          curvature: measured(0.6, "score.curvature.smoothed-geometry-proxy"),
        },
      }),
      fastest: candidate({ id: FAST }),
    });

    expect(bulletText(measuredExplanation, "component.curvature")).toBe(
      "Curvature is estimated from the returned route line, not from mapped road data.",
    );

    const unmeasuredExplanation = explain({ fastest: candidate({ id: FAST }) });
    expect(bulletKeys(unmeasuredExplanation)).not.toContain("component.curvature");
  });

  it("summarizes evidence coverage, and says so when there is none", () => {
    const none = explain({ fastest: candidate({ id: FAST }) });
    expect(bulletText(none, "component.confidence")).toBe(
      "No road-metric evidence is available for this route yet.",
    );

    const some = explain({
      candidate: candidate({ components: { confidence: measured(0.4) } }),
      fastest: candidate({ id: FAST }),
    });
    expect(bulletText(some, "component.confidence")).toBe(
      "Ride evidence covers 40% of the tracked road metrics.",
    );
  });

  it("keeps every bullet tied to a stable key and a real evidence status", () => {
    const explanation = explain({
      candidate: candidate({
        components: {
          curvature: measured(0.6, "score.curvature.smoothed-geometry-proxy"),
          surfaceFit: measured(0.5),
          elevation: measured(0.7),
          novelty: measured(0.3),
          junctionFriction: measured(0.4),
          backroad: measured(0.2),
        },
      }),
      fastest: candidate({ id: FAST }),
    });

    const keys = bulletKeys(explanation);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      "component.confidence",
      "surface.coverage",
      "component.curvature",
      "component.backroad",
      "component.surfaceFit",
      "component.elevation",
      "component.traffic",
      "component.junctionFriction",
      "component.novelty",
      "component.closureRisk",
    ]);
    for (const bullet of explanation.bullets) {
      expect(["known", "estimated", "unknown", "unavailable", "stale"]).toContain(
        bullet.evidenceStatus,
      );
      expect(bullet.text.length).toBeGreaterThan(0);
    }
  });
});

describe("buildRouteExplanation — the truth rule", () => {
  it("never names a provider or exposes a raw score", () => {
    const explanation = explain({
      candidate: candidate({
        components: { curvature: measured(0.6) },
      }),
      fastest: candidate({ id: FAST, components: { curvature: measured(0.3) } }),
    });

    // `total: 42` and every provider id are structured inputs, never copy.
    const copy = [explanation.headline, ...explanation.bullets.map((entry) => entry.text)].join(
      " | ",
    );
    expect(copy).not.toMatch(/graphhopper|valhalla|tomtom|router/i);
    expect(copy).not.toContain("42");
    expect(copy).not.toMatch(/\bscore\b/i);
  });

  it("is deterministic: the same input produces byte-identical output", () => {
    const input = {
      candidate: candidate({ components: { curvature: measured(0.6) } }),
      intent: intent("curvy"),
      policy: POLICY,
      fastest: { candidate: candidate({ id: FAST }), addedMinutes: 11 },
    };

    const first = buildRouteExplanation(input);
    const second = buildRouteExplanation(input);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.bullets)).toBe(true);
  });

  it("fails closed on a policy it cannot read", () => {
    expect(() =>
      buildRouteExplanation({
        candidate: candidate(),
        intent: intent(),
        policy: { version: "broken" } as unknown as typeof POLICY,
        fastest: null,
      }),
    ).toThrow(TypeError);
  });
});
