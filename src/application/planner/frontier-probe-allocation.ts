/** Experimental search allocation only; forecast routes are never route evidence. */
import {
  FRONTIER_QUALITY_KEYS,
  frontierUtility,
  selectLowRegretRepresentatives,
  type FrontierCandidate,
  type FrontierPreferenceProfile,
} from "./frontier-routing";

export interface FrontierProbeForecast {
  readonly id: string;
  /** Reserve every possible HTTP attempt, including adapter retries/connectors. */
  readonly maximumProviderAttempts: number;
  /** Mutually exclusive outcomes; remaining probability means no useful route. */
  readonly outcomes: readonly {
    readonly probability: number;
    readonly candidate: FrontierCandidate;
  }[];
}
export interface FrontierProbeBudget {
  readonly maximumProviderAttempts: number;
  readonly providerAttemptsUsed: number;
  readonly attemptedProbeIds: readonly string[];
}
export interface FrontierProbeAllocationInput {
  readonly candidates: readonly FrontierCandidate[];
  readonly profiles: readonly FrontierPreferenceProfile[];
  readonly forecasts: readonly FrontierProbeForecast[];
  readonly maxResults: number;
  readonly budget: FrontierProbeBudget;
}
export type FrontierProbeAllocation =
  | {
      readonly status: "selected";
      readonly probeId: string;
      readonly reservedProviderAttempts: number;
      readonly referenceMaximumRegret: number;
      readonly expectedMaximumRegretReduction: number;
      readonly expectedMeanRegretReduction: number;
    }
  | {
      readonly status: "exhausted";
      readonly reason:
        | "attempt-budget"
        | "no-useful-probe"
        | "no-comparable-evidence";
    }
  | {
      readonly status: "invalid";
      readonly reason:
        | "invalid-budget"
        | "invalid-forecast"
        | "invalid-candidates"
        | "invalid-profiles";
    };

function validBudget(budget: FrontierProbeBudget): boolean {
  if (!record(budget)) return false;
  return (
    Number.isSafeInteger(budget.maximumProviderAttempts) &&
    budget.maximumProviderAttempts >= 0 &&
    budget.maximumProviderAttempts <= 32 &&
    Number.isSafeInteger(budget.providerAttemptsUsed) &&
    budget.providerAttemptsUsed >= 0 &&
    budget.providerAttemptsUsed <= budget.maximumProviderAttempts &&
    Array.isArray(budget.attemptedProbeIds) &&
    budget.attemptedProbeIds.length <= budget.providerAttemptsUsed &&
    budget.attemptedProbeIds.every(validId) &&
    new Set(budget.attemptedProbeIds).size === budget.attemptedProbeIds.length
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 128
  );
}
function validCandidate(value: unknown): value is FrontierCandidate {
  if (!record(value) || !validId(value.id) || !record(value.quality))
    return false;
  const vector = value.quality;
  return (
    Object.keys(vector).length === FRONTIER_QUALITY_KEYS.length &&
    FRONTIER_QUALITY_KEYS.every(
      (key) =>
        vector[key] === null ||
        (typeof vector[key] === "number" &&
          Number.isFinite(vector[key]) &&
          vector[key] >= 0 &&
          vector[key] <= 1),
    )
  );
}
function validForecasts(
  forecasts: readonly FrontierProbeForecast[],
  candidates: readonly FrontierCandidate[],
): boolean {
  if (!Array.isArray(forecasts) || forecasts.length > 8) return false;
  const probeIds = new Set<string>();
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  for (const probe of forecasts) {
    if (
      !record(probe) ||
      !validId(probe.id) ||
      probeIds.has(probe.id) ||
      typeof probe.maximumProviderAttempts !== "number" ||
      !Number.isSafeInteger(probe.maximumProviderAttempts) ||
      probe.maximumProviderAttempts < 1 ||
      probe.maximumProviderAttempts > 32 ||
      !Array.isArray(probe.outcomes) ||
      probe.outcomes.length > 3
    )
      return false;
    probeIds.add(probe.id);
    let mass = 0;
    for (const outcome of probe.outcomes) {
      if (
        !record(outcome) ||
        typeof outcome.probability !== "number" ||
        !Number.isFinite(outcome.probability) ||
        outcome.probability < 0 ||
        outcome.probability > 1 ||
        !validCandidate(outcome.candidate) ||
        candidateIds.has(outcome.candidate.id)
      )
        return false;
      mass += outcome.probability;
      candidateIds.add(outcome.candidate.id);
    }
    if (mass > 1) return false;
  }
  return true;
}
function validProfiles(
  profiles: readonly FrontierPreferenceProfile[],
): boolean {
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 8)
    return false;
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (
      !record(profile) ||
      !validId(profile.id) ||
      ids.has(profile.id) ||
      !record(profile.weights)
    )
      return false;
    ids.add(profile.id);
    let weight = 0;
    for (const [key, value] of Object.entries(profile.weights)) {
      if (
        !FRONTIER_QUALITY_KEYS.includes(
          key as (typeof FRONTIER_QUALITY_KEYS)[number],
        ) ||
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0
      )
        return false;
      weight += value;
    }
    if (!Number.isFinite(weight) || weight <= 0) return false;
  }
  return true;
}

function bestUtilities(
  candidates: readonly FrontierCandidate[],
  profiles: readonly FrontierPreferenceProfile[],
): readonly (number | null)[] {
  return profiles.map((profile) => {
    const measured = candidates
      .map((candidate) => frontierUtility(candidate, profile))
      .filter((value): value is number => value !== null);
    return measured.length === 0 ? null : Math.max(...measured);
  });
}

function regret(
  selected: readonly FrontierCandidate[],
  profiles: readonly FrontierPreferenceProfile[],
  reference: readonly (number | null)[],
) {
  const utilities = bestUtilities(selected, profiles);
  if (
    reference.some((best, index) => best !== null && utilities[index] === null)
  )
    return null;
  const losses = reference.flatMap((best, index) => {
    const utility = utilities[index];
    return best === null || utility === null || utility === undefined
      ? []
      : [Math.max(0, best - utility)];
  });
  return losses.length === 0
    ? null
    : {
        maximum: Math.max(...losses),
        mean: losses.reduce((sum, value) => sum + value, 0) / losses.length,
      };
}

/**
 * One-step forecast acquisition. Re-run after canonical measurement of the
 * returned paths. Forecasts never enter the returned candidate pool or roles.
 */
export function selectNextFrontierProbe(
  input: FrontierProbeAllocationInput,
): FrontierProbeAllocation {
  if (!record(input) || !validBudget(input.budget))
    return { status: "invalid", reason: "invalid-budget" };
  const { candidates, profiles, forecasts, maxResults } = input;
  if (
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > 6 ||
    !candidates.every(validCandidate) ||
    new Set(candidates.map((candidate) => candidate.id)).size !==
      candidates.length ||
    !Number.isSafeInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > 3
  )
    return { status: "invalid", reason: "invalid-candidates" };
  if (!validProfiles(profiles))
    return { status: "invalid", reason: "invalid-profiles" };
  if (!validForecasts(forecasts, candidates))
    return { status: "invalid", reason: "invalid-forecast" };
  const remaining =
    input.budget.maximumProviderAttempts - input.budget.providerAttemptsUsed;
  const untried = forecasts.filter(
    (probe) => !input.budget.attemptedProbeIds.includes(probe.id),
  );
  if (untried.length === 0)
    return { status: "exhausted", reason: "no-useful-probe" };
  const available = untried.filter(
    (probe) => probe.maximumProviderAttempts <= remaining,
  );
  if (available.length === 0)
    return { status: "exhausted", reason: "attempt-budget" };
  const observedSelection = selectLowRegretRepresentatives(
    candidates,
    profiles,
    maxResults,
  );
  const observedUtilities = bestUtilities(observedSelection, profiles);
  const reference = bestUtilities(
    [
      ...candidates,
      ...available.flatMap((probe) =>
        probe.outcomes
          .filter((outcome) => outcome.probability > 0)
          .map((outcome) => outcome.candidate),
      ),
    ],
    profiles,
  ).map((best, index) => (observedUtilities[index] === null ? null : best));
  const before = regret(observedSelection, profiles, reference);
  if (before === null)
    return { status: "exhausted", reason: "no-comparable-evidence" };
  let best: Extract<FrontierProbeAllocation, { status: "selected" }> | null =
    null;
  let hasComparableProbe = false;
  for (const probe of available) {
    let maximumGain = 0,
      meanGain = 0;
    let comparable = true;
    for (const outcome of probe.outcomes) {
      if (outcome.probability === 0) continue;
      const selected = selectLowRegretRepresentatives(
        [...candidates, outcome.candidate],
        profiles,
        maxResults,
      );
      const after = regret(selected, profiles, reference);
      if (after === null) {
        comparable = false;
        break;
      }
      maximumGain += outcome.probability * (before.maximum - after.maximum);
      meanGain += outcome.probability * (before.mean - after.mean);
    }
    if (!comparable) continue;
    hasComparableProbe = true;
    if (maximumGain < -1e-9 || (maximumGain <= 1e-9 && meanGain <= 1e-9))
      continue;
    const maximumRate = maximumGain / probe.maximumProviderAttempts;
    const meanRate = meanGain / probe.maximumProviderAttempts;
    if (best !== null) {
      const bestMaximumRate =
        best.expectedMaximumRegretReduction / best.reservedProviderAttempts;
      const bestMeanRate =
        best.expectedMeanRegretReduction / best.reservedProviderAttempts;
      if (maximumRate < bestMaximumRate - 1e-9) continue;
      if (
        Math.abs(maximumRate - bestMaximumRate) <= 1e-9 &&
        (meanRate < bestMeanRate - 1e-9 ||
          (Math.abs(meanRate - bestMeanRate) <= 1e-9 &&
            probe.id >= best.probeId))
      )
        continue;
    }
    best = {
      status: "selected",
      probeId: probe.id,
      reservedProviderAttempts: probe.maximumProviderAttempts,
      referenceMaximumRegret: before.maximum,
      expectedMaximumRegretReduction: maximumGain,
      expectedMeanRegretReduction: meanGain,
    };
  }
  return (
    best ?? {
      status: "exhausted",
      reason: hasComparableProbe ? "no-useful-probe" : "no-comparable-evidence",
    }
  );
}
