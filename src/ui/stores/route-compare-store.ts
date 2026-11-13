"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the rider is comparing rides in the sheet (PF-8).
 *
 * Presentation state shared by the sheet's Compare view and the map in the
 * page frame, which do not own each other, so it lives in a tiny external
 * store like the elevation scrub point. While it is on, the map lifts the
 * other choices out of their dimmed look so each line can be told apart.
 */
let current = false;
const listeners = new Set<() => void>();

export function setRouteComparing(next: boolean): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRouteComparing(): boolean {
  return useSyncExternalStore(subscribe, () => current, () => false);
}
