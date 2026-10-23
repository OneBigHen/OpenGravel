import { describe, expect, it, vi } from "vitest";

import { APPEARANCE_STORAGE_KEY, DRAFT_DIRTY_STORAGE_KEY, NAV_SCREEN_STORAGE_KEY, SPOTIFY_CLIENT_ID_STORAGE_KEY, VOICE_MUTED_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import {
  BASEMAP_LOOK_PREFERENCE_KEY,
  CAMERA_ROUTE_ONLY_STORAGE_KEY,
  MAP_LAYERS_STORAGE_KEY,
  SATELLITE_PREFERENCE_KEY,
} from "@/application/map/preferences";
import { PLANNER_PLACES_PREFERENCE_KEY, RIDE_PLACES_PREFERENCE_KEY } from "@/application/places/preferences";
import { COMMUNITY_DEVICE_ID_STORAGE_KEY } from "@/application/contributions/device-id";
import { clearAllLocalData, LOCAL_DATA_STORAGE_KEYS } from "@/infrastructure/storage/clear-all-local-data";
import { BOOTSTRAP_POINTER_KEY } from "@/infrastructure/storage/bootstrap-pointer";
import { FREE_RIDE_TELEMETRY_STORAGE_KEY } from "@/infrastructure/storage/free-ride-telemetry-storage";
import { GARAGE_STORAGE_KEY } from "@/infrastructure/storage/garage-storage";
import { HOME_LOCATION_STORAGE_KEY } from "@/infrastructure/storage/home-location-storage";
import { createPlaceMemoryStore, PLACE_MEMORY_STORAGE_KEY } from "@/infrastructure/storage/place-memory-storage";
import { PLACE_NAME_STORAGE_KEY } from "@/infrastructure/storage/place-name-storage";
import { RIDE_FOCUS_POINTER_KEY } from "@/infrastructure/storage/ride-focus-pointer";
import { RIDER_SETTINGS_STORAGE_KEY } from "@/infrastructure/storage/rider-settings-storage";
import { TELEMETRY_CONSENT_STORAGE_KEY } from "@/infrastructure/telemetry/local-storage-consent-store";

/**
 * The device data the app writes. Imported from the owning modules (not
 * retyped here) so a key the app starts writing later has to appear in the
 * delete list, and `local-data-storage-keys.test.ts` catches a module that is
 * missed entirely.
 */
const APP_WRITTEN_KEYS = [
  GARAGE_STORAGE_KEY,
  SATELLITE_PREFERENCE_KEY,
  TELEMETRY_CONSENT_STORAGE_KEY,
  BOOTSTRAP_POINTER_KEY,
  RIDE_FOCUS_POINTER_KEY,
  HOME_LOCATION_STORAGE_KEY,
  DRAFT_DIRTY_STORAGE_KEY,
  PLACE_NAME_STORAGE_KEY,
  COMMUNITY_DEVICE_ID_STORAGE_KEY,
  RIDE_PLACES_PREFERENCE_KEY,
  PLANNER_PLACES_PREFERENCE_KEY,
  RIDER_SETTINGS_STORAGE_KEY,
  FREE_RIDE_TELEMETRY_STORAGE_KEY,
  PLACE_MEMORY_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  NAV_SCREEN_STORAGE_KEY,
  BASEMAP_LOOK_PREFERENCE_KEY,
  MAP_LAYERS_STORAGE_KEY,
  CAMERA_ROUTE_ONLY_STORAGE_KEY,
  SPOTIFY_CLIENT_ID_STORAGE_KEY,
  VOICE_MUTED_STORAGE_KEY,
] as const;

describe("clearAllLocalData", () => {
  it("removes every app-owned local-storage key and deletes the VNext database", async () => {
    const values = new Map<string, string>(APP_WRITTEN_KEYS.map((key) => [key, "present"]));
    const storage = {
      removeItem: vi.fn((key: string) => { values.delete(key); }),
    };
    const deleteDatabase = vi.fn(async () => undefined);

    await clearAllLocalData(storage, deleteDatabase);

    expect(LOCAL_DATA_STORAGE_KEYS).toEqual(expect.arrayContaining([...APP_WRITTEN_KEYS]));
    expect(storage.removeItem.mock.calls.map(([key]) => key)).toEqual([...LOCAL_DATA_STORAGE_KEYS]);
    expect(values.size).toBe(0);
    expect(deleteDatabase).toHaveBeenCalledOnce();
  });

  it("drops a mounted place-memory store's cached saved places", async () => {
    const values = new Map<string, string>([
      [PLACE_MEMORY_STORAGE_KEY, JSON.stringify({
        saved: [{
          id: "place_home",
          name: "Home",
          label: "Home, Jim Thorpe, PA",
          context: "PA",
          provider: "geocoder",
          coordinate: { lon: -75.7, lat: 40.9 },
        }],
        recents: [],
      })],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const memory = createPlaceMemoryStore(storage);
    expect(memory.read().saved).toHaveLength(1);

    await clearAllLocalData(storage, async () => undefined);

    expect(memory.read().saved).toEqual([]);
    expect(storage.getItem(PLACE_MEMORY_STORAGE_KEY)).toBeNull();
  });
});
