/**
 * Documented seam contracts for the advisor evaluation harness (10 §3–§5, §8,
 * §13, §16).
 *
 * The evaluation suite is written against the **documented** contracts of the
 * advisor seams: the bounded read model, grounded tool surface and proposal
 * protocol. Transport types come from the application; these small evaluation
 * shapes keep model behavior testable without a provider.
 *
 * Everything here is plain fixture data. The oracle in `harness.ts` validates a
 * scripted model turn against these shapes and the read model's structured
 * facts; it never parses model prose and never touches a provider or the
 * network (10 §16 — deterministic evaluation, no-key mode first class).
 */

import type {
  AdvisorCapability,
  AdvisorErrorClass,
  AdvisorRecovery,
} from "@/application/advisor";
import type { GeometryRef, RideId } from "@/domain/ride/ids";
import type {
  Coordinate,
  RideDocument,
  RideIntent,
} from "@/domain/ride/types";

/**
 * Fixed evaluation clock as an ISO-8601 instant (the shape
 * `CreateRideDocumentOverrides.now` documents) — the harness has no live time
 * dependency (10 §16).
 */
export const EVAL_NOW = "2026-01-12T08:00:00.000Z";

/** The authored intent fields a proposal may change (03-DOMAIN-MODEL §3). */
export type IntentField = keyof RideIntent;

/**
 * The transport can only classify these five classes (10 §13):
 * `grounding-failed` (10 §8) and `stale-revision` (10 §6) are raised by the
 * proposal/validation layer above the transport, so a scripted transport
 * failure never carries them.
 */
export type TransportErrorClass = Exclude<
  AdvisorErrorClass,
  "grounding-failed" | "stale-revision"
>;

/**
 * How much a structured fact knows (10 §18). `unknown` is a first-class value:
 * a missing measurement is never phrased as a measurement.
 */
export type FactKnowledge =
  | "verified"
  | "estimated"
  | "rider-report"
  | "community"
  | "unknown";

/** A numeric value exactly as structured context carries it (10 §18). */
export interface ClaimNumber {
  readonly value: number;
  readonly unit: string;
}

/**
 * One structured fact of the bounded read model (10 §3 "relevant evidence
 * summaries"). Facts are the only ground truth an assertion may cite.
 */
export interface EvalFact {
  readonly factId: string;
  readonly kind: "road" | "fuel" | "stop" | "incident" | "poi-search" | "metric";
  readonly subject: string;
  readonly knowledge: FactKnowledge;
  /** Incidents: `nearby` is never evidence about the route (10 §18). */
  readonly scope?: "on-route" | "nearby";
  /** POI searches: a result count is a search outcome, not a census (10 §18). */
  readonly resultCount?: number;
  readonly numbers?: readonly ClaimNumber[];
}

/**
 * One claim surfaced in an assertion (10 §8 "claims must trace to structured
 * evidence", 10 §18 truth rules). `certainty` is what the claim asserts; the
 * oracle rejects every phrasing that upgrades the underlying fact.
 */
export interface SurfacedClaim {
  /** Rider-facing phrasing; copy rules apply (VNX-007 / Rule E). */
  readonly text: string;
  readonly subject: string;
  readonly kind: "road" | "fuel" | "stop" | "metric";
  readonly certainty: "known" | "estimated" | "unknown";
  /** Structured fact this claim cites; required unless `certainty: "unknown"`. */
  readonly traceId?: string;
  /** An access claim ("open"/"closed") — never upgraded from a report (10 §18). */
  readonly access?: boolean;
  /** An incident placement claim — `on-route` needs an on-route fact (10 §18). */
  readonly onRoute?: boolean;
  /** A "none exist" claim — never grounded by an empty search (10 §18). */
  readonly assertsAbsence?: boolean;
  /** Numbers the phrasing surfaces; each must match the cited fact (10 §18). */
  readonly numbers?: readonly ClaimNumber[];
}

/**
 * Untrusted text that arrived with imported routes or community notes
 * (10 §15). It is data, never a system instruction; the prompt layer must keep
 * it out of the system role, and no applied intent may carry it.
 */
export interface UntrustedDatum {
  readonly kind: "route-name" | "community-note" | "imported-label";
  readonly text: string;
}

/** The selected map object/span (10 §3, §10 "keep this road"). */
export interface EvalMapSelection {
  readonly kind: "area" | "road-span" | "poi";
  readonly label: string;
  readonly geometryRef: GeometryRef;
  readonly direction?: "forward" | "reverse" | "either";
}

/** A known Home target (10 §9). Present only when explicitly provided. */
export interface EvalHomeTarget {
  readonly label: string;
  readonly savedPlaceId: string;
  readonly coordinate: Coordinate;
}

/** One candidate summary as the read model surfaces it (10 §3). */
export interface EvalCandidateSummary {
  readonly role: "fastest" | "balanced" | "scenic";
  readonly label: string;
  readonly factIds: readonly string[];
}

/**
 * The bounded read model (10 §3 context snapshot). It never carries the route
 * library or raw history (10 §3 "do not send entire route library").
 */
export interface EvalReadModel {
  readonly rideId: RideId;
  readonly revision: number;
  readonly intent: RideIntent;
  readonly capability: AdvisorCapability;
  readonly selectedRouteRole: "fastest" | "balanced" | "scenic";
  readonly candidates: readonly EvalCandidateSummary[];
  readonly warnings: readonly string[];
  readonly selection?: EvalMapSelection;
  readonly home?: EvalHomeTarget;
  readonly locationFreshness: "fresh" | "stale" | "unknown";
  readonly facts: readonly EvalFact[];
  readonly untrusted: readonly UntrustedDatum[];
}

/**
 * Raw model output before validation: an operation is untyped data until the
 * schema check proves it is a `RideCommandOp` (red-team §5 — typed commands
 * never degrade into an `edit({ ...anything })`).
 */
export type EvalOperation = Record<string, unknown>;

interface EvalTurnBase {
  /** Rider-facing summary (10 §12); copy rules apply (VNX-007 / Rule E). */
  readonly summary: string;
  readonly claims: readonly SurfacedClaim[];
}

/**
 * A documented proposal (10 §5): typed operations plus the scope it may change,
 * the constraints it commits to preserve and its unresolved references. The
 * Apply button is one compound `proposal.apply` — nothing else.
 */
export interface EvalProposalTurn extends EvalTurnBase {
  readonly kind: "proposal";
  readonly proposalId: string;
  /** The revision the turn was authored against (10 §6). */
  readonly baseRevision: number;
  readonly operations: readonly EvalOperation[];
  /** The intent fields this proposal declares it may change (21 §26). */
  readonly scope: readonly IntentField[];
  /** Constraints the proposal commits to keep unchanged (10 §5, 21 §26). */
  readonly preserved: readonly IntentField[];
  readonly unresolved: readonly string[];
}

/** A documented explanation (10 §5 "explanation — no mutation"). */
export interface EvalExplanationTurn extends EvalTurnBase {
  readonly kind: "explanation";
  readonly unresolved: readonly string[];
}

/** A scripted transport failure (10 §13) — one of the five transport classes. */
export interface EvalFailureTurn {
  readonly kind: "failure";
  readonly errorClass: TransportErrorClass;
}

/**
 * No-key mode (10 §2): no turn happens at all. The advisor is honestly off and
 * every core capability keeps working (red-team §25).
 */
export interface EvalDisabledTurn {
  readonly kind: "disabled";
}

export type EvalTurn =
  | EvalProposalTurn
  | EvalExplanationTurn
  | EvalFailureTurn
  | EvalDisabledTurn;

/**
 * Stable oracle findings. Each code names one documented rule; the negative
 * fixtures in the suite flag every code at least once.
 */
export const EVAL_VIOLATION_CODES = [
  "untyped-operation",
  "forbidden-action",
  "nested-proposal",
  "claim-untraced",
  "upgrade-unknown",
  "upgrade-estimated",
  "upgrade-report",
  "upgrade-nearby",
  "empty-search-absence",
  "number-mismatch",
  "scope-mismatch",
  "preserved-violation",
  "copy-provider-name",
  "copy-sentence-case",
  "domain-invalid",
] as const;

export type EvalViolationCode = (typeof EVAL_VIOLATION_CODES)[number];

export interface EvalViolation {
  readonly code: EvalViolationCode;
  readonly detail: string;
}

export type EvalDisposition = "apply" | "explain" | "reject" | "disabled";

/**
 * The verdict for one case. It is pure fixture-derived data — deliberately
 * free of generated IDs and timestamps — so the same inputs always produce the
 * same verdict (10 §16).
 */
export interface EvalVerdict {
  readonly disposition: EvalDisposition;
  readonly outcome: "applied" | "noop" | "none";
  readonly errorClass: AdvisorErrorClass | null;
  readonly recovery: AdvisorRecovery | null;
  /** Rider copy for a rejected or disabled turn; `null` for accepted turns. */
  readonly riderMessage: string | null;
  /** Whether the applied proposal asks the planner to evaluate again (10 §4). */
  readonly reroute: boolean;
  readonly changedFields: readonly IntentField[];
  readonly revisionBefore: number;
  readonly revisionAfter: number;
  readonly unresolved: readonly string[];
  readonly violations: readonly EvalViolation[];
  /** The resulting document — the caller's document is never mutated. */
  readonly document: RideDocument;
}

/**
 * ID-free verdict projection — the exact deterministic fingerprint of a case
 * outcome (10 §16). Used for expectation matching and cross-run comparison.
 */
export interface VerdictSummary {
  readonly disposition: EvalDisposition;
  readonly outcome: EvalVerdict["outcome"];
  readonly errorClass: AdvisorErrorClass | null;
  readonly reroute: boolean;
  readonly changedFields: readonly IntentField[];
  readonly unresolved: readonly string[];
  readonly violations: readonly EvalViolationCode[];
}

/** What one eval case expects (10 §16 — schema, grounding, preservation). */
export interface EvalExpectation {
  readonly disposition: EvalDisposition;
  readonly outcome: EvalVerdict["outcome"];
  readonly errorClass: AdvisorErrorClass | null;
  /** Whether the applied proposal asks the planner to evaluate again (10 §4). */
  readonly reroute: boolean;
  readonly changedFields: readonly IntentField[];
  readonly unresolved: readonly string[];
  readonly violations: readonly EvalViolationCode[];
}

/** One deterministic benchmark case (10 §16). */
export interface EvalCase {
  readonly id: string;
  /** Sentence case (VNX-007 / Rule E). */
  readonly title: string;
  /** The named rules this case pins, e.g. "10 §6" or "21 §26". */
  readonly pins: readonly string[];
  /** The rider utterance the scripted turn answers (recorded for live reruns). */
  readonly utterance: string;
  readonly readModel: EvalReadModel;
  readonly turn: EvalTurn;
  /** Document revision at Apply time when it moved past `turn.baseRevision`. */
  readonly liveRevision?: number;
  readonly expected: EvalExpectation;
}
