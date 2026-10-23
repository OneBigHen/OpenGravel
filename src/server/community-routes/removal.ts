import { createHash, timingSafeEqual } from "node:crypto";

import type { CommunityRouteStore } from "./store";

/**
 * Removal is the sharer's decision, so the share response mints a secret and
 * the store keeps only its hash. Built-in catalog routes have no sharer on this
 * device (their provenance is the route library), so they are never removable
 * here; a rider who does not want to see one hides it locally.
 */
export const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function ownerTokenMatches(expectedHash: string | null, token: string): boolean {
  if (expectedHash === null || !/^[a-f0-9]{64}$/.test(expectedHash) || !OWNER_TOKEN_PATTERN.test(token)) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const supplied = createHash("sha256").update(token).digest();
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export interface RouteRemovalDependencies {
  readonly store: CommunityRouteStore;
  /** True for a built-in catalog route, which exists but has no sharer to prove. */
  readonly catalogRouteExists: (id: string) => boolean;
  readonly now: () => string;
}

export type RouteRemovalOutcome =
  | { readonly status: 200; readonly removed: boolean; readonly name: string; readonly removedAt: string }
  | { readonly status: 400 | 403 | 404; readonly error: string };

/** Decides a removal request; the caller only persists and notifies. */
export function handleRouteRemoval(
  request: { readonly id: string; readonly ownerToken: string; readonly reason: string },
  dependencies: RouteRemovalDependencies,
): RouteRemovalOutcome {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(request.id)) return { status: 400, error: "Invalid route id." };
  const shared = dependencies.store.routes().find((row) => row.id === request.id);
  if (shared === undefined) {
    return dependencies.catalogRouteExists(request.id)
      ? { status: 403, error: "Only the rider who shared a route can remove it. Built-in catalog routes stay on Explore for everyone." }
      : { status: 404, error: "Route not found." };
  }
  if (!ownerTokenMatches(dependencies.store.ownerTokenHash(request.id), request.ownerToken)) {
    return { status: 403, error: "Only the device that shared this route can remove it." };
  }
  const removedAt = dependencies.now();
  const name = typeof shared.raw["name"] === "string" ? shared.raw["name"] : request.id;
  const removed = dependencies.store.remove(request.id, request.reason, removedAt);
  return { status: 200, removed, name, removedAt };
}
