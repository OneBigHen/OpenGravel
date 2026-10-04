/**
 * The versioned route policy (Task 3.1, 03-DOMAIN-MODEL §19,
 * 06-ROUTING-AND-DECISION-ENGINE §6/§11, 14-LEGACY-REUSE-LEDGER §4).
 *
 * Ported from the legacy `src/lib/recommendation/route-policy.ts`
 * (`OneBigHen/switchback@06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`). A score is
 * only reproducible together with the policy that produced it, so the policy is
 * an immutable, deeply frozen constant and every numeric change is a **new
 * version**, never an edit.
 *
 * Two adaptations are deliberate:
 *
 * - the legacy weight table was keyed by eight internal `RideProfile`s
 *   (including a visible `neural` one). VNext keys it by the four rider-facing
 *   road characters (`06 §6`, `OGV-D-152`) and **drops `neural`** — VNext has no
 *   personalized engine model and no AI rank authority (VNX-007).
 * - every legacy component name maps one-to-one onto the §19 component set
 *   (`twistiness`→`curvature`, `scenic`→`backroad`, `gravel`→`surfaceFit`,
 *   `simplicity`→`junctionFriction`, `safety`→`closureRisk`, `eta`→`timeCost`),
 *   so all legacy numbers are preserved exactly rather than re-tuned.
 *
 * The role detour envelopes and the timebox constant are new in VNext
 * (`06 §11`); the scalar policy values (`preferredDetourPct`, `diversityLambda`,
 * `duplicateSimilarityThreshold`, `maxAlternatives`) are the legacy ones.
 */

import type { RoadCharacterIntent } from "../ride/types";
import { deepFreeze } from "../util/freeze";
import type { RouteRole } from "./types";

/** Every §19 score component, in stable order. */
export const ROUTE_SCORE_COMPONENT_KEYS = [
  "curvature",
  "backroad",
  "surfaceFit",
  "elevation",
  "traffic",
  "junctionFriction",
  "novelty",
  "closureRisk",
  "timeCost",
  "confidence",
] as const;

export type RouteScoreComponentKey = (typeof ROUTE_SCORE_COMPONENT_KEYS)[number];

/** Non-negative weight per score component; each character's vector sums to 1. */
export type RouteScoreWeights = Readonly<Record<RouteScoreComponentKey, number>>;

/** How much extra time one role may spend for a better ride (`06 §11`). */
export interface DetourEnvelope {
  /** Detour share that is free of penalty. */
  readonly preferredPct: number;
  /** Detour share at which the role's envelope is exhausted. */
  readonly maximumPct: number;
}

/** Timeboxed-ride handling constants (`06 §11`, §17). */
export interface TimeboxPolicy {
  /**
   * Relative duration tolerance a discovered loop may miss its target by before
   * it is reported as a mismatch (legacy `ROUND_TRIP_DURATION_TOLERANCE`).
   */
  readonly roundTripDurationTolerance: number;
}

/**
 * How much better than the best ride a candidate must be before a material role
 * (`more-twisties`, `more-dirt`, `lower-workload`, `fast-and-fun`) may be
 * claimed (`06 §15`).
 *
 * Each value is a margin on the **same normalized 0–1 metric the score reads**,
 * so a threshold is comparable across candidates and cannot be satisfied by
 * measurement noise:
 *
 * - `twistiness` — the `curvature` component input;
 * - `surfaceFit` — the `surfaceFit` component input (the unpaved-share proxy);
 * - `junctionFriction` — the `junctionFriction` component input, where a
 *   *lower* value is the improvement.
 *
 * These are VNext-authored policy constants (`OGV-D-198`): they live beside the
 * policy because they are product policy, but they are deliberately **not**
 * members of `RoutePolicy`, so adding them neither changed the frozen
 * `PA_NJ_ROUTE_POLICY_VNEXT_1` object nor claimed a policy version this build
 * has not run a corpus for. They fold into `RoutePolicy` with the next version.
 */
export interface RoleMateriality {
  readonly twistiness: number;
  readonly surfaceFit: number;
  readonly junctionFriction: number;
}

/** The role materiality thresholds this build evaluates (`OGV-D-198`). */
export const ROLE_MATERIALITY_VNEXT_1: RoleMateriality = deepFreeze({
  // 10 points of the 0–1 curvature measure: a visibly different bend profile,
  // far above the ~1-point difference two runs of the same line can produce.
  twistiness: 0.1,
  // 15 points of unpaved share: "more dirt" means a materially dirtier ride.
  surfaceFit: 0.15,
  // 10 points of junction friction: a materially calmer line, not a rounding
  // difference.
  junctionFriction: 0.1,
});

/** The immutable, versioned ranking policy (`03 §19`). */
export interface RoutePolicy {
  readonly version: string;
  readonly territory: "pa-nj";
  readonly preferredDetourPct: number;
  readonly diversityLambda: number;
  readonly duplicateSimilarityThreshold: number;
  readonly maxAlternatives: number;
  readonly characterWeights: Readonly<Record<RoadCharacterIntent, RouteScoreWeights>>;
  readonly roleDetourEnvelopes: Readonly<Record<RouteRole, DetourEnvelope>>;
  readonly timebox: TimeboxPolicy;
}

const CHARACTERS: readonly RoadCharacterIntent[] = [
  "efficient",
  "balanced",
  "curvy",
  "backroads",
];

const ROLES: readonly RouteRole[] = [
  "best-ride",
  "fastest",
  "fast-and-fun",
  "more-twisties",
  "more-dirt",
  "lower-workload",
];

/**
 * Frozen PA/NJ ranking policy. Every weight traces back to
 * `PA_NJ_ROUTE_POLICY_V1`; changes require a new version and a corpus run.
 * The public export name is retained for callers; diagnostics use VNext 2
 * for the coverage-aware scoring semantics.
 */
export const PA_NJ_ROUTE_POLICY_VNEXT_1: RoutePolicy = deepFreeze({
  version: "PA_NJ_ROUTE_POLICY_VNEXT_2",
  territory: "pa-nj",
  preferredDetourPct: 0.08,
  diversityLambda: 0.35,
  duplicateSimilarityThreshold: 0.85,
  maxAlternatives: 2,
  characterWeights: {
    // legacy `quick`
    efficient: {
      curvature: 0.05,
      backroad: 0.05,
      surfaceFit: 0,
      elevation: 0.02,
      traffic: 0.2,
      junctionFriction: 0.18,
      novelty: 0.02,
      closureRisk: 0.2,
      timeCost: 0.16,
      confidence: 0.12,
    },
    // legacy `balanced`
    balanced: {
      curvature: 0.14,
      backroad: 0.12,
      surfaceFit: 0.03,
      elevation: 0.08,
      traffic: 0.14,
      junctionFriction: 0.13,
      novelty: 0.06,
      closureRisk: 0.16,
      timeCost: 0.04,
      confidence: 0.1,
    },
    // legacy `twisty`
    curvy: {
      curvature: 0.28,
      backroad: 0.1,
      surfaceFit: 0.03,
      elevation: 0.08,
      traffic: 0.12,
      junctionFriction: 0.05,
      novelty: 0.1,
      closureRisk: 0.12,
      timeCost: 0.04,
      confidence: 0.08,
    },
    // legacy `avoid-highways`
    backroads: {
      curvature: 0.18,
      backroad: 0.16,
      surfaceFit: 0.04,
      elevation: 0.08,
      traffic: 0.14,
      junctionFriction: 0.06,
      novelty: 0.08,
      closureRisk: 0.12,
      timeCost: 0.04,
      confidence: 0.1,
    },
  },
  roleDetourEnvelopes: {
    // 06 §11: Fastest takes no fun-driven detour at all.
    fastest: { preferredPct: 0, maximumPct: 0.1 },
    "fast-and-fun": { preferredPct: 0.08, maximumPct: 0.25 },
    // Best Ride is generous; More Twisties / More Dirt widen further.
    "best-ride": { preferredPct: 0.08, maximumPct: 0.35 },
    "more-twisties": { preferredPct: 0.08, maximumPct: 0.45 },
    "more-dirt": { preferredPct: 0.08, maximumPct: 0.45 },
    "lower-workload": { preferredPct: 0.05, maximumPct: 0.2 },
  },
  timebox: { roundTripDurationTolerance: 0.15 },
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function hasValidWeights(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (weight) => typeof weight === "number" && Number.isFinite(weight) && weight >= 0,
  );
}

function hasValidEnvelope(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const { preferredPct, maximumPct } = value;
  return (
    isUnitInterval(preferredPct) &&
    isUnitInterval(maximumPct) &&
    preferredPct <= maximumPct
  );
}

function hasValidCharacterWeights(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    CHARACTERS.every((character) => hasValidWeights(value[character]))
  );
}

function hasValidRoleEnvelopes(value: unknown): boolean {
  return (
    isPlainObject(value) && ROLES.every((role) => hasValidEnvelope(value[role]))
  );
}

/**
 * Runtime validator for policy data crossing a trust boundary (a persisted or
 * injected policy). It never throws and never repairs: a policy that fails any
 * clause is simply not a `RoutePolicy`.
 */
export function isRoutePolicy(value: unknown): value is RoutePolicy {
  if (!isPlainObject(value)) return false;
  const maxAlternatives = value["maxAlternatives"];
  const timebox = value["timebox"];
  return (
    typeof value["version"] === "string" &&
    value["version"].length > 0 &&
    value["territory"] === "pa-nj" &&
    isUnitInterval(value["preferredDetourPct"]) &&
    isUnitInterval(value["diversityLambda"]) &&
    isUnitInterval(value["duplicateSimilarityThreshold"]) &&
    typeof maxAlternatives === "number" &&
    Number.isInteger(maxAlternatives) &&
    maxAlternatives > 0 &&
    maxAlternatives <= 3 &&
    hasValidCharacterWeights(value["characterWeights"]) &&
    hasValidRoleEnvelopes(value["roleDetourEnvelopes"]) &&
    isPlainObject(timebox) &&
    isUnitInterval(timebox["roundTripDurationTolerance"])
  );
}
