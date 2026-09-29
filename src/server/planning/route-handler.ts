/**
 * The `/api/route-plan` HTTP handler (23-API-CONTRACTS §2–§3, §14–§15).
 *
 * Kept apart from the route file so the whole endpoint is testable without a
 * `Request`/`Response` pair: the handler takes an already-parsed body, validates
 * it, calls the planning service, and maps the result onto a status code and a
 * response body. `src/app/api/route-plan/route.ts` is a thin adapter over this.
 *
 * Two rules:
 *
 * - **Malformed input never reaches the provider** (§14): validation runs here
 *   as well as in the service, so a bad body is rejected with 400 before any
 *   routing work is started.
 * - **A personal route is never cacheable** (§15): every answer carries
 *   `private, no-store`.
 */

import type {
  RoutePlanErrorBody,
  RoutePlanResponseBody,
} from "@/application/planner/ports/route-plan-contract";
import {
  planRide,
  type PlanRideInput,
  type PlanServiceResult,
} from "./plan-service";
import {
  formatValidationIssues,
  parseRoutePlanRequestBody,
} from "./validation";

/** §15: personal planning answers are never shared caches' business. */
export const ROUTE_PLAN_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "private, no-store",
};

/** The planning call the handler makes; injectable so tests never route. */
export type PlanFunction = (
  input: PlanRideInput,
  options: { readonly signal: AbortSignal | undefined },
) => Promise<PlanServiceResult>;

export interface RoutePlanHandlerDeps {
  readonly plan?: PlanFunction;
}

export interface RoutePlanHandlerResult {
  readonly status: number;
  readonly body: RoutePlanResponseBody;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * §12 taxonomy → HTTP. An input problem is 400, a routing answer the engine
 * refused is 422, a relaxable constraint conflict is 409, and infrastructure
 * answers are 502/504 so a proxy or the browser can retry intelligently. An
 * unrecognized code is a server bug and answers 500.
 */
export function httpStatusForPlanErrorCode(code: string): number {
  switch (code) {
    case "validation":
    case "missing-input":
      return 400;
    case "no-route":
    case "outside-coverage":
      return 422;
    case "constraint-conflict":
      return 409;
    case "provider-timeout":
      return 504;
    case "provider-unavailable":
    case "network":
      return 502;
    case "cancelled":
      return 499;
    default:
      return 500;
  }
}

function errorBody(
  code: string,
  message: string,
  recoverable: boolean,
  details?: Readonly<Record<string, unknown>>,
): RoutePlanErrorBody {
  return {
    error:
      details === undefined
        ? { code, message, recoverable }
        : { code, message, recoverable, details },
  };
}

function failure(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): RoutePlanHandlerResult {
  return {
    status: httpStatusForPlanErrorCode(code),
    body: errorBody(code, message, false, details),
    headers: ROUTE_PLAN_RESPONSE_HEADERS,
  };
}

/**
 * Handles one `/api/route-plan` call. Never throws for a client-caused problem:
 * every rejection is a status plus the §3 error object.
 */
export async function handleRoutePlanRequest(
  body: unknown,
  deps: RoutePlanHandlerDeps = {},
  signal?: AbortSignal,
): Promise<RoutePlanHandlerResult> {
  const parsed = parseRoutePlanRequestBody(body);
  if (!parsed.ok) {
    const code = parsed.issues[0]?.code === "missing-input" ? "missing-input" : "validation";
    return failure(code, "The planning request was rejected.", {
      issues: formatValidationIssues(parsed.issues),
    });
  }

  const input = parsed.value;
  const plan: PlanFunction =
    deps.plan ??
    ((input, options) =>
      planRide(input, options.signal === undefined ? {} : { signal: options.signal }));

  const result = await plan(input, { signal });
  if (!result.ok) {
    return failure(result.error.code, result.error.message, result.error.details);
  }
  return {
    status: 200,
    body: {
      identity: result.identity,
      bundle: result.bundle,
      diagnostics: result.diagnostics,
    },
    headers: ROUTE_PLAN_RESPONSE_HEADERS,
  };
}
