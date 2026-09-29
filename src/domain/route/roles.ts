/**
 * Rider role assignment (Wave 3 Task 3.3, 03-DOMAIN-MODEL §16,
 * 06-ROUTING-AND-DECISION-ENGINE §11/§13/§15, VNX-006/VNX-007).
 *
 * A role is a **claim about a candidate's metrics**, and the two rules that make
 * the record trustworthy are both encoded here:
 *
 * 1. **Roles are earned, never forced** (`06 §15`). `fastest` is the reference
 *    to the same-constraint eligible set and always exists when there is a
 *    candidate; `best-ride` is the best deterministic score; every other role
 *    is claimed only when a candidate beats the best ride by the policy's
 *    materiality margin on that role's own metric. A record full of `null`s is a
 *    truthful answer, so an unscored or unmeasured bundle claims nothing.
 * 2. **A provider label buys nothing** (VNX-007). `RoleCandidate` has no
 *    provider field at all: a candidate cannot be "More Dirt" because its lane
 *    ran the adventure profile, and the type makes that impossible rather than
 *    merely discouraged. The metric readers below are the only inputs.
 *
 * ## Identity is the caller's business (`OGV-D-201`)
 *
 * `RouteCandidateId` is minted by whoever stores the candidate (the server for
 * the wire, the client controller for its `GeometryStore`), while the candidate
 * pipeline is pure and mints nothing. Roles are therefore assigned over a
 * generic identity, so the pipeline can assign them by **kept index** and the
 * caller binds real ids with {@link bindRoles} in one step. That is why this
 * module never needs an id factory.
 *
 * ## The metrics
 *
 * Roles read the deterministic score's own component inputs rather than a
 * second measurement of the same geometry, so the rider's card and the role
 * label cannot disagree:
 *
 * | role             | metric                                     |
 * | ---------------- | ------------------------------------------ |
 * | `more-twisties`  | `curvature` input (higher is better)       |
 * | `more-dirt`      | `surfaceFit` input (higher is better)      |
 * | `lower-workload` | `junctionFriction` input (lower is better) |
 * | `fast-and-fun`   | `curvature` input, gated by the fast-and-fun detour envelope |
 *
 * A `null` input is an unmeasured metric: the component says so (`06 §10`), and
 * the role stays unclaimed instead of being decided from an unknown. In Wave 3
 * that means `more-dirt` and `lower-workload` are honestly unearnable until a
 * surface/urban-friction evidence source exists (Wave 7).
 */

import type { RouteCandidateId } from "./ids";
import {
  ROLE_MATERIALITY_VNEXT_1,
  type RoleMateriality,
  type RoutePolicy,
} from "./policy";
import type { RouteRole, RouteScore } from "./types";

/** The role keys in assignment order; `best-ride` is the rider-facing headline. */
const ROUTE_ROLE_KEYS: readonly RouteRole[] = [
  "best-ride",
  "fastest",
  "fast-and-fun",
  "more-twisties",
  "more-dirt",
  "lower-workload",
];

/** The material roles, in the order a slot is offered. */
const MATERIAL_ROLE_KEYS = [
  "fast-and-fun",
  "more-twisties",
  "more-dirt",
  "lower-workload",
] as const satisfies readonly RouteRole[];

/** A candidate holds at most this many roles (`06 §15`, `OGV-D-202`). */
const MAX_ROLES_PER_CANDIDATE = 2;

/**
 * Floating-point tolerance for a materiality comparison. Comparisons are on
 * differences of normalized 0–1 metrics, and `0.5 - 0.4` is
 * `0.09999999999999998`: a candidate exactly at the threshold must be credited,
 * not rejected by representation noise (`OGV-D-203`).
 */
const MATERIALITY_EPSILON = 1e-9;

/** The candidate facts a role decision reads. */
export interface RoleCandidate<Id extends string | number = RouteCandidateId> {
  readonly id: Id;
  readonly durationSeconds: number;
  readonly distanceMeters: number;
  readonly score: RouteScore;
}

/** One role per candidate identity, or `null` when the role was not earned. */
export type RoleAssignment<Id extends string | number = RouteCandidateId> = Readonly<
  Record<RouteRole, Id | null>
>;

function noRoles<Id extends string | number>(): Record<RouteRole, Id | null> {
  return {
    "best-ride": null,
    fastest: null,
    "fast-and-fun": null,
    "more-twisties": null,
    "more-dirt": null,
    "lower-workload": null,
  };
}

/** Stable id ordering: a tie must never depend on object identity or input order. */
function byStableId<Id extends string | number>(
  left: RoleCandidate<Id>,
  right: RoleCandidate<Id>,
): number {
  const first = String(left.id);
  const second = String(right.id);
  return first < second ? -1 : first > second ? 1 : 0;
}

/** `fastest` order: shortest duration, then shortest distance, then stable id. */
function isFaster<Id extends string | number>(
  candidate: RoleCandidate<Id>,
  incumbent: RoleCandidate<Id>,
): boolean {
  if (candidate.durationSeconds !== incumbent.durationSeconds) {
    return candidate.durationSeconds < incumbent.durationSeconds;
  }
  if (candidate.distanceMeters !== incumbent.distanceMeters) {
    return candidate.distanceMeters < incumbent.distanceMeters;
  }
  return byStableId(candidate, incumbent) < 0;
}

/** The `surfaceFit` component input, or `null` when it was not measured. */
function surfaceFitInput<Id extends string | number>(
  candidate: RoleCandidate<Id>,
): number | null {
  return candidate.score.components.surfaceFit.input;
}

/**
 * `best-ride` order: highest deterministic score, then the higher surface fit,
 * then the shorter duration, then the stable id. The score is the product
 * ranking; the tie-breaks only decide what to show when two candidates are
 * indistinguishable to the policy (`OGV-D-202`).
 */
function isBetterRide<Id extends string | number>(
  candidate: RoleCandidate<Id>,
  incumbent: RoleCandidate<Id>,
): boolean {
  if (candidate.score.total !== incumbent.score.total) {
    return candidate.score.total > incumbent.score.total;
  }
  const candidateSurface = surfaceFitInput(candidate) ?? Number.NEGATIVE_INFINITY;
  const incumbentSurface = surfaceFitInput(incumbent) ?? Number.NEGATIVE_INFINITY;
  if (candidateSurface !== incumbentSurface) {
    return candidateSurface > incumbentSurface;
  }
  if (candidate.durationSeconds !== incumbent.durationSeconds) {
    return candidate.durationSeconds < incumbent.durationSeconds;
  }
  return byStableId(candidate, incumbent) < 0;
}

/** The `curvature` component input (0–1), or `null`. */
function curvatureInput<Id extends string | number>(
  candidate: RoleCandidate<Id>,
): number | null {
  return candidate.score.components.curvature.input;
}

/** The `junctionFriction` component input (0–1, lower is calmer), or `null`. */
function junctionFrictionInput<Id extends string | number>(
  candidate: RoleCandidate<Id>,
): number | null {
  return candidate.score.components.junctionFriction.input;
}

/** True when `value` improves on `reference` by at least `margin`. */
function beatsByAtLeast(value: number, reference: number, margin: number): boolean {
  return value - reference >= margin - MATERIALITY_EPSILON;
}

/** True when `value` is at least `margin` below `reference`. */
function lowerByAtLeast(value: number, reference: number, margin: number): boolean {
  return reference - value >= margin - MATERIALITY_EPSILON;
}

/**
 * The `fast-and-fun` time gate: the candidate must sit inside the role's own
 * detour envelope over the fastest reference (`06 §11`). An unmeasurable
 * reference duration fails closed — no envelope, no claim.
 */
function withinFastAndFunEnvelope<Id extends string | number>(
  candidate: RoleCandidate<Id>,
  fastest: RoleCandidate<Id>,
  policy: RoutePolicy,
): boolean {
  if (!(fastest.durationSeconds > 0)) return false;
  const detourPct =
    (candidate.durationSeconds - fastest.durationSeconds) / fastest.durationSeconds;
  return (
    detourPct <=
    policy.roleDetourEnvelopes["fast-and-fun"].maximumPct + MATERIALITY_EPSILON
  );
}

/**
 * Assigns the §16 roles. Pure and total: an empty candidate set claims nothing,
 * an unmeasured metric claims nothing, and no candidate ever holds more than
 * {@link MAX_ROLES_PER_CANDIDATE} roles.
 *
 * `fastest` may coincide with `best-ride` — one candidate that is both the
 * quickest and the best ride is a meaningful outcome, not a conflict.
 *
 * `canBeBestRide` narrows who may be the best ride: a timeboxed loop's best
 * ride is one that fits the ride time (OGV-D-262), whatever else scores higher.
 * When no candidate passes it, every candidate may.
 */
export function assignRoles<Id extends string | number>(
  candidates: readonly RoleCandidate<Id>[],
  policy: RoutePolicy,
  materiality: RoleMateriality = ROLE_MATERIALITY_VNEXT_1,
  canBeBestRide: (candidate: RoleCandidate<Id>) => boolean = () => true,
): RoleAssignment<Id> {
  const roles = noRoles<Id>();
  const first = candidates[0];
  if (first === undefined) return roles;

  const rideCandidates = candidates.some(canBeBestRide)
    ? candidates.filter(canBeBestRide)
    : candidates;
  let fastest = first;
  let bestRide = rideCandidates[0] ?? first;
  for (const candidate of candidates) {
    if (isFaster(candidate, fastest)) fastest = candidate;
  }
  for (const candidate of rideCandidates) {
    if (isBetterRide(candidate, bestRide)) bestRide = candidate;
  }
  roles.fastest = fastest.id;
  roles["best-ride"] = bestRide.id;

  const held = new Map<Id, number>();
  const claim = (candidate: RoleCandidate<Id>): void => {
    held.set(candidate.id, (held.get(candidate.id) ?? 0) + 1);
  };
  claim(fastest);
  if (bestRide.id !== fastest.id) claim(bestRide);
  const canHold = (candidate: RoleCandidate<Id>): boolean =>
    (held.get(candidate.id) ?? 0) < MAX_ROLES_PER_CANDIDATE;

  for (const role of MATERIAL_ROLE_KEYS) {
    const winner = materialWinner({
      role,
      candidates,
      bestRide,
      fastest,
      policy,
      materiality,
      canHold,
    });
    if (winner === null) continue;
    roles[role] = winner.id;
    claim(winner);
  }

  return roles;
}

interface MaterialQuery<Id extends string | number> {
  readonly role: (typeof MATERIAL_ROLE_KEYS)[number];
  readonly candidates: readonly RoleCandidate<Id>[];
  readonly bestRide: RoleCandidate<Id>;
  readonly fastest: RoleCandidate<Id>;
  readonly policy: RoutePolicy;
  readonly materiality: RoleMateriality;
  readonly canHold: (candidate: RoleCandidate<Id>) => boolean;
}

/**
 * The best candidate that materially beats the best ride on `role`'s metric and
 * can still hold a role, or `null`. Candidates are considered in metric order
 * (with duration and id as stable tie-breaks), so a candidate that has already
 * spent its two roles passes the claim to the next qualified one instead of
 * consuming it.
 *
 * The switch returns for every member of the material-role vocabulary, so a role
 * added without a metric becomes a compile error instead of a silently
 * unassigned claim.
 */
function materialWinner<Id extends string | number>(
  query: MaterialQuery<Id>,
): RoleCandidate<Id> | null {
  const { role } = query;
  switch (role) {
    case "more-twisties":
      return winnerByMetric(query, curvatureInput, (value, reference) =>
        beatsByAtLeast(value, reference, query.materiality.twistiness),
      );
    case "more-dirt":
      return winnerByMetric(query, surfaceFitInput, (value, reference) =>
        beatsByAtLeast(value, reference, query.materiality.surfaceFit),
      );
    case "lower-workload":
      return winnerByMetric(query, junctionFrictionInput, (value, reference) =>
        lowerByAtLeast(value, reference, query.materiality.junctionFriction),
      );
    case "fast-and-fun":
      return winnerByMetric(
        query,
        curvatureInput,
        (value, reference) =>
          beatsByAtLeast(value, reference, query.materiality.twistiness),
        (candidate) =>
          withinFastAndFunEnvelope(candidate, query.fastest, query.policy),
      );
  }
}

/** Candidates ordered by the metric (best first), then duration, then id. */
function winnerByMetric<Id extends string | number>(
  query: MaterialQuery<Id>,
  readMetric: (candidate: RoleCandidate<Id>) => number | null,
  isMaterial: (value: number, reference: number) => boolean,
  extraGate?: (candidate: RoleCandidate<Id>) => boolean,
): RoleCandidate<Id> | null {
  const reference = readMetric(query.bestRide);
  if (reference === null) return null;

  const qualified: { readonly candidate: RoleCandidate<Id>; readonly value: number }[] = [];
  for (const candidate of query.candidates) {
    const value = readMetric(candidate);
    if (value === null || !isMaterial(value, reference)) continue;
    if (extraGate !== undefined && !extraGate(candidate)) continue;
    qualified.push({ candidate, value });
  }

  // `lower-workload` reads a cost axis, and its `isMaterial` already encodes the
  // direction, so the sort is "best metric first" for the lower-is-better role
  // and "highest metric first" otherwise.
  const lowerIsBetter = query.role === "lower-workload";
  qualified.sort((left, right) => {
    if (left.value !== right.value) {
      return lowerIsBetter ? left.value - right.value : right.value - left.value;
    }
    if (left.candidate.durationSeconds !== right.candidate.durationSeconds) {
      return left.candidate.durationSeconds - right.candidate.durationSeconds;
    }
    return byStableId(left.candidate, right.candidate);
  });

  for (const entry of qualified) {
    if (query.canHold(entry.candidate)) return entry.candidate;
  }
  return null;
}

/**
 * Added minutes against the fastest reference (`06 §13`), rounded to whole
 * minutes like the card copy. `null` means there is no honest comparison: no
 * reference, or an unmeasurable duration. A negative value means the value
 * passed as the reference was not actually the minimum of the set, which the
 * caller can only cause by comparing across constraint sets — the comparison
 * must always come from the same-constraint eligible set `OGV-D-204`.
 */
export function addedMinutesVsFastest(
  candidate: { readonly durationSeconds: number },
  fastest: { readonly durationSeconds: number } | null,
): number | null {
  if (fastest === null) return null;
  if (
    !Number.isFinite(candidate.durationSeconds) ||
    !Number.isFinite(fastest.durationSeconds)
  ) {
    return null;
  }
  return Math.round((candidate.durationSeconds - fastest.durationSeconds) / 60);
}

/**
 * Binds index-shaped role assignments onto the candidates' own identities.
 * An index that names no candidate becomes `null`: a role must never point at
 * something the caller cannot show (`OGV-D-201`).
 */
export function bindRoles<Id extends string | number>(
  roles: RoleAssignment<number>,
  candidates: readonly { readonly id: Id }[],
): RoleAssignment<Id> {
  const bound = noRoles<Id>();
  for (const role of ROUTE_ROLE_KEYS) {
    const index = roles[role];
    if (index === null) continue;
    const candidate = candidates[index];
    bound[role] = candidate === undefined ? null : candidate.id;
  }
  return bound;
}
