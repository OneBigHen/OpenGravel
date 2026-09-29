/**
 * GraphHopper baseline provider (17-IMPLEMENTATION-PLAN Task 2.2).
 *
 * Clean-room port of the legacy `graphhopper.ts` transport (baseline
 * `06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`) behind the VNext
 * `RouteCandidateProvider` port.
 *
 * ## What the adapter does and does not own
 *
 * It builds a request, posts it, normalizes the answer into candidates, and
 * reports failures in the §12 taxonomy. It never scores, never assigns a role,
 * never decides eligibility, never returns rider copy, and never imports a
 * planner store or a UI module (Rule E). An answer with no candidates is not
 * this adapter's choice to make: a zero-path response is a `no-route` failure,
 * and a provider outage is a rejection the planner may absorb (§3).
 *
 * ## Cancellation contract (06 §28)
 *
 * The caller's `signal` is passed into the engine call combined with a 30 s
 * timeout. The two aborts mean different things and are kept apart:
 *
 * - **Caller cancellation** rejects with the caller's own abort reason
 *   (`AbortError`), unchanged. A cancelled plan must not leave work running and
 *   must not be dressed up as a provider failure the fallback could retry.
 * - **Engine timeout** maps to `provider-timeout`, which is recoverable.
 *
 * The legacy adapter collapsed both into `ROUTE_CANCELLED` (HTTP 499), which
 * made a rider-cancelled plan indistinguishable from a hung router. That
 * deviation is deliberate and recorded as `OGV-D-164`.
 *
 * ## Degradation chain
 *
 * An active graph can predate a detail or an encoded value this deployment
 * requests. The legacy retry is preserved: one retry, once, either without the
 * detail the engine named or without the smoothness condition. The returned
 * candidates carry `providerMetadata.degraded = true`, so the pipeline can
 * treat their evidence as thinner rather than pretending nothing happened.
 */

import type {
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { GRAPHHOPPER_ENGINE_PROFILES } from "./profiles";
import {
  REQUESTED_DETAILS,
  createGraphHopperRequest,
  requestWirePoints,
  type GraphHopperRequestBody,
  type GraphHopperSpanConstraint,
  type GraphHopperWirePoint,
} from "./request-builder";
import {
  HOSTED_MAX_SKETCH_ANCHORS,
  HOSTED_SKETCH_CHUNK_POINTS,
  SELF_HOSTED_SKETCH_CHUNK_POINTS,
  routeSketch,
  thinSketchAnchors,
} from "./sketch-routing";
import {
  GraphHopperProviderError,
  normalizeGraphHopperProviderError,
  parseGraphHopperPath,
  type GraphHopperPath,
  type GraphHopperResponse,
} from "./response-parser";

/** The provider id recorded as provenance (02 §10). */
export const GRAPHHOPPER_PROVIDER_ID = "graphhopper";

/** Default engine call budget (06 §29). */
export const DEFAULT_TIMEOUT_MS = 30_000;

const ROUTE_PATH = "/route";

/**
 * Version reported when the response carries none. GraphHopper 11's `/route`
 * omits `info.version` in the baseline deployment, and 06 §2 pins GraphHopper 11
 * as the baseline, so the legacy fallback is preserved as a named constant
 * instead of a magic string. It is diagnostics only.
 */
const FALLBACK_ENGINE_VERSION = "11.0";

/** `Cannot find the path details: [name, other]` — names the graph cannot serve. */
const UNSUPPORTED_DETAIL_PATTERN = /Cannot find the path details: \[([^\]]+)\]/;
/** `'smoothness' not available` — an encoded value missing from an older graph. */
const UNSUPPORTED_ENCODED_VALUE_PATTERN = /'([^']+)' not available/;

/** Copy used when the engine cannot be reached at all. */
const UNREACHABLE_MESSAGE =
  "The routing service could not be reached. Try again in a moment.";

/** One chunk of a sketch: exactly these points, held to this band. */
interface SketchChunkOverride {
  readonly points: readonly GraphHopperWirePoint[];
  readonly band: readonly Coordinate[];
}

/** One engine answer for one discovery seed (or the one plain request). */
interface SeedAnswer {
  readonly paths: readonly GraphHopperPath[];
  readonly engineVersion: string;
  readonly degraded: boolean;
}

/** Corrections a loop gets toward its ride time (OGV-D-262). */
const LOOP_CALIBRATION_PASSES = 2;
const LOOP_SCALE_MIN = 0.25;
const LOOP_SCALE_MAX = 2;

interface RouteAttempt {
  readonly response: Response;
  readonly payload: GraphHopperResponse;
}

/** Options for {@link createGraphHopperProvider}. */
export interface GraphHopperProviderOptions {
  /** Origin of the routing engine, e.g. `http://127.0.0.1:8989`. */
  readonly baseUrl: string;
  /** Injectable `fetch` for tests and server-side transports. */
  readonly fetcher?: typeof fetch;
  /**
   * Engine call budget in milliseconds. Documented default is
   * {@link DEFAULT_TIMEOUT_MS}; the option exists so an operator can tune the
   * budget and so a suite can observe the timeout path without waiting 30 s.
   */
  readonly timeoutMs?: number;
  /**
   * Route through GraphHopper's hosted Directions API instead of our own graph
   * (WORK-ORDER §1.2). The free plan answers only the stock `car` profile with no
   * custom model, so every answer is marked `basicRouting`: the rider's road
   * character and avoid rules were not applied, and the card says so.
   */
  readonly hosted?: { readonly apiKey: string };
}

/** The stock profile the hosted free plan serves. */
const HOSTED_PROFILE = "car";
/** Details the hosted graph does not carry; asking costs a failed credit. */
const HOSTED_UNSUPPORTED_DETAILS: ReadonlySet<string> = new Set(["urban_density", "max_speed_estimated"]);

/**
 * The port's road spans projected onto the builder's span shape (04 §17).
 *
 * The mapping is field-for-field because the builder's `GraphHopperSpanConstraint`
 * is the port's `ProviderRoadSpan` plus the optional label legacy locks carried;
 * VNext spans have no rider label, so none is fabricated.
 */
function spanConstraints(
  request: ProviderRouteRequest,
): readonly GraphHopperSpanConstraint[] {
  return (request.roadSpans ?? []).map((span) => ({
    id: span.id,
    mode: span.mode,
    direction: span.direction,
    anchors: span.anchors,
    ...(span.corridor === undefined ? {} : { corridor: span.corridor }),
    ...(span.corridorToleranceMeters === undefined
      ? {}
      : { corridorToleranceMeters: span.corridorToleranceMeters }),
  }));
}

/** The detail names a rejection says the active graph cannot serve. */
function unsupportedDetailsFrom(message: string | undefined): readonly string[] {
  if (message === undefined) return [];
  const matched = UNSUPPORTED_DETAIL_PATTERN.exec(message)?.[1];
  if (matched === undefined) return [];
  return matched
    .split(",")
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
}

/** The encoded value a rejection says the active graph does not carry. */
function unsupportedEncodedValueFrom(message: string | undefined): string | null {
  if (message === undefined) return null;
  return UNSUPPORTED_ENCODED_VALUE_PATTERN.exec(message)?.[1] ?? null;
}

function detailFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function discoverySeeds(requestId: string): readonly number[] {
  // FNV-1a gives retries of one discovery the same three bounded engine seeds,
  // while a later rider request can explore another set of loops.
  let hash = 0x811c9dc5;
  for (const character of requestId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  }
  const base = hash >>> 0;
  return [0, 1, 2].map((index) => (base + index) % 2_147_483_647);
}

/**
 * Creates the GraphHopper baseline provider.
 *
 * The returned provider is stateless and safe to share: every call carries its
 * own request, signal and timeout.
 */
export function createGraphHopperProvider(
  options: GraphHopperProviderOptions,
): RouteCandidateProvider {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hosted = options.hosted;
  const routeUrl = `${options.baseUrl.replace(/\/+$/, "")}${ROUTE_PATH}${
    hosted === undefined ? "" : `?key=${encodeURIComponent(hosted.apiKey)}`
  }`;

  return {
    id: GRAPHHOPPER_PROVIDER_ID,

    capabilities(): ProviderCapabilities {
      return {
        profiles: [...GRAPHHOPPER_ENGINE_PROFILES],
        supportsAlternatives: true,
        supportsAvoidPolygons: true,
      };
    },

    async candidates(
      request: ProviderRouteRequest,
      signal: AbortSignal,
    ): Promise<ProviderCandidateSet> {
      const postRoute = async (
        details: readonly string[],
        omitSmoothness: boolean,
        roundTripSeed?: number,
        distanceScale?: number,
        chunk?: SketchChunkOverride,
      ): Promise<RouteAttempt> => {
        const built = createGraphHopperRequest(request, {
          ...(chunk === undefined ? {} : { points: chunk.points, sketchBand: chunk.band }),
          details: hosted === undefined
            ? details
            : details.filter((detail) => !HOSTED_UNSUPPORTED_DETAILS.has(detail)),
          omitSmoothness,
          spans: spanConstraints(request),
          ...(request.discovery === undefined
            ? {}
            : {
                roundTrip: {
                  targetMinutes: request.discovery.targetMinutes,
                  ...(roundTripSeed === undefined ? {} : { seed: roundTripSeed }),
                  ...(distanceScale === undefined ? {} : { distanceScale }),
                },
              }),
        });
        const body = hosted === undefined ? built : hostedBody(built);
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const combined = AbortSignal.any([signal, timeoutSignal]);
        let response: Response;
        try {
          response = await fetcher(routeUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: combined,
          });
        } catch (caught) {
          // The caller owns cancellation: its reason travels unchanged, so the
          // planner sees an abort and never a retryable provider failure.
          if (signal.aborted) {
            const reason: unknown = signal.reason;
            throw reason;
          }
          if (timeoutSignal.aborted) {
            throw new GraphHopperProviderError(
              "The routing service did not answer in time.",
              "provider-timeout",
              { recoverable: true },
            );
          }
          throw new GraphHopperProviderError(UNREACHABLE_MESSAGE, "provider-unavailable", {
            recoverable: true,
            providerDetail: detailFrom(caught),
          });
        }

        let payload: GraphHopperResponse;
        try {
          payload = (await response.json()) as GraphHopperResponse;
        } catch (caught) {
          throw new GraphHopperProviderError(
            "The routing service returned an answer that could not be read.",
            "provider-unavailable",
            { httpStatus: 502, providerDetail: detailFrom(caught) },
          );
        }
        return { response, payload };
      };

      const details = [...REQUESTED_DETAILS];
      const seeds = request.discovery === undefined ? [undefined] : discoverySeeds(request.requestId);
      const answerFor = async (
        seed: number | undefined,
        distanceScale?: number,
        chunk?: SketchChunkOverride,
      ): Promise<SeedAnswer> => {
        let attempt = await postRoute(details, false, seed, distanceScale, chunk);
        let degraded = false;

        if (!attempt.response.ok) {
          const unsupportedDetails = unsupportedDetailsFrom(attempt.payload.message);
          const unsupportedEncodedValue = unsupportedEncodedValueFrom(attempt.payload.message);
          if (unsupportedDetails.length > 0 || unsupportedEncodedValue === "smoothness") {
            degraded = true;
            attempt = await postRoute(
              unsupportedDetails.length === 0
                ? details
                : details.filter((detail) => !unsupportedDetails.includes(detail)),
              unsupportedEncodedValue === "smoothness",
              seed,
              distanceScale,
              chunk,
            );
          }
        }

        if (!attempt.response.ok) {
          throw normalizeGraphHopperProviderError(
            attempt.response.status,
            attempt.payload.message ?? attempt.response.statusText,
          );
        }
        const paths = attempt.payload.paths ?? [];
        if (paths.length === 0) {
          throw normalizeGraphHopperProviderError(422, attempt.payload.message ?? "No route was found");
        }
        return {
          paths,
          engineVersion: attempt.payload.info?.version ?? FALLBACK_ENGINE_VERSION,
          degraded,
        };
      };

      // A loop's distance is an estimate the engine does not honor exactly
      // (a 3 h ask came back 5 h 25 min): re-ask the same seed with the
      // distance scaled by how far the answer missed, and keep the closest.
      const calibrated = async (seed: number | undefined): Promise<SeedAnswer> => {
        let best = await answerFor(seed);
        const discovery = request.discovery;
        if (discovery === undefined) return best;
        const targetMs = discovery.targetMinutes * 60_000;
        const toleranceMs = discovery.toleranceMinutes * 60_000;
        const miss = (answer: SeedAnswer): number =>
          Math.abs((answer.paths[0]?.time ?? Number.POSITIVE_INFINITY) - targetMs);
        let scale = 1;
        for (let pass = 0; pass < LOOP_CALIBRATION_PASSES; pass += 1) {
          const time = best.paths[0]?.time;
          if (time === undefined || time <= 0 || miss(best) <= toleranceMs) break;
          scale = Math.min(LOOP_SCALE_MAX, Math.max(LOOP_SCALE_MIN, (scale * targetMs) / time));
          let next: SeedAnswer;
          try {
            next = await answerFor(seed, scale);
          } catch (caught) {
            if (signal.aborted) throw caught;
            break;
          }
          if (miss(next) < miss(best)) best = next;
        }
        return best;
      };

      // A drawn route is chunked, reviewed against the drawing and repaired
      // once (OGV-D-285). A must-use span re-orders the wire points, so a sketch
      // with one keeps the single request it always had.
      const sketchRouted =
        request.sketch !== undefined &&
        request.discovery === undefined &&
        !(request.roadSpans ?? []).some((span) => span.mode === "must" && span.anchors.length >= 2);
      const sketchAnswer = async (): Promise<SeedAnswer> => {
        const routed = await routeSketch({
          request,
          wirePoints: hosted === undefined
            ? requestWirePoints(request)
            : thinSketchAnchors(requestWirePoints(request), HOSTED_MAX_SKETCH_ANCHORS),
          maxPointsPerRequest:
            hosted === undefined ? SELF_HOSTED_SKETCH_CHUNK_POINTS : HOSTED_SKETCH_CHUNK_POINTS,
          signal,
          routeChunk: async (points, band) => {
            const answer = await answerFor(undefined, undefined, { points, band });
            return {
              path: answer.paths[0] as GraphHopperPath,
              engineVersion: answer.engineVersion,
              degraded: answer.degraded,
            };
          },
        });
        return { paths: [routed.path], engineVersion: routed.engineVersion, degraded: routed.degraded };
      };

      const settledAnswers = await Promise.allSettled(seeds.map(async (seed) => {
        const answer = sketchRouted ? await sketchAnswer() : await calibrated(seed);
        return answer.paths.map((path, index) => parseGraphHopperPath(path, {
          providerId: GRAPHHOPPER_PROVIDER_ID,
          profile: request.profile,
          index,
          engineVersion: answer.engineVersion,
          degraded: answer.degraded,
        })).map((candidate) => hosted === undefined ? candidate : {
          ...candidate,
          providerMetadata: { ...candidate.providerMetadata, basicRouting: true },
        });
      }));
      const answers = settledAnswers.flatMap((answer) =>
        answer.status === "fulfilled" ? answer.value : [],
      );
      if (answers.length === 0) {
        const failure = settledAnswers.find(
          (answer): answer is PromiseRejectedResult => answer.status === "rejected",
        );
        throw failure?.reason ?? new GraphHopperProviderError(
          "The routing service returned no loop candidates.",
          "no-route",
        );
      }
      return { candidates: answers };
    },
  };
}

/**
 * The hosted free-plan body: the stock profile, no custom model, and no
 * headings (the free plan has no flexible mode, and headings need it).
 */
function hostedBody(body: GraphHopperRequestBody): GraphHopperRequestBody {
  const unsupported = new Set(["custom_model", "headings", "heading_penalty"]);
  return Object.fromEntries([
    ...Object.entries(body).filter(([name]) => !unsupported.has(name)),
    ["profile", HOSTED_PROFILE],
  ]) as unknown as GraphHopperRequestBody;
}
