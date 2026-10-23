import { HIDDEN_ROUTES_STORAGE_KEY } from "@/application/persistence/local-data-keys";

/**
 * Routes this device has hidden from its own Explore list.
 *
 * Hiding is a local preference, never a removal for everyone: a built-in
 * catalog route has no owner on this device, so "remove" can only mean "stop
 * showing it to me". The detail page stays reachable by link and offers the
 * reverse action.
 */
const STORAGE_KEY = HIDDEN_ROUTES_STORAGE_KEY;

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    // An unreadable preference is not "nothing hidden"; the caller treats it as
    // an empty set only for this render and never writes over the broken value.
    return new Set();
  }
}

export function hiddenRouteIds(): ReadonlySet<string> {
  return read();
}

/** Returns false when this browser refused to keep the preference. */
export function setRouteHidden(routeId: string, hidden: boolean): boolean {
  if (typeof window === "undefined") return false;
  const ids = read();
  if (hidden) ids.add(routeId);
  else ids.delete(routeId);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].sort()));
    return true;
  } catch {
    return false;
  }
}
