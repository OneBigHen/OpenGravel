/**
 * Stable branded identities for the route domain (03-DOMAIN-MODEL §1, §14–§15).
 *
 * These brands follow the same rule as `src/domain/ride/ids.ts`: an ID is a
 * string that a bare `string` cannot substitute for, `new*` factories mint
 * identities for objects being created, and `as*` helpers only narrow an
 * identifier another authority already minted.
 *
 * This module is also the single owner of span identity (`RouteSpanRef`):
 * 03-DOMAIN-MODEL §18 named the brand in the evidence module while the route
 * model did not exist yet. Evidence imports it from here now (OGV-D-141), and
 * `src/domain/evidence/types.ts` re-exports it so existing call sites keep
 * working.
 */

export type RouteCandidateId = string & { readonly __brand: "RouteCandidateId" };

/**
 * Opaque reference to a road span owned by road intelligence. Evidence values
 * use it as a scope (`appliesTo`), and route constraints use it to name the
 * road a span refers to.
 */
export type RouteSpanRef = string & { readonly __brand: "RouteSpanRef" };

/**
 * Opaque handle to a stored non-geometry blob (03-DOMAIN-MODEL §14 names
 * `BlobRef` for candidate instructions). The blob store is a later task, so
 * this module owns the brand while nothing mints one yet: only `asBlobRef`
 * narrows a handle that store already wrote.
 */
export type BlobRef = string & { readonly __brand: "BlobRef" };

/** Branded-ID constructor. Private: each factory names its own prefix. */
function mintId<T extends string>(prefix: string): T {
  return `${prefix}${crypto.randomUUID()}` as T;
}

/** `route_…` — one candidate route produced by the planning pipeline. */
export function newRouteCandidateId(): RouteCandidateId {
  return mintId<RouteCandidateId>("route_");
}

/** Narrows an existing route-candidate identity (for example one read back). */
export function asRouteCandidateId(value: string): RouteCandidateId {
  return value as RouteCandidateId;
}

/** Narrows an existing road-span identity; road intelligence mints it. */
export function asRouteSpanRef(value: string): RouteSpanRef {
  return value as RouteSpanRef;
}

/** Narrows an existing blob handle; the blob store mints it. */
export function asBlobRef(value: string): BlobRef {
  return value as BlobRef;
}
