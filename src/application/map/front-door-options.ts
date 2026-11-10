/**
 * The side features that stay off the first screen until the rider asks for
 * them in Settings (milestone 3, "one clean front door"): the AI Ask button
 * and the traffic-camera layer. Both are off by default; only the "on" choice
 * is stored, per device.
 *
 * Like the activity mode, this is a tiny external value in the application
 * layer so any surface can read it without importing UI state; the UI layer
 * owns the hook (see `@/ui/stores/front-door-options`).
 */

import { FRONT_DOOR_ASK_STORAGE_KEY, FRONT_DOOR_CAMERAS_STORAGE_KEY } from "@/application/persistence/local-data-keys";

export type FrontDoorOption = "ask" | "cameras";

const KEYS: Readonly<Record<FrontDoorOption, string>> = {
  ask: FRONT_DOOR_ASK_STORAGE_KEY,
  cameras: FRONT_DOOR_CAMERAS_STORAGE_KEY,
};

const listeners = new Set<() => void>();
/** What the rider chose this visit, for a device whose storage is blocked. */
const visitChoice = new Map<FrontDoorOption, boolean>();

export function getFrontDoorOption(option: FrontDoorOption): boolean {
  try {
    return globalThis.localStorage?.getItem(KEYS[option]) === "on";
  } catch {
    return visitChoice.get(option) ?? false;
  }
}

export function setFrontDoorOption(option: FrontDoorOption, on: boolean): void {
  visitChoice.set(option, on);
  try {
    if (on) globalThis.localStorage?.setItem(KEYS[option], "on");
    else globalThis.localStorage?.removeItem(KEYS[option]);
  } catch {
    // Storage is optional: the choice lasts this visit.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeFrontDoorOptions(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing the choice reaches this one too.
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || Object.values(KEYS).includes(event.key)) listener();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}
