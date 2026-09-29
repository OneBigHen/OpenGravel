/**
 * Rider role assignment (Wave 3 Task 3.3, 03-DOMAIN-MODEL §16,
 * 06-ROUTING-AND-DECISION-ENGINE §11/§13/§15, VNX-006/VNX-007).
 *
 * A role is earned from candidate metrics, never from a provider label, and it
 * is never forced to fill the record. These tests pin the four properties that
 * make the record trustworthy: `fastest` always exists, `best-ride` is the best
 * score, a material role needs a material margin over the best ride, and no
 * candidate holds more than two roles.
 */

import { describe, expect, it } from "vitest";

import {
  PA_NJ_ROUTE_POLICY_VNEXT_1,
  ROLE_MATERIALITY_VNEXT_1,
} from "@/domain/route/policy";
import { asRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";
import {
  addedMinutesVsFastest,
  assignRoles,
  bindRoles,
  type RoleCandidate,
} from "@/domain/route/roles";
import type { RouteScore, ScoreComponent } from "@/domain/route/types";

const POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;

interface Metrics {
  readonly duration?: number;
  readonly distance?: number;
  readonly total?: number;
  /** `curvature` component input: the more-twisties / fast-and-fun metric. */
  readonly curvature?: number | null;
  /** `surfaceFit` component input: the more-dirt metric. */
  readonly surfaceFit?: number | null;
  /** `junctionFriction` component input: the lower-workload metric. */
  readonly junctionFriction?: number | null;
}

/** A component with a real input, or honestly unknown when the input is null. */
function metric(input: number | null, key: string): ScoreComponent {
  return {
    input,
    weight: 0,
    contribution: 0,
    explanationKey: `test.${key}`,
    evidenceStatus: input === null ? "unknown" : "estimated",
  };
}

function components(metrics: Metrics): RouteScore["components"] {
  return {
    curvature: metric(metrics.curvature ?? null, "curvature"),
    backroad: metric(null, "backroad"),
    surfaceFit: metric(metrics.surfaceFit ?? null, "surfaceFit"),
    elevation: metric(null, "elevation"),
    traffic: metric(null, "traffic"),
    junctionFriction: metric(metrics.junctionFriction ?? null, "junctionFriction"),
    novelty: metric(null, "novelty"),
    closureRisk: metric(null, "closureRisk"),
    timeCost: metric(null, "timeCost"),
    confidence: metric(null, "confidence"),
  };
}

function candidate(id: string, metrics: Metrics = {}): RoleCandidate<RouteCandidateId> {
  return {
    id: asRouteCandidateId(id),
    durationSeconds: metrics.duration ?? 1_800,
    distanceMeters: metrics.distance ?? 40_000,
    score: {
      policyVersion: "test-policy",
      total: metrics.total ?? 50,
      components: components(metrics),
    },
  };
}

describe("assignRoles — fastest and best-ride", () => {
  it("a best-ride filter (a loop's ride time) narrows best-ride but not fastest", () => {
    const short = candidate("route_short", { duration: 8_000, total: 90 });
    const fits = candidate("route_fits", { duration: 11_000, total: 60 });
    const inBox = (entry: RoleCandidate<RouteCandidateId>) => entry.durationSeconds > 9_000;

    const roles = assignRoles([short, fits], POLICY, undefined, inBox);
    expect(roles["best-ride"]).toBe("route_fits");
    expect(roles.fastest).toBe("route_short");

    // A filter nobody passes changes nothing.
    const unfiltered = assignRoles([short, fits], POLICY, undefined, () => false);
    expect(unfiltered["best-ride"]).toBe("route_short");
  });

  it("always assigns fastest when at least one candidate is eligible", () => {
    const roles = assignRoles([candidate("route_a", { duration: 900 })], POLICY);

    expect(roles.fastest).toBe("route_a");
    expect(roles["best-ride"]).toBe("route_a");
  });

  it("breaks a fastest tie by distance and then by stable id", () => {
    const roles = assignRoles(
      [
        candidate("route_b", { duration: 900, distance: 12_000 }),
        candidate("route_d", { duration: 900, distance: 9_000 }),
        candidate("route_a", { duration: 900, distance: 9_000 }),
        candidate("route_c", { duration: 1_200, distance: 5_000 }),
      ],
      POLICY,
    );

    expect(roles.fastest).toBe("route_a");
  });

  it("picks the highest score as best-ride, then surface fit, then duration", () => {
    const worseSurface = candidate("route_low", { total: 80, surfaceFit: 0.4 });
    const betterSurface = candidate("route_high", { total: 80, surfaceFit: 0.6 });
    const sameSurfaceFaster = candidate("route_faster", {
      total: 80,
      surfaceFit: 0.6,
      duration: 1_200,
    });

    expect(
      assignRoles([worseSurface, betterSurface], POLICY)["best-ride"],
    ).toBe("route_high");
    expect(
      assignRoles([betterSurface, sameSurfaceFaster], POLICY)["best-ride"],
    ).toBe("route_faster");
  });

  it("claims nothing for an empty eligible set", () => {
    expect(assignRoles([], POLICY)).toEqual({
      "best-ride": null,
      fastest: null,
      "fast-and-fun": null,
      "more-twisties": null,
      "more-dirt": null,
      "lower-workload": null,
    });
  });
});

describe("assignRoles — material roles are earned, never forced", () => {
  it("leaves every material role null when no candidate materially differs", () => {
    const roles = assignRoles(
      [
        candidate("route_a", { total: 90, curvature: 0.4, surfaceFit: 0.5, junctionFriction: 0.5 }),
        candidate("route_b", { total: 60, curvature: 0.4, surfaceFit: 0.5, junctionFriction: 0.5 }),
      ],
      POLICY,
    );

    expect(roles["best-ride"]).toBe("route_a");
    expect(roles.fastest).toBe("route_a");
    expect(roles["fast-and-fun"]).toBeNull();
    expect(roles["more-twisties"]).toBeNull();
    expect(roles["more-dirt"]).toBeNull();
    expect(roles["lower-workload"]).toBeNull();
  });

  it("needs the twistiness materiality margin over the best ride", () => {
    const bestRide = candidate("route_best", { total: 90, curvature: 0.4, duration: 600 });
    const atThreshold = candidate("route_even", { total: 60, curvature: 0.5, duration: 620 });
    const justUnder = candidate("route_under", {
      total: 60,
      curvature: 0.4 + ROLE_MATERIALITY_VNEXT_1.twistiness - 0.001,
      duration: 620,
    });

    expect(
      assignRoles([bestRide, atThreshold], POLICY)["more-twisties"],
    ).toBe("route_even");
    expect(assignRoles([bestRide, justUnder], POLICY)["more-twisties"]).toBeNull();
  });

  it("cannot claim more dirt without a surface measurement on both sides", () => {
    const unmeasuredBestRide = candidate("route_best", { total: 90, surfaceFit: null });
    const measured = candidate("route_dirt", { total: 60, surfaceFit: 0.9 });
    const measuredBestRide = candidate("route_best2", { total: 90, surfaceFit: 0.2 });
    const atThreshold = candidate("route_dirt2", {
      total: 60,
      surfaceFit: 0.2 + ROLE_MATERIALITY_VNEXT_1.surfaceFit,
    });

    expect(
      assignRoles([unmeasuredBestRide, measured], POLICY)["more-dirt"],
    ).toBeNull();
    expect(assignRoles([measuredBestRide, atThreshold], POLICY)["more-dirt"]).toBe(
      "route_dirt2",
    );
  });

  it("requires a materially lower workload for lower-workload", () => {
    const bestRide = candidate("route_best", { total: 90, junctionFriction: 0.5 });
    const calmer = candidate("route_calm", {
      total: 60,
      junctionFriction: 0.5 - ROLE_MATERIALITY_VNEXT_1.junctionFriction,
    });
    const barelyCalmer = candidate("route_almost", {
      total: 60,
      junctionFriction: 0.5 - ROLE_MATERIALITY_VNEXT_1.junctionFriction + 0.001,
    });

    expect(assignRoles([bestRide, calmer], POLICY)["lower-workload"]).toBe("route_calm");
    expect(assignRoles([bestRide, barelyCalmer], POLICY)["lower-workload"]).toBeNull();
  });

  it("requires the fast-and-fun time envelope as well as the margin", () => {
    const bestRide = candidate("route_best", { total: 90, curvature: 0.4, duration: 660 });
    const fastest = candidate("route_quick", { total: 70, curvature: 0.4, duration: 600 });
    const insideEnvelope = candidate("route_fun", {
      total: 60,
      curvature: 0.6,
      duration: 700,
    });
    const outsideEnvelope = candidate("route_slow", {
      total: 60,
      curvature: 0.6,
      duration: 900,
    });

    expect(
      assignRoles([bestRide, fastest, insideEnvelope], POLICY)["fast-and-fun"],
    ).toBe("route_fun");
    expect(
      assignRoles([bestRide, fastest, outsideEnvelope], POLICY)["fast-and-fun"],
    ).toBeNull();
  });

  it("lets a candidate hold at most two roles", () => {
    // The fastest candidate is also materially curvier than the best ride, so it
    // would qualify for `fast-and-fun` *and* `more-twisties` on top of
    // `fastest`. It may keep only two.
    const bestRide = candidate("route_best", { total: 90, curvature: 0.4, duration: 900 });
    const fastAndCurvy = candidate("route_fast", {
      total: 60,
      curvature: 0.7,
      duration: 600,
    });

    const roles = assignRoles([bestRide, fastAndCurvy], POLICY);

    expect(roles.fastest).toBe("route_fast");
    expect(roles["best-ride"]).toBe("route_best");
    expect(roles["fast-and-fun"]).toBe("route_fast");
    expect(roles["more-twisties"]).toBeNull();
    expect(roles["more-dirt"]).toBeNull();
    expect(roles["lower-workload"]).toBeNull();
  });

  it("does not spend a capped candidate's slot when another candidate qualifies", () => {
    const bestRide = candidate("route_best", { total: 90, curvature: 0.4, duration: 900 });
    const fastestCurvy = candidate("route_fast", {
      total: 60,
      curvature: 0.9,
      duration: 600,
    });
    const otherCurvy = candidate("route_curvy", {
      total: 55,
      curvature: 0.6,
      duration: 900,
    });

    const roles = assignRoles([bestRide, fastestCurvy, otherCurvy], POLICY);

    expect(roles.fastest).toBe("route_fast");
    expect(roles["fast-and-fun"]).toBe("route_fast");
    // `route_fast` holds two roles, so the twistiness claim goes to the next
    // candidate that materially beats the best ride instead of being dropped.
    expect(roles["more-twisties"]).toBe("route_curvy");
  });
});

describe("addedMinutesVsFastest", () => {
  const fastest = candidate("route_fast", { duration: 600 });
  const slower = candidate("route_slow", { duration: 1_200 });

  it("reports the added minutes against the same-constraint fastest reference", () => {
    expect(addedMinutesVsFastest(slower, fastest)).toBe(10);
    expect(addedMinutesVsFastest(fastest, fastest)).toBe(0);
  });

  it("is null when there is no fastest reference", () => {
    expect(addedMinutesVsFastest(slower, null)).toBeNull();
  });

  it("reports a negative delta when the reference is not actually the fastest", () => {
    expect(addedMinutesVsFastest(fastest, slower)).toBe(-10);
  });
});

describe("bindRoles", () => {
  const candidates = [
    { id: asRouteCandidateId("route_one") },
    { id: asRouteCandidateId("route_two") },
  ];

  it("maps index roles onto candidate identities", () => {
    const bound = bindRoles(
      {
        "best-ride": 1,
        fastest: 0,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      candidates,
    );

    expect(bound["best-ride"]).toBe("route_two");
    expect(bound.fastest).toBe("route_one");
    expect(bound["more-dirt"]).toBeNull();
  });

  it("fails closed on an index that names no candidate", () => {
    const bound = bindRoles(
      {
        "best-ride": 4,
        fastest: null,
        "fast-and-fun": null,
        "more-twisties": null,
        "more-dirt": null,
        "lower-workload": null,
      },
      candidates,
    );

    expect(bound["best-ride"]).toBeNull();
  });
});
