/**
 * The same-origin planning bridge (02-ARCHITECTURE-CONTRACT §11, §17,
 * 23-API-CONTRACTS §2–§3).
 *
 * The controller (Task 2.3) is transport-agnostic: it only knows the
 * `RouteCandidateProvider` port. This adapter is the client half of that port —
 * it turns one provider-neutral `ProviderRouteRequest` into a
 * `/api/route-plan` POST and the answer back into `ProviderCandidate`s, so the
 * browser never talks to a router, never holds an engine URL and never sees a
 * provider message (Rule B, 13 §12).
 *
 * It is deliberately dumb: no scoring, no eligibility, no roles, no selection.
 * The Wave-3 pipeline decides those; where the pipeline finally runs (server,
 * client, or both) is settled then, and this adapter is the seam that moves.
 */

import type {
  RoutePlanErrorBody,
  RoutePlanIdentityWire,
  RoutePlanResponseBody,
  RoutePlanSuccessBody,
} from "@/application/planner/ports/route-plan-contract";
import {
  ROUTE_PLAN_PATH,
  isRoutePlanErrorBody,
  parseRoutePlanFunCharacter,
} from "@/application/planner/ports/route-plan-contract";
import type {
  ProviderCandidate,
  ProviderCandidateSet,
  ProviderCapabilities,
  ProviderRouteRequest,
  RouteCandidateProvider,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import { isRouteInstruction, isSpeedLimitSpans, MAX_ROUTE_INSTRUCTIONS } from "@/domain/route/types";

/** The provider id recorded for this transport (diagnostics only). */
export const API_PROVIDER_ID = "api";

/** The longest a plan request may stay open before it is treated as lost. */
export const PLAN_REQUEST_CEILING_MS = 90_000;

/** OpenGravel copy for a transport failure; never the fetch error's own text. */
const UNREACHABLE_MESSAGE = "The route planner could not be reached.";
const UNREADABLE_MESSAGE = "The route planner returned an unreadable response.";
const MISSING_ATTEMPT_MESSAGE = "The planning attempt identity is missing.";

/** A failure expressed in the VNext taxonomy, as the controller reads it. */
export class ApiRouteProviderError extends Error {
  readonly code: string;
  readonly recoverable: boolean;
  readonly httpStatus: number | null;

  constructor(
    message: string,
    code: string,
    options: { readonly recoverable?: boolean; readonly httpStatus?: number | null } = {},
  ) {
    super(message);
    this.name = "ApiRouteProviderError";
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.httpStatus = options.httpStatus ?? null;
  }
}

export interface ApiRouteProviderOptions {
  /** Injectable `fetch` for tests and non-browser transports. */
  readonly fetcher?: typeof fetch;
  /** Endpoint override; the contract's path is the default. */
  readonly path?: string;
}

/**
 * The bridge plus the one thing the port cannot carry: the ownership identity
 * of the attempt being planned.
 *
 * `ProviderRouteRequest` (Task 2.1) has no `rideId`/revision/generation — the
 * port is provider-neutral and identity is not a provider's business. The
 * composition root therefore scopes the identity per attempt *before*
 * `begin(...)`, and the adapter reads it synchronously at call time. The
 * controller's generation fence is what makes that safe: a superseded attempt
 * never reaches `candidates()` at all (OGV-D-169).
 */
export interface ApiRouteProvider extends RouteCandidateProvider {
  /** Scope the next call to one planning attempt. */
  beginAttempt(identity: RoutePlanIdentityWire): void;
}

function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

/**
 * A wire candidate becomes the port's DTO: geometry, metrics and fingerprint.
 *
 * `providerId` is this bridge's own id, not the upstream engine's, because the
 * controller's priority rule selects "the first eligible candidate of provider
 * X" by comparing `candidate.providerId` with the provider instance's `id`
 * (OGV-D-171) — and the instance the controller holds is this transport. The
 * engine that actually computed the path stays available as
 * `providerMetadata.upstreamProviderId`; which of the two
 * `ProviderProvenance.providerId` should name is a Wave-3 pipeline decision
 * (OGV-D-181).
 */
function toProviderCandidate(
  candidate: RoutePlanSuccessBody["bundle"]["candidates"][number],
  roles: RoutePlanSuccessBody["bundle"]["roles"],
): ProviderCandidate {
  return {
    providerId: API_PROVIDER_ID,
    profile: candidate.provider.profile,
    geometry: candidate.geometry.map(copyCoordinate),
    distanceMeters: candidate.distanceMeters,
    durationSeconds: candidate.durationSeconds,
    ...(candidate.instructions === undefined ? {} : { instructions: candidate.instructions }),
    // Optional facts: a malformed list is dropped, never a reason to refuse the route.
    ...(isSpeedLimitSpans(candidate.speedLimits) &&
    candidate.speedLimits.every((span) => span.toIndex < candidate.geometry.length)
      ? { speedLimits: candidate.speedLimits }
      : {}),
    providerMetadata: {
      fingerprint: candidate.fingerprint,
      upstreamProviderId: candidate.provider.providerId,
      candidateId: candidate.id,
      lowerWorkload: roles["lower-workload"] === candidate.id,
      bestRide: roles["best-ride"] === candidate.id,
    },
    // The server already measured and scored this line (OGV-D-263); a body
    // missing any part of the verdict carries none of it.
    ...(isPlainRecord(candidate.evidence) && isPlainRecord(candidate.score) && Array.isArray(candidate.warnings)
      ? { assessment: { evidence: candidate.evidence, score: candidate.score, warnings: candidate.warnings } }
      : {}),
  };
}

function isPlainRecord(value: unknown): value is Record<string, never> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses an error payload without trusting it; unknown shapes stay generic. */
function errorFromBody(body: unknown, httpStatus: number): ApiRouteProviderError {
  const parsed = body as Partial<RoutePlanErrorBody> | null;
  const error = parsed?.error;
  if (
    typeof error === "object" &&
    error !== null &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return new ApiRouteProviderError(error.message, error.code, {
      recoverable: error.recoverable === true,
      httpStatus,
    });
  }
  return new ApiRouteProviderError(UNREADABLE_MESSAGE, "provider-unavailable", {
    recoverable: true,
    httpStatus,
  });
}

/** Carries provider-neutral planning requests across the same-origin API. */
export function createApiRouteProvider(
  options: ApiRouteProviderOptions = {},
): ApiRouteProvider {
  const fetcher = options.fetcher ?? fetch;
  const path = options.path ?? ROUTE_PLAN_PATH;
  let attempt: RoutePlanIdentityWire | null = null;

  return {
    id: API_PROVIDER_ID,

    beginAttempt(identity: RoutePlanIdentityWire): void {
      attempt = {
        rideId: identity.rideId,
        rideRevision: identity.rideRevision,
        planningGeneration: identity.planningGeneration,
      };
    },

    capabilities(): ProviderCapabilities {
      // The bridge does not know which engine profiles the deployment serves;
      // claiming a list here would be a fabricated capability. It can carry
      // alternatives and avoid polygons because the contract supports both.
      return { profiles: [], supportsAlternatives: true, supportsAvoidPolygons: true };
    },

    async candidates(
      request: ProviderRouteRequest,
      signal: AbortSignal,
    ): Promise<ProviderCandidateSet> {
      const identity = attempt;
      if (identity === null) {
        throw new ApiRouteProviderError(MISSING_ATTEMPT_MESSAGE, "missing-input", {
          recoverable: false,
        });
      }

      let response: Response;
      // A request iOS froze while Safari was in the background never settles;
      // without a ceiling the planner stayed "on its way" with the map dimmed
      // (owner, 2026-10-04). The server's stages are bounded well inside this.
      const ceiling = new AbortController();
      const ceilingTimer = setTimeout(() => ceiling.abort(), PLAN_REQUEST_CEILING_MS);
      const onCallerAbort = (): void => ceiling.abort();
      if (signal.aborted) ceiling.abort();
      else signal.addEventListener("abort", onCallerAbort, { once: true });
      const settle = (): void => {
        clearTimeout(ceilingTimer);
        signal.removeEventListener("abort", onCallerAbort);
      };
      try {
        response = await fetcher(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identity, request }),
          signal: ceiling.signal,
        });
      } catch {
        // The caller owns cancellation: its reason travels unchanged, exactly as
        // the routing port's contract requires (OGV-D-152/OGV-D-164). The
        // transport's own error text is dropped, never forwarded.
        settle();
        if (signal.aborted) throw signal.reason;
        throw new ApiRouteProviderError(UNREACHABLE_MESSAGE, "provider-unavailable", {
          recoverable: true,
        });
      }

      let body: unknown;
      try {
        // The ceiling covers the body too: a frozen stream is as lost as a frozen request.
        body = await response.json();
      } catch {
        settle();
        if (signal.aborted) throw signal.reason;
        throw new ApiRouteProviderError(UNREADABLE_MESSAGE, "provider-unavailable", {
          recoverable: true,
          httpStatus: response.status,
        });
      }

      settle();
      if (!response.ok) throw errorFromBody(body, response.status);
      if (isRoutePlanErrorBody(body as RoutePlanResponseBody)) {
        // A 2xx carrying an error object is a broken deployment, not an answer.
        throw errorFromBody(body, response.status);
      }
      const success = body as RoutePlanSuccessBody;
      if (
        success.identity?.rideId !== identity.rideId ||
        success.identity?.rideRevision !== identity.rideRevision ||
        success.identity?.planningGeneration !== identity.planningGeneration ||
        !Array.isArray(success.bundle?.candidates) ||
        success.bundle.candidates.some((candidate) =>
          candidate.instructions !== undefined &&
          (!Array.isArray(candidate.geometry) ||
            !Array.isArray(candidate.instructions) ||
            candidate.instructions.length > MAX_ROUTE_INSTRUCTIONS ||
            candidate.instructions.some((instruction: unknown) =>
              !isRouteInstruction(instruction) ||
              (instruction.geometryIndex !== undefined && instruction.geometryIndex >= candidate.geometry.length),
            )),
        )
      ) {
        throw new ApiRouteProviderError(UNREADABLE_MESSAGE, "provider-unavailable", {
          recoverable: true,
          httpStatus: response.status,
        });
      }
      const reading = parseRoutePlanFunCharacter(success.diagnostics?.funCharacter);
      const matching = reading !== null && success.bundle.candidates.some((candidate) => candidate.fingerprint === reading.fingerprint);
      return {
        candidates: success.bundle.candidates.map((candidate) => toProviderCandidate(candidate, success.bundle.roles)),
        ...(matching ? { funCharacter: reading } : {}),
      };
    },
  };
}
