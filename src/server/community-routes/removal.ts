import { createHash, timingSafeEqual } from "node:crypto";

import type { CommunityRouteRow, CommunityRouteStore } from "./store";

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
  const found = sharedRouteFor(request.id, dependencies);
  if (!found.ok) return found.outcome;
  if (!ownerTokenMatches(dependencies.store.ownerTokenHash(request.id), request.ownerToken)) {
    return { status: 403, error: "Only the device that shared this route can remove it." };
  }
  return takeDown(found.row, request.reason, dependencies);
}

/**
 * An operator takedown needs no owner secret: a browser that cleared its data,
 * or an uploader who would rather keep their own route up, cannot be the only
 * way an abusive or badly wrong route leaves Explore. The caller proves the
 * operator token first.
 */
export function handleOperatorTakedown(
  request: { readonly id: string; readonly reason: string },
  dependencies: RouteRemovalDependencies,
): RouteRemovalOutcome {
  const found = sharedRouteFor(request.id, dependencies);
  return found.ok ? takeDown(found.row, request.reason, dependencies) : found.outcome;
}

type SharedRouteLookup =
  | { readonly ok: true; readonly row: CommunityRouteRow }
  | { readonly ok: false; readonly outcome: RouteRemovalOutcome };

function sharedRouteFor(id: string, dependencies: RouteRemovalDependencies): SharedRouteLookup {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return { ok: false, outcome: { status: 400, error: "Invalid route id." } };
  const row = dependencies.store.routes().find((candidate) => candidate.id === id);
  if (row !== undefined) return { ok: true, row };
  return {
    ok: false,
    outcome: dependencies.catalogRouteExists(id)
      ? { status: 403, error: "That route is part of the built-in catalog; a takedown only covers routes riders shared." }
      : { status: 404, error: "Route not found." },
  };
}

function takeDown(
  shared: CommunityRouteRow,
  reason: string,
  dependencies: RouteRemovalDependencies,
): RouteRemovalOutcome {
  const removedAt = dependencies.now();
  const name = typeof shared.raw["name"] === "string" ? shared.raw["name"] : shared.id;
  const removed = dependencies.store.remove(shared.id, reason, removedAt);
  return { status: 200, removed, name, removedAt };
}
