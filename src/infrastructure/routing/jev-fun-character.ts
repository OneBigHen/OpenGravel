/** Optional TypeSafe AI character reading of an already-scored route. */

import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

import type { FunAssessment } from "@/domain/route/fun";
import type { RoutePlanFunCharacterWire } from "@/application/planner/ports/route-plan-contract";
import { isPinnedJevProviderModel, JEV_DIRECT_MODEL } from "./jev-models";

const TIMEOUT_MS = 1_500;
const MINIMUM_CONFIDENCE = 0.65;
/**
 * Pinned for reproducible diagnostics. Changing this requires an explicit
 * calibration/replay decision; do not silently switch back to jev-latest.
 */
export const JEV_CHARACTER_MODEL = JEV_DIRECT_MODEL;

const CHARACTER_CHOICES = {
  FLOWING: "Sustained curves and few interruptions, with a smooth riding rhythm.",
  TWISTY: "Frequent meaningful curves are the dominant riding character.",
  BACKROAD: "Smaller roads and a non-arterial setting are the dominant character.",
  DIRT_FOCUSED: "Known unpaved or verified gravel riding is the dominant character.",
  UNKNOWN: "The aggregate evidence is too sparse or mixed to name one character.",
} as const;

export type JevCharacter = RoutePlanFunCharacterWire["label"];

export interface JevCharacterReading {
  readonly label: JevCharacter;
  readonly confidence: number;
  readonly model: string;
}

export interface JevCharacterClassifier {
  classify(assessment: FunAssessment, signal: AbortSignal): Promise<JevCharacterReading | null>;
}

/** The key is server-only. No key means no classifier and no model call. */
export function jevCharacterClassifierFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly fetcher?: typeof fetch } = {},
): JevCharacterClassifier | null {
  const apiKey = env["JEV_API_KEY"]?.trim();
  if (apiKey === undefined || apiKey === "") return null;
  let client: TypeSafeClient;
  try {
    client = new TypeSafeClient({
      apiKey,
      defaultModel: JEV_CHARACTER_MODEL,
      timeout: TIMEOUT_MS,
      retry: { maxRetries: 0 },
      logLevel: "off",
      ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    });
  } catch {
    return null;
  }

  return {
    async classify(assessment, signal) {
      if (assessment.classification === "unknown") return null;
      const result = await client.systemOne({
        state: {
          policyVersion: assessment.policyVersion,
          deterministicClassification: assessment.classification,
          deterministicScore: assessment.score,
          evidenceCoverage: assessment.coverage,
          features: { ...assessment.features },
        },
        questions: {
          character: choice(
            "Name the predominant recreational motorcycle route character from the supplied aggregate measurements only. Unknown values provide no evidence. A high mappedGravelAffinity is verified gravel-route evidence and can outweigh backroad share for DIRT_FOCUSED; surfaceFit alone does not establish dirt. Do not infer road access, legality or safety.",
            CHARACTER_CHOICES,
          ),
        },
      }, { signal, timeout: TIMEOUT_MS, retry: { maxRetries: 0 } });

      const answer = result.answers.character;
      if (
        answer?.type !== "choice" ||
        !Object.hasOwn(CHARACTER_CHOICES, answer.choice) ||
        !Number.isFinite(answer.confidence) ||
        answer.confidence < 0 || answer.confidence > 1 ||
        !isPinnedJevProviderModel(result.model, "typesafe")
      ) return null;

      return {
        label: answer.confidence >= MINIMUM_CONFIDENCE
          ? answer.choice as JevCharacter
          : "UNKNOWN",
        confidence: answer.confidence,
        model: result.model,
      };
    },
  };
}

/** How long a plan waits for a reading before answering without one. */
export const READING_BUDGET_MS = 800;
const CACHE_LIMIT = 500;

/**
 * Keeps model latency off the planning path. Readings are cached by the
 * aggregate assessment (the only thing the model sees), and concurrent plans
 * share one call. The plan waits at most `budgetMs`; a slower call keeps running
 * on its own timeout and fills the cache for the next identical plan.
 */
export function budgetedCharacterClassifier(
  inner: JevCharacterClassifier,
  options: { readonly budgetMs?: number } = {},
): JevCharacterClassifier {
  const budgetMs = options.budgetMs ?? READING_BUDGET_MS;
  const cache = new Map<string, Promise<JevCharacterReading | null>>();

  function readingFor(assessment: FunAssessment): Promise<JevCharacterReading | null> {
    const key = cacheKey(assessment);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const pending = inner.classify(assessment, AbortSignal.timeout(TIMEOUT_MS)).catch(() => {
      cache.delete(key);
      return null;
    });
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, pending);
    return pending;
  }

  return {
    async classify(assessment, signal) {
      if (assessment.classification === "unknown" || signal.aborted) return null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budgetMs);
        signal.addEventListener("abort", () => resolve(null), { once: true });
      });
      try {
        return await Promise.race([readingFor(assessment), deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function cacheKey(assessment: FunAssessment): string {
  const features = Object.entries(assessment.features)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}:${typeof value === "number" ? value.toFixed(2) : String(value)}`);
  return [assessment.policyVersion, assessment.classification, assessment.coverage.toFixed(2), ...features].join("|");
}
