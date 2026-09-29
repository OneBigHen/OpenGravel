/**
 * Large-geometry payloads and their validation (02-ARCHITECTURE-CONTRACT §4).
 *
 * Route geometry, sketch traces, recordings, imported tracks, road entities and
 * avoid areas are *large* values: they are authored or captured once, read many
 * times, and must never be duplicated into `RideDocument` history. The domain
 * therefore carries a `GeometryRef` handle and the bytes live in a
 * `GeometryStore` (see `src/application/geometry/geometry-store.ts`).
 *
 * This module owns the payload shape and the pure validation gate. It is
 * framework-free and store-free: a payload is a plain, structured-clone-safe
 * object, which is what lets the IndexedDB adapter write it unchanged.
 *
 * Two bounds are borrowed from the ride validators rather than re-derived: a
 * coordinate is a finite WGS84 lon/lat, so nothing can enter the store with a
 * `NaN` that would poison every distance and extent computed later.
 */

import type { GeometryRef } from "../ride/ids";
import type { Coordinate } from "../ride/types";
import { validateCoordinate } from "../ride/validate";

/** What a stored payload is for (02-ARCHITECTURE-CONTRACT §4). */
export type GeometryKind =
  | "route"
  | "sketch-stroke"
  | "sketch-corridor"
  | "recording"
  | "import-track"
  | "road-entity"
  | "avoid-area"
  | "road-span";

/** Every kind, for runtime re-checks of untrusted (persisted) values. */
export const GEOMETRY_KINDS: readonly GeometryKind[] = [
  "route",
  "sketch-stroke",
  "sketch-corridor",
  "recording",
  "import-track",
  "road-entity",
  "avoid-area",
  "road-span",
];

/** An ordered trace: at least two positions. */
export interface LineGeometry {
  readonly kind: "line";
  readonly coordinates: readonly Coordinate[];
}

/** Polygon rings; the outer ring is first, and every ring is closed. */
export interface PolygonGeometry {
  readonly kind: "polygon";
  readonly rings: readonly (readonly Coordinate[])[];
}

/** A payload the store can hold. Only plain data — no class instances. */
export type GeometryPayload = LineGeometry | PolygonGeometry;

/**
 * One stored geometry value: the handle, what it is, the payload, the payload's
 * size, and when it was written. `pointCount` is denormalized so a consumer can
 * size or filter a payload without deserializing it.
 */
export interface GeometryRecord {
  readonly geometryRef: GeometryRef;
  readonly kind: GeometryKind;
  readonly payload: GeometryPayload;
  readonly pointCount: number;
  readonly createdAt: string;
}

/** Payload discriminants, for re-checking an untrusted `kind`. */
const PAYLOAD_KINDS: readonly string[] = ["line", "polygon"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinateShaped(value: unknown): value is Coordinate {
  return (
    isRecord(value) &&
    typeof value["lon"] === "number" &&
    typeof value["lat"] === "number"
  );
}

/**
 * Bounds for one coordinate slot. A malformed coordinate is reported, never
 * dereferenced, so a persisted payload from an older writer cannot crash
 * validation.
 */
function coordinateIssuesAt(path: string, value: unknown): string[] {
  if (!isCoordinateShaped(value)) {
    return [`${path} must be a coordinate with numeric lon and lat`];
  }
  return validateCoordinate(value).map((issue) => `${path}: ${issue}`);
}

function lineIssues(payload: Record<string, unknown>): string[] {
  const coordinates = payload["coordinates"];
  if (!Array.isArray(coordinates)) {
    return ["line coordinates must be an array of coordinates"];
  }

  const issues: string[] = [];
  if (coordinates.length < 2) {
    issues.push(
      `line coordinates must hold at least 2 points, received ${coordinates.length}`,
    );
  }
  coordinates.forEach((value, index) => {
    issues.push(...coordinateIssuesAt(`coordinates[${index}]`, value));
  });
  return issues;
}

function ringIssues(ring: unknown, path: string): string[] {
  if (!Array.isArray(ring)) {
    return [`${path} must be an array of coordinates`];
  }

  const issues: string[] = [];
  if (ring.length < 3) {
    issues.push(
      `${path} must hold at least 3 points, received ${ring.length}`,
    );
  }
  ring.forEach((value, index) => {
    issues.push(...coordinateIssuesAt(`${path}[${index}]`, value));
  });

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length >= 2 &&
    isCoordinateShaped(first) &&
    isCoordinateShaped(last) &&
    (first.lon !== last.lon || first.lat !== last.lat)
  ) {
    issues.push(`${path} must be closed: the last point must repeat the first`);
  }
  return issues;
}

function polygonIssues(payload: Record<string, unknown>): string[] {
  const rings = payload["rings"];
  if (!Array.isArray(rings) || rings.length === 0) {
    return ["polygon rings must hold at least one ring, outer ring first"];
  }
  return rings.flatMap((ring, index) =>
    ringIssues(ring, `rings[${index}].coordinates`),
  );
}

/**
 * Every reason `payload` cannot be stored, or an empty list when it can.
 *
 * Pure and total: it never throws and never repairs. Input is treated as
 * untrusted, so an unknown discriminant, a missing array or a malformed
 * coordinate is an issue rather than a crash — a payload read back from
 * IndexedDB or an import is not proof of the type it claims.
 */
export function validateGeometryPayload(payload: GeometryPayload): string[] {
  const candidate: unknown = payload;
  if (!isRecord(candidate)) {
    return ["geometry payload must be a plain object"];
  }

  const kind = candidate["kind"];
  if (typeof kind !== "string" || !PAYLOAD_KINDS.includes(kind)) {
    return [
      `geometry kind "${String(kind)}" is not a known payload kind`,
    ];
  }
  return kind === "line" ? lineIssues(candidate) : polygonIssues(candidate);
}

/**
 * How many coordinates the payload holds. A polygon counts the closing
 * duplicate too, because that is what the store keeps and what a consumer
 * deserializing the ring will iterate.
 */
export function countGeometryPoints(payload: GeometryPayload): number {
  return payload.kind === "line"
    ? payload.coordinates.length
    : payload.rings.reduce((total, ring) => total + ring.length, 0);
}
