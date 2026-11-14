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

import { requestApproach } from "@/application/ride-session/approach-request";
import type { GeometryStore } from "@/application/geometry/geometry-store";
import {
  fetchCatalogRide,
  markRideToRestore,
  openCatalogRide,
  openLibraryRide,
} from "@/application/explore/ride-this";
import type { LibraryServicePort } from "@/application/library/library-service";
import type { RideId } from "@/domain/ride/ids";

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
    loadPlanner();
  }, [geometryStore, libraryService]);
}

/** A full load, deliberately: the planner restores its ride once, at boot. */
function loadPlanner(): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the planner restores a ride only at boot
  window.location.assign("/");
}

/**
 * Open a ride from My rides (R3-1, "saved means exact").
 *
 * The same path as the curated "Ride this" above: a working copy of the saved
 * ride, its own kept line handed to the planner as the answer, and a one-boot
 * marker naming the ride. A saved ride opens as exactly the line that was saved
 * and an imported track as its own track; neither asks the router.
 */
export function useOpenSavedRide(options: {
  readonly libraryService: LibraryServicePort | undefined;
  readonly geometryStore: GeometryStore | undefined;
}): (rideId: RideId, options?: { readonly announcement?: string | null; readonly approach?: boolean }) => Promise<void> {
  const { libraryService, geometryStore } = options;
  return useCallback(async (
    rideId: RideId,
    openOptions: { readonly announcement?: string | null; readonly approach?: boolean } = {},
  ): Promise<void> => {
    if (libraryService === undefined) throw new Error("This page cannot open rides.");
    const opened = await openLibraryRide(rideId, libraryService, geometryStore ?? null);
    const announcement = openOptions.announcement ?? null;
    const message = [opened.message, announcement].filter((part): part is string => part !== null && part !== "").join(" ");
    markRideToRestore(opened.rideId, { message: message === "" ? null : message });
    // "Ride to the start": the planner starts the ride and the ride screen
    // plans the way there (approach-request.ts).
    if (openOptions.approach === true) requestApproach(String(opened.rideId));
    loadPlanner();
  }, [geometryStore, libraryService]);
}
