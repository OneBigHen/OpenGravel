/**
 * GraphHopper response parsing, error normalization and candidate fingerprint
 * (17-IMPLEMENTATION-PLAN Task 2.2).
 *
 * Clean-room port of the legacy `graphhopper-response.ts` (baseline
 * `06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`) onto the VNext
 * `ProviderCandidate` DTO.
 *
 * Three boundaries are deliberate.
 *
 * - **The engine never writes rider copy.** `message` on a
 *   {@link GraphHopperProviderError} is OpenGravel's own sentence; the engine's
 *   text is retained only as `providerDetail` for structured logs, so no raw
 *   provider stack, message or router address can reach a client (13 §12–§13).
 * - **The candidate is geometry plus honest metrics.** The port's DTO has no
 *   waypoints, toll evidence or road mix, because enrichment, eligibility and
 *   scoring are the application pipeline's job (02 §10). Values the engine did
 *   not send stay absent — never a fabricated zero standing in for a
 *   measurement (06 §29).
 * - **Errors carry the taxonomy, not the transport.** `GraphHopperProviderError`
 *   exposes `code` from the §12 taxonomy, the HTTP status and `recoverable`,
 *   which is what a retry policy needs and all it needs.
 */

import type {
  ProviderCandidate,
  ProviderInstruction,
} from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";

import { speedLimitSpans, summarizeRoadDetails } from "./road-details";

/** The normalized failure codes this adapter can produce (13 §12). */
export type GraphHopperErrorCode =
  | "provider-timeout"
  | "provider-unavailable"
  | "no-route"
  | "outside-coverage"
  | "validation";

/** Codes that a later call with different conditions could succeed at. */
const RECOVERABLE_CODES: ReadonlySet<GraphHopperErrorCode> = new Set<GraphHopperErrorCode>([
  "provider-timeout",
  "provider-unavailable",
]);

/** Options for a {@link GraphHopperProviderError}. */
export interface GraphHopperErrorOptions {
  /** HTTP status the engine answered with, or `null` when no answer arrived. */
  readonly httpStatus?: number | null;
  /** Whether retrying the same request can plausibly succeed. */
  readonly recoverable?: boolean;
  /**
   * Diagnostic-only copy of the engine's own message. It is never rendered and
   * never leaves the server boundary (13 §13); `message` is the rider-facing
   * sentence.
   */
  readonly providerDetail?: string;
}

/** A routing failure expressed in the VNext error taxonomy. */
export class GraphHopperProviderError extends Error {
  readonly code: GraphHopperErrorCode;
  readonly httpStatus: number | null;
  readonly recoverable: boolean;
  readonly providerDetail: string | null;

  constructor(
    message: string,
    code: GraphHopperErrorCode,
    options: GraphHopperErrorOptions = {},
  ) {
    super(message);
    this.name = "GraphHopperProviderError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.recoverable = options.recoverable ?? RECOVERABLE_CODES.has(code);
    this.providerDetail = options.providerDetail ?? null;
  }
}

/** Engine errors that mean "this point is not on the installed graph". */
const OUT_OF_COVERAGE_PATTERNS: readonly RegExp[] = [
  /out of bounds/,
  /cannot find point/,
  /not found in graph/,
];

/** Engine errors that mean "the graph was searched and no path exists". */
const NO_ROUTE_PATTERNS: readonly RegExp[] = [
  /no route/,
  /no path/,
  /route not found/,
  /cannot find a route/,
  /could not find a route/,
];

/**
 * Classifies one engine rejection into the VNext taxonomy.
 *
 * The order matters: an out-of-coverage point (a coverage problem the rider can
 * only fix by moving a waypoint) is checked before a missing route (the engine
 * searched the graph and found nothing), and a 5xx before the generic
 * "rejected this trip" bucket, because an unavailable engine is transient while
 * a rejected request is not.
 */
export function normalizeGraphHopperProviderError(
  status: number,
  message: string,
): GraphHopperProviderError {
  const normalized = message.toLowerCase();
  const providerDetail = message;

  if (OUT_OF_COVERAGE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return new GraphHopperProviderError(
      "One or more waypoints are outside the installed routing region.",
      "outside-coverage",
      { httpStatus: status, providerDetail },
    );
  }
  if (NO_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return new GraphHopperProviderError(
      "No route was found for this trip.",
      "no-route",
      { httpStatus: status, providerDetail },
    );
  }
  if (status === 408 || status === 504) {
    return new GraphHopperProviderError(
      "The routing service did not answer in time.",
      "provider-timeout",
      { httpStatus: status, providerDetail },
    );
  }
  if (status >= 500) {
    return new GraphHopperProviderError(
      "The routing service is unavailable.",
      "provider-unavailable",
      { httpStatus: status, providerDetail },
    );
  }
  return new GraphHopperProviderError(
    "The routing service could not plan this trip.",
    "validation",
    { httpStatus: status, providerDetail },
  );
}

/** One turn instruction as GraphHopper reports it. */
export interface GraphHopperInstruction {
  readonly distance?: number;
  /** Milliseconds, as the engine reports them. */
  readonly time?: number;
  /** GraphHopper's numeric turn sign. */
  readonly sign?: number;
  readonly text?: string;
  readonly street_name?: string;
  readonly interval?: readonly [number, number];
}

/** One `[from, to, value]` interval of a requested route detail. */
export type GraphHopperDetailInterval = readonly [number, number, string | number | boolean | null];

/** One decoded path. `points.coordinates` is `[lon, lat]` because `points_encoded` is false. */
export interface GraphHopperPath {
  readonly distance?: number;
  /** Milliseconds, as the engine reports them. */
  readonly time?: number;
  readonly ascend?: number;
  readonly descend?: number;
  readonly points?: { readonly coordinates?: readonly (readonly [number, number])[] };
  readonly snapped_waypoints?: {
    readonly coordinates?: readonly (readonly [number, number])[];
  };
  readonly instructions?: readonly GraphHopperInstruction[];
  readonly details?: Readonly<
    Record<string, readonly GraphHopperDetailInterval[] | undefined>
  >;
}

/** The `/route` response envelope, narrowed to what this adapter reads. */
export interface GraphHopperResponse {
  readonly message?: string;
  readonly info?: { readonly version?: string };
  readonly paths?: readonly GraphHopperPath[];
}

/** What the parser needs to know about the path it is parsing. */
export interface GraphHopperPathMeta {
  readonly providerId: string;
  /** Provider-internal profile that produced this path. */
  readonly profile: string;
  /** Position of the path in the response; part of the stable fingerprint. */
  readonly index: number;
  /** Engine version the provider resolved for this call. */
  readonly engineVersion: string;
  /** Whether this answer came from a degraded (retried) request. */
  readonly degraded?: boolean;
}

/**
 * GraphHopper's numeric turn signs, mapped onto the port's provider-internal
 * instruction kind. Only the distinctions the port can carry are kept: the sign
 * travels no further, so turn direction lives in the engine's `text` until the
 * navigation wave owns instruction semantics (08-NAVIGATION-AND-FREE-RIDE).
 */
const INSTRUCTION_TYPES: Readonly<Record<number, string>> = {
  0: "continue",
  4: "finish",
  5: "via",
  6: "roundabout",
  7: "keep-left",
  "-7": "keep-right",
};

function instructionType(sign: number | undefined): string {
  if (sign === undefined) return "continue";
  return INSTRUCTION_TYPES[sign] ?? "turn";
}

function instructionManeuver(
  sign: number | undefined,
): ProviderInstruction["maneuver"] | undefined {
  switch (sign) {
    case -3:
    case -2:
      return "left";
    case -1:
      return "slight-left";
    case 0:
      return "straight";
    case 1:
      return "slight-right";
    case 2:
    case 3:
      return "right";
    default:
      return undefined;
  }
}

/**
 * A stable candidate fingerprint, ported from the legacy `createRouteId`.
 *
 * It hashes the geometry at six decimals with 32-bit FNV-1a and prefixes the
 * profile and 1-based path index, so two responses for the same question and
 * path order produce the same value while equal-length but different geometries
 * do not collide. The candidate pipeline uses it for §14 duplicate detection;
 * a cross-provider geometry comparison is the pipeline's own concern.
 */
export function createRouteFingerprint(
  profile: string,
  geometry: readonly Coordinate[],
  index: number,
): string {
  const fingerprint = geometry
    .map(
      ({ lon, lat }) => `${lon.toFixed(6)},${lat.toFixed(6)}`,
    )
    .join(";");
  let hash = 2166136261;
  for (let cursor = 0; cursor < fingerprint.length; cursor += 1) {
    hash ^= fingerprint.charCodeAt(cursor);
    hash = Math.imul(hash, 16777619);
  }
  return `${profile}-${index + 1}-${(hash >>> 0).toString(36)}`;
}

function toInstructions(path: GraphHopperPath): readonly ProviderInstruction[] {
  return (path.instructions ?? []).map((instruction) => {
    const maneuver = instructionManeuver(instruction.sign);
    const geometryIndex = instruction.interval?.[0];
    return {
      // The adapter never authors rider copy: a missing engine text stays empty
      // rather than becoming an invented English sentence.
      text: instruction.text ?? "",
      distanceMeters: instruction.distance ?? 0,
      durationSeconds: (instruction.time ?? 0) / 1000,
      type: instructionType(instruction.sign),
      ...(maneuver === undefined ? {} : { maneuver }),
      ...(instruction.street_name === undefined
        ? {}
        : { roadName: instruction.street_name }),
      ...(geometryIndex === undefined ? {} : { geometryIndex }),
    };
  });
}

/**
 * Normalizes one engine path into the provider-neutral candidate DTO.
 *
 * A path without at least two decoded points is not a rideable line: it is a
 * provider failure (`provider-unavailable`, HTTP 502), never a synthetic
 * candidate — the legacy `INVALID_PROVIDER_RESPONSE` case.
 */
export function parseGraphHopperPath(
  path: GraphHopperPath,
  meta: GraphHopperPathMeta,
): ProviderCandidate {
  const coordinates = path.points?.coordinates;
  if (coordinates === undefined || coordinates.length < 2) {
    throw new GraphHopperProviderError(
      "The route came back without usable geometry.",
      "provider-unavailable",
      { httpStatus: 502 },
    );
  }

  const raw: readonly Coordinate[] = coordinates.map(([lon, lat]) => ({
    lon,
    lat,
  }));
  // The engine repeats a point where a waypoint snaps onto a vertex. A repeated
  // point is not a rideable step and eligibility rightly refuses it, so the
  // adapter drops it here and remaps every index that pointed past it.
  const geometry: Coordinate[] = [];
  const indexMap: number[] = [];
  for (const point of raw) {
    const last = geometry.at(-1);
    if (last === undefined || last.lon !== point.lon || last.lat !== point.lat) geometry.push(point);
    indexMap.push(geometry.length - 1);
  }
  if (geometry.length < 2) {
    throw new GraphHopperProviderError(
      "The route came back without usable geometry.",
      "provider-unavailable",
      { httpStatus: 502 },
    );
  }
  const instructions = toInstructions(path).map((instruction) =>
    instruction.geometryIndex === undefined
      ? instruction
      : { ...instruction, geometryIndex: indexMap[instruction.geometryIndex] ?? instruction.geometryIndex },
  );
  const providerMetadata: Record<string, string | number | boolean> = {
    engineVersion: meta.engineVersion,
    fingerprint: createRouteFingerprint(meta.profile, geometry, meta.index),
  };
  if (path.ascend !== undefined) providerMetadata.ascentMeters = path.ascend;
  if (path.descend !== undefined) providerMetadata.descentMeters = path.descend;
  if (meta.degraded === true) providerMetadata.degraded = true;
  // Details index the engine's own points, so they are measured on the raw line
  // (a repeated point is a zero-length step and credits nothing).
  const roadSummary = summarizeRoadDetails(raw, path.details);
  const speedLimits = speedLimitSpans(raw.length, path.details, indexMap);

  return {
    providerId: meta.providerId,
    profile: meta.profile,
    geometry,
    distanceMeters: path.distance ?? 0,
    durationSeconds: (path.time ?? 0) / 1000,
    ...(instructions.length > 0 ? { instructions } : {}),
    ...(speedLimits.length > 0 ? { speedLimits } : {}),
    providerMetadata,
    ...(roadSummary === null ? {} : { roadSummary }),
  };
}
