"use client";

import { useSyncExternalStore } from "react";

import type { Coordinate } from "@/domain/ride/types";

/**
 * The point the rider is scrubbing on the elevation profile (UX rework phase 3).
 *
 * Presentation state shared by two surfaces that do not own each other — the
 * profile in the result panel and the map in the page frame — so it lives in a
 * tiny external store rather than in either one, and never in a ride authority.
 */
let current: Coordinate | null = null;
const listeners = new Set<() => void>();

export function setRouteScrub(next: Coordinate | null): void {
  if (next === current || (next !== null && current !== null && next.lon === current.lon && next.lat === current.lat)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRouteScrub(): Coordinate | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
