/**
 * Where the rider was standing in the Explore list.
 *
 * A list of a hundred rides is read by scrolling; opening one and coming back
 * must land on the card the rider tapped, not at the top of the list. The list
 * notes its offset on the way out and restores it once on the way back. The
 * note lives in this tab's `sessionStorage` and expires, so an old position
 * never moves a list the rider has just opened.
 */

/** This tab's note; a new tab starts at the top. */
const EXPLORE_LIST_POSITION_SESSION_KEY = "opengravel.explore.list-position";

/** How long a remembered offset stays useful (a rider coming straight back). */
export const LIST_POSITION_MAX_AGE_MS = 10 * 60_000;

interface RememberedPosition {
  readonly y: number;
  readonly at: number;
}

function read(now: number): number | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(EXPLORE_LIST_POSITION_SESSION_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { y, at } = parsed as Partial<RememberedPosition>;
    if (typeof y !== "number" || !Number.isFinite(y) || y < 0) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (now - at < 0 || now - at > LIST_POSITION_MAX_AGE_MS) return null;
    return y;
  } catch {
    return null;
  }
}

/** Notes the list offset before the rider leaves it for a route page. */
export function rememberListPosition(y: number, now: number = Date.now()): void {
  if (typeof window === "undefined" || !Number.isFinite(y)) return;
  const remembered: RememberedPosition = { y: Math.max(0, Math.round(y)), at: now };
  try {
    window.sessionStorage.setItem(EXPLORE_LIST_POSITION_SESSION_KEY, JSON.stringify(remembered));
  } catch {
    // A browser that refuses storage simply starts the next visit at the top.
  }
}

/** The offset without spending it, for the way back to know where it leads. */
export function peekListPosition(now: number = Date.now()): number | null {
  return read(now);
}

/**
 * The offset to restore, read once. Consuming it here (rather than keeping it)
 * means Forward, a reload or a second visit never yanks the list again.
 */
export function takeListPosition(now: number = Date.now()): number | null {
  if (typeof window === "undefined") return null;
  const y = read(now);
  try {
    window.sessionStorage.removeItem(EXPLORE_LIST_POSITION_SESSION_KEY);
  } catch {
    // Nothing to clean up if storage is off.
  }
  return y;
}
