/**
 * Candidate diversity and near-duplicate rejection
 * (Wave 3 Task 3.2, 06-ROUTING-AND-DECISION-ENGINE §14).
 *
 * Ported from the legacy `tests/unit/route-diversity.test.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`). The
 * algorithms are kept; the modes are not. The legacy module could compare
 * *canonical directed segments* when road intelligence had resolved them, and
 * fell back to a geometry proxy when it had not. VNext has no canonical
 * segment store yet (that is Wave 6), so every comparison here is the
 * geometry proxy, and the mode is reported so no caller can mistake the proxy
 * for segment truth.
 */

import { describe, expect, it } from "vitest";

import type { Coordinate } from "@/domain/ride/types";
import {
  rankDiverseCandidates,
  routeSimilarity,
  type DiversityRoute,
} from "@/domain/route/diversity";
import { asRouteCandidateId, type RouteCandidateId } from "@/domain/route/ids";

const ID_A = asRouteCandidateId("route_a");
const ID_B = asRouteCandidateId("route_b");
const ID_C = asRouteCandidateId("route_c");
const ID_D = asRouteCandidateId("route_d");

/** A straight ~8.5 km line, `latOffset` degrees north of the baseline. */
function straightLine(latOffset = 0): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let index = 0; index <= 10; index += 1) {
    coordinates.push({ lon: -75.5 + index * 0.01, lat: 40 + latOffset });
  }
  return coordinates;
}

/** Western half shared with {@link straightLine}, eastern half 2 km north. */
function halfSharedLine(): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (let index = 0; index <= 5; index += 1) {
    coordinates.push({ lon: -75.5 + index * 0.01, lat: 40 });
  }
  for (let index = 6; index <= 10; index += 1) {
    coordinates.push({ lon: -75.5 + index * 0.01, lat: 40 + (index - 5) * 0.004 });
  }
  return coordinates;
}

function route(
  id: RouteCandidateId,
  total: number,
  geometry: readonly Coordinate[],
  profile = "motorcycle_fastest",
  facts: Partial<Pick<DiversityRoute<RouteCandidateId>,
    "distanceMeters" | "durationSeconds" | "surfaceMix">> = {},
): DiversityRoute<RouteCandidateId> {
  return { id, score: { total }, geometry, profile, ...facts };
}

const OPTIONS = { maxResults: 3, similarityThreshold: 0.85 };

describe("routeSimilarity", () => {
  it("measures the geometry-proxy overlap of identical and separate corridors", () => {
    expect(routeSimilarity(route(ID_A, 90, straightLine()), route(ID_B, 90, straightLine()))).toEqual({
      mode: "geometry-proxy",
      overlap: 1,
    });
    expect(
      routeSimilarity(route(ID_A, 90, straightLine()), route(ID_B, 90, straightLine(0.03))).overlap,
    ).toBe(0);
  });

  it("measures a partially shared corridor as the sampled share", () => {
    const similarity = routeSimilarity(
      route(ID_A, 90, straightLine()),
      route(ID_B, 90, halfSharedLine()),
    );

    expect(similarity.mode).toBe("geometry-proxy");
    expect(similarity.overlap).toBeCloseTo(0.5, 1);
  });

  it("labels an unmeasurable comparison as unknown instead of claiming an overlap", () => {
    expect(routeSimilarity(route(ID_A, 90, []), route(ID_B, 90, straightLine()))).toEqual({
      mode: "unknown",
      overlap: 0,
    });
    expect(
      routeSimilarity(
        route(ID_A, 90, [{ lon: -75.5, lat: 40 }]),
        route(ID_B, 90, straightLine()),
      ),
    ).toEqual({ mode: "unknown", overlap: 0 });
  });

  it("uses known surface, duration, and distance differences beside corridor overlap", () => {
    const first = route(ID_A, 90, straightLine(), "motorcycle_fastest", {
      distanceMeters: 10_000,
      durationSeconds: 600,
      surfaceMix: 0.1,
    });
    const second = route(ID_B, 85, straightLine(0.0005), "motorcycle_fastest", {
      distanceMeters: 13_000,
      durationSeconds: 900,
      surfaceMix: 0.8,
    });

    const similarity = routeSimilarity(first, second);
    expect(similarity.mode).toBe("multi-factor-proxy");
    expect(similarity.overlap).toBeLessThanOrEqual(OPTIONS.similarityThreshold);
    expect(rankDiverseCandidates([first, second], OPTIONS).ranked).toHaveLength(2);
  });
});

describe("rankDiverseCandidates", () => {
  it("rejects a near-duplicate even when its score is higher", () => {
    const same = route(ID_A, 90, straightLine());
    const near = route(ID_B, 95, straightLine(0.0005));
    const far = route(ID_C, 80, straightLine(0.03));

    const ranking = rankDiverseCandidates([near, same, far], OPTIONS);

    expect(ranking.ranked.map((entry) => entry.route.id)).toEqual([ID_B, ID_C]);
    expect(ranking.dropped).toHaveLength(1);
    expect(ranking.dropped[0]?.route.id).toBe(ID_A);
    expect(ranking.dropped[0]?.reason).toBe("near-duplicate");
    expect(ranking.dropped[0]?.similarToId).toBe(ID_B);
    expect(ranking.dropped[0]?.overlap).toBe(1);
  });

  it("keeps two same-profile routes that are geographically distinct", () => {
    const first = route(ID_A, 90, straightLine(), "motorcycle_twisty");
    const second = route(ID_B, 80, straightLine(0.03), "motorcycle_twisty");

    const ranking = rankDiverseCandidates([first, second], OPTIONS);

    expect(ranking.ranked.map((entry) => entry.route.id)).toEqual([ID_A, ID_B]);
    expect(ranking.dropped).toEqual([]);
  });

  it("still rejects identical geometry that two different profiles produced", () => {
    const first = route(ID_A, 90, straightLine(), "motorcycle_twisty");
    const second = route(ID_B, 85, straightLine(), "motorcycle_adventure");

    const ranking = rankDiverseCandidates([first, second], OPTIONS);

    expect(ranking.ranked.map((entry) => entry.route.id)).toEqual([ID_A]);
    expect(ranking.dropped[0]?.route.id).toBe(ID_B);
  });

  it("returns at most maxResults candidates and explains the rest", () => {
    const ranking = rankDiverseCandidates(
      [
        route(ID_A, 90, straightLine()),
        route(ID_B, 80, straightLine(0.03)),
        route(ID_C, 70, straightLine(0.06)),
        route(ID_D, 60, straightLine(0.09)),
      ],
      { maxResults: 2, similarityThreshold: 0.85 },
    );

    expect(ranking.ranked.map((entry) => entry.route.id)).toEqual([ID_A, ID_B]);
    expect(ranking.dropped.map((entry) => entry.reason)).toEqual([
      "max-results",
      "max-results",
    ]);
    expect(ranking.dropped.map((entry) => entry.route.id)).toEqual([ID_C, ID_D]);
  });

  it("treats an overlap exactly at the ceiling as a distinct route", () => {
    const identical = [route(ID_A, 90, straightLine()), route(ID_B, 85, straightLine())];

    expect(
      rankDiverseCandidates(identical, { maxResults: 3, similarityThreshold: 1 }).ranked.map(
        (entry) => entry.route.id,
      ),
    ).toEqual([ID_A, ID_B]);
    expect(
      rankDiverseCandidates(identical, { maxResults: 3, similarityThreshold: 0.99 }).dropped.map(
        (entry) => entry.route.id,
      ),
    ).toEqual([ID_B]);
  });

  it("balances utility and diversity through the MMR lambda", () => {
    const duplicated = route(ID_B, 85, straightLine());
    const distinct = route(ID_C, 60, straightLine(0.03));
    const candidates = [route(ID_A, 90, straightLine()), duplicated, distinct];
    const noDiversity = { maxResults: 3, similarityThreshold: 1, diversityLambda: 0 };
    const fullDiversity = { maxResults: 3, similarityThreshold: 1, diversityLambda: 1 };

    expect(
      rankDiverseCandidates(candidates, noDiversity).ranked.map((entry) => entry.route.id),
    ).toEqual([ID_A, ID_B, ID_C]);
    expect(
      rankDiverseCandidates(candidates, fullDiversity).ranked.map((entry) => entry.route.id),
    ).toEqual([ID_A, ID_C, ID_B]);
  });

  it("is deterministic and reports the similarity the decision used", () => {
    const candidates = [
      route(ID_A, 90, straightLine()),
      route(ID_B, 85, straightLine(0.0005)),
      route(ID_C, 70, straightLine(0.03)),
    ];

    const first = rankDiverseCandidates(candidates, OPTIONS);
    const second = rankDiverseCandidates(candidates, OPTIONS);

    expect(first).toEqual(second);
    // The survivor that had to be compared against a kept route carries the
    // similarity that decided it, not a recomputed guess.
    const compared = first.ranked.find((entry) => entry.route.id === ID_C);
    expect(compared?.maxSimilarity).toBe(0);
    expect(compared?.similarityMode).toBe("geometry-proxy");
  });

  it("fails closed on options that cannot be honored", () => {
    const candidates = [route(ID_A, 90, straightLine())];

    expect(() => rankDiverseCandidates(candidates, { maxResults: 0, similarityThreshold: 0.85 }))
      .toThrow(TypeError);
    expect(() =>
      rankDiverseCandidates(candidates, { maxResults: 1.5, similarityThreshold: 0.85 }),
    ).toThrow(TypeError);
    expect(() => rankDiverseCandidates(candidates, { maxResults: 3, similarityThreshold: 1.5 }))
      .toThrow(TypeError);
    expect(() =>
      rankDiverseCandidates(candidates, {
        maxResults: 3,
        similarityThreshold: 0.85,
        diversityLambda: 2,
      }),
    ).toThrow(TypeError);
  });

  it("returns nothing for an empty candidate set", () => {
    expect(rankDiverseCandidates([], OPTIONS)).toEqual({ ranked: [], dropped: [] });
  });
});
