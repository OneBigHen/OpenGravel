/**
 * Route candidate, bundle, eligibility, evidence and score value types
 * (03-DOMAIN-MODEL §14–§19).
 *
 * This module is pure data: the shapes the candidate pipeline produces and the
 * RouteBundle stores. Two boundaries are deliberate.
 *
 * - **Provider provenance is diagnostics.** `ProviderProvenance` records which
 *   engine and internal profile produced a candidate. It is never rider-facing
 *   copy (Rule E, VNX-007): the UI names geography, not the engine.
 * - **Absence is data.** Route evidence keeps the evidence module's semantics
 *   (§18): a missing value is `unknown`, never a negative stand-in, and every
 *   score component states the evidence status it was computed from.
 */

import type { EvidenceStatus, EvidenceValue } from "../evidence/types";
import type { GeometryRef, RideId } from "../ride/ids";
import type { BlobRef, RouteCandidateId } from "./ids";

/** The distinctions the pipeline may assign a candidate (§16). */
export type RouteRole =
  | "best-ride"
  | "fastest"
  | "fast-and-fun"
  | "more-twisties"
  | "more-dirt"
  | "lower-workload";

/**
 * Which engine and internal profile produced a candidate (§14). Diagnostics
 * only: it is recorded for provenance and debugging and never rendered as
 * rider copy, because a rider chooses a route, not a provider.
 */
export interface ProviderProvenance {
  readonly providerId: string;
  readonly profile: string;
  readonly providerVersion?: string;
}

/**
 * One reason a candidate failed hard eligibility (§17). `code` is stable and
 * machine-readable; `message` is diagnostics, not rider copy; `constraintId`
 * points at the authored constraint that failed when one exists.
 */
export interface EligibilityFailure {
  readonly code: string;
  readonly message: string;
  readonly constraintId?: string;
}

/**
 * The hard-eligibility verdict (§17). `failures` is empty exactly when
 * `eligible` is true, so an ineligible candidate always explains itself.
 */
export interface EligibilityResult {
  readonly eligible: boolean;
  readonly failures: readonly EligibilityFailure[];
}

/**
 * One deterministic score contribution (§19). `input` is the normalized input
 * value, or `null` when the evidence was not usable — in which case
 * `contribution` reflects policy, never a fabricated measurement.
 */
export interface ScoreComponent {
  readonly input: number | null;
  readonly weight: number;
  readonly contribution: number;
  /** Stable key the UI resolves to explanation copy; never a sentence. */
  readonly explanationKey: string;
  readonly evidenceStatus: EvidenceStatus;
}

/** The §19 component set; a missing or renamed component is a compile error. */
export interface RouteScoreComponents {
  readonly curvature: ScoreComponent;
  readonly backroad: ScoreComponent;
  readonly surfaceFit: ScoreComponent;
  readonly elevation: ScoreComponent;
  readonly traffic: ScoreComponent;
  readonly junctionFriction: ScoreComponent;
  readonly novelty: ScoreComponent;
  readonly closureRisk: ScoreComponent;
  readonly timeCost: ScoreComponent;
  readonly confidence: ScoreComponent;
}

/**
 * One candidate's deterministic score (§19). No AI-generated numeric component
 * ever lands here: every component is produced by versioned policy from
 * evidence, and `policyVersion` names the policy that did it.
 */
export interface RouteScore {
  readonly policyVersion: string;
  readonly total: number;
  readonly components: RouteScoreComponents;
}

/** How loud a warning is; `blocking` is reserved for policy-hard findings. */
export type RouteWarningSeverity = "info" | "warning" | "blocking";

/**
 * One rider-relevant caveat about a candidate. `id` is stable inside a bundle
 * (so the UI can dismiss or collapse one), `code` is the machine key, and
 * `message` is the already-localized copy the pipeline authored.
 */
export interface RouteWarning {
  readonly id: string;
  readonly code: string;
  readonly severity: RouteWarningSeverity;
  readonly message: string;
}

/** Provider-neutral maneuver facts retained for Ride Focus guidance. */
export interface RouteInstruction {
  readonly text: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly type: string;
  readonly maneuver?: "left" | "right" | "slight-left" | "slight-right" | "straight" | "uturn";
  readonly roadName?: string;
  /** First route-geometry vertex in the provider's instruction interval. */
  readonly geometryIndex?: number;
}

export const MAX_ROUTE_INSTRUCTIONS = 512;

/**
 * A posted speed limit over route-geometry steps `fromIndex → toIndex` (NV-04).
 * Only limits mapped in OpenStreetMap: the engine's estimates for untagged
 * roads are dropped, so a rider never sees a guess dressed as a sign.
 */
export interface SpeedLimitSpan {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly kmh: number;
}

export const MAX_SPEED_LIMIT_SPANS = 2048;

export function isSpeedLimitSpan(value: unknown): value is SpeedLimitSpan {
  if (!isRecord(value)) return false;
  const { fromIndex, toIndex, kmh } = value;
  return (
    typeof fromIndex === "number" && Number.isSafeInteger(fromIndex) && fromIndex >= 0 &&
    typeof toIndex === "number" && Number.isSafeInteger(toIndex) && toIndex > fromIndex &&
    typeof kmh === "number" && Number.isFinite(kmh) && kmh > 0 && kmh <= 200
  );
}

export function isSpeedLimitSpans(value: unknown): value is readonly SpeedLimitSpan[] {
  return Array.isArray(value) && value.length <= MAX_SPEED_LIMIT_SPANS && value.every(isSpeedLimitSpan);
}

/** The posted limit on geometry step `segmentIndex`, or null where none is mapped. */
export function speedLimitAt(spans: readonly SpeedLimitSpan[] | undefined, segmentIndex: number): number | null {
  if (spans === undefined) return null;
  for (const span of spans) {
    if (segmentIndex >= span.fromIndex && segmentIndex < span.toIndex) return span.kmh;
  }
  return null;
}

/** A US sign reads in 5 mph steps; km/h from OSM `35 mph` is 56.3. */
export function speedLimitMph(kmh: number): number {
  return Math.round(kmh / 1.609344 / 5) * 5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validation at the route-plan wire and persisted Ride Focus pointer boundary. */
export function isRouteInstruction(value: unknown): value is RouteInstruction {
  if (!isRecord(value)) return false;
  const maneuver = value["maneuver"];
  const allowedManeuvers = ["left", "right", "slight-left", "slight-right", "straight", "uturn"];
  const geometryIndex = value["geometryIndex"];
  const roadName = value["roadName"];
  return (
    typeof value["text"] === "string" && value["text"].length <= 512 &&
    typeof value["type"] === "string" && value["type"].length > 0 && value["type"].length <= 40 &&
    typeof value["distanceMeters"] === "number" && Number.isFinite(value["distanceMeters"]) && value["distanceMeters"] >= 0 &&
    typeof value["durationSeconds"] === "number" && Number.isFinite(value["durationSeconds"]) && value["durationSeconds"] >= 0 &&
    (maneuver === undefined || (typeof maneuver === "string" && allowedManeuvers.includes(maneuver)) ) &&
    (roadName === undefined || (typeof roadName === "string" && roadName.length <= 160)) &&
    (geometryIndex === undefined || (typeof geometryIndex === "number" && Number.isSafeInteger(geometryIndex) && geometryIndex >= 0))
  );
}

/**
 * The stable evidence keys of §18. The map stays open (`RouteEvidence` accepts
 * any key) so a new evidence source does not require a breaking type change,
 * but these are the keys the pipeline and the UI already agree on.
 */
export type RouteEvidenceKey =
  | "surfaceMix"
  | "difficultyCoverage"
  | "access"
  | "closures"
  | "traffic"
  | "weatherExposure"
  | "daylight"
  | "curvature"
  | "elevation"
  | "urbanFriction"
  | "roadClassMix"
  | "scenery"
  | "novelty"
  | "fuelGap"
  | "knownRoadConfidence"
  /**
   * How much of a committed sketch's drawn trace the returned route covers
   * (06 §18, Task 4.4). Deliberately **not** a member of
   * {@link ROUTE_EVIDENCE_KEYS}: a ride without a sketch is not missing this
   * value, the question simply does not apply, so counting its absence as
   * unknown evidence would penalize every sketch-free ride (`OGV-D-248`).
   */
  | "sketchAdherence";

/**
 * The declared evidence keys as a runtime list, so a consumer that must count or
 * iterate the set cannot drift from the type. Scoring weights measured coverage
 * only across its quality and cost axes, rather than counting these keys.
 * Keys outside this list are still valid evidence (the map stays open). That is
 * where `sketchAdherence` sits, on purpose: it exists only for a ride that has a
 * sketch, so it is measured and explained but never scored as a coverage gap.
 */
export const ROUTE_EVIDENCE_KEYS = [
  "surfaceMix",
  "difficultyCoverage",
  "access",
  "closures",
  "traffic",
  "weatherExposure",
  "daylight",
  "curvature",
  "elevation",
  "urbanFriction",
  "roadClassMix",
  "scenery",
  "novelty",
  "fuelGap",
  "knownRoadConfidence",
] as const satisfies readonly RouteEvidenceKey[];

/**
 * Everything the pipeline knows about a candidate, keyed by evidence key
 * (§18). Values carry their own status, confidence and provenance, so an
 * absent value stays `unknown` instead of becoming an implied negative.
 */
export type RouteEvidence = Readonly<Record<string, EvidenceValue<unknown>>>;

/** One route the pipeline produced (§14), ready for eligibility and scoring. */
export interface RouteCandidate {
  readonly id: RouteCandidateId;
  /** Diagnostics only — never rider copy (Rule E / VNX-007). */
  readonly provider: ProviderProvenance;
  readonly geometryRef: GeometryRef;
  /** Stored turn-by-turn instructions, when the provider supplied them. */
  readonly instructionsRef?: BlobRef;
  /** Bounded provider facts used to build the active RideSession guidance frame. */
  readonly instructions?: readonly RouteInstruction[];
  /** Posted speed limits along the geometry, when the engine knows them (NV-04). */
  readonly speedLimits?: readonly SpeedLimitSpan[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly eligibility: EligibilityResult;
  readonly evidence: RouteEvidence;
  readonly score: RouteScore;
  readonly warnings: readonly RouteWarning[];
  /**
   * Stable identity of the candidate's geometry+constraints, used to detect
   * duplicates across providers (06 §14) without comparing coordinates.
   */
  readonly fingerprint: string;
}

/** Who decided the selection: the policy or the rider (§15). */
export type RouteSelectionSource = "automatic" | "rider";

/**
 * Role assignment (§16). A role is `null` when no candidate materially
 * satisfies the distinction; roles are never forced to fill the record.
 */
export type RouteRoles = Readonly<Record<RouteRole, RouteCandidateId | null>>;

/**
 * One planning attempt's result for one ride revision (§15).
 *
 * A bundle exists only when a route was selected: an attempt that selects
 * nothing is a planning failure with its own result type, not an empty bundle.
 * Ownership identity (`rideId`, `rideRevision`, `planningGeneration`) plus the
 * four versions is what lets a late response be recognized as stale
 * (02-ARCHITECTURE-CONTRACT §2.2, §13).
 */
export interface RouteBundle {
  readonly rideId: RideId;
  readonly rideRevision: number;
  readonly planningGeneration: number;
  readonly policyVersion: string;
  readonly graphVersion: string;
  readonly evidenceVersion: string;
  readonly candidates: readonly RouteCandidate[];
  readonly selectedRouteId: RouteCandidateId;
  readonly selectionSource: RouteSelectionSource;
  readonly roles: RouteRoles;
  readonly createdAt: string;
}
