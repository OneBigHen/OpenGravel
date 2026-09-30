/**
 * Provider-neutral route frontier selection.
 *
 * This is deliberately upstream of rider-facing roles and downstream of route
 * evidence. Providers propose paths; OpenGravel decides which paths are useful.
 *
 * Missing evidence is never fabricated. Dominance is conservative: candidate A
 * can dominate B only when A knows every dimension B knows, is no worse on all
 * of them, and is strictly better on at least one. A sparse candidate therefore
 * cannot win merely because inconvenient dimensions are absent.
 */

export const FRONTIER_DIMENSIONS = [
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

export type FrontierDimension = (typeof FRONTIER_DIMENSIONS)[number];

export type FrontierVector = Readonly<Record<FrontierDimension, number | null>>;

export interface FrontierCandidate<T = unknown> {
  readonly id: string;
  readonly vector: FrontierVector;
  readonly value: T;
}

export interface FrontierUtilityProfile {
  readonly id: string;
  /** Non-negative relative weights. Missing keys mean zero importance. */
  readonly weights: Readonly<Partial<Record<FrontierDimension, number>>>;
}

export interface FrontierSelectionOptions {
  /** Visible route count. Defaults to 3. */
  readonly limit?: number;
  /**
   * Minimum fraction of one profile's total weight that must have known
   * evidence before that candidate participates in regret for the profile.
   */
  readonly minimumUtilityCoverage?: number;
}

function valid(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** True only when left conservatively Pareto-dominates right. */
export function dominates(left: FrontierVector, right: FrontierVector): boolean {
  let compared = 0;
  let strictlyBetter = false;

  for (const dimension of FRONTIER_DIMENSIONS) {
    const rightValue = right[dimension];
    if (!valid(rightValue)) continue;

    const leftValue = left[dimension];
    // Evidence asymmetry matters: unknown cannot dominate known.
    if (!valid(leftValue)) return false;

    compared += 1;
    if (leftValue < rightValue) return false;
    if (leftValue > rightValue) strictlyBetter = true;
  }

  return compared > 0 && strictlyBetter;
}

/** Remove candidates that another candidate conservatively dominates. */
export function paretoFrontier<T>(
  candidates: readonly FrontierCandidate<T>[],
): readonly FrontierCandidate<T>[] {
  return candidates.filter((candidate, index) =>
    !candidates.some((other, otherIndex) =>
      otherIndex !== index && dominates(other.vector, candidate.vector),
    ),
  );
}

interface UtilityReading {
  readonly utility: number;
  readonly coverage: number;
}

function utility(
  vector: FrontierVector,
  profile: FrontierUtilityProfile,
  minimumCoverage: number,
): UtilityReading | null {
  let totalWeight = 0;
  let knownWeight = 0;
  let weightedKnown = 0;

  for (const dimension of FRONTIER_DIMENSIONS) {
    const weight = profile.weights[dimension] ?? 0;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    totalWeight += weight;

    const value = vector[dimension];
    if (!valid(value)) continue;
    knownWeight += weight;
    weightedKnown += weight * value;
  }

  if (totalWeight <= 0) return null;
  const coverage = knownWeight / totalWeight;
  if (coverage < minimumCoverage) return null;

  // Conservative utility: unknown dimensions contribute no claimed benefit.
  // This is not a fabricated feature value; coverage remains explicit.
  return { utility: weightedKnown / totalWeight, coverage };
}

function regretForSelection<T>(
  all: readonly FrontierCandidate<T>[],
  selected: readonly FrontierCandidate<T>[],
  profiles: readonly FrontierUtilityProfile[],
  minimumCoverage: number,
): number {
  let worst = 0;

  for (const profile of profiles) {
    let bestAll = 0;
    let bestSelected = 0;
    let usable = false;

    for (const candidate of all) {
      const reading = utility(candidate.vector, profile, minimumCoverage);
      if (reading === null) continue;
      usable = true;
      if (reading.utility > bestAll) bestAll = reading.utility;
    }

    if (!usable || bestAll <= 0) continue;

    for (const candidate of selected) {
      const reading = utility(candidate.vector, profile, minimumCoverage);
      if (reading !== null && reading.utility > bestSelected) {
        bestSelected = reading.utility;
      }
    }

    const regret = 1 - bestSelected / bestAll;
    if (regret > worst) worst = regret;
  }

  return worst;
}

/**
 * Deterministic greedy approximation to a k-regret representative subset.
 *
 * This is intentionally small and auditable, not an implementation of the
 * ATMOS 2025 algorithm. It gives OpenGravel a testable scaffold for selecting a
 * few routes that collectively cover several rider utility profiles.
 */
export function selectLowRegretRepresentatives<T>(
  candidates: readonly FrontierCandidate<T>[],
  profiles: readonly FrontierUtilityProfile[],
  options: FrontierSelectionOptions = {},
): readonly FrontierCandidate<T>[] {
  const limit = Math.max(0, Math.floor(options.limit ?? 3));
  if (limit === 0 || candidates.length === 0) return [];

  const minimumCoverage = Math.min(
    1,
    Math.max(0, options.minimumUtilityCoverage ?? 0.6),
  );
  const frontier = [...paretoFrontier(candidates)];
  if (frontier.length <= limit || profiles.length === 0) {
    return frontier
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit);
  }

  const selected: FrontierCandidate<T>[] = [];
  const remaining = new Map(frontier.map((candidate) => [candidate.id, candidate]));

  while (selected.length < limit && remaining.size > 0) {
    let best: FrontierCandidate<T> | null = null;
    let bestRegret = Number.POSITIVE_INFINITY;

    for (const candidate of remaining.values()) {
      const trial = [...selected, candidate];
      const regret = regretForSelection(frontier, trial, profiles, minimumCoverage);
      if (
        regret < bestRegret ||
        (regret === bestRegret && (best === null || candidate.id.localeCompare(best.id) < 0))
      ) {
        best = candidate;
        bestRegret = regret;
      }
    }

    if (best === null) break;
    selected.push(best);
    remaining.delete(best.id);
  }

  return selected;
}
