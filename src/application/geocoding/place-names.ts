/**
 * The place-name cache: what a dropped pin is near (MVP parity M1, OGV-D-260).
 *
 * A reverse-geocoded name is evidence about a coordinate, not authored intent.
 * Writing it into the RideDocument would be a new revision, and a new revision
 * is the planning fence — the drawn route would go stale and the planner would
 * ask the router again for a ride whose geometry did not change. So the name
 * lives here, keyed by the coordinate at the precision the planner displays
 * (four decimals, ~11 m), and the view model reads it beside the point:
 * `point.label ?? nameFor(point.coordinate) ?? "Dropped pin"`.
 *
 * The cache is bounded, remembers failures briefly so an outage is not hammered,
 * and may be persisted through an injected storage port so a reload keeps the
 * names it already paid for.
 */

import type { Coordinate } from "@/domain/ride/types";
import type { PlaceSearchPort } from "./place-search";

export interface PlaceNameStoragePort {
  load(): Readonly<Record<string, string>>;
  save(entries: Readonly<Record<string, string>>): void;
}

export interface PlaceNameCache {
  /** The resolved name, or `undefined` while unknown, pending or failed. */
  nameFor(coordinate: Coordinate): string | undefined;
  /** Starts a lookup unless the name is known, pending or recently failed. */
  request(coordinate: Coordinate): void;
  /** Change notification; the argument-free listener re-reads `nameFor`. */
  subscribe(listener: () => void): () => void;
  /** Bumped on every change, for `useSyncExternalStore`. */
  version(): number;
}

export interface PlaceNameCacheOptions {
  readonly port: PlaceSearchPort;
  readonly storage?: PlaceNameStoragePort;
  readonly maxEntries?: number;
  /** How long a failed lookup is left alone before it may be retried. */
  readonly retryAfterMs?: number;
  readonly now?: () => number;
}

export const PLACE_NAME_CACHE_LIMIT = 200;
const RETRY_AFTER_MS = 60_000;

/** The cache key: the four-decimal coordinate the planner already shows. */
export function placeNameKey(coordinate: Coordinate): string {
  return `${coordinate.lat.toFixed(4)},${coordinate.lon.toFixed(4)}`;
}

export function createPlaceNameCache(options: PlaceNameCacheOptions): PlaceNameCache {
  const limit = options.maxEntries ?? PLACE_NAME_CACHE_LIMIT;
  const retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
  const now = options.now ?? Date.now;
  const names = new Map<string, string>();
  const pending = new Set<string>();
  const failedAt = new Map<string, number>();
  const listeners = new Set<() => void>();
  let version = 0;

  try {
    for (const [key, name] of Object.entries(options.storage?.load() ?? {})) {
      if (typeof name === "string" && name.length > 0) names.set(key, name);
    }
  } catch {
    // A corrupt or unreadable cache is an empty cache; names are re-derivable.
  }

  function changed(): void {
    version += 1;
    for (const listener of [...listeners]) listener();
  }

  function remember(key: string, name: string): void {
    names.delete(key);
    names.set(key, name);
    while (names.size > limit) {
      const oldest = names.keys().next().value;
      if (oldest === undefined) break;
      names.delete(oldest);
    }
    try {
      options.storage?.save(Object.fromEntries(names));
    } catch {
      // Persistence is a convenience; the in-memory name is still correct.
    }
  }

  return {
    nameFor(coordinate) {
      return names.get(placeNameKey(coordinate));
    },

    request(coordinate) {
      const key = placeNameKey(coordinate);
      if (names.has(key) || pending.has(key)) return;
      const failed = failedAt.get(key);
      if (failed !== undefined && now() - failed < retryAfterMs) return;
      pending.add(key);
      void options.port
        .reverse(coordinate)
        .then((place) => {
          pending.delete(key);
          if (place === null) {
            failedAt.set(key, now());
            return;
          }
          failedAt.delete(key);
          remember(key, place.label);
          changed();
        })
        .catch(() => {
          pending.delete(key);
          failedAt.set(key, now());
        });
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    version: () => version,
  };
}
