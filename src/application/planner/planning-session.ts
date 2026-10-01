/**
 * The PlanningSession value surface (02-ARCHITECTURE-CONTRACT §2.2, §9, §13;
 * 06-ROUTING-AND-DECISION-ENGINE §28–§29; 21-RED-TEAM-AND-FAILURE-MODES §7–§8).
 *
 * PlanningSession is authority #2: **one attempt to answer one RideDocument
 * revision**. It owns the planning generation, the pending request, the
 * cancellation controller, the committed and last-good bundles, the rider's
 * selection, provider diagnostics and timing. It never owns authored truth
 * (that is RideDocument) and never owns a physical activity (that is
 * RideSession).
 *
 * This module is the pure value half — phases, identity, diagnostics, the
 * snapshot — so the fence itself (`planning-controller.ts`) can be read as
 * behavior instead of bookkeeping. Everything here is plain, deeply frozen
 * data: no React, no framework, no adapter.
 *
 * Three invariants are encoded in the types:
 *
 * - **Ownership is explicit.** A snapshot always states the `(rideId,
 *   rideRevision, planningGeneration)` it belongs to, so a consumer can prove
 *   a result is not stale. An idle session has no ride yet, which is why
 *   `rideId` is `null` until the first `begin`.
 * - **Last-good is retained, not reconstructed.** `lastGoodBundle` is the most
 *   recent bundle this session considers a truthful answer; a failed,
 *   cancelled or superseded attempt never clears it, so the map keeps showing
 *   the rider's last route while a new revision is computed.
 * - **Cancellation is not failure.** `phase` distinguishes `failed` from
 *   `cancelled`, and `error` stays `null` for a cancelled attempt.
 */

import type { RideId } from "@/domain/ride/ids";
import type { RouteCandidateId } from "@/domain/route/ids";
import type {
  RouteBundle,
  RouteRole,
  RouteRoles,
  RouteSelectionSource,
} from "@/domain/route/types";

/**
 * The §9 planning lifecycle. `idle` means nothing has been attempted yet;
 * `primary-ready` means a usable bundle is committed while alternatives are
 * still loading (or none are); every other phase is either work in progress or
 * terminal.
 */
export type PlanningPhase =
  | "idle"
  | "validating"
  | "routing-primary"
  | "primary-ready"
  | "alternatives-loading"
  | "ready"
  | "failed"
  | "cancelled";

/**
 * Fenced ownership identity (§2.2). `planningGeneration` strictly increases
 * inside one session and is the discriminator a late result is rejected by;
 * the other two fields are compared too, so a result can never be committed
 * against a different ride or revision.
 *
 * `rideId` is `null` only before the first `begin`: an idle controller has no
 * ride to answer, and inventing a placeholder id would be a lie.
 */
export interface PlanningIdentity {
  readonly rideId: RideId | null;
  readonly rideRevision: number;
  readonly planningGeneration: number;
}

/** How one provider's call ended (§2.2 "provider diagnostics"). */
export type ProviderDiagnosticOutcome = "ok" | "failed" | "cancelled" | "timeout";

/**
 * One provider's outcome for the current attempt. `providerId` is a
 * diagnostics label and never rider copy (VNX-007 / OGV-D-151); `note` is a
 * stable machine token (`"unresolved-avoid-areas"`, `"rejection:<code>"`, …),
 * never provider text, so nothing a router said can leak through it
 * (OGV-D-162).
 */
export interface ProviderDiagnostic {
  readonly providerId: string;
  readonly outcome: ProviderDiagnosticOutcome;
  readonly candidateCount: number;
  readonly note?: string;
  readonly funCharacter?: import("./ports/route-plan-contract").RoutePlanFunCharacterWire;
}

/**
 * The normalized session error codes (§29). The UI maps the code to rider
 * copy; `message` is diagnostics text, so no engine name, stack or address
 * travels in it.
 *
 * `recoverable` says whether asking again could change the answer:
 * `provider-unavailable` is transient infrastructure (`true`),
 * `constraint-conflict` is relaxable by the rider (`true`), and `no-route`
 * is a durable answer for this question (`false`).
 */
export type PlanningErrorCode =
  | "no-route"
  | "provider-unavailable"
  | "constraint-conflict";

export interface PlanningError {
  readonly code: PlanningErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

/**
 * Everything a surface needs to render one planning attempt. The snapshot is
 * rebuilt (and frozen) on every read, so a consumer can never observe a
 * half-written generation.
 */
export interface PlanningSessionSnapshot {
  readonly identity: PlanningIdentity;
  readonly phase: PlanningPhase;
  /** The most recent bundle that is still a truthful answer; survives failure. */
  readonly lastGoodBundle: RouteBundle | null;
  /** The bundle this attempt committed, or `null` while it has not (or cannot). */
  readonly committedBundle: RouteBundle | null;
  readonly selectionSource: RouteSelectionSource;
  readonly selectedRouteId: RouteCandidateId | null;
  readonly error: PlanningError | null;
  readonly diagnostics: readonly ProviderDiagnostic[];
  readonly startedAt: string;
  readonly settledAt: string | null;
}

/** Every §16 role, in the order the record is built. */
export const ROUTE_ROLES: readonly RouteRole[] = [
  "best-ride",
  "fastest",
  "fast-and-fun",
  "more-twisties",
  "more-dirt",
  "lower-workload",
];

/**
 * The documented role placeholder: every role is `null` until the role policy
 * lands (Task 3.3). A `null` role means "no candidate materially satisfies
 * this distinction", so an unscored bundle claims nothing (OGV-D-148).
 */
export function emptyRouteRoles(): RouteRoles {
  return {
    "best-ride": null,
    fastest: null,
    "fast-and-fun": null,
    "more-twisties": null,
    "more-dirt": null,
    "lower-workload": null,
  };
}

/**
 * The idle snapshot: no attempt, no bundle, no selection, no diagnostics. The
 * wall clock stamps `startedAt`, because the snapshot type always states when
 * the current state began; `begin` replaces it with its injected clock.
 */
export function emptyPlanningSession(
  rideId: RideId | null = null,
): PlanningSessionSnapshot {
  return {
    identity: { rideId, rideRevision: 0, planningGeneration: 0 },
    phase: "idle",
    lastGoodBundle: null,
    committedBundle: null,
    selectionSource: "automatic",
    selectedRouteId: null,
    error: null,
    diagnostics: [],
    startedAt: new Date().toISOString(),
    settledAt: null,
  };
}
