"use client";

import { useState } from "react";

import { createLibraryService } from "@/application/library/library-service";
import { openSharedRide } from "@/application/sharing/ride-this";
import type { ShareSnapshot } from "@/domain/sharing/types";
import { createIndexedDbGeometryStore } from "@/infrastructure/storage/indexeddb-geometry-store";
import { rideRepository } from "@/infrastructure/storage/ride-repository";

/**
 * The one action on a public share page: put this exact line in the planner.
 *
 * It uses the browser's own library and geometry stores, then navigates to the
 * planner, which restores the ride from the prepared-route note. Nothing here
 * is a preview or a second planning attempt: the line that was just read is the
 * answer the planner shows.
 */
export function RideThisButton({
  snapshot,
  sourceId,
}: {
  readonly snapshot: ShareSnapshot;
  readonly sourceId: string;
}) {
  const [state, setState] = useState<"idle" | "opening" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function open(): Promise<void> {
    setState("opening");
    setMessage(null);
    try {
      const geometryStore = createIndexedDbGeometryStore();
      const library = createLibraryService(rideRepository, { geometryStore });
      await openSharedRide(snapshot, sourceId, {
        library,
        geometryStore,
        storage: window.sessionStorage,
        now: () => new Date().toISOString(),
      });
      // A full load, deliberately: the planner restores its ride once, at boot.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the planner restores a ride only at boot
      window.location.assign("/");
    } catch (error: unknown) {
      setState("error");
      setMessage(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "This ride could not be opened. Check your connection and try again.",
      );
    }
  }

  return (
    <>
      <button
        type="button"
        className="og-primary"
        data-testid="ride-this-shared"
        aria-busy={state === "opening"}
        disabled={state === "opening"}
        onClick={() => {
          void open();
        }}
      >
        {state === "opening" ? "Opening this ride…" : "Ride this"}
      </button>
      {message === null ? null : (
        <p className="og-planner__error" role="alert">
          {message}
        </p>
      )}
    </>
  );
}
