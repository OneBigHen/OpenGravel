"use client";

/** Settings → Display → Lock screen Live Activity (app only). */

import { useSyncExternalStore } from "react";

import {
  DEFAULT_LIVE_ACTIVITY,
  LIVE_ACTIVITY_CHANGE_EVENT,
  readLiveActivityEnabled,
  setLiveActivityEnabled,
} from "@/ui/navigation/live-activity-setting";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(LIVE_ACTIVITY_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LIVE_ACTIVITY_CHANGE_EVENT, onChange);
}

export function LiveActivityRow() {
  const enabled = useSyncExternalStore<boolean>(subscribe, readLiveActivityEnabled, () => DEFAULT_LIVE_ACTIVITY);
  return (
    <label className="og-settings__row og-settings__row--check">
      <span className="og-settings__row-text">
        <span className="og-settings__row-label">Lock screen Live Activity</span>
        <span className="og-settings__row-meta">Shows your next turn or your hike on the Lock Screen and Dynamic Island while a ride is running.</span>
      </span>
      <input
        type="checkbox"
        aria-label="Lock screen Live Activity"
        data-testid="live-activity-toggle"
        checked={enabled}
        onChange={(event) => setLiveActivityEnabled(event.target.checked)}
      />
    </label>
  );
}
