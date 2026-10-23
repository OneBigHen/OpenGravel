/**
 * The removal secret this device received when it shared a route.
 *
 * The server keeps only a hash. Holding the secret is the proof of ownership
 * that lets this device take its own shared route down; a rider who never
 * shared the route has no token here and is offered the local hide instead.
 * Storage is best effort, and a failure is reported rather than claimed.
 */
const KEY_PREFIX = "opengravel.community.owner.";

function storageKey(routeId: string): string {
  return `${KEY_PREFIX}${routeId}`;
}

/** The token this device holds for a shared route, or null when it has none. */
export function ownerTokenFor(routeId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.localStorage.getItem(storageKey(routeId));
    return token !== null && /^[A-Za-z0-9_-]{32,128}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Keeps a freshly minted token. False means this device cannot remove it later. */
export function rememberOwnerToken(routeId: string, token: string): boolean {
  if (typeof window === "undefined" || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return false;
  try {
    window.localStorage.setItem(storageKey(routeId), token);
    return true;
  } catch {
    return false;
  }
}
