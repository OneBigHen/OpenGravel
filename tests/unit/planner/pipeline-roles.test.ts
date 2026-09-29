/**
 * End-to-end candidate pipeline with diversity and roles
 * (Wave 3 Tasks 3.2/3.3, 06-ROUTING-AND-DECISION-ENGINE §7–§15).
 *
 * This is the integration contract between the three new stages: hard
 * eligibility → scoring → diversity → roles. A near-duplicate never reaches a
 * rider-visible card, every assigned role names a candidate that survived, the
 * automatic selection follows the best ride (the fastest reference always
 * exists), and the added time is measured against the same-constraint eligible
 * set rather than against a route the rider's constraints forbade.
 */

import { describe, expect, it } from "vitest";

import { runCandidatePipeline } from "@/application/planner/pipeline";
import type { ProviderCandidate } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "@/domain/route/policy";
import { addedMinutesVsFastest, bindRoles } from "@/domain/route/roles";
import { asRouteCandidateId } from "@/domain/route/ids";

const POLICY = PA_NJ_ROUTE_POLICY_VNEXT_1;

/** A gentle wiggle, so the curve metrics are real geometry, not noise. */
function wigglyLine(offset: number): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let index = 0; index <= 20; index += 1) {
    coordinates.push({
      lon: -75.2 + index * 0.02 + offset,
      lat: 40 + Math.sin(index / 2) * 0.004,
    });
  }
  return coordinates;
}

function straightLine(northOffset: number): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let index = 0; index <= 10; index += 1) {
    coordinates.push({ lon: -75.2 + index * 0.04, lat: 40 + northOffset });
  }
  return coordinates;
}

function providerCandidate(input: {
  readonly profile: string;
  readonly fingerprint: string;
  readonly geometry: readonly Coordinate[];
  readonly durationSeconds: number;
  readonly distanceMeters: number;
}): ProviderCandidate {
  return {
    providerId: "stub-router",
    profile: input.profile,
    geometry: input.geometry,
    distanceMeters: input.distanceMeters,
    durationSeconds: input.durationSeconds,
    providerMetadata: { fingerprint: input.fingerprint },
  };
}

function run(candidates: readonly ProviderCandidate[]) {
  return runCandidatePipeline({
    candidates,
    intent: {},
    policy: POLICY,
  });
}

const CURVY = providerCandidate({
  profile: "motorcycle_twisty",
  fingerprint: "fp_curvy",
  geometry: wigglyLine(0),
  durationSeconds: 1_000,
  distanceMeters: 12_000,
});
const FAST = providerCandidate({
  profile: "motorcycle_fastest",
  fingerprint: "fp_fast",
  geometry: straightLine(0),
  durationSeconds: 700,
  distanceMeters: 10_000,
});
/** The same line as `FAST`, produced by a different lane: a near-duplicate. */
const DUPLICATE = providerCandidate({
  profile: "motorcycle_adventure",
  fingerprint: "fp_duplicate",
  geometry: straightLine(0),
  durationSeconds: 700,
  distanceMeters: 10_000,
});
const OTHER_CORRIDOR = providerCandidate({
  profile: "motorcycle_scenic",
  fingerprint: "fp_other",
  geometry: straightLine(0.04),
  durationSeconds: 820,
  distanceMeters: 11_000,
});

describe("runCandidatePipeline — diversity", () => {
  it("drops a near-duplicate and explains it instead of showing it twice", () => {
    const result = run([CURVY, FAST, DUPLICATE, OTHER_CORRIDOR]);

    expect(result.candidates.map((entry) => entry.fingerprint).sort()).toEqual([
      "fp_curvy",
      "fp_fast",
      "fp_other",
    ]);
    const dropped = result.diagnostics.filter(
      (entry) => entry.code === "near-duplicate",
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({
      stage: "diversity",
      candidateIndex: 2,
      providerId: "stub-router",
      similarity: 1,
    });
  });

  it("caps the visible set at the product's three choices", () => {
    const result = run([
      CURVY,
      FAST,
      OTHER_CORRIDOR,
      providerCandidate({
        profile: "motorcycle_scenic",
        fingerprint: "fp_fourth",
        geometry: straightLine(0.08),
        durationSeconds: 900,
        distanceMeters: 12_500,
      }),
    ]);

    expect(result.candidates).toHaveLength(3);
    expect(
      result.diagnostics.filter((entry) => entry.code === "over-limit"),
    ).toHaveLength(1);
  });

  it("keeps two candidates from the same profile when their corridors differ", () => {
    const sameProfile = providerCandidate({
      profile: "motorcycle_adventure",
      fingerprint: "fp_same_profile",
      geometry: straightLine(0.04),
      durationSeconds: 830,
      distanceMeters: 11_100,
    });

    const result = run([FAST, sameProfile]);

    expect(result.candidates).toHaveLength(2);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("runCandidatePipeline — roles", () => {
  it("assigns roles only to surviving candidates and selects the best ride", () => {
    const result = run([CURVY, FAST, DUPLICATE, OTHER_CORRIDOR]);
    const kept = result.candidates.length;

    // `fastest` always exists, and every assigned role names a kept candidate.
    expect(result.roles.fastest).not.toBeNull();
    expect(result.selectedIndex).toBe(result.roles["best-ride"]);
    // The visible set is a ranking: the automatic selection is the first card.
    expect(result.selectedIndex).toBe(0);
    for (const index of Object.values(result.roles)) {
      if (index === null) continue;
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(kept);
    }

    // The selection is the highest score in the kept set, never the duplicate
    // the diversity stage removed.
    const selected = result.candidates[result.selectedIndex ?? -1];
    const best = result.candidates.reduce((winner, entry) =>
      entry.score.total > winner.score.total ? entry : winner,
    );
    expect(selected?.fingerprint).toBe(best.fingerprint);

    // The dropped duplicate cannot be named by any role: binding the index
    // roles to the kept candidates' own identities never yields its fingerprint.
    const bound = bindRoles(
      result.roles,
      result.candidates.map((entry) => ({
        id: asRouteCandidateId(entry.fingerprint),
      })),
    );
    expect(Object.values(bound)).not.toContain(
      asRouteCandidateId("fp_duplicate"),
    );
  });

  it("measures added time against the fastest surviving candidate", () => {
    const result = run([CURVY, FAST, DUPLICATE, OTHER_CORRIDOR]);
    const fastestIndex = result.roles.fastest;
    expect(fastestIndex).not.toBeNull();
    if (fastestIndex === null) return;
    const fastest = result.candidates[fastestIndex];
    const slow = result.candidates.find(
      (entry) => entry.fingerprint === "fp_curvy",
    );
    const middle = result.candidates.find(
      (entry) => entry.fingerprint === "fp_other",
    );
    if (fastest === undefined || slow === undefined || middle === undefined) {
      throw new Error("the test expected three kept candidates");
    }

    expect(fastest.durationSeconds).toBe(700);
    expect(addedMinutesVsFastest(fastest, fastest)).toBe(0);
    expect(addedMinutesVsFastest(slow, fastest)).toBe(5);
    expect(addedMinutesVsFastest(middle, fastest)).toBe(2);
  });

  it("binds index roles onto the identities the caller mints", () => {
    const result = run([CURVY, FAST]);
    const bound = bindRoles(
      result.roles,
      result.candidates.map((_, index) => ({
        id: asRouteCandidateId(`route_${index}`),
      })),
    );
    const fastestIndex = result.candidates.findIndex(
      (entry) => entry.durationSeconds === 700,
    );
    const bestIndex = result.candidates.findIndex(
      (entry) => entry.score.total === Math.max(...result.candidates.map((c) => c.score.total)),
    );

    expect(fastestIndex).toBeGreaterThanOrEqual(0);
    expect(bound.fastest).toBe(`route_${fastestIndex}`);
    expect(bound["best-ride"]).toBe(`route_${bestIndex}`);
  });

  it("is deterministic for the same provider answer", () => {
    const candidates = [CURVY, FAST, DUPLICATE, OTHER_CORRIDOR];

    expect(run(candidates)).toEqual(run(candidates));
  });
});
