"use client";

/**
 * "Ride this" on a curated map ride (first-minute wow, W5).
 *
 * It is Explore's own path, reused rather than reinvented: the catalog route
 * becomes a derivative ride document through the library service, and its
 * published line is handed to the planner as that ride's answer, so the planner
 * opens ready to start instead of planning the same route again.
 *
 * The planner is already on screen, and it restores its ride once, at boot.
 * That is why the handoff ends in a full load with a one-boot marker naming the
 * ride to restore: the same one-shot Explore takes when it navigates here.
 *
 * Nothing here runs until the rider presses the button; opening a card never
 * changes the map.
 */

import { useCallback } from "react";

import type { GeometryStore } from "@/application/geometry/geometry-store";
import { fetchCatalogRide, markRideToRestore, openCatalogRide } from "@/application/explore/ride-this";
import type { LibraryServicePort } from "@/application/library/library-service";

export function useOpenCuratedRide(options: {
  readonly libraryService: LibraryServicePort | undefined;
  readonly geometryStore: GeometryStore | undefined;
}): (routeId: string) => Promise<void> {
  const { libraryService, geometryStore } = options;
  return useCallback(async (routeId: string): Promise<void> => {
    if (libraryService === undefined) throw new Error("This map cannot open rides.");
    const entry = await fetchCatalogRide(routeId);
    if (entry === null) throw new Error("That ride could not be read.");
    const opened = await openCatalogRide(entry, libraryService, geometryStore ?? null);
    markRideToRestore(opened.rideId);
    // A full load, deliberately: the planner restores its ride once, at boot.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the planner restores a ride only at boot
    window.location.assign("/");
  }, [geometryStore, libraryService]);
}
