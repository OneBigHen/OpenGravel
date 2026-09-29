/**
 * Pure validation for authored ride state (03-DOMAIN-MODEL §2–§13).
 *
 * Validation reports issues; it never throws and never repairs. It also never
 * invents a requirement the domain model does not state: a destination ride
 * without a finish, or an empty ride, is valid authored state — only the
 * documented contracts are checked here. Inputs are treated as untrusted
 * (imports, persisted documents), so enum-shaped fields, nested coordinates,
 * numeric finiteness, id prefixes and discriminants are re-checked at runtime.
 */

import {
  SKETCH_TOPOLOGY_HINT_KINDS,
  type SketchEndpointPolicy,
} from "../sketch/types";
import type { Coordinate, RideIntent, RideProvenance, SurfaceIntent, TimeIntent } from "./types";

/** Validate the small provenance envelope at persistence and import boundaries. */
export function isRideProvenance(value: unknown): value is RideProvenance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const provenance = value as Record<string, unknown>;
  const types = ["new", "import", "catalog", "shared", "recorded", "recreated-from-track", "derived"];
  if (typeof provenance.type !== "string" || !types.includes(provenance.type)) return false;
  if (provenance.sourceId !== undefined && typeof provenance.sourceId !== "string") return false;
  if (provenance.source !== undefined && (
    provenance.type !== "import" ||
    provenance.source !== "SwitchBack" ||
    typeof provenance.sourceId !== "string" ||
    provenance.sourceId.length === 0
  )) return false;
  return true;
}

const SURFACE_PREFERENCES: readonly SurfaceIntent["preference"][] = [
  "pavement",
  "mostly-pavement",
  "mixed",
  "dirt-preferred",
];

const UNKNOWN_SURFACE_POLICIES: readonly SurfaceIntent["unknownSurfacePolicy"][] = [
  "allow-with-warning",
  "avoid-when-possible",
];

const RIDE_SHAPES: readonly RideIntent["shape"][] = [
  "destination",
  "loop",
  "open",
];

const ROAD_CHARACTERS: readonly RideIntent["roadCharacter"][] = [
  "efficient",
  "balanced",
  "curvy",
  "backroads",
];

const TERRAIN_LEVELS: readonly RideIntent["terrain"]["level"][] = [
  "known-easy-only",
  "moderate",
  "any-supported",
];

const TRAFFIC_PREFERENCES: readonly RideIntent["traffic"][] = [
  "protect-ride",
  "minimize-delay",
];

const TOLL_POLICIES: readonly RideIntent["tollPolicy"][] = [
  "avoid",
  "allow-with-warning",
];

const DEPARTURE_KINDS: readonly RideIntent["departure"]["kind"][] = [
  "now",
  "future",
];

const SKETCH_ENDPOINT_POLICIES: readonly SketchEndpointPolicy[] = [
  "derive",
  "preserve-existing",
];

const TIME_INTENT_KINDS: ReadonlySet<string> = new Set([
  "none",
  "budget",
  "returnBy",
  "arriveBy",
]);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real `YYYY-MM-DD` calendar day (rejects `2026-13-40`/`2026-02-30`). */
function isCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

function isFiniteInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** True for a finite number at or above `min`. */
function isFiniteAtLeast(value: number, min: number): boolean {
  return Number.isFinite(value) && value >= min;
}

/**
 * Bounds issues for one coordinate. With a `fieldPath` the message is anchored
 * to the intent slot (`start.coordinate.lat`); without one it is the bare
 * `validateCoordinate` message. Both paths use the same WGS84 bounds.
 */
function coordinateIssuesAt(
  fieldPath: string | null,
  coordinate: Coordinate,
): string[] {
  const issues: string[] = [];
  const lonAnchor = fieldPath === null ? "" : `${fieldPath}.lon: `;
  const latAnchor = fieldPath === null ? "" : `${fieldPath}.lat: `;
  if (!isFiniteInRange(coordinate.lon, -180, 180)) {
    issues.push(
      `${lonAnchor}longitude ${coordinate.lon} must be a finite number in [-180, 180]`,
    );
  }
  if (!isFiniteInRange(coordinate.lat, -90, 90)) {
    issues.push(
      `${latAnchor}latitude ${coordinate.lat} must be a finite number in [-90, 90]`,
    );
  }
  return issues;
}

/** Finite lon/lat inside the WGS84 bounds. */
export function validateCoordinate(coordinate: Coordinate): string[] {
  return coordinateIssuesAt(null, coordinate);
}

/** Validate a bike snapshot arriving through an authored ride command. */
export function validateBikeConstraintSnapshot(bike: unknown): string[] {
  const issues: string[] = [];
  if (typeof bike !== "object" || bike === null || Array.isArray(bike)) {
    return ["bike snapshot must be an object"];
  }
  const value = bike as Record<string, unknown>;
  if (typeof value.bikeId !== "string" || value.bikeId.trim().length === 0) {
    issues.push("bikeId must be a non-empty string");
  }
  if (typeof value.category !== "string" || !["street", "touring", "adventure", "dual-sport"].includes(value.category)) {
    issues.push(`bike category "${String(value.category)}" is not known`);
  }
  const fuelRangeMiles = value.fuelRangeMiles;
  const reserveMiles = value.reserveMiles;
  if (typeof fuelRangeMiles !== "number" || !Number.isFinite(fuelRangeMiles) || fuelRangeMiles < 20 || fuelRangeMiles > 600) {
    issues.push("fuelRangeMiles must be between 20 and 600");
  }
  if (typeof reserveMiles !== "number" || !Number.isFinite(reserveMiles) || reserveMiles < 0 || reserveMiles > 100) {
    issues.push("reserveMiles must be between 0 and 100");
  } else if (typeof fuelRangeMiles === "number" && Number.isFinite(fuelRangeMiles) && reserveMiles >= fuelRangeMiles) {
    issues.push("reserveMiles must be less than fuelRangeMiles");
  }
  if (typeof value.maintainedGravel !== "string" || !["allow", "avoid"].includes(value.maintainedGravel)) {
    issues.push(`maintainedGravel "${String(value.maintainedGravel)}" is not known`);
  }
  if (typeof value.roughTracks !== "string" || !["allow", "avoid"].includes(value.roughTracks)) {
    issues.push(`roughTracks "${String(value.roughTracks)}" is not known`);
  }
  if (typeof value.unknownSurface !== "string" || !["allow-with-warning", "avoid-when-possible"].includes(value.unknownSurface)) {
    issues.push(`unknownSurface "${String(value.unknownSurface)}" is not known`);
  }
  if (value.custom !== undefined) {
    if (typeof value.custom !== "object" || value.custom === null || Array.isArray(value.custom)) {
      issues.push("custom bike values must be an object");
    } else if (Object.values(value.custom).some((entry) =>
      !(typeof entry === "boolean" || typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry))),
    )) {
      issues.push("custom bike values must be booleans, finite numbers, or strings");
    }
  }
  return issues;
}

/** One discriminant issue, or `null` when `value` is a known member. */
function discriminantIssue(
  field: string,
  value: string,
  allowed: readonly string[],
): string | null {
  return allowed.includes(value)
    ? null
    : `${field} "${value}" is not one of: ${allowed.join(", ")}`;
}

/** One branded-id prefix issue, or `null` when the prefix is right. */
function idPrefixIssue(field: string, id: string, prefix: string): string | null {
  return id.startsWith(prefix)
    ? null
    : `${field} "${id}" must start with "${prefix}"`;
}

/** A positive budget target, a real date, a 24h clock time, a finite tolerance. */
export function validateTimeIntent(time: TimeIntent): string[] {
  if (!TIME_INTENT_KINDS.has(time.kind)) {
    return [
      `time kind "${time.kind}" is not a known time intent`,
    ];
  }
  switch (time.kind) {
    case "none":
      return [];
    case "budget": {
      const issues: string[] = [];
      if (!(Number.isFinite(time.targetMinutes) && time.targetMinutes > 0)) {
        issues.push(
          `budget targetMinutes ${time.targetMinutes} must be a finite number greater than 0`,
        );
      }
      if (!isFiniteAtLeast(time.toleranceMinutes, 0)) {
        issues.push(
          `budget toleranceMinutes ${time.toleranceMinutes} must be a finite number 0 or greater`,
        );
      }
      return issues;
    }
    case "returnBy":
    case "arriveBy": {
      const issues: string[] = [];
      if (!isCalendarDate(time.date)) {
        issues.push(`${time.kind} date "${time.date}" must be a valid YYYY-MM-DD date`);
      }
      if (!CLOCK_TIME_PATTERN.test(time.localTime)) {
        issues.push(
          `${time.kind} localTime "${time.localTime}" must be a 24-hour HH:MM time`,
        );
      }
      if (!isFiniteAtLeast(time.toleranceMinutes, 0)) {
        issues.push(
          `${time.kind} toleranceMinutes ${time.toleranceMinutes} must be a finite number 0 or greater`,
        );
      }
      return issues;
    }
    default:
      return ["time kind is not a known time intent"];
  }
}

/** One unpaved-share envelope: each bound in [0, 1], min ≤ max, target inside it. */
function unpavedShareIssues(
  share: NonNullable<SurfaceIntent["targetUnpavedShare"]>,
): string[] {
  const issues: string[] = [];
  const bounds: readonly (readonly [string, number | undefined])[] = [
    ["min", share.min],
    ["target", share.target],
    ["max", share.max],
  ];
  for (const [field, value] of bounds) {
    if (value === undefined) continue;
    if (!isFiniteInRange(value, 0, 1)) {
      issues.push(`unpaved share ${field} ${value} must be a number in [0, 1]`);
    }
  }
  if (share.min !== undefined && share.max !== undefined && share.min > share.max) {
    issues.push(`unpaved share min ${share.min} must not exceed max ${share.max}`);
  }
  if (share.target !== undefined) {
    if (share.min !== undefined && share.target < share.min) {
      issues.push(
        `unpaved share target ${share.target} must be within [${share.min}, ${share.max ?? 1}]`,
      );
    }
    if (share.max !== undefined && share.target > share.max) {
      issues.push(
        `unpaved share target ${share.target} must be within [${share.min ?? 0}, ${share.max}]`,
      );
    }
  }
  return issues;
}

/** Surface preference, unknown-surface policy, and the unpaved-share envelope. */
export function validateSurfaceIntent(surface: SurfaceIntent): string[] {
  const issues: string[] = [];
  if (!SURFACE_PREFERENCES.includes(surface.preference)) {
    issues.push(`surface preference "${surface.preference}" is not a known preference`);
  }
  if (!UNKNOWN_SURFACE_POLICIES.includes(surface.unknownSurfacePolicy)) {
    issues.push(
      `unknownSurfacePolicy "${surface.unknownSurfacePolicy}" is not a known policy`,
    );
  }

  const share = surface.targetUnpavedShare;
  return share === undefined ? issues : [...issues, ...unpavedShareIssues(share)];
}

function duplicateIdIssues(label: string, ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const issues: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    if (reported.has(id)) continue;
    reported.add(id);
    issues.push(`duplicate ${label} id "${id}"`);
  }
  return issues;
}

/** Point discriminant plus its nested coordinate, anchored to the slot path. */
function pointIssues(
  fieldPath: string,
  kind: string,
  expectedKind: string,
  coordinate: Coordinate,
): string[] {
  const issues: string[] = [];
  if (kind !== expectedKind) {
    issues.push(`${fieldPath}.kind "${kind}" must be "${expectedKind}"`);
  }
  issues.push(...coordinateIssuesAt(`${fieldPath}.coordinate`, coordinate));
  return issues;
}

/**
 * The sketch's own issues (03 §13): its endpoint policy discriminant, the hint
 * kinds a persisted document may carry, each hint's coordinate, and the shape of
 * the raw-trace references. A committed sketch with no raw stroke is reported
 * rather than accepted: the raw trace is the authority a retry re-derives from
 * (04 §19), so a sketch without one is a corridor nothing can be re-derived from.
 */
function sketchIssues(sketch: RideIntent["sketch"]): string[] {
  if (sketch === null) return [];
  const issues: string[] = [];
  const prefixIssue = idPrefixIssue("sketch.id", sketch.id, "sketch_");
  if (prefixIssue !== null) issues.push(prefixIssue);
  const policyIssue = discriminantIssue(
    "sketch.endpointPolicy",
    sketch.endpointPolicy,
    SKETCH_ENDPOINT_POLICIES,
  );
  if (policyIssue !== null) issues.push(policyIssue);
  if (sketch.rawStrokeRefs.length === 0) {
    issues.push("sketch.rawStrokeRefs must hold the trace the sketch was drawn from");
  }
  sketch.rawStrokeRefs.forEach((ref, index) => {
    if (typeof ref !== "string" || ref.length === 0) {
      issues.push(`sketch.rawStrokeRefs[${index}] must be a non-empty geometry ref`);
    }
  });
  sketch.topologyHints.forEach((hint, index) => {
    const fieldPath = `sketch.topologyHints[${index}]`;
    const kindIssue = discriminantIssue(
      `${fieldPath}.kind`,
      hint.kind,
      SKETCH_TOPOLOGY_HINT_KINDS,
    );
    if (kindIssue !== null) issues.push(kindIssue);
    issues.push(...coordinateIssuesAt(`${fieldPath}.at`, hint.at));
    hint.strokeIndices?.forEach((strokeIndex, position) => {
      if (!Number.isInteger(strokeIndex) || strokeIndex < 0) {
        issues.push(
          `${fieldPath}.strokeIndices[${position}] must be a non-negative integer`,
        );
      }
    });
  });
  return issues;
}

/**
 * Aggregated authoring issues for one intent: time, surface, every documented
 * discriminant, nested coordinates (start/finish/stops/shaping and road-span
 * anchors), branded-id prefixes, and duplicate identities inside each
 * id-bearing collection (§1 — array index is not identity). An empty list means
 * the intent is valid authored state.
 */
export function validateRideIntent(intent: RideIntent): string[] {
  const issues: string[] = [
    ...validateTimeIntent(intent.time),
    ...validateSurfaceIntent(intent.surface),
  ];

  const discriminants: readonly (readonly [string, string, readonly string[]])[] = [
    ["shape", intent.shape, RIDE_SHAPES],
    ["roadCharacter", intent.roadCharacter, ROAD_CHARACTERS],
    ["terrain.level", intent.terrain.level, TERRAIN_LEVELS],
    ["traffic", intent.traffic, TRAFFIC_PREFERENCES],
    ["tollPolicy", intent.tollPolicy, TOLL_POLICIES],
    ["departure.kind", intent.departure.kind, DEPARTURE_KINDS],
  ];
  for (const [field, value, allowed] of discriminants) {
    const issue = discriminantIssue(field, value, allowed);
    if (issue !== null) issues.push(issue);
  }

  if (intent.start !== null) {
    issues.push(
      ...pointIssues("start", intent.start.kind, "start", intent.start.coordinate),
    );
  }
  if (intent.finish !== null) {
    issues.push(
      ...pointIssues("finish", intent.finish.kind, "finish", intent.finish.coordinate),
    );
  }

  intent.stops.forEach((stop, index) => {
    const fieldPath = `stops[${index}]`;
    issues.push(...pointIssues(fieldPath, stop.kind, "stop", stop.coordinate));
    const prefixIssue = idPrefixIssue(`${fieldPath}.id`, stop.id, "stop_");
    if (prefixIssue !== null) issues.push(prefixIssue);
  });

  intent.shaping.forEach((point, index) => {
    const fieldPath = `shaping[${index}]`;
    issues.push(...pointIssues(fieldPath, point.kind, "shape", point.coordinate));
    const prefixIssue = idPrefixIssue(`${fieldPath}.id`, point.id, "shape_");
    if (prefixIssue !== null) issues.push(prefixIssue);
  });

  intent.avoidAreas.forEach((area, index) => {
    const prefixIssue = idPrefixIssue(`avoidAreas[${index}].id`, area.id, "avoid_");
    if (prefixIssue !== null) issues.push(prefixIssue);
  });

  intent.roadSpans.forEach((span, index) => {
    const prefixIssue = idPrefixIssue(`roadSpans[${index}].id`, span.id, "span_");
    if (prefixIssue !== null) issues.push(prefixIssue);
    span.anchorRefs.forEach((anchor, anchorIndex) => {
      issues.push(
        ...coordinateIssuesAt(
          `roadSpans[${index}].anchorRefs[${anchorIndex}]`,
          anchor,
        ),
      );
    });
  });

  issues.push(
    ...duplicateIdIssues("stop", intent.stops.map((stop) => stop.id)),
    ...duplicateIdIssues("shaping point", intent.shaping.map((point) => point.id)),
    ...duplicateIdIssues("avoid area", intent.avoidAreas.map((area) => area.id)),
    ...duplicateIdIssues("road span", intent.roadSpans.map((span) => span.id)),
    ...sketchIssues(intent.sketch),
  );
  return issues;
}
