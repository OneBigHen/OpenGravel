/**
 * Our own graph first, GraphHopper's hosted API when ours cannot answer
 * (WORK-ORDER §1.2).
 *
 * The self-hosted engine covers one region (its `/info` bbox). A ride with any
 * point outside that box goes straight to the hosted API; a ride inside it goes
 * to ours, and only an outage (unreachable or timed out) retries on the hosted
 * API. A rider's own `no-route` or validation answer is never retried: the
 * hosted graph would only answer a different question.
 *
 * The hosted free plan is 500 credits a day, so the fallback keeps its own daily
 * budget and stops asking before the plan refuses.
 */

import type {
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { GraphHopperProviderError } from "./response-parser";

/** `[minLon, minLat, maxLon, maxLat]`, as GraphHopper's `/info` reports it. */
export type CoverageBox = readonly [number, number, number, number];

export interface FallbackRouteProviderOptions {
  readonly primary: RouteCandidateProvider;
  readonly hosted: RouteCandidateProvider;
  /** The primary graph's coverage, or `null` when it is unknown (then: try the primary). */
  readonly coverage: () => Promise<CoverageBox | null>;
  /** Hosted calls allowed per UTC day. */
  readonly dailyBudget: number;
  readonly now?: () => number;
}

/** How long lanes of one ride may share a hosted answer. */
const SHARED_ANSWER_MS = 60_000;

/** Engine failures that mean "our router cannot answer" (down, or off its graph), not "no such ride". */
const OUTAGE_CODES: ReadonlySet<string> = new Set(["provider-unavailable", "provider-timeout", "outside-coverage"]);

export interface HostedBudgetState {
  readonly day: string;
  readonly used: number;
  readonly budget: number;
}

export interface FallbackRouteProvider extends RouteCandidateProvider {
  /** Today's hosted spend, for health reporting. */
  hostedBudget(): HostedBudgetState;
}

export function createFallbackRouteProvider(options: FallbackRouteProviderOptions): FallbackRouteProvider {
  const now = options.now ?? Date.now;
  let day = "";
  let used = 0;
  const shared = new Map<string, { readonly at: number; readonly answer: Promise<ProviderCandidateSet> }>();

  const today = (): string => new Date(now()).toISOString().slice(0, 10);
  const rollDay = (): void => {
    const current = today();
    if (current !== day) {
      day = current;
      used = 0;
    }
  };

  const askHosted = async (
    request: ProviderRouteRequest,
    signal: AbortSignal,
    cause: unknown,
  ): Promise<ProviderCandidateSet> => {
    rollDay();
    if (used >= options.dailyBudget) {
      if (cause !== undefined) throw cause;
      throw new GraphHopperProviderError(
        "This ride is outside the area OpenGravel can route today. Try again tomorrow, or plan inside Pennsylvania and nearby states.",
        "provider-unavailable",
        { recoverable: false },
      );
    }
    // Every lane of one ride asks the same stock-profile question, so the lanes
    // share one hosted answer (and one credit) instead of spending one each.
    const key = hostedKey(request);
    const time = now();
    for (const [cachedKey, entry] of shared) if (time - entry.at > SHARED_ANSWER_MS) shared.delete(cachedKey);
    let entry = shared.get(key);
    if (entry === undefined) {
      used += 1;
      entry = { at: time, answer: options.hosted.candidates(request, signal) };
      shared.set(key, entry);
      entry.answer.catch(() => shared.delete(key));
    }
    const answer = await entry.answer;
    return {
      ...answer,
      candidates: answer.candidates.map((candidate) => ({ ...candidate, profile: request.profile })),
    };
  };

  return {
    id: options.primary.id,

    capabilities(): ProviderCapabilities {
      return options.primary.capabilities();
    },

    hostedBudget(): HostedBudgetState {
      rollDay();
      return { day, used, budget: options.dailyBudget };
    },

    async candidates(request: ProviderRouteRequest, signal: AbortSignal): Promise<ProviderCandidateSet> {
      const box = await options.coverage().catch(() => null);
      if (box !== null && !requestPoints(request).every((point) => inside(box, point))) {
        return askHosted(request, signal, undefined);
      }
      try {
        return await options.primary.candidates(request, signal);
      } catch (caught) {
        if (signal.aborted || !isOutage(caught)) throw caught;
        return askHosted(request, signal, caught);
      }
    },
  };
}

/** The hosted question without the lane: the stock profile ignores it. */
function hostedKey(request: ProviderRouteRequest): string {
  return JSON.stringify({ ...request, profile: null, requestId: null });
}

function isOutage(error: unknown): boolean {
  return error instanceof GraphHopperProviderError && OUTAGE_CODES.has(error.code);
}

function requestPoints(request: ProviderRouteRequest): readonly Coordinate[] {
  return [
    request.origin,
    ...request.stops,
    ...request.shaping,
    request.destination,
  ];
}

function inside(box: CoverageBox, point: Coordinate): boolean {
  const [minLon, minLat, maxLon, maxLat] = box;
  return point.lon >= minLon && point.lon <= maxLon && point.lat >= minLat && point.lat <= maxLat;
}

/**
 * Reads and caches the engine's coverage box from `/info`.
 *
 * A failed read caches nothing, so the next ride asks again; a good read is kept
 * for `ttlMs` because the graph changes only on a rebuild.
 */
export function engineCoverage(options: {
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  readonly ttlMs?: number;
  readonly now?: () => number;
}): () => Promise<CoverageBox | null> {
  const fetcher = options.fetcher ?? fetch;
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  let cached: { readonly box: CoverageBox; readonly at: number } | null = null;
  return async () => {
    if (cached !== null && now() - cached.at < ttlMs) return cached.box;
    try {
      const response = await fetcher(`${options.baseUrl.replace(/\/+$/, "")}/info`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { readonly bbox?: unknown };
      const bbox = body.bbox;
      if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((value) => typeof value === "number")) {
        return null;
      }
      cached = { box: bbox as unknown as CoverageBox, at: now() };
      return cached.box;
    } catch {
      return null;
    }
  };
}
