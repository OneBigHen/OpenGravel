"use client";

import type { SaveIndicatorState } from "@/ui/stores/ride-document-store";

export interface SaveIndicatorProps {
  readonly state: SaveIndicatorState;
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
      return "Not saved yet";
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

export function SaveIndicator({ state }: SaveIndicatorProps) {
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
