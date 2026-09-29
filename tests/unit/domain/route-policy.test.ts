/**
 * Route policy: changes are versioned so existing scoring results stay reproducible.
 *
 * The policy is immutable and versioned: a numeric change is a new version, not
 * an edit, because a score is only reproducible together with the policy that
 * produced it (03-DOMAIN-MODEL §19).
 */

import { describe, expect, it } from "vitest";

import type { RoadCharacterIntent } from "@/domain/ride/types";
import type { RouteRole } from "@/domain/route/types";
import {
  isRoutePolicy,
  PA_NJ_ROUTE_POLICY_VNEXT_1,
  ROUTE_SCORE_COMPONENT_KEYS,
  type RoutePolicy,
} from "@/domain/route/policy";

const CHARACTERS: readonly RoadCharacterIntent[] = [
  "efficient",
  "balanced",
  "curvy",
  "backroads",
];

const ROLES: readonly RouteRole[] = [
  "best-ride",
  "fastest",
  "fast-and-fun",
  "more-twisties",
  "more-dirt",
  "lower-workload",
];

describe("PA_NJ_ROUTE_POLICY_VNEXT_1", () => {
  it("is a valid, versioned frozen policy", () => {
    expect(isRoutePolicy(PA_NJ_ROUTE_POLICY_VNEXT_1)).toBe(true);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.version).toBe("PA_NJ_ROUTE_POLICY_VNEXT_1");
    expect(Object.isFrozen(PA_NJ_ROUTE_POLICY_VNEXT_1)).toBe(true);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.territory).toBe("pa-nj");
  });

  it("keeps the legacy scalar policy values", () => {
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.preferredDetourPct).toBe(0.08);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.diversityLambda).toBe(0.35);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.duplicateSimilarityThreshold).toBe(0.85);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.maxAlternatives).toBe(2);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.timebox.roundTripDurationTolerance).toBe(0.15);
  });

  it("keeps the legacy weight values under the VNext component names", () => {
    // `twisty` → `curvy`: curvature 0.28 was the legacy `twistiness` weight.
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights.curvy.curvature).toBe(0.28);
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights.curvy.backroad).toBe(0.1);
    // `avoid-highways` → `backroads`.
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights.backroads.backroad).toBe(0.16);
    // `quick` → `efficient`.
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights.efficient.traffic).toBe(0.2);
  });

  it("has a complete, relational weight table", () => {
    for (const character of CHARACTERS) {
      const weights = PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights[character];
      const total = ROUTE_SCORE_COMPONENT_KEYS.reduce(
        (sum, key) => sum + weights[key],
        0,
      );
      expect(total).toBeCloseTo(1, 6);
      for (const key of ROUTE_SCORE_COMPONENT_KEYS) {
        expect(weights[key]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("gives every role a coherent detour envelope", () => {
    for (const role of ROLES) {
      const envelope = PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes[role];
      expect(envelope.preferredPct).toBeGreaterThanOrEqual(0);
      expect(envelope.preferredPct).toBeLessThanOrEqual(envelope.maximumPct);
      expect(envelope.maximumPct).toBeLessThanOrEqual(1);
    }
    // 06 §11: Fastest allows zero fun-driven detour; Best Ride is generous.
    expect(PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes.fastest.preferredPct).toBe(0);
    expect(
      PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes["best-ride"].maximumPct,
    ).toBeGreaterThan(
      PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes["fast-and-fun"].maximumPct,
    );
  });
});

describe("isRoutePolicy", () => {
  function invalid(overrides: Record<string, unknown>): unknown {
    return { ...PA_NJ_ROUTE_POLICY_VNEXT_1, ...overrides };
  }

  it.each([
    ["a bad version", invalid({ version: "" })],
    ["a foreign territory", invalid({ territory: "eu" })],
    ["too many alternatives", invalid({ maxAlternatives: 4 })],
    ["a negative detour preference", invalid({ preferredDetourPct: -0.1 })],
    ["a missing character", invalid({ characterWeights: {} })],
    ["a negative weight", invalid({
      characterWeights: {
        ...PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights,
        curvy: { ...PA_NJ_ROUTE_POLICY_VNEXT_1.characterWeights.curvy, curvature: -1 },
      },
    })],
    ["an inverted detour envelope", invalid({
      roleDetourEnvelopes: {
        ...PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes,
        "best-ride": { preferredPct: 0.5, maximumPct: 0.2 },
      },
    })],
    ["a missing role", invalid({
      roleDetourEnvelopes: {
        ...PA_NJ_ROUTE_POLICY_VNEXT_1.roleDetourEnvelopes,
        "more-dirt": undefined,
      },
    })],
    ["a non-object", 42],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isRoutePolicy(value as RoutePolicy)).toBe(false);
  });
});
