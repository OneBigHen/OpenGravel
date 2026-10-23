"use client";

/**
 * The opt-in switch for the routing-methods comparison.
 *
 * The comparison exposes internal method names, model readings and confidence
 * numbers. That is useful while judging routing, and noise for a rider planning
 * a ride, so it is only rendered when the page was opened with
 * `?debug=routing`. The flag is read on the client after hydration: the server
 * render (and the hydration pass) always says `false`, so the panel can never
 * flash into a page that did not ask for it.
 */

import { useSyncExternalStore } from "react";

export const ROUTING_DEBUG_PARAM = "debug";
export const ROUTING_DEBUG_VALUE = "routing";

/** Whether a URL search string (with its leading `?`) asks for the panel. */
export function isRoutingDebugSearch(search: string): boolean {
  return new URLSearchParams(search).get(ROUTING_DEBUG_PARAM) === ROUTING_DEBUG_VALUE;
}

/** The URL does not change under the panel; there is nothing to subscribe to. */
function subscribe(): () => void {
  return () => undefined;
}

function clientSnapshot(): boolean {
  return isRoutingDebugSearch(window.location.search);
}

function serverSnapshot(): boolean {
  return false;
}

/** False on the server and during hydration; the client reads the URL after it. */
export function useRoutingDebug(): boolean {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
