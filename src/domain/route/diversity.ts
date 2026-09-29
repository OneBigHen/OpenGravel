/**
 * Candidate diversity and near-duplicate rejection
 * (Wave 3 Task 3.2, 06-ROUTING-AND-DECISION-ENGINE §14, VNX-007).
 *
 * Ported from the legacy `src/lib/recommendation/route-diversity.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`). The
 * selection algorithm is kept — greedy maximal-marginal-relevance with a
 * strict similarity ceiling — and the types are adapted to VNext.
 *
 * ## The one deliberate substitution (`OGV-D-199`)
 *
 * The legacy module could compare **directed canonical segments** when road
 * intelligence had resolved them, and fell back to a **geometry proxy** when it
 * had not. VNext has no canonical segment store (that is Wave 6 material), so
 * every comparison starts with the geometry proxy: `calculateGeometryOverlap`
 * samples both lines every ~120 m and reports the symmetric share of samples
 * that sit within ~140 m of the other line. When both candidates also carry
 * measured duration, distance, or surface mix, those known differences reduce
 * similarity; absent metrics never fabricate a distinction. The mode is
 * reported so the caller cannot mistake either proxy for segment truth.
 * When Wave 6 lands, a `canonical-directed` mode is added *beside* it rather
 * than replacing the honest fallback.
 *
 * ## Why the selection is greedy rather than a single pass
 *
 * The legacy signature accepted an already-selected route set and scored the
 * rest against it once. VNext's pipeline has no pre-existing selection: the
 * stage's whole job is to choose. So the same MMR formula is applied
 * iteratively — each pick is measured against the routes already kept, a
 * candidate above the similarity ceiling is rejected outright, and the loop
 * stops at `maxResults`. The outcome is deterministic: ties break on the lower
 * similarity, then on the provider's arrival index, never on object identity.
 *
 * The candidate's `profile` is carried for diagnostics only. It is never read
 * by the similarity math or the ranking, which is what makes "same provider
 * profile" neither an advantage nor a disqualification (`06 §14`, VNX-007).
 */

import { calculateGeometryOverlap } from "../geometry/analysis";
import type { Coordinate } from "../ride/types";
import type { RouteCandidateId } from "./ids";
import { PA_NJ_ROUTE_POLICY_VNEXT_1 } from "./policy";

/** The declared evidence a similarity verdict is based on. */
export type SimilarityMode = "geometry-proxy" | "multi-factor-proxy" | "unknown";

/** How similar two candidates are, and on what evidence. */
export interface RouteSimilarity {
  readonly mode: SimilarityMode;
  /** Share 0–1 of the sampled corridor the two lines share. */
  readonly overlap: number;
}

/**
 * The route facts diversity reads. A structural subset of the domain
 * `RouteCandidate`: identity, the line itself, and the deterministic score the
 * utility comes from.
 */
export interface DiversityRoute<Id extends string | number = RouteCandidateId> {
  readonly id: Id;
  /** Full-resolution line, in travel order. */
  readonly geometry: readonly Coordinate[];
  /** The deterministic score (`06 §9`); its `total` is the MMR utility. */
  readonly score: { readonly total: number };
  readonly distanceMeters?: number;
  readonly durationSeconds?: number;
  /** Known normalized unpaved/surface-fit measure; absent remains unknown. */
  readonly surfaceMix?: number;
  /** Provider profile, diagnostics only — never a similarity input. */
  readonly profile?: string;
}

/** One survivor, with the numbers the decision used. */
export interface RankedCandidate<T extends DiversityRoute<string | number>> {
  readonly route: T;
  /** The provider's arrival index, so a caller can restore a stable order. */
  readonly index: number;
  readonly mmrScore: number;
  /** Highest overlap against any already-kept route. */
  readonly maxSimilarity: number;
  readonly similarityMode: SimilarityMode;
}

/** Why one candidate was not selected. */
export type DropReason = "near-duplicate" | "max-results";

/** One rejected candidate and the comparison that rejected it. */
export interface DroppedCandidate<T extends DiversityRoute<string | number>> {
  readonly route: T;
  readonly index: number;
  readonly reason: DropReason;
  readonly overlap: number;
  readonly similarToId: T["id"] | null;
}

/** The selection: survivors in pick order plus every rejection. */
export interface DiverseRanking<T extends DiversityRoute<string | number>> {
  readonly ranked: readonly RankedCandidate<T>[];
  readonly dropped: readonly DroppedCandidate<T>[];
}

export interface DiversityOptions {
  /** Maximum number of survivors (a positive integer). */
  readonly maxResults: number;
  /** Overlap at or below which two routes are distinct (`06 §14`). */
  readonly similarityThreshold: number;
  /** MMR trade-off in 0–1; the policy's `diversityLambda` by default. */
  readonly diversityLambda?: number;
}

/** Two points are the minimum a line comparison can use (`unknown` otherwise). */
const MIN_GEOMETRY_POINTS = 2;

function sameGeometry(
  first: readonly Coordinate[],
  second: readonly Coordinate[],
): boolean {
  return first.length === second.length && first.every((coordinate, index) => {
    const other = second[index];
    return other !== undefined && coordinate.lon === other.lon && coordinate.lat === other.lat;
  });
}

function relativeDifference(first: number | undefined, second: number | undefined): number | null {
  if (
    first === undefined ||
    second === undefined ||
    !Number.isFinite(first) ||
    !Number.isFinite(second) ||
    first < 0 ||
    second < 0
  ) {
    return null;
  }
  const scale = Math.max(first, second);
  return scale === 0 ? 0 : Math.min(1, Math.abs(first - second) / scale);
}

function surfaceDifference(first: number | undefined, second: number | undefined): number | null {
  if (!isUnitInterval(first) || !isUnitInterval(second)) return null;
  return Math.abs(first - second);
}

/**
 * Similarity of two candidates. `unknown` means the comparison could not be
 * made at all (a degenerate line), with `overlap: 0`: a missing measurement is
 * never reported as a measured difference.
 */
export function routeSimilarity<Id extends string | number>(
  first: DiversityRoute<Id>,
  second: DiversityRoute<Id>,
): RouteSimilarity {
  if (
    first.geometry.length >= MIN_GEOMETRY_POINTS &&
    second.geometry.length >= MIN_GEOMETRY_POINTS
  ) {
    const geometryOverlap = calculateGeometryOverlap(first.geometry, second.geometry) / 100;
    if (sameGeometry(first.geometry, second.geometry)) {
      return { mode: "geometry-proxy", overlap: geometryOverlap };
    }
    const differences = [
      relativeDifference(first.distanceMeters, second.distanceMeters),
      relativeDifference(first.durationSeconds, second.durationSeconds),
      surfaceDifference(first.surfaceMix, second.surfaceMix),
    ].filter((value): value is number => value !== null);
    const materialDifference = differences.length === 0 ? 0 : Math.max(...differences);
    return {
      mode: differences.length === 0 ? "geometry-proxy" : "multi-factor-proxy",
      overlap: Math.max(0, geometryOverlap * (1 - 0.4 * materialDifference)),
    };
  }
  return { mode: "unknown", overlap: 0 };
}

function isUnitInterval(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/** One candidate's MMR utility in 0–1. */
function normalizedUtilities<T extends DiversityRoute<string | number>>(
  candidates: readonly T[],
): readonly number[] {
  const values = candidates.map((candidate) =>
    Number.isFinite(candidate.score.total) ? candidate.score.total : 0,
  );
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  // The policy's score scale is 0–100, so a score inside that range keeps its
  // absolute meaning; anything else is normalized against the set (legacy
  // `normalizedUtilities`).
  const scoreScale = values.every((value) => value >= 0 && value <= 100);
  return values.map((value) => {
    if (scoreScale) return Math.max(0, Math.min(1, value / 100));
    return span > 0 ? (value - minimum) / span : 1;
  });
}

interface SimilaritySummary {
  readonly maximum: number;
  readonly mode: SimilarityMode;
  readonly routeId: string | number | null;
}

/** The strongest similarity of `route` against anything already kept. */
function strongestSimilarity<T extends DiversityRoute<string | number>>(
  route: T,
  kept: readonly T[],
): SimilaritySummary {
  let maximum = 0;
  let mode: SimilarityMode = "unknown";
  let routeId: string | number | null = null;
  for (const current of kept) {
    const similarity = routeSimilarity(route, current);
    if (routeId === null || similarity.overlap > maximum) {
      maximum = similarity.overlap;
      mode = similarity.mode;
      routeId = current.id;
    }
  }
  return { maximum, mode, routeId };
}

/**
 * Selects at most `maxResults` candidates that are meaningfully distinct.
 *
 * A candidate whose overlap with an already-kept route exceeds
 * `similarityThreshold` is a near-duplicate and is rejected, whatever its
 * score. An overlap exactly *at* the ceiling is a distinct route: the ceiling
 * is a ceiling, not a floor (`OGV-D-200`).
 *
 * Throws a `TypeError` on options that cannot be honored, so a malformed
 * policy fails at the boundary instead of silently returning a plausible
 * selection.
 */
export function rankDiverseCandidates<T extends DiversityRoute<string | number>>(
  candidates: readonly T[],
  options: DiversityOptions,
): DiverseRanking<T> {
  const lambda = options.diversityLambda ?? PA_NJ_ROUTE_POLICY_VNEXT_1.diversityLambda;
  if (!Number.isInteger(options.maxResults) || options.maxResults <= 0) {
    throw new TypeError("diversity maxResults must be a positive integer");
  }
  if (!isUnitInterval(options.similarityThreshold)) {
    throw new TypeError("diversity similarityThreshold must be between 0 and 1");
  }
  if (!isUnitInterval(lambda)) {
    throw new TypeError("MMR diversity lambda must be between 0 and 1");
  }

  const utilities = normalizedUtilities(candidates);
  const remaining = candidates.map((route, index) => ({ route, index }));
  const kept: RankedCandidate<T>[] = [];
  const keptRoutes: T[] = [];
  const dropped: DroppedCandidate<T>[] = [];

  while (remaining.length > 0 && kept.length < options.maxResults) {
    // Reject near-duplicates of what is already kept before scoring anything:
    // a duplicate never competes for a slot, so a higher score cannot buy one.
    // A rejected candidate leaves the working set immediately — otherwise the
    // next round would measure it again and report it twice.
    const comparable: { readonly route: T; readonly index: number; readonly similarity: SimilaritySummary }[] = [];
    for (const entry of remaining) {
      const similarity = strongestSimilarity(entry.route, keptRoutes);
      if (similarity.maximum > options.similarityThreshold) {
        dropped.push({
          route: entry.route,
          index: entry.index,
          reason: "near-duplicate",
          overlap: similarity.maximum,
          similarToId: similarity.routeId as T["id"],
        });
        continue;
      }
      comparable.push({ route: entry.route, index: entry.index, similarity });
    }
    remaining.length = 0;
    for (const entry of comparable) {
      remaining.push({ route: entry.route, index: entry.index });
    }

    if (comparable.length === 0) break;

    let best = comparable[0];
    if (best === undefined) break;
    for (const entry of comparable) {
      const score =
        (utilities[entry.index] ?? 0) - lambda * entry.similarity.maximum;
      const bestScore = (utilities[best.index] ?? 0) - lambda * best.similarity.maximum;
      const wins =
        score > bestScore ||
        (score === bestScore && entry.similarity.maximum < best.similarity.maximum) ||
        (score === bestScore &&
          entry.similarity.maximum === best.similarity.maximum &&
          entry.index < best.index);
      if (wins) best = entry;
    }

    kept.push({
      route: best.route,
      index: best.index,
      mmrScore: (utilities[best.index] ?? 0) - lambda * best.similarity.maximum,
      maxSimilarity: best.similarity.maximum,
      similarityMode: best.similarity.mode,
    });
    keptRoutes.push(best.route);
    // `best` was built for comparison, not taken from `remaining`, so the pick
    // is removed by its arrival index rather than by object identity.
    remaining.splice(
      remaining.findIndex((entry) => entry.index === best.index),
      1,
    );
  }

  // Everything left was outside the selection budget; each one still reports
  // the similarity it was measured against, so the quietest drops are
  // explainable too.
  for (const entry of remaining) {
    const similarity = strongestSimilarity(entry.route, keptRoutes);
    dropped.push({
      route: entry.route,
      index: entry.index,
      reason: "max-results",
      overlap: similarity.maximum,
      similarToId: (similarity.routeId as T["id"] | null) ?? null,
    });
  }

  return { ranked: kept, dropped };
}
