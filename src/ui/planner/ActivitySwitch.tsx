"use client";

import { setActivityMode, useActivityMode } from "@/ui/stores/activity-mode";

const ACTIVITIES = [
  { mode: "ride", label: "Ride" },
  { mode: "hike", label: "Hike" },
] as const;

/** Ride / Hike, as a two-way segmented control (app menu and Settings). */
export function ActivitySwitch() {
  const mode = useActivityMode();
  return (
    <div className="og-activity-switch" role="radiogroup" aria-label="Activity">
      {ACTIVITIES.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          role="radio"
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
