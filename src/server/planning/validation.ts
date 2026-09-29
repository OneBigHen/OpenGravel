/**
 * Bounded validation for `/api/route-plan` input (23-API-CONTRACTS §14).
 *
 * Everything arriving from a browser is untrusted. This module is the single
 * gate that decides whether a body may reach the routing engine at all, and it
 * is deliberately *bounded*: coordinate ranges, a maximum number of stops and
 * shaping points, a maximum polygon size, a maximum nesting depth and a maximum
 * field count over the whole body. An unbounded body is a denial-of-service
 * vector against a router, not a routing problem.
 *
 * Two entry points:
 *
 * - {@link validateRoutePlanRequestBody} returns every issue it found, so a
 *   caller can report the whole picture instead of the first complaint;
 * - {@link parseRoutePlanRequestBody} validates and then builds a **fresh**
 *   object holding only the contract fields, so no unknown key from the wire
 *   can travel further into the pipeline.
 *
 * The module never throws and never repairs: malformed input is reported.
 */

import type {
  ProviderRoadSpan,
  ProviderRouteRequest,
  ProviderSketch,
} from "@/application/planner/route-provider";
import {
  MAX_PROVIDER_ROAD_SPANS,
  MAX_PROVIDER_SKETCH_ANCHORS,
  MAX_PROVIDER_SKETCH_CORRIDOR_POINTS,
  MAX_PROVIDER_SKETCH_TOPOLOGY_HINTS,
  MAX_PROVIDER_SPAN_ANCHORS,
  MAX_PROVIDER_SPAN_CORRIDOR_POINTS,
} from "@/application/planner/route-provider";
import type {
  RoutePlanIdentityWire,
  RoutePlanOptionsWire,
  RoutePlanRequestBody,
} from "@/application/planner/ports/route-plan-contract";
import type { Coordinate } from "@/domain/ride/types";

/** v1 bounds (23 §14). `MAX_STOPS` is the pinned v1 product bound. */
export const MAX_STOPS = 8;
export const MAX_SHAPING_POINTS = 32;
/**
 * The body's total field budget (23 §14).
 *
 * Raised from 64 when road spans joined the contract: eight bounded spans with
 * eight bounded anchors each, plus their ids and modes, is more than 64 fields
 * of the *legitimate* shape — the per-list caps below are the real per-value
 * bounds, and this number only has to stay far enough above them to admit a
 * valid ride while still refusing a body whose size is the attack. Depth is
 * capped separately, and every list a span can carry is capped individually.
 */
export const MAX_BODY_FIELDS = 8192;
export const MAX_BODY_DEPTH = 6;
export const MAX_POLYGON_RINGS = 16;
export const MAX_POLYGON_POINTS = 2_000;
export const MAX_PROFILE_LENGTH = 64;
export const MAX_REQUEST_ID_LENGTH = 128;
/** The most spans one request may carry; the port owns the number. */
export { MAX_PROVIDER_ROAD_SPANS as MAX_ROAD_SPANS };

/** Stable codes: the route handler maps them to HTTP status and details. */
export type ValidationIssueCode =
  | "missing-input"
  | "invalid-identity"
  | "invalid-coordinate"
  | "invalid-value"
  | "limit-exceeded";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  /** Dotted path to the offending value, e.g. `request.stops[2].lat`. */
  readonly path: string;
  readonly message: string;
}

export type RoutePlanParseResult =
  | { readonly ok: true; readonly value: RoutePlanRequestBody }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function issue(
  code: ValidationIssueCode,
  path: string,
  message: string,
): ValidationIssue {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Own enumerable field count, depth-bounded and early-exiting at `limit`.
 *
 * Counting is what makes "maximum body fields" enforceable without trusting the
 * shape of the body: an attacker-supplied 100k-key object is rejected before
 * any other check runs, and a deeply nested one stops at `MAX_BODY_DEPTH`.
 */
function countFields(
  value: unknown,
  limit: number,
  depth = 0,
): { count: number; tooDeep: boolean } {
  if (depth > MAX_BODY_DEPTH) return { count: limit + 1, tooDeep: true };
  if (!isPlainObject(value)) {
    if (Array.isArray(value)) {
      let count = 0;
      for (const entry of value) {
        const nested = countFields(entry, limit - count, depth + 1);
        count += nested.count;
        if (nested.tooDeep || count > limit) return { count: limit + 1, tooDeep: nested.tooDeep };
      }
      return { count, tooDeep: false };
    }
    return { count: 0, tooDeep: false };
  }
  let count = 0;
  for (const key of Object.keys(value)) {
    count += 1;
    if (count > limit) return { count, tooDeep: false };
    const nested = countFields(value[key], limit - count, depth + 1);
    count += nested.count;
    if (nested.tooDeep || count > limit) return { count: limit + 1, tooDeep: nested.tooDeep };
  }
  return { count, tooDeep: false };
}

function coordinateIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push(
      issue("missing-input", path, "must be an object with numeric lon and lat"),
    );
    return;
  }
  const { lon, lat } = value;
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
    issues.push(issue("invalid-coordinate", path, "lon and lat must be finite numbers"));
    return;
  }
  if (lon < -180 || lon > 180) {
    issues.push(issue("invalid-coordinate", `${path}.lon`, "must be within -180..180"));
  }
  if (lat < -90 || lat > 90) {
    issues.push(issue("invalid-coordinate", `${path}.lat`, "must be within -90..90"));
  }
}

function coordinateListIssues(
  value: unknown,
  path: string,
  maxPoints: number,
  issues: ValidationIssue[],
  label: string,
): void {
  if (!Array.isArray(value)) {
    issues.push(issue("missing-input", path, "must be an array of coordinates"));
    return;
  }
  if (value.length > maxPoints) {
    issues.push(
      issue(
        "limit-exceeded",
        path,
        `${label} accepts at most ${maxPoints} points, received ${value.length}`,
      ),
    );
    return;
  }
  value.forEach((entry, index) => coordinateIssues(entry, `${path}[${index}]`, issues));
}

function identityIssues(value: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", "identity", "ownership identity is required"));
    return;
  }
  const { rideId, rideRevision, planningGeneration } = value;
  if (typeof rideId !== "string" || rideId.length === 0) {
    issues.push(issue("invalid-identity", "identity.rideId", "must be a non-empty string"));
  }
  if (!isNonNegativeInteger(rideRevision)) {
    issues.push(
      issue("invalid-identity", "identity.rideRevision", "must be a non-negative integer"),
    );
  }
  if (!isNonNegativeInteger(planningGeneration)) {
    issues.push(
      issue(
        "invalid-identity",
        "identity.planningGeneration",
        "must be a non-negative integer",
      ),
    );
  }
}

function optionsIssues(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", path, "must be an object when present"));
    return;
  }
  const includeAlternatives = value["includeAlternatives"];
  if (includeAlternatives !== undefined && typeof includeAlternatives !== "boolean") {
    issues.push(
      issue("invalid-value", `${path}.includeAlternatives`, "must be a boolean"),
    );
  }
}

/** The request's own fields: correlation id and provider profile. */
function requestFieldIssues(value: Record<string, unknown>, issues: ValidationIssue[]): void {
  const requestId = value["requestId"];
  if (
    typeof requestId !== "string" ||
    requestId.length === 0 ||
    requestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    issues.push(
      issue(
        "invalid-value",
        "request.requestId",
        `must be a non-empty string of at most ${MAX_REQUEST_ID_LENGTH} characters`,
      ),
    );
  }
  const profile = value["profile"];
  if (
    typeof profile !== "string" ||
    profile.length === 0 ||
    profile.length > MAX_PROFILE_LENGTH
  ) {
    issues.push(
      issue(
        "invalid-value",
        "request.profile",
        `must be a non-empty provider profile of at most ${MAX_PROFILE_LENGTH} characters`,
      ),
    );
  }
}

/**
 * One road span as the wire carries it (23 §2, §14): a bounded identity plus its
 * ordered anchors and, optionally, its corridor polygon source line.
 */
function roadSpanIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", path, "must be a road-span object"));
    return;
  }
  roadSpanIdentityIssues(value, path, issues);
  roadSpanGeometryIssues(value, path, issues);
}

/** The span's identity fields: id, mode and direction. */
function roadSpanIdentityIssues(
  value: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  const id = value["id"];
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_REQUEST_ID_LENGTH) {
    issues.push(
      issue(
        "invalid-value",
        `${path}.id`,
        `must be a non-empty string of at most ${MAX_REQUEST_ID_LENGTH} characters`,
      ),
    );
  }
  const mode = value["mode"];
  if (mode !== "must" && mode !== "prefer" && mode !== "avoid") {
    issues.push(
      issue("invalid-value", `${path}.mode`, 'must be "must", "prefer" or "avoid"'),
    );
  }
  const direction = value["direction"];
  if (direction !== "forward" && direction !== "reverse" && direction !== "either") {
    issues.push(
      issue(
        "invalid-value",
        `${path}.direction`,
        'must be "forward", "reverse" or "either"',
      ),
    );
  }
}

/** One bounded coordinate line: the count first, then each position. */
function boundedLineIssues(
  value: unknown,
  path: string,
  maxPoints: number,
  issues: ValidationIssue[],
  label: string,
): void {
  if (!Array.isArray(value) || value.length < 2) {
    issues.push(issue("missing-input", path, `${label} needs at least two points`));
    return;
  }
  if (value.length > maxPoints) {
    issues.push(
      issue(
        "limit-exceeded",
        path,
        `${label} accepts at most ${maxPoints} points, received ${value.length}`,
      ),
    );
    return;
  }
  value.forEach((point, index) => coordinateIssues(point, `${path}[${index}]`, issues));
}

/** The span's geometry fields: anchors, optional corridor, optional tolerance. */
function roadSpanGeometryIssues(
  value: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  boundedLineIssues(
    value["anchors"],
    `${path}.anchors`,
    MAX_PROVIDER_SPAN_ANCHORS,
    issues,
    "a span's anchors",
  );
  const corridor = value["corridor"];
  if (corridor !== undefined) {
    boundedLineIssues(
      corridor,
      `${path}.corridor`,
      MAX_PROVIDER_SPAN_CORRIDOR_POINTS,
      issues,
      "a span corridor",
    );
  }
  const tolerance = value["corridorToleranceMeters"];
  if (tolerance !== undefined && (!isFiniteNumber(tolerance) || tolerance < 0)) {
    issues.push(
      issue(
        "invalid-value",
        `${path}.corridorToleranceMeters`,
        "must be a finite non-negative number",
      ),
    );
  }
}

/** Endpoints, stops, shaping points and avoid rings: every coordinate bound. */
function requestGeometryIssues(value: Record<string, unknown>, issues: ValidationIssue[]): void {
  coordinateIssues(value["origin"], "request.origin", issues);
  coordinateIssues(value["destination"], "request.destination", issues);
  coordinateListIssues(value["stops"], "request.stops", MAX_STOPS, issues, "stops");  coordinateListIssues(
    value["shaping"],
    "request.shaping",
    MAX_SHAPING_POINTS,
    issues,
    "shaping points",
  );

  const polygons = value["avoidPolygons"];
  if (!Array.isArray(polygons)) {
    issues.push(
      issue("missing-input", "request.avoidPolygons", "must be an array of rings"),
    );
    return;
  }
  if (polygons.length > MAX_POLYGON_RINGS) {
    issues.push(
      issue(
        "limit-exceeded",
        "request.avoidPolygons",
        `accepts at most ${MAX_POLYGON_RINGS} rings, received ${polygons.length}`,
      ),
    );
    return;
  }
  polygons.forEach((ring, index) =>
    coordinateListIssues(
      ring,
      `request.avoidPolygons[${index}]`,
      MAX_POLYGON_POINTS,
      issues,
      "an avoid ring",
    ),
  );

  // Road spans are optional: an absent list means the caller resolved none, and
  // a present one is bounded in count, anchors and corridor length before it can
  // reach the builder.
  const roadSpans = value["roadSpans"];
  if (roadSpans === undefined) return;
  if (!Array.isArray(roadSpans)) {
    issues.push(issue("missing-input", "request.roadSpans", "must be an array of spans"));
    return;
  }
  if (roadSpans.length > MAX_PROVIDER_ROAD_SPANS) {
    issues.push(
      issue(
        "limit-exceeded",
        "request.roadSpans",
        `accepts at most ${MAX_PROVIDER_ROAD_SPANS} spans, received ${roadSpans.length}`,
      ),
    );
    return;
  }
  roadSpans.forEach((span, index) =>
    roadSpanIssues(span, `request.roadSpans[${index}]`, issues),
  );
}

/** One topology hint as the wire carries it (04 §19, 05 §19). */
function sketchTopologyHintIssues(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", path, "must be a topology-hint object"));
    return;
  }
  const kind = value["kind"];
  if (kind !== "crossing" && kind !== "double-back" && kind !== "near-loop") {
    issues.push(
      issue(
        "invalid-value",
        `${path}.kind`,
        'must be "crossing", "double-back" or "near-loop"',
      ),
    );
  }
  coordinateIssues(value["at"], `${path}.at`, issues);
  const strokeIndices = value["strokeIndices"];
  if (strokeIndices === undefined) return;
  if (!Array.isArray(strokeIndices)) {
    issues.push(
      issue("invalid-value", `${path}.strokeIndices`, "must be an array of stroke indices"),
    );
    return;
  }
  strokeIndices.forEach((entry, index) => {
    if (!Number.isInteger(entry) || (entry as number) < 0) {
      issues.push(
        issue(
          "invalid-value",
          `${path}.strokeIndices[${index}]`,
          "must be a non-negative integer",
        ),
      );
    }
  });
}

/**
 * The resolved sketch on the wire (03 §13, 06 §18, Task 4.4).
 *
 * Optional, like the span list: an absent sketch means the ride has none — or
 * that the client could not resolve its geometry, which it reports through the
 * `sketch` member's own absence rather than by sending an empty one. The bounds
 * are the port's, so the validator and the builder name the same numbers.
 */
function sketchIssues(
  value: unknown,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", "request.sketch", "must be a sketch object"));
    return;
  }
  boundedLineIssues(
    value["anchors"],
    "request.sketch.anchors",
    MAX_PROVIDER_SKETCH_ANCHORS,
    issues,
    "sketch anchors",
  );
  const corridor = value["corridor"];
  if (corridor !== undefined) {
    boundedLineIssues(
      corridor,
      "request.sketch.corridor",
      MAX_PROVIDER_SKETCH_CORRIDOR_POINTS,
      issues,
      "a sketch corridor",
    );
  }
  const policy = value["endpointPolicy"];
  if (policy !== "derive" && policy !== "preserve-existing") {
    issues.push(
      issue(
        "invalid-value",
        "request.sketch.endpointPolicy",
        'must be "derive" or "preserve-existing"',
      ),
    );
  }
  if (typeof value["nearLoop"] !== "boolean") {
    issues.push(
      issue("invalid-value", "request.sketch.nearLoop", "must be a boolean"),
    );
  }
  const hints = value["topologyHints"];
  if (!Array.isArray(hints)) {
    issues.push(
      issue("missing-input", "request.sketch.topologyHints", "must be an array"),
    );
  } else if (hints.length > MAX_PROVIDER_SKETCH_TOPOLOGY_HINTS) {
    issues.push(
      issue(
        "limit-exceeded",
        "request.sketch.topologyHints",
        `accepts at most ${MAX_PROVIDER_SKETCH_TOPOLOGY_HINTS} hints, received ${hints.length}`,
      ),
    );
  } else {
    hints.forEach((hint, index) =>
      sketchTopologyHintIssues(hint, `request.sketch.topologyHints[${index}]`, issues),
    );
  }
  const endpoints = value["derivedEndpoints"];
  if (endpoints === null) return;
  if (!isPlainObject(endpoints)) {
    issues.push(
      issue(
        "invalid-value",
        "request.sketch.derivedEndpoints",
        "must be null or an endpoint pair",
      ),
    );
    return;
  }
  coordinateIssues(endpoints["start"], "request.sketch.derivedEndpoints.start", issues);
  coordinateIssues(endpoints["finish"], "request.sketch.derivedEndpoints.finish", issues);
}

/** The sketch half of the request geometry, next to the spans it resembles. */
function requestSketchIssues(value: Record<string, unknown>, issues: ValidationIssue[]): void {
  sketchIssues(value["sketch"], issues);
}

function discoveryIssues(
  value: unknown,
  request: Record<string, unknown>,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", "request.discovery", "must be a discovery object"));
    return;
  }
  const targetMinutes = value["targetMinutes"];
  const toleranceMinutes = value["toleranceMinutes"];
  if (!isFiniteNumber(targetMinutes) || targetMinutes < 20 || targetMinutes > 480) {
    issues.push(
      issue("invalid-value", "request.discovery.targetMinutes", "must be between 20 and 480 minutes"),
    );
  }
  if (!isFiniteNumber(toleranceMinutes) || toleranceMinutes < 0 || toleranceMinutes > 480) {
    issues.push(
      issue("invalid-value", "request.discovery.toleranceMinutes", "must be between 0 and 480 minutes"),
    );
  }
  const origin = request["origin"];
  const destination = request["destination"];
  const sameOrigin =
    isPlainObject(origin) &&
    isPlainObject(destination) &&
    origin["lon"] === destination["lon"] &&
    origin["lat"] === destination["lat"];
  if (
    !sameOrigin ||
    (Array.isArray(request["stops"]) && request["stops"].length > 0) ||
    (Array.isArray(request["shaping"]) && request["shaping"].length > 0)
  ) {
    issues.push(
      issue(
        "invalid-value",
        "request.discovery",
        "loop discovery requires a round trip without stops or shaping points",
      ),
    );
  }
}

/** The route options the provider contract requires (Task 2.1). */
function requestOptionsIssues(value: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", "request.options", "route options are required"));
    return;
  }  if (typeof value["includeAlternatives"] !== "boolean") {
    issues.push(
      issue("invalid-value", "request.options.includeAlternatives", "must be a boolean"),
    );
  }
  if (typeof value["avoidHighways"] !== "boolean") {
    issues.push(
      issue("invalid-value", "request.options.avoidHighways", "must be a boolean"),
    );
  }
  const tollPolicy = value["tollPolicy"];
  if (tollPolicy !== "avoid" && tollPolicy !== "allow-with-warning") {
    issues.push(
      issue(
        "invalid-value",
        "request.options.tollPolicy",
        'must be "avoid" or "allow-with-warning"',
      ),
    );
  }
  if (value["vehicle"] !== "motorcycle") {
    issues.push(
      issue("invalid-value", "request.options.vehicle", 'must be "motorcycle"'),
    );
  }
  const surfacePreference = value["surfacePreference"];
  if (surfacePreference !== undefined && !SURFACE_PREFERENCES.has(String(surfacePreference))) {
    issues.push(
      issue(
        "invalid-value",
        "request.options.surfacePreference",
        'must be "pavement", "mostly-pavement", "mixed" or "dirt-preferred"',
      ),
    );
  }
  const roadCharacter = value["roadCharacter"];
  if (roadCharacter !== undefined && !ROAD_CHARACTERS.has(String(roadCharacter))) {
    issues.push(
      issue(
        "invalid-value",
        "request.options.roadCharacter",
        'must be "efficient", "balanced", "curvy" or "backroads"',
      ),
    );
  }
}

const ROAD_CHARACTERS: ReadonlySet<string> = new Set(["efficient", "balanced", "curvy", "backroads"]);

const SURFACE_PREFERENCES: ReadonlySet<string> = new Set([
  "pavement",
  "mostly-pavement",
  "mixed",
  "dirt-preferred",
]);

function providerRequestIssues(value: unknown, issues: ValidationIssue[]): void {
  if (!isPlainObject(value)) {
    issues.push(issue("missing-input", "request", "planning request is required"));
    return;
  }
  requestFieldIssues(value, issues);
  requestGeometryIssues(value, issues);
  requestSketchIssues(value, issues);
  discoveryIssues(value["discovery"], value, issues);
  requestOptionsIssues(value["options"], issues);
}

/**
 * Every reason `body` cannot be planned, or an empty list when it can.
 *
 * Checks are bounded and non-recursive beyond `MAX_BODY_DEPTH`, so a hostile
 * body cannot make validation itself expensive.
 */
export function validateRoutePlanRequestBody(
  body: unknown,
): readonly ValidationIssue[] {
  if (!isPlainObject(body)) {
    return [issue("missing-input", "body", "the request body must be a JSON object")];
  }
  const issues: ValidationIssue[] = [];
  const fields = countFields(body, MAX_BODY_FIELDS);
  if (fields.tooDeep || fields.count > MAX_BODY_FIELDS) {
    issues.push(
      issue(
        "limit-exceeded",
        "body",
        `accepts at most ${MAX_BODY_FIELDS} fields (depth <= ${MAX_BODY_DEPTH})`,
      ),
    );
  }
  identityIssues(body["identity"], issues);
  providerRequestIssues(body["request"], issues);
  optionsIssues(body["options"], "options", issues);
  return issues;
}

function toCoordinate(value: unknown): Coordinate {
  const record = value as Record<string, unknown>;
  return { lon: record["lon"] as number, lat: record["lat"] as number };
}

function toCoordinateList(value: unknown): readonly Coordinate[] {
  return (value as readonly unknown[]).map(toCoordinate);
}

/**
 * Narrows one validated span into the contract shape, dropping unknown keys for
 * the same reason the body parser does: the request the builder sees is exactly
 * what the contract names.
 */
function toRoadSpan(value: unknown): ProviderRoadSpan {
  const record = value as Record<string, unknown>;
  const corridor = record["corridor"];
  const tolerance = record["corridorToleranceMeters"];
  return {
    id: record["id"] as string,
    mode: record["mode"] as ProviderRoadSpan["mode"],
    direction: record["direction"] as ProviderRoadSpan["direction"],
    anchors: toCoordinateList(record["anchors"]),
    ...(corridor === undefined ? {} : { corridor: toCoordinateList(corridor) }),
    ...(tolerance === undefined
      ? {}
      : { corridorToleranceMeters: tolerance as number }),
  };
}

/**
 * Narrows the wire's sketch into the port's projection (Task 4.4). The parser
 * trusts the validator's shapes; an absent member stays absent, so "the ride has
 * no sketch" and "the client resolved none" keep the one representation the
 * request already had.
 */
function toSketch(value: unknown): ProviderSketch | undefined {
  if (!isPlainObject(value)) return undefined;
  const corridor = value["corridor"];
  const endpoints = value["derivedEndpoints"];
  return {
    anchors: toCoordinateList(value["anchors"]),
    ...(corridor === undefined ? {} : { corridor: toCoordinateList(corridor) }),
    endpointPolicy: value["endpointPolicy"] as ProviderSketch["endpointPolicy"],
    nearLoop: value["nearLoop"] as boolean,
    topologyHints: (value["topologyHints"] as readonly unknown[]).map((hint) => {
      const record = hint as Record<string, unknown>;
      const strokeIndices = record["strokeIndices"];
      return {
        kind: record["kind"] as ProviderSketch["topologyHints"][number]["kind"],
        at: toCoordinate(record["at"]),
        ...(Array.isArray(strokeIndices)
          ? { strokeIndices: strokeIndices as readonly number[] }
          : {}),
      };
    }),
    derivedEndpoints:
      isPlainObject(endpoints)
        ? {
            start: toCoordinate(endpoints["start"]),
            finish: toCoordinate(endpoints["finish"]),
          }
        : null,
  };
}

/**
 * Validates and narrows a body into the contract shape, dropping every key the
 * contract does not name. Only call the parsing half after the validator has
 * accepted the body: it trusts the shapes the validator proved.
 */
export function parseRoutePlanRequestBody(
  body: unknown,
): RoutePlanParseResult {
  const issues = validateRoutePlanRequestBody(body);
  if (issues.length > 0) return { ok: false, issues };

  const source = body as Record<string, unknown>;
  const identitySource = source["identity"] as Record<string, unknown>;
  const requestSource = source["request"] as Record<string, unknown>;
  const optionsSource = requestSource["options"] as Record<string, unknown>;

  const roadSpansSource = requestSource["roadSpans"];
  const roadSpans: readonly ProviderRoadSpan[] | undefined = Array.isArray(roadSpansSource)
    ? roadSpansSource.map(toRoadSpan)
    : undefined;
  const sketch = toSketch(requestSource["sketch"]);
  const discoverySource = requestSource["discovery"];

  const request: ProviderRouteRequest = {
    requestId: requestSource["requestId"] as string,
    origin: toCoordinate(requestSource["origin"]),
    destination: toCoordinate(requestSource["destination"]),
    stops: toCoordinateList(requestSource["stops"]),
    shaping: toCoordinateList(requestSource["shaping"]),
    profile: requestSource["profile"] as string,
    avoidPolygons: (requestSource["avoidPolygons"] as readonly unknown[]).map(
      toCoordinateList,
    ),
    // Presence mirrors the wire: a body that carried no span list yields a
    // request with none, rather than fabricating an empty one the caller never
    // sent (the parsed request holds only the contract fields it was given).
    ...(roadSpans === undefined ? {} : { roadSpans }),
    ...(sketch === undefined ? {} : { sketch }),
    ...(isPlainObject(discoverySource)
      ? {
          discovery: {
            targetMinutes: discoverySource["targetMinutes"] as number,
            toleranceMinutes: discoverySource["toleranceMinutes"] as number,
          },
        }
      : {}),
    options: {
      includeAlternatives: optionsSource["includeAlternatives"] as boolean,
      avoidHighways: optionsSource["avoidHighways"] as boolean,
      tollPolicy: optionsSource["tollPolicy"] as ProviderRouteRequest["options"]["tollPolicy"],
      ...(optionsSource["surfacePreference"] === undefined
        ? {}
        : {
            surfacePreference: optionsSource[
              "surfacePreference"
            ] as NonNullable<ProviderRouteRequest["options"]["surfacePreference"]>,
          }),
      ...(optionsSource["roadCharacter"] === undefined
        ? {}
        : {
            roadCharacter: optionsSource[
              "roadCharacter"
            ] as NonNullable<ProviderRouteRequest["options"]["roadCharacter"]>,
          }),
      vehicle: "motorcycle",
    },
  };

  const identity: RoutePlanIdentityWire = {
    rideId: identitySource["rideId"] as string,
    rideRevision: identitySource["rideRevision"] as number,
    planningGeneration: identitySource["planningGeneration"] as number,
  };

  const optionsSourceWire = source["options"];
  const options: RoutePlanOptionsWire | undefined =
    optionsSourceWire === undefined
      ? undefined
      : {
          includeAlternatives: (optionsSourceWire as Record<string, unknown>)[
            "includeAlternatives"
          ] as boolean | undefined,
        };

  return {
    ok: true,
    value: options === undefined ? { identity, request } : { identity, request, options },
  };
}

/** Renders issues as stable `path: message` strings for `details` and logs. */
export function formatValidationIssues(
  issues: readonly ValidationIssue[],
): readonly string[] {
  return issues.map((entry) => `${entry.path}: ${entry.message}`);
}
