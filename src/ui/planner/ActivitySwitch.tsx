"use client";

import { setActivityMode, useActivityMode } from "@/ui/stores/activity-mode";

const ACTIVITIES = [
  { mode: "ride", label: "Ride" },
  { mode: "hike", label: "Hike" },
] as const;

/**
 * Ride / Hike, as a two-way segmented control. It lives in Settings, so it wears
 * the same segmented style as Day / Night above it (green when selected); the
 * map's first screen stays clear of it.
 */
export function ActivitySwitch() {
  const mode = useActivityMode();
  return (
    <div className="og-settings__segmented" role="radiogroup" aria-label="Activity">
      {ACTIVITIES.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          role="radio"
          className="og-settings__segment"
          aria-checked={mode === entry.mode}
          data-testid={`activity-${entry.mode}`}
          onClick={() => setActivityMode(entry.mode)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
