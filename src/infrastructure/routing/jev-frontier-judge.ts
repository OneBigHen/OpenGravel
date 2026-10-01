/** Server-only transport for the application-owned shadow judge; no planner hook. */
import "server-only";
import {
  APIError,
  APITimeoutError,
  APIUserAbortError,
  choice,
  noul,
  score,
  TypeSafeClient,
  type Questions,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";
import {
  JEV_FRONTIER_NONE,
  projectJevFrontierTransportState,
  validateJevFrontierJudgment,
  type JevFrontierJudge,
  type JevFrontierJudgeInput,
  type JevFrontierJudgeResult,
} from "@/application/planner/ports/jev-frontier-judge";
import { isPinnedJevProviderModel, JEV_DIRECT_MODEL, JEV_OPENROUTER_MODEL, type JevProvider } from "./jev-models";

export const JEV_FRONTIER_TIMEOUT_MS = 1500;
const FIT_INSTRUCTIONS =
  "Use only supplied measurements and explicit current intent/preferences. Unknown is not evidence. Do not infer legality, access, closure, safety, missing road facts, surface truth or unsupplied characteristics.";
const FIT_RUBRIC = [
  "Poor fit — materially conflicts with supplied current intent/preference.",
  "Acceptable — usable but little evidence of a particularly strong match.",
  "Strong — clearly matches several supplied priorities without a material supplied tradeoff.",
  "Exceptional — unusually strong match across priorities supported by the supplied evidence.",
] as const;

/** A new allowlisted request per variant and permutation; never serialize internal state. */
export function buildJevFrontierRequest(
  input: JevFrontierJudgeInput,
  provider: JevProvider = "openrouter",
): SystemOneRequest | null {
  if (!record(input) || !["openrouter", "typesafe"].includes(provider)) return null;
  const projected = projectJevFrontierTransportState(
    input.state,
    input.permutation,
    input.variant,
  );
  if (projected === null) return null;
  const criteria = Object.fromEntries(
    projected.candidates.map((c) => [
      c.slot,
      `The already-eligible candidate described by candidates[slot=${c.slot}]: distanceMeters is its measured length; durationSeconds is its measured travel time; frontier contains normalized road characteristics, with larger values indicating more of that quality; coherence contains measured interruptions/repetition; evidenceCoverage describes available evidence. Compare those supplied facts with current intent and any supplied rider summary. Null fields supply no evidence.`,
    ]),
  );
  const questions: Questions = {
    choose: choice(
      `Choose the already-eligible candidate best matching the rider's explicit current intent and supplied rider-preference summary. Choose NONE if supplied evidence does not support a meaningful preference. ${FIT_INSTRUCTIONS}`,
      {
        ...criteria,
        NONE: "Evidence does not support a meaningful preference.",
      },
    ),
  };
  for (const { slot } of projected.candidates) {
    questions[`fit_${slot}`] = score(
      `Evaluate semantic rider fit of candidate slot ${slot} using the fixed rubric. ${FIT_INSTRUCTIONS}`,
      FIT_RUBRIC,
    );
  }
  const baseline = input.permutation.slots.find(
    (s) => s.candidateId === input.state.deterministicBaselineId,
  )!.slot;
  questions.improvement = noul(
    `At least one supplied candidate other than baseline slot ${baseline} is meaningfully better matched than that deterministic baseline to this rider's explicit current intent and supplied rider-preference summary. Assess this proposition independently; do not refer to any Choice or Score answer. ${FIT_INSTRUCTIONS}`,
  );
  // JSON cloning severs aliases to caller-owned objects before any asynchronous work.
  return {
    model: provider === "typesafe" ? JEV_DIRECT_MODEL : JEV_OPENROUTER_MODEL,
    state: JSON.parse(JSON.stringify(projected)),
    questions,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function token(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function decode(
  input: JevFrontierJudgeInput,
  raw: unknown,
  latencyMs: number,
  provider: JevProvider,
): JevFrontierJudgeResult {
  if (!record(raw) || !record(raw.answers))
    return { status: "invalid", reason: "malformed-response", latencyMs };
  if (!isPinnedJevProviderModel(raw.model, provider))
    return { status: "invalid", reason: "invalid-model", latencyMs };
  const answers = raw.answers;
  const expectedKeys = [
    "choose",
    "improvement",
    ...input.permutation.slots.map((s) => `fit_${s.slot}`),
  ];
  if (
    Object.keys(answers).length !== expectedKeys.length ||
    expectedKeys.some((k) => !Object.hasOwn(answers, k))
  ) {
    return { status: "invalid", reason: "malformed-response", latencyMs };
  }
  const answer = answers.choose;
  if (!record(answer) || !record(answer.probabilities))
    return { status: "invalid", reason: "invalid-choice", latencyMs };
  const slotMap = new Map(
    input.permutation.slots.map((s) => [s.slot as string, s.candidateId]),
  );
  const probabilityKeys = Object.keys(answer.probabilities);
  if (
    probabilityKeys.length !== slotMap.size + 1 ||
    probabilityKeys.some((s) => s !== JEV_FRONTIER_NONE && !slotMap.has(s))
  ) {
    return {
      status: "invalid",
      reason: "invalid-choice-distribution",
      latencyMs,
    };
  }
  if (
    typeof answer.choice !== "string" ||
    (answer.choice !== JEV_FRONTIER_NONE && !slotMap.has(answer.choice))
  ) {
    return { status: "invalid", reason: "invalid-choice", latencyMs };
  }
  const fits = Object.fromEntries(
    input.permutation.slots.map(({ slot, candidateId }) => {
      const fit = answers[`fit_${slot}`];
      // The SDK's rubric legend is descriptive metadata, never semantic output.
      return [
        candidateId,
        record(fit)
          ? {
              type: fit.type,
              score: fit.score,
              probabilities: fit.probabilities,
              confidence: fit.confidence,
            }
          : fit,
      ];
    }),
  );
  const validation = validateJevFrontierJudgment(input.state, {
    model: raw.model,
    choice: {
      type: answer.type,
      choice: slotMap.get(answer.choice) ?? JEV_FRONTIER_NONE,
      confidence: answer.confidence,
      probabilities: Object.fromEntries(
        Object.entries(answer.probabilities).map(([s, p]) => [
          slotMap.get(s) ?? JEV_FRONTIER_NONE,
          p,
        ]),
      ),
    },
    fitByCandidateId: fits,
    meaningfulImprovement: answers.improvement,
  });
  if (!validation.ok)
    return { status: "invalid", reason: validation.reason, latencyMs };
  const usage = record(raw.usage) ? raw.usage : {};
  return {
    status: "ok",
    judgment: validation.judgment,
    latencyMs,
    usage: {
      inputTokens: token(usage.input_tokens),
      outputTokens: token(usage.output_tokens),
      cost:
        typeof usage.cost === "number" &&
        Number.isFinite(usage.cost) &&
        usage.cost >= 0
          ? usage.cost
          : null,
    },
  };
}

/** Explicit provider selection; no cross-provider credential fallback or environment URL override. */
export function jevFrontierJudgeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly fetcher?: typeof fetch } = {},
): JevFrontierJudge {
  const provider = env.OGV_JEV_FRONTIER_PROVIDER ?? "openrouter";
  const apiKey =
    provider === "typesafe"
      ? env.JEV_API_KEY?.trim()
      : provider === "openrouter"
        ? env.OPENROUTER_API_KEY?.trim()
        : undefined;
  const enabled = env.OGV_JEV_FRONTIER_SHADOW === "1" && !!apiKey;
  const client = enabled
    ? new TypeSafeClient({
        apiKey,
        baseURL:
          provider === "typesafe"
            ? "https://api.typesafe.ai"
            : "https://openrouter.ai/api",
        defaultModel: provider === "typesafe" ? JEV_DIRECT_MODEL : JEV_OPENROUTER_MODEL,
        timeout: JEV_FRONTIER_TIMEOUT_MS,
        retry: { maxRetries: 0 },
        logLevel: "off",
        ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
      })
    : null;
  return {
    async judge(input, signal) {
      const start = performance.now();
      const latency = () => Math.max(0, performance.now() - start);
      if (signal.aborted)
        return { status: "skipped", reason: "cancelled", latencyMs: latency() };
      if (client === null)
        return { status: "skipped", reason: "disabled", latencyMs: latency() };
      const selectedProvider: JevProvider = provider === "typesafe" ? "typesafe" : "openrouter";
      const request = buildJevFrontierRequest(input, selectedProvider);
      if (request === null)
        return {
          status: "skipped",
          reason: "invalid-state",
          latencyMs: latency(),
        };
      // Response mapping is fenced to the exact internal input that produced the wire request.
      const snapshot = structuredClone(input);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        const deadline = new Promise<JevFrontierJudgeResult>((resolve) => {
          onAbort = () => {
            controller.abort();
            resolve({
              status: "failed",
              reason: "aborted",
              latencyMs: latency(),
            });
          };
          signal.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => {
            controller.abort();
            resolve({
              status: "failed",
              reason: "timeout",
              latencyMs: latency(),
            });
          }, JEV_FRONTIER_TIMEOUT_MS);
        });
        const response = Promise.resolve(
          client.systemOne(request, {
            signal: controller.signal,
            timeout: JEV_FRONTIER_TIMEOUT_MS,
            retry: { maxRetries: 0 },
          }),
        ).then(
          (raw: unknown) => decode(snapshot, raw, latency(), selectedProvider),
          (error: unknown): JevFrontierJudgeResult => ({
            status: "failed",
            reason:
              signal.aborted ||
              (error instanceof APIUserAbortError && !controller.signal.aborted)
                ? "aborted"
                : error instanceof APITimeoutError
                  ? "timeout"
                  : "transport-error",
            latencyMs: latency(),
            ...(error instanceof APIError &&
            Number.isInteger(error.status) &&
            error.status >= 100 &&
            error.status <= 599
              ? { httpStatus: error.status }
              : {}),
          }),
        );
        return await Promise.race([response, deadline]);
      } catch {
        return {
          status: "failed",
          reason: signal.aborted ? "aborted" : "transport-error",
          latencyMs: latency(),
        };
      } finally {
        clearTimeout(timer);
        if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
