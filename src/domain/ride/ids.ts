/**
 * Stable branded identifiers for editable domain objects (03-DOMAIN-MODEL §1).
 *
 * Every editable object has a stable ID, and array position is never identity.
 * The string brand makes a bare `string` unusable where an ID is required, so a
 * label, a counter, or a coordinate can never flow into an ID slot unnoticed.
 *
 * Two rules keep this module honest:
 * - `new*` factories mint IDs for objects that are being *created*;
 * - `as*` helpers only narrow an identifier that another authority already
 *   minted (road graph, persisted geometry handle). Nothing here fabricates an
 *   ID for an entity that already exists.
 *
 * The GeometryStore is the one authority that mints `GeometryRef`s: it calls
 * `newGeometryRef()` when a payload is written, and consumers only ever receive
 * the handle through a stored record.
 */

export type RideId = string & { readonly __brand: "RideId" };
export type CommandId = string & { readonly __brand: "CommandId" };
export type PointId = string & { readonly __brand: "PointId" };
export type StopId = string & { readonly __brand: "StopId" };
export type ShapingId = string & { readonly __brand: "ShapingId" };
export type AvoidAreaId = string & { readonly __brand: "AvoidAreaId" };
export type RoadSpanId = string & { readonly __brand: "RoadSpanId" };
export type SketchId = string & { readonly __brand: "SketchId" };
export type RideHistoryEntryId = string & { readonly __brand: "RideHistoryEntryId" };

/** Opaque handle to geometry owned by the GeometryStore, never raw coordinates. */
export type GeometryRef = string & { readonly __brand: "GeometryRef" };

/** Road identity owned by road intelligence (03-DOMAIN-MODEL §20). */
export type RoadEntityId = string & { readonly __brand: "RoadEntityId" };

/** Branded-ID constructor. Private: each factory names its own prefix. */
function mintId<T extends string>(prefix: string): T {
  return `${prefix}${crypto.randomUUID()}` as T;
}

/** `ride_…` — one authored ride document. */
export function newRideId(): RideId {
  return mintId<RideId>("ride_");
}

/** `cmd_…` — one rider or advisor command submission. */
export function newCommandId(): CommandId {
  return mintId<CommandId>("cmd_");
}

/** `pt_…` — a start or finish endpoint (03-DOMAIN-MODEL §4). */
export function newPointId(): PointId {
  return mintId<PointId>("pt_");
}

/** `stop_…` — an itinerary stop. */
export function newStopId(): StopId {
  return mintId<StopId>("stop_");
}

/** `shape_…` — a shaping anchor. */
export function newShapingId(): ShapingId {
  return mintId<ShapingId>("shape_");
}

/** `avoid_…` — an avoid area. */
export function newAvoidAreaId(): AvoidAreaId {
  return mintId<AvoidAreaId>("avoid_");
}

/** `span_…` — a road-span constraint. */
export function newRoadSpanId(): RoadSpanId {
  return mintId<RoadSpanId>("span_");
}

/** `sketch_…` — one committed sketch (03-DOMAIN-MODEL §13). */
export function newSketchId(): SketchId {
  return mintId<SketchId>("sketch_");
}

/**
 * Narrows an existing sketch identity (a persisted document, a recovered draft).
 * Minting goes through `newSketchId`; nothing else may fabricate one.
 */
export function asSketchId(value: string): SketchId {
  return value as SketchId;
}

/** `hist_…` — one logical undo/redo history entry. */
export function newHistoryEntryId(): RideHistoryEntryId {
  return mintId<RideHistoryEntryId>("hist_");
}

/**
 * `geo_…` — one stored geometry payload (02-ARCHITECTURE-CONTRACT §4). Only the
 * GeometryStore mints these: a `put` always returns a new handle, so an
 * existing reference is never rewritten in place.
 */
export function newGeometryRef(): GeometryRef {
  return mintId<GeometryRef>("geo_");
}

/**
 * Narrows an existing GeometryStore handle (for example one read back from
 * persisted data). Minting goes through `newGeometryRef`; the domain only ever
 * carries the reference.
 */
export function asGeometryRef(value: string): GeometryRef {
  return value as GeometryRef;
}

/** Narrows an existing road-graph identity; road intelligence mints it. */
export function asRoadEntityId(value: string): RoadEntityId {
  return value as RoadEntityId;
}

/**
 * Narrows an existing road-span identity. Minting goes through
 * `newRoadSpanId`; a caller that already holds a span id (a request that crossed
 * the wire, a persisted document) only ever narrows it.
 */
export function asRoadSpanId(value: string): RoadSpanId {
  return value as RoadSpanId;
}
