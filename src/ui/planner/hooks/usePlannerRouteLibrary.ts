"use client";

/**
 * The national library, loaded once the planner has a route to compare against.
 *
 * The rider's own plan is the home page; an empty plan must not pay for a
 * 250 KB index it cannot use. Once loaded, the library stays for the session so
 * the next plan on the same phone opens with its great roads already known. A
 * deployment without a pack returns `null` and the planner is exactly as it was.
 */

import { useEffect, useRef, useState } from "react";

import { loadRouteLibrary, type RouteLibrary } from "@/application/route-library/client";

export function usePlannerRouteLibrary(enabled: boolean): RouteLibrary | null {
  const [library, setLibrary] = useState<RouteLibrary | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    let active = true;
    void loadRouteLibrary().then((loaded) => {
      if (active) setLibrary(loaded);
    });
    return () => { active = false; };
  }, [enabled]);
  return library;
}
