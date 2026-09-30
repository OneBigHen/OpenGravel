/**
 * Canonical provider request + route-affecting identity
 * (02-ARCHITECTURE-CONTRACT §10/§13, 06-ROUTING-AND-DECISION-ENGINE §6–§7).
 *
 * Two responsibilities live here, and both are about the same boundary: what
 * OpenGravel tells a provider, and what makes two planning attempts the same
 * question.
 *
 * **The request.** `buildProviderRequest` maps an authored `RideIntent` onto the
 * provider-neutral port request. The module is provider-neutral itself: it
 * imports no adapter, and the one piece of provider knowledge it needs — which
 * internal profile an intent maps to — is injected through
 * `PlanRequestContext.profileFor`, with the documented internal stub as the
 * default until the profile policy lands (Task 2.2/3.1). Geometry handles are
 * resolved through the same injected context, and a resolution that fails is
 * *reported* (`unresolvedRefs`), never silently dropped: a dropped avoid area
 * would mean routing through a place the rider forbade.
 *
 * **The identity.** `intentIdentity` is the cache key of 02 §13 and must
 * include every route-affecting input. A missing field does not make the cache
 * slower, it makes it wrong: a stored plan would be served for a different
 * question. The canonical form below therefore covers the whole planning
 * input (points, order, time, departure, preferences, bike snapshot, avoid
 * areas, road spans, sketch corridor) plus the three data/policy versions, and
 * deliberately excludes rider copy (labels, names, provenance) that cannot
 * change a route.
 */

import { deepFreeze } from "@/domain/util/freeze";
import type { GeometryPayload } from "@/domain/geometry/types";
import type { GeometryRef } from "@/domain/ride/ids";
import { validateRideIntent } from "@/domain/ride/validate";
import type {
  Coordinate,
  DepartureIntent,
  RideIntent,
  SurfaceIntent,
  TimeIntent,
} from "@/domain/ride/types";
import type {
  ProviderRoadSpan,
  ProviderRouteRequest,
  ProviderRouteOptions,
} from "./route-provider";

/** The internal profile used until the profile policy lands (Task 2.2/3.1). */
export const DEFAULT_PROVIDER_PROFILE = "motorcycle";

/**
 * The most corridor vertices one span may carry on the wire. Re-exported from
 * the port so the resolver and the validator name the same bound.
 */
import {
  MAX_PROVIDER_SKETCH_CORRIDOR_POINTS,
  MAX_PROVIDER_SKETCH_TOPOLOGY_HINTS,
  MAX_PROVIDER_SPAN_CORRIDOR_POINTS,
  type ProviderSketch,
} from "./route-provider";
import { buildSketchCorridor } from "./sketch-corridor";
import {
  resampleSketchCorridor,
  shapeAwareSketchAnchors,
} from "@/domain/sketch/snap";
import {
  MAX_SKETCH_REQUEST_ANCHORS,
  type SketchEndpoints,
} from "@/domain/sketch/types";

/**
 * The documented internal mapping stub (06 §6): today every intent maps to the
 * same provider profile. It takes the intent so the signature already matches
 * the real mapping, and returns a constant so no intent field is silently
 * treated as routing-relevant before the policy exists.
 */
export function defaultProfileFor(): string {
  return DEFAULT_PROVIDER_PROFILE;
}

/** Versions that participate in the planning identity (02 §13). */
export interface PlanRequestVersions {
  readonly routePolicy: string;
  readonly graph: string;
  readonly evidence: string;
}

/** Everything the builder needs from the outside world. */
export interface PlanRequestContext {
  /**
   * Resolves a stored geometry handle. Returns `null` when the handle is
   * unknown — absence is an ordinary outcome here, reported through
   * `unresolvedRefs`, not an error.
   */
  resolveGeometry: (
    ref: GeometryRef,
  ) => Promise<GeometryPayload | null> | GeometryPayload | null;
  /** Which internal provider profile this intent maps to (see §6). */
  readonly profileFor?: (intent: RideIntent) => string;
  /** Correlation id for one provider call; minted when omitted. */
  readonly requestId?: string;
  /** Whether the caller wants alternative candidates in this call (06 §5). */
  readonly includeAlternatives?: boolean;
}

/** A request that can be sent, or the reasons it cannot. */
export type PlanRequestResult =
  | {
      readonly ok: true;
      readonly profile: string;
      readonly request: ProviderRouteRequest;
      /**
       * Enabled avoid areas whose geometry could not be resolved to a polygon
       * ring. They are absent from `request.avoidPolygons`, so the pipeline's
       * eligibility step decides the conservative policy for them; the builder
       * never pretends an unresolved area was honored.
       */
      readonly unresolvedRefs: readonly GeometryRef[];
    }
  | {
      readonly ok: false;
      /** `<code>: <message>` — the token before `:` is the stable code. */
      readonly issues: readonly string[];
    };

function issue(code: string, message: string): string {
  return `${code}: ${message}`;
}

function mintRequestId(): string {
  return `req_${crypto.randomUUID()}`;
}

/** The request owns its coordinates, so nothing it returns aliases the intent. */
function copyCoordinate(coordinate: Coordinate): Coordinate {
  return { lon: coordinate.lon, lat: coordinate.lat };
}

interface EndpointResolution {
  readonly issues: readonly string[];
  readonly origin: Coordinate | null;
  readonly destination: Coordinate | null;
}

/**
 * Whether this intent has both endpoints a provider call needs.
 *
 * - `destination`: the authored finish is the endpoint.
 * - `loop`: the loop rides back to the origin (06 §17), so the origin is the
 *   endpoint and any authored finish is not part of the round trip.
 * - `open`: Free Ride is destination-free *execution* (04 §6), not a
 *   point-to-point plan, so an open ride needs an authored finish to form a
 *   request today; timeboxed loop discovery is the shape that replaces it.
 *
 * A committed sketch changes where an endpoint can come from, not the rule that
 * both must exist (03 §13's `endpointPolicy`, 04 §19): under `derive` the trace's
 * own endpoints **are** the ride's, and under `preserve-existing` an authored
 * endpoint wins while a missing one is still filled from the trace — falling back
 * to the drawing is what makes "keep my endpoints" a preference rather than a
 * refusal to plan. A `loop` under `preserve-existing` keeps its authored meaning
 * (the loop rides back to the origin); under `derive` it ends where the rider's
 * hand stopped, which is what the drawing says.
 */
function resolveEndpoints(
  intent: RideIntent,
  sketchEndpoints: SketchEndpoints | null,
): EndpointResolution {
  if (sketchEndpoints !== null) {
    const policy = intent.sketch?.endpointPolicy ?? "derive";
    const authoredStart = intent.start?.coordinate ?? null;
    const authoredFinish = intent.finish?.coordinate ?? null;
    const origin =
      policy === "derive" ? sketchEndpoints.start : (authoredStart ?? sketchEndpoints.start);
    const destination =
      policy === "derive"
        ? sketchEndpoints.finish
        : intent.shape === "loop"
          ? origin
          : (authoredFinish ?? sketchEndpoints.finish);
    return { issues: [], origin, destination };
  }

  if (intent.start === null) {
    return {
      issues: [issue("missing-start", "a start point is required to plan a route")],
      origin: null,
      destination: null,
    };
  }
  const origin = intent.start.coordinate;
  switch (intent.shape) {
    case "destination":
      return intent.finish === null
        ? {
            issues: [
              issue("missing-finish", "a destination ride requires a finish"),
            ],
            origin,
            destination: null,
          }
        : { issues: [], origin, destination: intent.finish.coordinate };
    case "loop":
      return { issues: [], origin, destination: origin };
    case "open":
      return intent.finish === null
        ? {
            issues: [
              issue(
                "open-ride-without-finish",
                "an open ride (Free Ride) has no destination; plan a loop or author a finish",
              ),
            ],
            origin,
            destination: null,
          }
        : { issues: [], origin, destination: intent.finish.coordinate };
  }
}

/**
 * How long a bare loop runs when the rider chose Loop but no ride time (M2,
 * OGV-D-262). A loop with no destination, stop or drawing would otherwise be a
 * zero-length origin→origin path that every candidate fails; two hours is
 * the middle of the 1–6 h range the composer offers and is what its duration
 * control shows as selected until the rider picks another.
 */
export const DEFAULT_LOOP_MINUTES = 120;

/** The tolerance a default loop is measured against: ±15%, at least 15 min. */
export function defaultLoopToleranceMinutes(targetMinutes: number): number {
  return Math.max(15, Math.round(targetMinutes * 0.15));
}

function loopDiscovery(time: RideIntent["time"]): {
  readonly targetMinutes: number;
  readonly toleranceMinutes: number;
} {
  if (time.kind === "budget") {
    return { targetMinutes: time.targetMinutes, toleranceMinutes: time.toleranceMinutes };
  }
  return {
    targetMinutes: DEFAULT_LOOP_MINUTES,
    toleranceMinutes: defaultLoopToleranceMinutes(DEFAULT_LOOP_MINUTES),
  };
}

/** The sketch's resolved contribution to one request. */
interface SketchResolution {
  /** The wire projection, or `null` when there is nothing to send. */
  readonly sketch: ProviderSketch | null;
  readonly endpoints: SketchEndpoints | null;
  /** Refs whose payload the store could not return. */
  readonly unresolved: readonly GeometryRef[];
}

/**
 * Resolves a committed sketch into the wire projection (03 §13, 06 §18).
 *
 * The **raw trace is the authority** (04 §19): the corridor, the hints and the
 * endpoints are re-derived from `rawStrokeRefs` on every plan, so a retry after a
 * failed attempt re-derives them from the original geographic trace instead of
 * from screen pixels that were unprojected against a camera that has since moved.
 * The committed `corridorRef` and `topologyHints` are the fallback for a payload
 * that no longer resolves, and an unresolvable trace is reported through
 * `unresolved` rather than replaced by an invented straight line.
 */
async function resolveSketch(
  intent: RideIntent,
  context: PlanRequestContext,
): Promise<SketchResolution> {
  const declared = intent.sketch;
  if (declared === null) return { sketch: null, endpoints: null, unresolved: [] };

  const unresolved: GeometryRef[] = [];
  const strokes: Coordinate[][] = [];
  for (const ref of declared.rawStrokeRefs) {
    const payload = await context.resolveGeometry(ref);
    if (payload === null || payload.kind !== "line") {
      unresolved.push(ref);
      continue;
    }
    strokes.push(payload.coordinates.map(copyCoordinate));
  }

  const corridorPayload = await context.resolveGeometry(declared.corridorRef);
  const storedCorridor =
    corridorPayload === null || corridorPayload.kind !== "line"
      ? null
      : corridorPayload.coordinates.map(copyCoordinate);
  if (corridorPayload === null || corridorPayload.kind !== "line") {
    unresolved.push(declared.corridorRef);
  }

  const derived = strokes.length > 0 ? buildSketchCorridor(strokes) : null;
  const corridor = derived !== null ? derived.corridor : storedCorridor;
  if (corridor === null || corridor.length < 2) {
    return { sketch: null, endpoints: null, unresolved };
  }

  const first = corridor[0];
  const last = corridor[corridor.length - 1];
  const topologyHints = derived?.topologyHints ?? declared.topologyHints;
  const endpoints =
    derived?.derivedEndpoints ??
    (first === undefined || last === undefined
      ? null
      : { start: first, finish: last });
  // Anchors come from the full corridor, so their headings use every drawn
  // vertex; the corridor itself is then fitted to the wire budget, never
  // dropped (OGV-D-285).
  const anchors = shapeAwareSketchAnchors(corridor, {
    maxAnchors: MAX_SKETCH_REQUEST_ANCHORS,
  }).map((anchor) => anchor.at);
  const sketch: ProviderSketch = {
    anchors,
    endpointPolicy: declared.endpointPolicy,
    nearLoop:
      derived?.nearLoop ?? topologyHints.some((hint) => hint.kind === "near-loop"),
    topologyHints: topologyHints.slice(0, MAX_PROVIDER_SKETCH_TOPOLOGY_HINTS),
    derivedEndpoints: endpoints,
    corridor: resampleSketchCorridor(corridor, MAX_PROVIDER_SKETCH_CORRIDOR_POINTS),
  };
  return { sketch, endpoints, unresolved };
}

/**
 * Maps an authored intent onto one provider request.
 *
 * Never throws for malformed authored state: it answers with `ok: false` and
 * the issues it found, so the caller can surface them. A request it does build
 * is deeply frozen and owns its own coordinates.
 */
export async function buildProviderRequest(
  intent: RideIntent,
  context: PlanRequestContext,
): Promise<PlanRequestResult> {
  // The sketch is resolved first: its endpoints can *be* the ride's endpoints
  // (03 §13's `endpointPolicy`), so the endpoint rule needs them before it can
  // decide whether anything is missing (04 §19).
  const sketchResolution = await resolveSketch(intent, context);
  const endpoints = resolveEndpoints(intent, sketchResolution.endpoints);
  const issues: readonly string[] = [
    ...validateRideIntent(intent).map((problem) => issue("invalid-intent", problem)),
    ...endpoints.issues,
  ];
  const { origin, destination } = endpoints;
  if (issues.length > 0 || origin === null || destination === null) {
    return { ok: false, issues };
  }

  const avoidPolygons: (readonly Coordinate[])[] = [];
  const unresolvedRefs: GeometryRef[] = [
    ...sketchResolution.unresolved,
  ];
  for (const area of intent.avoidAreas) {
    if (!area.enabled) continue;
    const payload = await context.resolveGeometry(area.geometryRef);
    if (payload === null || payload.kind !== "polygon") {
      unresolvedRefs.push(area.geometryRef);
      continue;
    }
    for (const ring of payload.rings) {
      avoidPolygons.push(ring.map(copyCoordinate));
    }
  }

  // Road spans are resolved here for the same reason avoid areas are: the
  // server holds no store, so the browser is the side that can turn a span's
  // `geometryRef` into the line a provider request can carry. A span whose line
  // did not resolve keeps its anchors — a `must` span is still enforced by
  // waypoints — but carries no corridor rather than a fabricated one, and a
  // corridor longer than the wire bound is omitted rather than truncated
  // (`ProviderRoadSpan`).
  const roadSpans: ProviderRoadSpan[] = [];
  for (const span of intent.roadSpans) {
    const payload = await context.resolveGeometry(span.geometryRef);
    const corridor =
      payload === null || payload.kind !== "line"
        ? null
        : payload.coordinates.map(copyCoordinate);
    roadSpans.push({
      id: span.id,
      mode: span.mode,
      direction: span.direction,
      anchors: span.anchorRefs.map(copyCoordinate),
      ...(corridor === null || corridor.length > MAX_PROVIDER_SPAN_CORRIDOR_POINTS
        ? {}
        : { corridor }),
    });
  }

  const profileFor = context.profileFor ?? defaultProfileFor;
  const profile = profileFor(intent);
  const options: ProviderRouteOptions = {
    includeAlternatives: context.includeAlternatives ?? false,
    avoidHighways: intent.avoidHighways,
    tollPolicy: intent.tollPolicy,
    surfacePreference: intent.surface.preference,
    roadCharacter: intent.roadCharacter,
    vehicle: "motorcycle",
  };

  const request = deepFreeze<ProviderRouteRequest>({
    requestId: context.requestId ?? mintRequestId(),
    origin: copyCoordinate(origin),
    destination: copyCoordinate(destination),
    stops: intent.stops.map((stop) => copyCoordinate(stop.coordinate)),
    shaping: intent.shaping.map((point) => copyCoordinate(point.coordinate)),
    profile,
    avoidPolygons,
    roadSpans,
    ...(sketchResolution.sketch === null ? {} : { sketch: sketchResolution.sketch }),
    ...(intent.shape === "loop" &&
    (intent.time.kind === "budget" ||
      (sketchResolution.sketch === null &&
        intent.stops.length === 0 &&
        intent.shaping.length === 0))
      ? { discovery: loopDiscovery(intent.time) }
      : {}),
    options,
  });

  return deepFreeze({
    ok: true as const,
    profile,
    request,
    unresolvedRefs: [...unresolvedRefs],
  });
}

/* -------------------------------------------------------------------------
 * Canonical route-affecting identity (02-ARCHITECTURE-CONTRACT §13)
 * ---------------------------------------------------------------------- */

/** Prefix of every planning identity; a new canonical form bumps the number. */
export const IDENTITY_PREFIX = "id1:";

/** Coordinate resolution: 7 decimals is ~1 cm, below any meaningful routing. */
const COORDINATE_DECIMALS = 7;

/** Resolution for every other number (minutes, miles, shares, weights). */
const MEASURE_DECIMALS = 6;

const FNV1A64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV1A64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/**
 * A number as a canonical decimal string.
 *
 * Fixed decimals make representation noise (`1.5000000001` vs `1.5`)
 * irrelevant, `-0` and `0` the same value, and non-finite numbers stay
 * representable so an invalid intent still has a stable identity. Numbers are
 * never emitted as JSON numbers, because `JSON.stringify` turns `NaN` into
 * `null` and two different inputs would then share one identity.
 */
function canonicalNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return `#${String(value)}`;
  const fixed = value.toFixed(decimals);
  return /^-0(?:\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed;
}

/**
 * A leaf inside an open rider-authored record. The value is length-prefixed so
 * a string can never be read as a boolean or a number.
 */
function canonicalLeaf(value: string | number | boolean): string {
  if (typeof value === "boolean") return `?${value ? "t" : "f"}`;
  if (typeof value === "number") return canonicalNumber(value, MEASURE_DECIMALS);
  return `s${value.length}:${value}`;
}

/** Length-prefixed string: unambiguous even when the text holds separators. */
function canonicalText(value: string): string {
  return `s${value.length}:${value}`;
}

function canonicalCoordinate(coordinate: Coordinate): readonly string[] {
  return [
    canonicalNumber(coordinate.lon, COORDINATE_DECIMALS),
    canonicalNumber(coordinate.lat, COORDINATE_DECIMALS),
  ];
}

/**
 * Only a point's coordinate is route-affecting: its id, label and provenance
 * describe the authored object, not the path it produces.
 */
function canonicalPoint(
  point: { readonly coordinate: Coordinate } | null,
): readonly string[] | null {
  return point === null ? null : canonicalCoordinate(point.coordinate);
}

function canonicalTime(time: TimeIntent): readonly (string | null)[] {
  switch (time.kind) {
    case "none":
      return ["none", null, null, null];
    case "budget":
      return [
        "budget",
        canonicalNumber(time.targetMinutes, MEASURE_DECIMALS),
        canonicalNumber(time.toleranceMinutes, MEASURE_DECIMALS),
        null,
      ];
    case "returnBy":
    case "arriveBy":
      return [
        time.kind,
        canonicalText(time.localTime),
        canonicalText(time.date),
        canonicalNumber(time.toleranceMinutes, MEASURE_DECIMALS),
      ];
  }
}

function canonicalDeparture(
  departure: DepartureIntent,
): readonly (string | null)[] {
  return departure.kind === "now"
    ? ["now", null]
    : ["future", canonicalText(departure.at)];
}

function canonicalSurface(surface: SurfaceIntent): Readonly<Record<string, unknown>> {
  const share = surface.targetUnpavedShare;
  // An absent bound is its domain default (no lower bound → 0, no upper bound
  // → 1) and an absent target is a sentinel outside the envelope, so two
  // intents that mean the same envelope share one identity.
  return {
    preference: surface.preference,
    unpavedShare:
      share === undefined
        ? null
        : [
            canonicalNumber(share.min ?? 0, MEASURE_DECIMALS),
            canonicalNumber(share.target ?? -1, MEASURE_DECIMALS),
            canonicalNumber(share.max ?? 1, MEASURE_DECIMALS),
          ],
    unknownSurfacePolicy: surface.unknownSurfacePolicy,
  };
}

/** The canonical intent structure: named keys, fixed order, no rider copy. */
function canonicalIntentStructure(
  intent: RideIntent,
  versions: PlanRequestVersions,
): Readonly<Record<string, unknown>> {
  return {
    identityVersion: 1,
    shape: intent.shape,
    start: canonicalPoint(intent.start),
    finish: canonicalPoint(intent.finish),
    stops: intent.stops.map((stop) => canonicalCoordinate(stop.coordinate)),
    shaping: intent.shaping.map((point) => canonicalCoordinate(point.coordinate)),
    time: canonicalTime(intent.time),
    departure: canonicalDeparture(intent.departure),
    roadCharacter: intent.roadCharacter,
    noveltyPreference: intent.noveltyPreference ?? "balanced",
    surface: canonicalSurface(intent.surface),
    terrain: intent.terrain.level,
    traffic: intent.traffic,
    avoidHighways: intent.avoidHighways,
    tollPolicy: intent.tollPolicy,
    bike: [
      canonicalText(intent.bike.bikeId),
      intent.bike.category,
      canonicalNumber(intent.bike.fuelRangeMiles, MEASURE_DECIMALS),
      canonicalNumber(intent.bike.reserveMiles, MEASURE_DECIMALS),
      intent.bike.maintainedGravel,
      intent.bike.roughTracks,
      intent.bike.unknownSurface,
      Object.entries(intent.bike.custom ?? {})
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => [canonicalText(key), canonicalLeaf(value)]),
    ],
    // A disabled area still contributes its ref: toggling it back on is a
    // different planning question from never having authored it.
    avoidAreas: intent.avoidAreas.map((area) => [
      canonicalText(area.geometryRef),
      area.enabled,
    ]),
    roadSpans: intent.roadSpans.map((span) => [
      span.mode,
      span.direction,
      span.roadEntityId === undefined ? null : canonicalText(span.roadEntityId),
      canonicalText(span.geometryRef),
      span.anchorRefs.map(canonicalCoordinate),
      span.evidenceSnapshot?.evidenceVersion === undefined
        ? null
        : canonicalText(span.evidenceSnapshot.evidenceVersion),
    ]),
    // The corridor ref is the routing input; raw strokes and topology hints
    // describe how it was authored, and the store's ref changes with the bytes.
    sketch:
      intent.sketch === null
        ? null
        : [canonicalText(intent.sketch.corridorRef), intent.sketch.endpointPolicy],
    // `longTrip` is intentionally absent: its only field is metadata today and
    // no routing consumer exists until Task 7.5 (OGV-D-118).
    versions: {
      evidence: canonicalText(versions.evidence),
      graph: canonicalText(versions.graph),
      routePolicy: canonicalText(versions.routePolicy),
    },
  };
}

/**
 * The canonical, stable serialization of every route-affecting input.
 *
 * Deterministic: fixed key order, fixed decimal places, authored array order,
 * sorted open-record keys. Pure: it reads nothing but its arguments. Two
 * intents that differ only in rider copy produce the same string; two intents
 * that differ in anything a route depends on produce different strings.
 */
export function canonicalIntentIdentity(
  intent: RideIntent,
  versions: PlanRequestVersions,
): string {
  return JSON.stringify(canonicalIntentStructure(intent, versions));
}

/**
 * UTF-8 bytes of `value`, encoded locally rather than through `TextEncoder`:
 * the domain's canonical form must not depend on a platform global, and hashing
 * UTF-8 (not UTF-16 code units) keeps the identity of non-ASCII text stable.
 */
function utf8Bytes(value: string): readonly number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      continue;
    }
    const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
    const isSurrogatePair =
      code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
    if (isSurrogatePair) {
      const codePoint = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
      index += 1;
      continue;
    }
    bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

/**
 * FNV-1a, 64-bit, over the UTF-8 bytes of `value`, as 16 lowercase hex digits.
 * Dependency-free and pure, so an identity can be recomputed anywhere the
 * canonical string can.
 */
export function fnv1a64Hex(value: string): string {
  let hash = FNV1A64_OFFSET_BASIS;
  for (const byte of utf8Bytes(value)) {
    hash = ((hash ^ BigInt(byte)) * FNV1A64_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * The planning identity: `id1:` plus the FNV-1a 64 hash of the canonical
 * route-affecting input. Every cached plan, in-flight request and late
 * response is compared through this value (02 §13, 06 §27).
 */
export function intentIdentity(
  intent: RideIntent,
  versions: PlanRequestVersions,
): string {
  return `${IDENTITY_PREFIX}${fnv1a64Hex(canonicalIntentIdentity(intent, versions))}`;
}
