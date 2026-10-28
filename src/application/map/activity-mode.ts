/**
 * The rider's current activity (ride or hike) as a tiny external value.
 *
 * It lives in the application layer, free of React and of any ride store, so the
 * map host can read the mode and follow changes without importing UI state. The
 * UI layer owns changing it (see `@/ui/stores/activity-mode`).
 */

export type ActivityMode = "ride" | "hike";
const KEY = "og-activity-mode";
const listeners = new Set<() => void>();
let mode: ActivityMode | undefined;

export function getActivityMode(): ActivityMode {
  if (mode === undefined) {
    try { mode = typeof window !== "undefined" && localStorage.getItem(KEY) === "hike" ? "hike" : "ride"; } catch { mode = "ride"; }
  }
  return mode;
}
export function setActivityMode(next: ActivityMode): void {
  mode = next;
  try { localStorage.setItem(KEY, next); } catch { /* Storage is optional. */ }
  listeners.forEach((listener) => listener());
}
export function subscribeActivityMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
