/**
 * Reusable FUN JUDGE service over a provider-neutral `FunJudgePort`.
 *
 * Any candidate generator can ask "which of these already-eligible routes is
 * the better ride?" and always gets an answer back:
 *
 * - a Jev preference, when the model answered in time, agreed with itself
 *   across presentation orders and cleared the confidence/margin floor; or
 * - the caller's deterministic ranking, with a machine reason saying why the
 *   model was not used (disabled, unavailable, timeout, budget, low confidence,
 *   order disagreement, no preference).
 *
 * Strict budgets: at most `callsPerJudgement` model calls per question, a
 * process-wide calls-per-minute ceiling, and a wall-clock deadline after which
 * the caller gets the fallback (a slower call keeps running on the adapter's
 * own timeout and fills the cache for the next identical question). Answers are
 * cached by an evidence fingerprint, so a candidate's opaque key, its position
 * and the request order never change the cache identity.
 */

import {
  FUN_JUDGE_MAX_CANDIDATES,
  FUN_JUDGE_MIN_CANDIDATES,
  type FunJudgeAnswer,
  type FunJudgeCandidateEvidence,
  type FunJudgePort,
  type FunJudgeRequest,
  type FunJudgeUnavailableReason,
  isValidFunJudgeFormulaEvidence,
  projectFunJudgeEvidence,
} from "./ports/fun-judge";

export interface FunJudgePolicy {
  /** How long a caller waits before receiving the deterministic fallback. */
  readonly deadlineMs: number;
  /** 1 = one order; 2 = forward and reversed order, both must agree. */
  readonly callsPerJudgement: 1 | 2;
  /** Process-wide ceiling on new model calls in any rolling minute. */
  readonly maxCallsPerMinute: number;
  /** Mean probability the chosen route must reach. */
  readonly minConfidence: number;
  /** Chosen minus runner-up mean probability. */
  readonly minMargin: number;
  /** Above this mean "no preference" probability the judge abstains. */
  readonly maxNoneProbability: number;
  readonly cacheLimit: number;
}

/**
 * Uncalibrated v1 thresholds. They are conservative on purpose (abstain often)
 * and must be re-tuned from held-out rider labels before any default-on use.
 */
export const FUN_JUDGE_POLICY_V1: FunJudgePolicy = Object.freeze({
  deadlineMs: 1_200,
  callsPerJudgement: 2,
  maxCallsPerMinute: 40,
  minConfidence: 0.6,
  minMargin: 0.2,
  maxNoneProbability: 0.35,
  cacheLimit: 500,
});

export type FunJudgeOutcome =
  | "preferred"
  | "no-preference"
  | "low-confidence"
  | "order-disagreement"
  | "unavailable"
  | "timeout"
  | "budget-exhausted"
  | "invalid-request"
  | "indistinguishable";

export interface FunJudgeVerdict {
  /** `jev` only for outcome `preferred`; everything else is the deterministic fallback. */
  readonly source: "jev" | "fallback";
  readonly outcome: FunJudgeOutcome;
  /** The judged winner's key (`null` on fallback). */
  readonly preferredKey: string | null;
  /** Model order (mean probability) on `jev`; otherwise the caller's fallback ranking. */
  readonly ranking: readonly string[];
  /** Mean probability of the model's choice; `null` when the model gave none. */
  readonly confidence: number | null;
  readonly margin: number | null;
  readonly noneProbability: number | null;
  /** Did both presentation orders pick the same route? `null` with a single order. */
  readonly orderAgreement: boolean | null;
  readonly model: string;
  /** New model calls this judgement started (0 on a cache hit). */
  readonly calls: number;
  readonly cached: boolean;
  readonly latencyMs: number;
  readonly unavailableReason?: FunJudgeUnavailableReason;
  readonly httpStatus?: number;
}

export interface FunJudge {
  /**
   * `fallbackRanking` is the caller's deterministic order of the same keys
   * (winner first). It is returned untouched whenever the model is not used.
   */
  judge(
    request: FunJudgeRequest,
    fallbackRanking: readonly string[],
    signal: AbortSignal,
    options?: FunJudgeCallOptions,
  ): Promise<FunJudgeVerdict>;
}

export interface FunJudgeCallOptions {
  /** Caller wait budget; a timeout returns the deterministic fallback. */
  readonly deadlineMs?: number;
  /** Optional transport budget; omitted keeps the adapter's own default. */
  readonly transportTimeoutMs?: number;
}

/** @deprecated Use FunJudgeCallOptions. */
export type FunJudgeJudgeOptions = FunJudgeCallOptions;

export const FUN_JUDGE_SHADOW_DEADLINE_MS = 4_000;

export interface FunJudgeShadowLog {
  readonly mode: "shadow";
  readonly outcome: FunJudgeOutcome;
  readonly source: FunJudgeVerdict["source"];
  readonly candidateCount: number;
  readonly calls: number;
  readonly cached: boolean;
  readonly latencyMs: number;
  readonly confidence: number | null;
  readonly margin: number | null;
  readonly orderAgreement: boolean | null;
  readonly model: string | null;
  readonly unavailableReason?: FunJudgeUnavailableReason;
}

export function funJudgeShadowLog(
  verdict: FunJudgeVerdict,
  candidateCount: number,
): FunJudgeShadowLog {
  return {
    mode: "shadow",
    outcome: verdict.outcome,
    source: verdict.source,
    candidateCount,
    calls: verdict.calls,
    cached: verdict.cached,
    latencyMs: Math.round(verdict.latencyMs),
    confidence: verdict.confidence,
    margin: verdict.margin,
    orderAgreement: verdict.orderAgreement,
    model: verdict.model,
    ...(verdict.unavailableReason === undefined ? {} : { unavailableReason: verdict.unavailableReason }),
  };
}

export interface FunJudgeShadowOptions {
  readonly signal?: AbortSignal;
  readonly onComplete?: (log: FunJudgeShadowLog) => void;
}

/**
 * Starts the advisory judge after the response is ready. The returned promise
 * is intentionally detached from response selection; callers may retain it in
 * tests, while production callers can simply schedule it and return.
 */
export function runFunJudgeShadow(
  judge: FunJudge,
  request: FunJudgeRequest,
  fallbackRanking: readonly string[],
  options: FunJudgeShadowOptions = {},
): Promise<FunJudgeShadowLog> {
  const signal = options.signal ?? new AbortController().signal;
  const notify = (log: FunJudgeShadowLog): void => {
    try {
      options.onComplete?.(log);
    } catch {
      // Shadow telemetry must never become a planning failure.
    }
  };
  return judge
    .judge(request, fallbackRanking, signal, {
      deadlineMs: FUN_JUDGE_SHADOW_DEADLINE_MS,
      transportTimeoutMs: FUN_JUDGE_SHADOW_DEADLINE_MS,
    })
    .then((verdict) => {
      const log = funJudgeShadowLog(verdict, request.candidates.length);
      notify(log);
      return log;
    })
    .catch(() => {
      // The existing public taxonomy has no additional shadow failure state.
      // A throwing injected judge therefore remains advisory and silent.
      const log: FunJudgeShadowLog = {
        mode: "shadow",
        outcome: "unavailable",
        source: "fallback",
        candidateCount: request.candidates.length,
        calls: 0,
        cached: false,
        latencyMs: 0,
        confidence: null,
        margin: null,
        orderAgreement: null,
        model: null,
        unavailableReason: "transport-error",
      };
      notify(log);
      return log;
    });
}

/** One order's answer re-keyed by evidence fingerprint. */
type OrderResult =
  | {
      readonly status: "ok";
      readonly probabilities: ReadonlyMap<string, number>;
      readonly noneProbability: number;
      readonly choice: string | null;
    }
  | {
      readonly status: "unavailable";
      readonly reason: FunJudgeUnavailableReason;
      readonly httpStatus?: number;
    };

const MINUTE_MS = 60_000;

export interface FunJudgeOptions {
  readonly policy?: FunJudgePolicy;
  /** Monotonic milliseconds; injectable for tests. */
  readonly now?: () => number;
}

export function createFunJudge(
  port: FunJudgePort,
  options: FunJudgeOptions = {},
): FunJudge {
  const policy = options.policy ?? FUN_JUDGE_POLICY_V1;
  const now = options.now ?? (() => performance.now());
  const cache = new Map<string, Promise<readonly OrderResult[]>>();
  const callTimes: number[] = [];

  function reserve(calls: number): boolean {
    const time = now();
    while (callTimes.length > 0 && time - callTimes[0]! >= MINUTE_MS) callTimes.shift();
    if (callTimes.length + calls > policy.maxCallsPerMinute) return false;
    for (let i = 0; i < calls; i += 1) callTimes.push(time);
    return true;
  }

  function remember(key: string, pending: Promise<readonly OrderResult[]>): void {
    if (cache.size >= policy.cacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, pending);
  }

  return {
    async judge(request, fallbackRanking, signal, judgeOptions = {}) {
      const start = now();
      const elapsed = () => Math.max(0, now() - start);
      const deadlineMs = Number.isFinite(judgeOptions.deadlineMs) && (judgeOptions.deadlineMs ?? 0) > 0
        ? judgeOptions.deadlineMs!
        : policy.deadlineMs;
      const transportTimeoutMs = Number.isFinite(judgeOptions.transportTimeoutMs) &&
        (judgeOptions.transportTimeoutMs ?? 0) > 0
        ? Math.max(1, Math.ceil(judgeOptions.transportTimeoutMs!))
        : undefined;
      const fallback = (
        outcome: Exclude<FunJudgeOutcome, "preferred">,
        extra: Partial<FunJudgeVerdict> = {},
      ): FunJudgeVerdict => ({
        source: "fallback",
        outcome,
        preferredKey: null,
        ranking: [...fallbackRanking],
        confidence: null,
        margin: null,
        noneProbability: null,
        orderAgreement: null,
        model: port.modelId,
        calls: 0,
        cached: false,
        latencyMs: elapsed(),
        ...extra,
      });

      if (!isValidRequest(request, fallbackRanking)) return fallback("invalid-request");
      const fingerprints = request.candidates.map(evidenceFingerprint);
      if (new Set(fingerprints).size !== fingerprints.length) return fallback("indistinguishable");
      const keyByFingerprint = new Map(
        request.candidates.map((candidate, index) => [fingerprints[index]!, candidate.key]),
      );
      const cacheKey = [
        port.modelId,
        request.intent.roadCharacter,
        request.intent.surfacePreference,
        String(request.intent.avoidHighways),
        policy.callsPerJudgement,
        ...[...fingerprints].sort(),
      ].join("#");

      let pending = cache.get(cacheKey);
      const cached = pending !== undefined;
      let calls = 0;
      if (pending === undefined) {
        if (signal.aborted) return fallback("unavailable", { unavailableReason: "aborted" });
        if (!reserve(policy.callsPerJudgement)) return fallback("budget-exhausted");
        calls = policy.callsPerJudgement;
        const orders = policy.callsPerJudgement === 2
          ? [request.candidates, [...request.candidates].reverse()]
          : [request.candidates];
        // The model call deliberately does not inherit the caller's signal: a
        // plan that stops waiting still lets the answer land in the cache.
        pending = Promise.all(
          orders.map((candidates) =>
            port
              .rank(
                { intent: request.intent, candidates },
                AbortSignal.timeout(MINUTE_MS),
                transportTimeoutMs === undefined ? undefined : { timeoutMs: transportTimeoutMs },
              )
              .then(
                (answer) => rekey(answer, candidates, fingerprints, request.candidates),
                (): OrderResult => ({ status: "unavailable", reason: "transport-error" }),
              ),
          ),
        );
        const settled = pending;
        remember(cacheKey, settled);
        // Transient failures are not remembered: the next identical plan retries.
        void settled.then((results) => {
          if (results.some((result) => result.status !== "ok") && cache.get(cacheKey) === settled) {
            cache.delete(cacheKey);
          }
        });
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const results = await Promise.race<readonly OrderResult[] | "timeout" | "aborted">([
        pending,
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), deadlineMs);
        }),
        new Promise<"aborted">((resolve) => {
          onAbort = () => resolve("aborted");
          if (signal.aborted) resolve("aborted");
          else signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]).finally(() => {
        clearTimeout(timer);
        if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      });

      if (results === "timeout") return fallback("timeout", { calls, cached });
      if (results === "aborted") {
        return fallback("unavailable", { calls, cached, unavailableReason: "aborted" });
      }
      const failure = results.find(
        (result): result is Extract<OrderResult, { status: "unavailable" }> =>
          result.status === "unavailable",
      );
      if (failure !== undefined) {
        return fallback("unavailable", {
          calls,
          cached,
          unavailableReason: failure.reason,
          ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
        });
      }
      const ok = results as readonly Extract<OrderResult, { status: "ok" }>[];
      const mean = (fingerprint: string): number =>
        ok.reduce((sum, result) => sum + (result.probabilities.get(fingerprint) ?? 0), 0) /
        ok.length;
      const noneProbability =
        ok.reduce((sum, result) => sum + result.noneProbability, 0) / ok.length;
      const orderAgreement = ok.length > 1
        ? ok.every((result) => result.choice === ok[0]!.choice)
        : null;
      const ordered = [...fingerprints].sort(
        (left, right) => mean(right) - mean(left) || fingerprints.indexOf(left) - fingerprints.indexOf(right),
      );
      const modelRanking = ordered.map((fingerprint) => keyByFingerprint.get(fingerprint)!);
      const choice = ok[0]!.choice;
      const confidence = choice === null ? null : mean(choice);
      const runnerUp = choice === null
        ? null
        : Math.max(0, ...fingerprints.filter((f) => f !== choice).map(mean));
      const margin = confidence === null || runnerUp === null ? null : confidence - runnerUp;
      const measured = { calls, cached, noneProbability, orderAgreement, confidence, margin };

      if (orderAgreement === false) return fallback("order-disagreement", measured);
      if (choice === null) return fallback("no-preference", measured);
      if (
        confidence === null || margin === null ||
        confidence < policy.minConfidence ||
        margin < policy.minMargin ||
        noneProbability > policy.maxNoneProbability ||
        ordered[0] !== choice
      ) {
        return fallback("low-confidence", measured);
      }
      return {
        source: "jev",
        outcome: "preferred",
        preferredKey: keyByFingerprint.get(choice)!,
        ranking: modelRanking,
        confidence,
        margin,
        noneProbability,
        orderAgreement,
        model: port.modelId,
        calls,
        cached,
        latencyMs: elapsed(),
      };
    },
  };
}

function rekey(
  answer: FunJudgeAnswer,
  presented: readonly FunJudgeCandidateEvidence[],
  fingerprints: readonly string[],
  original: readonly FunJudgeCandidateEvidence[],
): OrderResult {
  if (answer.status !== "ok") {
    return {
      status: "unavailable",
      reason: answer.reason,
      ...(answer.httpStatus === undefined ? {} : { httpStatus: answer.httpStatus }),
    };
  }
  const fingerprintByKey = new Map(
    original.map((candidate, index) => [candidate.key, fingerprints[index]!]),
  );
  const probabilities = new Map<string, number>();
  for (const candidate of presented) {
    const probability = answer.probabilities[candidate.key];
    const fingerprint = fingerprintByKey.get(candidate.key);
    if (typeof probability !== "number" || fingerprint === undefined) {
      return { status: "unavailable", reason: "invalid-response" };
    }
    probabilities.set(fingerprint, probability);
  }
  const choice = answer.choiceKey === null ? null : fingerprintByKey.get(answer.choiceKey);
  if (choice === undefined) return { status: "unavailable", reason: "invalid-response" };
  return { status: "ok", probabilities, noneProbability: answer.noneProbability, choice };
}

function isValidRequest(
  request: FunJudgeRequest,
  fallbackRanking: readonly string[],
): boolean {
  const keys = request.candidates.map((candidate) => candidate.key);
  return (
    request.candidates.length >= FUN_JUDGE_MIN_CANDIDATES &&
    request.candidates.length <= FUN_JUDGE_MAX_CANDIDATES &&
    new Set(keys).size === keys.length &&
    fallbackRanking.length === keys.length &&
    fallbackRanking.every((key) => keys.includes(key)) &&
    request.candidates.every(isValidEvidence)
  );
}

const UNIT_KEYS = [
  "curvature",
  "curvatureContinuity",
  "backroadShare",
  "surfaceFit",
  "elevation",
  "trafficFlow",
  "junctionFlow",
  "novelty",
  "mappedGravelAffinity",
] as const satisfies readonly (keyof FunJudgeCandidateEvidence)[];

function unitOrNull(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function isValidEvidence(candidate: FunJudgeCandidateEvidence): boolean {
  const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0;
  return (
    typeof candidate.key === "string" && candidate.key.length > 0 &&
    finiteNonNegative(candidate.durationMinutes) &&
    finiteNonNegative(candidate.distanceMiles) &&
    finiteNonNegative(candidate.addedTimePct) &&
    UNIT_KEYS.every((key) => unitOrNull(candidate[key])) &&
    (candidate.maneuversPer10Miles === null || finiteNonNegative(candidate.maneuversPer10Miles)) &&
    isValidFunJudgeFormulaEvidence(candidate.formulaEvidence) &&
    unitOrNull(candidate.evidenceCoverage) && candidate.evidenceCoverage !== null &&
    (candidate.rideArc === null ||
      (unitOrNull(candidate.rideArc.escapeShare) &&
        unitOrNull(candidate.rideArc.coreShare) &&
        unitOrNull(candidate.rideArc.returnShare) &&
        unitOrNull(candidate.rideArc.coreQuality)))
  );
}

/**
 * The cache identity of one candidate's evidence: exactly what the model sees
 * (the shared projection), never the opaque key or its position.
 */
export function evidenceFingerprint(candidate: FunJudgeCandidateEvidence): string {
  return JSON.stringify(projectFunJudgeEvidence(candidate));
}
