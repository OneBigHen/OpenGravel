/**
 * The places overlay controller: viewport in, places out, without hammering the
 * provider while a rider pans.
 *
 * - Viewports are **snapped outward to a 0.05° grid**, so small pans and zooms
 *   inside the same cells reuse one answer (and one cache key upstream).
 * - Changes are **debounced**; a newer viewport aborts the request in flight and
 *   a late answer for an old viewport is dropped.
 * - Answers are cached for `ttlMs` per (cells, query).
 * - A viewport larger than the provider allows is **not requested**; the state
 *   says `zoom-in` so the UI can say so instead of showing an empty map.
 *
 * Framework-free: timers and the clock are injected, so tests drive it
 * synchronously and a React hook is a thin subscription on top.
 */

import { MAX_PLACE_EXTENT_DEGREES, type PlacesSource } from "./places-source";
import type { NearbyPlace, PlaceExtent, PlaceQuery } from "./types";

export type PlacesOverlayStatus = "idle" | "loading" | "ready" | "zoom-in" | "unavailable";

export interface PlacesOverlayState {
  readonly status: PlacesOverlayStatus;
  readonly places: readonly NearbyPlace[];
  /** The snapped extent the places answer, or `null`. */
  readonly extent: PlaceExtent | null;
  readonly reason: string | null;
  readonly attribution: string | null;
  /** Generation time for the places currently shown, never the time of a new request. */
  readonly fetchedAt: string | null;
}

export interface PlacesOverlayDeps {
  readonly source: PlacesSource;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly debounceMs?: number;
  readonly ttlMs?: number;
  readonly maxCacheEntries?: number;
}

export interface PlacesOverlay {
  viewportChanged(extent: PlaceExtent): void;
  setQuery(query: PlaceQuery): void;
  getState(): PlacesOverlayState;
  subscribe(listener: (state: PlacesOverlayState) => void): () => void;
  dispose(): void;
}

const GRID = 0.05;
const IDLE: PlacesOverlayState = { status: "idle", places: [], extent: null, reason: null, attribution: null, fetchedAt: null };

export function snapExtent(extent: PlaceExtent): PlaceExtent {
  const round = (value: number) => Number(value.toFixed(4));
  return {
    west: round(Math.floor(extent.west / GRID) * GRID),
    south: round(Math.floor(extent.south / GRID) * GRID),
    east: round(Math.ceil(extent.east / GRID) * GRID),
    north: round(Math.ceil(extent.north / GRID) * GRID),
  };
}

export function extentTooLarge(extent: PlaceExtent): boolean {
  return extent.east - extent.west > MAX_PLACE_EXTENT_DEGREES
    || extent.north - extent.south > MAX_PLACE_EXTENT_DEGREES;
}

function keyOf(extent: PlaceExtent, query: PlaceQuery): string {
  return `${extent.west},${extent.south},${extent.east},${extent.north}|${[...query.kinds].sort().join(",")}|${query.window}`;
}

export function createPlacesOverlay(initialQuery: PlaceQuery, deps: PlacesOverlayDeps): PlacesOverlay {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? 350;
  const ttlMs = deps.ttlMs ?? 60_000;
  const maxEntries = deps.maxCacheEntries ?? 32;

  const cache = new Map<string, { readonly state: PlacesOverlayState; readonly expiresAt: number }>();
  const listeners = new Set<(state: PlacesOverlayState) => void>();
  let query = initialQuery;
  let state: PlacesOverlayState = IDLE;
  let lastExtent: PlaceExtent | null = null;
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  let generation = 0;
  let disposed = false;

  function publish(next: PlacesOverlayState): void {
    state = next;
    for (const listener of listeners) listener(state);
  }

  async function load(extent: PlaceExtent): Promise<void> {
    const snapped = snapExtent(extent);
    if (extentTooLarge(snapped)) {
      inFlight?.abort();
      publish({ status: "zoom-in", places: [], extent: null, reason: "Zoom in to see places.", attribution: null, fetchedAt: null });
      return;
    }
    const key = keyOf(snapped, query);
    const hit = cache.get(key);
    if (hit !== undefined && hit.expiresAt > now()) {
      if (hit.state !== state) publish(hit.state);
      return;
    }
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const mine = ++generation;
    // keep showing the last places while the next answer loads (no flicker)
    publish({ ...state, status: "loading" });
    let next: PlacesOverlayState;
    try {
      const result = await deps.source.inExtent(snapped, query, controller.signal);
      next = result.availability === "available"
        ? { status: "ready", places: result.places, extent: snapped, reason: null, attribution: result.attribution, fetchedAt: result.fetchedAt }
        : { status: "unavailable", places: [], extent: snapped, reason: result.reason, attribution: null, fetchedAt: null };
    } catch {
      if (controller.signal.aborted) return;
      next = { status: "unavailable", places: [], extent: snapped, reason: "Places are unavailable right now.", attribution: null, fetchedAt: null };
    }
    if (disposed || mine !== generation) return;
    inFlight = null;
    if (next.status === "ready") {
      cache.set(key, { state: next, expiresAt: now() + ttlMs });
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
    publish(next);
  }

  function schedule(): void {
    if (disposed || lastExtent === null) return;
    if (timer !== null) clearTimer(timer);
    const extent = lastExtent;
    timer = setTimer(() => {
      timer = null;
      void load(extent);
    }, debounceMs);
  }

  return {
    viewportChanged(extent) {
      lastExtent = extent;
      schedule();
    },
    setQuery(next) {
      query = next;
      schedule();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      inFlight?.abort();
      listeners.clear();
    },
  };
}
