/**
 * Settings → Lock screen Live Activity (app only): whether a ride or hike
 * shows on the Lock Screen and in the Dynamic Island. On unless the rider
 * turned it off; only the "off" choice is stored.
 */

import { LIVE_ACTIVITY_STORAGE_KEY } from "@/application/persistence/local-data-keys";

export { LIVE_ACTIVITY_STORAGE_KEY };
export const LIVE_ACTIVITY_CHANGE_EVENT = "og-live-activity-change";
export const DEFAULT_LIVE_ACTIVITY = true;

export function readLiveActivityEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(LIVE_ACTIVITY_STORAGE_KEY) !== "off";
  } catch {
    return DEFAULT_LIVE_ACTIVITY;
  }
}

export function setLiveActivityEnabled(enabled: boolean): void {
  try {
    if (enabled) globalThis.localStorage?.removeItem(LIVE_ACTIVITY_STORAGE_KEY);
    else globalThis.localStorage?.setItem(LIVE_ACTIVITY_STORAGE_KEY, "off");
  } catch {
    // Storage blocked: the choice lasts this visit.
  }
  globalThis.dispatchEvent?.(new CustomEvent(LIVE_ACTIVITY_CHANGE_EVENT, { detail: enabled }));
}
