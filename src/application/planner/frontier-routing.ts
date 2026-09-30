/**
 * Experimental provider-neutral frontier selection for the next routing method.
 *
 * Providers still propose paths and canonical OpenGravel policy still owns
 * eligibility, evidence and rider-visible roles. This module starts only after
 * a candidate has already been measured into normalized quality dimensions.
 *
 * Important semantics:
 * - every quality is 0..1, where larger is better;
 * - unavailable evidence is null, never 0.5;
 * - Pareto dominance is evidence-conservative: the dominating candidate must
 *   know every dimension known by the dominated candidate, and enough evidence
 *   must be comparable;
 * - representative selection is deterministic and intentionally small.
 *
 * This module is not wired into the live planner yet. It is the pure selection
 * substrate for the frontier-routing experiment documented in
 * docs/frontier-routing.md.
 */

export const FRONTIER_QUALITY_KEYS = [
  "timeEfficiency",
  "curvature",
  "flow",
  "backroad",
  "surfaceFit",
  "gravelAffinity",
  "trafficFlow",
  "junctionFlow",
  "novelty",
] as const;

export type FrontierQualityKey = (typeof FRONTIER_QUALITY_KEYS)[number];

export type FrontierQualityVector = Readonly<
  Record<FrontierQualityKey, number | null>
>;

export interface FrontierCandidate<T = unknown> {
  readonly id: string;
  readonly quality: FrontierQualityVector;
  readonly payload?: T;
}

export interface FrontierPreferenceProfile {
  readonly id: string;
  /** Positive relative weights. Missing/zero axes do not participate. */
  readonly weights: Readonly<Partial<Record<FrontierQualityKey, number>>>;
}

export interface FrontierSelectionOptions {
  /** Minimum mutually-known dimensions before one route may dominate another. */
  readonly minimumComparableDimensions?: number;
  /** Minimum preference weight coverage before a utility is considered usable. */
  readonly minimumUtilityCoverage?: number;
}

const DEFAULT_MINIMUM_COMPARABLE_DIMENSIONS = 3;
const DEFAULT_MINIMUM_UTILITY_COVERAGE = 0.5;
const EPSILON = 1e-9;

function quality(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/**
 * True only when `left` is no worse than `right` on every mutually-known
 * axis, strictly better on at least one, and enough evidence is comparable.
 */
export function frontierDominates(
  left: FrontierQualityVector,
  right: FrontierQualityVector,
  minimumComparableDimensions = DEFAULT_MINIMUM_COMPARABLE_DIMENSIONS,
): boolean {
  let comparable = 0;
  let strictlyBetter = false;

  for (const key of FRONTIER_QUALITY_KEYS) {
    const leftValue = quality(left[key]);
    const rightValue = quality(right[key]);
    if (rightValue === null) continue;
    // Unknown cannot dominate known. Without this asymmetry a sparse route can
    // look artificially strong simply because inconvenient dimensions vanish
    // from the comparison.
    if (leftValue === null) return false;

    comparable += 1;
    if (leftValue + EPSILON < rightValue) return false;
    if (leftValue > rightValue + EPSILON) strictlyBetter = true;
  }

  return comparable >= minimumComparableDimensions && strictlyBetter;
}

/**
 * Removes candidates that are clearly dominated by another candidate.
 *
 * Sparse evidence is conservative: it makes domination harder rather than
 * fabricating an average value for a missing axis.
 */
export function paretoFrontier<T>(
  candidates: readonly FrontierCandidate<T>[],
  options: FrontierSelectionOptions = {},
): readonly FrontierCandidate<T>[] {
  const minimumComparableDimensions =
    options.minimumComparableDimensions ??
    DEFAULT_MINIMUM_COMPARABLE_DIMENSIONS;

  return candidates.filter(
    (candidate, index) =>
      !candidates.some(
        (other, otherIndex) =>
          index !== otherIndex &&
          frontierDominates(
            other.quality,
            candidate.quality,
            minimumComparableDimensions,
          ),
      ),
  );
}

/**
 * A bounded utility projection used only for representative-set coverage.
 *
 * Missing evidence reduces coverage and therefore utility instead of receiving
 * a neutral score. Returns null when too little of the profile is known.
 */
export function frontierUtility(
  candidate: FrontierCandidate,
  profile: FrontierPreferenceProfile,
  minimumCoverage = DEFAULT_MINIMUM_UTILITY_COVERAGE,
): number | null {
  let totalWeight = 0;
  let knownWeight = 0;
  let weightedQuality = 0;

  for (const key of FRONTIER_QUALITY_KEYS) {
    const rawWeight = profile.weights[key] ?? 0;
    const weight =
      Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 0;
    if (weight === 0) continue;

    totalWeight += weight;
    const value = quality(candidate.quality[key]);
    if (value === null) continue;

    knownWeight += weight;
    weightedQuality += value * weight;
  }

  if (totalWeight === 0 || knownWeight === 0) return null;
  const coverage = knownWeight / totalWeight;
  if (coverage + EPSILON < minimumCoverage) return null;

  return (weightedQuality / knownWeight) * coverage;
}

interface RegretScore {
  readonly maximum: number;
  readonly mean: number;
}

function maximumUtility(
  candidates: readonly FrontierCandidate[],
  profile: FrontierPreferenceProfile,
  minimumCoverage: number,
): number | null {
  let best: number | null = null;
  for (const candidate of candidates) {
    const utility = frontierUtility(candidate, profile, minimumCoverage);
    if (utility === null) continue;
    if (best === null || utility > best) best = utility;
  }
  return best;
}

function regretScore(
  selected: readonly FrontierCandidate[],
  all: readonly FrontierCandidate[],
  profiles: readonly FrontierPreferenceProfile[],
  minimumCoverage: number,
): RegretScore {
  const regrets: number[] = [];

  for (const profile of profiles) {
    const bestAvailable = maximumUtility(all, profile, minimumCoverage);
    if (bestAvailable === null) continue;

    const bestSelected = maximumUtility(selected, profile, minimumCoverage) ?? 0;
    regrets.push(Math.max(0, bestAvailable - bestSelected));
  }

  if (regrets.length === 0) return { maximum: 0, mean: 0 };
  return {
    maximum: Math.max(...regrets),
    mean: regrets.reduce((sum, value) => sum + value, 0) / regrets.length,
  };
}

function betterRegret(
  left: RegretScore,
  right: RegretScore,
): boolean {
  if (left.maximum + EPSILON < right.maximum) return true;
  if (right.maximum + EPSILON < left.maximum) return false;
  return left.mean + EPSILON < right.mean;
}

/**
 * Chooses at most `maxResults` Pareto-surviving routes using a deterministic
 * greedy k-regret approximation.
 *
 * The exact ATMOS 2025 algorithm is deliberately not reproduced here. This
 * small implementation gives OpenGravel an experimentable seam: it asks which
 * candidate most reduces the worst preference-profile regret at each step.
 */
export function selectLowRegretRepresentatives<T>(
  candidates: readonly FrontierCandidate<T>[],
  profiles: readonly FrontierPreferenceProfile[],
  maxResults: number,
  options: FrontierSelectionOptions = {},
): readonly FrontierCandidate<T>[] {
  if (!Number.isInteger(maxResults) || maxResults <= 0 || candidates.length === 0) {
    return [];
  }

  const minimumCoverage =
    options.minimumUtilityCoverage ?? DEFAULT_MINIMUM_UTILITY_COVERAGE;
  const frontier = [...paretoFrontier(candidates, options)].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (frontier.length <= maxResults) return frontier;
  if (profiles.length === 0) return frontier.slice(0, maxResults);

  const selected: FrontierCandidate<T>[] = [];
  const selectedIds = new Set<string>();

  while (selected.length < maxResults) {
    let bestCandidate: FrontierCandidate<T> | null = null;
    let bestScore: RegretScore | null = null;

    for (const candidate of frontier) {
      if (selectedIds.has(candidate.id)) continue;
      const score = regretScore(
        [...selected, candidate],
        frontier,
        profiles,
        minimumCoverage,
      );

      if (
        bestCandidate === null ||
        bestScore === null ||
        betterRegret(score, bestScore) ||
        (
          !betterRegret(bestScore, score) &&
          !betterRegret(score, bestScore) &&
          candidate.id.localeCompare(bestCandidate.id) < 0
        )
      ) {
        bestCandidate = candidate;
        bestScore = score;
      }
    }

    if (bestCandidate === null) break;
    selected.push(bestCandidate);
    selectedIds.add(bestCandidate.id);
  }

  return selected;
}

/**
 * Fixed archetypes are evaluation coverage targets, not rider-visible profiles.
 * A learned rider preference (PR #29) can later be appended as one additional
 * profile without replacing explicit current-ride intent.
 */
export const DEFAULT_FRONTIER_PREFERENCE_PROFILES: readonly FrontierPreferenceProfile[] = [
  {
    id: "efficient",
    weights: {
      timeEfficiency: 0.65,
      flow: 0.15,
      trafficFlow: 0.1,
      junctionFlow: 0.1,
    },
  },
  {
    id: "flowing",
    weights: {
      curvature: 0.3,
      flow: 0.35,
      backroad: 0.15,
      trafficFlow: 0.1,
      junctionFlow: 0.1,
    },
  },
  {
    id: "twisty",
    weights: {
      timeEfficiency: 0.15,
      curvature: 0.6,
      flow: 0.1,
      backroad: 0.15,
    },
  },
  {
    id: "backroad",
    weights: {
      flow: 0.2,
      backroad: 0.5,
      trafficFlow: 0.15,
      junctionFlow: 0.15,
    },
  },
  {
    id: "adventure",
    weights: {
      timeEfficiency: 0.1,
      backroad: 0.15,
      surfaceFit: 0.3,
      gravelAffinity: 0.45,
    },
  },
  {
    id: "explore",
    weights: {
      curvature: 0.15,
      flow: 0.15,
      backroad: 0.2,
      novelty: 0.5,
    },
  },
];
