/** Offline experiment only. This module accepts no RouteBundle or mutation port. */
import { deepFreeze } from "@/domain/util/freeze";
import {
  auditJevFrontierOrder,
  buildBalancedJevFrontierPermutations,
  jevFrontierCounterfactual,
  validateJevFrontierJudgment,
  validateJevFrontierState,
  type JevFrontierAblationVariant,
  type JevFrontierCounterfactualPolicy,
  type JevFrontierJudge,
  type JevFrontierJudgeResult,
  type JevFrontierOrderAudit,
  type JevFrontierOrderOutcome,
  type JevFrontierPermutation,
  type JevFrontierState,
} from "./jev-frontier-shadow";

export interface JevReplayControl {
  readonly source: "rider-posterior" | "deterministic-baseline";
  readonly choiceCandidateId: string | null;
  /** An independently computed, frozen probability forecast, never fitted on test labels. */
  readonly probabilitiesByCandidateId: Readonly<Record<string, number>>;
}
export interface JevReplayCase {
  readonly schemaVersion: 1;
  readonly caseId: string;
  readonly corridorKey: string;
  readonly rideSessionKey: string;
  readonly selector: "exact-bounded-regret-v1";
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly state: JevFrontierState;
  readonly control: JevReplayControl;
}
export interface JevReplayRun {
  readonly repeat: number;
  readonly permutation: JevFrontierPermutation;
  readonly result: JevFrontierJudgeResult;
}
export interface JevReplayVariant {
  readonly runs: readonly JevReplayRun[];
  readonly audits: readonly (JevFrontierOrderAudit | null)[];
  readonly orderFlipRate: number | null;
  readonly repeatedRequestStability: number | null;
  readonly repeatedProbabilityTotalVariation: number | null;
  readonly repeatedComparisons: number;
  readonly choiceCandidateId: string | null;
  readonly probabilitiesByCandidateId: Readonly<Record<string, number>> | null;
  readonly noneProbability: number | null;
  readonly meaningfulImprovementProbability: number | null;
  readonly verdict:
    | "same-as-baseline"
    | "alternative"
    | "below-threshold"
    | "abstain";
}
export interface JevReplayRecord {
  readonly schemaVersion: 1;
  readonly orderDesign: "complete-factorial-v1";
  readonly caseId: string;
  readonly corridorKey: string;
  readonly rideSessionKey: string;
  readonly seed: string;
  readonly selector: "exact-bounded-regret-v1";
  readonly deterministicBaselineId: string;
  readonly candidates: readonly {
    readonly id: string;
    readonly fingerprint: string;
    readonly canonicalRank: number;
    readonly riderPreferenceUtility: number | null;
  }[];
  readonly control: JevReplayControl;
  readonly policy: JevFrontierCounterfactualPolicy;
  readonly variants: Readonly<
    Record<JevFrontierAblationVariant, JevReplayVariant>
  >;
}

export function isReplayObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function isReplayKey(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v) &&
    !["__proto__", "constructor", "prototype", "NONE"].includes(v)
  );
}
export function isExactReplayObject(
  v: unknown,
  keys: readonly string[],
): v is Record<string, unknown> {
  return (
    isReplayObject(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  );
}
export function isReplayProbability(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}
export function validReplayDistribution(
  v: unknown,
  ids: readonly string[],
): v is Record<string, number> {
  return (
    isExactReplayObject(v, ids) &&
    Object.values(v).every(isReplayProbability) &&
    Math.abs(Object.values(v).reduce<number>((a, b) => a + Number(b), 0) - 1) <
      1e-6
  );
}
export function validateJevReplayCase(v: unknown): v is JevReplayCase {
  if (
    !isExactReplayObject(v, [
      "schemaVersion",
      "caseId",
      "corridorKey",
      "rideSessionKey",
      "selector",
      "fingerprints",
      "state",
      "control",
    ]) ||
    v.schemaVersion !== 1 ||
    v.selector !== "exact-bounded-regret-v1" ||
    ![v.caseId, v.corridorKey, v.rideSessionKey].every(isReplayKey) ||
    validateJevFrontierState(v.state) !== null
  )
    return false;
  const state = v.state as JevFrontierState;
  const ids = state.candidates.map((c) => c.id);
  if (
    !isExactReplayObject(v.fingerprints, ids) ||
    !Object.values(v.fingerprints).every(isReplayKey) ||
    new Set(Object.values(v.fingerprints)).size !== ids.length
  )
    return false;
  const c = v.control;
  if (
    !isExactReplayObject(c, [
      "source",
      "choiceCandidateId",
      "probabilitiesByCandidateId",
    ]) ||
    !["rider-posterior", "deterministic-baseline"].includes(String(c.source)) ||
    !validReplayDistribution(c.probabilitiesByCandidateId, ids)
  )
    return false;
  if (state.rider !== null && c.source !== "rider-posterior") return false;
  const max = Math.max(...Object.values(c.probabilitiesByCandidateId));
  const probabilities = c.probabilitiesByCandidateId;
  const winners = ids.filter((id) => Math.abs(probabilities[id]! - max) < 1e-9);
  if (c.choiceCandidateId !== (winners.length === 1 ? winners[0] : null))
    return false;
  if (
    c.source === "deterministic-baseline" &&
    (c.choiceCandidateId !== state.deterministicBaselineId ||
      c.probabilitiesByCandidateId[state.deterministicBaselineId] !== 1)
  )
    return false;
  return true;
}

/** Validate injected judges too; replay fixtures must satisfy the remote contract. */
function sanitizeResult(
  state: JevFrontierState,
  result: JevFrontierJudgeResult,
): JevFrontierJudgeResult {
  if (
    !isReplayObject(result) ||
    typeof result.latencyMs !== "number" ||
    !Number.isFinite(result.latencyMs) ||
    result.latencyMs < 0
  )
    return { status: "invalid", reason: "malformed-response", latencyMs: 0 };
  if (result.status === "ok") {
    const validation = validateJevFrontierJudgment(state, result.judgment);
    if (!validation.ok)
      return {
        status: "invalid",
        reason: validation.reason,
        latencyMs: result.latencyMs,
      };
    const usage = result.usage;
    const token = (v: unknown): number | null =>
      typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
    return {
      status: "ok",
      judgment: validation.judgment,
      latencyMs: result.latencyMs,
      ...(usage === undefined
        ? {}
        : {
            usage: {
              inputTokens: token(usage.inputTokens),
              outputTokens: token(usage.outputTokens),
              cost:
                typeof usage.cost === "number" &&
                Number.isFinite(usage.cost) &&
                usage.cost >= 0
                  ? usage.cost
                  : null,
            },
          }),
    };
  }
  // No arbitrary fixture or provider messages enter telemetry.
  if (
    (result.status === "skipped" &&
      ["disabled", "invalid-state", "cancelled"].includes(result.reason)) ||
    (result.status === "failed" &&
      ["timeout", "transport-error", "aborted"].includes(result.reason)) ||
    (result.status === "invalid" &&
      [
        "candidate-count",
        "duplicate-candidate",
        "unsafe-candidate-id",
        "baseline-missing",
        "invalid-state",
        "invalid-model",
        "invalid-choice",
        "invalid-choice-distribution",
        "invalid-choice-confidence",
        "invalid-fit",
        "invalid-improvement-probability",
        "malformed-response",
      ].includes(result.reason))
  ) {
    return {
      status: result.status,
      reason: result.reason,
      latencyMs: result.latencyMs,
      ...(result.status === "failed" &&
      typeof result.httpStatus === "number" &&
      Number.isInteger(result.httpStatus) &&
      result.httpStatus >= 100 &&
      result.httpStatus <= 599
        ? { httpStatus: result.httpStatus }
        : {}),
    } as JevFrontierJudgeResult;
  }
  return {
    status: "invalid",
    reason: "malformed-response",
    latencyMs: result.latencyMs,
  };
}
function outcome(run: JevReplayRun): JevFrontierOrderOutcome | null {
  if (run.result.status !== "ok") return null;
  const c = run.result.judgment.choice;
  return {
    permutationId: run.permutation.id,
    choiceCandidateId: c.choice === "NONE" ? null : c.choice,
    probabilitiesByCandidateId: Object.fromEntries(
      Object.entries(c.probabilities).filter(([id]) => id !== "NONE"),
    ),
    noneProbability: c.probabilities.NONE!,
  };
}
function summarize(
  state: JevFrontierState,
  runs: readonly JevReplayRun[],
  repeats: number,
  policy: JevFrontierCounterfactualPolicy,
): JevReplayVariant {
  const audits = Array.from({ length: repeats }, (_, repeat) => {
    const outcomes = runs.filter((r) => r.repeat === repeat).map(outcome);
    return outcomes.some((o) => o === null)
      ? null
      : auditJevFrontierOrder(state, outcomes as JevFrontierOrderOutcome[]);
  });
  let repeatedComparisons = 0,
    agreements = 0,
    totalVariation = 0;
  for (let left = 0; left < runs.length; left++)
    for (let right = left + 1; right < runs.length; right++) {
      const a = runs[left]!,
        b = runs[right]!;
      if (
        a.permutation.id !== b.permutation.id ||
        a.result.status !== "ok" ||
        b.result.status !== "ok"
      )
        continue;
      repeatedComparisons++;
      if (a.result.judgment.choice.choice === b.result.judgment.choice.choice)
        agreements++;
      totalVariation +=
        Object.keys(a.result.judgment.choice.probabilities).reduce(
          (s, id) =>
            s +
            Math.abs(
              a.result.status === "ok"
                ? a.result.judgment.choice.probabilities[id]! -
                    (b.result.status === "ok"
                      ? b.result.judgment.choice.probabilities[id]!
                      : 0)
                : 0,
            ),
          0,
        ) / 2;
    }
  const valid = audits.filter((a): a is JevFrontierOrderAudit => a !== null);
  const complete = valid.length === repeats;
  const ids = state.candidates.map((c) => c.id);
  const probabilities = complete
    ? Object.fromEntries(
        ids.map((id) => [
          id,
          valid.reduce((s, a) => s + a.meanProbabilityByCandidateId[id]!, 0) /
            repeats,
        ]),
      )
    : null;
  const noneProbability = complete
    ? valid.reduce((s, a) => s + a.meanNoneProbability, 0) / repeats
    : null;
  const judgments = runs.flatMap((r) =>
    r.result.status === "ok" ? [r.result.judgment] : [],
  );
  const counterfactuals = judgments.map((j) =>
    jevFrontierCounterfactual(state, j, policy),
  );
  const stable =
    complete &&
    valid.every(
      (a) =>
        !a.orderDependent &&
        a.stableChoiceCandidateId === valid[0]!.stableChoiceCandidateId,
    );
  const choice = stable ? valid[0]!.stableChoiceCandidateId : null;
  const passes = judgments.every((j) => {
    const chosen = j.choice.probabilities[j.choice.choice]!;
    const runnerUp = Math.max(
      ...Object.entries(j.choice.probabilities)
        .filter(([id]) => id !== j.choice.choice)
        .map(([, p]) => p),
    );
    return (
      j.choice.confidence >= policy.minimumChoiceConfidence &&
      chosen >= policy.minimumChosenProbability &&
      chosen - runnerUp >= policy.minimumChoiceMargin
    );
  });
  const verdict =
    !stable || choice === null
      ? "abstain"
      : !passes ||
          counterfactuals.some(
            (c) => c === null || c.status === "below-threshold",
          )
        ? "below-threshold"
        : choice === state.deterministicBaselineId
          ? "same-as-baseline"
          : "alternative";
  return {
    runs,
    audits,
    orderFlipRate:
      valid.length === 0
        ? null
        : valid.reduce((s, a) => s + a.flipRate, 0) / valid.length,
    repeatedRequestStability:
      repeatedComparisons === 0 ? null : agreements / repeatedComparisons,
    repeatedProbabilityTotalVariation:
      repeatedComparisons === 0 ? null : totalVariation / repeatedComparisons,
    repeatedComparisons,
    choiceCandidateId:
      verdict === "abstain" || verdict === "below-threshold" ? null : choice,
    probabilitiesByCandidateId: probabilities,
    noneProbability,
    meaningfulImprovementProbability: complete
      ? judgments.reduce((s, j) => s + j.meaningfulImprovement.noul, 0) /
        judgments.length
      : null,
    verdict,
  };
}

/** Sequential, explicitly budgeted repeated measurements. Repeats are experiments, never retries. */
export async function runJevFrontierReplay(
  entry: JevReplayCase,
  options: {
    readonly judge: JevFrontierJudge | null;
    readonly seed: string;
    readonly repeats: number;
    readonly policy: JevFrontierCounterfactualPolicy;
  },
  signal: AbortSignal,
): Promise<JevReplayRecord> {
  if (
    !validateJevReplayCase(entry) ||
    !isReplayKey(options.seed) ||
    !Number.isSafeInteger(options.repeats) ||
    options.repeats < 1 ||
    options.repeats > 10 ||
    !isExactReplayObject(options.policy, [
      "minimumChoiceConfidence",
      "minimumChosenProbability",
      "minimumChoiceMargin",
      "minimumMeaningfulImprovementProbability",
    ]) ||
    !Object.values(options.policy).every(isReplayProbability)
  )
    throw Error("Invalid replay configuration");
  const snapshot: JevReplayCase = deepFreeze(JSON.parse(JSON.stringify(entry)));
  const seed = `${options.seed}:${snapshot.caseId}`;
  const permutations = deepFreeze(buildBalancedJevFrontierPermutations(
    snapshot.state,
    seed,
  ));
  const variants = {} as Record<JevFrontierAblationVariant, JevReplayVariant>;
  for (const variant of ["A", "B", "C"] as const) {
    const runs: JevReplayRun[] = [];
    for (let repeat = 0; repeat < options.repeats; repeat++)
      for (const permutation of permutations) {
        let result: JevFrontierJudgeResult;
        if (signal.aborted)
          result = { status: "skipped", reason: "cancelled", latencyMs: 0 };
        else if (options.judge === null)
          result = { status: "skipped", reason: "disabled", latencyMs: 0 };
        else {
          const start = performance.now();
          try {
            result = sanitizeResult(
              snapshot.state,
              await options.judge.judge(
                { state: snapshot.state, permutation, variant },
                signal,
              ),
            );
          } catch {
            result = {
              status: "failed",
              reason: signal.aborted ? "aborted" : "transport-error",
              latencyMs: performance.now() - start,
            };
          }
        }
        runs.push({ repeat, permutation, result });
      }
    variants[variant] = summarize(
      snapshot.state,
      runs,
      options.repeats,
      options.policy,
    );
  }
  return deepFreeze({
    schemaVersion: 1,
    orderDesign: "complete-factorial-v1",
    caseId: snapshot.caseId,
    corridorKey: snapshot.corridorKey,
    rideSessionKey: snapshot.rideSessionKey,
    seed,
    selector: snapshot.selector,
    deterministicBaselineId: snapshot.state.deterministicBaselineId,
    candidates: snapshot.state.candidates.map((c) => ({
      id: c.id,
      fingerprint: snapshot.fingerprints[c.id]!,
      canonicalRank: c.canonicalRank,
      riderPreferenceUtility: c.riderPreferenceUtility,
    })),
    control: snapshot.control,
    policy: { ...options.policy },
    variants,
  });
}
