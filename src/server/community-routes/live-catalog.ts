import { parseCatalogEntries, type CatalogEntry } from "@/application/explore/catalog";
import { serverCatalogEntries } from "@/server/explore/catalog-data";

import { sharedCommunityRouteStore } from "./store";

let cache: { readonly version: string; readonly entries: readonly CatalogEntry[] } | undefined;

/**
 * The catalog riders see now: the built-in routes minus any a rider removed,
 * plus the routes riders shared. Rebuilt only when a share or removal happened.
 */
export function liveCatalogEntries(): readonly CatalogEntry[] {
  const store = sharedCommunityRouteStore();
  const version = store.version();
  if (cache?.version === version) return cache.entries;
  const removed = store.removedIds();
  const shared = parseCatalogEntries(store.routes().map((row) => row.raw));
  const entries = [...serverCatalogEntries, ...shared].filter((entry) => !removed.has(entry.id));
  cache = { version, entries };
  return entries;
}

/** A route that exists, hidden or not (removal and restore need both). */
export function knownRouteName(id: string): string | null {
  const store = sharedCommunityRouteStore();
  const shared = store.routes().find((row) => row.id === id);
  if (shared !== undefined) return typeof shared.raw["name"] === "string" ? shared.raw["name"] : id;
  return serverCatalogEntries.find((entry) => entry.id === id)?.name ?? null;
}
