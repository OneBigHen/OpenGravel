/**
 * The one-shot "the rider just tapped Start ride" marker (UX rework phase 6).
 *
 * A ride page reconstructs its session from the journal and comes back paused
 * (8 §13), which is right after a reload or a crash and wrong after the rider's
 * own Start: every navigation app starts guiding on Start. The planner marks the
 * handoff in this tab's sessionStorage, and the ride page consumes the mark
 * once. A fresh mark resumes the ride; a reload, a new tab or a stale mark
 * (older than {@link HANDOFF_MAX_AGE_MS}) still comes back paused.
 */

const KEY = "opengravel-vnext-ride-handoff";
export const HANDOFF_MAX_AGE_MS = 30_000;

export function markRideHandoff(now: number = Date.now()): void {
  try {
    window.sessionStorage.setItem(KEY, String(now));
  } catch {
    // Storage off: the ride simply opens paused, as after a reload.
  }
}

/** True once for a handoff marked in this tab within the last 30 s. */
export function consumeRideHandoff(now: number = Date.now()): boolean {
  try {
    const value = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (value === null) return false;
    const markedAt = Number(value);
    return Number.isFinite(markedAt) && now - markedAt >= 0 && now - markedAt <= HANDOFF_MAX_AGE_MS;
  } catch {
    return false;
  }
}
