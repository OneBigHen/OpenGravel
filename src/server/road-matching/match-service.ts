/**
 * The road-matching service (04 §17, 05 §20, 23 §14; clean-room port of the
 * legacy `src/lib/roads/road-matching.ts` at baseline `06785c00`).
 *
 * A rider points at a road; the service answers with the router's own line
 * between those anchors, how far each anchor sat from that line, and what the
 * match actually said about motorcycle access. Three boundaries are deliberate,
 * and all three are honesty rules rather than implementation detail.
 *
 * ## 1. The request goes *through* the anchors
 *
 * `origin → stops → destination` (06 §2's multi-point shape), so the returned
 * geometry is the engine's path across every anchor. The legacy two-point
 * `start`/`end` request could only ever match a single edge pair; an authored
 * span needs the road between its entry and its exit, and a middle anchor has to
 * be honored rather than passed near.
 *
 * ## 2. Every number is measured against the returned line
 *
 * A request is not evidence (06 §8). The confidence bands are computed from the
 * **maximum anchor drift** — the largest distance from an input anchor to the
 * returned geometry — never from the request, the profile, or the engine's own
 * report:
 *
 * | drift                | confidence    |
 * | -------------------- | ------------- |
 * | ≤ {@link MATCH_EXACT_METERS} m | `exact`       |
 * | ≤ {@link MATCH_MATCHED_METERS} m | `matched`     |
 * | ≤ {@link MATCH_APPROXIMATE_METERS} m | `approximate` |
 * | beyond               | refused (`no-match`) |
 *
 * A refused match is a typed error, never a straight line standing in for a road
 * (the legacy `MATCH_UNAVAILABLE` case): 05 §20 requires the rider to refine
 * rather than silently keep a neighbouring road.
 *
 * ## 3. Access evidence is never fabricated
 *
 * The legacy asserted `motorcycle: "permitted"` from the fact that a motorcycle
 * profile had routed successfully. VNext treats that as a fabricated claim: a
 * successful route says the *router* found a path, not that the road's access
 * tags permit motorcycles. The service therefore reads an explicit access value
 * out of the candidate's own provider metadata ({@link ACCESS_EVIDENCE_KEY}) and
 * reports `unknown` with a reason when the match carried none. `unknown` is
 * never `denied` — absence is not negative evidence (03 §18).
 */

import { GraphHopperProviderError } from "@/infrastructure/routing/graphhopper/response-parser";
import { distanceToLineMeters } from "@/domain/road/spans";
import { knownEvidence, unknownEvidence, type EvidenceValue } from "@/domain/evidence/types";
import type { Coordinate } from "@/domain/ride/types";
import type {
  ProviderCandidate,
  ProviderRouteRequest,
} from "@/application/planner/route-provider";
import { graphHopperProviderFromEnv } from "@/server/planning/plan-service";

/** The fewest anchors a match can be built from: an entry and an exit. */
export const MIN_MATCH_ANCHORS = 2;

/** The most anchors one bounded match accepts (23 §14). */
export const MAX_MATCH_ANCHORS = 8;

/** Drift at or below which the returned line sits on every anchor. */
export const MATCH_EXACT_METERS = 5;

/** Drift at or below which the match is still taken as the same road. */
export const MATCH_MATCHED_METERS = 25;

/** Drift beyond which 05 §20 asks the rider to refine rather than accept. */
export const MATCH_APPROXIMATE_METERS = 100;

/** The engine profile a road match is requested under. */
export const DEFAULT_MATCH_PROFILE = "motorcycle";

/**
 * The provider-metadata key an adapter may use to report actual motorcycle
 * access. The baseline GraphHopper adapter supplies none — its `/route` response
 * carries no access tag — so today every live match honestly reports `unknown`.
 * The key exists so an adapter that *does* carry the fact can state it, and so
 * nothing here has to guess.
 */
export const ACCESS_EVIDENCE_KEY = "motorcycleAccess";

/** The value of {@link ACCESS_EVIDENCE_KEY} that means "permitted". */
export const ACCESS_PERMITTED = "permitted";

/** How confidently the anchors were found on the returned line. */
export type RoadMatchConfidence = "exact" | "matched" | "approximate";

/** A usable match: the router's line plus what could honestly be measured. */
export interface RoadMatch {
  readonly matchedGeometry: readonly Coordinate[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** The largest anchor drift, in meters, measured against the returned line. */
  readonly maxDriftMeters: number;
  readonly confidence: RoadMatchConfidence;
  /**
   * What the match carried about motorcycle access. `unknown` unless the match
   * itself reported a value; never a fabricated "legal" claim (03 §18).
   */
  readonly accessEvidence: EvidenceValue<"motorcycle" | "unknown">;
}

/** Why a match could not be produced; the codes mirror the §12 taxonomy. */
export type RoadMatchErrorCode =
  | "validation"
  | "no-match"
  | "no-route"
  | "outside-coverage"
  | "provider-timeout"
  | "provider-unavailable"
  | "cancelled";

export interface RoadMatchError {
  readonly code: RoadMatchErrorCode;
  /** Always OpenGravel copy: never a raw provider message (OGV-D-162). */
  readonly message: string;
  readonly recoverable: boolean;
}

export type RoadMatchResult =
  | { readonly ok: true; readonly match: RoadMatch }
  | { readonly ok: false; readonly error: RoadMatchError };

export interface RoadMatchDeps {
  /**
   * The router. Injected by the endpoint's composition (and by every test), so
   * this service never constructs a transport of its own.
   */
  readonly provider?: Pick<
    import("@/application/planner/route-provider").RouteCandidateProvider,
    "id" | "candidates"
  >;
  readonly signal?: AbortSignal;
}

interface ParsedMatchInput {
  readonly anchors: readonly Coordinate[];
  readonly profile: string;
}

/** The copy a rider sees; each code gets its own sentence. */
const ERROR_COPY: Readonly<Record<RoadMatchErrorCode, string>> = {
  validation: "Road matching needs between two and eight valid points.",
  "no-match": "No road could be matched between these points.",
  "no-route": "No legal path was found between these points.",
  "outside-coverage": "One of these points is outside the routing coverage.",
  "provider-timeout": "The routing service did not answer in time.",
  "provider-unavailable": "The routing service is unavailable right now.",
  cancelled: "The road match was cancelled.",
};

function failure(
  code: RoadMatchErrorCode,
  recoverable = code === "provider-timeout" || code === "provider-unavailable",
): RoadMatchResult {
  return { ok: false, error: { code, message: ERROR_COPY[code], recoverable } };
}

function isFiniteCoordinate(value: unknown): value is Coordinate {
  if (typeof value !== "object" || value === null) return false;
  const { lon, lat } = value as { readonly lon?: unknown; readonly lat?: unknown };
  return (
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180 &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90
  );
}

/**
 * The bounded input gate (23 §14). Malformed values are refused here, before any
 * provider work, and the anchors are copied so nothing downstream aliases the
 * caller's body.
 */
function parseMatchInput(input: unknown): ParsedMatchInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const { anchors, profile } = input as {
    readonly anchors?: unknown;
    readonly profile?: unknown;
  };
  if (!Array.isArray(anchors)) return null;
  if (anchors.length < MIN_MATCH_ANCHORS || anchors.length > MAX_MATCH_ANCHORS) return null;
  if (!anchors.every(isFiniteCoordinate)) return null;
  if (profile !== undefined && (typeof profile !== "string" || profile.length === 0 || profile.length > 64)) {
    return null;
  }
  return {
    anchors: anchors.map((anchor) => ({ lon: anchor.lon, lat: anchor.lat })),
    profile: typeof profile === "string" ? profile : DEFAULT_MATCH_PROFILE,
  };
}

/** The provider request through the anchors: origin → stops → destination. */
function matchRequest(
  input: ParsedMatchInput,
  requestId: string,
): ProviderRouteRequest {
  const first = input.anchors[0]!;
  const last = input.anchors[input.anchors.length - 1]!;
  return {
    requestId,
    origin: { lon: first.lon, lat: first.lat },
    destination: { lon: last.lon, lat: last.lat },
    stops: input.anchors.slice(1, -1).map((anchor) => ({ lon: anchor.lon, lat: anchor.lat })),
    shaping: [],
    profile: input.profile,
    avoidPolygons: [],
    options: {
      includeAlternatives: false,
      avoidHighways: false,
      tollPolicy: "avoid",
      vehicle: "motorcycle",
    },
  };
}

/** A candidate whose metrics are not usable measurements is a broken answer. */
function candidateIsUsable(candidate: ProviderCandidate): boolean {
  return (
    candidate.geometry.length >= 2 &&
    candidate.geometry.every(
      (coordinate) => Number.isFinite(coordinate.lon) && Number.isFinite(coordinate.lat),
    ) &&
    Number.isFinite(candidate.distanceMeters) &&
    candidate.distanceMeters >= 0 &&
    Number.isFinite(candidate.durationSeconds) &&
    candidate.durationSeconds >= 0
  );
}

/** The largest distance from an input anchor to the returned line, in meters. */
function maxAnchorDriftMeters(
  anchors: readonly Coordinate[],
  geometry: readonly Coordinate[],
): number {
  let worst = 0;
  for (const anchor of anchors) {
    const drift = distanceToLineMeters(anchor, geometry);
    if (drift > worst) worst = drift;
  }
  return worst;
}

/** The confidence band a measured drift falls in, or `null` beyond the bound. */
export function matchConfidenceFor(maxDriftMeters: number): RoadMatchConfidence | null {
  if (!Number.isFinite(maxDriftMeters)) return null;
  if (maxDriftMeters <= MATCH_EXACT_METERS) return "exact";
  if (maxDriftMeters <= MATCH_MATCHED_METERS) return "matched";
  if (maxDriftMeters <= MATCH_APPROXIMATE_METERS) return "approximate";
  return null;
}

/**
 * What the match itself said about motorcycle access.
 *
 * `known` only when the candidate reported {@link ACCESS_PERMITTED}; every other
 * outcome — an absent key, an unrelated metadata value, a withdrawn claim — is
 * `unknown` with a reason. The provenance names the provider that made the
 * claim, so the value is never rootless.
 */
export function accessEvidenceFrom(
  candidate: ProviderCandidate,
): EvidenceValue<"motorcycle" | "unknown"> {
  const reported: unknown = candidate.providerMetadata?.[ACCESS_EVIDENCE_KEY];
  if (reported !== ACCESS_PERMITTED) {
    return unknownEvidence(
      "The router did not report motorcycle access for this match.",
    );
  }
  return knownEvidence(
    "motorcycle",
    {
      id: candidate.providerId,
      label: "Routing engine",
      category: "routing",
    },
    0.6,
  );
}

/** Normalizes a provider rejection without leaking its own text. */
function providerFailure(error: unknown, aborted: boolean): RoadMatchResult {
  if (aborted) return failure("cancelled", false);
  if (error instanceof GraphHopperProviderError) {
    const code: RoadMatchErrorCode =
      error.code === "no-route"
        ? "no-route"
        : error.code === "outside-coverage"
          ? "outside-coverage"
          : error.code === "provider-timeout"
            ? "provider-timeout"
            : error.code === "validation"
              ? "validation"
              : "provider-unavailable";
    return failure(code, error.recoverable);
  }
  return failure("provider-unavailable");
}

/**
 * Matches `input.anchors` onto the routing graph and measures the answer.
 *
 * Never throws for a bad request or a router failure: every outcome is a
 * {@link RoadMatchResult}, so the endpoint has one shape to map onto HTTP.
 */
export async function matchRoadAnchors(
  input: unknown,
  deps: RoadMatchDeps = {},
): Promise<RoadMatchResult> {
  const parsed = parseMatchInput(input);
  if (parsed === null) return failure("validation", false);

  const provider = deps.provider ?? graphHopperProviderFromEnv();
  const signal = deps.signal ?? new AbortController().signal;

  let set: Awaited<ReturnType<typeof provider.candidates>>;
  try {
    set = await provider.candidates(
      matchRequest(parsed, `req_road_match_${crypto.randomUUID()}`),
      signal,
    );
  } catch (error) {
    return providerFailure(error, signal.aborted);
  }

  const candidate = set.candidates[0];
  if (candidate === undefined) return failure("no-match", false);
  if (!candidateIsUsable(candidate)) return failure("provider-unavailable");

  const maxDriftMeters = maxAnchorDriftMeters(parsed.anchors, candidate.geometry);
  const confidence = matchConfidenceFor(maxDriftMeters);
  if (confidence === null) return failure("no-match", false);

  return {
    ok: true,
    match: {
      matchedGeometry: candidate.geometry.map((coordinate) => ({
        lon: coordinate.lon,
        lat: coordinate.lat,
      })),
      distanceMeters: candidate.distanceMeters,
      durationSeconds: candidate.durationSeconds,
      maxDriftMeters,
      confidence,
      accessEvidence: accessEvidenceFrom(candidate),
    },
  };
}
