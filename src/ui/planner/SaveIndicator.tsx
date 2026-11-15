"use client";

import type { SaveIndicatorState } from "@/ui/stores/ride-document-store";

export interface SaveIndicatorProps {
  readonly state: SaveIndicatorState;
  /**
   * True once this document has had a save attempt that returned. A cold
   * planner has nothing to save, so an "unsaved" document with no result is
   * not a label a rider needs floating over the map (OG-23).
   */
  readonly savedBefore?: boolean;
}

/**
 * Single source of truth for the Wave 5.3b export capability. Keep this false
 * until a real export action exists; the quota recovery UI must not promise a
 * disabled button.
 */
export const RIDE_EXPORT_AVAILABLE = false;

export function saveIndicatorCopy(state: SaveIndicatorState): string {
  switch (state) {
    case "unsaved":
      return "Not saved";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "failed":
      return "Could not save";
    case "quota":
      return "Storage is full — try again after freeing space in browser settings";
    case "conflict":
      return "Conflict — choose an option";
  }
}

export function SaveIndicator({ state, savedBefore = false }: SaveIndicatorProps) {
  // OG-23: a cold planner is not "Not saved" — there is no ride, so there is
  // nothing to save and no label to show. After a save attempt the note stays.
  if (state === "unsaved" && !savedBefore) return null;
  return (
    <p
      className="og-planner__save-indicator"
      data-testid="save-indicator"
      data-state={state}
      role="status"
      aria-live="polite"
    >
      {saveIndicatorCopy(state)}
    </p>
  );
}
