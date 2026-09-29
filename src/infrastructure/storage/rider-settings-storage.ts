import {
  createRiderSettings,
  parseRiderSettings,
  type RiderSettingsStoragePort,
} from "@/application/ride-metrics/rider-settings";

export interface RiderSettingsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One versioned record (RIDE-INSTRUMENT-STRIP §5); the version lives inside it. */
export const RIDER_SETTINGS_STORAGE_KEY = "opengravel.vnext.rider-settings";

function defaultStorage(): RiderSettingsStorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalStorageRiderSettings(
  storage: RiderSettingsStorageLike | null = defaultStorage(),
): RiderSettingsStoragePort {
  return {
    read() {
      try {
        const raw = storage?.getItem(RIDER_SETTINGS_STORAGE_KEY);
        if (raw === null || raw === undefined) return createRiderSettings();
        return parseRiderSettings(JSON.parse(raw));
      } catch {
        return createRiderSettings();
      }
    },
    write(settings) {
      try {
        storage?.setItem(RIDER_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // Storage can be disabled or full; the choice still applies for this ride.
      }
    },
    clear() {
      try {
        storage?.removeItem(RIDER_SETTINGS_STORAGE_KEY);
      } catch {
        // Deletion remains best effort when browser storage is unavailable.
      }
    },
  };
}
