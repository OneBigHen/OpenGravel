/**
 * TypeSafe Jev implementation of the provider-neutral FUN JUDGE port.
 *
 * Direct TypeSafe only (server-side `JEV_API_KEY`, fixed service URL), pinned
 * to the frozen jev-1.13.0 release, zero retries, a hard per-call deadline and
 * SDK logging off. The model sees the shared rounded projection of aggregate
 * evidence under anonymous slots; candidate keys, geometry, ids, scores and the
 * deterministic winner never leave the server. Any malformed, mis-pinned or
 * inconsistent answer is `unavailable`, never a guess.
 *
 * Server-side by construction: its only importer is the server plan service
 * (enforced by tests/architecture/jev-shadow-boundary.test.ts), and the key is
 * not NEXT_PUBLIC so Next.js never inlines it into a browser bundle.
 */

import {
  APIError,
  APITimeoutError,
  choice,
  TypeSafeClient,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";

import {
  FUN_JUDGE_MAX_CANDIDATES,
  FUN_JUDGE_MIN_CANDIDATES,
  projectFunJudgeEvidence,
  type FunJudgeAnswer,
  type FunJudgePort,
  type FunJudgeRequest,
} from "@/application/planner/ports/fun-judge";
import { isPinnedJevProviderModel, JEV_DIRECT_MODEL } from "./jev-models";

export const JEV_FUN_JUDGE_TIMEOUT_MS = 1_500;
export const JEV_FUN_JUDGE_NONE = "NONE";
const SLOTS = ["A", "B", "C"] as const;
const PROBABILITY_SUM_TOLERANCE = 0.02;
const TYPESAFE_BASE_URL = "https://api.typesafe.ai";

const INSTRUCTIONS =
  "You are judging recreational motorcycle routes. Every candidate has ALREADY passed OpenGravel's legality, access, closure and time-budget checks; do not reconsider them. " +
  "Choose the candidate that will be the most enjoyable ride for this rider's stated intent, using only the supplied aggregate measurements. " +
  "0..1 features: larger means more of that quality (curvature = bendiness, curvatureContinuity = sustained flowing curves, backroadShare = share on small non-arterial roads, surfaceFit = match to the surface preference, elevation = terrain relief, trafficFlow/junctionFlow = fewer interruptions, novelty = roads new to the rider, mappedGravelAffinity = verified gravel routes). " +
  "addedTimePct is extra time versus the fastest eligible option, already inside the rider's budget. maneuversPer10Miles counts turns/instructions. rideArc splits the route into escape, core ride and return. " +
  "null means unmeasured and is not evidence either way. Choose NONE if the supplied evidence does not support a meaningful preference.";

function slotDescription(slot: string): string {
  return `The candidate described by state.candidates[slot=${slot}].`;
}

/** A fresh allowlisted request: anonymous slots and rounded aggregates only. */
export function buildJevFunJudgeRequest(request: FunJudgeRequest): SystemOneRequest | null {
  const count = request.candidates.length;
  if (count < FUN_JUDGE_MIN_CANDIDATES || count > FUN_JUDGE_MAX_CANDIDATES) return null;
  const slots = SLOTS.slice(0, count);
  const criteria: Record<string, string> = {};
  for (const slot of slots) criteria[slot] = slotDescription(slot);
  criteria[JEV_FUN_JUDGE_NONE] = "The evidence does not support a meaningful preference.";
  return {
    model: JEV_DIRECT_MODEL,
    // JSON cloning keeps the wire a plain JSON value with no caller aliases.
    state: JSON.parse(JSON.stringify({
      intent: {
        roadCharacter: request.intent.roadCharacter,
        surfacePreference: request.intent.surfacePreference,
        avoidHighways: request.intent.avoidHighways,
      },
      candidates: request.candidates.map((candidate, index) => ({
        slot: slots[index]!,
        ...projectFunJudgeEvidence(candidate),
      })),
    })),
    questions: { fun: choice(INSTRUCTIONS, criteria) },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Strict decode against the exact request that produced it. */
export function decodeJevFunJudgeAnswer(
  request: FunJudgeRequest,
  raw: unknown,
  latencyMs: number,
): FunJudgeAnswer {
  const invalid: FunJudgeAnswer = { status: "unavailable", reason: "invalid-response", latencyMs };
  if (!isRecord(raw) || !isRecord(raw.answers)) return invalid;
  if (!isPinnedJevProviderModel(raw.model, "typesafe")) return invalid;
  const answers = raw.answers;
  if (Object.keys(answers).length !== 1) return invalid;
  const answer = answers.fun;
  if (!isRecord(answer) || answer.type !== "choice" || !isRecord(answer.probabilities)) return invalid;
  const slots = SLOTS.slice(0, request.candidates.length);
  const expected = [...slots, JEV_FUN_JUDGE_NONE] as string[];
  const probabilities = answer.probabilities;
  const keys = Object.keys(probabilities);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(probabilities, key))) {
    return invalid;
  }
  if (!expected.every((key) => isUnit(probabilities[key]))) return invalid;
  const sum = expected.reduce((total, key) => total + (probabilities[key] as number), 0);
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) return invalid;
  if (typeof answer.choice !== "string" || !expected.includes(answer.choice)) return invalid;
  if (!isUnit(answer.confidence)) return invalid;
  const byKey: Record<string, number> = {};
  slots.forEach((slot, index) => {
    byKey[request.candidates[index]!.key] = (probabilities[slot] as number) / sum;
  });
  const slotIndex = (slots as readonly string[]).indexOf(answer.choice);
  return {
    status: "ok",
    probabilities: byKey,
    noneProbability: (probabilities[JEV_FUN_JUDGE_NONE] as number) / sum,
    choiceKey: slotIndex < 0 ? null : request.candidates[slotIndex]!.key,
    confidence: answer.confidence,
    model: raw.model as string,
    latencyMs,
  };
}

/**
 * `null` when no key is configured: no client, no calls. The caller decides
 * whether the judge runs at all (`OGV_JEV_FUN_JUDGE`); this only builds it.
 */
export function jevFunJudgeFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { readonly fetcher?: typeof fetch; readonly now?: () => number } = {},
): FunJudgePort | null {
  const apiKey = env["JEV_API_KEY"]?.trim();
  if (apiKey === undefined || apiKey === "") return null;
  let client: TypeSafeClient;
  try {
    client = new TypeSafeClient({
      apiKey,
      baseURL: TYPESAFE_BASE_URL,
      defaultModel: JEV_DIRECT_MODEL,
      timeout: JEV_FUN_JUDGE_TIMEOUT_MS,
      retry: { maxRetries: 0 },
      logLevel: "off",
      ...(options.fetcher === undefined ? {} : { fetch: options.fetcher }),
    });
  } catch {
    return null;
  }
  const now = options.now ?? (() => performance.now());

  return {
    modelId: JEV_DIRECT_MODEL,
    async rank(request, signal, rankOptions = {}) {
      const start = now();
      const latency = () => Math.max(0, now() - start);
      const timeoutMs = Number.isFinite(rankOptions.timeoutMs) && (rankOptions.timeoutMs ?? 0) > 0
        ? Math.max(1, Math.ceil(rankOptions.timeoutMs!))
        : JEV_FUN_JUDGE_TIMEOUT_MS;
      if (signal.aborted) return { status: "unavailable", reason: "aborted", latencyMs: 0 };
      const wire = buildJevFunJudgeRequest(request);
      if (wire === null) return { status: "unavailable", reason: "invalid-request", latencyMs: 0 };
      // Decode against a snapshot of the exact request that was sent.
      const snapshot: FunJudgeRequest = structuredClone(request);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const raw: unknown = await client.systemOne(wire, {
          signal: controller.signal,
          timeout: timeoutMs,
          retry: { maxRetries: 0 },
        });
        return decodeJevFunJudgeAnswer(snapshot, raw, latency());
      } catch (error) {
        const httpStatus =
          error instanceof APIError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
            ? error.status
            : undefined;
        return {
          status: "unavailable",
          reason: signal.aborted
            ? "aborted"
            : error instanceof APITimeoutError || controller.signal.aborted
              ? "timeout"
              : "transport-error",
          latencyMs: latency(),
          ...(httpStatus === undefined ? {} : { httpStatus }),
        };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
