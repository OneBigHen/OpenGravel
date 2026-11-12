"use client";

/**
 * Save in one tap (round 3, restructure call 4): the ride is kept under an
 * automatic name ("Rothrock loop, 53 mi") with the exact line on screen, the
 * button becomes "Saved", and the name can then be changed in place. There is
 * no name box to fill first and no second save.
 */

import { useRef, useState } from "react";

import type { LibraryServicePort } from "@/application/library/library-service";
import type { SelectedOfflineRoute } from "@/application/offline/selected-offline-route";
import type { RideId } from "@/domain/ride/ids";
import type { RideDocument } from "@/domain/ride/types";

export type OneTapSaveState = "idle" | "saving" | "saved" | "failed";

/** The route's distance and time for the library card; unknown values stay out. */
function bundleSummaryOf(route: SelectedOfflineRoute): { distanceMeters?: number; durationSeconds?: number } {
  const { distanceMeters, durationSeconds } = route.summary;
  return {
    ...(distanceMeters === null ? {} : { distanceMeters }),
    ...(durationSeconds === null ? {} : { durationSeconds }),
  };
}

export interface OneTapSave {
  readonly state: OneTapSaveState;
  /** The name the ride was saved or renamed under, or `null` before a save. */
  readonly savedTitle: string | null;
  readonly error: string | null;
  readonly canSave: boolean;
  readonly save: () => Promise<void>;
  readonly rename: (title: string) => Promise<void>;
}

export function useOneTapSave(input: {
  readonly document: RideDocument;
  readonly libraryService: LibraryServicePort | undefined;
  readonly route: SelectedOfflineRoute | null;
  readonly automaticName: string;
}): OneTapSave {
  const { document, libraryService, route, automaticName } = input;
  const [state, setState] = useState<OneTapSaveState>("idle");
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedId = useRef<RideId | null>(null);
  const canSave = libraryService !== undefined && state !== "saving" && state !== "saved";

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setState("saving");
    setError(null);
    try {
      const saved = await libraryService.saveNamed(document, {
        title: automaticName,
        ...(route === null
          ? {}
          : {
              offlinePack: route.pack,
              bundleSummary: bundleSummaryOf(route),
              // The chosen card exactly: its line, numbers and measured facts,
              // so the ride reopens as this line with the same truth lines (R3-1).
              plannedRoute: {
                geometry: route.geometry,
                ...bundleSummaryOf(route),
                ...(route.evidence === undefined ? {} : { evidence: route.evidence }),
                ...(route.instructions === undefined ? {} : { instructions: route.instructions }),
              },
            }),
      });
      savedId.current = saved.document.rideId;
      setSavedTitle(automaticName);
      setState("saved");
    } catch {
      setState("failed");
      setError("Could not save this ride. Try again.");
    }
  };

  const rename = async (title: string): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed === "" || trimmed === savedTitle) return;
    setSavedTitle(trimmed);
    if (savedId.current === null || libraryService === undefined) return;
    try {
      await libraryService.renameRide(savedId.current, trimmed);
      setError(null);
    } catch {
      setError("The new name could not be saved. Try again.");
    }
  };

  return { state, savedTitle, error, canSave, save, rename };
}
