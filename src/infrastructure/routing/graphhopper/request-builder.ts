/**
 * GraphHopper request builder (17-IMPLEMENTATION-PLAN Task 2.2).
 *
 * Clean-room port of the legacy `graphhopper-request.ts` (baseline
 * `06785c00e2ad9b51d12b1a4bb6c655ebb0f606c7`) onto the VNext
 * `ProviderRouteRequest` port.
 *
 * This module is pure: it reads one port request plus adapter options and
 * returns the JSON body GraphHopper's `/route` endpoint expects. It performs no
 * I/O, holds no state, and knows nothing about planning sessions. Everything
 * the legacy builder derived from planner internals is now an explicit,
 * documented option:
 *
 * - `details` — the requested detail list (the provider owns
 *   {@link REQUESTED_DETAILS} and drops a name the active graph rejects).
 * - `surfacePolicy` — the request-time surface/roughness rules the legacy
 *   builder derived from the rider's bike profile. The VNext port carries no
 *   bike snapshot yet, so the lane coordinator (Wave 3) supplies it; until then
 *   the engine's own custom models carry the character.
 * - `spans` — road-span constraints, the field-for-field analogue of the legacy
 *   road locks (`RoadSpanConstraint.mode === "must"` ⇒ ordered via-waypoints).
 * - `roundTrip` — the timeboxed loop metadata the legacy request carried
 *   inline; the port resolves a loop to `destination === origin`, so the mode
 *   is opt-in here instead of guessed.
 *
 * The two hard-won details this port preserves verbatim are the custom-model
 * rule order (highway, toll, avoid areas, must-use corridors, prefer corridors,
 * surface rules) and the `OTHER` surface enum mapping, without which a
 * request-time custom model fails to compile.
 *
 * ## `RoadSpanConstraint` mapping
 *
 * | legacy road lock            | VNext                           |
 * | --------------------------- | ------------------------------- |
 * | `mode === "must"`           | `RoadSpanConstraint.mode`       |
 * | `edgeIds.length > 0`        | `anchors.length >= 2` (resolved) |
 * | `orderedAnchors[0]`         | `anchorRefs[0]` (entry)         |
 * | `orderedAnchors.at(-1)`     | `anchorRefs.at(-1)` (exit)      |
 * | `displayName`               | `roadEntityId` / authored name  |
 * | `fallbackToleranceMeters`   | `corridorToleranceMeters`       |
 * | `geometry`                  | the resolved span geometry      |
 *
 * A `direction` of `"reverse"` is new in VNext: the rider rides the span the
 * other way round, so entry and exit swap. `"either"` keeps the authored order.
 *
 * `mode: "avoid"` is the VNext addition: the legacy lock vocabulary had only
 * must/prefer because an avoid area covered that intent. A road *span* the rider
 * refuses is its own constraint (04 §17), so its corridor becomes a
 * zero-priority avoid area here — and remains separately measurable, which an
 * avoid area is not.
 */

import type { ProviderRouteRequest } from "@/application/planner/route-provider";
import type { Coordinate } from "@/domain/ride/types";
import {
  SKETCH_OUTSIDE_BAND_PRIORITY,
  sketchAnchorHeadings,
  sketchCorridorBand,
} from "@/domain/sketch/snap";

/** The custom-model area id of a sketch's corridor band. */
export const SKETCH_BAND_AREA_ID = "opengravel_sketch";
import { characterProfileFor } from "./profiles";
import { rideFormulaRules } from "./ride-formula-rules";
import { riderModeRules } from "./rider-modes";
import { GraphHopperProviderError } from "./response-parser";

/**
 * The detail list the route pipeline needs (ported verbatim from the legacy
 * `REQUESTED_DETAILS`). These names are what the road-intelligence and evidence
 * waves read; dropping one costs evidence, not routing.
 */
export const REQUESTED_DETAILS: readonly string[] = [
  "road_class",
  "surface",
  "track_type",
  "max_speed",
  "max_speed_estimated",
  "toll",
  "road_environment",
  "urban_density",
  "curvature",
  // Built-in GraphHopper path detail: milliseconds per traversed edge,
  // including turn penalties. Unlike vehicle-specific average-speed encoded
  // values, this is available from the active weighting itself.
  "time",
  "smoothness",
  "road_class_link",
  "roundabout",
  "car_access",
  "road_access",
];

/** Engine locale for instruction text. */
const LOCALE = "en-US";
const METERS_PER_MILE = 1609.344;
const ROUND_TRIP_MIN_MINUTES = 20;
const ROUND_TRIP_MAX_MINUTES = 480;

/**
 * Round-trip distance estimate per engine profile, in mph.
 *
 * The legacy table was keyed by the rider profile (`quick` 48, `balanced` 44,
 * `twisty` 38, `scenic` 34, `adventure` 28, …). VNext's port carries only the
 * engine profile, so `balanced` and `efficient` share `motorcycle_fastest` and
 * therefore the 48 mph estimate of the legacy `quick` profile; the finer rider
 * distinction lives in the lane coordinator, not in a fabricated speed.
 */
const ROUND_TRIP_SPEED_MPH: Readonly<Record<string, number>> = {
  motorcycle_fastest: 48,
  motorcycle_twisty: 38,
  motorcycle_scenic: 34,
  motorcycle_adventure: 28,
};

/**
 * A timeboxed loop's round-trip distance in meters, from the engine profile and
 * the rider's target minutes (ported `estimateRoundTripDistanceMeters`).
 *
 * The target is bounded to the legacy 20–480 minute window before conversion,
 * so an extreme authored budget cannot produce an absurd loop request.
 */
export function estimateRoundTripDistanceMeters(
  profile: string,
  targetMinutes: number,
): number {
  const speedMph = ROUND_TRIP_SPEED_MPH[profile];
  if (speedMph === undefined) {
    throw new GraphHopperProviderError(
      `Unknown engine profile: ${profile}`,
      "validation",
    );
  }
  const boundedMinutes = Math.max(
    ROUND_TRIP_MIN_MINUTES,
    Math.min(ROUND_TRIP_MAX_MINUTES, targetMinutes),
  );
  return Math.round((speedMph * boundedMinutes) / 60 * METERS_PER_MILE);
}

/** One GraphHopper custom-model priority/speed statement. */
export interface GraphHopperCustomModelRule {
  readonly if?: string;
  readonly else?: string;
  readonly multiply_by?: string;
  readonly to?: string;
  readonly limit_to?: string;
  /** GraphHopper 11 turn-penalty increment; unused by current live routing. */
  readonly add?: string;
}

/** One polygon feature usable by an `in_<id>` custom-model condition. */
export interface GraphHopperAreaFeature {
  readonly type: "Feature";
  readonly id: string;
  readonly geometry:
    | {
        readonly type: "Polygon";
        readonly coordinates: readonly (readonly (readonly [number, number])[])[];
      }
    | {
        readonly type: "MultiPolygon";
        readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[];
      };
}

/** The `FeatureCollection` wrapper GraphHopper 11 expects for named areas. */
export interface GraphHopperAreaCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly GraphHopperAreaFeature[];
}

/** The inline custom model sent with a request. */
export interface GraphHopperCustomModel {
  readonly priority?: readonly GraphHopperCustomModelRule[];
  readonly speed?: readonly GraphHopperCustomModelRule[];
  /**
   * Query-time distance trade-off supported by GraphHopper custom weighting.
   * Frontier routing will use this only after deployment-mode constraints have
   * been verified; current requests leave it unset.
   */
  readonly distance_influence?: number;
  /**
   * GraphHopper 11 flexible turn costs. The active deployment must explicitly
   * allow request turn penalties before frontier probes may populate this.
   */
  readonly turn_penalty?: readonly GraphHopperCustomModelRule[];
  readonly areas?: GraphHopperAreaCollection;
}

/** The `/route` POST body this adapter sends. */
export interface GraphHopperRequestBody {
  readonly profile: string;
  /** `[lon, lat]` pairs in travel order. */
  readonly points: readonly (readonly [number, number])[];
  readonly points_encoded: false;
  readonly instructions: true;
  readonly calc_points: true;
  readonly elevation: false;
  readonly locale: string;
  readonly details: readonly string[];
  readonly custom_model?: GraphHopperCustomModel;
  readonly algorithm?: "alternative_route" | "round_trip";
  readonly "alternative_route.max_paths"?: number;
  readonly "alternative_route.max_weight_factor"?: number;
  readonly "alternative_route.max_share_factor"?: number;
  readonly "round_trip.distance"?: number;
  readonly "round_trip.seed"?: number;
  /**
   * One bearing per point, or `"NaN"` for "any direction" (the engine parses
   * the string; JSON has no NaN). Only sent in flexible mode.
   */
  readonly headings?: readonly (number | "NaN")[];
  readonly heading_penalty?: number;
}

/** A point as the wire list carries it, before conversion to `[lon, lat]`. */
export interface GraphHopperWirePoint {
  readonly lon: number;
  readonly lat: number;
  readonly label?: string;
  /** The bearing to snap in, for a sketch anchor (OGV-D-285). */
  readonly heading?: number;
}

/** How a listed span must be ridden (the legacy road-lock modes plus avoid). */
export type GraphHopperSpanMode = "must" | "prefer" | "avoid";

/** Which way along the span the rider travels. */
export type GraphHopperSpanDirection = "forward" | "reverse" | "either";

/**
 * One road span the ride must use or prefer, as the request builder needs it:
 * the resolved projection of `RoadSpanConstraint` (see the module docblock).
 */
export interface GraphHopperSpanConstraint {
  readonly id: string;
  readonly mode: GraphHopperSpanMode;
  readonly direction: GraphHopperSpanDirection;
  readonly label?: string;
  /** Ordered anchors from entry to exit; fewer than two means unresolved. */
  readonly anchors: readonly Coordinate[];
  /** Resolved span geometry, used to build the thin corridor polygon. */
  readonly corridor?: readonly Coordinate[];
  readonly corridorToleranceMeters?: number;
}

/**
 * Request-time surface/roughness rules, ported from the legacy bike-profile
 * rules. Values are GraphHopper enum names (`gravel`, `very_bad`, `grade3`, …);
 * an OSM-only material such as `earth` or `mud` is mapped to `OTHER` because
 * GraphHopper 11's enums have no member for it and the condition would
 * otherwise fail to compile at request time.
 */
export interface GraphHopperSurfacePolicy {
  readonly excludeSurfaces?: readonly string[];
  readonly excludeSmoothness?: readonly string[];
  readonly excludeTrackTypes?: readonly string[];
  readonly excludePathRoadClass?: boolean;
}

/** Timeboxed loop metadata (06 §17). */
export interface GraphHopperRoundTrip {
  readonly targetMinutes: number;
  readonly seed?: number;
  /**
   * Multiplies the estimated distance. The engine's loops overshoot or fall
   * short of the distance asked for, so the provider corrects it from the
   * answer's own duration (OGV-D-262).
   */
  readonly distanceScale?: number;
  /** Initial heading in degrees; omitted means "let the engine choose". */
  readonly heading?: number;
}

/** Everything the builder needs beyond the port request. */
export interface GraphHopperRequestOptions {
  /** Detail names to request; the provider passes {@link REQUESTED_DETAILS}. */
  readonly details: readonly string[];
  /**
   * Drop the smoothness condition from {@link GraphHopperSurfacePolicy}. Used by
   * the provider's degradation retry when the active graph predates the
   * smoothness encoded value.
   */
  readonly riderModesEnabled?: boolean;
  readonly rideFormulaEnabled?: boolean;
  readonly omitSmoothness?: boolean;
  /** Surface/roughness rules; absent when no bike policy was supplied. */
  readonly surfacePolicy?: GraphHopperSurfacePolicy;
  /** Road spans to route through or toward. */
  readonly spans?: readonly GraphHopperSpanConstraint[];
  /** Present only for a timeboxed loop. */
  readonly roundTrip?: GraphHopperRoundTrip;
  /**
   * The exact wire points to send, for one chunk of a long sketch (OGV-D-285).
   * The provider slices them from {@link requestWirePoints}; absent means the
   * whole request.
   */
  readonly points?: readonly GraphHopperWirePoint[];
  /**
   * The stretch of the sketch corridor this request's band covers. Absent
   * means the request's whole corridor; a chunk passes its own stretch so it
   * does not carry the band of the entire ride.
   */
  readonly sketchBand?: readonly Coordinate[];
}

/** A span is usable only once it resolved to at least two graph anchors. */
function isResolvedSpan(span: GraphHopperSpanConstraint): boolean {
  return span.anchors.length >= 2;
}

/** The anchors in travel order: a reverse span swaps entry and exit. */
function orderedAnchors(span: GraphHopperSpanConstraint): readonly Coordinate[] {
  return span.direction === "reverse" ? [...span.anchors].reverse() : span.anchors;
}

const MIN_CORRIDOR_TOLERANCE_METERS = 5;
const DEFAULT_CORRIDOR_TOLERANCE_METERS = 40;
const METERS_PER_DEGREE_LATITUDE = 111_320;

/**
 * Buffer a span line into a thin closed ring, so an `in_<area>` condition can
 * use it as a polygon mask.
 *
 * The corridor is a bounded *inside reward*, never a global outside zero: the
 * legacy defect that zeroed everything outside a thin polygon trapped the whole
 * route inside the corridor, which is why a must-use span is enforced by
 * injected waypoints and only rewarded by this polygon.
 */
function bufferSpanToPolygon(
  coordinates: readonly Coordinate[],
  toleranceMeters: number,
): Coordinate[] {
  if (coordinates.length < 2) return [];
  const tolerance = Math.max(toleranceMeters, MIN_CORRIDOR_TOLERANCE_METERS);
  const left: Coordinate[] = [];
  const right: Coordinate[] = [];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index];
    const to = coordinates[index + 1];
    if (from === undefined || to === undefined) continue;
    const deltaLon = to.lon - from.lon;
    const deltaLat = to.lat - from.lat;
    const length = Math.hypot(deltaLon, deltaLat);
    if (length === 0) continue;
    // Perpendicular direction adjusted for latitude so meters are roughly
    // isotropic at the span's location.
    const cosLat = Math.cos((from.lat * Math.PI) / 180) || 1;
    const scale = tolerance / METERS_PER_DEGREE_LATITUDE;
    const perpLon = (-deltaLat / length) * (scale / cosLat);
    const perpLat = (deltaLon / length) * scale;
    if (left.length === 0) {
      left.push({ lon: from.lon + perpLon, lat: from.lat + perpLat });
    }
    left.push({ lon: to.lon + perpLon, lat: to.lat + perpLat });
    if (right.length === 0) {
      right.push({ lon: from.lon - perpLon, lat: from.lat - perpLat });
    }
    right.push({ lon: to.lon - perpLon, lat: to.lat - perpLat });
  }
  const first = left[0];
  if (left.length === 0 || right.length === 0 || first === undefined) return [];
  return [...left, ...[...right].reverse(), first];
}

/** The inside-corridor rewards: a hard span pulls harder than a soft one. */
// Query priority multipliers cannot exceed one; outside penalties preserve
// the relative corridor rewards without reviving any hard zero.
const MUST_SPAN_OUTSIDE_FACTOR = "0.5556";
const PREFER_SPAN_OUTSIDE_FACTOR = "0.625";

/**
 * An `avoid` span is a request-time zero over its corridor: the same treatment an
 * avoid area gets, pointed at a line. It is the only shaping an avoid span gets —
 * the domain still measures the returned route against the span, so an avoid span
 * the router crossed anyway is rejected rather than quietly accepted.
 */
const AVOID_SPAN_INSIDE_WEIGHT = "0";

function areaFeature(id: string, ring: readonly Coordinate[]): GraphHopperAreaFeature {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "Polygon",
      coordinates: [ring.map(({ lon, lat }) => [lon, lat] as const)],
    },
  };
}

/**
 * Build the thin-corridor features for one span mode, numbering them from
 * `idOffset` so must and prefer spans share one id space (as the legacy lock
 * areas did).
 */
function buildSpanFeatures(
  spans: readonly GraphHopperSpanConstraint[],
  idOffset: number,
): GraphHopperAreaFeature[] {
  const features: GraphHopperAreaFeature[] = [];
  spans.forEach((span, index) => {
    const ring = bufferSpanToPolygon(
      span.corridor ?? [],
      span.corridorToleranceMeters ?? DEFAULT_CORRIDOR_TOLERANCE_METERS,
    );
    if (ring.length < 4) return;
    features.push(areaFeature(`opengravel_span_${idOffset + index}`, ring));
  });
  return features;
}

/** Close a resolve avoid ring if the caller did not. */
function closeRing(ring: readonly Coordinate[]): Coordinate[] {
  const first = ring[0];
  if (first === undefined) return [];
  const last = ring[ring.length - 1];
  if (last === undefined || first.lon !== last.lon || first.lat !== last.lat) {
    return [...ring, first];
  }
  return [...ring];
}

/**
 * A GraphHopper surface condition value: OSM materials GraphHopper's Surface
 * enum has no member for are sent as `OTHER`, because the engine's OSM parser
 * preserves them that way and sending `EARTH`/`MUD` fails to compile.
 */
function surfaceCondition(surface: string): string {
  const normalized = surface.toLowerCase();
  return normalized === "earth" || normalized === "mud"
    ? "surface == OTHER"
    : `surface == ${surface.toUpperCase()}`;
}

/** GraphHopper surface values that mean "not paved" (the M2 probe verified each). */
export const UNPAVED_SURFACE_CONDITION = [
  "UNPAVED",
  "COMPACTED",
  "FINE_GRAVEL",
  "GRAVEL",
  "GROUND",
  "DIRT",
  "GRASS",
  "SAND",
]
  .map((surface) => `surface == ${surface}`)
  .join(" || ");

/**
 * How strongly each surface preference discourages unpaved roads (M2,
 * OGV-D-262). None of the persistent motorcycle models penalize dirt, so the
 * rider's envelope has to arrive as a request-time rule or "Paved" would be a
 * decorative control. `pavement` is a near-exclusion rather than a zero, so a
 * destination only reachable over a gravel driveway still answers (and the
 * surface evidence then says so); `mixed` and `dirt-preferred` add nothing —
 * the latter is expressed by the adventure profile itself.
 */
export const SURFACE_PREFERENCE_UNPAVED_FACTOR: Readonly<
  Record<NonNullable<ProviderRouteRequest["options"]["surfacePreference"]>, string | null>
> = {
  pavement: "0.05",
  "mostly-pavement": "0.4",
  mixed: null,
  "dirt-preferred": null,
};

function surfacePreferenceRules(
  preference: ProviderRouteRequest["options"]["surfacePreference"],
): GraphHopperCustomModelRule[] {
  const factor = preference === undefined ? null : SURFACE_PREFERENCE_UNPAVED_FACTOR[preference];
  return factor === null ? [] : [{ if: UNPAVED_SURFACE_CONDITION, multiply_by: factor }];
}

/** The ported bike/surface rules, in the legacy order. */
function surfaceRules(
  policy: GraphHopperSurfacePolicy | undefined,
  omitSmoothness: boolean,
): GraphHopperCustomModelRule[] {
  if (policy === undefined) return [];
  const rules: GraphHopperCustomModelRule[] = [];
  const surfaces = policy.excludeSurfaces ?? [];
  if (surfaces.length > 0) {
    rules.push({
      if: surfaces.map(surfaceCondition).join(" || "),
      multiply_by: "0",
    });
  }
  const smoothness = policy.excludeSmoothness ?? [];
  if (!omitSmoothness && smoothness.length > 0) {
    rules.push({
      if: smoothness
        .map((value) => `smoothness == ${value.toUpperCase()}`)
        .join(" || "),
      multiply_by: "0",
    });
  }
  const trackTypes = policy.excludeTrackTypes ?? [];
  if (trackTypes.length > 0) {
    rules.push({
      if: trackTypes
        .map((value) => `track_type == ${value.toUpperCase()}`)
        .join(" || "),
      multiply_by: "0",
    });
  }
  if (policy.excludePathRoadClass === true) {
    rules.push({ if: "road_class == PATH", multiply_by: "0" });
  }
  return rules;
}

/**
 * A must-use span's ordered wire waypoints.
 *
 * Must-use spans force ordered traversal by injecting their entry and exit
 * anchors as via-waypoints in the rider's span order, which is what makes
 * "ride this road" an instruction rather than a hope. `wireToOriginal[i]` is
 * the original point index, or `-1` for an injected anchor, so a consumer that
 * reports rider-authored waypoints can drop the injected ones.
 */
export function expandMustUseSpans(
  points: readonly GraphHopperWirePoint[],
  spans: readonly GraphHopperSpanConstraint[],
): { readonly points: GraphHopperWirePoint[]; readonly wireToOriginal: number[] } {
  const plain = {
    points: points.map((point) => ({ ...point })),
    wireToOriginal: points.map((_point, index) => index),
  };
  const start = points[0];
  const mustSpans = spans.filter(
    (span) => span.mode === "must" && isResolvedSpan(span),
  );
  if (start === undefined || mustSpans.length === 0) return plain;

  const expanded: GraphHopperWirePoint[] = [{ ...start }];
  const wireToOriginal: number[] = [0];
  for (const span of mustSpans) {
    const anchors = orderedAnchors(span);
    const entry = anchors[0];
    const exit = anchors[anchors.length - 1];
    if (entry === undefined || exit === undefined) continue;
    const name = span.label?.trim() || span.id;
    expanded.push({ lon: entry.lon, lat: entry.lat, label: `Must-use ${name}: entry` });
    wireToOriginal.push(-1);
    expanded.push({ lon: exit.lon, lat: exit.lat, label: `Must-use ${name}: exit` });
    wireToOriginal.push(-1);
  }
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) continue;
    expanded.push({ ...point });
    wireToOriginal.push(index);
  }
  return { points: expanded, wireToOriginal };
}

/**
 * The sketch band's priority outside the drawn corridor (OGV-D-285): a penalty,
 * never a zero, so a drawn section with no road under it still routes around.
 */
const SKETCH_OUTSIDE_BAND_FACTOR = String(SKETCH_OUTSIDE_BAND_PRIORITY);

/**
 * How strongly a sketch anchor holds to the drawn heading, in seconds of
 * penalty for snapping against it. Measured with the band on the 90-mile
 * fixture: without headings, 24 anchors produced 23 extra miles of dead-end
 * spurs; with them, none.
 */
export const SKETCH_HEADING_PENALTY_SECONDS = 600;

/**
 * The endpoint wire list a non-round-trip request starts from:
 * `origin → stops → shaping → sketch anchors → destination`. Exported so the
 * provider can split a long sketch into chunks of exactly these points.
 */
export function requestWirePoints(request: ProviderRouteRequest): GraphHopperWirePoint[] {
  return endpointPoints(request);
}

/** The endpoint wire list a non-round-trip request starts from. */
function endpointPoints(request: ProviderRouteRequest): GraphHopperWirePoint[] {
  return [
    { lon: request.origin.lon, lat: request.origin.lat },
    ...request.stops.map((stop) => ({ lon: stop.lon, lat: stop.lat })),
    ...request.shaping.map((point) => ({ lon: point.lon, lat: point.lat })),
    ...sketchViaPoints(request),
    { lon: request.destination.lon, lat: request.destination.lat },
  ];
}

/**
 * A sketch's **interior** samples, as via points (04 §19, 06 §18).
 *
 * The anchors travel with the request so the engine is told which way the rider
 * drew; the two ends are deliberately left out, because the trace's own endpoints
 * are already the request's origin and destination under `derive`, and under
 * `preserve-existing` they are the rider's authored points — forcing a route
 * through where a pen happened to start would be a detour nobody asked for. This
 * is the legacy `corridorShapingAnchors` rule (interior fractions only), carried
 * onto the port.
 *
 * The anchors bias the path; they are never stops, never appear in guidance, and
 * the route that comes back is still measured against the corridor before
 * anything is shown (the pipeline's `sketchAdherence`).
 */
function sketchViaPoints(request: ProviderRouteRequest): GraphHopperWirePoint[] {
  const anchors = request.sketch?.anchors ?? [];
  if (anchors.length <= 2) return [];
  const interior = anchors.slice(1, -1);
  // Each anchor snaps to a road running the way the rider drew, so a noisy
  // anchor lands on the drawn road rather than a side street (OGV-D-285).
  const corridor = request.sketch?.corridor ?? [];
  const headings = corridor.length >= 2 ? sketchAnchorHeadings(corridor, interior) : [];
  return interior.map((point, index) => {
    const heading = headings[index];
    return {
      lon: point.lon,
      lat: point.lat,
      label: "Sketch",
      ...(heading === null || heading === undefined ? {} : { heading }),
    };
  });
}

/** The legacy round-trip preconditions, now expressed against the port. */
function roundTripPoints(request: ProviderRouteRequest): GraphHopperWirePoint[] {
  // A sketch is a drawn path, and the engine's round trip carries no via points:
  // the two are contradictory instructions, so the conflict is reported rather
  // than silently dropping the rider's drawing (06 §18).
  if (
    request.stops.length > 0 ||
    request.shaping.length > 0 ||
    (request.sketch?.anchors.length ?? 0) > 0
  ) {
    throw new GraphHopperProviderError(
      "A round trip rides back to its origin and cannot carry stops, shaping points or a sketch.",
      "validation",
    );
  }
  if (
    request.destination.lon !== request.origin.lon ||
    request.destination.lat !== request.origin.lat
  ) {
    throw new GraphHopperProviderError(
      "A round trip must start and finish at the same point.",
      "validation",
    );
  }
  return [{ lon: request.origin.lon, lat: request.origin.lat }];
}

/**
 * Builds the `/route` body for one port request.
 *
 * The body is exactly what the engine needs and nothing more: no provider
 * preference, no rider label, no role or score. Points are ordered
 * `origin → stops → shaping → destination`, with must-use span anchors injected
 * in span order when spans are supplied.
 */
export function createGraphHopperRequest(
  request: ProviderRouteRequest,
  options: GraphHopperRequestOptions,
): GraphHopperRequestBody {
  const roundTrip = options.roundTrip;
  let points: readonly GraphHopperWirePoint[];
  if (options.points !== undefined) {
    points = options.points;
  } else if (roundTrip === undefined) {
    const base = endpointPoints(request);
    const expansion = expandMustUseSpans(base, options.spans ?? []);
    points = expansion.wireToOriginal.some((index) => index === -1)
      ? expansion.points
      : base;
  } else {
    points = roundTripPoints(request);
  }

  const spans = (options.spans ?? []).filter(isResolvedSpan);
  const mustFeatures = buildSpanFeatures(
    spans.filter((span) => span.mode === "must"),
    0,
  );
  const preferFeatures = buildSpanFeatures(
    spans.filter((span) => span.mode === "prefer"),
    mustFeatures.length,
  );
  const avoidSpanFeatures = buildSpanFeatures(
    spans.filter((span) => span.mode === "avoid"),
    mustFeatures.length + preferFeatures.length,
  );
  const avoidFeatures = request.avoidPolygons.map((ring, index) =>
    areaFeature(`opengravel_avoid_${index}`, closeRing(ring)),
  );
  // The drawn corridor as a band the route is held to (OGV-D-285). A round trip
  // carries no sketch (it is refused above), so the band is point-to-point only.
  const sketchBand = roundTrip === undefined
    ? sketchCorridorBand(options.sketchBand ?? request.sketch?.corridor ?? [])
    : [];
  const sketchFeatures: GraphHopperAreaFeature[] = sketchBand.length === 0
    ? []
    : [{
        type: "Feature",
        id: SKETCH_BAND_AREA_ID,
        geometry: {
          type: "MultiPolygon",
          coordinates: sketchBand.map((ring) => [ring.map(({ lon, lat }) => [lon, lat] as const)]),
        },
      }];

  const trafficFeatures = options.riderModesEnabled === false ? [] :
    (request.options.trafficPenaltyPolygons ?? []).map((ring, index) => areaFeature(`opengravel_traffic_${index}`, closeRing(ring)));
  const priorityRules: GraphHopperCustomModelRule[] = [
    ...rideFormulaRules(request.options, options.riderModesEnabled !== false && options.rideFormulaEnabled === true),
    ...riderModeRules(request.options, options.riderModesEnabled !== false, options.omitSmoothness === true, request.profile),
    ...trafficFeatures.map(feature => ({ if: `in_${feature.id}`, multiply_by: "0.35" })),
    ...(request.options.avoidHighways
      ? [{ if: "road_class == MOTORWAY || road_class == TRUNK", multiply_by: "0" }]
      : []),
    // Explicit toll avoidance is a request-time zero; the persistent profiles
    // penalize tolls without excluding them by default.
    ...(request.options.tollPolicy === "avoid"
      ? [{ if: "toll == ALL", multiply_by: "0" }]
      : []),
    ...avoidFeatures.map((feature) => ({
      if: `in_${feature.id}`,
      multiply_by: "0",
    })),
    ...avoidSpanFeatures.map((feature) => ({
      if: `in_${feature.id}`,
      multiply_by: AVOID_SPAN_INSIDE_WEIGHT,
    })),
    ...mustFeatures.map((feature) => ({
      if: `!in_${feature.id}`,
      multiply_by: MUST_SPAN_OUTSIDE_FACTOR,
    })),
    ...preferFeatures.map((feature) => ({
      if: `!in_${feature.id}`,
      multiply_by: PREFER_SPAN_OUTSIDE_FACTOR,
    })),
    ...sketchFeatures.map((feature) => ({
      if: `!in_${feature.id}`,
      multiply_by: SKETCH_OUTSIDE_BAND_FACTOR,
    })),
    ...surfacePreferenceRules(request.options.surfacePreference),
    ...surfaceRules(options.surfacePolicy, options.omitSmoothness === true),
  ];
  const areaFeatures = [
    ...avoidFeatures,
    ...avoidSpanFeatures,
    ...mustFeatures,
    ...preferFeatures,
    ...sketchFeatures,
    ...trafficFeatures,
  ];
  const hasCustomModelContent =
    priorityRules.length > 0 || areaFeatures.length > 0;
  const customModel: GraphHopperCustomModel | undefined = hasCustomModelContent
    ? {
        priority: priorityRules,
        ...(areaFeatures.length > 0
          ? {
              areas: {
                type: "FeatureCollection",
                features: areaFeatures,
              } satisfies GraphHopperAreaCollection,
            }
          : {}),
      }
    : undefined;

  const body: GraphHopperRequestBody = {
    profile: options.riderModesEnabled === false && request.options.bike?.category === "dual-sport" && request.options.surfacePreference === "mixed" && request.profile === "motorcycle_adventure"
      ? characterProfileFor(request.options.roadCharacter ?? "balanced")
      : request.profile,
    points: points.map(({ lon, lat }) => [lon, lat] as const),
    points_encoded: false,
    instructions: true,
    calc_points: true,
    elevation: false,
    locale: LOCALE,
    details: [...options.details],
    ...(customModel === undefined ? {} : { custom_model: customModel }),
    ...(roundTrip === undefined && points.some((point) => point.heading !== undefined)
      ? {
          headings: points.map((point) => point.heading ?? "NaN"),
          heading_penalty: SKETCH_HEADING_PENALTY_SECONDS,
        }
      : {}),
  };

  if (roundTrip !== undefined) {
    return {
      ...body,
      algorithm: "round_trip",
      "round_trip.distance": Math.round(
        estimateRoundTripDistanceMeters(body.profile, roundTrip.targetMinutes) *
          (roundTrip.distanceScale ?? 1),
      ),
      "round_trip.seed": roundTrip.seed ?? 0,
      ...(roundTrip.heading === undefined ? {} : { headings: [roundTrip.heading] }),
    };
  }
  // Alternatives only make sense for a plain two-point request; a request with
  // stops is a multi-point tour the engine answers with one path.
  if (request.options.includeAlternatives && body.points.length === 2) {
    return {
      ...body,
      algorithm: "alternative_route",
      "alternative_route.max_paths": 3,
      "alternative_route.max_weight_factor": 1.8,
      "alternative_route.max_share_factor": 0.62,
    };
  }
  return body;
}
