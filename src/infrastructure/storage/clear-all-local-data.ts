import { DRAFT_DIRTY_STORAGE_KEY } from "@/application/persistence/local-data-keys";
import { PLANNER_PLACES_PREFERENCE_KEY, RIDE_PLACES_PREFERENCE_KEY } from "@/application/places/preferences";
import { COMMUNITY_DEVICE_ID_STORAGE_KEY } from "@/application/contributions/device-id";
import { SATELLITE_PREFERENCE_KEY } from "@/application/map/preferences";
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

export const LOCAL_DATA_STORAGE_KEYS = [
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
  try {
    await deleteDatabase();
  } catch (error: unknown) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new Error("Could not clear all local data");
  }
}
