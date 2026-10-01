/**
 * The RouteCandidateProvider port (02-ARCHITECTURE-CONTRACT §10,
 * 06-ROUTING-AND-DECISION-ENGINE §2–§4).
 *
 * The core rule of the routing engine is **providers generate paths; OpenGravel
 * determines whether they are valid, useful, distinct and worth showing**. This
 * port is that boundary, and it is deliberately narrow:
 *
 * - a provider **proposes** candidates — it never returns "Best Ride", never
 *   scores, never assigns a role, never decides eligibility, and never returns
 *   rider-facing copy;
 * - a provider answers one request with plain data: full-resolution geometry
 *   plus honest metrics, so the application layer owns normalization,
 *   eligibility, enrichment, scoring, diversity, roles and warnings;
 * - a provider is addressed by its own `id` and reports its own
 *   provider-internal profile ids, so nothing outside the adapter has to know
 *   how a given engine names its models.
 *
 * ## Cancellation contract
 *
 * Every implementation MUST pass the caller's `signal` into every network call
 * it makes (fetch, worker message, timer that outlives the call) and MUST
 * reject with the abort reason once the signal aborts — a cancelled plan must
 * not leave work running behind a response nobody will read. The application
 * layer owns the `AbortController`; this port only carries the signal.
 */

import type {
  Coordinate,
} from "@/domain/ride/types";
import type { RouteEvidence, RouteInstruction, RouteScore, RouteWarning, SpeedLimitSpan } from "@/domain/route/types";
import {
  MAX_SKETCH_REQUEST_ANCHORS,
  type SketchEndpoints,
  type SketchEndpointPolicy,
  type SketchTopologyHintKind,
} from "@/domain/sketch/types";

/** What one provider can do, in its own vocabulary (§3, §6). */
export interface ProviderCapabilities {
  /** Provider-internal profile ids this deployment can serve. */
  readonly profiles: readonly string[];
  readonly supportsAlternatives: boolean;
  readonly supportsAvoidPolygons: boolean;
}

/** One factor of `06 §4`'s lane policy a provider answer carries (06 §3). */
export interface ProviderRouteOptions {
  readonly includeAlternatives: boolean;
  readonly avoidHighways: boolean;
  readonly tollPolicy: "avoid" | "allow-with-warning";
  /**
   * The rider's surface envelope (03 §8, M2). Optional on the wire so an older
   * client stays valid; absent means "no preference was sent", which a provider
   * treats as `mixed` (no request-time surface rule). OGV-D-262.
   */
  readonly surfacePreference?: "pavement" | "mostly-pavement" | "mixed" | "dirt-preferred";
  /**
   * The rider's road character. Two characters share an engine profile, so the
   * server cannot recover it from `profile`; sent so scoring weighs curvature
   * and backroads the way the rider asked (OGV-D-263). Optional, like surface.
   */
  readonly roadCharacter?: "efficient" | "balanced" | "curvy" | "backroads";
  /**
   * Personal road-familiarity preference. Optional for older clients; absent
   * means balanced. This is scoring context, never provider-supplied evidence.
   */
  readonly noveltyPreference?: "prefer-new-to-me" | "balanced" | "prefer-familiar";
  /** VNext plans motorcycle rides; a provider must never guess otherwise. */
  readonly vehicle: "motorcycle";
}

/**
 * One road the rider must use, prefers, or avoids (03-DOMAIN-MODEL §12,
 * 04 §17, 06 §8/§19).
 *
 * This is the resolved projection of a `RoadSpanConstraint` onto the
 * provider-neutral request: identity, mode and direction are the authored
 * declaration, `anchors` are the ordered entry/exit coordinates a `must` span
 * forces as via waypoints, and `corridor` is the stored span line used to build
 * the thin polygon a `prefer` span rewards or an `avoid` span refuses.
 *
 * `corridor` is deliberately **bounded** ({@link MAX_PROVIDER_SPAN_CORRIDOR_POINTS}) because the request is the wire
 * contract (23 §2): a corridor longer than the bound is omitted rather than
 * truncated, which weakens only the request-time shaping — the domain's own
 * coverage measurement against the returned route still decides the constraint's
 * verdict, so nothing is silently satisfied.
 */
export interface ProviderRoadSpan {
  readonly id: string;
  readonly mode: "must" | "prefer" | "avoid";
  readonly direction: "forward" | "reverse" | "either";
  /** Ordered entry then exit anchors; fewer than two means unresolved. */
  readonly anchors: readonly Coordinate[];
  /** The resolved span line, when it fits the wire bound. */
  readonly corridor?: readonly Coordinate[];
  readonly corridorToleranceMeters?: number;
}

/**
 * The most spans one request may carry (23 §14). Eight is the product bound the
 * validation gate enforces on both sides of the wire.
 */
export const MAX_PROVIDER_ROAD_SPANS = 8;

/** The most anchors one span may carry: an entry, an exit, and bounded slack. */
export const MAX_PROVIDER_SPAN_ANCHORS = 8;

/**
 * The longest corridor the wire will carry for one span. A full-resolution
 * route line can be thousands of vertices; sending them all would blow the
 * request's field budget for a shaping polygon that is only a hint. A longer
 * corridor is omitted, never silently truncated (see {@link ProviderRoadSpan}).
 */
export const MAX_PROVIDER_SPAN_CORRIDOR_POINTS = 256;

/**
 * The most routing anchors one sketch contributes (04 §19, 06 §18, OGV-D-285).
 *
 * Anchors are placed by the drawing's shape, dense where it twists and sparse on
 * straights, so this bound is sized for a 300-mile day ride rather than for one
 * engine request: the provider routes a long list in chunks and stitches them.
 */
export const MAX_PROVIDER_SKETCH_ANCHORS = MAX_SKETCH_REQUEST_ANCHORS;

/**
 * The longest corridor the wire will carry for one sketch (OGV-D-285).
 *
 * Unlike a span's corridor, a sketch's is never omitted: a longer trace is fitted
 * to this budget by Douglas–Peucker at a growing tolerance
 * (`resampleSketchCorridor`), because the drawn line is both what the router is
 * asked to follow and what adherence is measured against. Two thousand points
 * keep a 300-mile drawing within a few meters of what was drawn.
 */
export const MAX_PROVIDER_SKETCH_CORRIDOR_POINTS = 2_000;

/** The most topology hints one sketch carries (04 §19, 05 §19). */
export const MAX_PROVIDER_SKETCH_TOPOLOGY_HINTS = 64;

/** One structural feature of a sketch's raw trace (05 §19, 03 §13). */
export interface ProviderSketchTopologyHint {
  readonly kind: SketchTopologyHintKind;
  readonly at: Coordinate;
  readonly strokeIndices?: readonly number[];
}

/**
 * A resolved sketch on the wire (03 §13, 04 §19, 06 §18).
 *
 * This is the projection of a committed `SketchIntent` onto the provider-neutral
 * request: `anchors` are the sampled via points a provider should route through,
 * `corridor` is the simplified trace adherence is measured against, and the
 * endpoint policy travels so the server can reconstruct what the sketch asked
 * for. The raw strokes deliberately do **not** travel: they stay in the client's
 * GeometryStore, and re-deriving from them is the client's job (04 §19 "retry uses
 * the original geographic trace").
 */
export interface ProviderSketch {
  /** Shape-aware via points, at most {@link MAX_PROVIDER_SKETCH_ANCHORS}. */
  readonly anchors: readonly Coordinate[];
  /**
   * The simplified corridor: the band the router follows and the adherence
   * reference, fitted to {@link MAX_PROVIDER_SKETCH_CORRIDOR_POINTS}. Optional on
   * the wire only so an older client stays valid; the builder always sends it.
   */
  readonly corridor?: readonly Coordinate[];
  readonly endpointPolicy: SketchEndpointPolicy;
  /** True when the trace's own endpoints came within the loop threshold. */
  readonly nearLoop: boolean;
  readonly topologyHints: readonly ProviderSketchTopologyHint[];
  /** The trace's own endpoints, or `null` when the trace had no usable line. */
  readonly derivedEndpoints: SketchEndpoints | null;
}

/**
 * One fully resolved planning request. The application layer built it from a
 * normalized `RideIntent`: coordinates are engine-ready, the profile is the
 * internal profile chosen by policy, and avoid polygons are resolved rings
 * rather than geometry handles.
 */
export interface ProviderRouteRequest {
  readonly requestId: string;
  readonly origin: Coordinate;
  /** The endpoint to plan to; a loop rides back to the origin (§17). */
  readonly destination: Coordinate;
  /** Ordered intermediates; the provider must visit them in this order. */
  readonly stops: readonly Coordinate[];
  /** Ordered shaping anchors; they bias the path and are not stops. */
  readonly shaping: readonly Coordinate[];
  /** Internal provider profile, chosen by OpenGravel policy (§6). */
  readonly profile: string;
  /** Resolved avoid rings, outer ring first within each area. */
  readonly avoidPolygons: readonly (readonly Coordinate[])[];
  /**
   * Resolved road-span constraints (04 §17, 06 §8). Absent means the caller
   * resolved none, which is not the same as "the ride has none": the builder
   * that has an intent populates it, and an absent list disables no constraint
   * the domain would otherwise measure.
   */
  readonly roadSpans?: readonly ProviderRoadSpan[];
  /**
   * The resolved sketch trace (03 §13, 06 §18). Absent means the ride has no
   * sketch, or the caller could not resolve its geometry — the two are
   * distinguished by the builder's `unresolvedRefs`, never by an empty sketch.
   */
  readonly sketch?: ProviderSketch;
  readonly options: ProviderRouteOptions;
  /**
   * Planning-time loop discovery context. A provider may use this to propose
   * bounded loops, but none of these requested preferences proves the returned
   * path satisfies them; OpenGravel measures that after the answer returns.
   */
  readonly discovery?: {
    readonly targetMinutes: number;
    readonly toleranceMinutes: number;
  };
}

/** Provider report alias; route instructions are also part of the route domain. */
export type ProviderInstruction = RouteInstruction;

/**
 * One proposed path. Metrics are the provider's own numbers: OpenGravel treats
 * them as candidate input, measures them against constraints (§8), and never
 * trusts that a requested shaping point was honored.
 */
export interface ProviderCandidate {
  readonly providerId: string;
  /** The internal profile that produced this candidate. */
  readonly profile: string;
  /** Full-resolution line, in travel order. */
  readonly geometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly instructions?: readonly ProviderInstruction[];
  /** Posted speed limits along `geometry` (NV-04). */
  readonly speedLimits?: readonly SpeedLimitSpan[];
  /** Provider diagnostics (graph fingerprint, toll flags, …). */
  readonly providerMetadata?: Readonly<Record<string, string | number | boolean>>;
  /** What the engine knows about the roads under the line (M3, OGV-D-263). */
  readonly roadSummary?: ProviderRoadSummary;
  /**
   * The server pipeline's verdict on this candidate, when the candidate came
   * through `/api/route-plan` (M3, OGV-D-263): its evidence, score and
   * warnings. The browser keeps them instead of re-deriving an unscored stub.
   */
  readonly assessment?: ProviderAssessment;
}

export interface ProviderAssessment {
  readonly evidence: RouteEvidence;
  readonly score: RouteScore;
  readonly warnings: readonly RouteWarning[];
}

/**
 * The engine's per-edge road attributes, reduced to metres (M3, OGV-D-263).
 *
 * Raw vocabulary on purpose: keys are the engine's own OSM-derived values, so
 * the application layer owns what "paved" or "a backroad" means. Every map sums
 * to `totalMeters` (an edge the engine did not describe is under `"missing"`).
 */
export interface ProviderRoadSummary {
  readonly totalMeters: number;
  /** Metres by `${surface}|${roadClass}`, e.g. `asphalt|secondary`, `missing|tertiary`. */
  readonly surfaceByRoadClassMeters: Readonly<Record<string, number>>;
  /**
   * Metres by curvature ratio (straight-line distance over road length, per
   * edge: `1` is straight, lower is curvier), keyed by the ratio to two decimals.
   */
  readonly curvatureMeters: Readonly<Record<string, number>>;
  /** Metres on edges tagged as toll roads. */
  readonly tollMeters: number;
  /**
   * Metres ridden through bends, measured on the returned line itself
   * (`bendMeters`). Preferred over `curvatureMeters`, whose per-edge ratio
   * reads a winding road cut into short edges as straight.
   */
  readonly bendMeters?: number;
  /**
   * Longest uninterrupted multi-vertex bend run on the returned line. This is
   * deliberately geometry-derived, not GraphHopper's per-edge curvature ratio.
   */
  readonly longestBendRunMeters?: number;
  /** Number of separate qualifying bend runs on the returned line. */
  readonly bendRunCount?: number;
  /**
   * The same `${surface}|${roadClass}` keys in travel order, as `[metres, key]`
   * runs with consecutive equal keys merged: where along the line each surface
   * is, for the surface strip under the elevation profile (UX rework phase 9).
   */
  readonly surfaceRuns?: readonly (readonly [number, string])[];
}

/** What one provider call returned. An empty set is a valid answer. */
export interface ProviderCandidateSet {
  readonly candidates: readonly ProviderCandidate[];
  /** Reading of an already-scored route, carried separately from road facts. */
  readonly funCharacter?: import("./ports/route-plan-contract").RoutePlanFunCharacterWire;
}

/**
 * A candidate source. Implementations live under
 * `src/infrastructure/routing/**` and may import this port — and only this
 * port — from the application layer (Rule E).
 */
export interface RouteCandidateProvider {
  readonly id: string;

  capabilities(): ProviderCapabilities;

  /**
   * Proposes candidate paths for one request. Resolves with what the provider
   * has (possibly nothing) and rejects on failure or abort; the caller decides
   * whether a provider outage removes candidates or fails the plan (§3).
   */
  candidates(
    request: ProviderRouteRequest,
    signal: AbortSignal,
  ): Promise<ProviderCandidateSet>;
}
