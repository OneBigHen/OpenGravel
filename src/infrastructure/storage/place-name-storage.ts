/**
 * localStorage persistence for the place-name cache (M1, OGV-D-260).
 *
 * Names are re-derivable evidence, so every failure here — private browsing, a
 * full quota, a corrupt value — degrades to an empty cache and nothing else.
 */

import type { PlaceNameStoragePort } from "@/application/geocoding/place-names";

export const PLACE_NAME_STORAGE_KEY = "opengravel-vnext-place-names";

export function createLocalStoragePlaceNames(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
): PlaceNameStoragePort {
  return {
    load() {
      const raw = storage?.getItem(PLACE_NAME_STORAGE_KEY);
      if (raw === null || raw === undefined) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    },
    save(entries) {
      storage?.setItem(PLACE_NAME_STORAGE_KEY, JSON.stringify(entries));
    },
  };
}
