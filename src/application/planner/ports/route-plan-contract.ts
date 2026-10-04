/**
 * The `/api/route-plan` wire contract (23-API-CONTRACTS §1–§3, §14–§15).
 *
 * This module is the one authority for the request/response shapes that cross
 * the browser/server boundary. It is imported by the server route handler and
 * by the client bridge (`src/infrastructure/routing/api-provider.ts`), so the
 * two sides can never drift into two incompatible dialects.
 *
 * It lives under `application/planner/ports/` because that is the one place a
 * provider adapter is allowed to import from `src/application/**`
 * (02-ARCHITECTURE-CONTRACT §7, architecture rule E).
 *
 * ## Why the payload carries a resolved plan request, not a `RideIntent`
 *
 * 23 §2 calls the planning field `intent`. In this slice the browser resolves
 * avoid-area geometry from its own `GeometryStore` before planning (04 §4,
 * OGV-D-163), and the server owns no store and no authored intent, so the field
 * that can actually cross the boundary is the provider-neutral
 * `ProviderRouteRequest` — origin, destination, stops, shaping, profile,
 * resolved avoid rings and options. Sending a `RideIntent` would either lose
 * the resolved polygons or force the server to guess them. Recorded as
 * `OGV-D-178`; the "exact endpoint split may change if the architecture
 * remains equivalent" clause at the top of 23 covers it.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { RouteCandidateId } from "@/domain/route/ids";
import type {
  RouteCandidate,
  RouteRoles,
  RouteSelectionSource,
} from "@/domain/route/types";
import type { ProviderRouteRequest } from "../route-provider";
import { isFrozenJevModelIdentity } from "./jev-model-identity";

/** The one route-plan endpoint the browser talks to (02 §11). */
export const ROUTE_PLAN_PATH = "/api/route-plan";

/**
 * Ownership identity of one planning attempt (23 §2). The server echoes it
 * unchanged so a late response can be recognized as stale by whoever asked.
 */
export interface RoutePlanIdentityWire {
  readonly rideId: string;
  readonly rideRevision: number;
  readonly planningGeneration: number;
}

/** Request-level planning options (23 §2). */
export interface RoutePlanOptionsWire {
  readonly includeAlternatives?: boolean;
}

/** What the browser POSTs to `/api/route-plan`. */
export interface RoutePlanRequestBody {
  readonly identity: RoutePlanIdentityWire;
  /** Fully resolved, provider-neutral planning input. */
  readonly request: ProviderRouteRequest;
  readonly options?: RoutePlanOptionsWire;
}

/**
 * One planned candidate as it travels to the browser: the domain
 * `RouteCandidate` field for field, with the `GeometryRef` handle replaced by
 * the geometry itself.
 *
 * The server is not a geometry authority — it holds no `GeometryStore`, and the
 * handle namespace is minted by whoever stores the bytes — so it ships the
 * line and lets the client's store mint a handle (02 §4). Bounded maneuver facts
 * travel inline because Ride Focus needs them at handoff; they are separately
 * validated and never treated as authored route intent.
 */
export type RoutePlanCandidate = Omit<
  RouteCandidate,
  "geometryRef" | "instructionsRef"
> & {
  readonly geometry: readonly Coordinate[];
};

/** The bundle half of a successful plan (23 §2). */
export interface RoutePlanBundleWire {
  readonly policyVersion: string;
  readonly graphVersion: string;
  readonly evidenceVersion: string;
  readonly candidates: readonly RoutePlanCandidate[];
  readonly roles: RouteRoles;
  /** A bundle exists only when a route was selected (OGV-D-148). */
  readonly selectedRouteId: RouteCandidateId;
  /**
   * Who decided the selection on the server: always `"automatic"` today, because
   * the server assigns roles and selects the best ride before the bundle is sent
   * (`VNX-006`). The field exists so the wire matches the domain `RouteBundle`,
   * whose `selectionSource` distinguishes a policy pick from a rider's own
   * (`06 §15`); a rider's pick is made on the client and never travels back as a
   * server claim (`OGV-D-208`).
   */
  readonly selectionSource: RouteSelectionSource;
}

/**
 * One provider's own report for one attempt (23 §16). `note` is a stable
 * machine token or an OpenGravel label — never provider text, never rider copy
 * (OGV-D-151/OGV-D-162).
 */
export interface RoutePlanProviderDiagnosticWire {
  readonly providerId: string;
  readonly outcome: "ok" | "failed" | "cancelled" | "timeout";
  readonly note: string;
}

/** Optional model reading of aggregate route character; never a selection input. */
export interface RoutePlanFunCharacterWire {
  readonly fingerprint: string;
  readonly label: "FLOWING" | "TWISTY" | "BACKROAD" | "DIRT_FOCUSED" | "UNKNOWN";
  readonly confidence: number;
  readonly model: string;
  readonly policyVersion: string;
}

/** Bounded advisory data only; malformed readings never invalidate a route. */
export function parseRoutePlanFunCharacter(value: unknown): RoutePlanFunCharacterWire | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const { fingerprint, label, confidence, model, policyVersion } = source;
  if (typeof fingerprint !== "string" || fingerprint.length === 0 || fingerprint.length > 128 ||
    typeof policyVersion !== "string" || policyVersion.length === 0 || policyVersion.length > 128 ||
    typeof label !== "string" || !["FLOWING", "TWISTY", "BACKROAD", "DIRT_FOCUSED", "UNKNOWN"].includes(label) ||
    typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !isFrozenJevModelIdentity(model)) return null;
  return { fingerprint, label: label as RoutePlanFunCharacterWire["label"], confidence, model, policyVersion };
}

/**
 * What the FUN JUDGE did for this plan (`OGV_JEV_FUN_JUDGE=shadow|on`).
 * Diagnostics only: the bundle's roles/selection are already final. `applied`
 * is true only when Jev's preference became Best Ride; `why` lists measured
 * evidence deltas (Jev's pick minus the deterministic winner), not model text.
 */
export interface RoutePlanFunJudgeWire {
  readonly mode: "shadow" | "on";
  readonly outcome: string;
  readonly applied: boolean;
  readonly deterministicRouteId: string;
  readonly jevRouteId: string | null;
  readonly selectedRouteId: string;
  readonly shortlistSize: number;
  readonly excluded: readonly { readonly routeId: string; readonly reason: string }[];
  readonly confidence: number | null;
  readonly margin: number | null;
  readonly orderAgreement: boolean | null;
  readonly model: string | null;
  readonly calls: number;
  readonly cached: boolean;
  readonly latencyMs: number;
  readonly why: readonly { readonly feature: string; readonly delta: number }[];
  readonly addedTimePct: number | null;
}

/** Server-side diagnostics for one attempt (23 §2, §16). */
export interface RoutePlanDiagnosticsWire {
  readonly riderModes?: {
    readonly calls: number;
    readonly trials: readonly { readonly factor: number; readonly unpavedShare: number; readonly busyShare: number | null; readonly minutes: number }[];
  };
  readonly optionalProvidersUnavailable: readonly string[];
  /** Shadow-only semantic label for the deterministic Fast & Fun shadow winner. */
  readonly funCharacter?: RoutePlanFunCharacterWire;
  /** Present only when the FUN JUDGE ran (shadow or on). */
  readonly funJudge?: RoutePlanFunJudgeWire;
  /**
   * Provider-level reports. Omitted by the live GraphHopper path, which reports
   * through `optionalProvidersUnavailable` and the §3 error object; present when
   * the deployment answers from the labeled route-plan fixture, so nothing
   * downstream can mistake that answer for a router's (Task 2.4b).
   */
  readonly providers?: readonly RoutePlanProviderDiagnosticWire[];
}

/** Successful plan response. */
export interface RoutePlanSuccessBody {
  readonly identity: RoutePlanIdentityWire;
  readonly bundle: RoutePlanBundleWire;
  readonly diagnostics: RoutePlanDiagnosticsWire;
}

/**
 * The §3 error object. `message` is always OpenGravel copy: a raw provider
 * message, stack or router address never reaches a client (OGV-D-162).
 */
export interface RoutePlanErrorWire {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RoutePlanErrorBody {
  readonly error: RoutePlanErrorWire;
}

export type RoutePlanResponseBody = RoutePlanSuccessBody | RoutePlanErrorBody;

/** Discriminates the two response shapes without a runtime library. */
export function isRoutePlanErrorBody(
  body: RoutePlanResponseBody,
): body is RoutePlanErrorBody {
  return "error" in body;
}
