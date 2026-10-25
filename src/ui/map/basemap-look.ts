/**
 * The rider's basemap look, shared by the map surface and the sheet that owns
 * the choice on a phone.
 *
 * The look is a per-device preference, not ride state: it is remembered once
 * and never written into a ride document. Keeping the labels and the storage
 * read/write here means the map's own control and the layers sheet cannot
 * disagree about what "Night" means or which key remembers it.
 */

import {
  BASEMAP_LOOK_PREFERENCE_KEY,
  SATELLITE_PREFERENCE_KEY,
} from "@/application/map/preferences";

export type BasemapLook = "map" | "night" | "satellite";

export const LOOK_LABEL: Readonly<Record<BasemapLook, string>> = {
  map: "Map",
  night: "Night",
  satellite: "Satellite",
};

export const LOOK_NOTE: Readonly<Record<BasemapLook, string>> = {
  map: "Terrain, trails and roads",
  night: "Dark, for night riding",
  satellite: "Aerial imagery",
};

const lookListeners = new Set<() => void>();

/** Notifies the surfaces when a look is remembered (including another tab). */
export function subscribeLookChoice(listener: () => void): () => void {
  lookListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    lookListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function notifyLookChoice(): void {
  for (const listener of lookListeners) listener();
}

/** The rider's last basemap look; "map" when nothing is stored or storage is unavailable. */
export function readLookChoice(): BasemapLook {
  try {
    const stored = window.localStorage.getItem(BASEMAP_LOOK_PREFERENCE_KEY);
    if (stored === "map" || stored === "night" || stored === "satellite") return stored;
    // The older Map/Satellite toggle's choice carries over.
    return window.localStorage.getItem(SATELLITE_PREFERENCE_KEY) === "1" ? "satellite" : "map";
  } catch {
    return "map";
  }
}

/** Remembers a look. A private-mode device simply forgets it. */
export function writeLookChoice(look: BasemapLook): void {
  try {
    window.localStorage.setItem(BASEMAP_LOOK_PREFERENCE_KEY, look);
    window.localStorage.setItem(SATELLITE_PREFERENCE_KEY, look === "satellite" ? "1" : "0");
  } catch {
    // Storage may be unavailable (private mode); the choice simply is not kept.
  }
  notifyLookChoice();
}
