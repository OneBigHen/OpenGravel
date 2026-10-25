/**
 * Where to come back to after Spotify's sign-in page. The server round-trips
 * `return_to` itself; this copy is the backup that survives a redirect that
 * lands somewhere else (for example Settings after a setup error), so the rider
 * can always get back to the ride that was running.
 */

const KEY = "og.ride.spotify-return";
const MAX_AGE_MS = 30 * 60 * 1000;

export type SpotifyOutcome = "connected" | "cancelled" | "error";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Only the ride screen is a valid place to come back to. */
export function isRideReturnPath(value: string): boolean {
  return /^\/ride(?:[?#].*)?$/.test(value) && !/[\\\s]/.test(value);
}

export function rememberRideReturn(
  path: string,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): void {
  if (storage === null || !isRideReturnPath(path)) return;
  try {
    storage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    // Private mode: the server-side return_to still works.
  }
}

/** The remembered ride path if it is fresh, else null. Does not clear it. */
export function readRideReturn(
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): string | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.path !== "string" || typeof parsed.at !== "number") return null;
    if (now - parsed.at > MAX_AGE_MS || !isRideReturnPath(parsed.path)) return null;
    return parsed.path;
  } catch {
    return null;
  }
}

export function clearRideReturn(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export function spotifyOutcomeOf(search: string): SpotifyOutcome | null {
  const value = new URLSearchParams(search).get("spotify");
  return value === "connected" || value === "cancelled" || value === "error" ? value : null;
}

/** The URL with the one-shot `spotify=` outcome removed. */
export function withoutSpotifyOutcome(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete("spotify");
  const rest = params.toString();
  return `${pathname}${rest.length === 0 ? "" : `?${rest}`}${hash}`;
}
