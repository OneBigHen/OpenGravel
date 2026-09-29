/**
 * The `/api/road-match` HTTP handler (23-API-CONTRACTS §3, §14–§15).
 *
 * Kept apart from the route file so the endpoint is testable without a
 * `Request`/`Response` pair: the handler takes an already-parsed body, calls the
 * matching service, and maps the result onto a status code and a body.
 * `src/app/api/road-match/route.ts` is the thin adapter over this.
 *
 * Two rules, both from the API contract:
 *
 * - **Malformed input never reaches the router** (§14): the service validates,
 *   and a validation failure answers 400 — but the handler is also where the
 *   status mapping lives, so a route file cannot drift from it.
 * - **A personal match is never cacheable** (§15): every answer carries
 *   `private, no-store`.
 */

import {
  matchRoadAnchors,
  type RoadMatchError,
  type RoadMatchResult,
  type RoadMatchConfidence,
} from "./match-service";
import type { Coordinate } from "@/domain/ride/types";
import type { EvidenceValue } from "@/domain/evidence/types";

/** §15: a rider's own road match is never a shared cache's business. */
export const ROAD_MATCH_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "private, no-store",
};

/**
 * The match call the handler makes. Injectable so a handler test never routes,
 * exactly like the route-plan handler's `PlanFunction` seam.
 */
export type RoadMatchFunction = (
  input: unknown,
  deps: { readonly signal: AbortSignal | undefined },
) => Promise<RoadMatchResult>;

export interface RoadMatchHandlerDeps {
  readonly match?: RoadMatchFunction;
}

export interface RoadMatchErrorBody {
  readonly error: RoadMatchError;
}

/** The success body: the matched line plus what the match could honestly report. */
export interface RoadMatchSuccessBody {
  readonly matchedGeometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly maxDriftMeters: number;
  readonly confidence: RoadMatchConfidence;
  readonly accessEvidence: EvidenceValue<"motorcycle" | "unknown">;
}

export interface RoadMatchHandlerResult {
  readonly status: number;
  readonly body: RoadMatchSuccessBody | RoadMatchErrorBody;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * §12 taxonomy → HTTP. An input problem is 400, an answer the engine refused is
 * 422, infrastructure answers are 502/504, and a cancellation is 499.
 */
export function httpStatusForMatchErrorCode(code: string): number {
  switch (code) {
    case "validation":
      return 400;
    case "no-match":
    case "no-route":
    case "outside-coverage":
      return 422;
    case "provider-timeout":
      return 504;
    case "provider-unavailable":
      return 502;
    case "cancelled":
      return 499;
    default:
      return 500;
  }
}

function errorResult(error: RoadMatchError): RoadMatchHandlerResult {
  return {
    status: httpStatusForMatchErrorCode(error.code),
    body: { error },
    headers: ROAD_MATCH_RESPONSE_HEADERS,
  };
}

/** Handles one `/api/road-match` call. Never throws for a client-caused problem. */
export async function handleRoadMatchRequest(
  body: unknown,
  deps: RoadMatchHandlerDeps = {},
  signal?: AbortSignal,
): Promise<RoadMatchHandlerResult> {
  const match: RoadMatchFunction =
    deps.match ??
    ((input, options) =>
      matchRoadAnchors(input, options.signal === undefined ? {} : { signal: options.signal }));

  let result: RoadMatchResult;
  try {
    result = await match(body, { signal });
  } catch {
    // The service normalizes its own failures; a throw here is a bug, and the
    // honest answer is a server-side outage, never a leaked stack.
    return errorResult({
      code: "provider-unavailable",
      message: "The routing service is unavailable right now.",
      recoverable: true,
    });
  }
  if (!result.ok) return errorResult(result.error);
  return {
    status: 200,
    body: {
      matchedGeometry: result.match.matchedGeometry,
      distanceMeters: result.match.distanceMeters,
      durationSeconds: result.match.durationSeconds,
      maxDriftMeters: result.match.maxDriftMeters,
      confidence: result.match.confidence,
      accessEvidence: result.match.accessEvidence,
    },
    headers: ROAD_MATCH_RESPONSE_HEADERS,
  };
}
