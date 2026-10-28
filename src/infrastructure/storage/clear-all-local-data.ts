import { DRAFT_DIRTY_STORAGE_KEY, APPEARANCE_STORAGE_KEY, HIDDEN_ROUTES_STORAGE_KEY, NAV_SCREEN_STORAGE_KEY, LIVE_ACTIVITY_STORAGE_KEY, SPOTIFY_CLIENT_ID_STORAGE_KEY, VOICE_MUTED_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import { PLANNER_PLACES_PREFERENCE_KEY, RIDE_PLACES_PREFERENCE_KEY } from "@/application/places/preferences";
import { COMMUNITY_DEVICE_ID_STORAGE_KEY } from "@/application/contributions/device-id";
import { BASEMAP_LOOK_PREFERENCE_KEY, CAMERA_ROUTE_ONLY_STORAGE_KEY, MAP_LAYERS_STORAGE_KEY, SATELLITE_PREFERENCE_KEY } from "@/application/map/preferences";
import { TELEMETRY_CONSENT_STORAGE_KEY } from "@/infrastructure/telemetry/local-storage-consent-store";
import { BOOTSTRAP_POINTER_KEY } from "@/infrastructure/storage/bootstrap-pointer";
import { GARAGE_STORAGE_KEY } from "@/infrastructure/storage/garage-storage";
import { deleteVNextDatabase } from "@/infrastructure/storage/db";
import { BasemapArchiveStore } from "@/infrastructure/offline/basemap-archive-store";
import { deleteOfflineRegionDatabase } from "@/infrastructure/offline/region-download-store";
import { PLACE_NAME_STORAGE_KEY } from "@/infrastructure/storage/place-name-storage";
import { RIDE_FOCUS_POINTER_KEY } from "@/infrastructure/storage/ride-focus-pointer";
import { HOME_LOCATION_STORAGE_KEY } from "@/infrastructure/storage/home-location-storage";
import { RIDER_SETTINGS_STORAGE_KEY } from "@/infrastructure/storage/rider-settings-storage";
import { FREE_RIDE_TELEMETRY_STORAGE_KEY } from "@/infrastructure/storage/free-ride-telemetry-storage";
import { invalidatePlaceMemoryCaches, PLACE_MEMORY_STORAGE_KEY } from "@/infrastructure/storage/place-memory-storage";
import { LIVE_RIDER_NAME_STORAGE_KEY, LIVE_SESSION_STORAGE_KEY } from "@/application/live/storage-keys";

import { HIKE_EXPLORE_ORIGIN_KEY } from "@/application/map/explore-origin";
import { KEPT_ROUTE_STORAGE_KEY } from "@/application/explore/ride-this";
export const LOCAL_DATA_STORAGE_KEYS = [
  KEPT_ROUTE_STORAGE_KEY,
  HIKE_EXPLORE_ORIGIN_KEY,
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
  // The rider's saved places and recents (names plus coordinates) and the
  // device choices a borrowed phone should not keep on their behalf.
  PLACE_MEMORY_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  NAV_SCREEN_STORAGE_KEY,
  LIVE_ACTIVITY_STORAGE_KEY,
  BASEMAP_LOOK_PREFERENCE_KEY,
  MAP_LAYERS_STORAGE_KEY,
  `${MAP_LAYERS_STORAGE_KEY}.hike`,
  "og-activity-mode",
  CAMERA_ROUTE_ONLY_STORAGE_KEY,
  SPOTIFY_CLIENT_ID_STORAGE_KEY,
  VOICE_MUTED_STORAGE_KEY,
  HIDDEN_ROUTES_STORAGE_KEY,
  // A live link being shared, with its write secret, and the name on it.
  LIVE_SESSION_STORAGE_KEY,
  LIVE_RIDER_NAME_STORAGE_KEY,
  "og.ride.install-hint-dismissed",
  "og.ride.spotify-return",
] as const;

export interface LocalDataStorage {
  removeItem(key: string): void;
}

function browserStorage(): LocalDataStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

async function deleteDeviceDatabases(): Promise<void> {
  await deleteVNextDatabase();
  await deleteOfflineRegionDatabase();
  await BasemapArchiveStore.clear();
}

/** Clears every app-owned device key, the VNext IndexedDB database and downloaded offline areas. */
export async function clearAllLocalData(
  storage?: LocalDataStorage | null,
  deleteDatabase: () => Promise<void> = deleteDeviceDatabases,
): Promise<void> {
  const failures: unknown[] = [];
  let targetStorage = storage;
  if (targetStorage === undefined) {
    try {
      targetStorage = browserStorage();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (targetStorage != null) {
    for (const key of LOCAL_DATA_STORAGE_KEYS) {
      try {
        targetStorage.removeItem(key);
      } catch (error: unknown) {
        failures.push(error);
      }
    }
  }
  try { if (typeof window !== "undefined") window.sessionStorage.removeItem(HIKE_EXPLORE_ORIGIN_KEY); } catch (error: unknown) { failures.push(error); }
  // A mounted place-memory store keeps its own copy; drop it so the saved
  // places cannot reappear from memory after the keys are gone.
  invalidatePlaceMemoryCaches();
  try {
    await deleteDatabase();
  } catch (error: unknown) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new Error("Could not clear all local data");
  }
}
